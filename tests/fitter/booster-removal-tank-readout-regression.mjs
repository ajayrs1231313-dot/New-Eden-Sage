import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const source=fs.readFileSync(path.join(root,"src/Fittings.tsx"),"utf8");

const analysisStart=source.indexOf("setAnalysis(null);");
const analysisCall=source.indexOf(".analyzeFitting({",analysisStart);
assert.ok(analysisStart>=0 && analysisCall>analysisStart,"fit changes must clear stale analysis before starting replacement analysis");
assert.ok(source.includes("removing one must immediately"),"booster-removal stale-state rationale must remain documented");
assert.ok(!source.includes("}, [tab, characterId, fit.id,"),"changing fitter tabs must not trigger a fresh fitting analysis");
assert.ok(source.includes("Tank stable indefinitely"),"stable tank wording must be plain-language");
assert.ok(source.includes("Tank holds while cap lasts -"),"cap-limited tank wording must state the cap limitation");
assert.ok(source.includes("EHP/s effective tank vs"),"tank readout must compare effective tank directly with incoming DPS");
assert.ok(source.includes("includes current reps, passive regen and resists"),"tank readout must explain what effective tank includes");
assert.ok(!source.includes("active reps ${activeScenarioTank.toFixed(1)} + passive"),"old raw component dump must stay removed");
console.log("Booster removal + tank readout regression: PASS");
