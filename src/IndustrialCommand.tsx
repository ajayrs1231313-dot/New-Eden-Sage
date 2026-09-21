import { useEffect, useMemo, useRef, useState } from "react";
import type { CharacterSnapshot, PlanetaryAlert } from "./types";
import { IndustrialProjectFoundry } from "./IndustrialProjectFoundry";
import { InventionIntelligence } from "./InventionIntelligence";
import industrialBanner from "./fitter-assets/misty-teal-orbital-shipyard-hangar.webp";
import "./invention-lab.css";
import "./industrial-command.css";

type IndustrialTab = "overview" | "foundry" | "opportunities" | "jobs" | "refinery" | "moon-goo" | "production" | "materials" | "blueprints" | "structures";
type MoonGooTab = "materials" | "reactions";
type FoundryTab = "projects" | "blueprints" | "materials" | "research";

type BlueprintRecord = {
  item_id?: number;
  type_id?: number;
  location_id?: number;
  location_flag?: string;
  quantity?: number;
  material_efficiency?: number;
  time_efficiency?: number;
  runs?: number;
  lpStoreTarget?: boolean;
};

type IndustryJobRecord = {
  job_id?: number;
  activity_id?: number;
  blueprint_type_id?: number;
  product_type_id?: number;
  blueprint_location_id?: number;
  output_location_id?: number;
  facility_id?: number;
  installer_id?: number;
  runs?: number;
  cost?: number;
  status?: string;
  start_date?: string;
  end_date?: string;
  completed_date?: string;
  successful_runs?: number;
};

type EnrichedAsset = {
  item_id?: number;
  type_id?: number;
  category_id?: number;
  item?: string;
  quantity?: number;
  location_id?: number;
  location_type?: string;
  root_location_id?: number;
  container_item_id?: number | null;
  station?: string | null;
  system?: string | null;
  location_flag?: string;
  estimatedValue?: number;
};

type AssetNameRecord = { item_id?: number; name?: string };

type MaterialTypeMetadata = {
  categoryId: number;
  categoryName: string;
  groupId: number;
  groupName: string;
  marketGroupName: string;
};

const tabs: Array<{ id: IndustrialTab; label: string }> = [
  { id: "overview", label: "Industrial Overview" },
  { id: "foundry", label: "Project Foundry" },
  { id: "opportunities", label: "Industrial Opportunities" },
  { id: "jobs", label: "Industry Jobs" },
  { id: "refinery", label: "Refinery" },
  { id: "moon-goo", label: "Moon Goo" },
  { id: "materials", label: "Materials & Stock" },
  { id: "blueprints", label: "Blueprints" },
  { id: "structures", label: "Structures" },
];

const activityNames: Record<number, string> = {
  1: "Manufacturing",
  3: "TE Research",
  4: "ME Research",
  5: "Copying",
  7: "Reverse Engineering",
  8: "Invention",
  9: "Reactions",
  11: "Reactions",
};

function number(value: number) {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);
}

function isk(value: number) {
  return `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value)} ISK`;
}

function isArray<T>(value: unknown): value is T[] {
  return Array.isArray(value);
}

function sourceUnavailable(value: unknown) {
  return Boolean(value && typeof value === "object" && "unavailable" in value);
}

type AssetSharingPreferences = { enabled: boolean; characterIds: string[] };
const ASSET_SHARING_STORAGE_KEY = "new-eden-sage-industrial-asset-sharing-v1";
const LP_STORE_INDUSTRY_HANDOFF_KEY = "new-eden-sage-lp-industry-handoff-v1";
const INDUSTRIAL_SELECTION_STORAGE_KEY = "new-eden-sage-industrial-selection-v1";

function loadIndustrialSelection(fallback: string[]) {
  try {
    const parsed = JSON.parse(localStorage.getItem(INDUSTRIAL_SELECTION_STORAGE_KEY) ?? "null");
    return Array.isArray(parsed) ? parsed.map(String) : fallback;
  } catch {
    return fallback;
  }
}

function compactSkillPoints(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M SP`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K SP`;
  return `${number(value)} SP`;
}

function compactIsk(value: number) {
  const amount = Math.abs(value);
  if (amount >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B ISK`;
  if (amount >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M ISK`;
  if (amount >= 1_000) return `${(value / 1_000).toFixed(0)}K ISK`;
  return `${number(value)} ISK`;
}

function characterRole(snapshot: CharacterSnapshot) {
  const byName = new Map(snapshot.skills.skills.map((skill) => [skill.name.toLowerCase(), skill]));
  const level = (name: string) => Number(byName.get(name.toLowerCase())?.trained_skill_level ?? 0);
  const lowerName = snapshot.character.name.toLowerCase();

  // Prefer clear specialist signatures over raw SP totals. Mature characters often
  // have substantial mining, hauling and combat cross-training, so summing every
  // related skill tends to mislabel generalists.
  if (lowerName.includes("hulk")) return "Mining";
  if (
    (level("Advanced Mass Production") >= 3 && level("Mass Production") >= 4) ||
    (level("Advanced Industry") >= 4 && level("Industry") >= 5 && level("Laboratory Operation") >= 4)
  ) return "Industrial / Trade";
  if (level("Transport Ships") >= 3 && ["Amarr Hauler", "Caldari Hauler", "Gallente Hauler", "Minmatar Hauler"].some((skill) => level(skill) >= 5)) return "Logistics";
  if (
    level("Advanced Weapon Upgrades") >= 4 ||
    level("Heavy Assault Cruisers") >= 3 ||
    level("Strategic Cruiser") >= 3 ||
    level("Drone Interfacing") >= 5
  ) return "Combat / Exploration";
  if (level("Exhumers") >= 3 || (level("Mining Barge") >= 4 && level("Astrogeology") >= 4)) return "Mining";

  const scores = { mining: 0, logistics: 0, industry: 0, combat: 0 };
  for (const skill of snapshot.skills.skills) {
    const name = skill.name.toLowerCase();
    const sp = Math.max(1, Number(skill.skillpoints_in_skill ?? 0));
    const includes = (...terms: string[]) => terms.some((term) => name.includes(term));
    if (includes("mining", "exhumer", "resource processing", "reprocessing", "astrogeology", "ice harvesting", "gas cloud harvesting", "deep core")) scores.mining += sp;
    if (includes("transport ships", "hauler", "freighter", "jump freighter")) scores.logistics += sp * 2.2;
    if (includes("trade", "production", "industry", "industrial ship construction", "mass production", "laboratory operation", "supply chain management", "accounting", "broker relations", "contracting", "invention")) scores.industry += sp * 1.6;
    if (includes("gunnery", "missile", "drone", "armor", "shield", "targeting", "electronic warfare", "scanning", "astrometric", "assault cruiser", "strategic cruiser")) scores.combat += sp;
  }
  const ranked = (Object.entries(scores) as Array<[keyof typeof scores, number]>).sort((a, b) => b[1] - a[1]);
  if (!ranked[0] || ranked[0][1] <= 0) return "Capsuleer";
  if (ranked[0][0] === "mining") return "Mining";
  if (ranked[0][0] === "logistics") return "Logistics";
  if (ranked[0][0] === "industry") return "Industrial / Trade";
  return "Combat / Exploration";
}

function relativeIndustrialTime(value?: string) {
  if (!value) return "--";
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function loadAssetSharingPreferences(): AssetSharingPreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(ASSET_SHARING_STORAGE_KEY) ?? "null") as Partial<AssetSharingPreferences> | null;
    return {
      enabled: Boolean(parsed?.enabled),
      characterIds: Array.isArray(parsed?.characterIds) ? parsed!.characterIds!.map(String) : [],
    };
  } catch {
    return { enabled: false, characterIds: [] };
  }
}

export function IndustrialCommand({
  snapshots,
  activeCharacterId,
  active: workspaceActive,
  marketDataRevision = 0,
  onSelectCharacter,
  onSelectionCountChange,
}: {
  snapshots: CharacterSnapshot[];
  activeCharacterId?: string;
  active: boolean;
  marketDataRevision?: number;
  onSelectCharacter(characterId: string): void;
  onSelectionCountChange?(count: number): void;
}) {
  const [tab, setTab] = useState<IndustrialTab>("overview");
  const [foundryTab, setFoundryTab] = useState<FoundryTab>("projects");
  const [moonGooTab, setMoonGooTab] = useState<MoonGooTab>("materials");
  const [blueprintFilter, setBlueprintFilter] = useState("");
  const [blueprintLibraryScope, setBlueprintLibraryScope] = useState<"personal" | "corporation">("personal");
  const [materialFilter, setMaterialFilter] = useState("");
  const [materialCategoryFilter, setMaterialCategoryFilter] = useState("all");
  const [jobScopeFilter, setJobScopeFilter] = useState<"all" | "solo" | "corporation">("all");
  const [jobStatusFilter, setJobStatusFilter] = useState<"all" | "active" | "history">("all");
  const [assetSharing, setAssetSharing] = useState<AssetSharingPreferences>(loadAssetSharingPreferences);
  const defaultSelection = [...new Set([activeCharacterId, ...snapshots.map((snapshot) => snapshot.characterId)].filter(Boolean) as string[])].slice(0, 3);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>(() => loadIndustrialSelection(defaultSelection));
  const [characterSearch, setCharacterSearch] = useState("");
  const [showOnlySelected, setShowOnlySelected] = useState(false);
  const [typeNames, setTypeNames] = useState<Record<number, string>>({});
  const [typeMetadata, setTypeMetadata] = useState<Record<number, MaterialTypeMetadata>>({});
  const [blueprintMaterialTypeIds, setBlueprintMaterialTypeIds] = useState<number[]>([]);
  const [materialIconRevision, setMaterialIconRevision] = useState(0);
  const [locationNames, setLocationNames] = useState<Record<number, string>>({});
  const [selectedBlueprintIndex, setSelectedBlueprintIndex] = useState(0);
  const [lpStoreBlueprintTarget, setLpStoreBlueprintTarget] = useState<BlueprintRecord | null>(null);
  const [targetQuantity, setTargetQuantity] = useState(1);
  const [manufacturingPlan, setManufacturingPlan] = useState<any>(null);
  const [manufacturingStatus, setManufacturingStatus] = useState("Choose a blueprint and output quantity.");
  const [blueprintActivities, setBlueprintActivities] = useState<any>(null);
  const [activityStatus, setActivityStatus] = useState("Choose an owned blueprint to inspect CCP activity data.");
  const [inventionAnalysis, setInventionAnalysis] = useState<any>(null);
  const [inventionBusy, setInventionBusy] = useState(false);
  const [inventionStatus, setInventionStatus] = useState("Open Research & Invention to rank the complete invention catalogue.");
  const [inventionDecryptor, setInventionDecryptor] = useState("");
  const inventionBuildKeyRef = useRef<string | null>(null);
  const inventionRequestSequence = useRef(0);
  const preparedCharacterRef = useRef<string | null>(null);
  const industrialBuildKeyRef = useRef<string | null>(null);
  const [systemCostIndex, setSystemCostIndex] = useState<any>(null);
  const [systemCostStatus, setSystemCostStatus] = useState("Current-system cost index not loaded.");
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [opportunityBusy, setOpportunityBusy] = useState(false);
  const [opportunityStatus, setOpportunityStatus] = useState("Industrial opportunities use server-prepared public market data with local character data.");
  const [opportunityPreparedFor, setOpportunityPreparedFor] = useState("");
  const [opportunitySystem, setOpportunitySystem] = useState("");
  const [opportunityJumpRadius, setOpportunityJumpRadius] = useState<5 | 10 | 20 | null>(null);
  const [opportunitySecurity, setOpportunitySecurity] = useState({ high: true, low: true, null: true });
  const [refineryFacility, setRefineryFacility] = useState<"npc" | "athanor" | "tatara">("athanor");
  const [refineryRig, setRefineryRig] = useState<"none" | "t1" | "t2">("t2");
  const [refinerySecurity, setRefinerySecurity] = useState<"high" | "low" | "null">("high");
  const [refineryImplant, setRefineryImplant] = useState<"none" | "rx801" | "rx802" | "rx804">("none");
  const [refineryResult, setRefineryResult] = useState<any>(null);
  const [refineryBusy, setRefineryBusy] = useState(false);
  const [refineryStatus, setRefineryStatus] = useState("Choose a facility profile, then analyse the selected ore stock pool.");
  const [refineryFilter, setRefineryFilter] = useState("");
  const [refineryCatalogue, setRefineryCatalogue] = useState<any[]>([]);
  const [refineryInputMode, setRefineryInputMode] = useState<"stock" | "manual">("stock");
  const [manualRefineryTypeId, setManualRefineryTypeId] = useState(0);
  const [manualRefineryQuantity, setManualRefineryQuantity] = useState(100);
  const [manualRefineryStock, setManualRefineryStock] = useState<Array<{ typeId: number; quantity: number }>>([]);
  const [reactionCatalogue, setReactionCatalogue] = useState<any>(null);
  const [reactionBlueprintTypeId, setReactionBlueprintTypeId] = useState(0);
  const [reactionRuns, setReactionRuns] = useState(1);
  const [reactionPlan, setReactionPlan] = useState<any>(null);
  const [reactionBusy, setReactionBusy] = useState(false);
  const [reactionStatus, setReactionStatus] = useState("Choose a reaction formula and run count.");
  const [moonFoundryProjects, setMoonFoundryProjects] = useState<any[]>([]);
  const [planetaryAttention, setPlanetaryAttention] = useState<PlanetaryAlert[]>([]);
  const [planetaryAttentionReady, setPlanetaryAttentionReady] = useState(false);
  const planetaryAttentionBuildKeyRef = useRef<string | null>(null);
  const active = snapshots.find((item) => item.characterId === activeCharacterId) ?? snapshots[0];

  const blueprintMaterialTypeIdSet = useMemo(() => new Set(blueprintMaterialTypeIds), [blueprintMaterialTypeIds]);
  const materialTypeIdsForCache = useMemo(() => [...new Set(snapshots.flatMap((snapshot) =>
    (Array.isArray(snapshot.extended?.assets) ? snapshot.extended!.assets! : [])
      .map((asset: any) => Number(asset?.type_id ?? 0))
      .filter((typeId: number) => typeId > 0 && blueprintMaterialTypeIdSet.has(typeId)),
  ))].sort((a, b) => a - b), [snapshots, blueprintMaterialTypeIdSet]);
  const materialTypeCacheKey = materialTypeIdsForCache.join(",");

  useEffect(() => {
    if (!workspaceActive || !materialTypeIdsForCache.length) return;
    let cancelled = false;
    void window.sage.cacheTypeIcons({ typeIds: materialTypeIdsForCache, size: 64 }).then(() => {
      if (!cancelled) setMaterialIconRevision((value) => value + 1);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [workspaceActive, materialTypeCacheKey]);

  useEffect(() => {
    const typeIds: number[] = [...new Set<number>((Array.isArray(refineryResult?.stacks) ? refineryResult.stacks : [])
      .map((stack: any) => Number(stack?.typeId ?? 0))
      .filter((typeId: number) => typeId > 0))];
    if (!workspaceActive || !typeIds.length) return;
    void window.sage.cacheTypeIcons({ typeIds, size: 64 }).catch(() => undefined);
  }, [workspaceActive, refineryResult]);


  useEffect(() => {
    const handleIndustrialSection = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: IndustrialTab; foundryTab?: FoundryTab }>).detail ?? {};
      if (detail.tab) setTab(detail.tab);
      if (detail.foundryTab) setFoundryTab(detail.foundryTab);
    };
    window.addEventListener("sage:industrial-section", handleIndustrialSection as EventListener);
    return () => window.removeEventListener("sage:industrial-section", handleIndustrialSection as EventListener);
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("sage:industrial-section-changed", { detail: { tab, foundryTab: tab === "foundry" ? foundryTab : undefined } }));
  }, [tab, foundryTab]);

  useEffect(() => {
    const validIds = new Set(snapshots.map((snapshot) => String(snapshot.characterId)));
    setSelectedCharacterIds((current) => {
      const valid = current.filter((id) => validIds.has(String(id)));
      if (valid.length || !snapshots.length) return valid;
      return [...new Set([activeCharacterId, ...snapshots.map((snapshot) => snapshot.characterId)].filter(Boolean) as string[])].slice(0, 3);
    });
  }, [snapshots, activeCharacterId]);
  useEffect(() => {
    if (!workspaceActive || !active?.characterId) return;
    const hasPlanetaryData = snapshots.some((snapshot) => Array.isArray((snapshot.extended as any)?.planets) && (snapshot.extended as any).planets.length > 0);
    if (!hasPlanetaryData) {
      setPlanetaryAttention([]);
      setPlanetaryAttentionReady(true);
      return;
    }
    const buildKey = snapshots.map((snapshot) => `${snapshot.characterId}:${snapshot.updatedAt ?? ""}`).join("|");
    if (planetaryAttentionBuildKeyRef.current === buildKey) return;
    planetaryAttentionBuildKeyRef.current = buildKey;
    let cancelled = false;
    setPlanetaryAttentionReady(false);
    void window.sage.getPlanetaryRevenue({ characterId: active.characterId }).then((analysis) => {
      if (cancelled) return;
      setPlanetaryAttention(Array.isArray(analysis?.empire?.alerts) ? analysis.empire.alerts : Array.isArray(analysis?.alerts) ? analysis.alerts : []);
      setPlanetaryAttentionReady(true);
    }).catch(() => {
      if (cancelled) return;
      planetaryAttentionBuildKeyRef.current = null;
      setPlanetaryAttention([]);
      setPlanetaryAttentionReady(true);
    });
    return () => { cancelled = true; };
  }, [workspaceActive, active?.characterId, snapshots]);

  useEffect(() => {
    localStorage.setItem(INDUSTRIAL_SELECTION_STORAGE_KEY, JSON.stringify(selectedCharacterIds));
    onSelectionCountChange?.(selectedCharacterIds.length);
    setAssetSharing((current) => {
      const nextIds = [...selectedCharacterIds];
      if (current.characterIds.length === nextIds.length && current.characterIds.every((id, index) => id === nextIds[index])) return current;
      return { ...current, characterIds: nextIds };
    });
  }, [selectedCharacterIds, onSelectionCountChange]);

  useEffect(() => {
    const validIds = new Set(snapshots.map((snapshot) => String(snapshot.characterId)));
    setAssetSharing((current) => {
      const characterIds = current.characterIds.filter((id) => validIds.has(id));
      return characterIds.length === current.characterIds.length ? current : { ...current, characterIds };
    });
  }, [snapshots]);
  useEffect(() => {
    localStorage.setItem(ASSET_SHARING_STORAGE_KEY, JSON.stringify(assetSharing));
    setManufacturingPlan(null);
    setRefineryResult(null);
    setReactionPlan(null);
  }, [assetSharing]);
  useEffect(() => {
    setRefineryResult(null);
    setRefineryStatus("Facility profile changed. Analyse the stock pool to refresh refinery values.");
  }, [active?.characterId, refineryFacility, refineryRig, refinerySecurity, refineryImplant]);
  useEffect(() => {
    const needsRefineryCatalogue = tab === "refinery" || (tab === "moon-goo" && moonGooTab === "materials");
    if (!needsRefineryCatalogue || refineryCatalogue.length) return;
    let cancelled = false;
    setRefineryStatus("Loading CCP refinery resource catalogue...");
    void window.sage.getRefineryCatalogue().then((catalogue) => {
      if (cancelled) return;
      const items = Array.isArray(catalogue) ? catalogue : [];
      setRefineryCatalogue(items);
      if (items.length) setManualRefineryTypeId((current) => current || Number(items[0].typeId));
      setRefineryStatus(items.length ? "Choose synced stock or build a manual ore selection, then analyse." : "No CCP refinery resource catalogue is available.");
    }).catch((error) => { if (!cancelled) setRefineryStatus(error instanceof Error ? error.message : "Refinery catalogue could not be loaded."); });
    return () => { cancelled = true; };
  }, [tab, moonGooTab, refineryCatalogue.length]);
  useEffect(() => {
    if (tab !== "moon-goo" || moonGooTab !== "reactions" || reactionCatalogue?.formulas?.length) return;
    let cancelled = false;
    setReactionStatus("Loading CCP reaction formulas and moon-material catalogue...");
    void window.sage.getReactionCatalogue().then((catalogue) => {
      if (cancelled) return;
      setReactionCatalogue(catalogue);
      const first = Array.isArray(catalogue?.formulas) ? catalogue.formulas[0] : null;
      if (first) setReactionBlueprintTypeId((current) => current || Number(first.blueprintTypeId));
      setReactionStatus(first ? "Choose a reaction formula and run count." : "No reaction formulas are available in the current CCP SDE.");
    }).catch((error) => { if (!cancelled) setReactionStatus(error instanceof Error ? error.message : "Reaction catalogue could not be loaded."); });
    return () => { cancelled = true; };
  }, [tab, moonGooTab, reactionCatalogue?.formulas?.length]);
  useEffect(() => {
    if (tab !== "moon-goo" || !active?.characterId) return;
    let cancelled = false;
    void window.sage.getFoundryProjects({ characterId: active.characterId }).then((projects: any[]) => {
      if (!cancelled) setMoonFoundryProjects(Array.isArray(projects) ? projects : []);
    }).catch(() => { if (!cancelled) setMoonFoundryProjects([]); });
    return () => { cancelled = true; };
  }, [tab, active?.characterId, active?.updatedAt]);

  const industrial = useMemo(() => {
    const characters = snapshots.map((snapshot) => {
      const extended = snapshot.extended as any;
      const blueprints: BlueprintRecord[] = isArray<BlueprintRecord>(extended?.blueprints) ? extended.blueprints : [];
      const jobs: IndustryJobRecord[] = isArray<IndustryJobRecord>(extended?.industryJobs) ? extended.industryJobs : [];
      const assets: EnrichedAsset[] = isArray<EnrichedAsset>(extended?.assets) ? extended.assets : [];
      const corpBlueprints: BlueprintRecord[] = isArray<BlueprintRecord>(extended?.corporation?.blueprints)
        ? extended.corporation.blueprints
        : [];
      const corpJobs: IndustryJobRecord[] = isArray<IndustryJobRecord>(extended?.corporation?.industryJobs)
        ? extended.corporation.industryJobs
        : [];
      const corpAssets: EnrichedAsset[] = isArray<EnrichedAsset>(extended?.corporation?.assets)
        ? extended.corporation.assets
        : [];
      const corpAssetNames: AssetNameRecord[] = isArray<AssetNameRecord>(extended?.corporation?.assetNames)
        ? extended.corporation.assetNames
        : [];
      const corpStructures: any[] = isArray<any>(extended?.corporation?.structures)
        ? extended.corporation.structures
        : [];
      const facilities: any[] = isArray<any>(extended?.corporation?.facilities)
        ? extended.corporation.facilities
        : [];
      return {
        snapshot,
        blueprints,
        jobs,
        assets,
        corpBlueprints,
        corpJobs,
        corpAssets,
        corpAssetNames,
        corpStructures,
        facilities,
        blueprintUnavailable: sourceUnavailable(extended?.blueprints),
        corpBlueprintUnavailable: sourceUnavailable(extended?.corporation?.blueprints),
        jobsUnavailable: sourceUnavailable(extended?.industryJobs),
        corpJobsUnavailable: sourceUnavailable(extended?.corporation?.industryJobs),
      };
    });
    return characters;
  }, [snapshots]);

  useEffect(() => {
    const typeIds = [...new Set(
      industrial.flatMap((item) => [
        ...item.blueprints.map((blueprint) => blueprint.type_id),
        ...item.corpBlueprints.map((blueprint) => blueprint.type_id),
        ...item.jobs.flatMap((job) => [job.blueprint_type_id, job.product_type_id]),
        ...item.corpJobs.flatMap((job) => [job.blueprint_type_id, job.product_type_id]),
      ]).filter((typeId): typeId is number => typeof typeId === "number" && typeId > 0 && !typeNames[typeId]),
    )];
    if (!typeIds.length) return;
    window.sage.resolveTypeIds(typeIds).then((resolved) => {
      setTypeNames((current) => ({
        ...current,
        ...Object.fromEntries(resolved.map((item) => [item.id, item.name])),
      }));
    }).catch(() => undefined);
  }, [industrial, typeNames]);

  useEffect(() => {
    const stationIds = [...new Set(industrial.flatMap((item) => [
      ...item.blueprints.map((blueprint) => blueprint.location_id),
      ...item.corpBlueprints.map((blueprint) => blueprint.location_id),
      ...item.assets.map((asset) => asset.root_location_id ?? asset.location_id),
      ...item.corpAssets.map((asset) => asset.root_location_id ?? asset.location_id),
    ]).map(Number).filter((id) => Number.isSafeInteger(id) && id >= 60_000_000 && id < 64_000_000 && !locationNames[id]))];
    if (!stationIds.length) return;
    window.sage.resolveTypeIds(stationIds).then((resolved) => {
      setLocationNames((current) => ({ ...current, ...Object.fromEntries(resolved.map((item) => [item.id, item.name])) }));
    }).catch(() => undefined);
  }, [industrial, locationNames]);

  useEffect(() => {
    let cancelled = false;
    if (!workspaceActive || !active?.characterId) return () => { cancelled = true; };
    const characterChanged = preparedCharacterRef.current !== active.characterId;
    if (characterChanged) {
      preparedCharacterRef.current = active.characterId;
      industrialBuildKeyRef.current = null;
      setSelectedBlueprintIndex(0);
      setManufacturingPlan(null);
      setManufacturingStatus("Choose a blueprint and output quantity.");
      setBlueprintActivities(null);
      setActivityStatus("Choose an owned blueprint to inspect CCP activity data.");
      setInventionAnalysis(null);
      setInventionStatus("Open Research & Invention to rank the complete invention catalogue.");
      inventionBuildKeyRef.current = null;
      inventionRequestSequence.current += 1;
      setOpportunitySystem("");
      setOpportunityJumpRadius(null);
      setOpportunityPreparedFor("");
      setOpportunities([]);
      setSystemCostIndex(null);
    }
    const buildKey = `${active.characterId}|${active.updatedAt ?? ""}`;
    const applyPrepared = (prepared: any) => {
      const previous = prepared?.pageState?.source === "last-known-good";
      if (Array.isArray(prepared?.opportunities)) {
        setOpportunities(prepared.opportunities);
        setOpportunityStatus(previous
          ? `${prepared.opportunities.length} previous coherent industrial opportunities are shown while Sage prepares the current character/market revision.`
          : prepared.opportunityStatus ?? ("Prepared " + prepared.opportunities.length + " industrial opportunities."));
      } else {
        setOpportunityStatus("No prepared Industrial Opportunities result is available yet. Building the current workspace from local character data and the installed market generation...");
      }
      if (prepared?.typeNames) setTypeNames((current) => ({ ...current, ...prepared.typeNames }));
      if (prepared?.typeMetadata) setTypeMetadata((current) => ({ ...current, ...prepared.typeMetadata }));
      if (Array.isArray(prepared?.blueprintMaterialTypeIds)) setBlueprintMaterialTypeIds(prepared.blueprintMaterialTypeIds.map(Number).filter((typeId: number) => typeId > 0));
      if (prepared?.systemCostIndex !== undefined) setSystemCostIndex(prepared.systemCostIndex ?? null);
      setSystemCostStatus(prepared?.systemCostIndex?.available
        ? (previous ? "Previous current-system industry indices are shown while the current revision prepares." : "Current-system industry indices are prepared.")
        : "No prepared current-system cost index is available.");
      return previous;
    };
    void window.sage.getPreparedIndustrialCommand({ characterId: active.characterId }).then((prepared) => {
      if (cancelled) return;
      const previous = applyPrepared(prepared);
      if ((previous || !Array.isArray(prepared?.opportunities)) && industrialBuildKeyRef.current !== buildKey) {
        industrialBuildKeyRef.current = buildKey;
        void window.sage.prepareIndustrialCommand({ characterId: active.characterId }).then((current) => {
          if (cancelled) return;
          applyPrepared(current);
        }).catch((error) => {
          if (cancelled) return;
          industrialBuildKeyRef.current = null;
          const message = error instanceof Error ? error.message : "Current Industrial Command preparation failed.";
          setOpportunityStatus((current) => `${current} ${message}`.trim());
        });
      } else if (!previous && Array.isArray(prepared?.opportunities)) {
        industrialBuildKeyRef.current = buildKey;
      }
    }).catch((error) => {
      if (cancelled) return;
      industrialBuildKeyRef.current = null;
      setOpportunityStatus(error instanceof Error ? error.message : "Prepared Industrial Command data could not be read.");
    });
    return () => { cancelled = true; };
  }, [workspaceActive, active?.characterId, active?.updatedAt]);

  useEffect(() => {
    if (!workspaceActive || tab !== "foundry" || foundryTab !== "research" || !active?.characterId) return;
    const inventionBuildKey = `${active.characterId}|${active.updatedAt ?? ""}|${marketDataRevision}|${inventionDecryptor || "none"}`;
    if (inventionAnalysis && inventionBuildKeyRef.current === inventionBuildKey) return;
    if (inventionBuildKeyRef.current === inventionBuildKey && inventionBusy) return;
    inventionBuildKeyRef.current = inventionBuildKey;
    void loadInventionIntelligence(inventionDecryptor, inventionBuildKey);
  }, [workspaceActive, tab, foundryTab, active?.characterId, active?.updatedAt, marketDataRevision, inventionDecryptor]);

  useEffect(() => {
    if (!active?.characterId) return;
    const raw = sessionStorage.getItem(LP_STORE_INDUSTRY_HANDOFF_KEY);
    if (!raw) return;
    try {
      const pending = JSON.parse(raw) as { characterId?: string; blueprintTypeId?: number; targetQuantity?: number };
      if (String(pending.characterId ?? "") !== String(active.characterId)) return;
      const blueprintTypeId = Number(pending.blueprintTypeId ?? 0);
      if (!(blueprintTypeId > 0)) return;
      setLpStoreBlueprintTarget({ type_id: blueprintTypeId, material_efficiency: 0, time_efficiency: 0, lpStoreTarget: true });
      setBlueprintLibraryScope("personal");
      setSelectedBlueprintIndex(0);
      setTargetQuantity(Math.max(1, Math.floor(Number(pending.targetQuantity ?? 1) || 1)));
      setManufacturingPlan(null);
      setManufacturingStatus("LP Store BPC target loaded. If the redeemed copy is not in assets yet, Sage plans it at ME 0 / TE 0 without inventing copy-run metadata.");
      setFoundryTab("projects");
      setTab("foundry");
      sessionStorage.removeItem(LP_STORE_INDUSTRY_HANDOFF_KEY);
    } catch {
      sessionStorage.removeItem(LP_STORE_INDUSTRY_HANDOFF_KEY);
    }
  }, [active?.characterId]);

  if (!active) {
    return (
      <section className="industrial-command industrial-empty">
        <p className="eyebrow">INDUSTRIAL COMMAND</p>
        <h2>Connect a character to initialise industry intelligence</h2>
        <p>Sage will keep each character&apos;s blueprints, jobs and assets separately identified.</p>
      </section>
    );
  }

  const activeData = industrial.find((item) => item.snapshot.characterId === active.characterId)!;
  const corporationJobIds = new Set(activeData.corpJobs.map((job) => Number(job.job_id ?? 0)).filter((id) => id > 0));
  const activeJobLedger = [
    ...activeData.corpJobs.map((job) => ({ job, scope: "corporation" as const })),
    ...activeData.jobs.filter((job) => !corporationJobIds.has(Number(job.job_id ?? 0))).map((job) => ({ job, scope: "solo" as const })),
  ].sort((a, b) => {
    const aTime = new Date(a.job.completed_date ?? a.job.end_date ?? a.job.start_date ?? 0).getTime();
    const bTime = new Date(b.job.completed_date ?? b.job.end_date ?? b.job.start_date ?? 0).getTime();
    return bTime - aTime;
  });
  const activeLedgerCount = activeJobLedger.filter(({ job }) => !["delivered", "cancelled", "reverted"].includes(String(job.status ?? "").toLowerCase())).length;
  const soloLedgerCount = activeJobLedger.filter((entry) => entry.scope === "solo").length;
  const corporationLedgerCount = activeJobLedger.filter((entry) => entry.scope === "corporation").length;
  const filteredJobLedger = activeJobLedger.filter((entry) => {
    if (jobScopeFilter !== "all" && entry.scope !== jobScopeFilter) return false;
    const status = String(entry.job.status ?? "unknown").toLowerCase();
    const isHistory = ["delivered", "cancelled", "reverted"].includes(status);
    if (jobStatusFilter === "active" && isHistory) return false;
    if (jobStatusFilter === "history" && !isHistory) return false;
    return true;
  });
  const selectedCharacterIdSet = new Set(selectedCharacterIds.map(String));
  const selectedIndustrial = industrial.filter((item) => selectedCharacterIdSet.has(String(item.snapshot.characterId)));
  const selectedBlueprints = selectedIndustrial.flatMap((item) => item.blueprints);
  const selectedJobs = selectedIndustrial.flatMap((item) => item.jobs.map((job) => ({ job, owner: item.snapshot })));
  const selectedActiveJobs = selectedJobs.filter(({ job }) => !["delivered", "cancelled", "reverted"].includes(job.status ?? ""));
  const now = Date.now();
  const completedIndustryJobs = selectedJobs.filter(({ job }) => {
    const status = String(job.status ?? "").toLowerCase();
    const end = job.end_date ? new Date(job.end_date).getTime() : 0;
    return status === "ready" || (status === "active" && end > 0 && end <= now);
  });
  const selectedPlanetaryAlerts = planetaryAttention
    .filter((alert) => selectedCharacterIdSet.has(String(alert.characterId)))
    .filter((alert) => ["critical", "warning"].includes(alert.severity))
    .filter((alert) => alert.type !== "unused-colony-slot")
    .sort((a, b) => {
      const severity = (value: PlanetaryAlert["severity"]) => value === "critical" ? 0 : value === "warning" ? 1 : 2;
      return severity(a.severity) - severity(b.severity) || Number(a.hoursUntil ?? Number.POSITIVE_INFINITY) - Number(b.hoursUntil ?? Number.POSITIVE_INFINITY);
    });
  const industrialNeedsActionTotal = completedIndustryJobs.length + selectedPlanetaryAlerts.length;
  const industrialNeedsAction = [
    ...(completedIndustryJobs.length ? [{
      id: "industry-delivery",
      tone: "critical" as const,
      category: "INDUSTRY",
      title: `${completedIndustryJobs.length} industry job${completedIndustryJobs.length === 1 ? "" : "s"} ready for delivery`,
      detail: [...new Set(completedIndustryJobs.map(({ owner }) => owner.character.name))].join(" · "),
      action: "jobs" as const,
    }] : []),
    ...selectedPlanetaryAlerts.slice(0, 4).map((alert) => ({
      id: alert.id,
      tone: alert.severity === "critical" ? "critical" as const : "warning" as const,
      category: "PI",
      title: alert.type === "storage-full"
        ? "PI storage needs pickup"
        : alert.type === "extractor-expired"
          ? "Restart expired PI extractor"
          : alert.type === "extractor-expiring"
            ? "PI extractor expires soon"
            : alert.type === "input-low"
              ? "PI factory needs inputs"
              : "PI colony needs attention",
      detail: `${alert.characterName} · ${alert.planetLabel} · ${alert.message}`,
      action: "pi" as const,
    })),
  ].slice(0, 4);
  const selectedJobCost = selectedActiveJobs.reduce((total, { job }) => total + (job.cost ?? 0), 0);
  const selectedAssetStacks = selectedIndustrial.reduce((total, item) => total + item.assets.filter((asset) => (asset.quantity ?? 0) > 0).length, 0);
  const selectedBlueprintTypeCount = new Set(selectedBlueprints.map((blueprint) => blueprint.type_id).filter(Boolean)).size;
  const selectedMaterialUnits = selectedIndustrial.reduce((total, item) => total + item.assets.reduce((sum, asset) => sum + Math.max(0, Number(asset.quantity ?? 0)), 0), 0);
  const selectedLocations = (() => {
    const locations = new Map<string, { location: string; items: number; estimatedValue: number }>();
    for (const item of selectedIndustrial) {
      for (const asset of item.assets) {
        const location = String(asset.station ?? asset.system ?? asset.location_flag ?? "Unknown location");
        const current = locations.get(location) ?? { location, items: 0, estimatedValue: 0 };
        current.items += Math.max(0, Number(asset.quantity ?? 0));
        current.estimatedValue += Math.max(0, Number(asset.estimatedValue ?? 0));
        locations.set(location, current);
      }
    }
    return [...locations.values()].sort((a, b) => b.estimatedValue - a.estimatedValue || b.items - a.items);
  })();
  const recentIndustryActivity = [...selectedJobs].sort((a, b) => {
    const aTime = new Date(a.job.completed_date ?? a.job.start_date ?? a.job.end_date ?? 0).getTime();
    const bTime = new Date(b.job.completed_date ?? b.job.start_date ?? b.job.end_date ?? 0).getTime();
    return bTime - aTime;
  }).slice(0, 5);
  const visibleCharacterSnapshots = snapshots.filter((snapshot) => {
    if (showOnlySelected && !selectedCharacterIdSet.has(String(snapshot.characterId))) return false;
    const query = characterSearch.trim().toLowerCase();
    if (!query) return true;
    return [snapshot.character.name, snapshot.character.corporation_name, characterRole(snapshot)].some((value) => String(value ?? "").toLowerCase().includes(query));
  });
  const selectedFacilities = selectedIndustrial.flatMap((item) => item.facilities.map((facility) => ({ facility, owner: item.snapshot })));

  const sharedCharacterIdSet = new Set(assetSharing.characterIds);
  const materialOwners = assetSharing.enabled
    ? industrial.filter((owner) => sharedCharacterIdSet.has(String(owner.snapshot.characterId)))
    : [activeData];
  const materialInventoryAll = [...materialOwners.flatMap((owner) => owner.assets.map((asset, assetIndex) => ({
    asset,
    characterId: String(owner.snapshot.characterId),
    characterName: owner.snapshot.character.name,
    sourceAssetId: `${owner.snapshot.characterId}:${asset.item_id ?? `stack-${assetIndex}`}`,
  }))).filter((entry) => blueprintMaterialTypeIdSet.has(Number(entry.asset.type_id ?? 0))).reduce((map, entry) => {
    const typeId = Number(entry.asset.type_id ?? 0);
    const key = typeId > 0 ? `type-${typeId}` : `name-${entry.asset.item ?? "unknown"}`;
    const current = map.get(key) ?? {
      typeId,
      categoryId: Number(entry.asset.category_id ?? 0),
      name: entry.asset.item ?? (typeId > 0 ? `Type ${typeId}` : "Unknown item"),
      quantity: 0,
      estimatedValue: 0,
      owners: new Map<string, { characterName: string; quantity: number }>(),
      locations: new Set<string>(),
      sourceAssetIds: new Set<string>(),
    };
    const quantity = Math.max(0, Number(entry.asset.quantity ?? 0));
    current.quantity += quantity;
    current.estimatedValue += Math.max(0, Number(entry.asset.estimatedValue ?? 0));
    const owner = current.owners.get(entry.characterId) ?? { characterName: entry.characterName, quantity: 0 };
    owner.quantity += quantity;
    current.owners.set(entry.characterId, owner);
    current.sourceAssetIds.add(entry.sourceAssetId);
    const location = entry.asset.station ?? entry.asset.system ?? entry.asset.location_flag;
    if (location) current.locations.add(String(location));
    map.set(key, current);
    return map;
  }, new Map<string, { typeId: number; categoryId: number; name: string; quantity: number; estimatedValue: number; owners: Map<string, { characterName: string; quantity: number }>; locations: Set<string>; sourceAssetIds: Set<string> }>()).values()]
    .filter((item) => item.quantity > 0)
    .map((item) => {
      const metadata = typeMetadata[item.typeId];
      return {
        ...item,
        categoryName: metadata?.categoryName && metadata.categoryName !== "Unknown" ? metadata.categoryName : "Other",
        groupName: metadata?.groupName && metadata.groupName !== "Unknown group" ? metadata.groupName : "Unclassified",
        marketGroupName: metadata?.marketGroupName ?? "",
      };
    });

  const materialCategories = [...materialInventoryAll.reduce((map, item) => {
    map.set(item.categoryName, (map.get(item.categoryName) ?? 0) + 1);
    return map;
  }, new Map<string, number>()).entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const materialLocationSummary = (() => {
    const locations = new Map<string, { location: string; items: number; estimatedValue: number }>();
    for (const owner of materialOwners) {
      for (const asset of owner.assets) {
        const typeId = Number(asset.type_id ?? 0);
        const quantity = Math.max(0, Number(asset.quantity ?? 0));
        if (!blueprintMaterialTypeIdSet.has(typeId) || quantity <= 0) continue;
        const location = String(asset.station ?? asset.system ?? asset.location_flag ?? "Unknown location");
        const current = locations.get(location) ?? { location, items: 0, estimatedValue: 0 };
        current.items += quantity;
        current.estimatedValue += Math.max(0, Number(asset.estimatedValue ?? 0));
        locations.set(location, current);
      }
    }
    return [...locations.values()].sort((a, b) => b.estimatedValue - a.estimatedValue || b.items - a.items);
  })();
  const materialStackCount = materialInventoryAll.reduce((sum, item) => sum + item.sourceAssetIds.size, 0);

  const normalizedMaterialFilter = materialFilter.trim().toLowerCase();
  const materialInventory = materialInventoryAll
    .filter((item) => materialCategoryFilter === "all" || item.categoryName === materialCategoryFilter)
    .filter((item) => !normalizedMaterialFilter || [
      item.name,
      item.categoryName,
      item.groupName,
      item.marketGroupName,
      ...[...item.owners.values()].map((owner) => owner.characterName),
      ...item.locations,
    ].some((value) => String(value ?? "").toLowerCase().includes(normalizedMaterialFilter)))
    .sort((a, b) => b.estimatedValue - a.estimatedValue || b.quantity - a.quantity || a.name.localeCompare(b.name));

  const personalPlanningBlueprints = lpStoreBlueprintTarget?.type_id
    ? (() => {
        const matchingOwned = activeData.blueprints.filter((blueprint) => Number(blueprint.type_id) === Number(lpStoreBlueprintTarget.type_id));
        if (matchingOwned.length) return [...matchingOwned, ...activeData.blueprints.filter((blueprint) => Number(blueprint.type_id) !== Number(lpStoreBlueprintTarget.type_id))];
        return [lpStoreBlueprintTarget, ...activeData.blueprints];
      })()
    : activeData.blueprints;
  const planningBlueprints = blueprintLibraryScope === "corporation" ? activeData.corpBlueprints : personalPlanningBlueprints;
  const selectedBlueprint = planningBlueprints[selectedBlueprintIndex] ?? planningBlueprints[0];
  const selectedReactionFormula = (reactionCatalogue?.formulas ?? []).find((formula: any) => Number(formula.blueprintTypeId) === Number(reactionBlueprintTypeId)) ?? reactionCatalogue?.formulas?.[0] ?? null;
  const moonMaterialTypeIds = new Set<number>((reactionCatalogue?.moonMaterialTypeIds ?? []).map(Number));
  const moonGooMap = new Map<number, { typeId: number; name: string; quantity: number; owners: Map<string, { characterName: string; quantity: number }> }>();
  for (const owner of materialOwners) {
    for (const asset of owner.assets) {
      const typeId = Number(asset.type_id ?? 0);
      const quantity = Math.max(0, Math.floor(Number(asset.quantity ?? 0)));
      if (!moonMaterialTypeIds.has(typeId) || quantity <= 0) continue;
      const current = moonGooMap.get(typeId) ?? { typeId, name: asset.item ?? typeNames[typeId] ?? `Type ${typeId}`, quantity: 0, owners: new Map() };
      current.quantity += quantity;
      const held = current.owners.get(String(owner.snapshot.characterId)) ?? { characterName: owner.snapshot.character.name, quantity: 0 };
      held.quantity += quantity;
      current.owners.set(String(owner.snapshot.characterId), held);
      moonGooMap.set(typeId, current);
    }
  }
  const moonGooInventory = [...moonGooMap.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
  const moonInventoryByType = new Map(materialInventory.map((item) => [Number(item.typeId), item] as const));
  const moonProjectDemand = new Map<number, { quantity: number; projects: Set<string> }>();
  for (const project of moonFoundryProjects) {
    if (String(project?.status ?? "") === "archived") continue;
    for (const requirement of Array.isArray(project?.requirements) ? project.requirements : []) {
      const typeId = Number(requirement?.typeId ?? 0);
      const quantity = Math.max(0, Number(requirement?.required ?? 0));
      if (!(typeId > 0) || quantity <= 0) continue;
      const entry = moonProjectDemand.get(typeId) ?? { quantity: 0, projects: new Set<string>() };
      entry.quantity += quantity;
      entry.projects.add(String(project?.name ?? "Foundry project"));
      moonProjectDemand.set(typeId, entry);
    }
  }
  const rawMoonOres = refineryCatalogue.filter((item: any) => item?.kind === "moon");
  const rawMoonOreIds = new Set<number>(rawMoonOres.map((item: any) => Number(item.typeId)));
  const reprocessedMoonIds = new Set<number>(rawMoonOres.flatMap((item: any) => (item.outputs ?? []).map((output: any) => Number(output.typeId))));
  const moonNames = new Map<number, string>();
  for (const ore of rawMoonOres) {
    moonNames.set(Number(ore.typeId), String(ore.name));
    for (const output of ore.outputs ?? []) moonNames.set(Number(output.typeId), String(output.name));
  }
  const reactionUses = new Map<number, Set<string>>();
  const reactionProducts = new Set<number>();
  for (const formula of reactionCatalogue?.formulas ?? []) {
    for (const material of formula.materials ?? []) {
      const typeId = Number(material.typeId);
      moonNames.set(typeId, String(material.name));
      const uses = reactionUses.get(typeId) ?? new Set<string>();
      uses.add(String(formula.productName ?? formula.formulaName ?? "Reaction"));
      reactionUses.set(typeId, uses);
    }
    for (const product of formula.products ?? []) {
      reactionProducts.add(Number(product.typeId));
      moonNames.set(Number(product.typeId), String(product.name));
    }
  }
  const moonIntelTypeIds = new Set<number>([
    ...rawMoonOreIds,
    ...reprocessedMoonIds,
    ...moonMaterialTypeIds,
    ...reactionProducts,
    ...moonProjectDemand.keys(),
  ]);
  const moonIntelRows = [...moonIntelTypeIds].map((typeId) => {
    const inventory = moonInventoryByType.get(typeId);
    const stock = Math.max(0, Number(inventory?.quantity ?? 0));
    const demand = moonProjectDemand.get(typeId);
    const projectDemand = Math.max(0, Number(demand?.quantity ?? 0));
    const rawOre = rawMoonOres.find((item: any) => Number(item.typeId) === typeId);
    const category = rawMoonOreIds.has(typeId)
      ? "Raw moon ore"
      : reprocessedMoonIds.has(typeId)
        ? "Reprocessed moon material"
        : reactionProducts.has(typeId)
          ? "Reaction intermediate"
          : "Moon material";
    return {
      typeId,
      name: moonNames.get(typeId) ?? inventory?.name ?? typeNames[typeId] ?? `Type ${typeId}`,
      category,
      stock,
      estimatedValue: Math.max(0, Number(inventory?.estimatedValue ?? 0)),
      projectDemand,
      deficit: Math.max(0, projectDemand - stock),
      surplus: Math.max(0, stock - projectDemand),
      projects: [...(demand?.projects ?? [])],
      destinations: [...(reactionUses.get(typeId) ?? [])],
      outputs: (rawOre?.outputs ?? []).map((output: any) => `${output.name} × ${number(output.quantity)}`),
    };
  }).filter((row) => row.stock > 0 || row.projectDemand > 0 || row.category === "Raw moon ore" || row.destinations.length > 0)
    .sort((a, b) => b.deficit - a.deficit || b.estimatedValue - a.estimatedValue || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  async function buildManufacturingPlan() {
    if (!selectedBlueprint?.type_id) {
      setManufacturingStatus("Choose a manufacturing blueprint first.");
      return;
    }
    setManufacturingStatus("Expanding CCP manufacturing materials and subtracting owned stock…");
    try {
      const result = await (window.sage as any).getManufacturingPlan({
        characterId: active.characterId,
        blueprintTypeId: selectedBlueprint.type_id,
        materialEfficiency: selectedBlueprint.material_efficiency ?? 0,
        timeEfficiency: selectedBlueprint.time_efficiency ?? 0,
        targetQuantity: Math.max(1, Math.floor(targetQuantity)),
        availableRuns: (selectedBlueprint.runs ?? -1) >= 0 ? selectedBlueprint.runs : undefined,
        includeConnectedStock: assetSharing.enabled,
        sharedCharacterIds: assetSharing.enabled ? assetSharing.characterIds : [],
      });
      setManufacturingPlan(result);
      setManufacturingStatus(result.totalMissingStacks ? `${result.totalMissingStacks} material type(s) still need sourcing.` : "Owned stock covers the complete blueprint bill of materials.");
    } catch (error) {
      setManufacturingPlan(null);
      setManufacturingStatus(error instanceof Error ? error.message : "Manufacturing analysis failed.");
    }
  }
  function addManualRefineryResource() {
    const typeId = Number(manualRefineryTypeId);
    const quantity = Math.max(1, Math.floor(Number(manualRefineryQuantity) || 1));
    if (!(typeId > 0)) {
      setRefineryStatus("Choose an ore, ice or moon-ore type first.");
      return;
    }
    setManualRefineryStock((current) => {
      const existing = current.find((item) => item.typeId === typeId);
      return existing
        ? current.map((item) => item.typeId === typeId ? { ...item, quantity: item.quantity + quantity } : item)
        : [...current, { typeId, quantity }];
    });
    const item = refineryCatalogue.find((entry) => Number(entry.typeId) === typeId);
    setRefineryStatus(`Added ${quantity.toLocaleString()} ${item?.name ?? "resource"} to the manual refinery selection.`);
  }

  async function analyzeRefineryStock() {
    if (refineryInputMode === "manual" && !manualRefineryStock.length) {
      setRefineryStatus("Add at least one ore, ice or moon-ore stack to the manual selection first.");
      return;
    }
    setRefineryBusy(true);
    setRefineryStatus(refineryInputMode === "manual"
      ? "Analysing the manual refinery selection with the active character's skills and retained market prices..."
      : "Reading exact SDE reprocessing outputs, character skills and retained market prices...");
    try {
      const result = await window.sage.getRefineryAnalysis({
        characterId: active.characterId,
        includeConnectedStock: assetSharing.enabled,
        sharedCharacterIds: assetSharing.enabled ? assetSharing.characterIds : [],
        stockMode: refineryInputMode,
        manualStock: refineryInputMode === "manual" ? manualRefineryStock : [],
        facility: refineryFacility,
        rig: refineryRig,
        security: refinerySecurity,
        implant: refineryImplant,
      });
      setRefineryResult(result);
      setRefineryStatus(result?.stacks?.length
        ? `${result.stacks.length} refinable resource type(s) analysed from ${refineryInputMode === "manual" ? "the manual selection" : "the selected stock pool"}.`
        : refineryInputMode === "manual" ? "No valid refinable resources are in the manual selection." : "No refinable ore, ice or moon ore is present in the selected stock pool.");
    } catch (error) {
      setRefineryResult(null);
      setRefineryStatus(error instanceof Error ? error.message : "Refinery analysis failed.");
    } finally {
      setRefineryBusy(false);
    }
  }

  async function buildReactionPlan() {
    if (!(reactionBlueprintTypeId > 0)) {
      setReactionStatus("Choose a reaction formula first.");
      return;
    }
    setReactionBusy(true);
    setReactionStatus("Expanding the exact CCP reaction formula, checking stock, skills and retained market prices...");
    try {
      const result = await window.sage.getReactionPlan({
        characterId: active.characterId,
        blueprintTypeId: reactionBlueprintTypeId,
        runs: Math.max(1, Math.floor(Number(reactionRuns) || 1)),
        includeConnectedStock: assetSharing.enabled,
        sharedCharacterIds: assetSharing.enabled ? assetSharing.characterIds : [],
      });
      setReactionPlan(result);
      setReactionStatus(result?.totals?.missingMaterialTypes
        ? `${result.totals.missingMaterialTypes} reaction input type(s) still need sourcing.`
        : "Selected stock covers every reaction input for these runs.");
    } catch (error) {
      setReactionPlan(null);
      setReactionStatus(error instanceof Error ? error.message : "Reaction analysis failed.");
    } finally {
      setReactionBusy(false);
    }
  }

  async function loadSystemCostIndex() {
    setSystemCostStatus("Loading current-system ESI industry indices…");
    try {
      const result = await (window.sage as any).getIndustrySystemCostIndex({ characterId: active.characterId });
      setSystemCostIndex(result);
      setSystemCostStatus(result.available ? "Current-system industry indices loaded." : "No cost-index record is available for this system.");
    } catch (error) {
      setSystemCostIndex(null);
      setSystemCostStatus(error instanceof Error ? error.message : "Industry cost-index lookup failed.");
    }
  }

  async function loadInventionIntelligence(decryptorValue = inventionDecryptor, requestedBuildKey?: string) {
    if (!active?.characterId) {
      setInventionAnalysis(null);
      setInventionStatus("Connect and sync a character before ranking invention opportunities.");
      return;
    }
    const requestId = ++inventionRequestSequence.current;
    setInventionBusy(true);
    setInventionStatus("Pricing the complete cached invention graph against retained market orders...");
    try {
      const result = await (window.sage as any).getInventionOpportunities({
        characterId: active.characterId,
        marketDataRevision,
        decryptorTypeId: decryptorValue ? Number(decryptorValue) : null,
      });
      if (requestId !== inventionRequestSequence.current) return;
      setInventionAnalysis(result);
      if (requestedBuildKey) inventionBuildKeyRef.current = requestedBuildKey;
      setInventionStatus(`${Number(result?.candidateCount ?? 0).toLocaleString()} invention outcomes ranked - ${Number(result?.ownedSourceCount ?? 0).toLocaleString()} use an owned source BPO.`);
    } catch (error) {
      if (requestId !== inventionRequestSequence.current) return;
      inventionBuildKeyRef.current = null;
      setInventionStatus(error instanceof Error ? error.message : "Invention intelligence failed.");
    } finally {
      if (requestId === inventionRequestSequence.current) setInventionBusy(false);
    }
  }

  async function loadBlueprintActivities() {
    if (!selectedBlueprint?.type_id) { setActivityStatus("Choose a blueprint first."); return; }
    setActivityStatus("Loading CCP research, copying and invention activities…");
    try {
      const result = await (window.sage as any).getBlueprintActivities({ characterId: active.characterId, blueprintTypeId: selectedBlueprint.type_id });
      setBlueprintActivities(result);
      setActivityStatus(`${result.activities.length} CCP activity definition(s) available.`);
    } catch (error) {
      setBlueprintActivities(null);
      setActivityStatus(error instanceof Error ? error.message : "Blueprint activity analysis failed.");
    }
  }
  async function analyseIndustrialOpportunities(force = true) {
    const selectedSecurity = (Object.entries(opportunitySecurity) as Array<["high" | "low" | "null", boolean]>)
      .filter(([, enabled]) => enabled)
      .map(([band]) => band);
    if ((opportunitySystem.trim() && !opportunityJumpRadius) || (!opportunitySystem.trim() && opportunityJumpRadius)) {
      setOpportunities([]);
      setOpportunityStatus("To use proximity filtering, choose both a system and a 5 / 10 / 20 jump radius. Clear both to search all selected security space.");
      return;
    }
    if (!selectedSecurity.length) {
      setOpportunities([]);
      setOpportunityStatus("Select at least one security band.");
      return;
    }
    setOpportunityBusy(true);
    setOpportunityStatus("Refreshing industrial opportunities from prepared Sage data...");
    try {
      const result = await window.sage.getIndustrialOpportunities({
        characterId: active.characterId,
        systemQuery: opportunitySystem,
        maxJumps: opportunityJumpRadius,
        security: selectedSecurity,
        includeConnectedStock: assetSharing.enabled,
        sharedCharacterIds: assetSharing.enabled ? assetSharing.characterIds : [],
        force,
      });
      setOpportunities(Array.isArray(result?.opportunities) ? result.opportunities : []);
      setOpportunityStatus(result?.status ?? "Industrial opportunity refresh completed.");
      setOpportunityPreparedFor(JSON.stringify(result?.scope ?? {}));
    } catch (error) {
      setOpportunityStatus(error instanceof Error ? error.message : "Industrial opportunity analysis failed.");
    } finally {
      setOpportunityBusy(false);
    }
  }

  const libraryBlueprints = blueprintLibraryScope === "corporation" ? activeData.corpBlueprints : activeData.blueprints;
  const libraryAssets = blueprintLibraryScope === "corporation" ? activeData.corpAssets : activeData.assets;

  useEffect(() => {
    const blueprintImages = [...new Map(industrial.flatMap((owner) => [
      ...owner.blueprints,
      ...owner.corpBlueprints,
    ]).flatMap((blueprint) => {
      const typeId = Number(blueprint.type_id ?? 0);
      if (!Number.isInteger(typeId) || typeId <= 0) return [];
      const kind = blueprint.quantity === -1 ? "bpo" : "bpc";
      return [[`${typeId}:${kind}`, { typeId, kind }] as const];
    })).values()];
    if (!blueprintImages.length) return;

    // Warm the real Tranquility blueprint artwork cache, not ordinary type icons.
    const warmers = blueprintImages.map(({ typeId, kind }) => {
      const image = new Image();
      image.decoding = "async";
      image.src = `sage-asset://blueprint/${typeId}/${kind}`;
      return image;
    });
    return () => {
      for (const image of warmers) image.src = "";
    };
  }, [industrial]);
  const blueprintAssetByItemId = new Map<number, EnrichedAsset>(
    libraryAssets
      .filter((asset): asset is EnrichedAsset & { item_id: number } => typeof asset.item_id === "number")
      .map((asset) => [asset.item_id, asset]),
  );
  const personalRootLocations = new Map<number, { station?: string | null; system?: string | null }>();
  for (const asset of activeData.assets) {
    const locationId = Number(asset.root_location_id ?? asset.location_id ?? 0);
    if (!(locationId > 0) || (!asset.station && !asset.system)) continue;
    if (!personalRootLocations.has(locationId)) personalRootLocations.set(locationId, { station: asset.station, system: asset.system });
  }
  const corporationStructureById = new Map<number, any>(activeData.corpStructures.flatMap((structure: any) => {
    const id = Number(structure?.structure_id ?? structure?.facility_id ?? 0);
    return id > 0 ? [[id, structure] as const] : [];
  }));
  const corporationFacilityById = new Map<number, any>(activeData.facilities.flatMap((facility: any) => {
    const id = Number(facility?.facility_id ?? facility?.structure_id ?? 0);
    return id > 0 ? [[id, facility] as const] : [];
  }));
  const corporationAssetNameById = new Map<number, string>(activeData.corpAssetNames.flatMap((entry) => {
    const id = Number(entry?.item_id ?? 0);
    const name = String(entry?.name ?? "").trim();
    return id > 0 && name ? [[id, name] as const] : [];
  }));

  function locationFlagLabel(flag?: string) {
    if (!flag) return "";
    const corpDivision = /^CorpSAG(\d+)$/i.exec(flag);
    if (corpDivision) return `Corporation hangar division ${corpDivision[1]}`;
    if (/^Hangar$/i.test(flag)) return "Item hangar";
    if (/^AssetSafety$/i.test(flag)) return "Asset Safety";
    return flag.replace(/([a-z])([A-Z])/g, "$1 $2");
  }

  function blueprintLocationDetails(blueprint: BlueprintRecord) {
    const asset = typeof blueprint.item_id === "number" ? blueprintAssetByItemId.get(blueprint.item_id) : undefined;
    // Corporation blueprint records can point at an office/container item even when the
    // blueprint itself is not present in the corporation asset feed. Start from that
    // containing asset as a fallback so we can follow its enriched root to the Upwell
    // structure instead of treating the container item ID as a location.
    const containingAsset = blueprint.location_id ? blueprintAssetByItemId.get(Number(blueprint.location_id)) : undefined;
    let current = asset ?? containingAsset;
    const visited = new Set<number>();
    while (current && String(current.location_type ?? "").toLowerCase() === "item") {
      const currentId = Number(current.item_id ?? 0);
      if (!currentId || visited.has(currentId)) break;
      visited.add(currentId);
      const parent = blueprintAssetByItemId.get(Number(current.location_id ?? 0));
      if (!parent) break;
      current = parent;
    }

    const rootId = Number(current?.root_location_id ?? current?.location_id ?? asset?.root_location_id ?? blueprint.location_id ?? 0);
    const currentItemId = Number(current?.item_id ?? 0);
    // A corporation office in an Upwell structure is represented as an item chain:
    // blueprint -> OfficeFolder -> structure item -> solar system. The enriched
    // root_location_id on the structure item is the solar-system ID, so preserve
    // the structure item's own ID when it matches the corporation structure/facility
    // feeds instead of collapsing the location to the system.
    const exactStructureId = currentItemId > 0 && (corporationStructureById.has(currentItemId) || corporationFacilityById.has(currentItemId))
      ? currentItemId
      : rootId;
    const rootFromPersonalAssets = personalRootLocations.get(rootId);
    const structure = corporationStructureById.get(exactStructureId);
    const facility = corporationFacilityById.get(exactStructureId);
    const containerId = asset && String(asset.location_type ?? "").toLowerCase() === "item"
      ? Number(asset.location_id ?? 0)
      : containingAsset
        ? Number(containingAsset.item_id ?? 0)
        : 0;
    const containerName = containerId > 0 ? corporationAssetNameById.get(containerId) : undefined;
    const flag = locationFlagLabel(asset?.location_flag ?? blueprint.location_flag);
    const station = asset?.station ?? current?.station ?? rootFromPersonalAssets?.station ?? locationNames[rootId] ?? null;
    const system = asset?.system ?? current?.system ?? rootFromPersonalAssets?.system ?? null;
    const structureName = String(structure?.name ?? structure?.structure_name ?? facility?.name ?? facility?.facility_name ?? facility?.structure_name ?? "").trim();
    const secondaryParts = [...new Set([containerName ? `Container: ${containerName}` : "", flag, system ?? ""].filter(Boolean))];
    const titleParts = [exactStructureId !== rootId ? `ESI structure ${exactStructureId}` : "", rootId > 0 ? `ESI location ${rootId}` : "", blueprint.location_id && Number(blueprint.location_id) !== rootId ? `blueprint location ${blueprint.location_id}` : ""].filter(Boolean);

    if (station) return { primary: station, secondary: secondaryParts.join(" · "), title: titleParts.join(" · "), resolved: true };
    if (structureName) return { primary: structureName, secondary: secondaryParts.join(" · "), title: titleParts.join(" · "), resolved: true };
    if (rootId === Number(active.location?.station_id ?? active.location?.structure_id ?? 0) && active.location?.place_name) {
      return { primary: active.location.place_name, secondary: secondaryParts.join(" · "), title: titleParts.join(" · "), resolved: true };
    }
    if (system) {
      const systemSecondaryParts = [...new Set([containerName ? `Container: ${containerName}` : "", flag].filter(Boolean))];
      return { primary: system, secondary: systemSecondaryParts.join(" · "), title: titleParts.join(" · "), resolved: true };
    }
    if (rootId > 1_000_000_000_000) {
      return { primary: "Unknown structure", secondary: secondaryParts.join(" · ") || "Location awaiting ESI resolution", title: titleParts.join(" · "), resolved: false };
    }
    return { primary: "Unresolved location", secondary: secondaryParts.join(" · ") || "Location awaiting ESI resolution", title: titleParts.join(" · "), resolved: false };
  }

  const blueprintLibraryRows = libraryBlueprints.map((blueprint, index) => {
    const typeName = blueprint.type_id ? typeNames[blueprint.type_id] ?? `Type ${blueprint.type_id}` : "Blueprint";
    const location = blueprintLocationDetails(blueprint);
    const kind: "BPO" | "BPC" = blueprint.quantity === -1 ? "BPO" : "BPC";
    return { blueprint, index, typeName, location, kind, scope: blueprintLibraryScope };
  });
  const normalizedBlueprintFilter = blueprintFilter.trim().toLowerCase();
  const filteredBlueprintRows = blueprintLibraryRows.filter((row) => {
    if (!normalizedBlueprintFilter) return true;
    return [row.typeName, row.kind, row.location.primary, row.location.secondary]
      .some((value) => String(value ?? "").toLowerCase().includes(normalizedBlueprintFilter));
  });
  const blueprintSourceUnavailable = blueprintLibraryScope === "corporation" ? activeData.corpBlueprintUnavailable : activeData.blueprintUnavailable;

  const toggleCharacterSelection = (characterId: string) => {
    setSelectedCharacterIds((current) => current.includes(characterId) ? current.filter((id) => id !== characterId) : [...current, characterId]);
  };

  const industrialShellBar = (
    <div className="industrial-shell-topbar industrial-shell-topbar-inpage">
      <div className="industrial-shell-brand"><span>&#9671;</span><strong>NEW EDEN SAGE</strong></div>
      <nav className="industrial-shell-nav" aria-label="Industrial workspace navigation">
        <button type="button" className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Command Center</button>
        <button type="button" className={tab === "foundry" && foundryTab === "projects" ? "active" : ""} onClick={() => { setTab("foundry"); setFoundryTab("projects"); }}>Project Foundry</button>
        <button type="button" className={tab === "jobs" ? "active" : ""} onClick={() => setTab("jobs")}>Industrial Jobs</button>
        <button type="button" className={tab === "foundry" && foundryTab === "blueprints" ? "active" : ""} onClick={() => { setTab("foundry"); setFoundryTab("blueprints"); }}>Blueprint Library</button>
        <button type="button" className={tab === "foundry" && foundryTab === "materials" ? "active" : ""} onClick={() => { setTab("foundry"); setFoundryTab("materials"); }}>Materials</button>
        <button type="button" className={tab === "foundry" && foundryTab === "research" ? "active" : ""} onClick={() => { setTab("foundry"); setFoundryTab("research"); }}>Research &amp; Invention</button>
        <button type="button" className={tab === "refinery" ? "active" : ""} onClick={() => setTab("refinery")}>Refinery</button>
        <button type="button" className={tab === "moon-goo" ? "active" : ""} onClick={() => setTab("moon-goo")}>Moon Materials</button>
        <button type="button" className={tab === "structures" ? "active" : ""} onClick={() => setTab("structures")}>Structures</button>
      </nav>
    </div>
  );

  return (
    <section className={`industrial-command industrial-command-reference ${tab === "refinery" ? "industrial-refinery-page" : ""}`}>
      <div className="industrial-page-shell">
        <aside className="industrial-character-sidebar" aria-label="Industrial character selection">
          <div className="industrial-sidebar-heading"><span className="industrial-sidebar-glyph">◇</span><strong>CHARACTERS</strong><button type="button" aria-label="Add or manage characters" onClick={() => document.getElementById("industrial-character-search")?.focus()}>+</button></div>
          <label className="industrial-character-search"><span>⌕</span><input id="industrial-character-search" value={characterSearch} onChange={(event) => setCharacterSearch(event.target.value)} placeholder="Search characters..." /></label>
          <div className="industrial-character-list">
            {visibleCharacterSnapshots.map((snapshot) => {
              const selected = selectedCharacterIdSet.has(String(snapshot.characterId));
              return <div className={`industrial-sidebar-character ${selected ? "selected" : ""} ${snapshot.characterId === active.characterId ? "active-owner" : ""}`} key={snapshot.characterId}>
                <label className="industrial-character-check" title={selected ? "Remove from industrial overview" : "Add to industrial overview"}><input type="checkbox" checked={selected} onChange={() => toggleCharacterSelection(snapshot.characterId)} /><span /></label>
                <button type="button" className="industrial-character-identity" onClick={() => onSelectCharacter(snapshot.characterId)}>
                  <img src={`https://images.evetech.net/characters/${snapshot.characterId}/portrait?size=64`} alt="" />
                  <span><strong>{snapshot.character.name}</strong><small>{characterRole(snapshot)}</small><b>{compactSkillPoints(snapshot.skills.total_sp)}</b></span>
                </button>
              </div>;
            })}
            {!visibleCharacterSnapshots.length && <div className="industrial-sidebar-empty">No characters match this filter.</div>}
          </div>
          <div className="industrial-selection-summary"><span><strong>{selectedCharacterIds.length}</strong> character{selectedCharacterIds.length === 1 ? "" : "s"} selected</span><button type="button" onClick={() => setSelectedCharacterIds([])} disabled={!selectedCharacterIds.length}>Clear</button></div>
          <button type="button" className={`industrial-manage-selection ${showOnlySelected ? "active" : ""}`} onClick={() => { setShowOnlySelected((value) => !value); setCharacterSearch(""); }}>♙ <span>{showOnlySelected ? "Show All Characters" : "Show Selected Only"}</span></button>
        </aside>

        <div className="industrial-command-deck">
          <div
            className={`industrial-advertising-slot ${tab === "refinery" ? "industrial-refinery-hero" : ""}`}
            data-ad-slot="industrial-command-leaderboard"
            aria-label="Industrial Command advertising space"
            style={{ backgroundImage: `linear-gradient(90deg, rgba(2,13,20,.14), rgba(2,13,20,.20)), url(${industrialBanner})` }}
          >
            {tab === "refinery" ? <div className="industrial-refinery-hero-copy" aria-hidden="true">
              <span>MATERIALS</span>
              <strong>FUEL CIVILISATION</strong>
              <small>ORE / ICE / MOON-ORE PROCESSING</small>
            </div> : null}
          </div>

          {industrialShellBar}

          {tab === "overview" && <section className={`industrial-pooling-strip ${assetSharing.enabled ? "enabled" : ""}`}>
            <label className="industrial-pooling-master"><input type="checkbox" checked={assetSharing.enabled} onChange={(event) => setAssetSharing((current) => ({ ...current, enabled: event.target.checked }))} /><span><strong>Cross-character asset sharing</strong><small>{assetSharing.enabled ? "Only checked characters contribute stocks to this industrial overview." : "Off — planning uses the active character's assets only."}</small></span></label>
            <div className="industrial-pooling-stat"><i>◇</i><span><strong>Shared blueprints</strong><small>{number(selectedBlueprints.length)} total ({number(selectedBlueprintTypeCount)} unique)</small></span></div>
            <div className="industrial-pooling-stat materials"><i>△</i><span><strong>Shared materials</strong><small>{number(selectedMaterialUnits)} total items</small></span></div>
            <div className="industrial-pooling-stat jobs"><i>▥</i><span><strong>Active industry jobs</strong><small>{number(selectedActiveJobs.length)} across {number(new Set(selectedActiveJobs.map(({ owner }) => owner.characterId)).size)} characters</small></span></div>
            <div className="industrial-pooling-stat pools"><i>◎</i><span><strong>Shared asset pools</strong><small>{number(selectedLocations.length)} locations combined</small></span></div>
            <button type="button" className="industrial-pooling-options" onClick={() => { setTab("foundry"); setFoundryTab("materials"); }}>Pooling Options</button>
          </section>}


      {tab === "overview" && (
        <>
          <div className="industrial-metrics industrial-reference-metrics">
            <IndustrialMetric icon="▣" label="Character blueprints" value={number(selectedBlueprints.length)} detail={`${number(selectedBlueprintTypeCount)} unique across ${selectedCharacterIds.length} selected character${selectedCharacterIds.length === 1 ? "" : "s"}`} />
            <IndustrialMetric icon="⚙" label="Industry jobs" value={number(selectedJobs.length)} detail={`${selectedActiveJobs.length} active / pending`} />
            <IndustrialMetric icon="▱" label="Committed job cost" value={isk(selectedJobCost)} detail="Across selected characters" />
            <IndustrialMetric icon="◇" label="Asset stacks" value={number(selectedAssetStacks)} detail="Available for material analysis" />
          </div>

          <div className="industrial-overview-panels">
            <article className="industrial-reference-panel industrial-needs-action-panel">
              <div className="industrial-reference-panel-head">
                <strong>NEEDS ACTION</strong>
                <span className={industrialNeedsActionTotal ? "industrial-needs-action-count active" : "industrial-needs-action-count"}>{industrialNeedsActionTotal ? `${industrialNeedsActionTotal} OPEN` : "ALL CLEAR"}</span>
              </div>
              <div className="industrial-needs-action-list">
                {industrialNeedsAction.map((item) => (
                  <div className={`industrial-needs-action-row ${item.tone}`} key={item.id}>
                    <i aria-hidden="true" />
                    <span className="industrial-needs-action-copy">
                      <small>{item.category}</small>
                      <strong>{item.title}</strong>
                      <b>{item.detail}</b>
                    </span>
                    {item.action === "jobs" ? <button type="button" onClick={() => setTab("jobs")}>Review</button> : <em>PI</em>}
                  </div>
                ))}
                {!industrialNeedsAction.length && <div className="industrial-needs-action-clear">
                  <i aria-hidden="true" />
                  <span><strong>{planetaryAttentionReady ? "No industrial actions need attention" : "Checking industrial attention queue"}</strong><small>{planetaryAttentionReady ? "No completed jobs or urgent PI alerts in the selected character scope." : "Reading synced PI and production state…"}</small></span>
                </div>}
              </div>
            </article>

            <article className="industrial-reference-panel recent-activity-panel">
              <div className="industrial-reference-panel-head"><strong>RECENT INDUSTRY ACTIVITY</strong><button type="button" onClick={() => setTab("jobs")}>View All Activity →</button></div>
              <div className="industrial-activity-table"><div className="heading"><span>TIME</span><span>CHARACTER</span><span>ACTIVITY</span><span>DETAILS</span></div>
                {recentIndustryActivity.map(({ job, owner }, index) => <div className="row" key={job.job_id ?? `${owner.characterId}:${index}`}><span>{relativeIndustrialTime(job.completed_date ?? job.start_date ?? job.end_date)}</span><strong>{owner.character.name}</strong><span>{activityNames[job.activity_id ?? 0] ?? "Industry job"}</span><span>{job.product_type_id ? typeNames[job.product_type_id] ?? `Type ${job.product_type_id}` : job.blueprint_type_id ? typeNames[job.blueprint_type_id] ?? `Blueprint ${job.blueprint_type_id}` : `${job.runs ?? 1} run${job.runs === 1 ? "" : "s"}`}</span></div>)}
                {!recentIndustryActivity.length && <div className="industrial-reference-empty">No synced industry activity for the selected characters.</div>}
              </div>
            </article>

            <article className="industrial-reference-panel asset-location-panel">
              <div className="industrial-reference-panel-head"><strong>ASSET LOCATION SUMMARY</strong><button type="button" onClick={() => setTab("materials")}>View All Asset Locations →</button></div>
              <div className="industrial-location-table"><div className="heading"><span>LOCATION</span><span>ITEMS</span><span>EST. VALUE</span></div>
                {selectedLocations.slice(0, 4).map((location) => <div className="row" key={location.location}><span><i>◎</i>{location.location}</span><strong>{number(location.items)}</strong><b>{location.estimatedValue > 0 ? compactIsk(location.estimatedValue) : "--"}</b></div>)}
                {!selectedLocations.length && <div className="industrial-reference-empty">No asset locations in the selected character scope.</div>}
              </div>
            </article>
          </div>
        </>
      )}

      {tab === "opportunities" && (
        <div className="industrial-opportunity-workspace">
          <article className="industrial-panel industrial-opportunity-intro industrial-workbench-card">
            <div className="industrial-panel-head industrial-opportunity-head">
              <div><p className="eyebrow">OWNED BLUEPRINT × MARKET DEMAND</p><h3>What should I build, and where should I sell it?</h3><p>Sage matches products you can actually manufacture against retained demand, constrained to the security space and jump radius you choose.</p></div>
              <button type="button" className="industrial-opportunity-refresh" onClick={() => void analyseIndustrialOpportunities(true)} disabled={opportunityBusy}>{opportunityBusy ? 'Analysing…' : 'Refresh opportunities'}</button>
            </div>
            <div className="industrial-opportunity-controls">
              <label className="industrial-opportunity-system"><span>Optional proximity search</span><input value={opportunitySystem} onChange={(event) => { setOpportunitySystem(event.target.value); setOpportunityPreparedFor(''); }} placeholder="System (optional) — e.g. Rens" /></label>
              <div className="industrial-opportunity-filter-group"><span>Security</span><div className="industrial-opportunity-toggle-row">
                {(['high','low','null'] as const).map((band) => <button type="button" key={band} className={opportunitySecurity[band] ? 'active' : ''} onClick={() => { setOpportunitySecurity((current) => ({ ...current, [band]: !current[band] })); setOpportunityPreparedFor(''); }}>{band === 'high' ? 'High sec' : band === 'low' ? 'Low sec' : 'Null sec'}</button>)}
              </div></div>
              <div className="industrial-opportunity-filter-group"><span>Jump radius</span><div className="industrial-opportunity-toggle-row">
                <button type="button" className={opportunityJumpRadius === null ? 'active' : ''} onClick={() => { setOpportunityJumpRadius(null); setOpportunitySystem(''); setOpportunityPreparedFor(''); }}>Anywhere</button>
                {([5,10,20] as const).map((radius) => <button type="button" key={radius} className={opportunityJumpRadius === radius ? 'active' : ''} onClick={() => { setOpportunityJumpRadius(radius); setOpportunityPreparedFor(''); }}>{radius} jumps</button>)}
              </div></div>
            </div>
            <div className="industrial-notice">{opportunityStatus}</div>
          </article>
          {opportunities.length ? <div className="industrial-opportunity-grid">{opportunities.map((item) => <article className="industrial-opportunity-card" key={item.productTypeId + ':' + item.region + ':' + item.system}>
            <div className="industrial-opportunity-card-head"><span className={'industrial-opportunity-confidence ' + item.confidence.toLowerCase()}>{item.confidence}</span><span>{item.region}</span></div>
            <h3>{item.productName}</h3><p>{item.system}{item.jumps != null ? <> · <strong>{item.jumps} jump{item.jumps === 1 ? '' : 's'}</strong> from {item.originSystem}</> : null} · {item.security === 'high' ? 'High sec' : item.security === 'low' ? 'Low sec' : 'Null sec'}</p>
            <div className="industrial-opportunity-numbers"><span><small>Recommended batch</small><strong>{number(item.batch)}</strong></span><span><small>Build / unit</small><strong>{item.buildUnitCost > 0 ? isk(item.buildUnitCost) : '—'}</strong></span><span><small>Immediate buyer</small><strong>{item.bestBuy == null ? '—' : isk(item.bestBuy)}</strong></span><span><small>Est. batch profit</small><strong className={item.batchProfit != null && item.batchProfit > 0 ? 'positive' : ''}>{item.batchProfit == null ? '—' : isk(item.batchProfit)}</strong></span></div>
            <div className="industrial-opportunity-signals"><span>{number(item.buyOrders ?? 0)} buy orders · {number(item.buyVolume ?? 0)} wanted</span><span>{number(item.sellOrders ?? 0)} sell orders · {number(item.sellVolume ?? 0)} supplied</span>{item.supplyGap && <b>Supply gap</b>}{item.thinSupply && <b>Thin supply</b>}{item.buyPressure && <b>Buy pressure</b>}</div>
            <div className="industrial-opportunity-blueprint"><span>{item.blueprintName}</span><small>ME {item.materialEfficiency}% · TE {item.timeEfficiency}%</small></div>
          </article>)}</div> : <article className="industrial-panel industrial-planned"><p className="eyebrow">INDUSTRIAL OPPORTUNITY ENGINE</p><h3>{opportunityBusy ? 'Building actionable demand intelligence…' : 'No ranked opportunities yet'}</h3><p>{opportunityBusy ? 'Sage is resolving owned blueprints, checking their products against retained regional market intelligence and calculating manufacture-vs-demand economics in the background.' : 'Refresh the opportunity scan after market data or blueprint ownership changes.'}</p></article>}
        </div>
      )}

      {tab === "foundry" && foundryTab === "blueprints" && (
        <div className="industrial-panel industrial-full-panel industrial-blueprint-library">
          <div className="industrial-blueprint-library-head">
            <div className="industrial-blueprint-library-title">
              <p className="eyebrow">BLUEPRINT LIBRARY</p>
              <h3>{active.character.name}</h3>
              <p>Owned originals and copies with ESI ME, TE, runs and resolved storage locations.</p>
            </div>
            <div className="industrial-blueprint-library-actions">
              <label className="industrial-blueprint-search">
                <span aria-hidden="true">⌕</span>
                <input value={blueprintFilter} onChange={(event) => setBlueprintFilter(event.target.value)} placeholder="Search blueprints..." aria-label="Search blueprints" />
              </label>
              <span className="industrial-blueprint-count"><strong>{number(filteredBlueprintRows.length)}</strong> VISIBLE <b>/</b> {number(libraryBlueprints.length)} TOTAL</span>
            </div>
          </div>
          <div className="industrial-blueprint-toolbar">
            <div className="industrial-blueprint-scope" aria-label="Blueprint ownership scope">
              <button type="button" className={blueprintLibraryScope === "personal" ? "active" : ""} onClick={() => setBlueprintLibraryScope("personal")}><span>PERSONAL</span><small>{number(activeData.blueprints.length)}</small></button>
              <button type="button" disabled={!activeData.corpBlueprints.length} className={blueprintLibraryScope === "corporation" ? "active" : ""} onClick={() => setBlueprintLibraryScope("corporation")}><span>CORPORATION</span><small>{number(activeData.corpBlueprints.length)}</small></button>
            </div>
            {activeData.corpBlueprints.length > 0 && <div className="industrial-blueprint-corp-access"><span aria-hidden="true">◇</span><div><strong>CORPORATION BLUEPRINT ACCESS</strong><small>{number(activeData.corpBlueprints.length)} corporation blueprint{activeData.corpBlueprints.length === 1 ? "" : "s"} synced</small></div></div>}
          </div>
          {blueprintSourceUnavailable ? (
            <div className="industrial-notice">Blueprint scope is unavailable for this stored login. Reconnect the character to grant the current Sage ESI scopes.</div>
          ) : filteredBlueprintRows.length ? (
            <div className="industrial-blueprint-table" role="table" aria-label={`${blueprintLibraryScope} blueprint library`}>
              <div className="industrial-blueprint-row heading" role="row">
                <span>Blueprint</span><span>Scope</span><span>Kind</span><span>ME</span><span>TE</span><span>Runs</span><span>Location</span>
              </div>
              {filteredBlueprintRows.map(({ blueprint, index, typeName, location, kind, scope }) => (
                <div className={`industrial-blueprint-row ${location.resolved ? "" : "unresolved"}`} role="row" key={blueprint.item_id ?? `${blueprint.type_id}-${index}`}>
                  <span className="industrial-blueprint-identity">
                    <BlueprintThumbnail typeId={blueprint.type_id} kind={kind} />
                    <span><strong>{typeName}</strong><small>{scope === "corporation" ? "Corporation blueprint" : "Personal blueprint"} · ESI synced</small></span>
                  </span>
                  <span><b className={`industrial-blueprint-scope-badge ${scope}`}>{scope === "corporation" ? "CORP" : "PERSONAL"}</b></span>
                  <span><b className={`industrial-blueprint-kind ${kind.toLowerCase()}`}>{kind}</b></span>
                  <span className="industrial-blueprint-number">{blueprint.material_efficiency ?? 0}%</span>
                  <span className="industrial-blueprint-number">{blueprint.time_efficiency ?? 0}%</span>
                  <span className="industrial-blueprint-number">{kind === "BPO" ? "∞" : number(blueprint.runs ?? 0)}</span>
                  <span className="industrial-blueprint-location" title={location.title || undefined}><strong>{location.primary}</strong>{location.secondary ? <small>{location.secondary}</small> : null}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="industrial-notice">{normalizedBlueprintFilter ? "No blueprints match this search in the selected scope." : "No blueprints are present in the selected library scope."}</div>
          )}
        </div>
      )}

      {tab === "jobs" && (
        <div className="industrial-panel industrial-full-panel industrial-job-ledger">
          <div className="industrial-job-ledger-head">
            <div className="industrial-job-ledger-title">
              <p className="eyebrow">INDUSTRY JOB LEDGER</p>
              <h3>{active.character.name}</h3>
              <p>Personal and corporation manufacturing activity from the latest synced ESI state.</p>
            </div>
            <div className="industrial-job-ledger-summary">
              <span><small>Total</small><strong>{number(activeJobLedger.length)}</strong></span>
              <span><small>Current</small><strong>{number(activeLedgerCount)}</strong></span>
              <span className="solo"><small>Solo</small><strong>{number(soloLedgerCount)}</strong></span>
              <span className="corp"><small>Corp</small><strong>{number(corporationLedgerCount)}</strong></span>
            </div>
          </div>
          <div className="industrial-job-ledger-toolbar">
            <div className="industrial-job-filter-group" aria-label="Job ownership filter">
              <span>OWNERSHIP</span>
              <div>
                <button type="button" className={jobScopeFilter === "all" ? "active" : ""} onClick={() => setJobScopeFilter("all")}>All</button>
                <button type="button" className={jobScopeFilter === "solo" ? "active" : ""} onClick={() => setJobScopeFilter("solo")}>Solo</button>
                <button type="button" className={jobScopeFilter === "corporation" ? "active" : ""} onClick={() => setJobScopeFilter("corporation")}>Corp</button>
              </div>
            </div>
            <div className="industrial-job-filter-group" aria-label="Job status filter">
              <span>STATE</span>
              <div>
                <button type="button" className={jobStatusFilter === "all" ? "active" : ""} onClick={() => setJobStatusFilter("all")}>All</button>
                <button type="button" className={jobStatusFilter === "active" ? "active" : ""} onClick={() => setJobStatusFilter("active")}>Current</button>
                <button type="button" className={jobStatusFilter === "history" ? "active" : ""} onClick={() => setJobStatusFilter("history")}>History</button>
              </div>
            </div>
            <span className="industrial-job-ledger-visible">{number(filteredJobLedger.length)} SHOWN</span>
          </div>
          {activeData.jobsUnavailable && activeData.corpJobsUnavailable ? (
            <div className="industrial-notice">Industry-job scopes are unavailable for this stored login. Reconnect the character to refresh authorization.</div>
          ) : (
            <JobList jobs={filteredJobLedger} typeNames={typeNames} />
          )}
        </div>
      )}

      {tab === "foundry" && foundryTab === "materials" && (
        <div className="industrial-production-workspace">
          <article className="industrial-panel industrial-full-panel">
            <div className="industrial-panel-head blueprint-head">
              <div><p className="eyebrow">MATERIAL INVENTORY</p><h3>{assetSharing.enabled ? "Selected shared stock pool" : active.character.name}</h3><p>Only owned items that appear in an actual CCP blueprint material list are shown here. Source character and ESI item identity remain preserved.</p></div>
              <input value={materialFilter} onChange={(event) => setMaterialFilter(event.target.value)} placeholder="Filter materials..." />
            </div>
            <div className="industrial-material-toolbar">
              <div className="industrial-stock-pool-label"><strong>{assetSharing.enabled ? "SHARED POOL ON" : "SHARING OFF"}</strong><small>{number(materialOwners.length)} contributing character{materialOwners.length === 1 ? "" : "s"} · source identities preserved</small></div>
              <span>{number(materialInventory.length)} shown / {number(materialInventoryAll.length)} type(s) · {number(materialInventory.reduce((sum, item) => sum + item.quantity, 0))} units</span>
            </div>
            <div className="industrial-material-categories" aria-label="Material category filter">
              <button type="button" className={materialCategoryFilter === "all" ? "active" : ""} onClick={() => setMaterialCategoryFilter("all")}><span>All</span><small>{number(materialInventoryAll.length)}</small></button>
              {materialCategories.map((category) => <button type="button" key={category.name} className={materialCategoryFilter === category.name ? "active" : ""} onClick={() => setMaterialCategoryFilter(category.name)}><span>{category.name}</span><small>{number(category.count)}</small></button>)}
            </div>
            {materialInventory.length ? <div className="industrial-table industrial-inventory-table"><div className="industrial-table-row heading"><span>Material</span><span>Category</span><span>Quantity</span><span>Owners</span><span>Locations</span><span>Est. value</span></div>{materialInventory.map((item) => <div className="industrial-table-row" key={`${item.typeId}-${item.name}`}>
              <span className="industrial-material-identity">
                {item.typeId > 0 && <img src={`sage-asset://type/${item.typeId}/icon?size=64&cache=only&v=${materialIconRevision}`} alt="" loading="lazy" />}
                <span><strong>{item.name}</strong><small>{item.groupName}{item.marketGroupName && item.marketGroupName !== item.groupName ? ` · ${item.marketGroupName}` : ""}</small></span>
              </span>
              <span><b className="industrial-material-category">{item.categoryName}</b></span>
              <span>{number(item.quantity)}</span>
              <span className="industrial-owner-breakdown" title={[...item.sourceAssetIds].join(" · ")}>{[...item.owners.values()].map((owner) => `${owner.characterName}: ${number(owner.quantity)}`).join(" · ")}</span>
              <span>{[...item.locations].slice(0, 3).join(" · ") || "--"}{item.locations.size > 3 ? ` +${item.locations.size - 3}` : ""}</span>
              <span>{item.estimatedValue > 0 ? isk(item.estimatedValue) : "--"}</span>
            </div>)}</div> : <div className="industrial-notice">No blueprint-usable material stacks match this search/category filter in the selected stock pool.</div>}
          </article>
          <div className="industrial-grid">
            <article className="industrial-panel"><p className="eyebrow">PRODUCTION LINK</p><h3>Owned stock feeds production automatically</h3><p>Production Planner subtracts these holdings before calculating shortages. Connected-stock mode preserves which character contributes each material stack.</p><div className="industrial-production-steps"><span>1 - Pick blueprint</span><span>2 - Pool chosen stock</span><span>3 - Consume owned inputs</span><span>4 - Build owned subcomponents</span><span>5 - Price market leaves</span><span>6 - Compare build vs buy</span></div></article>
            <article className="industrial-panel"><p className="eyebrow">PROCUREMENT READINESS</p><h3>Shortages remain actionable</h3><p>Run a Production Planner target to calculate exact shortages, full-market sourcing cost and the recursive owned-build chain.</p><div className="industrial-stat-list"><IndustrialStat label="Characters in stock pool" value={number(materialOwners.length)} /><IndustrialStat label="Material types" value={number(materialInventory.length)} /><IndustrialStat label="Asset stacks" value={number(materialOwners.reduce((sum, owner) => sum + owner.assets.length, 0))} /><IndustrialStat label="Visible estimated value" value={isk(materialInventory.reduce((sum, item) => sum + item.estimatedValue, 0))} /></div></article>
          </div>
        </div>
      )}
      {tab === "foundry" && foundryTab === "projects" && (
        <IndustrialProjectFoundry
          characterId={String(active.characterId)}
          corporationName={String(active.character.corporation_name ?? "Corporation")}
          snapshotUpdatedAt={active.updatedAt}
          typeNames={typeNames}
          blueprints={[
            ...activeData.blueprints.map((blueprint) => ({ ...blueprint, scope: "personal" as const })),
            ...activeData.corpBlueprints.map((blueprint) => ({ ...blueprint, scope: "corporation" as const })),
          ]}
        />
      )}
      {tab === "refinery" && (
        <div className="industrial-production-workspace industrial-refinery-workspace">
          <article className="industrial-panel industrial-production-control industrial-refinery-control industrial-workbench-card">
            <div className="industrial-panel-head">
              <div><p className="eyebrow">REFINERY</p><h3>Ore, ice & moon-ore reprocessing</h3><p>Analyse synced holdings or override them with any ore quantity you want to model. Sage keeps the active character's real processing skills and exact CCP SDE outputs either way.</p></div>
              <span className="industrial-status live">CCP SDE + MARKET</span>
            </div>
            <div className="industrial-refinery-source-row">
              <span><strong>INPUT SOURCE</strong><small>{refineryInputMode === "manual" ? "Manual selection ignores synced holdings." : "Uses the selected ESI stock pool."}</small></span>
              <div className="industrial-refinery-source-toggle">
                <button type="button" className={refineryInputMode === "stock" ? "active" : ""} onClick={() => { setRefineryInputMode("stock"); setRefineryResult(null); setRefineryStatus("Synced-stock mode selected. Analyse the selected stock pool when ready."); }}>Synced stock</button>
                <button type="button" className={refineryInputMode === "manual" ? "active" : ""} onClick={() => { setRefineryInputMode("manual"); setRefineryResult(null); setRefineryStatus("Manual override selected. Add any ore, ice or moon ore you want to model."); }}>Manual override</button>
              </div>
            </div>
            {refineryInputMode === "manual" && <div className="industrial-manual-refinery">
              <label><span>Resource</span><select value={manualRefineryTypeId || ""} onChange={(event) => setManualRefineryTypeId(Number(event.target.value))}>
                {!refineryCatalogue.length && <option value="">Loading resources...</option>}
                {refineryCatalogue.map((item: any) => <option key={item.typeId} value={item.typeId}>{item.name} — {item.groupName}</option>)}
              </select></label>
              <label><span>Quantity</span><input type="number" min="1" step="1" value={manualRefineryQuantity} onChange={(event) => setManualRefineryQuantity(Math.max(1, Math.floor(Number(event.target.value) || 1)))} /></label>
              <button type="button" onClick={addManualRefineryResource} disabled={!refineryCatalogue.length}>Add resource</button>
            </div>}
            {refineryInputMode === "manual" && <div className="industrial-manual-refinery-list">
              {manualRefineryStock.length ? manualRefineryStock.map((stack) => { const item = refineryCatalogue.find((entry: any) => Number(entry.typeId) === stack.typeId); return <span key={stack.typeId}><b>{item?.name ?? `Type ${stack.typeId}`}</b><small>{number(stack.quantity)} units</small><button type="button" aria-label={`Remove ${item?.name ?? "resource"}`} onClick={() => { setManualRefineryStock((current) => current.filter((entry) => entry.typeId !== stack.typeId)); setRefineryResult(null); }}>×</button></span>; }) : <small>No manual resources added yet.</small>}
            </div>}
            <div className="industrial-production-controls industrial-refinery-controls">
              <label><span>Facility</span><select value={refineryFacility} onChange={(event) => setRefineryFacility(event.target.value as typeof refineryFacility)}><option value="npc">NPC station</option><option value="athanor">Athanor</option><option value="tatara">Tatara</option></select></label>
              <label><span>Reprocessing rig</span><select value={refineryFacility === "npc" ? "none" : refineryRig} disabled={refineryFacility === "npc"} onChange={(event) => setRefineryRig(event.target.value as typeof refineryRig)}><option value="none">No rig</option><option value="t1">T1 rig</option><option value="t2">T2 rig</option></select></label>
              <label><span>Structure security</span><select value={refineryFacility === "npc" ? "high" : refinerySecurity} disabled={refineryFacility === "npc"} onChange={(event) => setRefinerySecurity(event.target.value as typeof refinerySecurity)}><option value="high">High-sec</option><option value="low">Low-sec</option><option value="null">Null / wormhole</option></select></label>
              <label><span>Reprocessing implant</span><select value={refineryImplant} onChange={(event) => setRefineryImplant(event.target.value as typeof refineryImplant)}><option value="none">No implant</option><option value="rx801">RX-801 — +1%</option><option value="rx802">RX-802 — +2%</option><option value="rx804">RX-804 — +4%</option></select></label>
              <button type="button" onClick={analyzeRefineryStock} disabled={refineryBusy}>{refineryBusy ? "Analysing..." : refineryInputMode === "manual" ? "Analyse manual selection" : "Analyse refinery stock"}</button>
            </div>
            <div className="industrial-notice">{refineryStatus}</div>
          </article>
          {refineryResult ? <RefineryView data={refineryResult} filter={refineryFilter} onFilter={setRefineryFilter} /> : null}
        </div>
      )}

      {tab === "moon-goo" && (
        <div className="industrial-foundry-subtabs" role="tablist" aria-label="Moon Goo sections">
          <button type="button" className={moonGooTab === "materials" ? "active" : ""} onClick={() => setMoonGooTab("materials")}>Moon Materials</button>
          <button type="button" className={moonGooTab === "reactions" ? "active" : ""} onClick={() => setMoonGooTab("reactions")}>Reactions</button>
        </div>
      )}

      {tab === "moon-goo" && moonGooTab === "materials" && (
        <MoonGooWorkspace
          rows={moonIntelRows}
          ownerLabel={assetSharing.enabled ? "Selected shared stock pool" : active.character.name}
          rawOreCount={rawMoonOres.length}
          projectCount={moonFoundryProjects.filter((project) => String(project?.status ?? "") !== "archived").length}
        />
      )}

      {tab === "moon-goo" && moonGooTab === "reactions" && (
        <div className="industrial-production-workspace industrial-reaction-workspace">
          <article className="industrial-panel industrial-production-control industrial-reaction-control industrial-workbench-card">
            <div className="industrial-panel-head">
              <div><p className="eyebrow">REACTIONS</p><h3>Reaction formula planner</h3><p>Pick any current CCP reaction formula, choose runs, then compare exact SDE inputs against the selected stock pool and retained market prices.</p></div>
              <span className="industrial-status live">CCP SDE + MARKET</span>
            </div>
            <div className="industrial-production-controls industrial-reaction-controls">
              <label><span>Reaction formula</span><select value={reactionBlueprintTypeId || ""} onChange={(event) => { setReactionBlueprintTypeId(Number(event.target.value)); setReactionPlan(null); }}>
                {!reactionCatalogue?.formulas?.length && <option value="">Loading formulas...</option>}
                {(reactionCatalogue?.formulas ?? []).map((formula: any) => <option key={formula.blueprintTypeId} value={formula.blueprintTypeId}>{formula.productName} — {formula.formulaName}</option>)}
              </select></label>
              <label><span>Runs</span><input type="number" min="1" step="1" value={reactionRuns} onChange={(event) => { setReactionRuns(Math.max(1, Math.floor(Number(event.target.value) || 1))); setReactionPlan(null); }} /></label>
              <button type="button" onClick={buildReactionPlan} disabled={reactionBusy || !reactionCatalogue?.formulas?.length}>{reactionBusy ? "Analysing..." : "Analyse reaction"}</button>
            </div>
            <div className="industrial-notice">{reactionStatus}</div>
          </article>

          <div className="industrial-grid industrial-reaction-summary-grid">
            <article className="industrial-panel industrial-reaction-formula-card">
              <div className="industrial-panel-head"><div><p className="eyebrow">SELECTED FORMULA</p><h3>{selectedReactionFormula?.productName ?? "Choose a reaction"}</h3></div><span className="industrial-status">{selectedReactionFormula ? duration(selectedReactionFormula.baseTimeSeconds) + " / run" : "--"}</span></div>
              {selectedReactionFormula ? <>
                <div className="industrial-reaction-flow"><div><strong>Inputs / run</strong>{(selectedReactionFormula.materials ?? []).map((item: any) => <span key={item.typeId}>{item.name}<b>{number(item.quantity)}</b></span>)}</div><div><strong>Outputs / run</strong>{(selectedReactionFormula.products ?? []).map((item: any) => <span key={item.typeId}>{item.name}<b>{number(item.quantity)}</b></span>)}</div></div>
                <small className="industrial-plan-scope">{selectedReactionFormula.formulaName}</small>
              </> : <div className="industrial-notice">Reaction catalogue is loading.</div>}
            </article>
          </div>
          {reactionPlan ? <ReactionPlanView data={reactionPlan} /> : null}
        </div>
      )}

      {tab === "foundry" && foundryTab === "research" && (
        <div className="industrial-production-workspace">
          <article className="industrial-panel industrial-production-control industrial-research-control industrial-workbench-card">
            <div className="industrial-panel-head"><div><p className="eyebrow">RESEARCH & INVENTION</p><h3>Blueprint activity intelligence</h3><p>Inspect copying, ME/TE research, invention inputs, output options and skill requirements directly from CCP's local SDE.</p></div><span className="industrial-status live">OFFLINE SDE</span></div>
            {planningBlueprints.length ? <><div className="industrial-production-controls research-controls"><label><span>Research blueprint scope</span><select value={blueprintLibraryScope} onChange={(event) => { setBlueprintLibraryScope(event.target.value as "personal" | "corporation"); setSelectedBlueprintIndex(0); setBlueprintActivities(null); }}><option value="personal">Personal blueprints</option><option value="corporation" disabled={!activeData.corpBlueprints.length}>Corporation blueprints</option></select></label><label><span>Owned blueprint</span><select value={Math.min(selectedBlueprintIndex, Math.max(0, planningBlueprints.length - 1))} onChange={(event) => { setSelectedBlueprintIndex(Number(event.target.value)); setBlueprintActivities(null); }}>
              {planningBlueprints.map((blueprint, index) => <option key={blueprint.item_id ?? index} value={index}>{blueprint.lpStoreTarget ? "LP Store target - " : ""}{blueprint.type_id ? typeNames[blueprint.type_id] ?? `Type ${blueprint.type_id}` : "Unknown blueprint"} - ME {blueprint.material_efficiency ?? 0} / TE {blueprint.time_efficiency ?? 0}{blueprint.lpStoreTarget ? " - copy runs unknown" : (blueprint.runs ?? -1) >= 0 ? ` - ${blueprint.runs} runs` : " - BPO"}</option>)}
            </select></label><button type="button" onClick={loadBlueprintActivities}>Analyse activities</button></div><div className="industrial-notice">{activityStatus}</div></> : <div className="industrial-notice">No blueprints are available in the selected personal/corporation scope.</div>}
          </article>
          {blueprintActivities ? <BlueprintActivityView data={blueprintActivities} /> : null}
          <article className="industrial-panel industrial-full-panel industrial-invention-intro">
            <div className="industrial-panel-head">
              <div>
                <p className="eyebrow">INVENTION INTELLIGENCE</p>
                <h3>Catalogue-wide invention opportunities</h3>
                <p>The same invention engine used by ISK Command, presented here as an Industrial Command workbench. Market prices, character skills, owned source BPOs and decryptor effects stay on the shared calculation path.</p>
              </div>
              <button type="button" className="industrial-invention-refresh" onClick={() => { inventionBuildKeyRef.current = null; void loadInventionIntelligence(inventionDecryptor); }} disabled={inventionBusy}>
                {inventionBusy ? "Analysing..." : "Refresh invention intelligence"}
              </button>
            </div>
            <div className="industrial-notice">{inventionStatus}</div>
          </article>
          {inventionAnalysis ? (
            <InventionIntelligence
              analysis={inventionAnalysis}
              busy={inventionBusy}
              decryptor={inventionDecryptor}
              onDecryptorChange={setInventionDecryptor}
              onRefresh={() => { inventionBuildKeyRef.current = null; void loadInventionIntelligence(inventionDecryptor); }}
              variant="industrial"
            />
          ) : inventionBusy ? (
            <div className="industrial-notice industrial-invention-loading">Building and pricing the complete invention catalogue...</div>
          ) : null}
        </div>
      )}
      {tab === "production" && (
        <div className="industrial-production-workspace">
          <article className="industrial-panel industrial-production-control industrial-production-target-control industrial-workbench-card">
            <div className="industrial-panel-head">
              <div><p className="eyebrow">PRODUCTION CHAIN PLANNER</p><h3>Manufacturing target</h3><p>Uses the selected personal or corporation blueprint's real ME/TE and character-owned material stock.</p></div>
              <span className="industrial-status live">CCP SDE</span>
            </div>
            {planningBlueprints.length ? <>
              <div className="industrial-production-controls">
                <label><span>Production blueprint scope</span><select value={blueprintLibraryScope} onChange={(event) => { setBlueprintLibraryScope(event.target.value as "personal" | "corporation"); setSelectedBlueprintIndex(0); setManufacturingPlan(null); }}><option value="personal">Personal blueprints</option><option value="corporation" disabled={!activeData.corpBlueprints.length}>Corporation blueprints</option></select></label>
                  <label><span>Blueprint</span><select value={Math.min(selectedBlueprintIndex, Math.max(0, planningBlueprints.length - 1))} onChange={(event) => { setSelectedBlueprintIndex(Number(event.target.value)); setManufacturingPlan(null); }}>
                  {planningBlueprints.map((blueprint, index) => <option key={blueprint.item_id ?? index} value={index}>{blueprint.lpStoreTarget ? "LP Store target - " : ""}{blueprint.type_id ? typeNames[blueprint.type_id] ?? `Type ${blueprint.type_id}` : "Unknown blueprint"} - ME {blueprint.material_efficiency ?? 0} / TE {blueprint.time_efficiency ?? 0}{blueprint.lpStoreTarget ? " - copy runs unknown" : (blueprint.runs ?? -1) >= 0 ? ` - ${blueprint.runs} runs` : " - BPO"}</option>)}
                </select></label>
                <label><span>Target output</span><input type="number" min="1" step="1" value={targetQuantity} onChange={(event) => setTargetQuantity(Math.max(1, Number(event.target.value) || 1))} /></label>
                <label className="industrial-stock-toggle"><input type="checkbox" checked={assetSharing.enabled} onChange={(event) => setAssetSharing((current) => ({ ...current, enabled: event.target.checked }))} /><span>Use selected shared asset pool ({materialOwners.length} character{materialOwners.length === 1 ? "" : "s"})</span></label>
                <button type="button" onClick={buildManufacturingPlan}>Build production plan</button>
              </div>
              <div className="industrial-system-index"><div><span>CURRENT SYSTEM</span><strong>{active.location?.solar_system_name ?? "Unknown system"}</strong><small>{systemCostIndex?.available ? `Manufacturing cost index ${(Number(systemCostIndex.indices?.manufacturing ?? 0) * 100).toFixed(3)}%` : systemCostStatus}</small></div><button type="button" onClick={loadSystemCostIndex}>Load current system index</button></div>
              <div className="industrial-notice">{manufacturingStatus}</div>
            </> : <div className="industrial-notice">No blueprints are available in the selected personal/corporation scope.</div>}
          </article>
          {manufacturingPlan ? <ManufacturingPlanView plan={manufacturingPlan} /> : null}
        </div>
      )}

      {tab === "materials" && (
        <div className="industrial-reference-workspace">
          <article className="industrial-panel industrial-full-panel">
            <div className="industrial-panel-head"><div><p className="eyebrow">MATERIALS & STOCK</p><h3>Blueprint-usable material pool</h3><p>Only owned item types referenced by a CCP blueprint material list are included; ships, modules, finished goods and unrelated assets are excluded.</p></div><span className="industrial-status live">{materialStackCount} STACKS</span></div>
            <div className="industrial-reference-location-summary">{materialLocationSummary.slice(0, 8).map((location) => <span key={location.location}><strong>{location.location}</strong><small>{number(location.items)} material units · {location.estimatedValue > 0 ? compactIsk(location.estimatedValue) : "value unavailable"}</small></span>)}</div>
            <div className="industrial-material-list">{materialInventory.slice(0, 80).map((item) => <div key={`${item.typeId}:${item.name}`}><span><strong>{item.name}</strong><small>{[...item.owners.values()].map((owner) => owner.characterName).join(" · ")}</small></span><span><strong>{number(item.quantity)}</strong><small>{item.estimatedValue > 0 ? compactIsk(item.estimatedValue) : "--"}</small></span></div>)}</div>
          </article>
        </div>
      )}

      {tab === "blueprints" && (
        <article className="industrial-panel industrial-full-panel">
          <div className="industrial-panel-head"><div><p className="eyebrow">BLUEPRINTS</p><h3>Selected character blueprint library</h3><p>{selectedBlueprints.length} blueprint records across {selectedCharacterIds.length} selected characters.</p></div><button type="button" onClick={() => { setFoundryTab("blueprints"); setTab("foundry"); }}>Open Project Foundry</button></div>
          <div className="industrial-table"><div className="industrial-table-row heading"><span>Blueprint</span><span>ME</span><span>TE</span><span>Runs</span><span>Type</span><span>Owner</span></div>
            {selectedIndustrial.flatMap(({ snapshot, blueprints }) => blueprints.map((blueprint, index) => <div className="industrial-table-row" key={`${snapshot.characterId}:${blueprint.item_id ?? index}`}><strong>{blueprint.type_id ? typeNames[blueprint.type_id] ?? `Type ${blueprint.type_id}` : "Blueprint"}</strong><span>{blueprint.material_efficiency ?? 0}%</span><span>{blueprint.time_efficiency ?? 0}%</span><span>{blueprint.runs == null || blueprint.runs < 0 ? "Original" : number(blueprint.runs)}</span><span>{blueprint.quantity === -2 ? "BPC" : "BPO"}</span><span>{snapshot.character.name}</span></div>)).slice(0, 100)}
          </div>
        </article>
      )}

      {tab === "structures" && (
        <article className="industrial-panel industrial-full-panel">
          <div className="industrial-panel-head"><div><p className="eyebrow">STRUCTURES</p><h3>Visible industrial facilities</h3><p>Corporation facilities visible to the selected characters from the latest private-data snapshot.</p></div><span className="industrial-status">{number(selectedFacilities.length)} VISIBLE</span></div>
          {selectedFacilities.length ? <div className="industrial-structure-grid">{selectedFacilities.map(({ facility, owner }, index) => <div key={String(facility?.facility_id ?? facility?.structure_id ?? `${owner.characterId}:${index}`)}><span className="industrial-structure-icon">⌂</span><span><strong>{facility?.name ?? facility?.facility_name ?? facility?.structure_name ?? `Facility ${facility?.facility_id ?? facility?.structure_id ?? index + 1}`}</strong><small>{facility?.solar_system_name ?? facility?.system_name ?? owner.location.solar_system_name} · visible via {owner.character.name}</small></span></div>)}</div> : <div className="industrial-notice">No corporation industrial facilities are visible in the current selected-character scope.</div>}
        </article>
      )}
        </div>
      </div>
    </section>
  );
}

function BlueprintThumbnail({ typeId, kind }: { typeId?: number; kind: "BPO" | "BPC" }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [typeId, kind]);
  if (!typeId || failed) return <span className="industrial-blueprint-thumb fallback" aria-hidden="true">BP</span>;
  return <span className={`industrial-blueprint-thumb ${kind.toLowerCase()}`}><img src={`sage-asset://blueprint/${typeId}/${kind.toLowerCase()}`} alt="" decoding="async" onError={() => setFailed(true)} /></span>;
}

function RefineryView({ data, filter, onFilter }: { data: any; filter: string; onFilter(value: string): void }) {
  const stacks = (Array.isArray(data?.stacks) ? data.stacks : []).filter((stack: any) => {
    const query = filter.trim().toLowerCase();
    if (!query) return true;
    return [stack.name, stack.groupName, stack.processingSkill?.name, ...(stack.outputs ?? []).map((output: any) => output.name)]
      .filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
  });
  const totals = data?.totals ?? {};
  const yieldLabel = Number(totals.minYieldPercent ?? 0).toFixed(2) === Number(totals.maxYieldPercent ?? 0).toFixed(2)
    ? `${Number(totals.maxYieldPercent ?? 0).toFixed(2)}%`
    : `${Number(totals.minYieldPercent ?? 0).toFixed(2)}-${Number(totals.maxYieldPercent ?? 0).toFixed(2)}%`;
  return <div className="industrial-production-results industrial-refinery-results">
    <div className="industrial-metrics">
      <IndustrialMetric icon="▣" label="Refinable stock" value={number(totals.stackCount ?? 0)} detail={`${Number(totals.inputVolumeM3 ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} m³ across ${data.stockSources?.length ?? 0} character(s)`} />
      <IndustrialMetric icon="%" label="Effective yield" value={yieldLabel} detail={`Reprocessing ${data.skills?.reprocessing?.trainedLevel ?? 0} · Efficiency ${data.skills?.efficiency?.trainedLevel ?? 0} · ore skill varies by row`} />
      <IndustrialMetric icon="ISK" label="Sell raw now" value={totals.rawValue == null ? "PRICE GAPS" : isk(totals.rawValue)} detail="Best retained all-region public buy orders" />
      <IndustrialMetric icon="⇆" label="Refine then sell" value={totals.refinedStrategyValue == null ? "PRICE GAPS" : isk(totals.refinedStrategyValue)} detail="Refined outputs plus any unprocessable leftovers" />
    </div>
    <article className="industrial-build-buy-strip industrial-refinery-value-strip">
      <span><small>Refining advantage</small><strong className={Number(totals.valueDelta ?? 0) > 0 ? "positive" : ""}>{totals.valueDelta == null ? "--" : `${totals.valueDelta > 0 ? "+" : ""}${isk(totals.valueDelta)}`}</strong></span>
      <span><small>Recommendations</small><strong>{number(totals.refineRecommendations ?? 0)} refine · {number(totals.sellRecommendations ?? 0)} sell raw</strong></span>
      <small>{totals.valuationComplete ? "All rows have retained buy-order pricing." : "One or more rows have a market-price gap; Sage keeps physical refinery quantities exact and does not invent missing ISK values."} Facility tax and hauling are not included.</small>
    </article>
    <article className="industrial-panel industrial-full-panel industrial-refinery-ledger">
      <div className="industrial-panel-head blueprint-head"><div><p className="eyebrow">REFINERY LEDGER</p><h3>{data.facility?.label ?? "Refinery"} · {data.facility?.rig?.toUpperCase?.() ?? "NO RIG"} · {data.facility?.security ?? "high"}</h3><p>Whole SDE processing batches only. Leftover units remain raw and are included in the comparison.</p></div><input value={filter} onChange={(event) => onFilter(event.target.value)} placeholder="Filter ore, ice or output..." /></div>
      {stacks.length ? <div className="industrial-table industrial-refinery-table">
        <div className="industrial-table-row heading"><span>Resource</span><span>Stock / batches</span><span>Yield / skill</span><span>Refined output</span><span>Sell raw</span><span>Refine value</span><span>Delta</span><span>Decision</span></div>
        {stacks.map((stack: any) => <div className="industrial-table-row" key={stack.typeId}>
          <span className="industrial-refinery-resource"><img src={`sage-asset://type/${stack.typeId}/icon?size=64`} alt="" loading="lazy" /><span><strong>{stack.name}</strong><small>{stack.groupName} · {(stack.owners ?? []).map((owner: any) => owner.characterName).join(" · ") || "Unknown owner"}</small></span></span>
          <span><strong>{number(stack.quantity)}</strong><small>{number(stack.fullBatches)} × {number(stack.portionSize)}{stack.leftoverUnits ? ` · ${number(stack.leftoverUnits)} left` : ""}</small></span>
          <span><strong>{Number(stack.yieldPercent ?? 0).toFixed(2)}%</strong><small>{stack.processingSkill ? `${stack.processingSkill.name} ${stack.processingSkill.trainedLevel}` : "No specific skill"}</small></span>
          <span className="industrial-refinery-output-list">{(stack.outputs ?? []).map((output: any) => <small key={output.typeId}><span>{output.name}</span><b>{number(output.refinedUnits)}</b></small>)}</span>
          <span><strong>{stack.rawValue == null ? "--" : isk(stack.rawValue)}</strong><small>{stack.rawBestBuy == null ? "No retained buy quote" : `${stack.rawBestBuy.toLocaleString(undefined, { maximumFractionDigits: 2 })} / unit`}</small></span>
          <span><strong>{stack.refinedStrategyValue == null ? "--" : isk(stack.refinedStrategyValue)}</strong><small>{stack.completeValuation ? "Outputs + leftovers" : "Price gap"}</small></span>
          <span><strong className={Number(stack.valueDelta ?? 0) > 0 ? "positive" : ""}>{stack.valueDelta == null ? "--" : `${stack.valueDelta > 0 ? "+" : ""}${isk(stack.valueDelta)}`}</strong><small>{stack.valueDeltaPercent == null ? "" : `${stack.valueDeltaPercent > 0 ? "+" : ""}${stack.valueDeltaPercent.toFixed(1)}%`}</small></span>
          <span className={`industrial-refinery-decision ${stack.recommendation}`}>{stack.recommendation === "refine" ? "REFINE" : stack.recommendation === "sell" ? "SELL RAW" : stack.recommendation === "insufficient-batch" ? "HOLD" : "PRICE GAP"}</span>
        </div>)}
      </div> : <div className="industrial-notice">No refinery rows match this filter.</div>}
      <small className="industrial-plan-scope">{data.source} · Market snapshot {data.marketCreatedAt ? new Date(data.marketCreatedAt).toLocaleString() : "not available"}. Facility tax and hauling cost are excluded.</small>
    </article>
  </div>;
}

function ReactionPlanView({ data }: { data: any }) {
  const totals = data?.totals ?? {};
  return <div className="industrial-production-results industrial-reaction-results">
    <div className="industrial-metrics">
      <IndustrialMetric label="Reaction runs" value={number(data.runs ?? 0)} detail={`${duration(data.baseTimeSeconds ?? 0)} base time per run`} />
      <IndustrialMetric label="Missing inputs" value={number(totals.missingMaterialTypes ?? 0)} detail="Material types not covered by selected stock" />
      <IndustrialMetric label="Cash to complete" value={totals.missingMarketCost == null ? "PRICE GAPS" : isk(totals.missingMarketCost)} detail="Best retained sell quotes for missing inputs" />
      <IndustrialMetric label="Immediate output value" value={totals.immediateSaleValue == null ? "PRICE GAPS" : isk(totals.immediateSaleValue)} detail="Best retained public buy orders" />
    </div>
    <article className="industrial-build-buy-strip industrial-reaction-value-strip">
      <span><small>Immediate gross spread</small><strong className={Number(totals.immediateGrossSpread ?? 0) > 0 ? "positive" : ""}>{totals.immediateGrossSpread == null ? "--" : `${totals.immediateGrossSpread > 0 ? "+" : ""}${isk(totals.immediateGrossSpread)}`}</strong></span>
      <span><small>Sell-order gross spread</small><strong className={Number(totals.sellOrderGrossSpread ?? 0) > 0 ? "positive" : ""}>{totals.sellOrderGrossSpread == null ? "--" : `${totals.sellOrderGrossSpread > 0 ? "+" : ""}${isk(totals.sellOrderGrossSpread)}`}</strong></span>
      <small>Gross spread compares all formula inputs at retained sell prices with outputs. Reaction job installation cost, structure bonuses, taxes and hauling are excluded.</small>
    </article>
    <article className="industrial-panel industrial-full-panel industrial-reaction-ledger">
      <div className="industrial-panel-head"><div><p className="eyebrow">REACTION INPUTS</p><h3>{data.formulaName}</h3><p>{number(data.runs ?? 0)} run(s) · {duration(data.totalTimeSeconds ?? 0)} base reaction time</p></div><span className={`industrial-status ${data.skillsReady ? "live" : ""}`}>{data.skillsReady ? "SKILLS READY" : "CHECK SKILLS"}</span></div>
      <div className="industrial-table industrial-reaction-input-table">
        <div className="industrial-table-row heading"><span>Material</span><span>Per run</span><span>Required</span><span>Owned</span><span>Missing</span><span>Cash to source</span></div>
        {(data.materials ?? []).map((item: any) => <div className={`industrial-table-row ${item.missing > 0 ? "shortage" : "covered"}`} key={item.typeId}>
          <span><strong>{item.name}</strong><small>{item.groupName}</small></span><span>{number(item.perRun)}</span><span>{number(item.required)}</span><span><strong>{number(item.owned)}</strong><small>{(item.owners ?? []).map((owner: any) => `${owner.characterName}: ${number(owner.quantity)}`).join(" · ") || "No selected stock"}</small></span><span>{number(item.missing)}</span><span>{item.missingMarketCost == null ? "--" : isk(item.missingMarketCost)}</span>
        </div>)}
      </div>
      {(data.skills ?? []).length > 0 && <div className="industrial-skill-strip">{data.skills.map((skill: any) => <span className={skill.met ? "ready" : "missing"} key={skill.typeId}>{skill.name} {skill.requiredLevel} · trained {skill.trainedLevel}</span>)}</div>}
    </article>
    <article className="industrial-panel industrial-full-panel industrial-reaction-ledger">
      <div className="industrial-panel-head"><div><p className="eyebrow">REACTION OUTPUTS</p><h3>Formula yield</h3><p>Exact CCP SDE output quantities for the requested runs.</p></div></div>
      <div className="industrial-table industrial-reaction-output-table">
        <div className="industrial-table-row heading"><span>Product</span><span>Per run</span><span>Total output</span><span>Best buy</span><span>Immediate value</span><span>Sell-order value</span></div>
        {(data.products ?? []).map((item: any) => <div className="industrial-table-row" key={item.typeId}><span><strong>{item.name}</strong><small>{item.groupName}</small></span><span>{number(item.perRun)}</span><span>{number(item.quantity)}</span><span>{item.bestBuy == null ? "--" : item.bestBuy.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " ISK"}</span><span>{item.immediateSaleValue == null ? "--" : isk(item.immediateSaleValue)}</span><span>{item.sellOrderValue == null ? "--" : isk(item.sellOrderValue)}</span></div>)}
      </div>
      <small className="industrial-plan-scope">{data.source} · Market snapshot {data.marketCreatedAt ? new Date(data.marketCreatedAt).toLocaleString() : "not available"}.</small>
    </article>
  </div>;
}

function AssetSharingControl({ snapshots, activeCharacterId, enabled, selectedIds, onToggle, onSelect }: { snapshots: CharacterSnapshot[]; activeCharacterId: string; enabled: boolean; selectedIds: string[]; onToggle(enabled: boolean): void; onSelect(characterId: string, selected: boolean): void }) {
  return <section className={`industrial-asset-sharing ${enabled ? "enabled" : "disabled"}`}>
    <div className="industrial-asset-sharing-head">
      <label><input type="checkbox" checked={enabled} onChange={(event) => onToggle(event.target.checked)} /><span><strong>Cross-character asset sharing</strong><small>{enabled ? "Only checked characters can contribute stock to this industrial owner." : "Off — production uses the active character's assets only."}</small></span></label>
      <span className={`industrial-status ${enabled ? "live" : ""}`}>{enabled ? "SELECTED POOL" : "ISOLATED"}</span>
    </div>
    <div className="industrial-asset-sharing-characters">
      {snapshots.map((snapshot) => {
        const characterId = String(snapshot.characterId);
        const isActive = characterId === activeCharacterId;
        const checked = isActive || selectedIds.includes(characterId);
        const assets = Array.isArray((snapshot.extended as any)?.assets) ? (snapshot.extended as any).assets.length : 0;
        return <label className={checked ? "selected" : ""} key={characterId}>
          <input type="checkbox" checked={checked} disabled={isActive || !enabled} onChange={(event) => onSelect(characterId, event.target.checked)} />
          <span><strong>{snapshot.character.name}</strong><small>{isActive ? "Active owner · always included" : `${assets} asset stacks · ${checked ? "sharing" : "not sharing"}`}</small></span>
        </label>;
      })}
    </div>
    <small className="industrial-asset-sharing-note">Sharing changes calculation scope only. Sage keeps source assets separate as characterId:item_id records, so disabling a character removes only that character's contribution and never rewrites or merges the stored assets.</small>
  </section>;
}

function IndustrialMetric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon?: string }) {
  return <article className="industrial-metric">{icon ? <i className="industrial-metric-icon">{icon}</i> : null}<span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function IndustrialStat({ label, value }: { label: string; value: string }) {
  return <div className="industrial-stat"><span>{label}</span><strong>{value}</strong></div>;
}

function JobList({ jobs, typeNames }: { jobs: Array<{ job: IndustryJobRecord; scope: "solo" | "corporation" }>; typeNames: Record<number, string> }) {
  if (!jobs.length) return <div className="industrial-notice">No industry jobs match the current ledger filters.</div>;
  const now = Date.now();
  return (
    <div className="industrial-job-ledger-list">
      {jobs.map(({ job, scope }, index) => {
        const activity = activityNames[job.activity_id ?? 0] ?? `Activity ${job.activity_id ?? "-"}`;
        const blueprintName = job.blueprint_type_id ? typeNames[job.blueprint_type_id] ?? `Blueprint ${job.blueprint_type_id}` : "Unknown blueprint";
        const productName = job.product_type_id ? typeNames[job.product_type_id] ?? `Product ${job.product_type_id}` : blueprintName.replace(/ Blueprint$/i, "");
        const status = String(job.status ?? "unknown").toLowerCase();
        const start = job.start_date ? new Date(job.start_date).getTime() : 0;
        const end = job.end_date ? new Date(job.end_date).getTime() : 0;
        const completed = ["delivered", "cancelled", "reverted"].includes(status);
        const progress = completed ? 1 : start > 0 && end > start ? Math.max(0, Math.min(1, (now - start) / (end - start))) : 0;
        return <article className={`industrial-job-card ${scope} ${completed ? "history" : "current"}`} key={`${scope}-${job.job_id ?? index}`}>
          <div className="industrial-job-card-main">
            <div className="industrial-job-activity-mark" aria-hidden="true">{job.activity_id === 1 ? "M" : job.activity_id === 8 ? "I" : job.activity_id === 5 ? "C" : "R"}</div>
            <div className="industrial-job-identity">
              <span className="industrial-job-activity">{activity}</span>
              <strong>{productName}</strong>
              <small>{blueprintName}</small>
            </div>
            <div className="industrial-job-badges">
              <span className={`industrial-job-scope ${scope}`} title={scope === "corporation" ? "Corporation job from the corporation ESI industry feed" : "Solo job from the character ESI industry feed"}>{scope === "corporation" ? "CORP" : "SOLO"}</span>
              <span className={`industrial-job-state state-${status.replace(/[^a-z0-9]+/g, "-")}`}>{status.toUpperCase()}</span>
            </div>
          </div>
          <div className="industrial-job-card-facts">
            <span><small>RUNS</small><strong>{job.runs ?? "-"}</strong></span>
            <span><small>COST</small><strong>{job.cost == null ? "-" : isk(job.cost)}</strong></span>
            <span><small>ENDS</small><strong>{job.end_date ? new Date(job.end_date).toLocaleString() : "-"}</strong></span>
            <span><small>JOB ID</small><strong>{job.job_id ?? "-"}</strong></span>
          </div>
          <div className="industrial-job-progress" title={`${Math.round(progress * 100)}% elapsed`}>
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </article>;
      })}
    </div>
  );
}

function duration(seconds: number) {
  const value = Math.max(0, Math.round(seconds));
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return [days ? days + "d" : "", hours ? hours + "h" : "", minutes ? minutes + "m" : ""].filter(Boolean).join(" ") || "<1m";
}

function ManufacturingPlanView({ plan }: { plan: any }) {
  return <div className="industrial-production-results">
    <div className="industrial-metrics">
      <IndustrialMetric label="Output" value={number(plan.outputQuantity)} detail={plan.productName} />
      <IndustrialMetric label="Manufacturing runs" value={number(plan.runs)} detail={plan.availableRuns == null ? "Original blueprint" : plan.runsAvailable ? plan.availableRuns + " BPC runs available" : "INSUFFICIENT BPC RUNS"} />
      <IndustrialMetric label="Blueprint time" value={duration(plan.blueprintTimeSeconds)} detail={`TE ${plan.timeEfficiency}% · before character/facility bonuses`} />
      <IndustrialMetric label="Missing volume" value={plan.missingVolumeM3.toLocaleString(undefined, { maximumFractionDigits: 1 }) + " m³"} detail={plan.totalMissingStacks + " material type(s) to source"} />
    </div>
    {plan.market?.available && <div className="industrial-metrics industrial-market-metrics">
      <IndustrialMetric label="Cash to complete" value={plan.market.shortageMarketCost == null ? "—" : isk(plan.market.shortageMarketCost)} detail="Cheapest retained all-region sell quotes for shortages" />
      <IndustrialMetric label="Full BOM market" value={plan.market.fullBomMarketCost == null ? "—" : isk(plan.market.fullBomMarketCost)} detail="Opportunity-cost value of all required materials" />
      <IndustrialMetric label="Buy finished" value={plan.market.finishedBuyCost == null ? "—" : isk(plan.market.finishedBuyCost)} detail={plan.market.productSellRegion ? `Best retained sell · ${plan.market.productSellRegion}` : "No retained sell quote"} />
      <IndustrialMetric label="Immediate sale" value={plan.market.immediateSaleRevenue == null ? "—" : isk(plan.market.immediateSaleRevenue)} detail="Best retained all-region buy order" />
    </div>}
    {plan.market?.available && <article className="industrial-build-buy-strip"><span><small>Cash build vs buy</small><strong>{plan.market.cashBuildVsBuyDelta == null ? "—" : `${plan.market.cashBuildVsBuyDelta >= 0 ? "+" : ""}${isk(plan.market.cashBuildVsBuyDelta)}`}</strong></span><span><small>Economic build vs buy</small><strong>{plan.market.economicBuildVsBuyDelta == null ? "—" : `${plan.market.economicBuildVsBuyDelta >= 0 ? "+" : ""}${isk(plan.market.economicBuildVsBuyDelta)}`}</strong></span><small>Positive = manufacturing materials are cheaper than buying the finished output. Job installation cost, facility/rig modifiers, taxes and hauling are not yet included.</small></article>}
    {plan.productionChain?.some((node: any) => node.mode === "build" || node.mode === "mixed-build-market") && <ProductionChainView plan={plan} />}
    <article className="industrial-panel industrial-full-panel">
      <div className="industrial-panel-head"><div><p className="eyebrow">BILL OF MATERIALS</p><h3>{plan.productName}</h3><p>{plan.blueprintName} · ME {plan.materialEfficiency}% / TE {plan.timeEfficiency}%</p></div><span className={`industrial-status ${plan.runsAvailable && plan.skillsReady ? "live" : ""}`}>{plan.runsAvailable && plan.skillsReady ? "READY" : "CHECK REQUIREMENTS"}</span></div>
      <div className="industrial-table industrial-material-table">
        <div className="industrial-table-row heading"><span>Material</span><span>Base</span><span>Required</span><span>Owned</span><span>Use stock</span><span>Owners</span><span>Missing</span><span>Shortage cost</span></div>
        {plan.materials.map((material: any) => <div className={`industrial-table-row ${material.missing > 0 ? "shortage" : "covered"}`} key={material.typeId}><span className="industrial-material-name"><strong>{material.name}</strong>{material.buildOptions?.length > 0 && <small>Buildable: {material.buildOptions.map((option: any) => `${option.characterName} · ${option.blueprintName} · ${option.runsNeeded} run${option.runsNeeded === 1 ? "" : "s"}${option.skillRequirements?.every((skill: any) => skill.met) ? " · skills ready" : " · skill blocked"}${option.canCoverRuns ? "" : " · insufficient BPC runs"}`).join(" | ")}</small>}</span><span>{number(material.baseRequired)}</span><span>{number(material.required)}</span><span>{number(material.owned)}</span><span>{number(material.usedFromStock)}</span><span className="industrial-owner-breakdown">{material.ownership?.length ? material.ownership.filter((owner: any) => owner.used > 0).map((owner: any) => `${owner.characterName}: ${number(owner.used)}`).join(" · ") : "—"}</span><span>{number(material.missing)}</span><span>{material.missingMarketCost == null ? "—" : isk(material.missingMarketCost)}</span></div>)}
      </div>
      <div className="industrial-skill-strip">{plan.skills.map((skill: any) => <span className={skill.met ? "ready" : "missing"} key={skill.typeId}>{skill.name} {skill.requiredLevel} · trained {skill.trainedLevel}</span>)}</div>
      {plan.stockSources?.length > 1 && <div className="industrial-stock-sources"><strong>Stock pool</strong><span>{plan.stockSources.map((source: any) => source.characterName).join(" · ")}</span></div>}
      <small className="industrial-plan-scope">{plan.scope}</small>
    </article>
  </div>;
}

function ProductionChainView({ plan }: { plan: any }) {
  const buildNodes = plan.productionChain.filter((node: any) => node.mode === "build" || node.mode === "mixed-build-market");
  function nodeView(node: any): any {
    const built = node.mode === "build" || node.mode === "mixed-build-market";
    return <div className={`industrial-chain-node depth-${Math.min(5, node.depth ?? 0)}`} key={`${node.depth}-${node.typeId}-${node.name}`}>
      <div className="industrial-chain-node-head">
        <span><strong>{node.name}</strong><small>{number(node.required)} required · {number(node.stockUsed ?? 0)} from stock</small></span>
        <span className={`industrial-status ${built ? "live" : ""}`}>{built ? node.mode === "mixed-build-market" ? "PARTIAL BUILD" : "BUILD" : node.mode === "stock" ? "STOCK" : "MARKET"}</span>
      </div>
      {built && <div className="industrial-chain-blueprint"><strong>{node.blueprint.characterName}</strong><span>{node.blueprint.blueprintName} · ME {node.blueprint.materialEfficiency}% / TE {node.blueprint.timeEfficiency}% · {number(node.blueprint.runs)} run{node.blueprint.runs === 1 ? "" : "s"}</span>{node.marketRemainder > 0 && <small>{number(node.marketRemainder)} unit(s) still need market sourcing after available BPC runs.</small>}{node.blueprint.skillRequirements?.some((skill: any) => !skill.met) && <small>Skill gap: {node.blueprint.skillRequirements.filter((skill: any) => !skill.met).map((skill: any) => `${skill.name} ${skill.requiredLevel}`).join(" · ")}</small>}</div>}
      {node.children?.length > 0 && <div className="industrial-chain-children">{node.children.map((child: any) => nodeView(child))}</div>}
    </div>;
  }
  return <article className="industrial-panel industrial-full-panel industrial-chain-panel">
    <div className="industrial-panel-head"><div><p className="eyebrow">OWNED PRODUCTION CHAIN</p><h3>Build subcomponents before buying</h3><p>Sage consumes pooled stock once, then recursively follows blueprints the connected characters actually own. BPC run shortages fall back to market leaves.</p></div><span className="industrial-status live">{buildNodes.length} build path{buildNodes.length === 1 ? "" : "s"}</span></div>
    {plan.market?.ownedChainMarketCost != null && <div className="industrial-chain-cost"><span>Market cash after owned sub-builds</span><strong>{isk(plan.market.ownedChainMarketCost)}</strong></div>}
    <div className="industrial-chain-tree">{plan.productionChain.map((node: any) => nodeView(node))}</div>
    {plan.chainLeafRequirements?.length > 0 && <div className="industrial-chain-leaves"><strong>Remaining market leaves</strong>{plan.chainLeafRequirements.map((leaf: any) => <span key={leaf.typeId}>{leaf.name}<b>{number(leaf.quantity)}{leaf.marketCost == null ? "" : ` · ${isk(leaf.marketCost)}`}</b></span>)}</div>}
  </article>;
}
function BlueprintActivityView({ data }: { data: any }) {
  const visible = data.activities.filter((activity: any) => activity.id !== "manufacturing");
  return <div className="industrial-activity-grid">
    {visible.length ? visible.map((activity: any) => <article className="industrial-panel industrial-activity-card" key={activity.id}>
      <div className="industrial-panel-head"><div><p className="eyebrow">{activity.id.toUpperCase().replaceAll("_", " ")}</p><h3>{activity.label}</h3></div><span className="industrial-status">{duration(activity.baseTimeSeconds)}</span></div>
      {activity.materials.length > 0 && <div className="industrial-activity-section"><strong>Inputs</strong>{activity.materials.map((item: any) => <span key={item.typeId}>{item.name}<b>{number(item.quantity)}</b></span>)}</div>}
      {activity.products.length > 0 && <div className="industrial-activity-section"><strong>Outputs</strong>{activity.products.map((item: any) => <span key={item.typeId}>{item.name}<b>{item.probability == null ? number(item.quantity) : `${(item.probability * 100).toFixed(1)}% base`}</b></span>)}</div>}
      {activity.skills.length > 0 && <div className="industrial-skill-strip">{activity.skills.map((skill: any) => <span className={skill.met ? "ready" : "missing"} key={skill.typeId}>{skill.name} {skill.requiredLevel} · trained {skill.trainedLevel}</span>)}</div>}
      {!activity.materials.length && !activity.products.length && <div className="industrial-notice">No consumable material/output record is defined for this activity in the current CCP SDE.</div>}
    </article>) : <article className="industrial-panel"><div className="industrial-notice">This blueprint has no copying, research or invention activities in the current CCP SDE.</div></article>}
  </div>;
}

function MoonGooWorkspace({ rows, ownerLabel, rawOreCount, projectCount }: { rows: any[]; ownerLabel: string; rawOreCount: number; projectCount: number }) {
  const held = rows.filter((row) => row.stock > 0);
  const deficits = rows.filter((row) => row.deficit > 0);
  const visibleValue = held.reduce((sum, row) => sum + Number(row.estimatedValue ?? 0), 0);
  return <div className="industrial-production-workspace industrial-moon-goo-workspace">
    <article className="industrial-panel industrial-workbench-card">
      <div className="industrial-panel-head">
        <div><p className="eyebrow">MOON GOO</p><h3>Moon material intelligence</h3><p>Raw moon ore, its authoritative reprocessing outputs, reaction uses and Foundry demand in one workspace. Recipes come from the local CCP SDE.</p></div>
        <span className="industrial-status live">CCP SDE + SYNCED STOCK</span>
      </div>
      <div className="industrial-metrics">
        <IndustrialMetric label="Moon ore catalogue" value={number(rawOreCount)} detail="Current refinable moon-asteroid types from CCP static data" />
        <IndustrialMetric label="Held moon types" value={number(held.length)} detail={ownerLabel} />
        <IndustrialMetric label="Visible stock value" value={visibleValue > 0 ? isk(visibleValue) : "--"} detail="Latest retained asset valuation where available" />
        <IndustrialMetric label="Project deficits" value={number(deficits.length)} detail={`${number(projectCount)} active Foundry project${projectCount === 1 ? "" : "s"} checked`} />
      </div>
    </article>
    <article className="industrial-panel industrial-full-panel industrial-moon-goo-ledger">
      <div className="industrial-panel-head"><div><p className="eyebrow">CHAIN INTELLIGENCE</p><h3>Stock · demand · destinations</h3><p>Deficit and surplus are calculated against current Foundry material demand; reaction destinations are derived from CCP formulas.</p></div><span className="industrial-status">{number(rows.length)} chain entries</span></div>
      {rows.length ? <div className="industrial-table industrial-moon-goo-table">
        <div className="industrial-table-row heading"><span>Material</span><span>Stock</span><span>Project demand</span><span>Deficit / surplus</span><span>Est. value</span><span>Destinations / outputs</span></div>
        {rows.map((row) => <div className={`industrial-table-row ${row.deficit > 0 ? "shortage" : ""}`} key={row.typeId}>
          <strong>{row.name}<small>{row.category}</small></strong>
          <span>{number(row.stock)}</span>
          <span>{number(row.projectDemand)}{row.projects.length ? <small>{row.projects.slice(0, 2).join(" · ")}{row.projects.length > 2 ? ` +${row.projects.length - 2}` : ""}</small> : null}</span>
          <span>{row.deficit > 0 ? <><b>{number(row.deficit)} short</b><small>needs sourcing</small></> : <><b>{number(row.surplus)} surplus</b><small>{row.projectDemand > 0 ? "after project demand" : "uncommitted"}</small></>}</span>
          <span>{row.estimatedValue > 0 ? isk(row.estimatedValue) : "--"}</span>
          <span><small>{[...row.destinations.slice(0, 3), ...row.outputs.slice(0, 3)].join(" · ") || "No downstream formula in current catalogue"}</small></span>
        </div>)}
      </div> : <div className="industrial-notice">No moon-chain entries are available from the current SDE and stock/project scope.</div>}
    </article>
  </div>;
}