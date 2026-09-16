const assert = require('node:assert/strict');
const fs = require('node:fs');

const fitter = fs.readFileSync('src/Fittings.tsx', 'utf8');
const planner = fs.readFileSync('src/SkillsWorkspace.tsx', 'utf8');
const types = fs.readFileSync('src/types.ts', 'utf8');
const css = fs.readFileSync('src/skills-task5.css', 'utf8');

assert.match(fitter, /abyss:\s*abyssSelection\.enabled/, 'fit export must carry selected Abyss scenario');
assert.match(fitter, /representativeTimerMarginSeconds/, 'fit export must carry timer margin');
assert.match(fitter, /scenarioTankEhpPerSecond/, 'fit export must carry scenario-adjusted tank');
assert.match(types, /abyss\?:\s*\{/, 'resolution intent must support Abyss context');
assert.match(types, /performance\?:\s*\{/, 'resolution intent must support fit performance context');
assert.match(planner, /ACTIVITY COMMAND - ABYSS FIT REVIEW/);
assert.match(planner, /What to improve first/);
assert.match(planner, /Known heavy-room envelope/);
assert.match(planner, /Exact fitting blockers & verified remedies/);
assert.match(planner, /not spawn-frequency weighted/);
assert.match(css, /\.abyss-review-metrics/);
assert.match(css, /\.abyss-review-priority/);
console.log('activity-command-abyss-review: ok');
