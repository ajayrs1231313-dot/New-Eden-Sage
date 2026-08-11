import { dialog, ipcMain } from "electron";
import { promises as fs } from "node:fs";
import ExcelJS from "exceljs";
import { loadRecentMarketDatasetsByMode } from "./market-storage";
import { getMarketTypeIndex } from "./market-static-index";

export type MarketItemHistoryPoint = {
  createdAt: string;
  regionId: number;
  region: string;
  bestBuy: number | null;
  bestSell: number | null;
  spreadPercent: number | null;
  buyOrders: number;
  sellOrders: number;
  buyVolume: number;
  sellVolume: number;
};

type StoredItem = {
  typeId: number;
  typeName: string;
  buyOrderCount?: number;
  sellOrderCount?: number;
  buyVolume?: number;
  sellVolume?: number;
  bestBuy?: number | null;
  bestSell?: number | null;
  spreadPercent?: number | null;
};

type StoredRegion = {
  regionId: number;
  regionName: string;
  items?: StoredItem[];
};

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function point(createdAt: string, region: StoredRegion, item: StoredItem): MarketItemHistoryPoint {
  const bestBuy = finite(item.bestBuy);
  const bestSell = finite(item.bestSell);
  const spread = finite(item.spreadPercent) ?? (bestBuy != null && bestSell != null && bestSell > 0 ? ((bestSell - bestBuy) / bestSell) * 100 : null);
  return {
    createdAt,
    regionId: region.regionId,
    region: region.regionName,
    bestBuy,
    bestSell,
    spreadPercent: spread,
    buyOrders: Number(item.buyOrderCount ?? 0),
    sellOrders: Number(item.sellOrderCount ?? 0),
    buyVolume: Number(item.buyVolume ?? 0),
    sellVolume: Number(item.sellVolume ?? 0),
  };
}

async function itemHistory(typeId: number) {
  if (!Number.isInteger(typeId) || typeId <= 0) throw new Error("Choose a valid market item first.");
  const [datasets, typeIndex] = await Promise.all([
    loadRecentMarketDatasetsByMode("all", 24),
    getMarketTypeIndex(),
  ]);
  const meta = typeIndex.get(typeId);
  if (!meta) throw new Error(`Type ${typeId} is not present in the market taxonomy.`);
  const snapshots = datasets.map((dataset) => {
    const rows: MarketItemHistoryPoint[] = [];
    for (const region of dataset.summaries as StoredRegion[]) {
      const item = region.items?.find((candidate) => candidate.typeId === typeId);
      if (item) rows.push(point(dataset.createdAt, region, item));
    }
    rows.sort((a, b) => a.region.localeCompare(b.region));
    return { createdAt: dataset.createdAt, rows };
  }).filter((snapshot) => snapshot.rows.length > 0);
  return {
    typeId,
    item: meta.name,
    category: meta.categoryName,
    group: meta.groupName,
    marketGroup: meta.marketGroupPathLabel,
    snapshotCount: snapshots.length,
    snapshots,
  };
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

ipcMain.handle("market:item-history", async (_event, typeId: number) => itemHistory(Number(typeId)));

ipcMain.handle("market:regional-export", async (_event, format: "csv" | "json" | "xlsx", rows: Array<Record<string, unknown>>, itemName?: string) => {
  const safe = String(itemName ?? "regional-market").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "regional-market";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const result = await dialog.showSaveDialog({
    title: "Export regional market intelligence",
    defaultPath: `new-eden-sage-${safe}-${stamp}.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (result.canceled || !result.filePath) return null;
  if (format === "json") {
    await fs.writeFile(result.filePath, JSON.stringify(rows, null, 2), "utf8");
    return result.filePath;
  }
  const keys = rows.length ? Object.keys(rows[0]) : [];
  if (format === "csv") {
    const content = [keys, ...rows.map((row) => keys.map((key) => row[key]))]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    await fs.writeFile(result.filePath, `${content}\r\n`, "utf8");
    return result.filePath;
  }
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Regional Market");
  sheet.addRow(keys);
  for (const row of rows) sheet.addRow(keys.map((key) => row[key]));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  if (keys.length) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: keys.length } };
    sheet.columns = keys.map((key) => ({ key, width: Math.max(12, Math.min(28, key.length + 4)) }));
  }
  await workbook.xlsx.writeFile(result.filePath);
  return result.filePath;
});
