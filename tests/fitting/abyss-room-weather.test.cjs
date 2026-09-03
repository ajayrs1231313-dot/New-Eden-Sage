const assert = require('node:assert/strict');
const dogma = require('../../dist-electron/fitting-dogma.js');
const abyss = require('../../dist-electron/abyss-encounters.js');

const approx = (actual, expected, epsilon = 1e-8, label = '') => {
  assert.ok(Number.isFinite(actual), `${label || 'value'} is not finite: ${actual}`);
  assert.ok(Math.abs(actual - expected) <= epsilon, `${label || 'value'} ${actual} != ${expected}`);
};

const snapshot = {
  character: { name: 'Abyss numerical regression' },
  skills: { total_sp: 0, skills: [] },
  extended: { implants: [] },
};

(async () => {
  // Encounter/tier filtering and verified high-tier dataset shape.
  assert.ok(abyss.abyssEncountersForTier(0).some(room => room.key === 't0-edencom-skybreaker'));
  assert.ok(!abyss.abyssEncountersForTier(1).some(room => room.key === 't0-edencom-skybreaker'));
  assert.equal(abyss.abyssEncountersForTier(5).length, 11, 'T5 documented catalogue count changed unexpectedly');
  const t6Catalogue = abyss.abyssEncountersForTier(6);
  assert.equal(t6Catalogue.length, 21, 'T6 should contain 2 documented rows plus 19 distinct live observations');
  for (const key of [
    't6-overmind',
    't6-observed-drone-grips',
    't6-observed-leshak',
    't6-observed-drifter-command-a',
    't6-observed-sansha',
    't6-observed-angel-a',
  ]) assert.ok(t6Catalogue.some(room => room.key === key), `missing verified T6 room ${key}`);
  assert.match(abyss.ABYSS_DATASET_PROVENANCE.limitation, /non-exhaustive/i);
  assert.match(abyss.ABYSS_DATASET_PROVENANCE.limitation, /not merged into guessed/i);

  // Pure weather resistance transformation: 50% Exotic increases post-resist kinetic vulnerability by 50%.
  const knownResists = [0.2, 0.4, 0.6, 0.8];
  const exoticResists = abyss.applyAbyssWeatherResists(knownResists, 'exotic', 0.5);
  approx(exoticResists[0], 0.2, 1e-12, 'Exotic EM unchanged');
  approx(exoticResists[1], 0.4, 1e-12, 'Exotic thermal unchanged');
  approx(exoticResists[2], 1 - (1 - 0.6) * 1.5, 1e-12, 'Exotic kinetic penalty');
  approx(exoticResists[3], 0.8, 1e-12, 'Exotic explosive unchanged');

  const ids = new Map((await dogma.resolveFittingTypeNamesLocal([
    'Ishtar',
    'Ogre II',
    '200mm Railgun II',
    'Antimatter Charge S',
  ])).map(item => [item.name, item.id]));
  const id = name => {
    const value = ids.get(name);
    assert.ok(value, `Missing local-SDE type ${name}`);
    return value;
  };
  const fitItems = [
    { typeId: id('200mm Railgun II'), quantity: 1, rack: 'high', chargeTypeId: id('Antimatter Charge S'), state: 'active' },
    { typeId: id('Ogre II'), quantity: 5, activeQuantity: 5, rack: 'drone' },
  ];
  const analyze = abyssProfile => dogma.analyzeFittingDogma({
    hullTypeId: id('Ishtar'),
    items: fitItems,
    snapshot,
    targetProfile: { rangeM: 10000, signatureRadiusM: 125, transverseVelocityMps: 0, velocityMps: 0 },
    ...(abyssProfile ? { abyssProfile } : {}),
  });

  const normal = await analyze();
  assert.equal(normal.abyss, undefined, 'normal fitter must remain unchanged when the Abyss profile is disabled');

  // Electrical: EM resistance penalty and capacitor recharge doubled (time halved).
  const electrical = await analyze({ tier: 5, weather: 'electrical', penalty: 0.5, roomKey: 'all' });
  approx(electrical.capacitor.rechargeSeconds, normal.capacitor.rechargeSeconds * 0.5, 1e-9, 'Electrical capacitor recharge time');
  const expectedElectricalShield = abyss.applyAbyssWeatherResists(normal.defence.shieldResists, 'electrical', 0.5);
  approx(electrical.defence.shieldResists[0], expectedElectricalShield[0], 1e-12, 'Electrical shield EM resist');

  // Exotic: kinetic resistance penalty and scan resolution +50%.
  const exotic = await analyze({ tier: 5, weather: 'exotic', penalty: 0.5, roomKey: 'all' });
  approx(exotic.targeting.scanResolution, normal.targeting.scanResolution * 1.5, 1e-8, 'Exotic scan resolution');
  const expectedExoticShield = abyss.applyAbyssWeatherResists(normal.defence.shieldResists, 'exotic', 0.5);
  approx(exotic.defence.shieldResists[2], expectedExoticShield[2], 1e-12, 'Exotic shield kinetic resist');

  // Firestorm: armor HP +50% and thermal resistance penalty.
  const firestorm = await analyze({ tier: 5, weather: 'firestorm', penalty: 0.5, roomKey: 'all' });
  approx(firestorm.defence.armorHp, normal.defence.armorHp * 1.5, 1e-8, 'Firestorm armor HP');
  const expectedFirestormArmor = abyss.applyAbyssWeatherResists(normal.defence.armorResists, 'firestorm', 0.5);
  approx(firestorm.defence.armorResists[1], expectedFirestormArmor[1], 1e-12, 'Firestorm armor thermal resist');

  // Gamma: shield HP +50% and explosive resistance penalty.
  const gamma = await analyze({ tier: 5, weather: 'gamma', penalty: 0.5, roomKey: 'all' });
  approx(gamma.defence.shieldHp, normal.defence.shieldHp * 1.5, 1e-8, 'Gamma shield HP');
  const expectedGammaShield = abyss.applyAbyssWeatherResists(normal.defence.shieldResists, 'gamma', 0.5);
  approx(gamma.defence.shieldResists[3], expectedGammaShield[3], 1e-12, 'Gamma shield explosive resist');

  // Dark: turret optimal/falloff reduced by selected penalty and velocity +50%.
  const dark = await analyze({ tier: 5, weather: 'dark', penalty: 0.5, roomKey: 'all' });
  assert.ok(normal.damage.weaponProfiles.length > 0, 'turret profile missing from baseline');
  approx(dark.damage.weaponProfiles[0].optimalM, normal.damage.weaponProfiles[0].optimalM * 0.5, 1e-8, 'Dark turret optimal');
  approx(dark.damage.weaponProfiles[0].falloffM, normal.damage.weaponProfiles[0].falloffM * 0.5, 1e-8, 'Dark turret falloff');
  approx(dark.navigation.baseMaximumVelocity, normal.navigation.baseMaximumVelocity * 1.5, 1e-8, 'Dark maximum velocity');

  // Count aggregation and each incoming damage channel independently.
  const benthic = exotic.abyss.rooms.find(room => room.key === 't5-overmind');
  assert.ok(benthic, 'T5 Benthic Overmind room missing');
  const aggregate = benthic.targets.reduce((sum, target) => {
    sum.em += target.outgoingDps.em * target.count;
    sum.thermal += target.outgoingDps.thermal * target.count;
    sum.kinetic += target.outgoingDps.kinetic * target.count;
    sum.explosive += target.outgoingDps.explosive * target.count;
    return sum;
  }, { em: 0, thermal: 0, kinetic: 0, explosive: 0 });
  approx(benthic.incoming.em, aggregate.em, 1e-8, 'room EM aggregation');
  approx(benthic.incoming.thermal, aggregate.thermal, 1e-8, 'room thermal aggregation');
  approx(benthic.incoming.kinetic, aggregate.kinetic, 1e-8, 'room kinetic aggregation');
  approx(benthic.incoming.explosive, aggregate.explosive, 1e-8, 'room explosive aggregation');
  approx(benthic.incoming.totalDps, aggregate.em + aggregate.thermal + aggregate.kinetic + aggregate.explosive, 1e-8, 'room total aggregation');

  // Weather is applied to room NPC HP/resists, not only the player fit.
  const benthicTarget = benthic.targets[0];
  const expectedNpcKinetic = abyss.applyAbyssWeatherResists(benthicTarget.baseResists.shield, 'exotic', 0.5)[2];
  approx(benthicTarget.weatherResists.shield[2], expectedNpcKinetic, 1e-12, 'room NPC Exotic kinetic resist');
  assert.ok(Number.isFinite(benthicTarget.trueDps) && benthicTarget.trueDps >= 0, 'room NPC true DPS missing');
  assert.ok(Number.isFinite(benthicTarget.ttkSeconds) && benthicTarget.ttkSeconds > 0, 'room NPC TTK missing');

  // Whole-room elapsed clear = combat TTK + practical drone target-to-target navigation.
  const expectedCombat = benthic.targets.filter(target => target.requiredForClear)
    .reduce((sum, target) => sum + target.ttkSeconds * target.count, 0);
  approx(benthic.combatSeconds, expectedCombat, 1e-8, 'whole-room combat time');
  assert.equal(benthic.timingGeometry, 'estimated');
  assert.equal(benthic.droneNavigation.mode, 'mobile');
  assert.ok(benthic.droneNavigation.effectiveMaxVelocityMps > 0, 'effective drone velocity missing');
  assert.ok(benthic.droneNavigationSeconds > 0, 'mobile drones should add practical navigation time');
  approx(benthic.clearSeconds, benthic.combatSeconds + benthic.droneNavigationSeconds, 1e-8, 'whole-room elapsed clear time');
  assert.ok(benthic.clearSeconds > benthic.combatSeconds, 'navigation must not be folded into a fake DPS number');

  assert.match(exotic.abyss.clearTimeCaveat, /Ship travel time is not included/i);
  assert.equal(exotic.abyss.siteEstimate.roomCount, 3);
  const finiteT5Rooms = exotic.abyss.rooms.filter(room => Number.isFinite(room.clearSeconds));
  const meanT5Clear = finiteT5Rooms.reduce((sum, room) => sum + room.clearSeconds, 0) / finiteT5Rooms.length;
  approx(exotic.abyss.siteEstimate.representative.estimatedClearSeconds, meanT5Clear * 3, 1e-8, 'representative site clear');
  approx(exotic.abyss.siteEstimate.representative.timerMarginSeconds, 1200 - meanT5Clear * 3, 1e-8, 'Abyss timer margin');

  // Documented hostile caps must constrain deterministic threat-envelope selection.
  const tier1 = await analyze({ tier: 1, weather: 'exotic', penalty: 0.5, roomKey: 'all' });
  for (const [key, cap] of [
    ['t1-edencom-pack', 3],
    ['t1-sleeper-mixed', 3],
    ['t1-sleeper-cruiser', 2],
  ]) {
    const room = tier1.abyss.rooms.find(candidate => candidate.key === key);
    assert.ok(room, `missing capped room ${key}`);
    assert.ok(room.totalHostiles <= cap, `${key} exceeded documented hostile cap ${cap}: ${room.totalHostiles}`);
  }

  // Triglavian ramp: SDE maximum damage bonus is a bonus, so a 150% bonus means base ×2.5.
  const tier6 = await analyze({ tier: 6, weather: 'exotic', penalty: 0.5, roomKey: 'all' });
  assert.equal(tier6.abyss.summary.roomCount, 21);
  const leshakRoom = tier6.abyss.rooms.find(room => room.key === 't6-observed-leshak');
  assert.ok(leshakRoom, 'observed T6 Leshak room missing');
  const strikingLeshak = leshakRoom.targets.find(target => target.name === 'Striking Leshak');
  assert.ok(strikingLeshak, 'Striking Leshak missing from observed T6 room');
  assert.ok(strikingLeshak.outgoingDpsMaxTotal > strikingLeshak.outgoingDpsTotal, 'Triglavian max-ramp DPS must exceed base DPS');
  approx(strikingLeshak.outgoingDpsMaxTotal / strikingLeshak.outgoingDpsTotal, 2.5, 1e-8, 'Leshak max-ramp multiplier');

  // Summary paths required by All Possible Rooms.
  for (const field of ['worstIncoming', 'worstMaxRamp', 'worstEm', 'worstThermal', 'worstKinetic', 'worstExplosive', 'longestClear', 'hardestTarget', 'highestEhpTarget']) {
    assert.ok(tier6.abyss.summary[field], `missing Abyss summary ${field}`);
  }
  assert.ok(tier6.abyss.limitations.some(text => /non-exhaustive/i.test(text)), 'T6 incompleteness must remain visible');

  console.log(`Abyss room/weather numerical regression: PASS (${tier6.abyss.summary.roomCount} known T6 compositions)`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
