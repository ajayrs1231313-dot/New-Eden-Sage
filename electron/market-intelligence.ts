import { loadLatestMarketDatasetByMode } from "./market-storage";
import { buildFullMarketAnalysisIndex } from "./raw-market-analysis";
import type { PublicContract } from "./market";
import {
  getMarketSystemIndex,
  getMarketTypeIndex,
  type MarketSystemEntry,
} from "./market-static-index";

type RetainedOrder = {
  orderId: number;
  price: number;
  volumeRemain: number;
  locationId: number;
  locationName: string;
  systemId: number;
  systemName: string;
  issued: string;
  minVolume?: number;
  range?: string;
  durationDays?: number;
};

type MarketItemLike = {
  typeId: number;
  typeName: string;
  bestBuy: number | null;
  bestSell: number | null;
  topBuyOrders?: RetainedOrder[];
  topSellOrders?: RetainedOrder[];
};

type RegionSummaryLike = {
  regionId: number;
  regionName: string;
  items?: MarketItemLike[];
  publicContracts?: PublicContract[];
};

type IndexedOrder = RetainedOrder & { regionId: number; regionName: string };
type SecurityBand = "high" | "low" | "null" | null;

type FillResult = {
  gross: number;
  units: number;
  remaining: number;
  fills: Array<{
    orderId: number;
    units: number;
    price: number;
    systemId: number;
    systemName: string;
    locationId: number;
    locationName: string;
    regionId: number;
    range: string;
  }>;
};

type ExitItem = { typeId: number; quantity: number; orders: IndexedOrder[] };

export type GlobalMarketQuote = {
  typeId: number;
  typeName: string;
  bestBuy: number | null;
  bestSell: number | null;
  bestBuySystem: string | null;
  bestSellSystem: string | null;
  buyOrders: IndexedOrder[];
  sellOrders: IndexedOrder[];
};

export type ExecutableBuyExit = {
  systemId: number;
  systemName: string;
  regionId: number;
  securityBand: SecurityBand;
  gross: number;
  coveredUnits: number;
  totalUnits: number;
  locationCount: number;
  usesPlayerStructure: boolean;
};

const PLAYER_STRUCTURE_ID_MIN = 1_000_000_000_000;
const POCHVEN_REGION_ID = 10000070;
const ZARZAKH_SYSTEM_ID = 30100000;

function dedupeOrders(rows: IndexedOrder[], side: "buy" | "sell") {
  const seen = new Set<number>();
  return rows
    .filter((row) => !seen.has(row.orderId) && seen.add(row.orderId))
    .sort((a, b) => (side === "buy" ? b.price - a.price : a.price - b.price))
    .slice(0, 80);
}

export async function loadGlobalMarketQuotes(typeIds?: number[]) {
  const dataset = await buildFullMarketAnalysisIndex();
  const wanted = typeIds?.length ? new Set(typeIds.map(Number)) : null;
  const quotes: GlobalMarketQuote[] = [];
  for (const item of dataset.items.values()) {
    if (wanted && !wanted.has(item.typeId)) continue;
    const buyOrders = dedupeOrders(item.buys.map((order) => ({ ...order })), "buy");
    const sellOrders = dedupeOrders(item.sells.map((order) => ({ ...order })), "sell");
    quotes.push({
      typeId: item.typeId,
      typeName: item.typeName,
      bestBuy: buyOrders[0]?.price ?? null,
      bestSell: sellOrders[0]?.price ?? null,
      bestBuySystem: buyOrders[0]?.systemName ?? null,
      bestSellSystem: sellOrders[0]?.systemName ?? null,
      buyOrders,
      sellOrders,
    });
  }
  return { createdAt: dataset.createdAt, quotes };
}

function fillOrders(quantity: number, orders: IndexedOrder[], predicate: (row: IndexedOrder) => boolean): FillResult {
  let remaining = Math.max(0, Math.floor(quantity));
  let gross = 0;
  let units = 0;
  const fills: FillResult["fills"] = [];

  for (const order of orders) {
    if (remaining <= 0) break;
    if (!predicate(order)) continue;
    const minimum = Math.max(1, Number(order.minVolume ?? 1));
    if (remaining < minimum) continue;
    const take = Math.min(remaining, Math.max(0, Math.floor(order.volumeRemain)));
    if (take < minimum) continue;
    gross += take * order.price;
    units += take;
    remaining -= take;
    fills.push({
      orderId: order.orderId,
      units: take,
      price: order.price,
      systemId: order.systemId,
      systemName: order.systemName,
      locationId: order.locationId,
      locationName: order.locationName,
      regionId: order.regionId,
      range: String(order.range ?? "station"),
    });
  }

  return { gross, units, remaining, fills };
}

function quoteSellCost(quantity: number, quote: GlobalMarketQuote | undefined) {
  if (!quote) return { gross: 0, units: 0, remaining: quantity };
  return fillOrders(quantity, quote.sellOrders, () => true);
}

function immediateAtContract(order: IndexedOrder, contract: PublicContract, regionId: number) {
  if (order.locationId === contract.startLocationId) return true;
  const range = String(order.range ?? "station").toLowerCase();
  if (range === "station") return false;
  // Any non-station range includes the order's own solar system. This also
  // fixes numeric ESI ranges (1, 5, 10, etc.) for same-system execution.
  if (contract.systemId > 0 && order.systemId === contract.systemId) return true;
  if (range === "region" && order.regionId === regionId) return true;
  // Numeric jump-range coverage outside the order system is deliberately not
  // guessed here; treating it as unavailable is conservative, never optimistic.
  return false;
}

function orderExecutableAtSystem(order: IndexedOrder, system: { systemId: number; regionId: number }) {
  if (order.systemId === system.systemId) return true;
  const range = String(order.range ?? "station").toLowerCase();
  if (range === "region" && order.regionId === system.regionId) return true;
  return false;
}

export function standardCapitalDestinationEligible(system: MarketSystemEntry | undefined) {
  return Boolean(
    system &&
      system.systemId >= 30_000_000 &&
      system.systemId < 31_000_000 &&
      system.regionId !== POCHVEN_REGION_ID &&
      system.systemId !== ZARZAKH_SYSTEM_ID &&
      system.securityBand !== "high",
  );
}

export function evaluateBestSingleSystemBuyExit(
  items: ExitItem[],
  systemIndex: Map<number, MarketSystemEntry>,
  options: { capitalRequired?: boolean } = {},
): ExecutableBuyExit | null {
  if (!items.length) return null;

  const candidateIds = new Set<number>();
  for (const item of items) for (const order of item.orders) if (order.systemId > 0) candidateIds.add(order.systemId);

  let best: ExecutableBuyExit | null = null;
  for (const systemId of candidateIds) {
    const known = systemIndex.get(systemId);
    const exemplar = items.flatMap((item) => item.orders).find((order) => order.systemId === systemId);
    if (!known && !exemplar) continue;
    if (options.capitalRequired && !standardCapitalDestinationEligible(known)) continue;

    const target = {
      systemId,
      regionId: known?.regionId ?? exemplar!.regionId,
    };
    let gross = 0;
    let coveredUnits = 0;
    let totalUnits = 0;
    let fullyCovered = true;
    const locations = new Set<number>();
    let usesPlayerStructure = false;

    for (const item of items) {
      totalUnits += item.quantity;
      const fill = fillOrders(item.quantity, item.orders, (order) => orderExecutableAtSystem(order, target));
      if (fill.remaining > 0) {
        fullyCovered = false;
        break;
      }
      gross += fill.gross;
      coveredUnits += fill.units;
      for (const filled of fill.fills) {
        // Non-station range orders can be sold from the chosen destination system;
        // only station-range orders force a distinct physical delivery location.
        if (String(filled.range).toLowerCase() === "station") {
          locations.add(filled.locationId);
          if (filled.locationId >= PLAYER_STRUCTURE_ID_MIN) usesPlayerStructure = true;
        }
      }
    }

    if (!fullyCovered || coveredUnits !== totalUnits) continue;
    const candidate: ExecutableBuyExit = {
      systemId,
      systemName: known?.name ?? exemplar!.systemName,
      regionId: target.regionId,
      securityBand: known?.securityBand ?? null,
      gross,
      coveredUnits,
      totalUnits,
      locationCount: Math.max(1, locations.size),
      usesPlayerStructure,
    };
    if (!best || candidate.gross > best.gross) best = candidate;
  }

  return best;
}

export type ContractOpportunity = {
  contractId: number;
  title: string;
  regionId: number;
  regionName: string;
  systemId: number;
  systemName: string;
  station: string;
  expires: string;
  price: number;
  volume: number;
  securityStatus: number | null;
  securityBand: SecurityBand;
  originResolved: boolean;
  contractType: string;
  availability: string;
  dateIssued: string;
  issuerId: number | null;
  issuerName: string | null;
  issuerCorporationId: number | null;
  issuerCorporationName: string | null;
  forCorporation: boolean;
  buyout: number | null;
  items: Array<{
    typeId: number;
    typeName: string;
    categoryId: number;
    categoryName: string;
    groupName: string;
    marketGroup: string;
    quantity: number;
    included: boolean;
    bestBuy: number | null;
    bestSell: number | null;
    isBlueprintCopy?: boolean;
    runs?: number;
    isSingleton?: boolean;
    marketLiquidatable: boolean;
    recoverableForResale: boolean;
    valuationNote?: string;
  }>;
  cleanSale: boolean;
  receivedItemCount: number;
  requestedItemCount: number;
  immediateGross: number;
  immediateCoveredUnits: number;
  immediateTotalUnits: number;
  immediateProfit: number | null;
  immediateRoiPercent: number | null;
  bestBuyGross: number;
  bestBuyProfit: number | null;
  bestBuyRoiPercent: number | null;
  bestBuySystemId: number | null;
  bestBuySystem: string | null;
  bestBuySecurityBand: SecurityBand;
  bestBuyUsesPlayerStructure: boolean;
  bestBuyLocationCount: number;
  sellOrderGross: number;
  sellOrderProfit: number | null;
  sellOrderRoiPercent: number | null;
  requestedItemCost: number;
  requestedItemsFullyPriced: boolean;
  nonRecoverableRigCount: number;
  haulVolumeM3: number;
  haulCargoVolumeM3: number;
  pilotRequiredShips: Array<{
    typeId: number;
    typeName: string;
    quantity: number;
    groupName: string;
    packagedVolumeM3: number;
    capital: boolean;
  }>;
  capitalRouteRequired: boolean;
  capitalOriginUnverified: boolean;
  score: number;
  opportunity: boolean;
  note: string;
};

export async function getContractMarketIntelligence() {
  const [contractsDataset, market, systemIndex, typeIndex] = await Promise.all([
    loadLatestMarketDatasetByMode("contracts"),
    loadGlobalMarketQuotes(),
    getMarketSystemIndex(),
    getMarketTypeIndex(),
  ]);

  const quoteById = new Map(market.quotes.map((quote) => [quote.typeId, quote]));
  // Public contract ESI does not resolve player structures without character
  // access. If that structure also appears in retained market orders, we can
  // recover its solar system locally without another ESI request.
  const marketLocationSystem = new Map<number, { systemId: number; systemName: string }>();
  for (const quote of market.quotes) {
    for (const order of [...quote.buyOrders, ...quote.sellOrders]) {
      if (order.locationId > 0 && order.systemId > 0 && !marketLocationSystem.has(order.locationId))
        marketLocationSystem.set(order.locationId, { systemId: order.systemId, systemName: order.systemName });
    }
  }

  const rows: ContractOpportunity[] = [];
  for (const region of (contractsDataset?.summaries ?? []) as RegionSummaryLike[]) {
    for (const originalContract of region.publicContracts ?? []) {
      const inferred = originalContract.systemId > 0 ? undefined : marketLocationSystem.get(originalContract.startLocationId);
      const resolvedSystemId = originalContract.systemId > 0 ? originalContract.systemId : (inferred?.systemId ?? 0);
      const resolvedSystemName = originalContract.systemId > 0
        ? originalContract.systemName
        : (inferred?.systemName ?? originalContract.systemName);
      const contract: PublicContract = {
        ...originalContract,
        systemId: resolvedSystemId,
        systemName: resolvedSystemName,
      };
      const contractSystem = systemIndex.get(resolvedSystemId);
      const securityStatus = contractSystem?.securityStatus ?? null;
      const securityBand = contractSystem?.securityBand ?? null;
      const originResolved = resolvedSystemId > 0 && Boolean(contractSystem);
      const received = contract.items.filter((item) => item.included);
      const requested = contract.items.filter((item) => !item.included);
      const receivedShipItems = received.filter((item) => typeIndex.get(Number(item.typeId))?.categoryName === "Ship");
      const hasExplicitAssembledShip = receivedShipItems.some((item) => item.isSingleton === true);
      const hasLegacyUnknownShip = receivedShipItems.some((item) => item.isSingleton == null);

      const isRigType = (typeId: number) => {
        const meta = typeIndex.get(Number(typeId));
        const group = String(meta?.groupName ?? "").toLowerCase();
        const marketPath = String(meta?.marketGroupPathLabel ?? "").toLowerCase();
        return (
          group.endsWith(" rig") ||
          group === "rig" ||
          marketPath.split(" â€º ").some((part) => part === "rig" || part === "rigs" || part.endsWith(" rigs"))
        );
      };

      const hasReceivedRig = received.some((item) => isRigType(item.typeId));
      const treatReceivedRigsAsFitted = hasExplicitAssembledShip || (hasLegacyUnknownShip && hasReceivedRig);
      const capitalPilotGroups = new Set([
        "Dreadnought",
        "Lancer Dreadnought",
        "Carrier",
        "Command Carrier",
        "Supercarrier",
        "Titan",
        "Force Auxiliary",
        "Capital Industrial Ship",
      ]);

      let nonRecoverableRigCount = 0;
      let haulVolumeM3 = 0;
      let haulCargoVolumeM3 = 0;
      const pilotRequiredShips: ContractOpportunity["pilotRequiredShips"] = [];
      let immediateGross = 0;
      let immediateCoveredUnits = 0;
      let immediateTotalUnits = 0;
      let sellOrderGross = 0;
      let sellOrderCoveredUnits = 0;
      let sellOrderTotalUnits = 0;
      let requestedItemCost = 0;
      let requestedItemsFullyPriced = true;
      const remoteExitItems: ExitItem[] = [];
      const itemRows: ContractOpportunity["items"] = [];

      for (const item of received) {
        const quote = quoteById.get(Number(item.typeId));
        const qty = Math.max(0, Math.floor(Number(item.quantity)));
        const isBlueprintCopy = item.isBlueprintCopy === true;
        const legacyBlueprintUnknown = item.isBlueprintCopy == null && / blueprint$/i.test(item.typeName);
        const typeMeta = typeIndex.get(Number(item.typeId));
        const fittedRig = treatReceivedRigsAsFitted && isRigType(item.typeId);
        const recoverableForResale = !fittedRig;
        if (fittedRig) nonRecoverableRigCount += qty;

        if (recoverableForResale) {
          const packagedVolumeM3 = Math.max(0, Number(typeMeta?.packagedVolumeM3 ?? typeMeta?.volumeM3 ?? 0));
          haulVolumeM3 += packagedVolumeM3 * qty;
          const oversizedShip = typeMeta?.categoryName === "Ship" && packagedVolumeM3 >= 1_300_000;
          if (oversizedShip) {
            pilotRequiredShips.push({
              typeId: item.typeId,
              typeName: item.typeName,
              quantity: qty,
              groupName: typeMeta?.groupName ?? "Ship",
              packagedVolumeM3,
              capital: capitalPilotGroups.has(typeMeta?.groupName ?? ""),
            });
          } else {
            haulCargoVolumeM3 += packagedVolumeM3 * qty;
          }
        }

        const marketLiquidatable = recoverableForResale && !isBlueprintCopy && !legacyBlueprintUnknown;
        if (marketLiquidatable) {
          immediateTotalUnits += qty;
          sellOrderTotalUnits += qty;
        }
        const local = marketLiquidatable && quote
          ? fillOrders(qty, quote.buyOrders, (order) => immediateAtContract(order, contract, region.regionId))
          : { gross: 0, units: 0, remaining: qty, fills: [] as FillResult["fills"] };
        const globalSell = marketLiquidatable && quote
          ? fillOrders(qty, quote.sellOrders, () => true)
          : { gross: 0, units: 0, remaining: qty, fills: [] as FillResult["fills"] };
        immediateGross += local.gross;
        immediateCoveredUnits += local.units;
        sellOrderGross += globalSell.gross;
        sellOrderCoveredUnits += globalSell.units;
        if (marketLiquidatable && quote) remoteExitItems.push({ typeId: item.typeId, quantity: qty, orders: quote.buyOrders });

        itemRows.push({
          typeId: item.typeId,
          typeName: item.typeName,
          categoryId: typeMeta?.categoryId ?? 0,
          categoryName: typeMeta?.categoryName ?? "Other",
          groupName: typeMeta?.groupName ?? "Unknown",
          marketGroup: typeMeta?.marketGroupPathLabel ?? "Unclassified",
          quantity: qty,
          included: true,
          bestBuy: marketLiquidatable ? (quote?.bestBuy ?? null) : null,
          bestSell: marketLiquidatable ? (quote?.bestSell ?? null) : null,
          isBlueprintCopy,
          runs: item.runs,
          isSingleton: item.isSingleton,
          marketLiquidatable,
          recoverableForResale,
          valuationNote: fittedRig ? "Fitted rig - destroyed if removed" : undefined,
        });
      }

      for (const item of requested) {
        const quote = quoteById.get(Number(item.typeId));
        const qty = Math.max(0, Math.floor(Number(item.quantity)));
        const requestedLiquidatable = item.isBlueprintCopy !== true && !(item.isBlueprintCopy == null && / blueprint$/i.test(item.typeName));
        const source = requestedLiquidatable ? quoteSellCost(qty, quote) : { gross: 0, units: 0, remaining: qty };
        requestedItemCost += source.gross;
        if (source.remaining > 0) requestedItemsFullyPriced = false;
        const typeMeta = typeIndex.get(Number(item.typeId));
        itemRows.push({
          typeId: item.typeId,
          typeName: item.typeName,
          categoryId: typeMeta?.categoryId ?? 0,
          categoryName: typeMeta?.categoryName ?? "Other",
          groupName: typeMeta?.groupName ?? "Unknown",
          marketGroup: typeMeta?.marketGroupPathLabel ?? "Unclassified",
          quantity: qty,
          included: false,
          bestBuy: requestedLiquidatable ? (quote?.bestBuy ?? null) : null,
          bestSell: requestedLiquidatable ? (quote?.bestSell ?? null) : null,
          isBlueprintCopy: item.isBlueprintCopy === true,
          runs: item.runs,
          isSingleton: item.isSingleton,
          marketLiquidatable: requestedLiquidatable,
          recoverableForResale: true,
        });
      }

      const acquisitionCost = Number(contract.price) + requestedItemCost;
      const contractType = contract.contractType ?? "item_exchange";
      const profitEligible = contractType === "item_exchange";
      const cleanSale = requested.length === 0;
      const hasCapitalPilot = pilotRequiredShips.some((ship) => ship.capital);
      const requiresKeepstar = pilotRequiredShips.some((ship) => ship.groupName === "Titan" || ship.groupName === "Supercarrier");
      const capitalOriginKnownInvalid = hasCapitalPilot && originResolved && !standardCapitalDestinationEligible(contractSystem);
      const capitalOriginUnverified = hasCapitalPilot && !originResolved;
      const bestExit = capitalOriginKnownInvalid
        ? null
        : evaluateBestSingleSystemBuyExit(remoteExitItems, systemIndex, { capitalRequired: hasCapitalPilot });

      const immediateFullyCovered = immediateCoveredUnits >= immediateTotalUnits && immediateTotalUnits > 0;
      const immediateProfit = profitEligible && cleanSale && immediateFullyCovered ? immediateGross - acquisitionCost : null;
      const bestBuyGross = bestExit?.gross ?? 0;
      const bestBuyProfit = profitEligible && cleanSale && bestExit ? bestBuyGross - acquisitionCost : null;
      // Lowest sell orders are an indicative listing benchmark only. They are
      // not executable sale revenue, so they never drive opportunity ranking.
      const sellOrderFullyCovered = sellOrderCoveredUnits >= sellOrderTotalUnits && sellOrderTotalUnits > 0;
      const sellOrderProfit = profitEligible && cleanSale && sellOrderFullyCovered ? sellOrderGross - acquisitionCost : null;
      const roi = (profit: number | null) => (profit == null || acquisitionCost <= 0 ? null : (profit / acquisitionCost) * 100);
      const immediateRoiPercent = roi(immediateProfit);
      const bestBuyRoiPercent = roi(bestBuyProfit);
      const sellOrderRoiPercent = roi(sellOrderProfit);
      const strongest = Math.max(immediateProfit ?? Number.NEGATIVE_INFINITY, bestBuyProfit ?? Number.NEGATIVE_INFINITY);
      const strongestRoi = Math.max(immediateRoiPercent ?? Number.NEGATIVE_INFINITY, bestBuyRoiPercent ?? Number.NEGATIVE_INFINITY);
      const expired = Number.isFinite(Date.parse(contract.expires)) && Date.parse(contract.expires) <= Date.now();
      const opportunity = !requiresKeepstar && !expired && profitEligible && cleanSale && strongest >= 5_000_000 && strongestRoi >= 5;
      const score = opportunity
        ? Math.max(0, strongest / 1_000_000) + Math.max(0, strongestRoi) * 0.5 + (immediateProfit != null ? 25 : 0)
        : Math.max(0, strongest / 1_000_000);

      const pilotWarning = (pilotRequiredShips.length > 0
        ? `${pilotRequiredShips.map((ship) => `${ship.quantity}x ${ship.typeName}`).join(", ")} must be piloted; oversized hulls are excluded from normal cargo volume. `
        : "") + (requiresKeepstar
          ? "Supercapital docking/access requires a suitable Keepstar; automatic profit ranking is suppressed because retained market orders do not prove a usable Keepstar exit. "
          : "");
      const rigWarning = (nonRecoverableRigCount > 0
        ? `${nonRecoverableRigCount} fitted rig${nonRecoverableRigCount === 1 ? "" : "s"} excluded from resale value because removing fitted rigs destroys them. `
        : "") + pilotWarning;
      const originWarning = !originResolved
        ? "Contract origin system/access is unresolved from public ESI; verify the player structure location and docking access in EVE before committing. "
        : "";
      const structureWarning = bestExit?.usesPlayerStructure
        ? "The selected buy exit requires access to at least one player-owned market structure; docking/access is not guaranteed. "
        : "";
      const splitExitWarning = bestExit && bestExit.locationCount > 1
        ? "The exit requires split deliveries across " + bestExit.locationCount + " exact buy-order stations in " + bestExit.systemName + ". "
        : "";
      const capitalWarning = hasCapitalPilot && bestBuyProfit != null
        ? `${capitalOriginUnverified ? "Capital origin is unresolved, so the jump route cannot be validated yet. " : ""}Capital exits are restricted to low/null K-space destinations; jump fuel, cyno logistics and pilot skills are not deducted from profit. `
        : "";
      const preTaxWarning = (immediateProfit != null || bestBuyProfit != null)
        ? "Profit is before character sales tax and logistics costs. "
        : "";
      const recommendedExitKind = immediateProfit != null && immediateProfit > 0
        ? "immediate"
        : bestBuyProfit != null && bestBuyProfit > 0
          ? "haul"
          : null;
      const immediateHaulUplift = immediateProfit != null && bestBuyProfit != null && bestBuyProfit > immediateProfit
        ? bestBuyProfit - immediateProfit
        : null;
      const bestBuySystem = bestExit?.systemName ?? null;

      const note = !profitEligible
        ? rigWarning + "Auction contract; retained for search and excluded from automatic profit flags."
        : !cleanSale
          ? rigWarning + "Requires items from the accepter; shown in search but excluded from automatic profit flags."
          : recommendedExitKind === "immediate" && immediateHaulUplift != null && bestBuySystem
            ? rigWarning + originWarning + structureWarning + splitExitWarning + capitalWarning + preTaxWarning + `Profitable immediate exit is available here. ${bestBuySystem === contract.systemName ? `Move within ${bestBuySystem}` : hasCapitalPilot ? `Capital move to ${bestBuySystem}` : `Haul to ${bestBuySystem}`} for about ${Math.round(immediateHaulUplift).toLocaleString("en-GB")} ISK more.`
            : recommendedExitKind === "immediate"
              ? rigWarning + preTaxWarning + "Profitable immediate exit is fully covered by buy orders executable from the contract location."
              : recommendedExitKind === "haul"
                ? rigWarning + originWarning + structureWarning + splitExitWarning + capitalWarning + preTaxWarning + `Profit requires moving the complete contract to one executable destination${bestBuySystem ? `: ${bestBuySystem}` : ""}; no fully covered profitable local exit was found.`
                : rigWarning + (capitalOriginKnownInvalid
                  ? "This capital hull is in a location that is not eligible for a standard capital jump-drive exit. "
                  : "") + "No fully covered executable buy-order exit was found in the retained market snapshot.";

      rows.push({
        contractId: contract.contractId,
        title: contract.title || `Contract ${contract.contractId}`,
        regionId: region.regionId,
        regionName: region.regionName,
        systemId: resolvedSystemId,
        systemName: resolvedSystemName,
        station: contract.startLocationName,
        expires: contract.expires,
        price: Number(contract.price),
        volume: Number(contract.volume),
        securityStatus,
        securityBand,
        originResolved,
        contractType,
        availability: contract.availability ?? "public",
        dateIssued: contract.dateIssued ?? "",
        issuerId: contract.issuerId ?? null,
        issuerName: contract.issuerName ?? null,
        issuerCorporationId: contract.issuerCorporationId ?? null,
        issuerCorporationName: contract.issuerCorporationName ?? null,
        forCorporation: contract.forCorporation === true,
        buyout: contract.buyout ?? null,
        items: itemRows,
        cleanSale,
        receivedItemCount: received.length,
        requestedItemCount: requested.length,
        immediateGross,
        immediateCoveredUnits,
        immediateTotalUnits,
        immediateProfit,
        immediateRoiPercent,
        bestBuyGross,
        bestBuyProfit,
        bestBuyRoiPercent,
        bestBuySystemId: bestExit?.systemId ?? null,
        bestBuySystem,
        bestBuySecurityBand: bestExit?.securityBand ?? null,
        bestBuyUsesPlayerStructure: bestExit?.usesPlayerStructure ?? false,
        bestBuyLocationCount: bestExit?.locationCount ?? 0,
        sellOrderGross,
        sellOrderProfit,
        sellOrderRoiPercent,
        requestedItemCost,
        requestedItemsFullyPriced,
        nonRecoverableRigCount,
        haulVolumeM3,
        haulCargoVolumeM3,
        pilotRequiredShips,
        capitalRouteRequired: hasCapitalPilot && bestExit != null && bestExit.systemId !== resolvedSystemId,
        capitalOriginUnverified,
        score,
        opportunity,
        note,
      });
    }
  }

  rows.sort(
    (a, b) =>
      b.score - a.score ||
      (b.immediateProfit ?? b.bestBuyProfit ?? -Infinity) - (a.immediateProfit ?? a.bestBuyProfit ?? -Infinity),
  );
  const activeRows = rows.filter((row) => !(Number.isFinite(Date.parse(row.expires)) && Date.parse(row.expires) <= Date.now()));
  const opportunities = activeRows.filter((row) => row.opportunity);
  return {
    generatedAt: new Date().toISOString(),
    contractsCreatedAt: contractsDataset?.createdAt ?? null,
    marketCreatedAt: market.createdAt,
    contracts: activeRows,
    opportunities,
    counts: { contracts: activeRows.length, opportunities: opportunities.length },
  };
}
