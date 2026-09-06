const assert = require('node:assert/strict');
const path = require('node:path');
const { isRepoElectronMain } = require('../../scripts/dev-process-detection.cjs');

const root = String.raw`C:\Users\Administrator\Documents\GameDev\New Eden Sage`;
const exe = root + String.raw`\node_modules\electron\dist\electron.exe`;

assert.equal(isRepoElectronMain({ ProcessId: 28368, Name: 'electron.exe', CommandLine: '"' + exe + '" --user-data-dir=C:/Users/Administrator/AppData/Roaming/new-eden-sage-dev .' }, root), true, 'legacy repo Electron main without --dev must be detected');
assert.equal(isRepoElectronMain({ ProcessId: 28369, Name: 'electron.exe', CommandLine: '"' + exe + '" --user-data-dir=C:/tmp/sage . --dev' }, root), true, 'current dev Electron main must be detected');
assert.equal(isRepoElectronMain({ ProcessId: 28370, Name: 'electron.exe', CommandLine: '"' + exe + '" --type=renderer --user-data-dir=C:/tmp/sage' }, root), false, 'Electron child processes must not be treated as mains');
assert.equal(isRepoElectronMain({ ProcessId: 28371, Name: 'New Eden Sage.exe', CommandLine: '"C:/Program Files/New Eden Sage/New Eden Sage.exe"' }, root), false, 'packaged Sage must never be targeted');
assert.equal(isRepoElectronMain({ ProcessId: 28372, Name: 'electron.exe', CommandLine: '"C:/other/project/node_modules/electron/dist/electron.exe" .' }, root), false, 'other Electron repos must never be targeted');
console.log('dev process detection tests passed');
