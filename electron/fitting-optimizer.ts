import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getFittingCatalogueLocal, getFittingTypeInfoLocal } from "./fitting-dogma";
import { simulateSageFits } from "./mcp-fitting";
import { remainingWorkEstimate } from "./strategic-timing";

type OptimizerDeps = {
  getSnapshot(characterId: string): unknown;
  getSavedFits(): Promise<Array<Record<string, unknown>>>;
};

type OptimizerInput = {
  characterId: string;
  hulls: string[];
  roles?: string[];
  candidateLimit?: number;
  top?: number;
  includePrices?: boolean;
  targetProfile?: {
    rangeM: number;
    signatureRadiusM: number;
    transverseVelocityMps: number;
    velocityMps: number;
  };
};

type CatalogueItem = {
  id: number;
  name: string;
  placement?: string;
  rootName?: string;
  categoryName?: string;
};

type CanonicalFitItem = {
  name: string;
  quantity?: number;
  charge?: string;
  chargeQuantity?: number;
  state?: "offline" | "online" | "active" | "overheated";
};

type CanonicalFit = {
  name: string;
  hull: CanonicalFitItem;
  high: CanonicalFitItem[];
  mid: CanonicalFitItem[];
  low: CanonicalFitItem[];
  rig: CanonicalFitItem[];
  subsystem: CanonicalFitItem[];
  drones: CanonicalFitItem[];
  fighters: CanonicalFitItem[];
  cargo: CanonicalFitItem[];
  implants: CanonicalFitItem[];
  boosters: CanonicalFitItem[];
};

function exact(catalogue: { items: CatalogueItem[] }, name: string, placement?: string) {
  return catalogue.items.find((item) =>
    item.name.toLowerCase() === name.toLowerCase() &&
    (!placement || item.placement === placement),
  );
}

function firstExisting(catalogue: { items: CatalogueItem[] }, names: string[], placement?: string, usable?: Set<string>) {
  for (const name of names) {
    const item = exact(catalogue, name, placement);
    if (item && (!usable || usable.has(item.name.toLowerCase()))) return item.name;
  }
  return undefined;
}

async function usableModuleNames(catalogue: { items: CatalogueItem[] }, snapshot: any) {
  const trained = new Map<number, number>(
    (snapshot?.skills?.skills ?? []).map((skill: any) => [
      Number(skill?.skill_id ?? 0),
      Number(skill?.active_skill_level ?? skill?.trained_skill_level ?? 0),
    ]),
  );
  const candidateName = /(missile launcher|energy neutralizer|shield booster|shield hardener|shield boost amplifier|capacitor booster|missile guidance computer|target painter|afterburner|micro jump drive|ballistic control system|damage control|capacitor flux coil|power diagnostic system|drone damage amplifier|co-processor|reactor control unit|capacitor control circuit|warhead rigor catalyst|core defense|ogre|hammerhead|hobgoblin)/i;
  const candidates = catalogue.items.filter((item) =>
    candidateName.test(item.name) &&
    ["high", "mid", "low", "rig", "drone", "charge"].includes(String(item.placement || "")),
  );
  const usable = new Set<string>();
  for (const item of candidates) {
    try {
      const info = await getFittingTypeInfoLocal(item.id);
      const ok = (info.requirements ?? []).every((req: any) =>
        (trained.get(Number(req.skillId)) ?? 0) >= Number(req.level ?? 0),
      );
      if (ok) usable.add(item.name.toLowerCase());
    } catch { /* Ignore malformed/non-fittable catalogue rows. */ }
  }
  return usable;
}

function attribute(info: any, internalName: string, fallback = 0) {
  const found = (info?.attributes ?? []).find((row: any) => String(row?.internalName || "") === internalName);
  return Number(found?.value ?? fallback);
}

function pushQuantity(target: CanonicalFitItem[], name: string | undefined, quantity: number, extra: Partial<CanonicalFitItem> = {}) {
  if (!name || quantity <= 0) return;
  target.push({ name, quantity, ...extra });
}

export function fillRack(target: CanonicalFitItem[], slots: number, fillers: Array<string | undefined>) {
  const available = fillers.filter((name): name is string => Boolean(name));
  let used = target.reduce((sum, item) => sum + Math.max(1, Number(item.quantity ?? 1)), 0);
  let cursor = 0;
  while (used < slots && available.length) {
    const name = available[cursor++ % available.length];
    target.push({ name, quantity: 1 });
    used += 1;
  }
}

function uniqueFits(fits: CanonicalFit[]) {
  const seen = new Set<string>();
  return fits.filter((fit) => {
    const key = JSON.stringify({
      hull: fit.hull,
      high: fit.high,
      mid: fit.mid,
      low: fit.low,
      rig: fit.rig,
      drones: fit.drones,
    });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function generateHullCandidates(
  catalogue: { items: CatalogueItem[] },
  hullName: string,
  roles: string[],
  limit: number,
  usable: Set<string>,
) {
  const hullEntry = exact(catalogue, hullName, "ship");
  if (!hullEntry) throw new Error(`Unknown or unavailable ship hull: ${hullName}`);
  const info = await getFittingTypeInfoLocal(hullEntry.id);
  if (info.group?.name !== "Battleship") {
    throw new Error("This optimiser currently supports battleship missile/shield templates. Use simulate_sage_fit for other hulls and roles.");
  }
  const highSlots = Math.max(0, Math.round(attribute(info, "hiSlots")));
  const midSlots = Math.max(0, Math.round(attribute(info, "medSlots")));
  const lowSlots = Math.max(0, Math.round(attribute(info, "lowSlots")));
  const rigSlots = Math.max(0, Math.round(attribute(info, "upgradeSlotsLeft")));
  const launcherHardpoints = Math.max(0, Math.round(attribute(info, "launcherSlotsLeft")));

  const wantsMissiles = roles.some((role) => /missile|pve|damage|dps/i.test(role));
  const wantsNeut = roles.some((role) => /neut|neutral|capacitor warfare/i.test(role));
  const wantsShield = !roles.some((role) => /armor|armour/i.test(role));

  const launcherOptions = wantsMissiles ? [
    {
      launcher: firstExisting(catalogue, ["Rapid Heavy Missile Launcher II", "'Arbalest' Rapid Heavy Missile Launcher I", "YO-5000 Rapid Heavy Missile Launcher", "Rapid Heavy Missile Launcher I"], "high", usable),
      charge: firstExisting(catalogue, ["Caldari Navy Scourge Heavy Missile", "Scourge Heavy Missile"], "charge", usable),
    },
    {
      launcher: firstExisting(catalogue, ["Cruise Missile Launcher II", "'Arbalest' Cruise Launcher I", "Cruise Missile Launcher I"], "high", usable),
      charge: firstExisting(catalogue, ["Caldari Navy Scourge Cruise Missile", "Scourge Cruise Missile"], "charge", usable),
    },
    {
      launcher: firstExisting(catalogue, ["Torpedo Launcher II", "'Arbalest' Torpedo Launcher", "Torpedo Launcher I"], "high", usable),
      charge: firstExisting(catalogue, ["Caldari Navy Scourge Torpedo", "Scourge Torpedo"], "charge", usable),
    },
  ].filter((entry) => entry.launcher && entry.charge) : [];

  const neutOptions = wantsNeut ? [
    firstExisting(catalogue, ["Heavy Energy Neutralizer II", "Heavy Infectious Scoped Energy Neutralizer", "Heavy Gremlin Compact Energy Neutralizer", "Heavy 'Moat' Energy Neutralizer", "Heavy Energy Neutralizer I"], "high", usable),
  ].filter(Boolean) as string[] : [];

  const xlBooster = firstExisting(catalogue, ["X-Large Shield Booster II", "X-Large 'Locomotive' Shield Booster", "X-Large C5-L Compact Shield Booster"], "mid", usable);
  const largeBooster = firstExisting(catalogue, ["Large Shield Booster II", "Large C5-L Compact Shield Booster"], "mid", usable);
  const hardener = firstExisting(catalogue, ["Multispectrum Shield Hardener II", "Compact Multispectrum Shield Hardener", "Enduring Multispectrum Shield Hardener", "Multispectrum Shield Hardener I"], "mid", usable);
  const boostAmp = firstExisting(catalogue, ["Shield Boost Amplifier II", "Shield Boost Amplifier I"], "mid", usable);
  const capBooster = firstExisting(catalogue, ["Heavy Capacitor Booster II", "'Plough' Heavy Capacitor Booster I", "Heavy Capacitor Booster I"], "mid", usable);
  const guidance = firstExisting(catalogue, ["Missile Guidance Computer II", "Missile Guidance Computer I"], "mid", usable);
  const afterburner = firstExisting(catalogue, ["100MN Afterburner II", "100MN Y-S8 Compact Afterburner"], "mid", usable);
  const mjd = firstExisting(catalogue, ["Large Micro Jump Drive"], "mid", usable);
  const painter = firstExisting(catalogue, ["Target Painter II", "Parallel Enduring Target Painter"], "mid", usable);

  const bcs = firstExisting(catalogue, ["Ballistic Control System II", "Ballistic Control System I"], "low", usable);
  const dc = firstExisting(catalogue, ["Damage Control II", "Damage Control I"], "low", usable);
  const capFlux = firstExisting(catalogue, ["Capacitor Flux Coil II", "Capacitor Flux Coil I"], "low", usable);
  const pds = firstExisting(catalogue, ["Power Diagnostic System II", "Power Diagnostic System I"], "low", usable);
  const dda = firstExisting(catalogue, ["Drone Damage Amplifier II", "Drone Damage Amplifier I"], "low", usable);
  const coProcessor = firstExisting(catalogue, ["Co-Processor II", "Co-Processor I"], "low", usable);
  const reactor = firstExisting(catalogue, ["Reactor Control Unit II", "Reactor Control Unit I"], "low", usable);

  const ccc = firstExisting(catalogue, ["Large Capacitor Control Circuit I", "Large Capacitor Control Circuit II"], "rig", usable);
  const rigor = firstExisting(catalogue, ["Large Warhead Rigor Catalyst I", "Large Warhead Rigor Catalyst II"], "rig", usable);
  const solidifier = firstExisting(catalogue, ["Large Core Defense Operational Solidifier I", "Large Core Defense Operational Solidifier II"], "rig", usable);
  const extenderRig = firstExisting(catalogue, ["Large Core Defense Field Extender I", "Large Core Defense Field Extender II"], "rig", usable);

  const ogre = firstExisting(catalogue, ["Ogre II", "Ogre I"], "drone", usable);
  const hammerhead = firstExisting(catalogue, ["Hammerhead II", "Hammerhead I"], "drone", usable);
  const hobgoblin = firstExisting(catalogue, ["Hobgoblin II", "Hobgoblin I"], "drone", usable);

  const candidates: CanonicalFit[] = [];
  const launcherCountBase = Math.max(0, Math.min(highSlots, launcherHardpoints || highSlots));
  const launcherCounts = [...new Set([
    launcherCountBase,
    Math.max(1, launcherCountBase - 1),
    Math.max(1, launcherCountBase - 2),
  ])].filter((value) => value > 0);
  const neutCounts = wantsNeut ? [1, 2, 3].filter((value) => value <= highSlots) : [0];
  const bcsCounts = [2, 3, 4].filter((value) => value <= lowSlots);
  const ddaCounts = [0, 1, 2].filter((value) => value <= lowSlots);
  const tankBoosters = wantsShield ? [xlBooster, largeBooster].filter(Boolean) as string[] : [];

  for (const launcher of (launcherOptions.length ? launcherOptions : [{ launcher: undefined, charge: undefined }])) {
    for (const launcherCount of (launcherOptions.length ? launcherCounts : [0])) {
      for (const neutCount of neutCounts) {
        if (launcherCount + neutCount > highSlots) continue;
        for (const booster of (tankBoosters.length ? tankBoosters : [undefined])) {
          for (const bcsCount of (bcsCounts.length ? bcsCounts : [0])) {
            for (const ddaCount of ddaCounts) {
              if (bcsCount + ddaCount + 1 > lowSlots) continue;
              for (let variation = 0; variation < 8; variation += 1) {
                const fit: CanonicalFit = {
                  name: `${hullName} Sage Optimizer ${candidates.length + 1}`,
                  hull: { name: hullEntry.name, quantity: 1 },
                  high: [],
                  mid: [],
                  low: [],
                  rig: [],
                  subsystem: [],
                  drones: [],
                  fighters: [],
                  cargo: [],
                  implants: [],
                  boosters: [],
                };

                if (launcher.launcher && launcher.charge) {
                  pushQuantity(fit.high, launcher.launcher, launcherCount, {
                    charge: launcher.charge,
                    state: "active",
                  });
                }
                if (neutCount > 0) {
                  const neut = neutOptions[variation % Math.max(1, neutOptions.length)];
                  pushQuantity(fit.high, neut, neutCount, { state: "active" });
                }

                if (booster) fit.mid.push({ name: booster, quantity: 1, state: "active" });
                if (hardener) pushQuantity(fit.mid, hardener, variation % 3 === 0 ? 1 : 2, { state: "active" });
                if (boostAmp && variation % 2 === 0) fit.mid.push({ name: boostAmp, quantity: 1, state: "active" });
                if (capBooster && (wantsNeut || variation % 3 !== 0)) {
                  fit.mid.push({ name: capBooster, quantity: 1, charge: "Cap Booster 800", state: "active" });
                }
                if (guidance && variation % 2 === 1) fit.mid.push({ name: guidance, quantity: 1, state: "active" });
                if (painter && variation % 4 === 1) fit.mid.push({ name: painter, quantity: 1, state: "active" });
                if (afterburner && variation % 4 !== 2) fit.mid.push({ name: afterburner, quantity: 1, state: "active" });
                if (mjd && variation % 4 === 2) fit.mid.push({ name: mjd, quantity: 1, state: "active" });
                fillRack(fit.mid, midSlots, [hardener, guidance, boostAmp, painter].filter(Boolean));

                pushQuantity(fit.low, bcs, bcsCount);
                pushQuantity(fit.low, dda, ddaCount);
                if (dc) fit.low.push({ name: dc, quantity: 1, state: "active" });
                const lowFillers = variation % 3 === 0
                  ? [capFlux, pds, coProcessor, reactor]
                  : variation % 3 === 1
                    ? [pds, capFlux, reactor, coProcessor]
                    : [capFlux, coProcessor, pds, reactor];
                fillRack(fit.low, lowSlots, lowFillers.filter(Boolean));

                const rigPattern = variation % 4;
                const rigFillers = rigPattern === 0
                  ? [ccc, ccc, rigor]
                  : rigPattern === 1
                    ? [rigor, rigor, ccc]
                    : rigPattern === 2
                      ? [solidifier, ccc, rigor]
                      : [extenderRig, ccc, rigor];
                fillRack(fit.rig, rigSlots, rigFillers.filter(Boolean));

                if (ogre) pushQuantity(fit.drones, ogre, 4, { state: "active" });
                if (hammerhead) pushQuantity(fit.drones, hammerhead, 5, { state: "online" });
                if (hobgoblin) pushQuantity(fit.drones, hobgoblin, 5, { state: "online" });

                candidates.push(fit);
                if (candidates.length >= limit) break;
              }
              if (candidates.length >= limit) break;
            }
            if (candidates.length >= limit) break;
          }
          if (candidates.length >= limit) break;
        }
        if (candidates.length >= limit) break;
      }
      if (candidates.length >= limit) break;
    }
    if (candidates.length >= limit) break;
  }

  return uniqueFits(candidates).slice(0, limit);
}

function scoreSimulation(data: any, roles: string[], fit: CanonicalFit) {
  const analysis = data?.analysis ?? {};
  const issues = Array.isArray(analysis.issues) ? analysis.issues : [];
  const missing = Array.isArray(analysis.missingRequirements) ? analysis.missingRequirements : [];
  const hardErrors = issues.filter((issue: any) => String(issue?.level || "").toLowerCase() === "error");
  const highNames = fit.high.map((item) => item.name).join(" ");
  const roleViolations: string[] = [];
  if (roles.some((role) => /missile/i.test(role)) && !/missile launcher/i.test(highNames)) roleViolations.push("missing-missile-launcher");
  if (roles.some((role) => /neut|neutral/i.test(role)) && !/neutralizer/i.test(highNames)) roleViolations.push("missing-energy-neutralizer");
  const legal = hardErrors.length === 0 && missing.length === 0 && roleViolations.length === 0;

  const totalDps = Number(analysis.damage?.totalDps ?? 0);
  const appliedDps = Number(analysis.damage?.appliedDpsBeforeTargetResists ?? totalDps);
  const ehp = Number(analysis.defence?.totalEhp ?? 0);
  const activeTank = Number(analysis.defence?.effectiveShieldRepairPerSecond ?? 0)
    + Number(analysis.defence?.effectiveArmorRepairPerSecond ?? 0)
    + Number(analysis.defence?.effectiveStructureRepairPerSecond ?? 0);
  const passiveTank = Number(analysis.defence?.effectivePassiveShieldPeak ?? 0);
  const stable = Boolean(analysis.capacitor?.stable);
  const depletion = Number(analysis.capacitor?.depletionSeconds ?? 0);
  const neutPerSecond = (Array.isArray(analysis.supportSystems) ? analysis.supportSystems : [])
    .filter((system: any) => /neutral/i.test(String(system?.kind || system?.name || "")))
    .reduce((sum: number, system: any) => sum + Number(system?.perSecond ?? 0), 0);

  let score = 0;
  score += totalDps * 1.0;
  score += appliedDps * 1.4;
  score += ehp / 180;
  score += activeTank * 1.2;
  score += passiveTank * 0.5;
  score += stable ? 250 : Math.min(180, depletion / 5);
  if (roles.some((role) => /neut|neutral/i.test(role))) score += neutPerSecond * 18;
  if (!legal) score -= 1_000_000;

  return {
    legal,
    score,
    metrics: {
      totalDps,
      appliedDps,
      totalEhp: ehp,
      activeTankEhpPerSecond: activeTank,
      passiveShieldEhpPerSecond: passiveTank,
      capacitorStable: stable,
      capacitorDepletionSeconds: depletion,
      neutGjPerSecond: neutPerSecond,
      issueCount: issues.length,
      missingSkillCount: missing.length,
    },
    issues,
    missingRequirements: missing,
    roleViolations,
  };
}

export async function optimiseSageFit(input: OptimizerInput, deps: OptimizerDeps, options: {
  signal?: AbortSignal; progress?: (completed: number, total: number, message: string) => Promise<void>;
} = {}) {
  const startedAt = Date.now();
  const catalogue = await getFittingCatalogueLocal() as { items: CatalogueItem[] };
  const snapshot = deps.getSnapshot(input.characterId) as any;
  if (!Array.isArray(snapshot?.skills?.skills)) {
    throw new Error("Synced character skills are required before optimising a fit.");
  }
  const usable = await usableModuleNames(catalogue, snapshot);
  const hulls = [...new Set(input.hulls.map((name) => name.trim()).filter(Boolean))].slice(0, 50);
  if (!hulls.length) throw new Error("Provide at least one hull.");
  const candidateLimit = Math.max(1, Math.min(5000, Math.round(input.candidateLimit ?? 800)));
  const top = Math.max(1, Math.min(50, Math.round(input.top ?? 15)));
  const roles = (input.roles?.length ? input.roles : ["pve", "missile", "neut", "shield"]).map(String);
  if (roles.some((role) => /tackle|armor|armour|logistics|mining/i.test(role))) {
    throw new Error("This optimiser does not generate those role templates. Use simulate_sage_fit to compare suitable candidates.");
  }
  const perHull = Math.max(1, Math.ceil(candidateLimit / hulls.length));

  const generated: CanonicalFit[] = [];
  for (const hull of hulls) {
    generated.push(...await generateHullCandidates(catalogue, hull, roles, perHull, usable));
    if (generated.length >= candidateLimit) break;
  }
  const candidates = uniqueFits(generated).slice(0, candidateLimit);
  if (!candidates.length) throw new Error("The optimiser could not generate any candidates from the requested hull/role combination.");

  const results: any[] = [];
  await options.progress?.(0, candidates.length, `Testing ${candidates.length.toLocaleString()} battleship fitting candidates…`);
  for (let offset = 0; offset < candidates.length; offset += 100) {
    if (options.signal?.aborted) break;
    const chunk = candidates.slice(offset, offset + 100);
    const batch = await simulateSageFits({
      characterId: input.characterId,
      fits: chunk.map((fit) => ({ fit })),
      batchDetail: "summary",
      includePrices: input.includePrices === true,
      targetProfile: input.targetProfile,
    }, deps);
    for (let index = 0; index < batch.results.length; index += 1) {
      const row = batch.results[index];
      const fit = chunk[index];
      if (!row?.success) {
        results.push({ fit, success: false, score: -1_000_000, error: row?.error ?? "Simulation failed." });
        continue;
      }
      const simulated = row.data as any;
      const scored = scoreSimulation(simulated, roles, fit);
      results.push({ fit, success: true, ...scored, analysis: simulated?.analysis, cost: simulated?.cost });
    }
    await options.progress?.(results.length, candidates.length, `Tested ${results.length.toLocaleString()} of ${candidates.length.toLocaleString()} candidates. ${remainingWorkEstimate(results.length, candidates.length, Date.now() - startedAt)}`.trim());
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  const legal = results
    .filter((row) => row.success && row.legal)
    .sort((a, b) => b.score - a.score);
  const rejected = results.length - legal.length;

  return {
    engine: "Sage headless fit optimiser v1",
    characterId: input.characterId,
    roles,
    hulls,
    candidateBudget: candidateLimit,
    generated: candidates.length,
    simulated: results.length,
    partial: results.length < candidates.length,
    legal: legal.length,
    rejected,
    durationMs: Date.now() - startedAt,
    rejectionSamples: results.filter((row) => !row.legal).slice(0, 8).map((row) => ({ error: row.error, issues: row.issues, missingRequirements: row.missingRequirements, fit: row.fit })),
    top: legal.slice(0, top).map((row, index) => ({
      rank: index + 1,
      score: row.score,
      fit: row.fit,
      metrics: row.metrics,
      cost: row.cost,
    })),
  };
}

export function registerSageFitOptimizer(
  server: McpServer,
  deps: OptimizerDeps,
  result: (value: unknown) => any,
) {
  server.registerTool("optimise_sage_fit", {
    title: "Optimise ship fits with Sage",
    description: "Deterministic search over battleship missile/shield templates, optionally with neutralisers, using synced character skills. This is a limited candidate search, not a universal best-fit solver. For tackle, armour, other hull classes, or different roles, batch candidates with simulate_sage_fit instead.",
    inputSchema: {
      characterId: z.string().regex(/^\d+$/),
      hulls: z.array(z.string().min(1).max(100)).min(1).max(50),
      roles: z.array(z.string().min(1).max(100)).max(20).optional(),
      candidateLimit: z.number().int().min(1).max(5000).default(800),
      top: z.number().int().min(1).max(50).default(15),
      includePrices: z.boolean().default(false),
      targetProfile: z.object({
        rangeM: z.number().nonnegative(),
        signatureRadiusM: z.number().positive(),
        transverseVelocityMps: z.number().nonnegative(),
        velocityMps: z.number().nonnegative(),
      }).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input, extra) => result(await optimiseSageFit(input, deps, { signal: extra.signal,
    progress: async (progress, total, message) => {
      const progressToken = extra._meta?.progressToken;
      if (progressToken !== undefined) await extra.sendNotification({ method: "notifications/progress", params: { progressToken, progress, total, message } });
    },
  })));
}
