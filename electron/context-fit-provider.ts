import { promises as fs } from "node:fs";
import path from "node:path";
import type { ActivityContext, ContextRule } from "./activity-context";
import { USER_DATA_ROOT } from "./data-paths";
import {
  getRecentHullFitSamples,
  type CommunityFitSample,
} from "./community-fit";

const WORKBENCH = "https://api.eveworkbench.com/v1";
const ESI = "https://esi.evetech.net";
const CACHE_TTL_MS = 60 * 60 * 1000;
const RUN_CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;
const ABYSS_MAX_PAGES = 3;
const MAX_PUBLIC_FIT_IDS = 18;
const MAX_RUN_WEIGHT_PER_FIT = 6;
const EXACT_EVIDENCE_TARGET = 6;

const headers = {
  Accept: "application/json",
  "X-User-Agent": "New Eden Sage/0.1.4",
};

type EwbRun = {
  id?: string;
  Id?: string;
  hullType?: string | null;
  HullType?: string | null;
  survived?: boolean;
  Survived?: boolean;
  fitId?: string | null;
  FitId?: string | null;
};

type EwbRunsResponse = {
  runs?: EwbRun[] | null;
  Runs?: EwbRun[] | null;
  numberOfPages?: number;
  NumberOfPages?: number;
};

type EwbItem = {
  typeId?: number;
  TypeId?: number;
};

type EwbFitResponse = {
  error?: boolean;
  Error?: boolean;
  name?: string | null;
  Name?: string | null;
  ship?: { name?: string | null; typeId?: number };
  Ship?: { Name?: string | null; TypeId?: number };
  highSlots?: EwbItem[] | null;
  HighSlots?: EwbItem[] | null;
  mediumSlots?: EwbItem[] | null;
  MediumSlots?: EwbItem[] | null;
  lowSlots?: EwbItem[] | null;
  LowSlots?: EwbItem[] | null;
  rigSlots?: EwbItem[] | null;
  RigSlots?: EwbItem[] | null;
  droneBay?: EwbItem[] | null;
  DroneBay?: EwbItem[] | null;
  fighterBay?: EwbItem[] | null;
  FighterBay?: EwbItem[] | null;
};

type FitSample = {
  id: string;
  name: string;
  itemTypeIds: number[];
  items: Array<{ typeId: number; name: string }>;
};

export type ContextFitArchetype = {
  id: string;
  label: string;
  source: "eve-workbench-abyss" | "zkillboard-recent-losses";
  sampleCount: number;
  confidence: "none" | "low" | "medium" | "high";
  contextSpecific: boolean;
  items: Array<{ typeId: number; name: string; presencePercent: number }>;
  itemTypeIds: number[];
};

export type ContextFitEvidence = {
  status: "ready" | "no-data" | "error";
  source: "eve-workbench-abyss" | "zkillboard-recent-losses" | "none";
  contextSpecific: boolean;
  fetchedAt: string;
  sampleCount: number;
  confidence: "none" | "low" | "medium" | "high";
  note?: string;
  archetypes: ContextFitArchetype[];
};

const abyssRunMemory = new Map<
  string,
  { expiresAt: number; promise: Promise<EwbRun[]> }
>();
const workbenchFitMemory = new Map<string, Promise<EwbFitResponse | null>>();

function cacheFile(hullTypeId: number, context: ActivityContext) {
  const key = [
    context.activityId,
    context.subcategoryId,
    context.contentId,
    ...Object.entries(context.selectorValues ?? {}).sort().flat(),
  ]
    .join("-")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 180);
  return path.join(
    USER_DATA_ROOT,
    "context-fit-cache",
    `${hullTypeId}-${key || "default"}.json`,
  );
}

async function readCached(file: string): Promise<ContextFitEvidence | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as ContextFitEvidence & {
      expiresAt?: number;
    };
    if ((parsed.expiresAt ?? 0) > Date.now()) return parsed;
  } catch {
    // Cache misses are normal.
  }
  return null;
}

async function writeCached(file: string, value: ContextFitEvidence) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({ ...value, expiresAt: Date.now() + CACHE_TTL_MS }, null, 2),
    "utf8",
  );
}

function normalizeTier(value: string) {
  return value.replace(/^T[0-6]\s*/i, "").trim();
}

function expectedAbyssClass(context: ActivityContext) {
  if (context.contentId.includes("frigate")) return "frigate";
  if (context.contentId.includes("destroyer")) return "destroyer";
  return "cruiser";
}

async function resolveNames(typeIds: number[]) {
  const names = new Map<number, string>();
  for (let index = 0; index < typeIds.length; index += 1000) {
    try {
      const response = await fetch(`${ESI}/universe/names/`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Compatibility-Date": "2026-08-02",
          "X-User-Agent": "NewEdenSage/0.1.4",
        },
        body: JSON.stringify(typeIds.slice(index, index + 1000)),
      });
      if (!response.ok) continue;
      for (const item of (await response.json()) as Array<{
        id: number;
        name: string;
      }>)
        names.set(item.id, item.name);
    } catch {
      // Names improve presentation only; the type IDs remain usable for readiness.
    }
  }
  return names;
}

function itemTypeId(item: EwbItem) {
  return item.typeId ?? item.TypeId ?? 0;
}

function fitTypeIds(fit: EwbFitResponse) {
  return [
    ...(fit.highSlots ?? fit.HighSlots ?? []).map(itemTypeId),
    ...(fit.mediumSlots ?? fit.MediumSlots ?? []).map(itemTypeId),
    ...(fit.lowSlots ?? fit.LowSlots ?? []).map(itemTypeId),
    ...(fit.rigSlots ?? fit.RigSlots ?? []).map(itemTypeId),
    ...(fit.droneBay ?? fit.DroneBay ?? []).map(itemTypeId),
    ...(fit.fighterBay ?? fit.FighterBay ?? []).map(itemTypeId),
  ].filter((id) => Number.isInteger(id) && id > 0);
}

function runFitId(run: EwbRun) {
  return run.fitId ?? run.FitId ?? null;
}

function runHullClass(run: EwbRun) {
  return String(run.hullType ?? run.HullType ?? "").toLowerCase();
}

function runSurvived(run: EwbRun) {
  return run.survived ?? run.Survived ?? false;
}

async function fetchAbyssRunsUncached(weather: string, tier: string) {
  const runs: EwbRun[] = [];
  let pagesAvailable = ABYSS_MAX_PAGES;
  for (let page = 1; page <= Math.min(ABYSS_MAX_PAGES, pagesAvailable); page += 1) {
    try {
      const url = `${WORKBENCH}/abyss-tracker/runs/${encodeURIComponent(weather)}/${encodeURIComponent(tier)}?page=${page}`;
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        if (page === 1)
          throw new Error(`EVE Workbench Abyss Tracker returned ${response.status}.`);
        break;
      }
      const payload = (await response.json()) as EwbRunsResponse;
      pagesAvailable =
        payload.numberOfPages ?? payload.NumberOfPages ?? ABYSS_MAX_PAGES;
      runs.push(...(payload.runs ?? payload.Runs ?? []));
    } catch (error) {
      if (page === 1) throw error;
      break;
    }
  }
  return runs;
}

function fetchAbyssRuns(weather: string, tier: string) {
  const key = `${weather.toLowerCase()}|${tier.toLowerCase()}`;
  const cached = abyssRunMemory.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = fetchAbyssRunsUncached(weather, tier);
  abyssRunMemory.set(key, {
    expiresAt: Date.now() + RUN_CACHE_TTL_MS,
    promise,
  });
  promise.catch(() => abyssRunMemory.delete(key));
  return promise;
}

function fetchWorkbenchFit(id: string) {
  const cached = workbenchFitMemory.get(id);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const response = await fetch(`${WORKBENCH}/fits/${id}`, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const fit = (await response.json()) as EwbFitResponse;
      if (fit.error ?? fit.Error ?? false) return null;
      return fit;
    } catch {
      return null;
    }
  })();
  workbenchFitMemory.set(id, pending);
  return pending;
}

function fitShipName(fit: EwbFitResponse) {
  return String(fit.ship?.name ?? fit.Ship?.Name ?? "").trim();
}

function fitName(fit: EwbFitResponse, hull: string) {
  return String(fit.name ?? fit.Name ?? "").trim() || `${hull} Abyss fit`;
}

async function getAbyssSamples(
  context: ActivityContext,
  hull: string,
): Promise<FitSample[]> {
  const weather = context.selectorValues?.weather;
  const tier = context.selectorValues?.tier;
  if (!weather || !tier) return [];

  const className = expectedAbyssClass(context);
  const runs = await fetchAbyssRuns(weather, normalizeTier(tier));
  const fitFrequency = new Map<string, number>();
  for (const run of runs) {
    const id = runFitId(run);
    if (!id || !runSurvived(run) || runHullClass(run) !== className) continue;
    fitFrequency.set(id, (fitFrequency.get(id) ?? 0) + 1);
  }

  const candidateIds = [...fitFrequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PUBLIC_FIT_IDS);
  const exactFits: Array<{
    id: string;
    frequency: number;
    fit: EwbFitResponse;
  }> = [];

  for (let index = 0; index < candidateIds.length; index += 6) {
    const batch = await Promise.all(
      candidateIds.slice(index, index + 6).map(async ([id, frequency]) => {
        const fit = await fetchWorkbenchFit(id);
        if (!fit || fitShipName(fit).toLowerCase() !== hull.toLowerCase())
          return null;
        return { id, frequency, fit };
      }),
    );
    exactFits.push(
      ...batch.filter(
        (
          item,
        ): item is { id: string; frequency: number; fit: EwbFitResponse } =>
          Boolean(item),
      ),
    );
    const weightedEvidence = exactFits.reduce(
      (sum, item) => sum + Math.min(MAX_RUN_WEIGHT_PER_FIT, item.frequency),
      0,
    );
    if (weightedEvidence >= EXACT_EVIDENCE_TARGET) break;
  }

  const allIds = [
    ...new Set(exactFits.flatMap(({ fit }) => fitTypeIds(fit))),
  ];
  const names = await resolveNames(allIds);
  const samples: FitSample[] = [];

  for (const { id, frequency, fit } of exactFits) {
    const itemTypeIds = [...new Set(fitTypeIds(fit))];
    if (!itemTypeIds.length) continue;
    const items = itemTypeIds.map((typeId) => ({
      typeId,
      name: names.get(typeId) ?? `Type ${typeId}`,
    }));
    const repeats = Math.max(1, Math.min(MAX_RUN_WEIGHT_PER_FIT, frequency));
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      samples.push({
        id: `${id}-${repeat + 1}`,
        name: fitName(fit, hull),
        itemTypeIds,
        items,
      });
    }
  }
  return samples;
}

function genericToFitSamples(samples: CommunityFitSample[]): FitSample[] {
  return samples.map((sample) => ({
    id: sample.id,
    name: "Observed recent fit",
    itemTypeIds: sample.itemTypeIds,
    items: sample.items,
  }));
}

function matchesHints(sample: FitSample, hints: string[]) {
  if (!hints.length) return true;
  const names = sample.items.map((item) => item.name.toLowerCase());
  return hints.some((hint) =>
    names.some((name) => name.includes(hint.toLowerCase())),
  );
}

function jaccard(a: number[], b: number[]) {
  const left = new Set(a);
  const right = new Set(b);
  let intersection = 0;
  for (const id of left) if (right.has(id)) intersection += 1;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function confidenceFor(count: number): ContextFitArchetype["confidence"] {
  if (count >= 8) return "high";
  if (count >= 4) return "medium";
  if (count >= 2) return "low";
  return "none";
}

function archetypeLabel(
  samples: FitSample[],
  items: Array<{ name: string }>,
) {
  const named = samples
    .map((sample) => sample.name)
    .find((name) => !/^Observed recent fit$/i.test(name));
  if (named) return named;
  const text = items.map((item) => item.name.toLowerCase()).join(" ");
  const parts: string[] = [];
  if (/shield booster|shield extender|shield hardener/.test(text))
    parts.push("Shield");
  if (/armor repair|armor plate|energized/.test(text)) parts.push("Armor");
  if (/missile launcher|rocket launcher|torpedo launcher/.test(text))
    parts.push("Missile");
  if (/laser|pulse laser|beam laser/.test(text)) parts.push("Laser");
  if (/autocannon|artillery/.test(text)) parts.push("Projectile");
  if (/blaster|railgun/.test(text)) parts.push("Hybrid");
  if (/drone damage|drone navigation|drone link/.test(text)) parts.push("Drone");
  if (/ice harvester/.test(text)) parts.push("Ice");
  if (/strip miner|mining laser/.test(text)) parts.push("Ore");
  if (/gas cloud/.test(text)) parts.push("Gas");
  if (/covert ops cloaking|cloaking device/.test(text)) parts.push("Covert");
  return `${parts.slice(0, 3).join(" / ") || "Observed"} archetype`;
}

function clusterSamples(
  samples: FitSample[],
  source: ContextFitArchetype["source"],
  contextSpecific: boolean,
) {
  const clusters: FitSample[][] = [];
  for (const sample of samples) {
    let bestIndex = -1;
    let bestScore = 0;
    clusters.forEach((cluster, index) => {
      const score = jaccard(sample.itemTypeIds, cluster[0].itemTypeIds);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0 && bestScore >= 0.42) clusters[bestIndex].push(sample);
    else clusters.push([sample]);
  }

  return clusters
    .sort((a, b) => b.length - a.length)
    .slice(0, 3)
    .map((cluster, clusterIndex): ContextFitArchetype => {
      const presence = new Map<number, { count: number; name: string }>();
      for (const sample of cluster)
        for (const item of sample.items) {
          const current = presence.get(item.typeId) ?? {
            count: 0,
            name: item.name,
          };
          current.count += 1;
          presence.set(item.typeId, current);
        }
      const ranked = [...presence.entries()]
        .sort((a, b) => b[1].count - a[1].count || a[0] - b[0])
        .filter(
          ([, item], index) =>
            item.count / cluster.length >= 0.45 || index < 10,
        )
        .slice(0, 24)
        .map(([typeId, item]) => ({
          typeId,
          name: item.name,
          presencePercent: Math.round((item.count / cluster.length) * 100),
        }));
      return {
        id: `${source}-${clusterIndex}-${cluster[0].id}`,
        label: archetypeLabel(cluster, ranked),
        source,
        sampleCount: cluster.length,
        confidence: confidenceFor(cluster.length),
        contextSpecific,
        items: ranked,
        itemTypeIds: ranked.map((item) => item.typeId),
      };
    });
}

export async function getContextFitEvidence(
  hullTypeId: number,
  hull: string,
  context: ActivityContext,
  rule: ContextRule,
  force = false,
): Promise<ContextFitEvidence> {
  if (!rule.includeFit)
    return {
      status: "no-data",
      source: "none",
      contextSpecific: true,
      fetchedAt: new Date().toISOString(),
      sampleCount: 0,
      confidence: "none",
      note: "A fitted-ship profile is not part of readiness for this activity.",
      archetypes: [],
    };

  const file = cacheFile(hullTypeId, context);
  if (!force) {
    const cached = await readCached(file);
    if (cached) return cached;
  }

  let exactSourceNote: string | undefined;
  if (context.subcategoryId === "abyss") {
    try {
      const abyssSamples = await getAbyssSamples(context, hull);
      if (abyssSamples.length >= 2) {
        const archetypes = clusterSamples(
          abyssSamples,
          "eve-workbench-abyss",
          true,
        );
        if (archetypes.length) {
          const result: ContextFitEvidence = {
            status: "ready",
            source: "eve-workbench-abyss",
            contextSpecific: true,
            fetchedAt: new Date().toISOString(),
            sampleCount: abyssSamples.length,
            confidence: confidenceFor(abyssSamples.length),
            archetypes,
          };
          await writeCached(file, result);
          return result;
        }
      }
      exactSourceNote =
        "No sufficiently repeated public fit for this exact Abyss hull, tier and weather was found in the bounded run sample.";
    } catch (error) {
      exactSourceNote = `Variation-specific Abyss fitting evidence was temporarily unavailable: ${
        error instanceof Error ? error.message : "provider error"
      }`;
    }
  }

  try {
    const observed = await getRecentHullFitSamples(hullTypeId, force);
    let generic = genericToFitSamples(observed.samples);
    let contextSpecific = false;
    if (rule.fitHints.length) {
      const filtered = generic.filter((sample) =>
        matchesHints(sample, rule.fitHints),
      );
      if (filtered.length >= 2) {
        generic = filtered;
        contextSpecific = true;
      }
    }
    const archetypes = clusterSamples(
      generic,
      "zkillboard-recent-losses",
      contextSpecific,
    );
    const fallbackNote = archetypes.length
      ? contextSpecific
        ? undefined
        : "Sage used recent hull-wide observed archetypes because no stronger variation-specific fit signal was available."
      : observed.note;
    const result: ContextFitEvidence = {
      status: archetypes.length ? "ready" : observed.status,
      source: "zkillboard-recent-losses",
      contextSpecific,
      fetchedAt: new Date().toISOString(),
      sampleCount: generic.length,
      confidence: confidenceFor(generic.length),
      archetypes,
      note: [exactSourceNote, fallbackNote].filter(Boolean).join(" ") || undefined,
    };
    await writeCached(file, result);
    return result;
  } catch (error) {
    const failed: ContextFitEvidence = {
      status: "error",
      source: "none",
      contextSpecific: false,
      fetchedAt: new Date().toISOString(),
      sampleCount: 0,
      confidence: "none",
      note: [
        exactSourceNote,
        error instanceof Error ? error.message : "Context fitting lookup failed.",
      ]
        .filter(Boolean)
        .join(" "),
      archetypes: [],
    };
    await writeCached(file, failed).catch(() => undefined);
    return failed;
  }
}
