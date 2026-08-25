import {
  analyzePlanetaryRevenue,
  buildPlanetaryPlan,
  type PlanetaryAlertSettings,
  type PlanetaryPlanInput,
  type PlanetaryPlanMode,
  type PlanetaryResourceObservation,
  type PlanetaryRevenueSettings,
} from "./planetary-revenue";

export type { PlanetaryAlertSettings } from "./planetary-revenue";

export const DEFAULT_PLANETARY_ALERT_SETTINGS: Required<Omit<PlanetaryAlertSettings, "overrides">> & { overrides: Record<string, NonNullable<PlanetaryAlertSettings["overrides"]>[string]> } = {
  enabled: {
    "extractor-6h": true,
    "extractor-1h": true,
    "extractor-expired": true,
    "factory-starvation": true,
    "broken-route": true,
    "storage-80": false,
    "storage-90": true,
    "storage-95": true,
    "storage-full": true,
    "colony-idle": true,
    "production-deficit": true,
    "stockpile-low": true,
    "optimizer-value": true,
    "unused-colony-slot": true,
  },
  extractorWarningHours: [6, 1],
  storageThresholds: [80, 90, 95],
  stockpileDays: 2,
  optimizerMinIskPerDay: 1_000_000,
  overrides: {},
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function observationPercent(row: PlanetaryResourceObservation) {
  const direct = Number(row.percent);
  if (Number.isFinite(direct)) return clamp(direct, 0, 100);
  const legacy = Number(row.score);
  if (!Number.isFinite(legacy)) return null;
  return clamp(legacy <= 5 ? legacy * 20 : legacy, 0, 100);
}

export function normalizePlanetaryObservation(row: PlanetaryResourceObservation): PlanetaryResourceObservation | null {
  const planetId = Number(row?.planetId);
  const percent = observationPercent(row);
  if (!(planetId > 0) || percent == null) return null;
  return {
    ...row,
    planetId,
    systemId: row.systemId == null ? undefined : Number(row.systemId),
    planetTypeId: row.planetTypeId == null ? undefined : Number(row.planetTypeId),
    radiusKm: row.radiusKm == null ? undefined : Math.max(0, Number(row.radiusKm)),
    resourceTypeId: row.resourceTypeId == null ? undefined : Number(row.resourceTypeId),
    percent,
    confidence: row.confidence == null ? undefined : clamp(Number(row.confidence), 0, 1),
    scope: row.scope ?? "personal",
    source: row.source ?? (row.score != null && row.percent == null ? "legacy" : "manual"),
    observedAt: row.observedAt && Number.isFinite(Date.parse(row.observedAt)) ? row.observedAt : new Date().toISOString(),
  };
}

export function summarizeSurvey(observations: PlanetaryResourceObservation[]) {
  const rows = observations.map(normalizePlanetaryObservation).filter((row): row is PlanetaryResourceObservation => Boolean(row));
  const systems = new Set(rows.map((row) => row.systemId).filter((value): value is number => Number.isFinite(value)));
  const planets = new Set(rows.map((row) => row.planetId));
  const resources = new Set(rows.map((row) => row.resourceTypeId ?? row.resourceName).filter(Boolean));
  const dates = rows.map((row) => Date.parse(String(row.observedAt ?? ""))).filter(Number.isFinite);
  return {
    systemsSurveyed: systems.size,
    planetsSurveyed: planets.size,
    observations: rows.length,
    distinctResources: resources.size,
    corporationRecords: rows.filter((row) => row.scope === "corporation").length,
    personalRecords: rows.filter((row) => row.scope !== "corporation").length,
    newestObservation: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
  };
}

function normalizeAlertSettings(input?: PlanetaryAlertSettings) {
  return {
    enabled: { ...DEFAULT_PLANETARY_ALERT_SETTINGS.enabled, ...(input?.enabled ?? {}) },
    extractorWarningHours: (input?.extractorWarningHours ?? DEFAULT_PLANETARY_ALERT_SETTINGS.extractorWarningHours).map(Number).filter((value) => value > 0).sort((a, b) => b - a),
    storageThresholds: (input?.storageThresholds ?? DEFAULT_PLANETARY_ALERT_SETTINGS.storageThresholds).map(Number).filter((value) => value > 0 && value <= 100).sort((a, b) => a - b),
    stockpileDays: Math.max(0.25, Number(input?.stockpileDays ?? DEFAULT_PLANETARY_ALERT_SETTINGS.stockpileDays)),
    optimizerMinIskPerDay: Math.max(0, Number(input?.optimizerMinIskPerDay ?? DEFAULT_PLANETARY_ALERT_SETTINGS.optimizerMinIskPerDay)),
    overrides: input?.overrides ?? {},
  };
}

function effectiveAlertSettings(base: ReturnType<typeof normalizeAlertSettings>, characterId: string, planetId: number) {
  const character = base.overrides[`character:${characterId}`] ?? {};
  const colony = base.overrides[`colony:${planetId}`] ?? {};
  return {
    ...base,
    ...character,
    ...colony,
    enabled: { ...base.enabled, ...(character.enabled ?? {}), ...(colony.enabled ?? {}) },
    extractorWarningHours: colony.extractorWarningHours ?? character.extractorWarningHours ?? base.extractorWarningHours,
    storageThresholds: colony.storageThresholds ?? character.storageThresholds ?? base.storageThresholds,
    stockpileDays: colony.stockpileDays ?? character.stockpileDays ?? base.stockpileDays,
    optimizerMinIskPerDay: colony.optimizerMinIskPerDay ?? character.optimizerMinIskPerDay ?? base.optimizerMinIskPerDay,
  };
}

function alertFeatureKey(alert: any) {
  if (alert.type === "extractor-expired") return "extractor-expired";
  if (alert.type === "extractor-expiring") return Number(alert.hoursUntil) <= 1 ? "extractor-1h" : "extractor-6h";
  if (alert.type === "processor-starved") return "factory-starvation";
  if (alert.type === "input-low") return "stockpile-low";
  if (["broken-route", "extractor-unrouted", "output-unrouted"].includes(alert.type)) return "broken-route";
  if (alert.type === "storage-full") return "storage-full";
  if (alert.type === "unused-colony-slot") return "unused-colony-slot";
  return alert.type;
}

export type PlanetaryOptimizerRecommendation = {
  id: string;
  rank: number;
  kind: string;
  title: string;
  characterId: string | null;
  characterName: string;
  planetId: number;
  planetLabel: string;
  reason: string;
  actions: string[];
  estimatedGainIskPerDay: number | null;
  estimatedCostIsk: number | null;
  confidence: number;
  destructive: boolean;
};

function addRecommendation(rows: PlanetaryOptimizerRecommendation[], row: Omit<PlanetaryOptimizerRecommendation, "confidence" | "destructive"> & { confidence?: number; destructive?: boolean }) {
  rows.push({ ...row, confidence: clamp(Number(row.confidence ?? 0.5), 0, 1), destructive: Boolean(row.destructive) });
}

export function buildOptimizerFromAnalysis(analysis: any, observations: PlanetaryResourceObservation[]) {
  const recommendations: PlanetaryOptimizerRecommendation[] = [];
  const normalizedObservations = observations.map(normalizePlanetaryObservation).filter((row): row is PlanetaryResourceObservation => Boolean(row));

  for (const colony of analysis.empire.colonies ?? []) {
    const label = `${colony.solarSystemName} · ${colony.planetType}`;
    const expired = (colony.extractors ?? []).filter((row: any) => !row.active);
    if (expired.length) addRecommendation(recommendations, {
      id: `restart:${colony.characterId}:${colony.planetId}`,
      rank: 1,
      kind: "restart-extractor",
      title: "Restart expired extraction",
      characterId: colony.characterId,
      characterName: colony.characterName,
      planetId: colony.planetId,
      planetLabel: label,
      reason: `${expired.length} extractor program${expired.length === 1 ? " is" : "s are"} expired. Restarting is the smallest useful intervention.`,
      actions: ["Restart the expired ECU program", "Keep the existing routes and processors unless demand says otherwise"],
      estimatedGainIskPerDay: null,
      estimatedCostIsk: 0,
      confidence: 0.98,
    });

    const urgent = (colony.extractors ?? []).filter((row: any) => row.active && Number(row.hoursUntilExpiry) <= 6);
    if (urgent.length) addRecommendation(recommendations, {
      id: `renew:${colony.characterId}:${colony.planetId}`,
      rank: 1,
      kind: "renew-extractor",
      title: "Renew extraction before downtime",
      characterId: colony.characterId,
      characterName: colony.characterName,
      planetId: colony.planetId,
      planetLabel: label,
      reason: `${urgent.length} extractor program${urgent.length === 1 ? " expires" : "s expire"} within six hours.`,
      actions: ["Restart or reseat heads before expiry", "Prefer the stronger surveyed resource band when evidence exists"],
      estimatedGainIskPerDay: urgent.every((row: any) => row.grossNext24h != null) ? urgent.reduce((sum: number, row: any) => sum + Number(row.grossNext24h), 0) : null,
      estimatedCostIsk: 0,
      confidence: 0.9,
    });

    for (const extractor of (colony.extractors ?? []).filter((row: any) => row.active)) {
      const evidence = normalizedObservations
        .filter((row) => row.planetId === colony.planetId && Number(row.resourceTypeId) === Number(extractor.productTypeId))
        .sort((a, b) => Date.parse(String(b.observedAt ?? "")) - Date.parse(String(a.observedAt ?? "")))[0];
      const current = evidence ? observationPercent(evidence) : null;
      if (current != null && current < 30) addRecommendation(recommendations, {
        id: `reseat:${colony.characterId}:${colony.planetId}:${extractor.pinId}`,
        rank: 1,
        kind: "reseat-extractor",
        title: "Reseat weak extractor heads",
        characterId: colony.characterId,
        characterName: colony.characterName,
        planetId: colony.planetId,
        planetLabel: label,
        reason: `${extractor.productName ?? "The extracted resource"} was surveyed at ${current.toFixed(0)}%. Try a head reseat before rebuilding or repurposing the colony.`,
        actions: ["Move heads to the strongest current hotspot", "Resurvey after the program to update the evidence record"],
        estimatedGainIskPerDay: null,
        estimatedCostIsk: 0,
        confidence: evidence?.confidence ?? 0.72,
      });
    }

    if (colony.badRoutes || colony.unroutedExtractors || colony.unroutedProcessors) addRecommendation(recommendations, {
      id: `routes:${colony.characterId}:${colony.planetId}`,
      rank: 1,
      kind: "repair-routes",
      title: "Repair PI routing",
      characterId: colony.characterId,
      characterName: colony.characterName,
      planetId: colony.planetId,
      planetLabel: label,
      reason: `${colony.badRoutes} broken route(s), ${colony.unroutedExtractors} unrouted extractor(s), ${colony.unroutedProcessors} unrouted processor output(s).`,
      actions: ["Repair only the disconnected route hops first", "Re-check processor starvation after routing is restored"],
      estimatedGainIskPerDay: (colony.recipes ?? []).reduce((sum: number, row: any) => sum + Math.max(0, Number(row.marginPerDay ?? 0)), 0) || null,
      estimatedCostIsk: 0,
      confidence: 0.96,
    });

    if (colony.starvedProcessors) addRecommendation(recommendations, {
      id: `feed:${colony.characterId}:${colony.planetId}`,
      rank: 2,
      kind: "feed-processors",
      title: "Restore factory input flow",
      characterId: colony.characterId,
      characterName: colony.characterName,
      planetId: colony.planetId,
      planetLabel: label,
      reason: `${colony.starvedProcessors} processor${colony.starvedProcessors === 1 ? " is" : "s are"} starved. Fix supply before adding or replacing facilities.`,
      actions: ["Restore the missing inbound route or refill the launchpad", "Add a processor only after existing processors remain continuously supplied"],
      estimatedGainIskPerDay: (colony.recipes ?? []).reduce((sum: number, row: any) => sum + Math.max(0, Number(row.marginPerDay ?? 0)), 0) || null,
      estimatedCostIsk: 0,
      confidence: 0.9,
    });

    const pressure = Math.max(0, ...(colony.storage ?? []).map((row: any) => Number(row.fillPercent ?? 0)));
    if (pressure >= 90) addRecommendation(recommendations, {
      id: `storage:${colony.characterId}:${colony.planetId}`,
      rank: 1,
      kind: "relieve-storage",
      title: "Relieve storage pressure",
      characterId: colony.characterId,
      characterName: colony.characterName,
      planetId: colony.planetId,
      planetLabel: label,
      reason: `Storage has reached ${pressure.toFixed(0)}%; avoid lost output before changing the layout.`,
      actions: ["Export finished goods or move buffer stock", "Only add storage if the recurring flow still overfills"],
      estimatedGainIskPerDay: null,
      estimatedCostIsk: 0,
      confidence: 0.95,
    });
  }

  const stockpile = new Map<number, number>((analysis.stockpile ?? []).map((row: any) => [Number(row.typeId), Number(row.quantity)] as [number, number]));
  for (const demand of analysis.industryDemand ?? []) {
    const shortage = Math.max(0, Number(demand.baseQuantity) - (stockpile.get(Number(demand.typeId)) ?? 0));
    if (!shortage) continue;
    const opportunity = (analysis.opportunities ?? []).find((row: any) => Number(row.output.typeId) === Number(demand.typeId));
    addRecommendation(recommendations, {
      id: `demand:${demand.typeId}`,
      rank: 3,
      kind: "production-deficit",
      title: `Cover ${demand.name} deficit`,
      characterId: null,
      characterName: "Empire",
      planetId: 0,
      planetLabel: "Industrial demand",
      reason: `Active industry signals need ${Math.round(shortage).toLocaleString()} more ${demand.name} than the current PI stockpile contains.`,
      actions: [opportunity ? `Add or retarget processor capacity for ${demand.name}` : `Acquire ${demand.name} externally`, "Use spare CPU/PG or a spare colony slot before repurposing a healthy colony"],
      estimatedGainIskPerDay: opportunity?.taxAdjustedMarginPerDay ?? null,
      estimatedCostIsk: null,
      confidence: 0.68,
    });
  }

  const best = [...(analysis.opportunities ?? [])].filter((row: any) => Number(row.taxAdjustedMarginPerDay) > 0 && row.tier !== "P4").sort((a: any, b: any) => Number(b.taxAdjustedMarginPerDay) - Number(a.taxAdjustedMarginPerDay))[0];
  const spare = (analysis.empire.characters ?? []).find((row: any) => row.spareColonies > 0);
  if (best && spare) addRecommendation(recommendations, {
    id: `spare:${spare.characterId}:${best.output.typeId}`,
    rank: 5,
    kind: "use-spare-slot",
    title: `Use a spare colony slot for ${best.output.name}`,
    characterId: spare.characterId,
    characterName: spare.characterName,
    planetId: 0,
    planetLabel: "Best compatible surveyed planet",
    reason: `${spare.characterName} has ${spare.spareColonies} spare colony slot${spare.spareColonies === 1 ? "" : "s"}. This avoids repurposing a working colony.`,
    actions: ["Open the product in Planetary Planner", "Prefer the highest complete bottleneck-density result, then validate current margin"],
    estimatedGainIskPerDay: best.taxAdjustedMarginPerDay,
    estimatedCostIsk: null,
    confidence: 0.58,
  });

  if (best) for (const colony of analysis.empire.colonies ?? []) {
    const current = Math.max(0, Number(colony.configuredMarginCapacityPerDay ?? 0));
    const gain = Number(best.taxAdjustedMarginPerDay) - current;
    if (gain <= 2_000_000 || Number(best.taxAdjustedMarginPerDay) <= Math.max(1, current) * 1.25) continue;
    addRecommendation(recommendations, {
      id: `repurpose:${colony.characterId}:${colony.planetId}:${best.output.typeId}`,
      rank: 4,
      kind: "repurpose-colony",
      title: `Consider repurposing to ${best.output.name}`,
      characterId: colony.characterId,
      characterName: colony.characterName,
      planetId: colony.planetId,
      planetLabel: `${colony.solarSystemName} · ${colony.planetType}`,
      reason: `Only surfaced because the estimated improvement is material: roughly ${Math.round(gain).toLocaleString()} ISK/day above configured margin capacity.`,
      actions: ["Compare against downstream demand and hauling first", "Repurpose only if simple fixes and spare slots are insufficient"],
      estimatedGainIskPerDay: gain,
      estimatedCostIsk: null,
      confidence: 0.58,
      destructive: true,
    });
  }

  recommendations.sort((a, b) => a.rank - b.rank || Number(b.estimatedGainIskPerDay ?? -Infinity) - Number(a.estimatedGainIskPerDay ?? -Infinity));
  return {
    generatedAt: new Date().toISOString(),
    recommendations,
    summary: {
      total: recommendations.length,
      simple: recommendations.filter((row) => row.rank <= 2).length,
      repurpose: recommendations.filter((row) => row.destructive).length,
      valued: recommendations.filter((row) => row.estimatedGainIskPerDay != null).length,
    },
    principle: "Prefer the minimum useful intervention: restart/retarget, then small layout or supply fixes, then processors, repurpose, spare slots, and only finally a rebuild.",
  };
}

export function buildPlanetaryAlertQueue(analysis: any, optimizer: ReturnType<typeof buildOptimizerFromAnalysis>, alertSettings?: PlanetaryAlertSettings) {
  const settings = normalizeAlertSettings(alertSettings);
  const derived: any[] = [];

  for (const colony of analysis.empire.colonies ?? []) {
    const effective = effectiveAlertSettings(settings, colony.characterId, colony.planetId);
    for (const threshold of effective.storageThresholds) {
      if (!effective.enabled[`storage-${threshold}`]) continue;
      const storage = (colony.storage ?? []).find((row: any) => Number(row.fillPercent) >= threshold);
      if (!storage) continue;
      derived.push({
        id: `${colony.characterId}:${colony.planetId}:storage-${threshold}`,
        severity: threshold >= 95 ? "critical" : "warning",
        type: `storage-${threshold}`,
        characterId: colony.characterId,
        characterName: colony.characterName,
        planetId: colony.planetId,
        planetLabel: `${colony.solarSystemName} · ${colony.planetType}`,
        message: `${storage.name} is ${Number(storage.fillPercent).toFixed(0)}% full (threshold ${threshold}%).`,
        hoursUntil: storage.hoursToFull ?? null,
      });
    }
    if (effective.enabled["colony-idle"] && colony.activeExtractors === 0 && colony.processors === 0) derived.push({
      id: `${colony.characterId}:${colony.planetId}:idle`,
      severity: "warning",
      type: "colony-idle",
      characterId: colony.characterId,
      characterName: colony.characterName,
      planetId: colony.planetId,
      planetLabel: `${colony.solarSystemName} · ${colony.planetType}`,
      message: "Colony has no active extractors or processors.",
      hoursUntil: null,
    });
  }

  const stockpile = new Map<number, number>((analysis.stockpile ?? []).map((row: any) => [Number(row.typeId), Number(row.quantity)] as [number, number]));
  for (const demand of analysis.industryDemand ?? []) {
    const shortage = Math.max(0, Number(demand.baseQuantity) - (stockpile.get(Number(demand.typeId)) ?? 0));
    if (shortage > 0 && settings.enabled["production-deficit"]) derived.push({
      id: `empire:demand:${demand.typeId}`,
      severity: "warning",
      type: "production-deficit",
      characterId: analysis.character.id,
      characterName: "Empire",
      planetId: 0,
      planetLabel: "Industrial demand",
      message: `${demand.name} is short by ${Math.round(shortage).toLocaleString()} units against active industry demand.`,
      hoursUntil: null,
    });
  }

  const valuable = optimizer.recommendations.find((row) => row.estimatedGainIskPerDay != null && row.estimatedGainIskPerDay >= settings.optimizerMinIskPerDay);
  if (valuable && settings.enabled["optimizer-value"]) derived.push({
    id: `optimizer:${valuable.id}`,
    severity: "info",
    type: "optimizer-value",
    characterId: valuable.characterId ?? analysis.character.id,
    characterName: valuable.characterName,
    planetId: valuable.planetId,
    planetLabel: valuable.planetLabel,
    message: `Optimizer found ${valuable.title} worth about ${Math.round(valuable.estimatedGainIskPerDay!).toLocaleString()} ISK/day.`,
    hoursUntil: null,
  });

  const all = [...(analysis.empire.alerts ?? []), ...derived];
  const seen = new Set<string>();
  return all.filter((alert) => {
    if (seen.has(alert.id)) return false;
    seen.add(alert.id);
    const effective = effectiveAlertSettings(settings, String(alert.characterId ?? ""), Number(alert.planetId ?? 0));
    const key = alertFeatureKey(alert);
    if (key === "extractor-6h" && Number(alert.hoursUntil) > 6) return false;
    if (key === "stockpile-low" && Number(alert.hoursUntil) > effective.stockpileDays * 24) return false;
    return effective.enabled[key] !== false;
  }).sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.severity as "critical" | "warning" | "info"] ?? 3) - ({ critical: 0, warning: 1, info: 2 }[b.severity as "critical" | "warning" | "info"] ?? 3) || (a.hoursUntil ?? Infinity) - (b.hoursUntil ?? Infinity));
}

export async function analyzePlanetaryAdvanced(snapshot: any, allSnapshots: any[], input: { settings?: PlanetaryRevenueSettings; observations?: PlanetaryResourceObservation[]; alertSettings?: PlanetaryAlertSettings }) {
  const observations = (input.observations ?? []).map(normalizePlanetaryObservation).filter((row): row is PlanetaryResourceObservation => Boolean(row));
  const alertSettings = normalizeAlertSettings(input.alertSettings);
  const analysis = await analyzePlanetaryRevenue(snapshot, allSnapshots, { ...(input.settings ?? {}), resourceObservations: observations, alertSettings });
  const optimizer = buildOptimizerFromAnalysis(analysis, observations);
  const alerts = buildPlanetaryAlertQueue(analysis, optimizer, alertSettings);
  return {
    ...analysis,
    alerts: alerts.filter((row) => row.characterId === String(snapshot.characterId)),
    empire: { ...analysis.empire, alerts, totals: { ...analysis.empire.totals, alerts: alerts.length } },
    optimizer,
    survey: summarizeSurvey(observations),
    alertSettings,
  };
}

export type PlanetaryBasketInput = PlanetaryRevenueSettings & {
  characterId: string;
  targets: Array<{ typeId: number; quantity: number; period: "day" | "week" }>;
  mode?: PlanetaryPlanMode;
  hybridBuildTypeIds?: number[];
  originSystemId?: number;
  finderSecurity?: "any" | "high" | "low" | "null";
  horizonDays?: number;
  resourceObservations?: PlanetaryResourceObservation[];
};

export async function buildPlanetaryBasketPlan(snapshot: any, allSnapshots: any[], analysis: any, input: PlanetaryBasketInput) {
  const horizonDays = clamp(Number(input.horizonDays ?? 7), 1, 30);
  const stock = new Map<number, number>((analysis.stockpile ?? []).map((row: any) => [Number(row.typeId), Number(row.quantity)] as [number, number]));
  const currentProduction = new Map<number, number>();
  for (const colony of analysis.empire.colonies ?? []) for (const recipe of colony.recipes ?? []) {
    const typeId = Number(recipe.outputTypeId ?? 0);
    if (!typeId || colony.starvedProcessors) continue;
    currentProduction.set(typeId, (currentProduction.get(typeId) ?? 0) + Number(recipe.outputPerDay ?? 0));
  }

  const targets: any[] = [];
  const plans: any[] = [];
  for (const target of input.targets ?? []) {
    const opportunity = (analysis.opportunities ?? []).find((row: any) => Number(row.output.typeId) === Number(target.typeId));
    if (!opportunity) continue;
    const periodDays = target.period === "week" ? 7 : 1;
    const requested = Math.max(0, Number(target.quantity));
    const available = stock.get(Number(target.typeId)) ?? 0;
    const stockApplied = Math.min(available, requested);
    stock.set(Number(target.typeId), available - stockApplied);
    const currentApplied = Math.min(Math.max(0, requested - stockApplied), (currentProduction.get(Number(target.typeId)) ?? 0) * periodDays);
    const productionNeed = Math.max(0, requested - stockApplied - currentApplied);
    const perDay = productionNeed / periodDays;
    const finalProcessors = perDay > 0 ? Math.max(1, Math.ceil(perDay / Math.max(1e-9, Number(opportunity.output.quantityPerDay)))) : 0;
    let plan: any = null;
    if (finalProcessors > 0) {
      const planInput: PlanetaryPlanInput = {
        characterId: input.characterId,
        productTypeId: Number(target.typeId),
        finalProcessors,
        mode: input.mode ?? "full",
        hybridBuildTypeIds: input.hybridBuildTypeIds,
        originSystemId: input.originSystemId,
        maxJumps: input.maxJumps,
        finderSecurity: input.finderSecurity,
        resourceObservations: input.resourceObservations,
        pocoOwnerTaxPercent: input.pocoOwnerTaxPercent,
        brokerFeePercent: input.brokerFeePercent,
        assumedSecurity: input.assumedSecurity,
        cargoM3: input.cargoM3,
        haulingCostPerTripIsk: input.haulingCostPerTripIsk,
        runtimeHours: input.runtimeHours,
      };
      plan = await buildPlanetaryPlan(snapshot, allSnapshots, planInput);
      plans.push(plan);
    }
    targets.push({
      typeId: Number(target.typeId),
      name: opportunity.output.name,
      tier: opportunity.tier,
      period: target.period,
      requested,
      requestedPerDay: requested / periodDays,
      stockApplied,
      currentProductionApplied: currentApplied,
      productionNeed,
      productionNeedPerDay: perDay,
      finalProcessors,
      marketUnitPrice: opportunity.output.bestSell,
      plan,
    });
  }

  const processorMap = new Map<number, any>();
  const externalMap = new Map<number, any>();
  const sourceMap = new Map<string, any>();
  const roles = new Map<string, any>();
  const systems = new Map<number, any>();
  let allLayoutsFit = true;
  for (const plan of plans) {
    allLayoutsFit = allLayoutsFit && Boolean(plan.layout?.fits);
    for (const processor of plan.chain.processors ?? []) {
      const current = processorMap.get(processor.schematicId);
      processorMap.set(processor.schematicId, { ...processor, equivalent: (current?.equivalent ?? 0) + processor.equivalent, dedicated: (current?.dedicated ?? 0) + processor.dedicated });
    }
    for (const external of plan.chain.externalInputs ?? []) {
      const current = externalMap.get(external.typeId);
      externalMap.set(external.typeId, { ...external, quantityPerDay: (current?.quantityPerDay ?? 0) + external.quantityPerDay });
    }
    for (const source of plan.sourceDecisions ?? []) {
      const key = `${source.decision}:${source.typeId}`;
      const current = sourceMap.get(key);
      sourceMap.set(key, { ...source, quantityPerDay: (current?.quantityPerDay ?? 0) + source.quantityPerDay });
    }
    for (const role of plan.allocation?.planetRoles ?? []) {
      const key = `${role.planetTypeId}:${[...(role.resourceTypeIds ?? [])].sort((a: number, b: number) => a - b).join(",")}`;
      if (!roles.has(key)) roles.set(key, role);
    }
    for (const system of plan.systemFinder?.systems ?? []) {
      const current = systems.get(system.systemId);
      systems.set(system.systemId, { ...system, basketScore: (current?.basketScore ?? 0) + Number(system.score ?? 0), targetCoverage: (current?.targetCoverage ?? 0) + 1 });
    }
  }

  const externalInputs = [...externalMap.values()];
  const refill = externalInputs.map((row) => {
    const need = row.quantityPerDay * horizonDays;
    const have = stock.get(row.typeId) ?? 0;
    const stockApplied = Math.min(have, need);
    stock.set(row.typeId, have - stockApplied);
    return { ...row, need, have, stockApplied, shortage: Math.max(0, need - stockApplied), shortagePerDay: Math.max(0, need - stockApplied) / horizonDays };
  });

  const activeTargets = targets.filter((row) => row.finalProcessors > 0);
  const acquisitionCostPerDay = activeTargets.every((row) => row.plan?.target?.inputAcquisitionCostPerDay != null) ? activeTargets.reduce((sum, row) => sum + Number(row.plan.target.inputAcquisitionCostPerDay), 0) : null;
  const customsTaxPerDay = activeTargets.reduce((sum, row) => sum + Number(row.plan?.target?.importTaxPerDay ?? 0) + Number(row.plan?.target?.exportTaxPerDay ?? 0), 0);
  const totalM3PerDay = activeTargets.reduce((sum, row) => sum + Number(row.plan?.hauling?.totalM3PerDay ?? 0), 0);
  const cargo = Math.max(1, Number(input.cargoM3 ?? analysis.settings.cargoM3 ?? 10_000));
  const tripsPerWeek = totalM3PerDay > 0 ? Math.ceil(totalM3PerDay * 7 / cargo) : 0;
  const haulingCostPerDay = tripsPerWeek * Math.max(0, Number(input.haulingCostPerTripIsk ?? analysis.settings.haulingCostPerTripIsk ?? 0)) / 7;
  const productionCostPerDay = acquisitionCostPerDay == null ? null : acquisitionCostPerDay + customsTaxPerDay + haulingCostPerDay;
  const marketBuyCostPerDay = targets.every((row) => row.marketUnitPrice != null) ? targets.reduce((sum, row) => sum + Number(row.marketUnitPrice) * row.requestedPerDay, 0) : null;
  const savingsPerDay = marketBuyCostPerDay == null || productionCostPerDay == null ? null : marketBuyCostPerDay - productionCostPerDay;

  const availableSlots = (analysis.empire.characters ?? []).flatMap((character: any) => Array.from({ length: character.spareColonies }, () => character));
  const requiredFactoryColonies = activeTargets.length;
  const requiredExtractionColonies = roles.size;
  const planetsRequired = requiredFactoryColonies + requiredExtractionColonies;
  const assignments = Array.from({ length: planetsRequired }, (_, index) => ({
    index,
    role: index < requiredFactoryColonies ? `Factory ${index + 1}` : `Extraction ${index - requiredFactoryColonies + 1}`,
    characterId: availableSlots[index]?.characterId ?? null,
    characterName: availableSlots[index]?.characterName ?? null,
    assigned: Boolean(availableSlots[index]),
  }));

  return {
    generatedAt: new Date().toISOString(),
    mode: input.mode ?? "full",
    horizonDays,
    targets,
    processors: [...processorMap.values()],
    externalInputs,
    refill,
    sourceDecisions: [...sourceMap.values()],
    planetRoles: [...roles.values()],
    systemCandidates: [...systems.values()].sort((a, b) => b.targetCoverage - a.targetCoverage || b.basketScore - a.basketScore).slice(0, 30),
    allocation: {
      assignments,
      planetsRequired,
      requiredFactoryColonies,
      requiredExtractionColonies,
      availableColonies: availableSlots.length,
      deficit: Math.max(0, planetsRequired - availableSlots.length),
      sparePlanets: Math.max(0, availableSlots.length - planetsRequired),
    },
    feasibility: { allLayoutsFit, plansChecked: activeTargets.length },
    economics: {
      marketBuyCostPerDay,
      marketBuyCostPerWeek: marketBuyCostPerDay == null ? null : marketBuyCostPerDay * 7,
      productionCostPerDay,
      productionCostPerWeek: productionCostPerDay == null ? null : productionCostPerDay * 7,
      savingsPerDay,
      savingsPerWeek: savingsPerDay == null ? null : savingsPerDay * 7,
      acquisitionCostPerDay,
      customsTaxPerDay,
      haulingCostPerDay,
      totalM3PerDay,
      tripsPerWeek,
    },
    shortages: refill.filter((row) => row.shortage > 0),
  };
}

export type PlanetaryDesignerNode = {
  id: string;
  typeId: number;
  x: number;
  y: number;
  label?: string;
  schematicId?: number | null;
  inputM3PerHour?: number;
  outputM3PerHour?: number;
  inputUnitsPerHour?: number;
  outputUnitsPerHour?: number;
  productTypeId?: number;
  templatePinIndex?: number;
};

export type PlanetaryDesignerInput = {
  planetTypeId: number;
  targetTypeId?: number;
  planetType?: string;
  planetRadiusKm: number;
  ccuLevel: number;
  commandCenter: { typeId: number; name: string; cpuOutput: number; powerOutput: number } | null;
  palette: Array<{ typeId: number; name: string; kind: string; cpu: number; power: number; capacityM3: number; requiredLevel?: number; headCpu?: number; headPower?: number }>;
  nodes: PlanetaryDesignerNode[];
  links: Array<{ sourceId: string; destinationId: string; level?: number }>;
};

export function evaluatePlanetaryDesignerLayout(input: PlanetaryDesignerInput) {
  const palette = new Map(input.palette.map((row) => [Number(row.typeId), row]));
  const nodeMap = new Map(input.nodes.map((row) => [row.id, row]));
  let facilityCpu = 0;
  let facilityPower = 0;
  let storageCapacityM3 = 0;
  let inputM3PerHour = 0;
  let outputM3PerHour = 0;
  let processorInputUnitsPerHour = 0;
  let processorOutputUnitsPerHour = 0;
  const nodes = input.nodes.map((node) => {
    const facility = palette.get(Number(node.typeId)) ?? null;
    if (facility) {
      facilityCpu += Number(facility.cpu ?? 0);
      facilityPower += Number(facility.power ?? 0);
      if (facility.kind === "launchpad" || facility.kind === "storage") storageCapacityM3 += Number(facility.capacityM3 ?? 0);
    }
    inputM3PerHour += Number(node.inputM3PerHour ?? 0);
    outputM3PerHour += Number(node.outputM3PerHour ?? 0);
    processorInputUnitsPerHour += Number(node.inputUnitsPerHour ?? 0);
    processorOutputUnitsPerHour += Number(node.outputUnitsPerHour ?? 0);
    return { ...node, facility };
  });

  let linkCpu = 0;
  let linkPower = 0;
  let totalLinkKm = 0;
  const links = input.links.map((link) => {
    const a = nodeMap.get(link.sourceId);
    const b = nodeMap.get(link.destinationId);
    if (!a || !b) return { ...link, valid: false, distanceKm: 0, cpu: 0, power: 0 };
    const dx = Number(a.x) - Number(b.x);
    const dy = Number(a.y) - Number(b.y);
    const normalizedDistance = Math.min(2, Math.sqrt(dx * dx + dy * dy));
    const distanceKm = Math.max(0.001, normalizedDistance * Math.PI * Math.max(1, input.planetRadiusKm) / 2);
    const cpu = 15 + 0.2 * distanceKm;
    const power = 10 + 0.15 * distanceKm;
    linkCpu += cpu;
    linkPower += power;
    totalLinkKm += distanceKm;
    return { ...link, valid: true, distanceKm, cpu, power };
  });

  const cpuCapacity = Number(input.commandCenter?.cpuOutput ?? 0);
  const powerCapacity = Number(input.commandCenter?.powerOutput ?? 0);
  const cpuUsed = facilityCpu + linkCpu;
  const powerUsed = facilityPower + linkPower;
  const cpuRatio = cpuUsed > 0 ? cpuCapacity / cpuUsed : 1;
  const powerRatio = powerUsed > 0 ? powerCapacity / powerUsed : 1;
  const throughputPercent = clamp(100 * Math.min(1, cpuRatio, powerRatio), 0, 100);
  const bufferHours = inputM3PerHour > 0 ? storageCapacityM3 / inputM3PerHour : null;
  let firstBottleneck = "None detected";
  if (cpuUsed > cpuCapacity) firstBottleneck = "CPU";
  else if (powerUsed > powerCapacity) firstBottleneck = "Powergrid";
  else if (bufferHours != null && bufferHours < 24) firstBottleneck = "Storage buffer";
  else if (links.some((row) => !row.valid)) firstBottleneck = "Broken link";

  return {
    planetTypeId: input.planetTypeId,
    planetType: input.planetType ?? "Planet",
    planetRadiusKm: input.planetRadiusKm,
    ccuLevel: input.ccuLevel,
    commandCenter: input.commandCenter,
    nodes,
    links,
    facilityCpu,
    facilityPower,
    linkCpu,
    linkPower,
    cpuUsed,
    powerUsed,
    cpuCapacity,
    powerCapacity,
    cpuSpare: cpuCapacity - cpuUsed,
    powerSpare: powerCapacity - powerUsed,
    totalLinkKm,
    storageCapacityM3,
    processorInputUnitsPerHour,
    processorOutputUnitsPerHour,
    inputM3PerHour,
    outputM3PerHour,
    bufferHours,
    throughputPercent,
    firstBottleneck,
    fits: Boolean(input.commandCenter && cpuUsed <= cpuCapacity && powerUsed <= powerCapacity && links.every((row) => row.valid)),
    palette: input.palette,
    linkEstimateBasis: "Link CPU/PG is an estimate derived from the proposed 2D geometry and planet radius. Facility CPU/PG is deterministic CCP SDE data.",
  };
}

export type PlanetaryDesignerProfile = "throughput" | "balanced" | "maintenance";

export type PlanetaryDesignerCandidate = {
  profile: PlanetaryDesignerProfile;
  label: string;
  description: string;
  layout: PlanetaryDesignerInput;
  result: ReturnType<typeof evaluatePlanetaryDesignerLayout>;
};

function cloneDesigner(input: PlanetaryDesignerInput): PlanetaryDesignerInput {
  return { ...input, palette: input.palette.map((row) => ({ ...row })), nodes: input.nodes.map((row) => ({ ...row })), links: input.links.map((row) => ({ ...row })) };
}

function designerKinds(input: PlanetaryDesignerInput) {
  return new Map(input.palette.map((row) => [Number(row.typeId), row.kind]));
}

function ensureMaintenanceStorage(input: PlanetaryDesignerInput, targetHours: number) {
  let current = cloneDesigner(input);
  const kinds = designerKinds(current);
  const launchpad = current.nodes.find((node) => kinds.get(Number(node.typeId)) === "launchpad") ?? null;
  if (!launchpad) return current;
  const storageFacility = current.palette.find((row) => row.kind === "storage");
  if (!storageFacility) return current;
  const initial = evaluatePlanetaryDesignerLayout(current);
  if (initial.bufferHours != null && initial.bufferHours >= targetHours) return current;
  let storageNodes = current.nodes.filter((node) => kinds.get(Number(node.typeId)) === "storage");
  for (let index = storageNodes.length; index < 2; index += 1) {
    const storage = { id: `auto-storage-${index + 1}`, typeId: storageFacility.typeId, x: 0.035 + index * 0.025, y: 0, label: `Maintenance Storage ${index + 1}` };
    current.nodes.push(storage);
    storageNodes = [...storageNodes, storage];
    const serviceHub = storageNodes[0];
    const rewritten = current.links.map((link) => {
      if (link.sourceId === launchpad.id && link.destinationId !== serviceHub.id) return { ...link, sourceId: serviceHub.id };
      if (link.destinationId === launchpad.id && link.sourceId !== serviceHub.id) return { ...link, destinationId: serviceHub.id };
      return link;
    });
    if (!rewritten.some((link) => (link.sourceId === launchpad.id && link.destinationId === serviceHub.id) || (link.destinationId === launchpad.id && link.sourceId === serviceHub.id))) {
      rewritten.push({ sourceId: launchpad.id, destinationId: serviceHub.id, level: 0 });
    }
    if (index > 0 && !rewritten.some((link) => (link.sourceId === storageNodes[index - 1].id && link.destinationId === storage.id) || (link.destinationId === storageNodes[index - 1].id && link.sourceId === storage.id))) {
      rewritten.push({ sourceId: storageNodes[index - 1].id, destinationId: storage.id, level: 0 });
    }
    current.links = rewritten;
    const evaluation = evaluatePlanetaryDesignerLayout(current);
    if (!evaluation.fits) { current.nodes = current.nodes.filter((node) => node.id !== storage.id); current.links = current.links.filter((link) => link.sourceId !== storage.id && link.destinationId !== storage.id); break; }
    if (evaluation.bufferHours != null && evaluation.bufferHours >= targetHours) break;
  }
  return current;
}

function arrangeDesigner(input: PlanetaryDesignerInput, profile: PlanetaryDesignerProfile) {
  let current = cloneDesigner(input);
  if (profile === "maintenance") current = ensureMaintenanceStorage(current, 72);
  else if (profile === "balanced") current = ensureMaintenanceStorage(current, 24);
  const kinds = designerKinds(current);
  const launchpad = current.nodes.find((node) => kinds.get(Number(node.typeId)) === "launchpad") ?? current.nodes[0] ?? null;
  if (!launchpad) return current;
  const storage = current.nodes.find((node) => kinds.get(Number(node.typeId)) === "storage") ?? null;
  const serviceHub = profile === "maintenance" && storage ? storage : launchpad;
  const radiusBase = profile === "throughput" ? 0.028 : profile === "balanced" ? 0.048 : 0.038;
  const nodes = current.nodes.map((node) => ({ ...node }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const hub = byId.get(launchpad.id)!; hub.x = 0; hub.y = 0;
  if (storage) { const row=byId.get(storage.id)!; row.x = profile === "maintenance" ? 0.025 : 0.04; row.y = 0; }
  let commandIndex = 0;
  let activeIndex = 0;
  for (const node of nodes) {
    if (node.id === launchpad.id || node.id === storage?.id) continue;
    const kind = kinds.get(Number(node.typeId));
    if (kind === "command") { const angle = commandIndex++ * 2.4 + 2.7; node.x = Math.cos(angle) * 0.22; node.y = Math.sin(angle) * 0.22; continue; }
    const ring = radiusBase + Math.floor(activeIndex / 10) * radiusBase * 0.7;
    const angle = activeIndex * 2.3999632297;
    const centreX = serviceHub.id === launchpad.id ? 0 : (byId.get(serviceHub.id)?.x ?? 0);
    const centreY = serviceHub.id === launchpad.id ? 0 : (byId.get(serviceHub.id)?.y ?? 0);
    node.x = Number((centreX + Math.cos(angle) * ring).toFixed(6));
    node.y = Number((centreY + Math.sin(angle) * ring).toFixed(6));
    activeIndex += 1;
  }
  return { ...current, nodes };
}

export function generatePlanetaryDesignerLayouts(input: PlanetaryDesignerInput): PlanetaryDesignerCandidate[] {
  const definitions: Array<{profile:PlanetaryDesignerProfile;label:string;description:string}> = [
    { profile:"throughput", label:"Max throughput", description:"Keeps the planned facilities and compresses the working network around the transport hub to minimise estimated link burden." },
    { profile:"balanced", label:"Balanced", description:"Compacts the colony while preserving or adding enough storage for roughly a 24-hour operating buffer when the grid allows it." },
    { profile:"maintenance", label:"Low maintenance", description:"Prioritises a storage-backed service hub and up to roughly 72 hours of buffer before spending additional CPU/PG." },
  ];
  return definitions.map((definition) => { const layout=arrangeDesigner(input,definition.profile); return { ...definition, layout, result:evaluatePlanetaryDesignerLayout(layout) }; });
}

function shortestDesignerPath(links: PlanetaryDesignerInput["links"], from: string, to: string) {
  if (from === to) return [from];
  const neighbours = new Map<string,string[]>();
  for (const link of links) {
    const a=neighbours.get(link.sourceId)??[]; a.push(link.destinationId); neighbours.set(link.sourceId,a);
    const b=neighbours.get(link.destinationId)??[]; b.push(link.sourceId); neighbours.set(link.destinationId,b);
  }
  const queue=[[from]]; const seen=new Set([from]);
  while(queue.length){ const path=queue.shift()!; const last=path[path.length-1]; for(const next of neighbours.get(last)??[]){ if(seen.has(next))continue; const candidate=[...path,next]; if(next===to)return candidate; seen.add(next); queue.push(candidate); } }
  return null;
}

export function buildPlanetaryDesignerEveTemplate(input: PlanetaryDesignerInput, baseTemplate: any, comment?: string) {
  const warnings:string[]=[];
  if (!baseTemplate || !Array.isArray(baseTemplate.P)) return { template:null, warnings:["The planner has no EVE template to use as the route/schematic source."] };
  const kinds=designerKinds(input);
  const exportNodes=input.nodes.filter((node)=>kinds.get(Number(node.typeId))!=="command");
  const ordered=[...exportNodes].sort((a,b)=>{ const ai=Number(a.templatePinIndex??0), bi=Number(b.templatePinIndex??0); if(ai&&bi)return ai-bi; if(ai)return -1;if(bi)return 1; const ak=kinds.get(Number(a.typeId))==="launchpad"?0:1,bk=kinds.get(Number(b.typeId))==="launchpad"?0:1; return ak-bk||a.id.localeCompare(b.id); });
  const nodeToIndex=new Map<string,number>(); const oldIndexToNode=new Map<number,string>();
  const pins=ordered.map((node,index)=>{ const pinIndex=index+1; nodeToIndex.set(node.id,pinIndex); const old=Number(node.templatePinIndex??0); if(old>0)oldIndexToNode.set(old,node.id); const basePin=old>0?baseTemplate.P[old-1]:null; const la=Number((1.12+clamp(Number(node.y),-.95,.95)*.25).toFixed(5)); const lo=Number((1.55+clamp(Number(node.x),-.95,.95)*.25).toFixed(5)); const product=node.productTypeId??basePin?.S??null; const kind=kinds.get(Number(node.typeId)); if((kind==="basic"||kind==="advanced"||kind==="hightech")&&product==null)warnings.push(`${node.label??node.id} has no schematic/product assignment; its exported pin is unconfigured.`); return {H:0,La:la,Lo:lo,S:product,T:Number(node.typeId)}; });
  const links=input.links.flatMap((link)=>{ const source=nodeToIndex.get(link.sourceId),destination=nodeToIndex.get(link.destinationId); if(!source||!destination)return []; return [{D:destination,Lv:Number(link.level??0),S:source}]; });
  const routes=(Array.isArray(baseTemplate.R)?baseTemplate.R:[]).flatMap((route:any)=>{ const path=Array.isArray(route?.P)?route.P.map(Number):[]; if(path.length<2)return []; const fromNode=oldIndexToNode.get(path[0]),toNode=oldIndexToNode.get(path[path.length-1]); if(!fromNode||!toNode){warnings.push(`A planner route could not be mapped after the layout was edited.`);return [];} const nodePath=shortestDesignerPath(input.links,fromNode,toNode); if(!nodePath){warnings.push(`No designer link path exists for route ${route.T??"unknown"}; the route was omitted.`);return [];} const pinPath=nodePath.map((id)=>nodeToIndex.get(id)).filter((value):value is number=>Boolean(value)); if(pinPath.length!==nodePath.length)return []; return [{...route,P:pinPath}]; });
  const evaluation=evaluatePlanetaryDesignerLayout(input);
  if(!evaluation.fits)warnings.push("The current layout exceeds CPU/PG or contains an invalid link; import may fail until it fits.");
  return {template:{CmdCtrLv:input.ccuLevel,Cmt:comment||String(baseTemplate.Cmt??"Sage - Custom PI Layout"),Diam:Number((input.planetRadiusKm*2).toFixed(3)),L:links,P:pins,Pln:input.planetTypeId,R:routes},warnings};
}

function readField(value: any, ...keys: string[]) {
  for (const key of keys) if (value?.[key] != null) return value[key];
  return undefined;
}

export function buildPlanetaryDesignerSeedFromSnapshot(snapshot: any, planetId: number) {
  const wrapper = (Array.isArray(snapshot?.extended?.planetDetails) ? snapshot.extended.planetDetails : []).find((row: any) => Number(readField(row, "planet_id", "planetId")) === Number(planetId));
  const colony = wrapper?.colony ?? wrapper;
  if (!colony) return null;
  const nodes = (Array.isArray(colony.pins) ? colony.pins : []).map((pin: any, index: number) => {
    const latitude = Number(readField(pin, "latitude") ?? 0);
    const longitude = Number(readField(pin, "longitude") ?? 0);
    return {
      id: String(readField(pin, "pin_id", "pinId") ?? `pin-${index}`),
      typeId: Number(readField(pin, "type_id", "typeId") ?? 0),
      schematicId: Number(readField(pin?.factory_details, "schematic_id", "schematicId") ?? 0) || null,
      x: Number((Math.cos(latitude) * Math.cos(longitude)).toFixed(6)),
      y: Number(Math.sin(latitude).toFixed(6)),
    };
  });
  const links = (Array.isArray(colony.links) ? colony.links : []).map((link: any) => ({
    sourceId: String(readField(link, "source_pin_id", "sourcePinId") ?? ""),
    destinationId: String(readField(link, "destination_pin_id", "destinationPinId") ?? ""),
    level: Number(readField(link, "link_level", "linkLevel") ?? 0),
  }));
  return { nodes, links };
}
