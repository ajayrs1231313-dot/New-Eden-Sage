const assert = require('node:assert/strict');
const fs = require('node:fs');

module.exports = async function endToEndNavigationSmoke() {
  const graph = require('../../dist-electron/universe-route-graph.js');
  const planner = require('../../dist-electron/navigation-route-planner.js');
  const serialization = require('../../dist-electron/navigation-route-serialization.js');
  const eve = require('../../dist-electron/navigation-eve-export.js');
  const intel = require('../../dist-electron/navigation-route-intelligence.js');
  const cap = require('../../dist-electron/navigation-capital.js');

  const exact = async (name) => {
    const rows = await graph.searchNavigationSystems(name, 8);
    const row = rows.find((item) => item.name === name);
    assert(row, `Missing SDE fixture ${name}`);
    return row;
  };
  const Jita = await exact('Jita');
  const Perimeter = await exact('Perimeter');
  const Amarr = await exact('Amarr');
  const Ahbazon = await exact('Ahbazon');
  const Tama = await exact('Tama');
  const Amamake = await exact('Amamake');

  const normal = await planner.calculateNavigationPlan({ waypointSystemIds: [Jita.systemId, Amarr.systemId] });
  assert.equal(normal.found, true);

  const secure = await planner.calculateNavigationPlan({ waypointSystemIds: [Jita.systemId, Amarr.systemId], profile: { mode: 'high-sec', minSecurity: 0.5 } });
  assert.equal(secure.found, true);
  assert(secure.totals.minimumDisplayedSecurityStatus >= 0.5);

  const waypointRoute = await planner.calculateNavigationPlan({ waypointSystemIds: [Jita.systemId, Perimeter.systemId, Amarr.systemId] });
  assert.equal(waypointRoute.segments.length, 2);
  const reordered = await planner.calculateNavigationPlan({ waypointSystemIds: [Jita.systemId, Amarr.systemId, Perimeter.systemId] });
  assert.equal(reordered.destination.name, 'Perimeter');

  const avoided = await planner.calculateNavigationPlan({ waypointSystemIds: [Jita.systemId, Amarr.systemId], profile: { avoids: { systemIds: [Ahbazon.systemId] } } });
  assert.equal(avoided.found, true);
  assert(!avoided.systems.some((s) => s.systemId === Ahbazon.systemId));

  const custom = { connectionId: 'e2e-manual', fromSystemId: Jita.systemId, toSystemId: Amarr.systemId, type: 'manual', enabled: true, bidirectional: true };
  const manual = await planner.calculateNavigationPlan({ waypointSystemIds: [Jita.systemId, Amarr.systemId], customConnections: [custom], profile: { specialConnections: { enabledTypes: ['manual'], disabledNetworkIds: [] } } });
  assert.equal(manual.totals.jumps, 1);
  assert.equal(manual.legs[0].type, 'manual');

  const baseline = await graph.calculateNavigationRoute({ from: Jita.systemId, to: Amarr.systemId });
  const locked = await planner.calculateNavigationPlan({ waypointSystemIds: [Jita.systemId, Amarr.systemId], lockedSegments: [{ lockId: 'e2e-lock', fromSystemId: Jita.systemId, toSystemId: Amarr.systemId, systemIds: baseline.systems.map((s) => s.systemId) }] });
  assert.equal(locked.segments[0].locked, true);

  const annotated = { ...locked, notes: 'E2E smoke route', waypointAnnotations: { [Jita.systemId]: { label: 'Form-up', notes: 'Start here' } } };
  const packet = serialization.exportNavigationRouteJson(annotated);
  const restored = serialization.importNavigationRouteJson(packet);
  assert.equal(restored.notes, 'E2E smoke route');
  assert.equal(restored.waypointAnnotations[Jita.systemId].label, 'Form-up');

  const now = Date.parse('2026-08-19T20:00:00.000Z');
  const gate = { gateId: 99, destinationSystemId: Perimeter.systemId, destinationSystemName: 'Perimeter', position: { x: 0, y: 0, z: 0 } };
  const kill = (id, min) => ({ killmailId: id, killmailTime: new Date(now - min * 60_000).toISOString(), solarSystemId: Jita.systemId, victim: { ship_type_id: 123, position: { x: 10_000, y: 0, z: 0 } }, attackers: [{ character_id: 42 }], source: 'zKillboard' });
  const kills = [kill(1, 10), kill(2, 20), kill(3, 30)];
  const classes = kills.map((row) => intel.classifyKillmailNearGate(row, [gate])).filter(Boolean);
  assert.equal(intel.deriveGateDanger(kills, classes, 99, { jumps: 10 }, now).state, 'active-camp');

  const eveChain = eve.navigationRouteEveWaypointChain(normal);
  assert.equal(eveChain.complete, true);
  assert.equal(eveChain.systemIds.length, normal.legs.length);
  const specialChain = eve.navigationRouteEveWaypointChain(manual);
  assert.equal(specialChain.complete, false);
  assert.equal(specialChain.systemIds.length, 0);

  const skill = (id, level) => ({ skill_id: id, active_skill_level: level, trained_skill_level: level });
  const snapshot = { characterId: 'e2e-capital', character: { name: 'E2E Capital' }, skills: { skills: [skill(cap.NAVIGATION_JDC_SKILL_TYPE_ID, 5), skill(cap.NAVIGATION_JFC_SKILL_TYPE_ID, 5)] }, ship: {} };
  const ctx = await cap.getNavigationCapitalContext(snapshot.characterId, [snapshot]);
  const rorqual = ctx.hulls.find((h) => h.name === 'Rorqual');
  assert(rorqual);
  const capital = await cap.calculateNavigationCapitalPlan({ characterId: snapshot.characterId, shipTypeId: rorqual.typeId, fromSystemId: Tama.systemId, toSystemId: Amamake.systemId, includeLiveIntelligence: false }, [snapshot]);
  assert.equal(capital.found, true);
  assert(capital.jumps >= 2);

  const appSource = fs.readFileSync('src/App.tsx', 'utf8');
  const navSource = fs.readFileSync('src/NavigationCommand.tsx', 'utf8');
  const corpSource = fs.readFileSync('src/CorporationManagement.tsx', 'utf8');
  assert.match(appSource, /NavigationCommand/);
  assert.match(navSource, /Route Planner/);
  assert.match(navSource, /Saved Routes/);
  assert.match(navSource, /Route Intelligence/);
  assert.match(navSource, /Capital \/ Jump Planner/);
  assert.match(corpSource, /system/i, 'Corporation Management/System Watch integration must remain present');

  return { normalJumps: normal.totals.jumps, highSecJumps: secure.totals.jumps, capitalJumps: capital.jumps, packetBytes: Buffer.byteLength(packet) };
};
