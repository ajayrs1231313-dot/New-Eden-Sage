const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const root = path.join(__dirname, "..");
const {
  searchIndustrialBlueprints,
  analyzeManufacturingPlan,
  getIndustrialProductionTree,
} = require("../dist-electron/industrial-engine.js");
const {
  analyzeFoundryProject,
  searchFoundryBlueprintCatalogue,
} = require("../dist-electron/project-foundry.js");

const CASES = [
  ["frigate","Rifter"],["frigate","Merlin"],["frigate","Punisher"],["frigate","Tristan"],
  ["destroyer","Thrasher"],["destroyer","Catalyst"],
  ["cruiser","Caracal"],["cruiser","Thorax"],["cruiser","Omen"],["cruiser","Rupture"],
  ["battlecruiser","Drake"],["battlecruiser","Hurricane"],["battlecruiser","Harbinger"],["battlecruiser","Brutix"],
  ["battleship","Raven"],["battleship","Megathron"],["battleship","Abaddon"],["battleship","Tempest"],
  ["industrial-ship","Venture"],["industrial-ship","Retriever"],["industrial-ship","Hulk"],["industrial-ship","Orca"],
  ["turret","200mm AutoCannon"],["launcher","Heavy Missile Launcher"],["launcher","Light Missile Launcher"],
  ["turret","Heavy Neutron Blaster"],["turret","425mm Railgun"],["turret","Focused Medium Pulse Laser"],
  ["tank-module","Damage Control"],["tank-module","Medium Armor Repairer"],["tank-module","Large Shield Booster"],
  ["propulsion","10MN Afterburner"],["propulsion","50MN Microwarpdrive"],["tackle","Warp Disruptor"],["tackle","Stasis Webifier"],
  ["damage-module","Ballistic Control System"],["damage-module","Gyrostabilizer"],["damage-module","Heat Sink"],["damage-module","Magnetic Field Stabilizer"],
  ["drone","Hobgoblin"],["drone","Warrior"],["drone","Vespa"],["drone","Hammerhead"],["drone","Ogre"],["drone","Wasp"],["drone","Mining Drone"],
  ["ammo","Antimatter Charge"],["ammo","Scourge Heavy Missile"],["ammo","Inferno Heavy Missile"],["ammo","EMP M"],["ammo","Fusion M"],["ammo","Multifrequency M"],["ammo","Void M"],["ammo","Barrage M"],
  ["probe","Core Scanner Probe"],["probe","Combat Scanner Probe"],
  ["rig","Medium Core Defense Field Extender"],["rig","Medium Trimark Armor Pump"],["rig","Medium Capacitor Control Circuit"],
  ["deployable","Mobile Tractor Unit"],["deployable","Mobile Depot"],
  ["structure","Athanor"],["structure","Raitaru"],
  ["capital-component","Capital Cargo Bay"],["capital-component","Capital Capacitor Battery"],["capital-component","Capital Armor Plates"],
  ["fighter","Templar"],["fighter","Firbolg"],["subsystem","Proteus Defensive"],
];

function assertFinitePositive(value, label) {
  assert(Number.isFinite(Number(value)), `${label} must be finite`);
  assert(Number(value) > 0, `${label} must be > 0`);
}

function makeProject(row, plan, tree, index) {
  return {
    id: `stress-${index}-${row.blueprintTypeId}`,
    corporationId: "stress-corp",
    corporationName: "Foundry Stress Test Corp",
    createdByCharacterId: "stress-character",
    createdByCharacterName: "Foundry Stress Pilot",
    name: `Stress ${row.productName}`,
    status: "planning",
    mode: "solo",
    blueprintSource: "manual",
    blueprintTypeId: Number(plan.blueprintTypeId),
    blueprintName: String(plan.blueprintName),
    productTypeId: Number(plan.productTypeId),
    productName: String(plan.productName),
    quantity: Number(plan.outputQuantity),
    outputPerRun: Number(plan.productPerRun),
    materialEfficiency: Number(plan.materialEfficiency),
    timeEfficiency: Number(plan.timeEfficiency),
    requirements: (plan.materials ?? []).map((material) => ({
      typeId: Number(material.typeId),
      name: String(material.name),
      required: Number(material.required),
    })),
    buildTree: tree.nodes,
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
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
  };
}

(async () => {
  const start = performance.now();
  const seenBlueprints = new Set();
  const categoryCounts = new Map();
  const projects = [];
  const timings = [];
  const errors = [];

  for (let index = 0; index < CASES.length; index += 1) {
    const [category, query] = CASES[index];
    const caseStarted = performance.now();
    try {
      const catalogue = await searchFoundryBlueprintCatalogue({ query, limit: 8 });
      assert(catalogue.length > 0, `${query}: Foundry catalogue returned no blueprint`);
      const row = catalogue[0];
      assertFinitePositive(row.blueprintTypeId, `${query} blueprintTypeId`);
      assertFinitePositive(row.productTypeId, `${query} productTypeId`);
      assert(!/^Blueprint \d+$/.test(String(row.blueprintName)), `${query}: blueprint name unresolved`);
      assert(!/^Type \d+$/.test(String(row.productName)), `${query}: product name unresolved`);
      assert(!seenBlueprints.has(row.blueprintTypeId), `${query}: duplicate blueprint ${row.blueprintTypeId}`);
      seenBlueprints.add(row.blueprintTypeId);
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);

      const me = index % 3 === 0 ? 10 : index % 3 === 1 ? 5 : 0;
      const te = index % 4 === 0 ? 20 : index % 4 === 1 ? 10 : 0;
      const targetQuantity = 1 + (index % 5);

      const planStarted = performance.now();
      const plan = await analyzeManufacturingPlan({
        blueprintTypeId: Number(row.blueprintTypeId),
        materialEfficiency: me,
        timeEfficiency: te,
        targetQuantity,
        assets: [],
        snapshot: { characterId: "stress-character", character: { name: "Foundry Stress Pilot" }, skills: { skills: [] } },
      });
      const planMs = performance.now() - planStarted;

      assert.equal(plan.blueprintTypeId, row.blueprintTypeId, `${query}: wrong blueprint returned from plan`);
      assert.equal(plan.productTypeId, row.productTypeId, `${query}: wrong product returned from plan`);
      assert.equal(plan.blueprintName, row.blueprintName, `${query}: blueprint display name mismatch`);
      assert.equal(plan.productName, row.productName, `${query}: product display name mismatch`);
      assertFinitePositive(plan.productPerRun, `${query} productPerRun`);
      assertFinitePositive(plan.runs, `${query} runs`);
      assertFinitePositive(plan.outputQuantity, `${query} outputQuantity`);
      assert(plan.outputQuantity >= targetQuantity, `${query}: output does not satisfy target quantity`);
      assert(Array.isArray(plan.materials) && plan.materials.length > 0, `${query}: no manufacturing materials`);

      for (const material of plan.materials) {
        assertFinitePositive(material.typeId, `${query}/${material.name} typeId`);
        assertFinitePositive(material.required, `${query}/${material.name} required`);
        assert(!/^Type \d+$/.test(String(material.name)), `${query}: unresolved material name ${material.name}`);
        assert(Number(material.missing) >= 0, `${query}: negative missing quantity`);
      }

      const treeStarted = performance.now();
      const tree = await getIndustrialProductionTree({
        blueprintTypeId: Number(row.blueprintTypeId),
        runs: Number(plan.runs),
        materialEfficiency: me,
        maxDepth: 6,
      });
      const treeMs = performance.now() - treeStarted;

      assert(Array.isArray(tree.nodes) && tree.nodes.length > 1, `${query}: production tree did not expand`);
      const rootNode = tree.nodes.find((node) => Number(node.depth) === 0);
      assert(rootNode, `${query}: missing production-tree root`);
      assert.equal(rootNode.typeId, row.productTypeId, `${query}: production-tree root product mismatch`);
      assert.equal(rootNode.blueprintTypeId, row.blueprintTypeId, `${query}: production-tree root blueprint mismatch`);
      assert.equal(rootNode.name, row.productName, `${query}: production-tree display name mismatch`);
      const nodeIds = new Set();
      for (const node of tree.nodes) {
        assert(!nodeIds.has(node.id), `${query}: duplicate tree node id ${node.id}`);
        nodeIds.add(node.id);
        assertFinitePositive(node.typeId, `${query}/tree typeId`);
        assertFinitePositive(node.required, `${query}/tree required`);
        assert(Number(node.depth) >= 0 && Number(node.depth) <= 6, `${query}: invalid tree depth ${node.depth}`);
        assert(!/^Type \d+$/.test(String(node.name)), `${query}: unresolved tree node name ${node.name}`);
        if (node.kind === "component") {
          assertFinitePositive(node.blueprintTypeId, `${query}/component blueprintTypeId`);
          assert(node.blueprintName && !/^Blueprint \d+$/.test(String(node.blueprintName)), `${query}: unresolved component blueprint`);
          assertFinitePositive(node.runs, `${query}/component runs`);
          assertFinitePositive(node.outputPerRun, `${query}/component outputPerRun`);
        }
      }

      const project = makeProject(row, plan, tree, index);
      const empty = analyzeFoundryProject(project, [project], []);
      assert.equal(empty.productName, row.productName);
      assert.equal(empty.blueprintName, row.blueprintName);
      assert.equal(empty.progress, 0, `${query}: empty project should start at 0%`);
      assert.equal(empty.finalAssembly.ready, false, `${query}: empty project should be blocked`);
      assert(empty.finalAssembly.blockerCount > 0, `${query}: empty project has no blockers`);
      assert(empty.missingUnits > 0, `${query}: empty project has no missing units`);
      assert.equal(empty.requirements.length, plan.materials.length, `${query}: requirement rows changed in Foundry analysis`);

      const fullAssets = project.requirements.map((line, assetIndex) => ({
        item_id: index * 10000 + assetIndex + 1,
        type_id: line.typeId,
        quantity: line.required,
        location_id: 60000001,
        location_flag: "Hangar",
        location_type: "station",
      }));
      const full = analyzeFoundryProject(project, [project], fullAssets);
      assert.equal(full.progress, 1, `${query}: exact stock did not produce 100% material progress`);
      assert.equal(full.finalAssembly.ready, true, `${query}: exact stock did not clear final assembly`);
      assert.equal(full.finalAssembly.blockerCount, 0, `${query}: blockers remain with exact stock`);
      assert.equal(full.missingUnits, 0, `${query}: missing units remain with exact stock`);
      assert(full.requirements.every((line) => line.outstanding === 0), `${query}: a requirement remains outstanding with exact stock`);

      const oversizedAssets = project.requirements.map((line, assetIndex) => ({
        item_id: index * 10000 + assetIndex + 5000,
        type_id: line.typeId,
        quantity: line.required + 7,
        location_id: 60000001,
        location_flag: "Hangar",
        location_type: "station",
      }));
      const surplus = analyzeFoundryProject(project, [project], oversizedAssets);
      assert.equal(surplus.progress, 1, `${query}: surplus stock reduced progress`);
      assert(surplus.requirements.every((line) => line.surplus === 7), `${query}: surplus quantities are wrong`);

      JSON.stringify(empty);
      JSON.stringify(full);
      projects.push(project);
      timings.push({
        category,
        query,
        blueprint: row.blueprintName,
        product: row.productName,
        materials: plan.materials.length,
        nodes: tree.nodes.length,
        depth: Math.max(...tree.nodes.map((node) => Number(node.depth))),
        planMs: Number(planMs.toFixed(1)),
        treeMs: Number(treeMs.toFixed(1)),
      });
    } catch (error) {
      errors.push({ category, query, error: error instanceof Error ? error.stack ?? error.message : String(error) });
    }
  }

  assert.equal(errors.length, 0, `Foundry blueprint failures:\n${errors.map((row) => `${row.query}: ${row.error}`).join("\n")}`);
  assert.equal(projects.length, CASES.length, "Not every stress blueprint produced a Foundry project");
  assert(projects.length >= 60, "Stress set must contain at least 60 blueprints");

  const allProjectIds = new Set(projects.map((project) => project.id));
  assert.equal(allProjectIds.size, projects.length, "Generated Foundry project IDs are not unique");

  const uiSource = fs.readFileSync(path.join(root, "src/IndustrialProjectFoundry.tsx"), "utf8");
  assert(uiSource.includes("activeProjects.map((row: any)"), "Project picker must render the full active project collection");
  assert(!uiSource.includes("(workspace?.projects ?? []).map((row: any) => <option"), "Completed projects must not leak into the active project selector");
  assert(uiSource.includes("owned.map((row, index)"), "Owned-blueprint picker must render the full synced blueprint collection");
  assert(!uiSource.includes("owned.slice("), "Owned-blueprint picker must not truncate large blueprint collections");
  assert(uiSource.includes("sage-asset://type/${productTypeId}/render?size=128"), "Foundry product output must use the real EVE product render");
  assert(uiSource.includes('sage-asset://type/" + row.typeId + "/icon?size=64'), "Foundry material rows must use real EVE type icons");

  const serializedWorkspace = JSON.stringify({ projects, selectedProject: projects[0] });
  assert(serializedWorkspace.length > 10000, "Large Foundry workspace serialization unexpectedly empty");

  const categories = Object.fromEntries([...categoryCounts.entries()].sort(([a],[b]) => a.localeCompare(b)));
  const totalMs = performance.now() - start;
  const slowest = timings.slice().sort((a,b) => (b.planMs+b.treeMs) - (a.planMs+a.treeMs)).slice(0,10);
  const largestTrees = timings.slice().sort((a,b) => b.nodes - a.nodes).slice(0,10);
  console.log(JSON.stringify({
    blueprintsTested: projects.length,
    categories,
    totalMs: Number(totalMs.toFixed(1)),
    averageMsPerBlueprint: Number((totalMs / projects.length).toFixed(1)),
    slowest,
    largestTrees,
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
