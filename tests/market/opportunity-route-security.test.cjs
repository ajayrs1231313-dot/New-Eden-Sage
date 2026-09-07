const assert = require('node:assert/strict');
const { toPersonalTrade, toPersonalShortage } = require('../../dist-electron/opportunity-engine.js');
const { routeSecurityAcrossMinimumStatuses } = require('../../dist-electron/regional-shortage.js');

assert.equal(routeSecurityAcrossMinimumStatuses(0.9, 0.6, 0.45), 'high', 'all-high route should be HIGH SEC');
assert.equal(routeSecurityAcrossMinimumStatuses(0.9, 0.2, 0.7), 'low', 'any low-sec leg should make the route LOW SEC');
assert.equal(routeSecurityAcrossMinimumStatuses(0.9, 0.2, -0.1), 'null', 'any null-sec leg should take precedence over low-sec');

const personalTrade = toPersonalTrade({
  id: 'trade:1', typeId: 34, item: 'Tritanium', categoryId: 4, category: 'Material',
  sell: { orderId: 1, price: 4, volumeRemain: 1000, systemId: 30000142, systemName: 'Jita', locationId: 60003760, locationName: 'Jita IV - Moon 4', regionName: 'The Forge' },
  buy: { orderId: 2, price: 5, volumeRemain: 1000, minVolume: 1, systemId: 30002187, systemName: 'Amarr', locationId: 60008494, locationName: 'Amarr VIII', regionName: 'Domain' },
  units: 100, availableUnits: 1000, itemVolumeM3: 0.01, cargoM3: 1, investment: 400, profit: 100,
  marginPercent: 25, iskPerM3: 100, iskPerJump: 10, capitalEfficiencyPercent: 25, jumps: 10, estimatedMinutes: 28,
  fillScore: 90, risk: 'Low', routeSecurity: 'null', currentSpread: 1, previousSpread: 0.5, spreadChange: 0.5,
  spreadChangePercent: 100, spreadComparisonGeneration: 'prev', spreadComparisonSnapshotId: 'prev', spreadComparisonGeneratedAt: '2026-09-07T16:00:00Z',
  marginWidenedBy: 0.5, score: 95, scoreBreakdown: { profit: 95, fill: 90, route: 10, capitalEfficiency: 80, cargoEfficiency: 90 }, reasons: ['fixture'],
});
assert.equal(personalTrade.routeSecurity, 'null', 'trade route security must be propagated directly, even when generic risk says Low');

const target = { bestBuyVolume: 50, bestSellVolume: 0 };
const source = { bestSellVolume: 50 };
const personalShortage = toPersonalShortage({
  id: 'shortage:1', typeId: 35, item: 'Pyerite', category: 'Material', itemVolumeM3: 0.01,
  target, source, sourcePrice: 10, targetSellPrice: 14, targetBuyPrice: 13, regionalPremiumPercent: 40,
  executableMarginPercent: 30, demandPressure: 50, supplyGap: false, score: 80, confidenceScore: 75,
  risk: 'Low', routeSecurity: 'low', jumpsFromCharacter: 8, estimatedMinutes: 24, reasons: ['fixture'],
});
assert.equal(personalShortage.routeSecurity, 'low', 'shortage route security must be propagated directly, not inferred from risk');
assert.equal(personalShortage.risk, 'Low', 'fixture deliberately keeps risk separate from route security');

console.log('PersonalOpportunity route-security propagation and precedence checks passed.');
