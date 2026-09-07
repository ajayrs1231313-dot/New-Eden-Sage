const assert = require('node:assert/strict');
const {
  attachPreparedTradeSpreadHistory,
  preparedTradeLaneKey,
} = require('../../dist-electron/public-market-intelligence.js');

const lane = (typeId, sellOrderId, buyOrderId, sellLocationId, buyLocationId, spread) => ({
  typeId,
  sell: { orderId: sellOrderId, locationId: sellLocationId, systemId: sellLocationId + 1000, price: 100 },
  buy: { orderId: buyOrderId, locationId: buyLocationId, systemId: buyLocationId + 1000, price: 100 + spread },
  marginPerUnit: spread,
  currentSpread: spread,
});

const previous = {
  schemaVersion: 1,
  dataset: 'market-trades',
  snapshotId: '2026-09-07T16-00-00-market',
  createdAt: '2026-09-07T16:00:00.000Z',
  routeChecks: 5,
  viablePairs: 5,
  spreadComparisonGeneration: null,
  spreadComparisonSnapshotId: null,
  spreadComparisonGeneratedAt: null,
  spreadComparisonCount: 0,
  opportunities: [
    lane(34, 1001, 2001, 60003760, 60008494, 100),
    lane(34, 1002, 2002, 60003760, 60008494, 90), // same stable lane: prior best executable spread is 100
    lane(35, 1101, 2101, 60003760, 60008494, 100),
    lane(36, 1201, 2201, 60003760, 60008494, 100),
    lane(37, 1301, 2301, 60003760, 60008494, 0),
  ],
};

const current = [
  lane(34, 9001, 9901, 60003760, 60008494, 112.4), // replacement order IDs, same lane
  lane(35, 9002, 9902, 60003760, 60008494, 95),
  lane(36, 9003, 9903, 60003760, 60008494, 100),
  lane(37, 9004, 9904, 60003760, 60008494, 10),
  lane(38, 9005, 9905, 60003760, 60008494, 50), // no previous lane
];

assert.equal(
  preparedTradeLaneKey(34, previous.opportunities[0].sell, previous.opportunities[0].buy),
  preparedTradeLaneKey(34, current[0].sell, current[0].buy),
  'stable lane identity must survive exact order-ID replacement',
);

const compared = attachPreparedTradeSpreadHistory(current, {
  generation: previous.snapshotId,
  dataset: previous,
});

const widening = compared[0];
assert.equal(widening.previousSpread, 100);
assert.ok(Math.abs(widening.spreadChange - 12.4) < 1e-9);
assert.ok(Math.abs(widening.spreadChangePercent - 12.4) < 1e-9);
assert.equal(widening.marginWidenedBy, widening.spreadChange, 'compatibility field should carry absolute spread change');
assert.equal(widening.spreadComparisonSnapshotId, previous.snapshotId);
assert.equal(widening.spreadComparisonGeneratedAt, previous.createdAt);

const narrowing = compared[1];
assert.equal(narrowing.previousSpread, 100);
assert.equal(narrowing.spreadChange, -5);
assert.equal(narrowing.spreadChangePercent, -5);

const unchanged = compared[2];
assert.equal(unchanged.previousSpread, 100);
assert.equal(unchanged.spreadChange, 0, 'unchanged must remain distinct from missing history');
assert.equal(unchanged.spreadChangePercent, 0);

const fromZero = compared[3];
assert.equal(fromZero.previousSpread, 0);
assert.equal(fromZero.spreadChange, 10);
assert.equal(fromZero.spreadChangePercent, null, 'zero previous spread must not manufacture an infinite percentage');

const noHistory = compared[4];
assert.equal(noHistory.previousSpread, null);
assert.equal(noHistory.spreadChange, null);
assert.equal(noHistory.spreadChangePercent, null);
assert.equal(noHistory.marginWidenedBy, null, 'missing history must remain distinguishable from unchanged');

const highSpread = compared.filter((row) => row.spreadChange != null && row.spreadChange > 0);
assert.deepEqual(highSpread.map((row) => row.typeId), [34, 37], 'High Spread should include widening only and exclude narrowing/unchanged/no-history');

console.log('Spread-history lane continuity and calculation checks passed.');
