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
  sageOnlineConnected: boolean;
  identitySchemaVersion: number;
  sageAccountId: string | null;
  primaryCharacterId: string | null;
}

export interface PublicDataStatus {
  installed: boolean;
  generation: string | null;
  createdAt: string | null;
  source: "shared" | null;
  orderCount: number;
  regionCount: number;
  updateAvailable: boolean;
  availableGeneration: string | null;
  lastCheckedAt: string | null;
}

export interface CharacterSnapshot {
  characterId: string;
  snapshotState?: "bootstrap" | "synced";
  connectedAt?: string;
  coreUpdatedAt?: string;
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
    start_date?: string;
    finish_date?: string;
    finished_level: number;
    training_start_sp?: number;
    level_end_sp?: number;
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
    loyaltyPoints?: Array<{ corporation_id:number; loyalty_points:number }>;
    standings?: Array<Record<string, unknown>>;
    industryJobs?: any[];
    marketOrders?: any[];
    contracts?: any[];
    killmails?: any[];
    killmailDetails?: any[];
    notifications?: any[];
    assets?: any[];
    planets?: Array<Record<string, unknown>>;
    planetDetails?: Array<Record<string, unknown>>;
    assetSummary?: {
      ownedShips?: Array<{ item: string; quantity: number }>;
    };
    currentShipFit?: Array<{ item_id:number; type_id:number; location_id:number; location_flag:string; quantity:number; item?:string; category_id?:number }>;
    walletTransactions?: Array<{ transaction_id:number; journal_ref_id:number; date:string; is_buy:boolean; is_personal?:boolean; location_id:number; quantity:number; type_id:number; unit_price:number }>;
    walletJournal?: Array<{ id:number; amount?:number; balance?:number; context_id?:number; context_id_type?:string; date:string; description?:string; first_party_id?:number; reason?:string; ref_type?:string; second_party_id?:number; tax?:number; tax_receiver_id?:number }>;
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

export interface HullAccessPreview { hullTypeId:number; hullTrainingPercent:number; competencyPercent:number; hullAccessReady:boolean; directRequirements:number; missingDirectRequirements:number }

export interface ShipReadinessResult {
  hullTypeId: number;
  hull: string;
  characterId: string;
  character: string;
  readinessPercent: number;
  ready: boolean;
  hullAccessPercent: number;
  hullTrainingPercent: number;
  hullAccessReady: boolean;
  hullAccessSkills: ShipReadinessSkill[];
  missingHullAccessSkills: ShipReadinessSkill[];
  hullAccessTrainingSkills: ShipReadinessSkill[];
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

export interface ActivityFitPayloadItem { typeId: number; name: string; quantity: number }
export interface ActivityFitPayload { low: ActivityFitPayloadItem[]; mid: ActivityFitPayloadItem[]; high: ActivityFitPayloadItem[]; rig: ActivityFitPayloadItem[]; subsystem: ActivityFitPayloadItem[]; drones: ActivityFitPayloadItem[]; fighters: ActivityFitPayloadItem[]; cargo: ActivityFitPayloadItem[] }
export interface ActivityRecommendedFit { id: string; name: string; itemTypeIds: number[]; fit: ActivityFitPayload }
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
  representativeFitCount: number;
  usableFitCount: number;
  fitChoices: ActivityRecommendedFit[];
  progressionFit?: ActivityRecommendedFit;
  recommendedFit?: ActivityRecommendedFit;
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
  hullAccessReady: boolean;
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
    hull: { percent: number | null; accessReady: boolean; accessPercent: number | null; trainingPercent: number | null; weight: number; missing: number | null; gaps: ShipReadinessSkill[] };
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

export type ShipUseProfileId = "pve-combat" | "pvp-combat" | "mining" | "exploration" | "logistics" | "hauling" | "salvage" | "support" | "general";

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

export interface CargoCapacityProfile { id:string; characterId:string; characterName:string; shipItemId:number; shipTypeId:number; shipName:string; quantity:number; systemName:string|null; stationName:string|null; capacityM3:number; fittedItemCount:number; isCurrentShip:boolean; basis:string }

export interface OpportunityAnalysis {
  generatedAt: string;
  character: null | { characterId: string; name: string; wallet: number; systemId: number | null; systemName: string | null };
  constraints: { maxCapital: number | null; cargoCapacityM3: number; cargoProfileId:string|null; cargoProfiles:CargoCapacityProfile[]; maxJumps: number | null; maxMinutes: number | null; capitalBasis: string; cargoBasis: string };
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
  character: { characterId: string; name: string; systemId: number; systemName: string; shipName: string | null; shipTypeId: number | null; shipReadiness: null | { percent: number; tier: string; label: string; profile: "pve-combat" } };
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
  jumpsFromOrigin: number | null;
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
    minVolume: number | null;
    systemNames: string[];
    systemQuery: string;
    locationQuery: string;
    originSystemId: number | null;
    maxJumps: number | null;
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

export type FitRemedyCandidate = {
  kind: "skill" | "implant" | "rig";
  typeId: number;
  name: string;
  solves: string[];
  affectedAttributeId: number;
  effectValue: number;
  operation: number;
  skillTypeId?: number;
  skillName?: string;
  currentLevel?: number;
  targetLevel?: number;
  reason: string;
};

export type FitResolutionIntent = {
  source: "dream-fit" | "fit-issues";
  fitName: string;
  hullTypeId: number;
  hullName: string;
  characterId?: string;
  issues: Array<{ level: string; code: string; message: string; item?: string }>;
  missingRequirements: Array<{ item: string; skillId: number; skill: string; requiredLevel: number; trainedLevel: number }>;
  remedies: FitRemedyCandidate[];
  resources?: { used: { cpu:number; powergrid:number; calibration:number }; capacity: { cpu:number; powergrid:number; calibration:number } };
};


export type NavigationRouteMode = "shortest" | "safer" | "less-secure" | "high-sec";

export interface NavigationSystem {
  systemId: number;
  name: string;
  securityStatus: number;
  constellationId: number;
  constellationName: string;
  regionId: number;
  regionName: string;
  position: { x: number; y: number; z: number };
  position2D?: { x: number; y: number };
}

export type NavigationEdgeType = "gate" | "ansiblex" | "wormhole" | "thera" | "turnur" | "zarzakh" | "jump-drive" | "manual";

export interface NavigationRouteLeg {
  from: number;
  to: number;
  type: NavigationEdgeType;
  gateId?: number;
  destinationGateId?: number;
  gatePosition?: { x: number; y: number; z: number };
  metadata?: Record<string, string | number | boolean | null>;
}

export interface NavigationRouteResult {
  found: boolean;
  reason?: string;
  mode: NavigationRouteMode;
  minSecurity: number | null;
  totalWeight: number;
  jumps: number;
  minimumSecurityStatus: number;
  minimumDisplayedSecurityStatus: number;
  securityTransitions: number;
  regionCount: number;
  systems: NavigationSystem[];
  legs: NavigationRouteLeg[];
}

export interface NavigationGraphStatus {
  systems: number;
  edges: number;
  preparedAt: string;
  source: "cache" | "sde";
  cachePath: string;
}

export interface NavigationRouteProfile {
  mode: NavigationRouteMode;
  minSecurity: number | null;
  avoids: { systemIds: number[]; constellationIds: number[]; regionIds: number[] };
  dynamicHazards: { providerIds: string[]; excludedSystemIds: number[]; snapshotAt?: string };
  specialConnections: { enabledTypes: NavigationEdgeType[]; disabledNetworkIds: string[]; wormholePolicy: { avoidEol:boolean; avoidCritical:boolean; avoidFrigateOnly:boolean; shipMassKg:number|null; shipName?:string } };
}

export interface NavigationRouteSegment {
  segmentId: string;
  fromWaypointIndex: number;
  toWaypointIndex: number;
  fromSystemId: number;
  toSystemId: number;
  locked: boolean;
  lockId?: string;
  manual: boolean;
  found: boolean;
  reason?: string;
  jumps: number;
  totalWeight: number;
  systems: NavigationSystem[];
  legs: NavigationRouteLeg[];
}

export interface NavigationLockedSegment {
  lockId: string;
  fromSystemId: number;
  toSystemId: number;
  systemIds: number[];
  createdAt?: string;
}

export interface NavigationCustomConnection {
  connectionId: string;
  fromSystemId: number;
  toSystemId: number;
  type: NavigationEdgeType;
  enabled: boolean;
  bidirectional: boolean;
  label?: string;
  networkId?: string;
  networkName?: string;
  ownerId?: number;
  ownerName?: string;
  access?: string;
  discoveredAt?: string;
  expiresAt?: string;
  connectionClass?: string;
  status?: "active" | "expiring" | "expired" | "unknown";
  maxJumpMassKg?: number;
  remainingMassKg?: number;
  shipRestriction?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface WormholePveSleeper { qty:number; name:string; hullClass:string; trigger:boolean; scram:number; web:number; neutGjPerSec:number; remoteRepHpPerSec:number; effectRange?:string; signatureRadius?:string; chaseSpeed?:string; orbitDistance?:string; orbitVelocity?:string; dps:number; alpha:number; range?:string; ehp:number }
export interface WormholePveWave { label:string; number:number; scram:number; web:number; neutGjPerSec:number; remoteRepHpPerSec:number; effectRange?:string; dps:number; alpha:number; range?:string; ehp:number; sleepers:WormholePveSleeper[] }
export interface WormholePveResource { name:string; quantity:number; volumeM3:number|null; cycles:number|null; iskPerM3:number|null; totalIsk:number|null }
export interface WormholePveSite { key:string; classLabel:"C1"|"C2"|"C3"|"C4"|"C5"|"C6"|"Gas"|"Ore"; name:string; category:string; blueLootIsk:number|null; resourceValueIsk:number|null; bestPossibleTime?:string; miningTime?:string; peakDps:number; peakAlpha:number; peakNeutGjPerSec:number; maxScrams:number; maxWebs:number; totalEhp:number; waves:WormholePveWave[]; resources:WormholePveResource[]; source:"PhobiaCide's Versioned Rykki Guide"; sourceSheet:string; sourceUpdatedAt?:string }
export interface WormholePveReferenceSnapshot { source:"PhobiaCide's Versioned Rykki Guide"; sourceUrl:string; fetchedAt:string; stale:boolean; sites:WormholePveSite[]; sheetUpdatedAt:Record<string,string|undefined>; errors:string[] }

export interface NavigationPublicWormholeSnapshot { source:"EVE-Scout v2 public signatures"; sourceUrl:string; fetchedAt:string; stale:boolean; connections:NavigationCustomConnection[]; rawCount:number; rejectedCount:number; error?:string }

export interface NavigationWaypointAnnotation { label?: string; note?: string }

export interface NavigationRoutePlan {
  schemaVersion: number;
  routeId: string;
  name: string;
  notes: string;
  waypointAnnotations: Record<string, NavigationWaypointAnnotation>;
  found: boolean;
  reason?: string;
  origin: NavigationSystem | null;
  destination: NavigationSystem | null;
  waypoints: NavigationSystem[];
  systems: NavigationSystem[];
  legs: NavigationRouteLeg[];
  segments: NavigationRouteSegment[];
  lockedSegments: NavigationLockedSegment[];
  customConnections: NavigationCustomConnection[];
  routingProfile: NavigationRouteProfile;
  totals: {
    jumps: number;
    totalWeight: number;
    minimumSecurityStatus: number;
    minimumDisplayedSecurityStatus: number;
    securityTransitions: number;
    regionCount: number;
    edgeTypes: Record<NavigationEdgeType, number>;
  };
  createdAt: string;
  updatedAt: string;
  version: number;
}


export interface NavigationCapitalHull {
  typeId: number;
  name: string;
  groupId: number;
  groupName: string;
  baseRangeLy: number;
  fuelTypeId?: number;
  fuelTypeName?: string;
  fuelPerLy?: number;
  fatigueMultiplier: number;
  jumpFreighter: boolean;
}

export interface NavigationCapitalContext {
  characterId: string;
  characterName: string;
  jumpDriveCalibrationLevel: number;
  jumpFuelConservationLevel: number;
  currentShipTypeId?: number;
  currentShipName?: string;
  hulls: NavigationCapitalHull[];
  formula: string;
  fuelFormula: string;
  fatigueFormula: string;
  source: string;
}

export interface NavigationCapitalFatigueLeg {
  effectiveFatigueDistanceLy: number;
  fatigueBeforeMinutes: number;
  activationCooldownMinutes: number;
  fatigueAfterJumpMinutes: number;
  fatigueAfterCooldownMinutes: number;
}

export interface NavigationCapitalLeg {
  from: number;
  to: number;
  fromName: string;
  toName: string;
  distanceLy: number;
  type: "jump-drive";
  fuelUnits: number;
  fatigue: NavigationCapitalFatigueLeg;
}

export interface NavigationMidpointQuality {
  systemId: number;
  name: string;
  npcStations: number;
  knownStructures: number;
  kills2h: number;
  jumps: number;
  gateDanger: string;
  score: number;
  reasons: string[];
}

export interface NavigationCapitalCandidate {
  candidateId: string;
  label: string;
  systems: NavigationSystem[];
  legs: NavigationCapitalLeg[];
  jumps: number;
  totalDistanceLy: number;
  totalFuelUnits: number;
  fuelTypeId?: number;
  fuelTypeName?: string;
  finalFatigueMinutes: number;
  totalActivationWaitMinutes: number;
  midpointQuality: NavigationMidpointQuality[];
  qualityScore: number;
}

export interface NavigationJumpFreighterTransition {
  lowSecSystem: NavigationSystem;
  highSecSystem: NavigationSystem;
  capitalCandidate: NavigationCapitalCandidate;
  gateRoute: {
    systems: NavigationSystem[];
    legs: NavigationRouteLeg[];
    jumps: number;
    transitionDanger: string;
    transitionDangerScore: number;
  };
  totalTravelLegs: number;
}

export interface NavigationCapitalPlan {
  found: boolean;
  reason?: string;
  characterId: string;
  characterName: string;
  ship: NavigationCapitalHull;
  jumpDriveCalibrationLevel: number;
  jumpFuelConservationLevel: number;
  effectiveRangeLy: number;
  origin: NavigationSystem | null;
  destination: NavigationSystem | null;
  systems: NavigationSystem[];
  legs: NavigationCapitalLeg[];
  jumps: number;
  totalDistanceLy: number;
  totalFuelUnits: number;
  fuelTypeId?: number;
  fuelTypeName?: string;
  finalFatigueMinutes: number;
  totalActivationWaitMinutes: number;
  reachableFromOriginCount: number;
  reachableFromOrigin: Array<{ systemId: number; name: string; regionName: string; securityStatus: number; distanceLy: number; distanceToDestinationLy: number }>;
  candidateMidpoints: Array<{ systemId: number; name: string; regionName: string; securityStatus: number }>;
  alternatives: NavigationCapitalCandidate[];
  jumpFreighterTransitions: NavigationJumpFreighterTransition[];
  formula: string;
  fuelFormula: string;
  fatigueFormula: string;
}

export interface NavigationOnlineWorkspace {
  workspace_id: string;
  workspace_type: "corporation";
  corporation_id: number;
  corporation_name: string;
  character_id: number;
  character_name: string;
  can_publish_routes: boolean;
  can_manage_wormholes?: boolean;
  roles: string[];
  titles: string[];
  member_access: "active";
}

export interface NavigationOnlineRouteSummary {
  id: string;
  object_type: "sage.route";
  current_version: number;
  visibility: "workspace" | "restricted";
  created_at: string;
  updated_at: string;
  published_at?: string;
}

export interface NavigationOnlineRouteObject extends NavigationOnlineRouteSummary {
  payload: NavigationRoutePlan;
  published_by_account_id?: string;
}

export interface NavigationHazardProviderSnapshot {
  id: "incursion" | "triglavian" | "edencom";
  label: string;
  available: boolean;
  systemIds: number[];
  fetchedAt?: string;
  note: string;
}

export interface NavigationHazardSnapshot {
  fetchedAt: string;
  providers: NavigationHazardProviderSnapshot[];
}

export interface NavigationCharacterLocation {
  characterId: string;
  characterName: string;
  systemId: number;
  systemName: string;
  stationId?: number;
  structureId?: number;
  source: "live-esi" | "synced-snapshot";
  observedAt: string;
}

export interface NavigationGateKillClassification {
  killmailId: number;
  killmailTime?: string;
  gateId: number;
  destinationSystemId: number;
  destinationSystemName: string;
  distanceMeters: number;
  confidence: "high" | "medium" | "low";
  thresholdMeters: number;
}

export interface NavigationRouteKillWindow {
  kills: number;
  totalValue: number;
  gateKills: number;
}

export type NavigationGateDangerState = "clear" | "activity" | "dangerous" | "camp-likely" | "active-camp";

export interface NavigationGateDangerAssessment {
  state: NavigationGateDangerState;
  label: "Clear" | "Activity" | "Dangerous" | "Camp likely" | "Active camp";
  score: number;
  reasons: string[];
  metrics: {
    gateKills1h: number; gateKills2h: number; gateKills6h: number; gateKills24h: number;
    systemKills1h: number; shipLosses2h: number; podLosses2h: number;
    recurringAttackers: number; repeatedAttackerAppearances: number; uniqueAttackers2h: number; jumps: number;
  };
}

export interface NavigationRouteSystemIntelligence {
  system: any;
  activity: { shipKills: number; podKills: number; npcKills: number; jumps: number };
  killWindows: Record<"1h" | "2h" | "6h" | "24h" | "7d" | "30d", NavigationRouteKillWindow>;
  gateClassifications: NavigationGateKillClassification[];
  routeGate: null | {
    gateId: number;
    destinationSystemId: number;
    destinationSystemName: string;
    windows: Record<"1h" | "2h" | "6h" | "24h", { kills: number }>;
    classifiedKills: NavigationGateKillClassification[];
    danger: NavigationGateDangerAssessment;
  };
  ownership: { allianceId: number | null; corporationId: number | null; factionId: number | null; source: "ESI sovereignty" | "unavailable" };
  hazards: { incursion: boolean; triglavian: boolean | null; edencom: boolean | null };
  infrastructure: { npcStations: number; knownStructures: number; structures: any[] };
}

export interface NavigationRouteIntelligence {
  generatedAt: string;
  activityFetchedAt: string | null;
  systems: NavigationRouteSystemIntelligence[];
  killmailRefresh: any;
  sources: {
    activity: string; kills: string; gateGeometry: string; ownership: string; hazards: string; infrastructure: string;
  };
}

export interface NavigationLiveMapMetrics {
  fetchedAt: string;
  stale: boolean;
  errors: string[];
  kills: Array<{ systemId: number; npcKills: number; podKills: number; shipKills: number }>;
  jumps: Array<{ systemId: number; shipJumps: number }>;
  incursionSystemIds: number[];
}

export interface NavigationMapData {
  scope: "universe" | "region";
  regionId: number | null;
  systems: NavigationSystem[];
  edges: NavigationRouteLeg[];
  regions: Array<{ regionId: number; name: string }>;
}

export interface NavigationPlanInput {
  routeId?: string;
  name?: string;
  createdAt?: string;
  version?: number;
  notes?: string;
  waypointAnnotations?: Record<string, NavigationWaypointAnnotation>;
  waypointSystemIds: number[];
  lockedSegments?: NavigationLockedSegment[];
  customConnections?: NavigationCustomConnection[];
  profile?: Partial<NavigationRouteProfile> & {
    avoids?: Partial<NavigationRouteProfile["avoids"]>;
    dynamicHazards?: Partial<NavigationRouteProfile["dynamicHazards"]>;
    specialConnections?: Partial<NavigationRouteProfile["specialConnections"]>;
  };
}

export type WormholeSignatureKind = "wormhole" | "gas" | "relic" | "data" | "combat" | "ore" | "unknown";
export type WormholeSignatureState = "new" | "existing" | "changed" | "missing";
export type WormholeSystemStatus = "unknown" | "friendly" | "occupied" | "hostile" | "empty" | "unscanned";
export type WormholeConnectionStatus = "unknown" | "active" | "eol" | "critical" | "quarantined" | "expired";
export type WormholeSiteState = "active" | "triggered" | "cleared";
export type WormholeWatchKind = "system" | "class" | "effect" | "wormhole-type" | "frigate-hole" | "new-k162" | "hostile-activity" | "near-home" | "eol-connection" | "critical-connection";
export interface WormholeWatchRecord { watchId:string; kind:WormholeWatchKind; value?:string; enabled:boolean; createdAt:string; updatedAt:string }
export interface WormholeWatchAlert { alertId:string; watchId:string; kind:WormholeWatchKind; fingerprint:string; message:string; systemId?:number; connectionId?:string; createdAt:string }
export interface WormholeSiteStateEvent { state:WormholeSiteState; changedAt:string; editorCharacterId?:string; editorCharacterName?:string }

export interface WormholeSignatureObservation { id: string; group: string; type: string; name: string; strength: string; distance: string; kind: WormholeSignatureKind; raw: string }
export interface WormholeReconciledSignature extends WormholeSignatureObservation { state: WormholeSignatureState }
export interface WormholeSystemRecord { systemId:number; systemName:string; alias?:string; notes?:string; status:WormholeSystemStatus; discoveredAt:string; updatedAt:string; lastScannedAt?:string; archivedAt?:string; createdByCharacterId?:string; createdByCharacterName?:string; editedByCharacterId?:string; editedByCharacterName?:string; pinned?:boolean }
export interface WormholeSignatureRecord extends WormholeSignatureObservation { signatureKey:string; systemId:number; systemName:string; status:"active"|"missing"; firstSeenAt:string; lastSeenAt:string; lastChangedAt:string; missingSince?:string; createdByCharacterId?:string; createdByCharacterName?:string; editedByCharacterId?:string; editedByCharacterName?:string; siteState?:WormholeSiteState; bookmarkName?:string; metadataUpdatedAt?:string; siteStateHistory?:WormholeSiteStateEvent[] }
export interface WormholeConnectionRecord { connectionId:string; fromSystemId:number; toSystemId?:number; fromSignatureId?:string; toSignatureId?:string; wormholeType?:string; status:WormholeConnectionStatus; notes?:string; label?:string; discoveredAt:string; updatedAt:string; expiresAt?:string; createdByCharacterId?:string; createdByCharacterName?:string; editedByCharacterId?:string; editedByCharacterName?:string; previousStatus?:WormholeConnectionStatus; quarantinedAt?:string; quarantineReason?:string; removedAt?:string }
export interface WormholeScanSnapshot { scanId:string; systemId:number; systemName:string; characterId:string; characterName:string; scannedAt:string; signatures:WormholeSignatureObservation[] }
export interface WormholeCleanupCandidate { systemId:number; systemName:string; alias?:string; lastEvidenceAt:string; inactiveHours:number; reason:string }
export interface WormholeCleanupPreview { generatedAt:string; homeSystemId?:number; minInactiveHours:number; protectedSystemIds:number[]; candidates:WormholeCleanupCandidate[]; message:string }
export interface WormholeMapLayout { positions:Record<string,{x:number;y:number}>; zoom:number; panX:number; panY:number; snapToGrid:boolean }
export interface WormholeCommandStore { schemaVersion:1; createdAt:string; updatedAt:string; systems:Record<string,WormholeSystemRecord>; signatures:Record<string,WormholeSignatureRecord>; connections:Record<string,WormholeConnectionRecord>; scanHistory:WormholeScanSnapshot[]; mapLayout:WormholeMapLayout; homeSystemId?:number; rallySystemId?:number; watches:WormholeWatchRecord[]; alerts:WormholeWatchAlert[] }
export interface WormholeSharedChainPayload { schema:"new-eden-sage.wormhole-chain.v1"; payloadVersion:1; sharedRevision:string; generatedAt:string; sourceStoreUpdatedAt:string; systems:Record<string,WormholeSystemRecord>; signatures:Record<string,WormholeSignatureRecord>; connections:Record<string,WormholeConnectionRecord>; scanHistory:WormholeScanSnapshot[]; mapLayout:WormholeMapLayout; homeSystemId?:number; rallySystemId?:number }
export interface WormholeOnlineChainSummary { id:string; object_type:"sage.wormhole-chain"; current_version:number; visibility:"workspace"|"restricted"; created_at:string; updated_at:string; published_at?:string }
export interface WormholeOnlineChainObject extends WormholeOnlineChainSummary { payload:WormholeSharedChainPayload; published_by_account_id?:string }
export interface WormholeWorkspaceEvent { sequence:number; workspace_id:string; event_type:string; object_id?:string; object_version?:number; created_at:string }
export interface WormholeOnlineAuditEntry { id:number; actor_account_id?:string; action:string; resource_type?:string; resource_id?:string; detail?:Record<string,any>|null; created_at:string }
export type WormholeDestinationKind = "c1"|"c2"|"c3"|"c4"|"c5"|"c6"|"highsec"|"lowsec"|"nullsec"|"thera"|"frigate-shattered"|"drifter-sentinel"|"drifter-barbican"|"drifter-vidette"|"drifter-conflux"|"drifter-redoubt"|"pochven"|"unknown";
export interface WormholeReferenceEntry { code:string; typeIds:number[]; destinationClassId:number|null; destinationKind:WormholeDestinationKind; destinationLabel:string; lifetimeMinutes:number|null; maxStableMassKg:number|null; massRegenerationKg:number|null; maxJumpMassKg:number|null; targetDistributionId:number|null; hasDogma:boolean; source:"CCP SDE" }
export interface WormholeSystemReferenceEntry { systemId:number; name:string; regionId:number; wormholeClassId:number|null; classLabel:string; securityStatus:number; securityLabel:string; effectTypeId:number|null; effectName:string|null; effectModifiers:Array<{attributeId:number;name:string;value:number;unitId?:number;unitName?:string;highIsGood?:boolean}>; planetCount:number; moonCount:number; asteroidBeltCount:number; source:"CCP SDE" }
export interface WormholeActivitySample { capturedAt:string; shipKills:number; podKills:number; npcKills:number; jumps:number }
export interface WormholeKillmailIntel { killmailId:number; killmailTime?:string; solarSystemId:number; victim?:any; attackers?:any[]; source:"zKillboard"|"connected character"; sourceCharacter?:string; totalValue?:number; points?:number; labels?:string[]; solo?:boolean; npc?:boolean; awox?:boolean; locationId?:number }
export interface WormholeLocalCorporationIntel { corporationId:number; name:string; ticker?:string; allianceId?:number; memberCount?:number; structureCount:number; connectedPilots:number; attackerKillmails:number; victimLosses:number; firstSeenAt?:string; lastSeenAt?:string; uniquePilots:number; confidencePercent:number; confidenceLabel:string; evidence:string }
export interface WormholeKnownStructureIntel { structureId?:number; name:string; typeId?:number; ownerId?:number; ownerName?:string; source:string }
export interface WormholeSystemIntelligence { system:{systemId:number;name:string;regionId:number;regionName:string;constellationName:string;securityStatus:number;securityBand:string}; current:WormholeActivitySample; history:WormholeActivitySample[]; windows:Record<"1h"|"24h"|"7d"|"30d",{samples:number;first:WormholeActivitySample|null;last:WormholeActivitySample|null;delta:{shipKills:number;podKills:number;npcKills:number;jumps:number}|null}>; knownStructures:WormholeKnownStructureIntel[]; localCorporations:WormholeLocalCorporationIntel[]; killmails:WormholeKillmailIntel[]; killmailRefresh:{lastUpdatedAt:string|null;queued:boolean;global:any}; limitations:string[] }
export interface WormholeSystemIntelligenceRefresh { systems:WormholeSystemIntelligence[]; killmailRefresh:any; activityFetchedAt:string|null }

export interface WormholeRollingMassModifier { typeId:number; name:string; locationFlag:string; effectName:string; operation:number; value:number; beforeKg:number; afterKg:number }
export interface WormholeRollingPropulsion { typeId:number; name:string; locationFlag:string; kind:"mwd"|"afterburner"; massAdditionKg:number; propOnMassKg:number }
export interface WormholeRollingShipMass { shipTypeId:number; shipName:string; baseMassKg:number; coldMassKg:number; fittedItemCount:number; passiveModifiers:WormholeRollingMassModifier[]; propulsion:WormholeRollingPropulsion[]; source:"CCP SDE + ESI current ship assets"; assumptions:string[] }

export type ClaudeCompatibilityStatus = {
  desktop: { detected: boolean; configured: boolean; verified?: boolean; state?: "not-detected"|"ready-to-install"|"install-pending"|"installed-unverified"|"configured-unverified"|"restart-required"|"verified"|"error"; changed?: boolean; restartRequired?: boolean; installPending?: boolean; manualInstallRequired?: boolean; extensionInstalled?: boolean; directConfigPresent?: boolean; running?: boolean; verifiedAt?: string; evidence?: string; path?: string; bundlePath?: string; configPath?: string; logPath?: string; method?: "mcpb" | "direct-config" | "claude-code"; error?: string };
  code: { detected: boolean; configured: boolean; verified?: boolean; changed?: boolean; restartRequired?: boolean; installPending?: boolean; path?: string; bundlePath?: string; evidence?: string; method?: "mcpb" | "direct-config" | "claude-code"; error?: string };
  launch: { command: string; args: string[]; env: Record<string, string> };
};
export type AugmentGoal = "damage"|"tank"|"capacitor"|"fitting"|"navigation"|"targeting"|"mining"|"exploration"|"training"|"industry";
export interface AugmentEffectGuide { targetAttributeId:number; target:string; sourceAttributeId:number; sourceAttribute:string; operation:number; sourceValue:number; deltaPercent:number|null; flatDelta:number|null; highIsGood:boolean|null; helpful:boolean|null; appliesTo?:string; effectName:string; summary:string; goals:AugmentGoal[] }
export interface AugmentGuideItem { typeId:number; name:string; slot:number|null; metaLevel:number; description:string; requirements:Array<{skillId:number;name:string;level:number}>; effects:AugmentEffectGuide[]; goals:AugmentGoal[]; score:number }
export interface AugmentGuideResult { generatedAt:string; installed:AugmentGuideItem[]; items:AugmentGuideItem[]; goals:Array<{id:AugmentGoal;label:string;description:string}> }

export type PlanetaryTier = "P0" | "P1" | "P2" | "P3" | "P4" | "unknown";
export type PlanetarySecurityBand = "high" | "low" | "null";
export type PlanetaryPlanMode = "buy" | "full" | "hybrid";
export interface PlanetaryAlertSettingsOverride { enabled?:Record<string,boolean>; extractorWarningHours?:number[]; storageThresholds?:number[]; stockpileDays?:number; optimizerMinIskPerDay?:number }
export interface PlanetaryAlertSettings extends PlanetaryAlertSettingsOverride { overrides?:Record<string,PlanetaryAlertSettingsOverride> }
export interface PlanetaryRevenueSettings { pocoOwnerTaxPercent?:number; brokerFeePercent?:number|null; assumedSecurity?:"auto"|PlanetarySecurityBand; cargoM3?:number; haulingCostPerTripIsk?:number; maxJumps?:number; runtimeHours?:number }
export interface PlanetaryResourceObservation { planetId:number; systemId?:number; systemName?:string; planetTypeId?:number; planetType?:string; radiusKm?:number; resourceTypeId?:number; resourceName?:string; percent?:number; score?:number; note?:string; characterId?:string; characterName?:string; source?:string; confidence?:number; scope?:"personal"|"corporation"; observedAt?:string }
export interface PlanetaryDesignerNode { id:string; typeId:number; x:number; y:number; label?:string; schematicId?:number|null; inputM3PerHour?:number; outputM3PerHour?:number; inputUnitsPerHour?:number; outputUnitsPerHour?:number; productTypeId?:number; templatePinIndex?:number }
export interface PlanetaryDesignerInput { planetTypeId:number; targetTypeId?:number; planetType?:string; planetRadiusKm:number; ccuLevel:number; commandCenter:{typeId:number;name:string;cpuOutput:number;powerOutput:number}|null; palette:Array<{typeId:number;name:string;kind:string;cpu:number;power:number;capacityM3:number;requiredLevel?:number;headCpu?:number;headPower?:number}>; nodes:PlanetaryDesignerNode[]; links:Array<{sourceId:string;destinationId:string;level?:number}> }
export interface PlanetaryDesignerCandidate { profile:"throughput"|"balanced"|"maintenance"; label:string; description:string; layout:PlanetaryDesignerInput; result:any }
export interface PlanetarySavedPlan { id:string; name:string; savedAt:string; input:PlanetaryPlanInput; kind?:"plan"|"template"; category?:string; scope?:"personal"|"corporation"; publishedObjectId?:string; publishedVersion?:number; publishedAt?:string; designerLayout?:PlanetaryDesignerInput; eveTemplate?:any; layoutProfile?:string }
export interface PlanetaryPersistentState { plans:PlanetarySavedPlan[]; observations:PlanetaryResourceObservation[]; alertSettings?:PlanetaryAlertSettings }
export interface PlanetaryPlanInput extends PlanetaryRevenueSettings { characterId:string; productTypeId:number; finalProcessors?:number; mode?:PlanetaryPlanMode; hybridBuildTypeIds?:number[]; originSystemId?:number; maxJumps?:number; finderSecurity?:"any"|PlanetarySecurityBand; planetId?:number|null; planetTypeId?:number|null; resourceObservations?:PlanetaryResourceObservation[] }
export interface PlanetaryRevenueSkill { typeId:number; name:string; level:number }
export interface PlanetaryRecipeLine { typeId:number; name:string; tier:PlanetaryTier; quantityPerCycle:number; quantityPerDay:number; volumeM3:number; volumePerDayM3:number; bestBuy:number|null; bestSell:number|null; bestBuySystem:string|null; bestSellSystem:string|null; valuePerDay:number|null }
export interface PlanetaryFactoryOpportunity {
  schematicId:number; name:string; tier:PlanetaryTier; cycleTimeSeconds:number; cyclesPerDay:number; output:PlanetaryRecipeLine; inputs:PlanetaryRecipeLine[];
  outputGrossPerDay:number|null; outputSellOrderValuePerDay:number|null; inputCostPerDay:number|null; marginPerDay:number|null; marginPercent:number|null; fullyPriced:boolean;
  executableInputCostPerDay:number|null; executableOutputGrossPerDay:number|null; inputCoveragePercent:number; outputCoveragePercent:number; buyDepthDays:number; liquidityScore:number;
  importTaxPerDay:number; exportTaxPerDay:number; salesTaxPerDay:number|null; brokerFeePerDay:number|null; haulingCostPerDay:number; taxAdjustedMarginPerDay:number|null; sellOrderMarginPerDay:number|null; score:number; assumedSecurity:PlanetarySecurityBand; pocoTaxPercent:number;
}
export interface PlanetaryAlert { id:string; severity:"critical"|"warning"|"info"; type:string; characterId:string; characterName:string; planetId:number; planetLabel:string; message:string; hoursUntil:number|null }
export interface PlanetaryExtractorForecast { pinId:number; active:boolean; productTypeId:number; productName?:string; cycleTimeSeconds:number; qtyPerCycle:number; totalCycles?:number; elapsedCycles?:number; totalUnits:number; remainingUnits:number; next24hUnits:number; hoursUntilExpiry:number; grossNext24h:number|null; grossRemaining:number|null; heads:number; installTime?:string; expiryTime?:string; decayFactor?:number; noiseFactor?:number; outputRoutes?:number; validOutputRoutes?:number; unrouted?:boolean }
export interface PlanetaryProcessorHealth { pinId:number; schematicId:number; name:string; outputTypeId:number; outputName:string; inputs:Array<{typeId:number;name:string;requiredPerDay:number;inboundRoutes:number;validInboundRoutes:number;availableUnits:number;continuous:boolean;hoursRemaining:number|null;starved:boolean}>; outputRoutes:number; validOutputRoutes:number; starving:boolean; lowestHoursRemaining:number|null; unroutedOutput:boolean }
export interface PlanetaryColonyAudit {
  characterId:string; characterName:string; planetId:number; planetType:string; planetTypeId:number; solarSystemId:number; solarSystemName:string; regionName:string; securityStatus:number; securityBand:PlanetarySecurityBand; upgradeLevel:number; pinCount:number; processors:number; activeExtractors:number; expiredExtractors:number; extractorGrossPerDay:number|null; configuredGrossPerDay:number; configuredMarginCapacityPerDay:number|null; storageValue:number; lastUpdate:string|null; healthScore:number; status:"healthy"|"watch"|"attention"; badRoutes:number; starvedProcessors:number; unroutedProcessors:number; unroutedExtractors:number; lowStockProcessors:number; fullStorage:number; attentionHours:number|null;
  routes:Array<{routeId:number;sourcePinId:number;destinationPinId:number;typeId:number;quantity:number;waypoints:number[];path:number[];valid:boolean;issue:string|null}>; processorsHealth:PlanetaryProcessorHealth[]; storage:Array<{pinId:number;name:string;usedM3:number;capacityM3:number;fillPercent:number;inboundM3PerDay:number;outboundM3PerDay:number;netInflowM3PerDay:number;hoursToFull:number|null}>; extractors:PlanetaryExtractorForecast[]; recipes:Array<{schematicId:number;name:string;outputTypeId?:number;outputName?:string;outputPerDay?:number;processors:number;grossPerDay:number|null;marginPerDay:number|null}>;
}
export interface PlanetaryStockpileLine { typeId:number; name:string; tier:PlanetaryTier; quantity:number; volumeM3:number; characters:string[]; locations:string[] }
export interface PlanetaryIndustryDemandLine { typeId:number; name:string; tier:PlanetaryTier; baseQuantity:number; jobs:number; characters:string[] }
export interface PlanetaryCharacterEmpireRow { characterId:string; characterName:string; colonies:number; maxColonies:number; spareColonies:number; commandCenterUpgrades:number; interplanetaryConsolidation:number; systemId:number; systemName:string }
export interface PlanetaryRevenueAnalysis {
  generatedAt:string; marketCreatedAt:string|null; character:{id:string;name:string};
  settings:{pocoOwnerTaxPercent:number;brokerFeePercent:number;assumedSecurity:PlanetarySecurityBand;cargoM3:number;haulingCostPerTripIsk:number;maxJumps:number;runtimeHours:number;accountingLevel:number;brokerRelationsLevel:number;customsCodeExpertiseLevel:number;salesTaxPercent:number;pocoTaxPercent:number};
  capacity:{colonies:number;maxColonies:number;spare:number;skills:PlanetaryRevenueSkill[]};
  summary:{processors:number;activeExtractors:number;expiredExtractors:number;extractorGrossPerDay:number|null;configuredGrossPerDay:number;configuredMarginCapacityPerDay:number|null;storedPiValue:number;bestOpportunityMarginPerDay:number|null;healthScore:number|null};
  empire:{characters:PlanetaryCharacterEmpireRow[];colonies:PlanetaryColonyAudit[];alerts:PlanetaryAlert[];totals:{characters:number;colonies:number;spareColonies:number;processors:number;activeExtractors:number;stockpileUnits:number;alerts:number}};
  colonies:PlanetaryColonyAudit[]; alerts:PlanetaryAlert[]; opportunities:PlanetaryFactoryOpportunity[]; stockpile:PlanetaryStockpileLine[]; industryDemand:PlanetaryIndustryDemandLine[]; stockpileBuildability:Array<{typeId:number;name:string;cycles:number|null;outputUnits:number|null}>; notes:string[]; optimizer?:{generatedAt:string;recommendations:Array<{id:string;rank:number;kind:string;title:string;characterId:string|null;characterName:string;planetId:number;planetLabel:string;reason:string;actions:string[];estimatedGainIskPerDay:number|null;estimatedCostIsk:number|null;confidence:number;destructive:boolean}>;summary:{total:number;simple:number;repurpose:number;valued:number};principle:string}; survey?:{systemsSurveyed:number;planetsSurveyed:number;observations:number;distinctResources:number;corporationRecords:number;personalRecords:number;newestObservation:string|null}; alertSettings?:PlanetaryAlertSettings;
}
export interface PlanetaryPlanResult {
  generatedAt:string; marketCreatedAt:string|null; character:{id:string;name:string}; settings:PlanetaryRevenueAnalysis["settings"]; mode:PlanetaryPlanMode;
  target:{typeId:number;name:string;tier:PlanetaryTier;finalProcessors:number;outputPerDay:number;immediateRevenuePerDay:number|null;taxAdjustedProfitPerDay:number|null;sellOrderProfitPerDay:number|null;liquidityScore:number;buyDepthDays:number;inputAcquisitionCostPerDay:number|null;importTaxPerDay:number;exportTaxPerDay:number;marketFeesPerDay:number|null;haulingCostPerDay:number;trueMarginPercent:number|null};
  chain:{processors:Array<{schematicId:number;name:string;tier:PlanetaryTier;outputTypeId:number;outputName:string;equivalent:number;dedicated:number;cycleTimeSeconds:number;inputs:PlanetaryRecipeLine[];output:PlanetaryRecipeLine}>;externalInputs:Array<{typeId:number;name:string;tier:PlanetaryTier;quantityPerDay:number;volumeM3:number}>;processorEquivalent:number;dedicatedProcessors:number;rawResourceIds:number[];rawResources:Array<{typeId:number;name:string}>};
  recommendedHybridBuildTypeIds:number[]; hybridCandidates:Array<{typeId:number;name:string;tier:PlanetaryTier;recommended:boolean}>; sourceDecisions:Array<{typeId:number;name:string;tier:PlanetaryTier;decision:"BUY"|"EXTRACT"|"PRODUCE";quantityPerDay:number;reason:string}>; refill:Array<{typeId:number;name:string;tier:PlanetaryTier;quantityPerDay:number;volumeM3:number;have:number;need:number;shortage:number;shortageVolumeM3:number;coveredPercent:number}>; stockpileRuntimeHours:number|null; stockpileBuildable:{cycles:number;outputUnits:number}|null;
  layout:{planetTypeId:number;planetType:string;planetId:number|null;planetRadiusKm:number;ccuLevel:number;commandCenter:null|{typeId:number;name:string;cpuOutput:number;powerOutput:number};launchpad:null|{typeId:number;name:string;capacityM3:number;count:number};facilities:any[];designerPalette?:Array<{typeId:number;name:string;kind:string;cpu:number;power:number;capacityM3:number;requiredLevel?:number;headCpu?:number;headPower?:number}>;processors:number;launchpads:number;linkCount:number;minLinkKm:number;linkCpu:number;linkPower:number;facilityCpuUsed:number;facilityPowerUsed:number;cpuUsed:number;powerUsed:number;cpuCapacity:number;powerCapacity:number;cpuSpare:number;powerSpare:number;fits:boolean;missingFacilities:string[];bufferVolumeM3:number;runtimeHours:number};
  eveTemplate:any|null; systemFinder:{systems:Array<{systemId:number;systemName:string;regionName:string;securityStatus:number;securityBand:PlanetarySecurityBand;jumps:number;planetCount:number;coveredResources:Array<{typeId:number;name:string}>;coveragePercent:number;fullCoverage:boolean;densityBottleneckPercent?:number|null;densityKnownPercent?:number;score:number}>;planets:Array<{planetId:number;systemId:number;systemName:string;regionName:string;securityStatus:number;securityBand:PlanetarySecurityBand;jumps:number;planetTypeId:number;planetType:string;planetIndex:number;radiusKm:number;resources:Array<{typeId:number;name:string}>;coveragePercent:number;observationScore:number|null;densityAveragePercent?:number|null;densityBottleneckPercent?:number|null;densityKnownPercent?:number;observedResources?:Array<{resourceTypeId:number;resourceName:string;percent:number|null;confidence:number|null;observedAt:string|null;source:string|null;scope:string}>;score:number}>};
  allocation:{assignments:Array<{role:string;detail:string;planetType:string|null;resources:string[];characterId:string|null;characterName:string|null;ccuLevel:number|null;assigned:boolean}>;requiredColonies:number;availableColonies:number;deficit:number;planetRoles:Array<{planetTypeId:number;planetType:string;resourceTypeIds:number[];resources:string[]}>;uncoveredResourceIds:number[]};
  hauling:{cargoM3:number;inboundM3PerDay:number;outboundM3PerDay:number;totalM3PerDay:number;tripsPerDay:number;tripsPerWeek:number;jumpsOneWay:number|null;jumpLegsPerWeek:number|null;estimatedMinutesPerWeek:number|null;costPerTripIsk:number;costPerDay:number;costPerWeek:number;basis:string}; industryDemand:PlanetaryIndustryDemandLine[]; stockpile:PlanetaryStockpileLine[]; netPerDay:number; notes:string[];
}

export interface MarketContractOpportunity {
  contractId:number; title:string; regionId:number; regionName:string; systemId:number; systemName:string; station:string; expires:string; price:number; volume:number; securityStatus:number|null; securityBand:"high"|"low"|"null"|null; originResolved:boolean;
  contractType:string; availability:string; dateIssued:string; issuerId:number|null; issuerName:string|null; issuerCorporationId:number|null; issuerCorporationName:string|null; forCorporation:boolean; buyout:number|null;
  items:Array<{typeId:number;typeName:string;categoryId:number;categoryName:string;groupName:string;marketGroup:string;quantity:number;included:boolean;bestBuy:number|null;bestSell:number|null;isBlueprintCopy?:boolean;runs?:number;isSingleton?:boolean;marketLiquidatable:boolean;recoverableForResale:boolean;valuationNote?:string}>;
  cleanSale:boolean; receivedItemCount:number; requestedItemCount:number; immediateGross:number; immediateCoveredUnits:number; immediateTotalUnits:number; immediateProfit:number|null; immediateRoiPercent:number|null;
  bestBuyGross:number; bestBuyProfit:number|null; bestBuyRoiPercent:number|null; bestBuySystemId:number|null; bestBuySystem:string|null; bestBuySecurityBand:"high"|"low"|"null"|null; bestBuyUsesPlayerStructure:boolean; bestBuyLocationCount:number; sellOrderGross:number; sellOrderProfit:number|null; sellOrderRoiPercent:number|null;
  requestedItemCost:number; requestedItemsFullyPriced:boolean; nonRecoverableRigCount:number; haulVolumeM3:number; haulCargoVolumeM3:number;
  pilotRequiredShips:Array<{typeId:number;typeName:string;quantity:number;groupName:string;packagedVolumeM3:number;capital:boolean}>; capitalRouteRequired:boolean; capitalOriginUnverified:boolean; score:number; opportunity:boolean; note:string;
}
export interface MarketContractIntelligence { generatedAt:string; contractsCreatedAt:string|null; marketCreatedAt:string|null; contracts:MarketContractOpportunity[]; opportunities:MarketContractOpportunity[]; counts:{contracts:number;opportunities:number} }
export interface MarketContractSearchQuery {
  itemSearch?:string; regionId?:string|number; locationSearch?:string; contractType?:string; category?:string; availability?:string; issuerSearch?:string;
  minPrice?:number|null; maxPrice?:number|null; excludeMultiple?:boolean; exactType?:boolean; cleanOnly?:boolean;
  security?:Partial<Record<"high"|"low"|"null"|"unknown",boolean>>; limit?:number;
}
export interface MarketContractSearchResult { total:number; rows:MarketContractOpportunity[] }
export interface MarketContractWorkspace {
  generatedAt:string; contractsCreatedAt:string|null; marketCreatedAt:string|null; counts:{contracts:number;opportunities:number};
  opportunities:MarketContractOpportunity[];
  options:{regions:Array<{id:number;name:string}>;categories:string[];contractTypes:string[];availabilities:string[]};
  topProfit:number; averageRoi:number; search:MarketContractSearchResult;
}
export type ProfitLedgerSource = "contract" | "market-opportunity" | "planetary" | "industry" | "lp-store";
export interface ProfitLedgerItem { typeId:number; name:string; quantity:number; expectedUnitSell?:number|null }
export interface ProfitLedgerRecord {
  id:string; characterId:string; characterName:string; source:ProfitLedgerSource; sourceKey:string; title:string; completedAt:string;
  estimatedCost:number; estimatedRevenue:number; estimatedProfit:number; actualRevenue:number|null; actualCost?:number|null; actualTax:number|null; actualBrokerFees:number|null; actualProfit:number|null;
  reconciliationStatus:"exact"|"partial"|"estimated"; reconciliationNote:string; items:ProfitLedgerItem[]; walletTransactionIds:number[]; walletJournalIds:number[]; allocations?:Array<{ productionLotId?:string; walletTransactionId:number; quantityAllocated:number; unitPrice:number; revenue:number; transactionDate?:string; confidence:"strong"|"compatible"; evidence:string }>;
  materialProvenance?:{mined:boolean;donated:boolean;owned:boolean;bought:boolean;updatedAt?:string};
  purchaseAllocations?:Array<{productionLotId?:string;walletTransactionId:number;typeId:number;materialName:string;quantityAllocated:number;unitPrice:number;cost:number;transactionDate?:string;evidence:string}>;
  cashMaterialCost?:number|null; economicMaterialValue?:number|null; cashProfit?:number|null; economicProfit?:number|null; metadata?:Record<string,unknown>;
}
export interface ProfitLedgerCompleteInput { characterId:string; source:ProfitLedgerSource; sourceKey:string; title:string; estimatedCost:number; estimatedRevenue:number; estimatedProfit:number; items?:ProfitLedgerItem[]; metadata?:Record<string,unknown> }
export interface ProfitReconciliationCandidate { walletTransactionId:number; date:string; typeId:number; itemName:string; quantity:number; unitPrice:number; revenue:number; walletScope:"character"|"corporation"; walletDivision?:number; selected:boolean; reservedByOther:boolean; priceCompatible:boolean }
export interface ProfitReconciliationReview { recordId:string; characterId:string; title:string; reconciliationStatus:"exact"|"partial"|"estimated"; candidates:ProfitReconciliationCandidate[] }
export interface ProfitPurchaseCandidate { walletTransactionId:number; date:string; typeId:number; materialName:string; quantity:number; unitPrice:number; cost:number; walletScope:"character"|"corporation"; walletDivision?:number; selected:boolean; reservedByOther:boolean }
export interface ProfitPurchaseReview { recordId:string; characterId:string; title:string; candidates:ProfitPurchaseCandidate[] }

declare global {
  interface Window {
    sage: {
      bridgeInfo: { version: number; localFittingCatalogue: boolean; localTypeImages: boolean };
      setDisplayFitEnabled(enabled: boolean): Promise<{ enabled: boolean }>;
      refreshDisplayFit(): Promise<boolean>;
      onDisplayFitChanged(callback: (enabled: boolean) => void): () => void;
      getUpdateState(): Promise<{ version: string; packaged: boolean }>;
      checkForUpdates(): Promise<unknown>;
      downloadUpdate(): Promise<unknown>;
      installUpdate(): Promise<boolean>;
      openSupportPage(): Promise<void>;
      openZkillboard(killmailId?: number): Promise<void>;
      openDiscordUrl(url:string): Promise<void>;
      getMcpSetup(): Promise<{ command: string; args: string[]; json: string; codex: string; access: string; claudeDesktop: string; claudeCode: string }>;
      getClaudeMcpStatus(): Promise<ClaudeCompatibilityStatus>;
      repairClaudeMcp(): Promise<ClaudeCompatibilityStatus>;
      repairClaudeDirectMcp(): Promise<ClaudeCompatibilityStatus["desktop"]>;
      showClaudeMcpBundle(): Promise<string>;
      getMcpTunnelStatus(): Promise<{ configured: boolean; tunnelId: string; running: boolean; ready: boolean; healthUrl: string }>;
      configureMcpTunnel(input: { tunnelId: string; runtimeKey: string }): Promise<{ configured: boolean; tunnelId: string; running: boolean; ready: boolean; healthUrl: string }>;
      openChatGptPlugins(): Promise<void>;
      openOpenAiTunnels(): Promise<void>;
      openOpenAiApiKeys(): Promise<void>;
      syncMcpRendererData(value: unknown): Promise<boolean>;
      onMcpFitDataUpdated(callback: (value: { savedFits?: unknown[]; fitLibraryMeta?: Record<string, unknown>; selectedFitId?: string }) => void): () => void;
      onUpdateStatus(callback: (value: { status: string; detail?: any }) => void): () => void;
      getHostClock(): Promise<{now:string;platform:string;timezone:string;offsetMinutes:number;hostname:string}>;
      syncHostClock(): Promise<{ok:boolean;message:string;clock:{now:string;platform:string;timezone:string;offsetMinutes:number}}>;
      setHostClock(value:string): Promise<{ok:boolean;message:string;clock:{now:string;platform:string;timezone:string;offsetMinutes:number}}>;
      getGlobalMarketQuotes(typeIds:number[]): Promise<{createdAt:string|null;quotes:Array<{typeId:number;typeName:string;bestBuy:number|null;bestSell:number|null;bestBuySystem:string|null;bestSellSystem:string|null}>}>;
      getLpCorporations(corporationIds:number[]): Promise<Array<{corporationId:number;corporationName:string}>>;
      getLpStoreOffers(corporationId:number, marketRevision?:number): Promise<any>;
      getLpEarningCandidates(standings:unknown, currentCorporationIds:number[]): Promise<any[]>;
      getContractMarketWorkspace(): Promise<MarketContractWorkspace>;
      searchMarketContracts(input:MarketContractSearchQuery): Promise<MarketContractSearchResult>;
      getProfitLedger(characterId?:string): Promise<ProfitLedgerRecord[]>;
      completeProfitDeal(input:ProfitLedgerCompleteInput): Promise<ProfitLedgerRecord>;
      reconcileProfitLedger(characterId?:string): Promise<ProfitLedgerRecord[]>;
      removeProfitLedgerRecord(id:string): Promise<boolean>;
      getProfitReconciliationReview(recordId:string): Promise<ProfitReconciliationReview>;
      setProfitTransactionOverride(input:{ recordId:string; walletTransactionId:number; assigned:boolean }): Promise<{ record:ProfitLedgerRecord; review:ProfitReconciliationReview }>;
      setProfitMatchDecision(input:{recordId:string;walletTransactionId:number;decision:"confirmed"|"rejected"}): Promise<ProfitLedgerRecord>;
      setProfitMaterialProvenance(input:{recordId:string;mined:boolean;donated:boolean;owned:boolean;bought:boolean}): Promise<ProfitLedgerRecord>;
      getProfitPurchaseReview(recordId:string): Promise<ProfitPurchaseReview>;
      setProfitPurchaseTransactionOverride(input:{recordId:string;walletTransactionId:number;assigned:boolean}): Promise<{record:ProfitLedgerRecord;review:ProfitPurchaseReview}>;
      applyProfitBulkBookkeeping(input:{recordIds:string[];matchDecision?:"confirmed"|"rejected";transactionDecisions?:Array<{recordId:string;walletTransactionId:number;decision:"confirmed"|"rejected"}>;provenance?:{mined:boolean;donated:boolean;owned:boolean;bought:boolean}}): Promise<ProfitLedgerRecord[]>;
      onWalletReconciled(callback:(value:{refreshed?:number;failed?:number;ledgerRecords?:number;completedAt?:string})=>void): () => void;
      openEveContract(input: { characterId: string; contractId: number }): Promise<{ success: boolean; contractId: number; characterId: string; characterName: string; usedFallback: boolean }>;
      openEveMarketType(input: { characterId: string; typeId: number }): Promise<{ success: boolean; typeId: number; characterId: string; characterName: string; usedFallback: boolean }>;
      getPlanetaryRevenue(input:{ characterId:string; settings?:PlanetaryRevenueSettings }): Promise<PlanetaryRevenueAnalysis>;
      getPlanetaryPlan(input:PlanetaryPlanInput): Promise<PlanetaryPlanResult>;
      getPlanetaryState(): Promise<PlanetaryPersistentState>;
      savePlanetaryPlan(plan:PlanetarySavedPlan): Promise<PlanetarySavedPlan>;
      deletePlanetaryPlan(id:string): Promise<boolean>;
      savePlanetaryObservations(observations:PlanetaryResourceObservation[]): Promise<PlanetaryResourceObservation[]>;
      savePlanetaryAlertSettings(settings:PlanetaryAlertSettings): Promise<PlanetaryAlertSettings>;
      getPlanetaryBasket(input:Record<string,unknown>): Promise<any>;
      evaluatePlanetaryLayout(input:PlanetaryDesignerInput): Promise<any>;
      generatePlanetaryLayouts(input:PlanetaryDesignerInput): Promise<PlanetaryDesignerCandidate[]>;
      buildPlanetaryDesignerEveTemplate(input:{designer:PlanetaryDesignerInput;baseTemplate:any;comment?:string}): Promise<{template:any|null;warnings:string[]}>;
      getPlanetaryDesignerSeed(input:Record<string,unknown>): Promise<any>;
      getCorporationDiscordState(characterId:string): Promise<any>;
      getCorporationDiscordServerStructure(characterId:string): Promise<any>;
      configureCorporationDiscord(input:{characterId:string;guildId:string;channelId:string;allowedChannelIds?:string[];enabled:boolean}): Promise<any>;
      getCorporationDiscordLinkUrl(characterId:string): Promise<{url:string;expiresInSeconds:number}>;
      sendCorporationDiscordAnnouncement(input:{characterId:string;content:string;channelId?:string;roleIds?:string[];userIds?:string[]}): Promise<{sent:boolean;messageId?:string}>;
      updateCorporationDiscordNotificationTargets(input:{characterId:string;characterIds:number[]}): Promise<any>;
      testCorporationDiscordDm(characterId:string): Promise<{sent:boolean;messageId?:string}>;
      unlinkCorporationDiscord(characterId:string): Promise<{unlinked:boolean}>;
      getCorporationRolesState(characterId:string): Promise<any>;
      updateCorporationRolePermission(input:{characterId:string;permissionKey:string;authorities:Array<{type:"eve_role"|"eve_title";value:string}>}): Promise<any>;
      getCorporationOpsWorkspace(characterId:string): Promise<any>;
      listCorporationOperations(input:{workspaceId:string}): Promise<any[]>;
      publishCorporationOperation(input:{characterId:string;payload:Record<string,unknown>}): Promise<any>;
      updateCorporationOperation(input:{characterId:string;workspaceId:string;objectId:string;payload:Record<string,unknown>;expectedVersion:number}): Promise<any>;
      announceCorporationOperationDiscord(input:{characterId:string;workspaceId:string;objectId:string}): Promise<any>;
      cancelCorporationOperation(input:{characterId:string;workspaceId:string;objectId:string;message?:string}): Promise<{discordDeleted:boolean;discordCleanupWarning?:string;legacyLookup?:boolean;discordCancellationSent?:boolean;discordCancellationMessageId?:string;discordCancellationWarning?:string}>;
      takeCorporationOperationOwnership(input:{characterId:string;workspaceId:string;objectId:string}): Promise<any>;
      setCorporationOperationApplicationNotifications(input:{characterId:string;workspaceId:string;objectId:string;enabled:boolean}): Promise<any>;
      applyCorporationOperationRole(input:{characterId:string;workspaceId:string;objectId:string;roleId:string;fitName?:string;fitText?:string;hullName?:string}): Promise<any>;
      decideCorporationOperationApplication(input:{characterId:string;workspaceId:string;objectId:string;applicationId:string;decision:"approved"|"denied";message?:string}): Promise<any>;
      getPlanetaryCorpState(input:{characterId:string}): Promise<any>;
      publishPlanetaryCorpSurvey(input:Record<string,unknown>): Promise<any>;
      publishPlanetaryCorpTemplate(input:{characterId:string;planId:string}): Promise<PlanetarySavedPlan>;
      unpublishPlanetaryCorpObject(input:{characterId:string;planId:string;objectId:string}): Promise<PlanetarySavedPlan|boolean>;
      getAugmentGuideLocal(installedTypeIds:number[]): Promise<AugmentGuideResult>;
      getBoosterSideEffectsLocal(boosterTypeIds:number[]): Promise<Array<{ boosterTypeId:number; boosterName:string; effectId:number; effectName:string; chanceAttributeId:number; chance:number }>>;
      copyText(value: string): Promise<boolean>;
      resolveTypeNames(
        names: string[],
      ): Promise<Array<{ id: number; name: string }>>;
      resolveFittingTypeNamesLocal(
        names: string[],
      ): Promise<Array<{ id: number; name: string; groupId?: number; categoryId?: number; categoryName?: string; rack?: "low" | "mid" | "high" | "rig" | "subsystem" }>>;
      resolveFittingTypeIdsLocal(
        typeIds: number[],
      ): Promise<Array<{ id: number; name: string; groupId?: number; categoryId?: number; categoryName?: string; rack?: "low" | "mid" | "high" | "rig" | "subsystem" }>>;
      searchFittingTypesLocal(query: string, limit?: number): Promise<Array<{ id: number; name: string; groupId: number; categoryId: number; categoryName: string; rack?: "low" | "mid" | "high" | "rig" | "subsystem"; combatProfile?: { abyssal:boolean; outgoingDamage:{em:number;thermal:number;kinetic:number;explosive:number}; outgoingDamageTotal:number; shieldHp:number; armorHp:number; structureHp:number; shieldResists:[number,number,number,number]; armorResists:[number,number,number,number]; hullResists:[number,number,number,number]; signatureRadiusM:number } }>>;
      prepareFittingDataLocal(): Promise<{ catalogue:{ groups:Array<{id:number;name:string;parentId?:number;iconId?:number}>; items:Array<any> }; preparedAt:string; itemCount:number; groupCount:number; durationMs:number }>;
      onFittingPreparationProgress(callback:(value:{percent:number;stage:string;message:string})=>void): () => void;
      filterFittingItemsForHullLocal(input:{hullTypeId:number;candidates:Array<{typeId:number;placement?:string}>;fitted?:Array<{typeId:number;rack?:string}>}): Promise<{compatibleTypeIds:number[];checked:number}>;
      getFittingChargesForModulesLocal(moduleTypeIds:number[]): Promise<{compatibleTypeIds:number[];checked:number}>;
      getFittingCatalogueLocal(): Promise<{ groups: Array<{ id:number; name:string; parentId?:number; iconId?:number }>; items: Array<{ id:number; name:string; groupId:number; categoryId:number; categoryName:string; rack?: "low" | "mid" | "high" | "rig" | "subsystem"; marketGroupId:number; rootName:string; metaLevel:number; placement:"ship"|"high"|"mid"|"low"|"rig"|"subsystem"|"drone"|"fighter"|"implant"|"booster"|"charge"|"cargo" }> }>;
      getFittingTypeInfoLocal(typeId:number): Promise<{ typeId:number; name:string; description:string; group:{id:number;name:string}; category:{id:number;name:string}; marketGroup:null|{id:number;name:string;path:string[]}; placement:"ship"|"high"|"mid"|"low"|"rig"|"subsystem"|"drone"|"fighter"|"implant"|"booster"|"charge"|"cargo"; rack?:string; metaLevel?:number; techLevel?:number; published:boolean; iconId?:number; physical:{volumeM3?:number;massKg?:number;capacityM3?:number;radiusM?:number;portionSize?:number;basePrice?:number}; fitting:Array<{attributeId:number;label:string;unit:string;value:number}>; requirements:Array<{skillId:number;name:string;level:number}>; attributes:Array<{attributeId:number;name:string;internalName?:string;description?:string;value:number;unitId?:number;unit?:string;categoryId?:number;category:string;highIsGood?:boolean;published:boolean}>; effects:Array<{effectId:number;name:string;category:number;description?:string}> }>;
      getHullFittingProfileLocal(typeId:number): Promise<{ slots:{ high:number; mid:number; low:number; rig:number; subsystem:number }; hardpoints:{ turret:number; launcher:number }; storage:{ cargoM3:number; droneBayM3:number; droneBandwidth:number; fighterHangarM3:number; fighterTubes:number } }>;
      getMutationOptionsLocal(typeId: number): Promise<Array<{ mutaplasmidTypeId: number; mutaplasmidName: string; resultingTypeId: number; resultingTypeName: string; attributes: Array<{ attributeId: number; name: string; baseValue: number; minValue: number; maxValue: number; minMultiplier: number; maxMultiplier: number; highIsGood: boolean; unitId?: number }> }>>;
      checkFittingChargeCompatibilityLocal(moduleTypeId:number, chargeTypeId:number): Promise<{ compatible:boolean; reason:string }>;
      checkFittingItemCompatibilityLocal(input:{ hullTypeId:number; itemTypeId:number; placement?:string; fitted?:Array<{typeId:number;rack?:string}> }): Promise<{ compatible:boolean; code:string; reason:string }>;
      getFittingRemediesLocal(input: { characterId?:string; hullTypeId:number; issueCodes:string[]; itemTypeIds:number[] }): Promise<FitRemedyCandidate[]>;
      resolveTypeIds(ids: number[]): Promise<Array<{ id: number; name: string }>>;
      listShips(): Promise<Array<{ typeId: number; name: string; groupId: number; groupName: string; metaGroupId?: number; metaGroupName?: string; factionId?: number; factionName?: string }>>;
      getManufacturingPlan(input: any): Promise<any>;
      getFoundryWorkspace(input: any): Promise<any>;
      getFoundryProjects(input: any): Promise<any[]>;
      searchFoundryBlueprints(input: any): Promise<any[]>;
      createFoundryProject(input: any): Promise<any>;
      updateFoundryProject(input: any): Promise<any>;
      deleteFoundryProject(input: any): Promise<any>;
      getRefineryCatalogue(): Promise<any>;
      getRefineryAnalysis(input: any): Promise<any>;
      getReactionCatalogue(): Promise<any>;
      getReactionPlan(input: any): Promise<any>;
      getBlueprintActivities(input: any): Promise<any>;
      getInventionOpportunities(input: any): Promise<any>;
      getIndustrySystemCostIndex(input: any): Promise<any>;
      getIndustrialOpportunities(input: any): Promise<any>;
      getPreparedIndustrialCommand(input: { characterId: string }): Promise<any>;
      getIndustrialOpportunityRouteScope(input: any): Promise<any>;
      getPreparedIskLab(input: { characterId: string; cloneState?: "alpha" | "omega"; modules?: Array<"market" | "pve" | "invention"> }): Promise<{ market: OpportunityAnalysis | null; pve: PveLocationAnalysis | null; invention: any | null }>;
      getShipReadiness(input: {
        characterId: string;
        hullTypeId: number;
        cloneState?: "alpha" | "omega";
        masteryLevel?: number;
      }): Promise<ShipReadinessResult>;
      getActivityHullPreviews(input: { characterId:string; hullTypeIds:number[] }): Promise<HullAccessPreview[]>;
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
        targetTypeId?: number;
        damageProfile?: { em: number; thermal: number; kinetic: number; explosive: number };
        implantTypeIds?: number[];
        boosterTypeIds?: number[];
        boosterSideEffectIds?: number[];
        boosterSideEffectSelections?: Array<{ boosterTypeId:number; effectId:number }>;
        projectedItems?: Array<{ typeId: number; chargeTypeId?: number; attributeOverrides?: Record<string, number>; state?: "offline" | "online" | "active" | "overheated"; effectiveness?: number }>;
        commandBurstItems?: Array<{ typeId: number; quantity?: number; chargeTypeId?: number; chargeQuantity?: number; activeQuantity?: number; attributeOverrides?: Record<string, number>; state?: "offline" | "online" | "active" | "overheated"; effectiveness?: number }>;
        environmentTypeIds?: number[];
        abyssProfile?: { tier: 0 | 1 | 2 | 3 | 4 | 5 | 6; weather: "electrical" | "exotic" | "firestorm" | "gamma" | "dark"; penalty?: number; roomKey?: string };
      }): Promise<any>;
      getCapabilities(input: {
        characterId: string;
        cloneState?: "alpha" | "omega";
      }): Promise<CapabilityAnalysis>;
      getCurrentShipCapability(input: {
        characterId: string;
        profileId: ShipUseProfileId;
        cloneState?: "alpha" | "omega";
      }): Promise<CapabilityResult>;
      getConfig(): Promise<PublicConfig>;
      saveConfig(input: { eveClientId: string }): Promise<PublicConfig>;
      loginWithEve(): Promise<{
        characterId: string;
        characterName: string;
        snapshot: CharacterSnapshot;
        becamePrimaryIdentity: boolean;
        sageAccountId: string;
        primaryCharacterId: string;
        onlineIdentitySynced: boolean;
        onlineIdentityError?: string;
      }>;
      refreshCharacter(characterId: string): Promise<CharacterSnapshot>;
      refreshCurrentShip(characterId: string): Promise<CharacterSnapshot>;
      listSnapshots(): Promise<CharacterSnapshot[]>;
      getEveNews(force?: boolean): Promise<EveNewsItem[]>;
      prepareNavigationGraph(): Promise<NavigationGraphStatus>;
      searchNavigationSystems(query: string, limit?: number): Promise<NavigationSystem[]>;
      getNavigationSystem(systemId: number): Promise<NavigationSystem | null>;
      getNavigationNeighbours(systemId: number): Promise<Array<{ edge: NavigationRouteLeg; system: NavigationSystem }>>;
      getNavigationMapData(input: { scope?: "universe" | "region"; regionId?: number | null }): Promise<NavigationMapData>;
      getNavigationLiveMapMetrics(force?: boolean): Promise<NavigationLiveMapMetrics>;
      calculateNavigationRoute(input: { from: number; to: number; mode?: NavigationRouteMode; minSecurity?: number | null; avoidSystemIds?: number[]; avoidConstellationIds?: number[]; avoidRegionIds?: number[]; excludedSystemIds?: number[] }): Promise<NavigationRouteResult>;
      calculateNavigationPlan(input: NavigationPlanInput): Promise<NavigationRoutePlan>;
      exportNavigationRouteToEve(input: { characterId: string; systemIds: number[]; clearOtherWaypoints?: boolean }): Promise<{ success: boolean; waypoints: number }>;
      getNavigationHazards(force?: boolean): Promise<NavigationHazardSnapshot>;
      getNavigationCharacterLocation(characterId: string, forceLive?: boolean): Promise<NavigationCharacterLocation>;
      getNavigationCapitalContext(characterId: string): Promise<NavigationCapitalContext>;
      calculateNavigationCapitalPlan(input: { characterId: string; shipTypeId: number; fromSystemId: number; toSystemId: number; startingFatigueMinutes?: number; includeLiveIntelligence?: boolean }): Promise<NavigationCapitalPlan>;
      getNavigationEveWaypointChain(route: NavigationRoutePlan): Promise<{ systemIds: number[]; complete: boolean; stoppedAtSpecialEdge: string | null; exportedGateLegs: number; totalLegs: number }>;
      exportNavigationRouteJson(route: NavigationRoutePlan): Promise<string>;
      importNavigationRouteJson(text: string): Promise<NavigationRoutePlan>;
      getNavigationOnlineWorkspace(characterId: string): Promise<NavigationOnlineWorkspace>;
      listNavigationOnlineRoutes(input: { characterId: string; workspaceId: string }): Promise<NavigationOnlineRouteSummary[]>;
      getNavigationOnlineRoute(input: { characterId: string; workspaceId: string; objectId: string }): Promise<NavigationOnlineRouteObject>;
      publishNavigationOnlineRoute(input: { characterId: string; workspaceId: string; route: NavigationRoutePlan; visibility?: "workspace" | "restricted"; recipientCharacterIds?: number[] }): Promise<{ id: string; object_type: "sage.route"; version: number; idempotent_replay?: boolean }>;
      updateNavigationOnlineRoute(input: { characterId: string; workspaceId: string; objectId: string; route: NavigationRoutePlan; expectedVersion: number }): Promise<{ id: string; object_type: "sage.route"; version: number }>;
      getNavigationRouteIntelligence(input: { systemIds: number[]; legs?: NavigationRouteLeg[] }): Promise<NavigationRouteIntelligence>;
      getWormholeCommandStore(): Promise<WormholeCommandStore>;
      exportWormholeSharedChain(): Promise<WormholeSharedChainPayload>;
      importWormholeSharedChain(input:WormholeSharedChainPayload): Promise<WormholeCommandStore>;
      mergeWormholeSharedChain(input:WormholeSharedChainPayload): Promise<WormholeCommandStore>;
      getWormholeOnlineWorkspace(characterId:string): Promise<NavigationOnlineWorkspace>;
      listWormholeOnlineChains(input:{characterId:string;workspaceId:string}): Promise<WormholeOnlineChainSummary[]>;
      getWormholeOnlineChain(input:{characterId:string;workspaceId:string;objectId:string}): Promise<WormholeOnlineChainObject>;
      publishWormholeOnlineChain(input:{characterId:string;workspaceId:string;chain:WormholeSharedChainPayload;visibility?:"workspace"|"restricted";recipientCharacterIds?:number[]}): Promise<{id:string;object_type:"sage.wormhole-chain";version:number;idempotent_replay?:boolean}>;
      updateWormholeOnlineChain(input:{characterId:string;workspaceId:string;objectId:string;chain:WormholeSharedChainPayload;expectedVersion:number}): Promise<{id:string;object_type:"sage.wormhole-chain";version:number}>;
      getWormholeOnlineEvents(input:{characterId:string;workspaceId:string;after?:number}): Promise<WormholeWorkspaceEvent[]>;
      getWormholeOnlineAudit(input:{characterId:string;workspaceId:string}): Promise<WormholeOnlineAuditEntry[]>;
      importLegacyWormholeScans(input: unknown): Promise<WormholeCommandStore>;
      recordWormholeScan(input: { systemId:number; systemName:string; characterId:string; characterName:string; scannedAt?:string; signatures:WormholeSignatureObservation[] }): Promise<{ store: WormholeCommandStore; reconciliation: WormholeReconciledSignature[] }>;
      observeWormholeSystem(input: { systemId:number; systemName:string; observedAt?:string; characterId?:string; characterName?:string }): Promise<WormholeCommandStore>;
      upsertWormholeWatch(input:{watchId?:string;kind:WormholeWatchKind;value?:string;enabled?:boolean}):Promise<WormholeCommandStore>;
      removeWormholeWatch(watchId:string):Promise<WormholeCommandStore>;
      recordWormholeWatchAlert(input:{watchId:string;fingerprint:string;message:string;systemId?:number;connectionId?:string}):Promise<{store:WormholeCommandStore;created:boolean;alert?:WormholeWatchAlert}>;
      dismissWormholeWatchAlert(alertId:string):Promise<WormholeCommandStore>;
      updateWormholeMapLayout(input: Partial<WormholeMapLayout>): Promise<WormholeCommandStore>;
      updateWormholeMapMarkers(input: { homeSystemId?:number|null; rallySystemId?:number|null }): Promise<WormholeCommandStore>;
      updateWormholeSignature(input: { systemId:number; signatureId:string; siteState?:WormholeSiteState; bookmarkName?:string; editorCharacterId?:string; editorCharacterName?:string }): Promise<WormholeCommandStore>;
      updateWormholeSystem(input: { systemId:number; alias?:string; notes?:string; status?:WormholeSystemStatus; pinned?:boolean; editorCharacterId?:string; editorCharacterName?:string }): Promise<WormholeCommandStore>;
      archiveWormholeSystem(input: { systemId:number; editorCharacterId?:string; editorCharacterName?:string }): Promise<WormholeCommandStore>;
      previewWormholeCleanup(input: { minInactiveHours:number }): Promise<WormholeCleanupPreview>;
      applyWormholeCleanup(input: { minInactiveHours:number; systemIds:number[]; editorCharacterId?:string; editorCharacterName?:string }): Promise<{store:WormholeCommandStore; archivedSystemIds:number[]; preview:WormholeCleanupPreview}>;
      upsertWormholeConnection(input: Partial<WormholeConnectionRecord> & { fromSystemId:number; editorCharacterId?:string; editorCharacterName?:string }): Promise<{ store: WormholeCommandStore; connection: WormholeConnectionRecord }>;
      removeWormholeConnection(connectionId:string): Promise<WormholeCommandStore>;
      getWormholeReference(): Promise<WormholeReferenceEntry[]>;
      getWormholeReferenceEntry(code:string): Promise<WormholeReferenceEntry|null>;
      getWormholeSystemReferences(systemIds:number[]): Promise<WormholeSystemReferenceEntry[]>;
      getWormholeRollingShipMass(input:{ shipTypeId:number; shipName?:string; fittedItems?:Array<{type_id:number;location_flag:string;item?:string}> }): Promise<WormholeRollingShipMass>;
      getNavigationPublicWormholes(force?:boolean): Promise<NavigationPublicWormholeSnapshot>;
      getWormholeSiteReference(force?:boolean): Promise<WormholePveReferenceSnapshot>;
      onWormholeCommandUpdated(callback:(value:WormholeCommandStore)=>void):()=>void;
      refreshSystemIntelligence(input: { systemIds: number[]; caller?: "watch" | "route" | "single"; discoverStructures?: boolean; deepKillmailBackfill?: boolean; forceActivity?: boolean }): Promise<WormholeSystemIntelligenceRefresh>;
      onSystemKillmailsUpdated(callback: (value: { systemIds?: number[]; killmailsBySystem?: Record<string, WormholeKillmailIntel[]>; updatedAtBySystem?: Record<string, string | null>; queuedBySystem?: Record<string, boolean>; status?: any }) => void): () => void;
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
        highSecOnly?: boolean;
        items: Array<{ typeId?: number; name: string; quantity: number }>;
      }): Promise<any>;
      exportShoppingRouteToEve(input: {
        characterId: string;
        stops: Array<{ locationId?: number; systemId: number; station: string; system: string }>;
      }): Promise<{ success: boolean; waypoints: number }>;
      exportFitToEve(input: { characterId: string; fit: unknown }): Promise<{ fitting_id?: number; success?: boolean }>;
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
        cargoProfileId?: string | null;
        maxJumps?: number | null;
        maxMinutes?: number | null;
        force?: boolean;
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
      runMasterUpdate(input?: { cloneStates?: Record<string, "alpha" | "omega">; characterIds?: string[] }): Promise<any>;
      onPreparedDataUpdated(callback: (value: { completedAt: string; characterIds?: string[]; preparationFailures?: number; publicDataUpdated?: boolean; publicGeneration?: string; publicArtifacts?: string[]; privateDataReady?: boolean }) => void): () => void;
      onMasterUpdateProgress(callback: (progress: { running:boolean; stage:string; message:string; percent:number; startedAt?:string; cpuWorkers?:number; downloadDurationMs?:number; totalDurationMs?:number; completed?:number; total?:number; tracks?: Array<{ id:string; label:string; percent:number; status:"waiting" | "running" | "done" | "error"; message:string }> }) => void): () => void;
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
        minVolume?: number | null;
        systemNames?: string[];
        systemQuery?: string;
        locationQuery?: string;
        originSystemId?: number | null;
        maxJumps?: number | null;
        sort?: "sell-lowest" | "buy-highest" | "price-low" | "price-high" | "volume" | "newest";
        offset?: number;
        limit?: number;
      }): Promise<RawMarketSearchResult>;
      listMarketSummaries(): Promise<MarketSummary[]>;
      getMarketRegion(regionId: number): Promise<MarketSummary | null>;
      getPublicDataStatus(): Promise<PublicDataStatus>;
      checkPublicDataAvailability(): Promise<PublicDataStatus>;
      checkPublicData(): Promise<PublicDataStatus & { changed: boolean; changedArtifacts: string[] }>;
      onPublicDataStatus(callback: (value: PublicDataStatus) => void): () => void;
      onPublicDataProgress(callback: (value: { running: boolean; percent: number; message: string; completed?: number; total?: number; error?: string }) => void): () => void;
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
