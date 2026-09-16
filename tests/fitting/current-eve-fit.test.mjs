import assert from "node:assert/strict";
import { currentEveFitFromSnapshot } from "../../src/current-eve-fit.ts";

const snapshot = {
  characterId: "42",
  character: { name: "Fit Pilot", corporation_id: 1, corporation_name: "Corp" },
  wallet: 0, skills: { total_sp: 0, skills: [] }, queue: [],
  location: { solar_system_id: 30000142, solar_system_name: "Jita", place_name: "Jita 4-4" },
  ship: { ship_item_id: 999, ship_name: "Abyss Ishtar", ship_type_id: 12005, ship_type_name: "Ishtar" },
  updatedAt: new Date(0).toISOString(),
  extended: { currentShipFit: [
    { item_id: 999, type_id: 12005, location_id: 60003760, location_flag: "Hangar", quantity: 1 },
    { item_id: 1, type_id: 111, location_id: 999, location_flag: "HiSlot0", quantity: 1, item: "High Module" },
    { item_id: 2, type_id: 222, location_id: 999, location_flag: "MedSlot1", quantity: 1, item: "Mid Module" },
    { item_id: 3, type_id: 333, location_id: 999, location_flag: "LoSlot2", quantity: 1, item: "Low Module" },
    { item_id: 4, type_id: 444, location_id: 999, location_flag: "RigSlot0", quantity: 1, item: "Rig" },
    { item_id: 5, type_id: 555, location_id: 999, location_flag: "DroneBay", quantity: 5, item: "Drone" },
    { item_id: 6, type_id: 666, location_id: 999, location_flag: "FighterTube0", quantity: 3, item: "Fighter" },
    { item_id: 7, type_id: 777, location_id: 999, location_flag: "Cargo", quantity: 500, item: "Ammo" },
    { item_id: 8, type_id: 888, location_id: 999, location_flag: "ShipHangar", quantity: 1, item: "Ignore me" },
    { item_id: 9, type_id: 9999, location_id: 999, location_flag: "HiSlot0", quantity: 40, item: "Loaded charge", categoryName: "Charge" },
  ] },
};

const fit = currentEveFitFromSnapshot(snapshot, "test-fit");
assert.equal(fit.id, "test-fit");
assert.equal(fit.hull.typeId, 12005);
assert.equal(fit.high[0].typeId, 111);
assert.equal(fit.mid[0].typeId, 222);
assert.equal(fit.low[0].typeId, 333);
assert.equal(fit.rig[0].typeId, 444);
assert.equal(fit.drones[0].quantity, 5);
assert.equal(fit.fighters[0].activeQuantity, 3);
assert.equal(fit.cargo.find(item => item.typeId === 777)?.quantity, 500);
assert.equal(fit.cargo.find(item => item.typeId === 9999)?.quantity, 40, "loaded charge metadata must route to cargo rather than block rack validation");
assert.equal(fit.high.length + fit.mid.length + fit.low.length + fit.rig.length, 4);
assert.equal(fit.source, "esi-current-ship");
assert.match(fit.instructions[0], /Loaded charges.*activation/i);
console.log("current-eve-fit: ok");
