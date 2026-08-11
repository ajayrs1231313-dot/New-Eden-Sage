import { useMemo, useState } from "react";
import type { PveLocationAnalysis, PveLocationKind } from "./types";

type KindFilter = "all" | PveLocationKind;
type SecurityFilter = "all" | "high" | "low" | "null";
type SortMode = "score" | "jumps" | "safety" | "npc" | "traffic";

const kindLabels: Record<PveLocationKind, string> = {
  incursion: "Live incursion",
  "mission-staging": "Mission staging",
  "ded-search": "DED / combat search",
  "lowsec-ratting": "Low-sec ratting",
  "nullsec-ratting": "Null-sec ratting",
};

function ageLabel(minutes: number) {
  if (minutes < 60) return `${minutes}m old`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m old`;
  return `${Math.floor(minutes / 1440)}d old`;
}

function securityLabel(value: number) {
  return value.toFixed(2);
}

export function PveLocationIntel({ analysis }: { analysis: PveLocationAnalysis }) {
  const [kind, setKind] = useState<KindFilter>("all");
  const [security, setSecurity] = useState<SecurityFilter>("all");
  const [sort, setSort] = useState<SortMode>("score");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return analysis.locations
      .filter((row) => {
        if (kind !== "all" && row.kind !== kind) return false;
        if (security !== "all" && row.securityBand !== security) return false;
        if (needle && !`${row.label} ${row.systemName} ${row.regionName} ${row.constellationName} ${row.corporationName ?? ""} ${row.factionName ?? ""}`.toLowerCase().includes(needle)) return false;
        return true;
      })
      .sort((a, b) => {
        if (sort === "jumps") return a.jumps - b.jumps || b.score - a.score;
        if (sort === "safety") return (a.shipKills + a.podKills * 2) - (b.shipKills + b.podKills * 2) || b.score - a.score;
        if (sort === "npc") return b.npcKills - a.npcKills || b.score - a.score;
        if (sort === "traffic") return a.shipJumps - b.shipJumps || b.score - a.score;
        return b.score - a.score || a.jumps - b.jumps;
      });
  }, [analysis.locations, kind, security, sort, search]);

  return (
    <section className="pve-intel">
      <div className="pve-intel-heading">
        <div>
          <p className="eyebrow">PVE & LOCATION INTELLIGENCE</p>
          <h3>Where should I go?</h3>
          <p>Ranks live incursions and useful PvE search/staging areas from your current location, readiness and current public system activity.</p>
        </div>
        <div className={`pve-data-status ${analysis.dataStatus.stale ? "stale" : "fresh"}`}>
          <span>{analysis.dataStatus.stale ? "Cached / partial intel" : "Current public intel"}</span>
          <strong>{ageLabel(analysis.dataStatus.ageMinutes)}</strong>
          <small>{analysis.dataStatus.source}</small>
        </div>
      </div>

      <div className="pve-ship-context">
        <span>Current EVE ship</span>
        <strong>{analysis.character.shipName ?? "No active ship reported"}</strong>
        <small>Readiness is matched against your synced character; imported Fittings remain a separate local planning reference.</small>
      </div>

      {analysis.dataStatus.errors.length > 0 && (
        <div className="pve-intel-warning">
          Some live signals could not refresh. Sage kept the available public data and marked confidence down rather than dropping the whole analysis.
        </div>
      )}

      <div className="pve-kind-strip">
        <button className={kind === "all" ? "active" : ""} onClick={() => setKind("all")}>All <span>{analysis.locations.length}</span></button>
        <button className={kind === "incursion" ? "active" : ""} onClick={() => setKind("incursion")}>Incursions <span>{analysis.counts.incursion}</span></button>
        <button className={kind === "mission-staging" ? "active" : ""} onClick={() => setKind("mission-staging")}>Missions <span>{analysis.counts["mission-staging"]}</span></button>
        <button className={kind === "ded-search" ? "active" : ""} onClick={() => setKind("ded-search")}>DED / Combat <span>{analysis.counts["ded-search"]}</span></button>
        <button className={kind === "lowsec-ratting" ? "active" : ""} onClick={() => setKind("lowsec-ratting")}>Low-sec <span>{analysis.counts["lowsec-ratting"]}</span></button>
        <button className={kind === "nullsec-ratting" ? "active" : ""} onClick={() => setKind("nullsec-ratting")}>Null-sec <span>{analysis.counts["nullsec-ratting"]}</span></button>
      </div>

      <div className="pve-filter-grid">
        <label>
          Search
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="System, region, corporation…" />
        </label>
        <label>
          Security
          <select value={security} onChange={(event) => setSecurity(event.target.value as SecurityFilter)}>
            <option value="all">All security</option>
            <option value="high">High-sec</option>
            <option value="low">Low-sec</option>
            <option value="null">Null-sec</option>
          </select>
        </label>
        <label>
          Sort by
          <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
            <option value="score">Best overall</option>
            <option value="jumps">Nearest first</option>
            <option value="safety">Lowest recent danger</option>
            <option value="npc">Most NPC activity</option>
            <option value="traffic">Lowest traffic</option>
          </select>
        </label>
        <div className="pve-filter-summary">
          <span>Showing</span>
          <strong>{rows.length}</strong>
          <small>from {analysis.character.systemName}</small>
        </div>
      </div>

      <div className="pve-location-table">
        <div className="pve-location-row heading">
          <span>Location</span>
          <span>Type / confidence</span>
          <span>Readiness</span>
          <span>Activity / danger</span>
          <span>Estimated ISK/hr</span>
          <span>Travel</span>
          <span>Score</span>
        </div>
        {rows.map((row) => (
          <article className={`pve-location-card risk-${row.risk.toLowerCase()}`} key={row.id}>
            <button className="pve-location-row" onClick={() => setExpanded((current) => current === row.id ? null : row.id)}>
              <span className="pve-place">
                <strong>{row.systemName}</strong>
                <small>{row.regionName} · {row.constellationName} · sec {securityLabel(row.securityStatus)}</small>
              </span>
              <span>
                <strong>{kindLabels[row.kind]}</strong>
                <small className={`availability ${row.availability}`}>{row.availability === "live" ? "LIVE" : row.availability === "search-area" ? "SEARCH AREA" : "STAGING CANDIDATE"} · {row.confidence} confidence</small>
              </span>
              <span>
                <strong>{row.readiness ? `${row.readiness.percent}%` : "—"}</strong>
                <small>{row.readiness ? `${row.readiness.tier} · ${row.readiness.bestRoute}` : "Readiness unavailable"}</small>
              </span>
              <span>
                <strong>{row.npcKills.toLocaleString("en-GB")} NPC</strong>
                <small>{row.shipKills} ship · {row.podKills} pod kills · {row.shipJumps.toLocaleString("en-GB")} jumps</small>
              </span>
              <span>
                <strong>{Math.round(row.earnings?.lowPerHour ?? 0).toLocaleString("en-GB")}–{Math.round(row.earnings?.highPerHour ?? 0).toLocaleString("en-GB")}</strong>
                <small>gross ISK/hour estimate</small>
              </span>
              <span>
                <strong>{row.jumps} jumps</strong>
                <small>~{row.estimatedMinutes} min · {row.risk} risk</small>
              </span>
              <span className="pve-score"><strong>{row.score}</strong><small>/100</small></span>
            </button>
            {expanded === row.id && (
              <div className="pve-location-detail">
                <div>
                  <b>{row.label}</b>
                  {row.standing && <p>Synced standing: <strong>{row.standing.value.toFixed(2)}</strong> with {row.standing.name}.</p>}
                  {row.incursion && <p>Incursion state: <strong>{row.incursion.state}</strong> · influence {(row.incursion.influence * 100).toFixed(0)}% · boss {row.incursion.hasBoss ? "present" : "not reported"}.</p>}
                  {row.reasons.map((reason) => <small key={reason}>{reason}</small>)}
                </div>
                <div>
                  <b>What to do</b>
                  <p>{row.action}</p>
                  <small className="pve-caveat">{row.caveat}</small>
                  {row.earnings && <small className="pve-caveat">{row.earnings.basis}</small>}
                </div>
              </div>
            )}
          </article>
        ))}
        {!rows.length && <div className="market-no-results">No PvE/location leads match these filters and travel limits.</div>}
      </div>
    </section>
  );
}
