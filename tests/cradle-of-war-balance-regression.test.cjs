const assert = require('node:assert/strict');
const dogma = require('../dist-electron/fitting-dogma.js');
const industrial = require('../dist-electron/industrial-engine.js');
const refinery = require('../dist-electron/refinery-engine.js');
const wormhole = require('../dist-electron/wormhole-reference.js');

const snapshot = {
  character: { name: 'Cradle of War regression' },
  skills: { total_sp: 0, skills: [] },
  extended: { implants: [] },
};

(async () => {
  const expectedMass = new Map([
    ['Kronos', 118400000],
    ['Vargur', 120000000],
    ['Paladin', 128000000],
    ['Golem', 125600000],
    ['Babaroga', 114400000],
    ['Marshal', 112500000],
    ['Panther', 111600000],
    ['Python', 106300000],
    ['Redeemer', 112700000],
    ['Sin', 106300000],
    ['Widow', 113300000],
  ]);

  const names = [...expectedMass.keys(), 'Zero-Point Field Manipulator', 'Hybrid Drone Specialization', 'Radical Drone Link Augmentor Mutaplasmid', 'Radical Drone Navigation Computer Mutaplasmid'];
  const resolved = await dogma.resolveFittingTypeNamesLocal(names);
  const ids = new Map(resolved.map((row) => [row.name, row.id]));
  for (const name of names) assert.ok(ids.get(name), 'Missing current SDE type: ' + name);

  await wormhole.prepareWormholeStaticData();
  for (const [name, massKg] of expectedMass) {
    const hullTypeId = ids.get(name);
    const fit = await dogma.analyzeFittingDogma({ hullTypeId, items: [], snapshot });
    assert.equal(fit.navigation.massKg, massKg, name + ' fitting-engine mass');
    assert.ok(fit.navigation.agility > 0, name + ' agility must be positive after mass rebalance');

    const rolling = await wormhole.getWormholeRollingShipMass({ shipTypeId: hullTypeId, fittedItems: [] });
    assert.equal(rolling.baseMassKg, massKg, name + ' wormhole base mass');
    assert.equal(rolling.coldMassKg, massKg, name + ' wormhole cold mass');
  }


  const wormholes = await wormhole.getWormholeReference();
  for (const code of ['I078','L687','O546']) {
    const row = wormholes.find((entry) => entry.code === code);
    assert.ok(row, code + ' Pochven wormhole must exist in the current SDE');
    assert.equal(row.destinationKind, 'pochven', code + ' destination');
    assert.equal(row.maxStableMassKg, 750000000, code + ' max stable mass');
    assert.equal(row.lifetimeMinutes, 720, code + ' 12-hour lifetime');
  }

  const paladin = await dogma.analyzeFittingDogma({ hullTypeId:ids.get('Paladin'), items:[], snapshot });
  const golem = await dogma.analyzeFittingDogma({ hullTypeId:ids.get('Golem'), items:[], snapshot });
  assert.equal(paladin.navigation.agility, 0.0858, 'Paladin post-hotfix agility');
  assert.equal(golem.navigation.agility, 0.0963, 'Golem post-hotfix agility');
  assert.ok(Math.abs(paladin.navigation.alignSeconds - 15.224839191563087) < 1e-9, 'Paladin post-hotfix align time');
  assert.ok(Math.abs(golem.navigation.alignSeconds - 16.76761846016619) < 1e-9, 'Golem post-hotfix align time');

  assert.equal(ids.get('Babaroga'), 88001, 'Babaroga type ID regression');
  assert.equal(ids.get('Radical Drone Link Augmentor Mutaplasmid'), 97247, 'Cradle Radical Drone Link Augmentor mutaplasmid');
  assert.equal(ids.get('Radical Drone Navigation Computer Mutaplasmid'), 97249, 'Cradle Radical Drone Navigation Computer mutaplasmid');
  const plan = await industrial.analyzeManufacturingPlan({
    blueprintTypeId: 88003,
    runs: 1,
    assets: [],
    snapshot,
  });
  const zeroPointId = ids.get('Zero-Point Field Manipulator');
  const manufacturing = plan.materials.find((row) => row.typeId === zeroPointId);
  assert.ok(manufacturing, 'Babaroga manufacturing must expose Zero-Point Field Manipulators');
  assert.equal(manufacturing.basePerRun, 4800, 'Babaroga base manufacturing input');
  assert.equal(manufacturing.required, 4800, 'Babaroga one-run manufacturing requirement at ME 0');

  await refinery.prepareRefineryStaticDataLocal();
  const reprocessing = await refinery.analyzeRefinery({
    snapshot,
    stockSources: [{
      characterId: 'patch-regression',
      characterName: 'Patch Regression',
      assets: [{ item_id: 1, type_id: 88001, quantity: 1 }],
    }],
    facility: 'npc',
    rig: 'none',
    security: 'high',
    implant: 'none',
  });
  const babaroga = reprocessing.stacks.find((row) => row.typeId === 88001);
  assert.ok(babaroga, 'Babaroga must be accepted by Refinery as a reprocessable ship');
  const zeroPointOutput = babaroga.outputs.find((row) => row.typeId === zeroPointId);
  assert.ok(zeroPointOutput, 'Babaroga reprocessing must expose Zero-Point Field Manipulators');
  assert.equal(zeroPointOutput.baseUnitsPerBatch, 4800, 'Current SDE material basis');
  assert.equal(zeroPointOutput.refinedUnits, 2400, 'NPC 50% reprocessing result from one Babaroga');

  console.log(JSON.stringify({
    patch: '2026-09-22 Cradle of War',
    hullMassesVerified: expectedMass.size,
    babarogaManufacturingZeroPoint: manufacturing.required,
    babarogaReprocessingZeroPoint: zeroPointOutput.refinedUnits,
    hybridDroneSpecializationTypeId: ids.get('Hybrid Drone Specialization'),
  }, null, 2));
  console.log('CRADLE OF WAR CORE BALANCE REGRESSION: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
