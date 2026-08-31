import { getContractMarketIntelligence } from "./market-intelligence";
import { loadPersistedResult, savePersistedResult } from "./persistent-result-cache";
import { loadCurrentSharedMarketManifest } from "./shared-market-data";

type SecurityKey = "high" | "low" | "null" | "unknown";
type SearchQuery = {
  itemSearch?: string;
  regionId?: string | number;
  locationSearch?: string;
  contractType?: string;
  category?: string;
  availability?: string;
  issuerSearch?: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  excludeMultiple?: boolean;
  exactType?: boolean;
  cleanOnly?: boolean;
  security?: Partial<Record<SecurityKey, boolean>>;
  limit?: number;
};

type RequestMessage =
  | { id: string; type: "workspace" }
  | { id: string; type: "search"; query?: SearchQuery }
  | { id: string; type: "detail"; contractId: number };

type ContractData = Awaited<ReturnType<typeof getContractMarketIntelligence>>;
type ContractRow = ContractData["contracts"][number];

type SearchIndexRow = {
  row: ContractRow;
  itemText: string;
  itemNames: string[];
  categories: Set<string>;
  locationText: string;
  issuerText: string;
};

let activeKey = "";
let activeData: ContractData | null = null;
let searchIndex: SearchIndexRow[] = [];
let contractById = new Map<number, ContractRow>();
let workspaceOptions: null | {
  regions: Array<{ id: number; name: string }>;
  categories: string[];
  contractTypes: string[];
  availabilities: string[];
} = null;

function send(message: unknown) {
  process.send?.(message);
}

function progress(id: string, percent: number, message: string) {
  send({ type: "progress", id, percent, message });
}

async function cacheKey() {
  const manifest = await loadCurrentSharedMarketManifest() as any;
  if (!manifest) throw new Error("No server-prepared public data is installed. Check Data Control for the latest public generation first.");
  const value = {
    schema: 2,
    generation: String(manifest.generation ?? "none"),
    contractsVersion: String(manifest.files?.["public-contracts"]?.version ?? "none"),
    marketVersion: String(manifest.files?.["market-global"]?.version ?? "none"),
  };
  return { value, serialized: JSON.stringify(value) };
}

function buildSearchIndex(data: ContractData) {
  const regionMap = new Map<number, string>();
  const categorySet = new Set<string>();
  const contractTypeSet = new Set<string>(["item_exchange", "auction"]);
  const availabilitySet = new Set<string>();

  contractById = new Map(data.contracts.map((row) => [row.contractId, row]));
  searchIndex = data.contracts.map((row) => {
    regionMap.set(row.regionId, row.regionName);
    contractTypeSet.add(row.contractType || "item_exchange");
    availabilitySet.add(row.availability || "public");
    const itemNames: string[] = [];
    const itemParts: string[] = [String(row.contractId), row.title || ""];
    const categories = new Set<string>();
    for (const item of row.items) {
      const name = String(item.typeName ?? "").toLowerCase();
      itemNames.push(name);
      itemParts.push(item.typeName ?? "", item.categoryName ?? "", item.groupName ?? "", item.marketGroup ?? "");
      const category = item.categoryName || "Other";
      categories.add(category);
      categorySet.add(category);
    }
    return {
      row,
      itemText: itemParts.join(" ").toLowerCase(),
      itemNames,
      categories,
      locationText: `${row.regionName} ${row.systemName} ${row.station}`.toLowerCase(),
      issuerText: `${row.issuerName ?? ""} ${row.issuerId ?? ""} ${row.issuerCorporationName ?? ""} ${row.issuerCorporationId ?? ""}`.toLowerCase(),
    };
  });

  workspaceOptions = {
    regions: [...regionMap.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    categories: [...categorySet].sort((a, b) => a.localeCompare(b)),
    contractTypes: [...contractTypeSet].sort(),
    availabilities: [...availabilitySet].sort(),
  };
}

async function ensureData(id: string) {
  const key = await cacheKey();
  if (activeData && activeKey === key.serialized) return activeData;

  progress(id, 8, "Preparing server data…");
  let data = await loadPersistedResult<ContractData>("contract-market-intelligence", key.value);
  if (!data) {
    progress(id, 18, "Preparing server data…");
    data = await getContractMarketIntelligence();
    progress(id, 82, "Preparing server data…");
    await savePersistedResult("contract-market-intelligence", key.value, data);
  }

  progress(id, 90, "Preparing server data…");
  activeData = data;
  activeKey = key.serialized;
  buildSearchIndex(data);
  progress(id, 100, "Contract data ready.");
  return data;
}

function securityKey(row: ContractRow): SecurityKey {
  return row.securityBand ?? "unknown";
}

function searchRow(row: ContractRow) {
  const included = row.items.filter((item) => item.included);
  const preview = included.slice(0, 2).map((item) => `${item.quantity}× ${item.typeName}`).join(" + ");
  return {
    contractId: row.contractId, title: row.title, regionName: row.regionName, systemName: row.systemName, station: row.station,
    expires: row.expires, price: row.price, volume: row.volume, securityBand: row.securityBand, contractType: row.contractType,
    issuerName: row.issuerName, cleanSale: row.cleanSale, receivedItemCount: row.receivedItemCount, requestedItemCount: row.requestedItemCount,
    haulVolumeM3: row.haulVolumeM3, itemSummary: preview + (row.receivedItemCount > 2 ? ` + ${row.receivedItemCount - 2} more` : ""),
  };
}

function search(query: SearchQuery = {}) {
  const itemNeedle = String(query.itemSearch ?? "").trim().toLowerCase();
  const locationNeedle = String(query.locationSearch ?? "").trim().toLowerCase();
  const issuerNeedle = String(query.issuerSearch ?? "").trim().toLowerCase();
  const regionId = query.regionId == null || query.regionId === "all" ? null : Number(query.regionId);
  const contractType = String(query.contractType ?? "all");
  const category = String(query.category ?? "all");
  const availability = String(query.availability ?? "all");
  const minPrice = Number.isFinite(query.minPrice) ? Number(query.minPrice) : null;
  const maxPrice = Number.isFinite(query.maxPrice) ? Number(query.maxPrice) : null;
  const security = query.security ?? { high: true, low: true, null: true, unknown: true };
  const limit = Math.max(1, Math.min(800, Math.floor(Number(query.limit ?? 800))));
  const rows: ReturnType<typeof searchRow>[] = [];
  let total = 0;

  for (const indexed of searchIndex) {
    const row = indexed.row;
    if (itemNeedle) {
      const itemMatch = query.exactType ? indexed.itemNames.some((name) => name === itemNeedle) : indexed.itemText.includes(itemNeedle);
      if (!itemMatch) continue;
    }
    if (locationNeedle && !indexed.locationText.includes(locationNeedle)) continue;
    if (issuerNeedle && !indexed.issuerText.includes(issuerNeedle)) continue;
    if (regionId != null && row.regionId !== regionId) continue;
    if (contractType !== "all" && (row.contractType || "item_exchange") !== contractType) continue;
    if (category !== "all" && !indexed.categories.has(category)) continue;
    if (availability !== "all" && (row.availability || "public") !== availability) continue;
    if (security[securityKey(row)] === false) continue;
    if (query.excludeMultiple && row.receivedItemCount + row.requestedItemCount > 1) continue;
    if (query.cleanOnly && !row.cleanSale) continue;
    if (minPrice != null && row.price < minPrice) continue;
    if (maxPrice != null && row.price > maxPrice) continue;
    total += 1;
    if (rows.length < limit) rows.push(searchRow(row));
  }
  return { total, rows };
}

function recommendedExit(row: ContractRow) {
  const immediate = row.immediateProfit == null ? null : { profit: row.immediateProfit, roi: row.immediateRoiPercent };
  const haul = row.bestBuyProfit == null ? null : { profit: row.bestBuyProfit, roi: row.bestBuyRoiPercent };
  if (immediate && immediate.profit > 0) return immediate;
  if (haul && haul.profit > 0) return haul;
  return immediate ?? haul;
}

async function handle(message: RequestMessage) {
  const data = await ensureData(message.id);
  if (message.type === "search") return search(message.query);
  if (message.type === "detail") return contractById.get(Number(message.contractId)) ?? null;
  const initialSearch = search({ limit: 800 });
  const topProfit = Math.max(0, ...data.opportunities.map((row) => recommendedExit(row)?.profit ?? 0));
  const roiValues = data.opportunities.map((row) => recommendedExit(row)?.roi).filter((value): value is number => Number.isFinite(value) && value! > 0);
  const averageRoi = roiValues.length ? roiValues.reduce((sum, value) => sum + value, 0) / roiValues.length : 0;
  return {
    generatedAt: data.generatedAt,
    contractsCreatedAt: data.contractsCreatedAt,
    marketCreatedAt: data.marketCreatedAt,
    counts: data.counts,
    opportunities: data.opportunities,
    options: workspaceOptions!,
    topProfit,
    averageRoi,
    search: initialSearch,
  };
}

process.on("message", (raw) => {
  const message = raw as RequestMessage;
  if (!message?.id || (message.type !== "workspace" && message.type !== "search" && message.type !== "detail")) return;
  void handle(message).then(
    (result) => send({ type: "result", id: message.id, result }),
    (error) => send({ type: "error", id: message.id, error: error instanceof Error ? error.message : String(error) }),
  );
});
