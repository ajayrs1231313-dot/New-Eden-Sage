const assert = require('node:assert/strict');
const dogma = require('../../dist-electron/fitting-dogma.js');

(async () => {
  const ids = new Map((await dogma.resolveFittingTypeNamesLocal([
    'Ishtar',
    'Tengu',
    'Tengu Defensive - Amplification Node',
    'Tengu Defensive - Covert Reconfiguration',
    'High-grade Crystal Alpha',
    'High-grade Snake Alpha',
    'Strong Blue Pill Booster',
    'Synth Blue Pill Booster',
    'Tracking Computer II',
    'Optimal Range Script',
    'Sensor Booster II',
    'Scan Resolution Script',
    'Shield Command Burst II',
    'Shield Extension Charge',
    'Ogre II',
    'Tritanium',
  ])).map(item => [item.name, item.id]));
  const id = name => {
    const value = ids.get(name);
    assert.ok(value, `Missing SDE type: ${name}`);
    return value;
  };

  const implantConflict = await dogma.checkFittingItemCompatibilityLocal({
    hullTypeId: id('Ishtar'),
    itemTypeId: id('High-grade Snake Alpha'),
    placement: 'implant',
    fitted: [{ typeId: id('High-grade Crystal Alpha'), rack: 'implant' }],
  });
  assert.equal(implantConflict.compatible, false);
  assert.equal(implantConflict.code, 'implant-slot-occupied');

  const boosterConflict = await dogma.checkFittingItemCompatibilityLocal({
    hullTypeId: id('Ishtar'),
    itemTypeId: id('Strong Blue Pill Booster'),
    placement: 'booster',
    fitted: [{ typeId: id('Synth Blue Pill Booster'), rack: 'booster' }],
  });
  assert.equal(boosterConflict.compatible, false);
  assert.equal(boosterConflict.code, 'booster-slot-occupied');

  const subsystemConflict = await dogma.checkFittingItemCompatibilityLocal({
    hullTypeId: id('Tengu'),
    itemTypeId: id('Tengu Defensive - Covert Reconfiguration'),
    placement: 'subsystem',
    fitted: [{ typeId: id('Tengu Defensive - Amplification Node'), rack: 'subsystem' }],
  });
  assert.equal(subsystemConflict.compatible, false);
  assert.equal(subsystemConflict.code, 'subsystem-slot-occupied');

  for (const [moduleName, chargeName] of [
    ['Tracking Computer II', 'Optimal Range Script'],
    ['Sensor Booster II', 'Scan Resolution Script'],
    ['Shield Command Burst II', 'Shield Extension Charge'],
  ]) {
    const result = await dogma.checkFittingChargeCompatibilityLocal(id(moduleName), id(chargeName));
    assert.equal(result.compatible, true, `${chargeName} should load into ${moduleName}`);
  }

  const baseSnapshot = { character: { name: 'Fitter Smoke' }, skills: { total_sp: 0, skills: [] }, extended: { implants: [] } };
  const replacement = await dogma.analyzeFittingDogma({
    hullTypeId: id('Ishtar'),
    items: [],
    snapshot: { ...baseSnapshot, extended: { implants: [id('High-grade Crystal Alpha')] } },
    implantTypeIds: [id('High-grade Snake Alpha')],
  });
  assert.ok(replacement.enhancements.some(item => item.typeId === id('High-grade Snake Alpha')));
  assert.ok(!replacement.enhancements.some(item => item.typeId === id('High-grade Crystal Alpha')), 'planned same-slot implant must replace, not stack with, installed implant');

  const duplicateEnhancements = await dogma.analyzeFittingDogma({
    hullTypeId: id('Ishtar'),
    items: [],
    snapshot: baseSnapshot,
    implantTypeIds: [id('High-grade Crystal Alpha'), id('High-grade Snake Alpha')],
    boosterTypeIds: [id('Strong Blue Pill Booster'), id('Synth Blue Pill Booster')],
  });
  assert.ok(duplicateEnhancements.issues.some(issue => issue.code === 'implant-slot-conflict'));
  assert.ok(duplicateEnhancements.issues.some(issue => issue.code === 'booster-slot-conflict'));

  const cargo = await dogma.analyzeFittingDogma({
    hullTypeId: id('Ishtar'),
    items: [{ typeId: id('Tritanium'), quantity: 100000000, rack: 'cargo' }],
    snapshot: baseSnapshot,
  });
  assert.ok(cargo.issues.some(issue => issue.code === 'cargo-capacity'));

  const droneSpares = await dogma.analyzeFittingDogma({
    hullTypeId: id('Ishtar'),
    items: [{ typeId: id('Ogre II'), quantity: 10, rack: 'drone' }],
    snapshot: baseSnapshot,
  });
  assert.equal(droneSpares.issues.some(issue => issue.code === 'drone-bandwidth'), false, 'spare drones in bay must not be treated as active bandwidth');
  assert.equal(droneSpares.storage.droneBandwidthUsed, 125, 'visible bandwidth must reflect the five active Ogre IIs, not all ten spares');

  const boosterSideEffects = await dogma.getBoosterSideEffectsLocal([id('Strong Blue Pill Booster')]);
  const capacitorPenalty = boosterSideEffects.find(effect => /Capacitor Capacity Penalty/i.test(effect.effectName));
  assert.ok(capacitorPenalty, 'Strong Blue Pill should expose its CCP side-effect rolls');
  const boosterNoPenalty = await dogma.analyzeFittingDogma({ hullTypeId:id('Ishtar'), items:[], snapshot:baseSnapshot, boosterTypeIds:[id('Strong Blue Pill Booster')] });
  const boosterWithPenalty = await dogma.analyzeFittingDogma({ hullTypeId:id('Ishtar'), items:[], snapshot:baseSnapshot, boosterTypeIds:[id('Strong Blue Pill Booster')], boosterSideEffectSelections:[{boosterTypeId:id('Strong Blue Pill Booster'),effectId:capacitorPenalty.effectId}] });
  assert.ok(boosterWithPenalty.capacitor.capacityGj < boosterNoPenalty.capacitor.capacityGj, 'selected booster side effect must alter the simulated ship');

  console.log('fitter legality + scripts + fleet burst smoke: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
