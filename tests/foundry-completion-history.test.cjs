const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('src/IndustrialProjectFoundry.tsx', 'utf8');
const backend = fs.readFileSync('electron/project-foundry.ts', 'utf8');

assert.match(ui, /I BUILT THIS/);
assert.match(ui, /I HAVE ALREADY BUILT THIS/);
assert.match(ui, /completeProject\("built"\)/);
assert.match(ui, /completeProject\("already-built"\)/);
assert.match(ui, /Project marked complete and added to Project History/);
assert.match(backend, /completedAt\?: string/);
assert.match(backend, /completionSource\?: "built" \| "already-built"/);
assert.match(backend, /completedByCharacterId\?: string/);
assert.match(backend, /completedByCharacterName\?: string/);

console.log(JSON.stringify({
  builtAction: true,
  alreadyBuiltOverride: true,
  completionHistoryMetadata: true,
}));
