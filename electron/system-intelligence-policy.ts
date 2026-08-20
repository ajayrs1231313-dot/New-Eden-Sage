export const SYSTEM_NEWS_ZKILL_REQUEST_SPACING_MS = 15 * 1000;
export const SYSTEM_NEWS_ZKILL_CACHE_TTL_MS = 5 * 60 * 1000;
// Backwards-compatible status field: this is now request spacing, not cache freshness.
export const SYSTEM_NEWS_ZKILL_COOLDOWN_MS = SYSTEM_NEWS_ZKILL_REQUEST_SPACING_MS;
export const SYSTEM_NEWS_ZKILL_LOOKBACK_SECONDS = 24 * 60 * 60;
export const SYSTEM_NEWS_ZKILL_BACKFILL_DAYS = 30;
// zKillboard kill endpoints currently paginate at 200 rows. Treating a full
// page as 1000 rows caused Sage to stop after page 1, leaving busy-system
// 24-hour windows incomplete.
export const SYSTEM_NEWS_ZKILL_PAGE_SIZE = 200;

export type ZkillBackfillMonth = { year: number; month: number };

export function killmailBackfillCutoffTime(now = Date.now()) {
  return now - SYSTEM_NEWS_ZKILL_BACKFILL_DAYS * 24 * 60 * 60 * 1000;
}

export function killmailBackfillMonths(now = Date.now()): ZkillBackfillMonth[] {
  const current = new Date(now);
  const cutoff = new Date(killmailBackfillCutoffTime(now));
  let year = current.getUTCFullYear();
  let month = current.getUTCMonth() + 1;
  const cutoffYear = cutoff.getUTCFullYear();
  const cutoffMonth = cutoff.getUTCMonth() + 1;
  const result: ZkillBackfillMonth[] = [];
  while (year > cutoffYear || (year === cutoffYear && month >= cutoffMonth)) {
    result.push({ year, month });
    if (year === cutoffYear && month === cutoffMonth) break;
    month -= 1;
    if (month === 0) { month = 12; year -= 1; }
  }
  return result;
}

export function zkillBackfillNeedsNextPage(rowCount: number, oldestResolvedTime: number, cutoffTime: number) {
  return rowCount >= SYSTEM_NEWS_ZKILL_PAGE_SIZE && (!oldestResolvedTime || oldestResolvedTime >= cutoffTime);
}

export function parseIsoTime(value?: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export type SystemIntelligenceCaller = "watch" | "route" | "single";

export function killmailCallerPriority(caller?: SystemIntelligenceCaller) {
  return caller === "watch" || caller === "single" ? 3 : caller === "route" ? 1 : 2;
}

export function killmailRefreshCycleAllowed(lastCycleRequestedAt?: string | null, now = Date.now()) {
  const previous = parseIsoTime(lastCycleRequestedAt);
  return !previous || now - previous >= SYSTEM_NEWS_ZKILL_REQUEST_SPACING_MS;
}

export function nextKillmailRequestTime(lastRequestAt?: string | null) {
  const previous = parseIsoTime(lastRequestAt);
  return previous ? previous + SYSTEM_NEWS_ZKILL_REQUEST_SPACING_MS : 0;
}

export function killmailCacheNeedsQueue(updatedAt?: string | null, alreadyQueued = false, now = Date.now()) {
  const updated = parseIsoTime(updatedAt);
  const fresh = updated > 0 && updated >= now - SYSTEM_NEWS_ZKILL_CACHE_TTL_MS;
  return !fresh && !alreadyQueued;
}

export function deepKillmailBackfillForCaller(caller?: SystemIntelligenceCaller, explicit?: boolean) {
  return explicit ?? caller !== "route";
}
