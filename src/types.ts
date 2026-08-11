export interface EveNewsItem {
  id: string;
  title: string;
  link: string;
  publishedAt: string;
  summary: string;
  category: "ccp" | "market" | "war" | "events";
}

export interface PublicConfig {
  eveClientId: string;
  callbackUrl: string;
  connectedCharacterIds: string[];
}

export interface CharacterSnapshot {
  characterId: string;
  character: {
    name: string;
    corporation_id: number;
    corporation_name: string;
    alliance_id?: number;
    security_status?: number;
  };
  wallet: number;
  skills: { total_sp: number; unallocated_sp?: number; skills: SkillDetail[] };
  queue: Array<{
    skill_id: number;
    finish_date?: string;
    finished_level: number;
  }>;
  attributes?: {
    charisma: number;
    intelligence: number;
    memory: number;
    perception: number;
    willpower: number;
  };
  location: {
    solar_system_id: number;
    solar_system_name: string;
    place_name: string;
    station_id?: number;
    structure_id?: number;
  };
  ship: {
    ship_item_id: number;
    ship_name: string;
    ship_type_id: number;
    ship_type_name: string;
  };
  updatedAt: string;
  extended?: {
    implants?: Array<number | { typeId: number; name: string }>;
    industryJobs?: any[];
    marketOrders?: any[];
    contracts?: any[];
    notifications?: any[];
    assetSummary?: {
      ownedShips?: Array<{ item: string; quantity: number }>;
    };
  };
}

export interface SkillDetail {
  skill_id: number;
  name: string;
  trained_skill_level: number;
  active_skill_level: number;
  skillpoints_in_skill: number;
  rank: number;
  timeToLevels: Array<{
    level: number;
    seconds: number | null;
    queuedFinishDate?: string;
  }>;
}

export interface ShipReadinessSkill {
  skillId: number;
  name: string;
  currentLevel: number;
  targetLevel: number;
  currentSkillPoints: number;
  rank: number;
  direct: boolean;
  met: boolean;
  missingLevels: number;
  estimatedSeconds: number | null;
  queuedToLevel: number;
  alreadyQueued: boolean;
  prerequisiteSkillIds: number[];
  requiredBySkillIds: number[];
  sources?: Array<"item" | "activity">;
  reasons?: string[];
}

export interface ShipReadinessResult {
  hullTypeId: number;
  hull: string;
  characterId: string;
  character: string;
  readinessPercent: number;
  ready: boolean;
  hullAccessPercent: number;
  hullAccessReady: boolean;
  hullAccessSkills: ShipReadinessSkill[];
  missingHullAccessSkills: ShipReadinessSkill[];
  targetMasteryLevel: number;
  masteryLevel: number;
  masteryLabel: string;
  relevantSkills: ShipReadinessSkill[];
  missingSkills: ShipReadinessSkill[];
  prerequisiteSkills: ShipReadinessSkill[];
  dependencyOrder: ShipReadinessSkill[];
  recommendedQueue: ShipReadinessSkill[];
  totalEstimatedSeconds: number | null;
  directRequirements: number;
  metDirectRequirements: number;
  explanation: {
    formula: string;
    reasons: string[];
    strengths: string[];
    weaknesses: string[];
  };
}

export interface ActivityFitArchetypeReadiness {
  id: string;
  label: string;
  source: "eve-workbench-abyss" | "zkillboard-recent-losses";
  sampleCount: number;
  confidence: "none" | "low" | "medium" | "high";
  contextSpecific: boolean;
  fitPercent: number;
  overallPercent: number;
  missingFitSkills: number;
  itemTypeIds: number[];
  items: Array<{ typeId: number; name: string; presencePercent: number }>;
}

export interface ActivityContextEvidence {
  source: "eve-workbench-journal" | "none";
  status: "ready" | "not-applicable" | "no-data" | "error";
  contextSpecific: boolean;
  fetchedAt: string;
  sampleCount: number;
  confidence: "none" | "low" | "medium" | "high";
  label: string;
  note?: string;
  entries: Array<{
    name: string;
    level: number | null;
    runs: number;
    survivedRuns: number;
    averageObservedProfit: number | null;
  }>;
}

export interface ActivityReadinessResult {
  hullTypeId: number;
  hull: string;
  context: { activityId: string; subcategoryId: string; contentId: string; selectorValues?: Record<string, string> };
  model: "combat" | "harvesting" | "exploration" | "hauling" | "industry" | "trading" | "capital" | "general";
  overallPercent: number;
  masteryPercent: number;
  tier: {
    id: "not-ready" | "early-training" | "developing" | "operational" | "strong" | "near-target" | "target-ready";
    label: string;
    description: string;
  };
  compatible: boolean;
  compatibilityReason?: string;
  components: {
    hull: { percent: number | null; weight: number; missing: number | null };
    fit: { percent: number | null; weight: number; missing: number | null; sampleCount: number; confidence: "none" | "low" | "medium" | "high"; status: "ready" | "no-data" | "error"; contextSpecific: boolean };
    activity: { percent: number; weight: number; corePercent: number; supportPercent: number; missingCore: number; missingSupport: number };
    context: { percent: number; weight: number; missing: number; targets: Array<{ skill: string; level: number }> };
  };
  activityEvidence: ActivityContextEvidence;
  fitEvidence: {
    status: "ready" | "no-data" | "error";
    source: "eve-workbench-abyss" | "zkillboard-recent-losses" | "none";
    contextSpecific: boolean;
    fetchedAt: string;
    sampleCount: number;
    confidence: "none" | "low" | "medium" | "high";
    note?: string;
    archetypes: ActivityFitArchetypeReadiness[];
  };
  selectedArchetype: ActivityFitArchetypeReadiness | null;
  alternativeArchetypes: ActivityFitArchetypeReadiness[];
  recommendedQueue: ShipReadinessSkill[];
  totalEstimatedSeconds: number | null;
  missingSkills: ShipReadinessSkill[];
  masteryQueue: ShipReadinessSkill[];
  missingMasterySkills: ShipReadinessSkill[];
  explanation: { formula: string; reasons: string[]; caveats: string[] };
}
export interface CapabilityUpgrade {
  type: "skill" | "ship" | "module" | "blueprint" | "wallet";
  label: string;
  why: string;
  estimatedGain: number;
  estimatedSeconds?: number | null;
  estimatedCost?: number | null;
}

export interface CapabilityResult {
  id: string;
  label: string;
  description: string;
  overallPercent: number;
  readinessPercent: number;
  assetPercent: number;
  resourcePercent: number;
  tier: string;
  bestRoute: string;
  bestHull?: string;
  ownedHull: boolean;
  missingAssetCost: number | null;
  missingAssetCount: number;
  queuedRelevantSkills: number;
  blueprintCount: number;
  savedFitCount: number;
  strengths: string[];
  weaknesses: string[];
  upgrades: CapabilityUpgrade[];
  showWork: string[];
}

export interface CapabilityAnalysis {
  characterId: string;
  character: string;
  generatedAt: string;
  capabilities: CapabilityResult[];
  topRecommendations: Array<{ capabilityId: string; capability: string; upgrade: CapabilityUpgrade }>;
  dataSignals: { wallet: number; ownedShips: number; modules: number; blueprints: number; savedFittings: number; activeQueue: number };
}

export interface AnalysisProgress {
  jobId: string;
  kind: "opportunity" | "capability" | "trade" | "raw-market" | "regional-filter" | "pve-location";
  stage: string;
  message: string;
  completed?: number;
  total?: number;
  percent?: number;
  cached?: boolean;
  startedAt: string;
}

export type OpportunityRisk = "Low" | "Medium" | "High";
export type OpportunityKind = "trade" | "asset" | "shortage" | "pve";

export interface MarketOpportunity {
  id: string;
  typeId: number;
  item: string;
  categoryId: number;
  category: string;
  sell: { orderId: number; price: number; volumeRemain: number; systemId: number; systemName: string; locationId: number; locationName: string; regionName: string };
  buy: { orderId: number; price: number; volumeRemain: number; minVolume: number; systemId: number; systemName: string; locationId: number; locationName: string; regionName: string };
  units: number;
  availableUnits: number;
  itemVolumeM3: number;
  cargoM3: number;
  investment: number;
  profit: number;
  marginPercent: number;
  iskPerM3: number;
  iskPerJump: number;
  capitalEfficiencyPercent: number;
  jumps: number;
  estimatedMinutes: number;
  fillScore: number;
  risk: OpportunityRisk;
  routeSecurity: "high" | "low" | "null";
  marginWidenedBy: number | null;
  score: number;
  scoreBreakdown: { profit: number; fill: number; route: number; capitalEfficiency: number; cargoEfficiency: number };
  reasons: string[];
}

export interface PersonalOpportunity {
  id: string;
  kind: OpportunityKind;
  title: string;
  subtitle: string;
  category: string;
  score: number;
  risk: OpportunityRisk;
  jumps: number;
  estimatedMinutes: number;
  fillScore: number;
  capitalRequired: number;
  profit: number | null;
  marginPercent: number | null;
  cashRelease: number | null;
  primaryValue: number;
  primaryLabel: string;
  primaryText?: string;
  confidenceLabel?: string;
  reasons: string[];
  action: string;
}

export interface OpportunityAnalysis {
  generatedAt: string;
  character: null | { characterId: string; name: string; wallet: number; systemId: number | null; systemName: string | null };
  constraints: { maxCapital: number | null; cargoCapacityM3: number; maxJumps: number | null; maxMinutes: number | null; capitalBasis: string; cargoBasis: string };
  market: {
    opportunities: MarketOpportunity[];
    facets: { categories: string[]; buyRegions: string[]; sellRegions: string[]; risks: OpportunityRisk[]; maximumProfit: number; maximumMarginPercent: number; maximumIskPerM3: number; maximumJumps: number };
    diagnostics: unknown;
  };
  ranked: PersonalOpportunity[];
  signals: { ownedAssetStacks: number; marketTradesConsidered: number; marketDatasetCreatedAt: string | null; marketDatasetAgeMinutes: number | null; marketDatasetStale: boolean; marketOrdersInspected: number; marketRegionsInspected: number; marketSource: string; regionalShortageSignals: number };
}

export type PveLocationKind = "incursion" | "mission-staging" | "ded-search" | "lowsec-ratting" | "nullsec-ratting";

export interface PveLocationOpportunity {
  id: string;
  kind: PveLocationKind;
  label: string;
  systemId: number;
  systemName: string;
  regionId: number;
  regionName: string;
  constellationId: number;
  constellationName: string;
  securityStatus: number;
  securityBand: "high" | "low" | "null";
  jumps: number;
  estimatedMinutes: number;
  availability: "live" | "search-area" | "static-candidate";
  score: number;
  risk: OpportunityRisk;
  confidence: "low" | "medium" | "high";
  confidenceScore: number;
  earnings?: { lowPerHour: number; highPerHour: number; basis: string };
  readiness: null | { capabilityId: string; label: string; percent: number; tier: string; bestRoute: string };
  standing: null | { entityType: "npc_corp" | "faction"; entityId: number; name: string; value: number };
  corporationName?: string;
  factionName?: string | null;
  stationCount?: number;
  npcKills: number;
  shipKills: number;
  podKills: number;
  shipJumps: number;
  incursion?: { state: string; influence: number; hasBoss: boolean; type: string };
  reasons: string[];
  action: string;
  caveat: string;
}

export interface PveLocationAnalysis {
  generatedAt: string;
  character: { characterId: string; name: string; systemId: number; systemName: string; shipName: string | null };
  constraints: { maxJumps: number | null; maxMinutes: number | null };
  locations: PveLocationOpportunity[];
  ranked: PersonalOpportunity[];
  counts: Record<PveLocationKind, number>;
  dataStatus: { source: string; fetchedAt: string; ageMinutes: number; stale: boolean; errors: string[] };
  notes: string[];
}

export interface MarketSummary {
  regionId: number;
  regionName: string;
  orderCount: number;
  pageCount: number;
  buyOrders: number;
  sellOrders: number;
  uniqueTypes: number;
  remainingUnits: number;
  updatedAt: string;
  items?: MarketItem[];
  topOrders: Array<{
    order_id: number;
    is_buy_order: boolean;
    price: number;
    volume_remain: number;
    typeName: string;
    totalValue: number;
  }>;
}

export interface RetainedMarketOrder {
  orderId: number;
  price: number;
  volumeRemain: number;
  locationId: number;
  locationName: string;
  systemId: number;
  systemName: string;
  issued: string;
  minVolume?: number;
  range?: string;
  durationDays?: number;
}

export interface MarketItem {
  typeId: number;
  typeName: string;
  categoryId?: number;
  categoryName?: string;
  itemVolumeM3?: number;
  estimatedUnitValue?: number;
  buyOrderCount: number;
  sellOrderCount: number;
  buyVolume: number;
  sellVolume: number;
  bestBuy: number | null;
  bestSell: number | null;
  spreadPercent: number | null;
  topBuyOrders?: RetainedMarketOrder[];
  topSellOrders?: RetainedMarketOrder[];
  omittedBuyOrders?: number;
  omittedSellOrders?: number;
}

export interface RawMarketSearchOrder {
  orderId: number;
  typeId: number;
  typeName: string;
  side: "buy" | "sell";
  price: number;
  volumeRemain: number;
  volumeTotal: number;
  minVolume: number;
  range: string;
  issued: string;
  durationDays: number;
  regionId: number;
  regionName: string;
  systemId: number;
  systemName: string;
  securityStatus: number | null;
  securityBand: "high" | "low" | "null" | "unknown";
  locationId: number;
  locationName: string;
}

export type RegionalMarketFilterSecurity = "all" | "high" | "low" | "null";
export type RegionalMarketPresence = "any" | "buy" | "sell" | "both";
export type RegionalMarketSignal = "all" | "supply-gap" | "thin-supply" | "premium" | "buy-pressure";
export type RegionalMarketSort = "signal" | "name" | "best-buy" | "best-sell" | "buy-orders" | "sell-orders" | "buy-volume" | "sell-volume" | "spread" | "premium" | "demand-pressure" | "cargo-size";

export interface RegionalMarketFilterRow {
  typeId: number; item: string; categoryId: number; category: string; groupId: number; group: string; marketGroupId: number | null; marketGroup: string; marketGroupPath: string; itemVolumeM3: number;
  regionId: number; region: string; security: RegionalMarketFilterSecurity; buyOrders: number; sellOrders: number; buyVolume: number; sellVolume: number;
  bestBuy: number | null; bestBuySystemId: number | null; bestBuySystemName: string | null; bestBuyVolume: number; bestSell: number | null; bestSellSystemId: number | null; bestSellSystemName: string | null; bestSellVolume: number;
  spreadPercent: number | null; globalCheapestSell: number | null; globalCheapestSellRegion: string | null; regionalPremiumPercent: number | null; demandSupplyRatio: number;
  supplyGap: boolean; thinSupply: boolean; buyPressure: boolean; signalScore: number;
}

export interface RegionalMarketFilterResult {
  available: boolean; message?: string; snapshot: null | { id: string; createdAt: string; orderCount: number; regionCount: number };
  filters: { query: string; categoryIds: number[]; groupIds: number[]; marketGroupIds: number[]; regionIds: number[]; security: RegionalMarketFilterSecurity; presence: RegionalMarketPresence; signal: RegionalMarketSignal; sort: RegionalMarketSort };
  taxonomy: { categories: Array<{ id: number; name: string; typeCount: number }>; groups: Array<{ id: number; name: string; categoryId: number; categoryName: string; typeCount: number }>; marketGroups: Array<{ id: number; name: string; parentId: number | null; path: string[]; pathLabel: string; typeCount: number }> };
  regionOptions: Array<{ regionId: number; regionName: string }>; totalRows: number; totalItems: number; offset: number; limit: number; rows: RegionalMarketFilterRow[];
  summary: { supplyGaps: number; thinSupply: number; premiumRows: number; buyPressureRows: number; regionsRepresented: number; categoriesRepresented: number; highestPremiumPercent: number; highestDemandSupplyRatio: number };
}

export interface RawMarketSearchResult {
  available: boolean;
  message?: string;
  snapshot: null | { id: string; createdAt: string; completedAt?: string; orderCount: number; regionCount: number };
  query: string;
  typeMatches: Array<{ typeId: number; name: string; categoryId: number; categoryName: string }>;
  selectedType: null | { typeId: number; name: string; categoryId: number; categoryName: string };
  filters: {
    side: "all" | "buy" | "sell";
    security: "all" | "high" | "low" | "null";
    regionId: number | null;
    minPrice: number | null;
    maxPrice: number | null;
    sort: "sell-lowest" | "buy-highest" | "price-low" | "price-high" | "volume" | "newest";
  };
  regionOptions: Array<{ regionId: number; regionName: string }>;
  totalOrders: number;
  buyOrders: number;
  sellOrders: number;
  regionsWithOrders: number;
  bestBuy: number | null;
  bestSell: number | null;
  offset: number;
  limit: number;
  orders: RawMarketSearchOrder[];
}

declare global {
  interface Window {
    sage: {
      getUpdateState(): Promise<{ version: string; packaged: boolean }>;
      checkForUpdates(): Promise<unknown>;
      downloadUpdate(): Promise<unknown>;
      installUpdate(): Promise<boolean>;
      openSupportPage(): Promise<void>;
      getMcpSetup(): Promise<{ command: string; args: string[]; json: string; codex: string; access: string }>;
      getMcpTunnelStatus(): Promise<{ configured: boolean; tunnelId: string; running: boolean; ready: boolean; healthUrl: string }>;
      configureMcpTunnel(input: { tunnelId: string; runtimeKey: string }): Promise<{ configured: boolean; tunnelId: string; running: boolean; ready: boolean; healthUrl: string }>;
      openChatGptPlugins(): Promise<void>;
      openOpenAiTunnels(): Promise<void>;
      openOpenAiApiKeys(): Promise<void>;
      syncMcpRendererData(value: unknown): Promise<boolean>;
      onMcpFitDataUpdated(callback: (value: { savedFits?: unknown[]; fitLibraryMeta?: Record<string, unknown> }) => void): () => void;
      onUpdateStatus(callback: (value: { status: string; detail?: any }) => void): () => void;
      copyText(value: string): Promise<boolean>;
      resolveTypeNames(
        names: string[],
      ): Promise<Array<{ id: number; name: string }>>;
      resolveFittingTypeNamesLocal(
        names: string[],
      ): Promise<Array<{ id: number; name: string }>>;
      resolveTypeIds(ids: number[]): Promise<Array<{ id: number; name: string }>>;
      listShips(): Promise<Array<{ typeId: number; name: string }>>;
      getShipReadiness(input: {
        characterId: string;
        hullTypeId: number;
        cloneState?: "alpha" | "omega";
        masteryLevel?: number;
      }): Promise<ShipReadinessResult>;
      getActivityReadiness(input: {
        characterId: string;
        hullTypeId: number;
        cloneState?: "alpha" | "omega";
        coreSkills: Array<{ skill: string; level: number }>;
        supportSkills: Array<{ skill: string; level: number }>;
        context: { activityId: string; subcategoryId: string; contentId: string; selectorValues?: Record<string, string> };
        archetypeId?: string;
      }): Promise<ActivityReadinessResult>;
      analyzeFitting(input: {
        characterId: string;
        hullTypeId?: number;
        itemTypeIds: number[];
        items?: Array<{ typeId: number; quantity?: number; rack?: string; chargeTypeId?: number; chargeQuantity?: number; activeQuantity?: number; attributeOverrides?: Record<string, number>; state?: "offline" | "online" | "active" | "overheated" }>;
        targetProfile?: { rangeM: number; signatureRadiusM: number; transverseVelocityMps: number; velocityMps: number };
        damageProfile?: { em: number; thermal: number; kinetic: number; explosive: number };
        boosterTypeIds?: number[];
        boosterSideEffectIds?: number[];
        projectedItems?: Array<{ typeId: number; chargeTypeId?: number; attributeOverrides?: Record<string, number>; state?: "offline" | "online" | "active" | "overheated"; effectiveness?: number }>;
        commandBurstItems?: Array<{ typeId: number; quantity?: number; chargeTypeId?: number; chargeQuantity?: number; activeQuantity?: number; attributeOverrides?: Record<string, number>; state?: "offline" | "online" | "active" | "overheated"; effectiveness?: number }>;
        environmentTypeIds?: number[];
      }): Promise<any>;
      getCapabilities(input: {
        characterId: string;
        cloneState?: "alpha" | "omega";
      }): Promise<CapabilityAnalysis>;
      getConfig(): Promise<PublicConfig>;
      saveConfig(input: { eveClientId: string }): Promise<PublicConfig>;
      loginWithEve(): Promise<{
        characterId: string;
        characterName: string;
        snapshot: CharacterSnapshot;
      }>;
      refreshCharacter(characterId: string): Promise<CharacterSnapshot>;
      listSnapshots(): Promise<CharacterSnapshot[]>;
      getEveNews(force?: boolean): Promise<EveNewsItem[]>;
      removeCharacter(characterId: string): Promise<CharacterSnapshot[]>;
      exportData(
        format: "json" | "chatgpt" | "chatgpt-radius",
        characterId?: string,
      ): Promise<string | null>;
      importData(): Promise<{
        snapshots: number;
        information: number;
        files: number;
      } | null>;
      exportDebugLog(): Promise<string | null>;
      listMarketRegions(): Promise<Array<{ regionId: number; name: string }>>;
      buildFitShoppingRoute(input: {
        characterId: string;
        buyEntireFit: boolean;
        items: Array<{ typeId?: number; name: string; quantity: number }>;
      }): Promise<any>;
      findRadiusTrades(
        mode:
          | "top"
          | "top1000"
          | "widened"
          | "likely"
          | "capital"
          | "under10"
          | "wallet100m"
          | "viator"
          | "iskm3",
      ): Promise<any>;
      getOpportunityAnalysis(input: {
        characterId?: string;
        maxCapital?: number | null;
        cargoCapacityM3?: number | null;
        maxJumps?: number | null;
        maxMinutes?: number | null;
      }): Promise<OpportunityAnalysis>;
      getPveLocationAnalysis(input: {
        characterId: string;
        cloneState?: "alpha" | "omega";
        maxJumps?: number | null;
        maxMinutes?: number | null;
        forceLive?: boolean;
      }): Promise<PveLocationAnalysis>;
      cancelAnalysis(kind?: "opportunity" | "capability" | "trade" | "raw-market" | "regional-filter" | "pve-location"): Promise<boolean>;
      getAnalysisStatus(): Promise<any>;
      onAnalysisProgress(callback: (progress: AnalysisProgress) => void): () => void;
      exportTopArbitrage(): Promise<string | null>;
      filterRegionalMarket(input: {
        query?: string; categoryIds?: number[]; groupIds?: number[]; marketGroupIds?: number[]; regionIds?: number[]; security?: RegionalMarketFilterSecurity; presence?: RegionalMarketPresence; signal?: RegionalMarketSignal;
        minBestBuy?: number | null; maxBestBuy?: number | null; minBestSell?: number | null; maxBestSell?: number | null; minBuyOrders?: number | null; maxBuyOrders?: number | null; minSellOrders?: number | null; maxSellOrders?: number | null; minBuyVolume?: number | null; minSellVolume?: number | null; maxSellVolume?: number | null;
        minSpreadPercent?: number | null; maxSpreadPercent?: number | null; minRegionalPremiumPercent?: number | null; minDemandSupplyRatio?: number | null; maxItemVolumeM3?: number | null; sort?: RegionalMarketSort; offset?: number; limit?: number;
      }): Promise<RegionalMarketFilterResult>;
      searchRawMarket(input: {
        query: string;
        typeId?: number;
        side?: "all" | "buy" | "sell";
        security?: "all" | "high" | "low" | "null";
        regionId?: number | null;
        minPrice?: number | null;
        maxPrice?: number | null;
        sort?: "sell-lowest" | "buy-highest" | "price-low" | "price-high" | "volume" | "newest";
        offset?: number;
        limit?: number;
      }): Promise<RawMarketSearchResult>;
      listMarketSummaries(): Promise<MarketSummary[]>;
      getMarketRegion(regionId: number): Promise<MarketSummary | null>;
      getMarketStorage(): Promise<{
        path: string;
        retainedDatasets: number;
        raw?: { root: string; snapshotId: string; createdAt: string; orderCount: number; regionCount: number; complete: boolean } | null;
      }>;
      pullMarket(input: {
        mode: "single" | "all" | "radius" | "contracts";
        regionId?: number;
        characterId?: string;
        includeLowSec?: boolean;
      }): Promise<{
        summaries: MarketSummary[];
        storage: {
          path: string;
          retained: number;
          raw?: { root: string; snapshotId: string; orderCount: number; regionCount: number } | null;
        };
      }>;
      onMarketProgress(
        callback: (progress: {
          mode: "single" | "all" | "radius" | "contracts";
          regionName: string;
          regionsDone: number;
          regionsTotal: number;
          pagesDone: number;
          pagesTotal: number;
        }) => void,
      ): () => void;
    };
  }
}
