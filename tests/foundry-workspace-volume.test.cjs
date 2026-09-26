const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "new-eden-sage-foundry-volume-"));
process.env.NEW_EDEN_SAGE_USER_DATA = tempRoot;

const { configureSnapshotEncryptionKey } = require("../dist-electron/snapshot-crypto.js");
const { saveSnapshot, saveProjectFoundryProject, listProjectFoundryProjects } = require("../dist-electron/database.js");
const { getFoundryWorkspace } = require("../dist-electron/project-foundry.js");

configureSnapshotEncryptionKey(Buffer.alloc(32, 0x5a).toString("base64"));

const characterId = "90000001";
const corporationId = 98000001;
const now = "2026-09-23T12:00:00.000Z";

saveSnapshot({
  characterId,
  character: {
    name: "Foundry Volume Pilot",
    corporation_id: corporationId,
    corporation_name: "Foundry Volume Corp",
  },
  updatedAt: now,
  location: {
    station_id: 60003760,
    solar_system_id: 30000142,
    solar_system_name: "Jita",
    place_name: "Jita IV - Moon 4 - Caldari Navy Assembly Plant",
  },
  extended: {
    assets: [],
    corporation: {
      assets: [],
      assetNames: [],
      members: [Number(characterId)],
      divisions: { hangar: [] },
      structures: [],
    },
  },
});

const total = 75;
const completed = 15;
for (let index = 0; index < total; index += 1) {
  const status = index < completed ? "complete" : index % 11 === 0 ? "archived" : "planning";
  const stamp = new Date(Date.parse(now) + index * 1000).toISOString();
  saveProjectFoundryProject({
    id: `volume-${String(index).padStart(3, "0")}`,
    corporationId: String(corporationId),
    corporationName: "Foundry Volume Corp",
    createdByCharacterId: characterId,
    createdByCharacterName: "Foundry Volume Pilot",
    name: `Volume Project ${String(index).padStart(3, "0")}`,
    status,
    mode: index % 2 ? "solo" : "corporation",
    blueprintSource: index % 3 ? "owned" : "manual",
    blueprintTypeId: 691 + index,
    blueprintName: `Stress Blueprint ${index}`,
    productTypeId: 587 + index,
    productName: `Stress Product ${index}`,
    quantity: 1 + (index % 9),
    outputPerRun: 1,
    materialEfficiency: index % 11,
    timeEfficiency: index % 21,
    requirements: [
      { typeId: 34, name: "Tritanium", required: 100 + index },
      { typeId: 35, name: "Pyerite", required: 50 + index },
    ],
    buildTree: [],
    assignments: [],
    groups: [],
    workPackages: [],
    linkedStores: [],
    storeRoutes: [],
    industryJobIds: [],
    productionLots: [],
    producedQuantity: status === "complete" ? 1 : 0,
    soldQuantity: 0,
    remainingQuantity: status === "complete" ? 0 : 1,
    estimatedMaterialCost: null,
    attributedProductionCost: 0,
    realisedRevenue: 0,
    realisedProfit: 0,
    lifecycleStatus: status === "complete" ? "complete" : "planning",
    createdAt: stamp,
    updatedAt: stamp,
    completedAt: status === "complete" ? stamp : undefined,
    completionSource: status === "complete" ? "built" : undefined,
  });
}

(async () => {
  const stored = listProjectFoundryProjects(String(corporationId));
  assert.equal(stored.length, total, "Foundry persistence truncated a large project set");

  const workspace = await getFoundryWorkspace(characterId, "volume-074");
  assert.equal(workspace.projects.length, total, "Workspace truncated a large project set");
  assert.equal(workspace.projects.filter((project) => project.status === "complete").length, completed, "Completed history count changed");
  assert.equal(workspace.projects.filter((project) => project.status !== "complete").length, total - completed, "Active project count changed");
  assert.equal(workspace.selectedProject.id, "volume-074", "Large workspace failed to select a late project");
  assert(workspace.projects.every((project) => project.requirements.length === 2), "A project lost requirement rows during workspace analysis");
  assert(workspace.projects.every((project) => project.finalAssembly && Number.isFinite(project.progress)), "A project lost analyzed Foundry state");

  const source = fs.readFileSync(path.join(__dirname, "..", "src", "IndustrialProjectFoundry.tsx"), "utf8");
  assert(source.includes("activeProjects.map((row: any)"), "Active project picker is not volume-safe");
  assert(source.includes("completedProjects"), "Completed projects must remain available to History");
  assert(!source.includes("(workspace?.projects ?? []).map((row: any) => <option"), "Completed History projects must not be rendered in the active project selector");

  console.log(JSON.stringify({
    persistedProjects: stored.length,
    workspaceProjects: workspace.projects.length,
    activeProjects: total - completed,
    completedHistory: completed,
    lateSelection: workspace.selectedProject.id,
  }));
})().finally(() => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
