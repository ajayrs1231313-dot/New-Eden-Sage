import assert from "node:assert/strict";
import { canonicalizeFittingPlacement } from "../../src/fitting-rack-normalization.ts";

const base = {
  low: [],
  mid: [],
  high: [],
  rig: [],
  subsystem: [],
  drones: [],
  fighters: [],
  cargo: [],
  implants: [],
  boosters: [],
};

const illegal = {
  ...base,
  high: [
    { name: "Drone Damage Amplifier II", typeId: 4405, quantity: 1 },
    { name: "Drone Damage Amplifier II", typeId: 4405, quantity: 1 },
  ],
};
const metadata = [{ id: 4405, name: "Drone Damage Amplifier II", categoryName: "Module", rack: "low" }];
const repaired = canonicalizeFittingPlacement(illegal, metadata);
assert.equal(repaired.fit.high.length, 0, "a low-slot module must never remain in high slots");
assert.equal(repaired.fit.low.length, 2, "both DDAs should be moved to low slots");
assert.equal(repaired.moved, 2);
assert.equal(repaired.unresolvedFitted.length, 0);

const unknown = canonicalizeFittingPlacement({
  ...base,
  high: [{ name: "Unverifiable Imported Module", quantity: 1 }],
}, []);
assert.equal(unknown.fit.high.length, 0, "unverified fitted items must not occupy a ship rack");
assert.equal(unknown.fit.cargo.length, 1, "unverified fitted items are quarantined to cargo");
assert.equal(unknown.unresolvedFitted.length, 1);
assert.equal(unknown.unresolvedFitted[0].sourceRack, "high");

console.log("rack normalization invariant: PASS");
