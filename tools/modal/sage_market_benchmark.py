from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

import modal

_HERE = Path(__file__).resolve()
ROOT = _HERE.parents[2] if len(_HERE.parents) > 2 and (_HERE.parents[2] / "package.json").exists() else Path("/app")
PUBLISHED_VOLUME_NAME = "new-eden-sage-market-trial"

app = modal.App("new-eden-sage-market-benchmark")
published_volume = modal.Volume.from_name(PUBLISHED_VOLUME_NAME, create_if_missing=True)

image = (
    modal.Image.from_registry("node:22-bookworm-slim", add_python="3.12")
    .pip_install("fastapi>=0.115,<1")
    .run_commands("mkdir -p /app && cd /app && npm init -y >/dev/null 2>&1 && npm install adm-zip@0.6.0 >/dev/null 2>&1")
    .add_local_dir(str(ROOT / "dist-electron"), remote_path="/app/dist-electron")
    .add_local_dir(str(ROOT / "vendor" / "market-data"), remote_path="/app/vendor/market-data")
    .add_local_file(r"F:\New Eden Sage Data\Static Data\eve-static-data-jsonl.zip", remote_path="/app/New Eden Sage Data/Static Data/eve-static-data-jsonl.zip")
)

NODE_BENCHMARK = r"""
import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { createGzip, gunzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';

const ESI = 'https://esi.evetech.net';
const RAW_ROOT = process.env.NEW_EDEN_SAGE_RAW_MARKET_ROOT;
const PUBLISH_ROOT = '/published';
const HEADERS = {
  'X-Compatibility-Date': '2026-08-02',
  'X-User-Agent': 'NewEdenSage-Modal-Benchmark/1.0',
};
const REGION_CONCURRENCY = 6;
const PAGE_CONCURRENCY = 4;
let sourceBytes = 0;
let sourceRequests = 0;
let sourceRetries = 0;

function safeTimestamp(value) {
  return value.replace(/[:.]/g, '-');
}
function safeName(value) {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'region';
}
async function mapLimited(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
async function fetchBuffer(url, attempts = 5) {
  let lastError;
  for (let attempt = 0; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
      sourceRequests += 1;
      if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
        sourceRetries += 1;
        const retryAfter = Number(response.headers.get('retry-after') || 0);
        const errorReset = Number(response.headers.get('x-esi-error-limit-reset') || 0);
        const delaySeconds = Math.max(1, retryAfter || 0, errorReset || 0, Math.min(20, 2 ** attempt));
        await wait(delaySeconds * 1000);
        continue;
      }
      if (!response.ok) throw new Error(`ESI ${response.status} for ${url}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      sourceBytes += buffer.byteLength;
      return { response, buffer };
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      sourceRetries += 1;
      await wait(Math.min(10000, 1000 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
async function fetchJson(url, attempts = 5) {
  const { response, buffer } = await fetchBuffer(url, attempts);
  return { response, data: JSON.parse(buffer.toString('utf8')) };
}
async function writeJsonAtomic(target, value) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const partial = `${target}.${process.pid}.${Date.now()}.partial`;
  await fs.writeFile(partial, JSON.stringify(value), 'utf8');
  await fs.rename(partial, target);
}
async function gzipJsonAtomic(target, value) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const partial = `${target}.${process.pid}.${Date.now()}.partial`;
  await pipeline(Readable.from([JSON.stringify(value)]), createGzip({ level: 6 }), createWriteStream(partial));
  await fs.rename(partial, target);
  return fs.stat(target);
}
async function sha256File(target) {
  const hash = createHash('sha256');
  const file = await fs.open(target, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await file.close();
  }
  return hash.digest('hex');
}

async function fetchAllMarketOrders() {
  const started = performance.now();
  await fs.rm(RAW_ROOT, { recursive: true, force: true });
  await fs.mkdir(RAW_ROOT, { recursive: true });

  const { data: regionIds } = await fetchJson(`${ESI}/universe/regions/`);
  const regions = await mapLimited(regionIds, 8, async regionId => {
    const { data } = await fetchJson(`${ESI}/universe/regions/${regionId}/`);
    return { regionId, name: data.name };
  });
  regions.sort((a, b) => a.name.localeCompare(b.name));

  const createdAt = new Date().toISOString();
  const snapshot = {
    schemaVersion: 1,
    id: `${safeTimestamp(createdAt)}-all`,
    mode: 'all',
    createdAt,
    complete: false,
    regionCount: 0,
    orderCount: 0,
    regions: [],
  };
  const snapshotRoot = path.join(RAW_ROOT, snapshot.id);
  await fs.mkdir(path.join(snapshotRoot, 'regions'), { recursive: true });
  await writeJsonAtomic(path.join(snapshotRoot, 'manifest.json'), snapshot);

  const regionEntries = await mapLimited(regions, REGION_CONCURRENCY, async region => {
    const base = `${ESI}/markets/${region.regionId}/orders/?order_type=all`;
    const first = await fetchJson(`${base}&page=1`);
    const totalPages = Number(first.response.headers.get('x-pages') || 1);
    const pageNumbers = Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => i + 2);
    const pages = await mapLimited(pageNumbers, PAGE_CONCURRENCY, async page => (await fetchJson(`${base}&page=${page}`)).data);
    const orders = first.data.concat(...pages);
    const fileName = `${region.regionId}-${safeName(region.name)}.json.gz`;
    const relativeFile = path.join(snapshot.id, 'regions', fileName);
    const finalPath = path.join(RAW_ROOT, relativeFile);
    await gzipJsonAtomic(finalPath, {
      schemaVersion: 1,
      snapshotId: snapshot.id,
      snapshotCreatedAt: snapshot.createdAt,
      regionId: region.regionId,
      regionName: region.name,
      orderCount: orders.length,
      orders,
    });
    return {
      regionId: region.regionId,
      regionName: region.name,
      orderCount: orders.length,
      file: relativeFile,
      savedAt: new Date().toISOString(),
    };
  });

  snapshot.regions = regionEntries.sort((a, b) => a.regionName.localeCompare(b.regionName));
  snapshot.regionCount = snapshot.regions.length;
  snapshot.orderCount = snapshot.regions.reduce((sum, item) => sum + item.orderCount, 0);
  snapshot.complete = true;
  snapshot.completedAt = new Date().toISOString();
  await writeJsonAtomic(path.join(snapshotRoot, 'manifest.json'), snapshot);
  await writeJsonAtomic(path.join(RAW_ROOT, 'current.json'), snapshot);
  await writeJsonAtomic(path.join(RAW_ROOT, 'current-all.json'), snapshot);

  const rawFiles = await fs.readdir(path.join(snapshotRoot, 'regions'));
  let rawStoredBytes = 0;
  for (const file of rawFiles) rawStoredBytes += (await fs.stat(path.join(snapshotRoot, 'regions', file))).size;
  rawStoredBytes += (await fs.stat(path.join(snapshotRoot, 'manifest.json'))).size;

  return {
    snapshot,
    downloadMs: Math.round(performance.now() - started),
    sourceBytes,
    sourceRequests,
    sourceRetries,
    rawStoredBytes,
  };
}

async function directSampleCheck(snapshot, index, sampleTypeIds) {
  const { getMarketSystemIndex } = await import('/app/dist-electron/market-static-index.js');
  const systems = await getMarketSystemIndex();
  const wanted = new Set(sampleTypeIds);
  const direct = new Map();
  for (const typeId of sampleTypeIds) direct.set(typeId, {
    buyOrders: 0, sellOrders: 0, bestBuy: null, bestSell: null,
    high: { buyOrders: 0, sellOrders: 0, bestBuy: null, bestSell: null },
    low: { buyOrders: 0, sellOrders: 0, bestBuy: null, bestSell: null },
    null: { buyOrders: 0, sellOrders: 0, bestBuy: null, bestSell: null },
  });
  for (const entry of snapshot.regions) {
    const payload = JSON.parse(gunzipSync(await fs.readFile(path.join(RAW_ROOT, entry.file))).toString('utf8'));
    for (const order of payload.orders) {
      if (!wanted.has(order.type_id)) continue;
      const value = direct.get(order.type_id);
      const band = systems.get(order.system_id)?.securityBand ?? 'null';
      const bandValue = value[band];
      if (order.is_buy_order) {
        value.buyOrders += 1;
        bandValue.buyOrders += 1;
        if (value.bestBuy == null || order.price > value.bestBuy) value.bestBuy = order.price;
        if (bandValue.bestBuy == null || order.price > bandValue.bestBuy) bandValue.bestBuy = order.price;
      } else {
        value.sellOrders += 1;
        bandValue.sellOrders += 1;
        if (value.bestSell == null || order.price < value.bestSell) value.bestSell = order.price;
        if (bandValue.bestSell == null || order.price < bandValue.bestSell) bandValue.bestSell = order.price;
      }
    }
  }
  return sampleTypeIds.map(typeId => {
    const item = index.items.get(typeId);
    const expected = direct.get(typeId);
    const actual = item ? {
      buyOrders: item.totalBuyOrders,
      sellOrders: item.totalSellOrders,
      bestBuy: item.buys[0]?.price ?? null,
      bestSell: item.sells[0]?.price ?? null,
    } : null;
    return {
      typeId,
      typeName: item?.typeName ?? null,
      expected,
      actual,
      match: Boolean(item)
        && expected.buyOrders === actual.buyOrders
        && expected.sellOrders === actual.sellOrders
        && expected.bestBuy === actual.bestBuy
        && expected.bestSell === actual.bestSell,
    };
  });
}

async function publishPrepared(fetchResult, index, regional, publicTrades, publicShortages) {
  const started = performance.now();
  const generation = fetchResult.snapshot.id;
  const generationRoot = path.join(PUBLISH_ROOT, 'generations', generation);
  await fs.mkdir(generationRoot, { recursive: true });

  const globalPath = path.join(generationRoot, 'market-global-v1.json.gz');
  const globalPartial = `${globalPath}.${process.pid}.partial`;
  const globalHeader = {
    schemaVersion: 1,
    dataset: 'market-global',
    snapshotId: index.snapshotId,
    createdAt: index.createdAt,
    orderCount: index.orderCount,
    regionCount: index.regionCount,
    sourceOrdersInspected: index.sourceOrdersInspected,
    candidateDepthPerSide: index.candidateDepthPerSide,
    itemCount: index.items.size,
  };
  async function* globalPayload() {
    yield `${JSON.stringify(globalHeader).slice(0, -1)},\"items\":[`;
    let first = true;
    for (const item of index.items.values()) {
      yield `${first ? '' : ','}${JSON.stringify(item)}`;
      first = false;
    }
    yield ']}';
  }
  await pipeline(Readable.from(globalPayload()), createGzip({ level: 6 }), createWriteStream(globalPartial));
  await fs.rename(globalPartial, globalPath);

  const regionalPath = path.join(generationRoot, 'market-regional-v1.jsonl.gz');
  const regionalPartial = `${regionalPath}.${process.pid}.partial`;
  async function* regionalPayload() {
    yield `${JSON.stringify({
      schemaVersion: 1,
      dataset: 'market-regional',
      snapshotId: regional.snapshotId,
      createdAt: regional.createdAt,
      orderCount: regional.orderCount,
      regionCount: regional.regionCount,
      rowCount: regional.rows.length,
    })}\n`;
    for (const row of regional.rows) yield `${JSON.stringify(row)}\n`;
  }
  await pipeline(Readable.from(regionalPayload()), createGzip({ level: 6 }), createWriteStream(regionalPartial));
  await fs.rename(regionalPartial, regionalPath);

  const tradesPath = path.join(generationRoot, 'market-trades-v1.json.gz');
  await gzipJsonAtomic(tradesPath, publicTrades);
  const shortagesPath = path.join(generationRoot, 'market-shortages-v1.json.gz');
  await gzipJsonAtomic(shortagesPath, publicShortages);

  const globalStat = await fs.stat(globalPath);
  const regionalStat = await fs.stat(regionalPath);
  const tradesStat = await fs.stat(tradesPath);
  const shortagesStat = await fs.stat(shortagesPath);
  const files = {
    'market-global': {
      version: generation,
      path: `generations/${generation}/market-global-v1.json.gz`,
      bytes: globalStat.size,
      sha256: await sha256File(globalPath),
      schemaVersion: 1,
    },
    'market-regional': {
      version: generation,
      path: `generations/${generation}/market-regional-v1.jsonl.gz`,
      bytes: regionalStat.size,
      sha256: await sha256File(regionalPath),
      schemaVersion: 1,
    },
    'market-trades': {
      version: generation,
      path: `generations/${generation}/market-trades-v1.json.gz`,
      bytes: tradesStat.size,
      sha256: await sha256File(tradesPath),
      schemaVersion: 1,
    },
    'market-shortages': {
      version: generation,
      path: `generations/${generation}/market-shortages-v1.json.gz`,
      bytes: shortagesStat.size,
      sha256: await sha256File(shortagesPath),
      schemaVersion: 1,
    },
  };
  const manifest = {
    schemaVersion: 1,
    generation,
    publishedAt: new Date().toISOString(),
    sourceCreatedAt: index.createdAt,
    source: 'CCP ESI public market orders',
    orderCount: index.orderCount,
    regionCount: index.regionCount,
    itemCount: index.items.size,
    regionalRowCount: regional.rows.length,
    tradeCandidateCount: publicTrades.opportunities.length,
    shortageSignalCount: publicShortages.signals.length,
    files,
  };
  await writeJsonAtomic(path.join(generationRoot, 'manifest.json'), manifest);
  const manifestPartial = path.join(PUBLISH_ROOT, `manifest.json.${process.pid}.partial`);
  await fs.writeFile(manifestPartial, JSON.stringify(manifest, null, 2), 'utf8');
  await fs.rename(manifestPartial, path.join(PUBLISH_ROOT, 'manifest.json'));

  return {
    publishMs: Math.round(performance.now() - started),
    files,
    totalPreparedBytes: globalStat.size + regionalStat.size + tradesStat.size + shortagesStat.size,
    manifest,
  };
}

const overallStarted = performance.now();
const fetchResult = await fetchAllMarketOrders();
const afterFetch = performance.now();

const { buildFullMarketAnalysisIndex } = await import('/app/dist-electron/raw-market-analysis.js');
const { buildRegionalMarketAggregateIndexFromFull } = await import('/app/dist-electron/regional-market-index.js');

const indexStarted = performance.now();
const index = await buildFullMarketAnalysisIndex(undefined, {
  bypassCache: true,
  skipPersist: true,
  retainHistoricalCache: false,
});
const afterIndex = performance.now();
const regional = await buildRegionalMarketAggregateIndexFromFull(index, { progress: () => {} });
const afterRegional = performance.now();
const { buildPreparedPublicTradeDataset, buildPreparedPublicShortageDataset } = await import('/app/dist-electron/public-market-intelligence.js');
const publicTrades = await buildPreparedPublicTradeDataset(index);
const afterPublicTrades = performance.now();
const publicShortages = await buildPreparedPublicShortageDataset(index);
const afterPublicShortages = performance.now();

const sampleCandidates = [34, 44992, 16633, 17887, 29668].filter(typeId => index.items.has(typeId));
const fallbackSamples = [...index.items.keys()].slice(0, Math.max(0, 3 - sampleCandidates.length));
const sampleTypeIds = [...new Set([...sampleCandidates, ...fallbackSamples])].slice(0, 5);
const sampleChecks = await directSampleCheck(fetchResult.snapshot, index, sampleTypeIds);
const correctness = {
  snapshotComplete: fetchResult.snapshot.complete === true,
  regionCountMatches: fetchResult.snapshot.regionCount === index.regionCount,
  orderCountMatches: fetchResult.snapshot.orderCount === index.orderCount && index.orderCount === index.sourceOrdersInspected,
  regionalMetadataMatches: regional.snapshotId === index.snapshotId && regional.orderCount === index.orderCount && regional.regionCount === index.regionCount,
  samplesMatch: sampleChecks.every(sample => sample.match),
  publicTradeSnapshotMatches: publicTrades.snapshotId === index.snapshotId && publicTrades.routeChecks <= 30000,
  publicShortageSnapshotMatches: publicShortages.snapshotId === index.snapshotId,
};
correctness.all = Object.values(correctness).every(Boolean);
if (!correctness.all) throw new Error(`Correctness validation failed: ${JSON.stringify({ correctness, sampleChecks })}`);

const publish = await publishPrepared(fetchResult, index, regional, publicTrades, publicShortages);
const completed = performance.now();
const mem = process.memoryUsage();

console.log(JSON.stringify({
  snapshotId: index.snapshotId,
  createdAt: index.createdAt,
  regions: index.regionCount,
  orders: index.sourceOrdersInspected,
  items: index.items.size,
  regionalRows: regional.rows.length,
  downloadMs: fetchResult.downloadMs,
  sourceBytes: fetchResult.sourceBytes,
  sourceRequests: fetchResult.sourceRequests,
  sourceRetries: fetchResult.sourceRetries,
  rawStoredBytes: fetchResult.rawStoredBytes,
  fullIndexMs: Math.round(afterIndex - indexStarted),
  regionalMs: Math.round(afterRegional - afterIndex),
  publicTradeMs: Math.round(afterPublicTrades - afterRegional),
  publicShortageMs: Math.round(afterPublicShortages - afterPublicTrades),
  publicTradeCandidates: publicTrades.opportunities.length,
  publicTradeRouteChecks: publicTrades.routeChecks,
  publicShortageSignals: publicShortages.signals.length,
  computeMs: Math.round(afterPublicShortages - indexStarted),
  publishMs: publish.publishMs,
  totalMs: Math.round(completed - overallStarted),
  rssMiB: +(mem.rss / 1048576).toFixed(1),
  heapUsedMiB: +(mem.heapUsed / 1048576).toFixed(1),
  heapTotalMiB: +(mem.heapTotal / 1048576).toFixed(1),
  correctness,
  sampleChecks,
  outputFiles: publish.files,
  totalPreparedBytes: publish.totalPreparedBytes,
  publishedManifest: publish.manifest,
}));
"""


@app.function(
    image=image,
    volumes={"/published": published_volume},
    cpu=1.0,
    memory=2048,
    timeout=600,
)
def benchmark_market_pipeline() -> dict:
    env = os.environ.copy()
    env["NEW_EDEN_SAGE_RAW_MARKET_ROOT"] = "/tmp/new-eden-sage-market/Raw Orders"
    env["NEW_EDEN_SAGE_USER_DATA"] = "/tmp/new-eden-sage-user"
    env["NEW_EDEN_SAGE_DISABLE_SHARED_MARKET"] = "1"

    started = time.perf_counter()
    completed = subprocess.run(
        ["node", "--max-old-space-size=1536", "--input-type=module", "-e", NODE_BENCHMARK],
        cwd="/app",
        env=env,
        capture_output=True,
        text=True,
        timeout=570,
        check=False,
    )
    wall_ms = round((time.perf_counter() - started) * 1000)

    if completed.returncode != 0:
        raise RuntimeError(
            "Sage public market pipeline failed on Modal.\n"
            f"stdout:\n{completed.stdout[-8000:]}\n"
            f"stderr:\n{completed.stderr[-8000:]}"
        )

    lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError("Sage public market pipeline returned no benchmark JSON.")

    result = json.loads(lines[-1])
    published_volume.commit()
    result["wallMs"] = wall_ms
    result["modalCpu"] = 1.0
    result["modalMemoryMiB"] = 2048
    return result


@app.local_entrypoint()
def main():
    started = time.perf_counter()
    result = benchmark_market_pipeline.remote()
    result["clientObservedMs"] = round((time.perf_counter() - started) * 1000)
    print(json.dumps(result, indent=2))


# SHARED MARKET HTTP SERVICE
from datetime import datetime, timezone

PUBLISH_ROOT = Path("/published")
MANIFEST_PATH = PUBLISH_ROOT / "manifest.json"
MAX_GENERATION_AGE_SECONDS = 300


def _read_manifest() -> dict | None:
    try:
        value = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None
    if not isinstance(value, dict) or value.get("schemaVersion") != 1 or not value.get("generation"):
        return None
    return value


def _parse_utc(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _manifest_age_seconds(manifest: dict) -> float | None:
    published_at = _parse_utc(manifest.get("publishedAt"))
    if published_at is None:
        return None
    return max(0.0, (datetime.now(timezone.utc) - published_at).total_seconds())


def _manifest_is_current(manifest: dict | None) -> bool:
    if manifest is None:
        return False
    age = _manifest_age_seconds(manifest)
    return age is not None and age < MAX_GENERATION_AGE_SECONDS


@app.function(
    image=image,
    volumes={"/published": published_volume},
    cpu=0.25,
    memory=256,
    timeout=660,
    max_containers=1,
)
@modal.concurrent(max_inputs=1)
def refresh_market_if_stale() -> dict:
    """Serialize global refreshes and re-check freshness after waiting in the queue."""
    published_volume.reload()
    existing = _read_manifest()
    if _manifest_is_current(existing):
        return {
            "manifest": existing,
            "refreshed": False,
            "ageSeconds": _manifest_age_seconds(existing),
        }

    result = benchmark_market_pipeline.remote()
    published_volume.reload()
    current = _read_manifest()
    if current is None:
        raise RuntimeError("Market refresh completed without publishing a valid manifest.")
    return {
        "manifest": current,
        "refreshed": True,
        "ageSeconds": _manifest_age_seconds(current),
        "refreshGeneration": result.get("snapshotId"),
        "refreshWallMs": result.get("wallMs"),
    }


@app.function(image=image, schedule=modal.Period(minutes=5), timeout=700)
def scheduled_market_refresh() -> dict:
    """Producer-only schedule. Desktop consumers never invoke this path."""
    return refresh_market_if_stale.remote()


@app.function(
    image=image,
    volumes={"/published": published_volume},
    cpu=0.25,
    memory=256,
    timeout=390,
)
@modal.asgi_app()
def shared_market_web():
    from fastapi import FastAPI, HTTPException
    from fastapi.responses import FileResponse

    web = FastAPI(title="New Eden Sage Shared Market", docs_url=None, redoc_url=None)

    def current_manifest() -> dict | None:
        published_volume.reload()
        return _read_manifest()

    @web.get("/status")
    def status():
        manifest = current_manifest()
        return {
            "ok": manifest is not None,
            "current": _manifest_is_current(manifest),
            "ageSeconds": _manifest_age_seconds(manifest) if manifest else None,
            "manifest": manifest,
        }

    @web.get("/latest-complete")
    def latest_complete():
        manifest = current_manifest()
        if manifest is None:
            raise HTTPException(status_code=503, detail="No complete shared market generation is available.")
        return {"manifest": manifest}

    @web.get("/ensure-current")
    def ensure_current():
        try:
            result = refresh_market_if_stale.remote()
            return result
        except Exception as error:
            # A failed refresh must never evict the last-known-good generation.
            manifest = current_manifest()
            if manifest is not None:
                return {
                    "manifest": manifest,
                    "refreshed": False,
                    "ageSeconds": _manifest_age_seconds(manifest),
                    "refreshError": str(error),
                }
            raise HTTPException(status_code=503, detail=f"No shared market generation is available: {error}")

    @web.get("/{artifact_path:path}")
    def artifact(artifact_path: str):
        normalized = artifact_path.lstrip("/")
        parts = normalized.split("/")
        if len(parts) != 3 or parts[0] != "generations" or not parts[1] or not parts[2] or ".." in parts:
            raise HTTPException(status_code=400, detail="Invalid shared market artifact path.")

        generation = parts[1]
        generation_manifest_path = PUBLISH_ROOT / "generations" / generation / "manifest.json"
        try:
            generation_manifest = json.loads(generation_manifest_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            raise HTTPException(status_code=404, detail="Shared market generation is unavailable.")
        if not isinstance(generation_manifest, dict) or generation_manifest.get("generation") != generation:
            raise HTTPException(status_code=404, detail="Shared market generation manifest is invalid.")

        files = generation_manifest.get("files") if isinstance(generation_manifest.get("files"), dict) else {}
        allowed = {
            item.get("path"): item
            for item in files.values()
            if isinstance(item, dict) and isinstance(item.get("path"), str)
        }
        metadata = allowed.get(normalized)
        if metadata is None:
            raise HTTPException(status_code=404, detail="Unknown shared market artifact.")

        target = PUBLISH_ROOT / normalized
        try:
            target.resolve().relative_to(PUBLISH_ROOT.resolve())
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid artifact path.")
        if not target.is_file():
            raise HTTPException(status_code=404, detail="Shared market artifact is missing.")

        return FileResponse(
            target,
            media_type="application/gzip",
            headers={
                "ETag": str(metadata.get("sha256", "")),
                "X-New-Eden-Sage-Generation": generation,
            },
        )

    return web
