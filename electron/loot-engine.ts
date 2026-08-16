import AdmZip from "adm-zip";
import path from "node:path";
import { STATIC_DATA_ROOT } from "./data-paths";
import { ensureStaticDataArchive, prepareStaticDataForProcess } from "./type-volumes";
import { getMarketType, searchMarketTypes } from "./market-static-index";

const SDE_ARCHIVE = path.join(STATIC_DATA_ROOT, "eve-static-data-jsonl.zip");

type SdeMaterial = { typeID: number; quantity: number };
type SdeProduct = { typeID: number; quantity: number; probability?: number };
type SdeSkill = { typeID: number; level: number };
type SdeActivity = { materials?: SdeMaterial[]; products?: SdeProduct[]; skills?: SdeSkill[]; time?: number };
type SdeBlueprint = { _key: number; blueprintTypeID: number; activities?: Record<string, SdeActivity> };
type TypeMeta = { typeId: number; name: string; groupId: number; metaGroupId: number | null; published: boolean };

type IndexedActivity = {
  blueprintTypeId: number;
  activityId: string;
  activity: SdeActivity;
};

type ReprocessingSource = {
  sourceTypeId: number;
  outputQuantity: number;
  randomizedMin: number | null;
  randomizedMax: number | null;
};

type AcquisitionIndex = {
  names: Map<number, string>;
  types: Map<number, TypeMeta>;
  blueprints: Map<number, SdeBlueprint>;
  outputs: Map<number, IndexedActivity[]>;
  reprocessing: Map<number, ReprocessingSource[]>;
};

export type LootSearchResult = {
  typeId: number;
  name: string;
  category: string;
  group: string;
  marketGroup: string;
};

export type LootAcquisitionRoute = {
  id: string;
  kind: "invention" | "manufacturing" | "reaction" | "copying" | "reprocessing" | "deadspace" | "officer";
  title: string;
  summary: string;
  steps: string[];
  sourceLabel: string;
  sourceUrl?: string;
  chanceNote?: string;
  intelligence: {
    heading: string;
    classification: string;
    facts: Array<{ label: string; value: string }>;
    chain?: string[];
    finding?: string[];
    warnings?: string[];
    probability: { status: "verified" | "unverified"; label: string; value?: number };
  };
  details?: {
    blueprintTypeId?: number;
    blueprintName?: string;
    sourceBlueprintTypeId?: number;
    sourceBlueprintName?: string;
    materials?: Array<{ typeId: number; name: string; quantity: number }>;
    skills?: Array<{ typeId: number; name: string; level: number }>;
    products?: Array<{ typeId: number; name: string; quantity: number; probability: number | null }>;
    site?: string;
    rating?: string;
    faction?: string;
    regions?: string[];
    npc?: string;
    durationSeconds?: number;
  };
};

export type LootAcquisitionResult = {
  item: {
    typeId: number;
    name: string;
    category: string;
    group: string;
    marketGroup: string;
  };
  routes: LootAcquisitionRoute[];
  exact: boolean;
  note: string;
  sources: string[];
};

let indexPromise: Promise<AcquisitionIndex> | undefined;

function lineObjects<T>(entry: AdmZip.IZipEntry | null): T[] {
  if (!entry) return [];
  const rows: T[] = [];
  for (const line of entry.getData().toString("utf8").split(/\r?\n/)) {
    if (!line) continue;
    rows.push(JSON.parse(line) as T);
  }
  return rows;
}

async function index(): Promise<AcquisitionIndex> {
  if (indexPromise) return indexPromise;
  indexPromise = Promise.resolve().then(async () => {
    await prepareStaticDataForProcess();
    await ensureStaticDataArchive();
    const zip = new AdmZip(SDE_ARCHIVE);
    const typesEntry = zip.getEntry("types.jsonl");
    const blueprintsEntry = zip.getEntry("blueprints.jsonl");
    const materialsEntry = zip.getEntry("typeMaterials.jsonl");
    if (!typesEntry || !blueprintsEntry)
      throw new Error("Official CCP static data is missing the item/blueprint records required by Loot.");

    const names = new Map<number, string>();
    const types = new Map<number, TypeMeta>();
    for (const row of lineObjects<{
      _key: number;
      name?: { en?: string };
      groupID: number;
      metaGroupID?: number;
      published?: boolean;
    }>(typesEntry)) {
      const name = row.name?.en;
      if (name) names.set(row._key, name);
      types.set(row._key, {
        typeId: row._key,
        name: name ?? `Type ${row._key}`,
        groupId: row.groupID,
        metaGroupId: Number.isFinite(row.metaGroupID) ? Number(row.metaGroupID) : null,
        published: Boolean(row.published),
      });
    }

    const blueprints = new Map<number, SdeBlueprint>();
    const outputs = new Map<number, IndexedActivity[]>();
    for (const row of lineObjects<SdeBlueprint>(blueprintsEntry)) {
      const blueprintTypeId = Number(row.blueprintTypeID ?? row._key);
      blueprints.set(blueprintTypeId, row);
      for (const [activityId, activity] of Object.entries(row.activities ?? {})) {
        for (const product of activity.products ?? []) {
          const list = outputs.get(product.typeID) ?? [];
          list.push({ blueprintTypeId, activityId, activity });
          outputs.set(product.typeID, list);
        }
      }
    }

    const reprocessing = new Map<number, ReprocessingSource[]>();
    for (const row of lineObjects<{
      _key: number;
      materials?: Array<{ materialTypeID: number; quantity: number }>;
      randomizedMaterials?: Array<{ materialTypeID: number; quantityMin: number; quantityMax: number }>;
    }>(materialsEntry)) {
      for (const material of row.materials ?? []) {
        const list = reprocessing.get(material.materialTypeID) ?? [];
        list.push({ sourceTypeId: row._key, outputQuantity: material.quantity, randomizedMin: null, randomizedMax: null });
        reprocessing.set(material.materialTypeID, list);
      }
      for (const material of row.randomizedMaterials ?? []) {
        const list = reprocessing.get(material.materialTypeID) ?? [];
        list.push({ sourceTypeId: row._key, outputQuantity: 0, randomizedMin: material.quantityMin, randomizedMax: material.quantityMax });
        reprocessing.set(material.materialTypeID, list);
      }
    }

    return { names, types, blueprints, outputs, reprocessing };
  });
  return indexPromise;
}

function namedMaterials(activity: SdeActivity, names: Map<number, string>) {
  return (activity.materials ?? []).map((material) => ({
    typeId: material.typeID,
    name: names.get(material.typeID) ?? `Type ${material.typeID}`,
    quantity: material.quantity,
  }));
}

function namedSkills(activity: SdeActivity, names: Map<number, string>) {
  return (activity.skills ?? []).map((skill) => ({
    typeId: skill.typeID,
    name: names.get(skill.typeID) ?? `Skill ${skill.typeID}`,
    level: skill.level,
  }));
}

function namedProducts(activity: SdeActivity, names: Map<number, string>) {
  return (activity.products ?? []).map((product) => ({
    typeId: product.typeID,
    name: names.get(product.typeID) ?? `Type ${product.typeID}`,
    quantity: product.quantity,
    probability: product.probability ?? null,
  }));
}

function inventionSourcesFor(blueprintTypeId: number, idx: AcquisitionIndex) {
  return (idx.outputs.get(blueprintTypeId) ?? []).filter((entry) => entry.activityId === "invention");
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (!parts.length || (remainder && seconds < 3_600)) parts.push(`${remainder} second${remainder === 1 ? "" : "s"}`);
  return parts.join(" ");
}

const DED_SITES: Record<string, Record<number, string>> = {
  "Angel Cartel": {
    1: "Minmatar Contracted Bio-Farm",
    2: "Angel Creo-Corp Mining",
    3: "Angel Repurposed Outpost",
    4: "Angel Cartel Occupied Mining Colony",
    5: "Angel's Red Light District",
    6: "Angel Mineral Acquisition Outpost",
    7: "Angel Military Operations Complex",
    8: "Cartel Prisoner Retention",
    10: "Angel Cartel Naval Shipyard",
  },
  "Blood Raiders": {
    1: "Old Meanie - Cultivation Center",
    2: "Blood Raider Human Farm",
    3: "Blood Raider Intelligence Collection Point",
    4: "Mul-Zatah Monastery",
    5: "Blood Raider Psychotropics Depot",
    6: "Crimson Hand Supply Depot",
    7: "Blood Raider Coordination Center",
    8: "Blood Raider Prison Camp",
    10: "Blood Raider Naval Shipyard",
  },
  "Guristas Pirates": {
    1: "Pith-Robux Asteroid Mining Co.",
    2: "Pith Merchant Depot",
    3: "Guristas Guerilla Grounds",
    4: "Guristas Scout Outpost",
    5: "Guristas Hallucinogen Supply Waypoint",
    6: "Guristas Troop Reinvigoration Camp",
    7: "Gurista Military Operations Complex",
    8: "Pith's Penal Complex",
    10: "The Maze",
  },
  "Sansha's Nation": {
    1: "Sansha Military Outpost",
    2: "Sansha Acclimatization Facility",
    3: "Sansha's Command Relay Outpost",
    4: "Sansha's Nation Occupied Mining Colony",
    5: "Sansha's Nation Neural Paralytic Facility",
    6: "Sansha War Supply Complex",
    7: "Sansha Military Operations Complex",
    8: "Sansha Prison Camp",
    10: "Centus Assembly T.P. Co.",
  },
  "Serpentis Corporation": {
    1: "Serpentis Drug Outlet",
    2: "Serpentis Live Cargo Distribution Facilities",
    3: "Serpentis Narcotic Warehouses",
    4: "Serpentis Phi-Outpost",
    5: "Serpentis Corporation Hydroponics Site",
    6: "Serpentis Logistical Outpost",
    7: "Serpentis Paramilitary Complex",
    8: "Serpentis Prison Camp",
    10: "Serpentis Fleet Shipyard",
  },
};

type DeadspaceFamily = { prefix: string; faction: keyof typeof DED_SITES; size: "small" | "medium" | "large" };
type DeadspaceLootSource = {
  target: string;
  sourceSite?: string;
  sourceNote?: string;
};

const FACTION_REGIONS: Record<keyof typeof DED_SITES, string[]> = {
  "Angel Cartel": ["Curse", "Great Wildlands", "Cache", "Insmother", "Scalding Pass and other Angel-dominant null-security regions"],
  "Blood Raiders": ["Delve", "Querious", "Period Basis"],
  "Guristas Pirates": ["Venal", "Branch", "Tenal", "Deklein", "Pure Blind", "Vale of the Silent", "Geminate"],
  "Sansha's Nation": ["Stain", "Catch", "Esoteria", "Paragon Soul"],
  "Serpentis Corporation": ["Fountain", "Cloud Ring"],
};

function dedSecurityContext(rating: number) {
  if (rating <= 4) return "High- and low-security space in systems where this pirate faction's combat signatures occur";
  if (rating <= 6) return "Low- and null-security space in systems where this pirate faction's combat signatures occur";
  return "Null-security space in regions where this pirate faction is the local pirate population";
}

const DED_LOOT_SOURCES: Record<keyof typeof DED_SITES, Partial<Record<number, DeadspaceLootSource>>> = {
  "Angel Cartel": {
    1: { target: "Oofus's Repair Shop" },
    2: { target: "Deadspace Control Station" },
    3: { target: "Domination Grigori" },
    4: { target: "Domination Excavator" },
    5: { target: "Angel Retirement Home" },
    6: { target: "Hashi Keptzh", sourceSite: "Angel Mineral Acquisition Outpost, 2nd Part", sourceNote: "The initial Angel Mineral Acquisition Outpost has no noteworthy deadspace drop; complete it to receive the Part 2 expedition." },
    7: { target: "The Battlestation Admiral" },
    8: { target: "Angel Retention Facility" },
    10: { target: "The Antimatter Channeler" },
  },
  "Blood Raiders": {
    1: { target: "Stuffed Container" },
    2: { target: "Dark Blood Keeper" },
    3: { target: "Dark Blood Alpha" },
    4: { target: "Inner Sanctum" },
    5: { target: "Exsanguinator" },
    6: { target: "Crimson Lord" },
    7: { target: "Dark Blood Hunter" },
    8: { target: "Blood Raider Central Bastion" },
    10: { target: "Blood Raider Fleet Stronghold" },
  },
  "Guristas Pirates": {
    1: { target: "Retired Mining Veteran" },
    2: { target: "The Superintendant" },
    3: { target: "Dread Guristas Irregular" },
    4: { target: "Radiating Telescope" },
    5: { target: "Gurista Distributor" },
    6: { target: "Captive Fighting Arena" },
    7: { target: "Dread Guristas Commanding Officer" },
    8: { target: "Screaming Dewak Humfry" },
    10: { target: "Guristas Fleet Stronghold" },
  },
  "Sansha's Nation": {
    1: { target: "Sansha Outpost Administration Building (Deadspace Overseer's Structure)" },
    2: { target: "Sansha Tenebrus" },
    3: { target: "Centus Black Ops Commander" },
    4: { target: "True Sansha Foreman" },
    5: { target: "Slave Ation09" },
    6: { target: "Skomener Effotber" },
    7: { target: "True Sansha Archduke" },
    8: { target: "Sansha's Nation Central Bastion" },
    10: { target: "Station Ultima" },
  },
  "Serpentis Corporation": {
    1: { target: "Serpentis Financing Office" },
    2: { target: "Shadow Serpentis Warden" },
    3: { target: "Serpentis Supply Stronghold" },
    4: { target: "Overseer Battleship" },
    5: { target: "Sarpati Family Enforcer" },
    6: { target: "Uehiro Katsen", sourceSite: "Serpentis Logistical Outpost Part 2", sourceNote: "The initial Serpentis Logistical Outpost has no notable deadspace loot; it always escalates to Part 2, where Uehiro Katsen carries the Corelum A-Type roll." },
    7: { target: "Shadow Serpentis Big Boss" },
    8: { target: "Serpentis Prisoner Isolation Facility" },
    10: { target: "Serpentis Fleet Stronghold" },
  },
};

const FLEET_STAGING_SOURCES: Record<keyof typeof DED_SITES, DeadspaceLootSource> = {
  "Angel Cartel": { target: "Angel Fleet Outpost", sourceSite: "Angel Domination Fleet Staging Point 3" },
  "Blood Raiders": { target: "Blood Raider Fleet Outpost", sourceSite: "Dark Blood Fleet Staging Point 3" },
  "Guristas Pirates": { target: "Guristas Fleet Outpost", sourceSite: "Dread Guristas Fleet Staging Point 3" },
  "Sansha's Nation": { target: "Sansha's Battletower", sourceSite: "True Sansha Fleet Staging Point 3" },
  "Serpentis Corporation": { target: "Serpentis Fleet Outpost", sourceSite: "Shadow Serpentis Fleet Staging Point 3" },
};

const DEADSPACE_FAMILIES: DeadspaceFamily[] = [
  { prefix: "Centii", faction: "Sansha's Nation", size: "small" },
  { prefix: "Centum", faction: "Sansha's Nation", size: "medium" },
  { prefix: "Centus", faction: "Sansha's Nation", size: "large" },
  { prefix: "Coreli", faction: "Serpentis Corporation", size: "small" },
  { prefix: "Corelum", faction: "Serpentis Corporation", size: "medium" },
  { prefix: "Core ", faction: "Serpentis Corporation", size: "large" },
  { prefix: "Corpii", faction: "Blood Raiders", size: "small" },
  { prefix: "Corpum", faction: "Blood Raiders", size: "medium" },
  { prefix: "Corpus", faction: "Blood Raiders", size: "large" },
  { prefix: "Gistii", faction: "Angel Cartel", size: "small" },
  { prefix: "Gistum", faction: "Angel Cartel", size: "medium" },
  { prefix: "Gist ", faction: "Angel Cartel", size: "large" },
  { prefix: "Pithi", faction: "Guristas Pirates", size: "small" },
  { prefix: "Pithum", faction: "Guristas Pirates", size: "medium" },
  { prefix: "Pith ", faction: "Guristas Pirates", size: "large" },
];

function deadspaceRoute(itemName: string): LootAcquisitionRoute | null {
  const family = DEADSPACE_FAMILIES.find((entry) => itemName.startsWith(`${entry.prefix} `) || itemName.startsWith(entry.prefix));
  const gradeMatch = itemName.match(/\b([ABCX])-Type\b/i);
  if (!family || !gradeMatch) return null;
  const grade = gradeMatch[1].toUpperCase();
  let rating: number | null = null;
  if (family.size === "small") rating = grade === "A" ? 3 : grade === "B" ? 2 : grade === "C" ? 1 : null;
  if (family.size === "medium") rating = grade === "A" ? 6 : grade === "B" ? 5 : grade === "C" ? 4 : null;
  if (family.size === "large") rating = grade === "C" ? 7 : grade === "B" ? 8 : grade === "X" ? 10 : null;

  if (family.size === "large" && grade === "A") {
    const source = FLEET_STAGING_SOURCES[family.faction];
    return {
      id: `deadspace:${family.faction}:fleet-staging:${itemName}`,
      kind: "deadspace",
      title: `Run ${source.sourceSite}`,
      summary: `${itemName} is in the ${family.prefix.trim()} A-Type deadspace family. The A-Type battleship module roll is in the final Fleet Staging Point expedition.`,
      steps: [
        `Find/run the ${family.faction} Fleet Staging Point chain and escalate it through to part 3.`,
        `In ${source.sourceSite}, destroy ${source.target}; that is the loot source to target.`,
        `Loot ${source.target} for a chance at ${family.prefix.trim()} A-Type modules, including ${itemName}.`,
      ],
      sourceLabel: "EVE University — Fleet Staging Point + deadspace module source tables",
      sourceUrl: "https://wiki.eveuniversity.org/Faction_modules",
      chanceNote: "Deadspace module drops are chance-based; reaching the correct loot source does not guarantee this specific module.",
      intelligence: {
        heading: "Expedition source",
        classification: "Escalation chain · Fleet Staging Point",
        facts: [
          { label: "Pirate faction", value: family.faction },
          { label: "Final stage", value: source.sourceSite ?? "Fleet Staging Point part 3" },
          { label: "Loot target", value: source.target },
          { label: "Security context", value: "Null-security pirate space" },
        ],
        chain: [`${family.faction} Fleet Staging Point`, "Escalation / expedition continuation", source.sourceSite ?? "Part 3", source.target, itemName],
        finding: [
          `Run ${family.faction} combat sites in its null-security regions and obtain the Fleet Staging Point expedition chain.`,
          "Follow the expedition through every issued stage; the module roll is at part 3, not at the originating site.",
        ],
        warnings: ["Finding the escalation and receiving this particular module are separate chance events."],
        probability: { status: "unverified", label: "Exact item drop chance not verified" },
      },
      details: { faction: family.faction, rating: "Fleet Staging Point part 3" },
    };
  }

  if (!rating) return null;
  const site = DED_SITES[family.faction]?.[rating];
  if (!site) return null;
  const lootSource = DED_LOOT_SOURCES[family.faction]?.[rating];
  const actualSite = lootSource?.sourceSite ?? site;
  const target = lootSource?.target;
  return {
    id: `deadspace:${family.faction}:${rating}:${itemName}`,
    kind: "deadspace",
    title: actualSite === site ? `Run ${site} (${rating}/10)` : `Run ${site} → ${actualSite}`,
    summary: `${itemName} belongs to the ${family.prefix.trim()} ${grade}-Type deadspace family. ${target ? `The verified loot target is ${target}.` : `It drops from ${family.faction} ${rating}/10 content.`}`,
    steps: [
      `Find/run ${site}, the ${family.faction} ${rating}/10 route for this deadspace family.`,
      ...(lootSource?.sourceNote ? [lootSource.sourceNote] : []),
      ...(actualSite !== site ? [`Continue the escalation into ${actualSite}.`] : []),
      target
        ? `Destroy ${target}; this is the specific loot source that carries the ${family.prefix.trim()} ${grade}-Type roll.`
        : "Complete the complex and destroy the deadspace-dropping overseer/structure.",
      `Loot ${target ?? "the overseer/structure"} for a chance at ${itemName}.`,
    ],
    sourceLabel: "EVE University — DED site walkthrough + deadspace module source table",
    sourceUrl: "https://wiki.eveuniversity.org/Faction_modules",
    chanceNote: "This identifies the correct site and loot target; the specific module remains a chance-based drop.",
    intelligence: {
      heading: "Complex source",
      classification: actualSite === site ? `DED-rated combat signature · ${rating}/10` : `DED complex with expedition continuation · ${rating}/10`,
      facts: [
        { label: "Pirate faction", value: family.faction },
        { label: "Originating complex", value: site },
        ...(actualSite !== site ? [{ label: "Final escalation", value: actualSite }] : []),
        { label: "Exact loot target", value: target ?? "Deadspace overseer / structure" },
        { label: "Security context", value: dedSecurityContext(rating) },
        { label: "Pirate-region context", value: FACTION_REGIONS[family.faction].join(", ") },
      ],
      chain: actualSite === site
        ? ["Scan cosmic signatures", site, target ?? "Final overseer / structure", itemName]
        : ["Scan cosmic signatures", site, actualSite, target ?? "Final overseer / structure", itemName],
      finding: [
        `Use core scanner probes to resolve combat signatures in ${family.faction} space appropriate to a ${rating}/10 complex.`,
        actualSite === site
          ? `Warp to and complete ${site}; the loot roll is attached to ${target ?? "the final overseer or structure"}.`
          : `Complete ${site}, then follow its expedition to ${actualSite}; the deadspace roll is not in the initial site.`,
      ],
      warnings: [
        "Resolving or receiving the site does not guarantee the requested module.",
        "The correct final target makes a chance-based family loot roll; individual items are not guaranteed.",
      ],
      probability: { status: "unverified", label: "Exact item drop chance not verified" },
    },
    details: { faction: family.faction, rating: `${rating}/10`, site: actualSite, npc: target, regions: FACTION_REGIONS[family.faction] },
  };
}

type OfficerRule = { npc: string; faction: string; regions: string[] };
const OFFICERS: OfficerRule[] = [
  { npc: "Tobias Kruzhor", faction: "Angel Cartel", regions: ["Curse", "Insmother", "Feythabolis", "Cache", "Great Wildlands", "Immensea", "Deterid", "Tenerifis", "Scalding Pass", "Omist", "Impass"] },
  { npc: "Gotan Kreiss", faction: "Angel Cartel", regions: ["Curse", "Insmother", "Feythabolis", "Cache", "Great Wildlands", "Immensea", "Deterid", "Tenerifis", "Scalding Pass", "Omist", "Impass"] },
  { npc: "Hakim Stormare", faction: "Angel Cartel", regions: ["Curse", "Insmother", "Feythabolis", "Cache", "Great Wildlands", "Immensea", "Deterid", "Tenerifis", "Scalding Pass", "Omist", "Impass"] },
  { npc: "Mizuro Cybon", faction: "Angel Cartel", regions: ["Curse", "Insmother", "Feythabolis", "Cache", "Great Wildlands", "Immensea", "Deterid", "Tenerifis", "Scalding Pass", "Omist", "Impass"] },
  { npc: "Estamel Tharchon", faction: "Guristas Pirates", regions: ["Venal", "Pure Blind", "Vale of the Silent", "Geminate", "Deklein", "Tenal", "Branch"] },
  { npc: "Vepas Minimala", faction: "Guristas Pirates", regions: ["Venal", "Pure Blind", "Vale of the Silent", "Geminate", "Deklein", "Tenal", "Branch"] },
  { npc: "Thon Eney", faction: "Guristas Pirates", regions: ["Venal", "Pure Blind", "Vale of the Silent", "Geminate", "Deklein", "Tenal", "Branch"] },
  { npc: "Kaikka Peunato", faction: "Guristas Pirates", regions: ["Venal", "Pure Blind", "Vale of the Silent", "Geminate", "Deklein", "Tenal", "Branch"] },
  { npc: "Draclira Merlonne", faction: "Blood Raiders", regions: ["Delve", "Querious", "Period Basis"] },
  { npc: "Ahremen Arkah", faction: "Blood Raiders", regions: ["Delve", "Querious", "Period Basis"] },
  { npc: "Raysere Giant", faction: "Blood Raiders", regions: ["Delve", "Querious", "Period Basis"] },
  { npc: "Tairei Namazoth", faction: "Blood Raiders", regions: ["Delve", "Querious", "Period Basis"] },
  { npc: "Chelm Soran", faction: "Sansha's Nation", regions: ["Stain", "Catch", "Paragon Soul", "Esoteria"] },
  { npc: "Vizan Ankonin", faction: "Sansha's Nation", regions: ["Stain", "Catch", "Paragon Soul", "Esoteria"] },
  { npc: "Selynne Mardakar", faction: "Sansha's Nation", regions: ["Stain", "Catch", "Paragon Soul", "Esoteria"] },
  { npc: "Brokara Ryver", faction: "Sansha's Nation", regions: ["Stain", "Catch", "Paragon Soul", "Esoteria"] },
  { npc: "Cormack Vaaja", faction: "Serpentis Corporation", regions: ["Fountain", "Cloud Ring"] },
  { npc: "Setele Schellan", faction: "Serpentis Corporation", regions: ["Fountain", "Cloud Ring"] },
  { npc: "Tuvan Orth", faction: "Serpentis Corporation", regions: ["Fountain", "Cloud Ring"] },
  { npc: "Brynn Jerdola", faction: "Serpentis Corporation", regions: ["Fountain", "Cloud Ring"] },
];

function officerRoute(itemName: string): LootAcquisitionRoute | null {
  const lower = itemName.toLowerCase();
  const officer = OFFICERS.find((entry) => lower.startsWith(`${entry.npc.split(" ")[0].toLowerCase()}'s `));
  if (!officer) return null;
  return {
    id: `officer:${officer.npc}:${itemName}`,
    kind: "officer",
    title: `Hunt ${officer.npc}`,
    summary: `${itemName} is named for ${officer.npc}; officer modules drop from the named officer's wreck, not from ordinary DED overseers.`,
    steps: [
      `Rat asteroid belts in ${officer.faction} space where ${officer.npc} can spawn.`,
      `Target regions: ${officer.regions.join(", ")}.`,
      `When the rare officer spawn ${officer.npc} appears, kill it and loot the wreck for a chance at ${itemName}.`,
    ],
    sourceLabel: "EVE University — Officer module source table",
    sourceUrl: "https://wiki.eveuniversity.org/Faction_modules",
    chanceNote: "Officer spawns are extremely rare and their named module drops are chance-based.",
    intelligence: {
      heading: "Officer source",
      classification: "Named officer · asteroid-belt hunting",
      facts: [
        { label: "Named officer", value: officer.npc },
        { label: "Pirate faction", value: officer.faction },
        { label: "Security context", value: "Null-security asteroid belts in the officer's pirate territory" },
        { label: "Verified regions", value: officer.regions.join(", ") },
      ],
      chain: ["Rat asteroid belts", `Rare ${officer.npc} spawn`, "Destroy and loot officer wreck", itemName],
      finding: [
        `Continuously clear asteroid-belt NPC waves in the listed ${officer.faction} regions to create further spawn opportunities.`,
        `Identify ${officer.npc} by name; ordinary faction commanders do not substitute for the named officer.`,
      ],
      warnings: ["Officer spawning is extremely rare.", "Even when the officer appears, this specific named module is not guaranteed."],
      probability: { status: "unverified", label: "Exact officer spawn and item drop chances not verified" },
    },
    details: { faction: officer.faction, regions: officer.regions, npc: officer.npc },
  };
}

function industryRoutes(typeId: number, idx: AcquisitionIndex): LootAcquisitionRoute[] {
  const routes: LootAcquisitionRoute[] = [];
  const targetName = idx.names.get(typeId) ?? `Type ${typeId}`;
  const outputEntries = idx.outputs.get(typeId) ?? [];

  for (const entry of outputEntries) {
    const blueprintName = idx.names.get(entry.blueprintTypeId) ?? `Blueprint ${entry.blueprintTypeId}`;
    const materials = namedMaterials(entry.activity, idx.names);
    const skills = namedSkills(entry.activity, idx.names);
    const products = namedProducts(entry.activity, idx.names);
    const product = products.find((value) => value.typeId === typeId);

    if (entry.activityId === "invention") {
      routes.push({
        id: `invention:${entry.blueprintTypeId}:${typeId}`,
        kind: "invention",
        title: `Invent ${targetName} from ${blueprintName}`,
        summary: `${targetName} is an invention output of ${blueprintName} in the CCP SDE.`,
        steps: [
          `Make/obtain a blueprint copy of ${blueprintName}; invention consumes a copy rather than the original blueprint.` ,
          `Load the invention job with ${materials.map((item) => `${item.quantity}× ${item.name}`).join(", ") || "the SDE-listed inputs"}.`,
          `Run the invention job${product?.probability != null ? `; base output probability is ${(product.probability * 100).toFixed(1)}% before applicable modifiers` : ""}.`,
          `A successful job produces ${product?.quantity ?? 1} run-output unit(s) of ${targetName}.`,
        ],
        sourceLabel: "CCP EVE Static Data — blueprints.jsonl",
        chanceNote: product?.probability != null ? `Base SDE invention probability: ${(product.probability * 100).toFixed(1)}%.` : undefined,
        intelligence: {
          heading: "Invention chain",
          classification: "Blueprint-copy invention · CCP static data",
          facts: [
            { label: "Source blueprint", value: blueprintName },
            { label: "Blueprint requirement", value: "A blueprint copy is consumed by the invention job" },
            { label: "Result", value: targetName },
            ...(entry.activity.time ? [{ label: "Base job time", value: formatDuration(entry.activity.time) }] : []),
          ],
          chain: [blueprintName, ...materials.map((item) => `${item.quantity}× ${item.name}`), targetName],
          finding: [
            `Obtain the T1 original or a copy of ${blueprintName}, then create/use a blueprint copy for invention.`,
            "The displayed probability is the CCP SDE base probability; decryptor and character modifiers are not being estimated here.",
          ],
          probability: product?.probability != null
            ? { status: "verified", label: "Base invention probability", value: product.probability }
            : { status: "unverified", label: "Base invention probability not supplied" },
        },
        details: {
          sourceBlueprintTypeId: entry.blueprintTypeId,
          sourceBlueprintName: blueprintName,
          materials,
          skills,
          products,
          durationSeconds: entry.activity.time,
        },
      });
      continue;
    }

    if (entry.activityId === "manufacturing" || entry.activityId === "reaction") {
      const inventedFrom = inventionSourcesFor(entry.blueprintTypeId, idx);
      const prefixSteps: string[] = [];
      if (inventedFrom.length) {
        const source = inventedFrom[0];
        const sourceName = idx.names.get(source.blueprintTypeId) ?? `Blueprint ${source.blueprintTypeId}`;
        const inventionProduct = (source.activity.products ?? []).find((value) => value.typeID === entry.blueprintTypeId);
        prefixSteps.push(
          `First invent ${blueprintName} from a ${sourceName} blueprint copy${inventionProduct?.probability != null ? ` (base probability ${(inventionProduct.probability * 100).toFixed(1)}%)` : ""}.`,
        );
      }
      routes.push({
        id: `${entry.activityId}:${entry.blueprintTypeId}:${typeId}`,
        kind: entry.activityId as "manufacturing" | "reaction",
        title: `${entry.activityId === "reaction" ? "React" : "Manufacture"} ${targetName}`,
        summary: `${targetName} is produced by ${blueprintName}${inventedFrom.length ? ", and that blueprint is itself obtainable by invention" : ""}.`,
        steps: [
          ...prefixSteps,
          `Use ${blueprintName} for the ${entry.activityId} job.`,
          `Provide ${materials.map((item) => `${item.quantity}× ${item.name}`).join(", ") || "the SDE-listed job inputs"} per base job run.`,
          `Run the job to produce ${product?.quantity ?? 1}× ${targetName} per listed output run.`,
        ],
        sourceLabel: "CCP EVE Static Data — blueprints.jsonl",
        intelligence: {
          heading: entry.activityId === "reaction" ? "Reaction source" : "Blueprint source",
          classification: inventedFrom.length
            ? "Invention-derived blueprint copy · CCP static data"
            : entry.activityId === "reaction" ? "Reaction formula · CCP static data" : "T1 blueprint · CCP static data",
          facts: [
            { label: "Job blueprint", value: blueprintName },
            { label: "Acquisition model", value: inventedFrom.length ? `Invent from ${idx.names.get(inventedFrom[0].blueprintTypeId) ?? "the listed source blueprint"}` : "Blueprint is not invention-derived in CCP blueprint activity data" },
            { label: "Output", value: `${product?.quantity ?? 1}× ${targetName}` },
            ...(entry.activity.time ? [{ label: "Base job time", value: formatDuration(entry.activity.time) }] : []),
          ],
          chain: inventedFrom.length
            ? [idx.names.get(inventedFrom[0].blueprintTypeId) ?? "Source T1 blueprint", "Invention job", blueprintName, `${entry.activityId} job`, targetName]
            : [blueprintName, `${entry.activityId} job`, targetName],
          finding: inventedFrom.length
            ? ["Create or acquire a copy of the source T1 blueprint, run invention, then use the successful T2 blueprint copy for the manufacturing job."]
            : ["CCP static data proves the production blueprint and job, but does not encode an NPC seller/corporation. Sage therefore does not invent a seeded vendor."],
          probability: inventedFrom[0]?.activity.products?.find((value) => value.typeID === entry.blueprintTypeId)?.probability != null
            ? { status: "verified", label: "Base invention probability", value: inventedFrom[0].activity.products!.find((value) => value.typeID === entry.blueprintTypeId)!.probability }
            : { status: "unverified", label: inventedFrom.length ? "Base invention probability not supplied" : "No chance roll: deterministic production job" },
        },
        details: {
          blueprintTypeId: entry.blueprintTypeId,
          blueprintName,
          sourceBlueprintTypeId: inventedFrom[0]?.blueprintTypeId,
          sourceBlueprintName: inventedFrom[0] ? idx.names.get(inventedFrom[0].blueprintTypeId) : undefined,
          materials,
          skills,
          products,
          durationSeconds: entry.activity.time,
        },
      });
    }
  }

  return routes;
}

function reprocessingRoutes(typeId: number, idx: AcquisitionIndex): LootAcquisitionRoute[] {
  const targetName = idx.names.get(typeId) ?? `Type ${typeId}`;
  const sources = (idx.reprocessing.get(typeId) ?? [])
    .filter((source) => idx.types.get(source.sourceTypeId)?.published)
    .sort((a, b) => (b.outputQuantity || b.randomizedMax || 0) - (a.outputQuantity || a.randomizedMax || 0))
    .slice(0, 24);
  if (!sources.length) return [];
  const preview = sources.slice(0, 8);
  return [{
    id: `reprocessing:${typeId}`,
    kind: "reprocessing",
    title: `Reprocess material into ${targetName}`,
    summary: `${targetName} is a reprocessing output of ${sources.length} published item type${sources.length === 1 ? "" : "s"} in the CCP SDE.`,
    steps: [
      `Acquire one of the source items listed below through gameplay (ore/loot/salvage as appropriate).`,
      "Reprocess it at a facility that accepts the source item.",
      `Collect ${targetName}; actual player yield can differ from the SDE base quantities because skills, structure and reprocessing bonuses apply.`,
    ],
    sourceLabel: "CCP EVE Static Data — typeMaterials.jsonl",
    intelligence: {
      heading: "Material sources",
      classification: "Reprocessing output · CCP static data",
      facts: [
        { label: "Published source types", value: String(sources.length) },
        { label: "Sources shown", value: String(preview.length) },
        { label: "Yield basis", value: "CCP SDE base material quantities; player yield modifiers are separate" },
      ],
      chain: ["Acquire a listed source through its own gameplay route", "Reprocess at a compatible facility", targetName],
      finding: ["The source list proves material composition only. It does not claim that every listed item has the same availability or that the first source is best."],
      warnings: ["Sage does not treat reprocessing as a complete acquisition answer when the source item's own route is unknown."],
      probability: { status: "unverified", label: "No item-specific chance roll is asserted" },
    },
    details: {
      products: preview.map((source) => ({
        typeId: source.sourceTypeId,
        name: idx.names.get(source.sourceTypeId) ?? `Type ${source.sourceTypeId}`,
        quantity: source.outputQuantity || source.randomizedMin || 0,
        probability: null,
      })),
    },
  }];
}

export async function searchLootItems(query: string, limit = 50): Promise<LootSearchResult[]> {
  const matches = await searchMarketTypes(query, limit);
  return matches.map((item) => ({
    typeId: item.typeId,
    name: item.name,
    category: item.categoryName,
    group: item.groupName,
    marketGroup: item.marketGroupPathLabel,
  }));
}

export async function getLootAcquisition(typeId: number): Promise<LootAcquisitionResult> {
  const [idx, marketType] = await Promise.all([index(), getMarketType(typeId)]);
  const itemName = idx.names.get(typeId) ?? marketType?.name ?? `Type ${typeId}`;
  const routes = [
    ...industryRoutes(typeId, idx),
    ...(deadspaceRoute(itemName) ? [deadspaceRoute(itemName)!] : []),
    ...(officerRoute(itemName) ? [officerRoute(itemName)!] : []),
    ...reprocessingRoutes(typeId, idx),
  ];

  const deduped = [...new Map(routes.map((route) => [route.id, route])).values()];
  const sourceSet = new Set(deduped.map((route) => route.sourceLabel));
  const exact = deduped.length > 0;
  return {
    item: {
      typeId,
      name: itemName,
      category: marketType?.categoryName ?? "Unknown category",
      group: marketType?.groupName ?? "Unknown group",
      marketGroup: marketType?.marketGroupPathLabel ?? "Unclassified",
    },
    routes: deduped,
    exact,
    note: exact
      ? "Only non-market acquisition routes backed by installed CCP static data or the explicitly named community drop table are shown. Buying from players is intentionally omitted."
      : "No verified non-market acquisition route is present in Sage's current acquisition sources for this item. Sage will not guess a drop, mission or escalation.",
    sources: [...sourceSet],
  };
}

export async function prepareLootDataLocal() {
  const idx = await index();
  return {
    namedTypes: idx.names.size,
    blueprints: idx.blueprints.size,
    outputTypes: idx.outputs.size,
    reprocessingOutputs: idx.reprocessing.size,
  };
}
