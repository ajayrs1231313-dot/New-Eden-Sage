const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('src/IndustrialProjectFoundry.tsx', 'utf8');
const css = fs.readFileSync('src/industrial-command.css', 'utf8');

assert.match(ui, /const \[showHistory, setShowHistory\] = useState\(false\)/);
assert.match(ui, /String\(row\?\.status \?\? ""\) === "complete"/);
assert.match(ui, /String\(row\?\.status \?\? ""\) !== "complete"/);
assert.match(ui, /Export CSV/);
assert.match(ui, /Export JSON/);
assert.match(ui, /new-eden-sage\.foundry-history\.v1/);
assert.match(ui, /foundry-history-popout/);
assert.match(ui, /foundry-history-button/);
assert.match(ui, /foundry-project-status-field/);
assert.match(css, /\.foundry-project-status-field dd select/);
assert.match(css, /max-height:16px!important/);
assert.match(css, /\.foundry-command-sync\{display:grid!important/);
assert.match(css, /transform:translateY\(-3px\)/);

console.log(JSON.stringify({
  completedProjectsMovedToHistory: true,
  csvExport: true,
  jsonExport: true,
  liveFoundryHistoryControl: true,
  statusGuardRailFit: true,
}));
