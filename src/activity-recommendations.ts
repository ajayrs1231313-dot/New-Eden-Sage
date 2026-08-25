import type { ActivityContent, ActivitySelector } from "./activity-planner-data";
import { activityMetaPicks, expandActivityShipPool } from "./activity-ship-rules";

export type RecommendationShip = { typeId: number; name: string; groupId?: number; groupName?: string; metaGroupId?: number; metaGroupName?: string; factionId?: number; factionName?: string };

export type RecommendationRoute = {
  match?: Record<string, string[]>;
  ships: string[];
  groups?: string[];
};

export type ActivityRecommendationProfile = {
  selectors?: ActivitySelector[];
  routes: RecommendationRoute[];
};

const route = (ships: string[], match?: Record<string, string[]>, groups?: string[]): RecommendationRoute => ({ ships, match, groups });

const profiles: Record<string, ActivityRecommendationProfile> = {
  "pvp-roaming": {
    selectors: [
      { id: "engagement", label: "Engagement", options: ["Solo", "Small gang"] },
      { id: "role", label: "PvP role", options: ["Damage / combat", "Tackle", "EWAR / control", "Support / logistics", "Command / links"] },
      { id: "shipClass", label: "Ship class", options: ["Frigate", "Assault Frigate", "Interceptor", "Electronic Attack Frigate", "Logistics Frigate", "Destroyer", "Interdictor", "Command Destroyer", "Tactical Destroyer", "Cruiser", "Heavy Assault Cruiser (HAC)", "Heavy Interdiction Cruiser (HIC)", "Force Recon Ship", "Combat Recon Ship", "Logistics Cruiser", "T3 Cruiser", "Battlecruiser", "Attack Battlecruiser", "Command Ship", "Battleship", "Marauder", "Black Ops"] },
      { id: "style", label: "Fighting style", options: ["Brawl", "Scram-kite", "Kite", "Projection"] },
    ],
    routes: [
      route(["Rifter", "Tristan", "Kestrel", "Punisher", "Merlin", "Incursus", "Breacher", "Tormentor", "Caldari Navy Hookbill", "Federation Navy Comet", "Republic Fleet Firetail", "Imperial Navy Slicer", "Dramiel", "Worm"], { shipClass: ["Frigate"], role: ["Damage / combat"] }),
      route(["Hawk", "Harpy", "Enyo", "Ishkur", "Jaguar", "Wolf", "Retribution", "Vengeance"], { shipClass: ["Assault Frigate"], role: ["Damage / combat"] }),
      route(["Ares", "Taranis", "Crow", "Raptor", "Malediction", "Crusader", "Stiletto", "Claw"], { shipClass: ["Interceptor"], role: ["Tackle", "Damage / combat"] }),
      route(["Keres", "Kitsune", "Sentinel", "Hyena"], { shipClass: ["Electronic Attack Frigate"], role: ["EWAR / control", "Tackle"] }),
      route(["Deacon", "Kirin", "Thalia", "Scalpel"], { shipClass: ["Logistics Frigate"], role: ["Support / logistics"] }),
      route(["Thrasher", "Catalyst", "Coercer", "Cormorant", "Algos", "Dragoon", "Corax", "Talwar", "Kikimora"], { shipClass: ["Destroyer"], role: ["Damage / combat"] }),
      route(["Sabre", "Flycatcher", "Heretic", "Eris"], { shipClass: ["Interdictor"], role: ["Tackle", "EWAR / control"] }),
      route(["Stork", "Bifrost", "Pontifex", "Magus"], { shipClass: ["Command Destroyer"], role: ["Command / links", "Support / logistics", "EWAR / control"] }),
      route(["Jackdaw", "Hecate", "Confessor", "Svipul"], { shipClass: ["Tactical Destroyer"], role: ["Damage / combat", "Tackle"] }),
      route(["Caracal", "Vexor", "Omen", "Stabber", "Thorax", "Moa", "Rupture", "Orthrus", "Cynabal", "Osprey Navy Issue", "Exequror Navy Issue", "Omen Navy Issue", "Stabber Fleet Issue"], { shipClass: ["Cruiser"], role: ["Damage / combat", "Tackle"] }),
      route(["Deimos", "Ishtar", "Cerberus", "Eagle", "Muninn", "Vagabond", "Zealot", "Sacrilege"], { shipClass: ["Heavy Assault Cruiser (HAC)"], role: ["Damage / combat"] }),
      route(["Broadsword", "Onyx", "Devoter", "Phobos"], { shipClass: ["Heavy Interdiction Cruiser (HIC)"], role: ["Tackle", "EWAR / control"] }),
      route(["Arazu", "Rapier", "Pilgrim", "Falcon"], { shipClass: ["Force Recon Ship"], role: ["Tackle", "EWAR / control", "Support / logistics"] }),
      route(["Lachesis", "Huginn", "Curse", "Rook"], { shipClass: ["Combat Recon Ship"], role: ["Tackle", "EWAR / control", "Damage / combat"] }),
      route(["Scimitar", "Basilisk", "Guardian", "Oneiros"], { shipClass: ["Logistics Cruiser"], role: ["Support / logistics"] }),
      route(["Tengu", "Loki", "Proteus", "Legion"], { shipClass: ["T3 Cruiser"], role: ["Damage / combat", "Tackle", "EWAR / control", "Support / logistics", "Command / links"] }),
      route(["Drake", "Hurricane", "Harbinger", "Brutix", "Ferox", "Cyclone", "Prophecy", "Myrmidon"], { shipClass: ["Battlecruiser"], role: ["Damage / combat", "Tackle"] }),
      route(["Naga", "Tornado", "Oracle", "Talos"], { shipClass: ["Attack Battlecruiser"], role: ["Damage / combat"] }),
      route(["Claymore", "Damnation", "Eos", "Vulture", "Sleipnir", "Absolution", "Astarte", "Nighthawk"], { shipClass: ["Command Ship"], role: ["Damage / combat", "Command / links", "Support / logistics"] }),
      route(["Megathron", "Tempest", "Raven", "Apocalypse", "Typhoon", "Dominix", "Hyperion", "Rokh", "Maelstrom", "Leshak", "Barghest", "Machariel", "Nightmare", "Bhaalgorn", "Armageddon", "Scorpion", "Nestor"], { shipClass: ["Battleship"], role: ["Damage / combat", "Tackle", "EWAR / control", "Support / logistics"] }),
      route(["Paladin", "Vargur", "Kronos", "Golem"], { shipClass: ["Marauder"], role: ["Damage / combat"] }),
      route(["Panther", "Redeemer", "Sin", "Widow"], { shipClass: ["Black Ops"], role: ["Damage / combat", "Support / logistics", "EWAR / control"] }),
    ],
  },
  "fleet-roles": {
    selectors: [
      { id: "role", label: "Fleet role", options: ["Line DPS", "Tackle", "EWAR / control", "Logistics", "Command / links"] },
      { id: "shipClass", label: "Ship class", options: ["Frigate", "Assault Frigate", "Interceptor", "Electronic Attack Frigate", "Logistics Frigate", "Destroyer", "Interdictor", "Command Destroyer", "Tactical Destroyer", "Cruiser", "Heavy Assault Cruiser (HAC)", "Heavy Interdiction Cruiser (HIC)", "Force Recon Ship", "Combat Recon Ship", "Logistics Cruiser", "T3 Cruiser", "Battlecruiser", "Attack Battlecruiser", "Command Ship", "Battleship", "Marauder", "Black Ops"] },
      { id: "style", label: "Doctrine range", options: ["Brawl", "Mid-range", "Long-range"] },
    ],
    routes: [
      route(["Harpy", "Retribution", "Wolf", "Enyo", "Hawk", "Jaguar"], { shipClass: ["Assault Frigate"], role: ["Line DPS"] }),
      route(["Malediction", "Stiletto", "Crow", "Ares", "Raptor", "Claw"], { shipClass: ["Interceptor"], role: ["Tackle"] }),
      route(["Keres", "Kitsune", "Sentinel", "Hyena"], { shipClass: ["Electronic Attack Frigate"], role: ["EWAR / control"] }),
      route(["Deacon", "Kirin", "Thalia", "Scalpel"], { shipClass: ["Logistics Frigate"], role: ["Logistics"] }),
      route(["Thrasher", "Cormorant", "Coercer", "Catalyst", "Kikimora"], { shipClass: ["Destroyer"], role: ["Line DPS"] }),
      route(["Sabre", "Flycatcher", "Heretic", "Eris"], { shipClass: ["Interdictor"], role: ["Tackle"] }),
      route(["Stork", "Bifrost", "Pontifex", "Magus"], { shipClass: ["Command Destroyer"], role: ["Command / links", "EWAR / control"] }),
      route(["Jackdaw", "Confessor", "Svipul", "Hecate"], { shipClass: ["Tactical Destroyer"], role: ["Line DPS"] }),
      route(["Caracal", "Omen Navy Issue", "Orthrus", "Osprey Navy Issue"], { shipClass: ["Cruiser"], role: ["Line DPS"] }),
      route(["Cerberus", "Muninn", "Zealot", "Eagle", "Deimos", "Ishtar", "Vagabond", "Sacrilege"], { shipClass: ["Heavy Assault Cruiser (HAC)"], role: ["Line DPS"] }),
      route(["Broadsword", "Onyx", "Devoter", "Phobos"], { shipClass: ["Heavy Interdiction Cruiser (HIC)"], role: ["Tackle"] }),
      route(["Arazu", "Rapier", "Pilgrim", "Falcon"], { shipClass: ["Force Recon Ship"], role: ["EWAR / control", "Tackle"] }),
      route(["Lachesis", "Huginn", "Curse", "Rook"], { shipClass: ["Combat Recon Ship"], role: ["EWAR / control", "Tackle"] }),
      route(["Scimitar", "Basilisk", "Guardian", "Oneiros"], { shipClass: ["Logistics Cruiser"], role: ["Logistics"] }),
      route(["Tengu", "Loki", "Proteus", "Legion"], { shipClass: ["T3 Cruiser"], role: ["Line DPS", "Tackle", "EWAR / control", "Logistics", "Command / links"] }),
      route(["Ferox", "Hurricane", "Drake", "Harbinger"], { shipClass: ["Battlecruiser"], role: ["Line DPS"] }),
      route(["Naga", "Tornado", "Oracle", "Talos"], { shipClass: ["Attack Battlecruiser"], role: ["Line DPS"] }),
      route(["Claymore", "Damnation", "Eos", "Vulture", "Sleipnir", "Absolution", "Astarte", "Nighthawk"], { shipClass: ["Command Ship"], role: ["Command / links", "Line DPS"] }),
      route(["Megathron", "Tempest", "Rokh", "Apocalypse", "Maelstrom", "Typhoon", "Leshak", "Machariel", "Nightmare", "Scorpion", "Bhaalgorn", "Armageddon", "Nestor"], { shipClass: ["Battleship"], role: ["Line DPS", "EWAR / control", "Logistics"] }),
      route(["Paladin", "Vargur", "Kronos", "Golem"], { shipClass: ["Marauder"], role: ["Line DPS"] }),
      route(["Panther", "Redeemer", "Sin", "Widow"], { shipClass: ["Black Ops"], role: ["Line DPS", "EWAR / control", "Command / links"] }),
    ],
  },
  "missions-l1-l2": {
    selectors: [{ id: "shipClass", label: "Mission hull", options: ["Destroyer", "Cruiser"] }],
    routes: [
      route(["Cormorant", "Catalyst", "Coercer", "Thrasher"], { shipClass: ["Destroyer"] }),
      route(["Caracal", "Vexor", "Arbitrator", "Rupture"], { shipClass: ["Cruiser"] }),
    ],
  },
  "missions-l3": {
    selectors: [{ id: "shipClass", label: "Mission hull", options: ["Cruiser", "Battlecruiser"] }],
    routes: [
      route(["Gila", "Vexor", "Caracal", "Rupture"], { shipClass: ["Cruiser"] }, ["Heavy Assault Cruiser", "Strategic Cruiser"]),
      route(["Drake", "Myrmidon", "Hurricane", "Harbinger", "Prophecy", "Ferox"], { shipClass: ["Battlecruiser"] }),
    ],
  },
  "missions-burner": {
    routes: [
      route(["Daredevil", "Garmur", "Nergal", "Hawk", "Vengeance", "Retribution"], { family: ["Anomic Agent", "Anomic Team"] }),
      route(["Deimos", "Vagabond", "Cerberus", "Sacrilege"], { family: ["Anomic Base"] }),
    ],
  },
  "highsec-combat-sites": {
    selectors: [{ id: "shipClass", label: "Combat hull", options: ["Cruiser", "Battlecruiser"] }],
    routes: [
      route(["Vexor", "Caracal", "Gila"], { shipClass: ["Cruiser"] }, ["Heavy Assault Cruiser", "Strategic Cruiser"]),
      route(["Gnosis", "Drake", "Myrmidon", "Hurricane"], { shipClass: ["Battlecruiser"] }),
    ],
  },
  "frigate-pvp": {
    selectors: [
      { id: "role", label: "PvP role", options: ["Damage / combat", "Tackle", "EWAR / control", "Support / logistics"] },
      { id: "shipClass", label: "Ship class", options: ["Frigate", "Destroyer"] },
    ],
    routes: [
      route(["Rifter", "Tristan", "Kestrel", "Punisher", "Merlin", "Incursus", "Breacher", "Tormentor", "Caldari Navy Hookbill", "Federation Navy Comet", "Republic Fleet Firetail", "Imperial Navy Slicer"], { shipClass: ["Frigate"], role: ["Damage / combat"] }),
      route(["Atron", "Executioner", "Slasher", "Condor", "Malediction", "Stiletto", "Crow", "Ares"], { shipClass: ["Frigate"], role: ["Tackle"] }),
      route(["Griffin", "Maulus", "Crucifier", "Vigil", "Keres", "Kitsune", "Sentinel", "Hyena"], { shipClass: ["Frigate"], role: ["EWAR / control"] }),
      route(["Navitas", "Bantam", "Burst", "Inquisitor", "Deacon", "Kirin", "Thalia", "Scalpel"], { shipClass: ["Frigate"], role: ["Support / logistics"] }),
      route(["Thrasher", "Catalyst", "Coercer", "Cormorant", "Hecate", "Jackdaw", "Confessor", "Svipul", "Kikimora"], { shipClass: ["Destroyer"], role: ["Damage / combat"] }),
      route(["Sabre", "Flycatcher", "Heretic", "Eris", "Stork", "Bifrost"], { shipClass: ["Destroyer"], role: ["Tackle"] }),
      route(["Stork", "Bifrost", "Pontifex", "Magus"], { shipClass: ["Destroyer"], role: ["EWAR / control", "Support / logistics"] }),
    ],
  },
  "cruiser-pvp": {
    selectors: [
      { id: "role", label: "PvP role", options: ["Damage / combat", "Tackle", "EWAR / control", "Support / logistics"] },
      { id: "shipClass", label: "Ship class", options: ["Cruiser", "Battlecruiser", "Battleship"] },
    ],
    routes: [
      route(["Caracal", "Vexor", "Omen", "Stabber", "Thorax", "Moa", "Rupture", "Osprey Navy Issue", "Exequror Navy Issue", "Omen Navy Issue", "Stabber Fleet Issue", "Orthrus", "Vagabond", "Cynabal", "Deimos"], { shipClass: ["Cruiser"], role: ["Damage / combat"] }),
      route(["Stabber", "Thorax", "Lachesis", "Huginn", "Rapier", "Arazu", "Curse"], { shipClass: ["Cruiser"], role: ["Tackle"] }),
      route(["Blackbird", "Celestis", "Arbitrator", "Bellicose", "Falcon", "Arazu", "Curse", "Huginn"], { shipClass: ["Cruiser"], role: ["EWAR / control"] }),
      route(["Scimitar", "Basilisk", "Guardian", "Oneiros", "Osprey", "Exequror", "Augoror", "Scythe"], { shipClass: ["Cruiser"], role: ["Support / logistics"] }),
      route(["Drake", "Hurricane", "Harbinger", "Brutix", "Ferox", "Cyclone", "Prophecy", "Myrmidon", "Naga", "Tornado", "Oracle", "Talos"], { shipClass: ["Battlecruiser"], role: ["Damage / combat"] }),
      route(["Hurricane", "Cyclone", "Prophecy", "Gnosis", "Claymore", "Damnation"], { shipClass: ["Battlecruiser"], role: ["Tackle", "EWAR / control"] }),
      route(["Claymore", "Damnation", "Eos", "Vulture", "Gnosis"], { shipClass: ["Battlecruiser"], role: ["Support / logistics"] }),
      route(["Megathron", "Tempest", "Raven", "Apocalypse", "Typhoon", "Dominix", "Hyperion", "Rokh", "Maelstrom", "Leshak", "Barghest", "Machariel", "Nightmare"], { shipClass: ["Battleship"], role: ["Damage / combat"] }),
      route(["Bhaalgorn", "Armageddon", "Scorpion", "Typhoon", "Barghest"], { shipClass: ["Battleship"], role: ["Tackle", "EWAR / control"] }),
      route(["Nestor", "Armageddon", "Scorpion", "Bhaalgorn"], { shipClass: ["Battleship"], role: ["Support / logistics"] }),
    ],
  },
  "line-dps": {
    selectors: [{ id: "shipClass", label: "Ship class", options: ["Cruiser", "Battlecruiser", "Battleship"] }],
    routes: [
      route(["Cerberus", "Muninn", "Zealot", "Eagle", "Omen Navy Issue", "Caracal", "Orthrus", "Deimos"], { shipClass: ["Cruiser"] }),
      route(["Ferox", "Hurricane", "Drake", "Harbinger", "Naga", "Tornado", "Oracle", "Talos"], { shipClass: ["Battlecruiser"] }),
      route(["Megathron", "Tempest", "Rokh", "Apocalypse", "Maelstrom", "Typhoon", "Leshak", "Machariel", "Nightmare"], { shipClass: ["Battleship"] }),
    ],
  },
  "logistics": {
    selectors: [{ id: "shipClass", label: "Logistics class", options: ["Cruiser", "Frigate"] }],
    routes: [
      route(["Scimitar", "Basilisk", "Guardian", "Oneiros"], { shipClass: ["Cruiser"] }),
      route(["Deacon", "Kirin", "Thalia", "Scalpel"], { shipClass: ["Frigate"] }),
    ],
  },
  "ewar-tackle": {
    selectors: [
      { id: "role", label: "Control role", options: ["Tackle", "EWAR / control"] },
      { id: "shipClass", label: "Ship class", options: ["Frigate", "Destroyer", "Cruiser"] },
    ],
    routes: [
      route(["Malediction", "Stiletto", "Crow", "Ares", "Atron", "Condor"], { shipClass: ["Frigate"], role: ["Tackle"] }),
      route(["Keres", "Kitsune", "Sentinel", "Hyena", "Griffin", "Maulus", "Crucifier", "Vigil"], { shipClass: ["Frigate"], role: ["EWAR / control"] }),
      route(["Sabre", "Flycatcher", "Heretic", "Eris"], { shipClass: ["Destroyer"], role: ["Tackle"] }),
      route(["Stork", "Bifrost", "Pontifex", "Magus"], { shipClass: ["Destroyer"], role: ["EWAR / control"] }),
      route(["Lachesis", "Huginn", "Rapier", "Arazu"], { shipClass: ["Cruiser"], role: ["Tackle"] }),
      route(["Falcon", "Arazu", "Curse", "Huginn", "Blackbird", "Celestis"], { shipClass: ["Cruiser"], role: ["EWAR / control"] }),
    ],
  },
  "fw-scout-small": {
    selectors: [
      { id: "role", label: "PvP role", options: ["Damage / combat", "Tackle", "EWAR / control"] },
      { id: "shipClass", label: "Plex size / max hull", options: ["Frigate", "Destroyer"] },
      { id: "accessRule", label: "Complex gate", options: ["NVY — T1 / Navy", "ADV — Advanced / Pirate"] },
    ],
    routes: [
      route(["Tristan", "Kestrel", "Rifter", "Punisher", "Merlin", "Incursus", "Republic Fleet Firetail", "Caldari Navy Hookbill", "Federation Navy Comet", "Imperial Navy Slicer", "Dramiel", "Worm"], { shipClass: ["Frigate"], role: ["Damage / combat"] }),
      route(["Atron", "Executioner", "Slasher", "Condor", "Caldari Navy Hookbill", "Republic Fleet Firetail"], { shipClass: ["Frigate"], role: ["Tackle"] }),
      route(["Griffin", "Maulus", "Crucifier", "Vigil"], { shipClass: ["Frigate"], role: ["EWAR / control"] }),
      route(["Thrasher", "Catalyst", "Coercer", "Cormorant", "Algos", "Dragoon", "Corax", "Talwar"], { shipClass: ["Destroyer"], role: ["Damage / combat"] }),
      route(["Thrasher", "Talwar", "Corax"], { shipClass: ["Destroyer"], role: ["Tackle"] }),
    ],
  },
  "fw-medium-large": {
    selectors: [
      { id: "role", label: "PvP role", options: ["Damage / combat", "Tackle", "EWAR / control", "Support / logistics"] },
      { id: "shipClass", label: "Plex size / max hull", options: ["Cruiser", "Battlecruiser", "Battleship"] },
      { id: "accessRule", label: "Complex gate", options: ["NVY — T1 / Navy", "ADV — Advanced / Pirate"] },
    ],
    routes: [
      route(["Caracal", "Omen", "Vexor", "Stabber", "Thorax", "Moa", "Rupture", "Osprey Navy Issue", "Exequror Navy Issue", "Omen Navy Issue", "Stabber Fleet Issue"], { shipClass: ["Cruiser"], role: ["Damage / combat"] }),
      route(["Lachesis", "Huginn", "Rapier", "Arazu", "Stabber"], { shipClass: ["Cruiser"], role: ["Tackle"] }),
      route(["Blackbird", "Celestis", "Arbitrator", "Bellicose", "Falcon", "Curse"], { shipClass: ["Cruiser"], role: ["EWAR / control"] }),
      route(["Scimitar", "Basilisk", "Guardian", "Oneiros"], { shipClass: ["Cruiser"], role: ["Support / logistics"] }),
      route(["Hurricane", "Drake", "Ferox", "Harbinger", "Brutix", "Cyclone", "Prophecy", "Myrmidon"], { shipClass: ["Battlecruiser"], role: ["Damage / combat"] }),
      route(["Hurricane", "Cyclone", "Gnosis", "Claymore", "Damnation"], { shipClass: ["Battlecruiser"], role: ["Tackle", "EWAR / control", "Support / logistics"] }),
      route(["Megathron", "Tempest", "Raven", "Apocalypse", "Typhoon", "Dominix", "Rokh", "Maelstrom", "Vargur", "Paladin"], { shipClass: ["Battleship"], role: ["Damage / combat", "Tackle", "EWAR / control", "Support / logistics"] }),
    ],
  },
  "fw-battlefields": {
    selectors: [
      { id: "role", label: "Fleet role", options: ["DPS", "Tackle / control", "Logistics"] },
      { id: "shipClass", label: "Fleet hull", options: ["Cruiser", "Battlecruiser", "Battleship"] },
    ],
    routes: [
      route(["Caracal", "Omen", "Stabber", "Vexor", "Omen Navy Issue", "Stabber Fleet Issue", "Osprey", "Augoror", "Exequror", "Scythe"], { shipClass: ["Cruiser"], role: ["DPS", "Tackle / control", "Logistics"] }),
      route(["Ferox", "Hurricane", "Drake", "Harbinger", "Ferox Navy Issue", "Prophecy Navy Issue"], { shipClass: ["Battlecruiser"], role: ["DPS", "Tackle / control"] }),
      route(["Megathron", "Tempest", "Raven", "Apocalypse", "Typhoon", "Dominix", "Rokh", "Maelstrom"], { shipClass: ["Battleship"], role: ["DPS", "Tackle / control"] }),
    ],
  },
  "ore-mining": {
    selectors: [{ id: "shipClass", label: "Mining hull", options: ["Mining frigate", "Barge", "Exhumer"] }],
    routes: [
      route(["Venture"], { shipClass: ["Mining frigate"] }),
      route(["Procurer", "Retriever", "Covetor"], { shipClass: ["Barge"] }),
      route(["Skiff", "Mackinaw", "Hulk"], { shipClass: ["Exhumer"] }),
    ],
  },
  "ice-mining": {
    selectors: [{ id: "shipClass", label: "Mining hull", options: ["Mining frigate", "Barge", "Exhumer"] }],
    routes: [
      route(["Endurance"], { shipClass: ["Mining frigate"] }),
      route(["Procurer", "Retriever", "Covetor"], { shipClass: ["Barge"] }),
      route(["Skiff", "Mackinaw", "Hulk"], { shipClass: ["Exhumer"] }),
    ],
  },
  "gas-huffing": {
    selectors: [{ id: "shipClass", label: "Gas hull", options: ["Mining frigate", "Expedition frigate"] }],
    routes: [
      route(["Venture"], { shipClass: ["Mining frigate"] }),
      route(["Prospect"], { shipClass: ["Expedition frigate"] }),
    ],
  },
  "mining-command": {
    selectors: [{ id: "shipClass", label: "Command hull", options: ["Industrial command", "Capital industrial"] }],
    routes: [
      route(["Porpoise", "Orca"], { shipClass: ["Industrial command"] }),
      route(["Rorqual"], { shipClass: ["Capital industrial"] }),
    ],
  },
  "relic-data": {
    selectors: [{ id: "shipClass", label: "Exploration hull", options: ["T1 explorer", "Covert Ops", "Sisters of EVE"] }],
    routes: [
      route(["Heron", "Imicus", "Probe", "Magnate"], { shipClass: ["T1 explorer"] }),
      route(["Cheetah", "Anathema", "Buzzard", "Helios"], { shipClass: ["Covert Ops"] }),
      route(["Astero", "Stratios"], { shipClass: ["Sisters of EVE"] }),
    ],
  },
  "combat-exploration": {
    selectors: [{ id: "shipClass", label: "Combat explorer", options: ["Cruiser", "Heavy Assault Cruiser (HAC)", "T3 Cruiser", "Sisters of EVE"] }],
    routes: [
      route(["Gila"], { shipClass: ["Cruiser"] }),
      route(["Ishtar", "Deimos", "Cerberus", "Vagabond", "Sacrilege"], { shipClass: ["Heavy Assault Cruiser (HAC)"] }),
      route(["Tengu", "Loki", "Proteus", "Legion"], { shipClass: ["T3 Cruiser"] }),
      route(["Stratios"], { shipClass: ["Sisters of EVE"] }),
    ],
  },
  "covert-scout": {
    selectors: [{ id: "shipClass", label: "Scout hull", options: ["Covert Ops", "Sisters of EVE", "Interceptor"] }],
    routes: [
      route(["Cheetah", "Anathema", "Buzzard", "Helios"], { shipClass: ["Covert Ops"] }),
      route(["Astero"], { shipClass: ["Sisters of EVE"] }),
      route(["Malediction", "Stiletto", "Crow", "Ares"], { shipClass: ["Interceptor"] }),
    ],
  },
  "dst-freighter": {
    selectors: [{ id: "shipClass", label: "Transport class", options: ["Deep Space Transport", "Freighter"] }],
    routes: [
      route(["Occator", "Bustard", "Mastodon", "Impel"], { shipClass: ["Deep Space Transport"] }),
      route(["Obelisk", "Charon", "Fenrir", "Providence"], { shipClass: ["Freighter"] }),
    ],
  },
  "regional-arbitrage": {
    selectors: [{ id: "shipClass", label: "Hauling class", options: ["Blockade Runner", "Deep Space Transport", "Freighter"] }],
    routes: [
      route(["Viator", "Crane", "Prowler", "Prorator"], { shipClass: ["Blockade Runner"] }),
      route(["Occator", "Bustard", "Mastodon", "Impel"], { shipClass: ["Deep Space Transport"] }),
      route(["Obelisk", "Charon", "Fenrir", "Providence"], { shipClass: ["Freighter"] }),
    ],
  },
  "market-seeding": {
    selectors: [{ id: "shipClass", label: "Hauling class", options: ["Blockade Runner", "Deep Space Transport", "Freighter", "Industrial command"] }],
    routes: [
      route(["Viator", "Crane", "Prowler", "Prorator"], { shipClass: ["Blockade Runner"] }),
      route(["Occator", "Bustard", "Mastodon", "Impel"], { shipClass: ["Deep Space Transport"] }),
      route(["Obelisk", "Charon", "Fenrir", "Providence"], { shipClass: ["Freighter"] }),
      route(["Orca"], { shipClass: ["Industrial command"] }),
    ],
  },
  "wh-daytrip": {
    routes: [
      route(["Astero", "Cheetah", "Anathema", "Buzzard", "Helios", "Stratios"], { target: ["Relic/data"] }),
      route(["Venture", "Prospect"], { target: ["Gas"] }),
      route(["Cheetah", "Anathema", "Buzzard", "Helios", "Astero"], { target: ["Scouting"] }),
    ],
  },
  "vanguard": {
    selectors: [{ id: "shipClass", label: "Fleet hull", options: ["Battleship", "Logistics cruiser"] }],
    routes: [
      route(["Vindicator", "Nightmare", "Machariel"], { shipClass: ["Battleship"], role: ["DPS", "Sniper / projection"] }),
      route(["Basilisk", "Scimitar", "Guardian", "Oneiros"], { shipClass: ["Logistics cruiser"], role: ["Logistics"] }),
    ],
  },
  "assault-hq": {
    selectors: [{ id: "shipClass", label: "Fleet hull", options: ["Battleship", "Marauder", "Logistics cruiser"] }],
    routes: [
      route(["Vindicator", "Nightmare", "Machariel"], { shipClass: ["Battleship"], role: ["DPS", "Sniper / projection"] }),
      route(["Paladin", "Vargur", "Kronos", "Golem"], { shipClass: ["Marauder"], role: ["DPS", "Sniper / projection"] }),
      route(["Basilisk", "Scimitar", "Guardian", "Oneiros"], { shipClass: ["Logistics cruiser"], role: ["Logistics"] }),
    ],
  },
  "wh-c3-pve": {
    selectors: [{ id: "shipClass", label: "PvE hull", options: ["Cruiser", "Heavy Assault Cruiser (HAC)", "T3 Cruiser", "Battleship", "Marauder"] }],
    routes: [
      route(["Gila"], { shipClass: ["Cruiser"] }),
      route(["Ishtar", "Cerberus", "Sacrilege", "Vagabond"], { shipClass: ["Heavy Assault Cruiser (HAC)"] }),
      route(["Tengu", "Loki", "Proteus", "Legion"], { shipClass: ["T3 Cruiser"] }),
      route(["Praxis", "Rattlesnake", "Dominix"], { shipClass: ["Battleship"] }),
      route(["Paladin", "Vargur", "Kronos", "Golem"], { shipClass: ["Marauder"] }),
    ],
  },
  "wh-c5-c6": {
    selectors: [{ id: "shipClass", label: "Fleet hull", options: ["Marauder", "Battleship", "Capital"] }],
    routes: [
      route(["Paladin", "Vargur", "Kronos", "Golem"], { shipClass: ["Marauder"], role: ["Marauder DPS"] }),
      route(["Nestor", "Leshak"], { shipClass: ["Battleship"], role: ["Battleship DPS"] }),
      route(["Naglfar", "Revelation", "Phoenix", "Moros"], { shipClass: ["Capital"], role: ["Capital escalation"] }),
    ],
  },
  "missions-l4": {
    selectors: [{ id: "shipClass", label: "Mission hull", options: ["Battleship", "Marauder"] }],
    routes: [
      route(["Raven", "Dominix", "Machariel", "Rattlesnake", "Nightmare", "Typhoon", "Apocalypse"], { shipClass: ["Battleship"] }),
      route(["Paladin", "Vargur", "Kronos", "Golem"], { shipClass: ["Marauder"] }),
    ],
  },
  "nullsec-ratting": {
    selectors: [{ id: "shipClass", label: "Ratting hull", options: ["Cruiser", "Heavy Assault Cruiser (HAC)", "T3 Cruiser", "Battlecruiser", "Battleship", "Marauder"] }],
    routes: [
      route(["Gila"], { shipClass: ["Cruiser"] }),
      route(["Ishtar"], { shipClass: ["Heavy Assault Cruiser (HAC)"] }),
      route(["Tengu", "Loki", "Proteus", "Legion"], { shipClass: ["T3 Cruiser"] }),
      route(["Myrmidon", "Prophecy"], { shipClass: ["Battlecruiser"] }),
      route(["Dominix", "Rattlesnake", "Praxis"], { shipClass: ["Battleship"] }),
      route(["Vargur", "Paladin", "Kronos", "Golem"], { shipClass: ["Marauder"] }),
    ],
  },
  "ded-escalations": {
    selectors: [{ id: "shipClass", label: "Combat hull", options: ["Cruiser", "Heavy Assault Cruiser (HAC)", "T3 Cruiser", "Battleship", "Marauder"] }],
    routes: [
      route(["Gila"], { shipClass: ["Cruiser"] }),
      route(["Ishtar", "Deimos", "Cerberus", "Vagabond", "Sacrilege"], { shipClass: ["Heavy Assault Cruiser (HAC)"] }),
      route(["Tengu", "Loki", "Proteus", "Legion"], { shipClass: ["T3 Cruiser"] }),
      route(["Rattlesnake", "Dominix", "Machariel"], { shipClass: ["Battleship"] }),
      route(["Vargur", "Paladin", "Kronos", "Golem"], { shipClass: ["Marauder"] }),
    ],
  },
};

export function recommendationProfile(contentId: string) {
  return profiles[contentId];
}

export function recommendationSelectors(content: ActivityContent): ActivitySelector[] {
  const profile = recommendationProfile(content.id);
  const profileById = new Map((profile?.selectors ?? []).map((selector) => [selector.id, selector]));
  const merged = (content.selectors ?? []).map((selector) => profileById.get(selector.id) ?? selector);
  for (const selector of profile?.selectors ?? []) {
    if (!merged.some((item) => item.id === selector.id)) merged.push(selector);
  }
  return merged;
}

export function recommendationShips(content: ActivityContent, selectorValues: Record<string, string>, catalogue: RecommendationShip[] = []) {
  const profile = recommendationProfile(content.id);
  let curated: string[] = [];

  if (!profile?.routes.length && content.shipRoutes?.length) {
    const shipClass = selectorValues.shipClass ?? "";
    const role = selectorValues.role ?? "";
    const engagement = selectorValues.engagement ?? "";
    const matched = content.shipRoutes.filter((route) =>
      (!shipClass || route.shipClass === shipClass) &&
      (!route.roles?.length || !role || route.roles.includes(role)) &&
      (!route.engagements?.length || !engagement || route.engagements.includes(engagement)),
    );
    curated = [...new Set(matched.flatMap((route) => route.ships))];
  } else if (!profile?.routes.length) {
    curated = [...content.ships];
  } else {
    const matching = profile.routes.filter((item) => {
      if (!item.match) return true;
      return Object.entries(item.match).every(([selectorId, allowed]) => {
        const selected = selectorValues[selectorId];
        return !selected || allowed.includes(selected);
      });
    });
    const seen = new Set<string>();
    const add = (name: string) => {
      const key = name.toLowerCase();
      if (!seen.has(key)) { seen.add(key); curated.push(name); }
    };
    for (const item of matching) {
      item.ships.forEach(add);
      if (item.groups?.length && catalogue.length) {
        const groups = new Set(item.groups.map((group) => group.toLowerCase()));
        catalogue
          .filter((ship) => ship.groupName && groups.has(ship.groupName.toLowerCase()))
          .sort((a, b) => a.name.localeCompare(b.name))
          .forEach((ship) => add(ship.name));
      }
    }
  }

  return expandActivityShipPool(content.id, selectorValues, catalogue, curated);
}

export function recommendationMetaPicks(content: ActivityContent, selectorValues: Record<string, string>, catalogue: RecommendationShip[] = []) {
  const available = new Set(recommendationShips(content, selectorValues, catalogue).map((name) => name.toLowerCase()));
  return activityMetaPicks(content.id, selectorValues).filter((pick) => available.has(pick.name.toLowerCase()));
}
