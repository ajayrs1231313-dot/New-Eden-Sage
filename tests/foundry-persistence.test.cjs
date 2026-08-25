const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-foundry-persist-'));
const env = { ...process.env, NEW_EDEN_SAGE_USER_DATA: temp };

const legacyProject = {
  id: 'legacy-project',
  corporationId: '77',
  corporationName: 'Legacy Corp',
  createdByCharacterId: '1',
  createdByCharacterName: 'AJ',
  name: 'Legacy Orca Build',
  status: 'active',
  blueprintTypeId: 28607,
  blueprintName: 'Orca Blueprint',
  productTypeId: 28606,
  productName: 'Orca',
  quantity: 1,
  materialEfficiency: 10,
  timeEfficiency: 20,
  requirements: [{ typeId: 34, name: 'Tritanium', required: 123 }],
  workPackages: [{ id: 'materials', name: 'Materials', assignedTo: 'Industry', status: 'in-progress', typeIds: [34], kind: 'materials' }],
  linkedStores: [{ kind: 'division', key: 'division:CorpSAG1', locationFlag: 'CorpSAG1', name: 'Corporation Hangar 1' }],
  productionLots: [{ id: 'legacy-project:job:9001', industryJobId: 9001, productTypeId: 28606, quantity: 1, producedAt: '2026-08-24T00:00:00.000Z', attributedProductionCost: 987654, soldQuantity: 0, remainingQuantity: 1, realisedRevenue: 0, realisedProfit: 0, reconciliationStatus: 'estimated' }],
  industryJobIds: [9001],
  producedQuantity: 1,
  soldQuantity: 0,
  remainingQuantity: 1,
  lifecycleStatus: 'produced',
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-24T00:00:00.000Z',
};

const writer = `const db=require('./dist-electron/database.js'); const p=${JSON.stringify(JSON.stringify(legacyProject))}; db.saveProjectFoundryProject(JSON.parse(p));`;
execFileSync(process.execPath, ['-e', writer], { cwd: root, env, stdio: 'pipe' });

// A second Node process simulates a fresh Sage process reading the persisted JSON payload.
const reader = `const db=require('./dist-electron/database.js'); const p=db.listProjectFoundryProjects('77')[0]; process.stdout.write(JSON.stringify(p));`;
const reloaded = JSON.parse(execFileSync(process.execPath, ['-e', reader], { cwd: root, env, encoding: 'utf8' }));

assert.equal(reloaded.id, legacyProject.id);
assert.deepEqual(reloaded.requirements, legacyProject.requirements, 'legacy requirements must survive persistence/reload');
assert.deepEqual(reloaded.workPackages, legacyProject.workPackages, 'legacy work packages must survive persistence/reload');
assert.deepEqual(reloaded.linkedStores, legacyProject.linkedStores, 'legacy linked stores must survive persistence/reload');
assert.deepEqual(reloaded.productionLots, legacyProject.productionLots, 'production lots must survive persistence/reload');
assert.deepEqual(reloaded.industryJobIds, [9001]);
assert.equal(reloaded.lifecycleStatus, 'produced');

fs.rmSync(temp, { recursive: true, force: true });
console.log(JSON.stringify({ productionLotsReload: true, legacyPayloadPreserved: true }));
