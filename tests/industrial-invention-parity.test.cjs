const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const industrial = read("src/IndustrialCommand.tsx");
const invention = read("src/InventionIntelligence.tsx");
const isk = read("src/IskLab.tsx");
const app = read("src/App.tsx");
const css = read("src/industrial-command.css");

test("Industrial Research & Invention reuses the shared ISK invention engine", () => {
  assert.match(industrial, /import \{ InventionIntelligence \} from "\.\/InventionIntelligence"/);
  assert.match(industrial, /getInventionOpportunities\(\{/);
  assert.match(industrial, /characterId: active\.characterId,[\s\S]*marketDataRevision,[\s\S]*decryptorTypeId:/);
  assert.match(industrial, /<InventionIntelligence[\s\S]*variant="industrial"/);
  assert.match(isk, /<InventionIntelligence/);
});

test("Industrial keeps the existing blueprint activity inspector beside catalogue invention intelligence", () => {
  assert.match(industrial, /getBlueprintActivities\(/);
  assert.match(industrial, /<BlueprintActivityView data=\{blueprintActivities\}/);
  assert.match(industrial, /Catalogue-wide invention opportunities/);
  assert.match(industrial, /Refresh invention intelligence/);
});

test("Industrial invention refreshes on character, market revision and decryptor changes", () => {
  assert.ok(industrial.includes("active.characterId") && industrial.includes("marketDataRevision") && industrial.includes('inventionDecryptor || "none"'), "invention build identity must include character, market revision and decryptor");
  assert.match(industrial, /inventionRequestSequence\.current \+= 1/);
  assert.match(industrial, /requestId !== inventionRequestSequence\.current/);
  assert.match(app, /<RetainedIndustrialCommand[\s\S]*marketDataRevision=\{marketDataRevision\}/);
  assert.match(app, /a\.marketDataRevision === b\.marketDataRevision/);
});

test("Shared renderer defaults to ISK styling and exposes an Industrial-only visual variant", () => {
  assert.match(invention, /variant\?: "isk" \| "industrial"/);
  assert.match(invention, /variant = "isk"/);
  assert.match(invention, /invention-intelligence-industrial/);
  assert.match(invention, /TOP INVENTION SIGNAL/);
  assert.match(css, /\/\* Industrial Invention Intelligence parity \*\//);
  assert.match(css, /\.industrial-command \.invention-intelligence-industrial/);
  assert.doesNotMatch(css, /^\.invention-intelligence-industrial/m);
});
