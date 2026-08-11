import type { CharacterSnapshot, SkillDetail } from "./types";

export type SkillImpact = {
  summary: string;
  bonuses: string[];
  ships: string[];
  modules: string[];
  activities: string[];
};

export type SkillTrainingState = {
  queued: boolean;
  queuedLevel?: number;
  queuedFinishDate?: string;
  trainingNow: boolean;
};

const exact: Record<string, Partial<SkillImpact>> = {
  "CPU Management": {
    summary: "Core fitting skill that improves the CPU available on every ship.",
    bonuses: ["More ship CPU for fitting modules"],
    ships: ["All ships"],
    modules: ["CPU-constrained fittings"],
    activities: ["PvE", "PvP", "Mining", "Exploration", "Hauling"],
  },
  "Power Grid Management": {
    summary: "Core fitting skill that improves the powergrid available on every ship.",
    bonuses: ["More ship powergrid for fitting modules"],
    ships: ["All ships"],
    modules: ["Powergrid-constrained fittings"],
    activities: ["PvE", "PvP", "Mining", "Exploration", "Hauling"],
  },
  "Weapon Upgrades": {
    summary: "Reduces fitting pressure from weapon systems and supports stronger combat fits.",
    bonuses: ["Lower weapon fitting requirements"],
    ships: ["Weapon-based combat ships"],
    modules: ["Turrets", "Launchers", "Weapon upgrade modules"],
    activities: ["PvE", "PvP", "Faction Warfare", "Incursions"],
  },
  "Advanced Weapon Upgrades": {
    summary: "Advanced fitting support for weapon-heavy ships and high-end combat fits.",
    bonuses: ["Further reduces weapon powergrid pressure"],
    ships: ["Weapon-based combat ships"],
    modules: ["Turrets", "Launchers"],
    activities: ["PvE", "PvP", "Faction Warfare", "Incursions"],
  },
  Drones: {
    summary: "Foundation skill for drone use and the prerequisite chain for advanced drone systems.",
    bonuses: ["Unlocks broader drone capability as trained"],
    ships: ["Drone-capable ships"],
    modules: ["Combat drones", "Mining drones", "Drone support modules"],
    activities: ["PvE", "PvP", "Mining", "Exploration"],
  },
  "Drone Interfacing": {
    summary: "Major support skill for characters whose damage or utility depends on drones.",
    bonuses: ["Improves drone combat and mining effectiveness"],
    ships: ["Drone-focused ships", "Mining ships"],
    modules: ["Combat drones", "Mining drones"],
    activities: ["PvE", "PvP", "Mining", "Null-sec ratting"],
  },
  "Capacitor Management": {
    summary: "Improves the ship capacitor pool and benefits almost every active fit.",
    bonuses: ["Larger capacitor reserve"],
    ships: ["All capacitor-using ships"],
    modules: ["Repairers", "Boosters", "Propulsion", "Energy weapons", "EWAR"],
    activities: ["PvE", "PvP", "Exploration", "Incursions"],
  },
  "Capacitor Systems Operation": {
    summary: "Improves capacitor recovery and sustained operation of active modules.",
    bonuses: ["Faster capacitor recharge"],
    ships: ["All capacitor-using ships"],
    modules: ["Active tank", "Propulsion", "Energy warfare", "Energy weapons"],
    activities: ["PvE", "PvP", "Exploration", "Incursions"],
  },
  Navigation: {
    summary: "Core mobility skill supporting travel, positioning and speed-tanking.",
    bonuses: ["Improves basic ship velocity"],
    ships: ["All ships"],
    modules: ["Afterburners", "Microwarpdrives"],
    activities: ["PvE", "PvP", "Exploration", "Hauling", "Faction Warfare"],
  },
  Mining: {
    summary: "Foundation resource-harvesting skill for mining lasers and mining progression.",
    bonuses: ["Improves mining capability"],
    ships: ["Venture", "Mining barges", "Exhumers", "Industrial command ships"],
    modules: ["Mining lasers", "Strip miners"],
    activities: ["Mining", "Industry"],
  },
  Industry: {
    summary: "Foundation production skill used throughout manufacturing progression.",
    bonuses: ["Improves manufacturing workflow and unlocks industrial prerequisites"],
    ships: ["Industrial progression"],
    modules: ["Manufactured items and components"],
    activities: ["Industry", "Manufacturing", "Research"],
  },
  Astrometrics: {
    summary: "Foundation probe-scanning skill for finding cosmic signatures and exploration content.",
    bonuses: ["Improves scanning capability and unlocks advanced scanning support"],
    ships: ["Exploration frigates", "Covert Ops", "Astero", "Strategic cruisers"],
    modules: ["Probe launchers", "Scan probes"],
    activities: ["Exploration", "Wormholes", "PvP scouting"],
  },
  Hacking: {
    summary: "Data-site access skill used to operate data analyzers successfully.",
    bonuses: ["Improves data-site hacking capability"],
    ships: ["Exploration ships"],
    modules: ["Data analyzers"],
    activities: ["Exploration", "Homefront Operations"],
  },
  Archaeology: {
    summary: "Relic-site access skill used to operate relic analyzers successfully.",
    bonuses: ["Improves relic-site hacking capability"],
    ships: ["Exploration ships"],
    modules: ["Relic analyzers"],
    activities: ["Exploration", "Wormholes"],
  },
  Trade: {
    summary: "Core market skill that expands a character's ability to maintain market orders.",
    bonuses: ["Supports additional market-order capacity"],
    ships: ["Any trading character"],
    modules: ["Market orders"],
    activities: ["Trading", "Hauling", "Industry"],
  },
};

const unique = (items: string[]) => [...new Set(items)];

export function describeSkill(skill: SkillDetail): SkillImpact {
  const name = skill.name ?? `Skill ${skill.skill_id}`;
  const known = exact[name] ?? {};
  const bonuses = [...(known.bonuses ?? [])];
  const ships = [...(known.ships ?? [])];
  const modules = [...(known.modules ?? [])];
  const activities = [...(known.activities ?? [])];
  let summary = known.summary ?? "Specialist capsuleer skill. Its value depends on the ships, modules and activities that require it.";

  if (/Frigate|Destroyer|Cruiser|Battlecruiser|Battleship|Industrial|Barge|Exhumers|Command Ships|Covert Ops|Interceptors|Logistics|Transport Ships/i.test(name)) {
    ships.push(name.replace(/ skill$/i, ""));
    activities.push("Ship progression");
    bonuses.push("Improves access to or performance of the associated ship class");
    summary = known.summary ?? `Ship-command progression skill for ${name}.`;
  }
  if (/Drone/i.test(name)) {
    ships.push("Drone-capable ships");
    modules.push("Drones", "Drone support modules");
    activities.push("PvE", "PvP");
  }
  if (/Missile|Rocket|Torpedo|Launcher/i.test(name)) {
    ships.push("Missile ships");
    modules.push("Missile launchers", "Missiles");
    activities.push("PvE", "PvP");
  }
  if (/Gunnery|Turret|Blaster|Railgun|Projectile|Artillery|Autocannon|Laser|Pulse|Beam/i.test(name)) {
    ships.push("Turret ships");
    modules.push("Turrets", "Weapon upgrades");
    activities.push("PvE", "PvP");
  }
  if (/Shield/i.test(name)) {
    ships.push("Shield-tanked ships");
    modules.push("Shield modules");
    activities.push("PvE", "PvP", "Incursions");
  }
  if (/Armor|Armour|Hull Upgrades|Mechanics|Repair/i.test(name)) {
    ships.push("Armor-tanked ships");
    modules.push("Armor modules", "Repair modules");
    activities.push("PvE", "PvP");
  }
  if (/Mining|Astrogeology|Reprocessing|Ore/i.test(name)) {
    ships.push("Mining ships");
    modules.push("Mining and reprocessing equipment");
    activities.push("Mining", "Industry");
  }
  if (/Science|Research|Invention|Laboratory|Mass Production|Supply Chain|Advanced Industry/i.test(name)) {
    activities.push("Industry", "Manufacturing", "Research");
    modules.push("Blueprint and production workflows");
  }
  if (/Trade|Accounting|Broker|Marketing|Daytrading|Retail|Wholesale/i.test(name)) {
    activities.push("Trading", "Hauling");
    modules.push("Market orders");
  }
  if (/Astrometric|Hacking|Archaeology|Cloaking/i.test(name)) {
    ships.push("Exploration ships");
    activities.push("Exploration", "Wormholes");
  }

  return {
    summary,
    bonuses: unique(bonuses.length ? bonuses : ["Supports skills, modules or ships that depend on this prerequisite"]),
    ships: unique(ships.length ? ships : ["Ships whose requirements include this skill"]),
    modules: unique(modules.length ? modules : ["Modules whose requirements include this skill"]),
    activities: unique(activities.length ? activities : ["General progression"]),
  };
}

export function getSkillTrainingState(snapshot: CharacterSnapshot, skill: SkillDetail): SkillTrainingState {
  const queueEntries = snapshot.queue.filter((item) => item.skill_id === skill.skill_id);
  const queued = queueEntries.length > 0;
  const first = queueEntries[0];
  const trainingNow = Boolean(first?.finish_date) && new Date(first.finish_date!).getTime() > Date.now();
  return {
    queued,
    queuedLevel: first?.finished_level,
    queuedFinishDate: first?.finish_date,
    trainingNow,
  };
}

export type ReadinessSkillCategory = {
  id: string;
  label: string;
  description: string;
  order: number;
};

const readinessCategory = (id: string, label: string, description: string, order: number): ReadinessSkillCategory => ({ id, label, description, order });

export function categorizeReadinessSkill(name: string): ReadinessSkillCategory {
  const value = name.toLowerCase();

  if (/spaceship command|frigate|destroyer|cruiser|battlecruiser|battleship|industrial|transport ships|freighter|mining barge|exhumers|covert ops|interceptors|interdictors|command destroyers|tactical destroyers|heavy assault cruisers|heavy interdictors|recon ships|logistics cruisers|strategic cruiser|marauders|black ops|capital ships|dreadnought|carrier|industrial command ships/.test(value))
    return readinessCategory("hull", "Hull & ship command", "Skills that unlock or improve the selected hull class and its ship-command prerequisites.", 10);

  if (/drone|fighter/.test(value))
    return readinessCategory("drones", "Drones & fighters", "Drone and fighter operation, damage, control range, durability and application.", 30);

  if (/missile|rocket|torpedo|gunnery|turret|blaster|railgun|projectile|artillery|autocannon|laser|pulse|beam|weapon specialization|rapid firing|surgical strike|motion prediction|sharpshooter|trajectory analysis|controlled bursts/.test(value))
    return readinessCategory("weapons", "Weapons & damage", "Weapon operation plus damage, rate-of-fire, range and application support.", 25);

  if (/shield|armor|armour|hull upgrades|mechanics|repair systems|damage control|compensation/.test(value))
    return readinessCategory("tank", "Tank & survivability", "Shield, armour, hull and repair skills needed to survive the selected content or fit.", 40);

  if (/capacitor|cpu management|power grid management|weapon upgrades|advanced weapon upgrades|energy grid upgrades|thermodynamics/.test(value))
    return readinessCategory("fitting", "Fitting, capacitor & heat", "CPU, powergrid, capacitor and overheating support that makes the complete fit practical.", 20);

  if (/navigation|afterburner|acceleration control|evasive maneuvering|high speed maneuvering|warp drive operation|fuel conservation|jump drive|micro jump/.test(value))
    return readinessCategory("navigation", "Navigation & mobility", "Speed, agility, propulsion, warp and jump skills used for positioning and travel.", 50);

  if (/propulsion jamming|electronic warfare|ecm|sensor linking|weapon disruption|target painting|long range targeting|signature analysis|target management|sensor compensation/.test(value))
    return readinessCategory("ewar", "Targeting, tackle & EWAR", "Locking, tackle and electronic-control skills required by the selected combat role.", 60);

  if (/logistics|remote armor|remote armour|shield emission|capacitor emission|leadership|command burst|warfare link|mining foreman|mining director/.test(value))
    return readinessCategory("fleet", "Logistics & fleet support", "Remote support, command and fleet-boosting skills used by specialist roles.", 70);

  if (/astrometric|hacking|archaeology|cloaking|survey|scanning/.test(value))
    return readinessCategory("exploration", "Scanning, hacking & covert", "Probe scanning, hacking and covert-operation skills used for exploration and wormholes.", 80);

  if (/mining|astrogeology|ice harvesting|gas cloud harvesting|reprocessing|industry|science|research|invention|mass production|laboratory|planet management|planetology/.test(value))
    return readinessCategory("industry", "Mining & industry", "Harvesting, processing and industrial skills that drive resource and production activities.", 90);

  return readinessCategory("support", "Other support skills", "Additional prerequisites or specialist support skills required by the selected route.", 100);
}
