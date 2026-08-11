import { contextBridge, ipcRenderer } from "electron";

const transientAnalysisError = (error: unknown) => /ANALYSIS_(WATCHDOG|WORKER_CRASH|WORKER_EXIT)|stopped responding|worker crashed|worker exited unexpectedly/i.test(error instanceof Error ? error.message : String(error));

async function invokeAnalysis(channel: string, ...args: unknown[]) {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    if (!transientAnalysisError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 180));
    return ipcRenderer.invoke(channel, ...args);
  }
}

contextBridge.exposeInMainWorld("sage", {
  bridgeInfo: { version: 2, localFittingCatalogue: true, localTypeImages: true },
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
  searchFittingTypesLocal: (query: string, limit = 60) =>
    ipcRenderer.invoke("fitting:search-types-local", { query, limit }),
  prepareFittingDataLocal: () => ipcRenderer.invoke("fitting:prepare-local"),
  onFittingPreparationProgress: (callback: (value: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
    ipcRenderer.on("fitting:prepare-progress", listener);
    return () => ipcRenderer.removeListener("fitting:prepare-progress", listener);
  },
  filterFittingItemsForHullLocal: (input: unknown) => ipcRenderer.invoke("fitting:compatible-items-local", input),
  getFittingChargesForModulesLocal: (moduleTypeIds: number[]) => ipcRenderer.invoke("fitting:charges-for-fit-local", moduleTypeIds),
  getFittingCatalogueLocal: () => ipcRenderer.invoke("fitting:catalogue-local"),
  getFittingTypeInfoLocal: (typeId: number) => ipcRenderer.invoke("fitting:type-info-local", typeId),
  getHullFittingProfileLocal: (typeId: number) => ipcRenderer.invoke("fitting:hull-profile-local", typeId),
  getMutationOptionsLocal: (typeId: number) => ipcRenderer.invoke("fitting:mutation-options", typeId),
  checkFittingChargeCompatibilityLocal: (moduleTypeId: number, chargeTypeId: number) => ipcRenderer.invoke("fitting:charge-compatibility-local", { moduleTypeId, chargeTypeId }),
  checkFittingItemCompatibilityLocal: (input: unknown) => ipcRenderer.invoke("fitting:item-compatibility-local", input),
  getFittingRemediesLocal: (input: unknown) => ipcRenderer.invoke("fitting:remedies-local", input),
  resolveTypeIds: (ids: number[]) =>
    ipcRenderer.invoke("universe:resolve-type-ids", ids),
  listShips: () => ipcRenderer.invoke("universe:ships"),
  getManufacturingPlan: (input: unknown) => ipcRenderer.invoke("industrial:manufacturing-plan", input),
  getBlueprintActivities: (input: unknown) => ipcRenderer.invoke("industrial:blueprint-activities", input),
  getIndustrySystemCostIndex: (input: unknown) => ipcRenderer.invoke("industrial:system-cost-index", input),
  getIndustrialOpportunityRouteScope: (input: unknown) => ipcRenderer.invoke("industrial:opportunity-route-scope", input),
  getShipReadiness: (input: unknown) =>
    ipcRenderer.invoke("skills:ship-readiness", input),
  getActivityReadiness: (input: unknown) =>
    ipcRenderer.invoke("activity:readiness", input),
  analyzeFitting: (input: unknown) =>
    ipcRenderer.invoke("fitting:analyze", input),
  getCapabilities: (input: unknown) =>
    invokeAnalysis("capability:analyze", input),
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
    invokeAnalysis("opportunity:analyze", input),
  getPveLocationAnalysis: (input: unknown) =>
    invokeAnalysis("pve:locations", input),
  cancelAnalysis: (kind?: string) => ipcRenderer.invoke("analysis:cancel", kind),
  getAnalysisStatus: () => ipcRenderer.invoke("analysis:status"),
  onAnalysisProgress: (callback: (progress: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress);
    ipcRenderer.on("analysis:progress", listener);
    return () => ipcRenderer.removeListener("analysis:progress", listener);
  },
  exportTopArbitrage: () => ipcRenderer.invoke("trade:export-top1000"),
  searchRawMarket: (input: unknown) => invokeAnalysis("market:raw-search", input),
  filterRegionalMarket: (input: unknown) => invokeAnalysis("market:regional-filter", input),
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
