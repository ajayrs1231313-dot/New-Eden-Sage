import { useEffect, useRef, useState } from "react";
import type { AnalysisProgress, CharacterSnapshot, OpportunityAnalysis, PveLocationAnalysis } from "./types";
import { MarketOpportunityScanner } from "./MarketOpportunityScanner";
import { OpportunityExplorer } from "./OpportunityExplorer";
import { PveLocationIntel } from "./PveLocationIntel";
import { friendlyAnalysisError, isExpectedAnalysisCancellation } from "./analysis-errors";
import "./invention-lab.css";

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

type LabTab = "market" | "opportunities" | "invention" | "pve";
type InventionSort = "route" | "chance" | "attempt" | "build" | "success" | "expected";
type CloneState = "alpha" | "omega";

export function IskLab({ snapshot, cloneState, marketDataRevision = 0 }: { snapshot?: CharacterSnapshot; cloneState?: CloneState; marketDataRevision?: number }) {
  const [tab, setTab] = useState<LabTab>("market");
  const [analysis, setAnalysis] = useState<OpportunityAnalysis | null>(null);
  const [pveAnalysis, setPveAnalysis] = useState<PveLocationAnalysis | null>(null);
  const [inventionAnalysis, setInventionAnalysis] = useState<any>(null);
  const [inventionBusy, setInventionBusy] = useState(false);
  const [inventionStatus, setInventionStatus] = useState("Open Invention to rank every inventable blueprint against the retained market.");
  const [inventionFilter, setInventionFilter] = useState("");
  const [inventionSort, setInventionSort] = useState<InventionSort>("expected");
  const [inventionSortDirection, setInventionSortDirection] = useState<"asc" | "desc">("desc");
  const [inventionDecryptor, setInventionDecryptor] = useState("");
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
    setInventionAnalysis(null);
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
      if (isExpectedAnalysisCancellation(error)) return null;
      const message = friendlyAnalysisError(error, "Could not analyze the current market snapshot.");
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
      if (isExpectedAnalysisCancellation(error)) return null;
      const message = friendlyAnalysisError(error, "Could not analyze PvE locations.");
      setPveStatus(pveAnalysis ? `${message} Previous completed location results are still shown.` : message);
      return null;
    } finally {
      if (requestId === pveRequestSequence.current) {
        setPveBusy(false);
        setPveProgress(null);
      }
    }
  }

  async function scanInvention(decryptorValue = inventionDecryptor) {
    if (!snapshot) {
      setInventionStatus("Connect and sync a character so Sage can identify owned source BPOs.");
      return;
    }
    setInventionBusy(true);
    setInventionStatus("Pricing the complete cached invention graph against retained market orders…");
    try {
      const value = await (window.sage as any).getInventionOpportunities({ characterId: snapshot.characterId, marketDataRevision, decryptorTypeId: decryptorValue ? Number(decryptorValue) : null });
      setInventionAnalysis(value);
      setInventionStatus(`${value.candidateCount.toLocaleString()} invention outcomes ranked · ${value.ownedSourceCount.toLocaleString()} use an owned source BPO.`);
    } catch (error) {
      setInventionStatus(error instanceof Error ? error.message : "Invention analysis failed.");
    } finally {
      setInventionBusy(false);
    }
  }

  useEffect(() => {
    if (tab === "invention" && snapshot && inventionAnalysis?.schema !== 4 && !inventionBusy) void scanInvention();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, snapshot?.characterId, snapshot?.updatedAt, marketDataRevision, inventionAnalysis?.schema]);

  useEffect(() => {
    void scanMarket();
    // Character source revisions and completed market refreshes rerun against the newest saved dataset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.characterId, snapshot?.updatedAt, marketDataRevision]);

  function openPveTab() {
    setTab("pve");
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

  const busy = marketBusy || pveBusy || inventionBusy;
  const status = tab === "pve" ? pveStatus : tab === "invention" ? inventionStatus : marketStatus;
  const changeInventionSort = (next: InventionSort) => {
    if (next === inventionSort) setInventionSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    else {
      setInventionSort(next);
      setInventionSortDirection(next === "route" ? "asc" : "desc");
    }
  };
  const inventionSortValue = (item: any) => inventionSort === "route" ? String(item.inventedBlueprintName ?? "").toLowerCase()
    : inventionSort === "chance" ? item.probability
    : inventionSort === "attempt" ? item.attemptCost
    : inventionSort === "build" ? item.manufacturingCostPerRun
    : inventionSort === "success" ? item.successfulRunProfit
    : item.expectedProfitPerAttempt;
  const visibleInventionOpportunities = (inventionAnalysis?.opportunities ?? [])
    .filter((item: any) => `${item.sourceBlueprintName} ${item.inventedBlueprintName} ${item.productName}`.toLowerCase().includes(inventionFilter.toLowerCase()))
    .sort((a: any, b: any) => {
      const left = inventionSortValue(a);
      const right = inventionSortValue(b);
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      const comparison = typeof left === "string" ? left.localeCompare(String(right)) : Number(left) - Number(right);
      return inventionSortDirection === "asc" ? comparison : -comparison;
    });

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
          <button className="isk-rescan" onClick={() => void scanMarket()}>{marketBusy ? "Restart Market Scanner" : "Apply market limits"}</button>
          {busy && <button className="isk-cancel-analysis" onClick={cancelCurrentAnalysis}>Cancel</button>}
          {tab === "pve" && snapshot && <button className="isk-refresh-intel" onClick={() => void scanPve(true)} disabled={pveBusy}>{pveBusy ? "Loading PvE intel…" : "Load PvE intelligence"}</button>}
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
        <button className={tab === "invention" ? "active" : ""} onClick={() => setTab("invention")}>Invention</button>
        <button className={tab === "pve" ? "active" : ""} onClick={openPveTab}>PvE & Locations</button>
      </div>

      {tab === "market" && !analysis && marketBusy && <div className="planner-analysis-state">Analyzing retained market data in the background...</div>}
      {tab === "market" && !analysis && !marketBusy && <div className="market-no-results">Run a full public market pull in Regional Market, then analyze it here.</div>}
      {analysis && tab === "market" && <MarketOpportunityScanner analysis={analysis} onExport={exportTop1000} />}

      {tab === "opportunities" && analysis && <OpportunityExplorer analysis={analysis} extraRows={pveAnalysis?.ranked ?? []} />}
      {tab === "opportunities" && !analysis && <div className="market-no-results">Market opportunities need a full public market snapshot. PvE/location intelligence remains available in its own tab.</div>}

      {tab === "invention" && !snapshot && <div className="market-no-results">Connect and sync a character to include owned blueprint originals.</div>}
      {tab === "invention" && snapshot && inventionBusy && !inventionAnalysis && <div className="planner-analysis-state">Building and pricing the complete invention catalogue…</div>}
      {tab === "invention" && inventionAnalysis && (
        <section className="invention-lab">
          <div className="invention-head">
            <div><p className="eyebrow">INVENTION PROFIT LAB</p><h3>Every inventable blueprint, priced as a successful build</h3><p>{inventionAnalysis.notes.join(" ")}</p></div>
            <button className="isk-rescan" onClick={() => void scanInvention()} disabled={inventionBusy}>{inventionBusy ? "Refreshing…" : "Refresh invention prices"}</button>
          </div>
          <input className="invention-filter" value={inventionFilter} onChange={(event) => setInventionFilter(event.target.value)} placeholder="Filter blueprint or final product…" />
          <label className="invention-decryptor">
            <span>Decryptor</span>
            <select value={inventionDecryptor} onChange={(event) => { const value = event.target.value; setInventionDecryptor(value); void scanInvention(value); }}>
              <option value="">No decryptor</option>
              {(inventionAnalysis.decryptors ?? []).map((decryptor: any) => <option value={decryptor.typeId} key={decryptor.typeId}>{decryptor.name} · ×{decryptor.probabilityMultiplier.toFixed(1)} chance · {decryptor.runModifier >= 0 ? "+" : ""}{decryptor.runModifier} runs · {decryptor.marketCost == null ? "unpriced" : `${money(decryptor.marketCost)} ISK`}</option>)}
            </select>
          </label>
          <div className="invention-table">
            <div className="invention-row heading">
              {([
                ['route', 'Invention route', 'The source BPC or ancient relic, the resulting advanced blueprint copy, and the item that copy manufactures.'],
                ['chance', 'Chance', 'Your success probability for one invention attempt: CCP base chance, relevant encryption and science skills, then the selected decryptor multiplier.'],
                ['attempt', 'Invention attempt', 'ISK consumed by one attempt: invention materials, selected decryptor and source blueprint/copy acquisition basis. Failed attempts still consume these inputs.'],
                ['build', 'Build / run', 'Market cost of the exact materials required to manufacture one run from the successful BPC at its resulting ME.'],
                ['success', 'Profit / run', 'Immediate-sale revenue for one manufactured item minus its one-run materials and one successful attempt cost spread across the BPC runs.'],
                ['expected', 'Expected / invention', 'Long-run expected profit for one invention attempt: success chance × the full BPC manufacturing margin, minus the attempt cost. This is not guaranteed profit.'],
              ] as Array<[InventionSort, string, string]>).map(([key, label, tooltip]) => (
                <button type="button" className={inventionSort === key ? "active" : ""} data-tooltip={tooltip} aria-label={`${label}. ${tooltip}`} onClick={() => changeInventionSort(key)} key={key}>{label}<i>{inventionSort === key ? inventionSortDirection === "asc" ? "▲" : "▼" : "↕"}</i></button>
              ))}
            </div>
            {visibleInventionOpportunities.map((item: any) => (
              <details className="invention-result" key={`${item.sourceBlueprintTypeId}:${item.inventedBlueprintTypeId}`}>
                <summary className="invention-row">
                  <span><strong>{item.inventedBlueprintName}</strong><small>{item.sourceBlueprintName} → {item.productName}</small>{item.ownsSourceOriginal && <em>OWNED BPO · COPY FREE</em>}</span>
                  <span><strong>{item.probability == null ? "—" : `${(item.probability * 100).toFixed(1)}%`}</strong><small>Base {item.baseProbability == null ? "—" : `${(item.baseProbability * 100).toFixed(1)}%`}</small></span>
                  <span>{item.attemptCost == null ? "Unpriced" : `${money(item.attemptCost)} ISK`}</span>
                  <span>{item.manufacturingCostPerRun == null ? "Unpriced" : `${money(item.manufacturingCostPerRun)} ISK`}</span>
                  <span className={item.successfulRunProfit >= 0 ? "positive" : "negative"}>{item.successfulRunProfit == null ? "Unpriced" : `${money(item.successfulRunProfit)} ISK`}</span>
                  <span className={item.expectedProfitPerAttempt >= 0 ? "positive" : "negative"}>{item.expectedProfitPerAttempt == null ? "Unpriced" : `${money(item.expectedProfitPerAttempt)} ISK`}</span>
                </summary>
                <div className="invention-detail">
                  <div><strong>Invention materials</strong>{item.inventionMaterials.map((line: any) => <small key={line.typeId}>{line.quantity}× {line.name} · {line.cost == null ? "no quote" : `${money(line.cost)} ISK`}</small>)}</div>
                  <div><strong>Blueprint basis</strong><small>{item.sourceCopyCostBasis}</small><small>Successful BPC: {item.outputRuns} runs · ME {item.materialEfficiency} · TE {item.timeEfficiency}</small><small>Full BPC build cost: {item.manufacturingCost == null ? "unpriced" : `${money(item.manufacturingCost)} ISK`}</small><small>Full BPC immediate-sale revenue: {item.immediateSaleRevenue == null ? "unpriced" : `${money(item.immediateSaleRevenue)} ISK`}</small><small>Full successful-BPC profit: {item.successfulCopyProfit == null ? "unpriced" : `${money(item.successfulCopyProfit)} ISK`}</small></div>
                  <div className="invention-skill-impact"><strong>Character invention chance</strong><small>Current adjusted chance: {item.probability == null ? "—" : `${(item.probability * 100).toFixed(2)}%`}</small><small>All relevant skills at V: {item.maxSkillsProbability == null ? "—" : `${(item.maxSkillsProbability * 100).toFixed(2)}%`}</small><small>Available through training: {item.trainingProbabilityGain == null ? "—" : `+${(item.trainingProbabilityGain * 100).toFixed(2)} percentage points`}</small>{item.skillImpacts.map((skill: any) => <div key={skill.typeId}><b>{skill.name} {skill.trainedLevel}/5</b><span>{skill.role} · currently +{(skill.currentRelativeBoost * 100).toFixed(2)}% to multiplier · another +{(skill.remainingRelativeBoost * 100).toFixed(2)}% available</span></div>)}</div>
                  <div className="invention-one-run-materials"><strong>Build materials · 1 run</strong><small>Exact quantities at ME {item.materialEfficiency}; not multiplied by the BPC&apos;s {item.outputRuns} runs.</small>{item.manufacturingMaterialsPerRun.map((line: any) => <small key={line.typeId}>{line.quantity}× {line.name} · {line.cost == null ? "no quote" : `${money(line.cost)} ISK`}</small>)}</div>
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

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
