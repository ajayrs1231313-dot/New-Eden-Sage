import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("sage", {
  copyText: (value: string) => ipcRenderer.invoke("clipboard:write", value),
  resolveTypeNames: (names: string[]) =>
    ipcRenderer.invoke("universe:resolve-types", names),
  resolveTypeIds: (ids: number[]) =>
    ipcRenderer.invoke("universe:resolve-type-ids", ids),
  listShips: () => ipcRenderer.invoke("universe:ships"),
  analyzeFitting: (input: unknown) =>
    ipcRenderer.invoke("fitting:analyze", input),
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (input: { eveClientId: string }) =>
    ipcRenderer.invoke("config:save", input),
  loginWithEve: () => ipcRenderer.invoke("eve:login"),
  refreshCharacter: (characterId: string) =>
    ipcRenderer.invoke("eve:refresh", characterId),
  listSnapshots: () => ipcRenderer.invoke("snapshot:list"),
  removeCharacter: (characterId: string) =>
    ipcRenderer.invoke("character:remove", characterId),
  exportData: (
    format: "json" | "chatgpt" | "chatgpt-radius",
    characterId?: string,
  ) => ipcRenderer.invoke("data:export", format, characterId),
  importData: () => ipcRenderer.invoke("data:import"),
  exportDebugLog: () => ipcRenderer.invoke("debug:export"),
  listMarketRegions: () => ipcRenderer.invoke("market:regions"),
  buildFitShoppingRoute: (input: unknown) =>
    ipcRenderer.invoke("fit:shopping-route", input),
  findRadiusTrades: (mode: string) =>
    ipcRenderer.invoke("trade:radius-opportunities", mode),
  exportTopArbitrage: () => ipcRenderer.invoke("trade:export-top1000"),
  listMarketSummaries: () => ipcRenderer.invoke("market:summaries"),
  getMarketRegion: (regionId: number) =>
    ipcRenderer.invoke("market:region", regionId),
  getMarketStorage: () => ipcRenderer.invoke("market:storage"),
  pullMarket: (input: {
    mode: "single" | "all" | "radius" | "contracts";
    regionId?: number;
    characterId?: string;
    includeLowSec?: boolean;
  }) => ipcRenderer.invoke("market:pull", input),
  onMarketProgress: (callback: (progress: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: unknown) =>
      callback(progress);
    ipcRenderer.on("market:progress", listener);
    return () => ipcRenderer.removeListener("market:progress", listener);
  },
});
