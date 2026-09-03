const assert = require('node:assert/strict');
const dogma = require('../../dist-electron/fitting-dogma.js');

const approx = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

(async () => {
  const abyss = await dogma.searchFittingTypesLocal('@npc:abyssal', 500);
  assert.equal(abyss.length, 120, 'current CCP SDE should expose all 120 Abyss entity profiles');
  assert.equal(abyss.filter(item => /placeholder/i.test(item.name)).length, 1, 'SDE placeholder remains identifiable for UI filtering');

  const byName = new Map(abyss.map(item => [item.name, item]));
  const pureCases = [
    ['Sparkneedle Tessella', { em: 20, thermal: 0, kinetic: 0, explosive: 0 }],
    ['Emberneedle Tessella', { em: 0, thermal: 20, kinetic: 0, explosive: 0 }],
    ['Strikeneedle Tessella', { em: 0, thermal: 0, kinetic: 20, explosive: 0 }],
    ['Blastneedle Tessella', { em: 0, thermal: 0, kinetic: 0, explosive: 20 }],
  ];
  for (const [name, expected] of pureCases) {
    const entity = byName.get(name);
    assert.ok(entity?.combatProfile, `missing Abyss combat profile for ${name}`);
    assert.deepEqual(entity.combatProfile.outgoingDamage, expected, `${name} damage channel mismatch`);
  }

  const allCombat = await dogma.searchFittingTypesLocal('@npc:all', 7000);
  assert.ok(allCombat.length >= 5800, `expected broad SDE combat catalogue, got ${allCombat.length}`);
  for (const channel of ['em', 'thermal', 'kinetic', 'explosive']) {
    assert.ok(allCombat.some(item => Number(item.combatProfile?.outgoingDamage?.[channel] ?? 0) > 0), `missing ${channel} NPC damage coverage`);
  }

  const ids = new Map((await dogma.resolveFittingTypeNamesLocal(['Ishtar', 'Ogre II'])).map(item => [item.name, item.id]));
  const ishtar = ids.get('Ishtar');
  const ogre = ids.get('Ogre II');
  assert.ok(ishtar && ogre, 'required fitting types missing from SDE');
  const spark = byName.get('Sparkneedle Tessella');
  assert.ok(spark?.combatProfile, 'Sparkneedle target missing');

  const result = await dogma.analyzeFittingDogma({
    hullTypeId: ishtar,
    items: [{ typeId: ogre, quantity: 5, activeQuantity: 5, rack: 'drone' }],
    snapshot: { character: { name: 'NPC DPS Test' }, skills: { total_sp: 0, skills: [] }, extended: { implants: [] } },
    targetTypeId: spark.id,
    damageProfile: { em: 0, thermal: 0, kinetic: 0, explosive: 1 },
    targetProfile: { rangeM: 10000, signatureRadiusM: spark.combatProfile.signatureRadiusM, transverseVelocityMps: 0, velocityMps: 0 },
  });

  assert.deepEqual(result.defence.damageProfile, { em: 1, thermal: 0, kinetic: 0, explosive: 0 }, 'exact target outgoing mix must override fallback tank preset');
  assert.equal(result.damage.target.name, 'Sparkneedle Tessella');
  assert.equal(result.damage.target.totalHp, 1150);
  const appliedDroneDps = result.damage.activeDrones.reduce((sum, drone) => sum + drone.targetApplication.appliedDps, 0);
  approx(result.damage.appliedDroneDps, appliedDroneDps);
  assert.ok(appliedDroneDps < result.damage.droneDps, 'mobile Ogre II application must no longer assume full paper DPS against a small target');
  approx(result.damage.target.shieldDps, appliedDroneDps * (1 - spark.combatProfile.shieldResists[1]));
  approx(result.damage.target.armorDps, appliedDroneDps * (1 - spark.combatProfile.armorResists[1]));
  approx(result.damage.target.structureDps, appliedDroneDps * (1 - spark.combatProfile.hullResists[1]));
  const expectedTtk = spark.combatProfile.shieldHp / result.damage.target.shieldDps
    + spark.combatProfile.armorHp / result.damage.target.armorDps
    + spark.combatProfile.structureHp / result.damage.target.structureDps;
  approx(result.damage.target.timeToKillSeconds, expectedTtk);
  approx(result.damage.target.trueDps, result.damage.target.totalHp / expectedTtk);
  assert.ok(result.damage.target.trueDps < result.damage.appliedDpsBeforeTargetResists, 'target resistances should reduce true DPS for Ogre II thermal damage');

  console.log(`NPC damage profiles: PASS (${abyss.length} Abyss profiles, ${allCombat.length} SDE combat profiles)`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});