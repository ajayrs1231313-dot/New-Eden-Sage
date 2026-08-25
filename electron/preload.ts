import { contextBridge, ipcRenderer } from "electron";

function rendererErrorReport(kind: string, value: unknown) {
  const error = value instanceof Error ? value : null;
  ipcRenderer.send("diagnostics:renderer-error", {
    kind,
    message: error?.message ?? String(value),
    name: error?.name,
    stack: error?.stack,
    href: globalThis.location?.href,
  });
}

globalThis.addEventListener("error", (event) => rendererErrorReport("error", event.error ?? event.message));
globalThis.addEventListener("unhandledrejection", (event) => rendererErrorReport("unhandledrejection", event.reason));

function rendererHeartbeat() {
  ipcRenderer.send("diagnostics:renderer-heartbeat", {
    timestamp: new Date().toISOString(),
    href: globalThis.location?.href,
    visibilityState: globalThis.document?.visibilityState,
  });
}
rendererHeartbeat();
setInterval(rendererHeartbeat, 2000);

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
  openZkillboard: (killmailId?: number) => ipcRenderer.invoke("external:open-zkillboard", killmailId),
  openDiscordUrl: (url:string) => ipcRenderer.invoke("external:open-discord-url", url),
  getMcpSetup: () => ipcRenderer.invoke("mcp:get-setup"),
  getClaudeMcpStatus: () => ipcRenderer.invoke("mcp:claude-status"),
  repairClaudeMcp: () => ipcRenderer.invoke("mcp:claude-repair"),
  repairClaudeDirectMcp: () => ipcRenderer.invoke("mcp:claude-direct-repair"),
  showClaudeMcpBundle: () => ipcRenderer.invoke("mcp:claude-show-bundle"),
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
  getHostClock: () => ipcRenderer.invoke("system-time:get"),
  syncHostClock: () => ipcRenderer.invoke("system-time:sync"),
  setHostClock: (value:string) => ipcRenderer.invoke("system-time:set", value),
  getGlobalMarketQuotes: (typeIds:number[]) => ipcRenderer.invoke("market:global-quotes", typeIds),
  getLpCorporations: (corporationIds:number[]) => ipcRenderer.invoke("lp-store:corporations", corporationIds),
  getLpStoreOffers: (corporationId:number, marketRevision = 0) => ipcRenderer.invoke("lp-store:offers", corporationId, marketRevision),
  getLpEarningCandidates: (standings:unknown, currentCorporationIds:number[]) => ipcRenderer.invoke("lp-store:earning-candidates", standings, currentCorporationIds),
  getContractMarketIntelligence: () => ipcRenderer.invoke("market:contract-intelligence"),
  getProfitLedger: (characterId?:string) => ipcRenderer.invoke("profit-ledger:list", characterId),
  completeProfitDeal: (input:unknown) => ipcRenderer.invoke("profit-ledger:complete", input),
  reconcileProfitLedger: (characterId?:string) => ipcRenderer.invoke("profit-ledger:reconcile", characterId),
  removeProfitLedgerRecord: (id:string) => ipcRenderer.invoke("profit-ledger:remove", id),
  getProfitReconciliationReview: (recordId:string) => ipcRenderer.invoke("profit-ledger:review", recordId),
  setProfitTransactionOverride: (input:unknown) => ipcRenderer.invoke("profit-ledger:transaction-override", input),
  setProfitMatchDecision: (input:unknown) => ipcRenderer.invoke("profit-ledger:match-decision", input),
  setProfitMaterialProvenance: (input:unknown) => ipcRenderer.invoke("profit-ledger:material-provenance", input),
  getProfitPurchaseReview: (recordId:string) => ipcRenderer.invoke("profit-ledger:purchase-review", recordId),
  setProfitPurchaseTransactionOverride: (input:unknown) => ipcRenderer.invoke("profit-ledger:purchase-override", input),
  applyProfitBulkBookkeeping: (input:unknown) => ipcRenderer.invoke("profit-ledger:bulk-bookkeeping", input),
  onWalletReconciled: (callback: (value: unknown) => void) => { const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value); ipcRenderer.on("wallet:reconciled", listener); return () => ipcRenderer.removeListener("wallet:reconciled", listener); },
  openEveContract: (input: { characterId: string; contractId: number }) => ipcRenderer.invoke("eve:open-contract", input),
  openEveMarketType: (input: { characterId:string; typeId:number }) => ipcRenderer.invoke("eve:open-market-type", input),
  getPlanetaryRevenue: (input:{ characterId:string; settings?:unknown }) => ipcRenderer.invoke("isklab:planetary-revenue", input),
  getPlanetaryPlan: (input:unknown) => ipcRenderer.invoke("isklab:planetary-plan", input),
  getPlanetaryState: () => ipcRenderer.invoke("isklab:planetary-state"),
  savePlanetaryPlan: (plan:unknown) => ipcRenderer.invoke("isklab:planetary-save-plan", plan),
  deletePlanetaryPlan: (id:string) => ipcRenderer.invoke("isklab:planetary-delete-plan", id),
  savePlanetaryObservations: (observations:unknown[]) => ipcRenderer.invoke("isklab:planetary-save-observations", observations),
  savePlanetaryAlertSettings: (settings:unknown) => ipcRenderer.invoke("isklab:planetary-save-alert-settings", settings),
  getPlanetaryBasket: (input:unknown) => ipcRenderer.invoke("isklab:planetary-basket", input),
  evaluatePlanetaryLayout: (input:unknown) => ipcRenderer.invoke("isklab:planetary-evaluate-layout", input),
  generatePlanetaryLayouts: (input:unknown) => ipcRenderer.invoke("isklab:planetary-generate-layouts", input),
  buildPlanetaryDesignerEveTemplate: (input:unknown) => ipcRenderer.invoke("isklab:planetary-designer-eve-template", input),
  getPlanetaryDesignerSeed: (input:unknown) => ipcRenderer.invoke("isklab:planetary-designer-seed", input),
  getCorporationDiscordState: (characterId:string) => ipcRenderer.invoke("corp:discord-state", characterId),
  getCorporationDiscordServerStructure: (characterId:string) => ipcRenderer.invoke("corp:discord-server-structure", characterId),
  configureCorporationDiscord: (input:unknown) => ipcRenderer.invoke("corp:discord-configure", input),
  getCorporationDiscordLinkUrl: (characterId:string) => ipcRenderer.invoke("corp:discord-link-url", characterId),
  sendCorporationDiscordAnnouncement: (input:unknown) => ipcRenderer.invoke("corp:discord-announce", input),
  updateCorporationDiscordNotificationTargets: (input:unknown) => ipcRenderer.invoke("corp:discord-notification-targets", input),
  testCorporationDiscordDm: (characterId:string) => ipcRenderer.invoke("corp:discord-test-dm", characterId),
  unlinkCorporationDiscord: (characterId:string) => ipcRenderer.invoke("corp:discord-unlink", characterId),  getCorporationRolesState: (characterId:string) => ipcRenderer.invoke("corp:roles-state", characterId),
  findCorporationHomes: (input:unknown) => ipcRenderer.invoke("corp:find-home", input),
  scanCorporationHomeCandidate: (input:unknown) => ipcRenderer.invoke("corp:find-home-scan", input),
  updateCorporationRolePermission: (input:unknown) => ipcRenderer.invoke("corp:roles-update", input),
  getCorporationOpsWorkspace: (characterId:string) => ipcRenderer.invoke("corp:ops-workspace", characterId),
  listCorporationOperations: (input:unknown) => ipcRenderer.invoke("corp:ops-list", input),
  publishCorporationOperation: (input:unknown) => ipcRenderer.invoke("corp:ops-publish", input),
  updateCorporationOperation: (input:unknown) => ipcRenderer.invoke("corp:ops-update", input),
  announceCorporationOperationDiscord: (input:unknown) => ipcRenderer.invoke("corp:ops-announce-discord", input),
  cancelCorporationOperation: (input:unknown) => ipcRenderer.invoke("corp:ops-cancel", input),
  takeCorporationOperationOwnership: (input:unknown) => ipcRenderer.invoke("corp:ops-take-ownership", input),
  setCorporationOperationApplicationNotifications: (input:unknown) => ipcRenderer.invoke("corp:ops-application-notifications", input),
  applyCorporationOperationRole: (input:unknown) => ipcRenderer.invoke("corp:ops-apply", input),
  decideCorporationOperationApplication: (input:unknown) => ipcRenderer.invoke("corp:ops-decision", input),  getPlanetaryCorpState: (input:unknown) => ipcRenderer.invoke("isklab:planetary-corp-state", input),
  publishPlanetaryCorpSurvey: (input:unknown) => ipcRenderer.invoke("isklab:planetary-corp-publish-survey", input),
  publishPlanetaryCorpTemplate: (input:unknown) => ipcRenderer.invoke("isklab:planetary-corp-publish-template", input),
  unpublishPlanetaryCorpObject: (input:unknown) => ipcRenderer.invoke("isklab:planetary-corp-unpublish", input),
  getAugmentGuideLocal: (installedTypeIds:number[]) => ipcRenderer.invoke("fitting:augment-guide", installedTypeIds),
  getBoosterSideEffectsLocal: (boosterTypeIds:number[]) => ipcRenderer.invoke("fitting:booster-side-effects-local", boosterTypeIds),
  copyText: (value: string) => ipcRenderer.invoke("clipboard:write", value),
  resolveTypeNames: (names: string[]) =>
    ipcRenderer.invoke("universe:resolve-types", names),
  resolveFittingTypeNamesLocal: (names: string[]) =>
    ipcRenderer.invoke("fitting:resolve-types-local", names),
  resolveFittingTypeIdsLocal: (typeIds: number[]) =>
    ipcRenderer.invoke("fitting:resolve-type-ids-local", typeIds),
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
  searchLootItems: (query: string, limit = 60) => ipcRenderer.invoke("loot:search", { query, limit }),
  getLootAcquisition: (typeId: number) => ipcRenderer.invoke("loot:acquisition", typeId),
  prepareLootDataLocal: () => ipcRenderer.invoke("loot:prepare"),
  getManufacturingPlan: (input: unknown) => ipcRenderer.invoke("industrial:manufacturing-plan", input),
  getFoundryWorkspace: (input: unknown) => ipcRenderer.invoke("industrial:foundry-workspace", input),
  getFoundryProjects: (input: unknown) => ipcRenderer.invoke("industrial:foundry-projects", input),
  searchFoundryBlueprints: (input: unknown) => ipcRenderer.invoke("industrial:foundry-blueprint-search", input),
  createFoundryProject: (input: unknown) => ipcRenderer.invoke("industrial:foundry-create", input),
  updateFoundryProject: (input: unknown) => ipcRenderer.invoke("industrial:foundry-update", input),
  deleteFoundryProject: (input: unknown) => ipcRenderer.invoke("industrial:foundry-delete", input),
  getRefineryCatalogue: () => ipcRenderer.invoke("industrial:refinery-catalogue"),
  getRefineryAnalysis: (input: unknown) => ipcRenderer.invoke("industrial:refinery-analysis", input),
  getReactionCatalogue: () => ipcRenderer.invoke("industrial:reaction-catalogue"),
  getReactionPlan: (input: unknown) => ipcRenderer.invoke("industrial:reaction-plan", input),
  getBlueprintActivities: (input: unknown) => ipcRenderer.invoke("industrial:blueprint-activities", input),
  getInventionOpportunities: (input: unknown) => ipcRenderer.invoke("industrial:invention-opportunities", input),
  getIndustrySystemCostIndex: (input: unknown) => ipcRenderer.invoke("industrial:system-cost-index", input),
  getIndustrialOpportunities: (input: unknown) => ipcRenderer.invoke("industrial:opportunities", input),
  getPreparedIndustrialCommand: (input: unknown) => ipcRenderer.invoke("industrial:prepared-state", input),
  getIndustrialOpportunityRouteScope: (input: unknown) => ipcRenderer.invoke("industrial:opportunity-route-scope", input),
  getPreparedIskLab: (input: unknown) => ipcRenderer.invoke("prepared:isk-lab", input),
  getShipReadiness: (input: unknown) =>
    ipcRenderer.invoke("skills:ship-readiness", input),
  getActivityHullPreviews: (input: unknown) =>
    ipcRenderer.invoke("activity:hull-previews", input),
  getActivityReadiness: (input: unknown) =>
    ipcRenderer.invoke("activity:readiness", input),
  analyzeFitting: (input: unknown) =>
    ipcRenderer.invoke("fitting:analyze", input),
  getCapabilities: (input: unknown) =>
    invokeAnalysis("capability:analyze", input),
  getCurrentShipCapability: (input: unknown) =>
    ipcRenderer.invoke("capability:current-ship", input),
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (input: { eveClientId: string }) =>
    ipcRenderer.invoke("config:save", input),
  loginWithEve: () => ipcRenderer.invoke("eve:login"),
  refreshCharacter: (characterId: string) =>
    ipcRenderer.invoke("eve:refresh", characterId),
  refreshCurrentShip: (characterId: string) =>
    ipcRenderer.invoke("eve:refresh-current-ship", characterId),
  listSnapshots: () => ipcRenderer.invoke("snapshot:list"),
  removeCharacter: (characterId: string) =>
    ipcRenderer.invoke("character:remove", characterId),
  getEveNews: (force = false) => ipcRenderer.invoke("news:list", force),
  searchSolarSystems: (query: string, limit = 20) => ipcRenderer.invoke("system-intelligence:search", query, limit),
  prepareNavigationGraph: () => ipcRenderer.invoke("navigation:prepare-graph"),
  searchNavigationSystems: (query: string, limit = 20) => ipcRenderer.invoke("navigation:search-systems", query, limit),
  getNavigationSystem: (systemId: number) => ipcRenderer.invoke("navigation:get-system", systemId),
  getNavigationNeighbours: (systemId: number) => ipcRenderer.invoke("navigation:get-neighbours", systemId),
  getNavigationMapData: (input: unknown) => ipcRenderer.invoke("navigation:map-data", input),
  getNavigationLiveMapMetrics: (force = false) => ipcRenderer.invoke("navigation:live-map-metrics", force),
  getNavigationCapitalContext: (characterId: string) => ipcRenderer.invoke("navigation:capital-context", characterId),
  calculateNavigationCapitalPlan: (input: unknown) => ipcRenderer.invoke("navigation:capital-plan", input),
  getNavigationEveWaypointChain: (route: unknown) => ipcRenderer.invoke("navigation:eve-waypoint-chain", route),
  exportNavigationRouteJson: (route: unknown) => ipcRenderer.invoke("navigation:export-route-json", route),
  importNavigationRouteJson: (text: string) => ipcRenderer.invoke("navigation:import-route-json", text),
  getNavigationOnlineWorkspace: (characterId: string) => ipcRenderer.invoke("navigation:online-workspace", characterId),
  listNavigationOnlineRoutes: (input: unknown) => ipcRenderer.invoke("navigation:online-routes", input),
  getNavigationOnlineRoute: (input: unknown) => ipcRenderer.invoke("navigation:online-route-get", input),
  publishNavigationOnlineRoute: (input: unknown) => ipcRenderer.invoke("navigation:online-route-publish", input),
  updateNavigationOnlineRoute: (input: unknown) => ipcRenderer.invoke("navigation:online-route-update", input),
  calculateNavigationRoute: (input: unknown) => ipcRenderer.invoke("navigation:calculate-route", input),
  calculateNavigationPlan: (input: unknown) => ipcRenderer.invoke("navigation:calculate-plan", input),
  exportNavigationRouteToEve: (input: unknown) => ipcRenderer.invoke("eve:export-navigation-route", input),
  getNavigationHazards: (force = false) => ipcRenderer.invoke("navigation:hazards", force),
  getNavigationCharacterLocation: (characterId: string, forceLive = true) => ipcRenderer.invoke("navigation:character-location", characterId, forceLive),
  getNavigationRouteIntelligence: (input: unknown) => ipcRenderer.invoke("navigation:route-intelligence", input),
  getWormholeCommandStore: () => ipcRenderer.invoke("wormhole:store-get"),
  exportWormholeSharedChain: () => ipcRenderer.invoke("wormhole:shared-export"),
  importWormholeSharedChain: (input: unknown) => ipcRenderer.invoke("wormhole:shared-import", input),
  mergeWormholeSharedChain: (input: unknown) => ipcRenderer.invoke("wormhole:shared-merge", input),
  getWormholeOnlineWorkspace: (characterId:string) => ipcRenderer.invoke("wormhole:online-workspace", characterId),
  listWormholeOnlineChains: (input:unknown) => ipcRenderer.invoke("wormhole:online-chains", input),
  getWormholeOnlineChain: (input:unknown) => ipcRenderer.invoke("wormhole:online-chain-get", input),
  publishWormholeOnlineChain: (input:unknown) => ipcRenderer.invoke("wormhole:online-chain-publish", input),
  updateWormholeOnlineChain: (input:unknown) => ipcRenderer.invoke("wormhole:online-chain-update", input),
  getWormholeOnlineEvents: (input:unknown) => ipcRenderer.invoke("wormhole:online-events", input),
  getWormholeOnlineAudit: (input:unknown) => ipcRenderer.invoke("wormhole:online-audit", input),
  importLegacyWormholeScans: (input: unknown) => ipcRenderer.invoke("wormhole:legacy-import", input),
  recordWormholeScan: (input: unknown) => ipcRenderer.invoke("wormhole:record-scan", input),
  observeWormholeSystem: (input: unknown) => ipcRenderer.invoke("wormhole:system-observe", input),
  upsertWormholeWatch: (input: unknown) => ipcRenderer.invoke("wormhole:watch-upsert", input),
  removeWormholeWatch: (watchId: string) => ipcRenderer.invoke("wormhole:watch-remove", watchId),
  recordWormholeWatchAlert: (input: unknown) => ipcRenderer.invoke("wormhole:watch-alert", input),
  dismissWormholeWatchAlert: (alertId: string) => ipcRenderer.invoke("wormhole:watch-alert-dismiss", alertId),
  updateWormholeMapLayout: (input: unknown) => ipcRenderer.invoke("wormhole:map-update", input),
  updateWormholeMapMarkers: (input: unknown) => ipcRenderer.invoke("wormhole:markers-update", input),
  updateWormholeSignature: (input: unknown) => ipcRenderer.invoke("wormhole:signature-update", input),
  updateWormholeSystem: (input: unknown) => ipcRenderer.invoke("wormhole:system-update", input),
  archiveWormholeSystem: (input: unknown) => ipcRenderer.invoke("wormhole:system-archive", input),
  previewWormholeCleanup: (input: unknown) => ipcRenderer.invoke("wormhole:cleanup-preview", input),
  applyWormholeCleanup: (input: unknown) => ipcRenderer.invoke("wormhole:cleanup-apply", input),
  upsertWormholeConnection: (input: unknown) => ipcRenderer.invoke("wormhole:connection-upsert", input),
  removeWormholeConnection: (connectionId: string) => ipcRenderer.invoke("wormhole:connection-remove", connectionId),
  getWormholeReference: () => ipcRenderer.invoke("wormhole:reference-list"),
  getWormholeReferenceEntry: (code: string) => ipcRenderer.invoke("wormhole:reference-get", code),
  getWormholeSystemReferences: (systemIds: number[]) => ipcRenderer.invoke("wormhole:system-reference", systemIds),
  getWormholeRollingShipMass: (input: unknown) => ipcRenderer.invoke("wormhole:rolling-ship-mass", input),
  onWormholeCommandUpdated: (callback: (value: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
    ipcRenderer.on("wormhole:store-updated", listener);
    return () => ipcRenderer.removeListener("wormhole:store-updated", listener);
  },
  getNavigationPublicWormholes: (force?: boolean) => ipcRenderer.invoke("navigation:public-wormholes", force),
  getWormholeSiteReference: (force?: boolean) => ipcRenderer.invoke("wormhole:site-reference", force),
  getSystemIntelligence: (systemId: number) => ipcRenderer.invoke("system-intelligence:get", systemId),
  refreshWatchedSystemIntelligence: (systemIds: number[]) => ipcRenderer.invoke("system-intelligence:refresh-watched", systemIds),
  refreshSystemIntelligence: (input: unknown) => ipcRenderer.invoke("system-intelligence:refresh", input),
  onSystemKillmailsUpdated: (callback: (value: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
    ipcRenderer.on("system-intelligence:killmails-updated", listener);
    return () => ipcRenderer.removeListener("system-intelligence:killmails-updated", listener);
  },
  exportData: (
    format: "json" | "chatgpt" | "chatgpt-radius",
    characterId?: string,
  ) => ipcRenderer.invoke("data:export", format, characterId),
  importData: () => ipcRenderer.invoke("data:import"),
  exportDebugLog: () => ipcRenderer.invoke("debug:export"),
  listMarketRegions: () => ipcRenderer.invoke("market:regions"),
  buildFitShoppingRoute: (input: unknown) =>
    ipcRenderer.invoke("fit:shopping-route", input),
  exportShoppingRouteToEve: (input: unknown) =>
    ipcRenderer.invoke("eve:export-shopping-route", input),
  exportFitToEve: (input: unknown) =>
    ipcRenderer.invoke("eve:export-fit", input),
  findRadiusTrades: (mode: string) =>
    ipcRenderer.invoke("trade:radius-opportunities", mode),
  getOpportunityAnalysis: (input: unknown) =>
    invokeAnalysis("opportunity:analyze", input),
  getPveLocationAnalysis: (input: unknown) =>
    invokeAnalysis("pve:locations", input),
  cancelAnalysis: (kind?: string) => ipcRenderer.invoke("analysis:cancel", kind),
  getAnalysisStatus: () => ipcRenderer.invoke("analysis:status"),
  runMasterUpdate: (input?: unknown) => ipcRenderer.invoke("master:update-all", input),
  onPreparedDataUpdated: (callback: (value: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
    ipcRenderer.on("prepared:data-updated", listener);
    return () => ipcRenderer.removeListener("prepared:data-updated", listener);
  },
  onMasterUpdateProgress: (callback: (progress: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress);
    ipcRenderer.on("master:update-progress", listener);
    return () => ipcRenderer.removeListener("master:update-progress", listener);
  },
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
