import { useEffect, useMemo, useRef, useState } from "react";
import type {
  NavigationCharacterLocation,
  NavigationMapData,
  NavigationRouteIntelligence,
  NavigationRoutePlan,
  NavigationSystem,
} from "./types";

type OverlayKey = "security" | "kills" | "danger" | "activity" | "sovereignty" | "faction" | "incursion" | "infrastructure" | "custom";
type MapScope = "universe" | "region" | "local";

type Props = {
  route: NavigationRoutePlan | null;
  intelligence: NavigationRouteIntelligence | null;
  characterLocation: NavigationCharacterLocation | null;
  selectedSystemId: number | null;
  selectedLegIndex: number | null;
  onSelectSystem(system: NavigationSystem): void;
  onSelectLeg(index: number): void;
  onContextSystem(system: NavigationSystem, clientX: number, clientY: number): void;
};

const overlayLabels: Array<{ id: OverlayKey; label: string }> = [
  { id: "security", label: "Security" },
  { id: "kills", label: "Recent kills" },
  { id: "danger", label: "Gate danger" },
  { id: "activity", label: "Jumps / activity" },
  { id: "sovereignty", label: "Sovereignty" },
  { id: "faction", label: "Faction" },
  { id: "incursion", label: "Incursions" },
  { id: "infrastructure", label: "Stations / structures" },
  { id: "custom", label: "Wormholes / custom" },
];

function worldPosition(system: NavigationSystem) {
  return { x: system.position2D?.x ?? system.position.x, y: system.position2D?.y ?? system.position.z };
}

function securityColor(value: number) {
  const displayed = Math.max(-1, Math.min(1, Math.round(value * 10) / 10));
  if (displayed >= 0.5) return "#65d9c9";
  if (displayed > 0) return "#e0b95e";
  return "#d8757d";
}

function dangerColor(state?: string) {
  if (state === "active-camp") return "#ff5f6d";
  if (state === "camp-likely") return "#f28b57";
  if (state === "dangerous") return "#e0b95e";
  if (state === "activity") return "#73a9d8";
  return "#416069";
}

function routeEdgeColor(type?: string) {
  if (type === "ansiblex") return "#6fa9e8";
  if (type === "wormhole" || type === "thera") return "#b989ea";
  if (type === "turnur") return "#e5b85f";
  if (type === "zarzakh") return "#e87b6f";
  if (type === "jump-drive") return "#f0c86a";
  if (type === "manual") return "#a78fe8";
  return "#65d9c9";
}

function routeEdgeDash(type?: string) {
  return type && type !== "gate" ? [7, 5] : [];
}

export function NavigationUniverseMap(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const pointsRef = useRef<Array<{ system: NavigationSystem; x: number; y: number }>>([]);
  const transformRef = useRef({ scale: 1, offsetX: 0, offsetY: 0 });
  const draggingRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [scope, setScope] = useState<MapScope>("universe");
  const [regionId, setRegionId] = useState<number | null>(props.route?.origin?.regionId ?? null);
  const [mapData, setMapData] = useState<NavigationMapData | null>(null);
  const [mapError, setMapError] = useState("");
  const [mapBusy, setMapBusy] = useState(false);
  const [viewVersion, setViewVersion] = useState(0);
  const [overlays, setOverlays] = useState<OverlayKey[]>(["security", "kills", "danger", "activity", "incursion", "infrastructure", "custom"]);

  const intelBySystem = useMemo(() => new Map((props.intelligence?.systems ?? []).map((row) => [Number(row.system?.system?.systemId), row])), [props.intelligence]);
  const routeSystemIds = useMemo(() => new Set(props.route?.systems.map((system) => system.systemId) ?? []), [props.route]);
  const waypointIds = useMemo(() => new Set(props.route?.waypoints.map((system) => system.systemId) ?? []), [props.route]);

  useEffect(() => {
    let cancelled = false;
    setMapBusy(true);
    setMapError("");
    const apiScope = scope === "region" ? "region" : "universe";
    const fallbackRegion = regionId ?? props.route?.origin?.regionId ?? null;
    window.sage.getNavigationMapData({ scope: apiScope, regionId: apiScope === "region" ? fallbackRegion : null })
      .then((data) => { if (!cancelled) { setMapData(data); setRegionId((current) => current ?? data.regionId ?? props.route?.origin?.regionId ?? null); resetView(); } })
      .catch((error) => { if (!cancelled) setMapError(error instanceof Error ? error.message : "Map data unavailable."); })
      .finally(() => { if (!cancelled) setMapBusy(false); });
    return () => { cancelled = true; };
  }, [scope === "region" ? regionId : scope]);

  const visibleData = useMemo(() => {
    if (!mapData || scope !== "local" || !props.route?.found) return mapData;
    const systems = props.route.systems;
    const ids = new Set(systems.map((system) => system.systemId));
    const edges = mapData.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
    return { ...mapData, systems, edges };
  }, [mapData, scope, props.route]);

  function resetView() {
    transformRef.current = { scale: 1, offsetX: 0, offsetY: 0 };
    setViewVersion((value) => value + 1);
  }

  function toggleOverlay(id: OverlayKey) {
    setOverlays((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !visibleData) return;
    const draw = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(320, rect.width);
      const height = Math.max(420, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#051117";
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = "rgba(102,154,164,.07)";
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
      for (let y = 0; y < height; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }

      const systems = visibleData.systems;
      if (!systems.length) { pointsRef.current = []; return; }
      const positions = systems.map((system) => ({ system, ...worldPosition(system) }));
      let minX = Math.min(...positions.map((p) => p.x)); let maxX = Math.max(...positions.map((p) => p.x));
      let minY = Math.min(...positions.map((p) => p.y)); let maxY = Math.max(...positions.map((p) => p.y));
      if (minX === maxX) { minX -= 1; maxX += 1; }
      if (minY === maxY) { minY -= 1; maxY += 1; }
      const padding = 34;
      const spanX = maxX - minX; const spanY = maxY - minY;
      const baseScale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
      const baseX = (width - spanX * baseScale) / 2;
      const baseY = (height - spanY * baseScale) / 2;
      const t = transformRef.current;
      const project = (system: NavigationSystem) => {
        const p = worldPosition(system);
        const basePx = baseX + (p.x - minX) * baseScale;
        const basePy = baseY + (p.y - minY) * baseScale;
        return { x: width / 2 + (basePx - width / 2) * t.scale + t.offsetX, y: height / 2 + (basePy - height / 2) * t.scale + t.offsetY };
      };
      const pointById = new Map<number, { x: number; y: number }>();
      const points = positions.map(({ system }) => { const p = project(system); pointById.set(system.systemId, p); return { system, ...p }; });
      pointsRef.current = points;

      ctx.lineWidth = Math.max(.5, Math.min(1.2, t.scale * .35));
      ctx.strokeStyle = "rgba(67,102,111,.35)";
      for (const edge of visibleData.edges) {
        const a = pointById.get(edge.from); const b = pointById.get(edge.to); if (!a || !b) continue;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }

      if (overlays.includes("custom") && props.route) {
        ctx.lineWidth = 1.6;
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = "rgba(121,187,179,.65)";
        for (const link of props.route.customConnections.filter((row) => row.enabled)) {
          const a = pointById.get(link.fromSystemId); const b = pointById.get(link.toSystemId); if (!a || !b) continue;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      if (props.route?.found) {
        ctx.lineWidth = 3;
        for (let index = 0; index < props.route.legs.length; index += 1) {
          const a = pointById.get(props.route.systems[index]?.systemId); const b = pointById.get(props.route.systems[index + 1]?.systemId); if (!a || !b) continue;
          const locked = props.route.segments.some((segment) => segment.locked && segment.systems.some((system, idx) => idx < segment.systems.length - 1 && system.systemId === props.route!.systems[index]?.systemId && segment.systems[idx + 1]?.systemId === props.route!.systems[index + 1]?.systemId));
          const leg = props.route.legs[index];
          ctx.strokeStyle = index === props.selectedLegIndex ? "#ffffff" : locked ? "#8be3af" : routeEdgeColor(leg?.type);
          ctx.setLineDash(locked ? [8, 4] : routeEdgeDash(leg?.type));
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      for (const point of points) {
        const { system, x, y } = point;
        if (x < -30 || y < -30 || x > width + 30 || y > height + 30) continue;
        const intel = intelBySystem.get(system.systemId);
        const onRoute = routeSystemIds.has(system.systemId);
        let radius = onRoute ? 4.2 : Math.max(1.5, Math.min(3.2, t.scale * .8));
        if (overlays.includes("kills") && intel) radius += Math.min(5, Math.sqrt(Number(intel.killWindows["1h"].kills ?? 0)) * 1.5);
        if (overlays.includes("activity") && intel) radius += Math.min(3, Math.log10(Math.max(1, intel.activity.jumps)) * .7);
        let fill = overlays.includes("security") ? securityColor(system.securityStatus) : "#67858c";
        if (overlays.includes("danger") && intel?.routeGate) fill = dangerColor(intel.routeGate.danger.state);
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
        if (waypointIds.has(system.systemId)) { ctx.beginPath(); ctx.arc(x, y, radius + 4, 0, Math.PI * 2); ctx.strokeStyle = "#d7f7f2"; ctx.lineWidth = 1.3; ctx.stroke(); }
        if (overlays.includes("incursion") && intel?.hazards.incursion) { ctx.beginPath(); ctx.arc(x, y, radius + 7, 0, Math.PI * 2); ctx.strokeStyle = "#bf70e8"; ctx.lineWidth = 2; ctx.stroke(); }
        if (overlays.includes("infrastructure") && intel && (intel.infrastructure.npcStations || intel.infrastructure.knownStructures)) { ctx.beginPath(); ctx.rect(x - radius - 3, y - radius - 3, (radius + 3) * 2, (radius + 3) * 2); ctx.strokeStyle = "#a6c9cd"; ctx.lineWidth = 1; ctx.stroke(); }
        if (overlays.includes("sovereignty") && intel?.ownership.allianceId) { ctx.beginPath(); ctx.arc(x, y, radius + 10, 0, Math.PI * 2); ctx.strokeStyle = "rgba(128,165,225,.75)"; ctx.lineWidth = 1; ctx.stroke(); }
        if (overlays.includes("faction") && intel?.ownership.factionId) { ctx.beginPath(); ctx.arc(x, y, radius + 12, 0, Math.PI * 2); ctx.strokeStyle = "rgba(219,192,117,.8)"; ctx.lineWidth = 1; ctx.stroke(); }
        if (system.systemId === props.characterLocation?.systemId) { ctx.beginPath(); ctx.arc(x, y, radius + 6, 0, Math.PI * 2); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2.4; ctx.stroke(); }
        if (system.systemId === props.selectedSystemId) { ctx.beginPath(); ctx.arc(x, y, radius + 9, 0, Math.PI * 2); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke(); }
        if (onRoute || waypointIds.has(system.systemId) || system.systemId === props.characterLocation?.systemId || system.systemId === props.selectedSystemId || t.scale >= 4.5) {
          ctx.font = `${onRoute ? 600 : 500} 10px Inter, sans-serif`;
          ctx.fillStyle = "#d8e9eb";
          ctx.fillText(system.name, x + radius + 5, y - radius - 2);
        }
      }
    };
    draw();
    const observer = new ResizeObserver(draw); observer.observe(wrap);
    return () => observer.disconnect();
  }, [visibleData, props.route, props.intelligence, props.characterLocation?.systemId, props.selectedSystemId, props.selectedLegIndex, overlays, viewVersion]);

  function hitSystem(clientX: number, clientY: number) {
    const canvas = canvasRef.current; if (!canvas) return null;
    const rect = canvas.getBoundingClientRect(); const x = clientX - rect.left; const y = clientY - rect.top;
    let best: { system: NavigationSystem; distance: number } | null = null;
    for (const point of pointsRef.current) {
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance <= 12 && (!best || distance < best.distance)) best = { system: point.system, distance };
    }
    return best?.system ?? null;
  }

  return <div className="navigation-universe-map-shell">
    <div className="navigation-map-toolbar">
      <div className="navigation-map-scope-buttons">
        <button type="button" className={scope === "universe" ? "active" : ""} onClick={() => setScope("universe")}>Universe</button>
        <button type="button" className={scope === "region" ? "active" : ""} onClick={() => setScope("region")}>Region</button>
        <button type="button" disabled={!props.route?.found} className={scope === "local" ? "active" : ""} onClick={() => setScope("local")}>Route local</button>
      </div>
      {scope === "region" && <select value={regionId ?? ""} onChange={(event) => setRegionId(Number(event.target.value) || null)}><option value="">Choose region</option>{mapData?.regions.map((region) => <option key={region.regionId} value={region.regionId}>{region.name}</option>)}</select>}
      <button type="button" onClick={resetView}>Reset view</button>
      <span>{mapBusy ? "Loading map…" : visibleData ? `${visibleData.systems.length.toLocaleString()} systems · ${visibleData.edges.length.toLocaleString()} connections` : "Map unavailable"}</span>
    </div>
    <div className="navigation-map-overlay-bar">
      {overlayLabels.map((overlay) => <button type="button" key={overlay.id} className={overlays.includes(overlay.id) ? "active" : ""} onClick={() => toggleOverlay(overlay.id)}>{overlay.label}</button>)}
      <button type="button" disabled title="No trusted provider currently wired">Storms / timers</button>
    </div>
    {mapError && <div className="navigation-route-error"><strong>Map unavailable</strong><span>{mapError}</span></div>}
    <div className="navigation-universe-map-wrap" ref={wrapRef}>
      <canvas ref={canvasRef}
        onWheel={(event) => {
          event.preventDefault();
          const canvas = canvasRef.current; if (!canvas) return;
          const rect = canvas.getBoundingClientRect(); const x = event.clientX - rect.left; const y = event.clientY - rect.top;
          const current = transformRef.current; const nextScale = Math.max(.6, Math.min(20, current.scale * (event.deltaY < 0 ? 1.18 : .84)));
          const ratio = nextScale / current.scale;
          transformRef.current = { scale: nextScale, offsetX: x - rect.width / 2 - (x - rect.width / 2 - current.offsetX) * ratio, offsetY: y - rect.height / 2 - (y - rect.height / 2 - current.offsetY) * ratio };
          setViewVersion((value) => value + 1);
        }}
        onPointerDown={(event) => { const t = transformRef.current; draggingRef.current = { x: event.clientX, y: event.clientY, offsetX: t.offsetX, offsetY: t.offsetY }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={(event) => { const drag = draggingRef.current; if (!drag) return; transformRef.current = { ...transformRef.current, offsetX: drag.offsetX + event.clientX - drag.x, offsetY: drag.offsetY + event.clientY - drag.y }; setViewVersion((value) => value + 1); }}
        onPointerUp={(event) => { const drag = draggingRef.current; draggingRef.current = null; event.currentTarget.releasePointerCapture(event.pointerId); if (drag && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) { const system = hitSystem(event.clientX, event.clientY); if (system) props.onSelectSystem(system); } }}
        onContextMenu={(event) => { event.preventDefault(); const system = hitSystem(event.clientX, event.clientY); if (system) props.onContextSystem(system, event.clientX, event.clientY); }}
      />
      <div className="navigation-map-legend"><span><i className="route" />Route</span><span><i className="locked" />Locked</span><span><i className="current" />Current character</span><span><i className="special" />Special connection</span><small>Wheel to zoom · drag to pan · click to inspect · right-click for route actions</small></div>
    </div>
  </div>;
}
