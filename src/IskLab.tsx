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
import { IskGlyph } from "./IskIcons";
import { InventionIntelligence } from "./InventionIntelligence";
import { iskModuleBuildKey, shouldWakeIskModule } from "./isk-command-activation";
import "./invention-lab.css";

const money = (value: number) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);

const compactMoney = (value: number) =>
  new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 2 }).format(value);

function updateAgeLabel(timestamp: string | null | undefined) {
  if (!timestamp) return "unknown";
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return "unknown";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - parsed) / 60000));
  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes < 60) return elapsedMinutes + " min ago";
  if (elapsedMinutes < 1440) return Math.floor(elapsedMinutes / 60) + "h ago";
  return Math.floor(elapsedMinutes / 1440) + "d ago";
}

function ageLabel(minutes: number | null) {
  if (minutes == null) return "unknown age";
  if (minutes < 60) return `${minutes}m old`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m old`;
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h old`;
}


type LabTab = "market" | "market-opportunities" | "orders" | "contracts" | "opportunities" | "invention" | "planetary" | "pve";
type CloneState = "alpha" | "omega";


export function IskLab({ snapshot, active = true, cloneState, marketDataRevision = 0, onMarketDataUpdated = () => undefined }: { snapshot?: CharacterSnapshot; active?: boolean; cloneState?: CloneState; marketDataRevision?: number; onMarketDataUpdated?: () => void }) {
  const [tab, setTab] = useState<LabTab>("market");
  const [contractsVisited, setContractsVisited] = useState(false);
  const [analysis, setAnalysis] = useState<OpportunityAnalysis | null>(null);
  const [pveAnalysis, setPveAnalysis] = useState<PveLocationAnalysis | null>(null);
  const [inventionAnalysis, setInventionAnalysis] = useState<any>(null);
  const [inventionBusy, setInventionBusy] = useState(false);
  const [inventionStatus, setInventionStatus] = useState("Open Invention to rank every inventable blueprint against the retained market.");
  const [inventionDecryptor, setInventionDecryptor] = useState("");
  const [marketBusy, setMarketBusy] = useState(false);
  const [marketMaxCapital, setMarketMaxCapital] = useState<number | null>(null);
  const [marketCapitalFocusRequest, setMarketCapitalFocusRequest] = useState(0);
  const [pveBusy, setPveBusy] = useState(false);
  const [marketProgress, setMarketProgress] = useState<AnalysisProgress | null>(null);
  const [pveProgress, setPveProgress] = useState<AnalysisProgress | null>(null);
  const [marketStatus, setMarketStatus] = useState("Use the newest full public market snapshot to compare candidate trade routes.");
  const [pveStatus, setPveStatus] = useState("Connect and sync a character to rank PvE locations from your current system.");
  const pveRequestSequence = useRef(0);
  const pvePreferLive = useRef(false);
  const marketRequestSequence = useRef(0);
  const [preparedDataRevision, setPreparedDataRevision] = useState(0);
  const preparedDataDirty = useRef(false);
  const marketAutoBuildKey = useRef<string | null>(null);
  const pveAutoBuildKey = useRef<string | null>(null);
  const inventionAutoBuildKey = useRef<string | null>(null);

  useEffect(() => {
    setAnalysis(null);
    setPveAnalysis(null);
    pvePreferLive.current = false;
    setInventionAnalysis(null);
  }, [snapshot?.characterId]);

  useEffect(() => {
    if (active && preparedDataDirty.current) {
      preparedDataDirty.current = false;
      setPreparedDataRevision((revision) => revision + 1);
    }
    return window.sage.onPreparedDataUpdated((value) => {
      if (snapshot?.characterId && value.characterIds?.length && !value.characterIds.includes(snapshot.characterId)) return;
      if (active) setPreparedDataRevision((revision) => revision + 1);
      else preparedDataDirty.current = true;
    });
  }, [active, snapshot?.characterId]);

  useEffect(() => window.sage.onAnalysisProgress((progress) => {
    if (progress.kind === "opportunity") setMarketProgress(progress);
    if (progress.kind === "pve-location") setPveProgress(progress);
  }), []);
  useEffect(() => {
    if (!analysis) return;
    setMarketMaxCapital(analysis.constraints.maxCapital);
  }, [analysis?.generatedAt, analysis?.constraints.maxCapital]);

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
      if (isExpectedAnalysisCancellation(error)) { marketAutoBuildKey.current = null; return; }
      marketAutoBuildKey.current = null;
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
      if (isExpectedAnalysisCancellation(error)) { pveAutoBuildKey.current = null; return null; }
      pveAutoBuildKey.current = null;
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
      inventionAutoBuildKey.current = null;
      setInventionStatus(error instanceof Error ? error.message : "Invention analysis failed.");
    } finally {
      setInventionBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    if (!active) return () => { cancelled = true; };
    if (!snapshot) {
      setAnalysis(null);
      setPveAnalysis(null);
      setInventionAnalysis(null);
      return () => { cancelled = true; };
    }

    const marketModuleVisible = tab === "market" || tab === "market-opportunities" || tab === "opportunities";
    const preparedModule: "market" | "pve" | "invention" | null = marketModuleVisible
      ? "market"
      : tab === "pve"
        ? "pve"
        : tab === "invention"
          ? "invention"
          : null;
    if (!preparedModule) return () => { cancelled = true; };
    if (preparedModule === "pve" && pvePreferLive.current) return () => { cancelled = true; };

    const marketBuildKey = iskModuleBuildKey("market", snapshot.characterId, snapshot.updatedAt, marketDataRevision, preparedDataRevision);
    const pveBuildKey = iskModuleBuildKey("pve", snapshot.characterId, snapshot.updatedAt, cloneState ?? "omega", preparedDataRevision);
    const inventionBuildKey = iskModuleBuildKey("invention", snapshot.characterId, snapshot.updatedAt, marketDataRevision, preparedDataRevision, inventionDecryptor || "none");

    if (preparedModule === "market" && analysis && marketAutoBuildKey.current === marketBuildKey) return () => { cancelled = true; };
    if (preparedModule === "pve" && pveAnalysis && pveAutoBuildKey.current === pveBuildKey) return () => { cancelled = true; };
    if (preparedModule === "invention" && inventionAnalysis && inventionAutoBuildKey.current === inventionBuildKey) return () => { cancelled = true; };

    const timer = setTimeout(() => {
      void window.sage.getPreparedIskLab({ characterId: snapshot.characterId, cloneState, modules: [preparedModule] }).then((prepared) => {
        if (cancelled) return;
        if (preparedModule === "market") {
          if (prepared.market) {
            marketAutoBuildKey.current = marketBuildKey;
            setAnalysis(prepared.market);
            setMarketStatus(
              `${prepared.market.market.opportunities.length.toLocaleString()} candidate routes ready from ${prepared.market.signals.marketOrdersInspected.toLocaleString()} retained public orders across ${prepared.market.signals.marketRegionsInspected.toLocaleString()} regions.`,
            );
          } else {
            setMarketStatus("Preparing Market Scanner intelligence from the installed server-prepared market generation and current local character data...");
            if (shouldWakeIskModule({ active, visible: true, prepared: prepared.market, busy: marketBusy, buildKey: marketBuildKey, lastBuildKey: marketAutoBuildKey.current })) {
              marketAutoBuildKey.current = marketBuildKey;
              void scanMarketWithCargo(null);
            }
          }
          return;
        }

        if (preparedModule === "pve") {
          if (prepared.pve) {
            pveAutoBuildKey.current = pveBuildKey;
            setPveAnalysis(prepared.pve);
            setPveStatus(
              `${prepared.pve.locations.length} PvE/location leads are ready from ${prepared.pve.character.systemName}. Public activity data is ${ageLabel(prepared.pve.dataStatus.ageMinutes)}.`,
            );
          } else {
            setPveStatus("No prepared PvE/location result is available yet. Building it from local character context and shared public activity data...");
            if (shouldWakeIskModule({ active, visible: true, prepared: prepared.pve, busy: pveBusy, buildKey: pveBuildKey, lastBuildKey: pveAutoBuildKey.current })) {
              pveAutoBuildKey.current = pveBuildKey;
              void scanPve(false);
            }
          }
          return;
        }

        if (prepared.invention) {
          inventionAutoBuildKey.current = inventionBuildKey;
          setInventionAnalysis(prepared.invention);
          setInventionStatus(
            `${prepared.invention.candidateCount.toLocaleString()} invention outcomes ready ┬À ${prepared.invention.ownedSourceCount.toLocaleString()} use an owned source BPO.`,
          );
        } else {
          setInventionStatus("Invention is prepared on demand. Building it from the current local character and installed public market generation...");
          if (shouldWakeIskModule({ active, visible: true, prepared: prepared.invention, busy: inventionBusy, buildKey: inventionBuildKey, lastBuildKey: inventionAutoBuildKey.current })) {
            inventionAutoBuildKey.current = inventionBuildKey;
            void scanInvention();
          }
        }
      }).catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Prepared ISK Command data could not be read.";
        if (preparedModule === "market") { marketAutoBuildKey.current = null; setMarketStatus(message); }
        if (preparedModule === "pve") { pveAutoBuildKey.current = null; setPveStatus(message); }
        if (preparedModule === "invention") { inventionAutoBuildKey.current = null; setInventionStatus(message); }
      });
    }, 100);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active, tab, snapshot?.characterId, snapshot?.updatedAt, marketDataRevision, cloneState, preparedDataRevision]);

  function openPveTab() {
    pvePreferLive.current = true;
    setTab("pve");
    void scanPve(true);
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
  function focusMarketCapital() {
    setTab("market");
    setMarketCapitalFocusRequest((value) => value + 1);
  }

  const marketOpportunities = analysis?.market.opportunities ?? [];
  const bestHaulYield = marketOpportunities.reduce((best, trade) => Number.isFinite(trade.iskPerM3) ? Math.max(best, trade.iskPerM3) : best, 0);
  const bestOpportunityProfit = marketOpportunities.reduce((best, trade) => Math.max(best, trade.profit), 0);
  const opportunityRoiValues = marketOpportunities.map((trade) => trade.marginPercent).filter((value) => Number.isFinite(value));
  const averageOpportunityRoi = opportunityRoiValues.length ? opportunityRoiValues.reduce((sum, value) => sum + value, 0) / opportunityRoiValues.length : null;
  const highConfidenceOpportunityCount = marketOpportunities.reduce((count, trade) => count + (trade.fillScore >= 80 ? 1 : 0), 0);
  const shortestOpportunityRoute = marketOpportunities.reduce<number | null>((best, trade) => best == null ? trade.jumps : Math.min(best, trade.jumps), null);

  return (
    <section className="isk-lab isk-lab-v2">
      <div className={`isk-head${tab === "invention" ? " invention-command-head" : ""}`}>
        {tab === "invention" ? (
          <>
            <div className="invention-command-copy">
              <p className="eyebrow">ISK COMMAND</p>
              <h2>Invention Intelligence</h2>
              <p className="invention-command-tagline">Turning blueprints into profit</p>
              <p className="invention-command-status">{status}</p>
            </div>
            {snapshot && (
              <div className="invention-wallet-card">
                <div><span>{snapshot.character.name}</span><small>ISK BALANCE</small><strong>{money(snapshot.wallet)} ISK</strong></div>
                <IskGlyph name="coin" />
              </div>
            )}
          </>
        ) : (
          <>
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
          </>
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

      {analysis && tab === "market" && (
        <div className="isk-summary-strip isk-summary-strip-polished">
          <article className="isk-summary-card">
            <span className="isk-summary-icon"><IskGlyph name="cart" /></span>
            <div><span>Raw orders</span><strong>{analysis.signals.marketOrdersInspected.toLocaleString()}</strong><small>{analysis.signals.marketRegionsInspected.toLocaleString()} regions · complete public order book</small></div>
          </article>
          <button type="button" className="isk-summary-card isk-summary-card-link" onClick={focusMarketCapital} title="Open the Market Scanner maximum-capital filter">
            <span className="isk-summary-icon"><IskGlyph name="bars" /></span>
            <div><span>Capital basis</span><strong>{marketMaxCapital == null ? "Unlimited" : `${money(marketMaxCapital)} ISK`}</strong><small>Market Scanner maximum-capital filter</small></div>
          </button>
          <article className="isk-summary-card active">
            <span className="isk-summary-icon"><IskGlyph name="route" /></span>
            <div><span>Market routes</span><strong>{analysis.market.opportunities.length.toLocaleString()}</strong><small>Filtered & aligned · jumps and time taken</small></div>
          </article>
          <article className="isk-summary-card amber">
            <span className="isk-summary-icon"><IskGlyph name="pulse" /></span>
            <div><span>Regional shortages</span><strong>{analysis.signals.regionalShortageSignals.toLocaleString()}</strong><small>Supply gaps and price inefficiency alerts</small></div>
          </article>
          <article className="isk-summary-card amber">
            <span className="isk-summary-icon"><IskGlyph name="cubes" /></span>
            <div><span>Best haul yield</span><strong>{bestHaulYield > 0 ? `${money(bestHaulYield)} ISK/m³` : "—"}</strong><small>Highest cargo efficiency in current results</small></div>
          </article>
        </div>
      )}
      {analysis && tab === "market-opportunities" && (
        <header className="market-opportunities-signal-bar">
          <span className="market-opportunities-signal-mark" aria-hidden="true">
            <IskGlyph name="target" />
          </span>
          <div className="market-opportunities-signal-copy">
            <p className="eyebrow">PROFIT OPPORTUNITIES INTELLIGENCE</p>
            <h2>OPPORTUNITIES &amp; SIGNALS</h2>
            <p>Real-time profit opportunities ranked by potential and reliability. Updated every 5 minutes.</p>
          </div>
          <div className="market-opportunities-signal-kpis">
            <article>
              <span>TOTAL OPPORTUNITIES</span>
              <strong>{marketOpportunities.length.toLocaleString()}</strong>
              <small>{highConfidenceOpportunityCount.toLocaleString()} high-confidence signals</small>
            </article>
            <article>
              <span>TOP PROFIT (ISK)</span>
              <strong>{bestOpportunityProfit > 0 ? compactMoney(bestOpportunityProfit) : "-"}</strong>
              <small>{shortestOpportunityRoute == null ? "Current prepared set" : shortestOpportunityRoute + " jumps on shortest route"}</small>
            </article>
            <article>
              <span>AVG ROI</span>
              <strong>{averageOpportunityRoi == null ? "-" : averageOpportunityRoi.toFixed(1) + "%"}</strong>
              <small>Gross return across current signals</small>
            </article>
            <button
              type="button"
              className="market-opportunities-update-kpi"
              onClick={() => void scanMarketWithCargo(analysis.constraints.cargoCapacityM3, analysis.constraints.cargoProfileId ?? null)}
              disabled={marketBusy}
              title="Refresh Market Opportunities using the current cargo profile"
            >
              <span>LAST UPDATE</span>
              <strong>{marketBusy ? "refreshing..." : updateAgeLabel(analysis.generatedAt)}</strong>
              <small><IskGlyph name="reset" />{marketBusy ? "rebuilding routes" : "refresh opportunities"}</small>
            </button>
          </div>
        </header>
      )}
      {!analysis && pveAnalysis && (
        <div className="isk-summary-strip">
          <article><span>PvE / location leads</span><strong>{pveAnalysis.locations.length.toLocaleString()}</strong><small>{pveAnalysis.counts.incursion} live incursions · {pveAnalysis.dataStatus.stale ? "cached/partial intel" : "current public intel"}</small></article>
        </div>
      )}

      <div className="isk-lab-tabs isk-lab-tabs-polished" role="tablist" aria-label="ISK Command sections">
        <button className={tab === "market" ? "active" : ""} onClick={() => setTab("market")}><IskGlyph name="search" />Market Scanner</button>
        <button className={tab === "market-opportunities" ? "active" : ""} onClick={() => setTab("market-opportunities")}><IskGlyph name="route" />Market Opportunities</button>
        <button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}><IskGlyph name="orders" />Order Desk</button>
        <button className={tab === "contracts" ? "active" : ""} onClick={() => { setContractsVisited(true); setTab("contracts"); }}><IskGlyph name="contract" />Contracts</button>
        <button className={tab === "opportunities" ? "active" : ""} onClick={() => setTab("opportunities")}><IskGlyph name="target" />All Opportunities</button>
        <button className={tab === "invention" ? "active" : ""} onClick={() => setTab("invention")}><IskGlyph name="invention" />Invention</button>
        <button className={tab === "planetary" ? "active" : ""} onClick={() => setTab("planetary")}><IskGlyph name="planet" />Planetary Revenue</button>
        <button className={tab === "pve" ? "active" : ""} onClick={openPveTab}><IskGlyph name="pve" />PvE & Locations</button>
      </div>

      {tab === "market" && !analysis && marketBusy && <div className="planner-analysis-state">Analyzing retained market data in the background...</div>}
      {tab === "market" && !analysis && !marketBusy && <div className="market-no-results">No prepared Market Scanner result is available yet. Sage uses the installed server-prepared market generation and builds this view on demand.</div>}
      {analysis && tab === "market" && <MarketOpportunityScanner analysis={analysis} onExport={exportMarketCsv} onMaxCapitalChange={setMarketMaxCapital} focusMaxCapitalRequest={marketCapitalFocusRequest} />}

      {tab === "market-opportunities" && analysis && <MarketDayTrader analysis={analysis} snapshot={snapshot} onCargoCapacityChange={scanMarketWithCargo} marketBusy={marketBusy} />}
      {tab === "market-opportunities" && !analysis && <div className="market-no-results">No prepared Market Opportunities result is available yet. Sage builds this view from the installed server-prepared market generation.</div>}

      {tab === "orders" && <OrderDesk snapshot={snapshot} />}

      {contractsVisited && <div hidden={tab !== "contracts"}><MarketContracts characterId={snapshot?.characterId} marketDataRevision={marketDataRevision} /></div>}

      {tab === "opportunities" && analysis && <OpportunityExplorer analysis={analysis} extraRows={pveAnalysis?.ranked ?? []} onCargoCapacityChange={scanMarketWithCargo} marketBusy={marketBusy} />}
      {tab === "opportunities" && !analysis && <div className="market-no-results">No prepared Opportunities result is available yet. Sage builds this view from installed public data and local character context.</div>}

      {tab === "invention" && !snapshot && <div className="market-no-results">Connect and sync a character to include owned blueprint originals.</div>}
      {tab === "invention" && snapshot && inventionBusy && !inventionAnalysis && <div className="planner-analysis-state">Building and pricing the complete invention catalogue…</div>}
      {tab === "invention" && inventionAnalysis && (
        <InventionIntelligence
          analysis={inventionAnalysis}
          busy={inventionBusy}
          decryptor={inventionDecryptor}
          onDecryptorChange={(value) => { setInventionDecryptor(value); void scanInvention(value); }}
          onRefresh={() => void scanInvention()}
        />
      )}

      {tab === "planetary" && !snapshot && <div className="market-no-results">Connect and sync a character to audit planetary colonies and PI skills.</div>}
      {tab === "planetary" && snapshot && <PlanetaryRevenue snapshot={snapshot} marketDataRevision={marketDataRevision} />}

      {tab === "pve" && !snapshot && <div className="market-no-results">Connect and sync a character so Sage can rank locations from your current system.</div>}
      {tab === "pve" && snapshot && !pveAnalysis && pveBusy && <div className="planner-analysis-state">Building PvE and location intelligence in the background...</div>}
      {tab === "pve" && snapshot && !pveAnalysis && !pveBusy && <div className="market-no-results">No prepared PvE/location result is available yet. Open the PvE tab to build it from local character context and shared public activity data.</div>}
      {tab === "pve" && pveAnalysis && <PveLocationIntel analysis={pveAnalysis} busy={pveBusy} onRefresh={() => { pvePreferLive.current = true; void scanPve(true); }} />}
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
