const assert = require('node:assert/strict');
const dogma = require('../../dist-electron/fitting-dogma.js');

const approx = (actual, expected, epsilon = 1e-9, label = 'value') => {
  assert.ok(Number.isFinite(actual), label + ' is not finite: ' + actual);
  assert.ok(Math.abs(actual - expected) <= epsilon, label + ' ' + actual + ' != ' + expected);
};
const snapshot = levels => ({
  character: { name: 'Skill bonus regression' },
  skills: { total_sp: 0, skills: Object.entries(levels).map(([skill_id, trained_skill_level]) => ({ skill_id: Number(skill_id), trained_skill_level })) },
  extended: { implants: [] },
});

(async () => {
  const ids = new Map((await dogma.resolveFittingTypeNamesLocal([
    'Ishtar', 'Ogre II', 'Drone Damage Amplifier II', 'Caracal', 'Light Missile Launcher II', 'Scourge Light Missile',
  ])).map(item => [item.name, item.id]));
  const id = name => { const value = ids.get(name); assert.ok(value, 'Missing SDE type: ' + name); return value; };

  const drones = [{ typeId:id('Ogre II'), rack:'drone', quantity:5, activeQuantity:5 }];
  const droneFit = (levels, extra = []) => dogma.analyzeFittingDogma({ hullTypeId:id('Ishtar'), items:[...drones, ...extra], snapshot:snapshot(levels) });
  const droneBaseSkills = { 3332:0, 16591:4, 3441:0, 3436:5, 12486:0, 3442:0 };
  const noHull = await droneFit(droneBaseSkills);
  const hullV = await droneFit({ ...droneBaseSkills, 3332:5 });
  approx(hullV.damage.droneDps / noHull.damage.droneDps, 1.5, 1e-12, 'Ishtar Gallente Cruiser V heavy-drone damage');

  const interfacing = await droneFit({ ...droneBaseSkills, 3332:5, 3442:5 });
  const hdoV = await droneFit({ ...droneBaseSkills, 3332:5, 3442:5, 3441:5 });
  approx(hdoV.damage.droneDps / interfacing.damage.droneDps, 1.25, 1e-12, 'Heavy Drone Operation V damage');
  const specIV = await droneFit({ ...droneBaseSkills, 3332:5, 3442:5, 3441:5, 12486:4 });
  approx(specIV.damage.droneDps / hdoV.damage.droneDps, 1.08, 1e-12, 'Gallente Drone Specialization IV damage');
  const ajDda = await droneFit({ ...droneBaseSkills, 3332:5, 3442:5, 3441:5, 12486:4 }, [{ typeId:id('Drone Damage Amplifier II'), rack:'low', quantity:3, state:'active' }]);
  approx(ajDda.damage.droneDps, 739.8500230477589, 1e-8, 'AJ Ishtar 5x Ogre II + 3x DDA II regression');

  const launcher = [{ typeId:id('Light Missile Launcher II'), rack:'high', quantity:1, state:'active', chargeTypeId:id('Scourge Light Missile') }];
  const missileFit = levels => dogma.analyzeFittingDogma({ hullTypeId:id('Caracal'), items:launcher, snapshot:snapshot(levels) });
  const missileBase = { 3319:5, 3321:0, 20210:0, 20315:0, 3334:5, 12441:0, 12442:0, 20312:0, 20314:0 };
  const m0 = await missileFit(missileBase);
  const lightV = await missileFit({ ...missileBase, 3321:5 });
  approx(lightV.damage.weaponDps / m0.damage.weaponDps, 1.25, 1e-12, 'Light Missiles V damage');
  const warheadV = await missileFit({ ...missileBase, 3321:5, 20315:5 });
  approx(warheadV.damage.weaponDps / lightV.damage.weaponDps, 1.1, 1e-12, 'Warhead Upgrades V damage');
  const specMissileIV = await missileFit({ ...missileBase, 3321:5, 20315:5, 20210:4 });
  approx(specMissileIV.damage.weaponDps / warheadV.damage.weaponDps, 1 / 0.92, 1e-12, 'Light Missile Specialization IV ROF');

  const baseProfile = m0.damage.weaponProfiles[0];
  const bombardmentV = (await missileFit({ ...missileBase, 12441:5 })).damage.weaponProfiles[0];
  const projectionV = (await missileFit({ ...missileBase, 12442:5 })).damage.weaponProfiles[0];
  const precisionV = (await missileFit({ ...missileBase, 20312:5 })).damage.weaponProfiles[0];
  const predictionV = (await missileFit({ ...missileBase, 20314:5 })).damage.weaponProfiles[0];
  approx(bombardmentV.maximumRangeM / baseProfile.maximumRangeM, 1.5, 1e-12, 'Missile Bombardment V range');
  approx(projectionV.maximumRangeM / baseProfile.maximumRangeM, 1.5, 1e-12, 'Missile Projection V range');
  approx(precisionV.explosionRadiusM / baseProfile.explosionRadiusM, 0.75, 1e-12, 'Guided Missile Precision V explosion radius');
  approx(predictionV.explosionVelocity / baseProfile.explosionVelocity, 1.5, 1e-12, 'Target Navigation Prediction V explosion velocity');

  console.log('fitter hull + drone + missile skill bonus regression: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
