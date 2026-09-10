const assert = require('node:assert/strict');
const dogma = require('../../dist-electron/fitting-dogma.js');

const approx = (actual, expected, epsilon = 1e-10, label = 'value') => {
  assert.ok(Number.isFinite(actual), `${label}: non-finite ${actual}`);
  assert.ok(Math.abs(actual - expected) <= epsilon, `${label}: ${actual} != ${expected}`);
};
const snapshot = levels => ({
  character: { name: 'Turret LocationGroupModifier regression' },
  skills: { total_sp: 0, skills: Object.entries(levels).map(([skill_id, trained_skill_level]) => ({ skill_id:Number(skill_id), trained_skill_level })) },
  extended: { implants: [] },
});

(async () => {
  const wanted = [
    'Thorax', 'Heavy Neutron Blaster II', 'Void M', 'Magnetic Field Stabilizer II',
    'Medium Hybrid Burst Aerator I', 'Medium Hybrid Collision Accelerator I',
  ];
  const ids = new Map((await dogma.resolveFittingTypeNamesLocal(wanted)).map(item => [item.name, item.id]));
  for (const name of wanted) assert.ok(ids.get(name), `missing ${name}`);
  const [infiltrator] = await dogma.resolveFittingTypeNamesLocal(['Infiltrator II']);
  assert.equal(infiltrator?.id, 2175, 'published Infiltrator II drone must win over unpublished Entity duplicate');
  assert.equal(infiltrator?.categoryId, 18, 'Infiltrator II must resolve as a Drone');
  const id = name => ids.get(name);
  const AJ_GUNNERY = { 3300:5, 3304:5, 3310:4, 3315:2, 3318:5, 11207:5, 12211:4, 3332:5 };
  const gun = { typeId:id('Heavy Neutron Blaster II'), rack:'high', quantity:5, state:'active', chargeTypeId:id('Void M') };
  const mfs = quantity => ({ typeId:id('Magnetic Field Stabilizer II'), rack:'low', quantity, state:'online' });
  const rig = name => ({ typeId:id(name), rack:'rig', quantity:1, state:'online' });
  const analyze = items => dogma.analyzeFittingDogma({ hullTypeId:id('Thorax'), items, snapshot:snapshot(AJ_GUNNERY) });
  const profile = result => result.damage.weaponProfiles[0];

  const base = profile(await analyze([gun]));
  const one = profile(await analyze([gun, mfs(1)]));
  const two = profile(await analyze([gun, mfs(2)]));
  const three = profile(await analyze([gun, mfs(3)]));
  const full = profile(await analyze([gun, mfs(3), rig('Medium Hybrid Burst Aerator I'), rig('Medium Hybrid Collision Accelerator I')]));

  approx(one.volley / base.volley, 1.1, 1e-12, 'MFS I damage multiplier');
  approx(one.cycleSeconds / base.cycleSeconds, 0.895, 1e-12, 'MFS I ROF multiplier');
  approx(two.volley / one.volley, 1 + 0.1 * 0.86911998, 1e-12, 'MFS II second damage stacking penalty');
  approx(two.cycleSeconds / one.cycleSeconds, 1 + (0.895 - 1) * 0.86911998, 1e-12, 'MFS II second ROF stacking penalty');
  approx(three.volley / two.volley, 1 + 0.1 * 0.57058314, 1e-12, 'MFS II third damage stacking penalty');
  approx(three.cycleSeconds / two.cycleSeconds, 1 + (0.895 - 1) * 0.57058314, 1e-12, 'MFS II third ROF stacking penalty');
  approx(full.volley / three.volley, 1 + 0.1 * 0.28295515, 1e-12, 'Collision Accelerator fourth damage stacking slot');
  approx(full.cycleSeconds / three.cycleSeconds, 1 + (0.9 - 1) * 0.28295515, 1e-12, 'Burst Aerator fourth ROF stacking slot');
  assert.ok(full.paperDps > base.paperDps * 1.7, 'fitted turret upgrades must materially increase turret DPS');

  console.log('turret LocationGroupModifier regression: PASS');
})().catch(error => { console.error(error); process.exit(1); });
