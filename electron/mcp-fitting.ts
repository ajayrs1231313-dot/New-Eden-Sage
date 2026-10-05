import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { analyzeFittingDogma, resolveFittingTypeNamesLocal, resolveFittingTypeIdsLocal, getFittingTypeInfoLocal } from "./fitting-dogma";
import { importFits, validateImportedFit, type ImportedFitItem } from "./fitting-import";

type EngineInput = Parameters<typeof analyzeFittingDogma>[0];
export type SimulateSageFitInput = {
  characterId: string;
  fit?: unknown;
  fitId?: string;
  targetProfile?: EngineInput["targetProfile"];
  targetTypeId?: number;
  damageProfile?: EngineInput["damageProfile"];
  includeCurrentImplants?: boolean;
  includePrices?: boolean;
  mechanicState?: EngineInput["mechanicState"];
};
type Dependencies = {
  getSnapshot(characterId: string): unknown;
  getSavedFits(): Promise<Array<Record<string, unknown>>>;
  getMarketQuotes?: typeof import("./market-intelligence")["loadGlobalMarketQuotes"];
};
const racks = ["low", "mid", "high", "rig", "subsystem", "drones", "fighters", "cargo", "implants", "boosters"] as const;

export async function simulateSageFits(input: Omit<SimulateSageFitInput, "fit" | "fitId"> & {
  fits: Array<{ fit?: unknown; fitId?: string }>;
  batchDetail?: "summary" | "full";
}, deps: Dependencies) {
  if (!input.fits.length || input.fits.length > 100) throw new Error("Supply between 1 and 100 fits per batch.");
  if (input.batchDetail === "full" && input.fits.length > 20) throw new Error("Full diagnostics support up to 20 fits; use summary for larger batches.");
  const snapshot = deps.getSnapshot(input.characterId);
  let saved: Promise<Array<Record<string, unknown>>> | undefined;
  const quotes = new Map<string, ReturnType<NonNullable<Dependencies["getMarketQuotes"]>>>();
  const batchDeps: Dependencies = {
    getSnapshot: () => snapshot,
    getSavedFits: () => saved ??= deps.getSavedFits(),
    getMarketQuotes: async (ids) => {
      const key = ids ? [...ids].sort((a, b) => a - b).join(",") : "all";
      if (!quotes.has(key)) quotes.set(key, (deps.getMarketQuotes ?? (await import("./market-intelligence.js")).loadGlobalMarketQuotes)(ids));
      return quotes.get(key)!;
    },
  };
  const results: Array<{ index: number; success: boolean; data?: unknown; error?: string }> = new Array(input.fits.length);
  let next = 0;
  const { fits, batchDetail, ...shared } = input;
  await Promise.all(Array.from({ length: Math.min(4, fits.length) }, async () => {
    while (next < fits.length) {
      const index = next++;
      try {
        const data = await simulateSageFit({ ...shared, ...fits[index] }, batchDeps);
        const a = data.analysis;
        const analysis = batchDetail === "full" ? a : {
          damage: Object.fromEntries(Object.entries(a.damage).filter(([, value]) => typeof value === "number" || typeof value === "boolean")),
          defence: a.defence, capacitor: a.capacitor, navigation: a.navigation,
          resources: a.resources, fitting: a.fitting, storage: a.storage,
          targeting: a.targeting, supportSystems: a.supportSystems,
          issues: a.issues, missingRequirements: a.missingRequirements,
        };
        results[index] = { index, success: true, data: { ...data, analysis } };
      }
      catch (error) { results[index] = { index, success: false, error: error instanceof Error ? error.message : "Simulation failed" }; }
    }
  }));
  return { characterId: input.characterId, batchDetail: batchDetail ?? "summary", total: results.length, succeeded: results.filter((r) => r.success).length, failed: results.filter((r) => !r.success).length, results };
}

export async function simulateSageFit(input: SimulateSageFitInput, deps: Dependencies) {
  if (!/^\d+$/.test(input.characterId)) throw new Error("Provide the selected Sage character ID.");
  if ((input.fit !== undefined) === Boolean(input.fitId)) throw new Error("Provide exactly one of fit or fitId.");
  const snapshot = deps.getSnapshot(input.characterId) as any;
  if (!snapshot?.character?.name || !Array.isArray(snapshot.skills?.skills) || !snapshot.skills.skills.length) {
    throw new Error("Character or synced skills are unavailable. Sync the selected character in Sage first.");
  }
  const payload = input.fitId
    ? (await deps.getSavedFits()).find((fit) => fit.id === input.fitId)
    : input.fit;
  if (payload === undefined) throw new Error(`Saved fit not found: ${input.fitId}`);
  const parsed = importFits(payload);
  if (parsed.length !== 1) throw new Error("Simulate one fit per call.");
  const fit = validateImportedFit(parsed[0]);
  const entries = [fit.hull, ...racks.flatMap((rack) => fit[rack])];
  if (entries.length > 512) throw new Error("Fit contains too many item entries (maximum 512).");
  for (const rack of racks) {
    for (const item of fit[rack]) {
      if (item.quantity > (rack === "cargo" ? 1_000_000_000 : 1000)) throw new Error(`Excessive quantity for ${item.name} in ${rack}.`);
      if (item.attributeOverrides && Object.values(item.attributeOverrides).some((value) => !Number.isFinite(value))) throw new Error(`Invalid attribute override for ${item.name}.`);
    }
  }
  const requestedNames = entries.flatMap((item) => [!item.typeId ? item.name : "", item.charge && !item.chargeTypeId ? item.charge : ""]).filter(Boolean);
  const byName = new Map((await resolveFittingTypeNamesLocal(requestedNames)).map((item) => [item.name.toLowerCase(), item]));
  for (const item of entries) {
    if (!item.typeId) item.typeId = byName.get(item.name.toLowerCase())?.id;
    if (item.charge && !item.chargeTypeId) item.chargeTypeId = byName.get(item.charge.toLowerCase())?.id;
    if (!item.typeId || (item.charge && !item.chargeTypeId)) throw new Error(`Unknown fitting item or charge: ${item.name}${item.charge ? `, ${item.charge}` : ""}`);
  }
  const byId = new Map((await resolveFittingTypeIdsLocal(entries.flatMap((item) => [item.typeId!, ...(item.chargeTypeId ? [item.chargeTypeId] : [])]))).map((item) => [item.id, item]));
  for (const item of entries) {
    const type = byId.get(item.typeId!);
    if (!type || (item.chargeTypeId && !byId.has(item.chargeTypeId))) throw new Error(`Unknown fitting type ID on ${item.name}.`);
    item.name = type.name;
    if (item.chargeTypeId) item.charge = byId.get(item.chargeTypeId)!.name;
  }
  if (byId.get(fit.hull.typeId!)?.categoryName.toLowerCase() !== "ship") throw new Error("Fit hull must be a ship.");
  // EFT's optional/empty sections and DNA's unlabelled stacks cannot reliably
  // identify racks. Resolve placement from CCP types rather than section order.
  // Keep explicit JSON placement unchanged so the engine can report bad racks.
  const textFit = typeof payload === "string" && (/^\s*\[[^\r\n]+?,[^\r\n]+?\]\s*(?:\r?\n|$)/.test(payload) || !/^\s*[\[{]/.test(payload));
  if (textFit) {
    const importedItems = racks.flatMap((rack) => fit[rack]);
    for (const rack of racks) fit[rack] = [];
    for (const item of importedItems) {
      const type = byId.get(item.typeId!)!;
      if (type.rack && racks.includes(type.rack as typeof racks[number])) {
        fit[type.rack as typeof racks[number]].push(item);
      } else if (type.categoryName.toLowerCase() === "drone") fit.drones.push(item);
      else if (type.categoryName.toLowerCase() === "fighter") fit.fighters.push(item);
      else if (type.categoryName.toLowerCase() === "implant") {
        const info = await getFittingTypeInfoLocal(item.typeId!);
        fit[info.attributes.some((a) => a.attributeId === 1087 && a.value > 0) ? "boosters" : "implants"].push(item);
      } else fit.cargo.push(item);
    }
  }
  // The desktop fitter represents each fitted module as one slot. Expand
  // imported stacks before analysis: some per-cycle engine systems operate on
  // individual modules rather than a quantity on a single module instance.
  const slotRacks = ["low", "mid", "high", "rig", "subsystem"] as const;
  const slotCount = slotRacks.reduce((sum, rack) => sum + fit[rack].reduce((n, item) => n + item.quantity, 0), 0);
  if (slotCount > 512) throw new Error("Fit contains too many fitted module slots (maximum 512).");
  for (const rack of slotRacks) fit[rack] = fit[rack].flatMap((item) => Array.from({ length: item.quantity }, () => ({ ...item, quantity: 1 })));
  const convert = (item: ImportedFitItem, rack: string): EngineInput["items"][number] => ({
    typeId: item.typeId!, quantity: item.quantity, rack,
    chargeTypeId: item.chargeTypeId, chargeQuantity: item.chargeQuantity,
    activeQuantity: item.activeQuantity, attributeOverrides: item.attributeOverrides,
    state: item.state ?? (rack === "rig" || rack === "subsystem" ? "online" : "active"),
  });
  // Match the desktop fitter's rack, drone and fighter activation semantics.
  const items = (["low", "mid", "high", "rig", "subsystem", "drones", "cargo"] as const)
    .flatMap((rack) => fit[rack].map((item) => convert(item, rack === "drones" ? "drone" : rack)));
  for (const item of fit.fighters) {
    const active = Math.max(0, Math.min(item.quantity, item.activeQuantity ?? Math.min(1, item.quantity)));
    if (item.quantity > active) items.push({ ...convert(item, "fighter"), quantity: item.quantity - active });
    if (active) items.push({ ...convert(item, "fighter-active"), quantity: active, activeQuantity: active });
  }
  const engineSnapshot = input.includeCurrentImplants === false
    ? { ...snapshot, extended: { ...snapshot.extended, implants: [] } }
    : snapshot;
  const analysis = await analyzeFittingDogma({
    hullTypeId: fit.hull.typeId!, items, snapshot: engineSnapshot,
    implantTypeIds: fit.implants.map((item) => item.typeId!),
    boosterTypeIds: fit.boosters.map((item) => item.typeId!),
    targetProfile: input.targetProfile, targetTypeId: input.targetTypeId,
    damageProfile: input.damageProfile, mechanicState: input.mechanicState,
  });
  const shopping = new Map<number, { typeId: number; name: string; quantity: number }>();
  const add = (typeId: number, name: string, quantity: number) => {
    const previous = shopping.get(typeId);
    shopping.set(typeId, { typeId, name, quantity: (previous?.quantity ?? 0) + quantity });
  };
  for (const item of [fit.hull, ...racks.flatMap((rack) => fit[rack])]) add(item.typeId!, item.name, item.quantity);
  for (const item of [...fit.high, ...fit.mid, ...fit.low]) {
    if (item.chargeTypeId && item.charge) add(item.chargeTypeId, item.charge, (item.chargeQuantity ?? 1) * item.quantity);
  }
  let cost: Record<string, unknown> = { available: false, reason: "Prices were disabled." };
  if (input.includePrices !== false) {
    try {
      const loadQuotes = deps.getMarketQuotes ?? (await import("./market-intelligence.js")).loadGlobalMarketQuotes;
      const market = await loadQuotes([...shopping.keys()]);
      const quotes = new Map(market.quotes.map((quote) => [quote.typeId, quote]));
      const lineItems = [...shopping.values()].map((entry) => {
        const price = quotes.get(entry.typeId)?.bestSell;
        const unitPrice = typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
        return { ...entry, unitPrice, subtotal: unitPrice === null ? null : unitPrice * entry.quantity };
      });
      const pricedTypes = lineItems.filter((item) => item.unitPrice !== null).length;
      cost = {
        available: pricedTypes > 0, complete: pricedTypes === lineItems.length,
        total: lineItems.reduce((sum, item) => sum + (item.subtotal ?? 0), 0),
        pricedTypes, totalTypes: lineItems.length, createdAt: market.createdAt,
        basis: "Same global best-sell estimate as the desktop fitter; not a Jita-only or executable market-depth purchase quote. Missing prices are excluded, not treated as free.",
        lineItems,
      };
    } catch (error) { cost = { available: false, reason: error instanceof Error ? error.message : "Sage market quotes unavailable." }; }
  }
  return {
    engine: "Sage desktop fitting:analyze / analyzeFittingDogma",
    characterId: input.characterId, characterName: snapshot.character.name,
    snapshotUpdatedAt: snapshot.updatedAt ?? null,
    assumptions: {
      skills: "Selected character's synced skills, using the desktop fitter's skill semantics",
      includeCurrentImplants: input.includeCurrentImplants !== false,
      targetProfile: input.targetProfile ?? { rangeM: 10000, signatureRadiusM: 125, transverseVelocityMps: 0, velocityMps: 0 },
      damageProfile: analysis.defence.damageProfile,
      moduleStates: "Unspecified modules active; rigs/subsystems online. Set explicit online/overheated states for ADC, propulsion and heat comparisons.",
      price: "Global best-sell estimate from the desktop fitter. Check completeness and timestamp; DPS is paper DPS unless an applied damage field is selected.",
    },
    fit, analysis, cost,
  };
}

export function registerSageFittingTool(server: McpServer, deps: Dependencies, result: (value: unknown) => any) {
  server.registerTool("simulate_sage_fit", {
    title: "Simulate one or multiple fits with Sage's fitter",
    description: "Run the same offline CCP DOGMA engine as Sage's desktop fitter with the selected character's synced skills. Supply exactly one proposed fit (canonical JSON, EFT/PYFA text, ESI JSON, XML or DNA) or saved fitId. Resolves exact item names locally; returns DPS/application, EHP/resists/repairs, capacitor, speed, tackle/support systems, heat, fitting resources, missing skills, legality issues and the desktop fitter's global best-sell cost estimate with price coverage and timestamp. Does not save, change the UI, or push to EVE. Explicitly load charges and set module states/active drone counts; keep Assault Damage Control online for normal tank or active to measure its temporary burst. Never report this as all-skills-V or guaranteed survival time.",
    inputSchema: {
      characterId: z.string().regex(/^\d+$/),
      fit: z.union([z.string().max(200000), z.record(z.string(), z.unknown())]).optional(),
      fitId: z.string().min(1).optional(),
      fits: z.array(z.object({
        fit: z.union([z.string().max(200000), z.record(z.string(), z.unknown())]).optional(),
        fitId: z.string().min(1).optional(),
      }).refine((entry) => (entry.fit !== undefined) !== Boolean(entry.fitId), "Supply exactly one of fit or fitId per entry")).min(1).max(100).optional().describe("Batch of proposed or saved fits. Shared character, target, damage, implant and price options apply to every entry. Results preserve input order with independent errors. Omit top-level fit and fitId."),
      targetProfile: z.object({ rangeM: z.number().nonnegative(), signatureRadiusM: z.number().positive(), transverseVelocityMps: z.number().nonnegative(), velocityMps: z.number().nonnegative() }).optional(),
      targetTypeId: z.number().int().positive().optional(),
      damageProfile: z.object({ em: z.number().nonnegative(), thermal: z.number().nonnegative(), kinetic: z.number().nonnegative(), explosive: z.number().nonnegative() }).refine((p) => p.em + p.thermal + p.kinetic + p.explosive > 0, "Damage profile must have a positive total").optional(),
      includeCurrentImplants: z.boolean().optional(),
      includePrices: z.boolean().optional(),
      batchDetail: z.enum(["summary", "full"]).optional().describe("Batch defaults to compact comparison statistics to keep tunnel messages small. Full per-module diagnostics allow at most 20 fits; single-fit output remains full."),
      mechanicState: z.object({ reactiveArmorCycles: z.number().int().min(0).max(1000) }).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    if (input.fits) {
      if (input.fit !== undefined || input.fitId !== undefined) throw new Error("Use fits for a batch or fit/fitId for a single simulation, not both.");
      return result(await simulateSageFits({ ...input, fits: input.fits }, deps));
    }
    return result(await simulateSageFit(input, deps));
  });
}
