import type { ExplicitSkillTarget } from "./readiness";

export type ActivityContext = {
  activityId: string;
  subcategoryId: string;
  contentId: string;
  selectorValues?: Record<string, string>;
};

export type ContextModel =
  | "combat"
  | "harvesting"
  | "exploration"
  | "hauling"
  | "industry"
  | "trading"
  | "capital"
  | "general";

export type ContextRule = {
  model: ContextModel;
  includeHull: boolean;
  includeFit: boolean;
  weights: { hull: number; fit: number; activity: number; context: number };
  contextTargets: ExplicitSkillTarget[];
  masteryTargets: ExplicitSkillTarget[];
  fitHints: string[];
  roleLabel?: string;
};

const target = (skill: string, level: number): ExplicitSkillTarget => ({ skill, level });

const weights: Record<ContextModel, ContextRule["weights"]> = {
  combat: { hull: 15, fit: 45, activity: 25, context: 15 },
  harvesting: { hull: 10, fit: 35, activity: 30, context: 25 },
  exploration: { hull: 10, fit: 30, activity: 35, context: 25 },
  hauling: { hull: 15, fit: 35, activity: 25, context: 25 },
  industry: { hull: 0, fit: 0, activity: 70, context: 30 },
  trading: { hull: 0, fit: 0, activity: 80, context: 20 },
  capital: { hull: 20, fit: 40, activity: 25, context: 15 },
  general: { hull: 0, fit: 0, activity: 80, context: 20 },
};

function selector(context: ActivityContext, id: string) {
  return context.selectorValues?.[id]?.trim() ?? "";
}

function tierNumber(value: string) {
  const match = value.match(/T([0-6])/i);
  return match ? Number(match[1]) : 0;
}

function baseModel(context: ActivityContext): ContextModel {
  if (context.activityId === "mining") return "harvesting";
  if (context.activityId === "exploration") return "exploration";
  if (context.activityId === "hauling") return "hauling";
  if (context.activityId === "industry") return "industry";
  if (context.activityId === "trading")
    return context.contentId === "regional-arbitrage" || context.contentId === "market-seeding"
      ? "hauling"
      : "trading";
  if (context.activityId === "capitals") return "capital";
  if (context.activityId === "general") return "general";
  return "combat";
}

export function resolveContextRule(context: ActivityContext): ContextRule {
  const model = baseModel(context);
  const contextTargets: ExplicitSkillTarget[] = [];
  const masteryTargets: ExplicitSkillTarget[] = [];
  const fitHints: string[] = [];
  let roleLabel: string | undefined;

  if (context.contentId === "missions-burner") {
    const family = selector(context, "family").toLowerCase();
    contextTargets.push(
      target("Thermodynamics", 4),
      target("Navigation", 5),
      target("Advanced Weapon Upgrades", 4),
      target("Signature Analysis", 4),
    );
    if (family.includes("agent") || family.includes("team")) {
      contextTargets.push(target("Evasive Maneuvering", 5), target("Propulsion Jamming", 4));
      fitHints.push("afterburner", "stasis webifier", "warp scrambler");
    }
    if (family.includes("base")) {
      contextTargets.push(target("Capacitor Management", 5), target("Capacitor Systems Operation", 4));
      fitHints.push("afterburner", "repairer", "shield booster");
    }
    masteryTargets.push(target("Thermodynamics", 5));
  }

  if (context.subcategoryId === "abyss") {
    const tier = tierNumber(selector(context, "tier"));
    const weather = selector(context, "weather").toLowerCase();
    if (tier >= 2) contextTargets.push(target("Thermodynamics", 3));
    if (tier >= 3) contextTargets.push(target("Thermodynamics", 4), target("Navigation", 5));
    if (tier >= 4) contextTargets.push(target("Advanced Weapon Upgrades", 4));
    if (tier >= 5) contextTargets.push(target("Capacitor Management", 5), target("Capacitor Systems Operation", 5));
    if (tier >= 6) masteryTargets.push(target("Thermodynamics", 5), target("Advanced Weapon Upgrades", 5));
    if (weather.includes("electrical")) contextTargets.push(target("Capacitor Management", Math.min(5, 3 + Math.ceil(tier / 2))));
    if (weather.includes("dark")) contextTargets.push(target("Acceleration Control", tier >= 4 ? 5 : 4), target("Evasive Maneuvering", 5));
    if (weather.includes("gamma")) contextTargets.push(target("Shield Management", tier >= 4 ? 5 : 4));
    if (weather.includes("firestorm")) contextTargets.push(target("Mechanics", tier >= 4 ? 5 : 4), target("Hull Upgrades", tier >= 4 ? 5 : 4));
    if (weather.includes("exotic")) contextTargets.push(target("Signature Analysis", tier >= 4 ? 5 : 4));
  }

  if (context.contentId === "ore-mining") {
    fitHints.push("strip miner", "mining laser");
    const operation = selector(context, "operation").toLowerCase();
    const priority = selector(context, "priority").toLowerCase();
    if (operation.includes("fleet")) contextTargets.push(target("Mining Upgrades", 4));
    if (priority.includes("yield")) contextTargets.push(target("Mining", 5), target("Astrogeology", 5), target("Mining Upgrades", 5));
    if (priority.includes("tank")) contextTargets.push(target("Shield Management", 5), target("Shield Operation", 4));
    masteryTargets.push(target("Exhumers", 5));
  }
  if (context.contentId === "ice-mining") {
    fitHints.push("ice harvester");
    contextTargets.push(target("Ice Harvesting", 5));
    if (selector(context, "priority").toLowerCase().includes("tank"))
      contextTargets.push(target("Shield Management", 5), target("Shield Operation", 4));
    masteryTargets.push(target("Exhumers", 5), target("Mining Upgrades", 5));
  }
  if (context.contentId === "gas-huffing") {
    fitHints.push("gas cloud");
    contextTargets.push(target("Gas Cloud Harvesting", 5));
    if (selector(context, "space").toLowerCase().includes("wormhole"))
      contextTargets.push(target("Astrometrics", 4), target("Cloaking", 4));
  }
  if (context.contentId === "mining-command") {
    fitHints.push("mining foreman burst", "industrial core");
    contextTargets.push(target("Mining Director", 5), target("Mining Foreman", 5));
  }

  if (context.activityId === "pvp" || context.activityId === "faction-warfare") {
    const style = selector(context, "style").toLowerCase();
    const role = selector(context, "role").toLowerCase();
    const shipClass = selector(context, "shipClass").toLowerCase();
    roleLabel = selector(context, "role") || roleLabel;
    if (style.includes("brawl")) fitHints.push("warp scrambler", "stasis webifier", "afterburner");
    if (style.includes("scram-kite")) fitHints.push("warp scrambler", "stasis webifier");
    if (style === "kite") fitHints.push("warp disruptor", "microwarpdrive");
    if (style.includes("projection")) fitHints.push("sensor booster", "tracking computer");
    contextTargets.push(target("Thermodynamics", 4));
    if (role.includes("tackle")) {
      fitHints.push("warp scrambler", "warp disruptor", "stasis webifier");
      contextTargets.push(target("Propulsion Jamming", 4), target("Evasive Maneuvering", 5), target("Navigation", 5));
    } else if (role.includes("ewar") || role.includes("control")) {
      fitHints.push("ecm", "sensor dampener", "tracking disruptor", "target painter", "stasis webifier");
      contextTargets.push(target("Electronic Warfare", 4), target("Long Range Targeting", 4), target("Signature Analysis", 4));
    } else if (role.includes("logistics") || role.includes("support")) {
      fitHints.push("remote shield", "remote armor", "remote capacitor");
      contextTargets.push(target("Capacitor Management", 5), target("Capacitor Systems Operation", 5), target("Long Range Targeting", 4), target("Signature Analysis", 4));
    } else {
      fitHints.push("damage");
      contextTargets.push(target("Advanced Weapon Upgrades", 4), target("Signature Analysis", 4));
    }
    if (shipClass.includes("interdictor") && !shipClass.includes("heavy")) fitHints.push("interdiction sphere launcher");
    if (shipClass.includes("heavy interdiction")) fitHints.push("warp disruption field generator");
    if (shipClass.includes("command destroyer")) fitHints.push("micro jump field generator", "command burst");
    if (shipClass.includes("command ship")) fitHints.push("command burst");
    if (shipClass.includes("logistics")) fitHints.push("remote shield", "remote armor", "remote capacitor");
    if (shipClass.includes("recon") || shipClass.includes("electronic attack")) fitHints.push("ecm", "sensor dampener", "tracking disruptor", "target painter");
    if (shipClass.includes("marauder")) fitHints.push("bastion module");
    if (shipClass.includes("black ops")) fitHints.push("covert jump portal", "cloaking device");

    if (selector(context, "engagement").toLowerCase().includes("solo"))
      contextTargets.push(target("Evasive Maneuvering", 5));
  }
  if (context.contentId === "line-dps") {
    roleLabel = selector(context, "role") || "Line DPS";
    fitHints.push(roleLabel.toLowerCase().includes("sniper") ? "sensor booster" : "weapon");
    contextTargets.push(target("Long Range Targeting", 4), target("Signature Analysis", 4));
  }
  if (context.contentId === "logistics") {
    fitHints.push("remote shield", "remote armor", "remote capacitor");
    contextTargets.push(target("Logistics Cruisers", 4), target("Signature Analysis", 5));
  }
  if (context.contentId === "ewar-tackle") {
    fitHints.push("warp disruptor", "warp scrambler", "ecm", "sensor dampener", "tracking disruptor");
  }

  if (context.contentId === "relic-data" || context.contentId === "covert-scout" || context.contentId === "wh-daytrip") {
    fitHints.push("probe launcher", "data analyzer", "relic analyzer", "cloaking device");
    const space = selector(context, "space").toLowerCase();
    if (space.includes("null") || space.includes("wormhole"))
      contextTargets.push(target("Cloaking", 4), target("Astrometric Rangefinding", 4));
  }
  if (context.contentId === "combat-exploration") fitHints.push("probe launcher", "cloaking device");

  if (context.contentId === "blockade-runner") {
    fitHints.push("covert ops cloaking device", "inertial stabilizer", "nanofiber");
    contextTargets.push(target("Cloaking", 4), target("Evasive Maneuvering", 5));
  }
  if (context.contentId === "dst-freighter" || context.contentId === "basic-hauling" || context.contentId === "regional-arbitrage" || context.contentId === "market-seeding") {
    fitHints.push("inertial stabilizer", "damage control", "shield extender", "armor plate");
    const route = selector(context, "route").toLowerCase();
    if (route.includes("low") || route.includes("null") || route.includes("wormhole"))
      contextTargets.push(target("Evasive Maneuvering", 5), target("Navigation", 5));
  }

  if (context.activityId === "incursions") {
    roleLabel = selector(context, "role") || "DPS";
    if (roleLabel.toLowerCase().includes("logistics")) {
      fitHints.push("remote shield", "remote armor", "remote capacitor");
      contextTargets.push(target("Logistics Cruisers", 4));
    } else {
      fitHints.push("tracking computer", "stasis webifier", "damage");
      contextTargets.push(target("Advanced Weapon Upgrades", context.contentId === "assault-hq" ? 5 : 4));
    }
  }

  if (context.contentId === "wh-c3-pve" || context.contentId === "wh-c5-c6") {
    contextTargets.push(target("Astrometrics", 4), target("Cloaking", 4), target("Thermodynamics", 4));
    if (context.contentId === "wh-c5-c6") masteryTargets.push(target("Thermodynamics", 5));
  }

  if (context.activityId === "capitals") {
    roleLabel = selector(context, "role") || selector(context, "doctrine") || undefined;
    contextTargets.push(target("Jump Drive Operation", 5), target("Jump Drive Calibration", 4));
    if (context.contentId === "dreadnought") fitHints.push("siege module");
    if (context.contentId === "fax") fitHints.push("triage module", "capital remote");
    if (context.contentId === "carrier") fitHints.push("fighter support unit", "networked sensor array");
    if (context.contentId === "rorqual") fitHints.push("industrial core", "mining foreman burst");
  }


  if (context.contentId === "ded-escalations") {
    const rating = Number(selector(context, "rating").split("/")[0] || 0);
    if (rating >= 6) contextTargets.push(target("Thermodynamics", 4), target("Navigation", 5));
    if (rating >= 8) contextTargets.push(target("Capacitor Management", 5), target("Advanced Weapon Upgrades", 4));
    if (rating >= 10) masteryTargets.push(target("Thermodynamics", 5), target("Advanced Weapon Upgrades", 5));
  }

  if (context.contentId === "mining-command") {
    const role = selector(context, "role").toLowerCase();
    if (role.includes("boost")) fitHints.push("mining foreman burst");
    if (role.includes("compress")) fitHints.push("compressor", "industrial core");
    if (role.includes("defensive")) fitHints.push("shield", "command burst");
  }

  if (context.contentId === "relic-data") {
    const priority = selector(context, "priority").toLowerCase();
    if (priority.includes("scanning")) contextTargets.push(target("Astrometric Rangefinding", 4), target("Astrometric Pinpointing", 4));
    if (priority.includes("hacking")) contextTargets.push(target("Hacking", 5), target("Archaeology", 5));
    if (priority.includes("travel")) contextTargets.push(target("Cloaking", 4), target("Navigation", 5), target("Evasive Maneuvering", 5));
  }
  if (context.contentId === "combat-exploration") {
    const space = selector(context, "space").toLowerCase();
    if (space.includes("low") || space.includes("null") || space.includes("wormhole"))
      contextTargets.push(target("Cloaking", 4), target("Astrometric Rangefinding", 4));
  }
  if (context.contentId === "covert-scout" && selector(context, "role").toLowerCase().includes("fleet"))
    contextTargets.push(target("Long Range Targeting", 4), target("Signature Analysis", 5));

  if (["basic-hauling", "blockade-runner", "dst-freighter", "regional-arbitrage", "market-seeding"].includes(context.contentId)) {
    const cargo = selector(context, "cargo").toLowerCase();
    if (cargo.includes("high value")) contextTargets.push(target("Evasive Maneuvering", 5), target("Mechanics", 5), target("Hull Upgrades", 5));
    if (cargo.includes("very high")) contextTargets.push(target("Navigation", 5), target("Shield Management", 5));
  }

  if (context.contentId === "wh-daytrip") {
    const goal = selector(context, "target").toLowerCase();
    if (goal.includes("gas")) {
      fitHints.push("gas cloud");
      contextTargets.push(target("Gas Cloud Harvesting", 5));
    }
    if (goal.includes("relic") || goal.includes("data")) fitHints.push("relic analyzer", "data analyzer");
    if (goal.includes("scouting")) fitHints.push("cloaking device", "probe launcher");
  }
  if (context.contentId === "wh-c3-pve" && selector(context, "operation").toLowerCase().includes("solo"))
    contextTargets.push(target("Capacitor Management", 5), target("Thermodynamics", 4));
  if (context.contentId === "wh-c5-c6") {
    const role = selector(context, "role").toLowerCase();
    if (role.includes("capital")) contextTargets.push(target("Capital Ships", 4), target("Jump Drive Operation", 5));
    if (role.includes("marauder")) fitHints.push("bastion module");
  }

  if (context.contentId === "dreadnought") {
    const role = selector(context, "role").toLowerCase();
    if (role.includes("structure")) fitHints.push("siege module", "capital weapon");
    if (role.includes("pve")) fitHints.push("siege module", "capital repair", "capital shield booster");
    if (role.includes("anti-capital")) fitHints.push("siege module", "capital weapon");
  }
  if (context.contentId === "carrier") {
    const role = selector(context, "role").toLowerCase();
    if (role.includes("support")) fitHints.push("networked sensor array", "command burst");
    else fitHints.push("fighter support unit", "networked sensor array");
  }
  if (context.contentId === "fax") {
    const role = selector(context, "role").toLowerCase();
    if (role.includes("armor")) fitHints.push("triage module", "capital remote armor");
    if (role.includes("shield")) fitHints.push("triage module", "capital shield emission");
  }
  if (context.contentId === "jump-freighter") {
    contextTargets.push(target("Jump Fuel Conservation", 4));
    if (selector(context, "route").toLowerCase().includes("null")) masteryTargets.push(target("Jump Fuel Conservation", 5));
  }
  if (context.contentId === "rorqual") {
    const role = selector(context, "role").toLowerCase();
    if (role.includes("boost") || role.includes("mining")) fitHints.push("mining foreman burst", "compressor", "industrial core");
    if (role.includes("defensive")) fitHints.push("shield", "panic");
  }

  const includeHull = !(model === "industry" || model === "trading" || model === "general");
  const includeFit = includeHull;
  return {
    model,
    includeHull,
    includeFit,
    weights: weights[model],
    contextTargets: dedupeTargets(contextTargets),
    masteryTargets: dedupeTargets(masteryTargets),
    fitHints: [...new Set(fitHints.map((item) => item.toLowerCase()))],
    roleLabel,
  };
}

export function contextualHullCompatibility(hull: string, context: ActivityContext) {
  if (context.contentId === "missions-burner") {
    const family = selector(context, "family").toLowerCase();
    const frigates = new Set(["Daredevil", "Garmur", "Nergal", "Hawk", "Vengeance", "Retribution"]);
    const cruisers = new Set(["Deimos", "Vagabond", "Cerberus", "Sacrilege"]);
    if ((family.includes("agent") || family.includes("team")) && !frigates.has(hull))
      return { compatible: false, reason: hull + " is not in Sage's Burner Agent/Team frigate route for the selected family." };
    if (family.includes("base") && !cruisers.has(hull))
      return { compatible: false, reason: hull + " is not in Sage's Burner Base cruiser route for the selected family." };
  }

  const role = selector(context, "role").toLowerCase();
  if (context.activityId === "incursions" && role) {
    const logistics = new Set(["Basilisk", "Scimitar", "Guardian", "Oneiros"]);
    if (role.includes("logistics") && !logistics.has(hull))
      return { compatible: false, reason: `${hull} is not a logistics hull for the selected incursion role.` };
    if (!role.includes("logistics") && logistics.has(hull))
      return { compatible: false, reason: `${hull} is a logistics hull while a damage role is selected.` };
  }
  return { compatible: true as const };
}

export function buildMasteryTargets(
  core: ExplicitSkillTarget[],
  support: ExplicitSkillTarget[],
  rule: ContextRule,
) {
  const raised = [...core, ...support, ...rule.contextTargets].map((item) => ({
    skill: item.skill,
    level: Math.min(5, item.level + (item.level < 4 ? 1 : 0)),
  }));
  return dedupeTargets([...raised, ...rule.masteryTargets]);
}

function dedupeTargets(targets: ExplicitSkillTarget[]) {
  const map = new Map<string, ExplicitSkillTarget>();
  for (const item of targets) {
    const current = map.get(item.skill.toLowerCase());
    if (!current || current.level < item.level) map.set(item.skill.toLowerCase(), item);
  }
  return [...map.values()];
}
