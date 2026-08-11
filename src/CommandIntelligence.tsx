import { useEffect, useMemo, useState } from "react";
import type { CharacterSnapshot, EveNewsItem } from "./types";

type Severity = "red" | "orange" | "yellow" | "green";
type PriorityItem = {
  id: string;
  severity: Severity;
  title: string;
  detail?: string;
  action?: string;
  target?: "skills" | "market" | "regional" | "fittings";
  weight: number;
};

const severityLabel: Record<Severity, string> = {
  red: "Action required now",
  orange: "Opportunity / expires soon",
  yellow: "Reminder",
  green: "Informational",
};

function remaining(target: Date, now = Date.now()) {
  const ms = target.getTime() - now;
  if (ms <= 0) return "now";
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function makePriorityItems(snapshot: CharacterSnapshot): PriorityItem[] {
  const now = Date.now();
  const result: PriorityItem[] = [];
  const extended = (snapshot.extended ?? {}) as Record<string, any>;

  const queueFinishDates = snapshot.queue
    .map((item) => item.finish_date)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((date) => Number.isFinite(date.getTime()) && date.getTime() > now)
    .sort((a, b) => a.getTime() - b.getTime());
  const queueEnd = queueFinishDates.at(-1);
  if (queueEnd) {
    const hours = (queueEnd.getTime() - now) / 3600000;
    result.push({
      id: "skill-queue",
      severity: hours <= 3 ? "red" : hours <= 24 ? "orange" : "green",
      title: `Skill queue ends in ${remaining(queueEnd, now)}`,
      detail: `${snapshot.queue.length} queued skill${snapshot.queue.length === 1 ? "" : "s"}`,
      action: "Add another skill",
      target: "skills",
      weight: hours <= 3 ? 100 : hours <= 24 ? 75 : 20,
    });
  } else {
    result.push({
      id: "skill-queue-empty",
      severity: "red",
      title: "Skill queue is empty",
      detail: "Training is currently idle.",
      action: "Open Skills",
      target: "skills",
      weight: 110,
    });
  }

  const jobs = Array.isArray(extended.industryJobs) ? extended.industryJobs : [];
  const completeJobs = jobs.filter((job: any) => {
    const end = job?.end_date ? new Date(job.end_date).getTime() : 0;
    return job?.status === "ready" || (job?.status === "active" && end > 0 && end <= now);
  });
  if (completeJobs.length) {
    result.push({
      id: "industry-complete",
      severity: "red",
      title: `${completeJobs.length} manufacturing job${completeJobs.length === 1 ? "" : "s"} complete`,
      detail: "Completed industry jobs are waiting for delivery.",
      action: "Review jobs",
      weight: 98,
    });
  }

  const marketOrders = Array.isArray(extended.marketOrders) ? extended.marketOrders : [];
  const expiredOrders = marketOrders.filter((order: any) => {
    const state = String(order?.state ?? order?.status ?? "").toLowerCase();
    const issued = order?.issued ? new Date(order.issued).getTime() : 0;
    const durationDays = Number(order?.duration ?? order?.durationDays ?? 0);
    const expires = issued && durationDays ? issued + durationDays * 86400000 : 0;
    return state === "expired" || state === "cancelled" || (expires > 0 && expires <= now);
  });
  if (expiredOrders.length) {
    result.push({
      id: "market-expired",
      severity: "red",
      title: `${expiredOrders.length} market order${expiredOrders.length === 1 ? "" : "s"} expired`,
      detail: "Review pricing and relist where appropriate.",
      action: "Open Market",
      target: "regional",
      weight: 96,
    });
  }

  const contracts = Array.isArray(extended.contracts) ? extended.contracts : [];
  const accepted = contracts.filter((contract: any) => {
    const status = String(contract?.status ?? "").toLowerCase();
    return status === "in_progress" || status === "outstanding" || status === "accepted";
  });
  const nearestContract = accepted
    .map((contract: any) => ({
      contract,
      expires: contract?.date_expired ? new Date(contract.date_expired) : null,
    }))
    .filter((item: any) => item.expires && item.expires.getTime() > now)
    .sort((a: any, b: any) => a.expires.getTime() - b.expires.getTime())[0];
  if (nearestContract?.expires) {
    const hours = (nearestContract.expires.getTime() - now) / 3600000;
    result.push({
      id: "contract-active",
      severity: hours <= 6 ? "orange" : "green",
      title: `Contract accepted${hours <= 24 ? ` · ${remaining(nearestContract.expires, now)} left` : ""}`,
      detail: nearestContract.contract?.title || "Active contract requires follow-through.",
      action: "Review contract",
      weight: hours <= 6 ? 82 : 18,
    });
  }

  if (snapshot.wallet >= 5_000_000_000) {
    result.push({
      id: "wallet-high",
      severity: "yellow",
      title: `Wallet over ${(snapshot.wallet / 1_000_000_000).toFixed(1)}b ISK`,
      detail: "Large idle cash balance detected.",
      action: "Open ISK Lab",
      target: "market",
      weight: 45,
    });
  }

  if (!result.some((item) => item.severity === "red" || item.severity === "orange")) {
    result.push({
      id: "all-clear",
      severity: "green",
      title: "No urgent character actions detected",
      detail: `Last sync ${new Date(snapshot.updatedAt).toLocaleString()}.`,
      weight: 5,
    });
  }

  return result.sort((a, b) => b.weight - a.weight);
}

export function CommandIntelligence({
  snapshot,
  onNavigate,
}: {
  snapshot: CharacterSnapshot;
  onNavigate(target: "skills" | "market" | "regional" | "fittings"): void;
}) {
  const priorities = useMemo(() => makePriorityItems(snapshot), [snapshot]);
  const [showAll, setShowAll] = useState(false);
  const [news, setNews] = useState<EveNewsItem[]>([]);
  const [newsFilter, setNewsFilter] = useState<"ccp" | "market" | "war" | "events">("ccp");
  const [newsState, setNewsState] = useState("Loading EVE news…");

  useEffect(() => {
    let cancelled = false;
    window.sage.getEveNews(false).then((items) => {
      if (cancelled) return;
      setNews(items);
      setNewsState(items.length ? "" : "No EVE news items returned.");
    }).catch((error) => {
      if (cancelled) return;
      setNewsState(error instanceof Error ? error.message : "EVE news unavailable.");
    });
    return () => { cancelled = true; };
  }, []);

  const visiblePriorities = showAll ? priorities : priorities.slice(0, 5);
  const filteredNews = news.filter((item) => item.category === newsFilter).slice(0, 5);

  return (
    <div className="command-intelligence-grid">
      <article className="command-priority-panel">
        <div className="command-panel-heading">
          <div>
            <p className="eyebrow">COMMAND PRIORITY</p>
            <h3>⚠ Needs Attention</h3>
          </div>
          <span>{priorities.length} tracked</span>
        </div>
        <div className="priority-list">
          {visiblePriorities.map((item) => (
            <div className={`priority-item priority-${item.severity}`} key={item.id}>
              <span className="priority-dot" title={severityLabel[item.severity]} />
              <div className="priority-copy">
                <strong>{item.title}</strong>
                {item.detail && <small>{item.detail}</small>}
              </div>
              {item.action && (
                <button disabled={!item.target} onClick={() => item.target && onNavigate(item.target)}>
                  {item.action}
                </button>
              )}
            </div>
          ))}
        </div>
        {priorities.length > 5 && (
          <button className="priority-view-all" onClick={() => setShowAll((value) => !value)}>
            {showAll ? "Show top 5" : `View all (${priorities.length})`}
          </button>
        )}
      </article>

      <article className="eve-news-panel">
        <div className="command-panel-heading">
          <div>
            <p className="eyebrow">EVE NEWS</p>
            <h3>Tranquility Intelligence</h3>
          </div>
          <button
            className="news-refresh"
            onClick={() => {
              setNewsState("Refreshing…");
              window.sage.getEveNews(true).then((items) => {
                setNews(items);
                setNewsState("");
              }).catch((error) => setNewsState(error instanceof Error ? error.message : "Refresh failed."));
            }}
          >↻</button>
        </div>
        <div className="news-filters">
          {(["ccp", "market", "war", "events"] as const).map((filter) => (
            <button key={filter} className={newsFilter === filter ? "active" : ""} onClick={() => setNewsFilter(filter)}>
              {filter === "ccp" ? "CCP" : filter === "market" ? "Market" : filter === "war" ? "War" : "Events"}
            </button>
          ))}
        </div>
        {newsState ? <div className="news-state">{newsState}</div> : (
          <div className="news-list">
            {filteredNews.length ? filteredNews.map((item) => (
              <a key={item.id} href={item.link} target="_blank" rel="noreferrer">
                <span className={`news-category news-${item.category}`}>{item.category.toUpperCase()}</span>
                <strong>{item.title}</strong>
                <small>{new Date(item.publishedAt).toLocaleDateString()}</small>
              </a>
            )) : <div className="news-state">No recent items in this category.</div>}
          </div>
        )}
      </article>
    </div>
  );
}
