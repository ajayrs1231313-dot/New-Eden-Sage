const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-wargame-warp-'));
try {
  const tsc = path.join(repo, 'node_modules', 'typescript', 'lib', 'tsc.js');
  const sources = [
    'src/wargame-command-model.ts',
    'src/wargame-types.ts',
    'src/wargame-observation.ts',
    'src/wargame-red-team.ts',
    'src/wargame-engine.ts',
    'src/wargame-session.ts',
  ].map((file) => path.join(repo, file));
  const compile = spawnSync(process.execPath, [
    tsc, ...sources,
    '--ignoreConfig', '--module', 'Node16', '--moduleResolution', 'node16',
    '--target', 'ES2022', '--outDir', temp, '--skipLibCheck', '--esModuleInterop',
  ], { encoding: 'utf8' });
  assert.equal(compile.status, 0, `Wargame warp test compile failed:\n${compile.stdout}\n${compile.stderr}`);
  const engine = require(path.join(temp, 'wargame-engine.js'));
  const session = require(path.join(temp, 'wargame-session.js'));

  function unit(id, side, x, overrides = {}) {
    return engine.prepareWargameUnit({
      id, name: id, side, count: 1, x, y: 50,
      dps: 2000, ehp: 100000, maxEhp: 100000,
      speed: 1200, baseSpeed: 300, range: 50,
      em: 60, therm: 60, kin: 60, exp: 60,
      role: 'Test cruiser', weaponModel: 'turret', signature: 150, tracking: .05,
      stance: 'hold', alignTimeSeconds: 2, warpSpeedAuPerSecond: 3,
      ...overrides,
    });
  }
  function advance(state, seconds = 1, extra = {}) {
    return session.applyWargameCommand(state, {
      id: `advance-${state.revision + 1}`, kind: 'advance', source: 'human',
      seconds, redAiEnabled: false, ...extra,
    }).state;
  }
  function move(state, unitId, mode, targetId, extra = {}) {
    return session.applyWargameCommand(state, {
      id: `move-${state.revision + 1}`, kind: 'movement-order', source: 'human',
      unitId, mode, targetId, ...extra,
    }).state;
  }

  // Direct Plot Move must follow the FC map point even when the formation has a combat primary.
  let moveState = session.createWargameSession([unit('blue-move', 'blue', 10, { targetId: 'red-primary', stance: 'pursue' }), unit('red-primary', 'red', 90)], 12345);
  moveState = session.applyWargameCommand(moveState, { id: 'plot-move', kind: 'movement-order', source: 'human', unitId: 'blue-move', mode: 'approach', x: 10, y: 80, rangeKm: 0 }).state;
  moveState = advance(moveState, 1);
  const plotted = moveState.units.find((u) => u.id === 'blue-move');
  assert.ok(plotted.y > 50, 'Plot Move should move toward the clicked map point');
  assert.ok(Math.abs(plotted.x - 10) < 0.01, 'combat primary must not steal a direct map-point movement order');
  // Semantic align/warp: 200 km across the tactical grid, with a 20 km landing offset.
  let state = session.createWargameSession([unit('blue', 'blue', 10), unit('nav', 'blue', 90)], 12345);
  state = move(state, 'blue', 'warp', 'nav', { warpRangeKm: 20 });
  assert.equal(state.units.find((u) => u.id === 'blue').movementOrder, 'warp');
  state = advance(state, 1);
  assert.equal(state.units.find((u) => u.id === 'blue').movementState, 'aligning');
  state = advance(state, 1);
  assert.equal(state.units.find((u) => u.id === 'blue').movementState, 'warping', 'aligned fleet should enter warp when not tackled');
  for (let i = 0; i < 12 && state.units.find((u) => u.id === 'blue').movementState === 'warping'; i++) state = advance(state, 1);
  const landed = state.units.find((u) => u.id === 'blue');
  assert.equal(landed.movementState, 'landed');
  assert.ok(Math.abs(engine.wargameDistanceKm(landed, state.units.find((u) => u.id === 'nav')) - 20) < 1.0, 'warp-at-20 should land about 20 km from destination');

  // Explicit align order completes without entering warp.
  state = session.createWargameSession([unit('blue', 'blue', 10), unit('nav', 'blue', 90)], 12345);
  state = move(state, 'blue', 'align', 'nav');
  state = advance(state, 2);
  assert.equal(state.units.find((u) => u.id === 'blue').movementState, 'aligned');
  assert.equal(engine.evaluateWargameCondition({ kind: 'self-aligned' }, state.units.find((u) => u.id === 'blue'), state.units, 0), true);

  // A targeted point blocks warp after alignment; scram also shuts down MWD state.
  const tackle = {
    typeId: 999001, name: 'Test Scrambler', groupId: 0, quantity: 1, kind: 'tackle',
    cycleSeconds: 5, optimalM: 20000, falloffM: 0, warpStrength: 1, mwdShutdown: true,
  };
  const tackler = unit('tackler', 'red', 12, { supportSystems: [tackle], supportTargetIds: { 'tackle:999001:0': 'blue' }, stance: 'hold' });
  state = session.createWargameSession([unit('blue', 'blue', 10, { propulsionKind: 'mwd' }), tackler, unit('nav', 'blue', 90)], 12345);
  state = move(state, 'blue', 'warp', 'nav');
  state = advance(state, 4);
  const held = state.units.find((u) => u.id === 'blue');
  assert.equal(held.movementState, 'aligned', 'pointed fleet should remain aligned instead of entering warp');
  assert.ok(held.warpDisruptionStrength > held.warpCoreStrength);
  assert.equal(held.scrammed, true);
  assert.match(held.warpBlockedReason || '', /warp disruption/i);
  assert.equal(engine.evaluateWargameCondition({ kind: 'target-warp-disrupted', targetId: 'blue' }, tackler, state.units, 0), true);

  // Equal warp-core strength defeats a single point in this abstraction.
  state = session.createWargameSession([unit('blue', 'blue', 10, { warpCoreStrength: 1 }), tackler, unit('nav', 'blue', 90)], 12345);
  state = move(state, 'blue', 'warp', 'nav');
  state = advance(state, 2);
  assert.equal(state.units.find((u) => u.id === 'blue').movementState, 'warping');

  // Multiple point sources stack and beat one core strength.
  const tackler2 = unit('tackler2', 'red', 13, { supportSystems: [tackle], supportTargetIds: { 'tackle:999001:0': 'blue' }, stance: 'hold' });
  state = session.createWargameSession([unit('blue', 'blue', 10, { warpCoreStrength: 1 }), tackler, tackler2, unit('nav', 'blue', 90)], 12345);
  state = move(state, 'blue', 'warp', 'nav');
  state = advance(state, 3);
  assert.equal(state.units.find((u) => u.id === 'blue').movementState, 'aligned');
  assert.ok(state.units.find((u) => u.id === 'blue').warpDisruptionStrength >= 2);

  // Spatial interdiction blocks a warp started inside a bubble. Nullification bypasses it.
  const bubble = { id: 'bubble', label: 'Interdiction Bubble', x: 10, y: 50, radiusKm: 20 };
  state = session.createWargameSession([unit('blue', 'blue', 10), unit('nav', 'blue', 90)], 12345);
  state = move(state, 'blue', 'warp', 'nav');
  state = advance(state, 3, { interdictionZones: [bubble] });
  assert.equal(state.units.find((u) => u.id === 'blue').movementState, 'aligned');
  assert.match(state.units.find((u) => u.id === 'blue').warpBlockedReason || '', /Interdiction Bubble/i);

  state = session.createWargameSession([unit('blue', 'blue', 10, { interdictionNullified: true }), unit('nav', 'blue', 90)], 12345);
  state = move(state, 'blue', 'warp', 'nav');
  state = advance(state, 2, { interdictionZones: [bubble] });
  assert.equal(state.units.find((u) => u.id === 'blue').movementState, 'warping');

  // Same-grid warp obeys EVE's 150 km minimum in the current planar scenario model.
  state = session.createWargameSession([unit('blue', 'blue', 10), unit('near', 'blue', 50)], 12345); // 100 km
  state = move(state, 'blue', 'warp', 'near');
  state = advance(state, 3);
  assert.equal(state.units.find((u) => u.id === 'blue').movementState, 'aligned');
  assert.match(state.units.find((u) => u.id === 'blue').warpBlockedReason || '', /150 km minimum/i);

  // Observation boundary exposes visible warp state but not hidden destination/intent.
  const observation = require(path.join(temp, 'wargame-observation.js'));
  const observed = observation.getWargameObservation('red', [unit('blue', 'blue', 10, { movementState: 'aligning', movementOrder: 'warp', destinationX: 90, destinationY: 50, warpDestinationX: 88 })]);
  assert.equal(observed[0].movementState, 'aligning');
  assert.equal(observed[0].movementOrder, undefined);
  assert.equal(observed[0].destinationX, undefined);
  assert.equal(observed[0].warpDestinationX, undefined);

  console.log('wargame warp/tackle regression: PASS');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
