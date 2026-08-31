import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../../src/App.tsx", import.meta.url), "utf8");
const isk = readFileSync(new URL("../../src/IskLab.tsx", import.meta.url), "utf8");

const appRootEnd = app.indexOf("function CharacterCommand(");
assert.ok(appRootEnd > 0, "CharacterCommand boundary should exist");
const appRoot = app.slice(0, appRootEnd);

assert.equal(
  /onPreparedDataUpdated[\s\S]{0,300}publicDataUpdated[\s\S]{0,300}setMarketDataRevision/.test(appRoot),
  false,
  "public generation activation must not invalidate top-level App market state",
);

assert.match(app, /active=\{view === "overview"\}/, "Character Command should know whether it is visible");
assert.match(app, /active=\{view === "isk"\}/, "ISK Command should know whether it is visible");
assert.match(app, /const publicDataDirty = useRef\(false\)/, "Character market consumers should retain a dirty flag without rendering");
assert.match(app, /const consumesPublicMarket = active && \(tab === "augments" \|\| tab === "lp-store"\)/, "only active Character market tabs should consume public invalidation immediately");
assert.match(app, /else \{\s*publicDataDirty\.current = true;/, "hidden Character market consumers should only mark public data dirty");
assert.match(app, /marketDataRevision=\{effectiveMarketDataRevision\}/, "active Character market consumers should receive the scoped revision");

assert.match(isk, /const preparedDataDirty = useRef\(false\)/, "ISK Command should retain prepared-data dirtiness without rendering");
assert.match(isk, /if \(active\) setPreparedDataRevision/, "visible ISK Command may consume prepared-data invalidation");
assert.match(isk, /else preparedDataDirty\.current = true;/, "hidden ISK Command must not schedule a React update on prepared-data activation");
assert.match(isk, /if \(!active\) return \(\) => \{ cancelled = true; \};/, "hidden ISK Command must not reload prepared analysis");

console.log("public refresh renderer invalidation regression checks passed");
