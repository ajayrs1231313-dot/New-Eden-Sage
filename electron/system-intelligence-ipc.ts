import { app, ipcMain } from "electron";
import { listSnapshots } from "./database";
import { findCorporationHomes, scanCorporationHomeCandidate } from "./corporation-home-finder";
import { getNavigationRouteIntelligence } from "./navigation-route-intelligence";
import { getNavigationPublicWormholes } from "./eve-scout-public";
import { getWormholeSiteReference } from "./wormhole-site-reference";
import {
  getSystemIntelligence,
  refreshSystemIntelligence,
  refreshWatchedSystemIntelligence,
  resumeKillmailRefreshQueue,
  searchSolarSystems,
} from "./system-intelligence";

ipcMain.handle("system-intelligence:search", (_event, query: string, limit = 20) =>
  searchSolarSystems(String(query ?? ""), Number(limit ?? 20)),
);

ipcMain.handle("corp:find-home", (_event, input: unknown) => findCorporationHomes((input ?? {}) as any));
ipcMain.handle("corp:find-home-scan", (_event, input: { systemIds?: number[] }) => scanCorporationHomeCandidate(input ?? {}, listSnapshots() as any[]));

ipcMain.handle("system-intelligence:get", (_event, systemId: number) =>
  getSystemIntelligence(Number(systemId), listSnapshots() as any[]),
);

ipcMain.handle("system-intelligence:refresh-watched", (_event, systemIds: number[]) =>
  refreshWatchedSystemIntelligence(
    Array.isArray(systemIds) ? systemIds.map(Number) : [],
    listSnapshots() as any[],
  ),
);

ipcMain.handle("system-intelligence:refresh", (_event, input: { systemIds?: number[]; caller?: "watch" | "route" | "single"; discoverStructures?: boolean; deepKillmailBackfill?: boolean; forceActivity?: boolean }) =>
  refreshSystemIntelligence(
    Array.isArray(input?.systemIds) ? input.systemIds.map(Number) : [],
    listSnapshots() as any[],
    { caller: input?.caller, discoverStructures: input?.discoverStructures, deepKillmailBackfill: input?.deepKillmailBackfill, forceActivity: input?.forceActivity },
  ),
);

ipcMain.handle("navigation:public-wormholes", (_event, force?: boolean) => getNavigationPublicWormholes(Boolean(force)));
ipcMain.handle("wormhole:site-reference", (_event, force?: boolean) => getWormholeSiteReference(Boolean(force)));

ipcMain.handle("navigation:route-intelligence", (_event, input: { systemIds?: number[]; legs?: any[] }) =>
  getNavigationRouteIntelligence(
    { systemIds: Array.isArray(input?.systemIds) ? input.systemIds.map(Number) : [], legs: Array.isArray(input?.legs) ? input.legs : [] },
    listSnapshots() as any[],
  ),
);

void app.whenReady().then(() => resumeKillmailRefreshQueue()).catch(() => undefined);
