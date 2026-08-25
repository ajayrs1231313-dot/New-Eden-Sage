import { useEffect, useMemo, useRef, useState } from "react";
import type {
  NavigationCharacterLocation,
  NavigationCustomConnection,
  NavigationLiveMapMetrics,
  NavigationMapData,
  NavigationRouteIntelligence,
  NavigationRoutePlan,
  NavigationSystem,
} from "./types";

type LayerKey =
  | "security"
  | "ship-kills"
  | "pod-kills"
  | "npc-kills"
  | "jumps"
  | "incursions"
  | "danger"
  | "sovereignty"
  | "faction"
  | "infrastructure"
  | "route"
  | "current"
  | "special"
  | "thera"
  | "turnur"
  | "wormholes";

type SecurityBand = "high" | "low" | "null";
type MapScope = "local" | "universe" | "region";

type FilterSet = {
  id: string;
  name: string;
  layers: LayerKey[];
  securityBands: SecurityBand[];
  minShipKills: number;
  minPodKills: number;
  minNpcKills: number;
  minJumps: number;
  focusOnly: boolean;
  regionId: number | null;
  builtIn?: boolean;
};

type Props = {
  route: NavigationRoutePlan | null;
  routeIntelligence: NavigationRouteIntelligence | null;
  characterLocation: NavigationCharacterLocation | null;
  followCharacter: boolean;
  setFollowCharacter(value: boolean): void;
  hasSelectedCharacter: boolean;
  selectedSystem: NavigationSystem | null;
  onSelectSystem(system: NavigationSystem): void;
  specialConnections: NavigationCustomConnection[];
};

const STORAGE_KEY = "new-eden-sage-on-the-fly-jump-map-filter-sets-v1";
const ACTIVE_SET_KEY = "new-eden-sage-on-the-fly-jump-map-active-set-v1";

const DEFAULT_SETS: FilterSet[] = [
  {
    id: "pvp",
    name: "PvP",
    layers: ["security", "ship-kills", "pod-kills", "jumps", "danger", "incursions", "route", "current", "special"],
    securityBands: ["low", "null"],
    minShipKills: 1,
    minPodKills: 0,
    minNpcKills: 0,
    minJumps: 0,
    focusOnly: false,
    regionId: null,
    builtIn: true,
  },
  {
    id: "fc-live",
    name: "FC Live",
    layers: ["ship-kills", "pod-kills", "jumps", "danger", "incursions", "route", "current", "special", "thera", "turnur", "wormholes"],
    securityBands: ["high", "low", "null"],
    minShipKills: 0,
    minPodKills: 0,
    minNpcKills: 0,
    minJumps: 0,
    focusOnly: false,
    regionId: null,
    builtIn: true,
  },
  {
    id: "hauling",
    name: "Hauling",
    layers: ["security", "ship-kills", "pod-kills", "jumps", "incursions", "route", "current"],
    securityBands: ["high", "low"],
    minShipKills: 0,
    minPodKills: 0,
    minNpcKills: 0,
    minJumps: 0,
    focusOnly: false,
    regionId: null,
    builtIn: true,
  },
  {
    id: "activity",
    name: "Activity",
    layers: ["jumps", "ship-kills", "npc-kills", "incursions"],
    securityBands: ["high", "low", "null"],
    minShipKills: 0,
    minPodKills: 0,
    minNpcKills: 0,
    minJumps: 1,
    focusOnly: false,
    regionId: null,
    builtIn: true,
  },
];

const LAYERS: Array<{ id: LayerKey; label: string; group: string; detail: string }> = [
  { id: "security", label: "Security Status", group: "Geography", detail: "CCP security status" },
  { id: "jumps", label: "Ship Jumps", group: "Activity", detail: "ESI system traffic" },
  { id: "ship-kills", label: "Ship Kills", group: "Activity", detail: "ESI ship kills" },
  { id: "pod-kills", label: "Pod Kills", group: "Activity", detail: "ESI capsule kills" },
  { id: "npc-kills", label: "NPC Kills", group: "Activity", detail: "ESI NPC kills" },
  { id: "incursions", label: "Incursions", group: "Events", detail: "Live ESI incursions" },
  { id: "danger", label: "Gate Danger", group: "Intel", detail: "Sage retained route/gate intel" },
  { id: "sovereignty", label: "Sovereignty", group: "Intel", detail: "Visible where Sage has ownership intel" },
  { id: "faction", label: "Faction", group: "Intel", detail: "Visible where Sage has faction intel" },
  { id: "infrastructure", label: "Stations / Structures", group: "Intel", detail: "Known Sage infrastructure" },
  { id: "route", label: "Current Route", group: "Navigation", detail: "Calculated Navigation route" },
  { id: "current", label: "Current Character", group: "Navigation", detail: "Selected character location" },
  { id: "special", label: "All Special Links", group: "Navigation", detail: "Enabled Sage non-gate links" },
  { id: "thera", label: "Thera Links", group: "Navigation", detail: "EVE-Scout public Thera" },
  { id: "turnur", label: "Turnur Links", group: "Navigation", detail: "EVE-Scout public Turnur" },
  { id: "wormholes", label: "Wormholes", group: "Navigation", detail: "Wormhole Command / manual WH" },
];

function loadSets(): FilterSet[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_SETS;
    const custom = parsed.filter((row: FilterSet) => row?.id && row?.name && !DEFAULT_SETS.some((builtin) => builtin.id === row.id));
    return [...DEFAULT_SETS, ...custom];
  } catch {
    return DEFAULT_SETS;
  }
}

function securityBand(value: number): SecurityBand {
  const rounded = Math.max(-1, Math.min(1, Math.round(value * 10) / 10));
  if (rounded >= 0.5) return "high";
  if (rounded > 0) return "low";
  return "null";
}

function securityColor(value: number) {
  const rounded = Math.max(-1, Math.min(1, Math.round(value * 10) / 10));
  if (rounded >= 0.8) return "#62d7ff";
  if (rounded >= 0.5) return "#5ccf9d";
  if (rounded > 0) return "#e6bb55";
  return "#d96876";
}

function heatRadius(value: number, divisor: number, max = 14) {
  if (value <= 0) return 0;
  return Math.min(max, Math.max(2.5, Math.log2(value + 1) * divisor));
}

function worldPosition(system: NavigationSystem) {
  return { x: system.position2D?.x ?? system.position.x, y: system.position2D?.y ?? system.position.z };
}

function connectionColor(type: string) {
  if (type === "thera") return "#b989ea";
  if (type === "turnur") return "#d6b35d";
  if (type === "wormhole") return "#9f7ee0";
  if (type === "ansiblex") return "#6da4d8";
  if (type === "zarzakh") return "#dd756b";
  return "#8e75c4";
}

export function OnTheFlyJumpMap(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const pointsRef = useRef<Array<{ system: NavigationSystem; x: number; y: number; radius: number }>>([]);
  const transformRef = useRef({ scale: 1, offsetX: 0, offsetY: 0 });
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const focusRequestRef = useRef<number | null>(null);
  const [mapData, setMapData] = useState<NavigationMapData | null>(null);
  const [metrics, setMetrics] = useState<NavigationLiveMapMetrics | null>(null);
  const [scope, setScope] = useState<MapScope>("local");
  const [localJumps, setLocalJumps] = useState(3);
  const [localAnchorId, setLocalAnchorId] = useState<number | null>(null);
  const [sets, setSets] = useState<FilterSet[]>(loadSets);
  const [activeSetId, setActiveSetId] = useState(() => localStorage.getItem(ACTIVE_SET_KEY) || "pvp");
  const [draft, setDraft] = useState<FilterSet>(() => loadSets().find((row) => row.id === (localStorage.getItem(ACTIVE_SET_KEY) || "pvp")) ?? DEFAULT_SETS[0]);
  const [newSetName, setNewSetName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [opsView, setOpsView] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [viewVersion, setViewVersion] = useState(0);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<NavigationSystem[]>([]);
  const [hoverSystem, setHoverSystem] = useState<NavigationSystem | null>(null);

  const killById = useMemo(() => new Map((metrics?.kills ?? []).map((row) => [row.systemId, row])), [metrics]);
  const jumpsById = useMemo(() => new Map((metrics?.jumps ?? []).map((row) => [row.systemId, row.shipJumps])), [metrics]);
  const incursionIds = useMemo(() => new Set(metrics?.incursionSystemIds ?? []), [metrics]);
  const intelById = useMemo(() => new Map((props.routeIntelligence?.systems ?? []).map((row) => [Number(row.system?.system?.systemId), row])), [props.routeIntelligence]);
  const routeIds = useMemo(() => new Set(props.route?.systems.map((row) => row.systemId) ?? []), [props.route]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    Promise.all([
      window.sage.getNavigationMapData({ scope: scope === "region" ? "region" : "universe", regionId: scope === "region" ? draft.regionId : null }),
      window.sage.getNavigationLiveMapMetrics(false),
    ]).then(([map, live]) => {
      if (cancelled) return;
      setMapData(map);
      setMetrics(live);
      setError("");
      resetView();
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "On The Fly Jump Map data is unavailable.");
    }).finally(() => {
      if (!cancelled) setBusy(false);
    });
    return () => { cancelled = true; };
  }, [scope, scope === "region" ? draft.regionId : null]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => void refreshLive(false), 300_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh]);

  useEffect(() => {
    const liveSystemId = props.characterLocation?.systemId ?? null;
    if (!liveSystemId) return;
    if (props.followCharacter || localAnchorId == null) {
      setLocalAnchorId(liveSystemId);
      if (props.followCharacter) setScope("local");
    }
  }, [props.followCharacter, props.characterLocation?.systemId, localAnchorId]);

  useEffect(() => {
    if (search.trim().length < 2) { setSearchResults([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void window.sage.searchNavigationSystems(search.trim(), 10).then((rows) => { if (!cancelled) setSearchResults(rows); }).catch(() => { if (!cancelled) setSearchResults([]); });
    }, 100);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [search]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sets.filter((row) => !row.builtIn)));
      localStorage.setItem(ACTIVE_SET_KEY, activeSetId);
    } catch { /* renderer persistence unavailable */ }
  }, [sets, activeSetId]);

  async function refreshLive(force = true) {
    setBusy(true);
    try {
      const live = await window.sage.getNavigationLiveMapMetrics(force);
      setMetrics(live);
      setError(live.errors.length ? live.errors.join(" · ") : "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Live map refresh failed.");
    } finally {
      setBusy(false);
    }
  }

  function resetView() {
    transformRef.current = { scale: 1, offsetX: 0, offsetY: 0 };
    setViewVersion((value) => value + 1);
  }

  function chooseSet(id: string) {
    const value = sets.find((row) => row.id === id);
    if (!value) return;
    setActiveSetId(id);
    setDraft({ ...value, layers: [...value.layers], securityBands: [...value.securityBands] });
    if (value.regionId && scope === "region") setScope("region");
  }

  function updateDraft(patch: Partial<FilterSet>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function toggleLayer(id: LayerKey) {
    updateDraft({ layers: draft.layers.includes(id) ? draft.layers.filter((value) => value !== id) : [...draft.layers, id] });
  }

  function toggleBand(id: SecurityBand) {
    const next = draft.securityBands.includes(id) ? draft.securityBands.filter((value) => value !== id) : [...draft.securityBands, id];
    updateDraft({ securityBands: next.length ? next : [id] });
  }

  function saveCurrentSet() {
    const name = newSetName.trim() || (draft.builtIn ? `${draft.name} Custom` : draft.name);
    const id = draft.builtIn || newSetName.trim()
      ? `set-${Date.now()}-${Math.random().toString(16).slice(2)}`
      : draft.id;
    const saved: FilterSet = { ...draft, id, name, builtIn: false, layers: [...draft.layers], securityBands: [...draft.securityBands] };
    setSets((current) => [saved, ...current.filter((row) => row.id !== id)]);
    setActiveSetId(id);
    setDraft(saved);
    setNewSetName("");
  }

  function updateSavedSet() {
    if (draft.builtIn) return saveCurrentSet();
    setSets((current) => current.map((row) => row.id === draft.id ? { ...draft, builtIn: false } : row));
  }

  function deleteSet(id: string) {
    const value = sets.find((row) => row.id === id);
    if (!value || value.builtIn) return;
    const next = sets.filter((row) => row.id !== id);
    setSets(next);
    chooseSet("pvp");
  }

  const localCenterId = localAnchorId ?? props.characterLocation?.systemId ?? props.selectedSystem?.systemId ?? props.route?.systems[0]?.systemId ?? null;

  const localTopology = useMemo(() => {
    const ids = new Set<number>();
    const parent = new Map<number, number | null>();
    const depth = new Map<number, number>();
    if (!mapData || scope !== "local" || !localCenterId) return { ids, parent, depth };
    const adjacency = new Map<number, number[]>();
    const connect = (from: number, to: number) => {
      const list = adjacency.get(from) ?? [];
      if (!list.includes(to)) list.push(to);
      adjacency.set(from, list);
    };
    for (const edge of mapData.edges) { connect(edge.from, edge.to); connect(edge.to, edge.from); }
    ids.add(localCenterId);
    parent.set(localCenterId, null);
    depth.set(localCenterId, 0);
    const queue = [localCenterId];
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      const currentDepth = depth.get(current) ?? 0;
      if (currentDepth >= localJumps) continue;
      const neighbours = [...(adjacency.get(current) ?? [])].sort((a, b) => a - b);
      for (const next of neighbours) {
        if (ids.has(next)) continue;
        ids.add(next);
        parent.set(next, current);
        depth.set(next, currentDepth + 1);
        queue.push(next);
      }
    }
    return { ids, parent, depth };
  }, [mapData, scope, localCenterId, localJumps]);

  const localBranchPositions = useMemo(() => {
    const positions = new Map<number, { x: number; y: number }>();
    if (scope !== "local" || !localCenterId || !localTopology.ids.size) return positions;
    const children = new Map<number, number[]>();
    for (const id of localTopology.ids) {
      const p = localTopology.parent.get(id);
      if (p == null) continue;
      const list = children.get(p) ?? [];
      list.push(id);
      children.set(p, list);
    }
    for (const list of children.values()) list.sort((a, b) => a - b);
    const weightMemo = new Map<number, number>();
    const weight = (id: number): number => {
      const cached = weightMemo.get(id);
      if (cached != null) return cached;
      const kids = children.get(id) ?? [];
      const value = kids.length ? kids.reduce((sum, child) => sum + weight(child), 0) : 1;
      weightMemo.set(id, value);
      return value;
    };
    positions.set(localCenterId, { x: 0, y: 0 });
    const placeChildren = (id: number, start: number, end: number) => {
      const kids = children.get(id) ?? [];
      if (!kids.length) return;
      const total = kids.reduce((sum, child) => sum + weight(child), 0);
      let cursor = start;
      for (const child of kids) {
        const share = (end - start) * (weight(child) / total);
        const childStart = cursor;
        const childEnd = cursor + share;
        const angle = (childStart + childEnd) / 2;
        const d = localTopology.depth.get(child) ?? 1;
        const radius = d * 145;
        positions.set(child, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
        placeChildren(child, childStart, childEnd);
        cursor = childEnd;
      }
    };
    placeChildren(localCenterId, -Math.PI, Math.PI);
    return positions;
  }, [scope, localCenterId, localTopology]);
  const visibleSystems = useMemo(() => {
    if (!mapData) return [];
    return mapData.systems.filter((system) => {
      if (scope === "local" && !localTopology.ids.has(system.systemId)) return false;
      const bandMatch = draft.securityBands.includes(securityBand(system.securityStatus));
      if (scope !== "local" && !bandMatch) return false;
      const kills = killById.get(system.systemId);
      const jumps = jumpsById.get(system.systemId) ?? 0;
      const thresholdMatch =
        Number(kills?.shipKills ?? 0) >= draft.minShipKills &&
        Number(kills?.podKills ?? 0) >= draft.minPodKills &&
        Number(kills?.npcKills ?? 0) >= draft.minNpcKills &&
        jumps >= draft.minJumps;
      if (draft.focusOnly) return bandMatch && thresholdMatch;
      return true;
    });
  }, [mapData, scope, localTopology, draft.securityBands, draft.focusOnly, draft.minShipKills, draft.minPodKills, draft.minNpcKills, draft.minJumps, killById, jumpsById]);

  const visibleIds = useMemo(() => new Set(visibleSystems.map((row) => row.systemId)), [visibleSystems]);
  const visibleEdges = useMemo(() => (mapData?.edges ?? []).filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to)), [mapData, visibleIds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !mapData) return;

    const draw = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(520, rect.width);
      const height = Math.max(360, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#020304";
      ctx.fillRect(0, 0, width, height);

      if (!visibleSystems.length) { pointsRef.current = []; return; }
      const positions = visibleSystems.map((system) => ({ system, ...(scope === "local" ? (localBranchPositions.get(system.systemId) ?? worldPosition(system)) : worldPosition(system)) }));
      let minX = Math.min(...positions.map((row) => row.x));
      let maxX = Math.max(...positions.map((row) => row.x));
      let minY = Math.min(...positions.map((row) => row.y));
      let maxY = Math.max(...positions.map((row) => row.y));
      if (minX === maxX) { minX -= 1; maxX += 1; }
      if (minY === maxY) { minY -= 1; maxY += 1; }
      const padding = 38;
      const spanX = maxX - minX;
      const spanY = maxY - minY;
      const baseScale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
      const baseX = (width - spanX * baseScale) / 2;
      const baseY = (height - spanY * baseScale) / 2;
      let t = transformRef.current;
      const requestedFocusId = focusRequestRef.current;
      if (requestedFocusId != null) {
        const focus = positions.find((row) => row.system.systemId === requestedFocusId);
        if (focus) {
          const basePx = baseX + (focus.x - minX) * baseScale;
          const basePy = baseY + (focus.y - minY) * baseScale;
          t = { ...t, offsetX: -(basePx - width / 2) * t.scale, offsetY: -(basePy - height / 2) * t.scale };
          transformRef.current = t;
          focusRequestRef.current = null;
        }
      }
      const project = (system: NavigationSystem) => {
        const p = scope === "local" ? (localBranchPositions.get(system.systemId) ?? worldPosition(system)) : worldPosition(system);
        const bx = baseX + (p.x - minX) * baseScale;
        const by = baseY + (p.y - minY) * baseScale;
        return {
          x: width / 2 + (bx - width / 2) * t.scale + t.offsetX,
          y: height / 2 + (by - height / 2) * t.scale + t.offsetY,
        };
      };
      const pointById = new Map<number, { x: number; y: number }>();
      for (const system of visibleSystems) pointById.set(system.systemId, project(system));

      ctx.strokeStyle = scope === "local" ? "rgba(210,149,34,.62)" : "rgba(185,127,21,.34)";
      ctx.lineWidth = scope === "local" ? Math.max(1, Math.min(2.2, t.scale * .75)) : Math.max(.4, Math.min(1.1, t.scale * .28));
      for (const edge of visibleEdges) {
        const a = pointById.get(edge.from); const b = pointById.get(edge.to); if (!a || !b) continue;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }

      if (draft.layers.some((id) => id === "special" || id === "thera" || id === "turnur" || id === "wormholes")) {
        for (const link of props.specialConnections.filter((row) => row.enabled)) {
          const allSpecial = draft.layers.includes("special");
          const explicitlyEnabled =
            (link.type === "thera" && draft.layers.includes("thera")) ||
            (link.type === "turnur" && draft.layers.includes("turnur")) ||
            (link.type === "wormhole" && draft.layers.includes("wormholes"));
          if (!allSpecial && !explicitlyEnabled) continue;
          const a = pointById.get(link.fromSystemId); const b = pointById.get(link.toSystemId); if (!a || !b) continue;
          ctx.save(); ctx.strokeStyle = connectionColor(link.type); ctx.lineWidth = 1.5; ctx.setLineDash([7, 5]);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
        }
      }

      if (draft.layers.includes("route") && props.route?.found) {
        ctx.save(); ctx.strokeStyle = "#62d7ff"; ctx.lineWidth = 2.5; ctx.shadowColor = "rgba(98,215,255,.45)"; ctx.shadowBlur = 8;
        for (let index = 0; index < props.route.systems.length - 1; index += 1) {
          const a = pointById.get(props.route.systems[index].systemId); const b = pointById.get(props.route.systems[index + 1].systemId); if (!a || !b) continue;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        ctx.restore();
      }

      const nextPoints: Array<{ system: NavigationSystem; x: number; y: number; radius: number }> = [];
      for (const system of visibleSystems) {
        const point = pointById.get(system.systemId)!;
        if (point.x < -30 || point.y < -30 || point.x > width + 30 || point.y > height + 30) continue;
        const kills = killById.get(system.systemId);
        const jumps = jumpsById.get(system.systemId) ?? 0;
        const intel = intelById.get(system.systemId);
        const onRoute = routeIds.has(system.systemId);
        const selected = props.selectedSystem?.systemId === system.systemId;
        const current = props.characterLocation?.systemId === system.systemId;
        let radius = scope === "local" ? Math.max(4, Math.min(6.6, 4 + t.scale * .55)) : Math.max(1.5, Math.min(4.2, 1.25 + t.scale * .55));
        if (onRoute) radius += 1.2;
        nextPoints.push({ system, ...point, radius: Math.max(8, radius + 5) });

        if (draft.layers.includes("jumps") && jumps > 0) {
          const r = radius + heatRadius(jumps, 1.05, 12);
          ctx.beginPath(); ctx.arc(point.x, point.y, r, 0, Math.PI * 2); ctx.strokeStyle = "rgba(222,159,43,.38)"; ctx.lineWidth = 1; ctx.stroke();
        }
        if (draft.layers.includes("npc-kills") && Number(kills?.npcKills ?? 0) > 0) {
          const r = radius + heatRadius(Number(kills?.npcKills ?? 0), .9, 10);
          ctx.beginPath(); ctx.arc(point.x, point.y, r, 0, Math.PI * 2); ctx.strokeStyle = "rgba(93,203,180,.42)"; ctx.lineWidth = 1; ctx.stroke();
        }
        if (draft.layers.includes("ship-kills") && Number(kills?.shipKills ?? 0) > 0) {
          const r = radius + heatRadius(Number(kills?.shipKills ?? 0), 1.6, 15);
          ctx.beginPath(); ctx.arc(point.x, point.y, r, 0, Math.PI * 2); ctx.strokeStyle = "rgba(240,91,73,.82)"; ctx.lineWidth = 1.5; ctx.stroke();
        }
        if (draft.layers.includes("pod-kills") && Number(kills?.podKills ?? 0) > 0) {
          const r = radius + heatRadius(Number(kills?.podKills ?? 0), 1.7, 16);
          ctx.beginPath(); ctx.arc(point.x, point.y, r, 0, Math.PI * 2); ctx.strokeStyle = "rgba(226,78,154,.8)"; ctx.lineWidth = 1.5; ctx.stroke();
        }
        if (draft.layers.includes("incursions") && incursionIds.has(system.systemId)) {
          ctx.beginPath(); ctx.arc(point.x, point.y, radius + 9, 0, Math.PI * 2); ctx.strokeStyle = "#a767db"; ctx.lineWidth = 2; ctx.stroke();
        }
        if (draft.layers.includes("danger") && intel?.routeGate?.danger?.state && intel.routeGate.danger.state !== "clear") {
          ctx.beginPath(); ctx.arc(point.x, point.y, radius + 12, 0, Math.PI * 2); ctx.strokeStyle = intel.routeGate.danger.state === "active-camp" ? "#ff4f5e" : intel.routeGate.danger.state === "camp-likely" ? "#ff8a48" : "#dfb655"; ctx.lineWidth = 2; ctx.stroke();
        }
        if (draft.layers.includes("sovereignty") && intel?.ownership?.allianceId) {
          ctx.beginPath(); ctx.arc(point.x, point.y, radius + 15, 0, Math.PI * 2); ctx.strokeStyle = "rgba(104,137,221,.65)"; ctx.lineWidth = 1; ctx.stroke();
        }
        if (draft.layers.includes("faction") && intel?.ownership?.factionId) {
          ctx.beginPath(); ctx.arc(point.x, point.y, radius + 17, 0, Math.PI * 2); ctx.strokeStyle = "rgba(229,194,104,.6)"; ctx.lineWidth = 1; ctx.stroke();
        }
        if (draft.layers.includes("infrastructure") && intel && (intel.infrastructure.npcStations || intel.infrastructure.knownStructures)) {
          ctx.strokeStyle = "rgba(211,222,224,.72)"; ctx.lineWidth = 1; ctx.strokeRect(point.x - radius - 3, point.y - radius - 3, (radius + 3) * 2, (radius + 3) * 2);
        }

        const fill = draft.layers.includes("security") ? securityColor(system.securityStatus) : "#d49a2f";
        ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
        ctx.beginPath(); ctx.arc(point.x, point.y, radius + 2.2, 0, Math.PI * 2); ctx.strokeStyle = "rgba(224,164,50,.72)"; ctx.lineWidth = 1; ctx.stroke();
        if (current && (draft.layers.includes("current") || props.followCharacter)) { ctx.beginPath(); ctx.arc(point.x, point.y, radius + 8, 0, Math.PI * 2); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2.2; ctx.stroke(); ctx.beginPath(); ctx.arc(point.x, point.y, radius + 12, 0, Math.PI * 2); ctx.strokeStyle = "rgba(212,154,47,.85)"; ctx.lineWidth = 1.4; ctx.stroke(); }
        if (selected) { ctx.beginPath(); ctx.arc(point.x, point.y, radius + 10, 0, Math.PI * 2); ctx.strokeStyle = "#ffd05c"; ctx.lineWidth = 1.8; ctx.stroke(); }

        const hot = Number(kills?.shipKills ?? 0) >= Math.max(1, draft.minShipKills) || Number(kills?.podKills ?? 0) >= Math.max(1, draft.minPodKills);
        if (scope === "local" || selected || current || onRoute || hot || t.scale >= 4.2) {
          ctx.font = `${selected || current ? 700 : 500} ${scope === "local" ? 10 : 10}px "Space Grotesk", sans-serif`;
          ctx.fillStyle = current ? "#fff0bd" : selected ? "#ffd05c" : "#d8d6cf";
          ctx.fillText(current ? system.name + " · YOU" : system.name, point.x + radius + 6, point.y - radius - 2);
        }
      }
      pointsRef.current = nextPoints;
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [mapData, visibleSystems, visibleEdges, localBranchPositions, scope, draft, metrics, props.route, props.routeIntelligence, props.characterLocation?.systemId, props.followCharacter, props.selectedSystem?.systemId, props.specialConnections, viewVersion]);

  function hitSystem(clientX: number, clientY: number) {
    const canvas = canvasRef.current; if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left; const y = clientY - rect.top;
    let best: { system: NavigationSystem; distance: number } | null = null;
    for (const point of pointsRef.current) {
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance <= Math.max(12, point.radius) && (!best || distance < best.distance)) best = { system: point.system, distance };
    }
    return best?.system ?? null;
  }

  function selectSearchResult(system: NavigationSystem) {
    props.onSelectSystem(system);
    setSearch(system.name);
    setSearchResults([]);
    if (scope === "local") {
      setLocalAnchorId(system.systemId);
      transformRef.current = { scale: 1, offsetX: 0, offsetY: 0 };
      setViewVersion((value) => value + 1);
      return;
    }
    const data = mapData?.systems.find((row) => row.systemId === system.systemId);
    if (!data) {
      setScope("universe");
      return;
    }
    focusRequestRef.current = system.systemId;
    transformRef.current = { scale: 6, offsetX: 0, offsetY: 0 };
    setViewVersion((value) => value + 1);
  }

  const groups = [...new Set(LAYERS.map((row) => row.group))];
  const selected = props.selectedSystem ?? hoverSystem;
  const selectedKills = selected ? killById.get(selected.systemId) : null;
  const selectedJumps = selected ? jumpsById.get(selected.systemId) ?? 0 : 0;
  const selectedIntel = selected ? intelById.get(selected.systemId) : null;

  return <div className={`on-the-fly-map ${opsView ? "ops-view" : ""}`}>
    <div className="on-the-fly-head">
      <div>
        <p className="eyebrow">ON THE FLY JUMP MAP</p>
        <h3>EVE map 2.0 — stack the filters you actually want</h3>
        <p>Run multiple CCP/Sage overlays at the same time, save them as named sets, and leave the map live on a second screen during an op.</p>
      </div>
      <div className={`on-the-fly-live ${metrics?.stale ? "stale" : "ready"}`}>
        <span>{metrics?.stale ? "STALE CACHE" : "LIVE ESI"}</span>
        <strong>{metrics ? new Date(metrics.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Loading…"}</strong>
        <small>{visibleSystems.length.toLocaleString()} visible / {mapData?.systems.length.toLocaleString() ?? "—"} loaded</small>
      </div>
    </div>

    <div className="on-the-fly-topbar">
      <label><span>Filter set</span><select value={activeSetId} onChange={(event) => chooseSet(event.target.value)}>{sets.map((row) => <option key={row.id} value={row.id}>{row.name}{row.builtIn ? " · built-in" : ""}</option>)}</select></label>
      <div className="on-the-fly-search">
        <span>Find system</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Jita, Amarr, Tama…" />
        {searchResults.length > 0 && <div>{searchResults.map((system) => <button type="button" key={system.systemId} onClick={() => selectSearchResult(system)}><strong>{system.name}</strong><small>{system.regionName} · {system.securityStatus.toFixed(1)}</small></button>)}</div>}
      </div>
      <label><span>Scope</span><select value={scope} onChange={(event) => { const next = event.target.value as MapScope; setScope(next); if (next === "local") resetView(); }}><option value="local">Local branches</option><option value="region">Region</option><option value="universe">Universe overview</option></select></label>
      {scope === "local" && <label><span>Range</span><select value={localJumps} onChange={(event) => { setLocalJumps(Number(event.target.value)); resetView(); }}><option value={2}>2 jumps</option><option value={3}>3 jumps</option><option value={4}>4 jumps</option><option value={5}>5 jumps</option></select></label>}
      {scope === "region" && <label><span>Region</span><select value={draft.regionId ?? ""} onChange={(event) => updateDraft({ regionId: Number(event.target.value) || null })}><option value="">Choose region</option>{mapData?.regions.map((region) => <option key={region.regionId} value={region.regionId}>{region.name}</option>)}</select></label>}
      <button type="button" onClick={() => void refreshLive(true)} disabled={busy}>{busy ? "Refreshing…" : "Refresh live"}</button>
      <button type="button" onClick={resetView}>Reset view</button>
      <button type="button" className={opsView ? "active" : ""} onClick={() => setOpsView((value) => !value)}>{opsView ? "Edit filters" : "Ops View"}</button>
      <label className="on-the-fly-auto"><input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} /><span>Auto 5m</span></label>
      <label className={`on-the-fly-auto ${props.followCharacter ? "active" : ""}`} title={props.hasSelectedCharacter ? "Follow the selected character with live ESI location checks every 15 seconds." : "Choose a Navigation character first."}><input type="checkbox" checked={props.followCharacter} disabled={!props.hasSelectedCharacter} onChange={(event) => { props.setFollowCharacter(event.target.checked); if (event.target.checked) { if (props.characterLocation?.systemId) setLocalAnchorId(props.characterLocation.systemId); setScope("local"); resetView(); } }} /><span>Follow live</span></label>
    </div>

    {error && <div className="on-the-fly-warning">{error}</div>}

    <div className="on-the-fly-workspace">
      {!opsView && <aside className="on-the-fly-filters">
        <div className="on-the-fly-filter-summary"><div><span>ACTIVE SET</span><strong>{draft.name}</strong><small>{draft.layers.length} simultaneous layers</small></div><b>{draft.layers.length}</b></div>
        <div className="on-the-fly-security-bands"><span>Security bands</span><div>{(["high", "low", "null"] as SecurityBand[]).map((band) => <button type="button" key={band} className={draft.securityBands.includes(band) ? "active" : ""} onClick={() => toggleBand(band)}>{band === "high" ? "High-sec" : band === "low" ? "Low-sec" : "Null-sec"}</button>)}</div></div>
        {groups.map((group) => <div className="on-the-fly-filter-group" key={group}><span>{group}</span>{LAYERS.filter((row) => row.group === group).map((row) => <button type="button" key={row.id} title={row.detail} className={draft.layers.includes(row.id) ? "active" : ""} onClick={() => toggleLayer(row.id)}><i /><div><strong>{row.label}</strong><small>{row.detail}</small></div></button>)}</div>)}
        <div className="on-the-fly-thresholds">
          <span>Focus thresholds</span>
          <label><strong>Ship kills</strong><input type="number" min="0" max="999" value={draft.minShipKills} onChange={(event) => updateDraft({ minShipKills: Math.max(0, Number(event.target.value) || 0) })} /></label>
          <label><strong>Pod kills</strong><input type="number" min="0" max="999" value={draft.minPodKills} onChange={(event) => updateDraft({ minPodKills: Math.max(0, Number(event.target.value) || 0) })} /></label>
          <label><strong>NPC kills</strong><input type="number" min="0" max="99999" value={draft.minNpcKills} onChange={(event) => updateDraft({ minNpcKills: Math.max(0, Number(event.target.value) || 0) })} /></label>
          <label><strong>Ship jumps</strong><input type="number" min="0" max="999999" value={draft.minJumps} onChange={(event) => updateDraft({ minJumps: Math.max(0, Number(event.target.value) || 0) })} /></label>
          <label className="on-the-fly-focus-only"><input type="checkbox" checked={draft.focusOnly} onChange={(event) => updateDraft({ focusOnly: event.target.checked })} /><span><strong>Hide non-matches</strong><small>Apply all thresholds as AND filters instead of heat overlays only.</small></span></label>
        </div>
        <div className="on-the-fly-save-set">
          <span>Save filter set</span>
          <input value={newSetName} onChange={(event) => setNewSetName(event.target.value)} placeholder={draft.builtIn ? `${draft.name} Custom` : draft.name} />
          <div><button type="button" onClick={saveCurrentSet}>Save as new</button><button type="button" disabled={draft.builtIn} onClick={updateSavedSet}>Update set</button><button type="button" disabled={draft.builtIn} onClick={() => deleteSet(draft.id)}>Delete</button></div>
        </div>
      </aside>}

      <main className="on-the-fly-canvas-shell">
        <div className="on-the-fly-layer-strip">{draft.layers.map((id) => <button key={id} type="button" onClick={() => toggleLayer(id)}>{LAYERS.find((row) => row.id === id)?.label ?? id}<span>×</span></button>)}</div>
        <div className="on-the-fly-canvas" ref={wrapRef}>
          <canvas ref={canvasRef}
            onWheel={(event) => {
              event.preventDefault();
              const canvas = canvasRef.current; if (!canvas) return;
              const rect = canvas.getBoundingClientRect(); const x = event.clientX - rect.left; const y = event.clientY - rect.top;
              const current = transformRef.current; const nextScale = Math.max(.55, Math.min(24, current.scale * (event.deltaY < 0 ? 1.18 : .84)));
              const ratio = nextScale / current.scale;
              transformRef.current = { scale: nextScale, offsetX: x - rect.width / 2 - (x - rect.width / 2 - current.offsetX) * ratio, offsetY: y - rect.height / 2 - (y - rect.height / 2 - current.offsetY) * ratio };
              setViewVersion((value) => value + 1);
            }}
            onPointerDown={(event) => { const t = transformRef.current; dragRef.current = { x: event.clientX, y: event.clientY, offsetX: t.offsetX, offsetY: t.offsetY }; event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerMove={(event) => { const hit = hitSystem(event.clientX, event.clientY); setHoverSystem(hit); const drag = dragRef.current; if (!drag) return; transformRef.current = { ...transformRef.current, offsetX: drag.offsetX + event.clientX - drag.x, offsetY: drag.offsetY + event.clientY - drag.y }; setViewVersion((value) => value + 1); }}
            onPointerUp={(event) => { const drag = dragRef.current; dragRef.current = null; event.currentTarget.releasePointerCapture(event.pointerId); if (drag && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) { const system = hitSystem(event.clientX, event.clientY); if (system) props.onSelectSystem(system); } }}
            onPointerLeave={() => setHoverSystem(null)}
          />
          <div className="on-the-fly-legend"><span><i className="gate" />Stargate</span><span><i className="special" />Special link</span><span><i className="route" />Route</span><span><i className="ship" />Ship kills</span><span><i className="pod" />Pod kills</span><small>{scope === "local" ? `${localJumps}-jump branch view · wheel zoom · drag pan · click inspect` : "Wheel zoom · drag pan · click inspect"}</small></div>
          {selected && <div className="on-the-fly-inspector">
            <div><span>SYSTEM</span><strong>{selected.name}</strong><small>{selected.constellationName} · {selected.regionName}</small></div><b className={securityBand(selected.securityStatus)}>{Math.max(-1, Math.min(1, Math.round(selected.securityStatus * 10) / 10)).toFixed(1)}</b>
            <div className="on-the-fly-inspector-metrics"><span><small>Ship kills</small><strong>{selectedKills?.shipKills ?? 0}</strong></span><span><small>Pod kills</small><strong>{selectedKills?.podKills ?? 0}</strong></span><span><small>NPC kills</small><strong>{selectedKills?.npcKills ?? 0}</strong></span><span><small>Jumps</small><strong>{selectedJumps.toLocaleString()}</strong></span></div>
            <div className="on-the-fly-inspector-tags">{incursionIds.has(selected.systemId) && <span>INCURSION</span>}{routeIds.has(selected.systemId) && <span>ON ROUTE</span>}{props.characterLocation?.systemId === selected.systemId && <span>CURRENT</span>}{selectedIntel?.routeGate?.danger?.state && selectedIntel.routeGate.danger.state !== "clear" && <span>{selectedIntel.routeGate.danger.label}</span>}</div>
          </div>}
        </div>
      </main>
    </div>
  </div>;
}
