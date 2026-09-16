import { loadSharedPublicContractsDataset } from "./shared-market-data";
import { getNavigationSystem, searchNavigationSystems, universeRoute } from "./universe-route-graph";

export type McpContractBlueprintKind = "all" | "bpo" | "bpc" | "any-blueprint" | "non-blueprint";
export type McpContractSort = "distance" | "price-low" | "price-high" | "newest" | "expiry";

export type McpContractSearchInput = {
  query?: string;
  typeId?: number;
  blueprintKind?: McpContractBlueprintKind;
  fullyResearched?: boolean;
  materialEfficiency?: number | null;
  timeEfficiency?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  regionId?: number | null;
  systemQuery?: string;
  locationQuery?: string;
  contractType?: string;
  standaloneOnly?: boolean;
  originSystem?: string;
  originSystemId?: number | null;
  maxJumps?: number | null;
  sort?: McpContractSort;
  offset?: number;
  limit?: number;
};

type ContractItem = {
  typeId?: number;
  typeName?: string;
  included?: boolean;
  isBlueprintCopy?: boolean;
  runs?: number;
  materialEfficiency?: number;
  timeEfficiency?: number;
  [key: string]: unknown;
};

type ContractRow = {
  contractId?: number;
  title?: string;
  price?: number;
  expires?: string;
  startLocationId?: number;
  startLocationName?: string;
  systemId?: number;
  systemName?: string;
  contractType?: string;
  dateIssued?: string;
  itemsPending?: boolean;
  items?: ContractItem[];
  [key: string]: unknown;
};

function finiteNumber(value: unknown) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function contractItemBlueprintKind(item: ContractItem): Exclude<McpContractBlueprintKind, "all" | "any-blueprint"> {
  const hasBlueprintStats = item.materialEfficiency != null || item.timeEfficiency != null || item.runs != null;
  if (!hasBlueprintStats && item.isBlueprintCopy == null) return "non-blueprint";
  return item.isBlueprintCopy === true ? "bpc" : "bpo";
}

function itemMatches(item: ContractItem, input: McpContractSearchInput, query: string) {
  if (item.included === false) return false;
  if (input.typeId != null && Number(item.typeId) !== Number(input.typeId)) return false;
  if (query && !String(item.typeName ?? "").toLowerCase().includes(query)) return false;

  const kind = contractItemBlueprintKind(item);
  const requestedKind = input.blueprintKind ?? "all";
  if (requestedKind === "bpo" && kind !== "bpo") return false;
  if (requestedKind === "bpc" && kind !== "bpc") return false;
  if (requestedKind === "any-blueprint" && kind === "non-blueprint") return false;
  if (requestedKind === "non-blueprint" && kind !== "non-blueprint") return false;

  const requestedMe = input.fullyResearched ? 10 : finiteNumber(input.materialEfficiency);
  const requestedTe = input.fullyResearched ? 20 : finiteNumber(input.timeEfficiency);
  if (requestedMe != null && finiteNumber(item.materialEfficiency) !== requestedMe) return false;
  if (requestedTe != null && finiteNumber(item.timeEfficiency) !== requestedTe) return false;
  return true;
}

async function resolveOrigin(input: McpContractSearchInput) {
  if (input.originSystemId != null) {
    const system = await getNavigationSystem(Number(input.originSystemId));
    return system ? { systemId: system.systemId, name: system.name } : null;
  }
  const requested = String(input.originSystem ?? "").trim();
  if (!requested) return null;
  const matches = await searchNavigationSystems(requested, 20);
  const exact = matches.find((system) => system.name.toLowerCase() === requested.toLowerCase());
  const system = exact ?? (matches.length === 1 ? matches[0] : null);
  return system ? { systemId: system.systemId, name: system.name } : null;
}

function sortRows(rows: any[], sort: McpContractSort) {
  const copy = [...rows];
  if (sort === "price-low") return copy.sort((a, b) => a.price - b.price || a.jumpsFromOrigin - b.jumpsFromOrigin || a.contractId - b.contractId);
  if (sort === "price-high") return copy.sort((a, b) => b.price - a.price || a.jumpsFromOrigin - b.jumpsFromOrigin || a.contractId - b.contractId);
  if (sort === "newest") return copy.sort((a, b) => Date.parse(b.dateIssued || "") - Date.parse(a.dateIssued || "") || a.price - b.price);
  if (sort === "expiry") return copy.sort((a, b) => Date.parse(a.expires || "") - Date.parse(b.expires || "") || a.price - b.price);
  return copy.sort((a, b) => a.jumpsFromOrigin - b.jumpsFromOrigin || a.price - b.price || a.contractId - b.contractId);
}

export async function searchMcpContracts(input: McpContractSearchInput) {
  const dataset = await loadSharedPublicContractsDataset();
  if (!dataset) return { available: false, message: "No Sage public-contract dataset is installed.", contracts: [] };

  const query = String(input.query ?? "").trim().toLowerCase();
  if (!query && input.typeId == null) {
    return {
      available: true,
      snapshot: { id: dataset.snapshotId, createdAt: dataset.createdAt, contractCount: dataset.contractCount, pendingDetailCount: dataset.pendingDetailCount },
      message: "Search for an item name or provide typeId.",
      contracts: [],
    };
  }

  const originRequested = input.originSystemId != null || Boolean(String(input.originSystem ?? "").trim());
  const origin = await resolveOrigin(input);
  if (originRequested && !origin) {
    return {
      available: true,
      snapshot: { id: dataset.snapshotId, createdAt: dataset.createdAt, contractCount: dataset.contractCount, pendingDetailCount: dataset.pendingDetailCount },
      message: `Could not resolve origin system ${input.originSystem ?? input.originSystemId}.`,
      contracts: [],
    };
  }

  const minPrice = finiteNumber(input.minPrice);
  const maxPrice = finiteNumber(input.maxPrice);
  const regionId = finiteNumber(input.regionId);
  const maxJumps = finiteNumber(input.maxJumps);
  const systemQuery = String(input.systemQuery ?? "").trim().toLowerCase();
  const locationQuery = String(input.locationQuery ?? "").trim().toLowerCase();
  const contractType = String(input.contractType ?? "").trim().toLowerCase();
  const jumpCache = new Map<number, { jumps: number; minimumSecurityStatus: number }>();
  const rows: any[] = [];

  for (const region of dataset.regions) {
    if (regionId != null && Number(region.regionId) !== regionId) continue;
    for (const contract of region.publicContracts as ContractRow[]) {
      const price = Number(contract.price ?? 0);
      if (minPrice != null && price < minPrice) continue;
      if (maxPrice != null && price > maxPrice) continue;
      if (contractType && String(contract.contractType ?? "").toLowerCase() !== contractType) continue;
      if (systemQuery && !String(contract.systemName ?? "").toLowerCase().includes(systemQuery)) continue;
      if (locationQuery && !String(contract.startLocationName ?? "").toLowerCase().includes(locationQuery)) continue;

      const includedItems = (Array.isArray(contract.items) ? contract.items : []).filter((item) => item.included !== false);
      if (input.standaloneOnly === true && includedItems.length !== 1) continue;
      const matchedItems = includedItems
        .filter((item) => itemMatches(item, input, query))
        .map((item) => ({ ...item, blueprintKind: contractItemBlueprintKind(item) }));
      if (!matchedItems.length) continue;

      let jumpsFromOrigin: number | null = null;
      let minimumSecurityStatusFromOrigin: number | null = null;
      const systemId = Number(contract.systemId ?? 0);
      if (origin && systemId > 0) {
        let route = jumpCache.get(systemId);
        if (!route) {
          route = await universeRoute(origin.systemId, systemId);
          jumpCache.set(systemId, route);
        }
        jumpsFromOrigin = route.jumps >= 999 ? null : route.jumps;
        minimumSecurityStatusFromOrigin = route.jumps >= 999 ? null : route.minimumSecurityStatus;
      }
      if (maxJumps != null && (jumpsFromOrigin == null || jumpsFromOrigin > maxJumps)) continue;

      rows.push({
        contractId: Number(contract.contractId),
        title: String(contract.title ?? "Untitled contract"),
        price,
        expires: String(contract.expires ?? ""),
        dateIssued: String(contract.dateIssued ?? ""),
        contractType: String(contract.contractType ?? ""),
        regionId: Number(region.regionId),
        regionName: String(region.regionName),
        systemId: systemId || null,
        systemName: String(contract.systemName ?? "Unresolved public structure"),
        startLocationId: finiteNumber(contract.startLocationId),
        startLocationName: String(contract.startLocationName ?? ""),
        itemsPending: contract.itemsPending === true,
        jumpsFromOrigin,
        minimumSecurityStatusFromOrigin,
        includedItemCount: includedItems.length,
        otherIncludedItems: includedItems.filter((item) => !itemMatches(item, input, query)).map((item) => ({ typeId: item.typeId, typeName: item.typeName, quantity: item.quantity, blueprintKind: contractItemBlueprintKind(item) })),
        matchedItems,
      });
    }
  }

  // Null/unknown distances sort after known routes.
  for (const row of rows) if (row.jumpsFromOrigin == null) row.jumpsFromOrigin = Number.POSITIVE_INFINITY;
  const sort = input.sort ?? (origin ? "distance" : "price-low");
  const sorted = sortRows(rows, sort);
  const offset = Math.max(0, Math.min(sorted.length, Math.floor(Number(input.offset ?? 0) || 0)));
  const limit = Math.max(1, Math.min(500, Math.floor(Number(input.limit ?? 100) || 100)));
  const page = sorted.slice(offset, offset + limit).map((row) => ({ ...row, jumpsFromOrigin: Number.isFinite(row.jumpsFromOrigin) ? row.jumpsFromOrigin : null }));

  return {
    available: true,
    snapshot: { id: dataset.snapshotId, createdAt: dataset.createdAt, contractCount: dataset.contractCount, pendingDetailCount: dataset.pendingDetailCount },
    coverage: {
      completeContractCoverage: true,
      itemDetailsPending: dataset.pendingDetailCount,
      note: dataset.pendingDetailCount
        ? `${dataset.pendingDetailCount} contracts are still awaiting CCP item-detail enrichment and cannot be matched by item/blueprint filters yet.`
        : "All public contracts in the installed Sage snapshot have item details available for item/blueprint filtering.",
    },
    query: String(input.query ?? "").trim(),
    origin,
    filters: {
      typeId: input.typeId ?? null,
      blueprintKind: input.blueprintKind ?? "all",
      fullyResearched: input.fullyResearched === true,
      materialEfficiency: input.fullyResearched ? 10 : finiteNumber(input.materialEfficiency),
      timeEfficiency: input.fullyResearched ? 20 : finiteNumber(input.timeEfficiency),
      minPrice,
      maxPrice,
      regionId,
      systemQuery: String(input.systemQuery ?? ""),
      locationQuery: String(input.locationQuery ?? ""),
      contractType: String(input.contractType ?? ""),
      standaloneOnly: input.standaloneOnly === true,
      maxJumps,
      sort,
    },
    totalMatches: sorted.length,
    offset,
    limit,
    contracts: page,
  };
}
