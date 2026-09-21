import type { CharacterSnapshot } from "./types";
import type { CharacterNavigateTarget } from "./character-navigation";

export type CommandSignal = {
  id: string;
  title: string;
  detail?: string;
  severity: "red" | "amber" | "green";
  target?: CharacterNavigateTarget;
  action?: string;
  weight: number;
};

export type CorporationOperationSummary = {
  summary?: { id?: string };
  payload?: {
    title?: string;
    operationType?: string;
    startsAt?: string;
    status?: string;
  };
};

const HOUR = 60 * 60 * 1000;
const WATCH_WINDOW = 48 * HOUR;

function timeUntil(ms: number) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins ? `${hours}h ${mins}m` : `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function orderExpiry(order: any) {
  const issued = Date.parse(String(order?.issued ?? ""));
  const duration = Number(order?.duration ?? order?.durationDays ?? 0);
  return Number.isFinite(issued) && duration > 0 ? issued + duration * 86400000 : Number.NaN;
}

function orderSide(order: any): "buy" | "sell" {
  return Boolean(order?.is_buy_order ?? order?.isBuy ?? order?.buy) ? "buy" : "sell";
}

function industryKind(job: any) {
  const activity = Number(job?.activity_id ?? job?.activityId ?? job?.activity);
  if (activity === 1) return "manufacturing";
  if (activity === 3 || activity === 4) return "research";
  if (activity === 5) return "copying";
  if (activity === 8) return "invention";
  if (activity === 9) return "reaction";
  return "industry";
}

function jobEnd(job: any) {
  const value = Date.parse(String(job?.end_date ?? job?.endDate ?? ""));
  return Number.isFinite(value) ? value : Number.NaN;
}

function addGroupedJobs(
  result: CommandSignal[],
  jobs: any[],
  idPrefix: string,
  state: "completed" | "upcoming",
  now: number,
) {
  const grouped = new Map<string, any[]>();
  for (const job of jobs) {
    const kind = industryKind(job);
    const rows = grouped.get(kind) ?? [];
    rows.push(job);
    grouped.set(kind, rows);
  }

  for (const [kind, rows] of grouped) {
    const noun = kind === "industry" ? "industry job" : `${kind} job`;
    if (state === "completed") {
      result.push({
        id: `${idPrefix}-${kind}`,
        title: `${rows.length} ${noun}${rows.length === 1 ? "" : "s"} completed`,
        detail: "Ready for attention now.",
        severity: "red",
        target: "industrial",
        action: "Open Industrial",
        weight: 110,
      });
    } else {
      const nearest = Math.min(...rows.map(jobEnd).filter(Number.isFinite));
      result.push({
        id: `${idPrefix}-${kind}`,
        title: `${rows.length} ${noun}${rows.length === 1 ? "" : "s"} completing within 48h`,
        detail: Number.isFinite(nearest) ? `Next in ${timeUntil(nearest - now)}.` : undefined,
        severity: "amber",
        target: "industrial",
        action: "Open Industrial",
        weight: 70,
      });
    }
  }
}

export function buildCommandSignals(
  snapshot: CharacterSnapshot,
  corporationOps: CorporationOperationSummary[] = [],
  now = Date.now(),
) {
  const priority: CommandSignal[] = [];
  const watch: CommandSignal[] = [];
  const extended = (snapshot.extended ?? {}) as Record<string, any>;

  const jobs = Array.isArray(extended.industryJobs) ? extended.industryJobs : [];
  const completedJobs = jobs.filter((job: any) => {
    const status = String(job?.status ?? "").toLowerCase();
    const end = jobEnd(job);
    return status === "ready" || (status === "active" && Number.isFinite(end) && end <= now);
  });
  const upcomingJobs = jobs.filter((job: any) => {
    const status = String(job?.status ?? "").toLowerCase();
    const end = jobEnd(job);
    const delta = end - now;
    return status === "active" && Number.isFinite(end) && delta > 0 && delta <= WATCH_WINDOW;
  });
  addGroupedJobs(priority, completedJobs, "job-complete", "completed", now);
  addGroupedJobs(watch, upcomingJobs, "job-upcoming", "upcoming", now);

  const orders = Array.isArray(extended.marketOrders) ? extended.marketOrders : [];
  for (const side of ["sell", "buy"] as const) {
    const relevant = orders.filter((order: any) => orderSide(order) === side);
    const expired = relevant.filter((order: any) => {
      const state = String(order?.state ?? order?.status ?? "").toLowerCase();
      const expires = orderExpiry(order);
      return state === "expired" || (Number.isFinite(expires) && expires <= now);
    });
    const upcoming = relevant.filter((order: any) => {
      const state = String(order?.state ?? order?.status ?? "").toLowerCase();
      const expires = orderExpiry(order);
      const delta = expires - now;
      return state !== "expired" && state !== "cancelled" && Number.isFinite(expires) && delta > 0 && delta <= WATCH_WINDOW;
    });

    if (expired.length) {
      priority.push({
        id: `market-${side}-expired`,
        title: `${expired.length} ${side} order${expired.length === 1 ? "" : "s"} expired`,
        detail: "Needs attention now.",
        severity: "red",
        target: "asset-market",
        action: "Open Market",
        weight: 108,
      });
    }
    if (upcoming.length) {
      const nearest = Math.min(...upcoming.map(orderExpiry).filter(Number.isFinite));
      watch.push({
        id: `market-${side}-upcoming`,
        title: `${upcoming.length} ${side} order${upcoming.length === 1 ? "" : "s"} expiring within 48h`,
        detail: Number.isFinite(nearest) ? `Next in ${timeUntil(nearest - now)}.` : undefined,
        severity: "amber",
        target: "asset-market",
        action: "Open Market",
        weight: 72,
      });
    }
  }

  const queueFinish = snapshot.queue
    .map((item) => item.finish_date ? Date.parse(item.finish_date) : Number.NaN)
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0] ?? Number.NaN;
  if (!snapshot.queue.length || (Number.isFinite(queueFinish) && queueFinish <= now)) {
    priority.push({
      id: "skill-queue-empty",
      title: "Skill queue needs attention",
      detail: "Training is idle.",
      severity: "red",
      target: "activity-skills",
      action: "Open Skills",
      weight: 112,
    });
  } else if (Number.isFinite(queueFinish) && queueFinish - now <= WATCH_WINDOW) {
    watch.push({
      id: "skill-queue-upcoming",
      title: "Skill queue ends within 48h",
      detail: `Ends in ${timeUntil(queueFinish - now)}.`,
      severity: "amber",
      target: "activity-skills",
      action: "Open Skills",
      weight: 68,
    });
  }

  const contracts = Array.isArray(extended.contracts) ? extended.contracts : [];
  if (contracts.some((contract: any) => ["in_progress", "outstanding", "accepted"].includes(String(contract?.status ?? "").toLowerCase()))) {
    priority.push({
      id: "contract-active",
      title: "You have a contract needing attention.",
      severity: "red",
      weight: 100,
    });
  }

  for (const op of corporationOps) {
    const payload = op?.payload ?? {};
    const status = String(payload.status ?? "").toLowerCase();
    if (status === "cancelled" || status === "complete") continue;
    const start = Date.parse(String(payload.startsAt ?? ""));
    if (!Number.isFinite(start)) continue;
    const delta = start - now;
    if (delta <= 0) continue;

    const title = payload.title?.trim() || payload.operationType?.trim() || "Corporation operation";
    const operationType = payload.operationType?.trim();
    const soonnessWeight = delta <= 24 * HOUR ? 92 : delta <= WATCH_WINDOW ? 84 : 78;
    watch.push({
      id: `corp-op-watch-${op.summary?.id ?? start}`,
      title,
      detail: `${operationType ? `${operationType} · ` : ""}Starts in ${timeUntil(delta)}.`,
      severity: "amber",
      weight: soonnessWeight,
    });
  }

  if (!priority.length) {
    priority.push({
      id: "all-clear",
      title: "No urgent character actions detected",
      severity: "green",
      weight: 1,
    });
  }

  if (!watch.length) {
    watch.push({
      id: "watch-clear",
      title: "Nothing currently on the horizon",
      severity: "green",
      weight: 1,
    });
  }

  priority.sort((a, b) => b.weight - a.weight);
  watch.sort((a, b) => b.weight - a.weight);
  return { priority, watch };
}
