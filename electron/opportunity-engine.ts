import { bestRawBuyOrdersForTypes } from "./raw-market-analysis";
import { universeRoute } from "./universe-route-graph";
import { findRegionalShortages, type RegionalShortageSignal } from "./regional-shortage";
import { findFullMarketTrades, type FullTradeRuntime } from "./full-market-trade";
import { analyzeFittingDogma } from "./fitting-dogma";

export type OpportunityRisk = "Low" | "Medium" | "High";
export type OpportunityKind = "trade" | "asset" | "shortage";

export type OpportunityAnalysisRuntime = FullTradeRuntime & { snapshots: any[] };

function fittingRackFromAssetFlag(flag: unknown) {
  const value = String(flag ?? "");
  if (/^HiSlot\d+$/i.test(value)) return "high";
  if (/^MedSlot\d+$/i.test(value)) return "mid";
  if (/^LoSlot\d+$/i.test(value)) return "low";
  if (/^RigSlot\d+$/i.test(value)) return "rig";
  if (/^SubSystemSlot\d+$/i.test(value)) return "subsystem";
  return null;
}

export type CargoCapacityProfile = {
  id: string;
  characterId: string;
  characterName: string;
  shipItemId: number;
  shipTypeId: number;
  shipName: string;
  quantity: number;
  systemName: string | null;
  stationName: string | null;
  capacityM3: number;
  fittedItemCount: number;
  isCurrentShip: boolean;
  basis: string;
};

const cargoProfileCache = new Map<string, Promise<CargoCapacityProfile | null>>();

async function cargoProfileForOwnedShip(snapshot: any, ship: any): Promise<CargoCapacityProfile | null> {
  const characterId = String(snapshot?.characterId ?? "");
  const characterName = String(snapshot?.character?.name ?? characterId ?? "Character");
  const shipItemId = Number(ship?.item_id ?? 0);
  const shipTypeId = Number(ship?.type_id ?? 0);
  if (!characterId || !shipItemId || !shipTypeId) return null;
  const assets = Array.isArray(snapshot?.extended?.assets) ? snapshot.extended.assets : [];
  const fitRows = assets.filter((row: any) => Number(row?.location_id ?? 0) === shipItemId && fittingRackFromAssetFlag(row?.location_flag));
  const fitSignature = fitRows.map((row: any) => `${row.type_id}:${row.location_flag}`).sort().join("|");
  const cacheKey = [characterId, String(snapshot?.updatedAt ?? ""), shipItemId, shipTypeId, fitSignature].join(":");
  let pending = cargoProfileCache.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      const items = fitRows.flatMap((row: any) => {
        const rack = fittingRackFromAssetFlag(row?.location_flag);
        const typeId = Number(row?.type_id ?? 0);
        if (!rack || !typeId) return [];
        return [{ typeId, quantity: Math.max(1, Number(row?.quantity ?? 1)), rack }];
      });
      try {
        // Critical: use the owning character snapshot here. Hull/transport skill bonuses,
        // implants and any other character modifiers must never leak across characters.
        const analysis = await analyzeFittingDogma({ hullTypeId: shipTypeId, items, snapshot });
        const capacityM3 = Number(analysis?.storage?.cargoCapacityM3 ?? 0);
        if (!(capacityM3 > 0)) return null;
        const shipName = String(ship?.item ?? `Type ${shipTypeId}`);
        const isCurrentShip = shipItemId === Number(snapshot?.ship?.ship_item_id ?? 0);
        return {
          id: `${characterId}:${shipItemId}`,
          characterId,
          characterName,
          shipItemId,
          shipTypeId,
          shipName,
          quantity: Math.max(1, Number(ship?.quantity ?? 1)),
          systemName: ship?.system ? String(ship.system) : null,
          stationName: ship?.station ? String(ship.station) : null,
          capacityM3,
          fittedItemCount: fitRows.length,
          isCurrentShip,
          basis: `${characterName}'s ${shipName} - CCP SDE base cargo + this ship's synced fitted modules/rigs + ${characterName}'s skills${isCurrentShip ? " (current ship)" : ""}`,
        };
      } catch {
        return null;
      }
    })();
    cargoProfileCache.set(cacheKey, pending);
  }
  return pending;
}

export async function getOwnedCargoCapacityProfiles(snapshots: any[] = []): Promise<CargoCapacityProfile[]> {
  const pending: Array<Promise<CargoCapacityProfile | null>> = [];
  for (const snapshot of snapshots) {
    const assets = Array.isArray(snapshot?.extended?.assets) ? snapshot.extended.assets : [];
    for (const ship of assets) {
      if (Number(ship?.category_id ?? 0) !== 6) continue;
      pending.push(cargoProfileForOwnedShip(snapshot, ship));
    }
  }
  const profiles = (await Promise.all(pending)).filter((profile): profile is CargoCapacityProfile => Boolean(profile));
  return profiles.sort((a, b) => Number(b.isCurrentShip) - Number(a.isCurrentShip) || b.capacityM3 - a.capacityM3 || a.characterName.localeCompare(b.characterName) || a.shipName.localeCompare(b.shipName));
}

export type OpportunityQuery = {
  characterId?: string;
  maxCapital?: number | null;
  cargoCapacityM3?: number | null;
  cargoProfileId?: string | null;
  maxJumps?: number | null;
  maxMinutes?: number | null;
};

export type MarketOpportunity = {
  id: string;
  typeId: number;
  item: string;
  categoryId: number;
  category: string;
  sell: {
    orderId: number;
    price: number;
    volumeRemain: number;
    systemId: number;
    systemName: string;
    locationId: number;
    locationName: string;
    regionName: string;
  };
  buy: {
    orderId: number;
    price: number;
    volumeRemain: number;
    minVolume: number;
    systemId: number;
    systemName: string;
    locationId: number;
    locationName: string;
    regionName: string;
  };
  units: number;
  availableUnits: number;
  itemVolumeM3: number;
  cargoM3: number;
  investment: number;
  profit: number;
  marginPercent: number;
  iskPerM3: number;
  iskPerJump: number;
  capitalEfficiencyPercent: number;
  jumps: number;
  estimatedMinutes: number;
  fillScore: number;
  risk: OpportunityRisk;
  routeSecurity: "high" | "low" | "null";
  marginWidenedBy: number | null;
  score: number;
  scoreBreakdown: {
    profit: number;
    fill: number;
    route: number;
    capitalEfficiency: number;
    cargoEfficiency: number;
  };
  reasons: string[];
};

export type PersonalOpportunity = {
  id: string;
  kind: OpportunityKind;
  title: string;
  subtitle: string;
  category: string;
  score: number;
  risk: OpportunityRisk;
  jumps: number;
  estimatedMinutes: number;
  fillScore: number;
  capitalRequired: number;
  profit: number | null;
  marginPercent: number | null;
  cashRelease: number | null;
  primaryValue: number;
  primaryLabel: string;
  primaryText?: string;
  confidenceLabel?: string;
  reasons: string[];
  action: string;
};

export type OpportunityAnalysis = {
  generatedAt: string;
  character: null | {
    characterId: string;
    name: string;
    wallet: number;
    systemId: number | null;
    systemName: string | null;
  };
  constraints: {
    maxCapital: number | null;
    cargoCapacityM3: number;
    cargoProfileId: string | null;
    cargoProfiles: CargoCapacityProfile[];
    maxJumps: number | null;
    maxMinutes: number | null;
    capitalBasis: string;
    cargoBasis: string;
  };
  market: {
    opportunities: MarketOpportunity[];
    facets: {
      categories: string[];
      buyRegions: string[];
      sellRegions: string[];
      risks: OpportunityRisk[];
      maximumProfit: number;
      maximumMarginPercent: number;
      maximumIskPerM3: number;
      maximumJumps: number;
    };
    diagnostics: unknown;
  };
  ranked: PersonalOpportunity[];
  signals: {
    ownedAssetStacks: number;
    marketTradesConsidered: number;
    marketDatasetCreatedAt: string | null;
    marketDatasetAgeMinutes: number | null;
    marketDatasetStale: boolean;
    marketOrdersInspected: number;
    marketRegionsInspected: number;
    marketSource: string;
    regionalShortageSignals: number;
  };
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function logScore(value: number, floorPower = 5, rangePower = 5) {
  if (!(value > 0)) return 0;
  return clamp(((Math.log10(value) - floorPower) / rangePower) * 100);
}

function planningMinutes(jumps: number) {
  return Math.max(8, Math.round(8 + Math.max(0, jumps) * 2));
}

function tradeScore(input: { profit: number; fillScore: number; jumps: number; capitalEfficiencyPercent: number; iskPerM3: number }) {
  const breakdown = {
    profit: logScore(input.profit, 6, 4),
    fill: clamp(input.fillScore),
    route: clamp(100 - input.jumps * 5),
    capitalEfficiency: clamp(input.capitalEfficiencyPercent * 2.5),
    cargoEfficiency: Number.isFinite(input.iskPerM3) ? logScore(Math.max(1, input.iskPerM3), 1, 5) : 100,
  };
  return {
    score: clamp(breakdown.profit * 0.32 + breakdown.fill * 0.24 + breakdown.route * 0.16 + breakdown.capitalEfficiency * 0.16 + breakdown.cargoEfficiency * 0.12),
    breakdown,
  };
}

function fillScore(order: { issued?: string; minVolume?: number }, units: number) {
  const issuedAt = Date.parse(order.issued ?? "");
  const ageDays = Number.isFinite(issuedAt) ? Math.max(0, (Date.now() - issuedAt) / 86_400_000) : 30;
  return clamp(48 + Math.min(24, Math.log10(Math.max(1, units)) * 6) + Math.max(0, 18 - ageDays) + ((order.minVolume ?? 1) <= units ? 10 : -25));
}

function riskFor(input: { fillScore: number; jumps: number; marginPercent?: number }): OpportunityRisk {
  if (input.fillScore < 55 || (input.marginPercent ?? 0) > 100) return "High";
  if (input.fillScore < 75 || input.jumps > 12 || (input.marginPercent ?? 0) > 45) return "Medium";
  return "Low";
}

function adjustedTrades(
  base: Awaited<ReturnType<typeof findFullMarketTrades>>,
  maxCapital: number | null,
  cargoCapacityM3: number,
  freshnessFactor: number,
) {
  const results: MarketOpportunity[] = [];
  for (const trade of base.opportunities as any[]) {
    const availableUnits = Math.max(
      0,
      Math.min(Number(trade.sell?.volumeRemain ?? 0), Number(trade.buy?.volumeRemain ?? 0)),
    );
    if (!availableUnits) continue;
    const sellPrice = Number(trade.sell?.price ?? 0);
    const buyPrice = Number(trade.buy?.price ?? 0);
    if (!(sellPrice > 0) || !(buyPrice > sellPrice)) continue;
    const itemVolumeM3 = Math.max(0, Number(trade.itemVolumeM3 ?? trade.volumeM3 ?? 0));
    const capitalUnits = maxCapital == null
      ? availableUnits
      : Math.max(0, Math.floor(maxCapital / sellPrice));
    const cargoUnits = itemVolumeM3 > 0
      ? Math.max(0, Math.floor(cargoCapacityM3 / itemVolumeM3))
      : availableUnits;
    const units = Math.min(availableUnits, capitalUnits, cargoUnits);
    if (!units || Number(trade.buy?.minVolume ?? 1) > units) continue;
    const investment = sellPrice * units;
    const profit = (buyPrice - sellPrice) * units;
    if (!(profit > 0)) continue;
    const marginPercent = ((buyPrice - sellPrice) / sellPrice) * 100;
    const cargoM3 = itemVolumeM3 * units;
    const iskPerM3 = itemVolumeM3 > 0 ? (buyPrice - sellPrice) / itemVolumeM3 : Infinity;
    const jumps = Number(trade.jumps ?? 999);
    if (!Number.isFinite(jumps) || jumps >= 999) continue;
    const tradeFillScore = clamp(Number(trade.fillScore ?? 0));
    const capitalEfficiencyPercent = investment > 0 ? (profit / investment) * 100 : 0;
    const iskPerJump = profit / Math.max(1, jumps);
    const scored = tradeScore({
      profit,
      fillScore: tradeFillScore,
      jumps,
      capitalEfficiencyPercent,
      iskPerM3,
    });
    const routeSecurity = (trade.routeSecurity === "null" || trade.routeSecurity === "low") ? trade.routeSecurity : "high";
    const risk: OpportunityRisk = routeSecurity === "null"
      ? "High"
      : routeSecurity === "low"
        ? "Medium"
        : riskFor({ fillScore: tradeFillScore, jumps, marginPercent });
    const estimatedMinutes = planningMinutes(jumps);
    results.push({
      id: `trade:${trade.typeId}:${trade.sell.orderId}:${trade.buy.orderId}`,
      typeId: Number(trade.typeId),
      item: String(trade.item ?? `Type ${trade.typeId}`),
      categoryId: Number(trade.categoryId ?? 0),
      category: String(trade.categoryName ?? trade.category ?? "Other"),
      sell: {
        orderId: Number(trade.sell.orderId),
        price: sellPrice,
        volumeRemain: Number(trade.sell.volumeRemain ?? 0),
        systemId: Number(trade.sell.systemId),
        systemName: String(trade.sell.systemName ?? "Unknown system"),
        locationId: Number(trade.sell.locationId),
        locationName: String(trade.sell.locationName ?? "Unknown location"),
        regionName: String(trade.sell.regionName ?? "Unknown region"),
      },
      buy: {
        orderId: Number(trade.buy.orderId),
        price: buyPrice,
        volumeRemain: Number(trade.buy.volumeRemain ?? 0),
        minVolume: Number(trade.buy.minVolume ?? 1),
        systemId: Number(trade.buy.systemId),
        systemName: String(trade.buy.systemName ?? "Unknown system"),
        locationId: Number(trade.buy.locationId),
        locationName: String(trade.buy.locationName ?? "Unknown location"),
        regionName: String(trade.buy.regionName ?? "Unknown region"),
      },
      units,
      availableUnits,
      itemVolumeM3,
      cargoM3,
      investment,
      profit,
      marginPercent,
      iskPerM3,
      iskPerJump,
      capitalEfficiencyPercent,
      jumps,
      estimatedMinutes,
      fillScore: tradeFillScore,
      risk,
      routeSecurity,
      marginWidenedBy: trade.marginWidenedBy == null ? null : Number(trade.marginWidenedBy),
      score: clamp(scored.score * freshnessFactor),
      scoreBreakdown: scored.breakdown,
      reasons: [
        `${Math.round(profit).toLocaleString("en-GB")} ISK gross profit for ${Math.round(investment).toLocaleString("en-GB")} ISK deployed.`,
        `${tradeFillScore}/100 fill-confidence signal from order age, size and minimum-volume fit.`,
        `${jumps} jumps; about ${estimatedMinutes} minutes is used as a planning estimate for ranking. Route security: ${routeSecurity}.`,
        `${marginPercent.toFixed(1)}% gross return and ${Number.isFinite(iskPerM3) ? Math.round(iskPerM3).toLocaleString("en-GB") : "unlimited"} ISK/m3 cargo efficiency.`,
      ],
    });
  }
  return results.sort((a, b) => b.score - a.score || b.profit - a.profit);
}

async function assetOpportunities(snapshot: any, freshnessFactor: number): Promise<PersonalOpportunity[]> {
  if (!snapshot) return [];
  const assets = Array.isArray(snapshot.extended?.assets) ? snapshot.extended.assets : [];
  const protectedCounts = new Map<number, number>();
  const protect = (typeId: number, quantity = 1) => {
    if (!typeId || quantity <= 0) return;
    protectedCounts.set(typeId, (protectedCounts.get(typeId) ?? 0) + quantity);
  };
  protect(Number(snapshot.ship?.ship_type_id ?? 0), 1);
  for (const item of (Array.isArray(snapshot.extended?.currentShipFit?.items) ? snapshot.extended.currentShipFit.items : []))
    protect(Number(item.type_id ?? 0), Math.max(1, Number(item.quantity ?? 1)));
  for (const fitting of (Array.isArray(snapshot.extended?.fittings) ? snapshot.extended.fittings : []))
    for (const item of (Array.isArray(fitting.items) ? fitting.items : []))
      protect(Number(item.type_id ?? 0), Math.max(1, Number(item.quantity ?? 1)));
  for (const blueprint of (Array.isArray(snapshot.extended?.blueprints) ? snapshot.extended.blueprints : []))
    if (Number(blueprint.quantity ?? 0) === -1)
      protectedCounts.set(Number(blueprint.type_id ?? 0), Math.max(1, protectedCounts.get(Number(blueprint.type_id ?? 0)) ?? 0));
  const blueprintCopies = new Set(
    (Array.isArray(snapshot.extended?.blueprints) ? snapshot.extended.blueprints : [])
      .filter((blueprint: any) => Number(blueprint.quantity ?? 0) === -2)
      .map((blueprint: any) => Number(blueprint.item_id ?? 0))
      .filter(Boolean),
  );
  const aggregate = new Map<number, { quantity: number; estimatedValue: number; name?: string; categoryId?: number }>();
  for (const asset of assets) {
    if (blueprintCopies.has(Number(asset.item_id ?? 0))) continue;
    const typeId = Number(asset.type_id ?? 0);
    const quantity = Math.max(0, Number(asset.quantity ?? 0));
    if (!typeId || !quantity) continue;
    const current = aggregate.get(typeId) ?? { quantity: 0, estimatedValue: 0 };
    current.quantity += quantity;
    current.estimatedValue += Math.max(0, Number(asset.estimatedValue ?? 0));
    current.name = current.name ?? asset.item;
    current.categoryId = current.categoryId ?? asset.category_id;
    aggregate.set(typeId, current);
    if (Number(asset.category_id ?? 0) === 6)
      protectedCounts.set(typeId, Math.max(1, protectedCounts.get(typeId) ?? 0));
    if (Number(asset.category_id ?? 0) === 9)
      protectedCounts.set(typeId, Math.max(1, protectedCounts.get(typeId) ?? 0));
  }

  const raw = await bestRawBuyOrdersForTypes(aggregate.keys());
  const originSystem = Number(snapshot.location?.solar_system_id ?? 0);
  const rows: PersonalOpportunity[] = [];
  for (const [typeId, asset] of aggregate) {
    const buyer = raw.orders.get(typeId);
    const item = raw.index.items.get(typeId);
    if (!buyer || !item) continue;
    const saleableQuantity = Math.max(0, asset.quantity - (protectedCounts.get(typeId) ?? 0));
    if (!saleableQuantity) continue;
    const units = Math.min(saleableQuantity, buyer.volumeRemain);
    if (!units || buyer.minVolume > units) continue;
    const cashRelease = units * buyer.price;
    if (cashRelease < 1_000_000) continue;
    const route = originSystem ? await universeRoute(originSystem, buyer.systemId) : { jumps: 999, minimumSecurityStatus: -1 };
    if (route.jumps >= 999) continue;
    const confidence = fillScore(buyer, units);
    const routeBand = route.minimumSecurityStatus >= 0.45 ? "high" : route.minimumSecurityStatus > 0 ? "low" : "null";
    const risk: OpportunityRisk = routeBand === "null" ? "High" : routeBand === "low" ? "Medium" : riskFor({ fillScore: confidence, jumps: route.jumps });
    const estimatedMinutes = planningMinutes(route.jumps);
    const valueScore = logScore(cashRelease, 6, 4);
    const score = clamp((valueScore * 0.5 + confidence * 0.3 + clamp(100 - route.jumps * 5) * 0.2) * freshnessFactor);
    rows.push({
      id: `asset:${typeId}:${buyer.orderId}`,
      kind: "asset",
      title: `Sell ${units.toLocaleString("en-GB")} × ${item.typeName}`,
      subtitle: `${buyer.systemName} · ${buyer.regionName}`,
      category: item.categoryName,
      score,
      risk,
      jumps: route.jumps,
      estimatedMinutes,
      fillScore: confidence,
      capitalRequired: 0,
      profit: null,
      marginPercent: null,
      cashRelease,
      primaryValue: cashRelease,
      primaryLabel: "Cash released",
      reasons: [
        `${Math.round(cashRelease).toLocaleString("en-GB")} ISK could be released against the best matching buyer found in the complete raw all-region order book.`,
        `${units.toLocaleString("en-GB")} surplus units remain after protecting active/fitting use and fit that buyer's remaining volume.`,
        `${confidence}/100 fill-confidence signal; ${route.jumps} jumps from the synced character location; route security is ${routeBand}.`,
        "This is liquidation value, not manufacturing/trading profit: Sage does not know the historical cost basis for this asset stack.",
      ],
      action: `Move the asset to ${buyer.locationName} and re-check the live order before selling.`,
    });
  }
  return rows.sort((a, b) => b.score - a.score || b.primaryValue - a.primaryValue).slice(0, 40);
}

function toPersonalShortage(signal: RegionalShortageSignal): PersonalOpportunity {
  const executableUnits = signal.targetBuyPrice != null && signal.targetBuyPrice > signal.sourcePrice
    ? Math.min(signal.source.bestSellVolume, signal.target.bestBuyVolume)
    : 0;
  const capitalRequired = executableUnits * signal.sourcePrice;
  const estimatedProfit = executableUnits > 0 && signal.targetBuyPrice != null
    ? (signal.targetBuyPrice - signal.sourcePrice) * executableUnits
    : null;
  const premiumText = signal.supplyGap ? "Supply gap" : `${signal.regionalPremiumPercent?.toFixed(1) ?? "—"}%`;
  return {
    id: signal.id,
    kind: "shortage",
    title: `${signal.item} · ${signal.target.regionName}`,
    subtitle: `${signal.source.regionName} → ${signal.target.regionName}`,
    category: signal.category,
    score: signal.score,
    risk: signal.risk,
    jumps: signal.jumpsFromCharacter,
    estimatedMinutes: signal.estimatedMinutes,
    fillScore: signal.confidenceScore,
    capitalRequired,
    profit: estimatedProfit,
    marginPercent: signal.executableMarginPercent,
    cashRelease: null,
    primaryValue: estimatedProfit ?? signal.score,
    primaryLabel: estimatedProfit != null ? "Estimated gross profit" : signal.supplyGap ? "Regional supply" : "Regional premium",
    primaryText: estimatedProfit != null ? `${Math.round(estimatedProfit).toLocaleString("en-GB")} ISK` : premiumText,
    confidenceLabel: `${signal.confidenceScore}/100 market-depth confidence`,
    reasons: [
      ...(estimatedProfit != null
        ? [`Estimated from ${executableUnits.toLocaleString("en-GB")} units at the retained best source sell and target buy orders; taxes, fees, cargo and route costs are excluded.`]
        : ["No matching retained buyer above the source price is available, so this is a supply/price signal rather than a profit estimate."]),
      ...signal.reasons,
    ],
    action: signal.executableMarginPercent != null
      ? `Re-check ${signal.item} sellers in ${signal.source.regionName} and buyers in ${signal.target.regionName}; include taxes, fees, cargo and route risk before committing ISK.`
      : `Re-check ${signal.item} supply in ${signal.target.regionName} and compare hauling or future manufacturing/stocking options before committing ISK.`,
  };
}

function toPersonalTrade(trade: MarketOpportunity): PersonalOpportunity {
  return {
    id: trade.id,
    kind: "trade",
    title: trade.item,
    subtitle: `${trade.sell.systemName} → ${trade.buy.systemName}`,
    category: trade.category,
    score: trade.score,
    risk: trade.risk,
    jumps: trade.jumps,
    estimatedMinutes: trade.estimatedMinutes,
    fillScore: trade.fillScore,
    capitalRequired: trade.investment,
    profit: trade.profit,
    marginPercent: trade.marginPercent,
    cashRelease: null,
    primaryValue: trade.profit,
    primaryLabel: "Gross profit",
    reasons: trade.reasons,
    action: `Buy up to ${trade.units.toLocaleString("en-GB")} units in ${trade.sell.systemName} and sell to the retained buyer in ${trade.buy.systemName}; re-check both orders before committing capital.`,
  };
}

export async function analyzeOpportunities(
  input: OpportunityQuery = {},
  runtime: OpportunityAnalysisRuntime = { snapshots: [] },
): Promise<OpportunityAnalysis> {
  const snapshot = input.characterId
    ? runtime.snapshots.find((item: any) => String(item.characterId) === String(input.characterId)) ?? null
    : null;
  const wallet = Math.max(0, Number(snapshot?.wallet ?? 0));
  const maxCapital = input.maxCapital == null
    ? null
    : Math.max(0, Number(input.maxCapital));
  const maxJumps = input.maxJumps == null ? null : Math.max(0, Number(input.maxJumps));
  const maxMinutes = input.maxMinutes == null ? null : Math.max(0, Number(input.maxMinutes));
  const cargoProfiles = await getOwnedCargoCapacityProfiles(runtime.snapshots ?? []);
  const requestedProfile = input.cargoProfileId ? cargoProfiles.find((profile) => profile.id === input.cargoProfileId) ?? null : null;
  const currentProfile = snapshot ? cargoProfiles.find((profile) => profile.characterId === String(snapshot.characterId) && profile.isCurrentShip) ?? null : null;
  const requestedCargo = input.cargoCapacityM3 == null ? null : Math.max(1, Number(input.cargoCapacityM3));
  const selectedCargoProfile = requestedProfile ?? (input.cargoCapacityM3 == null ? currentProfile : null);
  const cargoCapacityM3 = selectedCargoProfile?.capacityM3 ?? requestedCargo ?? 30_000;
  const base = await findFullMarketTrades(
    "top1000",
    { maxCapital, cargoCapacityM3, maxJumps, maxMinutes },
    runtime,
  );
  const datasetCreatedAt = String((base.diagnostics as any)?.datasetCreatedAt ?? "");
  const datasetCreatedAtMs = Date.parse(datasetCreatedAt);
  const marketDatasetAgeMinutes = Number.isFinite(datasetCreatedAtMs)
    ? Math.max(0, Math.round((Date.now() - datasetCreatedAtMs) / 60_000))
    : null;
  const marketDatasetStale = marketDatasetAgeMinutes == null || marketDatasetAgeMinutes > 90;
  const freshnessFactor = marketDatasetAgeMinutes == null
    ? 0.45
    : marketDatasetAgeMinutes <= 30
      ? 1
      : marketDatasetAgeMinutes <= 90
        ? 0.95
        : marketDatasetAgeMinutes <= 360
          ? 0.8
          : marketDatasetAgeMinutes <= 1440
            ? 0.65
            : 0.45;
  const trades = adjustedTrades(base, maxCapital, cargoCapacityM3, freshnessFactor);
  runtime.progress?.({ stage: "assets", message: "Checking surplus assets against the full market…", percent: 96 });
  const assetRows = await assetOpportunities(snapshot, freshnessFactor);
  runtime.progress?.({ stage: "regional-shortages", message: "Ranking regional shortages and demand pressure…", percent: 97 });
  const shortageSignals = await findRegionalShortages({
    originSystemId: Number(snapshot?.location?.solar_system_id ?? 0) || null,
    maxJumps,
    maxMinutes,
    limit: 50,
  }, runtime);
  const shortageRows = shortageSignals.map(toPersonalShortage);
  const eligibleTrades = trades.filter((trade) =>
    (maxJumps == null || trade.jumps <= maxJumps) &&
    (maxMinutes == null || trade.estimatedMinutes <= maxMinutes),
  );
  const eligibleAssets = assetRows.filter((item) =>
    (maxJumps == null || item.jumps <= maxJumps) &&
    (maxMinutes == null || item.estimatedMinutes <= maxMinutes),
  );
  const bestTradeByType = new Map<number, MarketOpportunity>();
  for (const trade of eligibleTrades)
    if (!bestTradeByType.has(trade.typeId)) bestTradeByType.set(trade.typeId, trade);
  const ranked = [...[...bestTradeByType.values()].slice(0, 80).map(toPersonalTrade), ...eligibleAssets, ...shortageRows]
    .sort((a, b) => b.score - a.score || b.primaryValue - a.primaryValue)
    .slice(0, 60);
  const categories = [...new Set(eligibleTrades.map((item) => item.category))].sort((a, b) => a.localeCompare(b));
  const buyRegions = [...new Set(eligibleTrades.map((item) => item.buy.regionName))].sort((a, b) => a.localeCompare(b));
  const sellRegions = [...new Set(eligibleTrades.map((item) => item.sell.regionName))].sort((a, b) => a.localeCompare(b));
  runtime.progress?.({ stage: "complete", message: "Analysis complete.", percent: 100 });
  return {
    generatedAt: new Date().toISOString(),
    character: snapshot
      ? {
          characterId: snapshot.characterId,
          name: snapshot.character?.name ?? "Character",
          wallet,
          systemId: snapshot.location?.solar_system_id ?? null,
          systemName: snapshot.location?.solar_system_name ?? null,
        }
      : null,
    constraints: {
      maxCapital,
      cargoCapacityM3,
      cargoProfileId: selectedCargoProfile?.id ?? null,
      cargoProfiles,
      maxJumps,
      maxMinutes,
      capitalBasis: input.maxCapital == null
        ? "No capital limit; use the Market Scanner maximum-capital filter when needed"
        : "Custom deployable capital",
      cargoBasis: selectedCargoProfile?.basis ?? "Custom cargo capacity",
    },
    market: {
      opportunities: eligibleTrades,
      facets: {
        categories,
        buyRegions,
        sellRegions,
        risks: ["Low", "Medium", "High"],
        maximumProfit: Math.max(0, ...eligibleTrades.map((item) => item.profit)),
        maximumMarginPercent: Math.max(0, ...eligibleTrades.map((item) => item.marginPercent)),
        maximumIskPerM3: Math.max(0, ...eligibleTrades.filter((item) => Number.isFinite(item.iskPerM3)).map((item) => item.iskPerM3)),
        maximumJumps: Math.max(0, ...eligibleTrades.map((item) => item.jumps)),
      },
      diagnostics: base.diagnostics,
    },
    ranked,
    signals: {
      ownedAssetStacks: Array.isArray(snapshot?.extended?.assets) ? snapshot.extended.assets.length : 0,
      marketTradesConsidered: eligibleTrades.length,
      marketDatasetCreatedAt: datasetCreatedAt || null,
      marketDatasetAgeMinutes,
      marketDatasetStale,
      marketOrdersInspected: Number((base.diagnostics as any)?.sourceOrdersInspected ?? 0),
      marketRegionsInspected: Number((base.diagnostics as any)?.sourceRegions ?? 0),
      marketSource: String((base.diagnostics as any)?.source ?? "complete raw market order book"),
      regionalShortageSignals: shortageSignals.length,
    },
  };
}
