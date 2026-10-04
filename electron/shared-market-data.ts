import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { createGunzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { MARKET_DATA_ROOT } from "./data-paths";
import { logEvent } from "./logger";
import { loadCurrentRawMarketManifest } from "./raw-market-storage";
import type { FullMarketAnalysisIndex, FullMarketItem } from "./raw-market-analysis";
import type {
  RegionalMarketAggregateIndex,
  RegionalMarketAggregateRow,
  RegionalMarketSecurityBand,
} from "./regional-market-index";

const gunzipAsync = promisify(gunzip);
const SHARED_MANIFEST_SCHEMA = 1;
const REQUIRED_ARTIFACTS = ["market-global", "market-regional"] as const;
const KNOWN_OPTIONAL_ARTIFACTS = ["market-trades", "market-shortages", "market-hub-depth", "public-shared", "public-contracts"] as const;
const DEFAULT_SHARED_MARKET_BASE_URL = "https://new-eden-sage-live-uzohm5sppa-nw.a.run.app";
const MANIFEST_FILE = "manifest.json";

export const SHARED_MARKET_ROOT = path.join(MARKET_DATA_ROOT, "Shared Market");
const SHARED_CONTRACT_ROOT = path.join(MARKET_DATA_ROOT, "Shared Contracts");
const SHARED_CONTRACT_MANIFEST_FILE = "manifest.json";

export type SharedMarketArtifact = {
  version: string;
  path: string;
  bytes: number;
  sha256: string;
  schemaVersion: number;
};

export type SharedMarketManifest = {
  schemaVersion: number;
  generation: string;
  publishedAt: string;
  sourceCreatedAt?: string;
  source: string;
  orderCount: number;
  regionCount: number;
  itemCount: number;
  regionalRowCount: number;
  tradeCandidateCount?: number;
  shortageSignalCount?: number;
  contractCount?: number;
  contractPendingDetailCount?: number;
  marketChanged?: boolean;
  contractsChanged?: boolean;
  publicChanged?: boolean;
  files: Record<string, SharedMarketArtifact>;
};

export type SharedMarketHubDepthDataset = {
  schemaVersion: 1;
  dataset: "market-hub-depth";
  snapshotId: string;
  createdAt: string;
  regionId: number;
  locationId: number;
  locationName: string;
  orderCount: number;
  orders: import("./market").MarketOrder[];
};

export type SharedPreparedTradeDataset = {
  schemaVersion: 1;
  dataset: "market-trades";
  snapshotId: string;
  createdAt: string;
  routeChecks: number;
  viablePairs: number;
  spreadComparisonGeneration?: string | null;
  spreadComparisonSnapshotId?: string | null;
  spreadComparisonGeneratedAt?: string | null;
  spreadComparisonCount?: number;
  opportunities: any[];
};

export type SharedPreparedShortageDataset = {
  schemaVersion: 1;
  dataset: "market-shortages";
  snapshotId: string;
  createdAt: string;
  signals: any[];
};

export type SharedPreparedPublicDataset = {
  schemaVersion: 1;
  dataset: "public-shared";
  snapshotId: string;
  createdAt: string;
  sources: Record<string, { fetchedAt: string; data: unknown }>;
};

export type SharedPublicContractsDataset = {
  schemaVersion: 1;
  dataset: "public-contracts";
  snapshotId: string;
  createdAt: string;
  regionCount: number;
  contractCount: number;
  pendingDetailCount: number;
  regions: Array<{ regionId: number; regionName: string; publicContracts: any[] }>;
};

export type SharedPublicContractsServerManifest = {
  schemaVersion: 1;
  dataset: "public-contracts";
  snapshotId: string;
  createdAt: string;
  bytes: number;
  sha256: string;
  regionCount: number;
  contractCount: number;
  pendingDetailCount: number;
  completedAt?: string;
};

export type SharedPublicContractsSyncResult = {
  changed: boolean;
  snapshotId: string;
  createdAt: string;
  contractCount: number;
  pendingDetailCount: number;
};

export type SharedMarketSyncResult = {
  manifest: SharedMarketManifest;
  changed: string[];
  reused: string[];
  usedLocalFallback: boolean;
  refreshError?: string;
};

export type SharedMarketAvailability = {
  updateAvailable: boolean;
  installedGeneration: string | null;
  availableGeneration: string | null;
  checkedAt: string;
};

type ParsedGeneration = {
  global: FullMarketAnalysisIndex;
  regional: RegionalMarketAggregateIndex;
  trades: SharedPreparedTradeDataset | null;
  shortages: SharedPreparedShortageDataset | null;
  hubDepth: SharedMarketHubDepthDataset | null;
  publicShared: SharedPreparedPublicDataset | null;
  contracts: SharedPublicContractsDataset | null;
};

let manifestMemory: SharedMarketManifest | null | undefined;
const globalGenerationCache = new Map<string, Promise<FullMarketAnalysisIndex | null>>();
const regionalGenerationCache = new Map<string, Promise<RegionalMarketAggregateIndex | null>>();
const tradeGenerationCache = new Map<string, Promise<SharedPreparedTradeDataset | null>>();
const shortageGenerationCache = new Map<string, Promise<SharedPreparedShortageDataset | null>>();
const hubDepthGenerationCache = new Map<string, Promise<SharedMarketHubDepthDataset | null>>();
const publicSharedGenerationCache = new Map<string, Promise<SharedPreparedPublicDataset | null>>();
const contractGenerationCache = new Map<string, Promise<SharedPublicContractsDataset | null>>();
const dedicatedContractCache = new Map<string, Promise<SharedPublicContractsDataset | null>>();

export function invalidateSharedMarketMemoryCache() {
  manifestMemory = undefined;
  globalGenerationCache.clear();
  regionalGenerationCache.clear();
  tradeGenerationCache.clear();
  shortageGenerationCache.clear();
  hubDepthGenerationCache.clear();
  publicSharedGenerationCache.clear();
  contractGenerationCache.clear();
  dedicatedContractCache.clear();
}

export function sharedMarketServerBaseUrl() {
  return String(process.env.NEW_EDEN_SAGE_SHARED_MARKET_URL || DEFAULT_SHARED_MARKET_BASE_URL).trim().replace(/\/$/, "");
}

function contractManifestPath() {
  return path.join(SHARED_CONTRACT_ROOT, SHARED_CONTRACT_MANIFEST_FILE);
}

function contractSnapshotPath(snapshotId: string) {
  return path.join(SHARED_CONTRACT_ROOT, "snapshots", `${snapshotId}.json.gz`);
}

function validateContractServerManifest(value: unknown): SharedPublicContractsServerManifest {
  const manifest = (value as any)?.contract ?? value;
  if (!manifest || typeof manifest !== "object") throw new Error("Sage contract server response is invalid.");
  const row = manifest as SharedPublicContractsServerManifest;
  if (row.schemaVersion !== 1 || row.dataset !== "public-contracts") throw new Error("Sage contract server schema is unsupported.");
  if (!row.snapshotId || !/^[A-Za-z0-9._-]+$/.test(row.snapshotId)) throw new Error("Sage contract snapshot id is invalid.");
  if (!row.createdAt || !Number.isFinite(Date.parse(row.createdAt))) throw new Error("Sage contract snapshot time is invalid.");
  if (!Number.isFinite(row.bytes) || row.bytes <= 0) throw new Error("Sage contract snapshot byte size is invalid.");
  if (!/^[a-f0-9]{64}$/i.test(String(row.sha256))) throw new Error("Sage contract snapshot SHA-256 is invalid.");
  if (!Number.isFinite(row.contractCount) || row.contractCount < 0 || !Number.isFinite(row.pendingDetailCount) || row.pendingDetailCount < 0) {
    throw new Error("Sage contract snapshot counts are invalid.");
  }
  return row;
}

async function loadInstalledContractManifest(): Promise<SharedPublicContractsServerManifest | null> {
  try {
    return validateContractServerManifest(JSON.parse(await fs.readFile(contractManifestPath(), "utf8")));
  } catch {
    return null;
  }
}

async function replaceContractManifestAtomically(manifest: SharedPublicContractsServerManifest) {
  await fs.mkdir(SHARED_CONTRACT_ROOT, { recursive: true });
  const target = contractManifestPath();
  const partial = `${target}.${process.pid}.${randomUUID()}.partial`;
  const backup = `${target}.${process.pid}.${randomUUID()}.backup`;
  await fs.writeFile(partial, JSON.stringify(manifest, null, 2), "utf8");
  let hadPrevious = false;
  try {
    await fs.rename(target, backup);
    hadPrevious = true;
  } catch {}
  try {
    await fs.rename(partial, target);
    if (hadPrevious) await fs.rm(backup, { force: true });
  } catch (error) {
    await fs.rm(partial, { force: true }).catch(() => undefined);
    if (hadPrevious) await fs.rename(backup, target).catch(() => undefined);
    throw error;
  }
}

async function parseDedicatedContractSnapshot(manifest: SharedPublicContractsServerManifest): Promise<SharedPublicContractsDataset | null> {
  const payload = JSON.parse((await gunzipAsync(await fs.readFile(contractSnapshotPath(manifest.snapshotId)))).toString("utf8")) as SharedPublicContractsDataset;
  if (payload.schemaVersion !== 1 || payload.dataset !== "public-contracts" || payload.snapshotId !== manifest.snapshotId) throw new Error("Dedicated Sage contract snapshot identity is invalid.");
  if (!Array.isArray(payload.regions) || payload.contractCount !== manifest.contractCount || payload.pendingDetailCount !== manifest.pendingDetailCount) {
    throw new Error("Dedicated Sage contract snapshot counts do not match its server manifest.");
  }
  return payload;
}

async function loadDedicatedContractSnapshot(): Promise<SharedPublicContractsDataset | null> {
  const manifest = await loadInstalledContractManifest();
  if (!manifest) return null;
  let value = dedicatedContractCache.get(manifest.snapshotId);
  if (!value) {
    value = parseDedicatedContractSnapshot(manifest).catch(async (error) => {
      dedicatedContractCache.delete(manifest.snapshotId);
      await logEvent("warn", "shared_contract.load_failed", { snapshotId: manifest.snapshotId, error: error instanceof Error ? error.message : String(error) });
      return null;
    });
    dedicatedContractCache.set(manifest.snapshotId, value);
  }
  return value;
}

export async function ensureCurrentSharedPublicContractsData(): Promise<SharedPublicContractsSyncResult> {
  const root = sharedMarketServerBaseUrl();
  if (!root) throw new Error("Sage public data server URL is not configured.");
  const metadataResponse = await request(`${root}/v1/contracts/latest`, 10_000, 2);
  const available = validateContractServerManifest(await metadataResponse.json());
  const installed = await loadInstalledContractManifest();
  if (installed?.snapshotId === available.snapshotId && installed.sha256.toLowerCase() === available.sha256.toLowerCase()) {
    return { changed: false, snapshotId: available.snapshotId, createdAt: available.createdAt, contractCount: available.contractCount, pendingDetailCount: available.pendingDetailCount };
  }

  const response = await request(`${root}/v1/contracts/latest.gz`, 90_000, 2);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength !== available.bytes) throw new Error("Sage contract snapshot byte count did not match the server manifest.");
  const digest = createHash("sha256").update(buffer).digest("hex");
  if (digest.toLowerCase() !== available.sha256.toLowerCase()) throw new Error("Sage contract snapshot failed SHA-256 validation.");
  const payload = JSON.parse((await gunzipAsync(buffer)).toString("utf8")) as SharedPublicContractsDataset;
  if (payload.schemaVersion !== 1 || payload.dataset !== "public-contracts" || payload.snapshotId !== available.snapshotId || !Array.isArray(payload.regions)) {
    throw new Error("Sage contract snapshot payload is invalid.");
  }
  if (payload.contractCount !== available.contractCount || payload.pendingDetailCount !== available.pendingDetailCount) {
    throw new Error("Sage contract snapshot counts do not match the server manifest.");
  }

  const snapshotsRoot = path.join(SHARED_CONTRACT_ROOT, "snapshots");
  await fs.mkdir(snapshotsRoot, { recursive: true });
  const target = contractSnapshotPath(available.snapshotId);
  const partial = `${target}.${process.pid}.${randomUUID()}.partial`;
  await fs.writeFile(partial, buffer, { flag: "wx" });
  try {
    await fs.rename(partial, target);
  } catch {
    await fs.rm(target, { force: true });
    await fs.rename(partial, target);
  }
  await replaceContractManifestAtomically(available);
  dedicatedContractCache.clear();
  dedicatedContractCache.set(available.snapshotId, Promise.resolve(payload));
  let files: string[] = [];
  try { files = await fs.readdir(snapshotsRoot); } catch {}
  await Promise.all(files.filter((name) => name.endsWith(".json.gz") && name !== `${available.snapshotId}.json.gz`).map((name) => fs.rm(path.join(snapshotsRoot, name), { force: true }).catch(() => undefined)));
  void logEvent("info", "shared_contract.promoted", { snapshotId: available.snapshotId, bytes: available.bytes, contractCount: available.contractCount, pendingDetailCount: available.pendingDetailCount });
  return { changed: true, snapshotId: available.snapshotId, createdAt: available.createdAt, contractCount: available.contractCount, pendingDetailCount: available.pendingDetailCount };
}

function manifestPath() {
  return path.join(SHARED_MARKET_ROOT, MANIFEST_FILE);
}

function generationRoot(generation: string) {
  return path.join(SHARED_MARKET_ROOT, "generations", generation);
}

function safeArtifactName(key: string, artifact: SharedMarketArtifact) {
  const normalized = artifact.path.replace(/\\/g, "/");
  if (!normalized.startsWith("generations/") || normalized.includes("../")) throw new Error(`Shared market artifact path is unsafe (${key}).`);
  const name = path.posix.basename(normalized);
  if (!name || name === "." || name === "..") throw new Error(`Shared market artifact name is invalid (${key}).`);
  return name;
}

function validateArtifact(key: string, value: unknown): SharedMarketArtifact {
  if (!value || typeof value !== "object") throw new Error(`Shared market manifest is missing artifact ${key}.`);
  const artifact = value as SharedMarketArtifact;
  if (!artifact.version || typeof artifact.version !== "string") throw new Error(`Shared market artifact ${key} has no version.`);
  if (!artifact.path || typeof artifact.path !== "string") throw new Error(`Shared market artifact ${key} has no path.`);
  if (!Number.isFinite(artifact.bytes) || artifact.bytes <= 0) throw new Error(`Shared market artifact ${key} has invalid byte size.`);
  if (!/^[a-f0-9]{64}$/i.test(String(artifact.sha256))) throw new Error(`Shared market artifact ${key} has invalid SHA-256.`);
  const supportedSchemas = key === "market-global" ? new Set([1, 2]) : new Set([1]);
  if (!supportedSchemas.has(artifact.schemaVersion)) throw new Error(`Shared market artifact ${key} schema ${artifact.schemaVersion} is unsupported.`);
  safeArtifactName(key, artifact);
  return artifact;
}

export function validateSharedMarketManifest(value: unknown): SharedMarketManifest {
  if (!value || typeof value !== "object") throw new Error("Shared market manifest response is invalid.");
  const manifest = value as SharedMarketManifest;
  if (manifest.schemaVersion !== SHARED_MANIFEST_SCHEMA) throw new Error(`Shared market manifest schema ${manifest.schemaVersion} is unsupported.`);
  if (!manifest.generation || typeof manifest.generation !== "string" || !/^[A-Za-z0-9._-]+$/.test(manifest.generation)) throw new Error("Shared market manifest generation is invalid.");
  if (!manifest.publishedAt || !Number.isFinite(Date.parse(manifest.publishedAt))) throw new Error("Shared market manifest publish time is invalid.");
  if (manifest.sourceCreatedAt && !Number.isFinite(Date.parse(manifest.sourceCreatedAt))) throw new Error("Shared market source time is invalid.");
  if (!manifest.files || typeof manifest.files !== "object") throw new Error("Shared market manifest has no file map.");
  for (const key of REQUIRED_ARTIFACTS) validateArtifact(key, manifest.files[key]);
  for (const [key, artifact] of Object.entries(manifest.files)) validateArtifact(key, artifact);
  return manifest;
}

export async function loadInstalledSharedMarketManifestFresh(): Promise<SharedMarketManifest | null> {
  try {
    return validateSharedMarketManifest(JSON.parse(await fs.readFile(manifestPath(), "utf8")));
  } catch {
    return null;
  }
}

export async function loadCurrentSharedMarketManifest(): Promise<SharedMarketManifest | null> {
  if (manifestMemory !== undefined) return manifestMemory;
  try {
    manifestMemory = validateSharedMarketManifest(JSON.parse(await fs.readFile(manifestPath(), "utf8")));
  } catch {
    manifestMemory = null;
  }
  return manifestMemory;
}

export function adoptInstalledSharedMarketManifest(value: SharedMarketManifest) {
  manifestMemory = validateSharedMarketManifest(value);
  return manifestMemory;
}

async function request(url: string, timeoutMs: number, attempts = 2) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "X-New-Eden-Sage-Client": "dev" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return response;
      const body = await response.text().catch(() => "");
      throw new Error(`Shared market service returned HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchLatestCompleteManifestFromServer() {
  const root = sharedMarketServerBaseUrl();
  if (!root) throw new Error("Shared market service URL is not configured.");
  const startedAt = Date.now();
  let payload: any;
  try {
    const response = await request(`${root}/latest-complete`, 7_000, 1);
    payload = await response.json();
  } catch (latestError) {
    // Compatibility with an older read-only service while /latest-complete is being rolled out.
    // /status never produces or waits for a generation.
    const response = await request(`${root}/status`, 7_000, 1);
    payload = await response.json();
    if (!payload?.manifest) throw latestError;
  }
  const manifest = validateSharedMarketManifest(payload?.manifest ?? payload);
  void logEvent("info", "shared_market.latest_manifest_ms", { durationMs: Date.now() - startedAt, generation: manifest.generation });
  return manifest;
}

async function downloadArtifact(root: string, key: string, artifact: SharedMarketArtifact, target: string) {
  const downloadStartedAt = Date.now();
  const response = await request(`${root}/${artifact.path.replace(/^\/+/, "")}`, 90_000, 2);
  const buffer = Buffer.from(await response.arrayBuffer());
  const downloadMs = Date.now() - downloadStartedAt;
  if (buffer.byteLength !== artifact.bytes) throw new Error(`Shared market artifact ${artifact.path} byte count did not match its manifest.`);
  const hashStartedAt = Date.now();
  const digest = createHash("sha256").update(buffer).digest("hex");
  const hashMs = Date.now() - hashStartedAt;
  if (digest.toLowerCase() !== artifact.sha256.toLowerCase()) throw new Error(`Shared market artifact ${artifact.path} failed SHA-256 validation.`);
  await fs.writeFile(target, buffer, { flag: "wx" });
  void logEvent("info", `shared_market.download.${key}_ms`, { durationMs: downloadMs, generation: artifact.version });
  void logEvent("info", `shared_market.download.${key}_bytes`, { bytes: buffer.byteLength, generation: artifact.version });
  void logEvent("info", `shared_market.hash.${key}_ms`, { durationMs: hashMs, generation: artifact.version });
}

async function replaceManifestAtomically(manifest: SharedMarketManifest) {
  await fs.mkdir(SHARED_MARKET_ROOT, { recursive: true });
  const target = manifestPath();
  const partial = `${target}.${process.pid}.${randomUUID()}.partial`;
  const backup = `${target}.${process.pid}.${randomUUID()}.backup`;
  await fs.writeFile(partial, JSON.stringify(manifest, null, 2), "utf8");
  let hadPrevious = false;
  try {
    await fs.rename(target, backup);
    hadPrevious = true;
  } catch {
    // First shared generation has no pointer to move aside.
  }
  try {
    await fs.rename(partial, target);
    if (hadPrevious) await fs.rm(backup, { force: true });
    manifestMemory = manifest;
  } catch (error) {
    await fs.rm(partial, { force: true }).catch(() => undefined);
    if (hadPrevious) await fs.rename(backup, target).catch(() => undefined);
    throw error;
  }
}

async function cleanupOldGenerations(current: string, previous?: string) {
  const root = path.join(SHARED_MARKET_ROOT, "generations");
  const keep = new Set([current, previous].filter(Boolean) as string[]);
  let entries: Array<{ name: string; isDirectory(): boolean }> = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true }) as Array<{ name: string; isDirectory(): boolean }>;
  } catch {
    return;
  }
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && !keep.has(entry.name) && !entry.name.includes(".partial-"))
    .map((entry) => fs.rm(path.join(root, entry.name), { recursive: true, force: true }).catch(() => undefined)));
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.includes(".partial-"))
    .map((entry) => fs.rm(path.join(root, entry.name), { recursive: true, force: true }).catch(() => undefined)));
}

function localArtifactPath(manifest: SharedMarketManifest, key: string, root = generationRoot(manifest.generation)) {
  const artifact = validateArtifact(key, manifest.files[key]);
  return path.join(root, safeArtifactName(key, artifact));
}

async function parseGlobalArtifact(manifest: SharedMarketManifest, root: string): Promise<FullMarketAnalysisIndex> {
  const file = localArtifactPath(manifest, "market-global", root);
  type GlobalHeader = {
    schemaVersion: number; dataset: string; snapshotId: string; createdAt: string; orderCount: number; regionCount: number;
    sourceOrdersInspected: number; candidateDepthPerSide: number; itemCount: number;
  };
  const marker = '"items":[';
  let header: GlobalHeader | null = null;
  let headerBuffer = "";
  const items = new Map<number, FullMarketItem>();
  let inItem = false;
  let inString = false;
  let escaped = false;
  let depth = 0;
  let itemParts: string[] = [];
  let sawItemsEnd = false;

  const consumeItems = (text: string) => {
    let segmentStart = inItem ? 0 : -1;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (!inItem) {
        if (character === "]") {
          sawItemsEnd = true;
          continue;
        }
        if (character === "{") {
          inItem = true;
          inString = false;
          escaped = false;
          depth = 1;
          segmentStart = index;
          continue;
        }
        if (character === "," || character === "}" || /\s/.test(character)) continue;
        throw new Error("Shared market-global item stream is malformed.");
      }

      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
      } else if (character === '"') inString = true;
      else if (character === "{" || character === "[") depth += 1;
      else if (character === "}" || character === "]") {
        depth -= 1;
        if (depth === 0) {
          itemParts.push(text.slice(segmentStart, index + 1));
          const item = JSON.parse(itemParts.join("")) as FullMarketItem;
          items.set(item.typeId, item);
          itemParts = [];
          inItem = false;
          inString = false;
          escaped = false;
          segmentStart = -1;
        }
      }
    }
    if (inItem && segmentStart >= 0) itemParts.push(text.slice(segmentStart));
  };

  const input = createReadStream(file).pipe(createGunzip());
  input.setEncoding("utf8");
  for await (const chunk of input) {
    let text = String(chunk);
    if (!header) {
      headerBuffer += text;
      const markerIndex = headerBuffer.indexOf(marker);
      if (markerIndex < 0) {
        if (headerBuffer.length > 1_000_000) throw new Error("Shared market-global header is malformed.");
        continue;
      }
      const headerJson = headerBuffer.slice(0, markerIndex).replace(/,\s*$/, "") + "}";
      header = JSON.parse(headerJson) as GlobalHeader;
      text = headerBuffer.slice(markerIndex + marker.length);
      headerBuffer = "";
    }
    consumeItems(text);
  }

  if (!header || !sawItemsEnd || inItem) throw new Error("Shared market-global payload ended before its item stream completed.");
  const globalArtifact = validateArtifact("market-global", manifest.files["market-global"]);
  if (header.schemaVersion !== globalArtifact.schemaVersion || header.dataset !== "market-global" || header.snapshotId !== globalArtifact.version) throw new Error("Shared market-global payload identity is invalid.");
  if (header.orderCount !== manifest.orderCount || header.regionCount !== manifest.regionCount || header.itemCount !== manifest.itemCount || items.size !== manifest.itemCount) throw new Error("Shared market-global payload counts do not match its manifest.");
  return {
    snapshotId: header.snapshotId,
    createdAt: header.createdAt,
    orderCount: header.orderCount,
    regionCount: header.regionCount,
    sourceOrdersInspected: header.sourceOrdersInspected,
    candidateDepthPerSide: header.candidateDepthPerSide,
    items,
  };
}

function buildRowsByType(rows: RegionalMarketAggregateRow[]) {
  const result = new Map<number, RegionalMarketAggregateRow[]>();
  for (const row of rows) {
    const list = result.get(row.typeId);
    if (list) list.push(row);
    else result.set(row.typeId, [row]);
  }
  return result;
}

function buildCheapestSellMap(rows: RegionalMarketAggregateRow[]) {
  type CheapestSell = { price: number; regionId: number; regionName: string } | null;
  const result = new Map<number, Record<RegionalMarketSecurityBand, CheapestSell>>();
  for (const row of rows) {
    const current = result.get(row.typeId) ?? { all: null, high: null, low: null, null: null };
    for (const band of ["all", "high", "low", "null"] as RegionalMarketSecurityBand[]) {
      const price = row[band].bestSell;
      if (price == null || price <= 0) continue;
      if (!current[band] || price < current[band]!.price) current[band] = { price, regionId: row.regionId, regionName: row.regionName };
    }
    result.set(row.typeId, current);
  }
  return result;
}

async function parseRegionalArtifact(manifest: SharedMarketManifest, root: string): Promise<RegionalMarketAggregateIndex> {
  const rows: RegionalMarketAggregateRow[] = [];
  const input = createReadStream(localArtifactPath(manifest, "market-regional", root));
  const rl = createInterface({ input: input.pipe(createGunzip()), crlfDelay: Infinity });
  let header: { schemaVersion: number; dataset: string; snapshotId: string; createdAt: string; orderCount: number; regionCount: number; rowCount: number } | null = null;
  for await (const line of rl) {
    if (!line) continue;
    if (!header) {
      header = JSON.parse(line);
      continue;
    }
    rows.push(JSON.parse(line) as RegionalMarketAggregateRow);
  }
  if (!header || header.schemaVersion !== 1 || header.dataset !== "market-regional" || header.snapshotId !== validateArtifact("market-regional", manifest.files["market-regional"]).version) throw new Error("Shared market-regional payload identity is invalid.");
  if (header.orderCount !== manifest.orderCount || header.regionCount !== manifest.regionCount || rows.length !== manifest.regionalRowCount || rows.length !== header.rowCount) throw new Error("Shared market-regional payload counts do not match its manifest.");
  return {
    snapshotId: header.snapshotId,
    createdAt: header.createdAt,
    orderCount: header.orderCount,
    regionCount: header.regionCount,
    rows,
    rowsByType: buildRowsByType(rows),
    cheapestSellByType: buildCheapestSellMap(rows),
  };
}

async function parseJsonDataset<T extends { schemaVersion: number; dataset: string; snapshotId: string }>(manifest: SharedMarketManifest, root: string, key: string, dataset: string): Promise<T | null> {
  if (!manifest.files[key]) return null;
  const payload = JSON.parse((await gunzipAsync(await fs.readFile(localArtifactPath(manifest, key, root)))).toString("utf8")) as T;
  if (payload.schemaVersion !== 1 || payload.dataset !== dataset || payload.snapshotId !== validateArtifact(key, manifest.files[key]).version) throw new Error(`Shared ${key} payload identity is invalid.`);
  return payload;
}

async function validateStagedGeneration(manifest: SharedMarketManifest, root: string): Promise<ParsedGeneration> {
  const startedAt = Date.now();
  const [global, regional, trades, shortages, hubDepth, publicShared, contracts] = await Promise.all([
    parseGlobalArtifact(manifest, root),
    parseRegionalArtifact(manifest, root),
    parseJsonDataset<SharedPreparedTradeDataset>(manifest, root, "market-trades", "market-trades"),
    parseJsonDataset<SharedPreparedShortageDataset>(manifest, root, "market-shortages", "market-shortages"),
    parseJsonDataset<SharedMarketHubDepthDataset>(manifest, root, "market-hub-depth", "market-hub-depth"),
    parseJsonDataset<SharedPreparedPublicDataset>(manifest, root, "public-shared", "public-shared"),
    parseJsonDataset<SharedPublicContractsDataset>(manifest, root, "public-contracts", "public-contracts"),
  ]);
  if (trades && !Array.isArray(trades.opportunities)) throw new Error("Shared market-trades payload has no opportunity list.");
  if (shortages && !Array.isArray(shortages.signals)) throw new Error("Shared market-shortages payload has no signal list.");
  if (contracts && !Array.isArray(contracts.regions)) throw new Error("Shared public-contracts payload has no region list.");
  if (hubDepth && !Array.isArray(hubDepth.orders)) throw new Error("Shared market-hub-depth payload has no order list.");
  void logEvent("info", "shared_market.validation_ms", { durationMs: Date.now() - startedAt, generation: manifest.generation });
  return { global, regional, trades, shortages, hubDepth, publicShared, contracts };
}

function installWarmGeneration(manifest: SharedMarketManifest, parsed: ParsedGeneration) {
  globalGenerationCache.set(manifest.generation, Promise.resolve(parsed.global));
  regionalGenerationCache.set(manifest.generation, Promise.resolve(parsed.regional));
  tradeGenerationCache.set(manifest.generation, Promise.resolve(parsed.trades));
  shortageGenerationCache.set(manifest.generation, Promise.resolve(parsed.shortages));
  hubDepthGenerationCache.set(manifest.generation, Promise.resolve(parsed.hubDepth));
  publicSharedGenerationCache.set(manifest.generation, Promise.resolve(parsed.publicShared));
  contractGenerationCache.set(manifest.generation, Promise.resolve(parsed.contracts));
}

function manifestsIdentical(a: SharedMarketManifest | null, b: SharedMarketManifest) {
  if (!a || a.generation !== b.generation) return false;
  const aKeys = Object.keys(a.files).sort();
  const bKeys = Object.keys(b.files).sort();
  if (aKeys.length !== bKeys.length || aKeys.some((key, index) => key !== bKeys[index])) return false;
  return bKeys.every((key) => {
    const left = a.files[key];
    const right = b.files[key];
    return Boolean(left && right && left.sha256 === right.sha256 && left.bytes === right.bytes && left.schemaVersion === right.schemaVersion && left.path === right.path);
  });
}

export async function checkSharedMarketDataAvailability(): Promise<SharedMarketAvailability> {
  const installed = await loadCurrentSharedMarketManifest();
  const available = await fetchLatestCompleteManifestFromServer();
  return {
    updateAvailable: !manifestsIdentical(installed, available),
    installedGeneration: installed?.generation ?? null,
    availableGeneration: available.generation,
    checkedAt: new Date().toISOString(),
  };
}

export async function ensureCurrentSharedMarketData(
  progress?: (message: string, completed?: number, total?: number) => void,
): Promise<SharedMarketSyncResult> {
  const totalStartedAt = Date.now();
  const previous = await loadCurrentSharedMarketManifest();
  let manifest: SharedMarketManifest;
  try {
    progress?.("Checking shared market");
    manifest = await fetchLatestCompleteManifestFromServer();
  } catch (error) {
    if (!previous) throw error;
    const message = error instanceof Error ? error.message : String(error);
    await logEvent("warn", "shared_market.server_unavailable_using_local", { generation: previous.generation, error: message });
    progress?.(`Shared server unavailable; keeping local generation ${previous.generation}.`);
    void logEvent("info", "shared_market.total_ms", { durationMs: Date.now() - totalStartedAt, generation: previous.generation, usedLocalFallback: true });
    return { manifest: previous, changed: [], reused: Object.keys(previous.files), usedLocalFallback: true, refreshError: message };
  }

  const compareStartedAt = Date.now();
  const identical = manifestsIdentical(previous, manifest);
  void logEvent("info", "shared_market.generation_compare_ms", { durationMs: Date.now() - compareStartedAt, generation: manifest.generation, identical });
  if (identical) {
    progress?.("Shared market ready");
    void logEvent("info", "shared_market.total_ms", { durationMs: Date.now() - totalStartedAt, generation: manifest.generation, changed: [], reused: Object.keys(manifest.files) });
    return { manifest, changed: [], reused: Object.keys(manifest.files), usedLocalFallback: false };
  }

  const root = sharedMarketServerBaseUrl();
  const finalRoot = generationRoot(manifest.generation);
  const stageRoot = `${finalRoot}.partial-${process.pid}-${randomUUID()}`;
  const changed: string[] = [];
  const reused: string[] = [];
  const artifactKeys = Object.keys(manifest.files).sort();

  await fs.rm(stageRoot, { recursive: true, force: true }).catch(() => undefined);
  await fs.mkdir(stageRoot, { recursive: true });
  try {
    let completed = 0;
    for (const key of artifactKeys) {
      const artifact = manifest.files[key];
      const staged = path.join(stageRoot, safeArtifactName(key, artifact));
      const oldArtifact = previous?.files[key];
      const oldFile = previous && oldArtifact ? path.join(generationRoot(previous.generation), safeArtifactName(key, oldArtifact)) : "";
      if (oldArtifact?.sha256 === artifact.sha256 && oldArtifact.bytes === artifact.bytes && oldArtifact.schemaVersion === artifact.schemaVersion && oldFile) {
        try {
          await fs.copyFile(oldFile, staged);
          reused.push(key);
        } catch {
          progress?.("Downloading market update", completed, artifactKeys.length);
          await downloadArtifact(root, key, artifact, staged);
          changed.push(key);
        }
      } else {
        progress?.("Downloading market update", completed, artifactKeys.length);
        await downloadArtifact(root, key, artifact, staged);
        changed.push(key);
      }
      completed += 1;
    }

    progress?.("Validating market update", artifactKeys.length, artifactKeys.length);
    const parsed = await validateStagedGeneration(manifest, stageRoot);
    progress?.("Installing market update", artifactKeys.length, artifactKeys.length);
    const promotionStartedAt = Date.now();
    await fs.mkdir(path.dirname(finalRoot), { recursive: true });
    await fs.rm(finalRoot, { recursive: true, force: true });
    await fs.rename(stageRoot, finalRoot);
    await replaceManifestAtomically(manifest);
    installWarmGeneration(manifest, parsed);
    void logEvent("info", "shared_market.promotion_ms", { durationMs: Date.now() - promotionStartedAt, generation: manifest.generation });
    await cleanupOldGenerations(manifest.generation, previous?.generation);
  } catch (error) {
    await fs.rm(stageRoot, { recursive: true, force: true }).catch(() => undefined);
    if (previous) {
      const message = error instanceof Error ? error.message : String(error);
      await logEvent("warn", "shared_market.download_failed_using_local", { generation: previous.generation, serverGeneration: manifest.generation, error: message });
      return { manifest: previous, changed: [], reused: Object.keys(previous.files), usedLocalFallback: true, refreshError: message };
    }
    throw error;
  }

  await logEvent("info", "shared_market.promoted", {
    generation: manifest.generation,
    previousGeneration: previous?.generation ?? null,
    changed,
    reused,
  });
  progress?.("Shared market ready", artifactKeys.length, artifactKeys.length);
  void logEvent("info", "shared_market.total_ms", { durationMs: Date.now() - totalStartedAt, generation: manifest.generation, changed, reused });
  return { manifest, changed, reused, usedLocalFallback: false };
}

function cachedLoad<T>(cache: Map<string, Promise<T | null>>, manifest: SharedMarketManifest, name: string, loader: () => Promise<T | null>) {
  let value = cache.get(manifest.generation);
  if (!value) {
    const startedAt = Date.now();
    value = loader()
      .then((result) => {
        void logEvent("info", `shared_market.load.${name}_ms`, { durationMs: Date.now() - startedAt, generation: manifest.generation, cached: false });
        return result;
      })
      .catch((error) => {
        cache.delete(manifest.generation);
        void logEvent("warn", "shared_market.prepared_load_failed", { dataset: name, generation: manifest.generation, error: error instanceof Error ? error.message : String(error) });
        return null;
      });
    cache.set(manifest.generation, value);
  }
  return value;
}

export async function loadSharedFullMarketAnalysisIndex(): Promise<FullMarketAnalysisIndex | null> {
  const manifest = await loadCurrentSharedMarketManifest();
  if (!manifest) return null;
  return cachedLoad(globalGenerationCache, manifest, "market-global", () => parseGlobalArtifact(manifest, generationRoot(manifest.generation)));
}

export async function loadSharedRegionalMarketAggregateIndex(): Promise<RegionalMarketAggregateIndex | null> {
  const manifest = await loadCurrentSharedMarketManifest();
  if (!manifest) return null;
  return cachedLoad(regionalGenerationCache, manifest, "market-regional", () => parseRegionalArtifact(manifest, generationRoot(manifest.generation)));
}

export async function loadSharedPreparedTradeDataset(): Promise<SharedPreparedTradeDataset | null> {
  const manifest = await loadCurrentSharedMarketManifest();
  if (!manifest?.files["market-trades"]) return null;
  return cachedLoad(tradeGenerationCache, manifest, "market-trades", () => parseJsonDataset<SharedPreparedTradeDataset>(manifest, generationRoot(manifest.generation), "market-trades", "market-trades"));
}

export async function loadSharedPreparedShortageDataset(): Promise<SharedPreparedShortageDataset | null> {
  const manifest = await loadCurrentSharedMarketManifest();
  if (!manifest?.files["market-shortages"]) return null;
  return cachedLoad(shortageGenerationCache, manifest, "market-shortages", () => parseJsonDataset<SharedPreparedShortageDataset>(manifest, generationRoot(manifest.generation), "market-shortages", "market-shortages"));
}

export async function loadSharedMarketHubDepthDataset(): Promise<SharedMarketHubDepthDataset | null> {
  const manifest = await loadCurrentSharedMarketManifest();
  if (!manifest?.files["market-hub-depth"]) return null;
  return cachedLoad(hubDepthGenerationCache, manifest, "market-hub-depth", () => parseJsonDataset<SharedMarketHubDepthDataset>(manifest, generationRoot(manifest.generation), "market-hub-depth", "market-hub-depth"));
}

export async function loadCurrentSharedPublicContractsRevision(): Promise<{ snapshotId: string; createdAt: string; source: "dedicated" | "shared" } | null> {
  const dedicated = await loadInstalledContractManifest();
  if (dedicated) return { snapshotId: dedicated.snapshotId, createdAt: dedicated.createdAt, source: "dedicated" };
  const manifest = await loadCurrentSharedMarketManifest();
  const artifact = manifest?.files["public-contracts"];
  if (!manifest || !artifact) return null;
  return { snapshotId: artifact.version, createdAt: manifest.publishedAt, source: "shared" };
}

export async function loadSharedPublicContractsDataset(): Promise<SharedPublicContractsDataset | null> {
  const dedicated = await loadDedicatedContractSnapshot();
  if (dedicated) return dedicated;
  const manifest = await loadCurrentSharedMarketManifest();
  if (!manifest?.files["public-contracts"]) return null;
  return cachedLoad(contractGenerationCache, manifest, "public-contracts", () => parseJsonDataset<SharedPublicContractsDataset>(manifest, generationRoot(manifest.generation), "public-contracts", "public-contracts"));
}

export async function loadSharedPublicDataset(): Promise<SharedPreparedPublicDataset | null> {
  const manifest = await loadCurrentSharedMarketManifest();
  if (!manifest?.files["public-shared"]) return null;
  return cachedLoad(publicSharedGenerationCache, manifest, "public-shared", () => parseJsonDataset<SharedPreparedPublicDataset>(manifest, generationRoot(manifest.generation), "public-shared", "public-shared"));
}

export async function loadSharedPublicSource<T>(source: string): Promise<{ fetchedAt: string; data: T } | null> {
  const dataset = await loadSharedPublicDataset();
  const value = dataset?.sources?.[source];
  return value ? { fetchedAt: value.fetchedAt, data: value.data as T } : null;
}

export function startSharedPublicDataListener(
  onAvailable?: (notice: { generation: string }) => void,
  onNotificationCheck?: (notice: { evaluatedAt?: string; notifications?: Record<string, unknown> }) => void,
) {
  let stopped = false;
  let controller: AbortController | null = null;
  let lastNotifiedGeneration = "";
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const run = async () => {
    while (!stopped) {
      try {
        const current = await loadCurrentSharedMarketManifest();
        controller = new AbortController();
        const url = new URL(sharedMarketServerBaseUrl() + "/events");
        if (current?.generation) url.searchParams.set("generation", current.generation);
        const response = await fetch(url, { headers: { Accept: "text/event-stream", "X-New-Eden-Sage-Client": "desktop" }, signal: controller.signal });
        if (!response.ok || !response.body) throw new Error("Shared public event stream returned HTTP " + response.status + ".");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const event = frame.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
            const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
            if (!data) continue;
            if (event === "notification-check") {
              const notice = JSON.parse(data) as { evaluatedAt?: string; notifications?: Record<string, unknown> };
              onNotificationCheck?.(notice);
              continue;
            }
            if (event !== "public-data-ready") continue;
            const notice = JSON.parse(data) as { generation?: string };
            const installed = await loadCurrentSharedMarketManifest();
            if (!notice.generation || notice.generation === installed?.generation || notice.generation === lastNotifiedGeneration) continue;
            lastNotifiedGeneration = notice.generation;
            onAvailable?.({ generation: notice.generation });
          }
        }
      } catch (error) {
        if (!stopped) void logEvent("warn", "shared_public.event_stream_disconnected", { error: error instanceof Error ? error.message : String(error) });
      } finally {
        controller = null;
      }
      if (!stopped) await sleep(5_000);
    }
  };
  void run();
  return () => { stopped = true; controller?.abort(); };
}

export async function loadCurrentMarketRevision() {
  const shared = await loadCurrentSharedMarketManifest();
  if (shared) return { id: shared.files["market-global"]?.version ?? shared.generation, createdAt: shared.sourceCreatedAt ?? shared.publishedAt, source: "shared" as const, orderCount: shared.orderCount, regionCount: shared.regionCount };
  const raw = await loadCurrentRawMarketManifest("all");
  if (raw?.complete) return { id: raw.id, createdAt: raw.createdAt, source: "raw" as const, orderCount: raw.orderCount, regionCount: raw.regionCount };
  return null;
}

void KNOWN_OPTIONAL_ARTIFACTS;
