import { useCallback, useEffect, useMemo, useState } from "react";
import { OnTheFlyJumpMap } from "./OnTheFlyJumpMap";
import type { NavigationCharacterLocation, NavigationSystem } from "./types";
import "./navigation-command.css";
import { CorporationDoctrines, PENDING_DOCTRINE_FIT_KEY } from "./CorporationDoctrines";

type FleetCorporation = {
  characterId: string;
  characterName: string;
  corporationId: number;
  name: string;
  snapshot: any;
  data: any;
};

type FleetCommandTab = "doctrines" | "jump-map" | "wargame";

function WargameMap({ corporation }: { corporation: FleetCorporation }) {
  return <div className="corp-data-view fleet-wargame-view">
    <div className="fleet-wargame-heading">
      <div>
        <p className="eyebrow">FLEET COMMAND / WARGAME MAP</p>
        <h3>Wargame Map</h3>
        <p>Build engagement scenarios for {corporation.name} on a tactical canvas designed for fleet composition, movement, range, support, damage application and battle phases.</p>
      </div>
      <span className="fleet-wargame-state">NO SCENARIO LOADED</span>
    </div>

    <div className="fleet-wargame-layout">
      <aside className="fleet-wargame-panel">
        <p className="eyebrow">SCENARIO INPUTS</p>
        <article><strong>Battlefield</strong><span>Celestials, grids, warp points, ranges and approach vectors.</span></article>
        <article><strong>Friendly forces</strong><span>Doctrine fits, squads, anchors, logistics and support wings.</span></article>
        <article><strong>Opposing forces</strong><span>Enemy compositions, known fits, formation and reinforcement assumptions.</span></article>
      </aside>

      <div className="fleet-wargame-canvas" aria-label="Wargame tactical scenario canvas">
        <div className="fleet-wargame-ring ring-one" />
        <div className="fleet-wargame-ring ring-two" />
        <div className="fleet-wargame-crosshair horizontal" />
        <div className="fleet-wargame-crosshair vertical" />
        <div className="fleet-wargame-canvas-copy">
          <span>TACTICAL SIMULATION SPACE</span>
          <strong>Create a scenario to populate the map</strong>
          <small>The map shell is isolated from doctrines so the combat model can grow without making Fleet Command heavy.</small>
        </div>
      </div>

      <aside className="fleet-wargame-panel">
        <p className="eyebrow">SIMULATION LAYERS</p>
        <article><strong>Application</strong><span>Range, tracking, missiles, velocity, signatures and projected damage.</span></article>
        <article><strong>Fleet systems</strong><span>EWAR, capacitor pressure, command bursts, logistics and remote assistance.</span></article>
        <article><strong>Battle timeline</strong><span>Orders, phases, target calls, attrition, reinforcements and replay.</span></article>
      </aside>
    </div>
  </div>;
}

export function FleetCommand() {
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [tab, setTab] = useState<FleetCommandTab>("doctrines");
  const [jumpLocation, setJumpLocation] = useState<NavigationCharacterLocation | null>(null);
  const [jumpLocationBusy, setJumpLocationBusy] = useState(false);
  const [jumpLocationError, setJumpLocationError] = useState("");
  const [followCharacter, setFollowCharacter] = useState(false);
  const [jumpSelectedSystem, setJumpSelectedSystem] = useState<NavigationSystem | null>(null);

  async function reloadSnapshots() {
    try {
      const values = await (window.sage as any).listSnapshots();
      setSnapshots(Array.isArray(values) ? values : []);
    } catch {
      setSnapshots([]);
    }
  }

  useEffect(() => { void reloadSnapshots(); }, []);

  const corporations = useMemo<FleetCorporation[]>(() => snapshots.flatMap((snapshot) => {
    const corporationId = Number(snapshot?.character?.corporation_id ?? 0);
    const characterId = String(snapshot?.characterId ?? "");
    if (!corporationId || !characterId) return [];
    const data = snapshot?.extended?.corporation ?? {};
    const publicData = data.publicData ?? snapshot?.character?.corporation_data ?? {};
    return [{
      characterId,
      characterName: String(snapshot?.character?.name ?? `Character ${characterId}`),
      corporationId,
      name: String(publicData?.name ?? snapshot?.character?.corporation_name ?? `Corporation ${corporationId}`),
      snapshot,
      data,
    }];
  }).sort((a, b) => a.characterName.localeCompare(b.characterName)), [snapshots]);

  useEffect(() => {
    if (!corporations.length) { setSelectedCharacterId(null); return; }
    let preferred: FleetCorporation | undefined;
    try {
      const pending = JSON.parse(sessionStorage.getItem(PENDING_DOCTRINE_FIT_KEY) ?? "null");
      const corporationId = Number(pending?.corporationId ?? 0);
      if (corporationId) preferred = corporations.find((corp) => corp.corporationId === corporationId);
    } catch { /* Legacy malformed pending data is ignored. */ }
    if (preferred) setSelectedCharacterId(preferred.characterId);
    else if (!selectedCharacterId || !corporations.some((corp) => corp.characterId === selectedCharacterId)) setSelectedCharacterId(corporations[0].characterId);
  }, [corporations, selectedCharacterId]);

  const corporation = corporations.find((item) => item.characterId === selectedCharacterId) ?? corporations[0] ?? null;

  const refreshJumpLocation = useCallback(async (forceLive = true) => {
    if (!corporation?.characterId) {
      setJumpLocation(null);
      setJumpLocationError("Choose a connected corporation character first.");
      return null;
    }
    setJumpLocationBusy(true);
    try {
      const value = await window.sage.getNavigationCharacterLocation(corporation.characterId, forceLive);
      setJumpLocation(value);
      setJumpLocationError("");
      return value;
    } catch (error) {
      setJumpLocationError(error instanceof Error ? error.message : "Live character location is unavailable.");
      return null;
    } finally {
      setJumpLocationBusy(false);
    }
  }, [corporation?.characterId]);

  useEffect(() => {
    setJumpLocation(null);
    setJumpSelectedSystem(null);
    setJumpLocationError("");
    if (tab === "jump-map" && corporation?.characterId && !followCharacter) void refreshJumpLocation(true);
  }, [corporation?.characterId, tab, followCharacter, refreshJumpLocation]);

  useEffect(() => {
    if (tab !== "jump-map" || !followCharacter || !corporation?.characterId) return;
    void refreshJumpLocation(true);
    const timer = window.setInterval(() => void refreshJumpLocation(true), 15_000);
    return () => window.clearInterval(timer);
  }, [tab, followCharacter, corporation?.characterId, refreshJumpLocation]);

  return <section className="corp-command fleet-command">
    <div className="corp-data-head">
      <div>
        <p className="eyebrow">FLEET COMMAND</p>
        <h2>{corporation?.name ?? "Fleet Command"}</h2>
        <p>Doctrine control, live jump intelligence and tactical planning are corporation-scoped here. Wargame Map remains the dedicated deep-combat simulation workspace.</p>
      </div>
      <div className="corp-data-actions">
        {corporations.length > 1 && <select value={selectedCharacterId ?? ""} onChange={(event) => setSelectedCharacterId(event.target.value)}>
          {corporations.map((corp) => <option key={corp.characterId} value={corp.characterId}>{corp.characterName} / {corp.name}</option>)}
        </select>}
        <button onClick={() => void reloadSnapshots()}>Reload local data</button>
      </div>
    </div>

    <div className="corp-subtabs fleet-command-subtabs" role="tablist" aria-label="Fleet Command sections">
      <button type="button" className={tab === "doctrines" ? "active" : ""} onClick={() => setTab("doctrines")}>Doctrine Library</button>
      <button type="button" className={tab === "jump-map" ? "active" : ""} onClick={() => setTab("jump-map")}>On The Fly Jump Map</button>
      <button type="button" className={tab === "wargame" ? "active" : ""} onClick={() => setTab("wargame")}>Wargame Map</button>
    </div>

    {corporation
      ? tab === "doctrines"
        ? <CorporationDoctrines corporation={corporation} snapshots={snapshots} />
        : tab === "jump-map"
          ? <div className="fleet-jump-map-view">
              <div className="fleet-jump-map-location">
                <div><span>CURRENT CHARACTER</span><strong>{corporation.characterName}</strong><small>{jumpLocation ? `${jumpLocation.systemName} / ${jumpLocation.source === "live-esi" ? "LIVE ESI" : "SYNCED SNAPSHOT"}` : "Location not loaded"}</small></div>
                <button type="button" disabled={jumpLocationBusy} onClick={() => void refreshJumpLocation(true)}>{jumpLocationBusy ? "Checking..." : "Refresh location"}</button>
              </div>
              {jumpLocationError && <div className="on-the-fly-warning">{jumpLocationError}</div>}
              <OnTheFlyJumpMap
                route={null}
                routeIntelligence={null}
                characterLocation={jumpLocation}
                followCharacter={followCharacter}
                setFollowCharacter={setFollowCharacter}
                hasSelectedCharacter={Boolean(corporation.characterId)}
                selectedSystem={jumpSelectedSystem}
                onSelectSystem={setJumpSelectedSystem}
                specialConnections={[]}
              />
            </div>
          : <WargameMap corporation={corporation} />
      : <div className="corp-data-view"><p className="eyebrow">FLEET COMMAND</p><h3>Connect a corporation character</h3><p>Sync a connected EVE character to load corporation doctrine and tactical data.</p></div>}
  </section>;
}
