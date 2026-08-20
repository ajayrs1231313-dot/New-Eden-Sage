import { ipcMain } from "electron";
import { navigationRouteEveWaypointChain } from "./navigation-eve-export";
import { getNavigationCharacterLocation } from "./navigation-character-location";
import { getNavigationHazardSnapshot } from "./navigation-hazards";
import { calculateNavigationCapitalPlan, getNavigationCapitalContext } from "./navigation-capital";
import { listSnapshots } from "./database";
import { decrypt, encrypt, readConfig, writeConfig } from "./config";
import { refreshEveToken } from "./eve";
import {
  ensureSageCorporationWorkspace,
  getSageSharedRoute,
  listSageSharedRoutes,
  publishSageSharedRoute,
  updateSageSharedRoute,
} from "./sage-online";
import { calculateNavigationPlan } from "./navigation-route-planner";
import { exportNavigationRouteJson, importNavigationRouteJson } from "./navigation-route-serialization";
import {
  calculateNavigationRoute,
  getNavigationSystem,
  getNavigationNeighbours,
  getNavigationMapData,
  prepareNavigationUniverseGraph,
  searchNavigationSystems,
} from "./universe-route-graph";

async function navigationOnlineAuth(characterId: string) {
  const id = String(characterId ?? "");
  if (!id) throw new Error("Choose a connected character for Sage Online route sharing.");
  const config = await readConfig();
  const sageSessionToken = decrypt(config.encryptedSageSessionToken);
  if (!sageSessionToken) throw new Error("Sage Online is not connected. Reconnect an EVE character to establish the Sage account session.");
  const storedRefresh = decrypt(config.encryptedRefreshTokens[id]);
  if (!storedRefresh) throw new Error("That character is not connected for EVE authentication.");
  const refreshed = await refreshEveToken(config.eveClientId, storedRefresh);
  if (refreshed.refresh_token && refreshed.refresh_token !== storedRefresh) {
    config.encryptedRefreshTokens[id] = encrypt(refreshed.refresh_token);
    await writeConfig(config);
  }
  return { sageSessionToken, eveAccessToken: refreshed.access_token };
}

ipcMain.handle("navigation:prepare-graph", () => prepareNavigationUniverseGraph());
ipcMain.handle("navigation:search-systems", (_event, query: string, limit = 20) =>
  searchNavigationSystems(String(query ?? ""), Number(limit ?? 20)),
);
ipcMain.handle("navigation:get-system", (_event, systemId: number) => getNavigationSystem(Number(systemId)));
ipcMain.handle("navigation:map-data", (_event, input: { scope?: "universe" | "region"; regionId?: number | null }) => getNavigationMapData(input ?? {}));

ipcMain.handle("navigation:get-neighbours", (_event, systemId: number) => getNavigationNeighbours(Number(systemId)));
ipcMain.handle("navigation:calculate-route", (_event, input: unknown) =>
  calculateNavigationRoute((input ?? {}) as any),
);
ipcMain.handle("navigation:calculate-plan", (_event, input: unknown) =>
  calculateNavigationPlan((input ?? {}) as any),
);
ipcMain.handle("navigation:hazards", (_event, force = false) => getNavigationHazardSnapshot(Boolean(force)));

ipcMain.handle("navigation:character-location", (_event, characterId: string, forceLive = true) => getNavigationCharacterLocation(String(characterId ?? ""), Boolean(forceLive)));

ipcMain.handle("navigation:capital-context", (_event, characterId: string) => getNavigationCapitalContext(String(characterId ?? ""), listSnapshots() as any[]));
ipcMain.handle("navigation:capital-plan", (_event, input: unknown) => calculateNavigationCapitalPlan((input ?? {}) as any, listSnapshots() as any[]));

ipcMain.handle("navigation:eve-waypoint-chain", (_event, route: unknown) => navigationRouteEveWaypointChain((route ?? {}) as any));
ipcMain.handle("navigation:export-route-json", (_event, route: unknown) => exportNavigationRouteJson(route));
ipcMain.handle("navigation:import-route-json", (_event, text: string) => importNavigationRouteJson(String(text ?? "")));

ipcMain.handle("navigation:online-workspace", async (_event, characterId: string) => {
  const auth = await navigationOnlineAuth(characterId);
  return ensureSageCorporationWorkspace(auth.sageSessionToken, auth.eveAccessToken);
});
ipcMain.handle("navigation:online-routes", async (_event, input: { characterId: string; workspaceId: string }) => {
  const auth = await navigationOnlineAuth(input?.characterId);
  return listSageSharedRoutes(auth.sageSessionToken, String(input?.workspaceId ?? ""));
});
ipcMain.handle("navigation:online-route-get", async (_event, input: { characterId: string; workspaceId: string; objectId: string }) => {
  const auth = await navigationOnlineAuth(input?.characterId);
  return getSageSharedRoute(auth.sageSessionToken, String(input?.workspaceId ?? ""), String(input?.objectId ?? ""));
});
ipcMain.handle("navigation:online-route-publish", async (_event, input: { characterId: string; workspaceId: string; route: Record<string, unknown>; visibility?: "workspace" | "restricted"; recipientCharacterIds?: number[] }) => {
  const auth = await navigationOnlineAuth(input?.characterId);
  return publishSageSharedRoute(auth.sageSessionToken, String(input?.workspaceId ?? ""), {
    route: input?.route ?? {},
    visibility: input?.visibility,
    recipientCharacterIds: input?.recipientCharacterIds,
  });
});
ipcMain.handle("navigation:online-route-update", async (_event, input: { characterId: string; workspaceId: string; objectId: string; route: Record<string, unknown>; expectedVersion: number }) => {
  const auth = await navigationOnlineAuth(input?.characterId);
  return updateSageSharedRoute(auth.sageSessionToken, String(input?.workspaceId ?? ""), String(input?.objectId ?? ""), {
    route: input?.route ?? {},
    expectedVersion: Number(input?.expectedVersion ?? 0),
  });
});
