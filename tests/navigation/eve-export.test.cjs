const assert = require('node:assert/strict');

module.exports = async function eveExportTests() {
  const mod = require('../../dist-electron/navigation-eve-export.js');

  await assert.rejects(
    () => mod.exportNavigationWaypoints({ characterId: '', systemIds: [1] }, { getAccessToken: async () => 'x', request: async () => true }),
    /connected character/i,
  );

  const calls = [];
  const deps = {
    getAccessToken: async (characterId) => {
      assert.equal(characterId, 'fixture-character');
      return 'fixture-access-token';
    },
    request: async (characterId, url, token) => {
      calls.push({ characterId, url: new URL(url), token });
      return true;
    },
  };
  const ordered = [30000144, 30002510, 30002187];
  const result = await mod.exportNavigationWaypoints({ characterId: 'fixture-character', systemIds: ordered, clearOtherWaypoints: true }, deps);
  assert.equal(result.waypoints, ordered.length);
  assert.deepEqual(calls.map((call) => Number(call.url.searchParams.get('destination_id'))), ordered);
  assert.deepEqual(calls.map((call) => call.url.searchParams.get('clear_other_waypoints')), ['true', 'false', 'false']);
  assert(calls.every((call) => call.url.searchParams.get('add_to_beginning') === 'false'));

  const longIds = Array.from({ length: 120 }, (_, index) => 30_000_001 + index);
  let longCount = 0;
  const longResult = await mod.exportNavigationWaypoints(
    { characterId: 'fixture-character', systemIds: longIds, clearOtherWaypoints: false },
    { getAccessToken: async () => 'token', request: async () => { longCount += 1; } },
  );
  assert.equal(longResult.waypoints, 120);
  assert.equal(longCount, 120);

  const denied = Object.assign(new Error('Forbidden'), { status: 403 });
  await assert.rejects(
    () => mod.exportNavigationWaypoints(
      { characterId: 'fixture-character', systemIds: [30000144] },
      { getAccessToken: async () => 'token', request: async () => { throw denied; } },
    ),
    /denied waypoint access/i,
  );

  const full = mod.navigationRouteEveWaypointChain({
    systems: [{ systemId: 1 }, { systemId: 2 }, { systemId: 3 }],
    legs: [{ from: 1, to: 2, type: 'gate' }, { from: 2, to: 3, type: 'gate' }],
  });
  assert.deepEqual(full.systemIds, [2, 3]);
  assert.equal(full.complete, true);

  const special = mod.navigationRouteEveWaypointChain({
    systems: [{ systemId: 1 }, { systemId: 2 }, { systemId: 3 }, { systemId: 4 }],
    legs: [
      { from: 1, to: 2, type: 'gate' },
      { from: 2, to: 3, type: 'ansiblex' },
      { from: 3, to: 4, type: 'gate' },
    ],
  });
  assert.deepEqual(special.systemIds, [2]);
  assert.equal(special.complete, false);
  assert.equal(special.stoppedAtSpecialEdge, 'ansiblex');

  return { ordered: result.waypoints, longRoute: longResult.waypoints, specialPrefix: special.exportedGateLegs };
};
