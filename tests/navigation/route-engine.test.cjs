const assert = require('node:assert/strict');

module.exports = async function routeEngineTests() {
  const graph = require('../../dist-electron/universe-route-graph.js');
  const planner = require('../../dist-electron/navigation-route-planner.js');
  const exact = async (name) => {
    const rows = await graph.searchNavigationSystems(name, 8);
    const row = rows.find((item) => item.name === name);
    assert(row, `Missing SDE fixture system ${name}`);
    return row;
  };
  const Jita = await exact('Jita');
  const Perimeter = await exact('Perimeter');
  const Amarr = await exact('Amarr');
  const Ahbazon = await exact('Ahbazon');

  const direct = await graph.calculateNavigationRoute({ from: Jita.systemId, to: Perimeter.systemId, mode: 'shortest' });
  assert.equal(direct.found, true);
  assert.equal(direct.jumps, 1);
  assert.deepEqual(direct.systems.map((s) => s.name), ['Jita', 'Perimeter']);

  const shortest = await graph.calculateNavigationRoute({ from: Jita.systemId, to: Amarr.systemId, mode: 'shortest' });
  assert.equal(shortest.found, true);
  assert(shortest.systems.some((s) => s.systemId === Ahbazon.systemId), 'Shortest fixture should cross Ahbazon');

  const multi = await planner.calculateNavigationPlan({ waypointSystemIds: [Jita.systemId, Perimeter.systemId, Amarr.systemId] });
  assert.equal(multi.found, true);
  assert.equal(multi.segments.length, 2);
  assert.deepEqual(multi.waypoints.map((s) => s.name), ['Jita', 'Perimeter', 'Amarr']);

  const high = await graph.calculateNavigationRoute({ from: Jita.systemId, to: Amarr.systemId, mode: 'high-sec', minSecurity: 0.5 });
  assert.equal(high.found, true);
  assert(high.minimumDisplayedSecurityStatus >= 0.5);
  assert(high.jumps > shortest.jumps);
  assert(!high.systems.some((s) => s.systemId === Ahbazon.systemId));

  const floor = await graph.calculateNavigationRoute({ from: Jita.systemId, to: Amarr.systemId, mode: 'shortest', minSecurity: 0.5 });
  assert.equal(floor.found, true);
  assert(floor.minimumDisplayedSecurityStatus >= 0.5);

  const avoided = await graph.calculateNavigationRoute({ from: Jita.systemId, to: Amarr.systemId, mode: 'shortest', avoidSystemIds: [Ahbazon.systemId] });
  assert.equal(avoided.found, true);
  assert(!avoided.systems.some((s) => s.systemId === Ahbazon.systemId));
  assert(avoided.jumps > shortest.jumps);

  const impossible = await graph.calculateNavigationRoute({ from: Jita.systemId, to: Amarr.systemId, avoidSystemIds: [Amarr.systemId] });
  assert.equal(impossible.found, false);
  assert.match(impossible.reason || '', /excluded/i);

  const locked = await planner.calculateNavigationPlan({
    waypointSystemIds: [Jita.systemId, Amarr.systemId],
    lockedSegments: [{ lockId: 'fixture-lock', fromSystemId: Jita.systemId, toSystemId: Amarr.systemId, systemIds: shortest.systems.map((s) => s.systemId) }],
  });
  assert.equal(locked.found, true);
  assert.equal(locked.segments[0].locked, true);
  assert.deepEqual(locked.systems.map((s) => s.systemId), shortest.systems.map((s) => s.systemId));

  const invalidLocked = await planner.calculateNavigationPlan({
    waypointSystemIds: [Jita.systemId, Amarr.systemId],
    lockedSegments: [{ lockId: 'fixture-lock', fromSystemId: Jita.systemId, toSystemId: Amarr.systemId, systemIds: shortest.systems.map((s) => s.systemId) }],
    profile: { mode: 'high-sec', minSecurity: 0.5 },
  });
  assert.equal(invalidLocked.found, false);
  assert.match(invalidLocked.reason || '', /locked segment/i);

  const manualConnection = { connectionId: 'fixture-manual', fromSystemId: Jita.systemId, toSystemId: Amarr.systemId, type: 'manual', enabled: true, bidirectional: true };
  const manual = await planner.calculateNavigationPlan({
    waypointSystemIds: [Jita.systemId, Amarr.systemId],
    customConnections: [manualConnection],
    profile: { specialConnections: { enabledTypes: ['manual'], disabledNetworkIds: [] } },
  });
  assert.equal(manual.found, true);
  assert.equal(manual.totals.jumps, 1);
  assert.equal(manual.legs[0].type, 'manual');

  const ansiblexConnection = { ...manualConnection, connectionId: 'fixture-ansiblex', type: 'ansiblex', networkId: 'fixture-network' };
  const specialOn = await planner.calculateNavigationPlan({
    waypointSystemIds: [Jita.systemId, Amarr.systemId],
    customConnections: [ansiblexConnection],
    profile: { specialConnections: { enabledTypes: ['ansiblex'], disabledNetworkIds: [] } },
  });
  assert.equal(specialOn.found, true);
  assert.equal(specialOn.totals.jumps, 1);
  assert.equal(specialOn.legs[0].type, 'ansiblex');

  const specialOff = await planner.calculateNavigationPlan({
    waypointSystemIds: [Jita.systemId, Amarr.systemId],
    customConnections: [ansiblexConnection],
    profile: { specialConnections: { enabledTypes: [], disabledNetworkIds: [] } },
  });
  assert.equal(specialOff.found, true);
  assert(specialOff.totals.jumps > 1);
  assert(specialOff.legs.every((leg) => leg.type === 'gate'));

  const reverseLocked = await planner.calculateNavigationPlan({
    waypointSystemIds: [Amarr.systemId, Jita.systemId],
    lockedSegments: [{ lockId: 'reverse-lock', fromSystemId: Amarr.systemId, toSystemId: Jita.systemId, systemIds: shortest.systems.map((s) => s.systemId).reverse() }],
  });
  assert.equal(reverseLocked.found, true);
  assert.deepEqual(reverseLocked.systems.map((s) => s.systemId), shortest.systems.map((s) => s.systemId).reverse());

  return { direct: direct.jumps, shortest: shortest.jumps, highSec: high.jumps, avoided: avoided.jumps };
};
