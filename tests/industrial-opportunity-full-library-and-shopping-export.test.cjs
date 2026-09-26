const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const industrial = fs.readFileSync(path.join(root, "electron", "industrial-preparation.ts"), "utf8");
const featureProcess = fs.readFileSync(path.join(root, "electron", "feature-prep-process.ts"), "utf8");
const main = fs.readFileSync(path.join(root, "electron", "main-task9.ts"), "utf8");
const foundry = fs.readFileSync(path.join(root, "src", "IndustrialProjectFoundry.tsx"), "utf8");

assert.match(industrial, /INDUSTRIAL_PAGE_MODEL_VERSION = 4/);
assert.match(industrial, /schema:\s*4,\s*input: normalized/);

const ownedStart = industrial.indexOf("const ownedBlueprints =");
const ownedEnd = industrial.indexOf("if (!ownedBlueprints.length)", ownedStart);
assert.ok(ownedStart >= 0 && ownedEnd > ownedStart, "owned blueprint scan block should exist");
const ownedBlock = industrial.slice(ownedStart, ownedEnd);
assert.doesNotMatch(ownedBlock, /\.slice\(0,\s*40\)/, "Industrial Opportunities must scan the complete owned blueprint library");

assert.match(featureProcess, /task: "industrial-opportunities"/);
assert.match(featureProcess, /getIndustrialOpportunitiesPrepared\(input\.input/);
assert.match(main, /task: "industrial-opportunities"/);
assert.match(main, /runFeaturePrepProcess\(/);

assert.match(foundry, /appendShoppingList/);
assert.match(foundry, /foundryMaterialShoppingLines/);
assert.match(foundry, /materialPlan\.orePlan/);
assert.match(foundry, /row\?\.oreUnits/);
assert.match(foundry, /\["pi", "reactions"\]/);
assert.match(foundry, /exportMaterialPlanToShoppingList\("ore", "Lowest-resistance ore plan"\)/);
assert.match(foundry, /exportMaterialPlanToShoppingList\(group\.key, group\.label\)/);
assert.match(foundry, /group\.key === "pi" \|\| group\.key === "reactions"/);

console.log("Industrial full-library background scan and Foundry shopping exports verified.");
