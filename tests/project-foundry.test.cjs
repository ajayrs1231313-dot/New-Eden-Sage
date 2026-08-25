const assert = require('node:assert/strict');
const { collectBoundAssets, sumBoundStock, analyzeFoundryProject, safelyMatchesProject, productionLotIdentifier } = require('../dist-electron/project-foundry.js');

const assets = [
  { item_id: 100, type_id: 3465, quantity: 1, location_id: 600001, location_flag: 'CorpSAG1', location_type: 'station', is_singleton: true },
  { item_id: 101, type_id: 34, quantity: 800, location_id: 100, location_flag: 'Unlocked', location_type: 'item' },
  { item_id: 102, type_id: 35, quantity: 250, location_id: 100, location_flag: 'Unlocked', location_type: 'item' },
  { item_id: 110, type_id: 3465, quantity: 1, location_id: 100, location_flag: 'Unlocked', location_type: 'item', is_singleton: true },
  { item_id: 111, type_id: 34, quantity: 300, location_id: 110, location_flag: 'Unlocked', location_type: 'item' },
  { item_id: 200, type_id: 34, quantity: 500, location_id: 600001, location_flag: 'CorpSAG2', location_type: 'station' },
];

const containerBinding = [{ kind: 'container', key: 'container:100', itemId: 100, name: 'ORCA PROJECT - MINERALS' }];
const divisionBinding = [{ kind: 'division', key: 'division:CorpSAG1', locationFlag: 'CorpSAG1', name: 'Corporation Hangar 1' }];

const containerAssets = collectBoundAssets(containerBinding, assets);
assert.equal(containerAssets.length, 4, 'container binding must include nested descendants');
const containerStock = sumBoundStock(containerBinding, assets);
assert.equal(containerStock.get(34), 1100, 'nested Tritanium must be counted once');
assert.equal(containerStock.get(35), 250, 'direct Pyerite must be counted');

const overlappingStock = sumBoundStock([...containerBinding, ...divisionBinding], assets);
assert.equal(overlappingStock.get(34), 1100, 'overlapping container + division bindings must not double count');

const baseProject = {
  id: 'orca-a', corporationId: '1', corporationName: 'Test Corp', createdByCharacterId: '1', createdByCharacterName: 'AJ',
  name: 'Build an Orca', status: 'active', blueprintTypeId: 1, blueprintName: 'Orca Blueprint', productTypeId: 2, productName: 'Orca', quantity: 1,
  materialEfficiency: 10, timeEfficiency: 20,
  requirements: [{ typeId: 34, name: 'Tritanium', required: 1000 }, { typeId: 35, name: 'Pyerite', required: 500 }],
  workPackages: [
    { id: 'materials', name: 'Materials & Supply', assignedTo: 'Mining Division', status: 'in-progress', typeIds: [34, 35], kind: 'materials' },
    { id: 'final', name: 'Final Assembly', assignedTo: 'Capital Division', status: 'open', typeIds: [34, 35], kind: 'final' },
  ],
  linkedStores: containerBinding,
  createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z',
};

const analyzed = analyzeFoundryProject(baseProject, [baseProject], assets);
assert.equal(analyzed.requirements[0].delivered, 1000);
assert.equal(analyzed.requirements[0].surplus, 100);
assert.equal(analyzed.requirements[1].delivered, 250);
assert.equal(analyzed.requirements[1].outstanding, 250);
assert.equal(analyzed.progress, 1250 / 1500);
assert.equal(analyzed.workPackages[1].ready, false);

const competing = {
  ...baseProject,
  id: 'orca-b', name: 'Second Orca',
  requirements: [{ typeId: 34, name: 'Tritanium', required: 400 }],
};
const reserved = analyzeFoundryProject(baseProject, [baseProject, competing], assets);
assert.equal(reserved.requirements[0].reservedByOtherProjects, 400);
assert.equal(reserved.requirements[0].delivered, 700);
assert.equal(reserved.storeConflicts.length, 1);


const matchingJob = { job_id: 9001, installer_id: 1, activity_id: 1, blueprint_type_id: 1, product_type_id: 2, runs: 1, status: 'delivered', start_date: '2026-08-23T00:10:00.000Z', end_date: '2026-08-23T01:00:00.000Z' };
assert.equal(safelyMatchesProject(matchingJob, baseProject), true, 'matching delivered manufacturing job should associate');
assert.equal(safelyMatchesProject({ ...matchingJob, product_type_id: 999 }, baseProject), false, 'same-time unrelated product must not associate');
assert.equal(safelyMatchesProject({ ...matchingJob, installer_id: 2 }, baseProject), false, 'another installer must not be claimed just because blueprint/product match');
assert.equal(safelyMatchesProject({ ...matchingJob, start_date: '2026-08-22T23:00:00.000Z' }, baseProject), false, 'job started before project creation must not be claimed');

// Stable production IDs are deterministic, human-readable, and include the EVE industry job id.
{
  const id = productionLotIdentifier('2026-08-24T13:45:00.000Z', 987654321);
  assert.equal(id, 'NES-IND-20260824-987654321');
  assert.equal(productionLotIdentifier('2026-08-24T23:59:59.000Z', 987654321), id);
}
console.log(JSON.stringify({ nestedContainer: true, noDoubleCount: true, progress: analyzed.progress, reservationProtected: true, safeLifecycleMatching: true, stableProductionId: true }));
