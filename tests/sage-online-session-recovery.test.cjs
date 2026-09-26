const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const main = fs.readFileSync("electron/main-task9.ts", "utf8");
const migration = main.slice(main.indexOf("async function ensureEsiScopeSchemaMigration"), main.indexOf("async function planetaryCorporationContext"));
const authFlow = main.slice(main.indexOf("const becamePrimaryIdentity"), main.indexOf("const mailCoverage"));

test("ESI scope migration preserves the independent Sage Online session", () => {
  assert.match(migration, /config\.encryptedRefreshTokens = \{\}/);
  assert.doesNotMatch(migration, /config\.encryptedSageSessionToken = undefined/);
  assert.match(migration, /sageSessionPreserved/);
});

test("identity claim completes before authorization returns instead of racing in a detached task", () => {
  assert.doesNotMatch(authFlow, /void \(async \(\) =>/);
  assert.match(authFlow, /onlineIdentitySynced = true/);
  assert.match(authFlow, /sage-online\.identity-link-failed/);
});
