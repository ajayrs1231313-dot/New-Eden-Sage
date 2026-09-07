import assert from "node:assert/strict";
import fs from "node:fs";

const explorer = fs.readFileSync(new URL("../../src/OpportunityExplorer.tsx", import.meta.url), "utf8");
const iskLab = fs.readFileSync(new URL("../../src/IskLab.tsx", import.meta.url), "utf8");

assert.doesNotMatch(explorer, /PvE\s*&\s*locations|PvE\s*\/\s*location/, "All Opportunities must not expose a PvE category or copy");
assert.doesNotMatch(explorer, /extraRows/, "All Opportunities must not accept appended PvE rows");
assert.match(explorer, /item\.kind !== "pve"/, "All Opportunities should defensively exclude PvE rows");
assert.match(explorer, /Market trades, regional shortages and owned assets/, "All Opportunities description should name only the three retained categories");
assert.match(explorer, /Want quick ISK\?/, "quick-ISK guidance should be prominent");
assert.match(explorer, /cargo capacity in m³ of the ship you want to use, click Apply, pick a ranked opportunity and go\./, "quick-ISK guidance should explain the cargo/apply/pick flow directly");
assert.match(explorer, /HIGH SEC|securityLabel/, "All Opportunities rows should render explicit route-security tags");
assert.match(explorer, /opportunity-security-tag/, "route-security badge should be rendered on each row");
assert.doesNotMatch(iskLab, /extraRows=\{pveAnalysis\?\.ranked/, "ISK Command must not append PvE analysis into All Opportunities");
assert.match(iskLab, /tab === "pve"/, "the separate PvE & Locations tab must remain wired");
assert.match(iskLab, />PvE & Locations<\/button>/, "the separate PvE & Locations tab must retain its visible navigation control");

console.log("All Opportunities PvE cleanup, guidance and route-tag regression checks passed.");
