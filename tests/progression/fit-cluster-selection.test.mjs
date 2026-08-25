import assert from "node:assert/strict";
import { fitTankFamilyFromNames, selectDiverseFitClusters } from "../../electron/fit-cluster-selection.ts";

assert.equal(fitTankFamilyFromNames(["Medium Armor Repairer II", "Multispectrum Energized Membrane II"]), "armor");
assert.equal(fitTankFamilyFromNames(["Large Shield Extender II", "Multispectrum Shield Hardener II"]), "shield");

const clusters = [
  Array.from({ length: 10 }, (_, i) => ({ id: `shield-a-${i}`, tank: "shield" })),
  Array.from({ length: 7 }, (_, i) => ({ id: `shield-b-${i}`, tank: "shield" })),
  Array.from({ length: 5 }, (_, i) => ({ id: `shield-c-${i}`, tank: "shield" })),
  Array.from({ length: 3 }, (_, i) => ({ id: `armor-a-${i}`, tank: "armor" })),
];
const selected = selectDiverseFitClusters(clusters, (cluster) => cluster[0].tank, 3);
assert.equal(selected.length, 3);
assert(selected.some((cluster) => cluster[0].tank === "shield"), "shield family should survive");
assert(selected.some((cluster) => cluster[0].tank === "armor"), "armor family should survive despite smaller population");
console.log("PASS fit cluster tank diversity");
