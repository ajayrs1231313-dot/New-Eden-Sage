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
  fitChoices: ActivityRecommendedFit[];
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
  specialConnections: { enabledTypes: NavigationEdgeType[]; disabledNetworkIds: string[] };
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

export type ClaudeCompatibilityStatus = {
  desktop: { detected: boolean; configured: boolean; changed?: boolean; restartRequired?: boolean; installPending?: boolean; path?: string; bundlePath?: string; method?: "mcpb" | "claude-code"; error?: string };
  code: { detected: boolean; configured: boolean; changed?: boolean; restartRequired?: boolean; installPending?: boolean; path?: string; bundlePath?: string; method?: "mcpb" | "claude-code"; error?: string };
  launch: { command: string; args: string[]; env: Record<string, string> };
};
declare global {
  interface Window {
    sage: {
      bridgeInfo: { version: number; localFittingCatalogue: boolean; localTypeImages: boolean };
      getUpdateState(): Promise<{ version: string; packaged: boolean }>;
      checkForUpdates(): Promise<unknown>;
      downloadUpdate(): Promise<unknown>;
      installUpdate(): Promise<boolean>;
      openSupportPage(): Promise<void>;
      openZkillboard(killmailId?: number): Promise<void>;
      getMcpSetup(): Promise<{ command: string; args: string[]; json: string; codex: string; access: string; claudeDesktop: string; claudeCode: string }>;
      getClaudeMcpStatus(): Promise<ClaudeCompatibilityStatus>;
      repairClaudeMcp(): Promise<ClaudeCompatibilityStatus>;
      getMcpTunnelStatus(): Promise<{ configured: boolean; tunnelId: string; running: boolean; ready: boolean; healthUrl: string }>;
      configureMcpTunnel(input: { tunnelId: string; runtimeKey: string }): Promise<{ configured: boolean; tunnelId: string; running: boolean; ready: boolean; healthUrl: string }>;
      openChatGptPlugins(): Promise<void>;
      openOpenAiTunnels(): Promise<void>;
      openOpenAiApiKeys(): Promise<void>;
      syncMcpRendererData(value: unknown): Promise<boolean>;
      onMcpFitDataUpdated(callback: (value: { savedFits?: unknown[]; fitLibraryMeta?: Record<string, unknown>; selectedFitId?: string }) => void): () => void;
      onUpdateStatus(callback: (value: { status: string; detail?: any }) => void): () => void;
      copyText(value: string): Promise<boolean>;
      resolveTypeNames(
        names: string[],
      ): Promise<Array<{ id: number; name: string }>>;
      resolveFittingTypeNamesLocal(
        names: string[],
      ): Promise<Array<{ id: number; name: string }>>;
      searchFittingTypesLocal(query: string, limit?: number): Promise<Array<{ id: number; name: string; groupId: number; categoryId: number; categoryName: string; rack?: "low" | "mid" | "high" | "rig" | "subsystem" }>>;
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
      listShips(): Promise<Array<{ typeId: number; name: string }>>;
      getManufacturingPlan(input: any): Promise<any>;
      getBlueprintActivities(input: any): Promise<any>;
      getInventionOpportunities(input: any): Promise<any>;
      getIndustrySystemCostIndex(input: any): Promise<any>;
      getIndustrialOpportunities(input: any): Promise<any>;
      getPreparedIndustrialCommand(input: { characterId: string }): Promise<any>;
      getIndustrialOpportunityRouteScope(input: any): Promise<any>;
      getPreparedIskLab(input: { characterId: string; cloneState?: "alpha" | "omega" }): Promise<{ market: OpportunityAnalysis | null; pve: PveLocationAnalysis | null; invention: any | null }>;
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
        implantTypeIds?: number[];
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
        becamePrimaryIdentity: boolean;
        sageAccountId: string;
        primaryCharacterId: string;
        onlineIdentitySynced: boolean;
        onlineIdentityError?: string;
      }>;
      refreshCharacter(characterId: string): Promise<CharacterSnapshot>;
      listSnapshots(): Promise<CharacterSnapshot[]>;
      getEveNews(force?: boolean): Promise<EveNewsItem[]>;
      prepareNavigationGraph(): Promise<NavigationGraphStatus>;
      searchNavigationSystems(query: string, limit?: number): Promise<NavigationSystem[]>;
      getNavigationSystem(systemId: number): Promise<NavigationSystem | null>;
      getNavigationNeighbours(systemId: number): Promise<Array<{ edge: NavigationRouteLeg; system: NavigationSystem }>>;
      getNavigationMapData(input: { scope?: "universe" | "region"; regionId?: number | null }): Promise<NavigationMapData>;
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
      refreshSystemIntelligence(input: { systemIds: number[]; caller?: "watch" | "route" | "single"; discoverStructures?: boolean; deepKillmailBackfill?: boolean; forceActivity?: boolean }): Promise<any>;
      onSystemKillmailsUpdated(callback: (value: { systemIds?: number[]; killmailsBySystem?: Record<string, unknown[]>; updatedAtBySystem?: Record<string, string | null>; queuedBySystem?: Record<string, boolean>; status?: any }) => void): () => void;
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
      runMasterUpdate(input?: { cloneStates?: Record<string, "alpha" | "omega"> }): Promise<any>;
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
