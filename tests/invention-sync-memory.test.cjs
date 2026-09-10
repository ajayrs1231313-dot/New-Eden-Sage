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
  const sync = between(main, "async function runCompleteSync", 'app.on("render-process-gone"');
  assert.match(sync, /setTrack\("inventions", \{ percent: 100, status: "done", message: "Prepared on demand when Invention is opened\." \}\);/);
  assert.doesNotMatch(sync, /task:\s*["']invention["']/);
  assert.doesNotMatch(sync, /runFeaturePrepProcess\(/);
});

test("prepared Invention cache lookup stays lightweight", () => {
  const lookup = between(main, "async function loadPreparedInventionResult", "async function runCompleteSync");
  assert.match(lookup, /loadPersistedResult/);
  assert.doesNotMatch(lookup, /loadSharedFullMarketAnalysisIndex/);
  assert.doesNotMatch(lookup, /loadLatestMarketDatasetByMode/);
  assert.doesNotMatch(lookup, /loadRecentPersistedResults/);
});

test("industrial:invention-opportunities returns prepared data before starting fallback work", () => {
  const handler = between(main, '"industrial:invention-opportunities"', 'ipcMain.handle("industrial:manufacturing-plan"');
  const preparedReturn = handler.indexOf("if (prepared.result) return prepared.result;");
  const fallback = handler.indexOf("await runFeaturePrepProcess({");
  assert.ok(preparedReturn >= 0, "prepared result early-return is missing");
  assert.ok(fallback > preparedReturn, "fallback must run only after the prepared cache misses");
  assert.match(handler, /task:\s*"invention"/);
  assert.doesNotMatch(handler, /ensureSyncMemoryHeadroom/);
});

test("Invention bypasses the obsolete generic 3 GB sync reserve", () => {
  const featureProcess = between(main, "async function runFeaturePrepProcessNow", "function runFeaturePrepProcess");
  assert.match(featureProcess, /if \(task !== "invention"\) \{\s*const headroom = await ensureSyncMemoryHeadroom/);
  assert.match(featureProcess, /real spawn\/allocation\/process failures are still handled below/);
});

test("prepared ISK Command reads never launch Invention preparation", () => {
  const preparedHandler = between(main, 'ipcMain.handle("prepared:isk-lab"', 'ipcMain.handle("analysis:cancel"');
  assert.match(preparedHandler, /loadPreparedInventionResult/);
  assert.doesNotMatch(preparedHandler, /runFeaturePrepProcess\(/);
  assert.doesNotMatch(preparedHandler, /task:\s*"invention"/);
});

test("only the visible Invention tab can wake a cache-miss build", () => {
  assert.match(iskLab, /tab === "invention"\s*\? "invention"\s*:\s*null/);
  assert.match(iskLab, /getPreparedIskLab\(\{ characterId: snapshot\.characterId, cloneState, modules: \[preparedModule\] \}\)/);
  assert.match(iskLab, /shouldWakeIskModule\(\{ active, visible: true, prepared: prepared\.invention, busy: inventionBusy/);
  assert.match(iskLab, /void scanInvention\(\);/);
  assert.match(iskLab, /onClick=\{\(\) => setTab\("invention"\)\}/);
});
