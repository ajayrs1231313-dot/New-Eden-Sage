const assert = require('node:assert/strict');
const dogma = require('../../dist-electron/fitting-dogma.js');

const snapshot = {
  character: { name: 'Wargame system-effect regression' },
  skills: { total_sp: 0, skills: [
    { skill_id: 3300, trained_skill_level: 5 },
    { skill_id: 3302, trained_skill_level: 5 },
    { skill_id: 3318, trained_skill_level: 5 },
    { skill_id: 3413, trained_skill_level: 5 },
    { skill_id: 3420, trained_skill_level: 5 },
    { skill_id: 3436, trained_skill_level: 5 },
  ] },
  extended: { implants: [] },
};

(async () => {
  const base = {
    hullTypeId: 12005, // Ishtar
    items: [{ typeId: 13773, rack: 'high', quantity: 4, state: 'active', chargeTypeId: 21939 }],
    snapshot,
  };
  const normal = await dogma.analyzeFittingDogma(base);
  const magnetar = await dogma.analyzeFittingDogma({ ...base, environmentTypeIds: [30863] }); // C5 Magnetar

  assert.equal(magnetar.environmentSources.length, 1, 'environment source should be surfaced');
  assert.equal(magnetar.environmentSources[0].name, 'Class 5 Magnetar Effects');
  assert.ok(magnetar.damage.weaponDps > normal.damage.weaponDps * 1.8, 'C5 Magnetar gun damage multiplier missing');
  assert.ok(magnetar.damage.weaponProfiles[0].tracking < normal.damage.weaponProfiles[0].tracking * 0.6, 'C5 Magnetar tracking penalty missing');
  assert.ok(magnetar.targeting.maximumRangeM < normal.targeting.maximumRangeM * 0.6, 'C5 Magnetar targeting-range penalty missing');

  console.log('wargame environment effects regression: PASS');
})().catch((error) => { console.error(error); process.exitCode = 1; });
