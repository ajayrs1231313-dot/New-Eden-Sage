import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  NavigationGraphStatus,
  NavigationHazardProviderSnapshot,
  NavigationHazardSnapshot,
  NavigationRouteMode,
  NavigationRoutePlan,
  NavigationLockedSegment,
  NavigationCustomConnection,
  NavigationCharacterLocation,
  NavigationRouteIntelligence,
  NavigationEdgeType,
  NavigationRouteProfile,
  NavigationCapitalContext,
  NavigationCapitalPlan,
  NavigationOnlineWorkspace,
  NavigationOnlineRouteSummary,
  NavigationWaypointAnnotation,
  NavigationSystem,
} from "./types";
import { NavigationUniverseMap } from "./NavigationUniverseMap";
import { NavigationRouteList } from "./NavigationRouteList";
import "./navigation-command.css";

type NavigationSection = "route" | "map" | "saved" | "intelligence" | "capital";
type FloorPreset = "any" | "high" | "low" | "custom";
type AvoidScope = "system" | "constellation" | "region";

type AvoidEntry = {
  key: string;
  scope: AvoidScope;
  scopeId: number;
  label: string;
  detail: string;
  persistent: boolean;
};

type SavedRouteEntry = { id: string; name: string; route: NavigationRoutePlan; avoids: AvoidEntry[]; notes?: string; savedAt: string };
type ConnectedCharacter = { characterId: string; name: string; systemId?: number; systemName?: string; updatedAt?: string };

const GLOBAL_AVOIDS_KEY = "new-eden-sage-navigation-global-avoids-v1";
const SAVED_ROUTES_KEY = "new-eden-sage-navigation-saved-routes-v1";
const FAVOURITES_KEY = "new-eden-sage-navigation-favourites-v1";
const CUSTOM_CONNECTIONS_KEY = "new-eden-sage-navigation-custom-connections-v1";
const RECENT_DESTINATIONS_KEY = "new-eden-sage-navigation-recent-destinations-v1";
const SPECIAL_EDGE_TYPES: NavigationEdgeType[] = ["ansiblex", "wormhole", "thera", "turnur", "zarzakh", "manual"];

const routePresets = [
  { id: "fastest", label: "Fastest", detail: "Shortest path · any security", mode: "shortest" as NavigationRouteMode, floor: "any" as FloorPreset },
  { id: "highsec-haul", label: "High-sec haul", detail: "Strict 0.5+ route", mode: "high-sec" as NavigationRouteMode, floor: "high" as FloorPreset },
  { id: "lowsec-roam", label: "Low-sec roam", detail: "Prefer lower security", mode: "less-secure" as NavigationRouteMode, floor: "any" as FloorPreset },
  { id: "capital-safe", label: "Capital-safe", detail: "Safer profile foundation", mode: "safer" as NavigationRouteMode, floor: "any" as FloorPreset },
];

const sections: Array<{ id: NavigationSection; label: string; eyebrow: string }> = [
  { id: "route", label: "Route Planner", eyebrow: "BUILD" },
  { id: "map", label: "Map", eyebrow: "EXPLORE" },
  { id: "saved", label: "Saved Routes", eyebrow: "LIBRARY" },
  { id: "intelligence", label: "Route Intelligence", eyebrow: "INTEL" },
  { id: "capital", label: "Capital / Jump Planner", eyebrow: "CAPITAL" },
];

const modeLabels: Record<NavigationRouteMode, string> = {
  shortest: "Shortest",
  safer: "Safer",
  "less-secure": "Less secure",
  "high-sec": "High-sec only",
};

function loadGlobalAvoids(): AvoidEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(GLOBAL_AVOIDS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => entry && ["system", "constellation", "region"].includes(entry.scope) && Number(entry.scopeId) > 0)
      .map((entry) => ({ ...entry, scopeId: Number(entry.scopeId), persistent: true }));
  } catch {
    return [];
  }
}

function loadJsonArray<T>(key: string): T[] {
  try { const value = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(value) ? value as T[] : []; } catch { return []; }
}

function loadSavedRoutes() { return loadJsonArray<SavedRouteEntry>(SAVED_ROUTES_KEY).filter((row) => row?.route?.routeId && row?.name); }
function loadFavourites() { return loadJsonArray<NavigationSystem>(FAVOURITES_KEY).filter((row) => Number(row?.systemId) > 0 && row?.name); }
function loadCustomConnections() { return loadJsonArray<NavigationCustomConnection>(CUSTOM_CONNECTIONS_KEY).filter((row) => row?.connectionId && Number(row?.fromSystemId) > 0 && Number(row?.toSystemId) > 0); }
function loadRecentDestinations() { return loadJsonArray<NavigationSystem>(RECENT_DESTINATIONS_KEY).filter((row) => Number(row?.systemId) > 0 && row?.name).slice(0, 8); }

export function NavigationCommand() {
  const [section, setSection] = useState<NavigationSection>("route");
  const [graph, setGraph] = useState<NavigationGraphStatus | null>(null);
  const [graphError, setGraphError] = useState("");
  const [hazards, setHazards] = useState<NavigationHazardSnapshot | null>(null);
  const [hazardError, setHazardError] = useState("");
  const [enabledHazards, setEnabledHazards] = useState<string[]>([]);
  const [waypoints, setWaypoints] = useState<NavigationSystem[]>([]);
  const [mode, setMode] = useState<NavigationRouteMode>("shortest");
  const [floorPreset, setFloorPreset] = useState<FloorPreset>("any");
  const [customFloor, setCustomFloor] = useState(0.0);
  const [temporaryAvoids, setTemporaryAvoids] = useState<AvoidEntry[]>([]);
  const [globalAvoids, setGlobalAvoids] = useState<AvoidEntry[]>(loadGlobalAvoids);
  const [route, setRoute] = useState<NavigationRoutePlan | null>(null);
  const [lockedSegments, setLockedSegments] = useState<NavigationLockedSegment[]>([]);
  const [customConnections, setCustomConnections] = useState<NavigationCustomConnection[]>(loadCustomConnections);
  const [enabledSpecialTypes, setEnabledSpecialTypes] = useState<NavigationEdgeType[]>(SPECIAL_EDGE_TYPES);
  const [disabledSpecialNetworkIds, setDisabledSpecialNetworkIds] = useState<string[]>([]);
  const [savedRoutes, setSavedRoutes] = useState<SavedRouteEntry[]>(loadSavedRoutes);
  const [favourites, setFavourites] = useState<NavigationSystem[]>(loadFavourites);
  const [recentDestinations, setRecentDestinations] = useState<NavigationSystem[]>(loadRecentDestinations);
  const [routeNotes, setRouteNotes] = useState("");
  const [waypointAnnotations, setWaypointAnnotations] = useState<Record<string, NavigationWaypointAnnotation>>({});
  const [characters, setCharacters] = useState<ConnectedCharacter[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [exportAppend, setExportAppend] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [routePacketMessage, setRoutePacketMessage] = useState("");
  const [onlineWorkspace, setOnlineWorkspace] = useState<NavigationOnlineWorkspace | null>(null);
  const [onlineRoutes, setOnlineRoutes] = useState<NavigationOnlineRouteSummary[]>([]);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [onlineMessage, setOnlineMessage] = useState("");
  const [onlineVisibility, setOnlineVisibility] = useState<"workspace" | "restricted">("workspace");
  const [onlineRecipientIds, setOnlineRecipientIds] = useState("");
  const [loadedOnlineObject, setLoadedOnlineObject] = useState<{ id: string; version: number; visibility: "workspace" | "restricted" } | null>(null);
  const [characterLocation, setCharacterLocation] = useState<NavigationCharacterLocation | null>(null);
  const [followCharacter, setFollowCharacter] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [routeIntelligence, setRouteIntelligence] = useState<NavigationRouteIntelligence | null>(null);
  const [routeIntelligenceBusy, setRouteIntelligenceBusy] = useState(false);
  const [routeIntelligenceError, setRouteIntelligenceError] = useState("");
  const [selectedSystem, setSelectedSystem] = useState<NavigationSystem | null>(null);
  const [selectedLegIndex, setSelectedLegIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Choose an origin and destination.");
  const lastCalculatedSignature = useRef("");

  useEffect(() => {
    let cancelled = false;
    window.sage.prepareNavigationGraph()
      .then((value) => { if (!cancelled) setGraph(value); })
      .catch((error) => { if (!cancelled) setGraphError(error instanceof Error ? error.message : "Navigation graph preparation failed."); });
    window.sage.getNavigationHazards(false)
      .then((value) => { if (!cancelled) setHazards(value); })
      .catch((error) => { if (!cancelled) setHazardError(error instanceof Error ? error.message : "Dynamic hazard data is unavailable."); });
    window.sage.listSnapshots().then((rows) => {
      if (cancelled) return;
      const next = (rows ?? []).map((row: any) => ({ characterId: String(row.characterId ?? row.character?.character_id ?? ""), name: String(row.character?.name ?? row.characterName ?? row.characterId ?? "Character"), systemId: Number(row.location?.solar_system_id ?? 0) || undefined, systemName: row.location?.solar_system_name ? String(row.location.solar_system_name) : undefined, updatedAt: row.updatedAt ? String(row.updatedAt) : undefined })).filter((row) => row.characterId);
      setCharacters(next);
      setSelectedCharacterId((current) => current || next[0]?.characterId || "");
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(GLOBAL_AVOIDS_KEY, JSON.stringify(globalAvoids)); } catch { /* renderer storage can fail in hardened contexts */ }
  }, [globalAvoids]);
  useEffect(() => { try { localStorage.setItem(SAVED_ROUTES_KEY, JSON.stringify(savedRoutes)); } catch {} }, [savedRoutes]);
  useEffect(() => { try { localStorage.setItem(FAVOURITES_KEY, JSON.stringify(favourites)); } catch {} }, [favourites]);
  useEffect(() => { try { localStorage.setItem(RECENT_DESTINATIONS_KEY, JSON.stringify(recentDestinations)); } catch {} }, [recentDestinations]);
  useEffect(() => { try { localStorage.setItem(CUSTOM_CONNECTIONS_KEY, JSON.stringify(customConnections)); } catch {} }, [customConnections]);

  useEffect(() => {
    const selected = characters.find((row) => row.characterId === selectedCharacterId);
    if (!selected?.systemId) { setCharacterLocation(null); return; }
    setCharacterLocation({
      characterId: selected.characterId,
      characterName: selected.name,
      systemId: selected.systemId,
      systemName: selected.systemName ?? ("System " + selected.systemId),
      source: "synced-snapshot",
      observedAt: selected.updatedAt ?? new Date(0).toISOString(),
    });
    setLocationError("");
  }, [selectedCharacterId, characters]);

  const refreshCharacterLocation = useCallback(async (forceLive = true) => {
    if (!selectedCharacterId) { setLocationError("Choose a connected character first."); return null; }
    setLocationBusy(true);
    try {
      const value = await window.sage.getNavigationCharacterLocation(selectedCharacterId, forceLive);
      setCharacterLocation(value);
      setLocationError("");
      return value;
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "Character location is unavailable.");
      return null;
    } finally {
      setLocationBusy(false);
    }
  }, [selectedCharacterId]);

  useEffect(() => {
    if (!followCharacter || !selectedCharacterId) return;
    void refreshCharacterLocation(true);
    const timer = window.setInterval(() => void refreshCharacterLocation(true), 15_000);
    return () => window.clearInterval(timer);
  }, [followCharacter, selectedCharacterId, refreshCharacterLocation]);

  const minSecurity = useMemo(() => {
    if (mode === "high-sec" || floorPreset === "high") return 0.5;
    if (floorPreset === "low") return 0.4;
    if (floorPreset === "custom") return Math.max(-1, Math.min(1, Math.round(customFloor * 10) / 10));
    return null;
  }, [mode, floorPreset, customFloor]);

  const activeAvoids = useMemo(() => [...globalAvoids, ...temporaryAvoids], [globalAvoids, temporaryAvoids]);
  const avoidIds = useMemo(() => ({
    systemIds: uniqueNumbers(activeAvoids.filter((entry) => entry.scope === "system").map((entry) => entry.scopeId)),
    constellationIds: uniqueNumbers(activeAvoids.filter((entry) => entry.scope === "constellation").map((entry) => entry.scopeId)),
    regionIds: uniqueNumbers(activeAvoids.filter((entry) => entry.scope === "region").map((entry) => entry.scopeId)),
  }), [activeAvoids]);

  const dynamicExcludedSystemIds = useMemo(() => uniqueNumbers(
    (hazards?.providers ?? [])
      .filter((provider) => enabledHazards.includes(provider.id) && provider.available)
      .flatMap((provider) => provider.systemIds),
  ), [hazards, enabledHazards]);

  const profile = useMemo<NavigationRouteProfile>(() => ({
    mode,
    minSecurity,
    avoids: avoidIds,
    dynamicHazards: {
      providerIds: enabledHazards,
      excludedSystemIds: dynamicExcludedSystemIds,
      snapshotAt: hazards?.fetchedAt,
    },
    specialConnections: { enabledTypes: enabledSpecialTypes, disabledNetworkIds: disabledSpecialNetworkIds },
  }), [mode, minSecurity, avoidIds, enabledHazards, dynamicExcludedSystemIds, hazards?.fetchedAt, enabledSpecialTypes, disabledSpecialNetworkIds]);

  const signature = useMemo(() => JSON.stringify({ waypoints: waypoints.map((system) => system.systemId), profile, lockedSegments, customConnections }), [waypoints, profile, lockedSegments, customConnections]);

  const calculatePlan = useCallback(async (explicitWaypoints?: NavigationSystem[]) => {
    const stops = explicitWaypoints ?? waypoints;
    if (stops.length < 2 || !graph) {
      setRoute(null);
      setMessage("Add at least an origin and destination.");
      return;
    }
    const calculationSignature = JSON.stringify({ waypoints: stops.map((system) => system.systemId), profile, lockedSegments, customConnections });
    lastCalculatedSignature.current = calculationSignature;
    setBusy(true);
    setMessage(stops.length > 2 ? `Calculating ${stops.length - 1} route segments locally…` : "Calculating locally…");
    try {
      const result = await window.sage.calculateNavigationPlan({
        routeId: route?.routeId,
        name: route?.name,
        createdAt: route?.createdAt,
        version: route?.version,
        notes: routeNotes,
        waypointAnnotations,
        waypointSystemIds: stops.map((system) => system.systemId),
        lockedSegments,
        customConnections,
        profile,
      });
      setRoute(result);
      setMessage(result.found
        ? `${result.totals.jumps} jumps across ${result.segments.length} segment${result.segments.length === 1 ? "" : "s"}.`
        : result.reason ?? "No valid route.");
    } catch (error) {
      setRoute(null);
      setMessage(error instanceof Error ? error.message : "Route calculation failed.");
    } finally {
      setBusy(false);
    }
  }, [waypoints, graph, profile, route?.routeId, route?.name, route?.createdAt, route?.version, routeNotes, waypointAnnotations, lockedSegments, customConnections]);

  useEffect(() => {
    if (!route || busy || waypoints.length < 2 || signature === lastCalculatedSignature.current) return;
    const timer = setTimeout(() => void calculatePlan(), 120);
    return () => clearTimeout(timer);
  }, [signature, route?.routeId, busy, waypoints.length, calculatePlan]);

  function commitWaypoints(next: NavigationSystem[]) {
    setWaypoints(next);
    if (next.length < 2) {
      setRoute(null);
      setMessage(next.length ? "Add a destination to complete the route." : "Choose an origin and destination.");
    }
  }

  function setOrigin(system: NavigationSystem | null) {
    if (!system) return commitWaypoints(waypoints.slice(1));
    if (!waypoints.length) return commitWaypoints([system]);
    commitWaypoints([system, ...waypoints.slice(1)]);
  }

  function setDestination(system: NavigationSystem | null) {
    if (!system) return commitWaypoints(waypoints.length > 1 ? waypoints.slice(0, -1) : waypoints);
    setRecentDestinations((current) => [system, ...current.filter((row) => row.systemId !== system.systemId)].slice(0, 8));
    if (!waypoints.length) return;
    if (waypoints.length === 1) return commitWaypoints([waypoints[0], system]);
    commitWaypoints([...waypoints.slice(0, -1), system]);
  }

  function addWaypoint(system: NavigationSystem) {
    if (!waypoints.length) return commitWaypoints([system]);
    if (waypoints.length === 1) return commitWaypoints([...waypoints, system]);
    commitWaypoints([...waypoints.slice(0, -1), system, waypoints.at(-1)!]);
  }

  function insertWaypoint(index: number, system: NavigationSystem, after: boolean) {
    const target = Math.max(0, Math.min(waypoints.length, index + (after ? 1 : 0)));
    commitWaypoints([...waypoints.slice(0, target), system, ...waypoints.slice(target)]);
  }

  function removeWaypoint(index: number) {
    commitWaypoints(waypoints.filter((_, row) => row !== index));
  }

  function reverseRoute() {
    if (waypoints.length < 2) return;
    setLockedSegments((current) => current.map((row) => ({ ...row, fromSystemId: row.toSystemId, toSystemId: row.fromSystemId, systemIds: [...row.systemIds].reverse() })));
    commitWaypoints([...waypoints].reverse());
  }

  function clearRoute() {
    setWaypoints([]);
    setRoute(null);
    setLockedSegments([]);
    setRouteNotes("");
    setWaypointAnnotations({});
    setLoadedOnlineObject(null);
    setMessage("Choose an origin and destination.");
    lastCalculatedSignature.current = "";
  }

  function addAvoid(system: NavigationSystem, scope: AvoidScope, persistent = false) {
    const source = scope === "system"
      ? { scopeId: system.systemId, label: system.name, detail: `System · ${system.regionName}` }
      : scope === "constellation"
        ? { scopeId: system.constellationId, label: system.constellationName, detail: `Constellation · ${system.regionName}` }
        : { scopeId: system.regionId, label: system.regionName, detail: "Region" };
    const key = `${scope}:${source.scopeId}`;
    const entry: AvoidEntry = { key, scope, ...source, persistent };
    if (persistent) {
      setTemporaryAvoids((current) => current.filter((item) => item.key !== key));
      setGlobalAvoids((current) => current.some((item) => item.key === key) ? current : [...current, entry]);
    } else if (!globalAvoids.some((item) => item.key === key)) {
      setTemporaryAvoids((current) => current.some((item) => item.key === key) ? current : [...current, entry]);
    }
  }

  function removeAvoid(entry: AvoidEntry) {
    if (entry.persistent) setGlobalAvoids((current) => current.filter((item) => item.key !== entry.key));
    else setTemporaryAvoids((current) => current.filter((item) => item.key !== entry.key));
  }

  function toggleSegmentLock(segmentIndex: number) {
    if (!route?.found) return;
    const segment = route.segments[segmentIndex];
    if (!segment?.found || segment.systems.length < 2) return;
    setLockedSegments((current) => {
      const existing = current.find((row) => row.fromSystemId === segment.fromSystemId && row.toSystemId === segment.toSystemId);
      if (existing) return current.filter((row) => row.lockId !== existing.lockId);
      return [...current, { lockId: "lock-" + Date.now() + "-" + segmentIndex, fromSystemId: segment.fromSystemId, toSystemId: segment.toSystemId, systemIds: segment.systems.map((system) => system.systemId), createdAt: new Date().toISOString() }];
    });
  }

  function addCustomConnection(connection: Omit<NavigationCustomConnection, "connectionId">) {
    const row: NavigationCustomConnection = { ...connection, connectionId: "connection-" + Date.now() + "-" + Math.random().toString(16).slice(2) };
    setCustomConnections((current) => [...current, row]);
  }
  function toggleCustomConnection(id: string) { setCustomConnections((current) => current.map((row) => row.connectionId === id ? { ...row, enabled: !row.enabled } : row)); }
  function toggleSpecialType(type: NavigationEdgeType) {
    setEnabledSpecialTypes((current) => current.includes(type) ? current.filter((row) => row !== type) : [...current, type]);
  }
  function toggleSpecialNetwork(networkId: string) {
    if (!networkId) return;
    setDisabledSpecialNetworkIds((current) => current.includes(networkId) ? current.filter((row) => row !== networkId) : [...current, networkId]);
  }

  function removeCustomConnection(id: string) { setCustomConnections((current) => current.filter((row) => row.connectionId !== id)); }

  function toggleFavourite(system: NavigationSystem) {
    setFavourites((current) => current.some((row) => row.systemId === system.systemId) ? current.filter((row) => row.systemId !== system.systemId) : [...current, system]);
  }

  function applyPreset(id: string) {
    const preset = routePresets.find((row) => row.id === id); if (!preset) return;
    setMode(preset.mode); setFloorPreset(preset.floor);
    if (id === "highsec-haul" && hazards?.providers.some((row) => row.id === "incursion" && row.available)) setEnabledHazards((current) => current.includes("incursion") ? current : [...current, "incursion"]);
  }

  function saveCurrentRoute() {
    if (!route) return;
    const name = route.name || ((route.origin?.name ?? "Route") + " → " + (route.destination?.name ?? "Destination"));
    const entry: SavedRouteEntry = { id: route.routeId, name, route: { ...route, lockedSegments, customConnections }, avoids: activeAvoids, savedAt: new Date().toISOString() };
    setSavedRoutes((current) => { const index = current.findIndex((row) => row.id === entry.id); if (index < 0) return [entry, ...current]; const next=[...current]; next[index]=entry; return next; });
    setExportMessage("Saved " + name + ".");
  }
  function loadSavedRoute(entry: SavedRouteEntry) {
    const raw = entry.route;
    const value: NavigationRoutePlan = { ...raw, notes: raw.notes ?? "", waypointAnnotations: raw.waypointAnnotations ?? {} };
    setWaypoints(value.waypoints); setRoute(value); setRouteNotes(value.notes); setWaypointAnnotations(value.waypointAnnotations); setLoadedOnlineObject(null); setLockedSegments(value.lockedSegments ?? []); setCustomConnections(value.customConnections ?? []);
    setMode(value.routingProfile.mode);
    const floor=value.routingProfile.minSecurity; setCustomFloor(floor ?? 0); setFloorPreset(floor == null ? "any" : floor === 0.5 ? "high" : floor === 0.4 ? "low" : "custom");
    setEnabledHazards(value.routingProfile.dynamicHazards.providerIds ?? []);
    setEnabledSpecialTypes(value.routingProfile.specialConnections?.enabledTypes ?? SPECIAL_EDGE_TYPES);
    setDisabledSpecialNetworkIds(value.routingProfile.specialConnections?.disabledNetworkIds ?? []);
    setTemporaryAvoids((entry.avoids ?? []).map((row) => ({ ...row, persistent: false })).filter((row) => !globalAvoids.some((g) => g.key === row.key)));
    lastCalculatedSignature.current = JSON.stringify({ waypoints: value.waypoints.map((system) => system.systemId), profile: value.routingProfile, lockedSegments: value.lockedSegments ?? [], customConnections: value.customConnections ?? [] });
    setSection("route"); setMessage("Loaded saved route " + entry.name + ".");
  }
  function renameSavedRoute(id: string, name: string) { setSavedRoutes((current) => current.map((row) => row.id === id ? { ...row, name, route: { ...row.route, name } } : row)); }
  function duplicateSavedRoute(entry: SavedRouteEntry) { const id=entry.id + "-copy-" + Date.now(); setSavedRoutes((current) => [{ ...entry, id, name: entry.name + " Copy", savedAt: new Date().toISOString(), route: { ...entry.route, routeId: id, name: entry.name + " Copy" } }, ...current]); }
  function deleteSavedRoute(id: string) { setSavedRoutes((current) => current.filter((row) => row.id !== id)); }

  function updateRouteNotes(value: string) {
    const notes = value.slice(0, 6000);
    setRouteNotes(notes);
    setRoute((current) => current ? { ...current, notes } : current);
  }

  function updateWaypointAnnotation(systemId: number, field: "label" | "note", value: string) {
    const limit = field === "label" ? 80 : 1200;
    setWaypointAnnotations((current) => {
      const key = String(systemId);
      const next = { ...current, [key]: { ...(current[key] ?? {}), [field]: value.slice(0, limit) } };
      if (!next[key].label?.trim() && !next[key].note?.trim()) delete next[key];
      setRoute((routeValue) => routeValue ? { ...routeValue, waypointAnnotations: next } : routeValue);
      return next;
    });
  }

  function duplicateWorkingRoute() {
    if (!route?.found) return;
    const routeId = `nav-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const copy: NavigationRoutePlan = { ...route, routeId, name: `${route.name} Copy`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 };
    setRoute(copy);
    setLoadedOnlineObject(null);
    setMessage(`Duplicated ${route.name}. This is now an independent working route.`);
  }

  function setSelectedAsOrigin() {
    if (!selectedSystem) return;
    setOrigin(selectedSystem);
  }

  function setSelectedAsDestination() {
    if (!selectedSystem) return;
    setDestination(selectedSystem);
  }

  function removeSelectedStop() {
    if (!selectedSystem) return;
    const index = waypoints.findIndex((row) => row.systemId === selectedSystem.systemId);
    if (index >= 0) removeWaypoint(index);
  }

  function lockSelectedLeg() {
    if (selectedLegIndex == null || !route?.found) return;
    const leg = route.legs[selectedLegIndex];
    if (!leg) return;
    const segmentIndex = route.segments.findIndex((segment) => segment.legs.some((candidate) => candidate.from === leg.from && candidate.to === leg.to));
    if (segmentIndex >= 0) toggleSegmentLock(segmentIndex);
  }

  async function copyOrderedSystems() {
    if (!route?.found) { setExportMessage("Calculate a route first."); return; }
    await window.sage.copyText(route.systems.map((system) => system.name).join("\n"));
    setExportMessage(`Copied ${route.systems.length} ordered systems.`);
  }

  async function copyCompactSummary() {
    if (!route?.found) { setExportMessage("Calculate a route first."); return; }
    const waypointsText = route.waypoints.map((system) => route.waypointAnnotations?.[String(system.systemId)]?.label?.trim() ? `${route.waypointAnnotations[String(system.systemId)].label}: ${system.name}` : system.name).join(" -> ");
    const text = [
      route.name,
      `${route.origin?.name ?? "?"} -> ${route.destination?.name ?? "?"} | ${route.totals.jumps} jumps | ${modeLabels[route.routingProfile.mode]}`,
      `Minimum security ${route.totals.minimumDisplayedSecurityStatus.toFixed(1)} | ${route.lockedSegments.length} locked | ${route.customConnections.length} custom`,
      `Stops: ${waypointsText}`,
      route.notes?.trim() ? `Notes: ${route.notes.trim()}` : "",
    ].filter(Boolean).join("\n");
    await window.sage.copyText(text);
    setExportMessage("Copied compact route summary.");
  }

  async function ensureOnlineWorkspace() {
    if (!selectedCharacterId) { setOnlineMessage("Choose a connected character first."); return null; }
    setOnlineBusy(true);
    try {
      const workspace = await window.sage.getNavigationOnlineWorkspace(selectedCharacterId);
      setOnlineWorkspace(workspace);
      const rows = await window.sage.listNavigationOnlineRoutes({ characterId: selectedCharacterId, workspaceId: workspace.workspace_id });
      setOnlineRoutes(rows);
      setOnlineMessage(`${workspace.corporation_name} workspace verified. ${rows.length} shared route${rows.length === 1 ? "" : "s"} visible to this Sage account.`);
      return workspace;
    } catch (error) {
      setOnlineWorkspace(null);
      setOnlineRoutes([]);
      setOnlineMessage(error instanceof Error ? error.message : "Sage Online corporation workspace is unavailable.");
      return null;
    } finally { setOnlineBusy(false); }
  }

  async function refreshOnlineRoutes() {
    const workspace = onlineWorkspace ?? await ensureOnlineWorkspace();
    if (!workspace || !selectedCharacterId) return;
    setOnlineBusy(true);
    try {
      const rows = await window.sage.listNavigationOnlineRoutes({ characterId: selectedCharacterId, workspaceId: workspace.workspace_id });
      setOnlineRoutes(rows);
      setOnlineMessage(`Refreshed ${rows.length} shared route${rows.length === 1 ? "" : "s"}.`);
    } catch (error) { setOnlineMessage(error instanceof Error ? error.message : "Shared route refresh failed."); }
    finally { setOnlineBusy(false); }
  }

  async function publishOnlineRoute() {
    if (!route?.found) { setOnlineMessage("Calculate or load a route first."); return; }
    const workspace = onlineWorkspace ?? await ensureOnlineWorkspace();
    if (!workspace || !selectedCharacterId) return;
    if (!workspace.can_publish_routes) { setOnlineMessage("This character/account does not have route.publish permission in the corporation workspace."); return; }
    const recipientCharacterIds = onlineVisibility === "restricted"
      ? [...new Set(onlineRecipientIds.split(/[\s,;]+/).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))]
      : [];
    if (onlineVisibility === "restricted" && !recipientCharacterIds.length) { setOnlineMessage("Add at least one active Sage-linked EVE character ID for restricted sharing."); return; }
    setOnlineBusy(true);
    try {
      const result = await window.sage.publishNavigationOnlineRoute({ characterId: selectedCharacterId, workspaceId: workspace.workspace_id, route, visibility: onlineVisibility, recipientCharacterIds });
      setLoadedOnlineObject({ id: result.id, version: result.version, visibility: onlineVisibility });
      setOnlineMessage(`Published ${route.name} as server version ${result.version}${onlineVisibility === "restricted" ? " to selected Sage members" : " to the corporation"}.`);
      await refreshOnlineRoutes();
    } catch (error) { setOnlineMessage(error instanceof Error ? error.message : "Route publish failed."); }
    finally { setOnlineBusy(false); }
  }

  async function updateOnlineRoute() {
    if (!route?.found || !loadedOnlineObject || !onlineWorkspace || !selectedCharacterId) return;
    if (!onlineWorkspace.can_publish_routes) { setOnlineMessage("You do not have route.publish permission for this workspace."); return; }
    setOnlineBusy(true);
    try {
      const result = await window.sage.updateNavigationOnlineRoute({ characterId: selectedCharacterId, workspaceId: onlineWorkspace.workspace_id, objectId: loadedOnlineObject.id, route, expectedVersion: loadedOnlineObject.version });
      setLoadedOnlineObject((current) => current ? { ...current, version: result.version } : current);
      setOnlineMessage(`Updated server-authoritative route to version ${result.version}.`);
      await refreshOnlineRoutes();
    } catch (error) { setOnlineMessage(error instanceof Error ? error.message : "Shared route update failed."); }
    finally { setOnlineBusy(false); }
  }

  async function loadOnlineRoute(summary: NavigationOnlineRouteSummary) {
    const workspace = onlineWorkspace ?? await ensureOnlineWorkspace();
    if (!workspace || !selectedCharacterId) return;
    setOnlineBusy(true);
    try {
      const object = await window.sage.getNavigationOnlineRoute({ characterId: selectedCharacterId, workspaceId: workspace.workspace_id, objectId: summary.id });
      const value = object.payload;
      setWaypoints(value.waypoints);
      setRoute(value);
      setRouteNotes(value.notes ?? "");
      setWaypointAnnotations(value.waypointAnnotations ?? {});
      setLockedSegments(value.lockedSegments ?? []);
      setCustomConnections(value.customConnections ?? []);
      setMode(value.routingProfile.mode);
      const floor = value.routingProfile.minSecurity;
      setCustomFloor(floor ?? 0);
      setFloorPreset(floor == null ? "any" : floor === 0.5 ? "high" : floor === 0.4 ? "low" : "custom");
      setEnabledHazards(value.routingProfile.dynamicHazards.providerIds ?? []);
      setEnabledSpecialTypes(value.routingProfile.specialConnections?.enabledTypes ?? SPECIAL_EDGE_TYPES);
      setDisabledSpecialNetworkIds(value.routingProfile.specialConnections?.disabledNetworkIds ?? []);
      setTemporaryAvoids(routeAvoidsFromProfile(value));
      setLoadedOnlineObject({ id: object.id, version: object.current_version, visibility: object.visibility });
      setOnlineVisibility(object.visibility);
      setSection("route");
      setMessage(`Loaded server-authoritative ${value.name} v${object.current_version}. Local edits remain local until an authorised Update Shared Route.`);
    } catch (error) { setOnlineMessage(error instanceof Error ? error.message : "Shared route load failed."); }
    finally { setOnlineBusy(false); }
  }


  function routeAvoidsFromProfile(value: NavigationRoutePlan): AvoidEntry[] {
    const rows: AvoidEntry[] = [];
    for (const id of value.routingProfile.avoids.systemIds ?? []) {
      const system = value.systems.find((row) => row.systemId === id);
      rows.push({ key: `system:${id}`, scope: "system", scopeId: id, label: system?.name ?? `System ${id}`, detail: system ? `System · ${system.regionName}` : "Imported system avoid", persistent: false });
    }
    for (const id of value.routingProfile.avoids.constellationIds ?? []) {
      const system = value.systems.find((row) => row.constellationId === id);
      rows.push({ key: `constellation:${id}`, scope: "constellation", scopeId: id, label: system?.constellationName ?? `Constellation ${id}`, detail: system ? `Constellation · ${system.regionName}` : "Imported constellation avoid", persistent: false });
    }
    for (const id of value.routingProfile.avoids.regionIds ?? []) {
      const system = value.systems.find((row) => row.regionId === id);
      rows.push({ key: `region:${id}`, scope: "region", scopeId: id, label: system?.regionName ?? `Region ${id}`, detail: "Imported region avoid", persistent: false });
    }
    return rows;
  }

  async function copyRouteJson(value: NavigationRoutePlan | null = route) {
    if (!value) { setRoutePacketMessage("Calculate or load a route first."); return; }
    try {
      const json = await window.sage.exportNavigationRouteJson(value);
      await window.sage.copyText(json);
      setRoutePacketMessage(`Copied ${value.name || "route"} as new-eden-sage.route.v1 JSON.`);
    } catch (error) { setRoutePacketMessage(error instanceof Error ? error.message : "Route JSON export failed."); }
  }

  async function downloadRouteJson(value: NavigationRoutePlan | null = route) {
    if (!value) { setRoutePacketMessage("Calculate or load a route first."); return; }
    try {
      const json = await window.sage.exportNavigationRouteJson(value);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${(value.name || "sage-route").replace(/[^a-z0-9-_]+/gi, "-").replace(/^-|-$/g, "") || "sage-route"}.sage-route.json`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setRoutePacketMessage(`Exported ${value.name || "route"} JSON.`);
    } catch (error) { setRoutePacketMessage(error instanceof Error ? error.message : "Route JSON export failed."); }
  }

  async function importRouteJson(text: string) {
    try {
      const value = await window.sage.importNavigationRouteJson(text);
      const entry: SavedRouteEntry = { id: value.routeId, name: value.name || `${value.origin?.name ?? "Route"} → ${value.destination?.name ?? "Destination"}`, route: value, avoids: routeAvoidsFromProfile(value), savedAt: new Date().toISOString() };
      setSavedRoutes((current) => { const without = current.filter((row) => row.id !== entry.id); return [entry, ...without]; });
      loadSavedRoute(entry);
      setRoutePacketMessage(`Imported ${entry.name} exactly from Sage route JSON.`);
      return true;
    } catch (error) { setRoutePacketMessage(error instanceof Error ? error.message : "Route JSON import failed."); return false; }
  }

  async function exportRouteToEve() {
    if (!route?.found || !selectedCharacterId) return;
    setExportMessage("Preparing ordered EVE-compatible waypoint chain…");
    try {
      const chain = await window.sage.getNavigationEveWaypointChain(route);
      if (!chain.systemIds.length) {
        setExportMessage(chain.stoppedAtSpecialEdge
          ? `The route begins with a Sage-only ${chain.stoppedAtSpecialEdge} connection, so there is no contiguous EVE gate segment to export.`
          : "No EVE-compatible gate waypoints are available to export.");
        return;
      }
      const result = await window.sage.exportNavigationRouteToEve({ characterId: selectedCharacterId, systemIds: chain.systemIds, clearOtherWaypoints: !exportAppend });
      setExportMessage(chain.complete
        ? `Exported ${result.waypoints} ordered waypoints to EVE.`
        : `Exported ${result.waypoints} ordered gate waypoints up to the first Sage-only ${chain.stoppedAtSpecialEdge} connection. Continue that special leg manually, then export the remaining route from Sage.`);
    } catch (error) { setExportMessage(error instanceof Error ? error.message : "Route export failed."); }
  }

  const characterRouteState = useMemo(() => {
    if (!characterLocation || !route?.found) return null;
    const index = route.systems.findIndex((system) => system.systemId === characterLocation.systemId);
    return {
      onRoute: index >= 0,
      index,
      remainingJumps: index >= 0 ? Math.max(0, route.legs.length - index) : route.totals.jumps,
    };
  }, [characterLocation?.systemId, route?.routeId, route?.version]);

  async function locationSystem(forceLive = true) {
    const location = forceLive ? await refreshCharacterLocation(true) : characterLocation ?? await refreshCharacterLocation(false);
    if (!location) return null;
    return window.sage.getNavigationSystem(location.systemId);
  }

  async function useCurrentSystemAsOrigin() {
    const system = await locationSystem(true);
    if (!system) { setLocationError("Current system is not present in the local universe graph."); return; }
    setOrigin(system);
    setMessage("Origin set to current character system: " + system.name + ".");
  }

  async function recalculateFromCurrentSystem() {
    const system = await locationSystem(true);
    if (!system) { setLocationError("Current system is not present in the local universe graph."); return; }
    let futureStops: NavigationSystem[] = [];
    if (route?.found) {
      const currentIndex = route.systems.findIndex((row) => row.systemId === system.systemId);
      if (currentIndex >= 0) {
        futureStops = waypoints.filter((waypoint) => {
          const routeIndex = route.systems.findIndex((row) => row.systemId === waypoint.systemId);
          return routeIndex > currentIndex;
        });
      } else {
        futureStops = waypoints.slice(1);
      }
    } else {
      futureStops = waypoints.slice(1);
    }
    const deduped = [system, ...futureStops.filter((row, index, array) => row.systemId !== system.systemId && array.findIndex((other) => other.systemId === row.systemId) === index)];
    if (deduped.length < 2 && destination && destination.systemId !== system.systemId) deduped.push(destination);
    commitWaypoints(deduped);
    if (deduped.length >= 2) {
      setMessage("Recalculating from current system while preserving future waypoints and compatible locks…");
      await calculatePlan(deduped);
    } else {
      setMessage("Current character is already at the final route destination.");
    }
  }

  const loadRouteIntelligence = useCallback(async () => {
    if (!route?.found) { setRouteIntelligence(null); setRouteIntelligenceError(""); return null; }
    setRouteIntelligenceBusy(true);
    try {
      const value = await window.sage.getNavigationRouteIntelligence({ systemIds: route.systems.map((system) => system.systemId), legs: route.legs });
      setRouteIntelligence(value);
      setRouteIntelligenceError("");
      return value;
    } catch (error) {
      setRouteIntelligenceError(error instanceof Error ? error.message : "Route intelligence refresh failed.");
      return null;
    } finally {
      setRouteIntelligenceBusy(false);
    }
  }, [route?.routeId, route?.version]);

  useEffect(() => { void loadRouteIntelligence(); }, [loadRouteIntelligence]);

  useEffect(() => {
    if (!route?.found) return;
    const routeIds = new Set(route.systems.map((system) => system.systemId));
    return window.sage.onSystemKillmailsUpdated((payload: any) => {
      const changed = Array.isArray(payload?.systemIds) ? payload.systemIds.map(Number) : [];
      if (changed.some((id: number) => routeIds.has(id))) void loadRouteIntelligence();
    });
  }, [route?.routeId, route?.version, loadRouteIntelligence]);

  function toggleHazard(provider: NavigationHazardProviderSnapshot) {
    if (!provider.available) return;
    setEnabledHazards((current) => current.includes(provider.id) ? current.filter((id) => id !== provider.id) : [...current, provider.id]);
  }

  const origin = waypoints[0] ?? null;
  const destination = waypoints.length > 1 ? waypoints.at(-1)! : null;

  const shared = {
    graphReady: Boolean(graph), graphError, hazards, hazardError, enabledHazards, toggleHazard,
    waypoints, origin, destination, setOrigin, setDestination, addWaypoint, insertWaypoint, removeWaypoint,
    commitWaypoints, reverseRoute, clearRoute, mode, setMode, floorPreset, setFloorPreset, customFloor, setCustomFloor,
    minSecurity, activeAvoids, addAvoid, removeAvoid, route, busy, message, calculatePlan, lockedSegments, toggleSegmentLock,
    customConnections, addCustomConnection, toggleCustomConnection, removeCustomConnection, enabledSpecialTypes, disabledSpecialNetworkIds, toggleSpecialType, toggleSpecialNetwork, favourites, recentDestinations, toggleFavourite, applyPreset,
    routeNotes, waypointAnnotations, updateRouteNotes, updateWaypointAnnotation, duplicateWorkingRoute, setSelectedAsOrigin, setSelectedAsDestination, removeSelectedStop, lockSelectedLeg, copyOrderedSystems, copyCompactSummary,
    savedRoutes, saveCurrentRoute, loadSavedRoute, renameSavedRoute, duplicateSavedRoute, deleteSavedRoute, routePacketMessage, copyRouteJson, downloadRouteJson, importRouteJson, characters, selectedCharacterId, setSelectedCharacterId, exportAppend, setExportAppend, exportMessage, exportRouteToEve,
    onlineWorkspace, onlineRoutes, onlineBusy, onlineMessage, onlineVisibility, setOnlineVisibility, onlineRecipientIds, setOnlineRecipientIds, loadedOnlineObject, ensureOnlineWorkspace, refreshOnlineRoutes, publishOnlineRoute, updateOnlineRoute, loadOnlineRoute,
    characterLocation, followCharacter, setFollowCharacter, locationBusy, locationError, characterRouteState, refreshCharacterLocation, useCurrentSystemAsOrigin, recalculateFromCurrentSystem,
    routeIntelligence, routeIntelligenceBusy, routeIntelligenceError, loadRouteIntelligence, selectedSystem, setSelectedSystem, selectedLegIndex, setSelectedLegIndex,
  };

  return (
    <section className="navigation-command">
      <div className="navigation-command-hero">
        <div>
          <p className="eyebrow">NEW EDEN NAVIGATION</p>
          <h2>Navigation Command</h2>
          <p>Build, constrain and hand-author Sage routes over the local CCP universe graph.</p>
        </div>
        <div className={`navigation-command-state ${graphError ? "error" : graph ? "ready" : "loading"}`}>
          <span>{graphError ? "GRAPH ERROR" : graph ? "LOCAL GRAPH READY" : "PREPARING GRAPH"}</span>
          <strong>{graphError || (graph ? `${graph.systems.toLocaleString()} systems · ${graph.edges.toLocaleString()} gate edges` : "Reading prepared universe data")}</strong>
          <small>{graph ? `${graph.source === "cache" ? "Prepared cache" : "CCP SDE"} · ${new Date(graph.preparedAt).toLocaleString()}` : "Routes remain local-first."}</small>
        </div>
      </div>

      <div className="navigation-command-tabs" role="tablist" aria-label="Navigation Command sections">
        {sections.map((item) => (
          <button key={item.id} role="tab" aria-selected={section === item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}>
            <span>{item.eyebrow}</span>
            <strong>{item.label}</strong>
          </button>
        ))}
      </div>

      <div className="navigation-command-stage">
        {section === "route" && <RoutePlanner {...shared} />}
        {section === "map" && <ManualMapBuilder {...shared} />}
        {section === "saved" && <SavedRoutesPanel {...shared} />}
        {section === "intelligence" && <RouteIntelligencePanel {...shared} />}
        {section === "capital" && <CapitalJumpPlanner {...shared} />}
      </div>
    </section>
  );
}

type SharedProps = {
  graphReady: boolean;
  graphError: string;
  hazards: NavigationHazardSnapshot | null;
  hazardError: string;
  enabledHazards: string[];
  toggleHazard(provider: NavigationHazardProviderSnapshot): void;
  waypoints: NavigationSystem[];
  origin: NavigationSystem | null;
  destination: NavigationSystem | null;
  setOrigin(system: NavigationSystem | null): void;
  setDestination(system: NavigationSystem | null): void;
  addWaypoint(system: NavigationSystem): void;
  insertWaypoint(index: number, system: NavigationSystem, after: boolean): void;
  removeWaypoint(index: number): void;
  commitWaypoints(next: NavigationSystem[]): void;
  reverseRoute(): void;
  clearRoute(): void;
  mode: NavigationRouteMode;
  setMode(value: NavigationRouteMode): void;
  floorPreset: FloorPreset;
  setFloorPreset(value: FloorPreset): void;
  customFloor: number;
  setCustomFloor(value: number): void;
  minSecurity: number | null;
  activeAvoids: AvoidEntry[];
  addAvoid(system: NavigationSystem, scope: AvoidScope, persistent?: boolean): void;
  removeAvoid(entry: AvoidEntry): void;
  route: NavigationRoutePlan | null;
  busy: boolean;
  message: string;
  calculatePlan(explicitWaypoints?: NavigationSystem[]): Promise<void>;
  lockedSegments: NavigationLockedSegment[];
  toggleSegmentLock(segmentIndex: number): void;
  customConnections: NavigationCustomConnection[];
  addCustomConnection(connection: Omit<NavigationCustomConnection, "connectionId">): void;
  toggleCustomConnection(id: string): void;
  removeCustomConnection(id: string): void;
  enabledSpecialTypes: NavigationEdgeType[];
  disabledSpecialNetworkIds: string[];
  toggleSpecialType(type: NavigationEdgeType): void;
  toggleSpecialNetwork(networkId: string): void;
  favourites: NavigationSystem[];
  recentDestinations: NavigationSystem[];
  toggleFavourite(system: NavigationSystem): void;
  applyPreset(id: string): void;
  routeNotes: string;
  waypointAnnotations: Record<string, NavigationWaypointAnnotation>;
  updateRouteNotes(value: string): void;
  updateWaypointAnnotation(systemId: number, field: "label" | "note", value: string): void;
  duplicateWorkingRoute(): void;
  setSelectedAsOrigin(): void;
  setSelectedAsDestination(): void;
  removeSelectedStop(): void;
  lockSelectedLeg(): void;
  copyOrderedSystems(): Promise<void>;
  copyCompactSummary(): Promise<void>;
    savedRoutes: SavedRouteEntry[];
  saveCurrentRoute(): void;
  loadSavedRoute(entry: SavedRouteEntry): void;
  renameSavedRoute(id: string, name: string): void;
  duplicateSavedRoute(entry: SavedRouteEntry): void;
  deleteSavedRoute(id: string): void;
  routePacketMessage: string;
  copyRouteJson(route?: NavigationRoutePlan | null): Promise<void>;
  downloadRouteJson(route?: NavigationRoutePlan | null): Promise<void>;
  importRouteJson(text: string): Promise<boolean>;
  onlineWorkspace: NavigationOnlineWorkspace | null;
  onlineRoutes: NavigationOnlineRouteSummary[];
  onlineBusy: boolean;
  onlineMessage: string;
  onlineVisibility: "workspace" | "restricted";
  setOnlineVisibility(value: "workspace" | "restricted"): void;
  onlineRecipientIds: string;
  setOnlineRecipientIds(value: string): void;
  loadedOnlineObject: { id: string; version: number; visibility: "workspace" | "restricted" } | null;
  ensureOnlineWorkspace(): Promise<NavigationOnlineWorkspace | null>;
  refreshOnlineRoutes(): Promise<void>;
  publishOnlineRoute(): Promise<void>;
  updateOnlineRoute(): Promise<void>;
  loadOnlineRoute(summary: NavigationOnlineRouteSummary): Promise<void>;
  characters: ConnectedCharacter[];
  selectedCharacterId: string;
  setSelectedCharacterId(id: string): void;
  exportAppend: boolean;
  setExportAppend(value: boolean): void;
  exportMessage: string;
  exportRouteToEve(): Promise<void>;
  characterLocation: NavigationCharacterLocation | null;
  followCharacter: boolean;
  setFollowCharacter(value: boolean): void;
  locationBusy: boolean;
  locationError: string;
  characterRouteState: { onRoute: boolean; index: number; remainingJumps: number } | null;
  refreshCharacterLocation(forceLive?: boolean): Promise<NavigationCharacterLocation | null>;
  useCurrentSystemAsOrigin(): Promise<void>;
  recalculateFromCurrentSystem(): Promise<void>;
  routeIntelligence: NavigationRouteIntelligence | null;
  routeIntelligenceBusy: boolean;
  routeIntelligenceError: string;
  loadRouteIntelligence(): Promise<NavigationRouteIntelligence | null>;
  selectedSystem: NavigationSystem | null;
  setSelectedSystem(system: NavigationSystem | null): void;
  selectedLegIndex: number | null;
  setSelectedLegIndex(index: number | null): void;
};


function DestinationQuickChoices({ props }: { props: SharedProps }) {
  const currentCharacter = props.characters.find((row) => row.characterId === props.selectedCharacterId);
  return <div className="navigation-destination-quick">
    <div className="navigation-panel-title"><div><span>Smart destination shortcuts</span><small>Recent destinations, favourites and the selected character's real Sage location—never inferred fleet positions.</small></div><b>{props.recentDestinations.length} RECENT</b></div>
    <div className="navigation-destination-quick-actions">
      {props.characterLocation && <button type="button" onClick={() => void props.useCurrentSystemAsOrigin()}><strong>Current → origin</strong><small>{props.characterLocation.systemName} · {currentCharacter?.name ?? props.characterLocation.characterName}</small></button>}
      {props.characterLocation && props.origin && <button type="button" onClick={() => void window.sage.getNavigationSystem(props.characterLocation!.systemId).then((system) => { if (system) props.setDestination(system); })}><strong>Current → destination</strong><small>{props.characterLocation.systemName} · {currentCharacter?.name ?? props.characterLocation.characterName}</small></button>}
      {props.favourites.slice(0, 5).map((system) => <button type="button" key={`fav-${system.systemId}`} onClick={() => props.setDestination(system)}><strong>★ {system.name}</strong><small>{system.regionName} · {displaySecurity(system.securityStatus).toFixed(1)}</small></button>)}
      {props.recentDestinations.filter((system) => !props.favourites.some((fav) => fav.systemId === system.systemId)).slice(0, 5).map((system) => <button type="button" key={`recent-${system.systemId}`} onClick={() => props.setDestination(system)}><strong>{system.name}</strong><small>Recent · {system.regionName} · {displaySecurity(system.securityStatus).toFixed(1)}</small></button>)}
      {!props.characterLocation && !props.favourites.length && !props.recentDestinations.length && <small>No shortcuts yet. Pick destinations or star systems and Sage will keep them here.</small>}
    </div>
  </div>;
}

function RouteOperationsPanel({ props }: { props: SharedProps }) {
  const [appendSystem, setAppendSystem] = useState<NavigationSystem | null>(null);
  const [insertSystem, setInsertSystem] = useState<NavigationSystem | null>(null);
  const selectedWaypointIndex = props.selectedSystem ? props.waypoints.findIndex((row) => row.systemId === props.selectedSystem?.systemId) : -1;
  function append() {
    if (!appendSystem || !props.waypoints.length) return;
    props.commitWaypoints([...props.waypoints, appendSystem]);
    setAppendSystem(null);
  }
  function insert() {
    if (!insertSystem || !props.waypoints.length) return;
    const index = selectedWaypointIndex >= 0 ? selectedWaypointIndex : Math.max(1, props.waypoints.length - 1);
    props.commitWaypoints([...props.waypoints.slice(0, index), insertSystem, ...props.waypoints.slice(index)]);
    setInsertSystem(null);
  }
  const selectedSegment = props.selectedLegIndex == null || !props.route ? null : props.route.segments.find((segment) => segment.legs.some((leg) => leg.from === props.route?.legs[props.selectedLegIndex!]?.from && leg.to === props.route?.legs[props.selectedLegIndex!]?.to));
  return <div className="navigation-route-operations">
    <div className="navigation-panel-title"><div><span>Route operations</span><small>Common route edits operate on the current Sage route object—no manual rebuild required.</small></div><b>{props.route?.found ? `${props.route.totals.jumps} JUMPS` : "DRAFT"}</b></div>
    <div className="navigation-route-operation-buttons">
      <button type="button" disabled={props.waypoints.length < 2} onClick={props.reverseRoute}>Reverse</button>
      <button type="button" disabled={props.waypoints.length < 2 || props.busy} onClick={() => void props.calculatePlan()}>Recalculate</button>
      <button type="button" disabled={!props.route?.found} onClick={props.duplicateWorkingRoute}>Duplicate</button>
      <button type="button" disabled={!props.selectedSystem} onClick={props.setSelectedAsOrigin}>Selected → origin</button>
      <button type="button" disabled={!props.selectedSystem || !props.origin} onClick={props.setSelectedAsDestination}>Selected → destination</button>
      <button type="button" disabled={selectedWaypointIndex < 0} onClick={props.removeSelectedStop}>Remove selected stop</button>
      <button type="button" disabled={props.selectedLegIndex == null || !props.route?.found} onClick={props.lockSelectedLeg}>{selectedSegment?.locked ? "Unlock selected segment" : "Lock selected segment"}</button>
    </div>
    <div className="navigation-route-operation-builders">
      <div><SystemPicker label="Append new destination" selected={appendSystem} onSelect={setAppendSystem} disabled={!props.graphReady || !props.waypoints.length} compact /><button type="button" disabled={!appendSystem} onClick={append}>Append</button></div>
      <div><SystemPicker label="Insert stop" selected={insertSystem} onSelect={setInsertSystem} disabled={!props.graphReady || !props.waypoints.length} compact /><button type="button" disabled={!insertSystem} onClick={insert}>Insert {selectedWaypointIndex >= 0 ? `before ${props.waypoints[selectedWaypointIndex]?.name}` : "before destination"}</button></div>
    </div>
  </div>;
}

function RouteNotesPanel({ props }: { props: SharedProps }) {
  return <div className="navigation-route-notes">
    <div className="navigation-panel-title"><div><span>Route notes & waypoint labels</span><small>Stored inside route schema v4, so notes survive local save, JSON export and Sage Online sharing.</small></div><b>SCHEMA V4</b></div>
    <label className="navigation-route-note-main"><span>Route notes</span><textarea value={props.routeNotes} onChange={(event) => props.updateRouteNotes(event.target.value)} placeholder="Form-up instructions, hauling cautions, cyno notes, timers…" /><small>{props.routeNotes.length}/6000</small></label>
    <div className="navigation-waypoint-note-list">
      {props.waypoints.map((system, index) => {
        const annotation = props.waypointAnnotations[String(system.systemId)] ?? {};
        return <div key={`${system.systemId}:${index}`} className="navigation-waypoint-note-row"><b>{index + 1}</b><div><strong>{system.name}</strong><small>{system.regionName} · {displaySecurity(system.securityStatus).toFixed(1)}</small></div><input value={annotation.label ?? ""} onChange={(event) => props.updateWaypointAnnotation(system.systemId, "label", event.target.value)} placeholder="Waypoint label" /><input value={annotation.note ?? ""} onChange={(event) => props.updateWaypointAnnotation(system.systemId, "note", event.target.value)} placeholder="Waypoint note" /></div>;
      })}
      {!props.waypoints.length && <small>Add route stops to annotate them.</small>}
    </div>
  </div>;
}

function MemberRouteContext({ props }: { props: SharedProps }) {
  const routeIds = new Set(props.route?.systems.map((system) => system.systemId) ?? []);
  const formUpId = props.route?.destination?.systemId;
  const rows = props.characters.map((character) => {
    const live = character.characterId === props.selectedCharacterId ? props.characterLocation : null;
    const systemId = live?.systemId ?? character.systemId;
    const systemName = live?.systemName ?? character.systemName;
    const status = !systemId ? "Location unavailable" : systemId === formUpId ? "At form-up" : routeIds.has(systemId) ? "On route" : "Off route";
    return { ...character, systemId, systemName, status, live: Boolean(live) };
  });
  return <div className="navigation-member-context">
    <div className="navigation-panel-title"><div><span>Connected member / form-up context</span><small>Only connected characters with real Sage snapshot or selected-character live ESI location appear. Sage does not infer corporation or fleet positions.</small></div><b>{rows.filter((row) => row.systemId).length}/{rows.length} KNOWN</b></div>
    <div className="navigation-member-context-list">
      {rows.map((row) => <div key={row.characterId} className={`navigation-member-row ${row.status.toLowerCase().replace(/\s+/g, "-")}`}><div><strong>{row.name}</strong><small>{row.live ? "Live ESI" : row.systemId ? "Synced Sage snapshot" : "No location data"}</small></div><span>{row.systemName ?? "—"}</span><b>{row.status}</b></div>)}
      {!rows.length && <div className="navigation-compact-empty">No connected Sage characters are available.</div>}
    </div>
  </div>;
}

function SageOnlineRoutesPanel({ props }: { props: SharedProps }) {
  return <article className="navigation-online-routes">
    <div className="navigation-panel-title"><div><span>Sage Online route sharing</span><small>Corporation routes are server-authoritative. Restricted routes are visible only to selected active Sage-linked members. Loading a route never grants server edit permission.</small></div><b>{props.onlineWorkspace ? "CONNECTED" : "OFFLINE"}</b></div>
    <div className="navigation-online-toolbar">
      <select value={props.selectedCharacterId} onChange={(event) => props.setSelectedCharacterId(event.target.value)}><option value="">Choose character</option>{props.characters.map((character) => <option key={character.characterId} value={character.characterId}>{character.name}</option>)}</select>
      <button type="button" disabled={!props.selectedCharacterId || props.onlineBusy} onClick={() => void props.ensureOnlineWorkspace()}>{props.onlineWorkspace ? "Reverify workspace" : "Connect corporation workspace"}</button>
      <button type="button" disabled={!props.onlineWorkspace || props.onlineBusy} onClick={() => void props.refreshOnlineRoutes()}>Refresh shared routes</button>
      {props.onlineWorkspace && <span><strong>{props.onlineWorkspace.corporation_name}</strong><small>{props.onlineWorkspace.can_publish_routes ? "route.publish authorised" : "read-only member"}</small></span>}
    </div>
    {props.onlineWorkspace && <div className="navigation-online-publish">
      <div><label><span>Audience</span><select value={props.onlineVisibility} onChange={(event) => props.setOnlineVisibility(event.target.value as "workspace" | "restricted")}><option value="workspace">Corporation workspace</option><option value="restricted">Fleet / selected Sage members</option></select></label>{props.onlineVisibility === "restricted" && <label><span>Recipient EVE character IDs</span><input value={props.onlineRecipientIds} onChange={(event) => props.setOnlineRecipientIds(event.target.value)} placeholder="12345678, 87654321" /><small>Recipients must already be active Sage-linked members of this corporation workspace.</small></label>}</div>
      <div><button type="button" className="navigation-primary" disabled={!props.route?.found || !props.onlineWorkspace.can_publish_routes || props.onlineBusy} onClick={() => void props.publishOnlineRoute()}>Publish current route</button><button type="button" disabled={!props.loadedOnlineObject || !props.onlineWorkspace.can_publish_routes || !props.route?.found || props.onlineBusy} onClick={() => void props.updateOnlineRoute()}>Update shared route v{props.loadedOnlineObject?.version ?? "—"}</button></div>
    </div>}
    {props.onlineMessage && <small className="navigation-online-message">{props.onlineMessage}</small>}
    <div className="navigation-online-route-list">
      {props.onlineRoutes.map((shared) => <div key={shared.id}><div><strong>{shared.id}</strong><small>{shared.visibility === "restricted" ? "Restricted ACL" : "Corporation workspace"} · server v{shared.current_version} · {new Date(shared.updated_at).toLocaleString()}</small></div><button type="button" disabled={props.onlineBusy} onClick={() => void props.loadOnlineRoute(shared)}>Load read-only source</button></div>)}
      {props.onlineWorkspace && !props.onlineRoutes.length && <div className="navigation-compact-empty">No Sage Online routes are visible to this account yet.</div>}
    </div>
  </article>;
}

function RoutePlanner(props: SharedProps) {
  return (
    <div className="navigation-route-planner">
      <div className="navigation-section-heading">
        <div>
          <p className="eyebrow">ROUTE PLANNER</p>
          <h3>Build a route across New Eden</h3>
          <p>Compose as many explicit stops as you need, then apply strict security, avoid and live-hazard constraints to every segment.</p>
        </div>
        <span className={`navigation-status-chip ${props.graphReady ? "ready" : props.graphError ? "error" : ""}`}>{props.graphReady ? "LOCAL GRAPH" : props.graphError ? "UNAVAILABLE" : "PREPARING"}</span>
      </div>

      <article className="navigation-route-control-card">
        <div className="navigation-picker-grid">
          <SystemPicker label="Origin" selected={props.origin} onSelect={props.setOrigin} disabled={!props.graphReady} clearOnType={false} />
          <div className="navigation-route-arrow" aria-hidden="true">→</div>
          <SystemPicker label="Destination" selected={props.destination} onSelect={props.setDestination} disabled={!props.graphReady || !props.origin} clearOnType={false} />
        </div>
        <DestinationQuickChoices props={props} />

        <CharacterRouteControl props={props} />

        <WaypointSequence waypoints={props.waypoints} onChange={props.commitWaypoints} onRemove={props.removeWaypoint} onAdd={props.addWaypoint} disabled={!props.graphReady} />
        <RouteOperationsPanel props={props} />
        <NavigationQuickTools props={props} />

        <div className="navigation-planner-grid">
          <div className="navigation-planner-column">
            <div className="navigation-control-block">
              <div className="navigation-control-copy"><span>Route mode</span><small>One weighted solver; different route profiles.</small></div>
              <div className="navigation-mode-buttons">
                {(Object.keys(modeLabels) as NavigationRouteMode[]).map((value) => <button key={value} className={props.mode === value ? "active" : ""} onClick={() => props.setMode(value)}>{modeLabels[value]}</button>)}
              </div>
            </div>

            <div className="navigation-control-block">
              <div className="navigation-control-copy"><span>Minimum security</span><small>A hard floor, never merely a preference.</small></div>
              <div className="navigation-security-controls">
                <select value={props.mode === "high-sec" ? "high" : props.floorPreset} disabled={props.mode === "high-sec"} onChange={(event) => props.setFloorPreset(event.target.value as FloorPreset)}>
                  <option value="any">Any security</option>
                  <option value="low">0.4 and above</option>
                  <option value="high">High-sec · 0.5 and above</option>
                  <option value="custom">Custom floor</option>
                </select>
                {props.floorPreset === "custom" && props.mode !== "high-sec" && <input type="number" min="-1" max="1" step="0.1" value={props.customFloor} onChange={(event) => props.setCustomFloor(Number(event.target.value))} aria-label="Custom security floor" />}
              </div>
            </div>

            <DynamicHazards hazards={props.hazards} error={props.hazardError} enabled={props.enabledHazards} onToggle={props.toggleHazard} />
          </div>

          <AvoidManager graphReady={props.graphReady} avoids={props.activeAvoids} onAdd={props.addAvoid} onRemove={props.removeAvoid} />
        </div>

        <RouteNotesPanel props={props} />
        <MemberRouteContext props={props} />
        <ExportRoutePanel props={props} />

        <div className="navigation-calculate-row">
          <div><strong>{props.message}</strong><small>{props.minSecurity == null ? "No strict security floor." : `Strict floor: ${props.minSecurity.toFixed(1)}+ displayed security.`}</small></div>
          <div className="navigation-action-cluster">
            <button type="button" disabled={props.waypoints.length < 2} onClick={props.reverseRoute}>Reverse</button>
            <button type="button" disabled={!props.waypoints.length} onClick={props.clearRoute}>Clear</button>
            <button className="navigation-primary" disabled={!props.graphReady || props.waypoints.length < 2 || props.busy} onClick={() => void props.calculatePlan()}>{props.busy ? "Calculating…" : "Calculate route"}</button>
          </div>
        </div>
      </article>

      {props.route?.found ? <RoutePlanResult route={props.route} onToggleLock={props.toggleSegmentLock} /> : props.route ? <div className="navigation-route-error"><strong>No valid route</strong><span>{props.route.reason}</span></div> : <div className="navigation-route-empty"><div className="navigation-route-line"><i /><i /><i /></div><strong>Your route will appear here</strong><span>Every explicit stop becomes a segment in one shared Sage route object.</span></div>}
    </div>
  );
}

function WaypointSequence({ waypoints, onChange, onRemove, onAdd, disabled }: { waypoints: NavigationSystem[]; onChange(value: NavigationSystem[]): void; onRemove(index: number): void; onAdd(system: NavigationSystem): void; disabled: boolean }) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [addCandidate, setAddCandidate] = useState<NavigationSystem | null>(null);

  function move(from: number, to: number) {
    if (from === to) return;
    const next = [...waypoints];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  }

  return <div className="navigation-waypoints-panel">
    <div className="navigation-panel-title"><div><span>Explicit route stops</span><small>Drag to reorder. Sage recalculates every unlocked segment after a calculated route changes.</small></div><b>{waypoints.length} stop{waypoints.length === 1 ? "" : "s"}</b></div>
    {waypoints.length ? <div className="navigation-waypoint-list">
      {waypoints.map((system, index) => <div className="navigation-waypoint-row" key={`${system.systemId}:${index}`} draggable onDragStart={() => setDragIndex(index)} onDragEnd={() => setDragIndex(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragIndex != null) move(dragIndex, index); setDragIndex(null); }}>
        <span className="navigation-drag-handle">⋮⋮</span>
        <b>{index + 1}</b>
        <div><strong>{system.name}</strong><small>{index === 0 ? "Origin" : index === waypoints.length - 1 ? "Destination" : "Waypoint"} · {system.regionName}</small></div>
        <em className={securityClass(system.securityStatus)}>{displaySecurity(system.securityStatus).toFixed(1)}</em>
        <button type="button" onClick={() => onRemove(index)} aria-label={`Remove ${system.name}`}>×</button>
      </div>)}
    </div> : <div className="navigation-waypoint-empty">Choose an origin to start the ordered stop list.</div>}
    <div className="navigation-add-waypoint">
      <SystemPicker label="Add waypoint" selected={addCandidate} onSelect={(system) => { setAddCandidate(system); if (system) { onAdd(system); setTimeout(() => setAddCandidate(null), 0); } }} disabled={disabled} compact />
      <small>New waypoints are inserted immediately before the current destination.</small>
    </div>
  </div>;
}

function AvoidManager({ graphReady, avoids, onAdd, onRemove }: { graphReady: boolean; avoids: AvoidEntry[]; onAdd(system: NavigationSystem, scope: AvoidScope, persistent?: boolean): void; onRemove(entry: AvoidEntry): void }) {
  const [candidate, setCandidate] = useState<NavigationSystem | null>(null);
  const [persistent, setPersistent] = useState(false);
  return <div className="navigation-avoid-panel">
    <div className="navigation-panel-title"><div><span>Avoid list</span><small>Block a system, its constellation or its whole region.</small></div><b>{avoids.length}</b></div>
    <SystemPicker label="Find location to avoid" selected={candidate} onSelect={setCandidate} disabled={!graphReady} compact />
    {candidate && <div className="navigation-avoid-actions">
      <button type="button" onClick={() => onAdd(candidate, "system", persistent)}>Avoid {candidate.name}</button>
      <button type="button" onClick={() => onAdd(candidate, "constellation", persistent)}>Constellation</button>
      <button type="button" onClick={() => onAdd(candidate, "region", persistent)}>Region</button>
    </div>}
    <label className="navigation-persist-toggle"><input type="checkbox" checked={persistent} onChange={(event) => setPersistent(event.target.checked)} /><span><strong>Save globally</strong><small>Persistent across Sage restarts instead of this route session only.</small></span></label>
    <div className="navigation-avoid-list">
      {avoids.map((entry) => <div key={`${entry.persistent ? "g" : "t"}:${entry.key}`} className="navigation-avoid-row"><div><strong>{entry.label}</strong><small>{entry.detail} · {entry.persistent ? "GLOBAL" : "TEMPORARY"}</small></div><button type="button" onClick={() => onRemove(entry)}>Remove</button></div>)}
      {!avoids.length && <div className="navigation-compact-empty">No active avoids.</div>}
    </div>
  </div>;
}

function DynamicHazards({ hazards, error, enabled, onToggle }: { hazards: NavigationHazardSnapshot | null; error: string; enabled: string[]; onToggle(provider: NavigationHazardProviderSnapshot): void }) {
  return <div className="navigation-hazard-panel">
    <div className="navigation-panel-title"><div><span>Dynamic exclusions</span><small>Current-state providers plug into the route profile without changing the graph.</small></div>{hazards && <b>{new Date(hazards.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</b>}</div>
    {error && <div className="navigation-hazard-error">{error}</div>}
    {!hazards && !error && <div className="navigation-compact-empty">Loading current hazard providers…</div>}
    {hazards?.providers.map((provider) => <button type="button" key={provider.id} disabled={!provider.available} className={`navigation-hazard-toggle ${enabled.includes(provider.id) ? "active" : ""}`} onClick={() => onToggle(provider)}>
      <span className="navigation-toggle-dot" />
      <div><strong>{provider.label}</strong><small>{provider.note}</small></div>
      <b>{provider.available ? provider.systemIds.length : "N/A"}</b>
    </button>)}
  </div>;
}

function ManualMapBuilder(props: SharedProps) {
  const [activeWaypointIndex, setActiveWaypointIndex] = useState(0);
  const [context, setContext] = useState<{ system: NavigationSystem; x: number; y: number } | null>(null);
  const activeAnchor = props.waypoints[activeWaypointIndex] ?? null;

  useEffect(() => {
    if (activeWaypointIndex >= props.waypoints.length) setActiveWaypointIndex(Math.max(0, props.waypoints.length - 1));
  }, [props.waypoints.length, activeWaypointIndex]);

  function action(kind: "add" | "before" | "after" | "remove" | "avoid", system: NavigationSystem) {
    if (kind === "add") props.commitWaypoints([...props.waypoints, system]);
    else if (kind === "before" && activeAnchor) props.insertWaypoint(activeWaypointIndex, system, false);
    else if (kind === "after" && activeAnchor) props.insertWaypoint(activeWaypointIndex, system, true);
    else if (kind === "remove") {
      const preferred = props.waypoints[activeWaypointIndex]?.systemId === system.systemId ? activeWaypointIndex : props.waypoints.findIndex((item) => item.systemId === system.systemId);
      if (preferred >= 0) props.removeWaypoint(preferred);
    } else if (kind === "avoid") props.addAvoid(system, "system", false);
    setContext(null);
  }

  return <div className="navigation-manual-map">
    <div className="navigation-section-heading">
      <div><p className="eyebrow">UNIVERSE NAVIGATION MAP</p><h3>Build and inspect the route visually</h3><p>Universe, regional and route-local views share the same route object and intelligence model. Pan, zoom, select or right-click systems without leaving Navigation Command.</p></div>
      <span className="navigation-status-chip ready">INTERACTIVE MAP</span>
    </div>

    <div className="navigation-map-commandbar">
      <div className="navigation-map-anchor-list">
        <span>Insertion anchor</span>
        <div>{props.waypoints.map((system, index) => <button type="button" key={`${system.systemId}:${index}`} className={activeWaypointIndex === index ? "active" : ""} onClick={() => { setActiveWaypointIndex(index); props.setSelectedSystem(system); }}><b>{index + 1}</b><span>{system.name}</span></button>)}{!props.waypoints.length && <small>No route stops yet. Right-click any map system and choose Add next.</small>}</div>
      </div>
      <div className="navigation-map-route-actions"><button type="button" disabled={props.waypoints.length < 2} onClick={props.reverseRoute}>Reverse</button><button type="button" disabled={!props.waypoints.length} onClick={props.clearRoute}>Clear</button><button type="button" className="navigation-primary" disabled={props.waypoints.length < 2 || props.busy} onClick={() => void props.calculatePlan()}>{props.busy ? "Calculating…" : "Calculate route"}</button></div>
    </div>

    <div className="navigation-map-workspace-grid">
      <NavigationUniverseMap
        route={props.route}
        intelligence={props.routeIntelligence}
        characterLocation={props.characterLocation}
        selectedSystemId={props.selectedSystem?.systemId ?? null}
        selectedLegIndex={props.selectedLegIndex}
        onSelectSystem={(system) => props.setSelectedSystem(system)}
        onSelectLeg={(index) => props.setSelectedLegIndex(index)}
        onContextSystem={(system, x, y) => { props.setSelectedSystem(system); setContext({ system, x, y }); }}
      />
      <aside className="navigation-map-route-list">
        {props.route?.found ? <NavigationRouteList route={props.route} intelligence={props.routeIntelligence} selectedSystemId={props.selectedSystem?.systemId ?? null} selectedLegIndex={props.selectedLegIndex} onSelectSystem={props.setSelectedSystem} onSelectLeg={props.setSelectedLegIndex} compact /> : <div className="navigation-route-empty"><strong>No calculated route yet</strong><span>The map is still fully navigable. Right-click systems to author stops, then calculate the route.</span></div>}
      </aside>
    </div>

    {context && <div className="navigation-map-context navigation-map-context-fixed" style={{ left: Math.min(window.innerWidth - 250, context.x + 8), top: Math.min(window.innerHeight - 270, context.y + 8) }} onClick={(event) => event.stopPropagation()}>
      <strong>{context.system.name}</strong><small>{context.system.regionName} · {displaySecurity(context.system.securityStatus).toFixed(1)}</small>
      <button type="button" onClick={() => action("add", context.system)}>Add next</button>
      <button type="button" disabled={!activeAnchor} onClick={() => action("before", context.system)}>Insert before {activeAnchor?.name ?? "waypoint"}</button>
      <button type="button" disabled={!activeAnchor} onClick={() => action("after", context.system)}>Insert after {activeAnchor?.name ?? "waypoint"}</button>
      <button type="button" disabled={!props.waypoints.some((item) => item.systemId === context.system.systemId)} onClick={() => action("remove", context.system)}>Remove from route</button>
      <button type="button" onClick={() => action("avoid", context.system)}>Avoid system</button>
      <button type="button" onClick={() => setContext(null)}>Close</button>
    </div>}

    <CustomConnectionPanel props={props} />
    <div className="navigation-map-strip"><span>{props.waypoints.length ? props.waypoints.map((system) => system.name).join(" → ") : "No map-authored stops yet."}</span><b>{props.route?.found ? `${props.route.totals.jumps} jumps` : `${props.waypoints.length} explicit stops`}</b></div>
  </div>;
}

function SystemPicker({ label, selected, onSelect, disabled, compact = false, clearOnType = true }: { label: string; selected: NavigationSystem | null; onSelect(value: NavigationSystem | null): void; disabled: boolean; compact?: boolean; clearOnType?: boolean }) {
  const [query, setQuery] = useState(selected?.name ?? "");
  const [results, setResults] = useState<NavigationSystem[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => { setQuery(selected?.name ?? ""); }, [selected?.systemId]);
  useEffect(() => {
    if (disabled || selected?.name === query || query.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => window.sage.searchNavigationSystems(query.trim(), 12).then((value) => { if (!cancelled) { setResults(value); setOpen(true); } }).catch(() => { if (!cancelled) setResults([]); }), 100);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, disabled, selected?.name]);

  return <label className={`navigation-system-picker ${compact ? "compact" : ""}`}>
    <span>{label}</span>
    <div className="navigation-system-input">
      <input disabled={disabled} value={query} placeholder={disabled ? "Preparing local graph…" : "Search solar system…"} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); if (clearOnType) onSelect(null); }} />
      {selected && <button type="button" onClick={() => { onSelect(null); setQuery(""); setResults([]); }}>×</button>}
    </div>
    {selected && !compact && <small>{selected.regionName} · {displaySecurity(selected.securityStatus).toFixed(1)} security</small>}
    {open && results.length > 0 && <div className="navigation-system-results">
      {results.map((system) => <button type="button" key={system.systemId} onMouseDown={(event) => event.preventDefault()} onClick={() => { onSelect(system); setQuery(system.name); setResults([]); setOpen(false); }}>
        <strong>{system.name}</strong><span>{system.regionName} · {system.constellationName}</span><b>{displaySecurity(system.securityStatus).toFixed(1)}</b>
      </button>)}
    </div>}
  </label>;
}

function RoutePlanResult({ route, compact = false, onToggleLock }: { route: NavigationRoutePlan; compact?: boolean; onToggleLock?: (segmentIndex: number) => void }) {
  return <div className={`navigation-route-result ${compact ? "compact" : ""}`}>
    <div className="navigation-route-result-head"><div><span>ROUTE OBJECT · v{route.schemaVersion}</span><strong>{route.name}</strong><small>{route.routeId}</small></div><b>{route.waypoints.length} explicit stops · {route.segments.length} segments</b></div>
    <div className="navigation-route-metrics">
      <article><span>Jumps</span><strong>{route.totals.jumps}</strong><small>{modeLabels[route.routingProfile.mode]}</small></article>
      <article><span>Minimum security</span><strong>{route.totals.minimumDisplayedSecurityStatus.toFixed(1)}</strong><small>{route.routingProfile.minSecurity == null ? "No strict floor" : `${route.routingProfile.minSecurity.toFixed(1)}+ required`}</small></article>
      <article><span>Regions</span><strong>{route.totals.regionCount}</strong><small>{route.totals.securityTransitions} security-band transition{route.totals.securityTransitions === 1 ? "" : "s"}</small></article>
      <article><span>Constraints</span><strong>{route.routingProfile.avoids.systemIds.length + route.routingProfile.avoids.constellationIds.length + route.routingProfile.avoids.regionIds.length}</strong><small>{route.routingProfile.dynamicHazards.providerIds.length} dynamic provider{route.routingProfile.dynamicHazards.providerIds.length === 1 ? "" : "s"}</small></article>
    </div>
    {!compact && <div className="navigation-segment-locks">
      {route.segments.map((segment, index) => <div key={segment.segmentId} className={`navigation-segment-lock ${segment.locked ? "locked" : ""}`}>
        <div><span>SEGMENT {index + 1}</span><strong>{segment.systems[0]?.name} → {segment.systems.at(-1)?.name}</strong><small>{segment.jumps} jumps · {segment.manual ? "custom edge in path" : "gate path"}</small></div>
        <button type="button" onClick={() => onToggleLock?.(index)}>{segment.locked ? "Unlock exact path" : "Lock exact path"}</button>
      </div>)}
    </div>}
    {!compact && <div className="navigation-route-table">
      <div className="navigation-route-row heading"><span>#</span><span>Solar system</span><span>Security</span><span>Via</span><span>Region</span></div>
      {route.systems.map((system, index) => {
        const leg = index > 0 ? route.legs[index - 1] : null;
        const waypointIndex = route.waypoints.findIndex((waypoint) => waypoint.systemId === system.systemId);
        return <div className={`navigation-route-row ${waypointIndex >= 0 ? "waypoint" : ""}`} key={`${system.systemId}-${index}`}>
          <span>{index}</span><strong>{system.name}{waypointIndex >= 0 && <em>W{waypointIndex + 1}</em>}</strong><b className={securityClass(system.securityStatus)}>{displaySecurity(system.securityStatus).toFixed(1)}</b><span>{leg?.type ?? "START"}</span><span>{system.regionName}</span>
        </div>;
      })}
    </div>}
  </div>;
}

function CharacterRouteControl({ props }: { props: SharedProps }) {
  const character = props.characters.find((row) => row.characterId === props.selectedCharacterId);
  const routeState = props.characterRouteState;
  return <div className={`navigation-character-route ${routeState && !routeState.onRoute ? "off-route" : ""}`}>
    <div className="navigation-character-route-head"><div><span>CURRENT CHARACTER</span><strong>{character?.name ?? "Choose a connected character"}</strong><small>Use live EVE location without running a full character sync.</small></div>{props.characterLocation && <b>{props.characterLocation.systemName}</b>}</div>
    <div className="navigation-character-route-controls">
      <select value={props.selectedCharacterId} onChange={(event) => props.setSelectedCharacterId(event.target.value)} aria-label="Navigation character"><option value="">Choose character</option>{props.characters.map((row) => <option key={row.characterId} value={row.characterId}>{row.name}</option>)}</select>
      <button type="button" disabled={!props.selectedCharacterId || props.locationBusy} onClick={() => void props.refreshCharacterLocation(true)}>{props.locationBusy ? "Checking…" : "Refresh location"}</button>
      <button type="button" disabled={!props.selectedCharacterId || props.locationBusy} onClick={() => void props.useCurrentSystemAsOrigin()}>Use current system</button>
      <label className="navigation-follow-toggle"><input type="checkbox" checked={props.followCharacter} disabled={!props.selectedCharacterId} onChange={(event) => props.setFollowCharacter(event.target.checked)} /><span>Follow character</span></label>
    </div>
    <div className="navigation-character-route-status">
      {props.characterLocation ? <><strong>{props.characterLocation.systemName}</strong><span>{props.characterLocation.source === "live-esi" ? "LIVE ESI" : "SYNCED SNAPSHOT"} · {new Date(props.characterLocation.observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></> : <span>No character location loaded.</span>}
      {routeState && <div className={routeState.onRoute ? "on-route" : "off-route"}><b>{routeState.onRoute ? `ON ROUTE · ${routeState.remainingJumps} jumps remaining` : "OFF PLANNED ROUTE"}</b>{!routeState.onRoute && <button type="button" disabled={props.locationBusy} onClick={() => void props.recalculateFromCurrentSystem()}>Recalculate from current</button>}</div>}
    </div>
    {props.locationError && <small className="navigation-character-route-error">{props.locationError}</small>}
  </div>;
}

function RouteIntelligencePanel(props: SharedProps) {
  const intel = props.routeIntelligence;
  const rows = intel?.systems ?? [];
  const total = (windowKey: "1h" | "2h" | "6h" | "24h", key: "kills" | "gateKills") => rows.reduce((sum, row) => sum + Number(row.killWindows[windowKey]?.[key] ?? 0), 0);
  const dangerCounts = rows.reduce((acc, row) => { const state = row.routeGate?.danger.state; if (state) acc[state] = (acc[state] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  const worst = rows.map((row) => row.routeGate?.danger).filter(Boolean).sort((a, b) => Number(b?.score ?? 0) - Number(a?.score ?? 0))[0];
  return <div className="navigation-route-intelligence">
    <div className="navigation-section-heading"><div><p className="eyebrow">ROUTE INTELLIGENCE</p><h3>Threat, traffic and infrastructure along the route</h3><p>One decorated route model combines shared zKill/ESI activity, gate geometry, danger classification, sovereignty, hazards and known infrastructure.</p></div><button type="button" className="navigation-primary" disabled={!props.route?.found || props.routeIntelligenceBusy} onClick={() => void props.loadRouteIntelligence()}>{props.routeIntelligenceBusy ? "Refreshing…" : "Refresh route intel"}</button></div>
    {!props.route?.found ? <div className="navigation-route-empty"><strong>Calculate a route first</strong><span>Route Intelligence decorates every system and outgoing route gate.</span></div> : <>
      <div className="navigation-intel-summary">
        <article><span>Route systems</span><strong>{props.route.systems.length}</strong><small>{intel ? "Single decorated model" : "Loading shared intelligence…"}</small></article>
        <article><span>Kills · 1 hour</span><strong>{total("1h", "kills")}</strong><small>{total("1h", "gateKills")} classified near gates</small></article>
        <article><span>Danger gates</span><strong>{(dangerCounts["dangerous"] ?? 0) + (dangerCounts["camp-likely"] ?? 0) + (dangerCounts["active-camp"] ?? 0)}</strong><small>{dangerCounts["active-camp"] ?? 0} active camp · {dangerCounts["camp-likely"] ?? 0} likely</small></article>
        <article><span>Worst route signal</span><strong>{worst?.label ?? "Clear"}</strong><small>{worst?.reasons?.[0] ?? "No recent gate evidence in retained cache."}</small></article>
      </div>
      {props.routeIntelligenceError && <div className="navigation-route-error"><strong>Route intelligence warning</strong><span>{props.routeIntelligenceError}</span></div>}
      <div className="navigation-intel-method"><strong>Explainable danger model</strong><span>Clear → Activity → Dangerous → Camp likely → Active camp. Repeated recent gate kills and recurring attackers increase confidence; raw kill, pod, attacker and jump counts stay visible in the inspector.</span><small>Gate attribution remains geometric: ≤50 km high confidence, ≤100 km medium, ≤250 km low; farther kills remain system-wide only.</small></div>
      <NavigationRouteList route={props.route} intelligence={intel} selectedSystemId={props.selectedSystem?.systemId ?? null} selectedLegIndex={props.selectedLegIndex} onSelectSystem={props.setSelectedSystem} onSelectLeg={props.setSelectedLegIndex} />
      <div className="navigation-intel-footer"><span>{intel?.activityFetchedAt ? `ESI activity ${new Date(intel.activityFetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "ESI activity loading"}</span><span>{intel?.sources ? `${intel.sources.kills} · ${intel.sources.gateGeometry}` : "Shared intelligence sources loading"}</span></div>
    </>}
  </div>;
}

function NavigationQuickTools({ props }: { props: SharedProps }) {
  return <div className="navigation-quick-tools">
    <div className="navigation-preset-block"><span>Route presets</span><div>{routePresets.map((preset) => <button type="button" key={preset.id} onClick={() => props.applyPreset(preset.id)}><strong>{preset.label}</strong><small>{preset.detail}</small></button>)}</div></div>
    <div className="navigation-favourite-block"><span>Favourite systems</span>
      <div className="navigation-favourite-actions">
        {props.origin && <button type="button" onClick={() => props.toggleFavourite(props.origin!)}>{props.favourites.some((row) => row.systemId === props.origin?.systemId) ? "★" : "☆"} {props.origin.name}</button>}
        {props.destination && props.destination.systemId !== props.origin?.systemId && <button type="button" onClick={() => props.toggleFavourite(props.destination!)}>{props.favourites.some((row) => row.systemId === props.destination?.systemId) ? "★" : "☆"} {props.destination.name}</button>}
      </div>
      <div className="navigation-favourite-list">{props.favourites.map((system) => <div key={system.systemId}><strong>{system.name}</strong><small>{system.regionName}</small><button type="button" onClick={() => props.setOrigin(system)}>Origin</button><button type="button" onClick={() => props.setDestination(system)} disabled={!props.origin}>Destination</button><button type="button" onClick={() => props.toggleFavourite(system)}>×</button></div>)}{!props.favourites.length && <small>No favourites yet — star an origin or destination.</small>}</div>
    </div>
  </div>;
}

function ExportRoutePanel({ props }: { props: SharedProps }) {
  return <div className="navigation-export-panel">
    <div><span>Route actions</span><strong>Save locally or transmit the exact gate path to EVE</strong><small>EVE export sends each ordered Sage system after the origin so the client cannot choose a different path between stops.</small></div>
    <div className="navigation-export-controls">
      <button type="button" disabled={!props.route} onClick={props.saveCurrentRoute}>Save route</button>
      <button type="button" disabled={!props.route?.found} onClick={() => void props.copyOrderedSystems()}>Copy system list</button>
      <button type="button" disabled={!props.route?.found} onClick={() => void props.copyCompactSummary()}>Copy summary</button>
      <button type="button" disabled={!props.route} onClick={() => void props.copyRouteJson()}>Copy route JSON</button>
      <select value={props.selectedCharacterId} onChange={(event) => props.setSelectedCharacterId(event.target.value)} aria-label="EVE export character"><option value="">Choose character</option>{props.characters.map((character) => <option value={character.characterId} key={character.characterId}>{character.name}</option>)}</select>
      <label><input type="checkbox" checked={props.exportAppend} onChange={(event) => props.setExportAppend(event.target.checked)} /><span>Append to current EVE route</span></label>
      <button type="button" className="navigation-primary" disabled={!props.route?.found || !props.selectedCharacterId} onClick={() => void props.exportRouteToEve()}>Export to EVE</button>
    </div>
    {props.exportMessage && <small className="navigation-export-message">{props.exportMessage}</small>}
  </div>;
}


function SpecialConnectionPolicy({ props }: { props: SharedProps }) {
  const networks = Array.from(new Map(props.customConnections.filter((row) => row.networkId).map((row) => [row.networkId!, row.networkName || row.networkId!])).entries());
  const labels: Partial<Record<NavigationEdgeType, string>> = { ansiblex: "Ansiblex", wormhole: "Wormholes", thera: "Thera", turnur: "Turnur", zarzakh: "Zarzakh", manual: "Manual links" };
  return <div className="navigation-special-policy">
    <div className="navigation-panel-title"><div><span>Special routing networks</span><small>Explicit route-profile controls decide which non-gate edges Sage may use. Expired, denied or inaccessible links are rejected even when their type is enabled.</small></div><b>{props.enabledSpecialTypes.length}/{SPECIAL_EDGE_TYPES.length}</b></div>
    <div className="navigation-special-type-grid">{SPECIAL_EDGE_TYPES.map((type) => <button type="button" key={type} className={props.enabledSpecialTypes.includes(type) ? "active" : ""} onClick={() => props.toggleSpecialType(type)}><strong>{labels[type] ?? type}</strong><small>{props.enabledSpecialTypes.includes(type) ? "Allowed" : "Excluded"}</small></button>)}</div>
    {networks.length > 0 && <div className="navigation-special-networks"><span>Known networks</span>{networks.map(([id,name]) => <button type="button" key={id} className={!props.disabledSpecialNetworkIds.includes(id) ? "active" : ""} onClick={() => props.toggleSpecialNetwork(id)}><strong>{name}</strong><small>{props.disabledSpecialNetworkIds.includes(id) ? "Disabled for this profile" : "Enabled for this profile"}</small></button>)}</div>}
  </div>;
}

function CustomConnectionPanel({ props }: { props: SharedProps }) {
  const [from, setFrom] = useState<NavigationSystem | null>(null); const [to, setTo] = useState<NavigationSystem | null>(null);
  const [type, setType] = useState<NavigationEdgeType>("manual"); const [bidirectional, setBidirectional] = useState(true); const [label, setLabel] = useState("");
  const [networkName, setNetworkName] = useState(""); const [ownerName, setOwnerName] = useState(""); const [access, setAccess] = useState(""); const [expiresAt, setExpiresAt] = useState(""); const [connectionClass, setConnectionClass] = useState(""); const [shipRestriction, setShipRestriction] = useState("");
  function add() { if (!from || !to || from.systemId === to.systemId) return; const networkId = networkName.trim() ? networkName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : undefined; props.addCustomConnection({ fromSystemId: from.systemId, toSystemId: to.systemId, type, enabled: true, bidirectional, label: label.trim() || undefined, networkId, networkName: networkName.trim() || undefined, ownerName: ownerName.trim() || undefined, access: access.trim() || undefined, discoveredAt: new Date().toISOString(), expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined, connectionClass: connectionClass.trim() || undefined, status: expiresAt ? "active" : undefined, shipRestriction: shipRestriction.trim() || undefined, metadata: { fromName: from.name, toName: to.name } }); setFrom(null); setTo(null); setLabel(""); setNetworkName(""); setOwnerName(""); setAccess(""); setExpiresAt(""); setConnectionClass(""); setShipRestriction(""); }
  return <div className="navigation-custom-connections">
    <div className="navigation-panel-title"><div><span>Custom connections</span><small>Temporary/private links plug into the same solver as gates. Enable, disable or remove them at any time.</small></div><b>{props.customConnections.filter((row) => row.enabled).length}/{props.customConnections.length}</b></div>
    <div className="navigation-custom-builder"><SystemPicker label="From" selected={from} onSelect={setFrom} disabled={!props.graphReady} compact /><SystemPicker label="To" selected={to} onSelect={setTo} disabled={!props.graphReady} compact />
      <label><span>Edge type</span><select value={type} onChange={(event) => setType(event.target.value as NavigationEdgeType)}><option value="manual">Manual</option><option value="wormhole">Wormhole</option><option value="ansiblex">Ansiblex</option><option value="thera">Thera</option><option value="turnur">Turnur</option><option value="zarzakh">Zarzakh</option></select></label>
      <label><span>Label</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Optional note" /></label>
      <label><span>Network</span><input value={networkName} onChange={(event) => setNetworkName(event.target.value)} placeholder="e.g. Corp Ansiblex / Thera scan" /></label>
      <label><span>Owner / access</span><input value={ownerName} onChange={(event) => setOwnerName(event.target.value)} placeholder="Owner if known" /><input value={access} onChange={(event) => setAccess(event.target.value)} placeholder="public / alliance / denied" /></label>
      {(type === "wormhole" || type === "thera") && <label><span>Expiry</span><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /><input value={connectionClass} onChange={(event) => setConnectionClass(event.target.value)} placeholder="Class / connection type" /></label>}
      {(type === "turnur" || type === "zarzakh" || type === "wormhole") && <label><span>Restriction</span><input value={shipRestriction} onChange={(event) => setShipRestriction(event.target.value)} placeholder="Known ship/access restriction" /></label>}
      <label className="navigation-inline-check"><input type="checkbox" checked={bidirectional} onChange={(event) => setBidirectional(event.target.checked)} /><span>Bidirectional</span></label>
      <button type="button" className="navigation-primary" disabled={!from || !to || from.systemId === to.systemId} onClick={add}>Add connection</button>
    </div>
    <div className="navigation-custom-list">{props.customConnections.map((row) => <div key={row.connectionId} className={row.enabled ? "active" : ""}><div><strong>{row.label || row.type.toUpperCase()}</strong><small>{String(row.metadata?.fromName ?? row.fromSystemId)} → {String(row.metadata?.toName ?? row.toSystemId)} · {row.bidirectional ? "two-way" : "one-way"}</small></div><button type="button" onClick={() => props.toggleCustomConnection(row.connectionId)}>{row.enabled ? "Disable" : "Enable"}</button><button type="button" onClick={() => props.removeCustomConnection(row.connectionId)}>Delete</button></div>)}{!props.customConnections.length && <div className="navigation-compact-empty">No custom connections configured.</div>}</div>
  </div>;
}

function SavedRoutesPanel(props: SharedProps) {
  const [importText, setImportText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  async function importPacket() {
    if (!importText.trim()) return;
    setImportBusy(true);
    try { if (await props.importRouteJson(importText)) setImportText(""); }
    finally { setImportBusy(false); }
  }
  return <div className="navigation-saved-routes">
    <div className="navigation-section-heading"><div><p className="eyebrow">ROUTE LIBRARY</p><h3>Saved Routes</h3><p>Persistent Sage routes keep their profile, waypoints, avoids, locked paths and special connections. Route packets can move the exact object between Sage installations.</p></div><button type="button" className="navigation-primary" disabled={!props.route} onClick={props.saveCurrentRoute}>Save current route</button></div>

    <SageOnlineRoutesPanel props={props} />

        <article className="navigation-route-portability">
      <div className="navigation-panel-title"><div><span>Portable Sage route</span><small>Versioned, human-readable <code>new-eden-sage.route.v1</code> JSON. Copy it, download it, or paste a packet from another Sage installation.</small></div><b>SCHEMA V1</b></div>
      <div className="navigation-route-portability-actions">
        <button type="button" disabled={!props.route} onClick={() => void props.copyRouteJson()}>Copy current JSON</button>
        <button type="button" disabled={!props.route} onClick={() => void props.downloadRouteJson()}>Download current JSON</button>
      </div>
      <div className="navigation-route-import">
        <textarea value={importText} onChange={(event) => setImportText(event.target.value)} placeholder='Paste a new-eden-sage.route.v1 JSON packet here…' spellCheck={false} />
        <button type="button" className="navigation-primary" disabled={importBusy || !importText.trim()} onClick={() => void importPacket()}>{importBusy ? "Validating…" : "Import route JSON"}</button>
      </div>
      {props.routePacketMessage && <small className="navigation-route-packet-message">{props.routePacketMessage}</small>}
    </article>

    {props.savedRoutes.length ? <div className="navigation-saved-grid">{props.savedRoutes.map((entry) => <article key={entry.id}>
      <div className="navigation-saved-head"><input defaultValue={entry.name} onBlur={(event) => { const value=event.target.value.trim(); if (value && value !== entry.name) props.renameSavedRoute(entry.id, value); }} /><span>{new Date(entry.savedAt).toLocaleString()}</span></div>
      <div className="navigation-saved-metrics"><b>{entry.route.totals.jumps} jumps</b><b>{entry.route.waypoints.length} stops</b><b>{entry.route.lockedSegments?.length ?? 0} locked</b><b>{entry.route.customConnections?.length ?? 0} custom</b></div>
      <small>{entry.route.origin?.name ?? "?"} → {entry.route.destination?.name ?? "?"} · {modeLabels[entry.route.routingProfile.mode]} · schema v{entry.route.schemaVersion}</small>
      <div className="navigation-saved-actions"><button type="button" onClick={() => props.loadSavedRoute(entry)}>Load</button><button type="button" onClick={() => void props.copyRouteJson(entry.route)}>Copy JSON</button><button type="button" onClick={() => props.duplicateSavedRoute(entry)}>Duplicate</button><button type="button" onClick={() => props.deleteSavedRoute(entry.id)}>Delete</button></div>
    </article>)}</div> : <div className="navigation-route-empty"><strong>No saved routes yet</strong><span>Calculate a route, then save it from Route Planner—or import a Sage route packet above.</span></div>}
  </div>;
}

function CapitalJumpPlanner(props: SharedProps) {
  const [context, setContext] = useState<NavigationCapitalContext | null>(null);
  const [contextError, setContextError] = useState("");
  const [shipTypeId, setShipTypeId] = useState(0);
  const [from, setFrom] = useState<NavigationSystem | null>(null);
  const [to, setTo] = useState<NavigationSystem | null>(null);
  const [startingFatigueMinutes, setStartingFatigueMinutes] = useState(0);
  const [includeLiveIntelligence, setIncludeLiveIntelligence] = useState(true);
  const [plan, setPlan] = useState<NavigationCapitalPlan | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled=false; setPlan(null);
    if(!props.selectedCharacterId){setContext(null);setContextError("Choose a connected character.");return;}
    window.sage.getNavigationCapitalContext(props.selectedCharacterId).then((value)=>{if(cancelled)return;setContext(value);setContextError("");const preferred=value.hulls.some((h)=>h.typeId===value.currentShipTypeId)?value.currentShipTypeId:0;setShipTypeId((current)=>current||preferred||value.hulls[0]?.typeId||0);}).catch((error)=>{if(!cancelled){setContext(null);setContextError(error instanceof Error?error.message:"Capital context is unavailable.");}});
    return()=>{cancelled=true;};
  },[props.selectedCharacterId]);

  useEffect(()=>{ if(!from && props.characterLocation) void window.sage.getNavigationSystem(props.characterLocation.systemId).then((system)=>{if(system)setFrom(system);}); },[props.characterLocation?.systemId]);

  async function calculate(){
    if(!context||!shipTypeId||!from||!to)return; setBusy(true);setContextError("");
    try{setPlan(await window.sage.calculateNavigationCapitalPlan({characterId:context.characterId,shipTypeId,fromSystemId:from.systemId,toSystemId:to.systemId,startingFatigueMinutes,includeLiveIntelligence}));}
    catch(error){setPlan(null);setContextError(error instanceof Error?error.message:"Capital route calculation failed.");}
    finally{setBusy(false);}
  }
  const hull=context?.hulls.find((row)=>row.typeId===shipTypeId);
  const effective=hull&&context?hull.baseRangeLy*(1+0.2*context.jumpDriveCalibrationLevel):0;
  const primaryQuality=plan?.alternatives[0]?.qualityScore ?? 0;
  return <div className="navigation-capital-planner">
    <div className="navigation-section-heading"><div><p className="eyebrow">CAPITAL NAVIGATION</p><h3>Jump-drive logistics planner</h3><p>Range, isotopes, fatigue, midpoint quality and Jump Freighter transition planning share the same local universe model.</p></div><span className="navigation-status-chip ready">SDE + CHARACTER SKILLS</span></div>
    <article className="navigation-capital-control">
      <div className="navigation-capital-grid">
        <label><span>Character</span><select value={props.selectedCharacterId} onChange={(e)=>props.setSelectedCharacterId(e.target.value)}><option value="">Choose character</option>{props.characters.map((c)=><option key={c.characterId} value={c.characterId}>{c.name}</option>)}</select></label>
        <label><span>Jump-capable hull</span><select value={shipTypeId||""} onChange={(e)=>{setShipTypeId(Number(e.target.value));setPlan(null);}} disabled={!context}><option value="">Choose hull</option>{context?.hulls.map((h)=><option key={h.typeId} value={h.typeId}>{h.groupName} · {h.name} · {h.baseRangeLy.toFixed(1)} LY</option>)}</select></label>
        <SystemPicker label="Origin" selected={from} onSelect={(system)=>{setFrom(system);setPlan(null);}} disabled={!props.graphReady} />
        <SystemPicker label="Destination" selected={to} onSelect={(system)=>{setTo(system);setPlan(null);}} disabled={!props.graphReady} />
      </div>
      <div className="navigation-capital-options">
        <label><span>Existing fatigue timer</span><div><input type="number" min="0" max="300" step="1" value={startingFatigueMinutes} onChange={(event)=>setStartingFatigueMinutes(Math.max(0,Math.min(300,Number(event.target.value)||0)))} /><small>minutes</small></div></label>
        <label className="navigation-inline-check"><input type="checkbox" checked={includeLiveIntelligence} onChange={(event)=>setIncludeLiveIntelligence(event.target.checked)} /><span>Include shared live danger / structure intelligence in midpoint scoring</span></label>
      </div>
      {context && <div className="navigation-capital-context">
        <div><span>JDC</span><strong>Level {context.jumpDriveCalibrationLevel}</strong><small>+{context.jumpDriveCalibrationLevel*20}% range</small></div>
        <div><span>JFC</span><strong>Level {context.jumpFuelConservationLevel}</strong><small>-{context.jumpFuelConservationLevel*10}% isotopes / LY</small></div>
        <div><span>Effective range</span><strong>{effective?effective.toFixed(2):"—"} LY</strong><small>{hull?.baseRangeLy.toFixed(2)??"—"} LY base</small></div>
        <div><span>Fuel</span><strong>{hull?.fuelTypeName??"Unknown"}</strong><small>{hull?.fuelPerLy?.toLocaleString()??"—"} base units / LY</small></div>
        <div><span>Fatigue multiplier</span><strong>×{hull?.fatigueMultiplier.toFixed(2)??"—"}</strong><small>{hull?.jumpFreighter?"Jump Freighter reduction":"SDE hull value"}</small></div>
        <div><span>Current ship</span><strong>{context.currentShipName??"Unknown"}</strong><small>{context.currentShipTypeId?`Type ${context.currentShipTypeId}`:"Snapshot unavailable"}</small></div>
      </div>}
      {contextError && <div className="navigation-route-error"><strong>Capital planner</strong><span>{contextError}</span></div>}
      <div className="navigation-capital-actions"><small>{context?.source??"Select a character to load jump-drive data."}</small><button type="button" className="navigation-primary" disabled={busy||!context||!shipTypeId||!from||!to} onClick={()=>void calculate()}>{busy?"Calculating logistics options…":"Calculate capital route"}</button></div>
    </article>

    {plan && !plan.found && <div className="navigation-route-error"><strong>No viable capital route</strong><span>{plan.reason}</span></div>}
    {plan?.found && <div className="navigation-capital-result">
      <div className="navigation-capital-metrics">
        <article><span>Jump-drive jumps</span><strong>{plan.jumps}</strong><small>{plan.origin?.name} → {plan.destination?.name}</small></article>
        <article><span>Total distance</span><strong>{plan.totalDistanceLy.toFixed(2)} LY</strong><small>{plan.effectiveRangeLy.toFixed(2)} LY max / jump</small></article>
        <article><span>Fuel</span><strong>{plan.totalFuelUnits.toLocaleString()}</strong><small>{plan.fuelTypeName ?? "fuel units"} · JFC {plan.jumpFuelConservationLevel}</small></article>
        <article><span>Activation waits</span><strong>{plan.totalActivationWaitMinutes.toFixed(1)}m</strong><small>sum of per-jump cooldowns</small></article>
        <article><span>Final fatigue</span><strong>{plan.finalFatigueMinutes.toFixed(1)}m</strong><small>after final jump</small></article>
        <article><span>Route quality</span><strong>{primaryQuality || "—"}</strong><small>{plan.alternatives.length} candidate chain{plan.alternatives.length===1?"":"s"}</small></article>
      </div>

      <div className="navigation-capital-route">
        <div className="navigation-panel-title"><div><span>Selected jump chain</span><small>Every leg includes deterministic isotope usage and character/hull fatigue effects.</small></div><b>{plan.jumps} jumps</b></div>
        {plan.systems.map((system,index)=>{const leg=index>0?plan.legs[index-1]:null;return <div key={system.systemId} className="navigation-capital-leg detailed"><b>{index}</b><div><strong>{system.name}</strong><small>{system.regionName} · {displaySecurity(system.securityStatus).toFixed(1)} security</small></div>{leg?<><span>{leg.distanceLy.toFixed(2)} LY</span><span>{leg.fuelUnits.toLocaleString()} fuel</span><span>{leg.fatigue.activationCooldownMinutes.toFixed(1)}m cooldown</span><span>{leg.fatigue.fatigueAfterJumpMinutes.toFixed(1)}m fatigue</span></>:<span className="navigation-capital-origin-label">ORIGIN</span>}</div>})}
      </div>

      {plan.alternatives.length>0 && <div className="navigation-capital-alternatives">
        <div className="navigation-panel-title"><div><span>Candidate chains</span><small>Compare midpoint quality, fuel, jump count and cooldown cost instead of accepting a single answer.</small></div><b>{plan.alternatives.length}</b></div>
        <div className="navigation-capital-alternative-grid">{plan.alternatives.map((candidate)=><article key={candidate.candidateId}>
          <div className="navigation-capital-candidate-head"><div><span>{candidate.label}</span><strong>{candidate.systems.map((row)=>row.name).join(" → ")}</strong></div><b>{candidate.qualityScore}/100</b></div>
          <div className="navigation-capital-candidate-metrics"><span>{candidate.jumps} jumps</span><span>{candidate.totalDistanceLy.toFixed(2)} LY</span><span>{candidate.totalFuelUnits.toLocaleString()} fuel</span><span>{candidate.totalActivationWaitMinutes.toFixed(1)}m waits</span></div>
          {candidate.midpointQuality.length?<div className="navigation-midpoint-quality">{candidate.midpointQuality.map((mid)=><div key={mid.systemId}><strong>{mid.name}</strong><b>{mid.score}</b><small>{mid.reasons.join(" · ")}</small></div>)}</div>:<small className="navigation-capital-direct">Direct chain has no intermediate cyno midpoint to score.</small>}
        </article>)}</div>
      </div>}

      {plan.jumpFreighterTransitions.length>0 && <div className="navigation-jf-transitions">
        <div className="navigation-panel-title"><div><span>Jump Freighter high-sec transitions</span><small>Capital jump chain plus the legal high-sec stargate section, with transition-gate danger where shared intelligence is available.</small></div><b>{plan.jumpFreighterTransitions.length}</b></div>
        <div className="navigation-jf-grid">{plan.jumpFreighterTransitions.map((item,index)=><article key={`${item.lowSecSystem.systemId}-${item.highSecSystem.systemId}-${index}`}>
          <div><span>Transition</span><strong>{item.lowSecSystem.name} ⇄ {item.highSecSystem.name}</strong><small>{item.capitalCandidate.jumps} jump-drive · {item.gateRoute.jumps} gate jumps (incl. transition) · {item.totalTravelLegs} travel legs</small></div>
          <div className={`navigation-jf-danger ${item.gateRoute.transitionDanger.toLowerCase().replace(/\s+/g,"-")}`}><span>Transition danger</span><strong>{item.gateRoute.transitionDanger}</strong><small>score {item.gateRoute.transitionDangerScore}</small></div>
          <div><span>Fuel</span><strong>{item.capitalCandidate.totalFuelUnits.toLocaleString()} {item.capitalCandidate.fuelTypeName ?? "units"}</strong><small>{item.capitalCandidate.systems.map((row)=>row.name).join(" → ")}</small></div>
        </article>)}</div>
      </div>}

      <div className="navigation-capital-reachable"><div className="navigation-panel-title"><div><span>Reachable systems from origin</span><small>Closest useful candidates toward the final destination.</small></div><b>{plan.reachableFromOriginCount}</b></div>{plan.reachableFromOrigin.slice(0,18).map((row)=><div key={row.systemId}><strong>{row.name}</strong><span>{row.regionName}</span><b>{row.distanceLy.toFixed(2)} LY</b><small>{row.distanceToDestinationLy.toFixed(2)} LY to destination</small></div>)}</div>
    </div>}
  </div>;
}

function FoundationPanel({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <div className="navigation-foundation-panel"><div className="navigation-foundation-orbit"><i /><i /><i /></div><p className="eyebrow">{eyebrow}</p><h3>{title}</h3><p>{text}</p><small>The section boundary is live; later tasks extend the shared Navigation Command route object rather than replacing it.</small></div>;
}

function mapPositions(focus: NavigationSystem, neighbours: NavigationSystem[]) {
  const center = { x: focus.position2D?.x ?? focus.position.x, y: focus.position2D?.y ?? focus.position.z };
  const raw = neighbours.map((system, index) => ({
    system,
    dx: (system.position2D?.x ?? system.position.x) - center.x,
    dy: (system.position2D?.y ?? system.position.z) - center.y,
    index,
  }));
  const maxDistance = Math.max(1, ...raw.map((item) => Math.hypot(item.dx, item.dy)));
  const positioned = raw.map((item) => {
    const distance = Math.hypot(item.dx, item.dy);
    if (distance < 1) {
      const angle = (item.index / Math.max(1, raw.length)) * Math.PI * 2;
      return { system: item.system, x: 50 + Math.cos(angle) * 34, y: 50 + Math.sin(angle) * 34 };
    }
    return { system: item.system, x: 50 + (item.dx / maxDistance) * 36, y: 50 + (item.dy / maxDistance) * 36 };
  });
  return [{ system: focus, x: 50, y: 50 }, ...positioned];
}

function uniqueNumbers(values: number[]) { return [...new Set(values.map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))]; }
function displaySecurity(value: number) { return Math.max(-1, Math.min(1, Math.round(value * 10) / 10)); }
function securityClass(value: number) { const security = displaySecurity(value); return security >= 0.5 ? "high" : security > 0 ? "low" : "null"; }
