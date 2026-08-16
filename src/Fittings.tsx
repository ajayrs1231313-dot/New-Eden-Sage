import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import "./fittings-task11.css";
import { fitFingerprint, parseFits, validateFit, type FitValidationResult } from "./fitting-engine";
import { duplicateFit, ensureFitMeta, exportFitJson, filterAndSortFits, renameFit, summarizeFit, type FitLibraryMetaMap, type FitLibrarySort } from "./fitting-library";
import "./fittings-task12.css";
import "./fittings-layout-v2.css";
import type { FitResolutionIntent, FitRemedyCandidate } from "./types";
import { FittingShowInfo, type ShowInfoTarget } from "./FittingShowInfo";
import fittingStaticTree from "./fitting-static-tree.json";

type FitMutation = { mutaplasmidTypeId: number; mutaplasmidName: string; resultingTypeId: number; resultingTypeName: string };
type FitItem = {
  name: string;
  typeId?: number;
  quantity: number;
  charge?: string;
  chargeTypeId?: number;
  chargeQuantity?: number;
  activeQuantity?: number;
  attributeOverrides?: Record<string, number>;
  mutation?: FitMutation;
  state?: "offline" | "online" | "active" | "overheated";
};
type ModuleState = NonNullable<FitItem["state"]>;
type ExternalEffectKind = "booster" | "projected" | "command" | "environment";
type ExternalEffectSelection = {
  id: string;
  kind: ExternalEffectKind;
  name: string;
  typeId: number;
  chargeName?: string;
  chargeTypeId?: number;
  state?: ModuleState;
  effectiveness?: number;
};
type FitModuleRack = "low" | "mid" | "high" | "rig" | "subsystem";
type FittingPlacement = "ship" | FitModuleRack | "drone" | "fighter" | "implant" | "booster" | "charge" | "cargo";
type FittingSearchResult = { id: number; name: string; groupId: number; categoryId: number; categoryName: string; rack?: FitModuleRack; placement?: FittingPlacement };
type ShipChoice = { typeId: number; name: string };
type BuilderTarget = FitModuleRack | "drones" | "fighters" | "cargo" | "implants" | "boosters";
type MutationAttribute = { attributeId:number; name:string; baseValue:number; minValue:number; maxValue:number; minMultiplier:number; maxMultiplier:number; highIsGood:boolean; unitId?:number };
type MutationOption = { mutaplasmidTypeId:number; mutaplasmidName:string; resultingTypeId:number; resultingTypeName:string; attributes:MutationAttribute[] };
type CatalogueGroup = { id:number; name:string; parentId?:number; iconId?:number };
type CatalogueItem = FittingSearchResult & { marketGroupId:number; rootName:string; metaLevel:number; placement:FittingPlacement };
type FittingCatalogue = { groups:CatalogueGroup[]; items:CatalogueItem[] };
type HullFittingProfile = { slots:{ high:number; mid:number; low:number; rig:number; subsystem:number }; hardpoints:{ turret:number; launcher:number }; storage:{ cargoM3:number; droneBayM3:number; droneBandwidth:number; fighterHangarM3:number; fighterTubes:number } };
type FittingDragPayload = FittingSearchResult & { rootName?:string; marketGroupId?:number; metaLevel?:number };
type FittingPreparationProgress = { percent:number; stage:string; message:string };
type FittingPreparationResult = { catalogue?:FittingCatalogue; preparedAt:string; itemCount:number; groupCount:number; durationMs:number; source?:string };
type FittingStaticTree = { version:number; generatedAt:string; groups:CatalogueGroup[]; groupPlacements:Record<string,FittingPlacement[]>; ships:ShipChoice[] };
const STATIC_FITTING_TREE=fittingStaticTree as FittingStaticTree;
const STATIC_SHIPS=STATIC_FITTING_TREE.ships;
type CatalogueCategoryId =
  | "ammo" | "deployables" | "drones" | "filaments" | "implants"
  | "rigs" | "ship-equipment" | "structure-equipment"
  | "structure-modifications" | "subsystems" | "recent" | "charges-active";
type CatalogueCategory = {
  id: CatalogueCategoryId;
  label: string;
  rootNames?: string[];
  hullFiltered?: boolean;
  dynamic?: "recent" | "charges-active";
};
const PYFA_CATALOGUE_CATEGORIES:CatalogueCategory[]=[
  {id:"ammo",label:"Ammunition & Charges",rootNames:["Ammunition & Charges"]},
  {id:"deployables",label:"Deployable Structures",rootNames:["Deployable Structures"]},
  {id:"drones",label:"Drones",rootNames:["Drones","Fighters"],hullFiltered:true},
  {id:"filaments",label:"Filaments",rootNames:["Filaments"]},
  {id:"implants",label:"Implants & Boosters",rootNames:["Implants & Boosters"]},
  {id:"rigs",label:"Rigs",rootNames:["Rigs"],hullFiltered:true},
  {id:"ship-equipment",label:"Ship Equipment",rootNames:["Ship Equipment"],hullFiltered:true},
  {id:"structure-equipment",label:"Structure Equipment",rootNames:["Structure Equipment"]},
  {id:"structure-modifications",label:"Structure Modifications",rootNames:["Structure Modifications"]},
  {id:"subsystems",label:"Subsystems",rootNames:["Subsystems"],hullFiltered:true},
  {id:"recent",label:"Recently Used Items",dynamic:"recent"},
  {id:"charges-active",label:"Charges For Active Fit",dynamic:"charges-active"},
];
let sharedPreparationPromise:Promise<FittingPreparationResult>|null=null;
let sharedPreparationResult:FittingPreparationResult|null=null;
let sharedStaticItemsPromise:Promise<CatalogueItem[]>|null=null;
function beginSharedFittingPreparation(){if(sharedPreparationResult)return Promise.resolve(sharedPreparationResult);if(typeof window.sage.prepareFittingDataLocal!=="function")return Promise.reject(new Error("Live fitting preparation bridge is not available in this window."));return sharedPreparationPromise ??= window.sage.prepareFittingDataLocal().then(result=>{sharedPreparationResult=result as FittingPreparationResult;return sharedPreparationResult;}).catch(error=>{sharedPreparationPromise=null;throw error;});}
function loadStaticFittingItems(){return sharedStaticItemsPromise ??= import("./fitting-catalogue-items-static.json").then(module=>{const payload=(module as any).default ?? module;return (payload.items ?? []) as CatalogueItem[];});}
type NpcDamagePreset = "omni" | "angel" | "blood-raiders" | "guristas" | "sansha" | "serpentis" | "mordus" | "rogue-drones";
const NPC_DAMAGE_PRESETS: Record<NpcDamagePreset,{label:string;incoming:{em:number;thermal:number;kinetic:number;explosive:number};incomingLabel:string;dealLabel:string}> = {
  omni:{label:"Omni / unknown",incoming:{em:.25,thermal:.25,kinetic:.25,explosive:.25},incomingLabel:"25 / 25 / 25 / 25",dealLabel:"match actual target"},
  angel:{label:"Angel Cartel",incoming:{em:.07,thermal:.09,kinetic:.22,explosive:.62},incomingLabel:"7 EM / 9 TH / 22 KI / 62 EX",dealLabel:"Explosive / Kinetic"},
  "blood-raiders":{label:"Blood Raiders",incoming:{em:.50,thermal:.48,kinetic:.02,explosive:0},incomingLabel:"50 EM / 48 TH / 2 KI",dealLabel:"EM / Thermal"},
  guristas:{label:"Guristas",incoming:{em:.02,thermal:.18,kinetic:.79,explosive:.01},incomingLabel:"2 EM / 18 TH / 79 KI / 1 EX",dealLabel:"Kinetic / Thermal"},
  sansha:{label:"Sansha's Nation",incoming:{em:.53,thermal:.47,kinetic:0,explosive:0},incomingLabel:"53 EM / 47 TH",dealLabel:"EM / Thermal"},
  serpentis:{label:"Serpentis",incoming:{em:0,thermal:.55,kinetic:.45,explosive:0},incomingLabel:"55 TH / 45 KI",dealLabel:"Kinetic / Thermal"},
  mordus:{label:"Mordu's Legion",incoming:{em:0,thermal:.30,kinetic:.70,explosive:0},incomingLabel:"30 TH / 70 KI",dealLabel:"Kinetic / EM"},
  "rogue-drones":{label:"Rogue Drones",incoming:{em:.25,thermal:.25,kinetic:.25,explosive:.25},incomingLabel:"varies by drone",dealLabel:"EM / Thermal"},
};
const NPC_DAMAGE_PRESET_KEYS = Object.keys(NPC_DAMAGE_PRESETS) as NpcDamagePreset[];

const FITTING_DRAG_MIME = "application/x-new-eden-sage-fitting-item";
function writeFittingDrag(event: DragEvent<HTMLElement>, item: FittingDragPayload) {
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(FITTING_DRAG_MIME, JSON.stringify(item));
  event.dataTransfer.setData("text/plain", item.name);
}
function readFittingDrag(event: DragEvent<HTMLElement>): FittingDragPayload | null {
  try {
    const raw = event.dataTransfer.getData(FITTING_DRAG_MIME);
    if (!raw) return null;
    const item = JSON.parse(raw) as FittingDragPayload;
    return Number.isInteger(item.id) && item.id > 0 && typeof item.name === "string" ? item : null;
  } catch {
    return null;
  }
}
type Fit = {
  id: string;
  name: string;
  hull: FitItem;
  low: FitItem[];
  mid: FitItem[];
  high: FitItem[];
  rig: FitItem[];
  subsystem: FitItem[];
  drones: FitItem[];
  fighters: FitItem[];
  cargo: FitItem[];
  implants: FitItem[];
  boosters: FitItem[];
  instructions: string[];
  source: string;
};

const FITTING_APP_INSTRUCTIONS = `NEW EDEN SAGE — UNIVERSAL FIT REQUEST FOR ANY LLM

Paste this entire prompt into ChatGPT, Claude, Gemini or another LLM, then add your ship, activity, skills, budget and constraints.

Return one complete EVE Online fitting. Prefer a single Sage JSON code block using the structure below. Do not put commentary outside the code block. Use exact current EVE item names, realistic quantities and the correct slot groups. Include charges, scripts, probes, nanite paste, drones, fighters, implants, boosters and concise operating instructions when relevant. If a type ID is uncertain, omit it rather than inventing it.

When asking ChatGPT for a fit, request one JSON code block only with no text outside it, using this structure:

{
  "name": "Fit name",
  "ship": { "name": "Ship name", "typeId": 0, "quantity": 1 },
  "modules": {
    "high": [{ "name": "Module", "typeId": 0, "quantity": 1, "charge": "Optional loaded charge" }],
    "mid": [],
    "low": [],
    "rig": [],
    "subsystem": []
  },
  "drones": [{ "name": "Drone", "typeId": 0, "quantity": 5 }],
  "cargo": [{ "name": "Ammo or cargo", "typeId": 0, "quantity": 1000 }],
  "instructions": [
    "Concise operating instruction",
    "Engagement limits, capacitor notes and important warnings"
  ]
}

New Eden Sage also accepts PYFA/EFT text, PYFA XML, ESI fitting JSON, DNA strings, multi-fit exports and clearly labelled plain-text slot sections.`;

function normalizeFit(value: any): Fit {
  return {
    ...value,
    id: String(value?.id ?? crypto.randomUUID()),
    name: String(value?.name ?? "New fitting"),
    hull: value?.hull ?? { name: "Unknown hull", quantity: 1 },
    low: Array.isArray(value?.low) ? value.low : [],
    mid: Array.isArray(value?.mid) ? value.mid : [],
    high: Array.isArray(value?.high) ? value.high : [],
    rig: Array.isArray(value?.rig) ? value.rig : [],
    subsystem: Array.isArray(value?.subsystem) ? value.subsystem : [],
    drones: Array.isArray(value?.drones) ? value.drones : [],
    fighters: Array.isArray(value?.fighters) ? value.fighters : [],
    cargo: Array.isArray(value?.cargo) ? value.cargo : [],
    implants: Array.isArray(value?.implants) ? value.implants : [],
    boosters: Array.isArray(value?.boosters) ? value.boosters : [],
    instructions: Array.isArray(value?.instructions) ? value.instructions.map(String) : [],
    source: String(value?.source ?? ""),
  };
}

const emptyFit = (): Fit => ({
  id: crypto.randomUUID(),
  name: "New fitting",
  hull: { name: "Unknown hull", quantity: 1 },
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
  instructions: [],
  source: "",
});
const imageUrl = (
  typeId: number | undefined,
  variation: "icon" | "render",
  size: number,
) =>
  typeId
    ? `sage-asset://type/${typeId}/${variation}?size=${size}`
    : "";

function parseItem(value: unknown): FitItem {
  if (typeof value === "string") return parseEftItem(value);
  const item = value as {
    name?: string;
    typeName?: string;
    type_id?: number;
    typeId?: number;
    quantity?: number;
    charge?: string;
    chargeQuantity?: number;
    activeQuantity?: number;
    attributeOverrides?: Record<string, number>;
    mutatedAttributes?: Record<string, number>;
    mutation?: FitMutation;
  };
  return {
    name: item.name ?? item.typeName ?? "Unknown item",
    typeId: item.typeId ?? item.type_id,
    quantity: item.quantity ?? 1,
    charge: item.charge,
    chargeQuantity: item.chargeQuantity,
    activeQuantity: item.activeQuantity,
    attributeOverrides: item.attributeOverrides ?? item.mutatedAttributes,
    mutation: item.mutation,
  };
}

function parseEftItem(line: string): FitItem {
  const quantityMatch = line.match(/\s+x(\d+)\s*$/i);
  const quantity = quantityMatch ? Number(quantityMatch[1]) : 1;
  const clean = line.replace(/\s+x\d+\s*$/i, "").trim();
  const [name, ...charge] = clean.split(",").map((part) => part.trim());
  return { name, quantity, charge: charge.join(", ") || undefined };
}

function parseFit(text: string): Fit {
  const trimmed = text
    .trim()
    .replace(/^```(?:json|eft)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
  if (trimmed.startsWith("{")) {
    const raw = JSON.parse(trimmed) as Record<string, any>;
    const modules = raw.modules ?? raw;
    const hull = parseItem(raw.ship ?? raw.hull ?? "Unknown hull");
    return {
      id: crypto.randomUUID(),
      name: raw.name ?? `${hull.name} fitting`,
      hull,
      low: (modules.low ?? []).map(parseItem),
      mid: (modules.mid ?? []).map(parseItem),
      high: (modules.high ?? []).map(parseItem),
      rig: (modules.rig ?? []).map(parseItem),
      subsystem: (modules.subsystem ?? []).map(parseItem),
      drones: (raw.drones ?? []).map(parseItem),
      fighters: (raw.fighters ?? []).map(parseItem),
      cargo: (raw.cargo ?? []).map(parseItem),
      implants: (raw.implants ?? []).map(parseItem),
      boosters: (raw.boosters ?? []).map(parseItem),
      instructions: (raw.instructions ?? []).map(String),
      source: text,
    };
  }
  const lines = trimmed.split(/\r?\n/);
  const header = lines.shift()?.match(/^\[(.+?),\s*(.+?)\]$/);
  if (!header)
    throw new Error(
      "Use an EFT fit beginning with [Ship, Fit name], or a Sage JSON fit block.",
    );
  const groups: string[][] = [[]];
  for (const line of lines) {
    if (!line.trim()) {
      if (groups.at(-1)?.length) groups.push([]);
      continue;
    }
    if (!/^\[Empty .* slot\]$/i.test(line.trim()))
      groups.at(-1)!.push(line.trim());
  }
  const [
    low = [],
    mid = [],
    high = [],
    rig = [],
    subsystem = [],
    drones = [],
    cargo = [],
  ] = groups.filter((group) => group.length);
  return {
    id: crypto.randomUUID(),
    name: header[2],
    hull: { name: header[1], quantity: 1 },
    low: low.map(parseEftItem),
    mid: mid.map(parseEftItem),
    high: high.map(parseEftItem),
    rig: rig.map(parseEftItem),
    subsystem: subsystem.map(parseEftItem),
    drones: drones.map(parseEftItem),
    fighters: [],
    cargo: cargo.map(parseEftItem),
    implants: [],
    boosters: [],
    instructions: [],
    source: text,
  };
}

function resolveFit(fit: Fit, names: Map<string, number>) {
  const resolve = (item: FitItem) => ({
    ...item,
    typeId:
      item.typeId && item.typeId > 0
        ? item.typeId
        : names.get(item.name.toLowerCase()),
    chargeTypeId: item.charge ? (names.get(item.charge.toLowerCase()) ?? item.chargeTypeId) : item.chargeTypeId,
  });
  return {
    ...fit,
    hull: resolve(fit.hull),
    low: (fit.low ?? []).map(resolve),
    mid: (fit.mid ?? []).map(resolve),
    high: (fit.high ?? []).map(resolve),
    rig: (fit.rig ?? []).map(resolve),
    subsystem: (fit.subsystem ?? []).map(resolve),
    drones: (fit.drones ?? []).map(resolve),
    fighters: (fit.fighters ?? []).map(resolve),
    cargo: (fit.cargo ?? []).map(resolve),
    implants: (fit.implants ?? []).map(resolve),
    boosters: (fit.boosters ?? []).map(resolve),
  };
}

function fitItems(fit: Fit) {
  return [
    fit.hull,
    ...fit.low,
    ...fit.mid,
    ...fit.high,
    ...fit.rig,
    ...fit.subsystem,
    ...fit.drones,
    ...fit.fighters,
    ...fit.cargo,
    ...fit.implants,
    ...fit.boosters,
  ];
}

async function resolveFitFromEve(fit: Fit, known: Map<string, number>) {
  let locallyResolved: Fit = resolveFit(normalizeFit(fit), known);
  const idItems = fitItems(locallyResolved).filter((item) => item.typeId && /^Type \d+$/i.test(item.name));
  if (idItems.length) {
    const byId = new Map((await window.sage.resolveTypeIds([...new Set(idItems.map((item) => item.typeId!))])).map((item) => [item.id, item.name]));
    const rename = (item: FitItem) => item.typeId && byId.has(item.typeId) ? { ...item, name: byId.get(item.typeId)! } : item;
    locallyResolved = { ...locallyResolved, hull: rename(locallyResolved.hull), low: locallyResolved.low.map(rename), mid: locallyResolved.mid.map(rename), high: locallyResolved.high.map(rename), rig: locallyResolved.rig.map(rename), subsystem: locallyResolved.subsystem.map(rename), drones: locallyResolved.drones.map(rename), fighters: locallyResolved.fighters.map(rename), cargo: locallyResolved.cargo.map(rename), implants: locallyResolved.implants.map(rename), boosters: locallyResolved.boosters.map(rename) };
  }
  const missing = [
    ...new Set(
      fitItems(locallyResolved)
        .filter((item) => !item.typeId)
        .map((item) => item.name),
    ),
  ];
  for (const item of fitItems(locallyResolved)) if (item.charge && !item.chargeTypeId) missing.push(item.charge);

  // Always ask the local SDE for bay-item metadata. EFT omits empty sections, so
  // blank-line position alone cannot reliably distinguish drones/fighters from cargo.
  const allNames = fitItems(locallyResolved).map((item) => item.name);
  const lookupNames = [...new Set([...missing, ...allNames])];
  const resolved = lookupNames.length ? await window.sage.resolveFittingTypeNamesLocal(lookupNames) : [];
  const names = new Map(known);
  for (const item of resolved) names.set(item.name.toLowerCase(), item.id);
  const withIds = resolveFit(locallyResolved, names);
  const metadata = new Map(resolved.map((item: any) => [item.name.toLowerCase(), item]));
  const drones: FitItem[] = [...withIds.drones];
  const fighters: FitItem[] = [...withIds.fighters];
  const cargo: FitItem[] = [];
  const movedRacks: Record<FitModuleRack, FitItem[]> = { low: [], mid: [], high: [], rig: [], subsystem: [] };
  const implants: FitItem[] = [...withIds.implants];
  const boosters: FitItem[] = [...withIds.boosters];
  const classifyCargo = (item: FitItem) => {
    const info: any = metadata.get(item.name.toLowerCase());
    if (!info) { cargo.push(item); return; }
    const category = String(info.categoryName ?? "").toLowerCase();
    if (category === "drone") drones.push(item);
    else if (category === "fighter") fighters.push(item);
    else if (info.rack && movedRacks[info.rack as FitModuleRack]) movedRacks[info.rack as FitModuleRack].push(item);
    else if (category.includes("implant")) implants.push(item);
    else cargo.push(item);
  };
  withIds.cargo.forEach(classifyCargo);
  return { ...withIds, low: [...withIds.low, ...movedRacks.low], mid: [...withIds.mid, ...movedRacks.mid], high: [...withIds.high, ...movedRacks.high], rig: [...withIds.rig, ...movedRacks.rig], subsystem: [...withIds.subsystem, ...movedRacks.subsystem], drones, fighters, cargo, implants, boosters };
}

export function FittingsWorkspace({ onExportToPlanner }: { onExportToPlanner?: (intent: FitResolutionIntent) => void }) {
  const [fits, setFits] = useState<Fit[]>(() => {
    try {
      return (JSON.parse(localStorage.getItem("new-eden-sage-fits") ?? "[]") as any[]).map(normalizeFit);
    } catch {
      return [];
    }
  });
  const [activeId, setActiveId] = useState(fits[0]?.id ?? "");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState(
    "Paste an EFT or Sage JSON fitting block from ChatGPT.",
  );
  const [typeNames, setTypeNames] = useState(new Map<string, number>());
  const [characters, setCharacters] = useState<
    Array<{ characterId: string; character: { name: string } }>
  >([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [routeOpen, setRouteOpen] = useState(false);
  const [sideMode, setSideMode] = useState<"build" | "import">("build");
  const [showInfoTarget, setShowInfoTarget] = useState<ShowInfoTarget | null>(null);
  const [lastValidation, setLastValidation] = useState<FitValidationResult | null>(null);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [librarySort, setLibrarySort] = useState<FitLibrarySort>("recent");
  const [libraryMeta, setLibraryMeta] = useState<FitLibraryMetaMap>(() => {
    try { return JSON.parse(localStorage.getItem("new-eden-sage-fit-library-meta") ?? "{}"); } catch { return {}; }
  });
  useEffect(() => {
    window.sage.listSnapshots().then((loaded) => {
      setCharacters(loaded);
      setSelectedCharacterId(
        (current) => current || loaded[0]?.characterId || "",
      );
    });
  }, []);
  useEffect(() => {
    localStorage.setItem("new-eden-sage-fits", JSON.stringify(fits));
    setLibraryMeta((current) => ensureFitMeta(fits, current));
  }, [fits]);
  useEffect(() => {
    let cancelled = false;
    const migrateLegacyFighters = async () => {
      const names = [...new Set(fits.flatMap((fit) => fit.drones.map((item) => item.name)).filter(Boolean))];
      if (!names.length) return;
      try {
        const resolved = await window.sage.resolveFittingTypeNamesLocal(names);
        if (cancelled) return;
        const fighterIds = new Set((resolved as any[]).filter((item) => String(item.categoryName ?? "").toLowerCase() === "fighter").map((item) => Number(item.id)));
        const fighterNames = new Set((resolved as any[]).filter((item) => String(item.categoryName ?? "").toLowerCase() === "fighter").map((item) => String(item.name ?? "").toLowerCase()));
        if (!fighterIds.size && !fighterNames.size) return;
        setFits((current) => current.map((fit) => {
          const moved = fit.drones.filter((item) => (item.typeId && fighterIds.has(item.typeId)) || fighterNames.has(item.name.toLowerCase()));
          if (!moved.length) return fit;
          const retained = fit.drones.filter((item) => !moved.includes(item));
          const fighters = [...fit.fighters];
          for (const fighter of moved) {
            const existing = fighters.findIndex((item) => (fighter.typeId && item.typeId === fighter.typeId) || (!fighter.typeId && item.name.toLowerCase() === fighter.name.toLowerCase()));
            if (existing >= 0) fighters[existing] = { ...fighters[existing], quantity: fighters[existing].quantity + fighter.quantity, activeQuantity: Math.max(fighters[existing].activeQuantity ?? 0, fighter.activeQuantity ?? 0) };
            else fighters.push({ ...fighter, activeQuantity: fighter.activeQuantity ?? Math.min(1, fighter.quantity) });
          }
          return { ...fit, drones: retained, fighters };
        }));
      } catch {
        // Legacy fits remain usable as drone-bay records if local SDE classification is temporarily unavailable.
      }
    };
    void migrateLegacyFighters();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    localStorage.setItem("new-eden-sage-fit-library-meta", JSON.stringify(libraryMeta));
  }, [libraryMeta]);
  useEffect(() => {
    void window.sage.syncMcpRendererData({ savedFits: fits, fitLibraryMeta: libraryMeta });
  }, [fits, libraryMeta]);
  useEffect(() => window.sage.onMcpFitDataUpdated((value) => {
    if (Array.isArray(value.savedFits)) setFits(value.savedFits as Fit[]);
    if (value.fitLibraryMeta && typeof value.fitLibraryMeta === "object") setLibraryMeta(value.fitLibraryMeta as FitLibraryMetaMap);
  }), []);
  // Saved fits render immediately. Resolving the complete CCP DOGMA index on
  // mount used to freeze the entire app the first time Fittings was opened.
  // Type resolution now happens only when a fit is imported or analyzed.
  const active = useMemo(
    () => fits.find((fit) => fit.id === activeId) ?? fits[0],
    [fits, activeId],
  );
  const visibleFits = useMemo(() => filterAndSortFits(fits, libraryMeta, libraryQuery, librarySort), [fits, libraryMeta, libraryQuery, librarySort]);
  async function importFit() {
    try {
      const parsedFits = parseFits(input) as Fit[];
      const preflights = parsedFits.map(validateFit);
      const blocked = preflights.find((result) => !result.valid);
      setLastValidation(blocked ?? preflights[0] ?? null);
      if (blocked) {
        setStatus(`Import blocked: ${blocked.errors.map((issue) => issue.message).join("  ")}`);
        return;
      }
      const resolved = await Promise.all(parsedFits.map((fit) => resolveFitFromEve(fit, typeNames)));
      const existing = new Set(fits.map(fitFingerprint));
      const unique = resolved.filter((fit) => { const key = fitFingerprint(fit); if (existing.has(key)) return false; existing.add(key); return true; });
      const duplicateCount = resolved.length - unique.length;
      if (!unique.length) { setStatus(`Import skipped: ${duplicateCount} duplicate fitting${duplicateCount === 1 ? "" : "s"} already exist.`); return; }
      const validations = unique.map(validateFit);
      setLastValidation(validations.find((result) => result.issues.length) ?? validations[0]);
      setFits((current) => [...unique, ...current]);
      setActiveId(unique[0].id);
      const unresolved = unique.reduce((total, fit) => total + fitItems(fit).filter((item) => !item.typeId).length, 0);
      setStatus(`Imported ${unique.length} fitting${unique.length === 1 ? "" : "s"}. ${duplicateCount ? `${duplicateCount} duplicate${duplicateCount === 1 ? " was" : "s were"} skipped. ` : ""}${unresolved} item name(s) remain unresolved.`);
      setInput("");
    } catch (error) {
      setLastValidation(null);
      setStatus(
        error instanceof Error
          ? error.message
          : "The fitting could not be imported.",
      );
    }
  }
  function touchFit(id: string) {
    setLibraryMeta((current) => ({ ...current, [id]: { ...(current[id] ?? { createdAt: new Date().toISOString() }), updatedAt: new Date().toISOString(), readiness: "unknown" } }));
  }

  function createBuilderFit(ship: ShipChoice, name?: string) {
    const fit: Fit = { ...emptyFit(), name: name?.trim() || `${ship.name} fitting`, hull: { name: ship.name, typeId: ship.typeId, quantity: 1 }, source: "Sage Fit Builder" };
    setFits((current) => [fit, ...current]);
    setActiveId(fit.id);
    touchFit(fit.id);
    setStatus(`Created ${fit.name}. Add modules, drones and cargo from the builder.`);
  }

  async function addBuilderItem(target: BuilderTarget, item: FittingSearchResult, mutation?: { option: MutationOption; values: Record<string, number> }) {
    if (!active) return false;
    if (active.hull.typeId && item.id && item.placement !== "charge" && target !== "cargo" && typeof window.sage.checkFittingItemCompatibilityLocal === "function") {
      const placement:FittingPlacement = target === "drones" ? "drone" : target === "fighters" ? "fighter" : target === "implants" ? "implant" : target === "boosters" ? "booster" : target;
      const fitted=(["high","mid","low","rig","subsystem"] as const).flatMap(rack=>active[rack].flatMap(candidate=>candidate.typeId?[{typeId:candidate.typeId,rack}]:[]));
      try { const legality=await window.sage.checkFittingItemCompatibilityLocal({hullTypeId:active.hull.typeId,itemTypeId:item.id,placement,fitted}); if(!legality.compatible){setStatus(legality.reason);return false;} }
      catch(error){ setStatus(error instanceof Error ? error.message : "Could not validate this item against the selected hull."); return false; }
    }
    if (["low", "mid", "high", "rig", "subsystem"].includes(target)) {
      if (!item.rack || item.rack !== target) {
        setStatus(`${item.name} belongs in the ${item.rack ?? "non-module"} section, not the ${target} rack.`);
        return false;
      }
      if (active.hull.typeId && typeof window.sage.getHullFittingProfileLocal === "function") {
        try {
          const profile = await window.sage.getHullFittingProfileLocal(active.hull.typeId);
          const limit = profile.slots[target as FitModuleRack] ?? 0;
          if (limit > 0 && active[target].length >= limit) {
            setStatus(`${active.hull.name} has no empty ${target} slots for ${item.name}.`);
            return false;
          }
        } catch {
          // The fitting analysis remains authoritative if the hull profile is temporarily unavailable.
        }
      }
    }
    const placementTarget:Partial<Record<FittingPlacement,BuilderTarget>> = { high:"high", mid:"mid", low:"low", rig:"rig", subsystem:"subsystem", drone:"drones", fighter:"fighters", implant:"implants", booster:"boosters", cargo:"cargo" };
    const expectedTarget = item.placement ? placementTarget[item.placement] : undefined;
    if (expectedTarget && expectedTarget !== target && item.placement !== "charge") { setStatus(`${item.name} belongs in ${expectedTarget}, not ${target}.`); return false; }
    if (target === "drones" && item.placement && item.placement !== "drone") { setStatus(`${item.name} is not a drone.`); return false; }
    if (target === "fighters" && item.placement && item.placement !== "fighter") { setStatus(`${item.name} is not a fighter.`); return false; }
    if (target === "implants" && item.placement && item.placement !== "implant") { setStatus(`${item.name} is not an implant.`); return false; }
    if (target === "boosters" && item.placement && item.placement !== "booster") { setStatus(`${item.name} is not a booster.`); return false; }
    if ((target === "implants" || target === "boosters") && active[target].some(candidate => candidate.typeId === item.id)) { setStatus(`${item.name} is already assigned to this fit.`); return false; }
    const additionTarget = target === "drones" || target === "fighters" || target === "cargo" || target === "implants" || target === "boosters";
    const nextItem: FitItem = { name: mutation ? item.name + " [Abyssal]" : item.name, typeId: item.id, quantity: 1, activeQuantity: target === "fighters" ? 1 : undefined, attributeOverrides: mutation?.values, mutation: mutation ? { mutaplasmidTypeId: mutation.option.mutaplasmidTypeId, mutaplasmidName: mutation.option.mutaplasmidName, resultingTypeId: mutation.option.resultingTypeId, resultingTypeName: mutation.option.resultingTypeName } : undefined, state: target === "rig" || target === "subsystem" ? "online" : additionTarget ? undefined : "active" };
    setFits((current) => current.map((fit) => {
      if (fit.id !== active.id) return fit;
      const list = fit[target];
      if (target === "drones" || target === "fighters" || target === "cargo") {
        const existing = list.findIndex((candidate) => candidate.typeId === item.id);
        if (existing >= 0) return { ...fit, [target]: list.map((candidate, index) => index === existing ? { ...candidate, quantity: candidate.quantity + 1 } : candidate) };
      }
      return { ...fit, [target]: [...list, nextItem] };
    }));
    touchFit(active.id);
    setStatus(`Added ${item.name} to ${target}.`);
    return true;
  }

  function removeBuilderItem(target: BuilderTarget, index: number) {
    if (!active) return;
    setFits((current) => current.map((fit) => fit.id !== active.id ? fit : { ...fit, [target]: fit[target].filter((_, itemIndex) => itemIndex !== index) }));
    touchFit(active.id);
  }

  function setBuilderItemQuantity(target: "drones" | "cargo", index: number, quantity: number) {
    if (!active) return;
    const safe = Math.max(1, Math.floor(quantity || 1));
    setFits((current) => current.map((fit) => fit.id !== active.id ? fit : { ...fit, [target]: fit[target].map((item, itemIndex) => itemIndex === index ? { ...item, quantity: safe } : item) }));
    touchFit(active.id);
  }

  function setBuilderItemState(target: FitModuleRack, index: number, state: ModuleState) {
    if (!active) return;
    setFits((current) => current.map((fit) => fit.id !== active.id ? fit : { ...fit, [target]: fit[target].map((item, itemIndex) => itemIndex === index ? { ...item, state } : item) }));
    touchFit(active.id);
  }

  async function loadBuilderCharge(target: FitModuleRack, index: number, item: FittingSearchResult) {
    if (!active) return false;
    const module = active[target][index];
    if (!module?.typeId) { setStatus("That fitted module has no resolved type ID, so Sage cannot validate a charge for it."); return false; }
    if (item.categoryId !== 8) { setStatus(`${item.name} is not ammunition or a charge.`); return false; }
    try {
      const check = await window.sage.checkFittingChargeCompatibilityLocal(module.typeId, item.id);
      if (!check.compatible) { setStatus(check.reason); return false; }
      setFits((current) => current.map((fit) => fit.id !== active.id ? fit : { ...fit, [target]: fit[target].map((candidate, itemIndex) => itemIndex === index ? { ...candidate, charge: item.name, chargeTypeId: item.id } : candidate) }));
      touchFit(active.id);
      setStatus(`Loaded ${item.name} into ${module.name}.`);
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not validate that charge against the selected module.");
      return false;
    }
  }

  function removeFit(id: string) {
    setFits((current) => current.filter((fit) => fit.id !== id));
    setLibraryMeta((current) => { const next = { ...current }; delete next[id]; return next; });
    if (activeId === id) setActiveId("");
  }
  function setActiveModuleState(rack: FitModuleRack, index: number, state: ModuleState) {
    if (!active) return;
    const itemName = active[rack][index]?.name ?? "Module";
    setFits((current) => current.map((fit) => {
      if (fit.id !== active.id) return fit;
      const next: Fit = { ...fit };
      next[rack] = fit[rack].map((item, itemIndex) => itemIndex === index ? { ...item, state } : item);
      return next;
    }));
    setLibraryMeta((current) => ({
      ...current,
      [active.id]: {
        ...(current[active.id] ?? { createdAt: new Date().toISOString() }),
        updatedAt: new Date().toISOString(),
      },
    }));
    setStatus(`${itemName} set ${state}. Performance analysis will use this module state.`);
  }
  function setActiveBayQuantity(target: "drones" | "fighters", index: number, activeQuantity: number) {
    if (!active) return;
    const bayItem = active[target][index];
    if (!bayItem) return;
    const quantity = Math.max(0, Math.min(bayItem.quantity, Math.floor(activeQuantity)));
    setFits((current) => current.map((fit) => fit.id !== active.id ? fit : ({ ...fit, [target]: fit[target].map((item, itemIndex) => itemIndex === index ? { ...item, activeQuantity: quantity } : item) })));
    setLibraryMeta((current) => ({ ...current, [active.id]: { ...(current[active.id] ?? { createdAt: new Date().toISOString() }), updatedAt: new Date().toISOString() } }));
    setStatus(`${bayItem.name}: ${quantity} active in ${target} for performance analysis.`);
  }
  function renameActiveFit() {
    if (!active) return;
    const nextName = window.prompt("Rename fitting", active.name);
    if (nextName == null) return;
    try {
      const renamed = normalizeFit(renameFit(active, nextName));
      setFits((current) => current.map((fit) => fit.id === active.id ? renamed : fit));
      setLibraryMeta((current) => ({ ...current, [active.id]: { ...(current[active.id] ?? { createdAt: new Date().toISOString() }), updatedAt: new Date().toISOString() } }));
      setStatus(`Renamed fitting to ${renamed.name}.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not rename fitting."); }
  }
  function duplicateActiveFit() {
    if (!active) return;
    const copy = normalizeFit(duplicateFit(active));
    setFits((current) => [copy, ...current]);
    setActiveId(copy.id);
    setLibraryMeta((current) => ({ ...current, [copy.id]: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), readiness: "unknown" } }));
    setStatus(`Duplicated ${active.name}.`);
  }
  async function exportActiveFit() {
    if (!active) return;
    const verified = await window.sage.copyText(exportFitJson(active));
    setStatus(verified ? `${active.name} Sage JSON copied.` : "Clipboard verification failed.");
  }
  async function copyChatGPTInstructions() {
    const verified = await window.sage.copyText(FITTING_APP_INSTRUCTIONS);
    setStatus(
      verified
        ? "Fitting instructions copied and verified."
        : "Clipboard verification failed.",
    );
  }
  if (routeOpen && active)
    return (
      <FitRouteScreen
        fit={active}
        characters={characters}
        onBack={() => setRouteOpen(false)}
      />
    );
  return (
    <section className="fit-workspace fit-workspace-v2">
      <div className="fit-v2-toolbar">
        <label>Saved fit<select value={active?.id ?? ""} onChange={(event) => setActiveId(event.target.value)}><option value="">Select fitting...</option>{fits.map((fit) => <option key={fit.id} value={fit.id}>{fit.name} · {fit.hull.name}</option>)}</select></label>
        <button type="button" className={sideMode === "build" ? "active" : ""} onClick={() => setSideMode("build")}>Modules</button>
        <button type="button" className={sideMode === "import" ? "active" : ""} onClick={() => setSideMode("import")}>Import</button>
      </div>
      <aside className="fit-v2-browser">
        {sideMode === "build" ? (
          <FitBuilder fit={active} onCreate={createBuilderFit} onAdd={addBuilderItem} onRemove={removeBuilderItem} onQuantity={setBuilderItemQuantity} onState={setBuilderItemState} onCharge={loadBuilderCharge} onShowInfo={(typeId,name) => setShowInfoTarget({typeId,name})} />
        ) : (
          <div className="fit-v2-import"><p className="eyebrow">UNIVERSAL FIT IMPORT</p><h3>Paste a fit from anywhere</h3><button type="button" className="copy-fit-prompt" onClick={() => void copyChatGPTInstructions()}>Copy prompt for any LLM</button><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder={'Paste PYFA/EFT, XML, ESI JSON, DNA, Sage JSON, or a labelled plain-text fit…'} /><label className="copy-fit-prompt">Choose fitting file<input type="file" accept=".eft,.fit,.txt,.json,.xml,.dna" hidden onChange={async (event) => { const file=event.target.files?.[0]; if(!file)return; try{setInput(await file.text());setStatus(file.name+' loaded locally. Review it, then import.');}catch{setStatus('Could not read '+file.name+'.');} event.target.value=''; }} /></label><button type="button" onClick={() => void importFit()} disabled={!input.trim()}>Import and display</button><small>{status}</small>{lastValidation && lastValidation.issues.length > 0 && <div className="fit-validation"><strong>{lastValidation.valid ? "Validation report" : "Import blocked"}</strong>{lastValidation.issues.slice(0,6).map((issue,index)=><p className={issue.level} key={issue.code+index}>{issue.message}</p>)}</div>}</div>
        )}
      </aside>
      <div className="fit-main">
        {active ? <FitDisplay fit={active} characters={characters} characterId={selectedCharacterId} onCharacterChange={setSelectedCharacterId} onRemove={() => removeFit(active.id)} onRoute={() => setRouteOpen(true)} onRename={renameActiveFit} onDuplicate={duplicateActiveFit} onExport={exportActiveFit} onModuleStateChange={setActiveModuleState} onBayActiveQuantityChange={setActiveBayQuantity} onRemoveItem={removeBuilderItem} onAddItem={addBuilderItem} onLoadCharge={loadBuilderCharge} onAnalysis={(readiness, missingRequirements) => setLibraryMeta((current) => ({ ...current, [active.id]: { ...(current[active.id] ?? { createdAt: new Date().toISOString() }), updatedAt: new Date().toISOString(), lastAnalyzedAt: new Date().toISOString(), readiness, missingRequirements } }))} onExportToPlanner={(intent) => onExportToPlanner?.(intent)} onShowInfo={(typeId,name) => setShowInfoTarget({typeId,name})} /> : <div className="fit-empty"><h2>No fitting selected</h2><p>Create a fit from the module browser or import one.</p></div>}
      </div>
      <FittingShowInfo target={showInfoTarget} onClose={() => setShowInfoTarget(null)} />
    </section>
  );
}

function FitBuilder({ fit, onCreate, onAdd, onRemove, onQuantity, onState, onCharge, onShowInfo }: { fit?: Fit; onCreate(ship: ShipChoice, name?: string): void; onAdd(target: BuilderTarget, item: FittingSearchResult, mutation?: { option: MutationOption; values: Record<string, number> }): Promise<boolean>; onRemove(target: BuilderTarget, index: number): void; onQuantity(target: "drones" | "cargo", index: number, quantity: number): void; onState(target: FitModuleRack, index: number, state: ModuleState): void; onCharge(target: FitModuleRack, index: number, item: FittingSearchResult): Promise<boolean>; onShowInfo(typeId:number,name?:string):void; }) {
  const [ships, setShips] = useState<ShipChoice[]>(STATIC_SHIPS);
  const [browserTab, setBrowserTab] = useState<"catalogue" | "ships">(fit ? "catalogue" : "ships");
  const [hullQuery, setHullQuery] = useState("");
  const [fitName, setFitName] = useState("");
  const [catalogue, setCatalogue] = useState<FittingCatalogue>(()=>({groups:STATIC_FITTING_TREE.groups,items:[]}));
  const [catalogueSource, setCatalogueSource] = useState<"tree"|"cached"|"live">(sharedPreparationResult?"live":"tree");
  const [catalogueFilter, setCatalogueFilter] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(() => new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<CatalogueCategoryId>>(() => new Set());
  const [mutationMenu, setMutationMenu] = useState<{ x:number; y:number; item:FittingSearchResult }>();
  const [mutationEditor, setMutationEditor] = useState<{ item:FittingSearchResult; options:MutationOption[]; selected:number; values:Record<string,number> }>();
  const [mutationStatus, setMutationStatus] = useState("");
  const [catalogueStatus, setCatalogueStatus] = useState("");
  const [preparation, setPreparation] = useState<FittingPreparationProgress>(()=>sharedPreparationResult?{percent:100,stage:"ready",message:"Fitting data ready"}:{percent:4,stage:"metadata",message:"Preparing fitting data…"});
  const [progressVisible, setProgressVisible] = useState(!sharedPreparationResult);
  const [compatibilityCache, setCompatibilityCache] = useState<Record<string,number[]>>({});
  const [compatibilityPendingKeys, setCompatibilityPendingKeys] = useState<Set<string>>(() => new Set());
  const [activeChargeTypeIds, setActiveChargeTypeIds] = useState<number[]>([]);
  const [activeChargesPending, setActiveChargesPending] = useState(false);
  const [recentTypeIds, setRecentTypeIds] = useState<number[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem("new-eden-sage-fitting-recent-types") ?? "[]");
      return Array.isArray(parsed) ? parsed.map(Number).filter(id=>Number.isInteger(id)&&id>0).slice(0,50) : [];
    } catch { return []; }
  });
  const liveReadyRef=useRef(Boolean(sharedPreparationResult));

  useEffect(() => {
    void window.sage.listShips().then((items: ShipChoice[]) => { if(items.length)setShips(items); }).catch(()=>undefined);
  }, []);
  useEffect(() => {
    if (!fit) setBrowserTab("ships");
  }, [fit?.id]);
  useEffect(() => {
    localStorage.setItem("new-eden-sage-fitting-recent-types", JSON.stringify(recentTypeIds.slice(0,50)));
  }, [recentTypeIds]);
  useEffect(() => {
    let cancelled=false;
    const timer=window.setTimeout(()=>{
      void loadStaticFittingItems().then(items=>{
        if(cancelled||liveReadyRef.current)return;
        setCatalogue(current=>({groups:current.groups,items}));
        setCatalogueSource("cached");
      }).catch(()=>{ if(!cancelled)setCatalogueStatus("Packaged module cache is unavailable; navigation remains ready while current fitting data loads."); });
    },0);
    return()=>{cancelled=true;window.clearTimeout(timer);};
  },[]);
  useEffect(() => {
    let cancelled=false; let hideTimer:number|undefined;
    if(sharedPreparationResult){
      liveReadyRef.current=true;
      if(sharedPreparationResult.catalogue){setCatalogue(sharedPreparationResult.catalogue);setCatalogueSource("live");}
      setProgressVisible(false);
      return;
    }
    const unsubscribe=typeof window.sage.onFittingPreparationProgress==="function"?window.sage.onFittingPreparationProgress((value)=>{
      if(cancelled)return;
      const next=value as FittingPreparationProgress;
      if(Number.isFinite(next?.percent))setPreparation(next);
    }):()=>undefined;
    void beginSharedFittingPreparation().then(result=>{
      if(cancelled)return;
      liveReadyRef.current=true;
      if(result.catalogue){setCatalogue(result.catalogue);setCatalogueSource("live");}
      setPreparation({percent:100,stage:"ready",message:"Fitting data ready"});
      hideTimer=window.setTimeout(()=>setProgressVisible(false),900);
    }).catch(error=>{
      if(cancelled)return;
      setProgressVisible(false);
      setCatalogueStatus(error instanceof Error ? error.message + " Using packaged fitting navigation/data where available." : "Live fitting refresh is unavailable; using packaged fitting data.");
    });
    return()=>{cancelled=true;unsubscribe();if(hideTimer)window.clearTimeout(hideTimer);};
  },[]);

  const hullMatches = useMemo(() => {
    const query = hullQuery.trim().toLowerCase();
    if (query.length < 1) return ships.slice(0,80);
    return ships.filter((ship) => ship.name.toLowerCase().includes(query)).sort((a,b)=>(a.name.toLowerCase().startsWith(query)?0:1)-(b.name.toLowerCase().startsWith(query)?0:1)||a.name.localeCompare(b.name)).slice(0,120);
  }, [ships, hullQuery]);

  const childrenByParent=useMemo(()=>{const map=new Map<number,CatalogueGroup[]>();for(const group of catalogue.groups){if(group.parentId==null)continue;const list=map.get(group.parentId)??[];list.push(group);map.set(group.parentId,list);}for(const list of map.values())list.sort((a,b)=>a.name.localeCompare(b.name));return map;},[catalogue.groups]);
  const itemById=useMemo(()=>new Map(catalogue.items.map(item=>[item.id,item])),[catalogue.items]);
  const fittedPayload=useMemo(()=>fit?(["high","mid","low","rig","subsystem"] as const).flatMap(rack=>fit[rack].flatMap(item=>item.typeId?[{typeId:item.typeId,rack}]:[])):[],[fit?.high,fit?.mid,fit?.low,fit?.rig,fit?.subsystem]);
  const fittedHash=useMemo(()=>fittedPayload.map(item=>item.rack+":"+item.typeId).join("|"),[fittedPayload]);
  const fittedModuleTypeIds=useMemo(()=>[...new Set(fittedPayload.map(item=>item.typeId))],[fittedHash]);
  const activeChargeSet=useMemo(()=>new Set(activeChargeTypeIds),[activeChargeTypeIds]);
  const compatibilityBridgeAvailable=typeof window.sage.filterFittingItemsForHullLocal==="function";

  const rawItemsForCategory=(category:CatalogueCategory):CatalogueItem[]=>{
    if(category.dynamic==="recent") return recentTypeIds.flatMap(id=>{const item=itemById.get(id);return item&&item.placement!=="ship"?[item]:[];});
    if(category.dynamic==="charges-active") return catalogue.items.filter(item=>item.rootName==="Ammunition & Charges"&&activeChargeSet.has(item.id));
    const roots=new Set(category.rootNames??[]);
    return catalogue.items.filter(item=>roots.has(item.rootName));
  };
  const compatibilityKeyFor=(category:CatalogueCategory,items:CatalogueItem[])=>{
    if(!fit?.hull.typeId||!category.hullFiltered||!compatibilityBridgeAvailable||!items.length)return "";
    const hash=items.reduce((value,item)=>((value*33)^item.id)>>>0,5381);
    return fit.hull.typeId+":"+category.id+":"+hash+":"+fittedHash;
  };
  const ensureCategoryCompatibility=async(category:CatalogueCategory)=>{
    const items=rawItemsForCategory(category);
    const key=compatibilityKeyFor(category,items);
    if(!key||compatibilityCache[key]||compatibilityPendingKeys.has(key)||typeof window.sage.filterFittingItemsForHullLocal!=="function"||!fit?.hull.typeId)return;
    setCompatibilityPendingKeys(current=>{const next=new Set(current);next.add(key);return next;});
    try{
      const chunks:CatalogueItem[][]=[];
      for(let index=0;index<items.length;index+=800)chunks.push(items.slice(index,index+800));
      const results=await Promise.all(chunks.map(chunk=>window.sage.filterFittingItemsForHullLocal({hullTypeId:fit.hull.typeId!,candidates:chunk.map(item=>({typeId:item.id,placement:item.placement})),fitted:fittedPayload})));
      const compatible=[...new Set(results.flatMap(result=>result.compatibleTypeIds))];
      setCompatibilityCache(current=>({...current,[key]:compatible}));
    }catch{
      setCatalogueStatus("Ship compatibility filtering is still preparing; fitting validation remains enforced when an item is added.");
    }finally{
      setCompatibilityPendingKeys(current=>{const next=new Set(current);next.delete(key);return next;});
    }
  };
  useEffect(()=>{
    for(const category of PYFA_CATALOGUE_CATEGORIES){
      if(expandedCategories.has(category.id)&&category.hullFiltered)void ensureCategoryCompatibility(category);
    }
  },[expandedCategories,fit?.hull.typeId,fittedHash,catalogue.items]);
  useEffect(()=>{
    if(!expandedCategories.has("charges-active"))return;
    if(!fittedModuleTypeIds.length){setActiveChargeTypeIds([]);setActiveChargesPending(false);return;}
    if(typeof window.sage.getFittingChargesForModulesLocal!=="function"){setActiveChargeTypeIds([]);setActiveChargesPending(false);return;}
    let cancelled=false;
    setActiveChargesPending(true);
    void window.sage.getFittingChargesForModulesLocal(fittedModuleTypeIds).then(result=>{
      if(!cancelled)setActiveChargeTypeIds(result.compatibleTypeIds);
    }).catch(()=>{if(!cancelled)setActiveChargeTypeIds([]);}).finally(()=>{if(!cancelled)setActiveChargesPending(false);});
    return()=>{cancelled=true;};
  },[expandedCategories,fittedModuleTypeIds.join("|")]);

  const rememberRecent=(item:FittingSearchResult)=>setRecentTypeIds(current=>[item.id,...current.filter(id=>id!==item.id)].slice(0,50));
  const toggleGroup=(id:number)=>setExpandedGroups(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});
  const toggleCategory=(category:CatalogueCategory)=>setExpandedCategories(current=>{
    const next=new Set(current);
    const opening=!next.has(category.id);
    if(opening)next.add(category.id);else next.delete(category.id);
    if(opening&&category.hullFiltered)void ensureCategoryCompatibility(category);
    return next;
  });

  const openMutationEditor = async (item:FittingSearchResult) => { setMutationMenu(undefined); setMutationStatus("Loading mutation ranges..."); const options=await window.sage.getMutationOptionsLocal(item.id) as MutationOption[]; if(!options.length){setMutationStatus("This module cannot be mutated.");return;} const first=options[0]; const values:Record<string,number>={}; first.attributes.forEach(a=>values[String(a.attributeId)]=Math.min(a.maxValue,Math.max(a.minValue,a.baseValue))); setMutationEditor({item,options,selected:0,values}); setMutationStatus(""); };
  const selectMutation=(index:number)=>{if(!mutationEditor)return;const option=mutationEditor.options[index];const values:Record<string,number>={};option.attributes.forEach(a=>values[String(a.attributeId)]=Math.min(a.maxValue,Math.max(a.minValue,a.baseValue)));setMutationEditor({...mutationEditor,selected:index,values});};
  const addMutated=async()=>{if(!mutationEditor)return;const option=mutationEditor.options[mutationEditor.selected];const automatic:BuilderTarget|undefined=mutationEditor.item.rack as BuilderTarget|undefined;const added=await onAdd(automatic??"cargo",mutationEditor.item,{option,values:mutationEditor.values});if(added)rememberRecent(mutationEditor.item);setMutationEditor(undefined);};
  const addResult=async(item:CatalogueItem|FittingSearchResult)=>{
    if(item.placement==="ship"){ onCreate({typeId:item.id,name:item.name}, fitName || (item.name + " fitting")); setBrowserTab("catalogue"); return; }
    if(item.placement === "charge" || item.categoryId===8){
      if(!fit){ setCatalogueStatus("Create or select a fit before loading ammunition."); return; }
      const candidates=(["high","mid","low","rig","subsystem"] as FitModuleRack[]).flatMap(rack=>fit[rack].map((module,index)=>({rack,index,module}))).filter(entry=>Boolean(entry.module.typeId));
      const checks=await Promise.all(candidates.map(async entry=>({entry,check:await window.sage.checkFittingChargeCompatibilityLocal(entry.module.typeId!,item.id).catch(()=>({compatible:false,reason:""}))})));
      const compatible=checks.filter(result=>result.check.compatible).map(result=>result.entry);
      if(compatible.length){const target=compatible.find(entry=>!entry.module.charge)??compatible[0];const loaded=await onCharge(target.rack,target.index,item);if(loaded){rememberRecent(item);setCatalogueStatus("Loaded "+item.name+" into "+target.module.name+".");return;}}
      const carried=await onAdd("cargo",{...item,placement:"cargo"});if(carried)rememberRecent(item);setCatalogueStatus(carried?"No fitted module currently accepts "+item.name+"; added it to Cargo instead.":"Charge could not be assigned.");return;
    }
    const targetByPlacement:Partial<Record<FittingPlacement,BuilderTarget>>={high:"high",mid:"mid",low:"low",rig:"rig",subsystem:"subsystem",drone:"drones",fighter:"fighters",implant:"implants",booster:"boosters",cargo:"cargo"};
    const automatic:BuilderTarget|undefined=(item.placement ? targetByPlacement[item.placement] : undefined) ?? (item.rack as BuilderTarget|undefined) ?? (item.categoryId===18?"drones":undefined);
    if(!automatic){setCatalogueStatus(item.name+" has no fitting destination in the current CCP SDE; added to Cargo for review.");const added=await onAdd("cargo",{...item,placement:"cargo"});if(added)rememberRecent(item);return;}
    const added=await onAdd(automatic,item);if(added)rememberRecent(item);setCatalogueStatus(added?"Added "+item.name+" to "+automatic+".":"Item was rejected by the fitting rules.");
  };
  const renderItem=(item:CatalogueItem)=><div className="fit-catalogue-item" key={item.id} draggable onDragStart={(event)=>writeFittingDrag(event,item)} onContextMenu={(event)=>{event.preventDefault();setMutationMenu({x:event.clientX,y:event.clientY,item});}}><img src={imageUrl(item.id,"icon",64)}/><span><strong>{item.name}</strong><small>{item.rack ? (item.rack + " slot") : item.categoryName}{item.metaLevel>0?(" · meta " + item.metaLevel):""}</small></span><button type="button" className="fit-catalogue-add" aria-label={"Add "+item.name} title={item.categoryId===8?"Load into the first compatible fitted module":"Add to fit"} onClick={()=>void addResult(item)}>+</button></div>;

  const renderCategoryContent=(category:CatalogueCategory)=>{
    const rawItems=rawItemsForCategory(category);
    const compatibilityKey=compatibilityKeyFor(category,rawItems);
    const compatibleIds=compatibilityKey?compatibilityCache[compatibilityKey]:undefined;
    const compatibilityPending=Boolean(compatibilityKey&&!compatibleIds);
    const compatibleSet=compatibleIds?new Set(compatibleIds):null;
    const displayItems=compatibilityKey?(compatibleSet?rawItems.filter(item=>compatibleSet.has(item.id)):[]):rawItems;
    if(category.dynamic==="recent") return displayItems.length?<div>{displayItems.map(renderItem)}</div>:<div className="fit-category-loading">No recently used fitting items yet.</div>;
    if(category.dynamic==="charges-active"){
      if(activeChargesPending)return <div className="fit-category-loading">Checking charges for the active fit…</div>;
      if(!fittedModuleTypeIds.length)return <div className="fit-category-loading">Fit a charge-using module to see compatible charges here.</div>;
      if(typeof window.sage.getFittingChargesForModulesLocal!=="function")return <div className="fit-category-loading">Active-fit charge filtering will be available after the Sage dev window restarts.</div>;
      return displayItems.length?<div>{displayItems.map(renderItem)}</div>:<div className="fit-category-loading">No compatible charges found for the active fit.</div>;
    }
    const roots=new Set(category.rootNames??[]);
    const rootGroups=catalogue.groups.filter(group=>group.parentId==null&&roots.has(group.name));
    const itemsByGroup=new Map<number,CatalogueItem[]>();
    for(const item of displayItems){const list=itemsByGroup.get(item.marketGroupId)??[];list.push(item);itemsByGroup.set(item.marketGroupId,list);}
    for(const list of itemsByGroup.values())list.sort((a,b)=>a.name.localeCompare(b.name));
    const renderGroup=(group:CatalogueGroup,depth=0):any=>{
      const children=childrenByParent.get(group.id)??[];
      const direct=itemsByGroup.get(group.id)??[];
      const isOpen=expandedGroups.has(group.id);
      const hasContent=children.length>0||direct.length>0||catalogue.items.length===0||compatibilityPending;
      return <div className="fit-catalogue-node" key={group.id}><button type="button" className="fit-catalogue-group" style={{paddingLeft:8+depth*13}} onClick={()=>hasContent&&toggleGroup(group.id)}><span>{hasContent?(isOpen?"▾":"▸"):"·"}</span><strong>{group.name}</strong><small>{direct.length||""}</small></button>{isOpen&&<div>{children.map(child=>renderGroup(child,depth+1))}{direct.map(renderItem)}{!children.length&&!direct.length&&<div className="fit-category-loading">{catalogue.items.length===0||compatibilityPending?"Preparing modules…":fit?.hull.name&&category.hullFiltered?"No items in this group are valid for "+fit.hull.name+".":"No items in this group."}</div>}</div>}</div>;
    };
    const rootChildren=[] as CatalogueGroup[];
    const seen=new Set<number>();
    for(const root of rootGroups)for(const child of childrenByParent.get(root.id)??[]){if(!seen.has(child.id)){seen.add(child.id);rootChildren.push(child);}}
    rootChildren.sort((a,b)=>a.name.localeCompare(b.name));
    const rootDirectItems=rootGroups.flatMap(root=>itemsByGroup.get(root.id)??[]).sort((a,b)=>a.name.localeCompare(b.name));
    if(!rootGroups.length)return <div className="fit-category-loading">{catalogueSource==="tree"?"Preparing category navigation…":"No current SDE items are available in this category."}</div>;
    return <div>{rootChildren.map(group=>renderGroup(group,0))}{rootDirectItems.map(renderItem)}{!rootChildren.length&&!rootDirectItems.length&&<div className="fit-category-loading">{catalogue.items.length===0||compatibilityPending?"Preparing modules…":"No items available in this category."}</div>}</div>;
  };

  const catalogueSearchResults=useMemo(()=>{
    const query=catalogueFilter.trim().toLowerCase();
    if(!query)return [];
    return catalogue.items.filter(item=>item.placement!=="ship"&&item.name.toLowerCase().includes(query)).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,400);
  },[catalogue.items,catalogueFilter]);

  return <div className="fit-builder fit-catalogue-browser">
    <div className="fit-builder-hull" onContextMenu={(event)=>{if(!fit?.hull.typeId)return;event.preventDefault();onShowInfo(fit.hull.typeId,fit.hull.name);}}><img src={imageUrl(fit?.hull.typeId,"icon",64)}/><span><strong>{fit?.hull.name??"Choose a ship"}</strong><small>Offline SDE fitting catalogue</small></span></div>
    <div className="fit-browser-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={browserTab==="catalogue"} className={browserTab==="catalogue"?"active":""} onClick={()=>setBrowserTab("catalogue")}>Catalogue</button>
      <button type="button" role="tab" aria-selected={browserTab==="ships"} className={browserTab==="ships"?"active":""} onClick={()=>setBrowserTab("ships")}>Ships</button>
    </div>
    {progressVisible&&<div className={"fitting-prep-progress "+(preparation.percent>=100?"ready":"")} aria-live="polite"><div><span>{preparation.message}</span><strong>{Math.round(Math.max(0,Math.min(100,preparation.percent)))}%</strong></div><b><i style={{width:Math.max(0,Math.min(100,preparation.percent))+"%"}}/></b></div>}
    {browserTab==="ships" ? <div className="fit-ships-tab">
      <input value={fitName} onChange={event=>setFitName(event.target.value)} placeholder="Optional fit name"/>
      <input value={hullQuery} onChange={event=>setHullQuery(event.target.value)} placeholder="Filter ships..."/>
      <div className="fit-builder-results hull-results">{hullMatches.map(ship=><button type="button" key={ship.typeId} onClick={()=>{onCreate(ship,fitName);setBrowserTab("catalogue");}} onContextMenu={(event)=>{event.preventDefault();onShowInfo(ship.typeId,ship.name);}}><img src={imageUrl(ship.typeId,"icon",64)}/><span><strong>{ship.name}</strong><small>Create fitting · right-click Show Info</small></span></button>)}</div>
    </div> : <div className="fit-catalogue-tab">
      <div className="fit-catalogue-section-row"><strong>Catalogue</strong><small>{catalogueSource==="live"?"Current SDE":catalogueSource==="cached"?"Cached modules":"Navigation ready"}</small></div>
      <input className="fit-catalogue-filter" value={catalogueFilter} onChange={event=>setCatalogueFilter(event.target.value)} placeholder="Filter catalogue locally..."/>
      {catalogueStatus&&<small className="fit-catalogue-action-status">{catalogueStatus}</small>}
      <div className="fit-catalogue-tree">{catalogueFilter.trim()?catalogue.items.length===0?<div className="fit-category-loading">Preparing modules…</div>:catalogueSearchResults.length?catalogueSearchResults.map(renderItem):<small>No matching catalogue items.</small>:PYFA_CATALOGUE_CATEGORIES.map(category=>{
        const isOpen=expandedCategories.has(category.id);
        return <div className="fit-catalogue-node fit-catalogue-top-node" key={category.id}><button type="button" className="fit-catalogue-group fit-catalogue-top-group" onClick={()=>toggleCategory(category)}><span>{isOpen?"▾":"▸"}</span><strong>{category.label}</strong><small></small></button>{isOpen&&<div className="fit-catalogue-top-content">{renderCategoryContent(category)}</div>}</div>;
      })}</div>
    </div>}
    {mutationMenu&&<div className="mutation-context-menu" style={{left:mutationMenu.x,top:mutationMenu.y}}><button type="button" onClick={()=>{onShowInfo(mutationMenu.item.id,mutationMenu.item.name);setMutationMenu(undefined);}}>Show Info</button>{mutationMenu.item.rack && <button type="button" onClick={()=>void openMutationEditor(mutationMenu.item)}>Mutate...</button>}<button type="button" onClick={()=>setMutationMenu(undefined)}>Cancel</button></div>}
    {mutationEditor&&<div className="mutation-backdrop" onMouseDown={()=>setMutationEditor(undefined)}><div className="mutation-editor" onMouseDown={event=>event.stopPropagation()}><div className="mutation-editor-head"><div><p className="eyebrow">ABYSSAL MUTATION</p><h3>{mutationEditor.item.name}</h3></div><button type="button" onClick={()=>setMutationEditor(undefined)}>×</button></div><label>Mutaplasmid<select value={mutationEditor.selected} onChange={event=>selectMutation(Number(event.target.value))}>{mutationEditor.options.map((option,index)=><option key={option.mutaplasmidTypeId} value={index}>{option.mutaplasmidName}</option>)}</select></label><div className="mutation-attributes">{mutationEditor.options[mutationEditor.selected].attributes.map(attribute=>{const key=String(attribute.attributeId);const value=mutationEditor.values[key]??attribute.baseValue;const delta=attribute.baseValue?((value/attribute.baseValue)-1)*100:0;return <div className="mutation-attribute" key={attribute.attributeId}><div><strong>{attribute.name}</strong><small>Base {attribute.baseValue.toFixed(3)} · legal {attribute.minValue.toFixed(3)} – {attribute.maxValue.toFixed(3)}</small></div><input type="range" min={attribute.minValue} max={attribute.maxValue} step={Math.max(Math.abs(attribute.maxValue-attribute.minValue)/1000,0.000001)} value={value} onChange={event=>setMutationEditor({...mutationEditor,values:{...mutationEditor.values,[key]:Number(event.target.value)}})}/><input type="number" min={attribute.minValue} max={attribute.maxValue} step="any" value={value} onChange={event=>setMutationEditor({...mutationEditor,values:{...mutationEditor.values,[key]:Math.min(attribute.maxValue,Math.max(attribute.minValue,Number(event.target.value)))}})}/><em className={(attribute.highIsGood?delta>=0:delta<=0)?"good":"bad"}>{delta>=0?"+":""}{delta.toFixed(1)}%</em></div>})}</div><div className="mutation-editor-foot"><span>{mutationEditor.options[mutationEditor.selected].resultingTypeName}</span><button type="button" onClick={()=>void addMutated()}>Add mutated module</button></div></div></div>}
    {mutationStatus&&<small className="mutation-status">{mutationStatus}</small>}
  </div>;
}
function FitDisplay({
  fit,
  characters,
  characterId,
  onCharacterChange,
  onRemove,
  onRoute,
  onRename,
  onDuplicate,
  onExport,
  onModuleStateChange,
  onBayActiveQuantityChange,
  onRemoveItem,
  onAddItem,
  onLoadCharge,
  onAnalysis,
  onExportToPlanner,
  onShowInfo,
}: {
  fit: Fit;
  characters: Array<{ characterId: string; character: { name: string } }>;
  characterId: string;
  onCharacterChange(id: string): void;
  onRemove(): void;
  onRoute(): void;
  onRename(): void;
  onDuplicate(): void;
  onExport(): void;
  onModuleStateChange(rack: FitModuleRack, index: number, state: ModuleState): void;
  onBayActiveQuantityChange(target: "drones" | "fighters", index: number, quantity: number): void;
  onRemoveItem(target: BuilderTarget, index: number): void;
  onAddItem(target: BuilderTarget, item: FittingSearchResult): Promise<boolean>;
  onLoadCharge(target: FitModuleRack, index: number, item: FittingSearchResult): Promise<boolean>;
  onAnalysis(readiness: "ready" | "missing", missingRequirements: number): void;
  onExportToPlanner(intent: FitResolutionIntent): void;
  onShowInfo(typeId:number,name?:string):void;
}) {
  const [tab, setTab] = useState<"fitting" | "performance">("fitting");
  const [analysis, setAnalysis] = useState<any>(null);
  const [remedies, setRemedies] = useState<FitRemedyCandidate[]>([]);
  const [hullProfile, setHullProfile] = useState<HullFittingProfile | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!fit.hull.typeId) { setHullProfile(null); return; }
    const load = async () => {
      try {
        if (typeof window.sage.getHullFittingProfileLocal !== "function") {
          if (!cancelled) setHullProfile(null);
          return;
        }
        const profile = await window.sage.getHullFittingProfileLocal(fit.hull.typeId!);
        if (!cancelled) setHullProfile(profile);
      } catch {
        if (!cancelled) setHullProfile(null);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [fit.hull.typeId]);
  const [targetProfile, setTargetProfile] = useState({ rangeM: 10000, signatureRadiusM: 125, transverseVelocityMps: 0, velocityMps: 0 });
  const [damageProfilePreset, setDamageProfilePreset] = useState<NpcDamagePreset>("omni");
  const [targetDamageProfilePreset, setTargetDamageProfilePreset] = useState<NpcDamagePreset>("omni");
  const [externalEffects, setExternalEffects] = useState<ExternalEffectSelection[]>([]);
  const addExternalEffect = async (input: { kind: ExternalEffectKind; name: string; chargeName?: string }) => {
    const name = input.name.trim();
    const chargeName = input.chargeName?.trim() ?? "";
    if (!name) return "Enter an exact EVE item/effect name.";
    const requested = chargeName ? [name, chargeName] : [name];
    const resolved = await window.sage.resolveFittingTypeNamesLocal(requested);
    const byName = new Map(resolved.map((item) => [item.name.toLowerCase(), item]));
    const effect = byName.get(name.toLowerCase());
    if (!effect) return "No current CCP SDE type matched “" + name + "”.";
    const charge = chargeName ? byName.get(chargeName.toLowerCase()) : undefined;
    if (chargeName && !charge) return "No current CCP SDE charge/script matched “" + chargeName + "”.";
    if (externalEffects.some((item) => item.kind === input.kind && item.typeId === effect.id && item.chargeTypeId === charge?.id)) return "That external effect is already selected.";
    setExternalEffects((current) => [...current, { id: crypto.randomUUID(), kind: input.kind, name: effect.name, typeId: effect.id, chargeName: charge?.name, chargeTypeId: charge?.id, state: "active", effectiveness: 1 }]);
    return null;
  };
  const updateExternalEffect = (id: string, patch: Partial<ExternalEffectSelection>) => setExternalEffects((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const removeExternalEffect = (id: string) => setExternalEffects((current) => current.filter((item) => item.id !== id));
  const damageProfile = NPC_DAMAGE_PRESETS[damageProfilePreset].incoming;
  const [analysisStatus, setAnalysisStatus] = useState(
    "Select Performance & skills to analyze this fit.",
  );
  const [analysisRefreshing, setAnalysisRefreshing] = useState(false);
  useEffect(() => { setAnalysis(null); setRemedies([]); setAnalysisRefreshing(false); }, [fit.id, fit.hull.typeId, characterId]);
  useEffect(() => {
    if (!characterId || !fit.hull.typeId) return;
    let cancelled = false;
    setRemedies([]);
    setAnalysisRefreshing(true);
    setAnalysisStatus("Checking hull attributes and character skills...");
    window.sage
      .analyzeFitting({
        characterId,
        hullTypeId: fit.hull.typeId,
        itemTypeIds: fitItems(fit)
          .map((item) => item.typeId)
          .filter((id): id is number => Boolean(id)),
        targetProfile,
        damageProfile,
        implantTypeIds: fit.implants.map((item) => item.typeId).filter((id): id is number => Boolean(id)),
        boosterTypeIds: [...fit.boosters.map((item) => item.typeId).filter((id): id is number => Boolean(id)), ...externalEffects.filter((item) => item.kind === "booster").map((item) => item.typeId)],
        projectedItems: externalEffects.filter((item) => item.kind === "projected").map((item) => ({ typeId: item.typeId, chargeTypeId: item.chargeTypeId, state: item.state ?? "active", effectiveness: item.effectiveness ?? 1 })),
        commandBurstItems: externalEffects.filter((item) => item.kind === "command").map((item) => ({ typeId: item.typeId, chargeTypeId: item.chargeTypeId, state: item.state ?? "active", effectiveness: item.effectiveness ?? 1 })),
        environmentTypeIds: externalEffects.filter((item) => item.kind === "environment").map((item) => item.typeId),
        items: [
          ...(["low", "mid", "high", "rig", "subsystem", "drones", "cargo"] as const).flatMap((rack) =>
            fit[rack].flatMap((item) => item.typeId ? [{ typeId: item.typeId, quantity: item.quantity, activeQuantity: item.activeQuantity, chargeTypeId: item.chargeTypeId, chargeQuantity: item.chargeQuantity, attributeOverrides: item.attributeOverrides, state: item.state ?? (rack === "rig" || rack === "subsystem" ? "online" : "active"), rack: rack === "drones" ? "drone" : rack === "cargo" ? "cargo" : rack }] : []),
          ),
          ...fit.fighters.flatMap((item) => {
            if (!item.typeId) return [];
            const activeQuantity = Math.max(0, Math.min(item.quantity, item.activeQuantity ?? Math.min(1, item.quantity)));
            const inactiveQuantity = Math.max(0, item.quantity - activeQuantity);
            return [
              ...(inactiveQuantity ? [{ typeId:item.typeId, quantity:inactiveQuantity, rack:"fighter" as const }] : []),
              ...(activeQuantity ? [{ typeId:item.typeId, quantity:activeQuantity, activeQuantity, rack:"fighter-active" as const }] : []),
            ];
          }),
        ],
      })
      .then((result) => {
        if (!cancelled) {
          setAnalysis(result);
          setAnalysisRefreshing(false);
          const missingCount = result.missingRequirements.length;
          setAnalysisStatus(missingCount ? `${missingCount} missing or undertrained requirement(s).` : "All identified fitting skill requirements are met.");
          onAnalysis(missingCount ? "missing" : "ready", missingCount);
          const issueCodes = (result.issues ?? []).map((issue: any) => String(issue.code));
          const itemTypeIds = fitItems(fit).map((item) => item.typeId).filter((id): id is number => Boolean(id));
          void window.sage.getFittingRemediesLocal({ characterId, hullTypeId: fit.hull.typeId!, issueCodes, itemTypeIds })
            .then((candidates) => {
              if (cancelled) return;
              const installed = new Set((result.enhancements ?? []).filter((item: any) => item.kind === "implant").map((item: any) => Number(item.typeId)));
              setRemedies(candidates.filter((candidate) => candidate.kind !== "implant" || !installed.has(candidate.typeId)));
            })
            .catch(() => { if (!cancelled) setRemedies([]); });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setAnalysisRefreshing(false);
          setAnalysisStatus(
            error instanceof Error ? error.message : "Fitting analysis failed.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tab, characterId, fit.id, fit.hull.typeId, fit.low, fit.mid, fit.high, fit.rig, fit.subsystem, fit.drones, fit.fighters, fit.cargo, fit.implants, fit.boosters, targetProfile.rangeM, targetProfile.signatureRadiusM, targetProfile.transverseVelocityMps, targetProfile.velocityMps, damageProfilePreset, externalEffects]);
  const exportResolution = (source: "dream-fit" | "fit-issues") => {
    if (!fit.hull.typeId) return;
    onExportToPlanner({
      source,
      fitName: fit.name,
      hullTypeId: fit.hull.typeId,
      hullName: fit.hull.name,
      characterId,
      issues: (analysis?.issues ?? []).map((issue: any) => ({ level: String(issue.level ?? "warning"), code: String(issue.code ?? "fit-issue"), message: String(issue.message ?? issue.code ?? "Fitting issue"), item: issue.item ? String(issue.item) : undefined })),
      missingRequirements: (analysis?.missingRequirements ?? []).map((requirement: any) => ({ item: String(requirement.item ?? "Fitted item"), skillId: Number(requirement.skillId), skill: String(requirement.skill ?? `Skill ${requirement.skillId}`), requiredLevel: Number(requirement.requiredLevel ?? 1), trainedLevel: Number(requirement.trainedLevel ?? 0) })),
      remedies,
      resources: analysis?.resources ? { used: { ...analysis.resources.used }, capacity: { ...analysis.resources.capacity } } : undefined,
    });
  };
  const fitSummary = summarizeFit(fit);
  return (
    <div className="fit-display fit-display-v3">
      <div className="fit-v2-center-header">
        <div className="fit-title">
          <div>
            <p className="eyebrow">SHIP FITTING</p>
            <h2>{fit.name}</h2>
            <span>{fit.hull.name}</span>
          </div>
          <div className="fit-title-actions">
            <select
              value={characterId}
              onChange={(event) => onCharacterChange(event.target.value)}
            >
              {characters.map((character) => (
                <option key={character.characterId} value={character.characterId}>
                  {character.character.name}
                </option>
              ))}
            </select>
            <button onClick={onRename}>Rename</button>
            <button onClick={onDuplicate}>Duplicate</button>
            <button onClick={onExport}>Copy JSON</button>
            <button className="route-fit" onClick={onRoute}>
              Find cheapest purchase route
            </button>
            <button onClick={onRemove}>Delete fit</button>
          </div>
        </div>
        <div className="fit-library-summary">
          <span>{fitSummary.moduleCount} modules</span><span>{fitSummary.droneCount} drones</span><span>{fitSummary.resolvedItems} resolved</span><span>{fitSummary.unresolvedItems} unresolved</span>
        </div>
        <div className="fit-tabs">
          <button
            className={tab === "fitting" ? "active" : ""}
            onClick={() => setTab("fitting")}
          >
            Fitting
          </button>
          <button
            className={tab === "performance" ? "active" : ""}
            onClick={() => setTab("performance")}
          >
            Performance & skills
          </button>
        </div>
      </div>

      {tab === "fitting" ? (
        <>
          <div className="fit-v2-center-stage">
            <div className="fit-v2-ship">
              <div className="fit-v2-ship-frame" onContextMenu={(event)=>{if(!fit.hull.typeId)return;event.preventDefault();onShowInfo(fit.hull.typeId,fit.hull.name);}}>{fit.hull.typeId ? <img src={imageUrl(fit.hull.typeId, "render", 512)} /> : <div>?</div>}</div>
              <div className="fit-v2-quick-actions"><button onClick={() => exportResolution("dream-fit")}>Dream fit</button><button onClick={onRoute}>Procurement</button><button onClick={onDuplicate}>Duplicate</button></div>
            </div>
            <div className="fit-v2-selected">
              <SlotRack title="High slots" side="high" items={fit.high} limit={hullProfile?.slots.high ?? fit.high.length} onStateChange={onModuleStateChange} onRemove={onRemoveItem} onDropItem={onAddItem} onLoadCharge={onLoadCharge} onShowInfo={onShowInfo} />
              <SlotRack title="Mid slots" side="mid" items={fit.mid} limit={hullProfile?.slots.mid ?? fit.mid.length} onStateChange={onModuleStateChange} onRemove={onRemoveItem} onDropItem={onAddItem} onLoadCharge={onLoadCharge} onShowInfo={onShowInfo} />
              <SlotRack title="Low slots" side="low" items={fit.low} limit={hullProfile?.slots.low ?? fit.low.length} onStateChange={onModuleStateChange} onRemove={onRemoveItem} onDropItem={onAddItem} onLoadCharge={onLoadCharge} onShowInfo={onShowInfo} />
              <SlotRack title="Rigs" side="rig" items={fit.rig} limit={hullProfile?.slots.rig ?? fit.rig.length} onStateChange={onModuleStateChange} onRemove={onRemoveItem} onDropItem={onAddItem} onLoadCharge={onLoadCharge} onShowInfo={onShowInfo} />
              {((hullProfile?.slots.subsystem ?? 0) > 0 || fit.subsystem.length > 0) && <SlotRack title="Subsystems" side="subsystem" items={fit.subsystem} limit={hullProfile?.slots.subsystem ?? fit.subsystem.length} onStateChange={onModuleStateChange} onRemove={onRemoveItem} onDropItem={onAddItem} onLoadCharge={onLoadCharge} onShowInfo={onShowInfo} />}
            </div>
            <FitIssuesPanel analysis={analysis} remedies={remedies} onFix={() => exportResolution("fit-issues")} />
          </div>
          <div className="fit-v2-additions">
            <FitAdditionsPanel fit={fit} analysis={analysis} externalEffects={externalEffects} onBayActiveQuantityChange={onBayActiveQuantityChange} onRemoveItem={onRemoveItem} onShowInfo={onShowInfo} />
          </div>
        </>
      ) : (
        <div className="fit-v2-performance-stage">
          <FitPerformance analysis={analysis} status={analysisStatus} fit={fit} targetProfile={targetProfile} onTargetProfileChange={setTargetProfile} damageProfilePreset={damageProfilePreset} onDamageProfilePresetChange={setDamageProfilePreset} externalEffects={externalEffects} onAddExternalEffect={addExternalEffect} onUpdateExternalEffect={updateExternalEffect} onRemoveExternalEffect={removeExternalEffect} onExportToPlanner={() => exportResolution("dream-fit")} />
        </div>
      )}

      <FitStatsSidebar analysis={analysis} refreshing={analysisRefreshing} fit={fit} hullProfile={hullProfile} targetDamageProfilePreset={targetDamageProfilePreset} onTargetDamageProfilePresetChange={setTargetDamageProfilePreset} damageProfilePreset={damageProfilePreset} onDamageProfilePresetChange={setDamageProfilePreset} targetProfile={targetProfile} onTargetProfileChange={setTargetProfile} />
    </div>
  );

}

type AdditionTab = "drones" | "fighters" | "cargo" | "implants" | "boosters" | "projected" | "command" | "notes";
type AdditionEntry = { item: FitItem; index: number; target: "drones" | "fighters" | "cargo" | "implants" | "boosters" };

function FitAdditionsPanel({ fit, analysis, externalEffects, onBayActiveQuantityChange, onRemoveItem, onShowInfo }: { fit: Fit; analysis: any; externalEffects: ExternalEffectSelection[]; onBayActiveQuantityChange(target:"drones"|"fighters",index:number, quantity:number):void; onRemoveItem(target:BuilderTarget,index:number):void; onShowInfo(typeId:number,name?:string):void }) {
  const [activeTab, setActiveTab] = useState<AdditionTab>("drones");
  const [legacyBayKinds, setLegacyBayKinds] = useState<Record<number, "drone" | "fighter" | "unknown">>({});
  useEffect(() => {
    let cancelled=false; const names=[...new Set(fit.drones.map(item=>item.name).filter(Boolean))]; if(!names.length){setLegacyBayKinds({});return;}
    void window.sage.resolveFittingTypeNamesLocal(names).then((resolved:any[])=>{if(cancelled)return;const next:Record<number,"drone"|"fighter"|"unknown">={};for(const item of resolved){const category=String(item.categoryName??"").toLowerCase();next[Number(item.id)]=category==="fighter"?"fighter":category==="drone"?"drone":"unknown";}setLegacyBayKinds(next);}).catch(()=>{if(!cancelled)setLegacyBayKinds({});});
    return()=>{cancelled=true;};
  },[fit.id,fit.drones]);
  const legacyEntries=fit.drones.map((item,index)=>({item,index,target:"drones" as const}));
  const legacyFighters=legacyEntries.filter(entry=>entry.item.typeId && legacyBayKinds[entry.item.typeId]==="fighter");
  const droneEntries=legacyEntries.filter(entry=>!entry.item.typeId || legacyBayKinds[entry.item.typeId]!=="fighter");
  const fighterEntries:AdditionEntry[]=[...legacyFighters,...fit.fighters.map((item,index)=>({item,index,target:"fighters" as const}))];
  const cargoEntries:AdditionEntry[]=fit.cargo.map((item,index)=>({item,index,target:"cargo" as const}));
  const plannedImplants:AdditionEntry[]=fit.implants.map((item,index)=>({item,index,target:"implants" as const}));
  const plannedBoosters:AdditionEntry[]=fit.boosters.map((item,index)=>({item,index,target:"boosters" as const}));
  const plannedImplantIds=new Set(fit.implants.map(item=>item.typeId).filter(Boolean));
  const installedImplants=(analysis?.enhancements??[]).filter((item:any)=>item.kind==="implant" && !plannedImplantIds.has(Number(item.typeId)));
  const appliedBoosters=externalEffects.filter(item=>item.kind==="booster"); const projected=externalEffects.filter(item=>item.kind==="projected"); const command=externalEffects.filter(item=>item.kind==="command");
  const sum=(entries:AdditionEntry[])=>entries.reduce((total,entry)=>total+Number(entry.item.quantity||0),0);
  const counts:Record<AdditionTab,number>={drones:sum(droneEntries),fighters:sum(fighterEntries),cargo:sum(cargoEntries),implants:plannedImplants.length+installedImplants.length,boosters:plannedBoosters.length+appliedBoosters.length,projected:projected.length,command:command.length,notes:fit.instructions.length};
  const tabs:Array<{id:AdditionTab;label:string}>=[{id:"drones",label:"Drones"},{id:"fighters",label:"Fighters"},{id:"cargo",label:"Cargo"},{id:"implants",label:"Implants"},{id:"boosters",label:"Boosters"},{id:"projected",label:"Projected"},{id:"command",label:"Command"},{id:"notes",label:"Notes"}];
  const info:Record<AdditionTab,string>={drones:"Drone bay loadout and launched count used by live DPS analysis.",fighters:"Fighter hangar and active squadrons validated against tubes and fighter class limits.",cargo:"Charges, scripts, paste, probes and other carried items.",implants:"Planned fit implants plus implants already installed on the selected pilot.",boosters:"Boosters assigned to the fit plus temporary external booster effects.",projected:"Remote effects projected onto this fit for performance analysis.",command:"Command burst effects currently applied to this fit.",notes:"Imported operating notes and fit instructions."};
  const activeCount=(entry:AdditionEntry)=>{if(entry.item.activeQuantity!=null)return Math.max(0,Math.min(entry.item.quantity,entry.item.activeQuantity));if(entry.target==="fighters")return Math.min(entry.item.quantity,1);const matches=(analysis?.damage?.activeDrones??[]).filter((candidate:any)=>(entry.item.typeId&&Number(candidate.typeId)===entry.item.typeId)||String(candidate.name??"")===entry.item.name);const explicit=matches.map((candidate:any)=>Number(candidate.activeQuantity??candidate.quantity)).find((value:number)=>Number.isFinite(value));if(explicit!=null)return Math.max(0,Math.min(entry.item.quantity,Math.round(explicit)));return Math.min(entry.item.quantity,5);};
  const step=(entry:AdditionEntry,delta:number)=>{if(entry.target!=="drones"&&entry.target!=="fighters")return;onBayActiveQuantityChange(entry.target,entry.index,Math.max(0,Math.min(entry.item.quantity,activeCount(entry)+delta)));};
  const renderBay=(entries:AdditionEntry[],active=false)=>entries.length?<div className="fit-addition-list">{entries.map(entry=><div className="fit-addition-item" key={entry.target+"-"+entry.item.name+"-"+entry.index} onContextMenu={event=>{if(!entry.item.typeId)return;event.preventDefault();onShowInfo(entry.item.typeId,entry.item.name);}}>{entry.item.typeId?<img src={imageUrl(entry.item.typeId,"icon",64)}/>:<b>?</b>}<span><strong>{entry.item.name}</strong><small>{entry.item.quantity} assigned · {entry.target}</small></span>{active&&<div className="drone-active-stepper" title="Active count used by fit analysis"><small>Active</small><button type="button" onClick={()=>step(entry,-1)}>−</button><b>{activeCount(entry)}</b><button type="button" onClick={()=>step(entry,1)}>+</button></div>}<button type="button" className="fit-addition-remove" onClick={()=>onRemoveItem(entry.target,entry.index)} aria-label={"Remove "+entry.item.name}>×</button></div>)}</div>:<div className="fit-addition-empty">Nothing assigned here.</div>;
  const renderEffects=(items:any[],empty:string,label:string)=>items.length?<div className="fit-addition-effect-list">{items.map((item:any,index:number)=><div className="fit-addition-effect" key={String(item.id??item.typeId??index)} onContextMenu={event=>{if(!item.typeId)return;event.preventDefault();onShowInfo(Number(item.typeId),item.name);}}>{item.typeId?<img src={imageUrl(Number(item.typeId),"icon",64)}/>:<b>◇</b>}<span><strong>{item.name??("Type "+item.typeId)}</strong><small>{item.chargeName?item.chargeName+" · ":""}{item.state?item.state+" · ":""}{label}</small></span></div>)}</div>:<div className="fit-addition-empty">{empty}</div>;
  return <div className="fit-additions-panel"><div className="fit-additions-head"><strong>Additions</strong><small>{info[activeTab]}</small></div><div className="fit-addition-tabs-v3" role="tablist">{tabs.map(tab=><button type="button" role="tab" aria-selected={activeTab===tab.id} className={activeTab===tab.id?"active":""} key={tab.id} onClick={()=>setActiveTab(tab.id)}><span>{tab.label}</span>{counts[tab.id]>0&&<b>{counts[tab.id]}</b>}</button>)}</div><div className="fit-addition-content" role="tabpanel">
    {activeTab==="drones"&&renderBay(droneEntries,true)}{activeTab==="fighters"&&renderBay(fighterEntries,true)}{activeTab==="cargo"&&renderBay(cargoEntries)}
    {activeTab==="implants"&&<>{renderBay(plannedImplants)}{installedImplants.length>0&&<div className="fit-addition-secondary"><small>Installed on pilot</small>{renderEffects(installedImplants,"","Installed on selected pilot")}</div>}</>}
    {activeTab==="boosters"&&<>{renderBay(plannedBoosters)}{appliedBoosters.length>0&&<div className="fit-addition-secondary"><small>External / temporary</small>{renderEffects(appliedBoosters,"","Applied to analysis")}</div>}</>}
    {activeTab==="projected"&&renderEffects(projected,"No projected effects are currently applied.","Applied to analysis")}{activeTab==="command"&&renderEffects(command,"No command burst effects are currently applied.","Applied to analysis")}
    {activeTab==="notes"&&(fit.instructions.length?<div className="fit-addition-notes">{fit.instructions.map((note,index)=><p key={index}>{note}</p>)}</div>:<div className="fit-addition-empty">No fit notes or operating instructions.</div>)}
  </div></div>;
}

function FitIssuesPanel({ analysis, remedies, onFix }: { analysis:any; remedies:FitRemedyCandidate[]; onFix():void }) {
  const rawMissing = analysis?.missingRequirements ?? [];
  const missing = [...new Map(rawMissing.map((item:any) => [`${item.skillId}:${item.requiredLevel}`, item])).values()] as any[];
  const issues = (analysis?.issues ?? []) as any[];
  const resolvable = missing.length > 0 || remedies.length > 0;
  const supportSkills = remedies.filter((item) => item.kind === "skill");
  const augments = remedies.filter((item) => item.kind === "implant");
  const rigs = remedies.filter((item) => item.kind === "rig");
  return <aside className="fit-v2-issues">
    <div className="fit-v2-issues-head"><strong>Fitting issues</strong><span>{analysis ? issues.length + missing.length : "…"}</span></div>
    {!analysis ? <small className="fit-issues-state">Analyzing fit…</small> : issues.length === 0 && missing.length === 0 ? <div className="fit-issue-ok">✓ Fit viable for this pilot</div> : <div className="fit-issue-list">
      {missing.slice(0,4).map((item:any) => <article className="skill" key={`skill-${item.skillId}-${item.requiredLevel}`}><strong>{item.skill}</strong><small>L{item.trainedLevel} → L{item.requiredLevel}</small><em>{item.item}</em></article>)}
      {issues.slice(0,6).map((issue:any,index:number) => <article className={issue.level === "error" ? "error" : "warning"} key={`${issue.code}-${index}`}><strong>{issue.item ?? issue.code}</strong><small>{issue.message}</small>{(issue.code === "cpu-exceeded" || issue.code === "powergrid-exceeded") && <em>{remedies.filter((item) => item.solves.includes(issue.code)).length} verified skill / augment / rig options</em>}</article>)}
    </div>}
    {resolvable && <div className="fit-issue-remedy-summary"><span>{supportSkills.length} skills</span><span>{augments.length} augments</span><span>{rigs.length} rigs</span></div>}
    {resolvable && <button type="button" className="fit-issues-fix" onClick={onFix}>Fix these issues</button>}
  </aside>;
}
function FitStatsSidebar({ analysis, refreshing, fit, hullProfile, targetDamageProfilePreset, onTargetDamageProfilePresetChange, damageProfilePreset, onDamageProfilePresetChange, targetProfile, onTargetProfileChange }: { analysis:any; refreshing:boolean; fit:Fit; hullProfile:HullFittingProfile|null; targetDamageProfilePreset:NpcDamagePreset; onTargetDamageProfilePresetChange(value:NpcDamagePreset):void; damageProfilePreset:NpcDamagePreset; onDamageProfilePresetChange(value:NpcDamagePreset):void; targetProfile:{rangeM:number;signatureRadiusM:number;transverseVelocityMps:number;velocityMps:number}; onTargetProfileChange(value:{rangeM:number;signatureRadiusM:number;transverseVelocityMps:number;velocityMps:number}):void }) {
  const fmt=(value:number|undefined,digits=0)=>value==null||!Number.isFinite(value)?"—":value.toLocaleString(undefined,{maximumFractionDigits:digits,minimumFractionDigits:digits});
  const pct=(value:number|undefined)=>value==null?"—":(value*100).toFixed(1)+"%";
  const slots=hullProfile?.slots;
  const storage=analysis?.storage;
  const res=analysis?.resources;
  const defence=analysis?.defence;
  const damage=analysis?.damage;
  const cap=analysis?.capacitor;
  const nav=analysis?.navigation;
  const targeting=analysis?.targeting;
  const appliedWeaponDps=damage?.weaponProfiles?.reduce((sum:number,weapon:any)=>sum+Number(weapon.targetApplication?.appliedDps??0),0)??0;
  const Stat=({icon,label,value,sub}:{icon:string;label:string;value:string;sub?:string})=><div className="pyfa-stat"><i>{icon}</i><span><small>{label}</small><strong>{value}</strong>{sub&&<em>{sub}</em>}</span></div>;
  const Resource=({icon,label,used,total,unit}:{icon:string;label:string;used:number|undefined;total:number|undefined;unit:string})=>{const ratio=total&&used!=null?Math.max(0,Math.min(1,used/total)):0;return <div className="pyfa-resource"><div><i>{icon}</i><span>{label}</span><strong>{used==null||total==null?"—":fmt(used,1)+" / "+fmt(total,1)+" "+unit}</strong></div><b><u style={{width:(ratio*100)+"%"}}/></b></div>};
  const ResistRow=({icon,label,resists,ehp}:{icon:string;label:string;resists:number[]|undefined;ehp:number|undefined})=><div className="pyfa-resist-row"><i>{icon}</i><span>{label}</span>{[0,1,2,3].map(index=><b key={index}>{resists?pct(resists[index]):"—"}</b>)}<strong>{ehp==null?"—":fmt(ehp)}</strong></div>;
  return <aside className="fit-v2-context pyfa-stats-panel">
    {refreshing&&<div className="fit-analysis-refreshing"><span>Calculating current fit…</span><i/></div>}
    <div className="pyfa-profile-stack">
      <label>
        <span>Target damage profile</span>
        <select value={targetDamageProfilePreset} onChange={event=>onTargetDamageProfilePresetChange(event.target.value as NpcDamagePreset)}>
          {NPC_DAMAGE_PRESET_KEYS.map(key=><option key={key} value={key}>{NPC_DAMAGE_PRESETS[key].label} · deal {NPC_DAMAGE_PRESETS[key].dealLabel}</option>)}
        </select>
        <small>Recommended damage: {NPC_DAMAGE_PRESETS[targetDamageProfilePreset].dealLabel}</small>
      </label>
      <label>
        <span>Defensive damage profile</span>
        <select value={damageProfilePreset} onChange={event=>onDamageProfilePresetChange(event.target.value as NpcDamagePreset)}>
          {NPC_DAMAGE_PRESET_KEYS.map(key=><option key={key} value={key}>{NPC_DAMAGE_PRESETS[key].label} · {NPC_DAMAGE_PRESETS[key].incomingLabel}</option>)}
        </select>
        <small>Incoming mix: {NPC_DAMAGE_PRESETS[damageProfilePreset].incomingLabel}</small>
      </label>
      <details className="pyfa-target-application">
        <summary>Target application</summary>
        <div className="fit-v2-target-grid">
          <label>Range km<input type="number" min="0" value={targetProfile.rangeM/1000} onChange={event=>onTargetProfileChange({...targetProfile,rangeM:Math.max(0,Number(event.target.value)*1000)})}/></label>
          <label>Signature m<input type="number" min="1" value={targetProfile.signatureRadiusM} onChange={event=>onTargetProfileChange({...targetProfile,signatureRadiusM:Math.max(1,Number(event.target.value))})}/></label>
          <label>Transversal<input type="number" min="0" value={targetProfile.transverseVelocityMps} onChange={event=>onTargetProfileChange({...targetProfile,transverseVelocityMps:Math.max(0,Number(event.target.value))})}/></label>
          <label>Velocity<input type="number" min="0" value={targetProfile.velocityMps} onChange={event=>onTargetProfileChange({...targetProfile,velocityMps:Math.max(0,Number(event.target.value))})}/></label>
        </div>
      </details>
    </div>
    <section><h3><i>⚙</i> Resources</h3><Resource icon="◫" label="CPU" used={res?.used.cpu} total={res?.capacity.cpu} unit="tf"/><Resource icon="⚡" label="Powergrid" used={res?.used.powergrid} total={res?.capacity.powergrid} unit="MW"/><Resource icon="⬡" label="Calibration" used={res?.used.calibration} total={res?.capacity.calibration} unit=""/><Resource icon="◇" label="Drone bay" used={storage?.droneBayUsedM3} total={storage?.droneBayCapacityM3??hullProfile?.storage.droneBayM3} unit="m³"/><Resource icon="⌁" label="Bandwidth" used={storage?.droneBandwidthUsed} total={storage?.droneBandwidthCapacity??hullProfile?.storage.droneBandwidth} unit="Mbit/s"/><Resource icon="▣" label="Cargo" used={storage?.cargoUsedM3} total={storage?.cargoCapacityM3??hullProfile?.storage.cargoM3} unit="m³"/><div className="pyfa-slot-line"><span>Slots</span><strong>{fit.high.length}/{slots?.high??"—"} H · {fit.mid.length}/{slots?.mid??"—"} M · {fit.low.length}/{slots?.low??"—"} L · {fit.rig.length}/{slots?.rig??"—"} R</strong></div></section>
    <section><h3><i>◈</i> Resistances <small>Effective HP {defence?fmt(defence.totalEhp):"—"}</small></h3><div className="pyfa-resist-head"><span></span><span></span><b title="EM"><i className="resist-damage-icon em">ϟ</i><small>EM</small></b><b title="Thermal"><i className="resist-damage-icon thermal">♨</i><small>TH</small></b><b title="Kinetic"><i className="resist-damage-icon kinetic">◆</i><small>KI</small></b><b title="Explosive"><i className="resist-damage-icon explosive">✹</i><small>EX</small></b><strong>EHP</strong></div><ResistRow icon="◉" label="Shield" resists={defence?.shieldResists} ehp={defence?.shieldEhp}/><ResistRow icon="◆" label="Armor" resists={defence?.armorResists} ehp={defence?.armorEhp}/><ResistRow icon="⬢" label="Hull" resists={defence?.hullResists} ehp={defence?.structureEhp}/></section>
    <section><h3><i>↻</i> Recharge & tank</h3><div className="pyfa-stat-grid"><Stat icon="◉" label="Passive shield" value={defence?fmt(defence.effectivePassiveShieldPeak,1)+" EHP/s":"—"}/><Stat icon="◆" label="Armor rep" value={defence?fmt(defence.effectiveArmorRepairPerSecond,1)+" EHP/s":"—"}/><Stat icon="◉" label="Shield rep" value={defence?fmt(defence.effectiveShieldRepairPerSecond,1)+" EHP/s":"—"}/><Stat icon="⬢" label="Hull rep" value={defence?fmt(defence.effectiveStructureRepairPerSecond,1)+" EHP/s":"—"}/></div></section>
    <section><h3><i>✦</i> Firepower</h3><div className="pyfa-stat-grid"><Stat icon="✹" label="Weapon DPS" value={damage?fmt(damage.weaponDps,1):"—"}/><Stat icon="◇" label="Drone DPS" value={damage?fmt(damage.droneDps,1):"—"}/><Stat icon="✦" label="Total volley" value={damage?fmt(damage.totalVolley,0):"—"}/><Stat icon="⌖" label="Applied weapon" value={damage?fmt(appliedWeaponDps,1)+" DPS":"—"}/></div></section>
    <section><h3><i>⚡</i> Capacitor</h3><div className="pyfa-stat-grid"><Stat icon="◍" label="Capacity" value={cap?fmt(cap.capacityGj,0)+" GJ":"—"}/><Stat icon="⏱" label="State" value={cap?(cap.stable?"Stable "+fmt(cap.stablePercent,0)+"%":fmt(cap.depletionSeconds,0)+" s"):"—"}/><Stat icon="↓" label="Demand" value={cap?fmt(cap.demandGjPerSecond,2)+" GJ/s":"—"}/><Stat icon="↑" label="Peak recharge" value={cap?fmt(cap.peakRechargeGjPerSecond,2)+" GJ/s":"—"}/></div></section>
    <section><h3><i>⌖</i> Targeting & misc</h3><div className="pyfa-stat-grid"><Stat icon="⌖" label="Targets" value={targeting?fmt(targeting.maximumLockedTargets):"—"}/><Stat icon="◎" label="Lock range" value={targeting?fmt(targeting.maximumRangeM/1000,1)+" km":"—"}/><Stat icon="◌" label="Scan res" value={targeting?fmt(targeting.scanResolution,0)+" mm":"—"}/><Stat icon="∿" label="Sensor str" value={targeting?fmt(targeting.sensorStrength,1):"—"}/><Stat icon="➤" label="Speed" value={nav?fmt(nav.maximumVelocity,0)+" m/s":"—"}/><Stat icon="⏱" label="Align" value={nav?fmt(nav.alignSeconds,2)+" s":"—"}/><Stat icon="◯" label="Signature" value={targeting?fmt(targeting.signatureRadiusM,0)+" m":"—"}/><Stat icon="✧" label="Warp" value={nav?fmt(nav.warpSpeedAuPerSecond,1)+" AU/s":"—"}/></div></section>
  </aside>;
}

function FitPerformance({
  analysis,
  status,
  fit,
  targetProfile,
  onTargetProfileChange,
  damageProfilePreset,
  onDamageProfilePresetChange,
  externalEffects,
  onAddExternalEffect,
  onUpdateExternalEffect,
  onRemoveExternalEffect,
  onExportToPlanner,
}: {
  analysis: any;
  status: string;
  fit: Fit;
  targetProfile: { rangeM: number; signatureRadiusM: number; transverseVelocityMps: number; velocityMps: number };
  onTargetProfileChange(value: { rangeM: number; signatureRadiusM: number; transverseVelocityMps: number; velocityMps: number }): void;
  damageProfilePreset: NpcDamagePreset;
  onDamageProfilePresetChange(value: NpcDamagePreset): void;
  externalEffects: ExternalEffectSelection[];
  onAddExternalEffect(input: { kind: ExternalEffectKind; name: string; chargeName?: string }): Promise<string | null>;
  onUpdateExternalEffect(id: string, patch: Partial<ExternalEffectSelection>): void;
  onRemoveExternalEffect(id: string): void;
  onExportToPlanner(): void;
}) {
  const [externalKind, setExternalKind] = useState<ExternalEffectKind>("environment");
  const [externalName, setExternalName] = useState("");
  const [externalCharge, setExternalCharge] = useState("");
  const [externalStatus, setExternalStatus] = useState("");
  const submitExternalEffect = async () => {
    setExternalStatus("Resolving from local CCP SDE...");
    try {
      const error = await onAddExternalEffect({ kind: externalKind, name: externalName, chargeName: externalCharge || undefined });
      if (error) setExternalStatus(error);
      else { setExternalStatus("External effect added."); setExternalName(""); setExternalCharge(""); }
    } catch (error) { setExternalStatus(error instanceof Error ? error.message : "Could not add external effect."); }
  };
  return (
    <div className="fit-performance">
      <div className="performance-note">
        <strong>{status}</strong>
        <small>
          Offline CCP dogma validates fitting resources, slots, hardpoints and
          character requirements. Effect simulation is being expanded toward
          full Pyfa parity.
        </small>
      </div>
      <h3>Damage profile</h3>
      <div className="damage-profile-controls"><label>Incoming NPC damage<select value={damageProfilePreset} onChange={(event) => onDamageProfilePresetChange(event.target.value as NpcDamagePreset)}>{NPC_DAMAGE_PRESET_KEYS.map(key=><option key={key} value={key}>{NPC_DAMAGE_PRESETS[key].label} · {NPC_DAMAGE_PRESETS[key].incomingLabel}</option>)}</select></label></div>
      <h3>Target application</h3>
      <div className="target-profile-controls">
        <label>Range km<input type="number" min="0" step="1" value={targetProfile.rangeM / 1000} onChange={(event) => onTargetProfileChange({ ...targetProfile, rangeM: Math.max(0, Number(event.target.value) * 1000) })} /></label>
        <label>Signature m<input type="number" min="1" step="1" value={targetProfile.signatureRadiusM} onChange={(event) => onTargetProfileChange({ ...targetProfile, signatureRadiusM: Math.max(1, Number(event.target.value)) })} /></label>
        <label>Transversal m/s<input type="number" min="0" step="10" value={targetProfile.transverseVelocityMps} onChange={(event) => onTargetProfileChange({ ...targetProfile, transverseVelocityMps: Math.max(0, Number(event.target.value)) })} /></label>
        <label>Velocity m/s<input type="number" min="0" step="10" value={targetProfile.velocityMps} onChange={(event) => onTargetProfileChange({ ...targetProfile, velocityMps: Math.max(0, Number(event.target.value)) })} /></label>
      </div>
      <h3>External effects</h3>
      <div className="external-effects-panel">
        <div className="external-effect-add">
          <label>Type<select value={externalKind} onChange={(event) => setExternalKind(event.target.value as ExternalEffectKind)}><option value="environment">Environment</option><option value="booster">Booster</option><option value="projected">Projected module</option><option value="command">Command burst</option></select></label>
          <label>Exact CCP name<input value={externalName} onChange={(event) => setExternalName(event.target.value)} placeholder={externalKind === "environment" ? "Class 1 Pulsar Effects" : externalKind === "booster" ? "Strong Blue Pill Booster" : externalKind === "command" ? "Shield Command Burst II" : "Stasis Webifier II"} /></label>
          {(externalKind === "projected" || externalKind === "command") && <label>Charge / script<input value={externalCharge} onChange={(event) => setExternalCharge(event.target.value)} placeholder={externalKind === "command" ? "Shield Extension Charge" : "Optional script"} /></label>}
          <button type="button" onClick={submitExternalEffect}>Add effect</button>
        </div>
        {externalStatus && <small className="external-effect-status">{externalStatus}</small>}
        {externalEffects.length > 0 && <div className="external-effect-list">{externalEffects.map((item) => <div className="external-effect-row" key={item.id}><div><strong>{item.name}</strong><small>{item.kind}{item.chargeName ? <> · {item.chargeName}</> : null}</small></div>{(item.kind === "projected" || item.kind === "command") && <><label>State<select value={item.state ?? "active"} onChange={(event) => onUpdateExternalEffect(item.id, { state: event.target.value as ModuleState })}><option value="active">Active</option><option value="overheated">Overheated</option></select></label><label>Effect %<input type="number" min="0" max="100" step="1" value={Math.round((item.effectiveness ?? 1) * 100)} onChange={(event) => onUpdateExternalEffect(item.id, { effectiveness: Math.max(0, Math.min(1, Number(event.target.value) / 100)) })} /></label></>}<button type="button" onClick={() => onRemoveExternalEffect(item.id)}>Remove</button></div>)}</div>}
      </div>
      {analysis && (
        <>
          <div className="performance-summary">
            <article>
              <span>Pilot</span>
              <strong>{analysis.character}</strong>
              <small>
                {analysis.totalSkillPoints.toLocaleString()} total SP
              </small>
            </article>
            <article>
              <span>Fit readiness</span>
              <strong>
                {analysis.missingRequirements.length
                  ? "Requirements missing"
                  : "Ready"}
              </strong>
              <small>
                {analysis.requirements.length} ship/module types checked
              </small>
            </article>
            <article>
              <span>Slots used</span>
              <strong>
                {fit.high.length}H / {fit.mid.length}M / {fit.low.length}L /{" "}
                {fit.rig.length}R
              </strong>
              <small>Modules grouped by imported fitting slots</small>
            </article>
          </div>
          <h3>Base hull performance</h3>
          {analysis.resources && (
            <div className="base-stat-grid">
              {(["cpu", "powergrid", "calibration"] as const).map((key) => (
                <article key={key}>
                  <span>{key}</span>
                  <strong>{analysis.resources.used[key].toFixed(1)} / {analysis.resources.capacity[key].toFixed(1)}</strong>
                </article>
              ))}
            </div>
          )}
          {analysis.capacitor && (
            <div className="base-stat-grid">
              <article><span>Capacitor demand</span><strong>{analysis.capacitor.demandGjPerSecond.toFixed(2)} GJ/s</strong></article>
              <article><span>Peak recharge</span><strong>{analysis.capacitor.peakRechargeGjPerSecond.toFixed(2)} GJ/s</strong></article>
              <article><span>Capacitor state</span><strong>{analysis.capacitor.stable ? `Stable Â· ${analysis.capacitor.stablePercent.toFixed(1)}%` : `${Math.round(analysis.capacitor.depletionSeconds)}s`}</strong></article>
            </div>
          )}
          {analysis.damage && (
            <div className="base-stat-grid">
              <article><span>Raw paper DPS</span><strong>{analysis.damage.totalDps.toFixed(1)}</strong></article>
              <article><span>Weapon / drone DPS</span><strong>{analysis.damage.weaponDps.toFixed(1)} / {analysis.damage.droneDps.toFixed(1)}</strong></article>
              <article><span>Total volley</span><strong>{analysis.damage.totalVolley.toFixed(1)}</strong></article>
              <article><span>Active drones</span><strong>{analysis.damage.activeDrones.length}</strong><small>{analysis.damage.activeDrones.map((drone: any) => drone.name).join(", ") || "None selected"}</small></article>
              {analysis.damage.weaponProfiles.map((weapon: any, index: number) => <article key={`${weapon.typeId}-${index}`}><span>{weapon.name}</span><strong>{weapon.kind === "turret" ? `${(weapon.optimalM / 1000).toFixed(1)} + ${(weapon.falloffM / 1000).toFixed(1)} km` : `${(weapon.maximumRangeM / 1000).toFixed(1)} km`}</strong><small>{weapon.kind === "turret" ? `${weapon.tracking.toFixed(3)} tracking` : `${weapon.explosionRadiusM.toFixed(0)} m explosion Â· ${weapon.explosionVelocity.toFixed(0)} m/s`}</small></article>)}
            </div>
          )}
          {analysis.defence && (
            <div className="base-stat-grid">
              <article><span>Profile EHP</span><strong>{Math.round(analysis.defence.totalEhp).toLocaleString()}</strong></article>
              <article><span>Shield / armor / hull</span><strong>{analysis.defence.shieldHp} / {analysis.defence.armorHp} / {analysis.defence.structureHp}</strong></article>
              <article><span>Raw active repair</span><strong>{(analysis.defence.shieldRepairPerSecond + analysis.defence.armorRepairPerSecond + analysis.defence.structureRepairPerSecond).toFixed(1)} HP/s</strong></article>
              <article><span>Effective active tank</span><strong>{(analysis.defence.effectiveShieldRepairPerSecond + analysis.defence.effectiveArmorRepairPerSecond + analysis.defence.effectiveStructureRepairPerSecond).toFixed(1)} EHP/s</strong></article>
              <article><span>Peak passive shield</span><strong>{analysis.defence.passiveShieldPeak.toFixed(1)} HP/s · {analysis.defence.effectivePassiveShieldPeak.toFixed(1)} EHP/s</strong></article>
            </div>
          )}
          {analysis.navigation && analysis.targeting && (
            <div className="base-stat-grid">
              <article><span>Align time</span><strong>{analysis.navigation.alignSeconds.toFixed(2)} s</strong></article>
              <article><span>Base speed / warp</span><strong>{analysis.navigation.maximumVelocity.toFixed(0)} m/s Â· {analysis.navigation.warpSpeedAuPerSecond.toFixed(1)} AU/s</strong></article>
              <article><span>Targeting</span><strong>{(analysis.targeting.maximumRangeM / 1000).toFixed(1)} km Â· {analysis.targeting.scanResolution.toFixed(0)} mm</strong></article>
              <article><span>Signature / sensors</span><strong>{analysis.targeting.signatureRadiusM.toFixed(0)} m Â· {analysis.targeting.sensorStrength.toFixed(1)}</strong></article>
            </div>
          )}
          {analysis.heat && (
            <>
              <h3>Heat & overload</h3>
              <div className="performance-note">
                <strong>Expected heat behaviour</strong>
                <small>Heat damage is probabilistic in EVE. Burnout values are expected outcomes from CCP rack heat, occupied-slot and attenuation mechanics, not guaranteed timers.</small>
              </div>
              {analysis.heat.racks.some((rack: any) => rack.overheatedModules > 0) ? analysis.heat.racks.filter((rack: any) => rack.overheatedModules > 0).map((rack: any) => (
                <div key={rack.rack}>
                  <div className="base-stat-grid">
                    <article><span>{rack.rack} rack heat · 30s</span><strong>{(rack.heatAt30Seconds * 100).toFixed(1)}%</strong></article>
                    <article><span>{rack.rack} rack heat · 60s</span><strong>{(rack.heatAt60Seconds * 100).toFixed(1)}%</strong></article>
                    <article><span>Expected first burnout</span><strong>{rack.firstExpectedBurnoutSeconds > 0 ? Math.floor(rack.firstExpectedBurnoutSeconds / 60) + "m " + Math.round(rack.firstExpectedBurnoutSeconds % 60) + "s" : "Beyond 60m / none"}</strong></article>
                    <article><span>Heat attenuation</span><strong>{rack.attenuation.toFixed(2)}</strong><small>{rack.overheatedModules} overloaded · {(rack.occupiedSlotFactor * 100).toFixed(1)}% occupied-slot factor</small></article>
                  </div>
                  <div className="requirement-list">
                    {rack.modules.filter((module: any) => module.state === "overheated" || module.expectedBurnoutSeconds > 0).map((module: any) => (
                      <article className={module.state === "overheated" ? "missing" : "ready"} key={rack.rack + "-" + module.position + "-" + module.typeId}>
                        <strong>{module.name}</strong>
                        <span>{module.state === "overheated" ? "Overheated source" : "Rack position " + (module.position + 1)}</span>
                        <small>{module.heatDamage.toFixed(2)} heat damage · {module.cycleSeconds.toFixed(2)}s cycle · {module.expectedBurnoutSeconds > 0 ? "expected burnout " + Math.floor(module.expectedBurnoutSeconds / 60) + "m " + Math.round(module.expectedBurnoutSeconds % 60) + "s" : "no expected burnout within 60m"}</small>
                      </article>
                    ))}
                  </div>
                </div>
              )) : <div className="performance-note"><small>No fitted modules are currently set to Overheated.</small></div>}
            </>
          )}
          {analysis.issues?.length > 0 && <div className="requirement-list">{analysis.issues.map((issue: any, index: number) => <article className={issue.level === "error" ? "missing" : "ready"} key={`${issue.code}-${index}`}><strong>{issue.item ?? issue.code}</strong><small>{issue.message}</small></article>)}</div>}
          <div className="base-stat-grid">
            {analysis.baseStats.map((stat: any) => (
              <article key={stat.id}>
                <span>{stat.label}</span>
                <strong>
                  {Math.round(stat.value).toLocaleString()} {stat.unit}
                </strong>
              </article>
            ))}
          </div>
          <div className="planner-panel-title">
            <div><p className="eyebrow">FIT PROGRESSION</p><h3>Continue in Progression</h3></div>
            <button onClick={onExportToPlanner}>Export to Progression Ship Planner</button>
          </div>
        </>
      )}
    </div>
  );
}

function FitRouteScreen({
  fit,
  characters,
  onBack,
}: {
  fit: Fit;
  characters: Array<{ characterId: string; character: { name: string } }>;
  onBack(): void;
}) {
  const [characterId, setCharacterId] = useState(
    characters[0]?.characterId ?? "",
  );
  const [buyEntireFit, setBuyEntireFit] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [status, setStatus] = useState(
    "Choose a character whose current location will be the route origin.",
  );
  async function calculate() {
    setStatus("Comparing owned assets, prices and secure routes...");
    setResult(null);
    try {
      const items = [
        fit.hull,
        ...fit.low,
        ...fit.mid,
        ...fit.high,
        ...fit.rig,
        ...fit.subsystem,
        ...fit.drones,
        ...fit.cargo,
      ];
      const next = await window.sage.buildFitShoppingRoute({
        characterId,
        buyEntireFit,
        items,
      });
      setResult(next);
      setStatus(`Route calculated from ${next.origin}.`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Route calculation failed.",
      );
    }
  }
  return (
    <section className="fit-route-screen">
      <div className="route-head">
        <div>
          <p className="eyebrow">FIT PROCUREMENT</p>
          <h2>{fit.name}</h2>
          <p>{status}</p>
        </div>
        <button onClick={onBack}>Back to fitting</button>
      </div>
      <div className="route-controls">
        <select
          value={characterId}
          onChange={(event) => setCharacterId(event.target.value)}
        >
          {characters.map((character) => (
            <option value={character.characterId} key={character.characterId}>
              {character.character.name}
            </option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={buyEntireFit}
            onChange={(event) => setBuyEntireFit(event.target.checked)}
          />
          Buy the entire fit; ignore owned assets
        </label>
        <button onClick={calculate} disabled={!characterId}>
          Calculate optimal route
        </button>
      </div>
      {result && (
        <>
          <div className="route-metrics">
            <article>
              <span>Total purchase</span>
              <strong>
                {Math.round(result.totalCost).toLocaleString()} ISK
              </strong>
            </article>
            <article>
              <span>Qualifying saving</span>
              <strong>
                {Math.round(result.estimatedSavings).toLocaleString()} ISK
              </strong>
            </article>
            <article>
              <span>Station stops</span>
              <strong>{result.stops}</strong>
            </article>
          </div>
          <div className="route-table">
            <div className="route-row heading">
              <span>Item</span>
              <span>Quantity</span>
              <span>Price</span>
              <span>Station</span>
              <span>Jumps</span>
              <span>Saving</span>
            </div>
            {result.purchases.map((purchase: any, index: number) => (
              <div className="route-row" key={`${purchase.typeId}-${index}`}>
                <span>{purchase.item}</span>
                <span>{purchase.quantity.toLocaleString()}</span>
                <span>{Math.round(purchase.total).toLocaleString()} ISK</span>
                <span>
                  <strong>{purchase.system}</strong>
                  <small>{purchase.station}</small>
                </span>
                <span>{purchase.jumps}</span>
                <span>
                  {purchase.savingVsLocal === null
                    ? "Required travel"
                    : `${Math.round(purchase.savingVsLocal).toLocaleString()} ISK`}
                </span>
              </div>
            ))}
          </div>
          {result.unavailable.length > 0 && (
            <div className="route-unavailable">
              <h3>Still required</h3>
              {result.unavailable.map((item: any) => (
                <p key={item.item}>
                  {item.item} x{item.quantity}: {item.reason}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SlotRack({ title, side, items, limit, onStateChange, onRemove, onDropItem, onLoadCharge, onShowInfo }: { title:string; side:FitModuleRack; items:FitItem[]; limit:number; onStateChange(rack:FitModuleRack,index:number,state:ModuleState):void; onRemove(target:BuilderTarget,index:number):void; onDropItem(target:BuilderTarget,item:FittingSearchResult):Promise<boolean>; onLoadCharge(target:FitModuleRack,index:number,item:FittingSearchResult):Promise<boolean>; onShowInfo(typeId:number,name?:string):void }) {
  const states:ModuleState[]=side==="rig"||side==="subsystem"?["offline","online"]:["offline","online","active","overheated"];
  const count=Math.max(items.length,Math.max(0,Math.floor(limit||0)));
  const allowDrag=(event:DragEvent<HTMLElement>)=>{if(event.dataTransfer.types.includes(FITTING_DRAG_MIME)){event.preventDefault();event.dataTransfer.dropEffect="copy";}};
  return <div className={"slot-rack "+side} onDragOver={allowDrag}><span>{title}<small>{items.length} / {limit || count}</small></span><div>{Array.from({length:count},(_,index)=>{const item=items[index];return item?<ItemIcon item={item} states={states} onStateChange={state=>onStateChange(side,index,state)} onRemove={()=>onRemove(side,index)} onChargeDrop={charge=>onLoadCharge(side,index,charge)} onShowInfo={onShowInfo} key={(item.name)+"-"+index}/>:<div className="fit-item fit-empty-slot" key={"empty-"+side+"-"+index} title={"Drop a "+side+" module here"} onDragOver={allowDrag} onDrop={(event)=>{event.preventDefault();const dragged=readFittingDrag(event);if(dragged)void onDropItem(side,dragged);}}><b>+</b><span>Drop / Empty</span></div>;})}</div></div>;
}
function ItemIcon({
  item,
  states,
  onStateChange,
  onRemove,
  onChargeDrop,
  onShowInfo,
}: {
  item: FitItem;
  states: ModuleState[];
  onStateChange(state: ModuleState): void;
  onRemove(): void;
  onChargeDrop(item:FittingSearchResult): Promise<boolean>;
  onShowInfo(typeId:number,name?:string):void;
}) {
  const defaultState: ModuleState = states.includes("active") ? "active" : "online";
  const currentState = item.state && states.includes(item.state) ? item.state : defaultState;
  const allowCharge=(event:DragEvent<HTMLElement>)=>{if(event.dataTransfer.types.includes(FITTING_DRAG_MIME)){event.preventDefault();event.dataTransfer.dropEffect="copy";}};
  return (
    <div
      className={`fit-item state-${currentState}`}
      title={`${item.name}${item.charge ? `, ${item.charge}` : ""} · drop compatible ammo/charges here`}
      onDragOver={allowCharge}
      onContextMenu={(event)=>{if(!item.typeId)return;event.preventDefault();onShowInfo(item.typeId,item.name);}}
      onDrop={(event)=>{event.preventDefault();const dragged=readFittingDrag(event);if(dragged)void onChargeDrop(dragged);}}
    >
      {item.typeId ? <img src={imageUrl(item.typeId, "icon", 64)} /> : <b>?</b>}
      {item.quantity > 1 && <em>{item.quantity}</em>}{item.mutation && <i className="abyssal-badge" title={item.mutation.mutaplasmidName}>A</i>}
      <span className="fit-item-copy"><strong className="fit-module-name" title={item.name}>{item.name}</strong><small className="fit-loaded-charge" title={item.charge ?? ""} onContextMenu={(event)=>{if(!item.chargeTypeId)return;event.preventDefault();event.stopPropagation();onShowInfo(item.chargeTypeId,item.charge);}}>{item.charge ?? "\u00a0"}</small></span>
      <button type="button" className="fit-item-remove" aria-label={`Remove ${item.name}`} onClick={onRemove}>×</button>
      <select
        className="fit-module-state"
        value={currentState}
        aria-label={`${item.name} module state`}
        onChange={(event) => onStateChange(event.target.value as ModuleState)}
      >
        {states.map((state) => <option value={state} key={state}>{state}</option>)}
      </select>
    </div>
  );
}
function ItemBay({ title, items, activeDroneSelection = false, onActiveQuantityChange }: { title: string; items: FitItem[]; activeDroneSelection?: boolean; onActiveQuantityChange?: (index: number, quantity: number) => void }) {
  return (
    <div className="item-bay">
      <h3>{title}</h3>
      {items.length ? (
        items.map((item, index) => (
          <div key={`${item.name}-${index}`}>
            <img src={imageUrl(item.typeId, "icon", 64)} />
            <span>
              <strong>{item.name}</strong>
              <small>
                {item.quantity} unit{item.quantity === 1 ? "" : "s"}
              </small>
              {activeDroneSelection && <label className="drone-active-selector">Active <input aria-label={`${item.name} active drones`} type="number" min="0" max={item.quantity} step="1" value={item.activeQuantity ?? ""} placeholder="Auto" onChange={(event) => onActiveQuantityChange?.(index, event.target.value === "" ? 0 : Number(event.target.value))} /></label>}
            </span>
          </div>
        ))
      ) : (
        <p>Empty</p>
      )}
    </div>
  );
}




