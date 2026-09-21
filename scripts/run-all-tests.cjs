const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const testsRoot = path.join(root, "tests");
const reportPath = path.join(os.tmpdir(), "new-eden-sage-test-all-report.json");
const timeoutMs = 120_000;

function walk(directory, out = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(test|spec)\.(cjs|mjs|js)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function tail(value, max = 6000) {
  const text = String(value ?? "");
  return text.length > max ? text.slice(-max) : text;
}

const files = walk(testsRoot).sort((a, b) => a.localeCompare(b));
const results = [];
let failed = 0;

console.log(`Running ${files.length} standalone Sage regression files...\n`);

for (let index = 0; index < files.length; index += 1) {
  const file = files[index];
  const relative = path.relative(root, file);
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "new-eden-sage-test-"));
  const started = Date.now();

  const result = spawnSync(process.execPath, ["--experimental-strip-types", file], {
    cwd: root,
    env: { ...process.env, NEW_EDEN_SAGE_USER_DATA: dataRoot },
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });

  const durationMs = Date.now() - started;
  try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch {}

  const ok = result.status === 0 && !result.error;
  if (!ok) failed += 1;

  const row = {
    file: relative,
    ok,
    status: result.status,
    signal: result.signal ?? null,
    durationMs,
    error: result.error ? String(result.error.stack ?? result.error) : "",
    stdout: ok ? "" : tail(result.stdout),
    stderr: ok ? "" : tail(result.stderr),
  };
  results.push(row);

  const marker = ok ? "PASS" : "FAIL";
  console.log(`[${String(index + 1).padStart(String(files.length).length, " ")}/${files.length}] ${marker} ${relative} (${durationMs} ms)`);
  if (!ok) {
    if (row.error) console.error(row.error);
    if (row.stdout) console.error(row.stdout);
    if (row.stderr) console.error(row.stderr);
  }
}

const passed = files.length - failed;
const slowest = results
  .filter((row) => row.ok)
  .sort((a, b) => b.durationMs - a.durationMs)
  .slice(0, 10)
  .map(({ file, durationMs }) => ({ file, durationMs }));

const report = {
  generatedAt: new Date().toISOString(),
  total: files.length,
  passed,
  failed,
  slowest,
  failures: results.filter((row) => !row.ok),
};
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");

console.log("\nSAGE FULL REGRESSION SUMMARY");
console.log(`  total:  ${files.length}`);
console.log(`  passed: ${passed}`);
console.log(`  failed: ${failed}`);
console.log(`  report: ${reportPath}`);

if (slowest.length) {
  console.log("  slowest:");
  for (const row of slowest.slice(0, 5)) console.log(`    ${row.durationMs} ms  ${row.file}`);
}

process.exit(failed ? 1 : 0);
