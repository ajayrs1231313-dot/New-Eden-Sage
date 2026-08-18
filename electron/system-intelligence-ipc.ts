import { app, ipcMain } from "electron";
import { listSnapshots } from "./database";
import {
  getSystemIntelligence,
  refreshWatchedSystemIntelligence,
  resumeKillmailRefreshQueue,
  searchSolarSystems,
} from "./system-intelligence";

ipcMain.handle("system-intelligence:search", (_event, query: string, limit = 20) =>
  searchSolarSystems(String(query ?? ""), Number(limit ?? 20)),
);

ipcMain.handle("system-intelligence:get", (_event, systemId: number) =>
  getSystemIntelligence(Number(systemId), listSnapshots() as any[]),
);

ipcMain.handle("system-intelligence:refresh-watched", (_event, systemIds: number[]) =>
  refreshWatchedSystemIntelligence(
    Array.isArray(systemIds) ? systemIds.map(Number) : [],
    listSnapshots() as any[],
  ),
);

void app.whenReady().then(() => resumeKillmailRefreshQueue()).catch(() => undefined);
