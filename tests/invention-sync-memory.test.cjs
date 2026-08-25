const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "electron", "main-task9.ts"), "utf8");
const iskLab = fs.readFileSync(path.join(root, "src", "IskLab.tsx"), "utf8");

function between(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `Missing start marker: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `Missing end marker: ${end}`);
  return source.slice(from, to);
}

test("Sync All keeps Invention off the sync critical path", () => {
  const prep = between(main, 'const inventionPrep = () => {', 'const pvePrep = () =>');
  assert.match(prep, /Prepared on demand when Invention is opened\./);
  assert.doesNotMatch(prep, /task:\s*["']invention["']/);
  assert.doesNotMatch(prep, /loadPreparedInventionResult/);
});

test("prepared Invention cache lookup does not deserialize the all-region market", () => {
  const lookup = between(main, 'async function loadPreparedInventionResult', 'async function runCompleteSync');
  assert.match(lookup, /loadPersistedResult/);
  assert.doesNotMatch(lookup, /loadLatestMarketDatasetByMode/);
  assert.doesNotMatch(lookup, /loadRecentPersistedResults/);
});

test("Invention cache misses run in the bounded feature worker with a trimmed snapshot", () => {
  const handler = between(main, '"industrial:invention-opportunities"', 'ipcMain.handle("industrial:manufacturing-plan"');
  assert.match(handler, /runFeaturePrepWorker/);
  assert.match(handler, /snapshot:\s*inventionWorkerSnapshot\(snapshot\)/);
  assert.match(main, /resourceLimits:\s*task === "invention" \? \{ maxOldGenerationSizeMb: 768 \}/);
});

test("opening Invention triggers on-demand preparation when no cached result exists", () => {
  assert.match(iskLab, /setTab\("invention"\); if \(!inventionAnalysis && !inventionBusy\) void scanInvention\(\);/);
  assert.match(iskLab, /Invention is prepared on demand\. Open the Invention tab to build it\./);
});