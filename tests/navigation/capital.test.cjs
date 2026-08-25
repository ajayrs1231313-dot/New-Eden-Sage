const assert = require('node:assert/strict');

module.exports = async function capitalTests() {
  const cap = require('../../dist-electron/navigation-capital.js');
  const graph = require('../../dist-electron/universe-route-graph.js');
  const exact = async (name) => {
    const rows = await graph.searchNavigationSystems(name, 8);
    const row = rows.find((item) => item.name === name);
    assert(row, `Missing SDE fixture system ${name}`);
    return row;
  };
  const Tama = await exact('Tama');
  const Amamake = await exact('Amamake');
  const OldManStar = await exact('Old Man Star');
  const Jita = await exact('Jita');

  const skill = (id, level) => ({ skill_id: id, active_skill_level: level, trained_skill_level: level });
  const snapshot = {
    characterId: 'fixture-capital',
    character: { name: 'Capital Fixture' },
    skills: { skills: [skill(cap.NAVIGATION_JDC_SKILL_TYPE_ID, 5), skill(cap.NAVIGATION_JFC_SKILL_TYPE_ID, 5)] },
    ship: {},
  };
  const noSkillSnapshot = {
    characterId: 'fixture-noskill',
    character: { name: 'No Skill Fixture' },
    skills: { skills: [] },
    ship: {},
  };
  const context = await cap.getNavigationCapitalContext(snapshot.characterId, [snapshot]);
  const rorqual = context.hulls.find((h) => h.name === 'Rorqual');
  const anshar = context.hulls.find((h) => h.name === 'Anshar');
  assert(rorqual, 'Rorqual must exist in SDE capital catalogue');
  assert(anshar, 'Anshar must exist in SDE capital catalogue');

  assert.equal(cap.navigationEffectiveJumpRange(rorqual, 0), rorqual.baseRangeLy);
  assert.equal(cap.navigationEffectiveJumpRange(rorqual, 5), rorqual.baseRangeLy * 2);
  assert.equal(cap.navigationFuelForLeg(rorqual, 2, 0), Math.ceil(rorqual.fuelPerLy * 2));
  assert.equal(cap.navigationFuelForLeg(rorqual, 2, 5), Math.ceil(rorqual.fuelPerLy * 2 * 0.5));

  const fatigue = cap.simulateJumpFatigue([2, 4, 6], 1, 0);
  assert.equal(fatigue.length, 3);
  assert(fatigue.every((row) => row.activationCooldownMinutes <= cap.NAVIGATION_ACTIVATION_CAP_MINUTES));
  assert(fatigue.every((row) => row.fatigueAfterJumpMinutes <= cap.NAVIGATION_FATIGUE_CAP_MINUTES));
  assert(fatigue[1].fatigueBeforeMinutes >= 0);

  const noSkillContext = await cap.getNavigationCapitalContext(noSkillSnapshot.characterId, [noSkillSnapshot]);
  assert.equal(noSkillContext.jumpDriveCalibrationLevel, 0);
  assert.equal(context.jumpDriveCalibrationLevel, 5);
  assert.equal(context.jumpFuelConservationLevel, 5);

  const standard = await cap.calculateNavigationCapitalPlan({
    characterId: snapshot.characterId,
    shipTypeId: rorqual.typeId,
    fromSystemId: Tama.systemId,
    toSystemId: Amamake.systemId,
    includeLiveIntelligence: false,
  }, [snapshot]);
  assert.equal(standard.found, true);
  assert(standard.jumps >= 2, 'fixture should exercise midpoint routing');
  assert(standard.candidateMidpoints.length >= 1);
  assert(standard.alternatives.length >= 2, 'fixture should produce alternate chains');
  assert(standard.totalFuelUnits > 0);
  assert(standard.legs.every((leg) => leg.distanceLy <= standard.effectiveRangeLy + 1e-9));

  const jf = await cap.calculateNavigationCapitalPlan({
    characterId: snapshot.characterId,
    shipTypeId: anshar.typeId,
    fromSystemId: OldManStar.systemId,
    toSystemId: Jita.systemId,
    includeLiveIntelligence: false,
  }, [snapshot]);
  assert.equal(jf.found, true);
  assert(jf.jumpFreighterTransitions.length >= 1);
  const transition = jf.jumpFreighterTransitions[0];
  assert(transition.lowSecSystem.securityStatus < 0.5);
  assert(transition.highSecSystem.securityStatus >= 0.5);
  assert(transition.gateRoute.jumps >= 1);
  assert(transition.totalTravelLegs >= transition.capitalCandidate.jumps);

  return {
    standardJumps: standard.jumps,
    midpoint: standard.candidateMidpoints[0]?.name,
    alternatives: standard.alternatives.length,
    fuel: standard.totalFuelUnits,
    jfTransitions: jf.jumpFreighterTransitions.length,
  };
};
