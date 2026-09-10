const assert = require('node:assert/strict');
const dogma = require('../../dist-electron/fitting-dogma.js');

const levels = {
  3300: 5, 3302: 5, 3318: 5,
  3436: 5, 3441: 5, 3442: 5, 12487: 4, 12305: 5, 23606: 5,
};
const snapshot = {
  character: { name: 'Wargame multichannel regression' },
  skills: { total_sp: 0, skills: Object.entries(levels).map(([skill_id, trained_skill_level]) => ({ skill_id: Number(skill_id), trained_skill_level })) },
  extended: { implants: [] },
};

(async () => {
  const result = await dogma.analyzeFittingDogma({
    hullTypeId: 12005, // Ishtar
    items: [
      { typeId: 13773, rack: 'high', quantity: 2, state: 'active', chargeTypeId: 21939 },
      { typeId: 2436, rack: 'drone', quantity: 5, activeQuantity: 5 }, // Wasp II
    ],
    snapshot,
    targetProfile: { rangeM: 10_000, signatureRadiusM: 250, transverseVelocityMps: 0, velocityMps: 0 },
  });

  assert.ok(result.damage.weaponProfiles.length > 0, 'gun damage channel missing');
  assert.ok(result.damage.weaponDps > 0, 'gun DPS missing');
  assert.equal(result.damage.activeDrones.length, 5, 'drone flight missing');
  assert.ok(result.damage.droneDps > 0, 'drone DPS missing');
  assert.ok(result.damage.totalDps > result.damage.weaponDps, 'total DPS should contain both gun and drone channels');
  assert.ok(result.damage.totalDps > result.damage.droneDps, 'total DPS should contain both drone and gun channels');

  console.log('wargame multichannel damage regression: PASS');
})().catch((error) => { console.error(error); process.exitCode = 1; });
