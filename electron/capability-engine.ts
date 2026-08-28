import { analyzeActivityReadiness, type ActivityReadinessResult } from "./activity-readiness";
import { analyzeTrainingPlan, type ExplicitSkillTarget, type ShipReadinessSkill, type SnapshotLike } from "./readiness";
import { listPublishedShips } from "./type-volumes";
import type { CloneState } from "./skill-training";
import { loadSharedPublicSource } from "./shared-market-data";

type CapabilityActivityProfile = {
  id: string;
  label: string;
  description: string;
  kind: "activity";
  candidates: string[];
  coreSkills: ExplicitSkillTarget[];
  supportSkills: ExplicitSkillTarget[];
  context: {
    activityId: string;
    subcategoryId: string;
    contentId: string;
    selectorValues?: Record<string, string>;
  };
};

type CapabilitySkillProfile = {
  id: string;
  label: string;
  description: string;
  kind: "skills";
  coreSkills: ExplicitSkillTarget[];
  supportSkills: ExplicitSkillTarget[];
  signal: "industry" | "trading";
};

type CapabilityProfile = CapabilityActivityProfile | CapabilitySkillProfile;

export type CurrentShipUseProfileId =
  | "pve-combat"
  | "pvp-combat"
  | "mining"
  | "exploration"
  | "logistics"
  | "hauling"
  | "salvage"
  | "support"
  | "general";

type OwnedAsset = {
  type_id?: number;
  item?: string;
  category_id?: number;
  quantity?: number;
  estimatedValue?: number;
};

export type CapabilityUpgrade = {
  type: "skill" | "ship" | "module" | "blueprint" | "wallet";
  label: string;
  why: string;
  estimatedGain: number;
  estimatedSeconds?: number | null;
  estimatedCost?: number | null;
};

export type CapabilityResult = {
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
};

export type CapabilityAnalysis = {
  characterId: string;
  character: string;
  generatedAt: string;
  capabilities: CapabilityResult[];
  topRecommendations: Array<{
    capabilityId: string;
    capability: string;
    upgrade: CapabilityUpgrade;
  }>;
  dataSignals: {
    wallet: number;
    ownedShips: number;
    modules: number;
    blueprints: number;
    savedFittings: number;
    activeQueue: number;
  };
};

const fitting = [
  { skill: "CPU Management", level: 5 },
  { skill: "Power Grid Management", level: 5 },
  { skill: "Weapon Upgrades", level: 4 },
];
const navigation = [
  { skill: "Navigation", level: 4 },
  { skill: "Evasive Maneuvering", level: 4 },
  { skill: "Warp Drive Operation", level: 4 },
];
const capacitor = [
  { skill: "Capacitor Management", level: 4 },
  { skill: "Capacitor Systems Operation", level: 4 },
];

const profiles: CapabilityProfile[] = [
  {
    id: "abyss",
    label: "Abyssal PvE",
    description: "Solo cruiser Abyss capability using a representative T4 Electrical target.",
    kind: "activity",
    candidates: ["Gila", "Sacrilege", "Ishtar", "Cerberus", "Vagabond"],
    coreSkills: [...fitting, ...capacitor, ...navigation],
    supportSkills: [
      { skill: "Drones", level: 5 },
      { skill: "Drone Interfacing", level: 4 },
      { skill: "Thermodynamics", level: 4 },
    ],
    context: {
      activityId: "pve",
      subcategoryId: "abyss",
      contentId: "abyss-cruiser",
      selectorValues: { tier: "T4 Raging", weather: "Electrical" },
    },
  },
  {
    id: "missions",
    label: "Level 4 Missions",
    description: "High-end mission running with battleship or Marauder progression.",
    kind: "activity",
    candidates: ["Raven", "Dominix", "Rattlesnake", "Machariel", "Paladin", "Vargur"],
    coreSkills: [...fitting, ...capacitor],
    supportSkills: [
      { skill: "Advanced Weapon Upgrades", level: 4 },
      { skill: "Long Range Targeting", level: 4 },
      { skill: "Signature Analysis", level: 4 },
    ],
    context: { activityId: "pve", subcategoryId: "missions", contentId: "missions-l4" },
  },
  {
    id: "pvp",
    label: "Solo / Small-gang PvP",
    description: "General combat readiness using a damage-focused cruiser route as the baseline.",
    kind: "activity",
    candidates: ["Caracal", "Stabber", "Vexor", "Omen", "Thorax", "Vagabond", "Deimos", "Orthrus"],
    coreSkills: [...fitting, ...navigation],
    supportSkills: [
      { skill: "Thermodynamics", level: 4 },
      { skill: "Propulsion Jamming", level: 4 },
      { skill: "Signature Analysis", level: 4 },
    ],
    context: {
      activityId: "pvp",
      subcategoryId: "solo-smallgang",
      contentId: "pvp-roaming",
      selectorValues: { engagement: "Solo", role: "Damage / combat", shipClass: "Cruiser", style: "Brawl" },
    },
  },
  {
    id: "ratting",
    label: "Null-sec Ratting",
    description: "Sustained anomaly ratting readiness with travel, tank and drone/damage support competency.",
    kind: "activity",
    candidates: ["Ishtar", "Dominix", "Myrmidon", "Gila", "Vargur"],
    coreSkills: [...fitting, ...navigation],
    supportSkills: [
      { skill: "Drones", level: 5 },
      { skill: "Drone Interfacing", level: 4 },
      { skill: "Thermodynamics", level: 4 },
    ],
    context: { activityId: "pve", subcategoryId: "anomalies", contentId: "nullsec-ratting" },
  },
  {
    id: "combat-exploration",
    label: "DED / Combat Exploration",
    description: "Combat-signature and escalation readiness combining scanning, dangerous-space travel and PvE fitting competency.",
    kind: "activity",
    candidates: ["Gila", "Ishtar", "Tengu", "Loki", "Proteus"],
    coreSkills: [...fitting, ...capacitor],
    supportSkills: [
      { skill: "Astrometrics", level: 4 },
      { skill: "Cloaking", level: 4 },
      { skill: "Thermodynamics", level: 4 },
    ],
    context: { activityId: "pve", subcategoryId: "anomalies", contentId: "ded-escalations" },
  },
  {
    id: "mining",
    label: "Ore Mining",
    description: "Exhumer/barge ore-mining capability with a balanced high-sec target.",
    kind: "activity",
    candidates: ["Hulk", "Mackinaw", "Skiff", "Covetor", "Retriever", "Procurer"],
    coreSkills: [
      { skill: "Mining", level: 5 },
      { skill: "Astrogeology", level: 5 },
      { skill: "Mining Barge", level: 4 },
    ],
    supportSkills: [
      { skill: "Mining Upgrades", level: 4 },
      { skill: "Drones", level: 4 },
      { skill: "Shield Management", level: 4 },
    ],
    context: {
      activityId: "mining",
      subcategoryId: "resource-harvesting",
      contentId: "ore-mining",
      selectorValues: { space: "High-sec", operation: "Solo", priority: "Balanced" },
    },
  },
  {
    id: "exploration",
    label: "Exploration",
    description: "Relic/data scanning and covert travel capability in dangerous space.",
    kind: "activity",
    candidates: ["Cheetah", "Anathema", "Buzzard", "Helios", "Astero"],
    coreSkills: [
      { skill: "Astrometrics", level: 4 },
      { skill: "Hacking", level: 4 },
      { skill: "Archaeology", level: 4 },
    ],
    supportSkills: [
      { skill: "Astrometric Rangefinding", level: 3 },
      { skill: "Astrometric Pinpointing", level: 3 },
      { skill: "Cloaking", level: 4 },
    ],
    context: {
      activityId: "exploration",
      subcategoryId: "scanning-sites",
      contentId: "relic-data",
      selectorValues: { space: "Null-sec", priority: "Travel safety" },
    },
  },
  {
    id: "hauling",
    label: "High-value Hauling",
    description: "Covert and resilient hauling with transport-ship progression.",
    kind: "activity",
    candidates: ["Viator", "Crane", "Prowler", "Prorator", "Occator", "Bustard", "Mastodon", "Impel"],
    coreSkills: [
      { skill: "Transport Ships", level: 4 },
      { skill: "Cloaking", level: 4 },
      { skill: "Evasive Maneuvering", level: 5 },
    ],
    supportSkills: [
      { skill: "Navigation", level: 5 },
      { skill: "Warp Drive Operation", level: 5 },
      { skill: "Cybernetics", level: 4 },
    ],
    context: {
      activityId: "hauling",
      subcategoryId: "transport",
      contentId: "blockade-runner",
      selectorValues: { route: "Low-sec", cargo: "High value" },
    },
  },
  {
    id: "incursions",
    label: "Incursions",
    description: "Vanguard DPS readiness with fleet-grade fitting expectations.",
    kind: "activity",
    candidates: ["Vindicator", "Nightmare", "Machariel"],
    coreSkills: [...fitting, ...capacitor],
    supportSkills: [
      { skill: "Long Range Targeting", level: 4 },
      { skill: "Signature Analysis", level: 4 },
      { skill: "Thermodynamics", level: 4 },
    ],
    context: {
      activityId: "incursions",
      subcategoryId: "incursion-sites",
      contentId: "vanguard",
      selectorValues: { role: "DPS", shipClass: "Battleship" },
    },
  },
  {
    id: "wormholes",
    label: "Wormhole PvE",
    description: "Representative C3 solo PvE readiness including scanning, cloak, tank and fit competency.",
    kind: "activity",
    candidates: ["Praxis", "Tengu", "Loki", "Rattlesnake", "Gila"],
    coreSkills: [...fitting, ...capacitor],
    supportSkills: [
      { skill: "Thermodynamics", level: 4 },
      { skill: "Astrometrics", level: 4 },
      { skill: "Cloaking", level: 4 },
    ],
    context: {
      activityId: "wormholes",
      subcategoryId: "wormhole-life",
      contentId: "wh-c3-pve",
      selectorValues: { operation: "Solo", shipClass: "Strategic cruiser" },
    },
  },
  {
    id: "industry",
    label: "Manufacturing & Industry",
    description: "Production capability using skills, blueprint access and current industrial data.",
    kind: "skills",
    signal: "industry",
    coreSkills: [
      { skill: "Industry", level: 5 },
      { skill: "Mass Production", level: 4 },
      { skill: "Advanced Industry", level: 4 },
    ],
    supportSkills: [
      { skill: "Advanced Mass Production", level: 3 },
      { skill: "Science", level: 4 },
      { skill: "Supply Chain Management", level: 3 },
    ],
  },
  {
    id: "trading",
    label: "Trading",
    description: "Market capability using trading skills, wallet capital and live order activity.",
    kind: "skills",
    signal: "trading",
    coreSkills: [
      { skill: "Trade", level: 5 },
      { skill: "Retail", level: 5 },
      { skill: "Accounting", level: 4 },
    ],
    supportSkills: [
      { skill: "Broker Relations", level: 4 },
      { skill: "Daytrading", level: 4 },
      { skill: "Marketing", level: 4 },
    ],
  },
];

const currentShipUseProfiles: Array<CapabilityActivityProfile & { id: CurrentShipUseProfileId }> = [
  {
    id: "pve-combat",
    label: "PvE Combat",
    description: "Current-hull combat readiness for entry-level mission and general PvE work.",
    kind: "activity", candidates: [],
    coreSkills: [...fitting, ...navigation],
    supportSkills: [{ skill: "Target Management", level: 3 }, { skill: "Mechanics", level: 4 }, { skill: "Capacitor Management", level: 4 }],
    context: { activityId: "pve", subcategoryId: "missions", contentId: "missions-l1-l2" },
  },
  {
    id: "pvp-combat",
    label: "PvP Combat",
    description: "Current-hull solo and small-gang combat readiness using Sage PvP fitting and piloting targets.",
    kind: "activity", candidates: [],
    coreSkills: [...fitting, ...navigation],
    supportSkills: [{ skill: "Thermodynamics", level: 4 }, { skill: "Propulsion Jamming", level: 4 }, { skill: "Signature Analysis", level: 4 }],
    context: { activityId: "pvp", subcategoryId: "solo-smallgang", contentId: "pvp-roaming", selectorValues: { engagement: "Solo", role: "Damage / combat", style: "Brawl" } },
  },
  {
    id: "mining",
    label: "Mining",
    description: "Current-hull ore-mining readiness. Select this only when the active hull is actually being used to mine.",
    kind: "activity", candidates: [],
    coreSkills: [{ skill: "Mining", level: 5 }, { skill: "Astrogeology", level: 4 }, ...fitting.slice(0, 2)],
    supportSkills: [{ skill: "Mining Upgrades", level: 4 }, { skill: "Drones", level: 4 }, { skill: "Shield Management", level: 4 }],
    context: { activityId: "mining", subcategoryId: "resource-harvesting", contentId: "ore-mining", selectorValues: { space: "High-sec", operation: "Solo", priority: "Balanced" } },
  },
  {
    id: "exploration",
    label: "Exploration",
    description: "Current-hull scanning, relic/data and travel readiness.",
    kind: "activity", candidates: [],
    coreSkills: [{ skill: "Astrometrics", level: 4 }, { skill: "Hacking", level: 4 }, { skill: "Archaeology", level: 4 }],
    supportSkills: [{ skill: "Astrometric Rangefinding", level: 3 }, { skill: "Astrometric Pinpointing", level: 3 }, { skill: "Cloaking", level: 4 }],
    context: { activityId: "exploration", subcategoryId: "scanning-sites", contentId: "relic-data", selectorValues: { space: "Low-sec", priority: "Travel safety" } },
  },
  {
    id: "logistics",
    label: "Logistics",
    description: "Current-hull fleet logistics readiness for remote repair and capacitor support work.",
    kind: "activity", candidates: [],
    coreSkills: [...fitting, ...capacitor, ...navigation],
    supportSkills: [{ skill: "Long Range Targeting", level: 4 }, { skill: "Signature Analysis", level: 4 }, { skill: "Capacitor Emission Systems", level: 4 }],
    context: { activityId: "pvp", subcategoryId: "fleet", contentId: "fleet-roles", selectorValues: { role: "Logistics", style: "Mid-range" } },
  },
  {
    id: "hauling",
    label: "Hauling",
    description: "Current-hull high-sec transport readiness with travel, tank and cargo-risk fundamentals.",
    kind: "activity", candidates: [],
    coreSkills: [...navigation, { skill: "Hull Upgrades", level: 4 }],
    supportSkills: [{ skill: "Evasive Maneuvering", level: 4 }, { skill: "Mechanics", level: 4 }],
    context: { activityId: "hauling", subcategoryId: "transport", contentId: "basic-hauling", selectorValues: { route: "High-sec", cargo: "Normal value" } },
  },
  {
    id: "salvage",
    label: "Salvage",
    description: "Current-hull salvage readiness for post-combat recovery and site cleanup.",
    kind: "activity", candidates: [],
    coreSkills: [{ skill: "Salvaging", level: 4 }, { skill: "Mechanics", level: 4 }, ...fitting.slice(0, 2)],
    supportSkills: [{ skill: "Survey", level: 3 }, { skill: "Navigation", level: 4 }, { skill: "Target Management", level: 3 }],
    context: { activityId: "pve", subcategoryId: "missions", contentId: "missions-l1-l2" },
  },
  {
    id: "support",
    label: "Support",
    description: "Current-hull fleet utility readiness for non-primary-DPS support work.",
    kind: "activity", candidates: [],
    coreSkills: [...fitting, ...capacitor, ...navigation],
    supportSkills: [{ skill: "Thermodynamics", level: 3 }, { skill: "Long Range Targeting", level: 4 }, { skill: "Signature Analysis", level: 4 }],
    context: { activityId: "pvp", subcategoryId: "solo-smallgang", contentId: "pvp-roaming", selectorValues: { engagement: "Small gang", role: "Support / utility", style: "Brawl" } },
  },
  {
    id: "general",
    label: "Other / General",
    description: "Baseline current-hull operation when the ship is not being judged for a specialist role.",
    kind: "activity", candidates: [],
    coreSkills: [...fitting, ...navigation, ...capacitor],
    supportSkills: [{ skill: "Target Management", level: 3 }, { skill: "Mechanics", level: 3 }, { skill: "Signature Analysis", level: 3 }],
    context: { activityId: "pve", subcategoryId: "missions", contentId: "missions-l1-l2" },
  },
];

const resultCache = new Map<string, CapabilityAnalysis>();
const currentShipResultCache = new Map<string, CapabilityResult>();
let marketPriceCache: { expiresAt: number; values: Map<number, number> } | null = null;

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function ownedAssets(snapshot: any): OwnedAsset[] {
  return asArray(snapshot.extended?.assets) as OwnedAsset[];
}

function ownedShipNames(snapshot: any) {
  return new Set(
    asArray(snapshot.extended?.assetSummary?.ownedShips)
      .map((ship: any) => String(ship.item ?? ""))
      .filter(Boolean),
  );
}

async function marketPrices() {
  if (marketPriceCache && marketPriceCache.expiresAt > Date.now()) return marketPriceCache.values;
  const source = await loadSharedPublicSource<Array<{ type_id: number; average_price?: number; adjusted_price?: number }>>("markets-prices");
  const values = new Map<number, number>();
  for (const item of source?.data ?? []) values.set(item.type_id, item.average_price ?? item.adjusted_price ?? 0);
  marketPriceCache = { expiresAt: Date.now() + 30 * 60 * 1000, values };
  return values;
}

function tier(percent: number) {
  if (percent >= 90) return "Strong";
  if (percent >= 75) return "Operational";
  if (percent >= 60) return "Developing";
  if (percent >= 40) return "Early training";
  return "Not ready";
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function estimateSkillGain(skill: ShipReadinessSkill, analysis: ActivityReadinessResult | null) {
  const sourceWeight = skill.sources?.includes("activity")
    ? Math.max(analysis?.components.activity.weight ?? 30, analysis?.components.context.weight ?? 0)
    : skill.direct
      ? Math.max(analysis?.components.fit.weight ?? 35, analysis?.components.hull.weight ?? 10)
      : Math.max(8, Math.round(Math.max(analysis?.components.fit.weight ?? 30, analysis?.components.hull.weight ?? 10) * 0.4));
  return Math.max(1, Math.min(15, Math.round(sourceWeight * (skill.missingLevels / Math.max(1, skill.targetLevel)) * 0.35)));
}

function skillReason(skill: ShipReadinessSkill) {
  if (skill.reasons?.length) return skill.reasons[0];
  if (skill.sources?.includes("activity")) return "Raises the selected activity or role competency.";
  if (skill.direct) return "Required directly by the selected hull or fitting route.";
  return "Prerequisite for another required skill.";
}

async function evaluateActivity(snapshot: any, profile: CapabilityActivityProfile, cloneState: CloneState, forcedShipTypeId?: number) {
  const ships = await listPublishedShips();
  const byName = new Map(ships.map((ship) => [ship.name, ship]));
  const owned = ownedShipNames(snapshot);
  if (forcedShipTypeId) {
    const ship = ships.find((item) => item.typeId === forcedShipTypeId);
    if (!ship) return null;
    const analysis = await analyzeActivityReadiness(snapshot as SnapshotLike, {
      hullTypeId: ship.typeId,
      coreSkills: profile.coreSkills,
      supportSkills: profile.supportSkills,
      context: profile.context,
      cloneState,
    });
    return { ship, owned: true, analysis };
  }
  const candidates = profile.candidates.flatMap((name) => {
    const ship = byName.get(name);
    return ship ? [{ ship, owned: owned.has(name) }] : [];
  });
  const results: Array<{ ship: { typeId: number; name: string }; owned: boolean; analysis: ActivityReadinessResult }> = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, candidates.length) }, async () => {
      while (cursor < candidates.length) {
        const item = candidates[cursor++];
        const analysis = await analyzeActivityReadiness(snapshot as SnapshotLike, {
          hullTypeId: item.ship.typeId,
          coreSkills: profile.coreSkills,
          supportSkills: profile.supportSkills,
          context: profile.context,
          cloneState,
        });
        results.push({ ...item, analysis });
      }
    }),
  );
  results.sort((a, b) =>
    b.analysis.overallPercent - a.analysis.overallPercent ||
    b.analysis.masteryPercent - a.analysis.masteryPercent ||
    Number(b.owned) - Number(a.owned),
  );
  return results[0] ?? null;
}

async function assetSignals(snapshot: any, best: Awaited<ReturnType<typeof evaluateActivity>>) {
  if (!best) return { assetPercent: 0, resourcePercent: 0, missingAssetCost: null, missingAssetCount: 0, savedFitCount: 0, missingNames: [] as string[] };
  const assets = ownedAssets(snapshot);
  const ownedByType = new Map<number, number>();
  for (const asset of assets) {
    if (!asset.type_id) continue;
    ownedByType.set(asset.type_id, (ownedByType.get(asset.type_id) ?? 0) + Math.max(1, asset.quantity ?? 1));
  }
  const hullOwned = best.owned;
  const contextFitKnown = Boolean(best.analysis.selectedArchetype?.contextSpecific);
  const fitItems = contextFitKnown ? (best.analysis.selectedArchetype?.items ?? []) : [];
  const requiredTypes = [...new Set(fitItems.map((item) => item.typeId))];
  const ownedFit = requiredTypes.filter((id) => (ownedByType.get(id) ?? 0) > 0);
  const fitAssetPercent = requiredTypes.length ? (ownedFit.length / requiredTypes.length) * 100 : 0;
  const assetPercent = contextFitKnown
    ? clamp((hullOwned ? 40 : 0) + fitAssetPercent * 0.6)
    : (hullOwned ? 60 : 0);
  const missingTypes = requiredTypes.filter((id) => (ownedByType.get(id) ?? 0) <= 0);
  if (!hullOwned) missingTypes.unshift(best.ship.typeId);
  const prices = await marketPrices().catch(() => new Map<number, number>());
  const missingAssetCost = missingTypes.length
    ? missingTypes.reduce((sum, id) => sum + (prices.get(id) ?? 0), 0)
    : 0;
  const wallet = Number(snapshot.wallet ?? 0);
  const resourcePercent = missingAssetCost <= 0
    ? 100
    : missingAssetCost > 0
      ? clamp((wallet / missingAssetCost) * 100)
      : 0;
  const typeNames = new Map<number, string>();
  typeNames.set(best.ship.typeId, best.ship.name);
  for (const item of fitItems) typeNames.set(item.typeId, item.name);
  const savedFitCount = asArray(snapshot.extended?.fittings).filter((fit: any) => fit.ship_type_id === best.ship.typeId).length;
  return {
    assetPercent,
    resourcePercent,
    missingAssetCost,
    missingAssetCount: missingTypes.length,
    savedFitCount,
    missingNames: missingTypes.slice(0, 5).map((id) => typeNames.get(id) ?? `Type ${id}`),
  };
}

function relevantQueued(snapshot: any, skills: ShipReadinessSkill[]) {
  const required = new Set(skills.map((skill) => skill.skillId));
  return asArray(snapshot.queue).filter((entry: any) => required.has(entry.skill_id)).length;
}

function topSkillUpgrades(skills: ShipReadinessSkill[], analysis: ActivityReadinessResult | null): CapabilityUpgrade[] {
  return skills
    .filter((skill) => !skill.met)
    .map((skill) => ({
      type: "skill" as const,
      label: `${skill.name} -> L${skill.targetLevel}`,
      why: skillReason(skill),
      estimatedGain: estimateSkillGain(skill, analysis),
      estimatedSeconds: skill.estimatedSeconds,
    }))
    .sort((a, b) => b.estimatedGain - a.estimatedGain || (a.estimatedSeconds ?? Infinity) - (b.estimatedSeconds ?? Infinity))
    .slice(0, 5);
}

async function analyzeActivityCapability(snapshot: any, profile: CapabilityActivityProfile, cloneState: CloneState, forcedShipTypeId?: number): Promise<CapabilityResult> {
  const best = await evaluateActivity(snapshot, profile, cloneState, forcedShipTypeId);
  if (!best) {
    return {
      id: profile.id,
      label: profile.label,
      description: profile.description,
      overallPercent: 0,
      readinessPercent: 0,
      assetPercent: 0,
      resourcePercent: 0,
      tier: "No route data",
      bestRoute: "No published candidate hull resolved",
      ownedHull: false,
      missingAssetCost: null,
      missingAssetCount: 0,
      queuedRelevantSkills: 0,
      blueprintCount: asArray(snapshot.extended?.blueprints).length,
      savedFitCount: 0,
      strengths: [],
      weaknesses: ["No candidate hull could be resolved for this capability."],
      upgrades: [],
      showWork: ["No capability score was fabricated because Sage could not resolve a candidate hull."],
    };
  }
  const assets = await assetSignals(snapshot, best);
  const readinessPercent = best.analysis.overallPercent;
  const operationalSignal = assets.savedFitCount > 0 ? 100 : best.owned ? 70 : 30;
  const overallPercent = clamp(readinessPercent * 0.65 + assets.assetPercent * 0.2 + assets.resourcePercent * 0.1 + operationalSignal * 0.05);
  const strengths = [
    best.owned ? `${best.ship.name} is already owned.` : `${best.ship.name} is the strongest current training route.`,
    `${readinessPercent}% contextual skill/fit readiness for the representative target.`,
    assets.assetPercent >= 70 ? `${assets.assetPercent}% of the selected hull/fit asset layer is already present.` : "",
    assets.resourcePercent >= 100 && assets.missingAssetCount > 0 ? "Current wallet can cover the estimated missing hull/fit acquisition cost." : "",
    assets.savedFitCount ? `${assets.savedFitCount} saved fitting${assets.savedFitCount === 1 ? "" : "s"} exist for this hull.` : "",
  ].filter(Boolean);
  const weaknesses = [
    ...best.analysis.missingSkills.slice(0, 4).map((skill) => `${skill.name} needs L${skill.targetLevel} (currently L${skill.currentLevel}).`),
    ...assets.missingNames.map((name) => `Missing asset: ${name}.`),
    assets.resourcePercent < 100 && assets.missingAssetCost ? `Wallet covers about ${assets.resourcePercent}% of the estimated missing fit/hull cost.` : "",
  ].filter(Boolean);
  const upgrades = topSkillUpgrades(best.analysis.recommendedQueue, best.analysis);
  if (!best.owned) upgrades.push({ type: "ship", label: `Acquire ${best.ship.name}`, why: "Owning the recommended hull removes the largest immediate asset gap.", estimatedGain: Math.max(4, Math.round((100 - assets.assetPercent) * 0.2)), estimatedCost: assets.missingAssetCost });
  if (assets.missingAssetCount > 0 && best.owned) upgrades.push({ type: "module", label: `Complete ${best.analysis.selectedArchetype?.label ?? "selected"} fit`, why: `${assets.missingAssetCount} identified hull/fit assets are not currently in the synced asset inventory.`, estimatedGain: Math.max(2, Math.round((100 - assets.assetPercent) * 0.2)), estimatedCost: assets.missingAssetCost });
  upgrades.sort((a, b) => b.estimatedGain - a.estimatedGain);
  return {
    id: profile.id,
    label: profile.label,
    description: profile.description,
    overallPercent,
    readinessPercent,
    assetPercent: assets.assetPercent,
    resourcePercent: assets.resourcePercent,
    tier: tier(overallPercent),
    bestRoute: `${best.ship.name}${best.analysis.selectedArchetype?.contextSpecific ? ` / ${best.analysis.selectedArchetype.label}` : best.analysis.selectedArchetype ? " / public hull-fit fallback" : ""}`,
    bestHull: best.ship.name,
    ownedHull: best.owned,
    missingAssetCost: assets.missingAssetCost,
    missingAssetCount: assets.missingAssetCount,
    queuedRelevantSkills: relevantQueued(snapshot, best.analysis.recommendedQueue),
    blueprintCount: asArray(snapshot.extended?.blueprints).length,
    savedFitCount: assets.savedFitCount,
    strengths,
    weaknesses,
    upgrades: upgrades.slice(0, 6),
    showWork: [
      `Overall capability = 65% contextual readiness + 20% owned hull/fit assets + 10% purchasing power + 5% operational signal.`,
      `Contextual readiness is ${readinessPercent}% and comes directly from the shared Activity Readiness engine for ${profile.context.activityId} / ${profile.context.contentId}.`,
      `Owned asset readiness is ${assets.assetPercent}%: ${best.analysis.selectedArchetype?.contextSpecific ? "hull ownership plus identified items in the context-specific fitting archetype" : "hull ownership only because the available fitting archetype is hull-wide fallback evidence"}.`,
      `Purchasing power is ${assets.resourcePercent}% against an estimated ${Math.round(assets.missingAssetCost ?? 0).toLocaleString("en-GB")} ISK of missing hull/fit assets using cached public ESI market-price estimates.`,
      `Operational signal is ${operationalSignal}% based on owning the hull and whether Sage sees a saved fitting for it.`,
    ],
  };
}

async function analyzeSkillCapability(snapshot: any, profile: CapabilitySkillProfile, cloneState: CloneState): Promise<CapabilityResult> {
  const targets = [...profile.coreSkills, ...profile.supportSkills];
  const plan = await analyzeTrainingPlan(snapshot as SnapshotLike, [], targets, cloneState);
  const blueprintCount = asArray(snapshot.extended?.blueprints).length;
  const marketOrders = asArray(snapshot.extended?.marketOrders).length;
  const industryJobs = asArray(snapshot.extended?.industryJobs).length;
  const wallet = Number(snapshot.wallet ?? 0);
  let assetPercent = 100;
  let resourcePercent = 100;
  let operationalSignal = 50;
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const upgrades = topSkillUpgrades(plan.recommendedQueue, null);
  if (profile.signal === "industry") {
    assetPercent = clamp(Math.min(100, blueprintCount * 4));
    resourcePercent = clamp(Math.min(100, wallet / 5_000_000 * 10));
    operationalSignal = clamp(Math.min(100, industryJobs * 15 + (blueprintCount ? 35 : 0)));
    if (blueprintCount) strengths.push(`${blueprintCount} character blueprint record${blueprintCount === 1 ? "" : "s"} are available to the engine.`);
    else {
      weaknesses.push("No character blueprints are present in the synced snapshot.");
      upgrades.push({ type: "blueprint", label: "Acquire or sync useful blueprints", why: "Industry skill readiness alone does not create a production opportunity.", estimatedGain: 10 });
    }
    if (industryJobs) strengths.push(`${industryJobs} industry job record${industryJobs === 1 ? "" : "s"} show active/recent industrial use.`);
  } else {
    assetPercent = 100;
    resourcePercent = wallet >= 1_000_000_000 ? 100 : wallet >= 250_000_000 ? 85 : wallet >= 50_000_000 ? 65 : wallet >= 10_000_000 ? 45 : 25;
    operationalSignal = clamp(Math.min(100, marketOrders * 12 + 30));
    strengths.push(`${Math.round(wallet).toLocaleString("en-GB")} ISK liquid capital is available.`);
    if (marketOrders) strengths.push(`${marketOrders} market order record${marketOrders === 1 ? "" : "s"} show active/recent market use.`);
    if (resourcePercent < 65) {
      weaknesses.push("Liquid capital is currently a meaningful constraint for market scaling.");
      upgrades.push({ type: "wallet", label: "Increase deployable trading capital", why: "More capital widens the set of executable market opportunities once trading skills are adequate.", estimatedGain: 6 });
    }
  }
  const overallPercent = clamp(plan.readinessPercent * 0.7 + assetPercent * 0.15 + resourcePercent * 0.1 + operationalSignal * 0.05);
  weaknesses.unshift(...plan.missingSkills.slice(0, 5).map((skill) => `${skill.name} needs L${skill.targetLevel} (currently L${skill.currentLevel}).`));
  if (plan.readinessPercent >= 85) strengths.unshift(`${plan.readinessPercent}% of the selected skill targets are already covered.`);
  return {
    id: profile.id,
    label: profile.label,
    description: profile.description,
    overallPercent,
    readinessPercent: plan.readinessPercent,
    assetPercent,
    resourcePercent,
    tier: tier(overallPercent),
    bestRoute: profile.signal === "industry" ? "Blueprint-driven production" : "Market trading",
    ownedHull: true,
    missingAssetCost: null,
    missingAssetCount: profile.signal === "industry" && !blueprintCount ? 1 : 0,
    queuedRelevantSkills: relevantQueued(snapshot, plan.recommendedQueue),
    blueprintCount,
    savedFitCount: 0,
    strengths,
    weaknesses,
    upgrades: upgrades.sort((a, b) => b.estimatedGain - a.estimatedGain).slice(0, 6),
    showWork: [
      `Overall capability = 70% shared training-plan readiness + 15% activity assets + 10% resources + 5% evidence of current use.`,
      `Training readiness is ${plan.readinessPercent}% across the selected direct targets and recursive prerequisites.`,
      profile.signal === "industry" ? `Industry assets score ${assetPercent}% from ${blueprintCount} synced blueprint records.` : `Trading resource score ${resourcePercent}% from current liquid wallet capital.`,
      profile.signal === "industry" ? `Operational signal is ${operationalSignal}% from blueprint access and ${industryJobs} captured industry job records.` : `Operational signal is ${operationalSignal}% from ${marketOrders} captured market-order records.`,
    ],
  };
}

function isCapsuleShip(snapshot: any) {
  const typeId = Number(snapshot?.ship?.ship_type_id ?? 0);
  const typeName = String(snapshot?.ship?.ship_type_name ?? "").trim().toLowerCase();
  return typeId === 670 || typeName === "capsule" || typeName.includes("capsule");
}

function capsuleCapabilityResult(snapshot: any, profile: CapabilityActivityProfile): CapabilityResult {
  const capsuleName = snapshot?.ship?.ship_type_name || snapshot?.ship?.ship_name || "Capsule";
  return {
    id: profile.id,
    label: profile.label,
    description: "Capsules are always fully operable and do not require ship-role readiness scoring.",
    overallPercent: 100,
    readinessPercent: 100,
    assetPercent: 100,
    resourcePercent: 100,
    tier: "Strong",
    bestRoute: capsuleName,
    bestHull: capsuleName,
    ownedHull: true,
    missingAssetCost: 0,
    missingAssetCount: 0,
    queuedRelevantSkills: 0,
    blueprintCount: asArray(snapshot.extended?.blueprints).length,
    savedFitCount: 0,
    strengths: ["Capsule operation is universally available to the active character."],
    weaknesses: [],
    upgrades: [],
    showWork: ["Capsule readiness is fixed at 100% for Overall, Practical, Assets and Resources regardless of the selected use profile."],
  };
}
export function listCurrentShipUseProfiles() {
  return currentShipUseProfiles.map(({ id, label, description }) => ({ id, label, description }));
}

export async function analyzeCurrentShipUse(
  snapshot: any,
  profileId: CurrentShipUseProfileId,
  cloneState: CloneState = "omega",
): Promise<CapabilityResult> {
  const shipTypeId = Number(snapshot?.ship?.ship_type_id ?? 0);
  if (!shipTypeId) throw new Error("Sync the current ship before calculating ship-use readiness.");
  const profile = currentShipUseProfiles.find((item) => item.id === profileId);
  if (!profile) throw new Error(`Unknown current-ship use profile: ${profileId}.`);
  const key = `${snapshot.characterId}:${shipTypeId}:${profile.id}:${cloneState}:${snapshot.updatedAt ?? "unknown"}`;
  const cached = currentShipResultCache.get(key);
  if (cached) return cached;
  if (isCapsuleShip(snapshot)) {
    const capsuleResult = capsuleCapabilityResult(snapshot, profile);
    currentShipResultCache.set(key, capsuleResult);
    return capsuleResult;
  }
  const result = await analyzeActivityCapability(snapshot, profile, cloneState, shipTypeId);
  result.bestRoute = snapshot.ship?.ship_type_name || snapshot.ship?.ship_name || result.bestRoute;
  result.showWork = [
    `This score evaluates the active hull only (${result.bestRoute}) for the selected ${profile.label} use profile.`,
    ...result.showWork,
  ];
  for (const cachedKey of currentShipResultCache.keys()) {
    if (cachedKey !== key && cachedKey.startsWith(`${snapshot.characterId}:${shipTypeId}:`)) currentShipResultCache.delete(cachedKey);
  }
  currentShipResultCache.set(key, result);
  return result;
}

export async function analyzeCapabilities(snapshot: any, cloneState: CloneState = "omega"): Promise<CapabilityAnalysis> {
  const key = `${snapshot.characterId}:${snapshot.updatedAt}:${cloneState}`;
  const cached = resultCache.get(key);
  if (cached) return cached;
  const capabilities: CapabilityResult[] = [];
  for (const profile of profiles) {
    capabilities.push(profile.kind === "activity"
      ? await analyzeActivityCapability(snapshot, profile, cloneState)
      : await analyzeSkillCapability(snapshot, profile, cloneState));
  }
  capabilities.sort((a, b) => b.overallPercent - a.overallPercent);
  const topRecommendations = capabilities
    .flatMap((capability) => capability.upgrades.map((upgrade) => ({ capabilityId: capability.id, capability: capability.label, upgrade })))
    .sort((a, b) => b.upgrade.estimatedGain - a.upgrade.estimatedGain || (a.upgrade.estimatedSeconds ?? Infinity) - (b.upgrade.estimatedSeconds ?? Infinity))
    .slice(0, 8);
  const assets = ownedAssets(snapshot);
  const value: CapabilityAnalysis = {
    characterId: snapshot.characterId,
    character: snapshot.character.name,
    generatedAt: new Date().toISOString(),
    capabilities,
    topRecommendations,
    dataSignals: {
      wallet: Number(snapshot.wallet ?? 0),
      ownedShips: asArray(snapshot.extended?.assetSummary?.ownedShips).length,
      modules: assets.filter((asset) => asset.category_id === 7).length,
      blueprints: asArray(snapshot.extended?.blueprints).length,
      savedFittings: asArray(snapshot.extended?.fittings).length,
      activeQueue: asArray(snapshot.queue).length,
    },
  };
  const characterPrefix = `${snapshot.characterId}:`;
  const cloneSuffix = `:${cloneState}`;
  for (const cachedKey of resultCache.keys()) {
    if (cachedKey !== key && cachedKey.startsWith(characterPrefix) && cachedKey.endsWith(cloneSuffix))
      resultCache.delete(cachedKey);
  }
  resultCache.set(key, value);
  return value;
}
