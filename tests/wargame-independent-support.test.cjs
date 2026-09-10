const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'src');
const ui = fs.readFileSync(path.join(root, 'FleetCommand.tsx'), 'utf8');
const types = fs.readFileSync(path.join(root, 'wargame-types.ts'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'wargame-engine.ts'), 'utf8');
const session = fs.readFileSync(path.join(root, 'wargame-session.ts'), 'utf8');

// Domain state belongs in the pure Wargame model, not the React control surface.
assert.match(types, /supportTargetIds\?: Record<string, string \| undefined>/, 'formation support targets must be independently stored in the domain model');
assert.match(types, /supportLastTargetIds\?: Record<string, string \| undefined>/, 'remote reps must retain per-channel lock targets in domain state');
assert.match(types, /supportLockRemaining\?: Record<string, number>/, 'remote reps must retain per-channel lock timers in domain state');

// The human FC surface must still author independent support assignments and branches.
assert.match(ui, /function updateOrderSupportTarget\(/, 'order editor must expose per-support-system assignments');
assert.match(ui, /wargameSupportSystemKey\(system,\s*(?:supportIndex|index)\)/, 'support systems need stable per-module command keys');
assert.match(ui, /BRANCH IF/, 'FC UI must expose conditional branch authoring');
assert.match(ui, /START WHEN/, 'FC UI must expose delayed/conditional step starts');

// Runtime mechanics and order decisions now belong to the authoritative engine.
assert.match(engine, /computeWargameCommandBurstModifiers/, 'battle engine must consume command burst calculations');
assert.match(engine, /canStartWargameOrder/, 'battle engine must own order start conditions');
assert.match(engine, /nextWargameOrderIndex/, 'battle engine must own branch selection');
assert.match(engine, /supportTargetIds/, 'battle engine must resolve independent support targets');
assert.match(engine, /supportLastTargetIds/, 'battle engine must resolve independent rep-channel lock state');
assert.match(engine, /supportLockRemaining/, 'battle engine must resolve independent rep-channel lock timers');

// React mutations must cross the shared command/session boundary rather than mutate simulator state directly.
assert.match(session, /kind: "patch-unit"/, 'session command model must support authoritative unit patches');
assert.match(ui, /executeWargameCommand\(/, 'FC surface must route Wargame mutations through the session command layer');

console.log('wargame independent support integration: PASS');
