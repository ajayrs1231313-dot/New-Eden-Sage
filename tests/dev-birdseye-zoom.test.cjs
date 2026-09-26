const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('electron/main-task9.ts', 'utf8');

assert.match(source, /let devVisualScale = 1;/);
assert.match(source, /transform:\s*scale\(var\(--sage-dev-visual-scale, 1\)\)/);
assert.match(source, /transform-origin: 50% 0/);
assert.match(source, /devVisualScale = clampDevZoom\(devVisualScale \+ \(zoomIn \? DEV_ZOOM_STEP : -DEV_ZOOM_STEP\)\)/);
assert.doesNotMatch(source, /devZoomOverride/);
assert.doesNotMatch(source, /createdWindow\.webContents\.setZoomFactor\(devVisual/);
assert.match(source, /if \(isDevelopmentRun\(\)\) void applyDevVisualScale\(createdWindow\);/);

console.log(JSON.stringify({ devBirdseyeUsesVisualTransform: true, electronZoomUntouchedByDevKeys: true }));
