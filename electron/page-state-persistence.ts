import { loadPersistedResult, savePersistedResult } from "./persistent-result-cache";

export const PAGE_STATE_SCHEMA_VERSION = 1;
export const PAGE_STATE_CACHE_KIND = "page-state-lkg";

export type PageStateScope = {
  kind: "global" | "account" | "character" | "region";
  id?: string;
};

export type PageStateSource = Record<string, string | number | boolean | null>;

export type PersistedPageState<T> = {
  schemaVersion: number;
  moduleId: string;
  scope: PageStateScope;
  source: PageStateSource;
  savedAt: string;
  payload: T;
};

export type PreparedPageStateSource = {
  source: "exact" | "last-known-good";
  savedAt: string;
  sourceRevision: PageStateSource;
};

export function pageStatePersistenceKey(moduleId: string, scope: PageStateScope) {
  return { moduleId, scope: { kind: scope.kind, ...(scope.id == null ? {} : { id: String(scope.id) }) } };
}

function sameScope(left: PageStateScope, right: PageStateScope) {
  return left.kind === right.kind && String(left.id ?? "") === String(right.id ?? "");
}

function isSource(value: unknown): value is PageStateSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((item) =>
    item == null || typeof item === "string" || typeof item === "number" || typeof item === "boolean");
}

export async function loadLastKnownGoodPageState<T>(input: {
  moduleId: string;
  scope: PageStateScope;
  validatePayload: (value: unknown) => value is T;
}): Promise<PersistedPageState<T> | undefined> {
  const value = await loadPersistedResult<unknown>(PAGE_STATE_CACHE_KIND, pageStatePersistenceKey(input.moduleId, input.scope));
  if (!value || typeof value !== "object") return undefined;
  const envelope = value as Partial<PersistedPageState<unknown>>;
  if (envelope.schemaVersion !== PAGE_STATE_SCHEMA_VERSION) return undefined;
  if (envelope.moduleId !== input.moduleId) return undefined;
  if (!envelope.scope || !sameScope(envelope.scope, input.scope)) return undefined;
  if (!isSource(envelope.source)) return undefined;
  if (typeof envelope.savedAt !== "string" || !Number.isFinite(Date.parse(envelope.savedAt))) return undefined;
  if (!input.validatePayload(envelope.payload)) return undefined;
  return envelope as PersistedPageState<T>;
}

export async function saveLastKnownGoodPageState<T>(input: {
  moduleId: string;
  scope: PageStateScope;
  source: PageStateSource;
  payload: T;
  validatePayload: (value: unknown) => value is T;
  savedAt?: string;
}) {
  if (!input.validatePayload(input.payload)) return false;
  const savedAt = input.savedAt && Number.isFinite(Date.parse(input.savedAt)) ? input.savedAt : new Date().toISOString();
  const envelope: PersistedPageState<T> = {
    schemaVersion: PAGE_STATE_SCHEMA_VERSION,
    moduleId: input.moduleId,
    scope: { kind: input.scope.kind, ...(input.scope.id == null ? {} : { id: String(input.scope.id) }) },
    source: input.source,
    savedAt,
    payload: input.payload,
  };
  try {
    await savePersistedResult(PAGE_STATE_CACHE_KIND, pageStatePersistenceKey(input.moduleId, input.scope), envelope);
    return true;
  } catch {
    // The exact prepared result remains authoritative even if the UX fallback
    // cannot be advanced. Atomic replacement in persistent-result-cache keeps
    // the previous good envelope intact on replacement failures.
    return false;
  }
}

export function exactPreparedPageState(savedAt: string | null | undefined, sourceRevision: PageStateSource): PreparedPageStateSource {
  const safeSavedAt = savedAt && Number.isFinite(Date.parse(savedAt)) ? savedAt : new Date().toISOString();
  return { source: "exact", savedAt: safeSavedAt, sourceRevision };
}

export function lastKnownGoodPreparedPageState<T>(envelope: PersistedPageState<T>): PreparedPageStateSource {
  return { source: "last-known-good", savedAt: envelope.savedAt, sourceRevision: envelope.source };
}
