const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'FleetCommand.tsx'), 'utf8');

const forbiddenUiCopy = [
  'Sage DOGMA',
  'system-wide DOGMA',
  'hostile-observable state',
  'The dashed vector is prediction',
  'existing fitting/DOGMA engine',
  'published hulls',
  '>MCP<',
  '43%',
];

for (const phrase of forbiddenUiCopy) {
  assert.equal(source.includes(phrase), false, `Wargame UI leaked internal/developer copy: ${phrase}`);
}

console.log('wargame UI copy regression: PASS');
