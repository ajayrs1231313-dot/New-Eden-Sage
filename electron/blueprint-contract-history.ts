import { loadPersistedResult, savePersistedResult } from "./persistent-result-cache";
import { sharedMarketServerBaseUrl } from "./shared-market-data";
import { logEvent } from "./logger";
import type { BlueprintIdentityRecord, BlueprintKind } from "./asset-valuation";

const CACHE_KIND = "blueprint-contract-valuation-v3";
const MEMORY_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 90_000;
const DEFAULT_LOOKBACK_DAYS = 120;

export type BlueprintContractValuationQuery = {
  typeId: number;
  blueprintKind: Exclude<BlueprintKind, "UNKNOWN">;
  materialEfficiency: number;
  timeEfficiency: number;
  runs: number | null;
};

export type BlueprintContractValuationEvidence = BlueprintContractValuationQuery & {
  estimatedValue: number | null;
  calculatedMidpointValue: number | null;
  medianValue: number | null;
  trimmedMeanValue: number | null;
  minValue: number | null;
  maxValue: number | null;
  lowestAcceptedPrice: number | null;
  highestAcceptedPrice: number | null;
  sampleCount: number;
  rawExactMatchCount: number;
  rawComparableMatchCount: number;
  exactMatchCount: number;
  comparableMatchCount: number;
  outlierCount: number;
  rejectedOutlierCount: number;
  confidence: "high" | "medium" | "low" | "none";
  researchMatch: "exact" | "extremely-close" | "max-research-reference" | "research-interpolation" | "nearby" | "comparable" | "none";
  researchMatchType: "exact" | "extremely-close" | "max-research-reference" | "research-interpolation" | "nearby" | "comparable" | "none";
  runsMatch: boolean;
  baseBlueprintValue: number | null;
  maxResearchAnchor: number | null;
  derivedResearchPremium: number | null;
  appliedResearchFraction: number | null;
  lookbackDays: number;
  newestSampleAt: string | null;
  oldestSampleAt: string | null;
  removedBeforeExpiryCount: number;
  valuationSource: "contract-history-exact" | "contract-history-comparable" | "bpc-contract-history" | "no-contract-history";
  evidenceBasis: string;
  observedSaleEvidence: false;
  evidenceNote: string;
  historyRevision?: string;
  historyRetentionDays?: number;
  historyOldestRetainedAt?: string | null;
  historyNewestRetainedAt?: string | null;
  generatedAt?: string;
  cacheStatus?: "live" | "memory" | "last-known-good";
};

type ServerResponse = {
  schemaVersion: number;
  generatedAt: string;
  historyRevision: string;
  historyRetentionDays: number;
  historyOldestRetainedAt: string | null;
  historyNewestRetainedAt: string | null;
  evidenceBasis: string;
  observedSaleEvidence: false;
  results: BlueprintContractValuationEvidence[];
};

type MemoryEntry = { value: BlueprintContractValuationEvidence; expiresAt: number };
const memory = new Map<string, MemoryEntry>();

function finiteInteger(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

export function blueprintContractQueryKey(query: BlueprintContractValuationQuery) {
  return [query.typeId, query.blueprintKind, query.materialEfficiency, query.timeEfficiency, query.runs ?? "-"] .join(":");
}

export function blueprintContractQueryForRecord(record: BlueprintIdentityRecord | undefined): BlueprintContractValuationQuery | null {
  if (!record) return null;
  const typeId = finiteInteger(record.type_id);
  const quantity = finiteInteger(record.quantity);
  const materialEfficiency = finiteInteger(record.material_efficiency);
  const timeEfficiency = finiteInteger(record.time_efficiency);
  if (typeId <= 0 || (quantity !== -1 && quantity !== -2)) return null;
  const blueprintKind = quantity === -2 ? "BPC" as const : "BPO" as const;
  const runs = blueprintKind === "BPC" ? finiteInteger(record.runs) : null;
  if (blueprintKind === "BPC" && (runs ?? 0) <= 0) return null;
  return { typeId, blueprintKind, materialEfficiency, timeEfficiency, runs };
}

function normalizeEvidence(value: unknown, metadata?: Omit<ServerResponse, "results">): BlueprintContractValuationEvidence | null {
  if (!value || typeof value !== "object") return null;
  const item = value as BlueprintContractValuationEvidence;
  const query: BlueprintContractValuationQuery = {
    typeId: finiteInteger(item.typeId),
    blueprintKind: item.blueprintKind === "BPC" ? "BPC" : item.blueprintKind === "BPO" ? "BPO" : ("" as any),
    materialEfficiency: finiteInteger(item.materialEfficiency),
    timeEfficiency: finiteInteger(item.timeEfficiency),
    runs: item.blueprintKind === "BPC" ? finiteInteger(item.runs) : null,
  };
  if (query.typeId <= 0 || !query.blueprintKind || (query.blueprintKind === "BPC" && (query.runs ?? 0) <= 0)) return null;
  const estimatedValue = item.estimatedValue == null ? null : Number(item.estimatedValue);
  if (estimatedValue != null && (!Number.isFinite(estimatedValue) || estimatedValue <= 0)) return null;
  if (!["contract-history-exact", "contract-history-comparable", "bpc-contract-history", "no-contract-history"].includes(String(item.valuationSource))) return null;
  return {
    ...item,
    ...query,
    estimatedValue,
    sampleCount: Math.max(0, finiteInteger(item.sampleCount)),
    exactMatchCount: Math.max(0, finiteInteger(item.exactMatchCount)),
    comparableMatchCount: Math.max(0, finiteInteger(item.comparableMatchCount)),
    rawExactMatchCount: Math.max(0, finiteInteger(item.rawExactMatchCount)),
    rawComparableMatchCount: Math.max(0, finiteInteger(item.rawComparableMatchCount)),
    outlierCount: Math.max(0, finiteInteger(item.outlierCount)),
    lookbackDays: Math.max(1, finiteInteger(item.lookbackDays, DEFAULT_LOOKBACK_DAYS)),
    historyRevision: metadata?.historyRevision ?? item.historyRevision,
    historyRetentionDays: metadata?.historyRetentionDays ?? item.historyRetentionDays,
    historyOldestRetainedAt: metadata?.historyOldestRetainedAt ?? item.historyOldestRetainedAt,
    historyNewestRetainedAt: metadata?.historyNewestRetainedAt ?? item.historyNewestRetainedAt,
    generatedAt: metadata?.generatedAt ?? item.generatedAt,
  };
}

function uniqueQueries(queries: BlueprintContractValuationQuery[]) {
  return [...new Map(queries.map((query) => [blueprintContractQueryKey(query), query])).values()];
}

async function loadLastKnownGood(query: BlueprintContractValuationQuery) {
  const cached = await loadPersistedResult<BlueprintContractValuationEvidence>(CACHE_KIND, { query });
  const normalized = normalizeEvidence(cached);
  return normalized ? { ...normalized, cacheStatus: "last-known-good" as const } : null;
}

async function saveLastKnownGood(value: BlueprintContractValuationEvidence) {
  const query: BlueprintContractValuationQuery = {
    typeId: value.typeId,
    blueprintKind: value.blueprintKind,
    materialEfficiency: value.materialEfficiency,
    timeEfficiency: value.timeEfficiency,
    runs: value.runs,
  };
  await savePersistedResult(CACHE_KIND, { query }, value);
}

async function requestServer(queries: BlueprintContractValuationQuery[], lookbackDays: number): Promise<BlueprintContractValuationEvidence[]> {
  const root = sharedMarketServerBaseUrl();
  if (!root) throw new Error("Shared market service URL is not configured.");
  const response = await fetch(`${root}/contract-history/blueprint-valuations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-New-Eden-Sage-Client": "desktop",
    },
    body: JSON.stringify({ lookbackDays, queries }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Blueprint contract-history service returned HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  const payload = await response.json() as ServerResponse;
  if (payload?.schemaVersion !== 2 || !Array.isArray(payload.results)) throw new Error("Blueprint contract-history response is invalid.");
  const metadata = {
    schemaVersion: payload.schemaVersion,
    generatedAt: payload.generatedAt,
    historyRevision: payload.historyRevision,
    historyRetentionDays: payload.historyRetentionDays,
    historyOldestRetainedAt: payload.historyOldestRetainedAt,
    historyNewestRetainedAt: payload.historyNewestRetainedAt,
    evidenceBasis: payload.evidenceBasis,
    observedSaleEvidence: payload.observedSaleEvidence,
  } as Omit<ServerResponse, "results">;
  return payload.results.map((item) => normalizeEvidence(item, metadata)).filter((item): item is BlueprintContractValuationEvidence => Boolean(item));
}

export async function loadBlueprintContractValuations(
  queries: BlueprintContractValuationQuery[],
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): Promise<Map<string, BlueprintContractValuationEvidence>> {
  const requested = uniqueQueries(queries);
  const result = new Map<string, BlueprintContractValuationEvidence>();
  if (!requested.length) return result;

  const now = Date.now();
  const missing: BlueprintContractValuationQuery[] = [];
  for (const query of requested) {
    const key = blueprintContractQueryKey(query);
    const cached = memory.get(key);
    if (cached && cached.expiresAt > now) result.set(key, { ...cached.value, cacheStatus: "memory" });
    else {
      memory.delete(key);
      missing.push(query);
    }
  }
  if (!missing.length) return result;

  const startedAt = Date.now();
  try {
    const live = await requestServer(missing, Math.max(1, Math.min(DEFAULT_LOOKBACK_DAYS, finiteInteger(lookbackDays, DEFAULT_LOOKBACK_DAYS))));
    const byKey = new Map(live.map((value) => [blueprintContractQueryKey(value), value]));
    for (const query of missing) {
      const key = blueprintContractQueryKey(query);
      const value = byKey.get(key);
      if (!value) continue;
      const liveValue = { ...value, cacheStatus: "live" as const };
      memory.set(key, { value: liveValue, expiresAt: now + MEMORY_TTL_MS });
      result.set(key, liveValue);
      await saveLastKnownGood(liveValue).catch(() => undefined);
    }
    void logEvent("info", "blueprint_contract_history.query_ms", {
      durationMs: Date.now() - startedAt,
      requested: missing.length,
      returned: live.length,
      historyRevision: live[0]?.historyRevision ?? null,
    });
    return result;
  } catch (error) {
    void logEvent("warn", "blueprint_contract_history.server_unavailable_using_lkg", {
      durationMs: Date.now() - startedAt,
      requested: missing.length,
      error: error instanceof Error ? error.message : String(error),
    });
    const persisted = await Promise.all(missing.map(async (query) => ({ query, value: await loadLastKnownGood(query) })));
    for (const { query, value } of persisted) {
      if (!value) continue;
      const key = blueprintContractQueryKey(query);
      result.set(key, value);
      memory.set(key, { value, expiresAt: now + MEMORY_TTL_MS });
    }
    return result;
  }
}

export function clearBlueprintContractValuationMemoryCacheForTests() {
  memory.clear();
}
