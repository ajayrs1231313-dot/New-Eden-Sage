import crypto from "node:crypto";
import {
  deleteProjectFoundryProject,
  getSnapshot,
  listSnapshots,
  listProjectFoundryProjects,
  saveProjectFoundryProject,
} from "./database";
import { getIndustrialProductionTree, getIndustrialTypeNames, searchIndustrialBlueprints } from "./industrial-engine";
import { getManufacturingPlanPrepared } from "./industrial-preparation";
import { reconcileProfitLedger, upsertIndustryProductionLot } from "./profit-ledger";

export type FoundryProjectStatus = "planning" | "active" | "complete" | "archived";
export type FoundryWorkStatus = "open" | "in-progress" | "complete";
export type FoundryStoreBinding = {
  kind: "container" | "division" | "personal";
  key: string;
  itemId?: number;
  locationFlag?: string;
  name: string;
};
export type FoundryStoreRoute = {
  targetId: string;
  stores: FoundryStoreBinding[];
};
export type FoundryRequirement = {
  typeId: number;
  name: string;
  required: number;
};
export type FoundryWorkPackage = {
  id: string;
  name: string;
  assignedTo: string;
  status: FoundryWorkStatus;
  typeIds: number[];
  kind: "materials" | "components" | "final";
};
export type FoundryProjectMode = "solo" | "corporation";
export type FoundryOwnerType = "member" | "division" | "project";
export type FoundryBuildNode = { id: string; parentId: string | null; typeId: number; name: string; required: number; depth: number; kind: "product" | "component" | "material"; direct: boolean; blueprintTypeId?: number; blueprintName?: string; runs?: number; outputPerRun?: number };
export type FoundryWorkGroup = { id: string; name: string; ownerType?: FoundryOwnerType; ownerId?: string; ownerName?: string };
export type FoundryAssignment = { id: string; targetId: string; quantity: number; ownerType: FoundryOwnerType; ownerId: string; ownerName: string; groupId?: string; status: FoundryWorkStatus };

export type FoundryProductionLot = {
  id: string;
  industryJobId: number;
  productTypeId: number;
  quantity: number;
  producedAt: string;
  attributedProductionCost: number;
  materialReferenceValue?: number;
  jobCost?: number;
  materialRequirements?: FoundryRequirement[];
  soldQuantity: number;
  remainingQuantity: number;
  realisedRevenue: number;
  realisedProfit: number;
  reconciliationStatus: "estimated" | "partial" | "exact";
};

export type FoundryProject = {
  id: string;
  corporationId: string;
  corporationName: string;
  createdByCharacterId: string;
  createdByCharacterName: string;
  name: string;
  status: FoundryProjectStatus;
  mode?: FoundryProjectMode;
  blueprintSource?: "owned" | "manual";
  blueprintTypeId: number;
  blueprintName: string;
  productTypeId: number;
  productName: string;
  quantity: number;
  outputPerRun?: number;
  availableRuns?: number;
  materialEfficiency: number;
  timeEfficiency: number;
  requirements: FoundryRequirement[];
  buildTree?: FoundryBuildNode[];
  assignments?: FoundryAssignment[];
  groups?: FoundryWorkGroup[];
  workPackages: FoundryWorkPackage[];
  linkedStores: FoundryStoreBinding[];
  storeRoutes?: FoundryStoreRoute[];
  industryJobIds?: number[];
  productionLots?: FoundryProductionLot[];
  producedQuantity?: number;
  soldQuantity?: number;
  remainingQuantity?: number;
  estimatedMaterialCost?: number | null;
  attributedProductionCost?: number;
  realisedRevenue?: number;
  realisedProfit?: number;
  lifecycleStatus?: "planning" | "producing" | "produced" | "partially-sold" | "sold";
  createdAt: string;
  updatedAt: string;
};

type CorpAsset = {
  item_id?: number;
  type_id?: number;
  quantity?: number;
  location_id?: number;
  location_flag?: string;
  location_type?: string;
  is_singleton?: boolean;
};
type AssetName = { item_id?: number; name?: string };

function projectId() {
  return `foundry-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

function packageId(label: string) {
  return `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "package"}-${crypto.randomBytes(3).toString("hex")}`;
}

function requireSnapshot(characterId: string) {
  const snapshot = getSnapshot(String(characterId)) as any;
  if (!snapshot) throw new Error("Select and sync a connected character before using Project Foundry.");
  return snapshot;
}

function corporationIdOf(snapshot: any) {
  const corporationId = Number(snapshot?.character?.corporation_id ?? 0);
  if (!(corporationId > 0)) throw new Error("The selected character has no corporation identity in the synced snapshot.");
  return String(corporationId);
}

function corpAssets(snapshot: any): CorpAsset[] {
  return Array.isArray(snapshot?.extended?.corporation?.assets) ? snapshot.extended.corporation.assets : [];
}

function corpAssetNames(snapshot: any): AssetName[] {
  return Array.isArray(snapshot?.extended?.corporation?.assetNames) ? snapshot.extended.corporation.assetNames : [];
}

function assetMap(assets: CorpAsset[]) {
  return new Map(assets.flatMap((asset) => Number(asset.item_id ?? 0) > 0 ? [[Number(asset.item_id), asset] as const] : []));
}

function rootDivisionFlag(asset: CorpAsset, byId: Map<number, CorpAsset>) {
  let current = asset;
  const visited = new Set<number>();
  while (String(current.location_type ?? "").toLowerCase() === "item") {
    const id = Number(current.item_id ?? 0);
    if (!id || visited.has(id)) break;
    visited.add(id);
    const parent = byId.get(Number(current.location_id ?? 0));
    if (!parent) break;
    current = parent;
  }
  return String(current.location_flag ?? asset.location_flag ?? "");
}

function descendants(containerItemId: number, assets: CorpAsset[]) {
  const children = new Map<number, CorpAsset[]>();
  for (const asset of assets) {
    if (String(asset.location_type ?? "").toLowerCase() !== "item") continue;
    const parentId = Number(asset.location_id ?? 0);
    if (!parentId) continue;
    const list = children.get(parentId) ?? [];
    list.push(asset);
    children.set(parentId, list);
  }
  const output: CorpAsset[] = [];
  const queue = [...(children.get(containerItemId) ?? [])];
  const visited = new Set<number>();
  while (queue.length) {
    const asset = queue.shift()!;
    const id = Number(asset.item_id ?? 0);
    if (id && visited.has(id)) continue;
    if (id) visited.add(id);
    output.push(asset);
    if (id) queue.push(...(children.get(id) ?? []));
  }
  return output;
}

export function collectBoundAssets(bindings: FoundryStoreBinding[], assets: CorpAsset[]) {
  const byId = assetMap(assets);
  const selected = new Map<number, CorpAsset>();
  let synthetic = -1;
  for (const binding of bindings) {
    const rows = binding.kind === "container" && Number(binding.itemId ?? 0) > 0
      ? descendants(Number(binding.itemId), assets)
      : binding.kind === "division" && binding.locationFlag
        ? assets.filter((asset) => rootDivisionFlag(asset, byId) === binding.locationFlag)
        : [];
    for (const asset of rows) {
      const id = Number(asset.item_id ?? 0) || synthetic--;
      selected.set(id, asset);
    }
  }
  return [...selected.values()];
}

export function sumBoundStock(bindings: FoundryStoreBinding[], assets: CorpAsset[]) {
  const quantities = new Map<number, number>();
  for (const asset of collectBoundAssets(bindings, assets)) {
    const typeId = Number(asset.type_id ?? 0);
    const quantity = Math.max(0, Number(asset.quantity ?? 0));
    if (!(typeId > 0) || !(quantity > 0)) continue;
    quantities.set(typeId, (quantities.get(typeId) ?? 0) + quantity);
  }
  return quantities;
}

function bindingKeys(project: FoundryProject) {
  return new Set([
    ...(project.linkedStores ?? []).map((store) => store.key),
    ...((project.storeRoutes ?? []).flatMap((route) => (route.stores ?? []).map((store) => store.key))),
  ]);
}

function routeBindings(project: FoundryProject, targetId?: string) {
  if (!targetId) return null;
  const route = (project.storeRoutes ?? []).find((row) => row.targetId === targetId);
  return route?.stores?.length ? route.stores : null;
}

function sourceKeysForTarget(project: FoundryProject, targetId?: string) {
  const routed = routeBindings(project, targetId);
  const stores = routed ?? project.linkedStores ?? [];
  if (stores.length) return new Set(stores.map((store) => store.key));
  return projectMode(project) === "solo" ? new Set(["personal:owner"]) : new Set<string>();
}

export function projectMode(project: FoundryProject): FoundryProjectMode {
  return project.mode === "solo" ? "solo" : "corporation";
}

function sumAssetStock(assets: CorpAsset[]) {
  const quantities = new Map<number, number>();
  for (const asset of assets) {
    const typeId = Number(asset.type_id ?? 0);
    const quantity = Math.max(0, Number(asset.quantity ?? 0));
    if (!(typeId > 0) || !(quantity > 0)) continue;
    quantities.set(typeId, (quantities.get(typeId) ?? 0) + quantity);
  }
  return quantities;
}

function mergeStock(target: Map<number, number>, source: Map<number, number>) {
  for (const [typeId, quantity] of source) target.set(typeId, (target.get(typeId) ?? 0) + quantity);
  return target;
}

function sumSourceStock(bindings: FoundryStoreBinding[], personalAssets: CorpAsset[], corporationAssets: CorpAsset[]) {
  const quantities = new Map<number, number>();
  const corpBindings = bindings.filter((binding) => binding.kind !== "personal");
  if (corpBindings.length) mergeStock(quantities, sumBoundStock(corpBindings, corporationAssets));
  if (bindings.some((binding) => binding.kind === "personal")) mergeStock(quantities, sumAssetStock(personalAssets));
  return quantities;
}

function directTargetByType(project: FoundryProject) {
  const map = new Map<number, string>();
  for (const node of project.buildTree ?? []) {
    if (Number(node.depth ?? 0) <= 0) continue;
    if (!node.direct && Number(node.depth ?? 0) !== 1) continue;
    const typeId = Number(node.typeId ?? 0);
    if (typeId > 0 && !map.has(typeId)) map.set(typeId, node.id);
  }
  return map;
}

function legacyBuildTree(project: FoundryProject): FoundryBuildNode[] {
  const rootId = `root:${project.productTypeId}`;
  return [
    { id: rootId, parentId: null, typeId: project.productTypeId, name: project.productName, required: project.quantity, depth: 0, kind: "product", direct: false, blueprintTypeId: project.blueprintTypeId, blueprintName: project.blueprintName },
    ...(project.requirements ?? []).map((line, index) => ({ id: `${rootId}/legacy-${index}:${line.typeId}`, parentId: rootId, typeId: line.typeId, name: line.name, required: line.required, depth: 1, kind: "material" as const, direct: true })),
  ];
}

function normalizeFoundryProject(project: FoundryProject): FoundryProject {
  return {
    ...project,
    mode: projectMode(project),
    blueprintSource: project.blueprintSource === "manual" ? "manual" : "owned",
    buildTree: Array.isArray(project.buildTree) && project.buildTree.length ? project.buildTree : legacyBuildTree(project),
    assignments: Array.isArray(project.assignments) ? project.assignments : [],
    groups: Array.isArray(project.groups) ? project.groups : [],
    workPackages: Array.isArray(project.workPackages) ? project.workPackages : [],
    linkedStores: Array.isArray(project.linkedStores) ? project.linkedStores : [],
    storeRoutes: Array.isArray(project.storeRoutes) ? project.storeRoutes.filter((route) => route && String(route.targetId ?? "").trim()).map((route) => ({ targetId: String(route.targetId), stores: Array.isArray(route.stores) ? route.stores : [] })) : [],
  };
}

export function analyzeFoundryProject(projectInput: FoundryProject, projectsInput: FoundryProject[], assets: CorpAsset[], inventory?: { personal?: CorpAsset[]; corporation?: CorpAsset[] }) {
  const project = normalizeFoundryProject(projectInput);
  const projects = projectsInput.map(normalizeFoundryProject);
  const mode = projectMode(project);
  const personalAssets = inventory?.personal ?? (mode === "solo" ? assets : []);
  const corporationAssets = inventory?.corporation ?? (mode === "corporation" ? assets : assets);
  const defaultStock = (project.linkedStores ?? []).length
    ? sumSourceStock(project.linkedStores ?? [], personalAssets, corporationAssets)
    : mode === "solo" ? sumAssetStock(personalAssets) : new Map<number, number>();
  const stockCache = new Map<string, Map<number, number>>();
  const stockForTarget = (targetId?: string) => {
    const routed = routeBindings(project, targetId);
    if (!routed) return defaultStock;
    const key = routed.map((store) => store.key).sort().join("|");
    const cached = stockCache.get(key);
    if (cached) return cached;
    const stock = sumSourceStock(routed, personalAssets, corporationAssets);
    stockCache.set(key, stock);
    return stock;
  };
  const ownKeys = bindingKeys(project);
  if (mode === "solo" && !(project.linkedStores ?? []).length) ownKeys.add("personal:owner");
  const competing = projects.filter((other) =>
    other.id !== project.id
    && other.status !== "archived"
    && other.status !== "complete"
    && [...bindingKeys(other), ...(projectMode(other) === "solo" && !(other.linkedStores ?? []).length ? ["personal:owner"] : [])].some((key) => ownKeys.has(key)),
  );
  const currentDirectTargets = directTargetByType(project);
  const otherDirectTargets = new Map(competing.map((other) => [other.id, directTargetByType(other)]));
  const reservationFor = (typeId: number, targetId?: string) => {
    const sourceKeys = sourceKeysForTarget(project, targetId);
    if (!sourceKeys.size) return 0;
    let reserved = 0;
    for (const other of competing) {
      const otherTargetId = otherDirectTargets.get(other.id)?.get(typeId);
      const otherKeys = sourceKeysForTarget(other, otherTargetId);
      if (![...otherKeys].some((key) => sourceKeys.has(key))) continue;
      const requirement = (other.requirements ?? []).find((line) => Number(line.typeId) === typeId);
      reserved += Math.max(0, Number(requirement?.required ?? 0));
    }
    return reserved;
  };
  const analyzeLine = (typeId: number, required: number, targetId?: string) => {
    const stock = stockForTarget(targetId);
    const physicallyPresent = stock.get(typeId) ?? 0;
    const reservedByOtherProjects = Math.min(physicallyPresent, reservationFor(typeId, targetId));
    const availableToProject = Math.max(0, physicallyPresent - reservedByOtherProjects);
    const delivered = Math.min(required, availableToProject);
    const outstanding = Math.max(0, required - delivered);
    const surplus = Math.max(0, availableToProject - required);
    const coverage = required > 0 ? Math.min(1, delivered / required) : 1;
    return { physicallyPresent, reservedByOtherProjects, availableToProject, delivered, outstanding, surplus, coverage };
  };
  const requirements = (project.requirements ?? []).map((line) => {
    const targetId = currentDirectTargets.get(Number(line.typeId));
    return { ...line, sourceTargetId: targetId ?? null, ...analyzeLine(line.typeId, line.required, targetId) };
  });
  const totalRequiredUnits = requirements.reduce((sum, line) => sum + line.required, 0);
  const totalDeliveredUnits = requirements.reduce((sum, line) => sum + line.delivered, 0);
  const progress = totalRequiredUnits > 0 ? Math.min(1, totalDeliveredUnits / totalRequiredUnits) : 0;
  const buildTree = (project.buildTree ?? legacyBuildTree(project)).map((node) => node.depth === 0
    ? { ...node, physicallyPresent: 0, reservedByOtherProjects: 0, availableToProject: 0, delivered: 0, outstanding: 0, surplus: 0, coverage: progress }
    : { ...node, ...analyzeLine(node.typeId, Math.max(0, Number(node.required ?? 0)), node.id) });
  const nodeById = new Map<string, any>(buildTree.map((node: any) => [node.id, node]));
  const blockers = requirements.filter((line) => line.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name));
  const finalAssembly = { ready: blockers.length === 0 && requirements.length > 0, coverage: progress, blockerCount: blockers.length, blockers: blockers.slice(0, 8).map((line) => ({ typeId: line.typeId, name: line.name, outstanding: line.outstanding })) };

  const childNodeIds = new Set(buildTree.map((node: any) => String(node.parentId ?? "")).filter(Boolean));
  const aggregateStoreRows = (nodes: any[]) => {
    const grouped = new Map<number, { typeId:number; name:string; required:number; depth:number }>();
    for (const node of nodes) {
      const typeId = Number(node.typeId ?? 0);
      const required = Math.max(0, Number(node.required ?? 0));
      if (!(typeId > 0) || required <= 0) continue;
      const current = grouped.get(typeId) ?? { typeId, name: String(node.name ?? `Type ${typeId}`), required: 0, depth: Number(node.depth ?? 0) };
      current.required += required;
      current.depth = Math.min(current.depth, Number(node.depth ?? current.depth));
      grouped.set(typeId, current);
    }
    return [...grouped.values()].map((row) => {
      const physicallyPresent = Math.max(0, Number(defaultStock.get(row.typeId) ?? 0));
      const reservedByOtherProjects = Math.min(physicallyPresent, reservationFor(row.typeId));
      const available = Math.max(0, physicallyPresent - reservedByOtherProjects);
      const ready = Math.min(row.required, available);
      return {
        ...row,
        physicallyPresent,
        reservedByOtherProjects,
        available,
        ready,
        missing: Math.max(0, row.required - ready),
        coverage: row.required > 0 ? Math.min(1, ready / row.required) : 1,
      };
    }).sort((a, b) => b.missing - a.missing || b.required - a.required || a.name.localeCompare(b.name));
  };
  const storePartRows = aggregateStoreRows(buildTree.filter((node: any) => Number(node.depth ?? 0) > 0 && node.kind === "component"));
  const storeMaterialRows = aggregateStoreRows(buildTree.filter((node: any) => Number(node.depth ?? 0) > 0 && node.kind === "material" && !childNodeIds.has(String(node.id))));
  const selectedStoreNames = (project.linkedStores ?? []).map((binding) => binding.name);
  const projectStoreSummary = {
    configured: selectedStoreNames.length > 0 || mode === "solo",
    selectedStores: selectedStoreNames,
    selectedStoreLabel: selectedStoreNames.length === 1
      ? selectedStoreNames[0]
      : selectedStoreNames.length > 1
        ? `${selectedStoreNames.length} project stores`
        : mode === "solo" ? "Owner personal assets" : "No project store selected",
    parts: storePartRows,
    materials: storeMaterialRows,
    partTypesReady: storePartRows.filter((row) => row.missing <= 0).length,
    partTypesTotal: storePartRows.length,
    partUnitsReady: storePartRows.reduce((sum, row) => sum + row.ready, 0),
    partUnitsRequired: storePartRows.reduce((sum, row) => sum + row.required, 0),
    materialTypesReady: storeMaterialRows.filter((row) => row.missing <= 0).length,
    materialTypesTotal: storeMaterialRows.length,
    materialUnitsReady: storeMaterialRows.reduce((sum, row) => sum + row.ready, 0),
    materialUnitsRequired: storeMaterialRows.reduce((sum, row) => sum + row.required, 0),
  };
  const groups = project.groups ?? [];
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const assignments = (project.assignments ?? []).map((assignment) => {
    const target = assignment.targetId === "final-assembly" ? null : nodeById.get(assignment.targetId);
    const group = assignment.groupId ? groupById.get(assignment.groupId) : undefined;
    const coverage = assignment.targetId === "final-assembly" ? progress : Number(target?.coverage ?? 0);
    return {
      ...assignment,
      targetName: assignment.targetId === "final-assembly" ? "Final Assembly" : target?.name ?? "Unknown requirement",
      targetRequired: assignment.targetId === "final-assembly" ? project.quantity : target?.required ?? assignment.quantity,
      coverage,
      deliveredQuantity: Math.min(assignment.quantity, assignment.quantity * Math.max(0, Math.min(1, coverage))),
      dataState: coverage >= 0.999999 ? "delivered" : assignment.status === "in-progress" ? "in-production" : "assigned",
      groupName: group?.name ?? null,
    };
  });
  const workPackages = (project.workPackages ?? []).map((workPackage) => {
    const lines = workPackage.kind === "final" ? requirements : requirements.filter((line) => workPackage.typeIds.includes(line.typeId));
    const coverage = lines.length ? lines.reduce((sum, line) => sum + line.delivered, 0) / Math.max(1, lines.reduce((sum, line) => sum + line.required, 0)) : 0;
    return { ...workPackage, coverage, ready: coverage >= 0.999999, requirementCount: lines.length, outstandingLines: lines.filter((line) => line.outstanding > 0).length };
  });
  return {
    ...project,
    requirements,
    buildTree,
    assignments,
    groups,
    workPackages,
    progress,
    deliveredLines: requirements.filter((line) => line.outstanding <= 0).length,
    totalLines: requirements.length,
    totalRequiredUnits,
    totalDeliveredUnits,
    missingUnits: requirements.reduce((sum, line) => sum + line.outstanding, 0),
    finalAssembly,
    projectStoreSummary,
    storeConflicts: competing.map((other) => ({ id: other.id, name: other.name })),
  };
}

export async function searchFoundryBlueprintCatalogue(input: { query?: string; limit?: number }) {
  return searchIndustrialBlueprints(String(input?.query ?? ""), Number(input?.limit ?? 40));
}

export async function createFoundryProject(input: {
  characterId: string;
  blueprintTypeId: number;
  materialEfficiency?: number;
  timeEfficiency?: number;
  quantity?: number;
  availableRuns?: number;
  name?: string;
  mode?: FoundryProjectMode;
  blueprintSource?: "owned" | "manual";
}) {
  const snapshot = requireSnapshot(input.characterId);
  const corporationId = corporationIdOf(snapshot);
  const materialEfficiency = Math.max(0, Math.min(10, Math.floor(Number(input.materialEfficiency ?? 0))));
  const timeEfficiency = Math.max(0, Math.min(20, Math.floor(Number(input.timeEfficiency ?? 0))));
  const blueprintSource = input.blueprintSource === "manual" ? "manual" : "owned";
  const plan = await getManufacturingPlanPrepared({
    characterId: String(input.characterId),
    blueprintTypeId: Number(input.blueprintTypeId),
    materialEfficiency,
    timeEfficiency,
    targetQuantity: Math.max(1, Math.floor(Number(input.quantity ?? 1))),
    availableRuns: blueprintSource === "manual" ? undefined : input.availableRuns,
    includeConnectedStock: false,
    sharedCharacterIds: [],
  });
  const productionTree = await getIndustrialProductionTree({ blueprintTypeId: Number(plan.blueprintTypeId), runs: Math.max(1, Number(plan.runs ?? 1)), materialEfficiency: Number(plan.materialEfficiency ?? materialEfficiency), maxDepth: 6 });
  const now = new Date().toISOString();
  const project: FoundryProject = {
    id: projectId(),
    corporationId,
    corporationName: String(snapshot.character?.corporation_name ?? `Corporation ${corporationId}`),
    createdByCharacterId: String(input.characterId),
    createdByCharacterName: String(snapshot.character?.name ?? input.characterId),
    name: String(input.name ?? "").trim() || `Build ${numberLabel(plan.outputQuantity)} ${plan.productName}`,
    status: "planning",
    mode: input.mode === "solo" ? "solo" : "corporation",
    blueprintSource,
    blueprintTypeId: Number(plan.blueprintTypeId),
    blueprintName: String(plan.blueprintName),
    productTypeId: Number(plan.productTypeId),
    productName: String(plan.productName),
    quantity: Number(plan.outputQuantity),
    outputPerRun: Math.max(1, Number(plan.productPerRun ?? 1)),
    availableRuns: blueprintSource === "manual" ? undefined : (Number.isFinite(Number(input.availableRuns)) && Number(input.availableRuns) >= 0 ? Math.floor(Number(input.availableRuns)) : undefined),
    materialEfficiency: Number(plan.materialEfficiency ?? materialEfficiency),
    timeEfficiency: Number(plan.timeEfficiency ?? timeEfficiency),
    requirements: (plan.materials ?? []).map((material: any) => ({ typeId: Number(material.typeId), name: String(material.name), required: Math.max(0, Number(material.required ?? 0)) })),
    buildTree: productionTree.nodes as FoundryBuildNode[],
    assignments: [],
    groups: [],
    workPackages: [],
    linkedStores: [],
    storeRoutes: [],
    industryJobIds: [],
    productionLots: [],
    producedQuantity: 0,
    soldQuantity: 0,
    remainingQuantity: Number(plan.outputQuantity),
    estimatedMaterialCost: plan.market?.fullBomMarketCost == null ? null : Number(plan.market.fullBomMarketCost),
    attributedProductionCost: 0,
    realisedRevenue: 0,
    realisedProfit: 0,
    lifecycleStatus: "planning",
    createdAt: now,
    updatedAt: now,
  };
  saveProjectFoundryProject(project);
  return getFoundryWorkspace(input.characterId, project.id);
}

function numberLabel(value: number) {
  return Number(value) === 1 ? "1" : Number(value).toLocaleString("en-GB");
}

function sanitizeFoundryGroups(input: unknown): FoundryWorkGroup[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input.flatMap((raw: any) => {
    const id = String(raw?.id ?? "").trim() || packageId("group");
    if (seen.has(id)) return [];
    seen.add(id);
    const ownerType = (["member", "division", "project"] as FoundryOwnerType[]).includes(raw?.ownerType) ? raw.ownerType : undefined;
    return [{ id, name: String(raw?.name ?? "").trim() || "Work group", ownerType, ownerId: ownerType ? String(raw?.ownerId ?? "").trim() : undefined, ownerName: ownerType ? String(raw?.ownerName ?? "").trim() : undefined }];
  });
}

function sanitizeFoundryAssignments(project: FoundryProject, input: unknown, groups: FoundryWorkGroup[]): FoundryAssignment[] {
  if (!Array.isArray(input)) return [];
  const tree = project.buildTree?.length ? project.buildTree : legacyBuildTree(project);
  const limits = new Map(tree.filter((node) => node.depth > 0).map((node) => [node.id, Math.max(0, Number(node.required ?? 0))]));
  limits.set("final-assembly", Math.max(1, Number(project.quantity ?? 1)));
  const validGroups = new Set(groups.map((group) => group.id));
  const used = new Map<string, number>();
  const output: FoundryAssignment[] = [];
  for (const raw of input as any[]) {
    const targetId = String(raw?.targetId ?? "");
    const limit = limits.get(targetId);
    if (limit == null) continue;
    const already = used.get(targetId) ?? 0;
    const quantity = Math.min(Math.max(0, Number(raw?.quantity ?? 0)), Math.max(0, limit - already));
    if (!(quantity > 0)) continue;
    const ownerType: FoundryOwnerType = (["member", "division", "project"] as FoundryOwnerType[]).includes(raw?.ownerType) ? raw.ownerType : "project";
    const ownerId = ownerType === "project" ? project.createdByCharacterId : String(raw?.ownerId ?? "").trim();
    const ownerName = ownerType === "project" ? project.createdByCharacterName : String(raw?.ownerName ?? "").trim();
    if (!ownerId || !ownerName) continue;
    used.set(targetId, already + quantity);
    output.push({ id: String(raw?.id ?? "").trim() || packageId("assignment"), targetId, quantity, ownerType, ownerId, ownerName, groupId: raw?.groupId && validGroups.has(String(raw.groupId)) ? String(raw.groupId) : undefined, status: (["open", "in-progress", "complete"] as FoundryWorkStatus[]).includes(raw?.status) ? raw.status : "open" });
  }
  return output;
}

function sanitizeStoreBindings(input: unknown): FoundryStoreBinding[] {
  const seen = new Set<string>();
  const rows = Array.isArray(input) ? input : [];
  return rows.flatMap((raw: any) => {
    const kind = raw?.kind === "container" || raw?.kind === "division" || raw?.kind === "personal" ? raw.kind as FoundryStoreBinding["kind"] : null;
    const key = String(raw?.key ?? "").trim();
    const name = String(raw?.name ?? "").trim();
    if (!kind || !key || !name || seen.has(key)) return [];
    if (kind === "container" && !(Number(raw?.itemId ?? 0) > 0)) return [];
    if (kind === "division" && !String(raw?.locationFlag ?? "").trim()) return [];
    seen.add(key);
    return [{ kind, key, name, itemId: kind === "container" ? Number(raw.itemId) : undefined, locationFlag: kind === "division" ? String(raw.locationFlag) : undefined }];
  });
}

function sanitizeStoreRoutes(project: FoundryProject, input: unknown): FoundryStoreRoute[] {
  const validTargets = new Set((project.buildTree ?? []).filter((node) => Number(node.depth ?? 0) > 0).map((node) => node.id));
  const seen = new Set<string>();
  return (Array.isArray(input) ? input : []).flatMap((raw: any) => {
    const targetId = String(raw?.targetId ?? "").trim();
    if (!targetId || !validTargets.has(targetId) || seen.has(targetId)) return [];
    const stores = sanitizeStoreBindings(raw?.stores);
    if (!stores.length) return [];
    seen.add(targetId);
    return [{ targetId, stores }];
  });
}

export async function updateFoundryProject(input: { characterId: string; project: FoundryProject }) {
  const snapshot = requireSnapshot(input.characterId);
  const corporationId = corporationIdOf(snapshot);
  const existingRaw = listProjectFoundryProjects(corporationId).find((project: any) => String(project.id) === String(input.project?.id)) as FoundryProject | undefined;
  if (!existingRaw) throw new Error("Project Foundry project not found for this corporation.");
  const existing = normalizeFoundryProject(existingRaw);
  const groups = sanitizeFoundryGroups(input.project.groups);
  const allowedStatuses = new Set<FoundryProjectStatus>(["planning", "active", "complete", "archived"]);
  const requestedQuantity = Math.max(1, Math.floor(Number(input.project.quantity ?? existing.quantity ?? 1)));
  const producedQuantity = Math.max(0, Number(existing.producedQuantity ?? 0), (existing.productionLots ?? []).reduce((sum, lot) => sum + Math.max(0, Number(lot.quantity ?? 0)), 0));
  if (requestedQuantity < producedQuantity) throw new Error(`Build quantity cannot be lower than ${numberLabel(producedQuantity)} already-produced units.`);

  let replanned = existing;
  const quantityChanged = requestedQuantity !== Math.max(1, Math.floor(Number(existing.quantity ?? 1)));
  if (quantityChanged) {
    const plan = await getManufacturingPlanPrepared({
      characterId: String(input.characterId),
      blueprintTypeId: Number(existing.blueprintTypeId),
      materialEfficiency: Number(existing.materialEfficiency ?? 0),
      timeEfficiency: Number(existing.timeEfficiency ?? 0),
      targetQuantity: requestedQuantity,
      availableRuns: existing.blueprintSource === "manual" ? undefined : existing.availableRuns,
      includeConnectedStock: false,
      sharedCharacterIds: [],
    });
    const productionTree = await getIndustrialProductionTree({
      blueprintTypeId: Number(plan.blueprintTypeId),
      runs: Math.max(1, Number(plan.runs ?? 1)),
      materialEfficiency: Number(plan.materialEfficiency ?? existing.materialEfficiency ?? 0),
      maxDepth: 6,
    });
    const plannedQuantity = Math.max(1, Number(plan.outputQuantity ?? requestedQuantity));
    replanned = normalizeFoundryProject({
      ...existing,
      quantity: plannedQuantity,
      outputPerRun: Math.max(1, Number(plan.productPerRun ?? existing.outputPerRun ?? 1)),
      requirements: (plan.materials ?? []).map((material: any) => ({ typeId: Number(material.typeId), name: String(material.name), required: Math.max(0, Number(material.required ?? 0)) })),
      buildTree: productionTree.nodes as FoundryBuildNode[],
      remainingQuantity: Math.max(0, plannedQuantity - producedQuantity),
      estimatedMaterialCost: plan.market?.fullBomMarketCost == null ? null : Number(plan.market.fullBomMarketCost),
      lifecycleStatus: plannedQuantity > producedQuantity ? (producedQuantity > 0 ? "producing" : "planning") : existing.lifecycleStatus,
    });
  }

  const assignments = sanitizeFoundryAssignments(replanned, input.project.assignments, groups);
  const requestedStatus = allowedStatuses.has(input.project.status) ? input.project.status : replanned.status;
  const nextStatus: FoundryProjectStatus = quantityChanged && requestedStatus === "complete" && replanned.quantity > producedQuantity ? "active" : requestedStatus;
  const requestedName = String(input.project.name ?? existing.name).trim() || existing.name;
  const previousDefaultName = `Build ${numberLabel(existing.quantity)} ${existing.productName}`;
  const nextName = quantityChanged && requestedName === previousDefaultName
    ? `Build ${numberLabel(replanned.quantity)} ${existing.productName}`
    : requestedName;
  const next: FoundryProject = {
    ...replanned,
    id: existing.id,
    corporationId,
    corporationName: existing.corporationName,
    createdByCharacterId: existing.createdByCharacterId,
    createdByCharacterName: existing.createdByCharacterName,
    blueprintTypeId: existing.blueprintTypeId,
    blueprintName: existing.blueprintName,
    blueprintSource: existing.blueprintSource,
    productTypeId: existing.productTypeId,
    productName: existing.productName,
    quantity: replanned.quantity,
    outputPerRun: replanned.outputPerRun,
    availableRuns: existing.availableRuns,
    materialEfficiency: existing.materialEfficiency,
    timeEfficiency: existing.timeEfficiency,
    requirements: replanned.requirements,
    buildTree: replanned.buildTree,
    industryJobIds: existing.industryJobIds,
    productionLots: existing.productionLots,
    producedQuantity: existing.producedQuantity,
    soldQuantity: existing.soldQuantity,
    remainingQuantity: replanned.remainingQuantity,
    estimatedMaterialCost: replanned.estimatedMaterialCost,
    attributedProductionCost: existing.attributedProductionCost,
    realisedRevenue: existing.realisedRevenue,
    realisedProfit: existing.realisedProfit,
    lifecycleStatus: replanned.lifecycleStatus,
    name: nextName,
    status: nextStatus,
    mode: input.project.mode === "solo" ? "solo" : "corporation",
    linkedStores: sanitizeStoreBindings(Array.isArray(input.project.linkedStores) ? input.project.linkedStores : existing.linkedStores),
    storeRoutes: sanitizeStoreRoutes(replanned, Array.isArray(input.project.storeRoutes) ? input.project.storeRoutes : existing.storeRoutes),
    groups,
    assignments,
    workPackages: existing.workPackages ?? [],
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  saveProjectFoundryProject(next);
  return getFoundryWorkspace(input.characterId, next.id);
}
export function removeFoundryProject(characterId: string, projectIdValue: string) {
  const snapshot = requireSnapshot(characterId);
  const corporationId = corporationIdOf(snapshot);
  const existing = listProjectFoundryProjects(corporationId).find((project: any) => String(project.id) === String(projectIdValue));
  if (!existing) return getFoundryWorkspace(characterId);
  deleteProjectFoundryProject(String(projectIdValue));
  return getFoundryWorkspace(characterId);
}

function configuredHangars(snapshot: any) {
  const rows = Array.isArray(snapshot?.extended?.corporation?.divisions?.hangar) ? snapshot.extended.corporation.divisions.hangar : [];
  return rows.map((row: any) => ({ division: Number(row?.division ?? 0), name: String(row?.name ?? "").trim() })).filter((row: any) => row.division > 0 && row.division <= 7).sort((a: any, b: any) => a.division - b.division);
}

async function discoverStores(snapshot: any) {
  const assets = corpAssets(snapshot);
  const byId = assetMap(assets);
  const names = new Map(corpAssetNames(snapshot).flatMap((row) => Number(row.item_id ?? 0) > 0 && row.name ? [[Number(row.item_id), String(row.name)] as const] : []));
  const childCounts = new Map<number, number>();
  for (const asset of assets) {
    if (String(asset.location_type ?? "").toLowerCase() !== "item") continue;
    const parent = Number(asset.location_id ?? 0);
    if (parent) childCounts.set(parent, (childCounts.get(parent) ?? 0) + 1);
  }
  const typeIds = [...new Set([...names.keys()].map((itemId) => Number(byId.get(itemId)?.type_id ?? 0)).filter((id) => id > 0))];
  const typeNames = await getIndustrialTypeNames(typeIds);
  const configured = configuredHangars(snapshot);
  const configuredByFlag = new Map<string, { division: number; name: string }>(configured.map((row: any) => [`CorpSAG${row.division}`, row]));
  const divisionFlags = [...new Set([...assets.map((asset) => rootDivisionFlag(asset, byId)).filter((flag) => /^CorpSAG\d+$/i.test(flag)), ...configured.map((row: any) => `CorpSAG${row.division}`)])].sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")));
  const divisions = divisionFlags.map((flag) => {
    const division = Number(flag.replace(/\D/g, ""));
    const configuredRow = configuredByFlag.get(flag);
    return { kind: "division" as const, key: `division:${flag}`, division, locationFlag: flag, name: configuredRow?.name || `Corporation Hangar ${division || flag}`, configuredName: configuredRow?.name || null, itemCount: collectBoundAssets([{ kind: "division", key: `division:${flag}`, locationFlag: flag, name: flag }], assets).length };
  });
  const containers = [...names.entries()].flatMap(([itemId, name]) => {
    const asset = byId.get(itemId);
    if (!asset) return [];
    const typeName = typeNames[Number(asset.type_id ?? 0)] ?? `Type ${asset.type_id ?? 0}`;
    const childCount = childCounts.get(itemId) ?? 0;
    if (!childCount && !/(container|storage|vault|hangar)/i.test(typeName)) return [];
    const flag = rootDivisionFlag(asset, byId);
    const configuredDivision = configuredByFlag.get(flag);
    return [{ kind: "container" as const, key: `container:${itemId}`, itemId, name, typeName, division: configuredDivision?.name || (/^CorpSAG\d+$/i.test(flag) ? `Hangar ${flag.replace(/\D/g, "")}` : flag || "Corporation assets"), itemCount: descendants(itemId, assets).length }];
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { divisions, containers, assetNameCount: names.size, configuredDivisionCount: configured.length };
}

function memberDirectory(snapshot: any, corporationId: string, snapshots: any[]) {
  const corporation = snapshot?.extended?.corporation;
  const memberIds = Array.isArray(corporation?.members) ? corporation.members.map(Number).filter((id: number) => id > 0) : [];
  const connected = snapshots.filter((row) => String(row?.character?.corporation_id ?? "") === corporationId);
  const connectedNames = new Map(connected.map((row) => [Number(row.characterId), String(row?.character?.name ?? row.characterId)]));
  const ids = [...new Set([...memberIds, ...connected.map((row) => Number(row.characterId)).filter((id) => id > 0)])];
  return ids.map((id) => ({ id, name: connectedNames.get(id) ?? null, sageConnected: connectedNames.has(id) })).sort((a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)));
}

export function getFoundryProjects(characterId: string) {
  const snapshot = requireSnapshot(characterId);
  const corporationId = corporationIdOf(snapshot);
  return (listProjectFoundryProjects(corporationId) as FoundryProject[]).map(normalizeFoundryProject).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getFoundryWorkspace(characterId: string, selectedProjectId?: string) {
  const snapshot = requireSnapshot(characterId);
  const corporationId = corporationIdOf(snapshot);
  const snapshots = listSnapshots() as any[];
  const assets = corpAssets(snapshot);
  const projects = (listProjectFoundryProjects(corporationId) as FoundryProject[]).map(normalizeFoundryProject).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const analyzed = projects.map((project) => {
    const creatorSnapshot = snapshots.find((row) => String(row?.characterId ?? "") === String(project.createdByCharacterId));
    const personal = Array.isArray(creatorSnapshot?.extended?.assets) ? creatorSnapshot.extended.assets : [];
    const defaultAssets = projectMode(project) === "solo" ? personal : assets;
    return analyzeFoundryProject(project, projects, defaultAssets, { personal, corporation: assets });
  });
  const stores = await discoverStores(snapshot);
  const selectedProject = analyzed.find((project) => project.id === selectedProjectId) ?? analyzed[0] ?? null;
  return {
    corporationId,
    corporationName: String(snapshot.character?.corporation_name ?? `Corporation ${corporationId}`),
    characterId: String(characterId),
    characterName: String(snapshot.character?.name ?? characterId),
    generatedAt: new Date().toISOString(),
    snapshotUpdatedAt: snapshot.updatedAt ?? null,
    corporationAssetsAvailable: Array.isArray(snapshot?.extended?.corporation?.assets),
    corporationAssetsUnavailable: !Array.isArray(snapshot?.extended?.corporation?.assets),
    personalAssetsAvailable: Array.isArray(snapshot?.extended?.assets),
    projects: analyzed,
    selectedProject,
    stores,
    directory: {
      members: memberDirectory(snapshot, corporationId, snapshots),
      membersAvailable: Array.isArray(snapshot?.extended?.corporation?.members),
      divisions: stores.divisions.map((division: any) => ({ id: division.key, division: division.division, name: division.name, locationFlag: division.locationFlag })),
      divisionsAvailable: stores.configuredDivisionCount > 0,
    },
    source: "Synced ESI assets and corporation identity + prepared CCP SDE manufacturing requirements",
  };
}

type SyncedIndustryJob = {
  job_id?: number;
  installer_id?: number;
  activity_id?: number;
  blueprint_type_id?: number;
  product_type_id?: number;
  runs?: number;
  successful_runs?: number;
  cost?: number;
  status?: string;
  start_date?: string;
  end_date?: string;
  completed_date?: string;
};

function jobCompletion(job: SyncedIndustryJob) {
  return String(job.completed_date ?? job.end_date ?? "");
}

export function productionLotIdentifier(producedAt: string, industryJobId: number) {
  const parsed = new Date(producedAt);
  const date = Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10).replace(/-/g, "") : "UNKNOWN";
  return `NES-IND-${date}-${Math.max(1, Math.floor(industryJobId))}`;
}

export function safelyMatchesProject(job: SyncedIndustryJob, project: FoundryProject) {
  const status = String(job.status ?? "").toLowerCase();
  if (status !== "delivered") return false;
  if (Number(job.activity_id ?? 0) !== 1) return false;
  if (Number(job.blueprint_type_id ?? 0) !== Number(project.blueprintTypeId)) return false;
  if (Number(job.product_type_id ?? 0) !== Number(project.productTypeId)) return false;
  if (String(job.installer_id ?? "") !== String(project.createdByCharacterId)) return false;
  const started = Date.parse(String(job.start_date ?? ""));
  const projectCreated = Date.parse(project.createdAt);
  if (!Number.isFinite(started) || !Number.isFinite(projectCreated) || started < projectCreated - 5 * 60_000) return false;
  return Number(job.job_id ?? 0) > 0 && Number.isFinite(Date.parse(jobCompletion(job)));
}

function jobsForSnapshot(snapshot: any) {
  const personal = Array.isArray(snapshot?.extended?.industryJobs) ? snapshot.extended.industryJobs : [];
  const corporation = Array.isArray(snapshot?.extended?.corporation?.industryJobs) ? snapshot.extended.corporation.industryJobs : [];
  const byId = new Map<number, SyncedIndustryJob>();
  for (const job of [...personal, ...corporation]) {
    const id = Number(job?.job_id ?? 0);
    if (id > 0) byId.set(id, job);
  }
  return [...byId.values()];
}

export function synchronizeFoundryLifecycle(characterId?: string) {
  const snapshots = listSnapshots() as any[];
  const snapshotsById = new Map(snapshots.map((snapshot) => [String(snapshot?.characterId ?? ""), snapshot]));
  const projects = (listProjectFoundryProjects() as FoundryProject[])
    .filter((project) => !characterId || String(project.createdByCharacterId) === String(characterId))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));
  const claimedJobs = new Set<number>();
  for (const project of listProjectFoundryProjects() as FoundryProject[]) {
    for (const lot of project.productionLots ?? []) claimedJobs.add(Number(lot.industryJobId));
  }
  const touchedCharacters = new Set<string>();

  for (const project of projects) {
    const snapshot = snapshotsById.get(String(project.createdByCharacterId));
    if (!snapshot || project.status === "archived") continue;
    const existingLots = [...(project.productionLots ?? [])];
    let produced = existingLots.reduce((sum, lot) => sum + Math.max(0, Number(lot.quantity ?? 0)), 0);
    const remainingTarget = () => Math.max(0, Number(project.quantity) - produced);
    const candidates = jobsForSnapshot(snapshot)
      .filter((job) => safelyMatchesProject(job, project))
      .filter((job) => !claimedJobs.has(Number(job.job_id)))
      .sort((a, b) => Date.parse(jobCompletion(a)) - Date.parse(jobCompletion(b)) || Number(a.job_id) - Number(b.job_id));

    for (const job of candidates) {
      const remaining = remainingTarget();
      if (remaining <= 0) break;
      const jobRuns = Math.max(1, Number(job.successful_runs ?? job.runs ?? 1));
      const quantity = Math.min(remaining, jobRuns * Math.max(1, Number(project.outputPerRun ?? 1)));
      const materialShare = project.estimatedMaterialCost == null || project.quantity <= 0
        ? 0
        : Number(project.estimatedMaterialCost) * (quantity / project.quantity);
      const jobCost = Math.max(0, Number(job.cost ?? 0));
      const attributedProductionCost = Math.max(0, materialShare + jobCost);
      const lotRatio = project.quantity > 0 ? quantity / project.quantity : 0;
      const materialRequirements = (project.requirements ?? []).map((line) => ({ ...line, required: Math.max(0, Math.round(Number(line.required ?? 0) * lotRatio)) }));
      const lot: FoundryProductionLot = {
        id: productionLotIdentifier(jobCompletion(job), Number(job.job_id)),
        industryJobId: Number(job.job_id),
        productTypeId: project.productTypeId,
        quantity,
        producedAt: jobCompletion(job),
        attributedProductionCost,
        materialReferenceValue: materialShare,
        jobCost,
        materialRequirements,
        soldQuantity: 0,
        remainingQuantity: quantity,
        realisedRevenue: 0,
        realisedProfit: 0,
        reconciliationStatus: "estimated",
      };
      existingLots.push(lot);
      produced += quantity;
      claimedJobs.add(lot.industryJobId);
    }

    for (const lot of existingLots) {
      const lotRatio = project.quantity > 0 ? Number(lot.quantity ?? 0) / Number(project.quantity) : 0;
      const materialReferenceValue = Number.isFinite(Number(lot.materialReferenceValue))
        ? Math.max(0, Number(lot.materialReferenceValue))
        : Math.max(0, Number(project.estimatedMaterialCost ?? 0) * lotRatio);
      const jobCost = Number.isFinite(Number(lot.jobCost))
        ? Math.max(0, Number(lot.jobCost))
        : Math.max(0, Number(lot.attributedProductionCost ?? 0) - materialReferenceValue);
      const materialRequirements = Array.isArray(lot.materialRequirements) && lot.materialRequirements.length
        ? lot.materialRequirements
        : (project.requirements ?? []).map((line) => ({ ...line, required: Math.max(0, Math.round(Number(line.required ?? 0) * lotRatio)) }));
      upsertIndustryProductionLot({
        characterId: project.createdByCharacterId,
        characterName: project.createdByCharacterName,
        sourceKey: `foundry:${project.id}:lot:${lot.id}`,
        title: `${project.name} · ${project.productName}`,
        productionLotId: lot.id,
        productionCompletedAt: lot.producedAt,
        productTypeId: project.productTypeId,
        productName: project.productName,
        quantity: lot.quantity,
        attributedProductionCost: lot.attributedProductionCost,
        materialReferenceValue,
        jobCost,
        materialRequirements,
        projectCreatedAt: project.createdAt,
        industryJobId: lot.industryJobId,
        projectId: project.id,
      });
      touchedCharacters.add(project.createdByCharacterId);
    }

    const interim: FoundryProject = {
      ...project,
      industryJobIds: existingLots.map((lot) => lot.industryJobId),
      productionLots: existingLots,
      producedQuantity: produced,
      remainingQuantity: Math.max(0, project.quantity - produced),
      attributedProductionCost: existingLots.reduce((sum, lot) => sum + Number(lot.attributedProductionCost ?? 0), 0),
      lifecycleStatus: produced >= project.quantity ? "produced" : produced > 0 ? "producing" : "planning",
      updatedAt: existingLots.length !== (project.productionLots ?? []).length ? new Date().toISOString() : project.updatedAt,
    };
    saveProjectFoundryProject(interim);
  }

  const ledger = reconcileProfitLedger(characterId) as any[];
  const byLot = new Map(ledger.flatMap((record) => {
    const lotId = String(record?.metadata?.productionLotId ?? "");
    return lotId ? [[lotId, record] as const] : [];
  }));

  for (const project of projects) {
    const current = (listProjectFoundryProjects(project.corporationId) as FoundryProject[]).find((item) => item.id === project.id) ?? project;
    const lots = (current.productionLots ?? []).map((lot) => {
      const record = byLot.get(lot.id);
      const soldQuantity = Array.isArray(record?.allocations) ? record.allocations.reduce((sum: number, row: any) => sum + Number(row.quantityAllocated ?? 0), 0) : 0;
      return {
        ...lot,
        soldQuantity,
        remainingQuantity: Math.max(0, lot.quantity - soldQuantity),
        realisedRevenue: Number(record?.actualRevenue ?? 0),
        realisedProfit: Number(record?.actualProfit ?? 0),
        reconciliationStatus: record?.reconciliationStatus ?? "estimated",
      } as FoundryProductionLot;
    });
    const producedQuantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
    const soldQuantity = lots.reduce((sum, lot) => sum + lot.soldQuantity, 0);
    const lifecycleStatus: FoundryProject["lifecycleStatus"] = soldQuantity >= project.quantity && project.quantity > 0
      ? "sold" : soldQuantity > 0 ? "partially-sold" : producedQuantity >= project.quantity ? "produced" : producedQuantity > 0 ? "producing" : "planning";
    saveProjectFoundryProject({
      ...current,
      productionLots: lots,
      industryJobIds: lots.map((lot) => lot.industryJobId),
      producedQuantity,
      soldQuantity,
      remainingQuantity: Math.max(0, producedQuantity - soldQuantity),
      realisedRevenue: lots.reduce((sum, lot) => sum + lot.realisedRevenue, 0),
      realisedProfit: lots.reduce((sum, lot) => sum + lot.realisedProfit, 0),
      attributedProductionCost: lots.reduce((sum, lot) => sum + lot.attributedProductionCost, 0),
      lifecycleStatus,
    });
  }
  return { projects: projects.length, characters: touchedCharacters.size, ledgerRecords: ledger.length };
}