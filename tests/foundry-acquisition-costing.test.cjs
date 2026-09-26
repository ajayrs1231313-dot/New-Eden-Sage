const assert = require('node:assert/strict');
const { priceFoundrySellDepth } = require('../dist-electron/foundry-material-acquisition.js');

const depth = priceFoundrySellDepth([
  { price: 5, volumeRemain: 100, regionName: 'The Forge', locationName: 'Jita' },
  { price: 1, volumeRemain: 10, regionName: 'Domain', locationName: 'Amarr' },
], 50);

assert.equal(depth.filled, true);
assert.equal(depth.totalCost, 210);
assert.equal(depth.averageUnitPrice, 4.2);
assert.equal(depth.orderCount, 2);
assert.equal(depth.location, 'Multiple locations');
assert.equal(depth.region, 'Multiple regions');

const insufficient = priceFoundrySellDepth([
  { price: 0.02, volumeRemain: 10, regionName: 'Kor-Azor', locationName: 'Danyana' },
], 2300);

assert.equal(insufficient.filled, false);
assert.equal(insufficient.totalCost, null);
assert.equal(insufficient.averageUnitPrice, null);

console.log(JSON.stringify({ weightedSellDepth: true, insufficientDepthRejected: true }));
