const assert = require('node:assert/strict');
const { discoverStores } = require('../dist-electron/project-foundry.js');

(async () => {
  const snapshot = {
    location: {
      structure_id: 9000000000003,
      place_name: 'Current Dock',
      solar_system_name: 'Current System',
    },
    extended: {
      assets: [
        {
          item_id: 1,
          type_id: 34,
          quantity: 1,
          root_location_id: 9000000000002,
          station: 'Personal Asset Structure',
          system: 'Personal System',
        },
      ],
      corporation: {
        assets: [
          {
            item_id: 2,
            type_id: 34,
            quantity: 1,
            root_location_id: 60000001,
            station: 'Corporation Asset Station',
            system: 'Corp System',
            location_flag: 'CorpSAG1',
          },
        ],
        assetNames: [],
        divisions: { hangar: [{ division: 1, name: 'Mining Division' }] },
        structures: [
          {
            structure_id: 9000000000001,
            name: 'Corporation Athanor',
            solar_system_name: 'Structure System',
          },
        ],
      },
    },
  };

  const stores = await discoverStores(snapshot);
  const byId = new Map(stores.stations.map((row) => [row.rootLocationId, row]));

  assert.equal(byId.get(60000001)?.name, 'Corporation Asset Station');
  assert.equal(byId.get(9000000000001)?.name, 'Corporation Athanor');
  assert.equal(byId.get(9000000000002)?.name, 'Personal Asset Structure');
  assert.equal(byId.get(9000000000003)?.name, 'Current Dock');

  console.log(JSON.stringify({
    corporationAssetLocations: true,
    corporationStructures: true,
    personalAssetStructures: true,
    currentDock: true,
  }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
