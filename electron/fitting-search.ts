import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { importFits, validateImportedFit, type ImportedFitItem } from "./fitting-import";
import { simulateSageFits } from "./mcp-fitting";
import { remainingWorkEstimate } from "./strategic-timing";

type Rack = "high" | "mid" | "low" | "rig" | "drones";
type Variation = { seedIndex: number; rack: Rack; slot: number; options: ImportedFitItem[] };
type SearchInput = {
  characterId: string;
  seeds: unknown[];
  variations: Variation[];
  candidateLimit?: number;
  top?: number;
  objective?: "tackle" | "damage" | "tank" | "balanced";
  minimumTackleStrength?: number;
  maxDurationMs?: number;
  targetProfile?: { rangeM: number; signatureRadiusM: number; transverseVelocityMps: number; velocityMps: number };
};
type Deps = Parameters<typeof simulateSageFits>[1];

export function generateFitSearchCandidates(input: SearchInput) {
  const seeds = input.seeds.map((value) => {
    const fits = importFits(value);
    if (fits.length !== 1) throw new Error("Each search seed must contain exactly one fit.");
    const fit = validateImportedFit(fits[0]);
    // Slot indexes refer to individual modules, including EFT duplicate stacks.
    for (const rack of ["high", "mid", "low", "rig"] as const) {
      if (fit[rack].reduce((sum, item) => sum + item.quantity, 0) > 32) throw new Error("Too many slots in a search seed.");
      fit[rack] = fit[rack].flatMap((item) => Array.from({ length: item.quantity }, () => ({ ...item, quantity: 1 })));
    }
    return fit;
  });
  for (const axis of input.variations) {
    if (!seeds[axis.seedIndex] || axis.slot > seeds[axis.seedIndex][axis.rack].length || !axis.options.length) throw new Error("Search variation refers to an invalid seed or slot.");
  }
  const axes = seeds.map((_, index) => input.variations.filter((axis) => axis.seedIndex === index));
  for (const group of axes) {
    if (new Set(group.map((axis) => `${axis.rack}:${axis.slot}`)).size !== group.length) throw new Error("Use one variation axis per seed slot.");
  }
  const spaces = axes.map((group) => group.reduce((count, axis) => count * BigInt(axis.options.length), 1n));
  const budget = Math.max(1, Math.min(5000, input.candidateLimit ?? 5000));
  const seen = new Set<string>();
  const candidates: ReturnType<typeof validateImportedFit>[] = [];
  // Round-robin hull coverage; an odd coprime stride spreads choices across axes.
  const gcd = (a: bigint, b: bigint): bigint => b === 0n ? a : gcd(b, a % b);
  const strides = spaces.map((space) => { let stride = 104729n; while (gcd(stride, space) !== 1n) stride += 2n; return stride; });
  let attempts = 0;
  for (let turn = 0; candidates.length < budget && attempts < budget * 10; turn++) {
    let produced = false;
    for (let seedIndex = 0; seedIndex < seeds.length && candidates.length < budget; seedIndex++) {
      if (BigInt(turn) >= spaces[seedIndex]) continue;
      produced = true; attempts++;
      let index = BigInt(turn) * strides[seedIndex] % spaces[seedIndex];
      const fit = structuredClone(seeds[seedIndex]);
      for (const axis of axes[seedIndex]) {
        const option = axis.options[Number(index % BigInt(axis.options.length))];
        index /= BigInt(axis.options.length);
        fit[axis.rack][axis.slot] = { ...option };
      }
      const { id: _id, name: _name, source: _source, instructions: _instructions, ...body } = fit;
      const key = JSON.stringify(body);
      if (seen.has(key)) continue;
      seen.add(key); candidates.push(fit);
    }
    if (!produced) break;
  }
  return { candidates, combinations: spaces.reduce((sum, count) => sum + count, 0n).toString() };
}

export function rankSearchCandidate(analysis: any, objective: SearchInput["objective"], minimumTackleStrength = 0) {
  const support = Array.isArray(analysis.supportSystems) ? analysis.supportSystems : [];
  const metrics = {
    dps: Number(analysis.damage?.appliedDpsBeforeTargetResists ?? analysis.damage?.totalDps ?? 0),
    ehp: Number(analysis.defence?.totalEhp ?? 0),
    repair: Number(analysis.defence?.effectiveShieldRepairPerSecond ?? 0) + Number(analysis.defence?.effectiveArmorRepairPerSecond ?? 0),
    speed: Number(analysis.navigation?.maximumVelocity ?? 0),
    scanResolution: Number(analysis.targeting?.scanResolution ?? 0),
    tackleStrength: support.filter((system: any) => system.kind === "tackle").reduce((sum: number, system: any) => sum + Number(system.warpStrength ?? 0), 0),
    capacitorStable: analysis.capacitor?.stable === true,
    capacitorSeconds: Number(analysis.capacitor?.depletionSeconds ?? 0),
  };
  const missingRequirements = analysis.missingRequirements ?? [];
  const errors = (analysis.issues ?? []).filter((issue: any) => issue.level === "error");
  const requiredTackle = Math.max(minimumTackleStrength, objective === "tackle" ? 1 : 0);
  const legal = errors.length === 0 && missingRequirements.length === 0 && metrics.tackleStrength >= requiredTackle;
  const weights = objective === "tackle" ? [0, 4, 1, 2, 2] : objective === "tank" ? [0, 4, 3, 0.5, 0]
    : objective === "damage" ? [5, 1, 0.5, 0.5, 0] : [2, 2, 1, 1, 0.5];
  const score = [metrics.dps, metrics.ehp, metrics.repair, metrics.speed, metrics.scanResolution]
    .reduce((sum, value, index) => sum + Math.log1p(Math.max(0, value)) * weights[index], 0);
  return { legal, score, metrics, missingRequirements, errors };
}

export async function searchSageFits(input: SearchInput, deps: Deps, options: {
  signal?: AbortSignal; progress?: (completed: number, total: number, message: string) => Promise<void>;
  simulate?: typeof simulateSageFits;
} = {}) {
  const started = Date.now();
  const { candidates, combinations } = generateFitSearchCandidates(input);
  const deadline = started + Math.max(1000, Math.min(900_000, input.maxDurationMs ?? 840_000));
  const top: any[] = [], rejections: any[] = [];
  let completed = 0, legal = 0, failed = 0;
  await options.progress?.(0, candidates.length, `Testing ${candidates.length.toLocaleString()} distinct fitting candidates…`);
  for (let offset = 0; offset < candidates.length; offset += 100) {
    if (options.signal?.aborted || Date.now() >= deadline) break;
    const chunk = candidates.slice(offset, offset + 100);
    const batch = await (options.simulate ?? simulateSageFits)({ characterId: input.characterId,
      fits: chunk.map((fit) => ({ fit })), batchDetail: "summary", includePrices: false, targetProfile: input.targetProfile }, deps);
    for (const row of batch.results) {
      completed++;
      if (!row.success) { failed++; if (rejections.length < 5) rejections.push({ error: row.error }); continue; }
      const ranked = rankSearchCandidate((row.data as any)?.analysis ?? {}, input.objective ?? "balanced", input.minimumTackleStrength);
      if (!ranked.legal) { if (rejections.length < 5) rejections.push(ranked); continue; }
      legal++;
      top.push({ fit: chunk[row.index], ...ranked });
      top.sort((a, b) => b.score - a.score);
      top.length = Math.min(top.length, input.top ?? 10);
    }
    const estimate = remainingWorkEstimate(completed, candidates.length, Date.now() - started);
    await options.progress?.(completed, candidates.length, `Tested ${completed.toLocaleString()} of ${candidates.length.toLocaleString()} candidates; ${legal.toLocaleString()} meet the checked requirements. ${estimate}`.trim());
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return { generated: candidates.length, combinations, simulated: completed, legal, failed,
    partial: completed < candidates.length, durationMs: Date.now() - started, top, rejectionSamples: rejections,
    ranking: `Heuristic ${input.objective ?? "balanced"} ranking of measured candidates. Not proof of a global optimum or survival duration. Current synced skills only; training allowances require a separate training plan. Re-simulate finalists for full diagnostics and prices if needed.` };
}

export function registerSageFitSearch(server: McpServer, deps: Deps, result: (value: unknown) => any) {
  const item = z.object({ name: z.string().min(1), quantity: z.number().int().min(1).max(1000).default(1),
    charge: z.string().optional(), state: z.enum(["offline", "online", "active", "overheated"]).optional() });
  const seed = z.object({ name: z.string().optional(), hull: item,
    high: z.array(item).max(32).default([]), mid: z.array(item).max(32).default([]), low: z.array(item).max(32).default([]),
    rig: z.array(item).max(8).default([]), drones: z.array(item).max(32).default([]),
    subsystem: z.array(item).max(8).default([]), cargo: z.array(item).max(32).default([]) });
  server.registerTool("search_sage_fits", {
    title: "Search fitting variations",
    description: "Test up to 5,000 distinct combinations locally using the real Sage fitter. Supply 1–30 canonical JSON seed fits covering suitable hulls and per-slot module/charge/state options. Slot indexes are zero-based after expanding quantities. Each variation names its seedIndex. Generate broad hull coverage and refine the measured winners; returns only ranked legal finalists and rejection samples, with progress during search. Uses current synced skills, not hypothetical training. No saving or EVE actions.",
    inputSchema: {
      characterId: z.string().regex(/^\d+$/), seeds: z.array(seed).min(1).max(30),
      variations: z.array(z.object({ seedIndex: z.number().int().min(0).max(29), rack: z.enum(["high", "mid", "low", "rig", "drones"]),
        slot: z.number().int().min(0).max(31), options: z.array(item).min(1).max(20) })).max(100),
      candidateLimit: z.number().int().min(1).max(5000).default(5000), top: z.number().int().min(1).max(20).default(10),
      objective: z.enum(["tackle", "damage", "tank", "balanced"]).default("balanced"), minimumTackleStrength: z.number().nonnegative().optional(),
      maxDurationMs: z.number().int().min(1000).max(900000).optional(),
      targetProfile: z.object({ rangeM: z.number().nonnegative(), signatureRadiusM: z.number().positive(), transverseVelocityMps: z.number().nonnegative(), velocityMps: z.number().nonnegative() }).optional(),
    }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input, extra) => result(await searchSageFits(input, deps, { signal: extra.signal,
    progress: async (progress, total, message) => {
      const progressToken = extra._meta?.progressToken;
      if (progressToken !== undefined) await extra.sendNotification({ method: "notifications/progress", params: { progressToken, progress, total, message } });
    },
  })));
}
