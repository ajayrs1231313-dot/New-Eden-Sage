import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mergeShoppingList, serializeShoppingListForEveMultiBuy } from "../../src/shopping-list.ts";

const now = "2026-09-04T00:00:00.000Z";
const current = [
  { id:"beam", typeId:101, name:"Heavy Beam Laser II", quantity:2, done:false, addedAt:now },
];
const merged = mergeShoppingList(current, [
  { typeId:101, name:"Heavy Beam Laser II", quantity:3 },
  { typeId:202, name:"Valkyrie II", quantity:5 },
  { typeId:202, name:"Valkyrie II", quantity:2 },
]);
assert.equal(merged.find((item) => item.typeId === 101)?.quantity, 5, "existing unfinished quantities should aggregate");
assert.equal(merged.find((item) => item.typeId === 202)?.quantity, 7, "same-source duplicate additions should aggregate");

const text = serializeShoppingListForEveMultiBuy([
  { id:"beam-a", typeId:101, name:" Heavy Beam Laser II ", quantity:2, done:false, addedAt:now },
  { id:"beam-b", typeId:101, name:"Heavy Beam Laser II", quantity:3, done:false, addedAt:now },
  { id:"valkyrie", typeId:202, name:"Valkyrie II", quantity:5, done:true, addedAt:now },
  { id:"warrior", typeId:303, name:"Warrior II", quantity:10, done:false, addedAt:now },
  { id:"zero", typeId:404, name:"Nanite Repair Paste", quantity:0, done:false, addedAt:now },
  { id:"negative", typeId:405, name:"Tritanium", quantity:-5, done:false, addedAt:now },
  { id:"blank", typeId:406, name:"   ", quantity:4, done:false, addedAt:now },
  { id:"placeholder", typeId:407, name:"Type 407", quantity:4, done:false, addedAt:now },
  { id:"bad-type", typeId:0, name:"Invalid", quantity:4, done:false, addedAt:now },
]);
assert.equal(text, "Heavy Beam Laser II 5\nWarrior II 10");
assert.ok(!text.includes("Valkyrie II"), "completed rows should not be re-purchased");
assert.ok(!text.includes("Nanite Repair Paste"), "zero quantities should not export");
assert.ok(!text.includes("Tritanium"), "negative quantities should not export");
assert.ok(!text.includes("Type 407"), "placeholder names should not export");

const here = dirname(fileURLToPath(import.meta.url));
const workspace = readFileSync(resolve(here, "../../src/MarketWorkspaceV2.tsx"), "utf8");
assert.match(workspace, /Copy for EVE MultiBuy/, "Shopping List must expose a clear MultiBuy copy action");
assert.match(workspace, /Market > MultiBuy window, choose Import Shopping List, paste the list, review the prices and quantities, then buy the items\./, "MultiBuy action must explain the in-game import workflow in its tooltip");
assert.match(workspace, /title=\{MULTIBUY_HELP\}/, "MultiBuy instructions must be attached as mouse-over help");
assert.match(workspace, /window\.sage\.copyText\(multiBuyText\)/, "MultiBuy action must use Sage's existing clipboard bridge");
assert.match(workspace, /Copied for EVE MultiBuy/, "successful copy must provide lightweight confirmation");
assert.match(workspace, /clipboard verification failed/, "clipboard failures must not be silent");
console.log("shopping-list MultiBuy export: PASS");
