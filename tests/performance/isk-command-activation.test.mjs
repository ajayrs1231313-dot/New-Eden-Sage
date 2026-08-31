import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { iskModuleBuildKey, shouldWakeIskModule } from "../../src/isk-command-activation.ts";

const app = readFileSync(new URL("../../src/App.tsx", import.meta.url), "utf8");
const isk = readFileSync(new URL("../../src/IskLab.tsx", import.meta.url), "utf8");
const main = readFileSync(new URL("../../electron/main-task9.ts", import.meta.url), "utf8");

assert.match(app, /const RetainedIskLab = memo\(IskLab\);/, "RetainedIskLab must use normal prop comparison so active changes are observable");
assert.match(app, /active=\{view === "isk"\}/, "App must pass the live ISK visibility state");
assert.match(isk, /\[active, tab, snapshot\?\.characterId, snapshot\?\.updatedAt, marketDataRevision, cloneState, preparedDataRevision\]/, "activation and visible-tab changes must rerun the prepared loader");
assert.match(isk, /modules: \[preparedModule\]/, "renderer must request only the visible ISK prepared module");
assert.match(isk, /if \(!preparedModule\) return/, "non-analysis ISK tabs must not trigger prepared intelligence probes");
assert.match(main, /requested\.has\("market"\)/, "main prepared handler must scope market work");
assert.match(main, /requested\.has\("pve"\)/, "main prepared handler must scope PvE work");
assert.match(main, /requested\.has\("invention"\)/, "main prepared handler must scope invention work");
assert.match(isk, /analysis && marketAutoBuildKey\.current === marketBuildKey/, "returning to unchanged Market data must reuse renderer state");
assert.match(isk, /pveAnalysis && pveAutoBuildKey\.current === pveBuildKey/, "returning to unchanged PvE data must reuse renderer state");
assert.match(isk, /inventionAnalysis && inventionAutoBuildKey\.current === inventionBuildKey/, "returning to unchanged Invention data must reuse renderer state");

assert.equal(
  shouldWakeIskModule({ active: false, visible: true, prepared: null, busy: false, buildKey: "market|1|r1", lastBuildKey: null }),
  false,
  "inactive initial render must not start expensive work",
);
assert.equal(
  shouldWakeIskModule({ active: true, visible: true, prepared: null, busy: false, buildKey: "market|1|r1", lastBuildKey: null }),
  true,
  "false-to-true activation with a real cache miss must wake the visible module",
);
assert.equal(
  shouldWakeIskModule({ active: true, visible: false, prepared: null, busy: false, buildKey: "pve|1|r1", lastBuildKey: null }),
  false,
  "hidden ISK modules must not start their worker",
);
assert.equal(
  shouldWakeIskModule({ active: true, visible: true, prepared: { real: true }, busy: false, buildKey: "market|1|r1", lastBuildKey: null }),
  false,
  "an existing prepared result must be reused",
);
assert.equal(
  shouldWakeIskModule({ active: true, visible: true, prepared: null, busy: false, buildKey: "market|1|r1", lastBuildKey: "market|1|r1" }),
  false,
  "navigating away and back without a revision change must not rebuild",
);
assert.equal(
  shouldWakeIskModule({ active: true, visible: true, prepared: null, busy: false, buildKey: "market|1|r2", lastBuildKey: "market|1|r1" }),
  true,
  "a hidden update consumed after reactivation must allow exactly one new build key",
);

const first = iskModuleBuildKey("market", "123", "snapshot-a", 4, 8);
const same = iskModuleBuildKey("market", "123", "snapshot-a", 4, 8);
const changed = iskModuleBuildKey("market", "123", "snapshot-b", 4, 8);
assert.equal(first, same, "unchanged data revisions must produce a stable build key");
assert.notEqual(first, changed, "private snapshot changes must invalidate the build key");

assert.match(isk, /else preparedDataDirty\.current = true;/, "inactive prepared updates must only mark ISK data dirty");
assert.match(isk, /marketAutoBuildKey\.current = null;\r?\n\s*setMarketStatus/, "failed Market auto-builds must be retryable");
assert.match(isk, /pveAutoBuildKey\.current = null;\r?\n\s*const message/, "failed PvE auto-builds must be retryable");
assert.match(isk, /inventionAutoBuildKey\.current = null;\r?\n\s*setInventionStatus/, "failed Invention auto-builds must be retryable");

console.log("ISK Command activation regression checks passed");
