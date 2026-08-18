export const SYSTEM_NEWS_ZKILL_COOLDOWN_MS = 5 * 60 * 1000;
export const SYSTEM_NEWS_ZKILL_LOOKBACK_SECONDS = 60 * 60;
export const SYSTEM_NEWS_ZKILL_BACKFILL_DAYS = 30;
export const SYSTEM_NEWS_ZKILL_MAX_ROWS = 1000;

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
  return rowCount >= SYSTEM_NEWS_ZKILL_MAX_ROWS && (!oldestResolvedTime || oldestResolvedTime >= cutoffTime);
}

export function parseIsoTime(value?: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function killmailRefreshCycleAllowed(lastCycleRequestedAt?: string | null, now = Date.now()) {
  const previous = parseIsoTime(lastCycleRequestedAt);
  return !previous || now - previous >= SYSTEM_NEWS_ZKILL_COOLDOWN_MS;
}

export function nextKillmailRequestTime(lastRequestAt?: string | null) {
  const previous = parseIsoTime(lastRequestAt);
  return previous ? previous + SYSTEM_NEWS_ZKILL_COOLDOWN_MS : 0;
}
