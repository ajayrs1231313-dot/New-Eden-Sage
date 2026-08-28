import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createGzip, gunzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import AdmZip from 'adm-zip';
import { pipeline } from 'node:stream/promises';

const ESI = 'https://esi.evetech.net';
const PUBLISH_ROOT = '/published';
const CURRENT_ROOT = path.join(PUBLISH_ROOT, 'source-current');
const STATE_ROOT = path.join(PUBLISH_ROOT, 'source-state');
const RAW_ROOT = process.env.NEW_EDEN_SAGE_RAW_MARKET_ROOT || path.join(CURRENT_ROOT, 'Raw Orders');
const HISTORY_ROOT = process.env.NEW_EDEN_SAGE_PUBLIC_HISTORY_ROOT || '/history';
const HISTORY_META_ROOT = path.join(HISTORY_ROOT, '_meta');
const HISTORY_PARTITION_INDEX_ROOT = path.join(HISTORY_META_ROOT, 'partitions');
const HISTORY_RECONCILE_MARKER = path.join(HISTORY_META_ROOT, 'reconcile-required');
const CONTRACT_ROOT = path.join(CURRENT_ROOT, 'public-contracts');
const CONTRACT_REGION_ROOT = path.join(CONTRACT_ROOT, 'regions');
const CONTRACT_ITEM_ROOT = path.join(CONTRACT_ROOT, 'items');
const CONTRACT_NAME_CACHE = path.join(CONTRACT_ROOT, 'name-cache.json');
const CONTRACT_SNAPSHOT_FILE = path.join(CONTRACT_ROOT, 'current.json.gz');
const CONTRACT_SDE_ARCHIVE = process.env.NEW_EDEN_SAGE_SDE_ARCHIVE || '/app/New Eden Sage Data/Static Data/eve-static-data-jsonl.zip';
const RETENTION_DAYS = Math.max(1, Number(process.env.NEW_EDEN_SAGE_PUBLIC_HISTORY_RETENTION_DAYS || 120));
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const REGION_CONCURRENCY = 6;
const PAGE_CONCURRENCY = 4;
const CONTRACT_REGION_CONCURRENCY = Math.max(1, Number(process.env.NEW_EDEN_SAGE_CONTRACT_REGION_CONCURRENCY || 4));
const CONTRACT_DETAIL_CONCURRENCY = Math.max(1, Number(process.env.NEW_EDEN_SAGE_CONTRACT_DETAIL_CONCURRENCY || 12));
const CONTRACT_DETAIL_BUDGET = Math.max(0, Number(process.env.NEW_EDEN_SAGE_CONTRACT_DETAIL_BUDGET || 1200));
const HEADERS = {
  Accept: 'application/json',
  'X-Compatibility-Date': '2026-08-02',
  'X-User-Agent': 'NewEdenSage-Public-Producer/1.1.12',
};

const PUBLIC_SOURCES = [
  { key: 'markets-prices', url: '/markets/prices/', history: true },
  { key: 'system-jumps', url: '/universe/system_jumps/', history: true },
  { key: 'system-kills', url: '/universe/system_kills/', history: true },
  { key: 'incursions', url: '/incursions/', history: true },
  { key: 'industry-systems', url: '/industry/systems/?datasource=tranquility', history: true },
  { key: 'sovereignty-systems', url: '/sovereignty/systems/', history: true },
  { key: 'sovereignty-campaigns', url: '/sovereignty/campaigns/', history: true },
  { key: 'fw-systems', url: '/fw/systems/', history: true },
  { key: 'fw-stats', url: '/fw/stats/', history: true },
];

const telemetry = {
  evaluatedAt: new Date().toISOString(), eligible: 0, skipped: 0, requests: 0, retries: 0,
  status200: 0, status304: 0, changedSources: 0, historyWrites: 0, historyFailures: 0,
  historyPruned: 0, historyPartitionsPruned: 0, historyBytesWritten: 0, historyBytesRemoved: 0,
  sourceBytes: 0, marketRegionsChanged: 0, marketRegionsUnchanged: 0,
  contractRegionsChanged: 0, contractRegionsUnchanged: 0, contractDetailsFetched: 0, contractDetailsPending: 0,
};

let historyMetadataQueue = Promise.resolve();
let historyWritesInFlight = 0;
let historyWriteFailed = false;
let historyDirtyMarkerPromise = null;

function safeTimestamp(value) { return value.replace(/[:.]/g, '-'); }
function safeName(value) { return String(value).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'source'; }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function dateKey(value = new Date()) { return value.toISOString().slice(0, 10); }

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.${Date.now()}.partial`;
  await fs.writeFile(partial, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(partial, file);
}
async function gzipJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.${Date.now()}.partial`;
  await pipeline(Readable.from([JSON.stringify(value)]), createGzip({ level: 6 }), createWriteStream(partial));
  await fs.rename(partial, file);
  return fs.stat(file);
}
async function readGzipJson(file, fallback = null) {
  try { return JSON.parse(gunzipSync(await fs.readFile(file)).toString('utf8')); } catch { return fallback; }
}

async function sha256File(file) {
  const hash = createHash('sha256');
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally { await handle.close(); }
  return hash.digest('hex');
}
async function mapLimited(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

function cacheSeconds(headers) {
  const cacheControl = String(headers.get('cache-control') || '');
  const match = cacheControl.match(/(?:^|,)\s*(?:s-maxage|max-age)=(\d+)/i);
  if (match) return Math.max(0, Number(match[1]));
  const expires = Date.parse(String(headers.get('expires') || ''));
  const date = Date.parse(String(headers.get('date') || '')) || Date.now();
  if (Number.isFinite(expires)) return Math.max(0, Math.ceil((expires - date) / 1000));
  return 0;
}
function retrySeconds(headers) {
  const value = String(headers.get('retry-after') || '').trim();
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return Math.max(1, Math.ceil((parsed - Date.now()) / 1000));
  const esiReset = Number(headers.get('x-esi-error-limit-reset') || 0);
  return Number.isFinite(esiReset) && esiReset > 0 ? esiReset : 0;
}
function responseState(previous, response, now = Date.now()) {
  const ttl = cacheSeconds(response.headers);
  return {
    ...previous,
    etag: response.headers.get('etag') || previous?.etag || null,
    lastModified: response.headers.get('last-modified') || previous?.lastModified || null,
    cacheControl: response.headers.get('cache-control') || null,
    expires: response.headers.get('expires') || null,
    nextEligibleAt: new Date(now + ttl * 1000).toISOString(),
    lastStatus: response.status,
    lastCheckedAt: new Date(now).toISOString(),
    rateGroup: response.headers.get('x-ratelimit-group') || previous?.rateGroup || null,
  };
}
function isEligible(state, now = Date.now()) {
  const next = Date.parse(String(state?.nextEligibleAt || ''));
  return !Number.isFinite(next) || next <= now;
}
function conditionalHeaders(state) {
  const headers = { ...HEADERS };
  if (state?.etag) headers['If-None-Match'] = state.etag;
  if (state?.lastModified) headers['If-Modified-Since'] = state.lastModified;
  return headers;
}
async function fetchWithBackoff(url, state, attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt <= attempts; attempt++) {
    try {
      telemetry.requests++;
      const response = await fetch(url, { headers: conditionalHeaders(state), signal: AbortSignal.timeout(30_000) });
      if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
        telemetry.retries++;
        await wait(Math.max(1, retrySeconds(response.headers), Math.min(20, 2 ** attempt)) * 1000);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      telemetry.retries++;
      await wait(Math.min(10_000, 1000 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function statePath(key) { return path.join(STATE_ROOT, `${safeName(key)}.json`); }
function currentPublicPath(key) { return path.join(CURRENT_ROOT, 'public', `${safeName(key)}.json`); }
async function readCurrentPublic(key) { return readJson(currentPublicPath(key), null); }
function historyPartitionIndexPath(day) { return path.join(HISTORY_PARTITION_INDEX_ROOT, `${day}.json`); }
function historyPartitionTemplate(day) {
  return { schemaVersion: 1, date: day, files: 0, bytes: 0, oldestObservedAt: null, newestObservedAt: null, sources: {} };
}
async function queueHistoryMetadata(work) {
  const queued = historyMetadataQueue.then(work, work);
  historyMetadataQueue = queued.then(() => undefined, () => undefined);
  return queued;
}
async function markHistoryDirty() {
  if (!historyDirtyMarkerPromise) {
    historyDirtyMarkerPromise = (async () => {
      await fs.mkdir(HISTORY_META_ROOT, { recursive: true });
      await fs.writeFile(HISTORY_RECONCILE_MARKER, new Date().toISOString(), 'utf8');
    })();
  }
  return historyDirtyMarkerPromise;
}
async function recordHistoryWrite(key, observedAt, bytes) {
  const day = dateKey(new Date(observedAt));
  const source = safeName(key);
  await queueHistoryMetadata(async () => {
    const file = historyPartitionIndexPath(day);
    const partition = await readJson(file, historyPartitionTemplate(day));
    const sourceState = partition.sources?.[source] || { files: 0, bytes: 0 };
    partition.schemaVersion = 1;
    partition.date = day;
    partition.files = Number(partition.files || 0) + 1;
    partition.bytes = Number(partition.bytes || 0) + bytes;
    partition.oldestObservedAt = !partition.oldestObservedAt || observedAt < partition.oldestObservedAt ? observedAt : partition.oldestObservedAt;
    partition.newestObservedAt = !partition.newestObservedAt || observedAt > partition.newestObservedAt ? observedAt : partition.newestObservedAt;
    partition.sources = { ...(partition.sources || {}), [source]: { files: Number(sourceState.files || 0) + 1, bytes: Number(sourceState.bytes || 0) + bytes } };
    await writeJsonAtomic(file, partition);
  });
}
async function writeHistory(key, observedAt, value) {
  const file = path.join(HISTORY_ROOT, safeName(key), dateKey(new Date(observedAt)), `${safeTimestamp(observedAt)}.json.gz`);
  historyWritesInFlight++;
  await markHistoryDirty();
  let success = false;
  try {
    const stat = await gzipJsonAtomic(file, { schemaVersion: 1, source: key, observedAt, data: value });
    await recordHistoryWrite(key, observedAt, stat.size);
    telemetry.historyWrites++;
    telemetry.historyBytesWritten += stat.size;
    success = true;
    return file;
  } catch (error) {
    historyWriteFailed = true;
    telemetry.historyFailures++;
    return null;
  } finally {
    historyWritesInFlight--;
    if (success && historyWritesInFlight === 0 && !historyWriteFailed) {
      await fs.rm(HISTORY_RECONCILE_MARKER, { force: true }).catch(() => undefined);
      historyDirtyMarkerPromise = null;
    }
  }
}
async function refreshJsonSource(definition) {
  const state = await readJson(statePath(definition.key), {});
  const existing = await readCurrentPublic(definition.key);
  if (!isEligible(state)) {
    telemetry.skipped++;
    if (!existing) throw new Error(`${definition.key} is ineligible but has no retained current representation.`);
    return { key: definition.key, changed: false, fetchedAt: existing.fetchedAt, data: existing.data, state };
  }
  telemetry.eligible++;
  let response;
  try { response = await fetchWithBackoff(`${ESI}${definition.url}`, state); }
  catch (error) {
    if (existing) return { key: definition.key, changed: false, fetchedAt: existing.fetchedAt, data: existing.data, state, error: String(error) };
    throw error;
  }
  const now = Date.now();
  if (response.status === 304) {
    telemetry.status304++;
    const nextState = responseState(state, response, now);
    await writeJsonAtomic(statePath(definition.key), nextState);
    if (!existing) throw new Error(`${definition.key} returned 304 without a retained representation.`);
    return { key: definition.key, changed: false, fetchedAt: existing.fetchedAt, data: existing.data, state: nextState };
  }
  if (response.status === 429 || response.status >= 500) {
    const nextState = { ...state, nextEligibleAt: new Date(now + Math.max(1, retrySeconds(response.headers)) * 1000).toISOString(), lastStatus: response.status, lastCheckedAt: new Date(now).toISOString() };
    await writeJsonAtomic(statePath(definition.key), nextState);
    if (existing) return { key: definition.key, changed: false, fetchedAt: existing.fetchedAt, data: existing.data, state: nextState, error: `ESI ${response.status}` };
    throw new Error(`ESI ${response.status} for ${definition.url}`);
  }
  if (!response.ok) {
    if (existing) return { key: definition.key, changed: false, fetchedAt: existing.fetchedAt, data: existing.data, state, error: `ESI ${response.status}` };
    throw new Error(`ESI ${response.status} for ${definition.url}`);
  }
  telemetry.status200++;
  const buffer = Buffer.from(await response.arrayBuffer());
  telemetry.sourceBytes += buffer.byteLength;
  const digest = sha256(buffer);
  const data = JSON.parse(buffer.toString('utf8'));
  const fetchedAt = new Date(now).toISOString();
  const changed = !existing || state.digest !== digest;
  const nextState = { ...responseState(state, response, now), digest, fetchedAt };
  if (changed) {
    telemetry.changedSources++;
    await writeJsonAtomic(currentPublicPath(definition.key), { schemaVersion: 1, source: definition.key, fetchedAt, digest, data });
    if (definition.history) await writeHistory(definition.key, fetchedAt, data);
  }
  await writeJsonAtomic(statePath(definition.key), nextState);
  return { key: definition.key, changed, fetchedAt: changed ? fetchedAt : existing.fetchedAt, data: changed ? data : existing.data, state: nextState };
}

async function loadCurrentRawManifest() { return readJson(path.join(RAW_ROOT, 'current-all.json'), null); }
function marketStateKey(regionId) { return `market-orders-${regionId}`; }
async function fetchMarketRegion(region, previousEntry, previousManifest) {
  const key = marketStateKey(region.regionId);
  const state = await readJson(statePath(key), {});
  if (!isEligible(state)) {
    telemetry.skipped++;
    if (!previousEntry) throw new Error(`${key} is ineligible but no retained region exists.`);
    telemetry.marketRegionsUnchanged++;
    return { region, changed: false, entry: previousEntry, state };
  }
  telemetry.eligible++;
  const base = `${ESI}/markets/${region.regionId}/orders/?order_type=all`;
  let response;
  try { response = await fetchWithBackoff(`${base}&page=1`, state); }
  catch (error) {
    if (previousEntry) { telemetry.marketRegionsUnchanged++; return { region, changed: false, entry: previousEntry, state, error: String(error) }; }
    throw error;
  }
  const now = Date.now();
  if (response.status === 304) {
    telemetry.status304++;
    const nextState = responseState(state, response, now);
    await writeJsonAtomic(statePath(key), nextState);
    if (!previousEntry) throw new Error(`${key} returned 304 without retained market orders.`);
    telemetry.marketRegionsUnchanged++;
    return { region, changed: false, entry: previousEntry, state: nextState };
  }
  if (!response.ok) {
    const retry = Math.max(0, retrySeconds(response.headers));
    const nextState = { ...state, nextEligibleAt: retry ? new Date(now + retry * 1000).toISOString() : state.nextEligibleAt, lastStatus: response.status, lastCheckedAt: new Date(now).toISOString() };
    await writeJsonAtomic(statePath(key), nextState);
    if (previousEntry) { telemetry.marketRegionsUnchanged++; return { region, changed: false, entry: previousEntry, state: nextState, error: `ESI ${response.status}` }; }
    throw new Error(`ESI ${response.status} for market region ${region.regionId}`);
  }
  telemetry.status200++;
  const firstBuffer = Buffer.from(await response.arrayBuffer());
  telemetry.sourceBytes += firstBuffer.byteLength;
  const first = JSON.parse(firstBuffer.toString('utf8'));
  const pages = Math.max(1, Number(response.headers.get('x-pages') || 1));
  const remaining = await mapLimited(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2), PAGE_CONCURRENCY, async pageNumber => {
    const pageResponse = await fetchWithBackoff(`${base}&page=${pageNumber}`, {});
    if (!pageResponse.ok) throw new Error(`ESI ${pageResponse.status} for market region ${region.regionId} page ${pageNumber}`);
    const buffer = Buffer.from(await pageResponse.arrayBuffer());
    telemetry.sourceBytes += buffer.byteLength;
    return JSON.parse(buffer.toString('utf8'));
  });
  const orders = first.concat(...remaining);
  const digest = sha256(Buffer.from(JSON.stringify(orders)));
  const fetchedAt = new Date(now).toISOString();
  const changed = !previousEntry || state.digest !== digest;
  const nextState = { ...responseState(state, response, now), digest, fetchedAt, pages, orderCount: orders.length };
  if (changed) {
    telemetry.marketRegionsChanged++;
    telemetry.changedSources++;
    let historyValue = { kind: 'checkpoint', regionId: region.regionId, regionName: region.name, orderCount: orders.length, orders };
    const checkpointAt = Date.parse(String(state.lastHistoryCheckpointAt || ''));
    const needsCheckpoint = !previousEntry || !Number.isFinite(checkpointAt) || now - checkpointAt >= 24 * 60 * 60 * 1000;
    if (!needsCheckpoint && previousEntry) {
      try {
        const previousPayload = JSON.parse(gunzipSync(await fs.readFile(path.join(RAW_ROOT, previousEntry.file))).toString('utf8'));
        const previousById = new Map((previousPayload.orders || []).map(order => [Number(order.order_id), order]));
        const nextById = new Map(orders.map(order => [Number(order.order_id), order]));
        const upserts = [];
        for (const order of orders) {
          const prior = previousById.get(Number(order.order_id));
          if (!prior || JSON.stringify(prior) !== JSON.stringify(order)) upserts.push(order);
        }
        const removedOrderIds = [];
        for (const orderId of previousById.keys()) if (!nextById.has(orderId)) removedOrderIds.push(orderId);
        historyValue = { kind: 'delta', regionId: region.regionId, regionName: region.name, orderCount: orders.length, upserts, removedOrderIds };
      } catch {
        historyValue = { kind: 'checkpoint', regionId: region.regionId, regionName: region.name, orderCount: orders.length, orders };
      }
    }
    const historyFile = await writeHistory(`market-orders-${region.regionId}`, fetchedAt, historyValue);
    if (historyFile && historyValue.kind === 'checkpoint') nextState.lastHistoryCheckpointAt = fetchedAt;
    await writeJsonAtomic(statePath(key), nextState);
  } else { telemetry.marketRegionsUnchanged++; await writeJsonAtomic(statePath(key), nextState); }
  return { region, changed, entry: previousEntry, state: nextState, orders, fetchedAt, digest };
}

async function discoverRegions() {
  const ids = await refreshJsonSource({ key: 'universe-regions', url: '/universe/regions/', history: false });
  const rows = await mapLimited(Array.isArray(ids.data) ? ids.data : [], 8, async regionId => {
    const detail = await refreshJsonSource({ key: `universe-region-${regionId}`, url: `/universe/regions/${regionId}/`, history: false });
    return { regionId: Number(regionId), name: String(detail.data?.name || `Region ${regionId}`) };
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

async function refreshMarketOrders(regions) {
  const started = performance.now();
  await fs.mkdir(RAW_ROOT, { recursive: true });
  const previous = await loadCurrentRawManifest();
  const previousEntries = new Map((previous?.regions || []).map(entry => [Number(entry.regionId), entry]));
  const refreshed = await mapLimited(regions, REGION_CONCURRENCY, region => fetchMarketRegion(region, previousEntries.get(region.regionId), previous));
  const changed = !previous || refreshed.some(item => item.changed);
  if (!changed) return { changed: false, snapshot: previous, durationMs: Math.round(performance.now() - started) };

  const createdAt = new Date().toISOString();
  const snapshot = { schemaVersion: 1, id: `${safeTimestamp(createdAt)}-all`, mode: 'all', createdAt, complete: false, regionCount: 0, orderCount: 0, regions: [] };
  const root = path.join(RAW_ROOT, snapshot.id);
  await fs.mkdir(path.join(root, 'regions'), { recursive: true });
  for (const item of refreshed) {
    const fileName = `${item.region.regionId}-${safeName(item.region.name)}.json.gz`;
    const relative = path.join(snapshot.id, 'regions', fileName);
    const target = path.join(RAW_ROOT, relative);
    let orderCount;
    if (item.changed || !item.entry) {
      const orders = item.orders || [];
      orderCount = orders.length;
      await gzipJsonAtomic(target, { schemaVersion: 1, snapshotId: snapshot.id, snapshotCreatedAt: snapshot.createdAt, regionId: item.region.regionId, regionName: item.region.name, orderCount, orders });
    } else {
      const previousFile = path.join(RAW_ROOT, item.entry.file);
      await fs.copyFile(previousFile, target);
      orderCount = Number(item.entry.orderCount || 0);
    }
    snapshot.regions.push({ regionId: item.region.regionId, regionName: item.region.name, orderCount, file: relative, savedAt: new Date().toISOString() });
  }
  snapshot.regions.sort((a, b) => a.regionName.localeCompare(b.regionName));
  snapshot.regionCount = snapshot.regions.length;
  snapshot.orderCount = snapshot.regions.reduce((sum, item) => sum + item.orderCount, 0);
  snapshot.complete = true;
  snapshot.completedAt = new Date().toISOString();
  await writeJsonAtomic(path.join(root, 'manifest.json'), snapshot);
  await writeJsonAtomic(path.join(RAW_ROOT, 'current.json'), snapshot);
  await writeJsonAtomic(path.join(RAW_ROOT, 'current-all.json'), snapshot);
  return { changed: true, snapshot, durationMs: Math.round(performance.now() - started) };
}


function contractRegionPath(regionId) { return path.join(CONTRACT_REGION_ROOT, `${regionId}.json.gz`); }
function contractItemPath(contractId) { return path.join(CONTRACT_ITEM_ROOT, `${contractId}.json.gz`); }
function contractStateKey(regionId) { return `public-contracts-${regionId}`; }
function activePublicContract(row, now = Date.now()) {
  if (!row || (row.type !== 'item_exchange' && row.type !== 'auction')) return false;
  const price = row.type === 'auction' ? Number(row.buyout || row.price || 0) : Number(row.price || 0);
  return price > 0 && Number.isFinite(Date.parse(String(row.date_expired || ''))) && Date.parse(row.date_expired) > now;
}
function normalizePublicContractMetadata(row) {
  return {
    contract_id: Number(row.contract_id), type: String(row.type || ''), availability: String(row.availability || 'public'),
    price: Number(row.price || 0), buyout: Number(row.buyout || 0), volume: Number(row.volume || 0), title: String(row.title || ''),
    date_expired: String(row.date_expired || ''), date_issued: String(row.date_issued || ''), start_location_id: Number(row.start_location_id || 0),
    issuer_id: Number(row.issuer_id || 0), issuer_corporation_id: Number(row.issuer_corporation_id || 0), for_corporation: row.for_corporation === true,
  };
}
async function fetchContractRegion(region) {
  const key = contractStateKey(region.regionId);
  const state = await readJson(statePath(key), {});
  const retained = await readGzipJson(contractRegionPath(region.regionId), null);
  if (!isEligible(state)) {
    telemetry.skipped++;
    if (!retained) throw new Error(`${key} is ineligible but has no retained contract metadata.`);
    telemetry.contractRegionsUnchanged++;
    return { region, changed: false, contracts: retained.contracts || [], state };
  }
  telemetry.eligible++;
  const base = `${ESI}/contracts/public/${region.regionId}/`;
  let response;
  try { response = await fetchWithBackoff(`${base}?page=1`, state); }
  catch (error) {
    if (retained) { telemetry.contractRegionsUnchanged++; return { region, changed: false, contracts: retained.contracts || [], state, error: String(error) }; }
    throw error;
  }
  const now = Date.now();
  if (response.status === 304) {
    telemetry.status304++;
    const nextState = responseState(state, response, now);
    await writeJsonAtomic(statePath(key), nextState);
    if (!retained) throw new Error(`${key} returned 304 without retained contract metadata.`);
    telemetry.contractRegionsUnchanged++;
    return { region, changed: false, contracts: retained.contracts || [], state: nextState };
  }
  if (!response.ok) {
    const retry = Math.max(0, retrySeconds(response.headers));
    const nextState = { ...state, nextEligibleAt: retry ? new Date(now + retry * 1000).toISOString() : state.nextEligibleAt, lastStatus: response.status, lastCheckedAt: new Date(now).toISOString() };
    await writeJsonAtomic(statePath(key), nextState);
    if (retained) { telemetry.contractRegionsUnchanged++; return { region, changed: false, contracts: retained.contracts || [], state: nextState, error: `ESI ${response.status}` }; }
    throw new Error(`ESI ${response.status} for public contracts region ${region.regionId}`);
  }
  telemetry.status200++;
  const firstBuffer = Buffer.from(await response.arrayBuffer());
  telemetry.sourceBytes += firstBuffer.byteLength;
  const first = JSON.parse(firstBuffer.toString('utf8'));
  const pages = Math.max(1, Number(response.headers.get('x-pages') || 1));
  const remaining = await mapLimited(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2), PAGE_CONCURRENCY, async pageNumber => {
    const pageResponse = await fetchWithBackoff(`${base}?page=${pageNumber}`, {});
    if (pageResponse.status === 404) return [];
    if (!pageResponse.ok) throw new Error(`ESI ${pageResponse.status} for public contracts region ${region.regionId} page ${pageNumber}`);
    const buffer = Buffer.from(await pageResponse.arrayBuffer());
    telemetry.sourceBytes += buffer.byteLength;
    return JSON.parse(buffer.toString('utf8'));
  });
  const contracts = first.concat(...remaining).filter(row => activePublicContract(row, now)).map(normalizePublicContractMetadata).sort((a, b) => a.contract_id - b.contract_id);
  const digest = sha256(Buffer.from(JSON.stringify(contracts)));
  const fetchedAt = new Date(now).toISOString();
  const changed = !retained || state.digest !== digest;
  const nextState = { ...responseState(state, response, now), digest, fetchedAt, pages, contractCount: contracts.length };
  if (changed) {
    telemetry.contractRegionsChanged++;
    telemetry.changedSources++;
    await gzipJsonAtomic(contractRegionPath(region.regionId), { schemaVersion: 1, regionId: region.regionId, regionName: region.name, fetchedAt, digest, contracts });
  } else telemetry.contractRegionsUnchanged++;
  await writeJsonAtomic(statePath(key), nextState);
  return { region, changed, contracts: changed ? contracts : (retained?.contracts || contracts), state: nextState };
}

let contractStaticLookupsPromise;
async function contractStaticLookups() {
  if (!contractStaticLookupsPromise) contractStaticLookupsPromise = (async () => {
    const { getMarketSystemIndex, getMarketTypeIndex } = await import('/app/dist-electron/market-static-index.js');
    const [systems, types] = await Promise.all([getMarketSystemIndex(), getMarketTypeIndex()]);
    return { systems, types };
  })();
  return contractStaticLookupsPromise;
}
let npcStationSystemPromise;
async function npcStationSystems() {
  if (!npcStationSystemPromise) npcStationSystemPromise = (async () => {
    const zip = new AdmZip(CONTRACT_SDE_ARCHIVE);
    const entry = zip.getEntry('npcStations.jsonl');
    if (!entry) throw new Error('Authoritative SDE is missing npcStations.jsonl.');
    const result = new Map();
    for (const line of entry.getData().toString('utf8').split(/\r?\n/)) {
      if (!line) continue;
      const row = JSON.parse(line);
      result.set(Number(row._key), Number(row.solarSystemID || 0));
    }
    return result;
  })();
  return npcStationSystemPromise;
}
async function resolveContractPublicNames(ids) {
  const cache = await readJson(CONTRACT_NAME_CACHE, { schemaVersion: 1, values: {} });
  cache.values ||= {};
  const requested = [...new Set(ids.map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
  const missing = requested.filter(id => !cache.values[String(id)]);
  let changed = false;
  for (let offset = 0; offset < missing.length; offset += 900) {
    const batch = missing.slice(offset, offset + 900);
    let response;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        telemetry.requests++;
        response = await fetch(`${ESI}/universe/names/`, { method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(batch), signal: AbortSignal.timeout(30_000) });
        if ((response.status === 429 || response.status >= 500) && attempt < 3) { telemetry.retries++; await wait(Math.max(1, retrySeconds(response.headers), 2 ** attempt) * 1000); continue; }
        break;
      } catch (error) {
        if (attempt >= 3) { response = null; break; }
        telemetry.retries++; await wait((attempt + 1) * 1000);
      }
    }
    if (!response?.ok) continue;
    const rows = await response.json();
    for (const row of Array.isArray(rows) ? rows : []) {
      cache.values[String(row.id)] = { name: String(row.name || ''), category: String(row.category || ''), resolvedAt: new Date().toISOString() };
      changed = true;
    }
  }
  if (changed) await writeJsonAtomic(CONTRACT_NAME_CACHE, cache);
  return new Map(requested.map(id => [id, cache.values[String(id)] || null]));
}
async function readContractItemCache(contractId) { return readGzipJson(contractItemPath(contractId), null); }
async function fetchContractItems(contractId) {
  const target = contractItemPath(contractId);
  const retained = await readContractItemCache(contractId);
  if (Array.isArray(retained?.items)) return retained;
  const checkedAt = Date.parse(String(retained?.checkedAt || ''));
  if (retained?.unavailable && Number.isFinite(checkedAt) && Date.now() - checkedAt < 6 * 60 * 60 * 1000) return retained;
  const response = await fetchWithBackoff(`${ESI}/contracts/public/items/${contractId}/`, {});
  const now = new Date().toISOString();
  if (response.status === 404 || response.status === 403) {
    const value = { schemaVersion: 1, contractId, unavailable: true, checkedAt: now };
    await gzipJsonAtomic(target, value);
    return value;
  }
  if (!response.ok) return retained;
  const buffer = Buffer.from(await response.arrayBuffer());
  telemetry.sourceBytes += buffer.byteLength;
  let items;
  try {
    if (!buffer.byteLength) return retained;
    items = JSON.parse(buffer.toString('utf8'));
  } catch {
    return retained;
  }
  if (!Array.isArray(items)) return retained;
  const value = { schemaVersion: 1, contractId, fetchedAt: now, items };
  await gzipJsonAtomic(target, value);
  telemetry.contractDetailsFetched++;
  return value;
}
function contractMetadataPrice(contract) { return contract.type === 'auction' && Number(contract.buyout || 0) > 0 ? Number(contract.buyout) : Number(contract.price || 0); }
function enrichContract(contract, itemPayload, names, stationSystems, systems, types, priceByType) {
  const stationSystemId = stationSystems.get(Number(contract.start_location_id)) || 0;
  const stationName = names.get(Number(contract.start_location_id))?.name || (stationSystemId ? `Station ${contract.start_location_id}` : `Public structure ${contract.start_location_id}`);
  const systemName = stationSystemId ? (systems.get(stationSystemId)?.name || `System ${stationSystemId}`) : 'Unresolved public structure';
  const items = Array.isArray(itemPayload?.items) ? itemPayload.items.map(item => {
    const meta = types.get(Number(item.type_id));
    return {
      typeId: Number(item.type_id), typeName: meta?.name || `Type ${item.type_id}`, itemVolumeM3: Number(meta?.volumeM3 || 0),
      estimatedUnitValue: Number(priceByType.get(Number(item.type_id)) || 0), estimatedValue: Number(priceByType.get(Number(item.type_id)) || 0) * Number(item.quantity || 0),
      quantity: Number(item.quantity || 0), included: item.is_included === true, isBlueprintCopy: item.is_blueprint_copy,
      runs: item.runs, materialEfficiency: item.material_efficiency, timeEfficiency: item.time_efficiency,
      itemId: item.item_id, isSingleton: item.is_singleton,
    };
  }) : [];
  return {
    contractId: Number(contract.contract_id), title: contract.title || 'Untitled contract', price: contractMetadataPrice(contract), volume: Number(contract.volume || 0),
    expires: contract.date_expired, startLocationId: Number(contract.start_location_id), startLocationName: stationName, systemId: stationSystemId, systemName,
    contractType: contract.type, availability: contract.availability || 'public', dateIssued: contract.date_issued || '',
    issuerId: Number(contract.issuer_id) > 0 ? Number(contract.issuer_id) : null,
    issuerName: Number(contract.issuer_id) > 0 ? (names.get(Number(contract.issuer_id))?.name || null) : null,
    issuerCorporationId: Number(contract.issuer_corporation_id) > 0 ? Number(contract.issuer_corporation_id) : null,
    issuerCorporationName: Number(contract.issuer_corporation_id) > 0 ? (names.get(Number(contract.issuer_corporation_id))?.name || null) : null,
    forCorporation: contract.for_corporation === true, buyout: Number(contract.buyout || 0) || null, items,
    itemsPending: !Array.isArray(itemPayload?.items),
  };
}
async function writeContractHistory(previous, snapshot) {
  const stateFile = statePath('public-contracts-history');
  const state = await readJson(stateFile, {});
  const now = Date.parse(snapshot.createdAt);
  const checkpointAt = Date.parse(String(state.lastHistoryCheckpointAt || ''));
  const needsCheckpoint = !previous || !Number.isFinite(checkpointAt) || now - checkpointAt >= 24 * 60 * 60 * 1000;
  let value;
  if (needsCheckpoint) value = { kind: 'checkpoint', contractCount: snapshot.contractCount, pendingDetailCount: snapshot.pendingDetailCount, regions: snapshot.regions };
  else {
    const before = new Map((previous.regions || []).flatMap(region => (region.publicContracts || []).map(contract => [Number(contract.contractId), contract])));
    const after = new Map((snapshot.regions || []).flatMap(region => (region.publicContracts || []).map(contract => [Number(contract.contractId), contract])));
    const upserts = [];
    for (const contract of after.values()) {
      const prior = before.get(Number(contract.contractId));
      if (!prior || JSON.stringify(prior) !== JSON.stringify(contract)) upserts.push(contract);
    }
    const removedContractIds = [];
    for (const contractId of before.keys()) if (!after.has(contractId)) removedContractIds.push(contractId);
    value = { kind: 'delta', contractCount: snapshot.contractCount, pendingDetailCount: snapshot.pendingDetailCount, upserts, removedContractIds };
  }
  const historyFile = await writeHistory('public-contracts', snapshot.createdAt, value);
  if (historyFile && needsCheckpoint) state.lastHistoryCheckpointAt = snapshot.createdAt;
  state.lastHistoryWriteAt = snapshot.createdAt;
  await writeJsonAtomic(stateFile, state);
}
async function refreshPublicContracts(regions) {
  const started = performance.now();
  await Promise.all([fs.mkdir(CONTRACT_REGION_ROOT, { recursive: true }), fs.mkdir(CONTRACT_ITEM_ROOT, { recursive: true })]);
  const previous = await readGzipJson(CONTRACT_SNAPSHOT_FILE, null);
  const regionResults = await mapLimited(regions, CONTRACT_REGION_CONCURRENCY, fetchContractRegion);
  const allContracts = regionResults.flatMap(result => result.contracts.map(contract => ({ region: result.region, contract })));
  const cachedRows = await mapLimited(allContracts, 48, async row => ({ ...row, itemPayload: await readContractItemCache(Number(row.contract.contract_id)) }));
  const missing = cachedRows.filter(row => {
    if (Array.isArray(row.itemPayload?.items)) return false;
    if (!row.itemPayload?.unavailable) return true;
    const checkedAt = Date.parse(String(row.itemPayload.checkedAt || ''));
    return !Number.isFinite(checkedAt) || Date.now() - checkedAt >= 6 * 60 * 60 * 1000;
  })
    .sort((a, b) => Date.parse(String(b.contract.date_issued || '')) - Date.parse(String(a.contract.date_issued || '')))
    .slice(0, CONTRACT_DETAIL_BUDGET);
  const fetched = new Map((await mapLimited(missing, CONTRACT_DETAIL_CONCURRENCY, async row => [Number(row.contract.contract_id), await fetchContractItems(Number(row.contract.contract_id))])).filter(Boolean));
  const rows = cachedRows.map(row => ({ ...row, itemPayload: fetched.get(Number(row.contract.contract_id)) || row.itemPayload }));
  const nameIds = rows.flatMap(row => {
    const locationId = Number(row.contract.start_location_id);
    const ids = [Number(row.contract.issuer_id), Number(row.contract.issuer_corporation_id)];
    if (locationId >= 60_000_000 && locationId < 64_000_000) ids.push(locationId);
    return ids;
  }).filter(id => id > 0);
  const [{ systems, types }, stationSystems, names, priceSource] = await Promise.all([contractStaticLookups(), npcStationSystems(), resolveContractPublicNames(nameIds), readJson(currentPublicPath('markets-prices'), { data: [] })]);
  const contractSourceRegions = regionResults
    .map(result => ({ regionId: result.region.regionId, regionName: result.region.name, contracts: result.contracts }))
    .sort((a, b) => a.regionId - b.regionId);
  const contractSourceDigest = sha256(Buffer.from(JSON.stringify(contractSourceRegions)));
  const marketPriceDigest = String(priceSource?.digest || '');
  const sourceDigest = sha256(Buffer.from(JSON.stringify({ contractSourceDigest, marketPriceDigest })));
  const sourceChanged = previous?.sourceDigest !== sourceDigest;
  const priceByType = new Map((Array.isArray(priceSource?.data) ? priceSource.data : []).map(row => [Number(row.type_id), Number(row.average_price || row.adjusted_price || 0)]));
  const byRegion = new Map(regions.map(region => [region.regionId, { regionId: region.regionId, regionName: region.name, publicContracts: [] }]));
  let pendingDetailCount = 0;
  for (const row of rows) {
    const enriched = enrichContract(row.contract, row.itemPayload, names, stationSystems, systems, types, priceByType);
    if (enriched.itemsPending) pendingDetailCount++;
    byRegion.get(row.region.regionId)?.publicContracts.push(enriched);
  }
  for (const region of byRegion.values()) region.publicContracts.sort((a, b) => a.contractId - b.contractId);
  const payloadRegions = [...byRegion.values()].filter(region => region.publicContracts.length).sort((a, b) => a.regionName.localeCompare(b.regionName));
  const digest = sha256(Buffer.from(JSON.stringify(payloadRegions)));
  const enrichmentChanged = previous?.digest !== digest;
  telemetry.contractDetailsPending = pendingDetailCount;
  if (!sourceChanged && previous) {
    return { changed: false, snapshot: previous, pendingDetailCount, enrichmentChanged, durationMs: Math.round(performance.now() - started) };
  }
  const createdAt = new Date().toISOString();
  const snapshot = {
    schemaVersion: 1, dataset: 'public-contracts', snapshotId: `${safeTimestamp(createdAt)}-contracts`, createdAt, digest, sourceDigest, contractSourceDigest, marketPriceDigest,
    regionCount: payloadRegions.length, contractCount: payloadRegions.reduce((sum, region) => sum + region.publicContracts.length, 0), pendingDetailCount, regions: payloadRegions,
  };
  await gzipJsonAtomic(CONTRACT_SNAPSHOT_FILE, snapshot);
  await writeContractHistory(previous, snapshot);
  return { changed: true, snapshot, pendingDetailCount, enrichmentChanged, durationMs: Math.round(performance.now() - started) };
}
async function contractBundle(contracts, previousManifest, generationRoot) {
  if (!contracts.changed && previousManifest?.files?.['public-contracts']) return { changed: false, files: await copyPreviousArtifacts(previousManifest, generationRoot, ['public-contracts']) };
  const target = path.join(generationRoot, 'public-contracts-v1.json.gz');
  const stat = await gzipJsonAtomic(target, contracts.snapshot);
  return { changed: true, files: { 'public-contracts': { version: contracts.snapshot.snapshotId, path: `generations/${path.basename(generationRoot)}/public-contracts-v1.json.gz`, bytes: stat.size, sha256: await sha256File(target), schemaVersion: 1 } } };
}

async function writeMarketArtifacts(generationRoot, snapshot) {
  const computeStarted = performance.now();
  const { buildFullMarketAnalysisIndex } = await import('/app/dist-electron/raw-market-analysis.js');
  const { buildRegionalMarketAggregateIndexFromFull } = await import('/app/dist-electron/regional-market-index.js');
  const { buildPreparedPublicTradeDataset, buildPreparedPublicShortageDataset } = await import('/app/dist-electron/public-market-intelligence.js');
  const index = await buildFullMarketAnalysisIndex(snapshot, { bypassCache: true, skipPersist: true, retainHistoricalCache: false });
  const regional = await buildRegionalMarketAggregateIndexFromFull(index, { progress: () => {} });
  const trades = await buildPreparedPublicTradeDataset(index);
  const shortages = await buildPreparedPublicShortageDataset(index);
  if (index.orderCount !== snapshot.orderCount || index.regionCount !== snapshot.regionCount || index.sourceOrdersInspected !== snapshot.orderCount) throw new Error('Prepared market counts do not match the authoritative current source snapshot.');

  const files = {};
  const globalPath = path.join(generationRoot, 'market-global-v1.json.gz');
  const globalPartial = `${globalPath}.${process.pid}.partial`;
  const header = { schemaVersion: 1, dataset: 'market-global', snapshotId: index.snapshotId, createdAt: index.createdAt, orderCount: index.orderCount, regionCount: index.regionCount, sourceOrdersInspected: index.sourceOrdersInspected, candidateDepthPerSide: index.candidateDepthPerSide, itemCount: index.items.size };
  async function* globalPayload() {
    yield `${JSON.stringify(header).slice(0, -1)},\"items\":[`;
    let first = true;
    for (const item of index.items.values()) { yield `${first ? '' : ','}${JSON.stringify(item)}`; first = false; }
    yield ']}';
  }
  await pipeline(Readable.from(globalPayload()), createGzip({ level: 6 }), createWriteStream(globalPartial));
  await fs.rename(globalPartial, globalPath);

  const regionalPath = path.join(generationRoot, 'market-regional-v1.jsonl.gz');
  const regionalPartial = `${regionalPath}.${process.pid}.partial`;
  async function* regionalPayload() {
    yield `${JSON.stringify({ schemaVersion: 1, dataset: 'market-regional', snapshotId: regional.snapshotId, createdAt: regional.createdAt, orderCount: regional.orderCount, regionCount: regional.regionCount, rowCount: regional.rows.length })}\n`;
    for (const row of regional.rows) yield `${JSON.stringify(row)}\n`;
  }
  await pipeline(Readable.from(regionalPayload()), createGzip({ level: 6 }), createWriteStream(regionalPartial));
  await fs.rename(regionalPartial, regionalPath);
  const tradesPath = path.join(generationRoot, 'market-trades-v1.json.gz');
  const shortagesPath = path.join(generationRoot, 'market-shortages-v1.json.gz');
  await gzipJsonAtomic(tradesPath, trades);
  await gzipJsonAtomic(shortagesPath, shortages);

  for (const [key, file] of [['market-global', globalPath], ['market-regional', regionalPath], ['market-trades', tradesPath], ['market-shortages', shortagesPath]]) {
    const stat = await fs.stat(file);
    files[key] = { version: snapshot.id, path: `generations/${path.basename(generationRoot)}/${path.basename(file)}`, bytes: stat.size, sha256: await sha256File(file), schemaVersion: 1 };
  }
  return { files, index, regional, trades, shortages, computeMs: Math.round(performance.now() - computeStarted) };
}

async function copyPreviousArtifacts(previousManifest, generationRoot, keys) {
  const files = {};
  for (const key of keys) {
    const metadata = previousManifest?.files?.[key];
    if (!metadata?.path) continue;
    const source = path.join(PUBLISH_ROOT, metadata.path);
    const target = path.join(generationRoot, path.basename(metadata.path));
    await fs.copyFile(source, target);
    files[key] = { ...metadata, path: `generations/${path.basename(generationRoot)}/${path.basename(target)}` };
  }
  return files;
}

async function publicBundle(results, previousManifest, generationRoot, forceWrite) {
  const sources = Object.fromEntries(results.map(item => [item.key, { fetchedAt: item.fetchedAt, data: item.data }]));
  const changed = forceWrite || results.some(item => item.changed) || !previousManifest?.files?.['public-shared'];
  if (!changed) return { changed: false, files: await copyPreviousArtifacts(previousManifest, generationRoot, ['public-shared']) };
  const createdAt = new Date().toISOString();
  const version = `${safeTimestamp(createdAt)}-public`;
  const target = path.join(generationRoot, 'public-shared-v1.json.gz');
  const stat = await gzipJsonAtomic(target, { schemaVersion: 1, dataset: 'public-shared', snapshotId: version, createdAt, sources });
  return { changed: true, files: { 'public-shared': { version, path: `generations/${path.basename(generationRoot)}/public-shared-v1.json.gz`, bytes: stat.size, sha256: await sha256File(target), schemaVersion: 1 } } };
}

async function historySourceDirectories() {
  let entries = [];
  try { entries = await fs.readdir(HISTORY_ROOT, { withFileTypes: true }); } catch { return []; }
  return entries.filter(entry => entry.isDirectory() && entry.name !== '_meta').map(entry => entry.name);
}
async function reconcileHistoryPartitionIndexes() {
  const started = performance.now();
  const partitions = new Map();
  const sources = await historySourceDirectories();
  for (const source of sources) {
    let dateEntries = [];
    try { dateEntries = await fs.readdir(path.join(HISTORY_ROOT, source), { withFileTypes: true }); } catch { continue; }
    for (const dateEntry of dateEntries) {
      if (!dateEntry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(dateEntry.name)) continue;
      const directory = path.join(HISTORY_ROOT, source, dateEntry.name);
      let fileEntries = [];
      try { fileEntries = await fs.readdir(directory, { withFileTypes: true }); } catch { continue; }
      const partition = partitions.get(dateEntry.name) || historyPartitionTemplate(dateEntry.name);
      const sourceState = partition.sources[source] || { files: 0, bytes: 0 };
      for (const fileEntry of fileEntries) {
        if (!fileEntry.isFile() || !fileEntry.name.endsWith('.json.gz')) continue;
        try {
          const stat = await fs.stat(path.join(directory, fileEntry.name));
          const observedAt = new Date(stat.mtimeMs).toISOString();
          partition.files++;
          partition.bytes += stat.size;
          sourceState.files++;
          sourceState.bytes += stat.size;
          partition.oldestObservedAt = !partition.oldestObservedAt || observedAt < partition.oldestObservedAt ? observedAt : partition.oldestObservedAt;
          partition.newestObservedAt = !partition.newestObservedAt || observedAt > partition.newestObservedAt ? observedAt : partition.newestObservedAt;
        } catch {}
      }
      if (sourceState.files) partition.sources[source] = sourceState;
      partitions.set(dateEntry.name, partition);
    }
  }
  await fs.rm(HISTORY_PARTITION_INDEX_ROOT, { recursive: true, force: true });
  await fs.mkdir(HISTORY_PARTITION_INDEX_ROOT, { recursive: true });
  for (const partition of partitions.values()) await writeJsonAtomic(historyPartitionIndexPath(partition.date), partition);
  await fs.rm(HISTORY_RECONCILE_MARKER, { force: true }).catch(() => undefined);
  historyWriteFailed = false;
  historyDirtyMarkerPromise = null;
  return { partitions: partitions.size, durationMs: Math.round(performance.now() - started) };
}
async function ensureHistoryMetadata() {
  await fs.mkdir(HISTORY_PARTITION_INDEX_ROOT, { recursive: true });
  let marker = false;
  try { await fs.access(HISTORY_RECONCILE_MARKER); marker = true; } catch {}
  let indexes = [];
  try { indexes = (await fs.readdir(HISTORY_PARTITION_INDEX_ROOT)).filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)); } catch {}
  if (marker) return reconcileHistoryPartitionIndexes();
  if (indexes.length) return { partitions: indexes.length, reconciled: false };
  const sources = await historySourceDirectories();
  for (const source of sources) {
    try {
      const entries = await fs.readdir(path.join(HISTORY_ROOT, source), { withFileTypes: true });
      if (entries.some(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))) return reconcileHistoryPartitionIndexes();
    } catch {}
  }
  return { partitions: 0, reconciled: false };
}
async function listHistoryPartitions() {
  let names = [];
  try { names = (await fs.readdir(HISTORY_PARTITION_INDEX_ROOT)).filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort(); } catch { return []; }
  const partitions = [];
  for (const name of names) {
    const partition = await readJson(path.join(HISTORY_PARTITION_INDEX_ROOT, name), null);
    if (partition?.schemaVersion === 1 && /^\d{4}-\d{2}-\d{2}$/.test(String(partition.date || ''))) partitions.push(partition);
  }
  return partitions;
}
async function pruneHistory() {
  const started = performance.now();
  const cutoffDay = dateKey(new Date(Date.now() - RETENTION_MS));
  const partitions = await listHistoryPartitions();
  let pruned = 0, partitionsPruned = 0, bytesRemoved = 0;
  for (const partition of partitions) {
    if (partition.date >= cutoffDay) continue;
    for (const source of Object.keys(partition.sources || {})) {
      await fs.rm(path.join(HISTORY_ROOT, source, partition.date), { recursive: true, force: true }).catch(() => undefined);
    }
    await fs.rm(historyPartitionIndexPath(partition.date), { force: true }).catch(() => undefined);
    pruned += Number(partition.files || 0);
    bytesRemoved += Number(partition.bytes || 0);
    partitionsPruned++;
  }
  telemetry.historyPruned = pruned;
  telemetry.historyPartitionsPruned = partitionsPruned;
  telemetry.historyBytesRemoved = bytesRemoved;
  return { pruned, partitionsPruned, bytesRemoved, durationMs: Math.round(performance.now() - started) };
}

async function historyStats() {
  const partitions = await listHistoryPartitions();
  let bytes = 0, files = 0, oldest = null, newest = null;
  for (const partition of partitions) {
    files += Number(partition.files || 0);
    bytes += Number(partition.bytes || 0);
    const first = String(partition.oldestObservedAt || '');
    const last = String(partition.newestObservedAt || '');
    if (first && (!oldest || first < oldest)) oldest = first;
    if (last && (!newest || last > newest)) newest = last;
  }
  return { files, bytes, partitions: partitions.length, retentionDays: RETENTION_DAYS, oldestRetainedAt: oldest, newestRetainedAt: newest };
}

async function main() {
  const overallStarted = performance.now();
  await Promise.all([fs.mkdir(CURRENT_ROOT, { recursive: true }), fs.mkdir(STATE_ROOT, { recursive: true }), fs.mkdir(HISTORY_ROOT, { recursive: true }), fs.mkdir(HISTORY_PARTITION_INDEX_ROOT, { recursive: true })]);
  await ensureHistoryMetadata();
  const previousManifest = await readJson(path.join(PUBLISH_ROOT, 'manifest.json'), null);
  const publicResults = await mapLimited(PUBLIC_SOURCES, 4, refreshJsonSource);
  const regions = await discoverRegions();
  const market = await refreshMarketOrders(regions);
  const contracts = await refreshPublicContracts(regions);
  const publicChanged = publicResults.some(item => item.changed);
  const materialChanged = market.changed || contracts.changed || publicChanged || !previousManifest || !previousManifest.files?.['public-contracts'];
  const pruning = await pruneHistory();

  if (!materialChanged) {
    const history = await historyStats();
    const result = { published: false, generation: previousManifest?.generation || null, marketChanged: false, contractsChanged: false, publicChanged: false, marketSourceId: market.snapshot?.id || null, contractSourceId: contracts.snapshot?.snapshotId || null, contractPendingDetailCount: contracts.pendingDetailCount ?? contracts.snapshot?.pendingDetailCount ?? 0, contractComputeMs: contracts.durationMs, scheduler: telemetry, history, pruning, totalMs: Math.round(performance.now() - overallStarted) };
    await writeJsonAtomic(path.join(STATE_ROOT, 'scheduler-status.json'), { ...result, completedAt: new Date().toISOString() });
    console.log(JSON.stringify(result));
    return;
  }

  const generation = `${safeTimestamp(new Date().toISOString())}-public`;
  const generationRoot = path.join(PUBLISH_ROOT, 'generations', generation);
  await fs.mkdir(generationRoot, { recursive: true });
  let marketPrepared;
  if (market.changed || !previousManifest) marketPrepared = await writeMarketArtifacts(generationRoot, market.snapshot);
  else {
    const files = await copyPreviousArtifacts(previousManifest, generationRoot, ['market-global', 'market-regional', 'market-trades', 'market-shortages']);
    marketPrepared = { files, index: null, regional: null, trades: null, shortages: null, computeMs: 0 };
  }
  const shared = await publicBundle(publicResults, previousManifest, generationRoot, !previousManifest);
  const contractPrepared = await contractBundle(contracts, previousManifest, generationRoot);
  const files = { ...marketPrepared.files, ...shared.files, ...contractPrepared.files };
  const base = previousManifest || {};
  const manifest = {
    schemaVersion: 1,
    generation,
    publishedAt: new Date().toISOString(),
    sourceCreatedAt: market.snapshot?.createdAt || base.sourceCreatedAt || null,
    source: 'CCP ESI public data; server prepared',
    orderCount: marketPrepared.index?.orderCount ?? base.orderCount ?? market.snapshot?.orderCount ?? 0,
    regionCount: marketPrepared.index?.regionCount ?? base.regionCount ?? market.snapshot?.regionCount ?? 0,
    itemCount: marketPrepared.index?.items?.size ?? base.itemCount ?? 0,
    regionalRowCount: marketPrepared.regional?.rows?.length ?? base.regionalRowCount ?? 0,
    tradeCandidateCount: marketPrepared.trades?.opportunities?.length ?? base.tradeCandidateCount ?? 0,
    shortageSignalCount: marketPrepared.shortages?.signals?.length ?? base.shortageSignalCount ?? 0,
    contractCount: contracts.snapshot?.contractCount ?? base.contractCount ?? 0,
    contractPendingDetailCount: contracts.snapshot?.pendingDetailCount ?? base.contractPendingDetailCount ?? 0,
    marketChanged: market.changed,
    contractsChanged: contracts.changed,
    publicChanged,
    files,
  };
  await writeJsonAtomic(path.join(generationRoot, 'manifest.json'), manifest);
  const partial = path.join(PUBLISH_ROOT, `manifest.json.${process.pid}.partial`);
  await fs.writeFile(partial, JSON.stringify(manifest, null, 2), 'utf8');
  await fs.rename(partial, path.join(PUBLISH_ROOT, 'manifest.json'));

  const history = await historyStats();
  const result = { published: true, generation, marketChanged: market.changed, contractsChanged: contracts.changed, publicChanged, marketSourceId: market.snapshot?.id || null, contractSourceId: contracts.snapshot?.snapshotId || null, contractPendingDetailCount: contracts.pendingDetailCount ?? contracts.snapshot?.pendingDetailCount ?? 0, computeMs: marketPrepared.computeMs, contractComputeMs: contracts.durationMs, scheduler: telemetry, history, pruning, totalMs: Math.round(performance.now() - overallStarted) };
  await writeJsonAtomic(path.join(STATE_ROOT, 'scheduler-status.json'), { ...result, completedAt: new Date().toISOString() });
  console.log(JSON.stringify(result));
}

await main();
