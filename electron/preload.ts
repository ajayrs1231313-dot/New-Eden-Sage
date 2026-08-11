import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("sage", {
  getUpdateState: () => ipcRenderer.invoke("update:get-state"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  openSupportPage: () => ipcRenderer.invoke("external:open-support"),
  getMcpSetup: () => ipcRenderer.invoke("mcp:get-setup"),
  getMcpTunnelStatus: () => ipcRenderer.invoke("mcp:tunnel-status"),
  configureMcpTunnel: (input: unknown) => ipcRenderer.invoke("mcp:tunnel-configure", input),
  openChatGptPlugins: () => ipcRenderer.invoke("mcp:open-chatgpt"),
  openOpenAiTunnels: () => ipcRenderer.invoke("mcp:open-tunnels"),
  openOpenAiApiKeys: () => ipcRenderer.invoke("mcp:open-api-keys"),
  syncMcpRendererData: (value: unknown) => ipcRenderer.invoke("mcp:sync-renderer-data", value),
  onMcpFitDataUpdated: (callback: (value: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
    ipcRenderer.on("mcp:fit-data-updated", listener);
    return () => ipcRenderer.removeListener("mcp:fit-data-updated", listener);
  },
  onUpdateStatus: (callback: (value: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
    ipcRenderer.on("update:status", listener);
    return () => ipcRenderer.removeListener("update:status", listener);
  },
  copyText: (value: string) => ipcRenderer.invoke("clipboard:write", value),
  resolveTypeNames: (names: string[]) =>
    ipcRenderer.invoke("universe:resolve-types", names),
  resolveFittingTypeNamesLocal: (names: string[]) =>
    ipcRenderer.invoke("fitting:resolve-types-local", names),
  resolveTypeIds: (ids: number[]) =>
    ipcRenderer.invoke("universe:resolve-type-ids", ids),
  listShips: () => ipcRenderer.invoke("universe:ships"),
  getManufacturingPlan: (input: unknown) => ipcRenderer.invoke("industrial:manufacturing-plan", input),
  getBlueprintActivities: (input: unknown) => ipcRenderer.invoke("industrial:blueprint-activities", input),
  getIndustrySystemCostIndex: (input: unknown) => ipcRenderer.invoke("industrial:system-cost-index", input),
  getShipReadiness: (input: unknown) =>
    ipcRenderer.invoke("skills:ship-readiness", input),
  getActivityReadiness: (input: unknown) =>
    ipcRenderer.invoke("activity:readiness", input),
  analyzeFitting: (input: unknown) =>
    ipcRenderer.invoke("fitting:analyze", input),
  getCapabilities: (input: unknown) =>
    ipcRenderer.invoke("capability:analyze", input),
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (input: { eveClientId: string }) =>
    ipcRenderer.invoke("config:save", input),
  loginWithEve: () => ipcRenderer.invoke("eve:login"),
  refreshCharacter: (characterId: string) =>
    ipcRenderer.invoke("eve:refresh", characterId),
  listSnapshots: () => ipcRenderer.invoke("snapshot:list"),
  removeCharacter: (characterId: string) =>
    ipcRenderer.invoke("character:remove", characterId),
  getEveNews: (force = false) => ipcRenderer.invoke("news:list", force),
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
  getOpportunityAnalysis: (input: unknown) =>
    ipcRenderer.invoke("opportunity:analyze", input),
  getPveLocationAnalysis: (input: unknown) =>
    ipcRenderer.invoke("pve:locations", input),
  cancelAnalysis: (kind?: string) => ipcRenderer.invoke("analysis:cancel", kind),
  getAnalysisStatus: () => ipcRenderer.invoke("analysis:status"),
  onAnalysisProgress: (callback: (progress: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress);
    ipcRenderer.on("analysis:progress", listener);
    return () => ipcRenderer.removeListener("analysis:progress", listener);
  },
  exportTopArbitrage: () => ipcRenderer.invoke("trade:export-top1000"),
  searchRawMarket: (input: unknown) => ipcRenderer.invoke("market:raw-search", input),
  filterRegionalMarket: (input: unknown) => ipcRenderer.invoke("market:regional-filter", input),
  getMarketItemHistory: (typeId: number) => ipcRenderer.invoke("market:item-history", typeId),
  exportRegionalMarket: (format: "csv" | "json" | "xlsx", rows: unknown[], itemName?: string) =>
    ipcRenderer.invoke("market:regional-export", format, rows, itemName),
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
