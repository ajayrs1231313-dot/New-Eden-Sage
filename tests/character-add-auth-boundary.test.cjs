const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "electron/main-task9.ts"), "utf8");
const start = main.indexOf('ipcMain.handle("eve:login"');
const end = main.indexOf('ipcMain.handle("eve:refresh"', start);
assert.ok(start >= 0 && end > start, "must locate the Add Character IPC handler");
const login = main.slice(start, end);

assert.ok(login.includes("createConnectedCharacterBootstrapSnapshot"), "Add Character must persist a bootstrap snapshot as soon as OAuth succeeds");
assert.ok(login.includes("saveSnapshot(snapshot)"), "Add Character must make the newly authorized character visible locally");
assert.ok(!login.includes("await fetchCharacterCoreSnapshot"), "Add Character must not wait on downstream ESI core refreshes");
assert.ok(login.indexOf("await writeConfig(config)") < login.indexOf("createConnectedCharacterBootstrapSnapshot"), "refresh token must be persisted before the local bootstrap is exposed");
assert.ok(login.indexOf("createConnectedCharacterBootstrapSnapshot") < login.indexOf("return {"), "bootstrap registration must complete before the renderer receives success");

const refreshStart = main.indexOf('ipcMain.handle("eve:refresh"');
const refreshTail = main.slice(refreshStart, refreshStart + 1800);
assert.ok(refreshTail.includes("fetchCharacterCoreSnapshot"), "explicit character refresh must retain the focused core ESI path");

console.log("character add auth-boundary regression checks passed");
