const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const main = read("electron/main-task9.ts");
const worker = read("electron/feature-prep-process.ts");

test("isolated feature workers receive the snapshot encryption key over IPC", () => {
  assert.match(main, /let featurePrepPrivateDataKey: string \| null = null;/);
  assert.match(main, /featurePrepPrivateDataKey = privateDataKey;/);
  assert.match(main, /const featureProcessInput = featurePrepPrivateDataKey[\s\S]*privateDataKey: featurePrepPrivateDataKey[\s\S]*child\.send\?\.\(featureProcessInput/);
});

test("feature worker initializes snapshot crypto before any snapshot-backed task", () => {
  assert.match(worker, /import \{ configureSnapshotEncryptionKey \} from "\.\/snapshot-crypto";/);
  assert.match(worker, /privateDataKey\?: string/);
  const configureAt = worker.indexOf("configureSnapshotEncryptionKey(String(input.privateDataKey))");
  const industrialAt = worker.indexOf('input.task === "industrial-command"');
  const snapshotAt = worker.indexOf("const snapshot = getSnapshot(input.characterId)");
  assert.ok(configureAt >= 0 && configureAt < industrialAt && configureAt < snapshotAt, "snapshot crypto must initialize before Industrial Command or direct snapshot reads");
});

test("private snapshot key is not exposed through the child process environment", () => {
  const forkStart = main.indexOf('fork(path.join(__dirname, "feature-prep-process.js")');
  const forkEnd = main.indexOf("});", forkStart);
  const forkBlock = main.slice(forkStart, forkEnd + 3);
  assert.doesNotMatch(forkBlock, /privateDataKey|PRIVATE_DATA_KEY/);
  assert.match(forkBlock, /NEW_EDEN_SAGE_USER_DATA: USER_DATA_ROOT/);
});
