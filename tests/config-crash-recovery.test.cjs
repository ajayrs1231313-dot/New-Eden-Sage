const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const config = fs.readFileSync("electron/config.ts", "utf8");

test("settings writes commit atomically and retain a recoverable backup", () => {
  assert.match(config, /settings\.json/);
  assert.match(config, /configBackupPath/);
  assert.match(config, /\.tmp-\$\{process\.pid\}-\$\{Date\.now\(\)\}/);
  assert.match(config, /await fs\.rename\(temporary, target\)/);
  assert.match(config, /JSON\.parse\(previous\)/);
  assert.match(config, /await fs\.writeFile\(backup, serialized/);
});

test("corrupt primary settings recover from the last known-good backup", () => {
  const readConfig = config.slice(config.indexOf("export async function readConfig"), config.indexOf("export async function writeConfig"));
  assert.match(readConfig, /readConfigFile\(configBackupPath\(\)\)/);
  assert.match(readConfig, /await writeConfig\(recovered\)/);
});
