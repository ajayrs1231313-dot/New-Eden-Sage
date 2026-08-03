import { promises as fs } from "node:fs";
import path from "node:path";
import { itemCategoryIds, itemCategoryName } from "./type-volumes";
import { MARKET_DATA_ROOT } from "./data-paths";

export { MARKET_DATA_ROOT };
const MARKET_INDEX_ROOT = path.join(MARKET_DATA_ROOT, "Current Index");
const MARKET_INDEX_MANIFEST = path.join(MARKET_INDEX_ROOT, "regions.json");
interface DatasetEnvelope {
  schemaVersion: 1;
  mode: "single" | "all" | "radius" | "contracts";
  createdAt: string;
  summaries: unknown[];
}

async function ensureStorage() {
  try {
    await fs.mkdir(MARKET_DATA_ROOT, { recursive: true });
  } catch {
    throw new Error(
      `Market storage is unavailable at ${MARKET_DATA_ROOT}. Check that the F: drive is connected and writable.`,
    );
  }
}

export async function loadLatestMarketDataset(): Promise<unknown[]> {
  await ensureStorage();
  const files = (await listDatasetFiles()).filter(
    (file) => !file.startsWith("market-contracts-"),
  );
  if (!files.length) return [];
  try {
    const data = JSON.parse(
      await fs.readFile(path.join(MARKET_DATA_ROOT, files[0]), "utf8"),
    ) as DatasetEnvelope;
    return Array.isArray(data.summaries)
      ? await enrichCategories(data.summaries)
      : [];
  } catch {
    throw new Error("The latest market dataset could not be read.");
  }
}

export async function loadLatestMarketDatasetByMode(
  mode: "single" | "all" | "radius" | "contracts",
): Promise<DatasetEnvelope | null> {
  await ensureStorage();
  const files = (await listDatasetFiles()).filter((file) =>
    file.startsWith(`market-${mode}-`),
  );
  if (!files.length) return null;
  try {
    return JSON.parse(
      await fs.readFile(path.join(MARKET_DATA_ROOT, files[0]), "utf8"),
    ) as DatasetEnvelope;
  } catch {
    throw new Error(`The latest ${mode} market dataset could not be read.`);
  }
}

export async function loadRecentMarketDatasetsByMode(
  mode: "single" | "all" | "radius" | "contracts",
  limit = 2,
): Promise<DatasetEnvelope[]> {
  await ensureStorage();
  const files = (await listDatasetFiles())
    .filter((file) => file.startsWith(`market-${mode}-`))
    .slice(0, limit);
  const datasets = await Promise.all(
    files.map(async (file) =>
      JSON.parse(
        await fs.readFile(path.join(MARKET_DATA_ROOT, file), "utf8"),
      ),
    ),
  );
  return datasets as DatasetEnvelope[];
}

export async function saveMarketDataset(
  mode: "single" | "all" | "radius" | "contracts",
  summaries: unknown[],
) {
  await ensureStorage();
  const createdAt = new Date().toISOString();
  const safeTimestamp = createdAt.replace(/[:.]/g, "-");
  const finalName = `market-${mode}-${safeTimestamp}.json`;
  const finalPath = path.join(MARKET_DATA_ROOT, finalName);
  const temporaryPath = `${finalPath}.partial`;
  const envelope: DatasetEnvelope = {
    schemaVersion: 1,
    mode,
    createdAt,
    summaries,
  };
  await fs.writeFile(temporaryPath, JSON.stringify(envelope), "utf8");
  await fs.rename(temporaryPath, finalPath);
  if (mode === "all" || mode === "single") await writeMarketIndex(summaries);

  const files = await listDatasetFiles();
  return {
    path: finalPath,
    retained: files.length,
  };
}

export async function loadMarketIndexHeaders() {
  await ensureStorage();
  try {
    return JSON.parse(await fs.readFile(MARKET_INDEX_MANIFEST, "utf8"));
  } catch {
    return [];
  }
}

export async function loadMarketRegion(regionId: number) {
  await ensureStorage();
  try {
    const summary = JSON.parse(
      await fs.readFile(path.join(MARKET_INDEX_ROOT, `${regionId}.json`), "utf8"),
    );
    return (await enrichCategories([summary]))[0] ?? null;
  } catch {
    return null;
  }
}

export async function rebuildMarketIndexFromLatestFull() {
  const full = await loadLatestMarketDatasetByMode("all");
  if (!full) return 0;
  await writeMarketIndex(full.summaries);
  return full.summaries.length;
}

export function marketSummaryHeaders(summaries: unknown[]) {
  return (summaries as Array<Record<string, unknown>>).map(
    ({ items: _items, topOrders: _topOrders, publicContracts: _contracts, ...header }) =>
      header,
  );
}

async function writeMarketIndex(summaries: unknown[]) {
  await fs.mkdir(MARKET_INDEX_ROOT, { recursive: true });
  const regions = summaries as Array<{ regionId: number }>;
  await Promise.all(
    regions.map((summary) =>
      fs.writeFile(
        path.join(MARKET_INDEX_ROOT, `${summary.regionId}.json`),
        JSON.stringify(summary),
        "utf8",
      ),
    ),
  );
  const temporaryManifest = `${MARKET_INDEX_MANIFEST}.partial`;
  await fs.writeFile(
    temporaryManifest,
    JSON.stringify(marketSummaryHeaders(summaries)),
    "utf8",
  );
  await fs.rename(temporaryManifest, MARKET_INDEX_MANIFEST);
}

export async function countMarketDatasets() {
  await ensureStorage();
  return (await listDatasetFiles()).length;
}

async function listDatasetFiles() {
  const entries = await fs.readdir(MARKET_DATA_ROOT, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        /^market-(single|all|radius|contracts)-.*\.json$/.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort((a, b) => datasetTimestamp(b).localeCompare(datasetTimestamp(a)));
}

function datasetTimestamp(file: string) {
  return (
    file.match(
      /^market-(?:single|all|radius|contracts)-(.+)\.json$/,
    )?.[1] ?? ""
  );
}

async function enrichCategories(summaries: unknown[]) {
  const regions = summaries as Array<{
    items?: Array<{
      typeId: number;
      categoryId?: number;
      categoryName?: string;
    }>;
  }>;
  const items = regions.flatMap((region) => region.items ?? []);
  const missing = items.filter((item) => !item.categoryName);
  if (!missing.length) return summaries;
  const categories = await itemCategoryIds(missing.map((item) => item.typeId));
  for (const item of missing) {
    item.categoryId = categories.get(item.typeId) ?? 0;
    item.categoryName = itemCategoryName(item.categoryId);
  }
  return summaries;
}
