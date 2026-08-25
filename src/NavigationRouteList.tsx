import { useMemo, useState } from "react";
import { KillmailReader } from "./KillmailReader";
import type { NavigationRouteIntelligence, NavigationRoutePlan, NavigationSystem } from "./types";

type WindowKey = "1h" | "2h" | "6h" | "24h";

type Props = {
  route: NavigationRoutePlan;
  intelligence: NavigationRouteIntelligence | null;
  selectedSystemId: number | null;
  selectedLegIndex: number | null;
  onSelectSystem(system: NavigationSystem): void;
  onSelectLeg(index: number): void;
  compact?: boolean;
};

function displaySecurity(value: number) { return Math.max(-1, Math.min(1, Math.round(value * 10) / 10)); }
function securityClass(value: number) { const v = displaySecurity(value); return v >= .5 ? "high" : v > 0 ? "low" : "null"; }
function ownershipLabel(row: any) {
  if (row?.ownership?.factionId) return `Faction ${row.ownership.factionId}`;
  if (row?.ownership?.allianceId) return `Alliance ${row.ownership.allianceId}`;
  if (row?.ownership?.corporationId) return `Corporation ${row.ownership.corporationId}`;
  return "Unclaimed / unavailable";
}

export function NavigationRouteList(props: Props) {
  const [windowKey, setWindowKey] = useState<WindowKey>("1h");
  const [killmail, setKillmail] = useState<any | null>(null);
  const intelBySystem = useMemo(() => new Map((props.intelligence?.systems ?? []).map((row) => [Number(row.system?.system?.systemId), row])), [props.intelligence]);
  const selectedSystem = props.route.systems.find((system) => system.systemId === props.selectedSystemId) ?? null;
  const selectedIntel = selectedSystem ? intelBySystem.get(selectedSystem.systemId) : null;

  return <div className={`navigation-dense-route ${props.compact ? "compact" : ""}`}>
    <div className="navigation-dense-route-head">
      <div><span>ROUTE LIST</span><strong>{props.route.origin?.name} → {props.route.destination?.name}</strong><small>Click a system for embedded intelligence. Click a leg to highlight it on the map.</small></div>
      <div className="navigation-window-buttons">{(["1h", "2h", "6h", "24h"] as WindowKey[]).map((value) => <button type="button" key={value} className={windowKey === value ? "active" : ""} onClick={() => setWindowKey(value)}>{value}</button>)}</div>
    </div>
    <div className="navigation-dense-table">
      <div className="navigation-dense-row heading"><span>#</span><span>System</span><span>Sec</span><span>Edge</span><span>Kills</span><span>Gate danger</span><span>Jumps</span></div>
      {props.route.systems.map((system, index) => {
        const intel = intelBySystem.get(system.systemId);
        const outgoing = index < props.route.legs.length ? props.route.legs[index] : null;
        const danger = intel?.routeGate?.danger;
        const selected = props.selectedSystemId === system.systemId;
        const selectedLeg = props.selectedLegIndex === index;
        return <div key={`${system.systemId}:${index}`} className={`navigation-dense-row ${selected ? "selected" : ""} ${selectedLeg ? "selected-leg" : ""} ${danger?.state ? `danger-${danger.state}` : ""} ${index === 0 ? "route-start" : index === props.route.systems.length - 1 ? "route-end" : ""}` }>
          <button type="button" className="jump" onClick={() => outgoing && props.onSelectLeg(index)}>{index}</button>
          <button type="button" className="system" onClick={() => props.onSelectSystem(system)}><strong>{system.name}</strong><small>{system.regionName}</small></button>
          <b className={securityClass(system.securityStatus)}>{displaySecurity(system.securityStatus).toFixed(1)}</b>
          <button type="button" className={`edge edge-${outgoing?.type ?? "dest"}`} disabled={!outgoing} onClick={() => outgoing && props.onSelectLeg(index)}>{outgoing?.type ?? "DEST"}</button>
          <span>{intel?.killWindows?.[windowKey]?.kills ?? "—"}{intel?.routeGate ? <small>{` · gate ${intel.routeGate.windows[windowKey].kills}`}</small> : null}</span>
          <span className={`navigation-danger-badge ${danger?.state ?? "clear"}`} title={danger?.reasons?.join(" ") ?? "No route-gate assessment"}>{danger?.label ?? (outgoing?.type === "gate" ? "Loading" : "—")}</span>
          <span>{intel?.activity?.jumps?.toLocaleString() ?? "—"}</span>
        </div>;
      })}
    </div>

    {selectedSystem && <div className="navigation-system-inspector">
      <div className="navigation-system-inspector-head"><div><span>SYSTEM INTELLIGENCE</span><strong>{selectedSystem.name}</strong><small>{selectedSystem.regionName} · {selectedSystem.constellationName}</small></div><b className={securityClass(selectedSystem.securityStatus)}>{displaySecurity(selectedSystem.securityStatus).toFixed(1)}</b></div>
      {selectedIntel ? <>
        <div className="navigation-system-inspector-metrics">
          <article><span>Ship / pod kills</span><strong>{selectedIntel.activity.shipKills} / {selectedIntel.activity.podKills}</strong><small>Public ESI activity</small></article>
          <article><span>NPC kills</span><strong>{selectedIntel.activity.npcKills.toLocaleString()}</strong><small>Public ESI activity</small></article>
          <article><span>Jumps</span><strong>{selectedIntel.activity.jumps.toLocaleString()}</strong><small>Public ESI activity</small></article>
          <article><span>Infrastructure</span><strong>{selectedIntel.infrastructure.npcStations} / {selectedIntel.infrastructure.knownStructures}</strong><small>NPC stations / known structures</small></article>
        </div>
        <div className="navigation-system-inspector-grid">
          <article><h4>Route gate assessment</h4>{selectedIntel.routeGate ? <><strong className={`navigation-danger-text ${selectedIntel.routeGate.danger.state}`}>{selectedIntel.routeGate.danger.label}</strong><p>{selectedIntel.routeGate.destinationSystemName} gate</p><ul>{selectedIntel.routeGate.danger.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul><small>{selectedIntel.routeGate.danger.metrics.gateKills1h} gate kills 1h · {selectedIntel.routeGate.danger.metrics.recurringAttackers} recurring attackers · {selectedIntel.routeGate.danger.metrics.podLosses2h} pod losses 2h</small></> : <p>No outgoing stargate leg from this system.</p>}</article>
          <article><h4>Ownership / hazards</h4><p>{ownershipLabel(selectedIntel)}</p><small>{selectedIntel.ownership.source}</small><div className="navigation-inspector-tags">{selectedIntel.hazards.incursion && <span>INCURSION</span>}{selectedIntel.hazards.triglavian && <span>TRIGLAVIAN</span>}{selectedIntel.hazards.edencom && <span>EDENCOM</span>}{!selectedIntel.hazards.incursion && selectedIntel.hazards.triglavian !== true && selectedIntel.hazards.edencom !== true && <span>NO ACTIVE HAZARD FLAG</span>}</div></article>
          <article><h4>Known structures</h4>{selectedIntel.infrastructure.structures.length ? <div className="navigation-inspector-structures">{selectedIntel.infrastructure.structures.slice(0, 8).map((structure: any, index: number) => <div key={`${structure.structureId ?? structure.name}:${index}`}><strong>{structure.name}</strong><small>{structure.ownerName ?? (structure.ownerId ? `Owner ${structure.ownerId}` : structure.source)}</small></div>)}</div> : <p>No player structure evidence is currently retained for this system.</p>}<small>{selectedIntel.infrastructure.npcStations} NPC station{selectedIntel.infrastructure.npcStations === 1 ? "" : "s"} in CCP static data.</small></article>
          <article><h4>Recent cached killmails</h4>{selectedIntel.system.killmails?.length ? <div className="navigation-inspector-kills">{selectedIntel.system.killmails.slice(0, 8).map((item: any) => <button type="button" key={item.killmailId} onClick={() => setKillmail(item)}><strong>#{item.killmailId}</strong><span>{item.killmailTime ? new Date(item.killmailTime).toLocaleString() : "Time unavailable"}</span><b>{item.totalValue ? `${Math.round(item.totalValue / 1_000_000).toLocaleString()}m ISK` : ""}</b></button>)}</div> : <p>No retained killmails for this system yet.</p>}</article>
        </div>
      </> : <div className="navigation-compact-empty">Route intelligence has not loaded this system yet.</div>}
    </div>}
    {killmail && <KillmailReader killmail={killmail} systemName={selectedSystem?.name ?? "Route system"} onClose={() => setKillmail(null)} />}
  </div>;
}
