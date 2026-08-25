export type ActivityShipCatalogueEntry = {
  typeId: number;
  name: string;
  groupId?: number;
  groupName?: string;
  metaGroupId?: number;
  metaGroupName?: string;
  factionId?: number;
  factionName?: string;
};

export type ActivityMetaPick = { name: string; reason: string };

const exactClassGroups: Record<string, string[]> = {
  "assault frigate": ["Assault Frigate"],
  interceptor: ["Interceptor"],
  "electronic attack frigate": ["Electronic Attack Ship"],
  "logistics frigate": ["Logistics Frigate"],
  "covert ops": ["Covert Ops"],
  capital: ["Dreadnought", "Lancer Dreadnought"],
  interdictor: ["Interdictor"],
  "command destroyer": ["Command Destroyer"],
  "tactical destroyer": ["Tactical Destroyer"],
  "heavy assault cruiser (hac)": ["Heavy Assault Cruiser"],
  "heavy interdiction cruiser (hic)": ["Heavy Interdiction Cruiser"],
  "force recon ship": ["Force Recon Ship"],
  "combat recon ship": ["Combat Recon Ship"],
  "logistics cruiser": ["Logistics"],
  "logistics cruiser ": ["Logistics"],
  "t3 cruiser": ["Strategic Cruiser"],
  "strategic cruiser": ["Strategic Cruiser"],
  "attack battlecruiser": ["Attack Battlecruiser"],
  "command ship": ["Command Ship"],
  marauder: ["Marauder"],
  "black ops": ["Black Ops"],
  exhumer: ["Exhumer"],
  barge: ["Mining Barge"],
  "expedition frigate": ["Expedition Frigate"],
  "blockade runner": ["Blockade Runner"],
  "deep space transport": ["Deep Space Transport"],
  freighter: ["Freighter"],
  "jump freighter": ["Jump Freighter"],
  "industrial command": ["Industrial Command Ship"],
  "capital industrial": ["Capital Industrial Ship"],
};

const genericFamilies: Record<string, string[]> = {
  frigate: ["Frigate", "Assault Frigate", "Interceptor", "Electronic Attack Ship", "Logistics Frigate", "Covert Ops", "Stealth Bomber"],
  destroyer: ["Destroyer", "Tactical Destroyer", "Interdictor", "Command Destroyer"],
  cruiser: ["Cruiser", "Heavy Assault Cruiser", "Heavy Interdiction Cruiser", "Force Recon Ship", "Combat Recon Ship", "Logistics", "Strategic Cruiser"],
  battlecruiser: ["Combat Battlecruiser", "Attack Battlecruiser", "Command Ship"],
  battleship: ["Battleship", "Marauder", "Black Ops"],
};

const pvpContent = new Set([
  "pvp-roaming", "fleet-roles", "frigate-pvp", "cruiser-pvp", "line-dps", "ewar-tackle",
  "fw-scout-small", "fw-medium-large", "fw-battlefields",
]);

const pveContent = new Set([
  "missions-l1-l2", "missions-l3", "missions-l4", "highsec-combat-sites", "nullsec-ratting",
  "ded-escalations", "combat-exploration", "wh-c3-pve", "wh-rampant-drone-fabricator",
]);

const fwContent = new Set(["fw-scout-small", "fw-medium-large", "fw-battlefields"]);
const empireFactions = new Set(["Amarr Empire", "Caldari State", "Gallente Federation", "Minmatar Republic"]);
const fwNonCombatGroups = new Set([
  "Expedition Frigate", "Mining Barge", "Exhumer", "Hauler", "Blockade Runner", "Deep Space Transport",
  "Industrial Command Ship", "Capital Industrial Ship", "Freighter", "Jump Freighter",
]);

function normalized(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function fwAccessRule(contentId: string, selectorValues: Record<string, string>) {
  if (contentId === "fw-battlefields") return "nvy";
  if (contentId === "fw-scout-small" && normalized(selectorValues.shipClass) === "frigate") return "nvy";
  const selected = normalized(selectorValues.accessRule);
  return selected.startsWith("adv") ? "adv" : "nvy";
}

const fwTierGroups: Record<string, string[]> = {
  frigate: [...genericFamilies.frigate],
  destroyer: [...genericFamilies.frigate, ...genericFamilies.destroyer],
  cruiser: [...genericFamilies.frigate, ...genericFamilies.destroyer, ...genericFamilies.cruiser],
  battlecruiser: [...genericFamilies.frigate, ...genericFamilies.destroyer, ...genericFamilies.cruiser, ...genericFamilies.battlecruiser],
  battleship: [...genericFamilies.frigate, ...genericFamilies.destroyer, ...genericFamilies.cruiser, ...genericFamilies.battlecruiser, ...genericFamilies.battleship],
};

function isEmpireNavyHull(ship: ActivityShipCatalogueEntry) {
  return empireFactions.has(String(ship.factionName ?? "")) && /\b(navy|fleet)\b/i.test(ship.name);
}

function fwShipAllowed(contentId: string, selectorValues: Record<string, string>, ship: ActivityShipCatalogueEntry) {
  const groupName = String(ship.groupName ?? "");
  if (fwNonCombatGroups.has(groupName)) return false;
  if (normalized(ship.factionName) === "ore") return false;

  const meta = normalized(ship.metaGroupName);
  const access = fwAccessRule(contentId, selectorValues);
  if (access === "nvy") {
    if (meta === "tech i") return empireFactions.has(String(ship.factionName ?? ""));
    return meta === "faction" && isEmpireNavyHull(ship);
  }
  if (!(meta === "tech i" || meta === "tech ii" || meta === "tech iii" || meta === "faction")) return false;

  // FW treats precursor/special T1 hulls as ADV, but T3 hulls have stricter size gates.
  if (meta === "tech iii") {
    const selectedClass = normalized(selectorValues.shipClass);
    const group = normalized(ship.groupName);
    if (group === "tactical destroyer") return contentId === "fw-medium-large" && ["cruiser", "battlecruiser", "battleship"].includes(selectedClass);
    if (group === "strategic cruiser") return contentId === "fw-medium-large" && selectedClass === "battleship";
  }
  return true;
}

function roleGroups(size: string, roleText: string) {
  const role = normalized(roleText);
  const support = role.includes("logistics") || role.includes("support");
  const ewar = role.includes("ewar") || role.includes("control");
  const tackle = role.includes("tackle");
  const command = role.includes("command") || role.includes("links");

  if (size === "frigate") {
    if (support) return ["Frigate", "Logistics Frigate"];
    if (ewar) return ["Frigate", "Electronic Attack Ship", "Interceptor"];
    if (tackle) return ["Frigate", "Assault Frigate", "Interceptor", "Electronic Attack Ship"];
    return ["Frigate", "Assault Frigate", "Interceptor", "Stealth Bomber"];
  }
  if (size === "destroyer") {
    if (command || support || ewar) return ["Destroyer", "Interdictor", "Command Destroyer", "Tactical Destroyer"];
    if (tackle) return ["Destroyer", "Interdictor", "Command Destroyer", "Tactical Destroyer"];
    return ["Destroyer", "Tactical Destroyer", "Interdictor"];
  }
  if (size === "cruiser") {
    if (command) return ["Strategic Cruiser"];
    if (support) return ["Cruiser", "Logistics", "Strategic Cruiser", "Force Recon Ship"];
    if (ewar) return ["Cruiser", "Force Recon Ship", "Combat Recon Ship", "Heavy Interdiction Cruiser", "Strategic Cruiser"];
    if (tackle) return ["Cruiser", "Heavy Assault Cruiser", "Heavy Interdiction Cruiser", "Force Recon Ship", "Combat Recon Ship", "Strategic Cruiser"];
    return ["Cruiser", "Heavy Assault Cruiser", "Heavy Interdiction Cruiser", "Combat Recon Ship", "Strategic Cruiser"];
  }
  if (size === "battlecruiser") {
    if (command || support) return ["Combat Battlecruiser", "Command Ship"];
    if (ewar || tackle) return ["Combat Battlecruiser", "Command Ship"];
    return ["Combat Battlecruiser", "Attack Battlecruiser", "Command Ship"];
  }
  if (size === "battleship") {
    if (support || ewar || tackle) return ["Battleship", "Black Ops"];
    return ["Battleship", "Marauder", "Black Ops"];
  }
  return genericFamilies[size] ?? [];
}

function groupsForGenericClass(contentId: string, shipClass: string, role: string) {
  const size = normalized(shipClass);
  if (!genericFamilies[size]) return [];

  if (contentId === "abyss-cruiser") {
    // Abyss accepts T1/T2/navy/pirate cruisers, but Strategic Cruisers are not legal entrants.
    return genericFamilies.cruiser.filter((group) => group !== "Strategic Cruiser");
  }
  if (contentId === "abyss-destroyer") return [...genericFamilies.destroyer];
  if (contentId === "abyss-frigate") return [...genericFamilies.frigate];
  if (pvpContent.has(contentId)) return roleGroups(size, role);
  if (pveContent.has(contentId)) {
    if (size === "cruiser") return ["Cruiser", "Heavy Assault Cruiser", "Heavy Interdiction Cruiser", "Force Recon Ship", "Combat Recon Ship", "Strategic Cruiser"];
    return [...genericFamilies[size]];
  }
  return [...genericFamilies[size]];
}

function inferredGroups(contentId: string, selectorValues: Record<string, string>) {
  const shipClass = normalized(selectorValues.shipClass);
  if (shipClass) {
    if (fwContent.has(contentId) && contentId !== "fw-battlefields" && fwTierGroups[shipClass]) return fwTierGroups[shipClass];
    const exact = exactClassGroups[shipClass];
    if (exact) return exact;
    const generic = groupsForGenericClass(contentId, shipClass, selectorValues.role ?? "");
    if (generic.length) return generic;
  }

  switch (contentId) {
    case "missions-burner": {
      const family = normalized(selectorValues.family);
      if (family.includes("base")) return ["Frigate", "Assault Frigate", "Interceptor", "Electronic Attack Ship", "Stealth Bomber", "Destroyer", "Tactical Destroyer", "Interdictor", "Command Destroyer", "Cruiser", "Heavy Assault Cruiser", "Combat Battlecruiser", "Attack Battlecruiser"];
      return ["Frigate", "Assault Frigate", "Interceptor", "Electronic Attack Ship", "Logistics Frigate", "Covert Ops", "Stealth Bomber"];
    }
    case "abyss-cruiser": return groupsForGenericClass(contentId, "cruiser", "");
    case "abyss-destroyer": return groupsForGenericClass(contentId, "destroyer", "");
    case "abyss-frigate": return groupsForGenericClass(contentId, "frigate", "");
    case "basic-hauling": return ["Hauler"];
    case "blockade-runner": return ["Blockade Runner"];
    case "dreadnought": return ["Dreadnought", "Lancer Dreadnought"];
    case "carrier": return ["Carrier", "Command Carrier"];
    case "fax": return ["Force Auxiliary"];
    case "jump-freighter": return ["Jump Freighter"];
    case "rorqual": return ["Capital Industrial Ship"];
    case "wh-rampant-drone-fabricator": return ["Battleship", "Marauder", "Strategic Cruiser"];
    default: return [];
  }
}

function explicitActivityNames(contentId: string, selectorValues: Record<string, string>) {
  const shipClass = normalized(selectorValues.shipClass);
  if (contentId === "ore-mining" && shipClass === "mining frigate") return ["Prospect", "Endurance"];
  if (contentId !== "wh-daytrip") return [];
  const target = normalized(selectorValues.target);
  if (target.includes("relic") || target.includes("data") || target.includes("scouting")) {
    return ["Heron", "Imicus", "Probe", "Magnate", "Cheetah", "Anathema", "Buzzard", "Helios", "Astero", "Stratios"];
  }
  return [];
}

export function expandActivityShipPool(
  contentId: string,
  selectorValues: Record<string, string>,
  catalogue: ActivityShipCatalogueEntry[],
  curatedNames: string[],
) {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (name: string) => {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };

  curatedNames.forEach(add);
  explicitActivityNames(contentId, selectorValues).forEach(add);
  const groups = new Set(inferredGroups(contentId, selectorValues).map(normalized));
  if (groups.size) {
    catalogue
      .filter((ship) => ship.groupName && groups.has(normalized(ship.groupName)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((ship) => add(ship.name));
  }
  if (fwContent.has(contentId)) {
    const byName = new Map(catalogue.map((ship) => [normalized(ship.name), ship]));
    return names.filter((name) => {
      const ship = byName.get(normalized(name));
      return Boolean(ship && fwShipAllowed(contentId, selectorValues, ship));
    });
  }
  return names;
}

export function activityMetaPicks(contentId: string, selectorValues: Record<string, string>): ActivityMetaPick[] {
  const tier = normalized(selectorValues.tier);
  const shipClass = normalized(selectorValues.shipClass);
  const priority = normalized(selectorValues.priority);
  const accessRule = fwAccessRule(contentId, selectorValues);
  const picks: ActivityMetaPick[] = [];
  const add = (name: string, reason: string) => picks.push({ name, reason });

  if (contentId === "fw-scout-small") {
    if (!shipClass || shipClass === "frigate") {
      for (const name of ["Caldari Navy Hookbill", "Federation Navy Comet"])
        add(name, "Established FW frigate plex meta pick.");
      if (accessRule === "adv") for (const name of ["Dramiel", "Worm"]) add(name, "Advanced FW frigate plex meta pick.");
    }
    if (shipClass === "destroyer") {
      for (const name of ["Thrasher", "Catalyst", "Thrasher Fleet Issue", "Catalyst Navy Issue"])
        add(name, "Established FW small-plex destroyer pick.");
    }
  }
  if (contentId === "fw-medium-large") {
    if (!shipClass || shipClass === "cruiser") {
      for (const name of ["Omen Navy Issue", "Stabber Fleet Issue"]) add(name, "Established FW medium-plex Navy cruiser pick.");
      if (accessRule === "adv") {
        for (const name of ["Cynabal", "Gila"]) add(name, "Advanced FW medium-plex pirate cruiser pick.");
        for (const name of ["Confessor", "Jackdaw"]) add(name, "Advanced FW medium-plex tactical destroyer pick.");
      }
    }
    if (shipClass === "battlecruiser") {
      for (const name of ["Ferox Navy Issue", "Prophecy Navy Issue"]) add(name, "Established FW moderate-plex Navy battlecruiser pick.");
    }
    if (shipClass === "battleship" && accessRule === "adv") {
      for (const name of ["Vargur", "Paladin"]) add(name, "Advanced large-plex grid-control pick.");
    }
  }
  if (contentId === "missions-burner") {
    const family = normalized(selectorValues.family);
    const names = family.includes("base")
      ? ["Deimos", "Vagabond", "Cerberus", "Sacrilege"]
      : ["Daredevil", "Garmur", "Nergal", "Hawk", "Vengeance", "Retribution"];
    for (const name of names) add(name, "Established " + (family || "anomic") + " burner fit platform.");
  }
  if (contentId === "missions-l3" && (!shipClass || shipClass === "cruiser")) {
    for (const name of ["Gila", "Vexor Navy Issue", "Caracal Navy Issue"])
      add(name, "Established Level 3 cruiser mission meta pick.");
  }
  if (contentId === "abyss-cruiser" && tier.startsWith("t6")) {
    add("Gila", "Established high-tier Abyss cruiser meta pick.");
  }
  if (contentId === "nullsec-ratting") {
    add("Ishtar", "Established null-sec anomaly ratting meta pick.");
  }
  if (contentId === "missions-l4" && (!shipClass || shipClass === "battleship" || shipClass === "marauder")) {
    for (const name of ["Vargur", "Paladin", "Golem", "Kronos"])
      add(name, "Marauder-class Level 4 mission meta pick.");
  }
  if (contentId === "ore-mining") {
    if (priority.includes("yield")) {
      if (shipClass === "exhumer") add("Hulk", "Maximum-yield Exhumer meta pick.");
      if (shipClass === "barge") add("Covetor", "Maximum-yield mining barge meta pick.");
    }
    if (priority.includes("tank")) {
      if (shipClass === "exhumer") add("Skiff", "Tank-focused Exhumer meta pick.");
      if (shipClass === "barge") add("Procurer", "Tank-focused mining barge meta pick.");
    }
  }
  return picks;
}
