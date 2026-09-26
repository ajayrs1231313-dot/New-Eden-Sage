const assert = require('node:assert/strict');
const readiness = require('../../dist-electron/readiness.js');

(async () => {
  const snapshot = {
    characterId: 'patch-level-zero',
    character: { name: 'New Character' },
    skills: {
      skills: [{
        skill_id: 3330,
        name: 'Caldari Frigate',
        trained_skill_level: 0,
        active_skill_level: 0,
        skillpoints_in_skill: 0,
      }],
    },
    queue: [],
    attributes: { intelligence:20, memory:20, perception:20, willpower:20, charisma:19 },
  };

  const plan = await readiness.analyzeTrainingPlan(
    snapshot,
    [],
    [{ skill:'Caldari Frigate', level:1, reason:'Cradle of War level-zero injection regression' }],
    'omega',
  );
  const row = plan.relevantSkills.find((skill) => skill.skillId === 3330);
  assert.ok(row, 'Injected level-zero skill must remain visible in readiness');
  assert.equal(row.currentLevel, 0);
  assert.equal(row.targetLevel, 1);
  assert.equal(row.met, false, 'Injected level-zero skill must not satisfy level-1 requirement');
  assert.equal(row.missingLevels, 1);
  assert.ok(plan.missingSkills.some((skill) => skill.skillId === 3330));

  console.log('CRADLE OF WAR LEVEL-ZERO SKILL REGRESSION: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
