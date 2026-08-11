import fs from "node:fs/promises";
import path from "node:path";
import { STATIC_DATA_ROOT } from "./data-paths";
import { logEvent } from "./logger";

export type TypeImageVariation = "icon" | "render";

const TYPE_IMAGE_ROOT = path.join(STATIC_DATA_ROOT, "Type Images");
const IMAGE_SERVER = "https://images.evetech.net/types";
const allowedSizes = new Set([32, 64, 128, 256, 512, 1024]);
const inflight = new Map<string, Promise<string>>();
let prefetchStarted = false;

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
    const response = await fetch(`${IMAGE_SERVER}/${typeId}/${variation}?size=${size}`, {
      headers: { "X-User-Agent": "NewEdenSage/0.1.14" },
    });
    if (!response.ok) throw new Error(`EVE type image ${typeId} failed (${response.status}).`);
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, Buffer.from(await response.arrayBuffer()));
    await fs.rename(temp, target).catch(async () => {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      if (!(await exists(target))) throw new Error(`Could not cache EVE type image ${typeId}.`);
    });
    return target;
  })().finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}

function placeholderSvg(typeId: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="#08171d"/><rect x="1" y="1" width="62" height="62" fill="none" stroke="#31515a"/><text x="32" y="37" text-anchor="middle" font-family="sans-serif" font-size="17" fill="#6f929a">${typeId}</text></svg>`;
}

export async function typeImageProtocolResponse(requestUrl: string) {
  try {
    const url = new URL(requestUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const typeId = safeTypeId(parts[0]);
    const variation = safeVariation(parts[1]);
    const size = safeSize(url.searchParams.get("size"), variation);
    const file = await ensureTypeImageLocal(typeId, variation, size);
    const data = await fs.readFile(file);
    return new Response(data, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    const match = requestUrl.match(/\/([0-9]+)\//);
    const typeId = match ? Number(match[1]) : 0;
    const svg = placeholderSvg(typeId);
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
