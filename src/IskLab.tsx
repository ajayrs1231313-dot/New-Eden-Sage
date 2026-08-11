import { useEffect, useRef, useState } from "react";
import type { AnalysisProgress, CharacterSnapshot, OpportunityAnalysis, PveLocationAnalysis } from "./types";
import { MarketOpportunityScanner } from "./MarketOpportunityScanner";
import { OpportunityExplorer } from "./OpportunityExplorer";
import { PveLocationIntel } from "./PveLocationIntel";

const money = (value: number) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);

function ageLabel(minutes: number | null) {
  if (minutes == null) return "unknown age";
  if (minutes < 60) return `${minutes}m old`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m old`;
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h old`;
}

function numberOrNull(value: string) {
  const parsed = Number(value.replace(/,/g, ""));
  return value.trim() && Number.isFinite(parsed) ? parsed : null;
}

type LabTab = "market" | "opportunities" | "pve";
type CloneState = "alpha" | "omega";

export function IskLab({ snapshot, cloneState, marketDataRevision = 0 }: { snapshot?: CharacterSnapshot; cloneState?: CloneState; marketDataRevision?: number }) {
  const [tab, setTab] = useState<LabTab>("market");
  const [analysis, setAnalysis] = useState<OpportunityAnalysis | null>(null);
  const [pveAnalysis, setPveAnalysis] = useState<PveLocationAnalysis | null>(null);
  const [marketBusy, setMarketBusy] = useState(false);
  const [pveBusy, setPveBusy] = useState(false);
  const [marketProgress, setMarketProgress] = useState<AnalysisProgress | null>(null);
  const [pveProgress, setPveProgress] = useState<AnalysisProgress | null>(null);
  const [marketStatus, setMarketStatus] = useState("Use the newest full public market snapshot to compare candidate trade routes.");
  const [pveStatus, setPveStatus] = useState("Connect and sync a character to rank PvE locations from your current system.");
  const [capital, setCapital] = useState(snapshot?.wallet ? String(Math.round(snapshot.wallet)) : "");
  const [cargo, setCargo] = useState("");
  const [maxJumps, setMaxJumps] = useState("");
  const [maxMinutes, setMaxMinutes] = useState("");
  const marketRequestSequence = useRef(0);
  const pveRequestSequence = useRef(0);

  useEffect(() => {
    setCapital(snapshot?.wallet ? String(Math.round(snapshot.wallet)) : "");
    setCargo("");
    setAnalysis(null);
    setPveAnalysis(null);
  }, [snapshot?.characterId]);

  useEffect(() => window.sage.onAnalysisProgress((progress) => {
    if (progress.kind === "opportunity") setMarketProgress(progress);
    if (progress.kind === "pve-location") setPveProgress(progress);
  }), []);

  async function scanMarket() {
    const requestId = ++marketRequestSequence.current;
    setMarketBusy(true);
    setMarketProgress(null);
    setMarketStatus("Market analysis is running in the background. You can keep using Sage while it works.");
    try {
      const next = await window.sage.getOpportunityAnalysis({
        characterId: snapshot?.characterId,
        maxCapital: numberOrNull(capital),
        cargoCapacityM3: numberOrNull(cargo),
        maxJumps: numberOrNull(maxJumps),
        maxMinutes: numberOrNull(maxMinutes),
      });
      if (requestId !== marketRequestSequence.current) return null;
      setAnalysis(next);
      setMarketStatus(
        `${next.market.opportunities.length.toLocaleString()} candidate routes ranked from ${next.signals.marketOrdersInspected.toLocaleString()} raw public orders across ${next.signals.marketRegionsInspected.toLocaleString()} regions${next.character ? ` for ${next.character.name}` : ""}.`,
      );
      if (!cargo) setCargo(String(Math.round(next.constraints.cargoCapacityM3)));
      if (!capital && next.constraints.maxCapital != null) setCapital(String(Math.round(next.constraints.maxCapital)));
      return next;
    } catch (error) {
      if (requestId !== marketRequestSequence.current) return null;
      const message = error instanceof Error ? error.message : "Could not analyze the current market snapshot.";
      setMarketStatus(analysis ? `${message} Previous completed results are still shown.` : message);
      return null;
    } finally {
      if (requestId === marketRequestSequence.current) {
        setMarketBusy(false);
        setMarketProgress(null);
      }
    }
  }

  async function scanPve(forceLive = false) {
    if (!snapshot) {
      setPveStatus("Connect and sync a character before ranking PvE locations.");
      return null;
    }
    const requestId = ++pveRequestSequence.current;
    setPveBusy(true);
    setPveProgress(null);
    setPveStatus("PvE and location intelligence is running in its own background worker.");
    try {
      const next = await window.sage.getPveLocationAnalysis({
        characterId: snapshot.characterId,
        cloneState,
        maxJumps: numberOrNull(maxJumps),
        maxMinutes: numberOrNull(maxMinutes),
        forceLive,
      });
      if (requestId !== pveRequestSequence.current) return null;
      setPveAnalysis(next);
      setPveStatus(
        `${next.locations.length} PvE/location leads fit the current travel limits from ${next.character.systemName}. Public activity data is ${ageLabel(next.dataStatus.ageMinutes)}.`,
      );
      return next;
    } catch (error) {
      if (requestId !== pveRequestSequence.current) return null;
      const message = error instanceof Error ? error.message : "Could not analyze PvE locations.";
      setPveStatus(pveAnalysis ? `${message} Previous completed location results are still shown.` : message);
      return null;
    } finally {
      if (requestId === pveRequestSequence.current) {
        setPveBusy(false);
        setPveProgress(null);
      }
    }
  }

  async function scanAll() {
    await Promise.allSettled([scanMarket(), scanPve(false)]);
  }

  useEffect(() => {
    void scanMarket();
    // Character switches and completed market refreshes rerun against the newest saved dataset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.characterId, marketDataRevision]);

  function openPveTab() {
    setTab("pve");
    if (snapshot && !pveAnalysis && !pveBusy) void scanPve(false);
  }

  async function cancelCurrentAnalysis() {
    marketRequestSequence.current += 1;
    pveRequestSequence.current += 1;
    const [marketCancelled, pveCancelled] = await Promise.all([
      window.sage.cancelAnalysis("opportunity"),
      window.sage.cancelAnalysis("pve-location"),
    ]);
    if (marketCancelled) setMarketStatus("Market analysis cancelled. Previous completed results are still available.");
    if (pveCancelled) setPveStatus("PvE/location analysis cancelled. Previous completed results are still available.");
    setMarketBusy(false);
    setPveBusy(false);
    setMarketProgress(null);
    setPveProgress(null);
  }

  async function exportTop1000() {
    setMarketBusy(true);
    try {
      const file = await window.sage.exportTopArbitrage();
      if (file) setMarketStatus(`Top 1,000 market routes saved to ${file}`);
    } catch (error) {
      setMarketStatus(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setMarketBusy(false);
    }
  }

  const busy = marketBusy || pveBusy;
  const status = tab === "pve" ? pveStatus : marketStatus;

  return (
    <section className="isk-lab isk-lab-v2">
      <div className="isk-head">
        <div>
          <p className="eyebrow">ISK LAB</p>
          <h2>Market, PvE and location intelligence</h2>
          <p>{status}</p>
        </div>
        {analysis?.character && (
          <div className="isk-character-context">
            <span>Character</span>
            <strong>{analysis.character.name}</strong>
            <small>{money(analysis.character.wallet)} ISK wallet · {analysis.character.systemName ?? "location unavailable"}</small>
          </div>
        )}
      </div>

      {analysis?.signals.marketDatasetStale && tab !== "pve" && (
        <div className="market-freshness-warning">
          <strong>Market snapshot is {ageLabel(analysis.signals.marketDatasetAgeMinutes)}</strong>
          <span>Refresh the full public market dataset in Regional Market before committing ISK; prices and orders may have changed.</span>
        </div>
      )}

      <section className="isk-constraints">
        <div className="isk-constraints-copy">
          <p className="eyebrow">YOUR LIMITS</p>
          <h3>Set what you are actually willing to use</h3>
          <p>Capital and cargo control executable market volume. Jump and time limits apply to both market routes and PvE/location recommendations.</p>
        </div>
        <div className="isk-constraint-grid">
          <label>
            Deployable capital
            <input value={capital} onChange={(event) => setCapital(event.target.value)} placeholder="No limit" inputMode="numeric" />
            <small>{snapshot?.wallet ? `Wallet: ${money(snapshot.wallet)} ISK` : "Connect a character to use wallet capital automatically."}</small>
          </label>
          <label>
            Cargo capacity
            <input value={cargo} onChange={(event) => setCargo(event.target.value)} placeholder="Auto-detect" inputMode="numeric" />
            <small>{analysis ? `${analysis.constraints.cargoBasis} · ${money(analysis.constraints.cargoCapacityM3)} m3` : "m3 · scans the selected character's owned ships and uses the largest detected cargo hold."}</small>
          </label>
          <label>
            Maximum jumps
            <input value={maxJumps} onChange={(event) => setMaxJumps(event.target.value)} placeholder="Any" inputMode="numeric" />
            <small>Applies before market and PvE results are ranked.</small>
          </label>
          <label>
            Available time
            <input value={maxMinutes} onChange={(event) => setMaxMinutes(event.target.value)} placeholder="Any" inputMode="numeric" />
            <small>Minutes · travel time is a planning estimate, not an in-game timer.</small>
          </label>
        </div>
        <div className="isk-analysis-actions">
          <button className="isk-rescan" onClick={scanAll}>{busy ? "Restart with these limits" : "Apply limits and analyze"}</button>
          {busy && <button className="isk-cancel-analysis" onClick={cancelCurrentAnalysis}>Cancel</button>}
          {tab === "pve" && snapshot && <button className="isk-refresh-intel" onClick={() => void scanPve(true)} disabled={pveBusy}>Refresh live PvE intel</button>}
        </div>
      </section>

      {(marketBusy && marketProgress) || (pveBusy && pveProgress) ? (
        <div className="analysis-progress-stack" aria-live="polite">
          {marketBusy && marketProgress && <ProgressLine title="Market" progress={marketProgress} />}
          {pveBusy && pveProgress && <ProgressLine title="PvE / locations" progress={pveProgress} />}
        </div>
      ) : null}

      {(analysis || pveAnalysis) && (
        <div className="isk-summary-strip">
          {analysis && <article><span>Market source</span><strong>{analysis.signals.marketOrdersInspected.toLocaleString()} raw orders</strong><small>{analysis.signals.marketRegionsInspected.toLocaleString()} regions · complete public order book</small></article>}
          {analysis && <article><span>Capital basis</span><strong>{analysis.constraints.maxCapital == null ? "Unlimited" : `${money(analysis.constraints.maxCapital)} ISK`}</strong><small>{analysis.constraints.capitalBasis}</small></article>}
          {analysis && <article><span>Market routes</span><strong>{analysis.market.opportunities.length.toLocaleString()}</strong><small>Fits capital, cargo, jump and time limits</small></article>}
          {pveAnalysis && <article><span>PvE / location leads</span><strong>{pveAnalysis.locations.length.toLocaleString()}</strong><small>{pveAnalysis.counts.incursion} live incursions · {pveAnalysis.dataStatus.stale ? "cached/partial intel" : "current public intel"}</small></article>}
          {analysis && <article><span>Regional shortages</span><strong>{analysis.signals.regionalShortageSignals.toLocaleString()}</strong><small>Supply gaps and price-pressure signals</small></article>}
          {analysis && <article><span>Owned asset stacks</span><strong>{analysis.signals.ownedAssetStacks.toLocaleString()}</strong><small>Used for liquidation opportunities</small></article>}
        </div>
      )}

      <div className="isk-lab-tabs" role="tablist" aria-label="ISK Lab sections">
        <button className={tab === "market" ? "active" : ""} onClick={() => setTab("market")}>Market Scanner</button>
        <button className={tab === "opportunities" ? "active" : ""} onClick={() => setTab("opportunities")}>Opportunities</button>
        <button className={tab === "pve" ? "active" : ""} onClick={openPveTab}>PvE & Locations</button>
      </div>

      {tab === "market" && !analysis && marketBusy && <div className="planner-analysis-state">Analyzing retained market data in the background...</div>}
      {tab === "market" && !analysis && !marketBusy && <div className="market-no-results">Run a full public market pull in Regional Market, then analyze it here.</div>}
      {analysis && tab === "market" && <MarketOpportunityScanner analysis={analysis} onExport={exportTop1000} />}

      {tab === "opportunities" && analysis && <OpportunityExplorer analysis={analysis} extraRows={pveAnalysis?.ranked ?? []} />}
      {tab === "opportunities" && !analysis && <div className="market-no-results">Market opportunities need a full public market snapshot. PvE/location intelligence remains available in its own tab.</div>}

      {tab === "pve" && !snapshot && <div className="market-no-results">Connect and sync a character so Sage can rank locations from your current system.</div>}
      {tab === "pve" && snapshot && !pveAnalysis && pveBusy && <div className="planner-analysis-state">Building PvE and location intelligence in the background...</div>}
      {tab === "pve" && snapshot && !pveAnalysis && !pveBusy && <div className="market-no-results">Run PvE/location analysis to rank current activity and staging areas.</div>}
      {tab === "pve" && pveAnalysis && <PveLocationIntel analysis={pveAnalysis} />}
    </section>
  );
}

function ProgressLine({ title, progress }: { title: string; progress: AnalysisProgress }) {
  return (
    <div className="analysis-progress">
      <div>
        <strong>{title}: {progress.message}</strong>
        <span>{progress.cached ? "Cached result" : progress.completed != null && progress.total != null ? `${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()}` : "Background worker active"}</span>
      </div>
      <div className="analysis-progress-track"><i style={{ width: `${Math.max(2, Math.min(100, progress.percent ?? 8))}%` }} /></div>
    </div>
  );
}
