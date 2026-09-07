import assert from "node:assert/strict";
import { prepareImportedFits } from "../../src/fitting-engine.ts";

function fit(id, name, moduleTypeId = 440) {
  return {
    id,
    name,
    hull: { name: "Ishtar", typeId: 12005, quantity: 1 },
    low: [{ name: "Drone Damage Amplifier II", typeId: moduleTypeId, quantity: 1 }],
    mid: [],
    high: [],
    rig: [],
    subsystem: [],
    drones: [],
    fighters: [],
    cargo: [],
    implants: [],
    boosters: [],
    instructions: [],
    source: "duplicate-policy-test",
  };
}

const existing = [fit("existing", "Abyss Ishtar")];
const first = prepareImportedFits(existing, [fit("incoming-1", "Abyss Ishtar")]);
assert.equal(first.imported.length, 1, "duplicate content must still be imported");
assert.equal(first.duplicateCount, 1);
assert.equal(first.renamedCount, 1);
assert.equal(first.imported[0].name, "Abyss Ishtar (Imported 2)");
assert.equal(first.imported[0].id, "incoming-1", "import must retain its own identity");

const second = prepareImportedFits([...existing, first.imported[0]], [fit("incoming-2", "Abyss Ishtar")]);
assert.equal(second.imported[0].name, "Abyss Ishtar (Imported 3)", "rename sequence must avoid existing imported names");

const sameContentDifferentName = prepareImportedFits(existing, [fit("incoming-3", "Alternate Ishtar")]);
assert.equal(sameContentDifferentName.duplicateCount, 1, "same loadout should still be identified for status reporting");
assert.equal(sameContentDifferentName.renamedCount, 0, "a unique incoming name should be preserved");
assert.equal(sameContentDifferentName.imported[0].name, "Alternate Ishtar");

const batch = prepareImportedFits([], [fit("batch-1", "Fresh Fit"), fit("batch-2", "Fresh Fit")]);
assert.equal(batch.imported.length, 2);
assert.equal(batch.duplicateCount, 1, "duplicates inside one import batch must be retained and counted");
assert.equal(batch.imported[0].name, "Fresh Fit");
assert.equal(batch.imported[1].name, "Fresh Fit (Imported 2)");

console.log("duplicate import policy: PASS");
