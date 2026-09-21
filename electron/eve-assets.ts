import fs from "node:fs/promises";
import path from "node:path";
import { DATA_ROOT, STATIC_DATA_ROOT } from "./data-paths";
import { logEvent } from "./logger";

export type TypeImageVariation = "icon" | "render";

const TYPE_IMAGE_ROOT = path.join(STATIC_DATA_ROOT, "Type Images");
const BLUEPRINT_IMAGE_ROOT = path.join(STATIC_DATA_ROOT, "Blueprint Images");
const BLUEPRINT_GRAPHICS_ROOT = path.join(BLUEPRINT_IMAGE_ROOT, "graphics");
const BLUEPRINT_RENDER_ROOT = path.join(BLUEPRINT_IMAGE_ROOT, "rendered");
const BLUEPRINT_OFFICIAL_ROOT = path.join(BLUEPRINT_IMAGE_ROOT, "official");
const BLUEPRINT_OVERLAYS_ROOT = path.join(BLUEPRINT_IMAGE_ROOT, "overlays");
const BLUEPRINT_TYPE_MAP = path.join(BLUEPRINT_IMAGE_ROOT, "blueprint-type-map.json");
const FITTER_CONTENT_ASSET_ROOT = path.join(DATA_ROOT, "Fitter Content");
const IMAGE_SERVER = "https://images.evetech.net/types";
const allowedSizes = new Set([32, 64, 128, 256, 512, 1024]);
const inflight = new Map<string, Promise<string>>();
const MAX_CONCURRENT_IMAGE_DOWNLOADS = 8;
const IMAGE_DOWNLOAD_ATTEMPTS = 3;
let activeImageDownloads = 0;
const imageDownloadWaiters: Array<() => void> = [];
let prefetchStarted = false;

async function acquireImageDownloadSlot() {
  if (activeImageDownloads < MAX_CONCURRENT_IMAGE_DOWNLOADS) {
    activeImageDownloads += 1;
    return;
  }
  await new Promise<void>((resolve) => imageDownloadWaiters.push(resolve));
}

function releaseImageDownloadSlot() {
  const next = imageDownloadWaiters.shift();
  if (next) next();
  else activeImageDownloads = Math.max(0, activeImageDownloads - 1);
}

const imageRetryDelay = (attempt: number) => new Promise((resolve) => setTimeout(resolve, 150 * attempt * attempt));

async function downloadTypeImage(typeId: number, variation: TypeImageVariation, size: number) {
  await acquireImageDownloadSlot();
  try {
    let lastError: unknown;
    for (let attempt = 1; attempt <= IMAGE_DOWNLOAD_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(`${IMAGE_SERVER}/${typeId}/${variation}?size=${size}`, {
          headers: { "X-User-Agent": "NewEdenSage/0.1.14" },
        });
        if (!response.ok) {
          const error = new Error(`EVE type image ${typeId} failed (${response.status}).`);
          if (response.status === 400 || response.status === 404) {
            error.name = "PermanentTypeImageError";
          }
          throw error;
        }
        return Buffer.from(await response.arrayBuffer());
      } catch (error) {
        if (error instanceof Error && error.name === "PermanentTypeImageError") throw error;
        lastError = error;
        if (attempt < IMAGE_DOWNLOAD_ATTEMPTS) await imageRetryDelay(attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`EVE type image ${typeId} could not be downloaded.`);
  } finally {
    releaseImageDownloadSlot();
  }
}

function safeTypeId(value: unknown) {
  const typeId = Number(value);
  if (!Number.isInteger(typeId) || typeId <= 0) throw new Error("Invalid EVE type ID.");
  return typeId;
}

function safeVariation(value: unknown): TypeImageVariation {
  return value === "render" ? "render" : "icon";
}

function safeSize(value: unknown, variation: TypeImageVariation) {
  const requested = Number(value);
  if (allowedSizes.has(requested)) return requested;
  return variation === "render" ? 512 : 64;
}

function imagePath(typeId: number, variation: TypeImageVariation, size: number) {
  return path.join(TYPE_IMAGE_ROOT, variation, String(size), `${typeId}.png`);
}

async function exists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function ensureTypeImageLocal(
  rawTypeId: unknown,
  rawVariation: unknown = "icon",
  rawSize: unknown = 64,
) {
  const typeId = safeTypeId(rawTypeId);
  const variation = safeVariation(rawVariation);
  const size = safeSize(rawSize, variation);
  const target = imagePath(typeId, variation, size);
  if (await exists(target)) return target;

  const key = `${variation}:${size}:${typeId}`;
  const current = inflight.get(key);
  if (current) return current;

  const task = (async () => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const data = await downloadTypeImage(typeId, variation, size);
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, data);
    await fs.rename(temp, target).catch(async () => {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      if (!(await exists(target))) throw new Error(`Could not cache EVE type image ${typeId}.`);
    });
    return target;
  })().finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}

type BlueprintKind = "bpo" | "bpc";
type BlueprintArtMapRow = { blueprintTypeId:number; productTypeId:number|null; graphicId:number|null; hasClientBlueprintGraphic:boolean };
let blueprintMapPromise: Promise<Record<string, BlueprintArtMapRow>> | undefined;

function safeBlueprintKind(value: unknown): BlueprintKind {
  return String(value ?? "bpo").toLowerCase() === "bpc" ? "bpc" : "bpo";
}

async function loadBlueprintArtMap() {
  return blueprintMapPromise ??= fs.readFile(BLUEPRINT_TYPE_MAP, "utf8")
    .then((text) => JSON.parse(text)?.blueprints as Record<string, BlueprintArtMapRow>)
    .catch(() => ({} as Record<string, BlueprintArtMapRow>));
}

function blueprintRenderedPath(typeId:number, kind:BlueprintKind) {
  return path.join(BLUEPRINT_RENDER_ROOT, kind, `${typeId}.png`);
}

function blueprintOfficialPath(typeId:number, kind:BlueprintKind, size=64) {
  return path.join(BLUEPRINT_OFFICIAL_ROOT, kind, String(size), `${typeId}.png`);
}

async function ensureOfficialBlueprintImageLocal(typeId:number, kind:BlueprintKind, size=64) {
  const target = blueprintOfficialPath(typeId, kind, size);
  if (await exists(target)) return target;
  const key = `blueprint:${kind}:${size}:${typeId}`;
  const current = inflight.get(key);
  if (current) return current;
  const task = (async () => {
    await fs.mkdir(path.dirname(target), { recursive:true });
    await acquireImageDownloadSlot();
    try {
      let lastError: unknown;
      for (let attempt=1; attempt<=IMAGE_DOWNLOAD_ATTEMPTS; attempt += 1) {
        try {
          const serverVariation = kind === "bpo" ? "bp" : "bpc";
          const response = await fetch(`${IMAGE_SERVER}/${typeId}/${serverVariation}?size=${size}`, { headers:{ "X-User-Agent":"NewEdenSage/0.1.14" } });
          if (!response.ok) {
            const error = new Error(`EVE blueprint image ${typeId}/${kind} failed (${response.status}).`);
            if (response.status === 400 || response.status === 404) error.name = "PermanentBlueprintImageError";
            throw error;
          }
          const data = Buffer.from(await response.arrayBuffer());
          if (!data.length) throw new Error(`EVE blueprint image ${typeId}/${kind} was empty.`);
          const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
          await fs.writeFile(temp, data);
          await fs.rename(temp, target).catch(async () => {
            await fs.rm(temp, { force:true }).catch(() => undefined);
            if (!(await exists(target))) throw new Error(`Could not cache EVE blueprint image ${typeId}/${kind}.`);
          });
          return target;
        } catch (error) {
          if (error instanceof Error && error.name === "PermanentBlueprintImageError") throw error;
          lastError = error;
          if (attempt < IMAGE_DOWNLOAD_ATTEMPTS) await imageRetryDelay(attempt);
        }
      }
      throw lastError instanceof Error ? lastError : new Error(`EVE blueprint image ${typeId}/${kind} could not be downloaded.`);
    } finally {
      releaseImageDownloadSlot();
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

async function ensureBlueprintImageLocal(rawTypeId: unknown, rawKind: unknown = "bpo") {
  const typeId = safeTypeId(rawTypeId);
  const kind = safeBlueprintKind(rawKind);
  const map = await loadBlueprintArtMap();
  const row = map[String(typeId)];

  // CCP exposes first-party BPO/BPC image variants. Keep these as the canonical
  // blueprint art and cache them permanently for offline use.
  try { return await ensureOfficialBlueprintImageLocal(typeId, kind, 64); } catch { /* legacy/client fallback below */ }

  const graphicId = Number(row?.graphicId ?? 0);
  const clientGraphic = graphicId > 0 ? path.join(BLUEPRINT_GRAPHICS_ROOT, `${graphicId}.png`) : "";

  // CCP ships these exact 64px blueprint renderings in the Tranquility client.
  // Prefer them byte-for-byte over a generated approximation whenever one exists.
  if (clientGraphic && await exists(clientGraphic)) return clientGraphic;

  // Non-model blueprints are precomposed by scripts/cache-eve-blueprint-art.cjs
  // from the manufactured item's icon and CCP's own BPO/BPC overlay. This keeps
  // runtime rendering dependency-free and makes the library fully offline.
  const rendered = blueprintRenderedPath(typeId, kind);
  if (await exists(rendered)) return rendered;

  const generic = path.join(BLUEPRINT_OVERLAYS_ROOT, `${kind}.png`);
  if (await exists(generic)) return generic;

  const productTypeId = Number(row?.productTypeId ?? 0);
  return ensureTypeImageLocal(productTypeId > 0 ? productTypeId : typeId, "icon", 64);
}

async function blueprintImageProtocolResponse(url: URL) {
  const parts = url.pathname.split("/").filter(Boolean);
  const typeId = safeTypeId(parts[0]);
  const kind = safeBlueprintKind(parts[1]);
  const file = await ensureBlueprintImageLocal(typeId, kind);
  const data = await fs.readFile(file);
  return new Response(data, { status:200, headers:{ "Content-Type":imageContentType(data), "Cache-Control":"public, max-age=31536000, immutable" } });
}

function placeholderSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="#08171d"/><rect x="1" y="1" width="62" height="62" fill="none" stroke="#31515a"/><path d="M18 24 32 16l14 8v16L32 48 18 40V24Z" fill="#0b252d" stroke="#4e7e88" stroke-width="2"/><path d="m18 24 14 8 14-8M32 32v16" fill="none" stroke="#4e7e88" stroke-width="2"/></svg>`;
}

function imageContentType(data: Buffer) {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "application/octet-stream";
}

async function fitterContentProtocolResponse(url: URL) {
  const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
  if (!parts.length) throw new Error("Missing fitter content asset path.");
  const root = path.resolve(FITTER_CONTENT_ASSET_ROOT);
  const target = path.resolve(root, ...parts);
  const rootPrefix = root.toLowerCase() + path.sep;
  if (!target.toLowerCase().startsWith(rootPrefix)) throw new Error("Invalid fitter content asset path.");
  const ext = path.extname(target).toLowerCase();
  const allowed = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
  if (!allowed.has(ext)) throw new Error("Unsupported fitter content asset type.");
  const data = await fs.readFile(target);
  const contentType = ext === ".svg" ? "image/svg+xml" : ext === ".gif" ? "image/gif" : imageContentType(data);
  return new Response(data, { status:200, headers:{ "Content-Type":contentType, "Cache-Control":"no-cache" } });
}

export async function typeImageProtocolResponse(requestUrl: string) {
  try {
    const url = new URL(requestUrl);
    if (url.hostname === "fitter-content") return await fitterContentProtocolResponse(url);
    if (url.hostname === "blueprint") return await blueprintImageProtocolResponse(url);
    const parts = url.pathname.split("/").filter(Boolean);
    const typeId = safeTypeId(parts[0]);
    const variation = safeVariation(parts[1]);
    const size = safeSize(url.searchParams.get("size"), variation);
    const cacheOnly = url.searchParams.get("cache") === "only";
    const cached = imagePath(typeId, variation, size);
    const file = cacheOnly
      ? (await exists(cached) ? cached : "")
      : await ensureTypeImageLocal(typeId, variation, size);
    if (!file) throw new Error(`Cached EVE type image ${typeId} is not ready.`);
    const data = await fs.readFile(file);
    return new Response(data, {
      status: 200,
      headers: {
        "Content-Type": imageContentType(data),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    const svg = placeholderSvg();
    return new Response(svg, {
      status: 200,
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" },
    });
  }
}

async function mapLimited<T>(items: T[], limit: number, mapper: (item: T) => Promise<void>) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await mapper(items[index]);
    }
  }));
}

export async function cacheTypeIconsLocal(typeIds: number[], size = 64) {
  const resolvedSize = safeSize(size, "icon");
  const unique = [...new Set(typeIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  let ready = 0;
  let failed = 0;
  await mapLimited(unique, 10, async (typeId) => {
    try {
      await ensureTypeImageLocal(typeId, "icon", resolvedSize);
      ready += 1;
    } catch {
      failed += 1;
    }
  });
  return { requested: unique.length, ready, failed, size: resolvedSize };
}

export function prefetchFittingTypeIcons(typeIds: number[]) {
  if (prefetchStarted) return;
  prefetchStarted = true;
  const unique = [...new Set(typeIds.filter((id) => Number.isInteger(id) && id > 0))];
  void mapLimited(unique, 10, async (typeId) => {
    await ensureTypeImageLocal(typeId, "icon", 64).catch(() => undefined);
  }).then(() => logEvent("info", "static_data.fitting_images_cached", { types: unique.length }))
    .catch((error) => logEvent("warn", "static_data.fitting_images_cache_failed", { error }));
}

export function typeImageRoot() {
  return TYPE_IMAGE_ROOT;
}
