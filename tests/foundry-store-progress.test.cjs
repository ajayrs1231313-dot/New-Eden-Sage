const assert = require('node:assert/strict');
const { analyzeFoundryProject } = require('../dist-electron/project-foundry.js');

function project() {
  return {
    id: 'layer-progress',
    mode: 'corporation',
    corporationId: '1',
    corporationName: 'Test Corp',
    createdByCharacterId: '1',
    createdByCharacterName: 'AJ',
    name: 'Capital build',
    status: 'active',
    blueprintTypeId: 1,
    blueprintName: 'Capital Blueprint',
    productTypeId: 2,
    productName: 'Capital Ship',
    quantity: 1,
    materialEfficiency: 10,
    timeEfficiency: 20,
    requirements: [{ typeId: 500, name: 'Capital Part', required: 100 }],
    buildTree: [
      { id: 'root:2', parentId: null, typeId: 2, name: 'Capital Ship', required: 1, depth: 0, kind: 'product', direct: false },
      { id: 'root:2/part:500', parentId: 'root:2', typeId: 500, name: 'Capital Part', required: 100, depth: 1, kind: 'component', direct: true },
      { id: 'root:2/part:500/material:34', parentId: 'root:2/part:500', typeId: 34, name: 'Tritanium', required: 1000, depth: 2, kind: 'material', direct: false },
    ],
    assignments: [],
    groups: [],
    workPackages: [],
    linkedStores: [{ kind: 'container', key: 'container:9000', itemId: 9000, name: 'Project Store' }],
    storeRoutes: [],
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
  };
}

function assets(partQty, materialQty) {
  return [
    { item_id: 9000, type_id: 3465, quantity: 1, location_id: 600001, location_flag: 'CorpSAG1', location_type: 'station', is_singleton: true },
    { item_id: 9001, type_id: 500, quantity: partQty, location_id: 9000, location_flag: 'Unlocked', location_type: 'item' },
    { item_id: 9002, type_id: 34, quantity: materialQty, location_id: 9000, location_flag: 'Unlocked', location_type: 'item' },
  ];
}

{
  const result = analyzeFoundryProject(project(), [project()], assets(2, 200));
  assert.equal(result.projectStoreSummary.partCoverage, 0.02);
  assert.equal(result.projectStoreSummary.materialCoverage, 0.2);
  assert.equal(result.projectStoreSummary.progress, 0.2, '20% raw materials must beat 2% completed capital parts');
  assert.equal(result.projectStoreSummary.progressSource, 'materials');
}

{
  const result = analyzeFoundryProject(project(), [project()], assets(80, 10));
  assert.equal(result.projectStoreSummary.partCoverage, 0.8);
  assert.equal(result.projectStoreSummary.materialCoverage, 0.01);
  assert.equal(result.projectStoreSummary.progress, 0.8, '80% completed capital parts must beat 1% raw materials');
  assert.equal(result.projectStoreSummary.progressSource, 'parts');
}

console.log(JSON.stringify({ highestStoreLayerWins: true }));
