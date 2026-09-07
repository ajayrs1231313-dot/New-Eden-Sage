import { useEffect, useMemo, useState } from "react";
import type { OpportunityAnalysis, OpportunityKind, PersonalOpportunity } from "./types";

const money = (value: number) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);

type ExplorerKind = Exclude<OpportunityKind, "pve">;

function kindLabel(kind: ExplorerKind) {
  if (kind === "trade") return "Market trade";
  if (kind === "asset") return "Owned asset";
  return "Regional shortage";
}

function securityLabel(routeSecurity: PersonalOpportunity["routeSecurity"]) {
  if (routeSecurity === "null") return "NULL SEC";
  if (routeSecurity === "low") return "LOW SEC";
  if (routeSecurity === "high") return "HIGH SEC";
  return "ROUTE UNKNOWN";
}

export function OpportunityExplorer({
  analysis,
  onCargoCapacityChange,
  marketBusy = false,
}: {
  analysis: OpportunityAnalysis;
  onCargoCapacityChange?: (cargoCapacityM3: number | null) => void | Promise<void>;
  marketBusy?: boolean;
}) {
  const [kind, setKind] = useState<"all" | ExplorerKind>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cargoInput, setCargoInput] = useState(String(Math.round(analysis.constraints.cargoCapacityM3)));
  useEffect(() => setCargoInput(String(Math.round(analysis.constraints.cargoCapacityM3))), [analysis.constraints.cargoCapacityM3]);
  const applyCargo = () => {
    const parsed = Number(cargoInput.replace(/,/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) void onCargoCapacityChange?.(Math.round(parsed));
  };
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return analysis.ranked
      .filter((item): item is PersonalOpportunity & { kind: ExplorerKind } => item.kind !== "pve")
      .sort((a, b) => b.score - a.score || b.primaryValue - a.primaryValue)
      .filter((item) => {
        if (kind !== "all" && item.kind !== kind) return false;
        if (!query) return true;
        return `${item.title} ${item.subtitle} ${item.category} ${item.action}`
          .toLowerCase()
          .includes(query);
      });
  }, [analysis.ranked, kind, search]);

  return (
    <section className="opportunity-explorer">
      <div className="opportunity-heading">
        <div>
          <p className="eyebrow">OPPORTUNITIES</p>
          <h3>Best useful moves under your current limits</h3>
          <p className="opportunity-quick-isk"><strong>Want quick ISK?</strong> Enter your cargo capacity in m³ of the ship you want to use, click Apply, pick a ranked opportunity and go.</p>
          <p className="opportunity-ranking-note">Market trades, regional shortages and owned assets are ranked by their own evidence, then compared on a common 0–100 usefulness score.</p>
        </div>
        <div className="opportunity-context">
          <strong>{analysis.character?.name ?? "Market only"}</strong>
          <small>{analysis.constraints.maxCapital == null ? "No capital cap" : `${money(analysis.constraints.maxCapital)} ISK deployable`}</small>
          <div className="opportunity-cargo-control">
            <span>Cargo capacity m³</span>
            <div><input value={cargoInput} onChange={(event) => setCargoInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyCargo(); }} inputMode="numeric" aria-label="Cargo capacity in cubic metres" /><button type="button" disabled={marketBusy || !onCargoCapacityChange} onClick={applyCargo}>{marketBusy ? "Applying..." : "Apply"}</button></div>
            <small>Use the ship you intend to haul with.</small>
          </div>
        </div>
      </div>

      <div className="opportunity-tools">
        <div className="opportunity-kind-tabs">
          <button className={kind === "all" ? "active" : ""} onClick={() => setKind("all")}>All</button>
          <button className={kind === "trade" ? "active" : ""} onClick={() => setKind("trade")}>Market trades</button>
          <button className={kind === "asset" ? "active" : ""} onClick={() => setKind("asset")}>Owned assets</button>
          <button className={kind === "shortage" ? "active" : ""} onClick={() => setKind("shortage")}>Regional shortages</button>
        </div>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ranked opportunities..." />
      </div>

      <div className="opportunity-list">
        {rows.map((item, index) => (
          <article className={`opportunity-card risk-${item.risk.toLowerCase()}`} key={item.id}>
            <button className="opportunity-card-main" onClick={() => setExpanded((current) => current === item.id ? null : item.id)}>
              <span className="opportunity-rank">#{index + 1}</span>
              <div className="opportunity-copy">
                <div>
                  <strong>{item.title}</strong>
                  <em>{kindLabel(item.kind)}</em>
                  <span className={`opportunity-security-tag security-${item.routeSecurity ?? "unknown"}`}>{securityLabel(item.routeSecurity)}</span>
                </div>
                <small>{item.subtitle}</small>
                <small>
                  {item.category} · {item.jumps} jumps · ~{item.estimatedMinutes} min · {item.risk} risk · {item.kind === "shortage" ? `confidence ${item.fillScore}/100` : `fill ${item.fillScore}/100`}
                </small>
              </div>
              <div className="opportunity-value">
                <span>{item.primaryLabel}</span>
                <strong>{item.primaryText ?? `${money(item.primaryValue)} ISK`}</strong>
                {item.profit != null && <small>{item.marginPercent?.toFixed(1)}% gross return · {money(item.capitalRequired)} ISK capital</small>}
                {item.cashRelease != null && <small>No capital required</small>}
                {item.kind === "shortage" && <small>{item.confidenceLabel ?? "Evidence confidence"}</small>}
              </div>
              <div className="opportunity-score"><strong>{item.score}</strong><span>/100</span></div>
            </button>
            {expanded === item.id && (
              <div className="opportunity-detail">
                <div><b>Why this ranks here</b>{item.reasons.map((reason) => <small key={reason}>{reason}</small>)}</div>
                <div><b>Suggested next step</b><p>{item.action}</p></div>
              </div>
            )}
          </article>
        ))}
        {!rows.length && <div className="market-no-results">No ranked opportunities match this view.</div>}
      </div>
    </section>
  );
}
