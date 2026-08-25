export type ActivitySkillTarget = {
  skill: string;
  level: number;
};

export type ActivitySelector = {
  id: string;
  label: string;
  options: string[];
};

export type ActivityShipRoute = {
  shipClass: string;
  roles?: string[];
  engagements?: string[];
  ships: string[];
};

export type ActivityContent = {
  id: string;
  label: string;
  description: string;
  difficulty: "Beginner" | "Intermediate" | "Advanced" | "Expert";
  experience: string;
  ships: string[];
  coreSkills: ActivitySkillTarget[];
  supportSkills: ActivitySkillTarget[];
  incomeHooks: string[];
  selectors?: ActivitySelector[];
  shipRoutes?: ActivityShipRoute[];
  notes?: string[];
};

export type ActivitySubcategory = {
  id: string;
  label: string;
  description: string;
  content: ActivityContent[];
};

export type ActivityDefinition = {
  id: string;
  label: string;
  description: string;
  subcategories: ActivitySubcategory[];
};

const core = {
  fitting: [
    { skill: "CPU Management", level: 5 },
    { skill: "Power Grid Management", level: 5 },
    { skill: "Weapon Upgrades", level: 4 },
  ],
  navigation: [
    { skill: "Navigation", level: 4 },
    { skill: "Evasive Maneuvering", level: 4 },
    { skill: "Warp Drive Operation", level: 4 },
  ],
  capacitor: [
    { skill: "Capacitor Management", level: 4 },
    { skill: "Capacitor Systems Operation", level: 4 },
  ],
  drones: [
    { skill: "Drones", level: 5 },
    { skill: "Drone Interfacing", level: 4 },
    { skill: "Drone Navigation", level: 4 },
  ],
};

export const activityDefinitions: ActivityDefinition[] = [
  {
    id: "pve",
    label: "PvE",
    description: "Missions, Abyss, anomalies, escalations and repeatable combat income.",
    subcategories: [
      {
        id: "missions",
        label: "Security Missions",
        description: "Agent PvE progression with bounties, rewards and loyalty points.",
        content: [
          {
            id: "missions-l1-l2",
            label: "Level 1–2 missions",
            description: "Entry-level mission running while learning damage types, range control and basic tanking.",
            difficulty: "Beginner",
            experience: "New capsuleer or returning pilot learning PvE fundamentals.",
            ships: ["Cormorant", "Caracal", "Vexor", "Arbitrator", "Rupture"],
            coreSkills: [...core.fitting.slice(0, 2), ...core.navigation.slice(0, 2)],
            supportSkills: [{ skill: "Target Management", level: 3 }, { skill: "Social", level: 3 }],
            incomeHooks: ["Mission rewards", "Bounties", "Loyalty points", "Loot and salvage"],
          },
          {
            id: "missions-l3",
            label: "Level 3 missions",
            description: "Battlecruiser and strong cruiser PvE with better tank, application and sustained damage.",
            difficulty: "Intermediate",
            experience: "Comfortable with active/passive tanking and mission trigger awareness.",
            ships: ["Drake", "Myrmidon", "Hurricane", "Harbinger", "Gila"],
            coreSkills: [...core.fitting, ...core.capacitor],
            supportSkills: [{ skill: "Target Management", level: 4 }, { skill: "Weapon Upgrades", level: 4 }, { skill: "Drones", level: 4 }],
            incomeHooks: ["Mission rewards", "Bounties", "Loyalty points", "Salvage"],
          },
          {
            id: "missions-l4",
            label: "Level 4 missions",
            description: "High-end high-sec missions focused on battleship-class damage, tank and application.",
            difficulty: "Advanced",
            experience: "Experienced mission runner who understands triggers, damage profiles and capacitor management.",
            ships: ["Raven", "Dominix", "Machariel", "Rattlesnake", "Paladin"],
            coreSkills: [...core.fitting, ...core.capacitor],
            supportSkills: [{ skill: "Advanced Weapon Upgrades", level: 4 }, { skill: "Long Range Targeting", level: 4 }, { skill: "Signature Analysis", level: 4 }],
            incomeHooks: ["Mission rewards", "Bounties", "Loyalty points", "Faction/mission loot"],
          },
          {
            id: "missions-burner",
            label: "Burner / Anomic missions",
            description: "Specialized high-difficulty mission encounters where the exact family, hull class, fitting and execution matter far more than normal mission progression.",
            difficulty: "Expert",
            experience: "Experienced Level 4 mission runner comfortable with specialized fits, overheating, range control and encounter-specific damage profiles.",
            ships: ["Daredevil", "Garmur", "Nergal", "Hawk", "Vengeance", "Retribution", "Deimos", "Vagabond", "Cerberus", "Sacrilege"],
            coreSkills: [...core.fitting, ...core.navigation],
            supportSkills: [
              { skill: "Thermodynamics", level: 4 },
              { skill: "Advanced Weapon Upgrades", level: 4 },
              { skill: "Propulsion Jamming", level: 4 },
              { skill: "Signature Analysis", level: 4 },
            ],
            incomeHooks: ["Mission rewards", "Loyalty points", "Bounties where applicable", "Encounter loot"],
            selectors: [
              { id: "family", label: "Encounter family", options: ["Anomic Agent", "Anomic Team", "Anomic Base"] },
            ],
            notes: ["Burner encounters are highly specialized. Sage treats the family selector as a real readiness input and rejects obviously mismatched hull classes rather than averaging every Burner route together."],
          },
        ],
      },
      {
        id: "abyss",
        label: "Abyssal Deadspace",
        description: "Timed instanced PvE where hull choice, weather, application and tank are tightly linked.",
        content: [
          {
            id: "abyss-cruiser",
            label: "Cruiser Abyss",
            description: "Solo cruiser Abyss with tier and weather selection. Higher tiers demand stronger fitting, piloting and implants/consumables.",
            difficulty: "Advanced",
            experience: "Know spawn priority, weather effects, manual piloting and failure conditions before pushing higher tiers.",
            ships: ["Gila", "Cerberus", "Sacrilege", "Ishtar", "Vagabond"],
            coreSkills: [...core.fitting, ...core.capacitor, ...core.navigation],
            supportSkills: [...core.drones, { skill: "Thermodynamics", level: 4 }],
            incomeHooks: ["Abyssal loot cache", "Triglavian materials", "Mutaplasmids", "Filaments"],
            selectors: [
              { id: "tier", label: "Tier", options: ["T0 Tranquil", "T1 Calm", "T2 Agitated", "T3 Fierce", "T4 Raging", "T5 Chaotic", "T6 Cataclysmic"] },
              { id: "weather", label: "Weather", options: ["Electrical", "Exotic", "Gamma", "Dark", "Firestorm"] },
            ],
            notes: ["Treat T4+ as a separate fitting and piloting threshold; a hull being flyable does not mean the fit is safe for that tier."],
          },
          {
            id: "abyss-destroyer",
            label: "Destroyer Abyss",
            description: "Small-hull Abyss progression for pilots who prefer speed, lower hull cost and tighter execution.",
            difficulty: "Intermediate",
            experience: "Comfortable with manual piloting and target priority under a timer.",
            ships: ["Jackdaw", "Confessor", "Hecate", "Svipul"],
            coreSkills: [...core.fitting, ...core.navigation],
            supportSkills: [{ skill: "Thermodynamics", level: 4 }, { skill: "Acceleration Control", level: 4 }],
            incomeHooks: ["Abyssal loot cache", "Triglavian materials", "Mutaplasmids"],
            selectors: [
              { id: "tier", label: "Tier", options: ["T0 Tranquil", "T1 Calm", "T2 Agitated", "T3 Fierce", "T4 Raging", "T5 Chaotic", "T6 Cataclysmic"] },
              { id: "weather", label: "Weather", options: ["Electrical", "Exotic", "Gamma", "Dark", "Firestorm"] },
            ],
          },
          {
            id: "abyss-frigate",
            label: "Frigate Abyss",
            description: "Frigate Abyss for solo challenge or coordinated multi-pilot runs.",
            difficulty: "Advanced",
            experience: "Strong frigate piloting and a clear understanding of spawn threats and range control.",
            ships: ["Hawk", "Retribution", "Worm", "Nergal"],
            coreSkills: [...core.fitting, ...core.navigation],
            supportSkills: [{ skill: "Thermodynamics", level: 4 }, { skill: "Signature Analysis", level: 4 }],
            incomeHooks: ["Abyssal loot cache", "Triglavian materials", "Mutaplasmids"],
            selectors: [
              { id: "tier", label: "Tier", options: ["T0 Tranquil", "T1 Calm", "T2 Agitated", "T3 Fierce", "T4 Raging", "T5 Chaotic", "T6 Cataclysmic"] },
              { id: "weather", label: "Weather", options: ["Electrical", "Exotic", "Gamma", "Dark", "Firestorm"] },
            ],
          },
        ],
      },
      {
        id: "anomalies",
        label: "Anomalies & Escalations",
        description: "Open-space PvE from combat anomalies through escalations and DED sites.",
        content: [
          {
            id: "highsec-combat-sites",
            label: "High-sec combat sites",
            description: "Low-friction anomaly and combat-site running with escalation chances.",
            difficulty: "Beginner",
            experience: "Basic PvE awareness and scanning knowledge are enough to start.",
            ships: ["Vexor", "Caracal", "Gnosis", "Gila"],
            coreSkills: [...core.fitting.slice(0, 2), ...core.navigation.slice(0, 2)],
            supportSkills: [{ skill: "Drones", level: 4 }, { skill: "Astrometrics", level: 3 }],
            incomeHooks: ["Bounties", "Faction/deadspace drops", "Escalations", "Loot"],
          },
          {
            id: "nullsec-ratting",
            label: "Null-sec anomaly ratting",
            description: "Sustained anomaly farming with stronger income potential and much higher player risk.",
            difficulty: "Advanced",
            experience: "Comfortable with intel channels, safe spots, local/d-scan and loss replacement.",
            ships: ["Ishtar", "Dominix", "Myrmidon", "Gila", "Vargur"],
            coreSkills: [...core.fitting, ...core.drones],
            supportSkills: [...core.navigation, { skill: "Thermodynamics", level: 4 }],
            incomeHooks: ["Bounties", "ESS payouts", "Faction spawns", "Escalations"],
          },
          {
            id: "ded-escalations",
            label: "DED sites & escalations",
            description: "Higher-value combat exploration where site rating, damage profile and travel risk matter.",
            difficulty: "Advanced",
            experience: "Experienced PvE pilot with scanning, travel safety and site-specific knowledge.",
            ships: ["Gila", "Ishtar", "Tengu", "Loki", "Proteus"],
            coreSkills: [...core.fitting, ...core.capacitor],
            supportSkills: [{ skill: "Astrometrics", level: 4 }, { skill: "Cloaking", level: 4 }, { skill: "Thermodynamics", level: 4 }],
            incomeHooks: ["Deadspace modules", "Faction loot", "Bounties", "Escalation rewards"],
            selectors: [
              { id: "rating", label: "DED / escalation level", options: ["4/10", "5/10", "6/10", "7/10", "8/10", "9/10", "10/10"] },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "pvp",
    label: "PvP",
    description: "Solo, small-gang, fleet and specialist combat progression.",
    subcategories: [
      {
        id: "solo-smallgang",
        label: "Solo & Small Gang",
        description: "Choose the engagement, combat role and hull class you actually want to fly.",
        content: [
          {
            id: "pvp-roaming",
            label: "Roaming / skirmish PvP",
            description: "Context-driven PvP progression across frigates through battleships, with role and engagement style changing the recommended hulls and readiness targets.",
            difficulty: "Intermediate",
            experience: "Basic fitting knowledge, manual piloting and willingness to learn matchups through repeated fights.",
            ships: ["Rifter", "Tristan", "Kestrel", "Caracal", "Stabber", "Hurricane", "Drake", "Tempest"],
            coreSkills: [...core.fitting, ...core.navigation],
            supportSkills: [
              { skill: "Thermodynamics", level: 4 },
              { skill: "Propulsion Jamming", level: 4 },
              { skill: "Signature Analysis", level: 4 },
            ],
            incomeHooks: ["Loot from kills", "Faction Warfare LP when combined with FW"],
            selectors: [
              { id: "engagement", label: "Engagement", options: ["Solo", "Small gang"] },
              { id: "role", label: "PvP role", options: ["Damage / combat", "Tackle", "EWAR / control", "Support / utility"] },
              { id: "shipClass", label: "Ship class", options: ["Frigate", "Destroyer", "Cruiser", "Battlecruiser", "Battleship"] },
              { id: "style", label: "Fighting style", options: ["Brawl", "Scram-kite", "Kite", "Projection"] },
            ],
            shipRoutes: [
              { shipClass: "Frigate", roles: ["Damage / combat"], ships: ["Rifter", "Tristan", "Kestrel", "Punisher", "Merlin", "Incursus", "Breacher", "Tormentor", "Caldari Navy Hookbill", "Federation Navy Comet", "Republic Fleet Firetail", "Imperial Navy Slicer"] },
              { shipClass: "Frigate", roles: ["Tackle"], ships: ["Atron", "Executioner", "Slasher", "Condor", "Malediction", "Stiletto", "Crow", "Ares"] },
              { shipClass: "Frigate", roles: ["EWAR / control"], ships: ["Griffin", "Maulus", "Crucifier", "Vigil", "Keres", "Kitsune", "Sentinel", "Hyena"] },
              { shipClass: "Frigate", roles: ["Support / utility"], ships: ["Navitas", "Bantam", "Burst", "Inquisitor", "Deacon", "Kirin", "Thalia", "Scalpel"] },
              { shipClass: "Destroyer", roles: ["Damage / combat"], ships: ["Thrasher", "Catalyst", "Coercer", "Cormorant", "Hecate", "Jackdaw", "Confessor", "Svipul", "Kikimora"] },
              { shipClass: "Destroyer", roles: ["Tackle"], ships: ["Sabre", "Flycatcher", "Heretic", "Eris", "Stork", "Bifrost"] },
              { shipClass: "Destroyer", roles: ["EWAR / control", "Support / utility"], ships: ["Stork", "Bifrost", "Pontifex", "Magus"] },
              { shipClass: "Cruiser", roles: ["Damage / combat"], ships: ["Caracal", "Vexor", "Omen", "Stabber", "Thorax", "Moa", "Rupture", "Osprey Navy Issue", "Exequror Navy Issue", "Omen Navy Issue", "Stabber Fleet Issue", "Orthrus", "Vagabond", "Cynabal", "Deimos"] },
              { shipClass: "Cruiser", roles: ["Tackle"], ships: ["Stabber", "Thorax", "Lachesis", "Huginn", "Rapier", "Arazu", "Curse"] },
              { shipClass: "Cruiser", roles: ["EWAR / control"], ships: ["Blackbird", "Celestis", "Arbitrator", "Bellicose", "Falcon", "Arazu", "Curse", "Huginn", "Keres"] },
              { shipClass: "Cruiser", roles: ["Support / utility"], ships: ["Scimitar", "Basilisk", "Guardian", "Oneiros", "Osprey", "Exequror", "Augoror", "Scythe"] },
              { shipClass: "Battlecruiser", roles: ["Damage / combat"], ships: ["Drake", "Hurricane", "Harbinger", "Brutix", "Ferox", "Cyclone", "Prophecy", "Myrmidon", "Naga", "Tornado", "Oracle", "Talos"] },
              { shipClass: "Battlecruiser", roles: ["Tackle", "EWAR / control"], ships: ["Hurricane", "Cyclone", "Prophecy", "Gnosis", "Claymore", "Damnation"] },
              { shipClass: "Battlecruiser", roles: ["Support / utility"], ships: ["Claymore", "Damnation", "Eos", "Vulture", "Gnosis"] },
              { shipClass: "Battleship", roles: ["Damage / combat"], ships: ["Megathron", "Tempest", "Raven", "Apocalypse", "Typhoon", "Dominix", "Hyperion", "Rokh", "Maelstrom", "Leshak", "Barghest", "Machariel", "Nightmare"] },
              { shipClass: "Battleship", roles: ["Tackle", "EWAR / control"], ships: ["Bhaalgorn", "Armageddon", "Scorpion", "Typhoon", "Barghest"] },
              { shipClass: "Battleship", roles: ["Support / utility"], ships: ["Nestor", "Armageddon", "Scorpion", "Bhaalgorn"] },
            ],
            notes: ["Ship class and PvP role are readiness inputs, not presentation filters. Changing either changes the hull pool, fitting evidence and contextual skill targets."],
          },
        ],
      },
      {
        id: "fleet",
        label: "Fleet PvP",
        description: "Doctrine combat with selectable fleet role and hull class rather than one fixed five-ship list.",
        content: [
          {
            id: "fleet-roles",
            label: "Fleet roles",
            description: "Choose the job you intend to perform, then compare the hull classes commonly used for that job.",
            difficulty: "Advanced",
            experience: "Comfortable following broadcasts, anchoring, range discipline and fleet movement commands.",
            ships: ["Ferox", "Hurricane", "Cerberus", "Scimitar", "Basilisk", "Malediction", "Stiletto"],
            coreSkills: [...core.fitting, ...core.navigation],
            supportSkills: [
              { skill: "Thermodynamics", level: 4 },
              { skill: "Long Range Targeting", level: 4 },
              { skill: "Signature Analysis", level: 4 },
            ],
            incomeHooks: ["Alliance/corp SRP where offered", "Loot where doctrine permits"],
            selectors: [
              { id: "role", label: "Fleet role", options: ["Line DPS", "Tackle", "EWAR / control", "Logistics", "Command / links"] },
              { id: "shipClass", label: "Ship class", options: ["Frigate", "Destroyer", "Cruiser", "Battlecruiser", "Battleship"] },
              { id: "style", label: "Doctrine range", options: ["Brawl", "Mid-range", "Long-range"] },
            ],
            shipRoutes: [
              { shipClass: "Frigate", roles: ["Line DPS"], ships: ["Harpy", "Retribution", "Wolf", "Enyo", "Caldari Navy Hookbill", "Federation Navy Comet"] },
              { shipClass: "Frigate", roles: ["Tackle"], ships: ["Malediction", "Stiletto", "Crow", "Ares", "Atron", "Condor"] },
              { shipClass: "Frigate", roles: ["EWAR / control"], ships: ["Keres", "Kitsune", "Sentinel", "Hyena", "Griffin", "Maulus"] },
              { shipClass: "Frigate", roles: ["Logistics"], ships: ["Deacon", "Kirin", "Thalia", "Scalpel", "Navitas", "Bantam", "Burst", "Inquisitor"] },
              { shipClass: "Destroyer", roles: ["Line DPS"], ships: ["Thrasher", "Cormorant", "Coercer", "Catalyst", "Kikimora", "Jackdaw", "Confessor"] },
              { shipClass: "Destroyer", roles: ["Tackle"], ships: ["Sabre", "Flycatcher", "Heretic", "Eris"] },
              { shipClass: "Destroyer", roles: ["EWAR / control", "Command / links"], ships: ["Stork", "Bifrost", "Pontifex", "Magus"] },
              { shipClass: "Cruiser", roles: ["Line DPS"], ships: ["Cerberus", "Muninn", "Zealot", "Eagle", "Omen Navy Issue", "Caracal", "Orthrus", "Deimos"] },
              { shipClass: "Cruiser", roles: ["Tackle"], ships: ["Lachesis", "Huginn", "Rapier", "Arazu"] },
              { shipClass: "Cruiser", roles: ["EWAR / control"], ships: ["Falcon", "Arazu", "Curse", "Huginn", "Blackbird", "Celestis"] },
              { shipClass: "Cruiser", roles: ["Logistics"], ships: ["Scimitar", "Basilisk", "Guardian", "Oneiros"] },
              { shipClass: "Battlecruiser", roles: ["Line DPS"], ships: ["Ferox", "Hurricane", "Drake", "Harbinger", "Naga", "Tornado", "Oracle", "Talos"] },
              { shipClass: "Battlecruiser", roles: ["Command / links"], ships: ["Claymore", "Damnation", "Eos", "Vulture"] },
              { shipClass: "Battlecruiser", roles: ["Tackle", "EWAR / control"], ships: ["Claymore", "Damnation", "Gnosis", "Hurricane"] },
              { shipClass: "Battleship", roles: ["Line DPS"], ships: ["Megathron", "Tempest", "Rokh", "Apocalypse", "Maelstrom", "Typhoon", "Leshak", "Machariel", "Nightmare"] },
              { shipClass: "Battleship", roles: ["EWAR / control", "Tackle"], ships: ["Scorpion", "Bhaalgorn", "Armageddon"] },
              { shipClass: "Battleship", roles: ["Logistics"], ships: ["Nestor"] },
              { shipClass: "Battleship", roles: ["Command / links"], ships: ["Armageddon", "Nestor"] },
            ],
            notes: ["Doctrine availability varies by corporation and alliance. Sage treats these as broad role routes; a supplied doctrine fit should override generic public evidence later in the fitting workflow."],
          },
        ],
      },
    ],
  },
  {
    id: "mining",
    label: "Mining",
    description: "Ore, ice, gas and fleet-support progression from Venture to Exhumers and command ships.",
    subcategories: [
      {
        id: "resource-harvesting",
        label: "Resource Harvesting",
        description: "Direct extraction of ore, ice and gas.",
        content: [
          {
            id: "ore-mining",
            label: "Ore mining",
            description: "Standard asteroid mining from entry-level solo work through exhumer fleets.",
            difficulty: "Beginner",
            experience: "No specialist experience required to start; yield and survival scale with skills.",
            ships: ["Venture", "Retriever", "Mackinaw", "Hulk"],
            coreSkills: [{ skill: "Mining", level: 5 }, { skill: "Astrogeology", level: 5 }, { skill: "Mining Barge", level: 4 }],
            supportSkills: [{ skill: "Mining Upgrades", level: 4 }, { skill: "Drones", level: 4 }, { skill: "Shield Management", level: 4 }],
            incomeHooks: ["Ore value", "Reprocessing value", "Compression/logistics efficiency"],
            selectors: [
              { id: "space", label: "Space", options: ["High-sec", "Low-sec", "Null-sec", "Wormhole"] },
              { id: "operation", label: "Operation", options: ["Solo", "Fleet boosted"] },
              { id: "priority", label: "Priority", options: ["Balanced", "Maximum yield", "Tanked"] },
            ],
          },
          {
            id: "ice-mining",
            label: "Ice harvesting",
            description: "Specialized ice-belt harvesting with cycle-time and cargo considerations.",
            difficulty: "Intermediate",
            experience: "Basic barge operation and awareness of predictable belt locations.",
            ships: ["Retriever", "Mackinaw", "Hulk"],
            coreSkills: [{ skill: "Ice Harvesting", level: 5 }, { skill: "Mining Barge", level: 4 }],
            supportSkills: [{ skill: "Mining Upgrades", level: 4 }, { skill: "Shield Management", level: 4 }],
            incomeHooks: ["Ice products", "Fuel-block demand", "Compression/logistics efficiency"],
            selectors: [
              { id: "operation", label: "Operation", options: ["Solo", "Fleet boosted"] },
              { id: "priority", label: "Priority", options: ["Balanced", "Maximum yield", "Tanked"] },
            ],
          },
          {
            id: "gas-huffing",
            label: "Gas harvesting",
            description: "Gas cloud harvesting for booster, reaction and wormhole supply chains.",
            difficulty: "Intermediate",
            experience: "Comfortable scanning signatures and operating in dangerous space.",
            ships: ["Venture", "Prospect"],
            coreSkills: [{ skill: "Gas Cloud Harvesting", level: 5 }, { skill: "Astrometrics", level: 3 }],
            supportSkills: [{ skill: "Cloaking", level: 4 }, { skill: "Evasive Maneuvering", level: 4 }],
            incomeHooks: ["Gas market value", "Reaction/booster inputs"],
            selectors: [
              { id: "space", label: "Space", options: ["Low-sec", "Wormhole"] },
              { id: "operation", label: "Operation", options: ["Solo", "Fleet"] },
            ],
          },
        ],
      },
      {
        id: "fleet-support",
        label: "Fleet Support",
        description: "Boosting, compression and mining-fleet logistics.",
        content: [
          {
            id: "mining-command",
            label: "Mining command & boosts",
            description: "Command bursts, compression and fleet support rather than pure personal yield.",
            difficulty: "Advanced",
            experience: "Experienced miner coordinating a fleet and managing expensive command hulls.",
            ships: ["Porpoise", "Orca"],
            coreSkills: [{ skill: "Mining Foreman", level: 5 }, { skill: "Mining Director", level: 5 }, { skill: "Leadership", level: 5 }],
            supportSkills: [{ skill: "Industrial Command Ships", level: 4 }, { skill: "Shield Management", level: 4 }, { skill: "Drone Interfacing", level: 4 }],
            incomeHooks: ["Fleet yield uplift", "Compression convenience", "Logistics efficiency"],
            selectors: [
              { id: "role", label: "Fleet role", options: ["Boosting", "Compression", "Balanced support"] },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "industry",
    label: "Industry",
    description: "Manufacturing, research, invention, reactions and planetary production.",
    subcategories: [
      {
        id: "manufacturing",
        label: "Manufacturing",
        description: "Blueprint-driven production from simple modules to ships and components.",
        content: [
          {
            id: "basic-manufacturing",
            label: "T1 manufacturing",
            description: "Straightforward blueprint production focused on material costs, facility fees and market demand.",
            difficulty: "Beginner",
            experience: "Basic understanding of blueprints, material efficiency and sell prices.",
            ships: ["Sunesis", "Epithal", "Miasmos", "Iteron Mark V"],
            coreSkills: [{ skill: "Industry", level: 5 }, { skill: "Mass Production", level: 4 }],
            supportSkills: [{ skill: "Advanced Industry", level: 4 }, { skill: "Supply Chain Management", level: 3 }, { skill: "Accounting", level: 4 }],
            incomeHooks: ["Build-vs-buy margin", "Blueprint efficiency", "Facility/system cost index", "Market demand"],
          },
          {
            id: "advanced-manufacturing",
            label: "T2 & advanced manufacturing",
            description: "Higher-complexity production using invention, advanced components and deeper material chains.",
            difficulty: "Advanced",
            experience: "Comfortable costing multi-stage production and managing invention variance.",
            ships: ["Viator", "Occator", "Orca"],
            coreSkills: [{ skill: "Advanced Industry", level: 5 }, { skill: "Advanced Mass Production", level: 4 }, { skill: "Science", level: 5 }],
            supportSkills: [{ skill: "Supply Chain Management", level: 4 }, { skill: "Accounting", level: 4 }],
            notes: ["Invention prerequisites are blueprint-specific: one racial Encryption Methods skill plus two science skills come from the selected invention activity. Sage Industry resolves those exact skills from the current SDE rather than pretending there is a universal Invention skill."],
            incomeHooks: ["T2 margin", "Invention cost", "Component chain efficiency", "Market shortages"],
          },
        ],
      },
      {
        id: "research-invention",
        label: "Research & Invention",
        description: "Improve blueprints, copy them and invent advanced variants.",
        content: [
          {
            id: "blueprint-research",
            label: "Blueprint research & copying",
            description: "ME/TE research and copying to improve production efficiency and feed invention.",
            difficulty: "Intermediate",
            experience: "Understands BPO/BPC differences and opportunity cost of research slots.",
            ships: ["Sunesis", "Viator"],
            coreSkills: [{ skill: "Science", level: 5 }, { skill: "Laboratory Operation", level: 5 }],
            supportSkills: [{ skill: "Advanced Laboratory Operation", level: 4 }, { skill: "Metallurgy", level: 4 }, { skill: "Scientific Networking", level: 4 }],
            incomeHooks: ["Improved material/time efficiency", "Copy sales/use", "Invention inputs"],
          },
          {
            id: "invention",
            label: "Invention",
            description: "Convert eligible T1 copies into T2 blueprint copies with datacores and optional decryptors.",
            difficulty: "Advanced",
            experience: "Comfortable with probability, datacore costs and downstream T2 production economics.",
            ships: ["Viator", "Occator"],
            coreSkills: [{ skill: "Science", level: 5 }, { skill: "Laboratory Operation", level: 5 }],
            supportSkills: [{ skill: "Advanced Laboratory Operation", level: 4 }],
            notes: ["This generic progression score covers universal research support only. Exact invention eligibility and success chance depend on the selected blueprint's racial Encryption Methods skill and two science skills; Sage Industry resolves those exact SDE requirements per blueprint."],
            incomeHooks: ["T2 BPC value", "Datacore/decryptor economics", "T2 manufacturing margin"],
          },
        ],
      },
      {
        id: "reactions-pi",
        label: "Reactions & PI",
        description: "Intermediate-material and passive-production chains.",
        content: [
          {
            id: "reactions",
            label: "Reactions",
            description: "Transform moon, gas and advanced materials through reaction formulas in suitable structures.",
            difficulty: "Advanced",
            experience: "Comfortable with logistics, structure access and multi-stage material costing.",
            ships: ["Viator", "Occator", "Orca"],
            coreSkills: [{ skill: "Reactions", level: 5 }, { skill: "Mass Reactions", level: 4 }],
            supportSkills: [{ skill: "Remote Reactions", level: 3 }, { skill: "Accounting", level: 4 }],
            incomeHooks: ["Reaction spread", "Moon/gas input pricing", "Structure fees", "Regional shortages"],
          },
          {
            id: "planetary-industry",
            label: "Planetary Industry",
            description: "Planet colonies producing P0–P4 materials with extraction and factory chains.",
            difficulty: "Intermediate",
            experience: "Comfortable balancing extraction cycles, hauling and factory layouts.",
            ships: ["Epithal", "Viator"],
            coreSkills: [{ skill: "Command Center Upgrades", level: 4 }, { skill: "Interplanetary Consolidation", level: 4 }],
            supportSkills: [{ skill: "Planetology", level: 4 }, { skill: "Advanced Planetology", level: 3 }, { skill: "Remote Sensing", level: 4 }],
            incomeHooks: ["P1–P4 market demand", "Tax rates", "Extraction quality", "Hauling efficiency"],
          },
        ],
      },
    ],
  },
  {
    id: "exploration",
    label: "Exploration",
    description: "Scanning, relic/data sites, combat exploration and covert travel.",
    subcategories: [
      {
        id: "scanning-sites",
        label: "Scanning & Sites",
        description: "Probe down signatures and extract value from relic/data/combat sites.",
        content: [
          {
            id: "relic-data",
            label: "Relic & data sites",
            description: "Scan signatures, hack containers and move safely through space with low startup cost.",
            difficulty: "Beginner",
            experience: "Basic probe scanning and safe-spot/d-scan habits.",
            ships: ["Heron", "Imicus", "Probe", "Magnate", "Astero", "Cheetah"],
            coreSkills: [{ skill: "Astrometrics", level: 4 }, { skill: "Hacking", level: 4 }, { skill: "Archaeology", level: 4 }],
            supportSkills: [{ skill: "Astrometric Rangefinding", level: 3 }, { skill: "Astrometric Pinpointing", level: 3 }, { skill: "Cloaking", level: 4 }],
            incomeHooks: ["Relic salvage", "Data-site materials", "Blueprints/decryptors"],
            selectors: [
              { id: "space", label: "Space", options: ["High-sec", "Low-sec", "Null-sec", "Wormhole"] },
              { id: "priority", label: "Priority", options: ["Scanning", "Hacking", "Travel safety"] },
            ],
          },
          {
            id: "combat-exploration",
            label: "Combat exploration",
            description: "Scan and run combat signatures/escalations for bounties and valuable deadspace/faction drops.",
            difficulty: "Advanced",
            experience: "Strong PvE skills plus safe travel and scanning discipline.",
            ships: ["Gila", "Tengu", "Loki", "Ishtar", "Stratios"],
            coreSkills: [{ skill: "Astrometrics", level: 4 }, ...core.fitting],
            supportSkills: [{ skill: "Cloaking", level: 4 }, { skill: "Thermodynamics", level: 4 }, ...core.navigation],
            incomeHooks: ["Deadspace modules", "Faction drops", "Bounties", "Escalations"],
            selectors: [
              { id: "space", label: "Space", options: ["High-sec", "Low-sec", "Null-sec", "Wormhole"] },
            ],
          },
        ],
      },
      {
        id: "covert-travel",
        label: "Covert Travel & Scouting",
        description: "Move, observe and scan while minimizing exposure.",
        content: [
          {
            id: "covert-scout",
            label: "Covert scouting",
            description: "Fast scanning, cloaked movement and route intelligence for personal or fleet use.",
            difficulty: "Intermediate",
            experience: "Comfortable with d-scan, bookmarks and gate-camp avoidance.",
            ships: ["Cheetah", "Anathema", "Buzzard", "Helios", "Astero"],
            coreSkills: [{ skill: "Astrometrics", level: 4 }, { skill: "Cloaking", level: 4 }, ...core.navigation],
            supportSkills: [{ skill: "Covert Ops", level: 4 }, { skill: "Astrometric Acquisition", level: 4 }, { skill: "Astrometric Pinpointing", level: 4 }],
            incomeHooks: ["Exploration finds", "Fleet/scouting utility"],
            selectors: [
              { id: "role", label: "Role", options: ["Personal exploration", "Fleet scout"] },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "trading",
    label: "Trading",
    description: "Station trading, regional arbitrage and market seeding.",
    subcategories: [
      {
        id: "market-trading",
        label: "Market Trading",
        description: "Use order placement, fees and market structure to earn margin.",
        content: [
          {
            id: "station-trading",
            label: "Station trading",
            description: "Buy and sell in the same hub by working spreads and turnover rather than hauling.",
            difficulty: "Intermediate",
            experience: "Comfortable reading order depth, fees, turnover and undercut risk.",
            ships: ["Sunesis", "Shuttle"],
            coreSkills: [{ skill: "Trade", level: 5 }, { skill: "Retail", level: 5 }, { skill: "Accounting", level: 4 }],
            supportSkills: [{ skill: "Broker Relations", level: 4 }, { skill: "Daytrading", level: 4 }, { skill: "Marketing", level: 4 }],
            incomeHooks: ["Bid/ask spread", "Turnover", "Fees/taxes", "Capital efficiency"],
          },
          {
            id: "regional-arbitrage",
            label: "Regional arbitrage",
            description: "Move items between markets where price differences exceed fees, hauling cost and risk.",
            difficulty: "Advanced",
            experience: "Understands order depth, route security, cargo value and realistic executable volume.",
            ships: ["Viator", "Occator", "Crane", "Bustard", "Fenrir"],
            coreSkills: [{ skill: "Trade", level: 4 }, { skill: "Accounting", level: 4 }, ...core.navigation],
            supportSkills: [{ skill: "Broker Relations", level: 4 }, { skill: "Evasive Maneuvering", level: 5 }, { skill: "Cloaking", level: 4 }],
            incomeHooks: ["Cross-region spread", "ISK per m³", "Turnover", "Route risk"],
          },
          {
            id: "market-seeding",
            label: "Market seeding",
            description: "Supply under-served local markets with useful modules, ammo, ships and consumables.",
            difficulty: "Advanced",
            experience: "Can identify demand gaps and manage slower-moving stock without overcommitting capital.",
            ships: ["Viator", "Occator", "Orca", "Fenrir"],
            coreSkills: [{ skill: "Trade", level: 5 }, { skill: "Retail", level: 5 }, { skill: "Marketing", level: 4 }],
            supportSkills: [{ skill: "Accounting", level: 4 }, { skill: "Broker Relations", level: 4 }, { skill: "Wholesale", level: 4 }],
            incomeHooks: ["Regional shortages", "Convenience premium", "Stock turnover", "Hauling efficiency"],
          },
        ],
      },
    ],
  },
  {
    id: "hauling",
    label: "Hauling",
    description: "Cargo progression from basic industrials through blockade runners, DSTs and freighters.",
    subcategories: [
      {
        id: "transport",
        label: "Transport",
        description: "Move personal, corporate or commercial cargo with a risk-appropriate hull.",
        content: [
          {
            id: "basic-hauling",
            label: "Basic high-sec hauling",
            description: "Low-complexity cargo movement in T1 industrials with sensible tank and cargo-value discipline.",
            difficulty: "Beginner",
            experience: "Basic route planning and understanding that cargo value affects gank risk.",
            ships: ["Iteron Mark V", "Mammoth", "Badger", "Bestower"],
            coreSkills: [...core.navigation, { skill: "Hull Upgrades", level: 4 }],
            supportSkills: [{ skill: "Evasive Maneuvering", level: 4 }, { skill: "Mechanics", level: 4 }],
            incomeHooks: ["Courier contracts", "Personal logistics savings", "Trade-route support"],
            selectors: [
              { id: "route", label: "Route", options: ["High-sec", "Mixed high/low-sec"] },
              { id: "cargo", label: "Cargo profile", options: ["Normal value", "High value"] },
            ],
          },
          {
            id: "blockade-runner",
            label: "Blockade runner",
            description: "Fast covert hauling for smaller high-value cargo through dangerous routes.",
            difficulty: "Advanced",
            experience: "Confident with cloak use, bookmarks, gate camps and route avoidance.",
            ships: ["Viator", "Crane", "Prowler", "Prorator"],
            coreSkills: [{ skill: "Transport Ships", level: 4 }, { skill: "Cloaking", level: 4 }, { skill: "Evasive Maneuvering", level: 5 }],
            supportSkills: [{ skill: "Navigation", level: 5 }, { skill: "Warp Drive Operation", level: 5 }, { skill: "Cybernetics", level: 4 }],
            incomeHooks: ["High-value courier contracts", "Trade-route margin", "Dangerous-space logistics"],
            selectors: [
              { id: "route", label: "Route", options: ["High-sec", "Low-sec", "Null-sec", "Wormhole"] },
              { id: "cargo", label: "Cargo profile", options: ["High value", "Very high value"] },
            ],
          },
          {
            id: "dst-freighter",
            label: "DST & freighter hauling",
            description: "Bulk cargo transport where tank, align time, scouting and collateral discipline dominate.",
            difficulty: "Advanced",
            experience: "Understands gank economics, collateral, webbing/scouting and route risk.",
            ships: ["Occator", "Bustard", "Mastodon", "Impel", "Obelisk", "Charon"],
            coreSkills: [{ skill: "Transport Ships", level: 4 }, { skill: "Evasive Maneuvering", level: 5 }, { skill: "Hull Upgrades", level: 5 }],
            supportSkills: [{ skill: "Navigation", level: 5 }, { skill: "Mechanics", level: 5 }, { skill: "Cybernetics", level: 4 }],
            incomeHooks: ["Bulk courier contracts", "Industrial logistics", "Market seeding"],
            selectors: [
              { id: "route", label: "Route", options: ["High-sec", "Mixed high/low-sec"] },
              { id: "cargo", label: "Cargo profile", options: ["Bulk", "High-value bulk"] },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "faction-warfare",
    label: "Faction Warfare",
    description: "Small-ship PvP, frontline complexes and loyalty-point progression.",
    subcategories: [
      {
        id: "complexes",
        label: "Complexes & Frontlines",
        description: "Fight around capture complexes where hull restrictions shape engagements.",
        content: [
          {
            id: "fw-scout-small",
            label: "Scout / small complexes",
            description: "Scout and small FW complexes with NVY/ADV gate rules, frequent engagements and low replacement cost.",
            difficulty: "Intermediate",
            experience: "Basic solo PvP skills and willingness to learn matchups through repeated fights.",
            ships: ["Tristan", "Kestrel", "Republic Fleet Firetail", "Caldari Navy Hookbill", "Federation Navy Comet", "Thrasher"],
            coreSkills: [...core.fitting, ...core.navigation],
            supportSkills: [{ skill: "Thermodynamics", level: 4 }, { skill: "Propulsion Jamming", level: 4 }],
            incomeHooks: ["Faction Warfare loyalty points", "Kill loot", "Battlefield/plex rewards"],
            selectors: [
              { id: "engagement", label: "Engagement", options: ["Solo", "Small gang"] },
              { id: "style", label: "Style", options: ["Brawl", "Scram-kite", "Kite", "Projection"] },
            ],
          },
          {
            id: "fw-medium-large",
            label: "Medium / moderate / large complexes",
            description: "Cruiser, battlecruiser and battleship FW with NVY/ADV gate rules, where fleet composition, projection and tackle become more important.",
            difficulty: "Advanced",
            experience: "Comfortable with small-gang communication, target calling and disengagement.",
            ships: ["Caracal", "Omen Navy Issue", "Stabber Fleet Issue", "Hurricane", "Ferox Navy Issue", "Prophecy Navy Issue", "Tempest"],
            coreSkills: [...core.fitting, ...core.navigation],
            supportSkills: [{ skill: "Advanced Weapon Upgrades", level: 4 }, { skill: "Thermodynamics", level: 4 }, { skill: "Propulsion Jamming", level: 4 }],
            incomeHooks: ["Faction Warfare loyalty points", "Kill loot", "Objective rewards"],
            selectors: [
              { id: "engagement", label: "Engagement", options: ["Solo", "Small gang", "Fleet"] },
              { id: "style", label: "Style", options: ["Brawl", "Kite", "Projection"] },
            ],
          },
          {
            id: "fw-battlefields",
            label: "Battlefields",
            description: "Larger organized FW objectives using the current Tech I / Navy battlefield gate, with stronger fleet and logistics expectations.",
            difficulty: "Advanced",
            experience: "Fleet experience and a doctrine-ready combat or logistics ship.",
            ships: ["Ferox", "Ferox Navy Issue", "Hurricane", "Prophecy Navy Issue", "Osprey", "Augoror"],
            coreSkills: [...core.fitting, { skill: "Long Range Targeting", level: 4 }],
            supportSkills: [{ skill: "Thermodynamics", level: 4 }, { skill: "Signature Analysis", level: 4 }],
            incomeHooks: ["Faction Warfare loyalty points", "Objective rewards", "Fleet SRP where offered"],
          },
        ],
      },
    ],
  },
  {
    id: "incursions",
    label: "Incursions",
    description: "High-end organized PvE built around fleet-ready DPS, tank and logistics.",
    subcategories: [
      {
        id: "incursion-sites",
        label: "Incursion Sites",
        description: "Progress from Vanguard fleets to harder Assault/HQ content.",
        content: [
          {
            id: "vanguard",
            label: "Vanguard",
            description: "Smaller incursion fleet sites with strict fit expectations but lower barrier than HQs.",
            difficulty: "Advanced",
            experience: "Solid fleet PvE habits, broadcasts and a doctrine-approved fit.",
            ships: ["Vindicator", "Nightmare", "Machariel", "Basilisk", "Scimitar"],
            coreSkills: [...core.fitting, ...core.capacitor],
            supportSkills: [{ skill: "Long Range Targeting", level: 4 }, { skill: "Signature Analysis", level: 4 }, { skill: "Thermodynamics", level: 4 }],
            incomeHooks: ["CONCORD payouts", "Loyalty points"],
            selectors: [
              { id: "role", label: "Fleet role", options: ["DPS", "Sniper / projection", "Logistics"] },
            ],
          },
          {
            id: "assault-hq",
            label: "Assault / Headquarters",
            description: "Larger, more demanding incursion fleets with high doctrine and support-skill expectations.",
            difficulty: "Expert",
            experience: "Experienced incursion pilot with high support skills and fleet-approved fittings.",
            ships: ["Vindicator", "Nightmare", "Machariel", "Paladin", "Basilisk", "Guardian"],
            coreSkills: [...core.fitting, ...core.capacitor, { skill: "Advanced Weapon Upgrades", level: 5 }],
            supportSkills: [{ skill: "Long Range Targeting", level: 5 }, { skill: "Signature Analysis", level: 5 }, { skill: "Thermodynamics", level: 4 }],
            incomeHooks: ["CONCORD payouts", "Loyalty points"],
            selectors: [
              { id: "role", label: "Fleet role", options: ["DPS", "Sniper / projection", "Logistics"] },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "wormholes",
    label: "Wormholes",
    description: "Scanning, daytripping, wormhole PvE and deep-space fleet operations.",
    subcategories: [
      {
        id: "wormhole-life",
        label: "Wormhole Operations",
        description: "Operate without local, manage connections and extract value while controlling risk.",
        content: [
          {
            id: "wh-daytrip",
            label: "Daytripping & exploration",
            description: "Enter wormholes for relic/data sites, gas or opportunistic content without living there.",
            difficulty: "Intermediate",
            experience: "Comfortable with probe scanning, bookmarking every connection and d-scan discipline.",
            ships: ["Astero", "Cheetah", "Prospect", "Stratios"],
            coreSkills: [{ skill: "Astrometrics", level: 4 }, { skill: "Cloaking", level: 4 }, ...core.navigation],
            supportSkills: [{ skill: "Hacking", level: 4 }, { skill: "Archaeology", level: 4 }, { skill: "Gas Cloud Harvesting", level: 4 }],
            incomeHooks: ["Relic/data loot", "Gas", "Sleeper salvage where applicable"],
            selectors: [
              { id: "target", label: "Primary target", options: ["Relic/data", "Gas", "Scouting"] },
            ],
          },
          {
            id: "wh-c3-pve",
            label: "C3 PvE",
            description: "Solo/small-group Sleeper combat sites with strong tank and capacitor demands.",
            difficulty: "Advanced",
            experience: "Comfortable with wormhole chains, polarization, PvP interruption risk and Sleeper mechanics.",
            ships: ["Praxis", "Tengu", "Loki", "Rattlesnake", "Gila"],
            coreSkills: [...core.fitting, ...core.capacitor],
            supportSkills: [{ skill: "Thermodynamics", level: 4 }, { skill: "Astrometrics", level: 4 }, { skill: "Cloaking", level: 4 }],
            incomeHooks: ["Sleeper blue loot", "Salvage"],
            selectors: [
              { id: "operation", label: "Operation", options: ["Solo", "Small group"] },
            ],
          },
          {
            id: "wh-rampant-drone-fabricator",
            label: "Rampant Drone Fabricator",
            description: "Escalating Rogue Drone site found in C1-C6 wormholes. Rampancy scales the threat; large Severe and Critical waves can now field an Infested Drone Naglfar with a Capital Energy Neutralizer and concentrated high EHP/DPS pressure.",
            difficulty: "Expert",
            experience: "Experienced wormhole fleet with strong capacitor discipline, target calling, logistics awareness and an exit/refit plan between waves.",
            ships: ["Paladin", "Vargur", "Nestor", "Leshak", "Loki"],
            coreSkills: [...core.fitting, ...core.capacitor],
            supportSkills: [{ skill: "Thermodynamics", level: 4 }, { skill: "Astrometrics", level: 4 }, { skill: "Cloaking", level: 4 }],
            incomeHooks: ["Fabricator Data", "Rogue Drone loot", "Escalating wormhole PvE rewards"],
            selectors: [
              { id: "threat", label: "Threat target", options: ["Lower threat", "Severe", "Critical"] },
            ],
          },

          {
            id: "wh-c5-c6",
            label: "C5/C6 fleet PvE",
            description: "High-class wormhole PvE with capital/escalation mechanics, fleet coordination and major risk.",
            difficulty: "Expert",
            experience: "Established wormhole group, advanced fleet skills and deep understanding of chain control.",
            ships: ["Paladin", "Vargur", "Nestor", "Leshak", "Naglfar"],
            coreSkills: [...core.fitting, ...core.capacitor, { skill: "Advanced Weapon Upgrades", level: 5 }],
            supportSkills: [{ skill: "Thermodynamics", level: 5 }, { skill: "Astrometrics", level: 4 }, { skill: "Cloaking", level: 4 }],
            incomeHooks: ["Sleeper blue loot", "Salvage", "High-class site income"],
            selectors: [
              { id: "role", label: "Fleet role", options: ["Marauder DPS", "Battleship DPS", "Capital escalation"] },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "capitals",
    label: "Capital Gameplay",
    description: "Long-form progression into carriers, dreadnoughts, FAX, jump freighters and industrial capitals.",
    subcategories: [
      {
        id: "combat-capitals",
        label: "Combat Capitals",
        description: "Capital combat roles with major skill, cost and group-support requirements.",
        content: [
          {
            id: "dreadnought",
            label: "Dreadnought",
            description: "Siege-based capital damage for structures, capitals and high-end PvE/PvP roles.",
            difficulty: "Expert",
            experience: "Experienced null/wormhole fleet pilot with strong support skills and capital replacement planning.",
            ships: ["Revelation", "Naglfar", "Phoenix", "Moros"],
            coreSkills: [...core.fitting, { skill: "Capital Ships", level: 4 }, { skill: "Advanced Weapon Upgrades", level: 5 }],
            supportSkills: [{ skill: "Jump Drive Operation", level: 5 }, { skill: "Jump Drive Calibration", level: 4 }, { skill: "Thermodynamics", level: 5 }],
            incomeHooks: ["Alliance/fleet strategic utility", "Capital PvE where appropriate"],
            selectors: [
              { id: "role", label: "Role", options: ["PvP anti-capital", "Structure", "Capital PvE"] },
            ],
          },
          {
            id: "carrier",
            label: "Carrier",
            description: "Fighter-based capital platform requiring deep drone/fighter and jump-drive progression.",
            difficulty: "Expert",
            experience: "Experienced capital-space pilot with strong intel, cyno/jump and fighter management knowledge.",
            ships: ["Thanatos", "Chimera", "Archon", "Nidhoggur"],
            coreSkills: [{ skill: "Capital Ships", level: 4 }, { skill: "Fighters", level: 5 }, { skill: "Drone Interfacing", level: 5 }],
            supportSkills: [{ skill: "Jump Drive Operation", level: 5 }, { skill: "Jump Drive Calibration", level: 4 }, { skill: "Fighter Hangar Management", level: 4 }],
            incomeHooks: ["Alliance/fleet strategic utility", "Capital PvE where appropriate"],
            selectors: [
              { id: "role", label: "Role", options: ["Fleet PvP", "Capital PvE", "Support"] },
            ],
          },
          {
            id: "fax",
            label: "Force Auxiliary",
            description: "Capital logistics with demanding capacitor, triage and remote-repair requirements.",
            difficulty: "Expert",
            experience: "Veteran logistics pilot with capital fleet experience and strong communication discipline.",
            ships: ["Apostle", "Minokawa", "Ninazu", "Lif"],
            coreSkills: [{ skill: "Capital Ships", level: 4 }, { skill: "Tactical Logistics Reconfiguration", level: 4 }, ...core.capacitor],
            supportSkills: [{ skill: "Jump Drive Operation", level: 5 }, { skill: "Jump Drive Calibration", level: 4 }, { skill: "Long Range Targeting", level: 5 }],
            incomeHooks: ["Alliance/fleet strategic utility"],
            selectors: [
              { id: "role", label: "Logistics role", options: ["Armor triage", "Shield triage"] },
            ],
          },
        ],
      },
      {
        id: "industrial-capitals",
        label: "Industrial Capitals",
        description: "Capital-scale hauling, mining support and logistics.",
        content: [
          {
            id: "jump-freighter",
            label: "Jump Freighter",
            description: "Long-distance capital logistics with cyno/jump planning and enormous cargo value exposure.",
            difficulty: "Expert",
            experience: "Experienced hauler with cyno chains, jump fatigue and capital-risk discipline.",
            ships: ["Anshar", "Rhea", "Nomad", "Ark"],
            coreSkills: [{ skill: "Jump Freighters", level: 4 }, { skill: "Jump Drive Operation", level: 5 }, { skill: "Jump Drive Calibration", level: 4 }],
            supportSkills: [{ skill: "Navigation", level: 5 }, { skill: "Evasive Maneuvering", level: 5 }],
            incomeHooks: ["Capital logistics", "Regional arbitrage", "Alliance/corp hauling"],
            selectors: [
              { id: "route", label: "Route", options: ["Low/null logistics", "Null staging", "Regional trade"] },
            ],
          },
          {
            id: "rorqual",
            label: "Rorqual support",
            description: "Industrial capital command, compression and mining support in dangerous space.",
            difficulty: "Expert",
            experience: "Established null-sec industrial pilot with capital survival and fleet-support knowledge.",
            ships: ["Rorqual"],
            coreSkills: [{ skill: "Capital Industrial Ships", level: 4 }, { skill: "Mining Director", level: 5 }, { skill: "Industrial Reconfiguration", level: 4 }],
            supportSkills: [{ skill: "Jump Drive Operation", level: 5 }, { skill: "Drone Interfacing", level: 5 }, { skill: "Shield Management", level: 5 }],
            incomeHooks: ["Fleet yield uplift", "Compression", "Industrial support"],
            selectors: [
              { id: "role", label: "Industrial role", options: ["Boosting / compression", "Mining support", "Defensive support"] },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "general",
    label: "Everything / General",
    description: "Broad progression for a character that should stay flexible across many careers.",
    subcategories: [
      {
        id: "core-progression",
        label: "Core Progression",
        description: "High-value skills that improve many ships and activities at once.",
        content: [
          {
            id: "core-fitting",
            label: "Core fitting skills",
            description: "Reduce fitting friction and make more ship fits practical without expensive compromises.",
            difficulty: "Beginner",
            experience: "Useful for every capsuleer regardless of career.",
            ships: ["Gnosis", "Praxis", "Sunesis"],
            coreSkills: [{ skill: "CPU Management", level: 5 }, { skill: "Power Grid Management", level: 5 }, { skill: "Weapon Upgrades", level: 5 }],
            supportSkills: [{ skill: "Advanced Weapon Upgrades", level: 4 }, { skill: "Mechanics", level: 5 }, { skill: "Hull Upgrades", level: 5 }],
            incomeHooks: ["Indirect: broader fitting options and lower fitting-compromise cost"],
          },
          {
            id: "core-navigation",
            label: "Core navigation",
            description: "Improve speed, agility, propulsion and warp efficiency across almost every ship.",
            difficulty: "Beginner",
            experience: "Useful for every capsuleer regardless of career.",
            ships: ["Sunesis", "Gnosis", "Praxis"],
            coreSkills: [{ skill: "Navigation", level: 5 }, { skill: "Evasive Maneuvering", level: 5 }, { skill: "Warp Drive Operation", level: 5 }],
            supportSkills: [{ skill: "Acceleration Control", level: 4 }, { skill: "Fuel Conservation", level: 4 }, { skill: "High Speed Maneuvering", level: 4 }],
            incomeHooks: ["Indirect: faster travel, safer movement and better application/range control"],
          },
          {
            id: "core-capacitor-tank",
            label: "Capacitor & tank fundamentals",
            description: "Improve survivability and sustained module operation across PvE and PvP fits.",
            difficulty: "Intermediate",
            experience: "Useful before specializing into expensive or demanding hulls.",
            ships: ["Gnosis", "Praxis", "Drake", "Myrmidon"],
            coreSkills: [{ skill: "Capacitor Management", level: 5 }, { skill: "Capacitor Systems Operation", level: 5 }, { skill: "Mechanics", level: 5 }],
            supportSkills: [{ skill: "Hull Upgrades", level: 5 }, { skill: "Shield Management", level: 5 }, { skill: "Thermodynamics", level: 4 }],
            incomeHooks: ["Indirect: stronger and more sustainable fits"],
          },
          {
            id: "all-rounder",
            label: "All-round capsuleer",
            description: "Balanced path for pilots who want useful competence across combat, travel, exploration and industry.",
            difficulty: "Intermediate",
            experience: "Best for broad progression rather than rushing one specialist activity.",
            ships: ["Gnosis", "Praxis", "Sunesis", "Astero", "Venture"],
            coreSkills: [...core.fitting, ...core.navigation, ...core.capacitor],
            supportSkills: [{ skill: "Drones", level: 5 }, { skill: "Astrometrics", level: 4 }, { skill: "Industry", level: 4 }, { skill: "Trade", level: 4 }],
            incomeHooks: ["Indirect: unlocks more viable activities and flexible earning options"],
          },
        ],
      },
    ],
  },
];
