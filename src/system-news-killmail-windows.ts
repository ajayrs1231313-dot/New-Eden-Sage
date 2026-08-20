export type KillmailWindowKey = "1h" | "24h" | "7d" | "30d";

export const KILLMAIL_WINDOW_MS: Record<KillmailWindowKey, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

function killmailId(item: any) {
  const value = Number(item?.killmailId ?? item?.killmail_id ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function killmailTime(item: any) {
  const value = Date.parse(String(item?.killmailTime ?? item?.killmail_time ?? ""));
  return Number.isFinite(value) ? value : 0;
}

function detailScore(item: any) {
  const victimItems = Array.isArray(item?.victim?.items) ? item.victim.items.length : 0;
  const attackers = Array.isArray(item?.attackers) ? item.attackers.length : 0;
  return victimItems * 100 + attackers * 5 + (item?.victim?.ship_type_id ? 2 : 0) + (killmailTime(item) ? 1 : 0);
}

/**
 * Merge killmail sources without allowing a narrower asynchronous cache update to
 * erase killmails already composed from other legitimate sources.
 */
export function mergeSystemNewsKillmails(...groups: any[][]) {
  const byId = new Map<number, any>();
  for (const group of groups) {
    for (const item of Array.isArray(group) ? group : []) {
      const id = killmailId(item);
      if (!id) continue;
      const current = byId.get(id);
      if (!current) {
        byId.set(id, item);
        continue;
      }
      if (detailScore(item) > detailScore(current)) byId.set(id, item);
      else {
        byId.set(id, {
          ...item,
          ...current,
          totalValue: current?.totalValue ?? item?.totalValue,
          points: current?.points ?? item?.points,
          labels: current?.labels ?? item?.labels,
          victim: detailScore(current) >= detailScore(item) ? current?.victim : item?.victim,
          attackers: detailScore(current) >= detailScore(item) ? current?.attackers : item?.attackers,
        });
      }
    }
  }
  return [...byId.values()].sort((a, b) => killmailTime(b) - killmailTime(a) || killmailId(b) - killmailId(a));
}

/** One canonical set of arrays feeds both card counts and the clicked list. */
export function buildSystemNewsKillmailWindows(killmails: any[], now = Date.now()) {
  const all = mergeSystemNewsKillmails(killmails);
  const result = { all } as { all: any[] } & Record<KillmailWindowKey, any[]>;
  for (const key of ["1h", "24h", "7d", "30d"] as KillmailWindowKey[]) {
    const cutoff = now - KILLMAIL_WINDOW_MS[key];
    result[key] = all.filter((item) => killmailTime(item) >= cutoff);
  }
  return result;
}
