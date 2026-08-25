import assert from "node:assert/strict";
import { activityMetaPicks, expandActivityShipPool } from "../../src/activity-ship-rules.ts";

const catalogue = [
  [1, "Rifter", "Frigate"],
  [2, "Daredevil", "Frigate"],
  [3, "Hawk", "Assault Frigate"],
  [4, "Cheetah", "Covert Ops"],
  [5, "Sabre", "Interdictor"],
  [6, "Hecate", "Tactical Destroyer"],
  [7, "Caracal", "Cruiser"],
  [8, "Osprey Navy Issue", "Cruiser"],
  [9, "Vigilant", "Cruiser"],
  [10, "Gila", "Cruiser"],
  [11, "Ishtar", "Heavy Assault Cruiser"],
  [12, "Onyx", "Heavy Interdiction Cruiser"],
  [13, "Lachesis", "Combat Recon Ship"],
  [14, "Rapier", "Force Recon Ship"],
  [15, "Basilisk", "Logistics"],
  [16, "Tengu", "Strategic Cruiser"],
  [17, "Drake", "Combat Battlecruiser"],
  [18, "Naga", "Attack Battlecruiser"],
  [19, "Nighthawk", "Command Ship"],
  [20, "Raven", "Battleship"],
  [21, "Vargur", "Marauder"],
  [22, "Widow", "Black Ops"],
  [23, "Mammoth", "Hauler"],
  [24, "Viator", "Blockade Runner"],
  [25, "Revelation", "Dreadnought"],
  [26, "Bane", "Lancer Dreadnought"],
  [27, "Pacifier", "Covert Ops"],
  [28, "Prospect", "Expedition Frigate"],
  [29, "Endurance", "Expedition Frigate"],
].map(([typeId, name, groupName]) => ({ typeId, name, groupName }));

const l3 = expandActivityShipPool("missions-l3", { shipClass: "Cruiser" }, catalogue, ["Caracal", "Gila"]);
for (const ship of ["Caracal", "Osprey Navy Issue", "Vigilant", "Gila", "Ishtar", "Onyx", "Lachesis", "Rapier", "Tengu"])
  assert.ok(l3.includes(ship), `L3 Cruiser should include ${ship}`);
assert.ok(!l3.includes("Basilisk"), "L3 Cruiser should not promote logistics hulls as solo mission recommendations");

const abyss = expandActivityShipPool("abyss-cruiser", { tier: "T6 Chaotic", weather: "Electrical" }, catalogue, ["Gila"]);
for (const ship of ["Gila", "Ishtar", "Onyx", "Lachesis", "Rapier", "Basilisk"])
  assert.ok(abyss.includes(ship), `Abyss cruiser pool should include legal cruiser-family hull ${ship}`);
assert.ok(!abyss.includes("Tengu"), "Strategic Cruisers must not enter Abyssal Deadspace");

const battleships = expandActivityShipPool("missions-l4", { shipClass: "Battleship" }, catalogue, ["Raven"]);
for (const ship of ["Raven", "Vargur", "Widow"])
  assert.ok(battleships.includes(ship), `Generic Battleship should include ${ship}`);

const exactHac = expandActivityShipPool("combat-exploration", { shipClass: "Heavy Assault Cruiser (HAC)" }, catalogue, []);
assert.deepEqual(exactHac, ["Ishtar"]);

const hauling = expandActivityShipPool("basic-hauling", {}, catalogue, []);
assert.deepEqual(hauling, ["Mammoth"]);

const covert = expandActivityShipPool("relic-data", { shipClass: "Covert Ops" }, catalogue, ["Cheetah"]);
assert.ok(covert.includes("Pacifier"), "Covert Ops selector should expand to every published Covert Ops hull");

const oreFrigates = expandActivityShipPool("ore-mining", { shipClass: "Mining frigate" }, catalogue, ["Venture"]);
assert.ok(oreFrigates.includes("Prospect") && oreFrigates.includes("Endurance"), "Ore mining frigate route should include T2 expedition mining hulls");

const wormholeCapitals = expandActivityShipPool("wh-c5-c6", { shipClass: "Capital" }, catalogue, ["Revelation"]);
assert.ok(wormholeCapitals.includes("Bane"), "C5/C6 Capital route should include Lancer Dreadnoughts");

const dreadnoughts = expandActivityShipPool("dreadnought", {}, catalogue, ["Revelation"]);
assert.ok(dreadnoughts.includes("Bane"), "Dreadnought progression should include Lancer Dreadnoughts");

const burnerAgent = expandActivityShipPool("missions-burner", { family: "Anomic Agent" }, catalogue, ["Daredevil"]);
assert.ok(burnerAgent.includes("Rifter") && burnerAgent.includes("Hawk") && burnerAgent.includes("Cheetah"));
assert.ok(!burnerAgent.includes("Caracal"));

assert.deepEqual(activityMetaPicks("abyss-cruiser", { tier: "T5 Chaotic" }), []);
assert.ok(activityMetaPicks("abyss-cruiser", { tier: "T6 Chaotic" }).some((pick) => pick.name === "Gila"));
assert.ok(activityMetaPicks("nullsec-ratting", {}).some((pick) => pick.name === "Ishtar"));
assert.ok(activityMetaPicks("missions-l4", { shipClass: "Battleship" }).some((pick) => pick.name === "Vargur"));
assert.ok(activityMetaPicks("ore-mining", { shipClass: "Exhumer", priority: "Yield" }).some((pick) => pick.name === "Hulk"));

const l3Meta = activityMetaPicks("missions-l3", { shipClass: "Cruiser" }).map((pick) => pick.name);
for (const name of ["Gila", "Vexor Navy Issue", "Caracal Navy Issue"]) assert(l3Meta.includes(name), `missing L3 meta pick ${name}`);


const fwCatalogue = [
  [101, "Rifter", "Frigate", "Tech I", "Minmatar Republic"],
  [102, "Venture", "Frigate", "Tech I", "ORE"],
  [103, "Caldari Navy Hookbill", "Frigate", "Faction", "Caldari State"],
  [104, "Federation Navy Comet", "Frigate", "Faction", "Gallente Federation"],
  [105, "Daredevil", "Frigate", "Faction", "Serpentis"],
  [106, "Hawk", "Assault Frigate", "Tech II", "Caldari State"],
  [107, "Thrasher", "Destroyer", "Tech I", "Minmatar Republic"],
  [108, "Catalyst", "Destroyer", "Tech I", "Gallente Federation"],
  [109, "Thrasher Fleet Issue", "Destroyer", "Faction", "Minmatar Republic"],
  [110, "Catalyst Navy Issue", "Destroyer", "Faction", "Gallente Federation"],
  [111, "Confessor", "Tactical Destroyer", "Tech III", "Amarr Empire"],
  [112, "Jackdaw", "Tactical Destroyer", "Tech III", "Caldari State"],
  [113, "Caracal", "Cruiser", "Tech I", "Caldari State"],
  [114, "Omen Navy Issue", "Cruiser", "Faction", "Amarr Empire"],
  [115, "Stabber Fleet Issue", "Cruiser", "Faction", "Minmatar Republic"],
  [116, "Gila", "Cruiser", "Faction", "Guristas Pirates"],
  [117, "Cynabal", "Cruiser", "Faction", "Angel Cartel"],
  [118, "Ishtar", "Heavy Assault Cruiser", "Tech II", "Gallente Federation"],
  [119, "Guardian", "Logistics", "Tech II", "Amarr Empire"],
  [120, "Osprey", "Cruiser", "Tech I", "Caldari State"],
  [121, "Augoror", "Cruiser", "Tech I", "Amarr Empire"],
  [122, "Exequror", "Cruiser", "Tech I", "Gallente Federation"],
  [123, "Scythe", "Cruiser", "Tech I", "Minmatar Republic"],
  [124, "Ferox Navy Issue", "Combat Battlecruiser", "Faction", "Caldari State"],
  [125, "Prophecy Navy Issue", "Combat Battlecruiser", "Faction", "Amarr Empire"],
  [126, "Vargur", "Marauder", "Tech II", "Minmatar Republic"],
  [127, "Paladin", "Marauder", "Tech II", "Amarr Empire"],
  [128, "Tempest", "Battleship", "Tech I", "Minmatar Republic"],
  [129, "Damavik", "Frigate", "Tech I", "Triglavian Collective"],
  [130, "Skybreaker", "Frigate", "Tech I", "EDENCOM"],
  [131, "Cambion", "Assault Frigate", "Faction", "Caldari State"],
  [132, "Tengu", "Strategic Cruiser", "Tech III", "Caldari State"],
].map(([typeId, name, groupName, metaGroupName, factionName]) => ({ typeId, name, groupName, metaGroupName, factionName }));

const fwNvyFrigates = expandActivityShipPool(
  "fw-scout-small",
  { shipClass: "Frigate", role: "Damage / combat", accessRule: "NVY - T1 / Navy" },
  fwCatalogue,
  ["Rifter", "Venture", "Caldari Navy Hookbill", "Federation Navy Comet", "Daredevil", "Hawk", "Damavik", "Skybreaker", "Cambion"],
);
for (const ship of ["Rifter", "Caldari Navy Hookbill", "Federation Navy Comet"])
  assert.ok(fwNvyFrigates.includes(ship), `FW NVY frigates should include ${ship}`);
for (const ship of ["Venture", "Daredevil", "Hawk", "Damavik", "Skybreaker", "Cambion"])
  assert.ok(!fwNvyFrigates.includes(ship), `FW NVY frigates must exclude ${ship}`);

const fwSmallAdv = expandActivityShipPool(
  "fw-scout-small",
  { shipClass: "Destroyer", role: "Damage / combat", accessRule: "ADV - Advanced / Pirate" },
  fwCatalogue,
  ["Rifter", "Venture", "Caldari Navy Hookbill", "Daredevil", "Hawk", "Damavik", "Skybreaker", "Cambion", "Confessor", "Jackdaw"],
);
for (const ship of ["Daredevil", "Hawk", "Damavik", "Skybreaker", "Cambion"])
  assert.ok(fwSmallAdv.includes(ship), `FW Small ADV should admit combat advanced hull ${ship}`);
for (const ship of ["Venture", "Confessor", "Jackdaw"])
  assert.ok(!fwSmallAdv.includes(ship), `FW Small ADV must exclude ${ship}`);

const fwNvyCruisers = expandActivityShipPool(
  "fw-medium-large",
  { shipClass: "Cruiser", role: "Damage / combat", accessRule: "NVY - T1 / Navy" },
  fwCatalogue,
  ["Caracal", "Omen Navy Issue", "Stabber Fleet Issue", "Gila", "Cynabal", "Ishtar"],
);
for (const ship of ["Caracal", "Omen Navy Issue", "Stabber Fleet Issue"])
  assert.ok(fwNvyCruisers.includes(ship), `FW NVY medium should include ${ship}`);
for (const ship of ["Gila", "Cynabal", "Ishtar"])
  assert.ok(!fwNvyCruisers.includes(ship), `FW NVY medium must exclude advanced/pirate hull ${ship}`);

const fwAdvCruisers = expandActivityShipPool(
  "fw-medium-large",
  { shipClass: "Cruiser", role: "Damage / combat", accessRule: "ADV - Advanced / Pirate" },
  fwCatalogue,
  ["Caracal", "Omen Navy Issue", "Stabber Fleet Issue", "Gila", "Cynabal", "Ishtar"],
);
for (const ship of ["Gila", "Cynabal", "Ishtar"])
  assert.ok(fwAdvCruisers.includes(ship), `FW ADV medium should include ${ship}`);
for (const ship of ["Confessor", "Jackdaw"])
  assert.ok(fwAdvCruisers.includes(ship), `FW Medium ADV should include tactical destroyer ${ship}`);
assert.ok(!fwAdvCruisers.includes("Tengu"), "Strategic Cruisers must not enter Medium ADV complexes");

const fwLargeAdv = expandActivityShipPool(
  "fw-medium-large",
  { shipClass: "Battleship", role: "Damage / combat", accessRule: "ADV - Advanced / Pirate" },
  fwCatalogue,
  ["Tempest", "Vargur", "Tengu"],
);
assert.ok(fwLargeAdv.includes("Tengu"), "Strategic Cruisers should be legal in Large ADV complexes");
assert.ok(fwLargeAdv.includes("Vargur"), "Marauders should be legal in Large ADV complexes");

const battlefieldCruisers = expandActivityShipPool(
  "fw-battlefields",
  { shipClass: "Cruiser", role: "Logistics" },
  fwCatalogue,
  ["Osprey", "Augoror", "Exequror", "Scythe", "Guardian", "Gila"],
);
for (const ship of ["Osprey", "Augoror", "Exequror", "Scythe"])
  assert.ok(battlefieldCruisers.includes(ship), `Battlefields should include T1 logistics hull ${ship}`);
for (const ship of ["Guardian", "Gila"])
  assert.ok(!battlefieldCruisers.includes(ship), `Current Battlefield gate must exclude ${ship}`);

const fwFrigateMeta = activityMetaPicks("fw-scout-small", { shipClass: "Frigate", accessRule: "NVY - T1 / Navy" }).map((pick) => pick.name);
for (const ship of ["Caldari Navy Hookbill", "Federation Navy Comet"])
  assert.ok(fwFrigateMeta.includes(ship), `missing FW frigate meta pick ${ship}`);
const fwDestroyerMeta = activityMetaPicks("fw-scout-small", { shipClass: "Destroyer", accessRule: "NVY - T1 / Navy" }).map((pick) => pick.name);
for (const ship of ["Thrasher", "Catalyst", "Thrasher Fleet Issue", "Catalyst Navy Issue"])
  assert.ok(fwDestroyerMeta.includes(ship), `missing FW destroyer meta pick ${ship}`);
const fwMediumAdvMeta = activityMetaPicks("fw-medium-large", { shipClass: "Cruiser", accessRule: "ADV - Advanced / Pirate" }).map((pick) => pick.name);
for (const ship of ["Omen Navy Issue", "Stabber Fleet Issue", "Cynabal", "Gila"])
  assert.ok(fwMediumAdvMeta.includes(ship), `missing FW medium ADV meta pick ${ship}`);
for (const ship of ["Confessor", "Jackdaw"])
  assert.ok(fwMediumAdvMeta.includes(ship), `missing FW medium ADV tactical destroyer meta pick ${ship}`);
const fwSmallAdvMeta = activityMetaPicks("fw-scout-small", { shipClass: "Destroyer", accessRule: "ADV - Advanced / Pirate" }).map((pick) => pick.name);
for (const ship of ["Confessor", "Jackdaw"]) assert.ok(!fwSmallAdvMeta.includes(ship), `Small ADV must not advertise illegal T3D meta pick ${ship}`);
const fwBattlecruiserMeta = activityMetaPicks("fw-medium-large", { shipClass: "Battlecruiser", accessRule: "NVY - T1 / Navy" }).map((pick) => pick.name);
for (const ship of ["Ferox Navy Issue", "Prophecy Navy Issue"])
  assert.ok(fwBattlecruiserMeta.includes(ship), `missing FW moderate meta pick ${ship}`);
assert.deepEqual(
  activityMetaPicks("fw-battlefields", { shipClass: "Cruiser", role: "Logistics" }),
  [],
  "Battlefields must not expose logistics meta picks",
);
assert.deepEqual(
  activityMetaPicks("fw-battlefields", { shipClass: "Battlecruiser", role: "DPS" }),
  [],
  "Battlefields must not expose DPS meta picks",
);

console.log("PASS progression activity ship pool + meta-pick rules");
