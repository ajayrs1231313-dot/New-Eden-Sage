import { promises as fs } from "node:fs";
import path from "node:path";
import type { ActivityContext } from "./activity-context";
import { USER_DATA_ROOT } from "./data-paths";

const WORKBENCH = "https://api.eveworkbench.com/v1";
const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_PAGES = 2;

const headers = {
  Accept: "application/json",
  "X-User-Agent": "New Eden Sage/0.1.4",
};

type JournalRun = {
  Type?: string;
  type?: string;
  EveDungeonName?: string | null;
  eveDungeonName?: string | null;
  EveDungeonLevel?: number | null;
  eveDungeonLevel?: number | null;
  Survived?: boolean;
  survived?: boolean;
  TotalProfit?: number | null;
  totalProfit?: number | null;
};

type JournalResponse = {
  Runs?: JournalRun[] | null;
  runs?: JournalRun[] | null;
  NumberOfPages?: number;
  numberOfPages?: number;
};

export type ActivityEvidenceEntry = {
  name: string;
  level: number | null;
  runs: number;
  survivedRuns: number;
  averageObservedProfit: number | null;
};

export type ActivityContextEvidence = {
  source: "eve-workbench-journal" | "none";
  status: "ready" | "not-applicable" | "no-data" | "error";
  contextSpecific: boolean;
  fetchedAt: string;
  sampleCount: number;
  confidence: "none" | "low" | "medium" | "high";
  label: string;
  note?: string;
  entries: ActivityEvidenceEntry[];
};

type EvidencePlan = {
  category: "BurnerMission" | "CombatSite";
  label: string;
  familyFilter?: string;
  contextSpecific: boolean;
  note?: string;
};

function planFor(context: ActivityContext): EvidencePlan | null {
  if (context.contentId === "missions-burner") {
    const family = context.selectorValues?.family?.trim();
    return {
      category: "BurnerMission",
      label: family ? `${family} public runs` : "Burner / Anomic public runs",
      familyFilter: family,
      contextSpecific: Boolean(family),
    };
  }

  if (
    context.contentId === "lowsec-ratting" ||
    context.contentId === "nullsec-ratting" ||
    context.contentId === "ded-escalations" ||
    context.contentId === "combat-exploration"
  ) {
    return {
      category: "CombatSite",
      label: "Observed public combat-site runs",
      contextSpecific: false,
      note:
        context.contentId === "ded-escalations"
          ? "EVE Journal combat-site levels are observational metadata and are not treated as equivalent to the selected DED rating."
          : "The public run feed does not expose security-space location, so these observations support the activity context without claiming an exact region/security match.",
    };
  }
  return null;
}

function cacheFile(plan: EvidencePlan) {
  const family = (plan.familyFilter ?? "all")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .toLowerCase();
  return path.join(
    USER_DATA_ROOT,
    "activity-evidence-cache",
    `${plan.category.toLowerCase()}-${family}.json`,
  );
}

async function readCache(file: string) {
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8")) as ActivityContextEvidence & {
      expiresAt?: number;
    };
    if ((value.expiresAt ?? 0) > Date.now()) return value;
  } catch {
    // Cache miss.
  }
  return null;
}

async function writeCache(file: string, value: ActivityContextEvidence) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({ ...value, expiresAt: Date.now() + CACHE_TTL_MS }, null, 2),
    "utf8",
  );
}

async function fetchCategory(category: EvidencePlan["category"]) {
  const runs: JournalRun[] = [];
  let pageCount = MAX_PAGES;
  for (let page = 1; page <= Math.min(pageCount, MAX_PAGES); page += 1) {
    const response = await fetch(
      `${WORKBENCH}/eve-journal/runs/${category}?page=${page}`,
      {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok)
      throw new Error(`EVE Journal returned ${response.status} for ${category}.`);
    const payload = (await response.json()) as JournalResponse;
    pageCount = payload.NumberOfPages ?? payload.numberOfPages ?? MAX_PAGES;
    runs.push(...(payload.Runs ?? payload.runs ?? []));
  }
  return runs;
}

function confidenceFor(count: number): ActivityContextEvidence["confidence"] {
  if (count >= 50) return "high";
  if (count >= 20) return "medium";
  if (count >= 5) return "low";
  return "none";
}

function runName(run: JournalRun) {
  return String(run.EveDungeonName ?? run.eveDungeonName ?? "Unknown content").trim();
}

function aggregate(runs: JournalRun[]) {
  const byName = new Map<
    string,
    {
      name: string;
      level: number | null;
      runs: number;
      survivedRuns: number;
      profitTotal: number;
      profitSamples: number;
    }
  >();

  for (const run of runs) {
    const name = runName(run);
    const key = name.toLowerCase();
    const current = byName.get(key) ?? {
      name,
      level: run.EveDungeonLevel ?? run.eveDungeonLevel ?? null,
      runs: 0,
      survivedRuns: 0,
      profitTotal: 0,
      profitSamples: 0,
    };
    current.runs += 1;
    if (run.Survived ?? run.survived ?? false) current.survivedRuns += 1;
    const profit = run.TotalProfit ?? run.totalProfit;
    if (typeof profit === "number" && Number.isFinite(profit)) {
      current.profitTotal += profit;
      current.profitSamples += 1;
    }
    byName.set(key, current);
  }

  return [...byName.values()]
    .sort((a, b) => b.runs - a.runs || b.survivedRuns - a.survivedRuns)
    .slice(0, 8)
    .map((item): ActivityEvidenceEntry => ({
      name: item.name,
      level: item.level,
      runs: item.runs,
      survivedRuns: item.survivedRuns,
      averageObservedProfit: item.profitSamples
        ? Math.round(item.profitTotal / item.profitSamples)
        : null,
    }));
}

export async function getActivityContextEvidence(
  context: ActivityContext,
  force = false,
): Promise<ActivityContextEvidence> {
  const plan = planFor(context);
  if (!plan)
    return {
      source: "none",
      status: "not-applicable",
      contextSpecific: false,
      fetchedAt: new Date().toISOString(),
      sampleCount: 0,
      confidence: "none",
      label: "No public activity evidence provider for this route",
      entries: [],
    };

  const file = cacheFile(plan);
  if (!force) {
    const cached = await readCache(file);
    if (cached) return cached;
  }

  try {
    let runs = await fetchCategory(plan.category);
    if (plan.familyFilter) {
      const family = plan.familyFilter.toLowerCase();
      runs = runs.filter((run) => runName(run).toLowerCase().includes(family));
    }
    const result: ActivityContextEvidence = {
      source: "eve-workbench-journal",
      status: runs.length ? "ready" : "no-data",
      contextSpecific: plan.contextSpecific,
      fetchedAt: new Date().toISOString(),
      sampleCount: runs.length,
      confidence: confidenceFor(runs.length),
      label: plan.label,
      note:
        plan.note ??
        (runs.length
          ? "Observed public runs support context selection only; they do not substitute for fitting or skill requirements."
          : "No matching public runs were found in the bounded recent sample."),
      entries: aggregate(runs),
    };
    await writeCache(file, result);
    return result;
  } catch (error) {
    const failed: ActivityContextEvidence = {
      source: "eve-workbench-journal",
      status: "error",
      contextSpecific: plan.contextSpecific,
      fetchedAt: new Date().toISOString(),
      sampleCount: 0,
      confidence: "none",
      label: plan.label,
      note:
        error instanceof Error
          ? error.message
          : "Public activity evidence lookup failed.",
      entries: [],
    };
    await writeCache(file, failed).catch(() => undefined);
    return failed;
  }
}
