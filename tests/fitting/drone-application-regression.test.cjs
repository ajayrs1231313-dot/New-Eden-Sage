const assert = require('node:assert/strict');
const dogma = require('../../dist-electron/fitting-dogma.js');

const approx = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
const snapshot = (skills = []) => ({
  character: { name: 'Drone application regression' },
  skills: { total_sp: 0, skills: skills.map(([skill_id, level]) => ({ skill_id, trained_skill_level: level, active_skill_level: level, skillpoints_in_skill: 1 })) },
  extended: { implants: [] },
});

(async () => {
  const wanted = ['Ishtar', 'Ogre II', 'Garde II', 'Drone Navigation', 'Drone Sharpshooting', 'Drone Avionics', 'Advanced Drone Avionics', 'Omnidirectional Tracking Link II', 'Tracking Speed Script', 'Optimal Range Script', 'Proteus', 'Proteus Offensive - Drone Synthesis Projector', 'Gallente Offensive Systems', '200mm Railgun II'];
  const resolved = new Map((await dogma.resolveFittingTypeNamesLocal(wanted)).map(item => [item.name, item.id]));
  for (const name of wanted) assert.ok(resolved.get(name), `missing ${name}`);

  const ishtar = resolved.get('Ishtar');
  const ogre = resolved.get('Ogre II');
  const garde = resolved.get('Garde II');
  const analyze = (drone, skills, targetProfile, extras = []) => dogma.analyzeFittingDogma({
    hullTypeId: ishtar,
    items: [{ typeId: drone, quantity: 5, activeQuantity: 5, rack: 'drone' }, ...extras],
    snapshot: snapshot(skills),
    targetProfile,
  });

  const smallTarget = { rangeM: 10000, signatureRadiusM: 40, transverseVelocityMps: 0, velocityMps: 0 };
  const largeTarget = { ...smallTarget, signatureRadiusM: 400 };
  const mobileSmall = await analyze(ogre, [], smallTarget);
  const mobileLarge = await analyze(ogre, [], largeTarget);
  const mobile = mobileSmall.damage.activeDrones[0].targetApplication;
  assert.equal(mobile.model, 'mobile-orbit-pursuit-approximation');
  assert.equal(mobile.exactPhysics, false);
  assert.ok(mobile.travelSeconds > 0);
  assert.ok(mobileSmall.damage.appliedDroneDps < mobileSmall.damage.droneDps);
  assert.ok(mobileLarge.damage.appliedDroneDps > mobileSmall.damage.appliedDroneDps);

  const navId = resolved.get('Drone Navigation');
  const fast = await analyze(ogre, [[navId, 5]], { rangeM: 10000, signatureRadiusM: 125, transverseVelocityMps: 0, velocityMps: 1400 });
  const slow = await analyze(ogre, [], { rangeM: 10000, signatureRadiusM: 125, transverseVelocityMps: 0, velocityMps: 1400 });
  approx(fast.damage.activeDrones[0].maximumVelocityMps / slow.damage.activeDrones[0].maximumVelocityMps, 1.25);
  approx(fast.damage.droneDps, slow.damage.droneDps);
  assert.ok(fast.damage.activeDrones[0].targetApplication.pursuitFactor > slow.damage.activeDrones[0].targetApplication.pursuitFactor);
  assert.ok(fast.damage.activeDrones[0].targetApplication.travelSeconds < slow.damage.activeDrones[0].targetApplication.travelSeconds);

  const sharpId = resolved.get('Drone Sharpshooting');
  const sharp = await analyze(ogre, [[sharpId, 5]], largeTarget);
  approx(sharp.damage.activeDrones[0].optimalM / mobileLarge.damage.activeDrones[0].optimalM, 1.25);

  const beyondBaseControl = { rangeM: 30000, signatureRadiusM: 400, transverseVelocityMps: 0, velocityMps: 0 };
  const noControl = await analyze(ogre, [], beyondBaseControl);
  assert.equal(noControl.damage.droneControlDistanceM, 20000);
  assert.equal(noControl.damage.activeDrones[0].targetApplication.controlFactor, 0);
  approx(noControl.damage.appliedDroneDps, 0);
  const avionicsId = resolved.get('Drone Avionics');
  const advancedId = resolved.get('Advanced Drone Avionics');
  const controlled = await analyze(ogre, [[avionicsId, 5], [advancedId, 5]], beyondBaseControl);
  assert.equal(controlled.damage.droneControlDistanceM, 60000);
  assert.equal(controlled.damage.activeDrones[0].targetApplication.controlFactor, 1);
  assert.ok(controlled.damage.appliedDroneDps > 0);

  const sentryClose = await analyze(garde, [], { rangeM: 10000, signatureRadiusM: 400, transverseVelocityMps: 0, velocityMps: 0 });
  const sentryMoving = await analyze(garde, [], { rangeM: 10000, signatureRadiusM: 400, transverseVelocityMps: 2000, velocityMps: 2000 });
  const sentry = sentryClose.damage.activeDrones[0].targetApplication;
  assert.equal(sentryClose.damage.activeDrones[0].sentry, true);
  assert.equal(sentry.model, 'sentry-turret');
  assert.equal(sentry.exactPhysics, true);
  approx(sentry.travelSeconds, 0);
  approx(sentry.applicationFactor, 1.01505);
  assert.ok(sentryMoving.damage.appliedDroneDps < sentryClose.damage.appliedDroneDps);

  const sentryBaseFar = await analyze(garde, [], { rangeM: 19000, signatureRadiusM: 400, transverseVelocityMps: 0, velocityMps: 0 });
  const sentrySharpFar = await analyze(garde, [[sharpId, 5]], { rangeM: 19000, signatureRadiusM: 400, transverseVelocityMps: 0, velocityMps: 0 });
  assert.ok(sentrySharpFar.damage.appliedDroneDps > sentryBaseFar.damage.appliedDroneDps);

  const omniId = resolved.get('Omnidirectional Tracking Link II');
  const trackingScriptId = resolved.get('Tracking Speed Script');
  const optimalScriptId = resolved.get('Optimal Range Script');
  const omniTracking = await analyze(garde, [], { rangeM: 10000, signatureRadiusM: 100, transverseVelocityMps: 1000, velocityMps: 1000 }, [{ typeId: omniId, quantity: 1, rack: 'mid', state: 'active', chargeTypeId: trackingScriptId }]);
  const omniRange = await analyze(garde, [], { rangeM: 19000, signatureRadiusM: 400, transverseVelocityMps: 0, velocityMps: 0 }, [{ typeId: omniId, quantity: 1, rack: 'mid', state: 'active', chargeTypeId: optimalScriptId }]);
  assert.ok(omniTracking.damage.activeDrones[0].tracking > sentryClose.damage.activeDrones[0].tracking);
  assert.ok(omniRange.damage.activeDrones[0].optimalM > sentryBaseFar.damage.activeDrones[0].optimalM);

  const proteusId = resolved.get('Proteus');
  const projectorId = resolved.get('Proteus Offensive - Drone Synthesis Projector');
  const offensiveId = resolved.get('Gallente Offensive Systems');
  const proteusAnalyze = (level) => dogma.analyzeFittingDogma({
    hullTypeId: proteusId,
    items: [
      { typeId: projectorId, quantity: 1, rack: 'subsystem' },
      { typeId: ogre, quantity: 5, activeQuantity: 5, rack: 'drone' },
    ],
    snapshot: snapshot(level ? [[offensiveId, level]] : []),
    targetProfile: { rangeM: 10000, signatureRadiusM: 400, transverseVelocityMps: 0, velocityMps: 0 },
    abyssProfile: { tier: 5, weather: 'exotic', penalty: 0.5, roomKey: 't5-overmind' },
  });
  const proteus0 = await proteusAnalyze(0);
  const proteus5 = await proteusAnalyze(5);
  approx(proteus0.damage.activeDrones[0].maximumVelocityMps, 1200);
  approx(proteus5.damage.activeDrones[0].maximumVelocityMps, 1500);
  approx(proteus5.damage.activeDrones[0].tracking / proteus0.damage.activeDrones[0].tracking, 1.25);
  approx(proteus5.damage.droneDps / proteus0.damage.droneDps, 1.5);
  assert.equal(proteus5.fitting.slots.high, 6);
  assert.equal(proteus5.fitting.slots.mid, 0);
  assert.equal(proteus5.fitting.slots.low, 0);
  assert.equal(proteus5.fitting.hardpoints.turret, 5);
  assert.equal(proteus5.fitting.hardpoints.launcher, 0);
  assert.ok(proteus5.abyss.selectedRoom.droneNavigationSeconds < proteus0.abyss.selectedRoom.droneNavigationSeconds);
  approx(proteus5.abyss.selectedRoom.droneNavigation.effectiveMaxVelocityMps, 1500);

  const railgunId = resolved.get('200mm Railgun II');
  const nakedGun = await dogma.checkFittingItemCompatibilityLocal({ hullTypeId: proteusId, itemTypeId: railgunId, placement: 'high', fitted: [] });
  assert.equal(nakedGun.code, 'rack-unavailable');
  const subsystemGun = await dogma.checkFittingItemCompatibilityLocal({ hullTypeId: proteusId, itemTypeId: railgunId, placement: 'high', fitted: [{ typeId: projectorId, rack: 'subsystem' }] });
  assert.equal(subsystemGun.compatible, true);
  const hardpointLimit = await dogma.checkFittingItemCompatibilityLocal({ hullTypeId: proteusId, itemTypeId: railgunId, placement: 'high', fitted: [{ typeId: projectorId, rack: 'subsystem' }, ...Array.from({ length: 5 }, () => ({ typeId: railgunId, rack: 'high' }))] });
  assert.equal(hardpointLimit.code, 'turret-hardpoints');

  console.log('drone application regression: PASS');
})().catch(error => { console.error(error); process.exit(1); });
