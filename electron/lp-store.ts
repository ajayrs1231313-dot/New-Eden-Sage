import { loadGlobalMarketQuotes, type GlobalMarketQuote } from "./market-intelligence";
import { getMarketSystemIndex, getMarketTypeIndex } from "./market-static-index";
import { getPveStaticIndex } from "./pve-static-index";

export type LpHubName = "Jita" | "Amarr" | "Dodixie" | "Rens" | "Hek";

const HUB_NAMES: LpHubName[] = ["Jita", "Amarr", "Dodixie", "Rens", "Hek"];
const OFFER_CACHE_MS = 12 * 60 * 60 * 1000;
const NAME_CACHE_MS = 24 * 60 * 60 * 1000;
const ANALYSIS_CACHE_MS = 5 * 60 * 1000;

type EsiLpOffer = {
  ak_cost: number;
  isk_cost: number;
  lp_cost: number;
  offer_id: number;
  quantity: number;
  required_items: Array<{ quantity: number; type_id: number }>;
  type_id: number;
};

type Cached<T> = { value: T; expiresAt: number };
const offerCache = new Map<number, Cached<EsiLpOffer[]>>();
const corporationNameCache = new Map<number, Cached<string>>();
const analysisCache = new Map<string, Cached<Promise<LpCorporationAnalysis>>>();

export type LpOrderSummary = {
  price: number;
  volumeRemain: number;
  systemId: number;
  systemName: string;
  locationId: number;
  locationName: string;
};

export type LpHubMetrics = {
  hub: LpHubName;
  systemId: number;
  quickProceeds: number | null;
  quickUnitPrice: number | null;
  quickCoveredUnits: number;
  quickCoveragePercent: number;
  patientProceeds: number | null;
  patientUnitPrice: number | null;
  buyDepthUnits: number;
  sellDepthUnits: number;
  buyOrderCount: number;
  sellOrderCount: number;
  spreadPercent: number | null;
};

export type LpRequiredItemAnalysis = {
  typeId: number;
  name: string;
  quantity: number;
  unitMarketCost: number | null;
  marketCost: number | null;
};

export type LpScoreComponents = {
  profitability: number;
  liquidity: number;
  absoluteProfit: number;
  capitalEfficiency: number;
  stability: number;
  confidence: number;
};

export type LpOfferAnalysis = {
  offerId: number;
  outputTypeId: number;
  outputName: string;
  outputQuantity: number;
  lpCost: number;
  iskCost: number;
  akCost: number;
  requiredItems: LpRequiredItemAnalysis[];
  requiredItemsCost: number | null;
  requiredItemsFullyPriced: boolean;
  capitalRequired: number | null;
  categoryName: string;
  groupName: string;
  packagedVolumeM3: number;
  isBlueprint: boolean;
  hubs: Record<LpHubName, LpHubMetrics>;
  bestHub: LpHubName | null;
  bestQuickHub: LpHubName | null;
  bestPatientHub: LpHubName | null;
  quickProceeds: number | null;
  patientProceeds: number | null;
  quickNetProfit: number | null;
  patientNetProfit: number | null;
  quickIskPerLp: number | null;
  patientIskPerLp: number | null;
  roiPercent: number | null;
  marketValue: number | null;
  dailyVolume: number | null;
  saleTimeDays: number | null;
  saleTimeLabel: string;
  liquidityLabel: string;
  score: number;
  scoreComponents: LpScoreComponents;
  classifications: string[];
  warnings: string[];
};

export type LpCorporationAnalysis = {
  corporationId: number;
  corporationName: string;
  generatedAt: string;
  marketAsOf: string | null;
  hubSystems: Array<{ name: LpHubName; systemId: number }>;
  offers: LpOfferAnalysis[];
  warnings: string[];
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`EVE public API returned ${response.status}${body ? `: ${body.slice(0, 160)}` : ""}`);
  }
  return response.json() as Promise<T>;
}

async function getOffers(corporationId: number) {
  const now = Date.now();
  const cached = offerCache.get(corporationId);
  if (cached && cached.expiresAt > now) return cached.value;
  const value = await fetchJson<EsiLpOffer[]>(
    `https://esi.evetech.net/latest/loyalty/stores/${corporationId}/offers/?datasource=tranquility`,
  );
  offerCache.set(corporationId, { value, expiresAt: now + OFFER_CACHE_MS });
  return value;
}

async function resolveNames(ids: number[]) {
  const unique = [...new Set(ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  const now = Date.now();
  const missing = unique.filter((id) => {
    const cached = corporationNameCache.get(id);
    return !cached || cached.expiresAt <= now;
  });
  if (missing.length) {
    for (let index = 0; index < missing.length; index += 900) {
      const batch = missing.slice(index, index + 900);
      try {
        const rows = await fetchJson<Array<{ id: number; name: string }>>(
          "https://esi.evetech.net/latest/universe/names/?datasource=tranquility",
          { method: "POST", body: JSON.stringify(batch) },
        );
        for (const row of rows) {
          corporationNameCache.set(Number(row.id), { value: String(row.name), expiresAt: now + NAME_CACHE_MS });
        }
      } catch {
        // Keep the feature usable when the public names endpoint is temporarily unavailable.
      }
    }
  }
  return unique.map((id) => ({
    corporationId: id,
    corporationName: corporationNameCache.get(id)?.value ?? `Corporation ${id}`,
  }));
}

function fillBuyOrders(quantity: number, quote: GlobalMarketQuote | undefined, systemId: number) {
  let remaining = Math.max(0, Math.floor(quantity));
  let gross = 0;
  let covered = 0;
  const rows = (quote?.buyOrders ?? [])
    .filter((order) => Number(order.systemId) === systemId && Number(order.volumeRemain) > 0)
    .sort((a, b) => b.price - a.price);
  for (const row of rows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Math.max(0, Math.floor(Number(row.volumeRemain) || 0)));
    if (!take) continue;
    gross += take * Number(row.price || 0);
    covered += take;
    remaining -= take;
  }
  return { gross, covered, remaining, rows };
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function smooth(value: number, scale: number) {
  if (!(value > 0)) return 0;
  return clamp(100 * (1 - Math.exp(-value / scale)));
}

function roundScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hubMetrics(hub: LpHubName, systemId: number, outputQuantity: number, quote: GlobalMarketQuote | undefined): LpHubMetrics {
  const buyOrders = (quote?.buyOrders ?? []).filter((row) => Number(row.systemId) === systemId && Number(row.volumeRemain) > 0);
  const sellOrders = (quote?.sellOrders ?? []).filter((row) => Number(row.systemId) === systemId && Number(row.volumeRemain) > 0);
  const fill = fillBuyOrders(outputQuantity, quote, systemId);
  const bestSell = sellOrders.length ? Math.min(...sellOrders.map((row) => Number(row.price)).filter((value) => value > 0)) : null;
  const quickProceeds = fill.covered === outputQuantity && outputQuantity > 0 ? fill.gross : null;
  const quickUnitPrice = quickProceeds != null ? quickProceeds / outputQuantity : null;
  const patientProceeds = bestSell != null ? bestSell * outputQuantity : null;
  const buyDepthUnits = buyOrders.reduce((sum, row) => sum + Math.max(0, Number(row.volumeRemain) || 0), 0);
  const sellDepthUnits = sellOrders.reduce((sum, row) => sum + Math.max(0, Number(row.volumeRemain) || 0), 0);
  const spreadPercent = quickUnitPrice != null && bestSell != null && bestSell > 0
    ? ((bestSell - quickUnitPrice) / bestSell) * 100
    : null;
  return {
    hub,
    systemId,
    quickProceeds,
    quickUnitPrice,
    quickCoveredUnits: fill.covered,
    quickCoveragePercent: outputQuantity > 0 ? clamp((fill.covered / outputQuantity) * 100) : 0,
    patientProceeds,
    patientUnitPrice: bestSell,
    buyDepthUnits,
    sellDepthUnits,
    buyOrderCount: buyOrders.length,
    sellOrderCount: sellOrders.length,
    spreadPercent,
  };
}

function finiteOrNull(value: number | null | undefined) {
  return value != null && Number.isFinite(value) ? value : null;
}

function chooseBestHub(hubs: Record<LpHubName, LpHubMetrics>, key: "quickProceeds" | "patientProceeds") {
  let winner: LpHubName | null = null;
  let best = -Infinity;
  for (const name of HUB_NAMES) {
    const value = hubs[name][key];
    if (value != null && value > best) {
      best = value;
      winner = name;
    }
  }
  return winner;
}

function scoreOffer(input: {
  bestMetric: LpHubMetrics | null;
  quickIskPerLp: number | null;
  patientIskPerLp: number | null;
  bestProfit: number | null;
  roiPercent: number | null;
  outputQuantity: number;
  requiredItemsFullyPriced: boolean;
  outputPriced: boolean;
  isBlueprint: boolean;
}) {
  const metric = input.bestMetric;
  const practicalIskLp = Math.max(0, input.quickIskPerLp ?? 0, input.patientIskPerLp ?? 0);
  const profitability = smooth(practicalIskLp, 1800);
  const depthRatio = metric && input.outputQuantity > 0
    ? Math.max(metric.buyDepthUnits, metric.sellDepthUnits) / input.outputQuantity
    : 0;
  const coverage = metric?.quickCoveragePercent ?? 0;
  const liquidity = clamp(coverage * 0.45 + smooth(depthRatio, 12) * 0.55);
  const absoluteProfit = smooth(Math.max(0, input.bestProfit ?? 0), 120_000_000);
  const capitalEfficiency = input.roiPercent == null ? 20 : smooth(Math.max(0, input.roiPercent), 120);
  const spread = metric?.spreadPercent;
  const stability = spread == null ? 45 : clamp(100 - Math.max(0, spread - 6) * 1.8);
  const confidence = clamp((input.outputPriced ? 55 : 0) + (input.requiredItemsFullyPriced ? 35 : 0) + (metric ? 10 : 0));
  const components = { profitability, liquidity, absoluteProfit, capitalEfficiency, stability, confidence };
  let score = profitability * 0.34 + liquidity * 0.24 + absoluteProfit * 0.12 + capitalEfficiency * 0.10 + stability * 0.10 + confidence * 0.10;
  if (input.isBlueprint) score -= 8; // BPCs need contract/manufacturing analysis before they can be trusted like normal market goods.
  if (!input.outputPriced) score -= 25;
  if (!input.requiredItemsFullyPriced) score -= 18;
  return { score: roundScore(score), components };
}

export async function resolveLpCorporations(corporationIds: number[]) {
  return resolveNames(corporationIds);
}

export type LpEarningCandidate = {
  corporationId: number;
  corporationName: string;
  factionId: number | null;
  factionName: string | null;
  standingEntity: "npc_corp" | "faction" | null;
  standingName: string | null;
  standingValue: number | null;
  corporationStanding: number | null;
  factionStanding: number | null;
  blockedByLowStanding: boolean;
  indicativeAgentLevel: number;
  accessLabel: string;
  stationCount: number;
  stagingSystems: Array<{ systemId: number; systemName: string; stationCount: number }>;
  hasCurrentLp: boolean;
};

export async function getLpEarningCandidates(standingsInput: unknown, currentCorporationIdsInput: unknown): Promise<LpEarningCandidate[]> {
  const standings = Array.isArray(standingsInput) ? standingsInput : [];
  const currentCorporationIds = new Set((Array.isArray(currentCorporationIdsInput) ? currentCorporationIdsInput : []).map(Number).filter((id) => id > 0));
  const corpStandings = new Map<number, number>();
  const factionStandings = new Map<number, number>();
  for (const raw of standings as any[]) {
    const id = Number(raw?.from_id ?? 0);
    const value = Number(raw?.standing);
    if (!(id > 0) || !Number.isFinite(value)) continue;
    if (raw?.from_type === "npc_corp") corpStandings.set(id, value);
    if (raw?.from_type === "faction") factionStandings.set(id, value);
  }
  const staticIndex = await getPveStaticIndex();
  const grouped = new Map<number, LpEarningCandidate>();
  for (const row of staticIndex.missionStaging) {
    const corpStanding = corpStandings.get(row.corporationId) ?? null;
    const factionStanding = row.factionId == null ? null : factionStandings.get(row.factionId) ?? null;
    const blockedByLowStanding = (corpStanding != null && corpStanding < -2) || (factionStanding != null && factionStanding < -2);
    const bestStanding = Math.max(corpStanding ?? -Infinity, factionStanding ?? -Infinity);
    const standingValue = Number.isFinite(bestStanding) ? bestStanding : null;
    const standingEntity = corpStanding != null && (factionStanding == null || corpStanding >= factionStanding) ? "npc_corp" as const : factionStanding != null ? "faction" as const : null;
    const indicativeAgentLevel = blockedByLowStanding ? 0 : standingValue == null ? 1 : standingValue >= 5 ? 4 : standingValue >= 3 ? 3 : standingValue >= 1 ? 2 : 1;
    const accessLabel = blockedByLowStanding
      ? "Standing below -2 blocks normal higher-level agent access"
      : standingValue == null
        ? "No direct synced corp/faction standing; Level 1 only is safe to assume"
        : indicativeAgentLevel >= 2
          ? `Standing threshold is consistent with up to Level ${indicativeAgentLevel}; exact agent access must still be confirmed`
          : "Standing only supports a Level 1 assumption";
    const existing = grouped.get(row.corporationId) ?? {
      corporationId: row.corporationId,
      corporationName: row.corporationName,
      factionId: row.factionId,
      factionName: row.factionName,
      standingEntity,
      standingName: standingEntity === "npc_corp" ? row.corporationName : standingEntity === "faction" ? row.factionName : null,
      standingValue,
      corporationStanding: corpStanding,
      factionStanding,
      blockedByLowStanding,
      indicativeAgentLevel,
      accessLabel,
      stationCount: 0,
      stagingSystems: [],
      hasCurrentLp: currentCorporationIds.has(row.corporationId),
    };
    existing.stationCount += row.stationCount;
    existing.stagingSystems.push({ systemId: row.systemId, systemName: staticIndex.systems.get(row.systemId)?.systemName ?? `System ${row.systemId}`, stationCount: row.stationCount });
    grouped.set(row.corporationId, existing);
  }
  return [...grouped.values()]
    .map((row) => ({ ...row, stagingSystems: row.stagingSystems.sort((a, b) => b.stationCount - a.stationCount || a.systemName.localeCompare(b.systemName)).slice(0, 4) }))
    .filter((row) => row.hasCurrentLp || row.standingValue != null)
    .sort((a, b) => Number(b.hasCurrentLp) - Number(a.hasCurrentLp) || Number(a.blockedByLowStanding) - Number(b.blockedByLowStanding) || b.indicativeAgentLevel - a.indicativeAgentLevel || (b.standingValue ?? -99) - (a.standingValue ?? -99) || b.stationCount - a.stationCount)
    .slice(0, 12);
}

export async function analyzeLpCorporation(corporationIdInput: number, marketRevisionInput = 0): Promise<LpCorporationAnalysis> {
  const corporationId = Number(corporationIdInput);
  const marketRevision = Number.isFinite(Number(marketRevisionInput)) ? Number(marketRevisionInput) : 0;
  const cacheKey = `${corporationId}:${marketRevision}`;
  if (!Number.isSafeInteger(corporationId) || corporationId <= 0) throw new Error("Choose a valid LP corporation.");
  const now = Date.now();
  const cached = analysisCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const promise = (async () => {
    const [offers, names, typeIndex, systemIndex] = await Promise.all([
      getOffers(corporationId),
      resolveNames([corporationId]),
      getMarketTypeIndex(),
      getMarketSystemIndex(),
    ]);
    const typeIds = new Set<number>();
    for (const offer of offers) {
      typeIds.add(Number(offer.type_id));
      for (const item of offer.required_items ?? []) typeIds.add(Number(item.type_id));
    }
    const market = await loadGlobalMarketQuotes([...typeIds]);
    const quoteById = new Map(market.quotes.map((quote) => [Number(quote.typeId), quote]));
    const hubSystems = HUB_NAMES.map((name) => {
      const system = [...systemIndex.values()].find((candidate) => candidate.name === name);
      return { name, systemId: Number(system?.systemId ?? 0) };
    }).filter((entry) => entry.systemId > 0);

    const rows: LpOfferAnalysis[] = offers.map((offer) => {
      const outputTypeId = Number(offer.type_id);
      const outputQuantity = Math.max(1, Math.floor(Number(offer.quantity) || 1));
      const outputMeta = typeIndex.get(outputTypeId);
      const outputQuote = quoteById.get(outputTypeId);
      const requiredItems = (offer.required_items ?? []).map((item) => {
        const typeId = Number(item.type_id);
        const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
        const meta = typeIndex.get(typeId);
        const quote = quoteById.get(typeId);
        const unitMarketCost = finiteOrNull(quote?.bestSell);
        return {
          typeId,
          name: meta?.name ?? quote?.typeName ?? `Type ${typeId}`,
          quantity,
          unitMarketCost,
          marketCost: unitMarketCost == null ? null : unitMarketCost * quantity,
        };
      });
      const requiredItemsFullyPriced = requiredItems.every((item) => item.marketCost != null);
      const requiredItemsCost = requiredItemsFullyPriced ? requiredItems.reduce((sum, item) => sum + Number(item.marketCost), 0) : null;
      const capitalRequired = requiredItemsCost == null ? null : Math.max(0, Number(offer.isk_cost) || 0) + requiredItemsCost;
      const hubs = Object.fromEntries(HUB_NAMES.map((name) => {
        const systemId = hubSystems.find((hub) => hub.name === name)?.systemId ?? 0;
        return [name, hubMetrics(name, systemId, outputQuantity, outputQuote)];
      })) as Record<LpHubName, LpHubMetrics>;
      const bestQuickHub = chooseBestHub(hubs, "quickProceeds");
      const bestPatientHub = chooseBestHub(hubs, "patientProceeds");
      const bestQuick = bestQuickHub ? hubs[bestQuickHub] : null;
      const bestPatient = bestPatientHub ? hubs[bestPatientHub] : null;
      const quickProceeds = bestQuick?.quickProceeds ?? null;
      const patientProceeds = bestPatient?.patientProceeds ?? null;
      const quickNetProfit = quickProceeds != null && capitalRequired != null ? quickProceeds - capitalRequired : null;
      const patientNetProfit = patientProceeds != null && capitalRequired != null ? patientProceeds - capitalRequired : null;
      const lpCost = Math.max(0, Number(offer.lp_cost) || 0);
      const quickIskPerLp = quickNetProfit != null && lpCost > 0 ? quickNetProfit / lpCost : null;
      const patientIskPerLp = patientNetProfit != null && lpCost > 0 ? patientNetProfit / lpCost : null;
      const bestHub = patientNetProfit != null && patientNetProfit >= (quickNetProfit ?? -Infinity) ? bestPatientHub : bestQuickHub;
      const bestMetric = bestHub ? hubs[bestHub] : null;
      const bestProfit = Math.max(quickNetProfit ?? -Infinity, patientNetProfit ?? -Infinity);
      const roiPercent = capitalRequired != null && capitalRequired > 0 && Number.isFinite(bestProfit)
        ? (bestProfit / capitalRequired) * 100
        : null;
      const isBlueprint = String(outputMeta?.categoryName ?? "").toLowerCase() === "blueprint";
      const { score, components } = scoreOffer({
        bestMetric,
        quickIskPerLp,
        patientIskPerLp,
        bestProfit: Number.isFinite(bestProfit) ? bestProfit : null,
        roiPercent,
        outputQuantity,
        requiredItemsFullyPriced,
        outputPriced: Boolean(outputQuote && (outputQuote.bestBuy != null || outputQuote.bestSell != null)),
        isBlueprint,
      });
      const depthRatio = bestMetric ? Math.max(bestMetric.buyDepthUnits, bestMetric.sellDepthUnits) / outputQuantity : 0;
      const liquidityLabel = bestMetric?.quickCoveragePercent === 100 && depthRatio >= 20
        ? "High"
        : depthRatio >= 5 ? "Moderate" : depthRatio > 0 ? "Thin" : "Unknown";
      const warnings: string[] = [];
      if (!requiredItemsFullyPriced && requiredItems.length) warnings.push("One or more required LP-store ingredients have no retained sell price.");
      if (!outputQuote) warnings.push(isBlueprint ? "Blueprint-copy value needs contract/manufacturing analysis; normal market pricing is not reliable." : "No retained market quote is available for this reward.");
      if (bestMetric?.spreadPercent != null && bestMetric.spreadPercent > 60) warnings.push("Wide retained spread: the visible sell price may overstate achievable value.");
      const classifications: string[] = [];
      if (isBlueprint) classifications.push("BPC");
      if (bestMetric?.quickCoveragePercent === 100 && depthRatio >= 12) classifications.push("FAST SALE");
      if (bestMetric?.quickCoveragePercent === 100 && quickNetProfit != null && quickNetProfit > 0) classifications.push("INSTANT CASH");
      if (depthRatio > 0 && depthRatio < 3) classifications.push("LOW VOLUME");
      if (bestMetric && (bestMetric.buyOrderCount + bestMetric.sellOrderCount <= 3 || depthRatio < 1.25)) classifications.push("THIN MARKET");
      if (bestMetric?.spreadPercent != null && bestMetric.spreadPercent > 60) classifications.push("PRICE SPIKE");
      return {
        offerId: Number(offer.offer_id),
        outputTypeId,
        outputName: outputMeta?.name ?? outputQuote?.typeName ?? `Type ${outputTypeId}`,
        outputQuantity,
        lpCost,
        iskCost: Math.max(0, Number(offer.isk_cost) || 0),
        akCost: Math.max(0, Number(offer.ak_cost) || 0),
        requiredItems,
        requiredItemsCost,
        requiredItemsFullyPriced,
        capitalRequired,
        categoryName: outputMeta?.categoryName ?? "Unknown",
        groupName: outputMeta?.groupName ?? "Unknown",
        packagedVolumeM3: Math.max(0, Number(outputMeta?.packagedVolumeM3 ?? outputMeta?.volumeM3 ?? 0)) * outputQuantity,
        isBlueprint,
        hubs,
        bestHub,
        bestQuickHub,
        bestPatientHub,
        quickProceeds,
        patientProceeds,
        quickNetProfit,
        patientNetProfit,
        quickIskPerLp,
        patientIskPerLp,
        roiPercent,
        marketValue: patientProceeds ?? quickProceeds,
        dailyVolume: null,
        saleTimeDays: null,
        saleTimeLabel: bestMetric?.quickCoveragePercent === 100 ? "Immediate buy exit available; patient-sale velocity not retained" : "Trade velocity unavailable",
        liquidityLabel,
        score,
        scoreComponents: components,
        classifications,
        warnings,
      };
    });

    rows.sort((a, b) => b.score - a.score || (b.patientIskPerLp ?? b.quickIskPerLp ?? -Infinity) - (a.patientIskPerLp ?? a.quickIskPerLp ?? -Infinity));
    const best = rows.find((row) => row.score > 0 && !row.isBlueprint && (row.quickNetProfit ?? row.patientNetProfit ?? 0) > 0);
    if (best && !best.classifications.includes("BEST PICK")) best.classifications.unshift("BEST PICK");

    const warnings = [
      "Daily traded volume and patient-sale time are not invented when Sage has no retained transaction history; current order depth is used as the liquidity signal.",
      "Displayed net profit is before character-specific sales tax and broker fees unless those fees can be reconciled later from the synced wallet.",
    ];
    return {
      corporationId,
      corporationName: names[0]?.corporationName ?? `Corporation ${corporationId}`,
      generatedAt: new Date().toISOString(),
      marketAsOf: market.createdAt ?? null,
      hubSystems,
      offers: rows,
      warnings,
    };
  })();

  analysisCache.set(cacheKey, { value: promise, expiresAt: now + ANALYSIS_CACHE_MS });
  try {
    return await promise;
  } catch (error) {
    analysisCache.delete(cacheKey);
    throw error;
  }
}
