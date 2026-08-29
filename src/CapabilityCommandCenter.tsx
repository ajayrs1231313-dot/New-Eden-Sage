import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CapabilityAnalysis, CapabilityResult, CharacterSnapshot, ShipUseProfileId } from "./types";
import { TrainingTimeNotice } from "./TrainingTimeNotice";
import { friendlyAnalysisError, isExpectedAnalysisCancellation } from "./analysis-errors";

type CloneState = "alpha" | "omega";

type Props = {
  snapshot: CharacterSnapshot;
  cloneState?: CloneState;
  onOpenProgression(): void;
  compact?: boolean;
};

const money = (value: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);

const SHIP_USE_OPTIONS: Array<{ id: ShipUseProfileId; label: string }> = [
  { id: "pve-combat", label: "PvE Combat" },
  { id: "pvp-combat", label: "PvP Combat" },
  { id: "mining", label: "Mining" },
  { id: "exploration", label: "Exploration" },
  { id: "logistics", label: "Logistics" },
  { id: "hauling", label: "Hauling" },
  { id: "salvage", label: "Salvage" },
  { id: "support", label: "Support" },
  { id: "general", label: "Other / General" },
];
const SHIP_USE_IDS = new Set<ShipUseProfileId>(SHIP_USE_OPTIONS.map((item) => item.id));

function shipUseStorageKey(snapshot: CharacterSnapshot) {
  return `new-eden-sage:ship-use:v1:${snapshot.characterId}:${Number(snapshot.ship.ship_type_id ?? 0)}`;
}
function readShipUse(snapshot: CharacterSnapshot): ShipUseProfileId {
  try {
    const value = localStorage.getItem(shipUseStorageKey(snapshot)) as ShipUseProfileId | null;
    if (value && SHIP_USE_IDS.has(value)) return value;
  } catch { /* localStorage can be unavailable in isolated renderer tests. */ }
  return "general";
}
function saveShipUse(snapshot: CharacterSnapshot, profileId: ShipUseProfileId) {
  try { localStorage.setItem(shipUseStorageKey(snapshot), profileId); } catch { /* Preference persistence is non-fatal. */ }
}

function duration(seconds: number | null | undefined) {
  if (seconds == null) return "time unavailable";
  if (seconds <= 0) return "ready now";
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.ceil((seconds % 86400) / 3600)}h`;
}

function CapabilityHudDial({ snapshot, percent }: { snapshot: CharacterSnapshot; percent: number }) {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  const radius = 49;
  const complete = safePercent >= 100;
  return (
    <div className={`capability-hud-dial${complete ? " complete" : ""}`} aria-label={`${safePercent}% capability readiness`}>
      <svg viewBox="0 0 124 124" aria-hidden="true">
        <circle className="capability-hud-orbit" cx="62" cy="62" r="55" />
        <circle className="capability-hud-track" cx="62" cy="62" r={radius} />
        <circle className={`capability-hud-progress${complete ? " complete" : ""}`} cx="62" cy="62" r={radius} pathLength={100} strokeDasharray={`${safePercent} ${100 - safePercent}`} strokeDashoffset={0} transform="rotate(-90 62 62)" style={{ opacity: safePercent === 0 ? 0 : 1 }} />
        <path className="capability-hud-brackets" d="M23 31h10V21M91 21v10h10M23 93h10v10M91 103V93h10" />
        {Array.from({ length: 16 }, (_, index) => {
          const angle = (index / 16) * Math.PI * 2 - Math.PI / 2;
          const x1 = 62 + Math.cos(angle) * 53;
          const y1 = 62 + Math.sin(angle) * 53;
          const x2 = 62 + Math.cos(angle) * (index % 4 === 0 ? 58 : 56);
          const y2 = 62 + Math.sin(angle) * (index % 4 === 0 ? 58 : 56);
          return <line className="capability-hud-tick" key={index} x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
      </svg>
      <div className="capability-hud-ship"><img src={`https://images.evetech.net/types/${snapshot.ship.ship_type_id}/render?size=128`} alt="" /></div>
      <strong>{safePercent}%</strong>
    </div>
  );
}

export function CapabilityCommandCenter({ snapshot, cloneState, onOpenProgression, compact = false }: Props) {
  const [analysis, setAnalysis] = useState<CapabilityAnalysis | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shipUseProfile, setShipUseProfile] = useState<ShipUseProfileId>(() => readShipUse(snapshot));
  const [shipCapability, setShipCapability] = useState<CapabilityResult | null>(null);
  const [shipBusy, setShipBusy] = useState(false);
  const [shipError, setShipError] = useState("");
  const [shipRefreshStatus, setShipRefreshStatus] = useState("");
  const requestSequence = useRef(0);
  const shipRequestSequence = useRef(0);

  const refresh = useCallback(async (showBusy = false) => {
    const requestId = ++requestSequence.current;
    if (showBusy) setBusy(true);
    setError("");
    try {
      const result = await window.sage.getCapabilities({ characterId: snapshot.characterId, cloneState: cloneState ?? "omega" });
      if (requestId !== requestSequence.current) return;
      setAnalysis(result);
      setSelectedId((current) => result.capabilities.some((item) => item.id === current) ? current : result.capabilities[0]?.id ?? "");
    } catch (caught) {
      if (requestId !== requestSequence.current || isExpectedAnalysisCancellation(caught)) return;
      setError(friendlyAnalysisError(caught, "Could not calculate capability intelligence."));
    } finally {
      if (requestId === requestSequence.current) setBusy(false);
    }
  }, [snapshot.characterId, snapshot.updatedAt, cloneState]);

  useEffect(() => {
    if (!compact) void refresh();
  }, [compact, refresh]);

  useEffect(() => {
    if (!compact) return;
    setShipUseProfile(readShipUse(snapshot));
    setShipCapability(null);
    setShipRefreshStatus("");
  }, [compact, snapshot.characterId, snapshot.ship.ship_type_id]);

  const refreshShipCapability = useCallback(async (profileId: ShipUseProfileId, showBusy = false) => {
    const requestId = ++shipRequestSequence.current;
    if (showBusy) setShipBusy(true);
    setShipError("");
    try {
      const result = await window.sage.getCurrentShipCapability({ characterId: snapshot.characterId, profileId, cloneState: cloneState ?? "omega" });
      if (requestId !== shipRequestSequence.current) return;
      setShipCapability(result);
    } catch (caught) {
      if (requestId !== shipRequestSequence.current) return;
      setShipError(caught instanceof Error ? caught.message : "Could not calculate current-ship readiness.");
    } finally {
      if (requestId === shipRequestSequence.current) setShipBusy(false);
    }
  }, [snapshot.characterId, snapshot.ship.ship_type_id, snapshot.updatedAt, cloneState]);

  useEffect(() => {
    if (compact) void refreshShipCapability(shipUseProfile);
  }, [compact, refreshShipCapability, shipUseProfile]);

  const changeShipUseProfile = (profileId: ShipUseProfileId) => {
    saveShipUse(snapshot, profileId);
    setShipCapability(null);
    setShipUseProfile(profileId);
    setShipRefreshStatus("");
  };

  const refreshCurrentShipFromEsi = async () => {
    const requestId = ++shipRequestSequence.current;
    setShipBusy(true);
    setShipError("");
    setShipRefreshStatus("Pulling current ship from ESI...");
    try {
      const nextSnapshot = await window.sage.refreshCurrentShip(snapshot.characterId);
      if (requestId !== shipRequestSequence.current) return;
      window.dispatchEvent(new CustomEvent<CharacterSnapshot>("sage:character-snapshot-updated", { detail: nextSnapshot }));
      const nextProfile = Number(nextSnapshot.ship.ship_type_id) === Number(snapshot.ship.ship_type_id) ? shipUseProfile : readShipUse(nextSnapshot);
      if (nextProfile !== shipUseProfile) setShipUseProfile(nextProfile);
      const result = await window.sage.getCurrentShipCapability({ characterId: nextSnapshot.characterId, profileId: nextProfile, cloneState: cloneState ?? "omega" });
      if (requestId !== shipRequestSequence.current) return;
      setShipCapability(result);
      setShipRefreshStatus(`${nextSnapshot.ship.ship_type_name || nextSnapshot.ship.ship_name || "Current ship"} updated from ESI`);
    } catch (caught) {
      if (requestId !== shipRequestSequence.current) return;
      setShipError(caught instanceof Error ? caught.message : "Could not refresh the current ship from ESI.");
      setShipRefreshStatus("");
    } finally {
      if (requestId === shipRequestSequence.current) setShipBusy(false);
    }
  };

  const selected = useMemo(
    () => analysis?.capabilities.find((item) => item.id === selectedId) ?? analysis?.capabilities[0],
    [analysis, selectedId],
  );

  if (!compact && busy && !analysis) return <div className="capability-loading">Building personalised capability intelligence from prepared Sage data...</div>;
  if (!compact && error && !analysis) return <div className="capability-loading error"><span>{error}</span><button onClick={() => void refresh(true)} disabled={busy}>Refresh analysis</button></div>;
  if (!compact && (!analysis || !selected)) return null;

  const radarSelected = compact ? shipCapability : selected;
  const bars = radarSelected ? [
    ["Overall", radarSelected.overallPercent],
    ["Practical", radarSelected.readinessPercent],
    ["Assets", radarSelected.assetPercent],
    ["Resources", radarSelected.resourcePercent],
  ] as const : [];

  return (
    <div className={`capability-command-center${compact ? " compact" : ""}`}>
      <article className="capability-next-moves">
        <div className="capability-heading">
          <div><p className="eyebrow">SUGGESTED NEXT MOVES</p><h3>Highest-impact upgrades</h3></div>
          {!compact && <button onClick={onOpenProgression}>Open Activity Command</button>}
        </div>
        {!compact && <TrainingTimeNotice cloneState={cloneState} />}
        {!compact && <ol>
          {analysis!.topRecommendations.slice(0, 5).map((item, index) => (
            <li key={`${item.capabilityId}-${item.upgrade.type}-${item.upgrade.label}`}>
              <span>{index + 1}</span>
              <div>
                <strong>{item.upgrade.label}</strong>
                <small>{item.capability} / {item.upgrade.why}</small>
                {!compact && (item.upgrade.estimatedSeconds != null || item.upgrade.estimatedCost != null) && (
                  <em>{item.upgrade.estimatedSeconds != null ? duration(item.upgrade.estimatedSeconds) : ""}{item.upgrade.estimatedSeconds != null && item.upgrade.estimatedCost != null ? " / " : ""}{item.upgrade.estimatedCost != null ? `~${money(item.upgrade.estimatedCost)} ISK` : ""}</em>
                )}
              </div>
              <b>+{item.upgrade.estimatedGain}%</b>
            </li>
          ))}
        </ol>}
        {compact && <div className="capability-next-moves-ready"><strong>Training guidance ready on demand</strong><small>Open Activity Command for full recommendations without blocking current-ship readiness.</small></div>}
        <button className="capability-open-activity" onClick={onOpenProgression}>View all suggestions <span>&rarr;</span></button>
        {!compact && <small className="capability-data-line">Using {analysis!.dataSignals.ownedShips} owned ship records / {analysis!.dataSignals.modules} module assets / {analysis!.dataSignals.blueprints} blueprints / {analysis!.dataSignals.savedFittings} saved fits / {money(analysis!.dataSignals.wallet)} ISK</small>}
      </article>

      <article className="capability-radar capability-radar-v2">
        <div className="capability-heading">
          <div><p className="eyebrow">SHIP & CAPABILITY READINESS</p><h3>{snapshot.ship.ship_type_name || snapshot.ship.ship_name || "Current ship"}</h3></div>
          <div className="capability-refresh-actions">
            {compact && <label className="capability-use-select" title="What are you using this ship for?">
              <span>USE</span>
              <select value={shipUseProfile} onChange={(event) => changeShipUseProfile(event.target.value as ShipUseProfileId)} disabled={shipBusy}>
                {SHIP_USE_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>}
            {(compact ? shipBusy : busy) && <small>Refreshing...</small>}
            {compact && !shipBusy && shipRefreshStatus && <small className="capability-refresh-status">{shipRefreshStatus}</small>}
            <button type="button" title={compact ? "Refresh current ship from ESI" : "Refresh capability analysis"} aria-label={compact ? "Refresh current ship from ESI" : "Refresh capability analysis"} onClick={() => compact ? void refreshCurrentShipFromEsi() : void refresh(true)} disabled={compact ? shipBusy : busy}>&#8635;</button>
          </div>
        </div>
        {(compact ? shipError : error) && <div className="capability-inline-error"><span>{compact ? shipError : error}</span><button onClick={() => compact ? void refreshShipCapability(shipUseProfile, true) : void refresh(true)} disabled={compact ? shipBusy : busy}>Retry</button></div>}

        {radarSelected ? <div className="capability-hud-summary">
          <CapabilityHudDial snapshot={snapshot} percent={radarSelected.overallPercent} />
          <div className="capability-hud-bars">
            <div className="capability-hud-selected"><strong>{radarSelected.label}</strong><small>{radarSelected.tier}</small></div>
            {bars.map(([label, value]) => <div className="capability-hud-bar" key={label}><span>{label}</span><i><b style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i><strong>{value}%</strong></div>)}
          </div>
        </div> : <div className="capability-ship-use-loading">Calculating {SHIP_USE_OPTIONS.find((item) => item.id === shipUseProfile)?.label ?? "current-ship"} readiness...</div>}

        {compact ? (radarSelected && (
          <details className="capability-deep-analysis">
            <summary>View full readiness <span>&rarr;</span></summary>
            <CapabilityDetail item={radarSelected} />
          </details>
        )) : <CapabilityExplorer analysis={analysis!} selected={selected!} selectedId={selectedId} setSelectedId={setSelectedId} />}
      </article>
    </div>
  );
}

function CapabilityExplorer({ analysis, selected, selectedId, setSelectedId }: { analysis: CapabilityAnalysis; selected: CapabilityResult; selectedId: string; setSelectedId(id: string): void }) {
  return <div className="capability-explorer"><ol className="capability-bars">{analysis.capabilities.map((item) => <li key={item.id} className={selectedId === item.id ? "active" : ""} onClick={() => setSelectedId(item.id)}><span>{item.label}</span><div><i style={{ width: `${item.overallPercent}%` }} /></div><strong>{item.overallPercent}%</strong></li>)}</ol><CapabilityDetail item={selected} /></div>;
}

function CapabilityDetail({ item }: { item: CapabilityResult }) {
  return (
    <section className="capability-detail">
      <div className="capability-detail-title"><div><span>{item.tier}</span><h4>{item.label}</h4><p>{item.description}</p></div><strong>{item.overallPercent}%</strong></div>
      <div className="capability-components"><div><span>Practical readiness</span><strong>{item.readinessPercent}%</strong></div><div><span>Owned assets</span><strong>{item.assetPercent}%</strong></div><div><span>Resources</span><strong>{item.resourcePercent}%</strong></div></div>
      <div className="capability-route"><span>Best current route</span><strong>{item.bestRoute}</strong>{item.bestHull && <small>{item.ownedHull ? "Hull owned" : "Hull not currently owned"}{item.savedFitCount ? ` / ${item.savedFitCount} saved fit${item.savedFitCount === 1 ? "" : "s"}` : ""}</small>}</div>
      <div className="capability-strength-grid"><div><b>Strengths</b>{item.strengths.length ? item.strengths.slice(0, 5).map((text) => <small key={text}>{text}</small>) : <small>No strong positive signal identified yet.</small>}</div><div><b>Weaknesses</b>{item.weaknesses.length ? item.weaknesses.slice(0, 5).map((text) => <small key={text}>{text}</small>) : <small>No major identified gap for this representative target.</small>}</div></div>
      <div className="capability-upgrades"><b>Best improvements</b>{item.upgrades.slice(0, 4).map((upgrade) => <div key={`${upgrade.type}-${upgrade.label}`}><span><strong>{upgrade.label}</strong><small>{upgrade.why}</small></span><em>+{upgrade.estimatedGain}%</em></div>)}</div>
      <details className="capability-show-work"><summary>Show Work - why {item.overallPercent}%?</summary>{item.showWork.map((line) => <small key={line}>{line}</small>)}</details>
    </section>
  );
}
