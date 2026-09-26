const assert = require('node:assert/strict');
const { collectBoundAssets } = require('../dist-electron/project-foundry.js');

const assets = [
  { item_id: 1, type_id: 34, quantity: 100, location_id: 600001, location_flag: 'CorpSAG1', location_type: 'station', root_location_id: 600001, station: 'Station A' },
  { item_id: 2, type_id: 34, quantity: 200, location_id: 600002, location_flag: 'CorpSAG1', location_type: 'station', root_location_id: 600002, station: 'Station B' },
];

const scoped = collectBoundAssets([
  { kind: 'division', key: 'division:600001:CorpSAG1', locationFlag: 'CorpSAG1', rootLocationId: 600001, station: 'Station A', name: 'Mining Division' },
], assets);

assert.equal(scoped.length, 1);
assert.equal(scoped[0].item_id, 1);

const legacy = collectBoundAssets([
  { kind: 'division', key: 'division:CorpSAG1', locationFlag: 'CorpSAG1', name: 'Mining Division' },
], assets);

assert.equal(legacy.length, 2);

console.log(JSON.stringify({ stationScopedDivisionStore: true, legacyDivisionBindingStillSupported: true }));
