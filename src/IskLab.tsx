import { useEffect, useRef, useState } from "react";
import type { AnalysisProgress, CharacterSnapshot, OpportunityAnalysis, PveLocationAnalysis } from "./types";
import { MarketOpportunityScanner } from "./MarketOpportunityScanner";
import { MarketDayTrader } from "./MarketDayTrader";
import { MarketContracts } from "./MarketContracts";
import { OpportunityExplorer } from "./OpportunityExplorer";
import { OrderDesk } from "./OrderDesk";
import { PveLocationIntel } from "./PveLocationIntel";
import { PlanetaryRevenue } from "./PlanetaryRevenue";
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


type LabTab = "market" | "market-opportunities" | "orders" | "contracts" | "opportunities" | "invention" | "planetary" | "pve";
type InventionSort = "route" | "chance" | "attempt" | "build" | "success" | "expected";
type InventionCategory = "all" | "t1" | "ship" | "module" | "rig" | "drone" | "charge" | "subsystem" | "other";
type CloneState = "alpha" | "omega";

function matchesInventionCategory(item: any, category: InventionCategory) {
  if (category === "all") return true;
  // “T1” describes the source blueprint route, not the invented output (which is
  // normally T2). It is deliberately independent of whether the character owns it.
  if (category === "t1") return item.sourceTechLevel === 1 || item.sourceMetaGroupId === 1;
  if (category === "drone") return item.productCategory === "drone" || item.productCategory === "fighter";
  if (category === "other") return !["ship", "module", "rig", "drone", "fighter", "charge", "subsystem"].includes(String(item.productCategory));
  return item.productCategory === category;
}

export function IskLab({ snapshot, cloneState, marketDataRevision = 0, onMarketDataUpdated = () => undefined }: { snapshot?: CharacterSnapshot; cloneState?: CloneState; marketDataRevision?: number; onMarketDataUpdated?: () => void }) {
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
  const [inventionCategory, setInventionCategory] = useState<InventionCategory>("all");
  const [marketBusy, setMarketBusy] = useState(false);
  const [pveBusy, setPveBusy] = useState(false);
  const [marketProgress, setMarketProgress] = useState<AnalysisProgress | null>(null);
  const [pveProgress, setPveProgress] = useState<AnalysisProgress | null>(null);
  const [marketStatus, setMarketStatus] = useState("Use the newest full public market snapshot to compare candidate trade routes.");
  const [pveStatus, setPveStatus] = useState("Connect and sync a character to rank PvE locations from your current system.");
  const pveRequestSequence = useRef(0);
  const marketRequestSequence = useRef(0);
  const [preparedDataRevision, setPreparedDataRevision] = useState(0);

  useEffect(() => {
    setAnalysis(null);
    setPveAnalysis(null);
    setInventionAnalysis(null);
  }, [snapshot?.characterId]);

  useEffect(() => window.sage.onPreparedDataUpdated((value) => {
    if (!snapshot?.characterId || value.characterIds.includes(snapshot.characterId)) {
      setPreparedDataRevision((revision) => revision + 1);
    }
  }), [snapshot?.characterId]);

  useEffect(() => window.sage.onAnalysisProgress((progress) => {
    if (progress.kind === "opportunity") setMarketProgress(progress);
    if (progress.kind === "pve-location") setPveProgress(progress);
  }), []);

  async function scanMarketWithCargo(cargoCapacityM3: number | null, cargoProfileId: string | null = null) {
    const requestId = ++marketRequestSequence.current;
    setMarketBusy(true);
    setMarketProgress(null);
    const selectedProfile = cargoProfileId ? analysis?.constraints.cargoProfiles.find((profile) => profile.id === cargoProfileId) : null;
    setMarketStatus(selectedProfile ? `Rebuilding market routes for ${selectedProfile.characterName}'s ${selectedProfile.shipName}...` : cargoCapacityM3 == null ? "Rebuilding market routes with current fitted ship cargo capacity..." : `Rebuilding market routes for ${Math.round(cargoCapacityM3).toLocaleString()} m3 cargo...`);
    try {
      const next = await window.sage.getOpportunityAnalysis({
        characterId: snapshot?.characterId,
        maxCapital: analysis?.constraints.maxCapital ?? null,
        cargoCapacityM3,
        cargoProfileId,
        maxJumps: analysis?.constraints.maxJumps ?? null,
        maxMinutes: analysis?.constraints.maxMinutes ?? null,
      });
      if (requestId !== marketRequestSequence.current) return;
      setAnalysis(next);
      setMarketStatus(`${next.market.opportunities.length.toLocaleString()} candidate routes ready with ${Math.round(next.constraints.cargoCapacityM3).toLocaleString()} m3 cargo capacity.`);
    } catch (error) {
      if (requestId !== marketRequestSequence.current) return;
      if (isExpectedAnalysisCancellation(error)) return;
      setMarketStatus(friendlyAnalysisError(error, "Could not rebuild market routes for that cargo capacity."));
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
        maxJumps: null,
        maxMinutes: null,
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
    let cancelled = false;
    if (!snapshot) {
      setAnalysis(null);
      setPveAnalysis(null);
      setInventionAnalysis(null);
      return () => { cancelled = true; };
    }
    const timer = setTimeout(() => {
      void window.sage.getPreparedIskLab({ characterId: snapshot.characterId, cloneState }).then((prepared) => {
      if (cancelled) return;
      setAnalysis((current: OpportunityAnalysis | null) => prepared.market ?? current);
      setPveAnalysis((current: PveLocationAnalysis | null) => prepared.pve ?? current);
      setInventionAnalysis((current: any) => prepared.invention ?? current);
      if (prepared.market) {
        setMarketStatus(
          `${prepared.market.market.opportunities.length.toLocaleString()} candidate routes ready from ${prepared.market.signals.marketOrdersInspected.toLocaleString()} retained public orders across ${prepared.market.signals.marketRegionsInspected.toLocaleString()} regions.`,
        );
      } else {
        setMarketStatus("No prepared Market Scanner result is available. Run Sync All to prepare it.");
      }
      if (prepared.pve) {
        setPveStatus(
          `${prepared.pve.locations.length} PvE/location leads are ready from ${prepared.pve.character.systemName}. Public activity data is ${ageLabel(prepared.pve.dataStatus.ageMinutes)}.`,
        );
      } else {
        setPveStatus("No prepared PvE/location result is available. Run Sync All to prepare it.");
      }
      if (prepared.invention) {
        setInventionStatus(
          `${prepared.invention.candidateCount.toLocaleString()} invention outcomes ready · ${prepared.invention.ownedSourceCount.toLocaleString()} use an owned source BPO.`,
        );
      } else {
        setInventionStatus("Invention is prepared on demand. Open the Invention tab to build it.");
      }
    }).catch((error) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : "Prepared ISK Command data could not be read.";
      setMarketStatus(message);
      setPveStatus(message);
      setInventionStatus(message);
      });
    }, 100);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [snapshot?.characterId, snapshot?.updatedAt, marketDataRevision, cloneState, preparedDataRevision]);

  function openPveTab() {
    setTab("pve");
  }

  async function exportMarketCsv() {
    setMarketBusy(true);
    try {
      const file = await window.sage.exportTopArbitrage();
      if (file) setMarketStatus(`Market routes saved to ${file}`);
    } catch (error) {
      setMarketStatus(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setMarketBusy(false);
    }
  }

  const status = tab === "orders" ? "Track the selected character's active personal buy and sell orders from the latest synced ESI snapshot." : tab === "contracts" ? "Search EVE-wide public buy/sell contracts and rank immediate or haul-required profit against retained market orders." : tab === "pve" ? pveStatus : tab === "planetary" ? "Model exact PI factory chains against retained market prices and synced colonies." : tab === "invention" ? inventionStatus : marketStatus;
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
    .filter((item: any) => matchesInventionCategory(item, inventionCategory))
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
          <h2>Market, industry, PvE and revenue intelligence</h2>
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
          <span>Refresh the public market dataset in Asset Command → Market before committing ISK; prices and orders may have changed.</span>
        </div>
      )}

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

      <div className="isk-lab-tabs" role="tablist" aria-label="ISK Command sections">
        <button className={tab === "market" ? "active" : ""} onClick={() => setTab("market")}>Market Scanner</button>
        <button className={tab === "market-opportunities" ? "active" : ""} onClick={() => setTab("market-opportunities")}>Market Opportunities</button>
        <button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}>Order Desk</button>
        <button className={tab === "contracts" ? "active" : ""} onClick={() => setTab("contracts")}>Contracts</button>
        <button className={tab === "opportunities" ? "active" : ""} onClick={() => setTab("opportunities")}>All Opportunities</button>
        <button className={tab === "invention" ? "active" : ""} onClick={() => { setTab("invention"); if (!inventionAnalysis && !inventionBusy) void scanInvention(); }}>Invention</button>
        <button className={tab === "planetary" ? "active" : ""} onClick={() => setTab("planetary")}>Planetary Revenue</button>
        <button className={tab === "pve" ? "active" : ""} onClick={openPveTab}>PvE & Locations</button>
      </div>

      {tab === "market" && !analysis && marketBusy && <div className="planner-analysis-state">Analyzing retained market data in the background...</div>}
      {tab === "market" && !analysis && !marketBusy && <div className="market-no-results">No prepared Market Scanner result is available. Run Sync All to prepare it.</div>}
      {analysis && tab === "market" && <MarketOpportunityScanner analysis={analysis} onExport={exportMarketCsv} />}

      {tab === "market-opportunities" && analysis && <MarketDayTrader analysis={analysis} snapshot={snapshot} onCargoCapacityChange={scanMarketWithCargo} marketBusy={marketBusy} />}
      {tab === "market-opportunities" && !analysis && <div className="market-no-results">No prepared Market Opportunities result is available. Run Sync All to prepare it.</div>}

      {tab === "orders" && <OrderDesk snapshot={snapshot} />}

      {tab === "contracts" && <MarketContracts characterId={snapshot?.characterId} marketDataRevision={marketDataRevision} onMarketDataUpdated={onMarketDataUpdated} />}

      {tab === "opportunities" && analysis && <OpportunityExplorer analysis={analysis} extraRows={pveAnalysis?.ranked ?? []} onCargoCapacityChange={scanMarketWithCargo} marketBusy={marketBusy} />}
      {tab === "opportunities" && !analysis && <div className="market-no-results">No prepared Opportunities result is available. Run Sync All to prepare it.</div>}

      {tab === "invention" && !snapshot && <div className="market-no-results">Connect and sync a character to include owned blueprint originals.</div>}
      {tab === "invention" && snapshot && inventionBusy && !inventionAnalysis && <div className="planner-analysis-state">Building and pricing the complete invention catalogue…</div>}
      {tab === "invention" && inventionAnalysis && (
        <section className="invention-lab">
          <div className="invention-head">
            <div><p className="eyebrow">INVENTION PROFIT LAB</p><h3>Every inventable blueprint, priced as a successful build</h3><p>{inventionAnalysis.notes.join(" ")}</p></div>
            <button className="isk-rescan" onClick={() => void scanInvention()} disabled={inventionBusy}>{inventionBusy ? "Refreshing…" : "Refresh invention prices"}</button>
          </div>
          <input className="invention-filter" value={inventionFilter} onChange={(event) => setInventionFilter(event.target.value)} placeholder="Filter blueprint or final product…" />
          <div className="invention-selectors">
            <label className="invention-decryptor"><span>Decryptor</span><select value={inventionDecryptor} onChange={(event) => { const value = event.target.value; setInventionDecryptor(value); void scanInvention(value); }}><option value="">No decryptor</option>{(inventionAnalysis.decryptors ?? []).map((decryptor: any) => <option value={decryptor.typeId} key={decryptor.typeId}>{decryptor.name} · ×{decryptor.probabilityMultiplier.toFixed(1)} chance · {decryptor.runModifier >= 0 ? "+" : ""}{decryptor.runModifier} runs · {decryptor.marketCost == null ? "unpriced" : `${money(decryptor.marketCost)} ISK`}</option>)}</select></label>
            <label className="invention-decryptor"><span>Category</span><select value={inventionCategory} onChange={(event) => setInventionCategory(event.target.value as InventionCategory)}><option value="all">All invention routes</option><option value="t1">T1 source blueprints only</option><option value="ship">Ships only</option><option value="module">Modules only</option><option value="rig">Rigs only</option><option value="drone">Drones & fighters only</option><option value="charge">Ammo & charges only</option><option value="subsystem">Subsystems only</option><option value="other">Other outputs only</option></select></label>
          </div>
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
                  <div><strong>Invention materials</strong>{item.inventionMaterials.map((line: any, index: number) => <small key={`${line.typeId}:${index}`}>{line.quantity}× {line.name} · {line.cost == null ? "no quote" : `${money(line.cost)} ISK`} · {line.priceBasis}</small>)}</div>
                  <div><strong>Blueprint basis</strong><small>{item.sourceCopyCostBasis}</small><small>Successful BPC: {item.outputRuns} runs · ME {item.materialEfficiency} · TE {item.timeEfficiency}</small><small>Full BPC build cost: {item.manufacturingCost == null ? "unpriced" : `${money(item.manufacturingCost)} ISK`}</small><small>Output valuation: {item.immediateSaleRevenue == null ? "unpriced" : `${money(item.immediateSaleRevenue)} ISK`} · {item.revenueBasis}</small><small>Full successful-BPC profit: {item.successfulCopyProfit == null ? "unpriced" : `${money(item.successfulCopyProfit)} ISK`}</small></div>
                  <div className="invention-skill-impact"><strong>Character invention chance</strong><small>Current adjusted chance: {item.probability == null ? "—" : `${(item.probability * 100).toFixed(2)}%`}</small><small>All relevant skills at V: {item.maxSkillsProbability == null ? "—" : `${(item.maxSkillsProbability * 100).toFixed(2)}%`}</small><small>Available through training: {item.trainingProbabilityGain == null ? "—" : `+${(item.trainingProbabilityGain * 100).toFixed(2)} percentage points`}</small>{item.skillImpacts.map((skill: any, index: number) => <div key={`${skill.typeId}:${skill.role}:${index}`}><b>{skill.name} {skill.trainedLevel}/5</b><span>{skill.role} · currently +{(skill.currentRelativeBoost * 100).toFixed(2)}% to multiplier · another +{(skill.remainingRelativeBoost * 100).toFixed(2)}% available</span></div>)}</div>
                  <div className="invention-one-run-materials"><strong>Build materials · 1 run</strong><small>Exact quantities at ME {item.materialEfficiency}; not multiplied by the BPC&apos;s {item.outputRuns} runs.</small>{item.manufacturingMaterialsPerRun.map((line: any, index: number) => <small key={`${line.typeId}:${index}`}>{line.quantity}× {line.name} · {line.cost == null ? "no quote" : `${money(line.cost)} ISK`} · {line.priceBasis}</small>)}</div>
                </div>
              </details>
            ))}
            {!visibleInventionOpportunities.length && <div className="invention-empty">No invention routes match this category and text filter.</div>}
          </div>
        </section>
      )}

      {tab === "planetary" && !snapshot && <div className="market-no-results">Connect and sync a character to audit planetary colonies and PI skills.</div>}
      {tab === "planetary" && snapshot && <PlanetaryRevenue snapshot={snapshot} marketDataRevision={marketDataRevision} />}

      {tab === "pve" && snapshot && (
        <div className="isk-analysis-actions">
          <button className="isk-refresh-intel" onClick={() => void scanPve(true)} disabled={pveBusy}>{pveBusy ? "Loading PvE intel…" : "Load PvE intelligence"}</button>
        </div>
      )}
      {tab === "pve" && !snapshot && <div className="market-no-results">Connect and sync a character so Sage can rank locations from your current system.</div>}
      {tab === "pve" && snapshot && !pveAnalysis && pveBusy && <div className="planner-analysis-state">Building PvE and location intelligence in the background...</div>}
      {tab === "pve" && snapshot && !pveAnalysis && !pveBusy && <div className="market-no-results">No prepared PvE/location result is available. Run Sync All to prepare it.</div>}
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
