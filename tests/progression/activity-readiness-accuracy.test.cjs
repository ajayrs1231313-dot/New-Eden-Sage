const assert = require('node:assert/strict');
const fs = require('node:fs');
const { analyzeShipReadiness, analyzeHullAccessPreviews } = require('../../dist-electron/readiness.js');

const ATTRS = { charisma: 20, intelligence: 20, memory: 20, perception: 20, willpower: 20 };
const skill = (skill_id, name, trained_skill_level, rank = 1) => ({
  skill_id, name, trained_skill_level, active_skill_level: trained_skill_level,
  skillpoints_in_skill: trained_skill_level ? Math.ceil(250 * rank * Math.pow(2, 2.5 * (trained_skill_level - 1))) : 0,
  rank,
});
const snapshot = (characterId, skills) => ({
  characterId, character: { name: characterId }, skills: { skills }, queue: [], attributes: ATTRS,
});

const ids = {
  spaceshipCommand: 3327,
  amarrHauler: 3343,
  advancedSpaceshipCommand: 20342,
  amarrFreighter: 20524,
  providence: 20183,
};

(async () => {
  const ready = snapshot('ready', [
    skill(ids.spaceshipCommand, 'Spaceship Command', 5, 1),
    skill(ids.advancedSpaceshipCommand, 'Advanced Spaceship Command', 1, 5),
    skill(ids.amarrFreighter, 'Amarr Freighter', 1, 10),
  ]);
  const readyResult = await analyzeShipReadiness(ready, ids.providence, 'omega', 5);
  assert.equal(readyResult.hullAccessReady, true);
  assert.equal(readyResult.hullAccessPercent, 100);
  assert.equal(readyResult.hullTrainingPercent, 100);
  assert.equal(readyResult.missingHullAccessSkills.length, 0);
  assert.equal(readyResult.hullAccessTrainingSkills.length, 0);
  assert.deepEqual(readyResult.hullAccessSkills.map(s => [s.name, s.targetLevel]), [
    ['Advanced Spaceship Command', 1], ['Amarr Freighter', 1],
  ]);

  const oneGap = snapshot('one-gap', [
    skill(ids.spaceshipCommand, 'Spaceship Command', 5, 1),
    skill(ids.amarrHauler, 'Amarr Hauler', 3, 4),
    skill(ids.advancedSpaceshipCommand, 'Advanced Spaceship Command', 5, 5),
  ]);
  const oneGapResult = await analyzeShipReadiness(oneGap, ids.providence, 'omega', 5);
  assert.equal(oneGapResult.hullAccessReady, false);
  assert.equal(oneGapResult.hullAccessPercent, 0);
  assert.equal(oneGapResult.missingHullAccessSkills.length, 1);
  assert.equal(oneGapResult.missingHullAccessSkills[0].name, 'Amarr Freighter');
  assert.equal(oneGapResult.missingHullAccessSkills[0].targetLevel, 1);
  assert.equal(oneGapResult.hullAccessTrainingSkills.length, 1);
  assert.equal(oneGapResult.hullAccessTrainingSkills[0].name, 'Amarr Freighter');
  assert.equal(oneGapResult.hullAccessTrainingSkills[0].targetLevel, 1);
  assert.ok(oneGapResult.totalEstimatedSeconds > 0);

  const recursive = snapshot('recursive', [
    skill(ids.spaceshipCommand, 'Spaceship Command', 5, 1),
  ]);
  const recursiveResult = await analyzeShipReadiness(recursive, ids.providence, 'omega', 5);
  const queueNames = recursiveResult.hullAccessTrainingSkills.map(s => s.name);
  assert.equal(new Set(queueNames).size, queueNames.length, 'recursive queue must not duplicate skills');
  assert.equal(recursiveResult.hullAccessTrainingSkills.find(s => s.name === 'Advanced Spaceship Command').targetLevel, 5);
  assert.equal(recursiveResult.hullAccessTrainingSkills.some(s => s.name === 'Spaceship Command'), false, 'trained prerequisite must stay out of queue');

  const switchedReady = await analyzeHullAccessPreviews(ready, [ids.providence]);
  const switchedBlocked = await analyzeHullAccessPreviews(oneGap, [ids.providence]);
  assert.equal(switchedReady[0].hullAccessReady, true);
  assert.equal(switchedBlocked[0].hullAccessReady, false);
  assert.equal(switchedBlocked[0].missingDirectRequirements, 1);

  const resynced = snapshot('one-gap', [
    skill(ids.spaceshipCommand, 'Spaceship Command', 5, 1),
    skill(ids.amarrHauler, 'Amarr Hauler', 3, 4),
    skill(ids.advancedSpaceshipCommand, 'Advanced Spaceship Command', 5, 5),
    skill(ids.amarrFreighter, 'Amarr Freighter', 1, 10),
  ]);
  const afterSync = await analyzeShipReadiness(resynced, ids.providence, 'omega', 5);
  assert.equal(afterSync.hullAccessReady, true);
  assert.equal(afterSync.hullAccessTrainingSkills.length, 0);

  console.log('PASS Activity readiness authoritative SDE + Providence access');
  console.log('PASS Activity readiness exact one-gap queue');
  console.log('PASS Activity readiness recursive dedupe');
  console.log('PASS Activity readiness character-switch isolation');
  const plannerSource = fs.readFileSync('src/ActivityPlanner.tsx', 'utf8');
  const activitySource = fs.readFileSync('electron/activity-readiness.ts', 'utf8');
  assert.match(plannerSource, /copyTrainingPlan[\s\S]*selectedShip\.analysis\.recommendedQueue/, 'Copy Queue must use the Activity mandatory queue');
  assert.match(activitySource, /recommendedQueue:\s*combinedPlan\.recommendedQueue/, 'Activity recommendedQueue must remain the concrete blocking plan');
  assert.match(activitySource, /masteryQueue:\s*masteryPlan\.recommendedQueue/, 'mastery guidance must remain separate from the blocking plan');
  console.log('PASS Activity readiness sync refresh isolation');
  console.log('PASS Activity Copy Queue uses mandatory blocking route');
})().catch((error) => { console.error(error); process.exit(1); });
