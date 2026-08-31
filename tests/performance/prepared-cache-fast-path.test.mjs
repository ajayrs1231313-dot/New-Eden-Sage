import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manager = readFileSync(new URL("../../electron/analysis-job-manager.ts", import.meta.url), "utf8");
const worker = readFileSync(new URL("../../electron/analysis-worker.ts", import.meta.url), "utf8");

assert.match(
  manager,
  /if \(options\.skipWhenBusy\) return null;/,
  "prepared cache probes must return immediately instead of waiting behind active analysis",
);
assert.doesNotMatch(
  manager,
  /waitForLaneIdle/,
  "prepared probes must not contain an analysis-lane wait loop",
);

const freshnessFilter = worker.indexOf("freshnessFloor <= 0 || candidate.mtimeMs >= freshnessFloor");
const compressedRead = worker.indexOf("gunzipAsync(await fs.readFile(candidate.file))");
assert.ok(freshnessFilter >= 0, "opportunity compatibility lookup must reject stale files by mtime");
assert.ok(compressedRead >= 0, "opportunity compatibility lookup must still validate plausible cached payloads");
assert.ok(
  freshnessFilter < compressedRead,
  "stale opportunity caches must be filtered before expensive read/gunzip work",
);
assert.match(worker, /const marketCreatedAt = Date\.parse\(String\(manifest\.createdAt \?\? ""\)\);/);
assert.match(worker, /Number\.isFinite\(selectedUpdatedAt\) \? selectedUpdatedAt : 0/);

console.log("Prepared-cache fast-path regression checks passed");
