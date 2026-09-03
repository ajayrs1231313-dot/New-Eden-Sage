const assert = require('node:assert/strict');
const timing = require('../../dist-electron/pve-clear-time.js');

const approx = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon, actual + ' != ' + expected);
const targets = [
  { id:'a', priority:0, ttkSeconds:10, position:{xM:30000,yM:0}, requiredForClear:true },
  { id:'b', priority:0, ttkSeconds:10, position:{xM:35000,yM:0}, requiredForClear:true },
  { id:'c', priority:0, ttkSeconds:10, position:{xM:42000,yM:0}, requiredForClear:true },
  { id:'d', priority:0, ttkSeconds:10, position:{xM:82000,yM:0}, requiredForClear:true },
];

const mobile = timing.calculatePveRoomClearTime({
  targets,
  geometry:'exact',
  droneTravel:{mode:'mobile', effectiveVelocityMps:1000},
});
assert.deepEqual(mobile.route.map((leg) => leg.targetId), ['a','b','c','d']);
approx(mobile.droneNavigationDistanceM, 82000);
approx(mobile.droneNavigationSeconds, 82);
approx(mobile.combatSeconds, 40);
approx(mobile.estimatedClearSeconds, 122);
assert.ok(mobile.droneNavigationDistanceM < 30000 + 35000 + 42000 + 82000, 'routing regressed to repeated ship-to-target travel');

const fast = timing.calculatePveRoomClearTime({
  targets,
  geometry:'exact',
  droneTravel:{mode:'mobile', effectiveVelocityMps:2000},
});
approx(fast.droneNavigationSeconds, 41);
approx(fast.combatSeconds, mobile.combatSeconds);

const sentry = timing.calculatePveRoomClearTime({
  targets,
  geometry:'exact',
  droneTravel:{mode:'sentry', effectiveVelocityMps:0},
});
approx(sentry.droneNavigationSeconds, 0);
approx(sentry.estimatedClearSeconds, 40);

const priorityRoute = timing.calculatePveRoomClearTime({
  targets:[
    {id:'near-low', priority:1, ttkSeconds:1, position:{xM:1000,yM:0}},
    {id:'far-high', priority:0, ttkSeconds:1, position:{xM:10000,yM:0}},
    {id:'near-high', priority:0, ttkSeconds:1, position:{xM:12000,yM:0}},
  ],
  geometry:'exact',
  droneTravel:{mode:'mobile', effectiveVelocityMps:1000},
});
assert.deepEqual(priorityRoute.route.map((leg) => leg.targetId), ['far-high','near-high','near-low']);

const site = timing.aggregatePveSiteClearTime([mobile, fast, sentry]);
approx(site.combatSeconds, 120);
approx(site.droneNavigationSeconds, 123);
approx(site.estimatedClearSeconds, 243);
assert.equal(timing.PVE_CLEAR_TIME_CAVEAT, 'Estimated clear time includes combat and drone navigation. Ship travel time is not included.');

const estimated = timing.estimateClusteredPveGeometry([
  {id:'group-a', count:3, priority:0, ttkSeconds:5},
  {id:'group-b', count:2, priority:1, ttkSeconds:7},
], {initialTargetRangeM:30000, engagementRangeM:4000});
assert.equal(estimated.length, 5);
approx(Math.hypot(estimated[0].position.xM, estimated[0].position.yM), 26000);

console.log('PvE clear-time routing regression: PASS');
