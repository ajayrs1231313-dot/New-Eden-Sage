import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { createPortal } from "react-dom";
import "./fittings-task11.css";
import { parseFits, prepareImportedFits, validateFit, type FitValidationResult } from "./fitting-engine";
import { duplicateFit, ensureFitMeta, exportFitJson, filterAndSortFits, renameFit, summarizeFit, type FitLibraryMetaMap, type FitLibrarySort } from "./fitting-library";
import "./fittings-task12.css";
import type { CharacterSnapshot, FitResolutionIntent, FitRemedyCandidate } from "./types";
import { currentEveFitFromSnapshot } from "./current-eve-fit";
import { FITTER_HERO_CONTENT, coerceFitterHeroRules, resolveFactionArtwork, resolveFitterFaction, resolveFitterHero, resolveShipFrame, type FitterHeroRule } from "./fitter-presentation";
import { advanceFitterActiveQuantity } from "./fitter-quantity";
import { FittingShowInfo, type ShowInfoTarget } from "./FittingShowInfo";
import fittingStaticTree from "./fitting-static-tree.json";
import { appendShoppingList, OPEN_SHOPPING_LIST_EVENT } from "./shopping-list";
import { canonicalizeFittingPlacement } from "./fitting-rack-normalization";

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
type BoosterSideEffectOption = { boosterTypeId:number; boosterName:string; effectId:number; effectName:string; chanceAttributeId:number; chance:number };
type FittingCharacter = CharacterSnapshot;
type DoctrineExportSlotOption = { slot: number; name: string; fitCount: number };
type DoctrineExportDraft = { corporationId: number; corporationName: string; slot: number; doctrineName: string; slots: DoctrineExportSlotOption[] };
const PENDING_DOCTRINE_FIT_KEY = "new-eden-sage-pending-doctrine-fit";
function doctrineExportSlots(corporationId: number): DoctrineExportSlotOption[] {
  let saved: any[] = [];
  try { const parsed = JSON.parse(localStorage.getItem(`new-eden-sage-corp-doctrines-v1:${corporationId}`) ?? "[]"); saved = Array.isArray(parsed) ? parsed : []; } catch { saved = []; }
  return Array.from({ length: 5 }, (_, index) => {
    const slot = index + 1;
    const item = saved.find((value) => Number(value?.slot) === slot);
    return { slot, name: String(item?.name ?? ""), fitCount: Array.isArray(item?.fits) ? Math.min(10, item.fits.length) : 0 };
  });
}
type FitModuleRack = "low" | "mid" | "high" | "rig" | "subsystem";
type FittingPlacement = "ship" | FitModuleRack | "drone" | "fighter" | "implant" | "booster" | "charge" | "cargo";
type NpcCombatProfile = { abyssal:boolean; outgoingDamage:{em:number;thermal:number;kinetic:number;explosive:number}; outgoingDamageTotal:number; outgoingDps?:{em:number;thermal:number;kinetic:number;explosive:number}; outgoingDpsTotal?:number; outgoingDpsMax?:{em:number;thermal:number;kinetic:number;explosive:number}; outgoingDpsMaxTotal?:number; shieldHp:number; armorHp:number; structureHp:number; shieldResists:[number,number,number,number]; armorResists:[number,number,number,number]; hullResists:[number,number,number,number]; signatureRadiusM:number };
type FittingSearchResult = { id: number; name: string; groupId: number; categoryId: number; categoryName: string; rack?: FitModuleRack; placement?: FittingPlacement; combatProfile?: NpcCombatProfile };
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
  {id:"charges-active",label:"Ammo & Scripts for Active Fit",dynamic:"charges-active"},
];
let sharedPreparationPromise:Promise<FittingPreparationResult>|null=null;
let sharedPreparationResult:FittingPreparationResult|null=null;
let sharedStaticItemsPromise:Promise<CatalogueItem[]>|null=null;
function beginSharedFittingPreparation(){if(sharedPreparationResult)return Promise.resolve(sharedPreparationResult);if(typeof window.sage.prepareFittingDataLocal!=="function")return Promise.reject(new Error("Live fitting preparation bridge is not available in this window."));return sharedPreparationPromise ??= window.sage.prepareFittingDataLocal().then(result=>{sharedPreparationResult=result as FittingPreparationResult;return sharedPreparationResult;}).catch(error=>{sharedPreparationPromise=null;throw error;});}
function loadStaticFittingItems(){return sharedStaticItemsPromise ??= import("./fitting-catalogue-items-static.json").then(module=>{const payload=(module as any).default ?? module;return (payload.items ?? []) as CatalogueItem[];});}
type AbyssFitterSelection = { enabled:boolean; tier:0|1|2|3|4|5|6; weather:"electrical"|"exotic"|"firestorm"|"gamma"|"dark"; penalty:0.3|0.5|0.7; roomKey:string };
const ABYSS_WEATHER_OPTIONS: Array<{ value:AbyssFitterSelection["weather"]; label:string }> = [
  { value:"electrical", label:"Electrical" }, { value:"exotic", label:"Exotic" }, { value:"firestorm", label:"Firestorm" }, { value:"gamma", label:"Gamma" }, { value:"dark", label:"Dark" },
];
const abyssScenarioLabel=(tier:AbyssFitterSelection["tier"],weather:AbyssFitterSelection["weather"])=>`T${tier} ${ABYSS_WEATHER_OPTIONS.find(option=>option.value===weather)?.label??weather}`;
type NpcDamagePreset = "omni" | "em-only" | "thermal-only" | "kinetic-only" | "explosive-only" | "angel" | "blood-raiders" | "guristas" | "sansha" | "serpentis" | "mordus" | "rogue-drones";
const NPC_DAMAGE_PRESETS: Record<NpcDamagePreset,{label:string;incoming:{em:number;thermal:number;kinetic:number;explosive:number};incomingLabel:string;dealLabel:string}> = {
  omni:{label:"Omni / unknown",incoming:{em:.25,thermal:.25,kinetic:.25,explosive:.25},incomingLabel:"25 / 25 / 25 / 25",dealLabel:"match actual target"},
  "em-only":{label:"EM only",incoming:{em:1,thermal:0,kinetic:0,explosive:0},incomingLabel:"100 EM",dealLabel:"manual EM profile"},
  "thermal-only":{label:"Thermal only",incoming:{em:0,thermal:1,kinetic:0,explosive:0},incomingLabel:"100 TH",dealLabel:"manual Thermal profile"},
  "kinetic-only":{label:"Kinetic only",incoming:{em:0,thermal:0,kinetic:1,explosive:0},incomingLabel:"100 KI",dealLabel:"manual Kinetic profile"},
  "explosive-only":{label:"Explosive only",incoming:{em:0,thermal:0,kinetic:0,explosive:1},incomingLabel:"100 EX",dealLabel:"manual Explosive profile"},
  angel:{label:"Angel Cartel",incoming:{em:.07,thermal:.09,kinetic:.22,explosive:.62},incomingLabel:"7 EM / 9 TH / 22 KI / 62 EX",dealLabel:"Explosive / Kinetic"},
  "blood-raiders":{label:"Blood Raiders",incoming:{em:.50,thermal:.48,kinetic:.02,explosive:0},incomingLabel:"50 EM / 48 TH / 2 KI",dealLabel:"EM / Thermal"},
  guristas:{label:"Guristas",incoming:{em:.02,thermal:.18,kinetic:.79,explosive:.01},incomingLabel:"2 EM / 18 TH / 79 KI / 1 EX",dealLabel:"Kinetic / Thermal"},
  sansha:{label:"Sansha's Nation",incoming:{em:.53,thermal:.47,kinetic:0,explosive:0},incomingLabel:"53 EM / 47 TH",dealLabel:"EM / Thermal"},
  serpentis:{label:"Serpentis",incoming:{em:0,thermal:.55,kinetic:.45,explosive:0},incomingLabel:"55 TH / 45 KI",dealLabel:"Kinetic / Thermal"},
  mordus:{label:"Mordu's Legion",incoming:{em:0,thermal:.30,kinetic:.70,explosive:0},incomingLabel:"30 TH / 70 KI",dealLabel:"Kinetic / EM"},
  "rogue-drones":{label:"Rogue Drones",incoming:{em:.25,thermal:.25,kinetic:.25,explosive:.25},incomingLabel:"varies by drone",dealLabel:"EM / Thermal"},
};
const NPC_DAMAGE_PRESET_KEYS = Object.keys(NPC_DAMAGE_PRESETS) as NpcDamagePreset[];

type CombatActivityId = "manual" | "abyss" | "anomaly" | "ded" | "mission" | "burner" | "incursion" | "homefront" | "wormhole" | "pochven" | "exploration" | "foB" | "event";
type CombatTargetProfile = { rangeM:number; signatureRadiusM:number; transverseVelocityMps:number; velocityMps:number };
type CombatSiteOption = { id:string; label:string; detail:string; profile:CombatTargetProfile; strategy?:string[] };
type CombatSpaceOption = { value:string; label:string; faction?:NpcDamagePreset };
type CombatActivityDefinition = { id:CombatActivityId; label:string; short:string; description:string; defaultFaction:NpcDamagePreset; factionSelectable:boolean; spaces:CombatSpaceOption[]; sites:CombatSiteOption[]; strategy:string[] };
type FitCombatScenarioState = { activity:CombatActivityId; space:string; faction:NpcDamagePreset; site:string; abyssHull:"cruiser"|"destroyer"|"frigate" };
const COMBAT_TARGET_PROFILES = {
  light:{rangeM:8_000,signatureRadiusM:45,transverseVelocityMps:450,velocityMps:900},
  medium:{rangeM:20_000,signatureRadiusM:125,transverseVelocityMps:220,velocityMps:450},
  mixed:{rangeM:30_000,signatureRadiusM:150,transverseVelocityMps:200,velocityMps:500},
  heavy:{rangeM:40_000,signatureRadiusM:380,transverseVelocityMps:80,velocityMps:180},
  fleet:{rangeM:45_000,signatureRadiusM:250,transverseVelocityMps:160,velocityMps:350},
} satisfies Record<string,CombatTargetProfile>;
const COMBAT_SPACE_OPTIONS:CombatSpaceOption[] = [
  {value:"any",label:"Any space / use enemy profile"},
  {value:"highsec",label:"High security"},
  {value:"lowsec",label:"Low security"},
  {value:"nullsec",label:"Null security"},
];
const DED_SPACE_OPTIONS:CombatSpaceOption[] = [
  {value:"amarr-blood",label:"Amarr regions - Blood Raiders",faction:"blood-raiders"},
  {value:"amarr-sansha",label:"Amarr south / Khanid - Sansha",faction:"sansha"},
  {value:"caldari",label:"Caldari regions - Guristas",faction:"guristas"},
  {value:"gallente",label:"Gallente regions - Serpentis",faction:"serpentis"},
  {value:"minmatar",label:"Minmatar regions - Angel Cartel",faction:"angel"},
  {value:"drone",label:"Drone regions - Rogue Drones",faction:"rogue-drones"},
  {value:"custom",label:"Other / choose enemy manually"},
];
const COMBAT_FACTION_OPTIONS = (["angel","blood-raiders","guristas","sansha","serpentis","mordus","rogue-drones"] as NpcDamagePreset[]);
const site=(id:string,label:string,detail:string,profile:CombatTargetProfile,strategy?:string[]):CombatSiteOption=>({id,label,detail,profile,strategy});
const FIT_COMBAT_ACTIVITIES:CombatActivityDefinition[] = [
  {id:"manual",label:"Manual / exact NPC",short:"Manual",description:"Use the exact NPC or manual application controls in the right rail.",defaultFaction:"omni",factionSelectable:true,spaces:COMBAT_SPACE_OPTIONS,sites:[site("manual","Manual target profile","No site assumptions; use exact NPC search or tune range, signature and movement yourself.",COMBAT_TARGET_PROFILES.medium)],strategy:["Use this when you know the exact NPC or want to test a specific range, signature and movement profile.","The right-rail Target & Application panel remains authoritative in manual mode."]},
  {id:"abyss",label:"Abyssal Deadspace",short:"Abyss",description:"Tier, weather and documented Abyss room populations calculated by Sage.",defaultFaction:"omni",factionSelectable:false,spaces:[{value:"abyss",label:"Abyssal Deadspace"}],sites:[site("abyss","Abyss room catalogue","Sage uses the selected tier/weather and its documented room catalogue.",COMBAT_TARGET_PROFILES.mixed)],strategy:["Match damage type and movement to the selected weather rather than one NPC.","Watch the 20-minute margin, neut pressure and small-target application; a paper-DPS increase is not always a faster clear.","Use the room breakdown below when one spawn family is the limiting case."]},
  {id:"anomaly",label:"Combat anomalies",short:"Anomalies",description:"K-space pirate anomalies from starter sites through null-sec Havens and Sanctums.",defaultFaction:"guristas",factionSelectable:true,spaces:COMBAT_SPACE_OPTIONS,sites:[
    site("hideaway","Hideaway / Burrow","Entry-level anomaly; mostly light targets.",COMBAT_TARGET_PROFILES.light),site("refuge","Refuge","Light-to-medium wave profile.",COMBAT_TARGET_PROFILES.light),site("den","Den","Frigate/cruiser-heavy mixed waves.",COMBAT_TARGET_PROFILES.medium),site("rally","Rally Point","Mid-tier mixed pirate waves.",COMBAT_TARGET_PROFILES.medium),site("port","Port","Cruiser/battlecruiser weighted waves.",COMBAT_TARGET_PROFILES.mixed),site("hub","Hub","Heavy anomaly with larger hulls.",COMBAT_TARGET_PROFILES.heavy),site("haven","Haven","Null-sec battleship-heavy anomaly.",COMBAT_TARGET_PROFILES.heavy),site("sanctum","Sanctum","Top-end null-sec anomaly; sustained heavy waves.",COMBAT_TARGET_PROFILES.heavy)
  ],strategy:["Set the local pirate faction so the tank profile and recommended damage are relevant to the region.","Prioritise tackle, e-war and trigger management before chasing maximum paper DPS.","For fast anomalies, drone travel and lock/application time can matter as much as raw DPS."]},
  {id:"ded",label:"DED complexes & escalations",short:"DED / escalations",description:"Rated DED complexes, unrated combat signatures and expedition/escalation combat.",defaultFaction:"guristas",factionSelectable:true,spaces:DED_SPACE_OPTIONS,sites:[
    ...([1,2,3,4,5,6,7,8,10] as const).map(level=>site(`ded-${level}`,`${level}/10 DED complex`,level<=3?"Small-hull rated complex.":level<=6?"Cruiser/battlecruiser weighted rated complex.":"High-end rated complex with heavy NPCs and escalation-grade pressure.",level<=3?COMBAT_TARGET_PROFILES.light:level<=6?COMBAT_TARGET_PROFILES.mixed:COMBAT_TARGET_PROFILES.heavy)),
    site("unrated","Unrated combat signature","Unrated signature; exact wave composition varies by faction/site.",COMBAT_TARGET_PROFILES.mixed),site("expedition","Escalation / expedition","Escalated combat chain; use the local pirate faction and the exact stage if known.",COMBAT_TARGET_PROFILES.heavy)
  ],strategy:["Choose the local pirate faction first; DED resist holes and incoming damage follow the NPC family, not the security band alone.","Rated complexes can restrict hull size, so validate the ship before treating the result as operational.","Use an exact NPC in the right rail for a boss/application check when the final room is the real limiter."]},
  {id:"mission",label:"Security missions / Epic arcs",short:"Missions",description:"Security missions, COSMOS combat and epic-arc combat stages.",defaultFaction:"guristas",factionSelectable:true,spaces:[{value:"highsec",label:"High security"},{value:"lowsec",label:"Low security"},{value:"nullsec",label:"Null security / pirate missions"}],sites:[
    site("l1","Level 1 security","Frigate-scale mission profile.",COMBAT_TARGET_PROFILES.light),site("l2","Level 2 security","Frigate/destroyer profile.",COMBAT_TARGET_PROFILES.light),site("l3","Level 3 security","Cruiser/battlecruiser profile.",COMBAT_TARGET_PROFILES.medium),site("l4","Level 4 security","Battleship-heavy mission profile.",COMBAT_TARGET_PROFILES.heavy),site("epic","Epic Arc / COSMOS combat","Long-form mission combat; select the actual enemy faction for the stage.",COMBAT_TARGET_PROFILES.mixed)
  ],strategy:["Set the mission enemy faction rather than assuming the agent faction.","Carry the correct damage flight/ammo and keep a secondary damage option for mixed-faction chains.","For Level 4s and arcs, trigger order and range control usually matter more than squeezing out a few extra paper DPS."]},
  {id:"burner",label:"Anomic / Burner missions",short:"Burners",description:"Anomic Agent, Team and Base encounters where application and control are critical.",defaultFaction:"omni",factionSelectable:true,spaces:[{value:"mission",label:"Mission pocket"}],sites:[
    site("agent","Anomic Agent","Small, fast target; application profile is deliberately harsh.",{rangeM:12_000,signatureRadiusM:35,transverseVelocityMps:650,velocityMps:1_400}),site("team","Anomic Team","Fast frigate team encounter with support pressure.",{rangeM:18_000,signatureRadiusM:40,transverseVelocityMps:600,velocityMps:1_200}),site("base","Anomic Base","Multi-ship burner encounter with heavier combined pressure.",COMBAT_TARGET_PROFILES.medium)
  ],strategy:["Application, control and the exact burner damage profile are mandatory; generic mission fits are not a safe assumption.","Use the exact NPC selector for a named burner when available.","Treat web/scram range, speed tank and cap pressure as fit requirements, not optional polish."]},
  {id:"incursion",label:"Sansha Incursions",short:"Incursions",description:"Scout through Headquarters and mothership sites using the Sansha damage profile.",defaultFaction:"sansha",factionSelectable:false,spaces:[{value:"incursion",label:"Incursion constellation"}],sites:[
    site("scout","Scout","Low-end incursion fleet site.",COMBAT_TARGET_PROFILES.medium),site("vanguard","Vanguard","Fast fleet site with strong application requirements.",COMBAT_TARGET_PROFILES.fleet),site("assault","Assault","Larger fleet site with heavier target mix.",COMBAT_TARGET_PROFILES.fleet),site("hq","Headquarters","High incoming pressure and battleship-weighted fleet combat.",COMBAT_TARGET_PROFILES.heavy),site("mothership","Mothership / Kundalini","End-site fleet encounter.",COMBAT_TARGET_PROFILES.heavy)
  ],strategy:["Sansha EM/Thermal pressure is applied automatically to the tank profile.","Fleet composition, broadcasts and logistics coverage are part of survivability; local tank alone is not a complete incursion safety check.","Use the fitted drone selector for the flight you will actually field so Sage recalculates DPS."]},
  {id:"homefront",label:"Homefront Operations",short:"Homefront",description:"Fleet PvE Homefront content; use the selected enemy profile for the specific operation.",defaultFaction:"omni",factionSelectable:true,spaces:[{value:"highsec",label:"High security"}],sites:[
    site("combat","Combat-focused Homefront","General combat-heavy Homefront profile.",COMBAT_TARGET_PROFILES.medium),site("mixed","Mixed-objective Homefront","Combat plus objective/support pressure.",COMBAT_TARGET_PROFILES.mixed),site("boss","Heavy / boss objective","Heavier target and fleet-pressure profile.",COMBAT_TARGET_PROFILES.heavy)
  ],strategy:["Homefront objectives differ sharply; use the operation's actual enemy profile where known.","Do not judge fleet viability from personal DPS alone: objective mechanics and logistics can be the limiting factor.","Select the drone flight you intend to use rather than leaving Auto when coordinating fleet damage types."]},
  {id:"wormhole",label:"Wormhole Sleeper PvE",short:"Wormholes",description:"Sleeper combat sites from C1 through C6; omni tank assumption until an exact wave is selected.",defaultFaction:"omni",factionSelectable:false,spaces:[{value:"wormhole",label:"Wormhole space"}],sites:[
    site("c1","Class 1 Sleeper site","Entry Sleeper site.",COMBAT_TARGET_PROFILES.medium),site("c2","Class 2 Sleeper site","Light-to-medium Sleeper waves.",COMBAT_TARGET_PROFILES.medium),site("c3","Class 3 Sleeper site","Stronger Sleeper waves with meaningful neut/web pressure.",COMBAT_TARGET_PROFILES.mixed),site("c4","Class 4 Sleeper site","Heavy Sleeper combat.",COMBAT_TARGET_PROFILES.heavy),site("c5","Class 5 Sleeper site","Capital-capable high-class Sleeper combat.",COMBAT_TARGET_PROFILES.heavy),site("c6","Class 6 Sleeper site","Top-end Sleeper combat pressure.",COMBAT_TARGET_PROFILES.heavy)
  ],strategy:["Sleeper damage and e-war vary by wave, so Sage keeps the generic tank profile omni unless you select an exact NPC.","Neuts, webs and remote reps can define the encounter; cap stability and target priority deserve equal weight with DPS.","In high-class holes, use this as a fit/application view rather than a substitute for site-specific escalation mechanics."]},
  {id:"pochven",label:"Pochven combat",short:"Pochven",description:"Triglavian/EDENCOM/Drifter combat and Observatory Flashpoint-style fleet PvE.",defaultFaction:"omni",factionSelectable:false,spaces:[{value:"pochven",label:"Pochven"}],sites:[
    site("flashpoint","Observatory Flashpoint","Fleet-scale Pochven site.",COMBAT_TARGET_PROFILES.fleet),site("anomaly","Pochven combat anomaly","Mixed Triglavian/EDENCOM combat profile.",COMBAT_TARGET_PROFILES.mixed),site("drifter","Drifter / roaming combat","High application and potentially heavy incoming damage.",COMBAT_TARGET_PROFILES.heavy)
  ],strategy:["Pochven NPC composition varies, so use exact NPC search for a precise resist/application check.","Expect webs, neuts, remote reps and target switching; raw paper DPS is only one part of the site.","Use omni tank as the safe generic profile until the exact hostile group is known."]},
  {id:"exploration",label:"Combat exploration & hazardous sites",short:"Combat exploration",description:"Unrated combat signatures, Ghost/Sleeper Cache hazards and related exploration combat.",defaultFaction:"guristas",factionSelectable:true,spaces:COMBAT_SPACE_OPTIONS,sites:[
    site("unrated","Unrated combat signature","Faction combat signature with variable room composition.",COMBAT_TARGET_PROFILES.mixed),site("ghost","Ghost / Covert Research site","Short timer/hazard site; survival and exit discipline matter.",COMBAT_TARGET_PROFILES.light),site("sleeper-cache","Sleeper Cache","Exploration hazards with Sleeper-related pressure.",COMBAT_TARGET_PROFILES.medium),site("besieged","Besieged Covert Research Facility","Combat exploration site with heavier NPC pressure.",COMBAT_TARGET_PROFILES.heavy)
  ],strategy:["Site hazards can kill a fit that looks fine against NPC DPS alone; timer/cloud/explosion mechanics remain separate from tank math.","Use the faction selector when the site has a normal pirate NPC family; otherwise leave the profile conservative.","Keep an exit plan and do not trade mobility for paper DPS unless the site mechanic allows it."]},
  {id:"foB",label:"Pirate FOB / Stronghold",short:"FOB",description:"Forward Operating Base and diamond-rat style combat.",defaultFaction:"guristas",factionSelectable:true,spaces:[{value:"highsec",label:"High security"},{value:"lowsec",label:"Low security"}],sites:[
    site("fob","Pirate Forward Operating Base","Diamond-rat fleet pressure and structure objective.",COMBAT_TARGET_PROFILES.fleet),site("diamond","Diamond NPC engagement","Response-fleet style NPC combat.",COMBAT_TARGET_PROFILES.fleet)
  ],strategy:["Diamond NPCs behave more like a coordinated fleet than ordinary belt/anomaly rats.","Account for tackle, logistics and response escalation; solo tank/DPS numbers do not describe the whole engagement.","Set the pirate faction so the right-rail tank profile follows the local FOB."]},
  {id:"event",label:"Limited-time combat event",short:"Events",description:"Rotating seasonal/live-event combat sites using a manually selected enemy profile.",defaultFaction:"omni",factionSelectable:true,spaces:COMBAT_SPACE_OPTIONS,sites:[
    site("event-light","Event site - light targets","Frigate/cruiser-weighted event profile.",COMBAT_TARGET_PROFILES.light),site("event-mixed","Event site - mixed targets","General mixed event profile.",COMBAT_TARGET_PROFILES.mixed),site("event-heavy","Event site - heavy / boss","Heavy or boss-weighted event profile.",COMBAT_TARGET_PROFILES.heavy)
  ],strategy:["Events rotate, so select the enemy profile and target scale that match the current site rather than relying on stale hard-coded spawns.","Use exact NPC search when the current event NPC is present in the SDE.","The selected fitted drone flight feeds live DPS immediately, making it easy to compare the damage type you plan to bring."]},
];
const dedTargetProfile=(rating:number)=>rating<=3?COMBAT_TARGET_PROFILES.light:rating<=5?COMBAT_TARGET_PROFILES.mixed:COMBAT_TARGET_PROFILES.heavy;
const DED_COMPLEX_NAMES:Partial<Record<NpcDamagePreset,Array<{rating:number;name:string}>>> = {
  angel:[{rating:1,name:"Minmatar Contracted Bio-Farm"},{rating:2,name:"Angel Creo-Corp Mining"},{rating:3,name:"Angel Repurposed Outpost"},{rating:4,name:"Angel Cartel Occupied Mining Colony"},{rating:5,name:"Angel's Red Light District"},{rating:6,name:"Angel Mineral Acquisition Outpost"},{rating:7,name:"Angel Military Operations Complex"},{rating:8,name:"Cartel Prisoner Retention"},{rating:10,name:"Angel Cartel Naval Shipyard"}],
  "blood-raiders":[{rating:1,name:"Old Meanie - Cultivation Center"},{rating:2,name:"Blood Raider Human Farm"},{rating:3,name:"Blood Raider Intelligence Collection Point"},{rating:4,name:"Mul-Zatah Monastery"},{rating:5,name:"Blood Raider Psychotropics Depot"},{rating:6,name:"Crimson Hand Supply Depot"},{rating:7,name:"Blood Raider Coordination Center"},{rating:8,name:"Blood Raider Prison Camp"},{rating:10,name:"Blood Raider Naval Shipyard"}],
  guristas:[{rating:1,name:"Pith Robux Asteroid Mining & Co."},{rating:2,name:"Pith Merchant Depot"},{rating:3,name:"Guristas Guerilla Grounds"},{rating:4,name:"Guristas Scout Outpost"},{rating:5,name:"Guristas Hallucinogen Supply Waypoint"},{rating:6,name:"Guristas Troop Reinvigoration Camp"},{rating:7,name:"Gurista Military Operations Complex"},{rating:8,name:"Pith's Penal Complex"},{rating:10,name:"The Maze"}],
  sansha:[{rating:1,name:"Sansha Military Outpost"},{rating:2,name:"Sansha Acclimatization Facility"},{rating:3,name:"Sansha's Command Relay Outpost"},{rating:4,name:"Sansha's Nation Occupied Mining Colony"},{rating:5,name:"Sansha's Nation Neural Paralytic Facility"},{rating:6,name:"Sansha War Supply Complex"},{rating:7,name:"Sansha Military Operations Complex"},{rating:8,name:"Sansha Prison Camp"},{rating:10,name:"Centus Assembly T.P. Co."}],
  serpentis:[{rating:1,name:"Serpentis Drug Outlet"},{rating:2,name:"Serpentis Live Cargo Distribution Facilities"},{rating:3,name:"Serpentis Narcotic Warehouses"},{rating:4,name:"Serpentis Phi-Outpost"},{rating:5,name:"Serpentis Corporation Hydroponics Site"},{rating:6,name:"Serpentis Logistical Outpost"},{rating:7,name:"Serpentis Paramilitary Complex"},{rating:8,name:"Serpentis Prison Camp"},{rating:10,name:"Serpentis Fleet Shipyard"}],
  "rogue-drones":[{rating:2,name:"Rogue Drone Infestation Sprout"},{rating:3,name:"Rogue Drone Asteroid Infestation"},{rating:4,name:"Drone Infested Mine"},{rating:5,name:"Outgrowth Rogue Drone Hive"},{rating:10,name:"Outgrowth Rogue Drone Hive"}],
};
const DED_UNRATED_BY_FACTION:Partial<Record<NpcDamagePreset,CombatSiteOption[]>> = {
  angel:[site("unrated-outpost","Angel Outpost","Unrated Angel combat signature.",COMBAT_TARGET_PROFILES.medium),site("unrated-minor-annex","Minor Angel Annex","Unrated Angel complex.",COMBAT_TARGET_PROFILES.medium),site("unrated-annex","Angel Annex","Unrated Angel complex with escalation potential.",COMBAT_TARGET_PROFILES.mixed),site("unrated-base","Angel Base","Null-sec unrated Angel complex.",COMBAT_TARGET_PROFILES.heavy),site("unrated-fortress","Angel Fortress","Heavy unrated Angel complex.",COMBAT_TARGET_PROFILES.heavy),site("unrated-military","Angel Military Complex","Heavy unrated military complex.",COMBAT_TARGET_PROFILES.heavy),site("unrated-provincial","Angel Provincial HQ","High-end unrated Angel complex.",COMBAT_TARGET_PROFILES.heavy),site("unrated-staging","Angel Domination Fleet Staging Point","Fleet-staging-point combat chain.",COMBAT_TARGET_PROFILES.heavy)],
  "blood-raiders":[site("unrated-outpost","Blood Raider Outpost","Unrated Blood Raider combat signature.",COMBAT_TARGET_PROFILES.medium),site("unrated-minor-annex","Minor Blood Annex","Unrated Blood Raider complex.",COMBAT_TARGET_PROFILES.medium),site("unrated-annex","Blood Annex","Unrated Blood Raider complex.",COMBAT_TARGET_PROFILES.mixed),site("unrated-base","Blood Raider Base","Null-sec unrated Blood Raider complex.",COMBAT_TARGET_PROFILES.heavy),site("unrated-fortress","Blood Raider Fortress","Heavy unrated Blood Raider complex.",COMBAT_TARGET_PROFILES.heavy),site("unrated-military","Blood Military Complex","Heavy unrated military complex.",COMBAT_TARGET_PROFILES.heavy),site("unrated-provincial","Blood Provincial HQ","High-end unrated Blood Raider complex.",COMBAT_TARGET_PROFILES.heavy),site("unrated-staging","Dark Blood Fleet Staging Point","Fleet-staging-point combat chain.",COMBAT_TARGET_PROFILES.heavy)],
  guristas:[site("unrated-outpost","Gurista Outpost","Unrated Guristas combat signature.",COMBAT_TARGET_PROFILES.medium),site("unrated-minor-annex","Minor Guristas Annex","Unrated Guristas complex.",COMBAT_TARGET_PROFILES.medium),site("unrated-annex","Guristas Annex","Unrated Guristas complex.",COMBAT_TARGET_PROFILES.mixed),site("unrated-base","Gurista Base","Null-sec unrated Guristas complex.",COMBAT_TARGET_PROFILES.heavy),site("unrated-fortress","Gurista Fortress","Heavy unrated Guristas complex.",COMBAT_TARGET_PROFILES.heavy),site("unrated-military","Gurista Military Complex","Heavy unrated military complex.",COMBAT_TARGET_PROFILES.heavy),site("unrated-provincial","Gurista Provincial HQ","High-end unrated Guristas complex.",COMBAT_TARGET_PROFILES.heavy),site("unrated-staging","Dread Guristas Fleet Staging Point","Fleet-staging-point combat chain.",COMBAT_TARGET_PROFILES.heavy)],
  sansha:[site("unrated-outpost","Sansha Outpost","Unrated Sansha combat signature.",COMBAT_TARGET_PROFILES.medium),site("unrated-minor-annex","Minor Sansha Annex","Unrated Sansha complex.",COMBAT_TARGET_PROFILES.medium),site("unrated-annex","Sansha Annex","Unrated Sansha complex.",COMBAT_TARGET_PROFILES.mixed),site("unrated-base","Sansha Base","Null-sec unrated Sansha complex.",COMBAT_TARGET_PROFILES.heavy),site("unrated-fortress","Sansha Fortress","Heavy unrated Sansha complex.",COMBAT_TARGET_PROFILES.heavy),site("unrated-military","Sansha Military Complex","Heavy unrated military complex.",COMBAT_TARGET_PROFILES.heavy),site("unrated-provincial","Sansha Provincial HQ","High-end unrated Sansha complex.",COMBAT_TARGET_PROFILES.heavy),site("unrated-staging","True Sansha Fleet Staging Point","Fleet-staging-point combat chain.",COMBAT_TARGET_PROFILES.heavy)],
  serpentis:[site("unrated-outpost","Serpentis Outpost","Unrated Serpentis combat signature.",COMBAT_TARGET_PROFILES.medium),site("unrated-minor-annex","Minor Serpentis Annex","Unrated Serpentis complex.",COMBAT_TARGET_PROFILES.medium),site("unrated-annex","Serpentis Annex","Unrated Serpentis complex.",COMBAT_TARGET_PROFILES.mixed),site("unrated-base","Serpentis Base","Null-sec unrated Serpentis complex.",COMBAT_TARGET_PROFILES.heavy),site("unrated-fortress","Serpentis Fortress","Heavy unrated Serpentis complex.",COMBAT_TARGET_PROFILES.heavy),site("unrated-military","Serpentis Military Complex","Heavy unrated military complex.",COMBAT_TARGET_PROFILES.heavy),site("unrated-provincial","Serpentis Provincial HQ","High-end unrated Serpentis complex.",COMBAT_TARGET_PROFILES.heavy),site("unrated-staging","Shadow Serpentis Fleet Staging Point","Fleet-staging-point combat chain.",COMBAT_TARGET_PROFILES.heavy)],
};
const INITIAL_COMBAT_SCENARIO:FitCombatScenarioState = { activity:"manual", space:"any", faction:"omni", site:"manual", abyssHull:"cruiser" };
const combatActivity=(id:CombatActivityId)=>FIT_COMBAT_ACTIVITIES.find(item=>item.id===id)??FIT_COMBAT_ACTIVITIES[0];
const combatSitesFor=(state:FitCombatScenarioState)=>{
  const activity=combatActivity(state.activity);
  if(state.activity!=="ded")return activity.sites;
  const named=DED_COMPLEX_NAMES[state.faction]??[];
  if(!named.length)return activity.sites;
  return [...named.map(item=>site(`ded-${item.rating}`,`${item.rating}/10 · ${item.name}`,`Faction-specific DED complex for ${NPC_DAMAGE_PRESETS[state.faction].label}.`,dedTargetProfile(item.rating))),...DED_UNRATED_BY_FACTION[state.faction]??[],site("expedition","Escalation / expedition","Escalated combat chain from the selected pirate faction; use the exact chain/stage where known.",COMBAT_TARGET_PROFILES.heavy)];
};
const combatSite=(state:FitCombatScenarioState)=>{const sites=combatSitesFor(state);return sites.find(item=>item.id===state.site)??sites[0]};

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

type FitShoppingEntry = { typeId: number; name: string; quantity: number };
type FitCostEstimate = { total: number; pricedTypes: number; totalTypes: number; createdAt: string | null };

function fitShoppingEntries(fit: Fit): FitShoppingEntry[] {
  const raw = [
    fit.hull,
    ...fit.high, ...fit.mid, ...fit.low, ...fit.rig, ...fit.subsystem,
    ...fit.drones, ...fit.fighters, ...fit.cargo, ...fit.implants, ...fit.boosters,
  ].flatMap((item) => item.typeId ? [{ typeId: item.typeId, name: item.name, quantity: Math.max(1, Math.floor(item.quantity || 1)) }] : []);
  for (const module of [...fit.high, ...fit.mid, ...fit.low]) {
    if (module.chargeTypeId && module.charge) raw.push({ typeId: module.chargeTypeId, name: module.charge, quantity: Math.max(1, Math.floor(module.chargeQuantity || 1)) });
  }
  const merged = new Map<number, FitShoppingEntry>();
  for (const entry of raw) {
    const current = merged.get(entry.typeId);
    if (current) current.quantity += entry.quantity;
    else merged.set(entry.typeId, { ...entry });
  }
  return [...merged.values()];
}

function formatFitIsk(value: number) {
  if (!Number.isFinite(value)) return "Unavailable";
  return `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(Math.max(0, value))} ISK`;
}

const FITTING_APP_INSTRUCTIONS = `NEW EDEN SAGE - UNIVERSAL FIT REQUEST FOR ANY LLM

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

type PendingFitImport = { fit: Fit; characterId?: string };

function takePendingFit(): PendingFitImport | null {
  const pendingRaw = localStorage.getItem("new-eden-sage-pending-fit");
  if (!pendingRaw) return null;
  const parsed = JSON.parse(pendingRaw);
  const pending = { fit: normalizeFit(parsed), characterId: parsed?.characterId ? String(parsed.characterId) : undefined };
  localStorage.removeItem("new-eden-sage-pending-fit");
  return pending;
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
type FittingTypeInfo = Awaited<ReturnType<typeof window.sage.getFittingTypeInfoLocal>>;
type ModuleStateCapabilities = { canActivate:boolean; canOverheat:boolean };
const fittingTypeInfoCache = new Map<number,Promise<FittingTypeInfo>>();
const moduleStateCapabilityCache = new Map<number,Promise<ModuleStateCapabilities>>();
function getFittingTypeInfoCached(typeId:number) {
  let pending=fittingTypeInfoCache.get(typeId);
  if(!pending){
    pending=window.sage.getFittingTypeInfoLocal(typeId);
    fittingTypeInfoCache.set(typeId,pending);
    void pending.catch(()=>fittingTypeInfoCache.delete(typeId));
  }
  return pending;
}
function getModuleStateCapabilities(typeId:number) {
  let pending=moduleStateCapabilityCache.get(typeId);
  if(!pending){
    pending=getFittingTypeInfoCached(typeId).then((info)=>{
      const effects=info.effects??[];
      const canOverheat=effects.some((effect)=>Number(effect.category)===5);
      const canActivate=effects.some((effect)=>Number(effect.effectId)!==16 && (Number(effect.category)===1 || Number(effect.category)===2));
      return {canActivate,canOverheat};
    }).catch(()=>({canActivate:true,canOverheat:false}));
    moduleStateCapabilityCache.set(typeId,pending);
  }
  return pending;
}

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

async function resolveFitFromEve(fit: Fit, known: Map<string, number>, options: { rejectUnresolvedFitted?: boolean } = {}) {
  let locallyResolved: Fit = resolveFit(normalizeFit(fit), known);
  const idItems = fitItems(locallyResolved).filter((item) => item.typeId && /^Type \d+$/i.test(item.name));
  if (idItems.length) {
    const byId = new Map((await window.sage.resolveTypeIds([...new Set(idItems.map((item) => item.typeId!))])).map((item) => [item.id, item.name]));
    const rename = (item: FitItem) => item.typeId && byId.has(item.typeId) ? { ...item, name: byId.get(item.typeId)! } : item;
    locallyResolved = { ...locallyResolved, hull: rename(locallyResolved.hull), low: locallyResolved.low.map(rename), mid: locallyResolved.mid.map(rename), high: locallyResolved.high.map(rename), rig: locallyResolved.rig.map(rename), subsystem: locallyResolved.subsystem.map(rename), drones: locallyResolved.drones.map(rename), fighters: locallyResolved.fighters.map(rename), cargo: locallyResolved.cargo.map(rename), implants: locallyResolved.implants.map(rename), boosters: locallyResolved.boosters.map(rename) };
  }

  const allItems = fitItems(locallyResolved);
  const missingNames = [...new Set(allItems.filter((item) => !item.typeId).map((item) => item.name))];
  for (const item of allItems) if (item.charge && !item.chargeTypeId) missingNames.push(item.charge);
  const allNames = allItems.map((item) => item.name);
  const lookupNames = [...new Set([...missingNames, ...allNames])];
  const lookupTypeIds = [...new Set(allItems.flatMap((item) => item.typeId && item.typeId > 0 ? [item.typeId] : []))];
  const [resolvedByName, resolvedById] = await Promise.all([
    lookupNames.length ? window.sage.resolveFittingTypeNamesLocal(lookupNames) : Promise.resolve([]),
    lookupTypeIds.length ? window.sage.resolveFittingTypeIdsLocal(lookupTypeIds) : Promise.resolve([]),
  ]);
  const metadataById = new Map<number, any>();
  for (const item of [...resolvedByName, ...resolvedById]) metadataById.set(Number(item.id), item);
  const metadata = [...metadataById.values()];
  const names = new Map(known);
  for (const item of metadata) names.set(String(item.name).toLowerCase(), Number(item.id));
  const withIds = resolveFit(locallyResolved, names);

  // Imported slot labels are untrusted. CCP DOGMA is authoritative for every fitted
  // item, regardless of whether the source was JSON, EFT, MCP, Activity Command or cargo.
  const canonical = canonicalizeFittingPlacement(withIds, metadata);
  if (canonical.unresolvedFitted.length && options.rejectUnresolvedFitted !== false) {
    const detail = canonical.unresolvedFitted.slice(0, 5).map(({ item, sourceRack }) => item.name + " (" + sourceRack + ")").join(", ");
    throw new Error("Import blocked: Sage could not prove the CCP fitting rack for " + detail + ". Unverified fitted items are never stored in a ship slot.");
  }
  const expandRack = (items: FitItem[]) => items.flatMap((item) =>
    Array.from({ length: Math.max(1, Math.floor(item.quantity || 1)) }, () => ({ ...item, quantity: 1 })),
  );
  return {
    ...canonical.fit,
    low: expandRack(canonical.fit.low),
    mid: expandRack(canonical.fit.mid),
    high: expandRack(canonical.fit.high),
    rig: expandRack(canonical.fit.rig),
    subsystem: expandRack(canonical.fit.subsystem),
  };
}

export function FittingsWorkspace({ onExportToPlanner, activeCharacterId }: { onExportToPlanner?: (intent: FitResolutionIntent) => void; activeCharacterId?: string }) {
  const initialPending = useMemo(() => {
    try { return takePendingFit(); } catch { return null; }
  }, []);
  const legacyFittingPersistence = useMemo(() => {
    let savedFits: unknown[] = [];
    let fitLibraryMeta: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(localStorage.getItem("new-eden-sage-fits") ?? "[]");
      if (Array.isArray(parsed)) savedFits = parsed;
    } catch {}
    try {
      const parsed = JSON.parse(localStorage.getItem("new-eden-sage-fit-library-meta") ?? "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fitLibraryMeta = parsed;
    } catch {}
    return { savedFits, fitLibraryMeta };
  }, []);
  const [fits, setFits] = useState<Fit[]>([]);
  const [activeId, setActiveId] = useState("");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState(
    "Paste an EFT or Sage JSON fitting block from ChatGPT.",
  );
  const [typeNames, setTypeNames] = useState(new Map<string, number>());
  const [characters, setCharacters] = useState<
    FittingCharacter[]
  >([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState(initialPending?.characterId ?? activeCharacterId ?? "");
  const [doctrineExport, setDoctrineExport] = useState<DoctrineExportDraft | null>(null);
  const [routeOpen, setRouteOpen] = useState(false);
  const [sideMode, setSideMode] = useState<"build" | "import" | "saved">("build");
  const [builderBrowseMode, setBuilderBrowseMode] = useState<"catalogue" | "ships">("catalogue");
  const [showInfoTarget, setShowInfoTarget] = useState<ShowInfoTarget | null>(null);
  const [lastValidation, setLastValidation] = useState<FitValidationResult | null>(null);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [librarySort, setLibrarySort] = useState<FitLibrarySort>("recent");
  const [libraryMeta, setLibraryMeta] = useState<FitLibraryMetaMap>({});
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [issuesDock, setIssuesDock] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const handleShellSearch = (event: Event) => {
      const query = String((event as CustomEvent<string>).detail ?? "");
      setSideMode("build");
      window.setTimeout(() => window.dispatchEvent(new CustomEvent("sage:fitter-search-builder", { detail: query })), 0);
    };
    window.addEventListener("sage:fitter-search", handleShellSearch);
    return () => window.removeEventListener("sage:fitter-search", handleShellSearch);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void window.sage.loadFittingPersistence(legacyFittingPersistence).then((value) => {
      if (cancelled) return;
      const normalized = (Array.isArray(value.savedFits) ? value.savedFits : [])
        .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate) && typeof candidate === "object" && !Array.isArray(candidate))
        .map((candidate) => normalizeFit(candidate));
      const meta = value.fitLibraryMeta && typeof value.fitLibraryMeta === "object" ? value.fitLibraryMeta as FitLibraryMetaMap : {};
      setFits(normalized);
      setLibraryMeta(ensureFitMeta(normalized, meta));
      const selected = value.selectedFitId && normalized.some((fit) => fit.id === value.selectedFitId) ? value.selectedFitId : normalized[0]?.id ?? "";
      setActiveId(selected);
      setPersistenceReady(true);
      if (normalized.length) setStatus("Loaded " + normalized.length + " saved fitting" + (normalized.length === 1 ? "" : "s") + " from Sage persistent storage.");
    }).catch((caught) => {
      if (cancelled) return;
      setStatus(caught instanceof Error ? "Saved fittings could not be loaded: " + caught.message : "Saved fittings could not be loaded.");
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!persistenceReady || !initialPending?.fit) return;
    let cancelled = false;
    void resolveFitFromEve(initialPending.fit, new Map<string, number>()).then((resolved) => {
      if (cancelled) return;
      setFits((current) => [resolved, ...current.filter((fit) => fit.id !== resolved.id)]);
      setActiveId(resolved.id);
      if (initialPending.characterId) setSelectedCharacterId(initialPending.characterId);
      setSideMode("build");
      setStatus(resolved.name + " imported from Activity Command and rack-validated against CCP DOGMA.");
    }).catch((caught) => {
      if (!cancelled) setStatus(caught instanceof Error ? caught.message : "Activity Command fit failed CCP rack validation.");
    });
    return () => { cancelled = true; };
  }, [persistenceReady]);
  useEffect(() => {
    if (!persistenceReady) return;
    const importPendingFit = () => {
      try {
        const pending = takePendingFit();
        if (!pending) return;
        void resolveFitFromEve(pending.fit, new Map<string, number>()).then((resolved) => {
          setFits((current) => [resolved, ...current.filter((fit) => fit.id !== resolved.id)]);
          setActiveId(resolved.id);
          if (pending.characterId) setSelectedCharacterId(pending.characterId);
          setSideMode("build");
          setStatus(resolved.name + " imported from Activity Command and rack-validated against CCP DOGMA.");
        }).catch((caught) => {
          setStatus(caught instanceof Error ? caught.message : "Activity Command fit failed CCP rack validation.");
        });
      } catch (caught) {
        setStatus(caught instanceof Error ? caught.message : "Could not import the Activity Command fit.");
      }
    };
    window.addEventListener("sage:navigate-fittings", importPendingFit);
    return () => window.removeEventListener("sage:navigate-fittings", importPendingFit);
  }, [persistenceReady]);
  useEffect(() => {
    window.sage.listSnapshots().then((loaded) => {
      setCharacters(loaded);
      setSelectedCharacterId((current) => {
        if (current && loaded.some((character) => character.characterId === current)) return current;
        if (activeCharacterId && loaded.some((character) => character.characterId === activeCharacterId)) return activeCharacterId;
        return loaded[0]?.characterId || "";
      });
    });
  }, []);
  useEffect(() => {
    if (!activeCharacterId) return;
    if (characters.some((character) => character.characterId === activeCharacterId)) setSelectedCharacterId(activeCharacterId);
  }, [activeCharacterId, characters]);
  useEffect(() => {
    if (!persistenceReady) return;
    const rackSchemaKey = "new-eden-sage-fitting-rack-schema";
    const rackSchemaVersion = "ccp-dogma-v1";
    if (localStorage.getItem(rackSchemaKey) === rackSchemaVersion) return;
    const savedAtMount = fits;
    if (!savedAtMount.length) {
      localStorage.setItem(rackSchemaKey, rackSchemaVersion);
      return;
    }
    let cancelled = false;
    void Promise.all(savedAtMount.map(async (fit) => {
      try {
        return { id: fit.id, repaired: await resolveFitFromEve(fit, new Map<string, number>(), { rejectUnresolvedFitted: false }) };
      } catch {
        return { id: fit.id, repaired: null };
      }
    })).then((results) => {
      if (cancelled) return;
      const repairedById = new Map(results.flatMap((result) => result.repaired ? [[result.id, result.repaired] as const] : []));
      if (repairedById.size) setFits((current) => current.map((fit) => repairedById.get(fit.id) ?? fit));
      if (results.every((result) => result.repaired)) localStorage.setItem(rackSchemaKey, rackSchemaVersion);
    });
    return () => { cancelled = true; };
  }, [persistenceReady]);
  useEffect(() => {
    if (!persistenceReady) return;
    setLibraryMeta((current) => ensureFitMeta(fits, current));
  }, [fits, persistenceReady]);
  useEffect(() => {
    if (!persistenceReady) return;
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
  }, [persistenceReady]);
  useEffect(() => {
    if (!persistenceReady) return;
    void window.sage.saveFittingPersistence({ savedFits: fits, fitLibraryMeta: libraryMeta, selectedFitId: activeId || undefined })
      .catch((caught) => setStatus(caught instanceof Error ? "Saved fittings could not be persisted: " + caught.message : "Saved fittings could not be persisted."));
  }, [fits, libraryMeta, activeId, persistenceReady]);
  useEffect(() => {
    if (!persistenceReady) return;
    let updateSequence = 0;
    const applyMcpFitUpdate = async (value: { savedFits?: unknown[]; fitLibraryMeta?: Record<string, unknown>; selectedFitId?: string }) => {
      const sequence = ++updateSequence;
      if (Array.isArray(value.savedFits)) {
        const normalized = value.savedFits
          .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate) && typeof candidate === "object" && !Array.isArray(candidate))
          .map((candidate) => normalizeFit(candidate));
        let resolved = normalized;
        try {
          resolved = await Promise.all(normalized.map((fit) => resolveFitFromEve(fit, new Map<string, number>())));
        } catch (caught) {
          if (sequence !== updateSequence) return;
          setStatus(caught instanceof Error ? `MCP fit rejected by local CCP fitting validation: ${caught.message}` : "MCP fit rejected by local CCP fitting validation.");
          return;
        }
        if (sequence !== updateSequence) return;
        setFits(resolved);
        const selected = typeof value.selectedFitId === "string" && resolved.some((fit) => fit.id === value.selectedFitId)
          ? value.selectedFitId
          : undefined;
        setActiveId((current) => selected ?? (resolved.some((fit) => fit.id === current) ? current : (resolved[0]?.id ?? "")));
        if (selected) {
          const fit = resolved.find((candidate) => candidate.id === selected);
          if (fit) {
            const unresolved = fitItems(fit).filter((item) => !item.typeId).length;
            setSideMode("build");
            setStatus(unresolved ? `${fit.name} received from MCP; ${unresolved} item name(s) could not be resolved.` : `${fit.name} received from MCP and resolved against the local SDE.`);
          }
        }
      }
      if (sequence !== updateSequence) return;
      if (value.fitLibraryMeta && typeof value.fitLibraryMeta === "object") setLibraryMeta(value.fitLibraryMeta as FitLibraryMetaMap);
    };
    const removeIpcListener = window.sage.onMcpFitDataUpdated((value) => { void applyMcpFitUpdate(value); });
    const onDirectRendererUpdate = (event: Event) => { void applyMcpFitUpdate((event as CustomEvent).detail ?? {}); };
    window.addEventListener("sage:mcp-fit-data-updated", onDirectRendererUpdate);
    return () => {
      updateSequence += 1;
      removeIpcListener();
      window.removeEventListener("sage:mcp-fit-data-updated", onDirectRendererUpdate);
    };
  }, [persistenceReady]);
  // Saved fits hydrate once from Sage persistent storage. Resolving the complete CCP DOGMA index on
  // mount used to freeze the entire app the first time Fittings was opened.
  // Type resolution now happens only when a fit is imported or analyzed.
  const active = useMemo(
    () => activeId ? fits.find((fit) => fit.id === activeId) : undefined,
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
      const { imported, duplicateCount, renamedCount } = prepareImportedFits(fits, resolved);
      const validations = imported.map(validateFit);
      setLastValidation(validations.find((result) => result.issues.length) ?? validations[0]);
      setFits((current) => [...imported, ...current]);
      setActiveId(imported[0].id);
      const unresolved = imported.reduce((total, fit) => total + fitItems(fit).filter((item) => !item.typeId).length, 0);
      const duplicateNote = duplicateCount ? ` ${duplicateCount} duplicate fitting${duplicateCount === 1 ? "" : "s"} kept instead of skipped.` : "";
      const renamedNote = renamedCount ? ` ${renamedCount} imported fitting${renamedCount === 1 ? "" : "s"} automatically renamed.` : "";
      setStatus(`Imported ${imported.length} fitting${imported.length === 1 ? "" : "s"}.${duplicateNote}${renamedNote} ${unresolved} item name(s) remain unresolved.`);
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
  async function importCurrentEveFit() {
    if (!selectedCharacterId) {
      setStatus("Select a connected character before importing the current EVE fit.");
      return;
    }
    try {
      setLastValidation(null);
      setStatus("Refreshing current EVE ship and fitted assets...");
      const snapshot = await window.sage.refreshCurrentShip(selectedCharacterId);
      const currentRows = Array.isArray(snapshot.extended?.currentShipFit) ? snapshot.extended.currentShipFit : [];
      const currentTypeIds = [...new Set(currentRows.flatMap((item:any) => Number(item?.type_id) > 0 ? [Number(item.type_id)] : []))];
      const currentTypeMeta = currentTypeIds.length ? await window.sage.resolveFittingTypeIdsLocal(currentTypeIds) : [];
      const currentMetaById = new Map(currentTypeMeta.map((item:any) => [Number(item.id), item]));
      const enrichedSnapshot = {
        ...snapshot,
        extended: {
          ...(snapshot.extended ?? {}),
          currentShipFit: currentRows.map((item:any) => {
            const meta = currentMetaById.get(Number(item.type_id)) as any;
            return { ...item, item: meta?.name ?? item.item, category_id: meta?.categoryId ?? item.category_id, categoryName: meta?.categoryName };
          }),
        },
      } as CharacterSnapshot;
      setCharacters((current) => current.map((character) => character.characterId === enrichedSnapshot.characterId ? enrichedSnapshot : character));
      const draft = currentEveFitFromSnapshot(enrichedSnapshot) as Fit;
      const resolved = await resolveFitFromEve(draft, typeNames);
      const validation = validateFit(resolved);
      setLastValidation(validation);
      if (!validation.valid) {
        setStatus(`Current EVE fit import blocked: ${validation.errors.map((issue) => issue.message).join("  ")}`);
        return;
      }
      const { imported, duplicateCount, renamedCount } = prepareImportedFits(fits, [resolved]);
      const importedFit = imported[0];
      setFits((current) => [importedFit, ...current]);
      setActiveId(importedFit.id);
      setSelectedCharacterId(snapshot.characterId);
      setSideMode("build");
      const fittedCount = importedFit.high.length + importedFit.mid.length + importedFit.low.length + importedFit.rig.length + importedFit.subsystem.length;
      const bayCount = importedFit.drones.reduce((sum, item) => sum + item.quantity, 0) + importedFit.fighters.reduce((sum, item) => sum + item.quantity, 0);
      const notes = [duplicateCount ? "duplicate kept" : "", renamedCount ? "renamed to keep both fits" : ""].filter(Boolean).join(", ");
      setStatus(`Imported current EVE fit from ${snapshot.character.name}: ${snapshot.ship.ship_type_name} with ${fittedCount} fitted modules/rigs and ${bayCount} drones/fighters.${notes ? " " + notes + "." : ""} Loaded charges and live activation state may need review.`);
    } catch (error) {
      setLastValidation(null);
      setStatus(error instanceof Error ? error.message : "The current EVE fit could not be imported.");
    }
  }

  function touchFit(id: string) {
    setLibraryMeta((current) => ({ ...current, [id]: { ...(current[id] ?? { createdAt: new Date().toISOString() }), updatedAt: new Date().toISOString(), readiness: "unknown" } }));
  }

  function startNewFit() {
    setActiveId("");
    setSideMode("build");
    setInput("");
    setLastValidation(null);
    setStatus("New fitting ready. Choose a ship to start a clean build.");
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
      const fitted=[
        ...(["high","mid","low","rig","subsystem"] as const).flatMap(rack=>active[rack].flatMap(candidate=>candidate.typeId?[{typeId:candidate.typeId,rack}]:[])),
        ...active.implants.flatMap(candidate=>candidate.typeId?[{typeId:candidate.typeId,rack:"implant"}]:[]),
        ...active.boosters.flatMap(candidate=>candidate.typeId?[{typeId:candidate.typeId,rack:"booster"}]:[]),
      ];
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
          if (active[target].length >= limit) {
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
  function setActiveBayQuantity(target: "drones" | "fighters", index: number, delta: number, baseline: number, maxAllowed: number) {
    if (!active) return;
    const activeId = active.id;
    setFits((current) => current.map((fit) => {
      if (fit.id !== activeId) return fit;
      return { ...fit, [target]: fit[target].map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const quantity = advanceFitterActiveQuantity(item.activeQuantity, baseline, delta, item.quantity, maxAllowed);
        return { ...item, activeQuantity: quantity };
      }) };
    }));
    setLibraryMeta((current) => ({ ...current, [activeId]: { ...(current[activeId] ?? { createdAt: new Date().toISOString() }), updatedAt: new Date().toISOString() } }));
    setStatus(`Active ${target} selection updated. DPS and bandwidth will recalculate automatically.`);
  }
  function setActiveInstructions(instructions: string[]) {
    if (!active) return;
    const fitId = active.id;
    setFits((current) => current.map((fit) => fit.id === fitId ? { ...fit, instructions } : fit));
    touchFit(fitId);
  }

  function setActiveDroneFlight(typeId: number | null, activeCount = 0) {
    if (!active) return;
    const fitId = active.id;
    setFits((current) => current.map((fit) => {
      if (fit.id !== fitId) return fit;
      return { ...fit, drones: fit.drones.map((item) => typeId == null ? { ...item, activeQuantity: undefined } : { ...item, activeQuantity: item.typeId === typeId ? Math.max(0, Math.min(item.quantity, Math.floor(activeCount))) : 0 }) };
    }));
    touchFit(fitId);
    const chosen = typeId == null ? "automatic drone flight" : active.drones.find((item) => item.typeId === typeId)?.name ?? "drone flight";
    setStatus(`Using ${chosen}. DPS and bandwidth will recalculate automatically.`);
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
  function openDoctrineExport() {
    if (!active) return;
    const character = characters.find((item) => item.characterId === selectedCharacterId) ?? characters[0];
    const corporationId = Number(character?.character?.corporation_id ?? 0);
    if (!corporationId) {
      setStatus("Choose a connected corporation character before exporting to a doctrine.");
      return;
    }
    const slots = doctrineExportSlots(corporationId);
    const available = slots.find((slot) => slot.fitCount < 10);
    if (!available) {
      setStatus("All five doctrine slots are full for this corporation.");
      return;
    }
    setDoctrineExport({
      corporationId,
      corporationName: String(character?.character?.corporation_name ?? `Corporation ${corporationId}`),
      slot: available.slot,
      doctrineName: available.name || active.name,
      slots,
    });
  }
  function commitDoctrineExport() {
    if (!active || !doctrineExport) return;
    const selected = doctrineExport.slots.find((slot) => slot.slot === doctrineExport.slot);
    if (!selected || selected.fitCount >= 10) { setStatus("That doctrine slot is full. Choose another slot."); return; }
    const doctrineName = doctrineExport.doctrineName.trim() || selected.name || active.name;
    sessionStorage.setItem(PENDING_DOCTRINE_FIT_KEY, JSON.stringify({
      corporationId: doctrineExport.corporationId,
      targetSlot: doctrineExport.slot,
      doctrineName,
      exportedAt: new Date().toISOString(),
      fit: JSON.parse(JSON.stringify(active)),
    }));
    setDoctrineExport(null);
    setStatus(`${active.name} ready for ${doctrineExport.corporationName} - Doctrine ${doctrineExport.slot}.`);
    window.dispatchEvent(new CustomEvent("sage:navigate-corp-doctrines"));
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
        <div className="fit-catalogue-title-row"><strong>{sideMode === "import" ? "FIT IMPORT" : sideMode === "saved" ? "SAVED FITS" : builderBrowseMode === "ships" ? "SHIP CATALOGUE" : "MODULE CATALOGUE"}</strong><span aria-hidden="true">~</span></div>
        <div className="fit-catalogue-mode-tabs" role="tablist" aria-label="Fitting sidebar mode">
          <button type="button" role="tab" aria-selected={sideMode === "build"} className={sideMode === "build" ? "active" : ""} onClick={() => { setSideMode("build"); window.setTimeout(() => window.dispatchEvent(new CustomEvent("sage:fitter-open-modules")), 0); }}>{sideMode === "build" && builderBrowseMode === "ships" ? "Ships" : "Modules"}</button>
          <button type="button" role="tab" aria-selected={sideMode === "import"} className={sideMode === "import" ? "active" : ""} onClick={() => setSideMode("import")}>Import</button>
          <button type="button" role="tab" aria-selected={sideMode === "saved"} className={sideMode === "saved" ? "active" : ""} onClick={() => setSideMode("saved")}>Saved Fits</button>
        </div>
      </div>
      <aside className="fit-v2-browser">
        {sideMode === "build" ? (
          <FitBuilder fit={active} characterId={selectedCharacterId} onCreate={createBuilderFit} onAdd={addBuilderItem} onRemove={removeBuilderItem} onQuantity={setBuilderItemQuantity} onState={setBuilderItemState} onCharge={loadBuilderCharge} onShowInfo={(typeId,name) => setShowInfoTarget({typeId,name})} onBrowseModeChange={setBuilderBrowseMode} />
        ) : sideMode === "import" ? (
          <div className="fit-v2-import">
            <p className="eyebrow">FIT IMPORT</p>
            <h3>Bring a fit into Sage</h3>
            <button type="button" className="fit-import-current-eve" onClick={() => void importCurrentEveFit()} disabled={!selectedCharacterId}>Import current EVE fit</button>
            <small className="fit-import-current-eve-note">Refreshes the selected character's active ship and imports its fitted assets directly from EVE.</small>
            <div className="fit-import-divider"><span>or paste a fit</span></div>
            <button type="button" className="copy-fit-prompt" onClick={() => void copyChatGPTInstructions()}>Copy prompt for any LLM</button>
            <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder={'Paste PYFA/EFT, XML, ESI JSON, DNA, Sage JSON, or a labelled plain-text fit...'} />
            <label className="copy-fit-prompt">Choose fitting file<input type="file" accept=".eft,.fit,.txt,.json,.xml,.dna" hidden onChange={async (event) => { const file=event.target.files?.[0]; if(!file)return; try{setInput(await file.text());setStatus(file.name+' loaded locally. Review it, then import.');}catch{setStatus('Could not read '+file.name+'.');} event.target.value=''; }} /></label>
            <button type="button" onClick={() => void importFit()} disabled={!input.trim()}>Import and display</button>
            <small>{status}</small>
            {lastValidation && lastValidation.issues.length > 0 && <div className="fit-validation"><strong>{lastValidation.valid ? "Validation report" : "Import blocked"}</strong>{lastValidation.issues.slice(0,6).map((issue,index)=><p className={issue.level} key={issue.code+index}>{issue.message}</p>)}</div>}
          </div>
        ) : (
          <div className="fit-saved-browser">
            <div className="fit-saved-browser-head"><span>SAVED FITS</span><button type="button" className="fit-new-build" onClick={startNewFit}>+ New Fit</button></div>
            <input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Search saved fits..." />
            <select value={librarySort} onChange={(event) => setLibrarySort(event.target.value as FitLibrarySort)}><option value="recent">Recently updated</option><option value="name">Name</option><option value="ship">Ship</option><option value="readiness">Readiness</option></select>
            <div className="fit-saved-list">{filterAndSortFits(fits, libraryMeta, libraryQuery, librarySort).map((saved) => <button type="button" key={saved.id} className={saved.id === activeId ? "active" : ""} onClick={() => { setActiveId(saved.id); setSideMode("build"); }}><img src={imageUrl(saved.hull.typeId,"icon",64)} /><span><strong>{saved.name}</strong><small>{saved.hull.name}</small></span></button>)}</div>
          </div>
        )}
      </aside>
      <div className="fit-v2-issues-dock" ref={setIssuesDock} />
      <div className="fit-main">
        {active ? <FitDisplay fit={active} characters={characters} characterId={selectedCharacterId} onCharacterChange={setSelectedCharacterId} onRemove={() => removeFit(active.id)} onRoute={() => setRouteOpen(true)} onRename={renameActiveFit} onDuplicate={duplicateActiveFit} onExport={exportActiveFit} onExportToDoctrine={openDoctrineExport} onModuleStateChange={setActiveModuleState} onBayActiveQuantityChange={setActiveBayQuantity} onDroneFlightChange={setActiveDroneFlight} onInstructionsChange={setActiveInstructions} onRemoveItem={removeBuilderItem} onAddItem={addBuilderItem} onLoadCharge={loadBuilderCharge} onAnalysis={(readiness, missingRequirements) => setLibraryMeta((current) => ({ ...current, [active.id]: { ...(current[active.id] ?? { createdAt: new Date().toISOString() }), updatedAt: new Date().toISOString(), lastAnalyzedAt: new Date().toISOString(), readiness, missingRequirements } }))} onExportToPlanner={(intent) => onExportToPlanner?.(intent)} onShowInfo={(typeId,name) => setShowInfoTarget({typeId,name})} onChangeShip={() => { setSideMode("build"); window.setTimeout(() => window.dispatchEvent(new CustomEvent("sage:fitter-open-ships")), 0); }} onBrowseDamageItems={(kind) => { setSideMode("build"); window.setTimeout(() => window.dispatchEvent(new CustomEvent(kind === "drones" ? "sage:fitter-open-drones" : "sage:fitter-open-weapons")), 0); }} issuesDock={issuesDock} /> : <div className="fit-empty"><h2>No fitting selected</h2><p>Create a fit from the module browser or import one.</p></div>}
      </div>
      {doctrineExport && active && <div className="fit-doctrine-export-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDoctrineExport(null); }}>
        <section className="fit-doctrine-export-dialog" role="dialog" aria-modal="true" aria-label="Export fitting to doctrine">
          <div className="fit-doctrine-export-head"><div><p className="eyebrow">CORPORATION - DOCTRINES</p><h3>Export to Doctrine</h3><p>{active.name} - {active.hull.name}</p></div><button className="fit-doctrine-export-close" onClick={() => setDoctrineExport(null)} aria-label="Close">X</button></div>
          <div className="fit-doctrine-export-corp"><span>DESTINATION CORPORATION</span><strong>{doctrineExport.corporationName}</strong></div>
          <label><span>Doctrine slot</span><select value={doctrineExport.slot} onChange={(event) => { const slot = Number(event.target.value); const target = doctrineExport.slots.find((item) => item.slot === slot); setDoctrineExport((current) => current ? { ...current, slot, doctrineName: target?.name || active.name } : current); }}>{doctrineExport.slots.map((slot) => <option key={slot.slot} value={slot.slot} disabled={slot.fitCount >= 10}>Slot {slot.slot} - {slot.name || "Empty"} ({slot.fitCount}/10)</option>)}</select></label>
          <label><span>Doctrine name</span><input value={doctrineExport.doctrineName} onChange={(event) => setDoctrineExport((current) => current ? { ...current, doctrineName: event.target.value } : current)} placeholder={active.name} /></label>
          <div className="fit-doctrine-export-actions"><button onClick={() => setDoctrineExport(null)}>Cancel</button><button className="primary" onClick={commitDoctrineExport}>Continue to doctrine</button></div>
          <small>The fitter queues this exact fit into the existing corporation doctrine library; no duplicate doctrine store is created.</small>
        </section>
      </div>}
      <FittingShowInfo target={showInfoTarget} onClose={() => setShowInfoTarget(null)} />
    </section>
  );
}

function FitBuilder({ fit, characterId, onCreate, onAdd, onRemove, onQuantity, onState, onCharge, onShowInfo, onBrowseModeChange }: { fit?: Fit; characterId?: string; onCreate(ship: ShipChoice, name?: string): void; onAdd(target: BuilderTarget, item: FittingSearchResult, mutation?: { option: MutationOption; values: Record<string, number> }): Promise<boolean>; onRemove(target: BuilderTarget, index: number): void; onQuantity(target: "drones" | "cargo", index: number, quantity: number): void; onState(target: FitModuleRack, index: number, state: ModuleState): void; onCharge(target: FitModuleRack, index: number, item: FittingSearchResult): Promise<boolean>; onShowInfo(typeId:number,name?:string):void; onBrowseModeChange?(mode:"catalogue"|"ships"):void; }) {
  const [ships, setShips] = useState<ShipChoice[]>(STATIC_SHIPS);
  const [browserTab, setBrowserTab] = useState<"catalogue" | "ships">(fit ? "catalogue" : "ships");
  const [hullQuery, setHullQuery] = useState("");
  const [fitName, setFitName] = useState("");
  const [onlyFlyableShips, setOnlyFlyableShips] = useState(false);
  const [flyableHullIds, setFlyableHullIds] = useState<Set<number> | null>(null);
  const [flyablePending, setFlyablePending] = useState(false);
  const [flyableError, setFlyableError] = useState("");
  const [catalogue, setCatalogue] = useState<FittingCatalogue>(()=>({groups:STATIC_FITTING_TREE.groups,items:[]}));
  const [catalogueSource, setCatalogueSource] = useState<"tree"|"cached"|"live">(sharedPreparationResult?"live":"tree");
  const [catalogueFilter, setCatalogueFilter] = useState("");
  const [placementFilter, setPlacementFilter] = useState<"all" | "high" | "mid" | "low" | "rig" | "drone" | "cargo">("all");
  const [browseCategories, setBrowseCategories] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(() => new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<CatalogueCategoryId>>(() => new Set());
  const [mutationMenu, setMutationMenu] = useState<{ x:number; y:number; item:FittingSearchResult }>();
  const [mutationEditor, setMutationEditor] = useState<{ item:FittingSearchResult; options:MutationOption[]; selected:number; values:Record<string,number> }>();
  const [mutationStatus, setMutationStatus] = useState("");
  const [catalogueStatus, setCatalogueStatus] = useState("");
  const [preparation, setPreparation] = useState<FittingPreparationProgress>(()=>sharedPreparationResult?{percent:100,stage:"ready",message:"Fitting data ready"}:{percent:4,stage:"metadata",message:"Preparing fitting data..."});
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
  const [catalogueHover,setCatalogueHover]=useState<{item:CatalogueItem;anchor:DOMRect}|null>(null);
  const [catalogueHoverTypeInfo,setCatalogueHoverTypeInfo]=useState<FittingTypeInfo|null>(null);
  useEffect(()=>{
    let cancelled=false;
    setCatalogueHoverTypeInfo(null);
    if(!catalogueHover)return()=>{cancelled=true;};
    void getFittingTypeInfoCached(catalogueHover.item.id).then(info=>{if(!cancelled)setCatalogueHoverTypeInfo(info);}).catch(()=>{if(!cancelled)setCatalogueHoverTypeInfo(null);});
    return()=>{cancelled=true;};
  },[catalogueHover?.item.id]);

  useEffect(() => {
    void window.sage.listShips().then((items: ShipChoice[]) => { if(items.length)setShips(items); }).catch(()=>undefined);
  }, []);
  useEffect(() => {
    if (!fit) {
      setBrowserTab("ships");
      setFitName("");
      setHullQuery("");
    } else {
      setBrowserTab("catalogue");
    }
  }, [fit?.id]);
  useEffect(() => {
    if (!onlyFlyableShips) { setFlyableHullIds(null); setFlyablePending(false); setFlyableError(""); return; }
    if (!characterId) { setFlyableHullIds(new Set()); setFlyablePending(false); setFlyableError("Select a synced character to filter flyable ships."); return; }
    let cancelled = false;
    setFlyablePending(true);
    setFlyableError("");
    void window.sage.getActivityHullPreviews({ characterId, hullTypeIds: ships.map((ship) => ship.typeId) })
      .then((previews) => {
        if (cancelled) return;
        setFlyableHullIds(new Set(previews.filter((preview) => preview.hullAccessReady).map((preview) => preview.hullTypeId)));
        setFlyablePending(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setFlyableHullIds(new Set());
        setFlyablePending(false);
        setFlyableError(error instanceof Error ? error.message : "Could not check hull access for this character.");
      });
    return () => { cancelled = true; };
  }, [onlyFlyableShips, characterId, ships]);
  useEffect(() => {
    localStorage.setItem("new-eden-sage-fitting-recent-types", JSON.stringify(recentTypeIds.slice(0,50)));
  }, [recentTypeIds]);
  useEffect(() => { onBrowseModeChange?.(browserTab); }, [browserTab, onBrowseModeChange]);
  useEffect(() => {
    const openShips = () => setBrowserTab("ships");
    const openModules = () => setBrowserTab("catalogue");
    const openDrones = () => { setBrowserTab("catalogue"); setPlacementFilter("drone"); setCatalogueFilter(""); };
    const openWeapons = () => { setBrowserTab("catalogue"); setPlacementFilter("high"); setCatalogueFilter(""); };
    const openCargo = () => { setBrowserTab("catalogue"); setPlacementFilter("cargo"); };
    const searchBuilder = (event: Event) => {
      const query = String((event as CustomEvent<string>).detail ?? "");
      setBrowserTab("catalogue");
      setPlacementFilter("all");
      setCatalogueFilter(query);
    };
    window.addEventListener("sage:fitter-open-ships", openShips);
    window.addEventListener("sage:fitter-open-modules", openModules);
    window.addEventListener("sage:fitter-open-drones", openDrones);
    window.addEventListener("sage:fitter-open-weapons", openWeapons);
    window.addEventListener("sage:fitter-open-cargo", openCargo);
    window.addEventListener("sage:fitter-search-builder", searchBuilder);
    return () => {
      window.removeEventListener("sage:fitter-open-ships", openShips);
      window.removeEventListener("sage:fitter-open-modules", openModules);
      window.removeEventListener("sage:fitter-open-drones", openDrones);
      window.removeEventListener("sage:fitter-open-weapons", openWeapons);
      window.removeEventListener("sage:fitter-open-cargo", openCargo);
      window.removeEventListener("sage:fitter-search-builder", searchBuilder);
    };
  }, []);
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
    const candidates = onlyFlyableShips ? (flyableHullIds ? ships.filter((ship) => flyableHullIds.has(ship.typeId)) : []) : ships;
    if (query.length < 1) return candidates.slice(0,80);
    return candidates.filter((ship) => ship.name.toLowerCase().includes(query)).sort((a,b)=>(a.name.toLowerCase().startsWith(query)?0:1)-(b.name.toLowerCase().startsWith(query)?0:1)||a.name.localeCompare(b.name)).slice(0,120);
  }, [ships, hullQuery, onlyFlyableShips, flyableHullIds]);

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
  const renderItem=(item:CatalogueItem)=><div className="fit-catalogue-item" key={item.id} draggable onMouseEnter={(event)=>setCatalogueHover({item,anchor:event.currentTarget.getBoundingClientRect()})} onMouseLeave={()=>setCatalogueHover(current=>current?.item.id===item.id?null:current)} onDragStart={(event)=>writeFittingDrag(event,item)} onContextMenu={(event)=>{event.preventDefault();setMutationMenu({x:event.clientX,y:event.clientY,item});}}><img src={imageUrl(item.id,"icon",64)}/><span><strong>{item.name}</strong><small>{item.rack ? (item.rack + " slot") : item.categoryName}{item.metaLevel>0?(" - meta " + item.metaLevel):""}</small></span><button type="button" className="fit-catalogue-add" aria-label={"Add "+item.name} title={item.categoryId===8?"Load into the first compatible fitted module":"Add to fit"} onClick={()=>void addResult(item)}>+</button></div>;

  const renderCategoryContent=(category:CatalogueCategory)=>{
    const rawItems=rawItemsForCategory(category);
    const compatibilityKey=compatibilityKeyFor(category,rawItems);
    const compatibleIds=compatibilityKey?compatibilityCache[compatibilityKey]:undefined;
    const compatibilityPending=Boolean(compatibilityKey&&!compatibleIds);
    const compatibleSet=compatibleIds?new Set(compatibleIds):null;
    const placementItems=placementFilter==="all"?rawItems:rawItems.filter(item=>item.placement===placementFilter);
    const displayItems=compatibilityKey?(compatibleSet?placementItems.filter(item=>compatibleSet.has(item.id)):[]):placementItems;
    if(category.dynamic==="recent") return displayItems.length?<div>{displayItems.map(renderItem)}</div>:<div className="fit-category-loading">No recently used fitting items yet.</div>;
    if(category.dynamic==="charges-active"){
      if(activeChargesPending)return <div className="fit-category-loading">Checking charges for the active fit...</div>;
      if(!fittedModuleTypeIds.length)return <div className="fit-category-loading">Fit a charge-using module to see compatible ammo and scripts here.</div>;
      if(typeof window.sage.getFittingChargesForModulesLocal!=="function")return <div className="fit-category-loading">Active-fit charge filtering will be available after the Sage dev window restarts.</div>;
      return displayItems.length?<div>{displayItems.map(renderItem)}</div>:<div className="fit-category-loading">No compatible ammo or scripts found for the active fit.</div>;
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
      return <div className="fit-catalogue-node" key={group.id}><button type="button" className="fit-catalogue-group" style={{paddingLeft:8+depth*13}} onClick={()=>hasContent&&toggleGroup(group.id)}><span>{hasContent?(isOpen?"v":">"):"-"}</span><strong>{group.name}</strong><small>{direct.length||""}</small></button>{isOpen&&<div>{children.map(child=>renderGroup(child,depth+1))}{direct.map(renderItem)}{!children.length&&!direct.length&&<div className="fit-category-loading">{catalogue.items.length===0||compatibilityPending?"Preparing modules...":fit?.hull.name&&category.hullFiltered?"No items in this group are valid for "+fit.hull.name+".":"No items in this group."}</div>}</div>}</div>;
    };
    const rootChildren=[] as CatalogueGroup[];
    const seen=new Set<number>();
    for(const root of rootGroups)for(const child of childrenByParent.get(root.id)??[]){if(!seen.has(child.id)){seen.add(child.id);rootChildren.push(child);}}
    rootChildren.sort((a,b)=>a.name.localeCompare(b.name));
    const rootDirectItems=rootGroups.flatMap(root=>itemsByGroup.get(root.id)??[]).sort((a,b)=>a.name.localeCompare(b.name));
    if(!rootGroups.length)return <div className="fit-category-loading">{catalogueSource==="tree"?"Preparing category navigation...":"No current SDE items are available in this category."}</div>;
    return <div>{rootChildren.map(group=>renderGroup(group,0))}{rootDirectItems.map(renderItem)}{!rootChildren.length&&!rootDirectItems.length&&<div className="fit-category-loading">{catalogue.items.length===0||compatibilityPending?"Preparing modules...":"No items available in this category."}</div>}</div>;
  };

  const catalogueSearchResults=useMemo(()=>{
    const query=catalogueFilter.trim().toLowerCase();
    if(!query)return [];
    return catalogue.items.filter(item=>item.placement!=="ship"&&(placementFilter==="all"||item.placement===placementFilter)&&item.name.toLowerCase().includes(query)).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,400);
  },[catalogue.items,catalogueFilter,placementFilter]);
  const contextualCatalogueItems=useMemo(()=>{
    const contextIds=[...recentTypeIds,...fittedModuleTypeIds,...(fit?.drones??[]).flatMap(item=>item.typeId?[item.typeId]:[]),...(fit?.cargo??[]).flatMap(item=>item.typeId?[item.typeId]:[])];
    const seen=new Set<number>();
    const items:CatalogueItem[]=[];
    for(const typeId of contextIds){
      if(seen.has(typeId))continue;
      seen.add(typeId);
      const item=itemById.get(typeId);
      if(!item||item.placement==="ship"||(placementFilter!=="all"&&item.placement!==placementFilter))continue;
      items.push(item);
      if(items.length>=7)break;
    }
    return items;
  },[itemById,recentTypeIds.join("|"),fittedModuleTypeIds.join("|"),fit?.id,fit?.drones,fit?.cargo,placementFilter]);
  const renderCategoryNavigation=()=>PYFA_CATALOGUE_CATEGORIES.map(category=>{
    const isOpen=expandedCategories.has(category.id);
    return <div className="fit-catalogue-node fit-catalogue-top-node" key={category.id}><button type="button" className="fit-catalogue-group fit-catalogue-top-group" onClick={()=>toggleCategory(category)}><span>{isOpen?"v":">"}</span><strong>{category.label}</strong><small></small></button>{isOpen&&<div className="fit-catalogue-top-content">{renderCategoryContent(category)}</div>}</div>;
  });

  return <div className="fit-builder fit-catalogue-browser">
    <div className="fit-builder-hull" onContextMenu={(event)=>{if(!fit?.hull.typeId)return;event.preventDefault();onShowInfo(fit.hull.typeId,fit.hull.name);}}><img src={imageUrl(fit?.hull.typeId,"icon",64)}/><span><strong>{fit?.hull.name??"Choose a ship"}</strong><small>Offline SDE fitting catalogue</small></span></div>
    <div className="fit-browser-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={browserTab==="catalogue"} className={browserTab==="catalogue"?"active":""} onClick={()=>setBrowserTab("catalogue")}>Catalogue</button>
      <button type="button" role="tab" aria-selected={browserTab==="ships"} className={browserTab==="ships"?"active":""} onClick={()=>setBrowserTab("ships")}>Ships</button>
    </div>
    {progressVisible&&<div className={"fitting-prep-progress "+(preparation.percent>=100?"ready":"")} aria-live="polite"><div><span>{preparation.message}</span><strong>{Math.round(Math.max(0,Math.min(100,preparation.percent)))}%</strong></div><b><i style={{width:Math.max(0,Math.min(100,preparation.percent))+"%"}}/></b></div>}
    {browserTab==="ships" ? <div className="fit-ships-tab">
      <div className="fit-ship-picker-head"><strong>Ship Catalogue</strong><button type="button" onClick={()=>setBrowserTab("catalogue")}>Return to Modules</button></div>
      <input value={fitName} onChange={event=>setFitName(event.target.value)} placeholder="Optional fit name"/>
      <input value={hullQuery} onChange={event=>setHullQuery(event.target.value)} placeholder="Filter ships..."/>
      <label className="fit-flyable-toggle"><input type="checkbox" checked={onlyFlyableShips} disabled={!characterId} onChange={(event)=>setOnlyFlyableShips(event.target.checked)}/><span>Only ships I can fly</span></label>
      {onlyFlyableShips && <small className={flyableError ? "fit-flyable-status error" : "fit-flyable-status"}>{flyablePending ? "Checking hull access..." : flyableError || `${flyableHullIds?.size ?? 0} flyable hulls`}</small>}
      <div className="fit-builder-results hull-results">{hullMatches.map(ship=><button type="button" key={ship.typeId} onClick={()=>{onCreate(ship,fitName);setBrowserTab("catalogue");}} onContextMenu={(event)=>{event.preventDefault();onShowInfo(ship.typeId,ship.name);}}><img src={imageUrl(ship.typeId,"icon",64)}/><span><strong>{ship.name}</strong><small>Create fitting - right-click Show Info</small></span></button>)}</div>
    </div> : <div className="fit-catalogue-tab">
      <div className="fit-catalogue-section-row"><strong>Catalogue</strong><small>{catalogueSource==="live"?"Current SDE":catalogueSource==="cached"?"Cached modules":"Navigation ready"}</small></div>
      <input className="fit-catalogue-filter" value={catalogueFilter} onChange={event=>setCatalogueFilter(event.target.value)} placeholder="Search modules..."/>
      <div className="fit-placement-chips" role="group" aria-label="Module slot filter">{([ ["all","All"], ["high","High"], ["mid","Mid"], ["low","Low"], ["rig","Rig"], ["drone","Drone"], ["cargo","Cargo"] ] as const).map(([id,label])=><button type="button" key={id} className={placementFilter===id?"active":""} onClick={()=>setPlacementFilter(id)}>{label}</button>)}</div>
      {catalogueStatus&&<small className="fit-catalogue-action-status">{catalogueStatus}</small>}
      <div className="fit-catalogue-tree">{catalogueFilter.trim()?catalogue.items.length===0?<div className="fit-category-loading">Preparing modules...</div>:catalogueSearchResults.length?catalogueSearchResults.map(renderItem):<small>No matching catalogue items.</small>:!browseCategories&&contextualCatalogueItems.length?<><div className="fit-catalogue-context-feed">{contextualCatalogueItems.map(renderItem)}</div><button type="button" className="fit-catalogue-browse-all" onClick={()=>setBrowseCategories(true)}>Browse all categories</button></>:<><button type="button" className="fit-catalogue-browse-all back" onClick={()=>setBrowseCategories(false)}>Contextual modules</button>{renderCategoryNavigation()}</>}</div>
    </div>}
    {catalogueHover&&<ModuleHoverCard item={{name:catalogueHover.item.name,typeId:catalogueHover.item.id,quantity:1}} rack={catalogueHover.item.rack} analysis={null} typeInfo={catalogueHoverTypeInfo} anchor={catalogueHover.anchor} />}
    {mutationMenu&&<div className="mutation-context-menu" style={{left:mutationMenu.x,top:mutationMenu.y}}><button type="button" onClick={()=>{onShowInfo(mutationMenu.item.id,mutationMenu.item.name);setMutationMenu(undefined);}}>Show Info</button>{mutationMenu.item.rack && <button type="button" onClick={()=>void openMutationEditor(mutationMenu.item)}>Mutate...</button>}<button type="button" onClick={()=>setMutationMenu(undefined)}>Cancel</button></div>}
    {mutationEditor&&<div className="mutation-backdrop" onMouseDown={()=>setMutationEditor(undefined)}><div className="mutation-editor" onMouseDown={event=>event.stopPropagation()}><div className="mutation-editor-head"><div><p className="eyebrow">ABYSSAL MUTATION</p><h3>{mutationEditor.item.name}</h3></div><button type="button" onClick={()=>setMutationEditor(undefined)}>X</button></div><label>Mutaplasmid<select value={mutationEditor.selected} onChange={event=>selectMutation(Number(event.target.value))}>{mutationEditor.options.map((option,index)=><option key={option.mutaplasmidTypeId} value={index}>{option.mutaplasmidName}</option>)}</select></label><div className="mutation-attributes">{mutationEditor.options[mutationEditor.selected].attributes.map(attribute=>{const key=String(attribute.attributeId);const value=mutationEditor.values[key]??attribute.baseValue;const delta=attribute.baseValue?((value/attribute.baseValue)-1)*100:0;return <div className="mutation-attribute" key={attribute.attributeId}><div><strong>{attribute.name}</strong><small>Base {attribute.baseValue.toFixed(3)} - legal {attribute.minValue.toFixed(3)} to {attribute.maxValue.toFixed(3)}</small></div><input type="range" min={attribute.minValue} max={attribute.maxValue} step={Math.max(Math.abs(attribute.maxValue-attribute.minValue)/1000,0.000001)} value={value} onChange={event=>setMutationEditor({...mutationEditor,values:{...mutationEditor.values,[key]:Number(event.target.value)}})}/><input type="number" min={attribute.minValue} max={attribute.maxValue} step="any" value={value} onChange={event=>setMutationEditor({...mutationEditor,values:{...mutationEditor.values,[key]:Math.min(attribute.maxValue,Math.max(attribute.minValue,Number(event.target.value)))}})}/><em className={(attribute.highIsGood?delta>=0:delta<=0)?"good":"bad"}>{delta>=0?"+":""}{delta.toFixed(1)}%</em></div>})}</div><div className="mutation-editor-foot"><span>{mutationEditor.options[mutationEditor.selected].resultingTypeName}</span><button type="button" onClick={()=>void addMutated()}>Add mutated module</button></div></div></div>}
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
  onExportToDoctrine,
  onModuleStateChange,
  onBayActiveQuantityChange,
  onDroneFlightChange,
  onInstructionsChange,
  onRemoveItem,
  onAddItem,
  onLoadCharge,
  onAnalysis,
  onExportToPlanner,
  onShowInfo,
  onChangeShip,
  onBrowseDamageItems,
  issuesDock,
}: {
  fit: Fit;
  characters: FittingCharacter[];
  characterId: string;
  onCharacterChange(id: string): void;
  onRemove(): void;
  onRoute(): void;
  onRename(): void;
  onDuplicate(): void;
  onExport(): void;
  onExportToDoctrine(): void;
  onModuleStateChange(rack: FitModuleRack, index: number, state: ModuleState): void;
  onBayActiveQuantityChange(target: "drones" | "fighters", index: number, delta: number, baseline: number, maxAllowed: number): void;
  onDroneFlightChange(typeId: number | null, activeCount?: number): void;
  onInstructionsChange(instructions: string[]): void;
  onRemoveItem(target: BuilderTarget, index: number): void;
  onAddItem(target: BuilderTarget, item: FittingSearchResult): Promise<boolean>;
  onLoadCharge(target: FitModuleRack, index: number, item: FittingSearchResult): Promise<boolean>;
  onAnalysis(readiness: "ready" | "missing", missingRequirements: number): void;
  onExportToPlanner(intent: FitResolutionIntent): void;
  onShowInfo(typeId:number,name?:string):void;
  onChangeShip():void;
  onBrowseDamageItems(kind:"drones"|"weapons"):void;
  issuesDock: HTMLDivElement | null;
}) {
  const [tab, setTab] = useState<"fitting" | "scenario" | "performance" | "market" | "notes">("fitting");
  const [analysis, setAnalysis] = useState<any>(null);
  const [remedies, setRemedies] = useState<FitRemedyCandidate[]>([]);
  const [eveExporting, setEveExporting] = useState(false);
  const [eveExportStatus, setEveExportStatus] = useState("");
  const [eveExportDialogOpen, setEveExportDialogOpen] = useState(false);
  const [eveExportCharacterId, setEveExportCharacterId] = useState(characterId);
  useEffect(() => { if (!eveExportStatus) return; const timer = window.setTimeout(() => { setEveExportStatus(""); }, 2800); return () => window.clearTimeout(timer); }, [eveExportStatus]);
  const [hullProfile, setHullProfile] = useState<HullFittingProfile | null>(null);
  const [hullTypeInfo, setHullTypeInfo] = useState<Awaited<ReturnType<typeof window.sage.getFittingTypeInfoLocal>> | null>(null);
  const [externalHeroRules, setExternalHeroRules] = useState<FitterHeroRule[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = window.sage.getFitterContentConfig;
    if (typeof load !== "function") return () => { cancelled = true; };
    void load().then((value) => { if (!cancelled) setExternalHeroRules(coerceFitterHeroRules(value?.rules)); }).catch(() => { if (!cancelled) setExternalHeroRules([]); });
    return () => { cancelled = true; };
  }, []);
  const shoppingEntries = useMemo(() => fitShoppingEntries(fit), [fit]);
  const fitPriceKey = shoppingEntries.map((entry) => `${entry.typeId}:${entry.quantity}`).join("|");
  const [fitCost, setFitCost] = useState<FitCostEstimate | null>(null);
  const [fitCostLoading, setFitCostLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!shoppingEntries.length) { setFitCost({ total: 0, pricedTypes: 0, totalTypes: 0, createdAt: null }); setFitCostLoading(false); return; }
    setFitCostLoading(true);
    void window.sage.getGlobalMarketQuotes(shoppingEntries.map((entry) => entry.typeId)).then((market) => {
      if (cancelled) return;
      const quoteByType = new Map(market.quotes.map((quote) => [quote.typeId, quote]));
      let total = 0;
      let pricedTypes = 0;
      for (const entry of shoppingEntries) {
        const price = quoteByType.get(entry.typeId)?.bestSell;
        if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
        total += price * entry.quantity;
        pricedTypes += 1;
      }
      setFitCost({ total, pricedTypes, totalTypes: shoppingEntries.length, createdAt: market.createdAt });
      setFitCostLoading(false);
    }).catch(() => { if (!cancelled) { setFitCost(null); setFitCostLoading(false); } });
    return () => { cancelled = true; };
  }, [fitPriceKey]);
  useEffect(() => {
    let cancelled = false;
    if (!fit.hull.typeId) { setHullTypeInfo(null); return; }
    void window.sage.getFittingTypeInfoLocal(fit.hull.typeId).then((info) => { if (!cancelled) setHullTypeInfo(info); }).catch(() => { if (!cancelled) setHullTypeInfo(null); });
    return () => { cancelled = true; };
  }, [fit.hull.typeId]);
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
  const [abyssSelection, setAbyssSelection] = useState<AbyssFitterSelection>({ enabled:false, tier:5, weather:"exotic", penalty:0.7, roomKey:"all" });
  const [combatScenario, setCombatScenario] = useState<FitCombatScenarioState>(INITIAL_COMBAT_SCENARIO);
  useEffect(() => { setCombatScenario(INITIAL_COMBAT_SCENARIO); }, [fit.id]);
  const [damageProfilePreset, setDamageProfilePreset] = useState<NpcDamagePreset>("omni");
  const [targetNpc, setTargetNpc] = useState<FittingSearchResult | null>(null);
  const [npcTargetSearch, setNpcTargetSearch] = useState("");
  const [npcTargetSearchResults, setNpcTargetSearchResults] = useState<FittingSearchResult[]>([]);
  useEffect(() => {
    const query=npcTargetSearch.trim();
    if (query.length < 2) { setNpcTargetSearchResults([]); return; }
    let cancelled=false;
    const timer=window.setTimeout(() => { void window.sage.searchFittingTypesLocal("@npc:" + query, 80).then((items) => { if (!cancelled) setNpcTargetSearchResults(items.filter((item) => Boolean(item.combatProfile))); }).catch(() => { if (!cancelled) setNpcTargetSearchResults([]); }); }, 120);
    return () => { cancelled=true; window.clearTimeout(timer); };
  }, [npcTargetSearch]);
  const npcTargetOptions = useMemo(() => {
    const byId=new Map<number,FittingSearchResult>();
    for (const item of [...npcTargetSearchResults, ...(targetNpc ? [targetNpc] : [])]) byId.set(item.id,item);
    return [...byId.values()];
  }, [npcTargetSearchResults,targetNpc]);
  const selectNpcTarget = (typeId:number) => {
    if (!typeId) { setTargetNpc(null); return; }
    const target=npcTargetOptions.find((item) => item.id===typeId) ?? null;
    setTargetNpc(target);
    if (target) setAbyssSelection((current) => ({ ...current, enabled:false }));
    if (target?.combatProfile?.signatureRadiusM) setTargetProfile((current) => ({...current,signatureRadiusM:target.combatProfile!.signatureRadiusM}));
  };
  const [externalEffects, setExternalEffects] = useState<ExternalEffectSelection[]>([]);
  const [boosterSideEffects,setBoosterSideEffects]=useState<BoosterSideEffectOption[]>([]);
  const [selectedBoosterSideEffectKeys,setSelectedBoosterSideEffectKeys]=useState<string[]>([]);
  const boosterSourceTypeIds=useMemo(()=>[...new Set([
    ...fit.boosters.flatMap(item=>item.typeId?[item.typeId]:[]),
    ...externalEffects.filter(item=>item.kind==="booster").map(item=>item.typeId),
  ])],[fit.boosters,externalEffects]);
  useEffect(()=>{
    let cancelled=false;
    if(!boosterSourceTypeIds.length){setBoosterSideEffects([]);setSelectedBoosterSideEffectKeys([]);return;}
    void window.sage.getBoosterSideEffectsLocal(boosterSourceTypeIds).then((options)=>{
      if(cancelled)return;
      setBoosterSideEffects(options);
      const available=new Set(options.map(option=>option.boosterTypeId+":"+option.effectId));
      setSelectedBoosterSideEffectKeys(current=>current.filter(key=>available.has(key)));
    }).catch(()=>{if(!cancelled)setBoosterSideEffects([]);});
    return()=>{cancelled=true;};
  },[boosterSourceTypeIds.join(",")]);
  const addExternalEffect = async (input: { kind: ExternalEffectKind; name: string; chargeName?: string }) => {
    const name = input.name.trim();
    const chargeName = input.chargeName?.trim() ?? "";
    if (!name) return "Enter an exact EVE item/effect name.";
    const requested = chargeName ? [name, chargeName] : [name];
    const resolved = await window.sage.resolveFittingTypeNamesLocal(requested);
    const byName = new Map(resolved.map((item) => [item.name.toLowerCase(), item]));
    const effect = byName.get(name.toLowerCase());
    if (!effect) return "No current CCP SDE type matched: " + name + ".";
    const charge = chargeName ? byName.get(chargeName.toLowerCase()) : undefined;
    if (chargeName && !charge) return "No current CCP SDE charge/script matched: " + chargeName + ".";
    if (charge && (input.kind === "projected" || input.kind === "command")) {
      const compatibility = await window.sage.checkFittingChargeCompatibilityLocal(effect.id, charge.id);
      if (!compatibility.compatible) return compatibility.reason;
    }
    if (externalEffects.some((item) => item.kind === input.kind && item.typeId === effect.id && item.chargeTypeId === charge?.id)) return "That external effect is already selected.";
    setExternalEffects((current) => [...current, { id: crypto.randomUUID(), kind: input.kind, name: effect.name, typeId: effect.id, chargeName: charge?.name, chargeTypeId: charge?.id, state: "active", effectiveness: 1 }]);
    return null;
  };
  const updateExternalEffect = (id: string, patch: Partial<ExternalEffectSelection>) => setExternalEffects((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const removeExternalEffect = (id: string) => setExternalEffects((current) => current.filter((item) => item.id !== id));
  const selectedNpcOutgoing = targetNpc?.combatProfile?.outgoingDamage;
  const damageProfile = targetNpc?.combatProfile && targetNpc.combatProfile.outgoingDamageTotal > 0 && selectedNpcOutgoing ? selectedNpcOutgoing : NPC_DAMAGE_PRESETS[damageProfilePreset].incoming;
  const [analysisStatus, setAnalysisStatus] = useState(
    "Select Performance & skills to analyze this fit.",
  );
  const [analysisRefreshing, setAnalysisRefreshing] = useState(false);
  useEffect(() => { setAnalysis(null); setRemedies([]); setAnalysisRefreshing(false); }, [fit.id, fit.hull.typeId, characterId]);
  useEffect(() => {
    if (!characterId || !fit.hull.typeId) return;
    let cancelled = false;
    // Never leave requirements/issues from the previous fit state visible while the new analysis is running.
    // This is especially important for temporary enhancements such as boosters: removing one must immediately
    // remove its stale skill warning instead of showing the old result until the worker returns.
    setAnalysis(null);
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
        targetTypeId: targetNpc?.id,
        damageProfile,
        implantTypeIds: fit.implants.map((item) => item.typeId).filter((id): id is number => Boolean(id)),
        boosterTypeIds: [...fit.boosters.map((item) => item.typeId).filter((id): id is number => Boolean(id)), ...externalEffects.filter((item) => item.kind === "booster").map((item) => item.typeId)],
        boosterSideEffectSelections: selectedBoosterSideEffectKeys.flatMap((key)=>{const [boosterTypeId,effectId]=key.split(":").map(Number);return boosterTypeId&&effectId?[{boosterTypeId,effectId}]:[];}),
        projectedItems: externalEffects.filter((item) => item.kind === "projected").map((item) => ({ typeId: item.typeId, chargeTypeId: item.chargeTypeId, state: item.state ?? "active", effectiveness: item.effectiveness ?? 1 })),
        commandBurstItems: externalEffects.filter((item) => item.kind === "command").map((item) => ({ typeId: item.typeId, chargeTypeId: item.chargeTypeId, state: item.state ?? "active", effectiveness: item.effectiveness ?? 1 })),
        environmentTypeIds: externalEffects.filter((item) => item.kind === "environment").map((item) => item.typeId),
        abyssProfile: abyssSelection.enabled ? { tier:abyssSelection.tier, weather:abyssSelection.weather, penalty:abyssSelection.penalty, roomKey:abyssSelection.roomKey } : undefined,
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
          const fittingBlockers = (result.issues ?? []).filter((issue: any) => issue.level === "error").length;
          const blocked = missingCount > 0 || fittingBlockers > 0;
          setAnalysisStatus(blocked ? `${missingCount} skill requirement(s), ${fittingBlockers} fitting blocker(s).` : "All identified fitting skill and resource requirements are met.");
          onAnalysis(blocked ? "missing" : "ready", missingCount);
          const issueCodes = (result.issues ?? []).map((issue: any) => String(issue.code));
          const itemTypeIds = fitItems(fit).map((item) => item.typeId).filter((id): id is number => Boolean(id));
          const remedyItems = (["low", "mid", "high", "rig", "subsystem"] as const).flatMap((rack) =>
            fit[rack].flatMap((item) => item.typeId ? [{ typeId:item.typeId, quantity:item.quantity, chargeTypeId:item.chargeTypeId, chargeQuantity:item.chargeQuantity, attributeOverrides:item.attributeOverrides, state:item.state ?? (rack === "rig" || rack === "subsystem" ? "online" : "active"), rack }] : []),
          );
          const remedyImplants = fit.implants.map((item) => item.typeId).filter((id): id is number => Boolean(id));
          const remedyBoosters = [...fit.boosters.map((item) => item.typeId).filter((id): id is number => Boolean(id)), ...externalEffects.filter((item) => item.kind === "booster").map((item) => item.typeId)];
          void window.sage.getFittingRemediesLocal({ characterId, hullTypeId: fit.hull.typeId!, issueCodes, itemTypeIds, items:remedyItems, implantTypeIds:remedyImplants, boosterTypeIds:remedyBoosters })
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
  }, [characterId, fit.id, fit.hull.typeId, fit.low, fit.mid, fit.high, fit.rig, fit.subsystem, fit.drones, fit.fighters, fit.cargo, fit.implants, fit.boosters, targetProfile.rangeM, targetProfile.signatureRadiusM, targetProfile.transverseVelocityMps, targetProfile.velocityMps, damageProfilePreset, targetNpc?.id, externalEffects, selectedBoosterSideEffectKeys.join("|"), abyssSelection.enabled, abyssSelection.tier, abyssSelection.weather, abyssSelection.penalty, abyssSelection.roomKey]);
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
      rigSlots: { used: fit.rig.reduce((sum, item) => sum + Math.max(1, Number(item.quantity ?? 1)), 0), capacity: Number(analysis?.fitting?.slots?.rig ?? 0) },
      abyss: abyssSelection.enabled && analysis?.abyss ? {
        enabled: true,
        tier: Number(abyssSelection.tier),
        weather: String(abyssSelection.weather),
        penalty: Number(abyssSelection.penalty),
        roomKey: String(abyssSelection.roomKey),
        roomName: analysis.abyss?.selectedRoom?.name ? String(analysis.abyss.selectedRoom.name) : undefined,
        roomCount: Number(analysis.abyss?.summary?.roomCount ?? 0),
        unclearableRoomCount: Number(analysis.abyss?.summary?.unclearableRoomCount ?? 0),
        averageTargetDps: Number(analysis.abyss?.summary?.averageTarget?.trueDps ?? 0),
        averageIncomingDps: Number(analysis.abyss?.summary?.averageIncoming?.totalDps ?? 0),
        averageHostilesPerRoom: Number(analysis.abyss?.summary?.averageTarget?.averageHostilesPerRoom ?? 0),
        targetSample: Number(analysis.abyss?.summary?.averageTarget?.distinctTargetCount ?? 0),
        timerSeconds: Number(analysis.abyss?.siteEstimate?.timerSeconds ?? 1200),
        representativeClearSeconds: Number(analysis.abyss?.siteEstimate?.representative?.estimatedClearSeconds ?? Infinity),
        representativeTimerMarginSeconds: Number(analysis.abyss?.siteEstimate?.representative?.timerMarginSeconds ?? -Infinity),
        heavyKnownClearSeconds: Number(analysis.abyss?.siteEstimate?.heavyKnown?.estimatedClearSeconds ?? Infinity),
        heavyKnownTimerMarginSeconds: Number(analysis.abyss?.siteEstimate?.heavyKnown?.timerMarginSeconds ?? -Infinity),
        basis: analysis.abyss?.summary?.averageTarget?.basis ? String(analysis.abyss.summary.averageTarget.basis) : undefined,
      } : undefined,
      performance: analysis ? (() => {
        const scenarioTank = analysis?.abyss?.summary?.averageIncoming?.playerTank;
        const scenarioTankEhpPerSecond =
          Number(scenarioTank?.effectiveShieldRepairPerSecond ?? analysis?.defence?.effectiveShieldRepairPerSecond ?? 0) +
          Number(scenarioTank?.effectiveArmorRepairPerSecond ?? analysis?.defence?.effectiveArmorRepairPerSecond ?? 0) +
          Number(scenarioTank?.effectiveStructureRepairPerSecond ?? analysis?.defence?.effectiveStructureRepairPerSecond ?? 0) +
          Number(scenarioTank?.effectivePassiveShieldPeak ?? analysis?.defence?.effectivePassiveShieldPeak ?? 0);
        const capPeakMarginGjPerSecond = Number(analysis?.capacitor?.peakRechargeGjPerSecond ?? 0) - Number(analysis?.capacitor?.demandGjPerSecond ?? 0);
        return {
          paperDps: Number(analysis?.damage?.totalDps ?? 0),
          weaponDps: Number(analysis?.damage?.weaponDps ?? 0),
          droneDps: Number(analysis?.damage?.droneDps ?? 0),
          appliedWeaponDps: Number(analysis?.damage?.appliedWeaponDps ?? 0),
          totalEhp: Number(analysis?.defence?.totalEhp ?? 0),
          scenarioTankEhpPerSecond,
          shieldRepairEhpPerSecond: Number(analysis?.defence?.effectiveShieldRepairPerSecond ?? 0),
          armorRepairEhpPerSecond: Number(analysis?.defence?.effectiveArmorRepairPerSecond ?? 0),
          passiveShieldEhpPerSecond: Number(analysis?.defence?.effectivePassiveShieldPeak ?? 0),
          capStable: Boolean(analysis?.capacitor?.stable),
          capStablePercent: Number(analysis?.capacitor?.stablePercent ?? 0),
          capDepletionSeconds: Number(analysis?.capacitor?.depletionSeconds ?? 0),
          capDemandGjPerSecond: Number(analysis?.capacitor?.demandGjPerSecond ?? 0),
          capPeakMarginGjPerSecond,
          maximumVelocityMps: Number(analysis?.navigation?.maximumVelocity ?? 0),
          alignSeconds: Number(analysis?.navigation?.alignSeconds ?? 0),
          signatureRadiusM: Number(analysis?.targeting?.signatureRadiusM ?? 0),
          activeDrones: (analysis?.damage?.activeDrones ?? []).map((drone:any) => String(drone.name ?? `Type ${drone.typeId}`)),
        };
      })() : undefined,
    });
  };
  function openEveExportDialog() {
    const defaultCharacterId = characters.some((character) => character.characterId === characterId)
      ? characterId
      : characters[0]?.characterId ?? "";
    setEveExportCharacterId(defaultCharacterId);
    setEveExportStatus("");
    setEveExportDialogOpen(true);
  }
  async function exportCurrentFitToEve(targetCharacterId = characterId, closeDialogOnSuccess = false) {
    if (!targetCharacterId) return;
    setEveExporting(true);
    setEveExportStatus("Saving fit to EVE...");
    try {
      await window.sage.exportFitToEve({ characterId: targetCharacterId, fit });
      const characterName = characters.find((character) => character.characterId === targetCharacterId)?.character.name ?? "the selected character";
      setEveExportStatus(`Saved to ${characterName}'s EVE fitting library.`);
      if (closeDialogOnSuccess) setEveExportDialogOpen(false);
    } catch (error) {
      setEveExportStatus(error instanceof Error ? error.message : "Could not export the fit to EVE.");
    } finally {
      setEveExporting(false);
    }
  }
  function exportCurrentFitToShoppingList() {
    const result = appendShoppingList(shoppingEntries, fit.name + " added to Shopping List.");
    if (!result.addedLines) {
      setEveExportStatus("Nothing resolved in this fit could be added to Shopping List.");
      return;
    }
    setEveExportStatus(fit.name + " added: " + result.addedLines + " item types / " + result.addedUnits.toLocaleString() + " units. Opening Shopping List...");
    window.dispatchEvent(new CustomEvent(OPEN_SHOPPING_LIST_EVENT));
  }

  const fitSummary = summarizeFit(fit);
  const selectedCombatActivity = combatActivity(combatScenario.activity);
  const selectedCombatSite = combatSite(combatScenario);
  const combatScenarioLabel = combatScenario.activity === "abyss"
    ? `${selectedCombatActivity.short} · ${abyssScenarioLabel(abyssSelection.tier,abyssSelection.weather)}`
    : `${selectedCombatActivity.short} · ${selectedCombatSite.label}`;
  const combatScenarioActive = combatScenario.activity !== "manual";
  const effectiveSlots = analysis?.fitting?.slots ?? hullProfile?.slots;
  const hullGroupName = String(hullTypeInfo?.group?.name ?? "Ship");
  const hullClass = hullGroupName.toUpperCase();
  const hullMarketSegments = hullTypeInfo?.marketGroup?.path ?? [];
  const hullMarketPath = hullMarketSegments.slice(-2).join(" / ") || "Capsuleer Hull";
  const faction = resolveFitterFaction({ factionId:hullTypeInfo?.identity?.factionId, factionName:hullTypeInfo?.identity?.factionName, raceId:hullTypeInfo?.identity?.raceId, raceName:hullTypeInfo?.identity?.raceName, marketSegments:hullMarketSegments, hullName:fit.hull.name });
  const factionArtwork = resolveFactionArtwork(faction);
  const hero = resolveFitterHero({ hullName:fit.hull.name, hullTypeId:fit.hull.typeId, factionId:faction.id, groupName:hullGroupName }, [...externalHeroRules, ...FITTER_HERO_CONTENT]);
  const heroStyle = { "--fit-hero-art": `url("${hero.resolvedArtwork}")` } as CSSProperties & Record<"--fit-hero-art", string>;
  const factionStyle = { "--fit-faction-art": `url("${factionArtwork}")` } as CSSProperties & Record<"--fit-faction-art", string>;
  const shipFrame = resolveShipFrame(fit.hull.name, hullGroupName);
  const shipFrameStyle = { "--fit-ship-scale": String(shipFrame.scale), "--fit-ship-x": `${shipFrame.x}%`, "--fit-ship-y": `${shipFrame.y}%`, "--fit-ship-rotate": `${shipFrame.rotate}deg` } as CSSProperties & Record<string,string>;
  const runHeroCta = () => {
    if (hero.ctaAction) window.dispatchEvent(new CustomEvent("sage:fitter-hero-cta", { detail:{ action:hero.ctaAction, fitId:fit.id, hullTypeId:fit.hull.typeId } }));
    if (hero.ctaUrl && typeof window.sage.openExternalUrl === "function") void window.sage.openExternalUrl(hero.ctaUrl).catch(() => undefined);
  };
  return (
    <div className="fit-display fit-display-v3 fit-concept-display">
      {issuesDock ? createPortal(<FitIssuesPanel analysis={analysis} remedies={remedies} onFix={() => exportResolution("fit-issues")} />, issuesDock) : null}
      <section className={`fit-concept-hero ${hero.kind === "promotion" ? "has-promotion" : ""}`} style={heroStyle} onContextMenu={(event)=>{if(!fit.hull.typeId)return;event.preventDefault();onShowInfo(fit.hull.typeId,fit.hull.name);}}>
        <div className="fit-concept-hero-copy">
          <div className="fit-concept-hull-class">{fit.hull.typeId && <img src={imageUrl(fit.hull.typeId,"icon",64)} />}<span>{hullClass}</span></div>
          {hero.kind === "promotion" && hero.headline && <div className="fit-concept-promo-kicker">LIVE CAMPAIGN <b>{hero.headline}</b></div>}
          <h2>{fit.hull.name}</h2>
          <div className="fit-concept-breadcrumb"><span>{faction.name}</span><b>/</b><span>{hullMarketPath}</span></div>
          <p>{hero.supportingText ?? <>&quot;{fit.hull.name} in theory. Devastating in practice.&quot;</>}</p>
          <div className="fit-concept-hero-actions"><button type="button" className="fit-concept-change-ship" onClick={onChangeShip}>Change Ship</button>{hero.kind === "promotion" && hero.ctaLabel && <button type="button" className="fit-concept-promo-cta" onClick={runHeroCta}>{hero.ctaLabel}</button>}</div>
        </div>
        <div className={`fit-concept-faction-card ${faction.className}`} style={factionStyle} aria-label={`${faction.name} faction presentation`}>
          <span className="fit-faction-eyebrow">{faction.eyebrow}</span><b className="fit-faction-sigil">{faction.sigil}</b><strong>{faction.name}</strong><small>{faction.flavour.map((line,index)=><span key={line}>{line}{index < faction.flavour.length-1 && <br/>}</span>)}</small>
        </div>
      </section>

      <section className="fit-concept-commandbar">
        <div className="fit-concept-namebox">
          <span><small>Fitting Name</small><strong>{fit.name}</strong></span>
          <button type="button" className="fit-name-edit" onClick={onRename} title="Rename fitting">Edit</button>
        </div>
        <div className="fit-concept-actions">
          <button type="button" className="fit-action-save" onClick={()=>setEveExportStatus("Fit saved to Sage persistent storage.")}>Save Fit</button>
          <button type="button" className="fit-action-duplicate" onClick={onDuplicate}>Duplicate</button>
          <button type="button" className="fit-action-export" onClick={openEveExportDialog}>Export</button>
          <button type="button" className="shopping fit-action-shopping" onClick={exportCurrentFitToShoppingList}>Add to Shopping List</button>
          <details className="fit-concept-more">
            <summary aria-label="More fitting actions">...</summary>
            <div>
              <button type="button" onClick={openEveExportDialog} disabled={!characters.length}>Export to EVE</button>
              <button type="button" onClick={onExportToDoctrine}>Export to Doctrine</button>
              <button type="button" onClick={onRoute}>Procurement</button>
              <button type="button" onClick={()=>exportResolution("dream-fit")}>Add Skills to Planner</button>
              <button type="button" className="danger" onClick={onRemove}>Delete Fit</button>
            </div>
          </details>
          <select className="fit-concept-character" value={characterId} onChange={(event)=>onCharacterChange(event.target.value)} aria-label="Fitting pilot">{characters.map((character)=><option key={character.characterId} value={character.characterId}>{character.character.name}</option>)}</select>
        </div>
      </section>

      {eveExportDialogOpen && <div className="fit-doctrine-export-backdrop fit-eve-export-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !eveExporting) setEveExportDialogOpen(false); }}>
        <section className="fit-doctrine-export-dialog fit-eve-export-dialog" role="dialog" aria-modal="true" aria-label="Export fitting to EVE">
          <div className="fit-doctrine-export-head"><div><p className="eyebrow">EVE FIT EXPORT</p><h3>Choose destination character</h3><p>{fit.name} - {fit.hull.name}</p></div><button className="fit-doctrine-export-close" onClick={() => setEveExportDialogOpen(false)} disabled={eveExporting} aria-label="Close">X</button></div>
          <div className="fit-doctrine-export-corp"><span>DESTINATION</span><strong>{characters.find((character) => character.characterId === eveExportCharacterId)?.character.name ?? "Choose a connected character"}</strong></div>
          <label><span>Send fitting to</span><select value={eveExportCharacterId} onChange={(event) => setEveExportCharacterId(event.target.value)} aria-label="Export fit destination character">{characters.map((character) => <option key={character.characterId} value={character.characterId}>{character.character.name}</option>)}</select></label>
          {eveExportStatus && <small className="fit-eve-export-dialog-status">{eveExportStatus}</small>}
          <div className="fit-doctrine-export-actions"><button type="button" onClick={() => void onExport()} disabled={eveExporting}>Copy Sage JSON</button><button type="button" onClick={() => setEveExportDialogOpen(false)} disabled={eveExporting}>Cancel</button><button type="button" className="primary" onClick={() => void exportCurrentFitToEve(eveExportCharacterId, true)} disabled={!eveExportCharacterId || eveExporting}>{eveExporting ? "Exporting..." : "Export fit to EVE"}</button></div>
          <small>This saves the fitting to the selected character's personal EVE fitting library. It does not change the fitter analysis pilot.</small>
        </section>
      </div>}

      <section className="fit-concept-tabs">
        <div role="tablist" aria-label="Fitting detail views">
          <button type="button" role="tab" aria-selected={tab==="fitting"} className={tab==="fitting"?"active":""} onClick={()=>setTab("fitting")}>Fitting</button>
          <button type="button" role="tab" aria-selected={tab==="scenario"} className={tab==="scenario"?"active":""} onClick={()=>setTab("scenario")}>Combat Scenario</button>
          <button type="button" role="tab" aria-selected={tab==="performance"} className={tab==="performance"?"active":""} onClick={()=>setTab("performance")}>Performance</button>
          <button type="button" role="tab" aria-selected={tab==="market"} className={tab==="market"?"active":""} onClick={()=>setTab("market")}>Cost &amp; Market</button>
          <button type="button" role="tab" aria-selected={tab==="notes"} className={tab==="notes"?"active":""} onClick={()=>setTab("notes")}>Notes</button>
        </div>
        <span className="fit-concept-fix-tip">Fix My Fit can resolve fitting issues and suggest viable replacements.</span>
      </section>

      {tab === "fitting" ? (
        <>
          <div className="fit-v2-center-stage fit-concept-fitting-stage">
            <div className="fit-v2-selected fit-concept-racks fit-concept-racks-left">
              <SlotRack title="HIGH SLOTS" side="high" items={fit.high} limit={effectiveSlots?.high ?? fit.high.length} onStateChange={onModuleStateChange} onRemove={onRemoveItem} onDropItem={onAddItem} onLoadCharge={onLoadCharge} onShowInfo={onShowInfo} analysis={analysis} />
              <SlotRack title="MID SLOTS" side="mid" items={fit.mid} limit={effectiveSlots?.mid ?? fit.mid.length} onStateChange={onModuleStateChange} onRemove={onRemoveItem} onDropItem={onAddItem} onLoadCharge={onLoadCharge} onShowInfo={onShowInfo} analysis={analysis} />
              <SlotRack title="LOW SLOTS" side="low" items={fit.low} limit={effectiveSlots?.low ?? fit.low.length} onStateChange={onModuleStateChange} onRemove={onRemoveItem} onDropItem={onAddItem} onLoadCharge={onLoadCharge} onShowInfo={onShowInfo} analysis={analysis} />
            </div>
            <div className="fit-v2-ship fit-concept-ship-core">
              <div className="fit-concept-core-orbit orbit-a" aria-hidden="true" />
              <div className="fit-concept-core-orbit orbit-b" aria-hidden="true" />
              <div className="fit-v2-ship-frame" style={shipFrameStyle}>{fit.hull.typeId ? <img src={imageUrl(fit.hull.typeId, "render", 512)} alt={fit.hull.name} /> : <div>?</div>}</div>
              <div className="fit-concept-core-status"><i/><span>SYSTEMS ONLINE</span><small>READY FOR DEPLOYMENT</small></div>
            </div>
            <div className="fit-v2-selected fit-concept-racks fit-concept-racks-right">
              <SlotRack title="RIG SLOTS" side="rig" items={fit.rig} limit={effectiveSlots?.rig ?? fit.rig.length} onStateChange={onModuleStateChange} onRemove={onRemoveItem} onDropItem={onAddItem} onLoadCharge={onLoadCharge} onShowInfo={onShowInfo} analysis={analysis} />
              {((effectiveSlots?.subsystem ?? 0) > 0 || fit.subsystem.length > 0) && <SlotRack title="SUBSYSTEMS" side="subsystem" items={fit.subsystem} limit={effectiveSlots?.subsystem ?? fit.subsystem.length} onStateChange={onModuleStateChange} onRemove={onRemoveItem} onDropItem={onAddItem} onLoadCharge={onLoadCharge} onShowInfo={onShowInfo} analysis={analysis} />}            </div>
          </div>
          <div className="fit-v2-additions"><FitAdditionsPanel fit={fit} analysis={analysis} externalEffects={externalEffects} onBayActiveQuantityChange={onBayActiveQuantityChange} onRemoveItem={onRemoveItem} onShowInfo={onShowInfo} onAddDrones={()=>onBrowseDamageItems("drones")} onInstructionsChange={onInstructionsChange} /></div>
        </>
      ) : tab === "scenario" ? (
        <div className="fit-v2-performance-stage fit-concept-secondary-stage fit-combat-scenario-host">
          <FitCombatScenario analysis={analysis} fit={fit} scenario={combatScenario} onScenarioChange={setCombatScenario} abyssSelection={abyssSelection} onAbyssSelectionChange={setAbyssSelection} damageProfilePreset={damageProfilePreset} onDamageProfilePresetChange={setDamageProfilePreset} targetProfile={targetProfile} onTargetProfileChange={setTargetProfile} onNpcTargetChange={selectNpcTarget} onDroneFlightChange={onDroneFlightChange} onBrowseDrones={()=>onBrowseDamageItems("drones")} />
        </div>
      ) : tab === "performance" ? (
        <div className="fit-v2-performance-stage fit-concept-secondary-stage"><FitPerformance analysis={analysis} status={analysisStatus} fit={fit} characters={characters} characterId={characterId} onCharacterChange={onCharacterChange} externalEffects={externalEffects} boosterSideEffects={boosterSideEffects} selectedBoosterSideEffectKeys={selectedBoosterSideEffectKeys} onSelectedBoosterSideEffectKeysChange={setSelectedBoosterSideEffectKeys} onAddExternalEffect={addExternalEffect} onUpdateExternalEffect={updateExternalEffect} onRemoveExternalEffect={removeExternalEffect} onModuleStateChange={onModuleStateChange} onExportToEve={exportCurrentFitToEve} eveExporting={eveExporting} eveExportStatus={eveExportStatus} onExportToPlanner={()=>exportResolution("dream-fit")} /></div>
      ) : tab === "market" ? (
        <div className="fit-v2-performance-stage fit-concept-secondary-stage fit-concept-market-stage">
          <div><p className="eyebrow">COST &amp; MARKET</p><h3>{fitCostLoading ? "Pricing fit..." : fitCost ? formatFitIsk(fitCost.total) : "Market price unavailable"}</h3><p>{fitCost ? `${fitCost.pricedTypes}/${fitCost.totalTypes} item types have retained best-sell quotes.` : "Retained public market quotes are unavailable."}</p></div>
          <div className="fit-concept-market-metrics"><article><span>Modules</span><strong>{fitSummary.moduleCount}</strong></article><article><span>Drones</span><strong>{fitSummary.droneCount}</strong></article><article><span>Resolved</span><strong>{fitSummary.resolvedItems}</strong></article><article><span>Unresolved</span><strong>{fitSummary.unresolvedItems}</strong></article></div>
          <div className="fit-concept-market-actions"><button type="button" onClick={exportCurrentFitToShoppingList}>Add to Shopping List</button><button type="button" onClick={onRoute}>Open Procurement</button></div>
        </div>
      ) : (
        <div className="fit-v2-performance-stage fit-concept-secondary-stage fit-concept-notes-stage">
          <div><p className="eyebrow">FIT NOTES</p><h3>{fit.name}</h3></div>
          <textarea className="fit-notes-editor fit-notes-editor-page" value={fit.instructions.join("\n")} onChange={(event)=>onInstructionsChange(event.target.value.split(/\r?\n/))} placeholder="Add fit notes or operating instructions..." aria-label="Fit notes" />
        </div>
      )}

      <aside className="fit-concept-right-rail">
        <div className="fit-total-cost" aria-live="polite">
          <span>EST. TOTAL FIT COST</span>
          <strong>{fitCostLoading ? "Pricing..." : fitCost ? formatFitIsk(fitCost.total) : "Pricing unavailable"}</strong>
          <small>{fitCost ? `${fitCost.pricedTypes}/${fitCost.totalTypes} item types priced from retained market quotes` : "Retained public market quotes unavailable"}</small>
        </div>
        {eveExportStatus && <small className="fit-eve-export-status">{eveExportStatus}</small>}
        <FitStatsSidebar analysis={analysis} refreshing={analysisRefreshing} fit={fit} hullProfile={hullProfile} damageProfilePreset={damageProfilePreset} onDamageProfilePresetChange={setDamageProfilePreset} targetProfile={targetProfile} onTargetProfileChange={setTargetProfile} targetNpc={targetNpc} npcTargetOptions={npcTargetOptions} npcTargetSearch={npcTargetSearch} onNpcTargetSearchChange={setNpcTargetSearch} onNpcTargetChange={selectNpcTarget} abyssSelection={abyssSelection} scenarioLabel={combatScenarioLabel} scenarioActive={combatScenarioActive} onDroneFlightChange={onDroneFlightChange} onModuleStateChange={onModuleStateChange} onLoadCharge={onLoadCharge} onBrowseDamageItems={onBrowseDamageItems} />
      </aside>
    </div>
  );
}
type AdditionTab = "drones" | "fighters" | "cargo" | "implants" | "boosters" | "projected" | "command" | "notes";
type AdditionEntry = { item: FitItem; index: number; target: "drones" | "fighters" | "cargo" | "implants" | "boosters" };

function DroneLoadoutCard({ entry, activeQuantity, maxActive, onStep, onRemove, onShowInfo }: { entry: AdditionEntry; activeQuantity: number; maxActive: number; onStep(delta:number):void; onRemove():void; onShowInfo(typeId:number,name?:string):void }) {
  return <article className="fit-drone-card" onContextMenu={event=>{if(!entry.item.typeId)return;event.preventDefault();onShowInfo(entry.item.typeId,entry.item.name);}}>
    <div className="fit-drone-icon">{entry.item.typeId?<img src={imageUrl(entry.item.typeId,"icon",64)}/>:<b>?</b>}</div>
    <span className="fit-drone-copy"><strong title={entry.item.name}>{entry.item.name}</strong><small><b>{entry.item.quantity}</b> in bay <i/> <b>{activeQuantity}</b> active <em>/ {maxActive} max</em></small></span>
    <div className="drone-active-stepper" title="Active count used by fit analysis"><button type="button" disabled={activeQuantity<=0} onClick={()=>onStep(-1)} aria-label={"Reduce active "+entry.item.name}>-</button><b>{activeQuantity}</b><button type="button" disabled={activeQuantity>=maxActive} onClick={()=>onStep(1)} aria-label={"Increase active "+entry.item.name}>+</button></div>
    <button type="button" className="fit-addition-remove" onClick={onRemove} aria-label={"Remove "+entry.item.name}>x</button>
  </article>;
}

function FitAdditionsPanel({ fit, analysis, externalEffects, onBayActiveQuantityChange, onRemoveItem, onShowInfo, onAddDrones, onInstructionsChange }: { fit: Fit; analysis: any; externalEffects: ExternalEffectSelection[]; onBayActiveQuantityChange(target:"drones"|"fighters",index:number, delta:number, baseline:number, maxAllowed:number):void; onRemoveItem(target:BuilderTarget,index:number):void; onShowInfo(typeId:number,name?:string):void; onAddDrones():void; onInstructionsChange(instructions:string[]):void }) {
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
  const counts:Record<AdditionTab,number>={drones:sum(droneEntries),fighters:sum(fighterEntries),cargo:sum(cargoEntries),implants:plannedImplants.length+installedImplants.length,boosters:plannedBoosters.length+appliedBoosters.length,projected:projected.length,command:command.length,notes:fit.instructions.filter(note=>note.trim()).length};
  const tabs:Array<{id:AdditionTab;label:string}>=[{id:"drones",label:"Drones"},{id:"fighters",label:"Fighters"},{id:"cargo",label:"Cargo"},{id:"implants",label:"Implants"},{id:"boosters",label:"Boosters"},{id:"projected",label:"Projected"},{id:"command",label:"Command"},{id:"notes",label:"Notes"}];
  const info:Record<AdditionTab,string>={drones:"Drone bay loadout and launched count used by live DPS analysis.",fighters:"Fighter hangar and active squadrons validated against tubes and fighter class limits.",cargo:"Charges, scripts, paste, probes and other carried items.",implants:"Planned fit implants plus implants already installed on the selected pilot.",boosters:"Boosters assigned to the fit plus temporary external booster effects.",projected:"Remote effects projected onto this fit for performance analysis.",command:"Command burst effects currently applied to this fit.",notes:"Imported operating notes and fit instructions."};
  const activeCount=(entry:AdditionEntry)=>{
    if(entry.item.activeQuantity!=null)return Math.max(0,Math.min(entry.item.quantity,Math.floor(entry.item.activeQuantity)));
    if(entry.target==="fighters")return Math.min(entry.item.quantity,1);
    const matches=(analysis?.damage?.activeDrones??[]).filter((candidate:any)=>(entry.item.typeId&&Number(candidate.typeId)===entry.item.typeId)||String(candidate.name??"")===entry.item.name);
    if(matches.length)return Math.max(0,Math.min(entry.item.quantity,matches.length));
    return 0;
  };
  const maxActiveFor=(entry:AdditionEntry)=>{
    if(entry.target==="fighters") { const system=analysis?.fighterSystem; const tubes=Math.max(0,Number(system?.tubes??1)); const otherEntries=fighterEntries.filter(candidate=>candidate!==entry); const other=otherEntries.reduce((sum,candidate)=>sum+activeCount(candidate),0); const inventory=Array.isArray(system?.inventory)?system.inventory:[]; const row=inventory.find((item:any)=>(entry.item.typeId&&Number(item.typeId)===entry.item.typeId)||String(item.name??"")===entry.item.name); const fighterClass=String(row?.class??"unknown"); const classLimit=fighterClass==="light"?Number(system?.lightSlots??tubes):fighterClass==="support"?Number(system?.supportSlots??tubes):fighterClass==="heavy"?Number(system?.heavySlots??tubes):tubes; const otherSameClass=otherEntries.reduce((sum,candidate)=>{const match=inventory.find((item:any)=>(candidate.item.typeId&&Number(item.typeId)===candidate.item.typeId)||String(item.name??"")===candidate.item.name);return String(match?.class??"unknown")===fighterClass?sum+activeCount(candidate):sum;},0); return Math.max(0,Math.min(entry.item.quantity,tubes-other,Math.max(0,classLimit-otherSameClass))); }
    if(entry.target!=="drones")return entry.item.quantity;
    const limits=analysis?.damage?.droneLimits; const maxDrones=Math.max(0,Number(limits?.maxActiveDrones??5));
    const otherActive=droneEntries.filter(candidate=>candidate!==entry).reduce((sum,candidate)=>sum+activeCount(candidate),0);
    const countCap=Math.max(0,maxDrones-otherActive);
    const bandwidthCapacity=Math.max(0,Number(limits?.bandwidthCapacity??analysis?.resources?.capacity?.bandwidth??0));
    const bandwidthByType=Array.isArray(limits?.bandwidthByType)?limits.bandwidthByType:[];
    const bandwidthFor=(candidate:AdditionEntry)=>Number(bandwidthByType.find((row:any)=>(candidate.item.typeId&&Number(row.typeId)===candidate.item.typeId)||String(row.name??"")===candidate.item.name)?.bandwidth??0);
    const usedByOthers=droneEntries.filter(candidate=>candidate!==entry).reduce((sum,candidate)=>sum+activeCount(candidate)*bandwidthFor(candidate),0);
    const perDrone=bandwidthFor(entry); const bandwidthCap=bandwidthCapacity>0&&perDrone>0?Math.max(0,Math.floor((bandwidthCapacity-usedByOthers)/perDrone)):entry.item.quantity;
    return Math.max(0,Math.min(entry.item.quantity,countCap,bandwidthCap));
  };
  const step=(entry:AdditionEntry,delta:number)=>{if(entry.target!=="drones"&&entry.target!=="fighters")return;const baseline=activeCount(entry);const maxAllowed=maxActiveFor(entry);onBayActiveQuantityChange(entry.target,entry.index,delta,baseline,maxAllowed);};
  const renderBay=(entries:AdditionEntry[],active=false)=>entries.length?<div className={active?"fit-addition-list fit-drone-list":"fit-addition-list"}>{entries.map(entry=>active?<DroneLoadoutCard key={entry.target+"-"+entry.item.name+"-"+entry.index} entry={entry} activeQuantity={activeCount(entry)} maxActive={maxActiveFor(entry)} onStep={delta=>step(entry,delta)} onRemove={()=>onRemoveItem(entry.target,entry.index)} onShowInfo={onShowInfo}/>:<div className="fit-addition-item" key={entry.target+"-"+entry.item.name+"-"+entry.index} onContextMenu={event=>{if(!entry.item.typeId)return;event.preventDefault();onShowInfo(entry.item.typeId,entry.item.name);}}>{entry.item.typeId?<img src={imageUrl(entry.item.typeId,"icon",64)}/>:<b>?</b>}<span><strong>{entry.item.name}</strong><small>{entry.item.quantity} assigned / {entry.target}</small></span><button type="button" className="fit-addition-remove" onClick={()=>onRemoveItem(entry.target,entry.index)} aria-label={"Remove "+entry.item.name}>x</button></div>)}</div>:<div className="fit-addition-empty">Nothing assigned here.</div>;
  const renderEffects=(items:any[],empty:string,label:string)=>items.length?<div className="fit-addition-effect-list">{items.map((item:any,index:number)=><div className="fit-addition-effect" key={String(item.id??item.typeId??index)} onContextMenu={event=>{if(!item.typeId)return;event.preventDefault();onShowInfo(Number(item.typeId),item.name);}}>{item.typeId?<img src={imageUrl(Number(item.typeId),"icon",64)}/>:<b>?</b>}<span><strong>{item.name??("Type "+item.typeId)}</strong><small>{item.chargeName?item.chargeName+" - ":""}{item.state?item.state+" - ":""}{label}</small></span></div>)}</div>:<div className="fit-addition-empty">{empty}</div>;
  return <div className="fit-additions-panel"><div className="fit-additions-head"><strong>Additional Loadouts</strong><small>{info[activeTab]}</small>{activeTab==="drones"&&<button type="button" className="fit-add-drones" onClick={onAddDrones}>+ Add Drones</button>}</div><div className="fit-addition-tabs-v3" role="tablist">{tabs.map(tab=><button type="button" role="tab" aria-selected={activeTab===tab.id} className={activeTab===tab.id?"active":""} key={tab.id} onClick={()=>setActiveTab(tab.id)}><span>{tab.label}</span>{counts[tab.id]>0&&<b>{counts[tab.id]}</b>}</button>)}</div><div className="fit-addition-content" role="tabpanel">
    {activeTab==="drones"&&renderBay(droneEntries,true)}{activeTab==="fighters"&&renderBay(fighterEntries,true)}{activeTab==="cargo"&&renderBay(cargoEntries)}
    {activeTab==="implants"&&<>{renderBay(plannedImplants)}{installedImplants.length>0&&<div className="fit-addition-secondary"><small>Installed on pilot</small>{renderEffects(installedImplants,"","Installed on selected pilot")}</div>}</>}
    {activeTab==="boosters"&&<>{renderBay(plannedBoosters)}{appliedBoosters.length>0&&<div className="fit-addition-secondary"><small>External / temporary</small>{renderEffects(appliedBoosters,"","Applied to analysis")}</div>}</>}
    {activeTab==="projected"&&renderEffects(projected,"No projected effects are currently applied.","Applied to analysis")}{activeTab==="command"&&renderEffects(command,"No command burst effects are currently applied.","Applied to analysis")}
    {activeTab==="notes"&&<textarea className="fit-notes-editor fit-notes-editor-inline" value={fit.instructions.join("\n")} onChange={(event)=>onInstructionsChange(event.target.value.split(/\r?\n/))} placeholder="Add fit notes or operating instructions..." aria-label="Fit notes" />}
  </div></div>;
}

function FitIssuesPanel({ analysis, remedies, onFix }: { analysis:any; remedies:FitRemedyCandidate[]; onFix():void }) {
  const rawMissing = analysis?.missingRequirements ?? [];
  const missing = [...new Map(rawMissing.map((item:any) => [`${item.skillId}:${item.requiredLevel}`, item])).values()] as any[];
  const issues = (analysis?.issues ?? []) as any[];
  const hasIssues = issues.length > 0 || missing.length > 0;
  const hasRemedySummary = missing.length > 0 || remedies.length > 0;
  const supportSkills = remedies.filter((item) => item.kind === "skill");
  const augments = remedies.filter((item) => item.kind === "implant" || item.kind === "implant-set");
  const moduleChanges = remedies.filter((item) => item.kind === "module");
  const rigs = remedies.filter((item) => item.kind === "rig");
  const stateClass = !analysis ? "analyzing" : hasIssues ? "has-issues" : "viable";
  const visibleIssues = issues.slice(0,3);
  const visibleMissing = missing.slice(0,Math.max(0,3-visibleIssues.length));
  return <aside className={`fit-v2-issues ${stateClass}`}>
    <div className="fit-v2-issues-head"><strong>Fitting Issues</strong><span>{analysis ? issues.length + missing.length : "..."}</span></div>
    {analysis && hasIssues && <small className="fit-issues-intro">Your current fit has issues that need attention before it can be used effectively.</small>}
    {!analysis ? <small className="fit-issues-state">Analyzing fit...</small> : !hasIssues ? <div className="fit-issue-ok">Fit viable for this pilot</div> : <div className="fit-issue-list">
      {visibleIssues.map((issue:any,index:number) => <article className={issue.level === "error" ? "error" : "warning"} key={`${issue.code}-${index}`}><strong>{issue.item ?? issue.code}</strong><small>{issue.message}</small>{(issue.code === "cpu-exceeded" || issue.code === "powergrid-exceeded") && <em>{remedies.filter((item) => item.solves.includes(issue.code)).length} exact full-fit fixes</em>}</article>)}
      {visibleMissing.map((item:any) => <article className="skill" key={`skill-${item.skillId}-${item.requiredLevel}`}><strong>{item.skill}</strong><small>L{item.trainedLevel} -&gt; L{item.requiredLevel}</small><em>{item.item}</em></article>)}
    </div>}
    {hasRemedySummary && <div className="fit-issue-remedy-summary"><span>{supportSkills.length} skills</span><span>{augments.length} augments</span><span>{moduleChanges.length} module swaps</span><span>{rigs.length} rigs</span></div>}
    {hasIssues && <div className="fit-issues-actions"><button type="button" className="fit-issues-fix" onClick={onFix}>Fix My Fit</button><button type="button" className="fit-issues-remedies" onClick={onFix}>Show Remedies</button></div>}
  </aside>;
}
function FitStatsSidebar({ analysis, refreshing, fit, hullProfile, damageProfilePreset, onDamageProfilePresetChange, targetProfile, onTargetProfileChange, targetNpc, npcTargetOptions, npcTargetSearch, onNpcTargetSearchChange, onNpcTargetChange, abyssSelection, scenarioLabel, scenarioActive, onDroneFlightChange, onModuleStateChange, onLoadCharge, onBrowseDamageItems }: {
  analysis:any; refreshing:boolean; fit:Fit; hullProfile:HullFittingProfile|null;
  damageProfilePreset:NpcDamagePreset; onDamageProfilePresetChange(value:NpcDamagePreset):void;
  targetProfile:{rangeM:number;signatureRadiusM:number;transverseVelocityMps:number;velocityMps:number};
  onTargetProfileChange(value:{rangeM:number;signatureRadiusM:number;transverseVelocityMps:number;velocityMps:number}):void;
  targetNpc:FittingSearchResult|null; npcTargetOptions:FittingSearchResult[]; npcTargetSearch:string; onNpcTargetSearchChange(value:string):void; onNpcTargetChange(typeId:number):void;
  abyssSelection:AbyssFitterSelection; scenarioLabel:string; scenarioActive:boolean;
  onDroneFlightChange(typeId:number|null, activeCount?:number):void;
  onModuleStateChange(rack:FitModuleRack,index:number,state:ModuleState):void;
  onLoadCharge(rack:FitModuleRack,index:number,item:FittingSearchResult):Promise<boolean>;
  onBrowseDamageItems(kind:"drones"|"weapons"):void;
}) {
  const fmt=(value:number|undefined,digits=0)=>value==null||!Number.isFinite(value)?"--":value.toLocaleString(undefined,{maximumFractionDigits:digits,minimumFractionDigits:digits});
  const pct=(value:number|undefined)=>value==null?"--":(value*100).toFixed(1)+"%";
  const duration=(seconds:number|undefined)=>{
    if(seconds==null||!Number.isFinite(seconds))return "--";
    const safe=Math.max(0,Math.round(seconds));
    return `${Math.floor(safe/60)}m ${String(safe%60).padStart(2,"0")}s`;
  };
  const slots=analysis?.fitting?.slots ?? hullProfile?.slots;
  const hardpoints=analysis?.fitting?.hardpoints ?? hullProfile?.hardpoints;
  const storage=analysis?.storage;
  const res=analysis?.resources;
  const defence=analysis?.defence;
  const damage=analysis?.damage;
  const cap=analysis?.capacitor;
  const nav=analysis?.navigation;
  const targeting=analysis?.targeting;
  const abyss=analysis?.abyss;
  const averageTarget=abyssSelection.enabled ? abyss?.summary?.averageTarget : undefined;
  const averageIncoming=abyssSelection.enabled ? abyss?.summary?.averageIncoming : undefined;
  const weaponProfileTypeIds=useMemo(()=>new Set((damage?.weaponProfiles??[]).map((item:any)=>Number(item.typeId)).filter(Boolean)),[damage?.weaponProfiles]);
  const weaponEntries=useMemo(()=>fit.high.map((item,index)=>({item,index})).filter(({item})=>Boolean(item.typeId)&&(weaponProfileTypeIds.has(Number(item.typeId))||Boolean(item.chargeTypeId))),[fit.high,weaponProfileTypeIds]);
  const [weaponChargeOptions,setWeaponChargeOptions]=useState<Record<number,Array<{id:number;name:string}>>>({});
  useEffect(()=>{
    let cancelled=false;
    const modules=[...new Set(weaponEntries.flatMap(({item})=>item.typeId?[item.typeId]:[]))];
    if(!modules.length){setWeaponChargeOptions({});return;}
    void Promise.all(modules.map(async(typeId)=>{
      try{
        const result=await window.sage.getFittingChargesForModulesLocal([typeId]);
        const resolved=result.compatibleTypeIds.length?await window.sage.resolveFittingTypeIdsLocal(result.compatibleTypeIds):[];
        return [typeId,resolved.map((item:any)=>({id:Number(item.id),name:String(item.name)})).filter(item=>item.id>0).sort((a,b)=>a.name.localeCompare(b.name))] as const;
      }catch{return [typeId,[]] as const;}
    })).then(rows=>{if(!cancelled)setWeaponChargeOptions(Object.fromEntries(rows));});
    return()=>{cancelled=true;};
  },[weaponEntries.map(({item})=>item.typeId).join(",")]);
  const explicitDroneFlight=fit.drones.some(item=>item.activeQuantity!=null);
  const quickDroneTypeId=explicitDroneFlight?(fit.drones.find(item=>Number(item.activeQuantity??0)>0)?.typeId??0):0;
  const selectDroneFlight=(typeId:number)=>{
    if(!typeId){onDroneFlightChange(null);return;}
    const bay=fit.drones.find(item=>item.typeId===typeId);
    if(!bay)return;
    const limits=damage?.droneLimits;
    const maxActive=Math.max(0,Math.floor(Number(limits?.maxActiveDrones??5)));
    const bandwidthEntry=(limits?.bandwidthByType??[]).find((item:any)=>Number(item.typeId)===typeId);
    const bandwidth=Math.max(0,Number(bandwidthEntry?.bandwidth??0));
    const byBandwidth=bandwidth>0?Math.floor(Number(limits?.bandwidthCapacity??0)/bandwidth):maxActive;
    const activeCount=Math.max(0,Math.min(Number(bay.quantity||0),maxActive,byBandwidth||maxActive));
    onDroneFlightChange(typeId,activeCount);
  };
  const appliedWeaponDps=damage?.weaponProfiles?.reduce((sum:number,weapon:any)=>sum+Number(weapon.targetApplication?.appliedDps??0),0)??0;
  const profileAppliedDps=appliedWeaponDps+Number(damage?.droneDps??0);
  const capacitorPeakMargin=cap ? Number(cap.peakRechargeGjPerSecond??0)-Number(cap.demandGjPerSecond??0) : undefined;
  const damageKinds=["em","thermal","kinetic","explosive"] as const;
  const Metric=({label,value,sub,tone="normal",featured=false}:{label:string;value:string;sub?:string;tone?:"normal"|"primary"|"good"|"warn"|"danger"|"muted";featured?:boolean})=><article className={`fit-rail-metric tone-${tone}${featured?" featured":""}`}><span>{label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}</article>;
  const Resource=({label,used,total,unit}:{label:string;used:number|undefined;total:number|undefined;unit:string})=>{
    const rawRatio=total&&used!=null?used/total:0;
    const ratio=Math.max(0,Math.min(1,rawRatio));
    const state=rawRatio>1?"danger":rawRatio>=.98?"full":rawRatio>=.85?"warn":"ok";
    return <article className={`fit-rail-resource resource-${state}`}><span>{label}</span><strong>{used==null||total==null?"--":fmt(used,1)+" / "+fmt(total,1)+(unit?" "+unit:"")}</strong><b><i style={{width:(ratio*100)+"%"}}/></b></article>;
  };
  const ResistRow=({label,resists,ehp}:{label:string;resists:number[]|undefined;ehp:number|undefined})=><div className="fit-rail-resist-row"><strong>{label}</strong>{[0,1,2,3].map(index=><span className={`fit-rail-resist-pill damage-${damageKinds[index]}`} key={index}>{resists?pct(resists[index]):"--"}</span>)}<b className="fit-rail-ehp-pill">{ehp==null?"--":fmt(ehp)}</b></div>;
  const tankAgainstScenario=averageIncoming?.playerTank;
  const scenarioTank=Number(tankAgainstScenario?.effectiveShieldRepairPerSecond??defence?.effectiveShieldRepairPerSecond??0)
    +Number(tankAgainstScenario?.effectiveArmorRepairPerSecond??defence?.effectiveArmorRepairPerSecond??0)
    +Number(tankAgainstScenario?.effectiveStructureRepairPerSecond??defence?.effectiveStructureRepairPerSecond??0)
    +Number(tankAgainstScenario?.effectivePassiveShieldPeak??defence?.effectivePassiveShieldPeak??0);
  const incoming=Number(averageIncoming?.totalDps??0);
  const tankRatio=incoming>0?scenarioTank/incoming:0;

  return <aside className="fit-v2-context pyfa-stats-panel fit-stats-polished">
    {refreshing&&<div className="fit-analysis-refreshing"><span>Calculating current fit...</span></div>}

    <section className="fit-rail-section fit-rail-target-application">
      <header className="fit-rail-section-head"><div><span>Target &amp; application</span><strong>{targetNpc?.name??"Application profile"}</strong></div><em>{scenarioActive?scenarioLabel:"Manual / exact NPC"}</em></header>
      <div className="fit-rail-advanced-grid">
        <label><span>Incoming tank profile</span><select value={damageProfilePreset} onChange={event=>onDamageProfilePresetChange(event.target.value as NpcDamagePreset)}>{NPC_DAMAGE_PRESET_KEYS.map(key=><option key={key} value={key}>{NPC_DAMAGE_PRESETS[key].label} - {NPC_DAMAGE_PRESETS[key].incomingLabel}</option>)}</select></label>
        <label><span>Specific NPC</span><input value={npcTargetSearch} onChange={event=>onNpcTargetSearchChange(event.target.value)} placeholder="Search NPC..."/><select value={targetNpc?.id??0} onChange={event=>onNpcTargetChange(Number(event.target.value))}><option value={0}>No exact target</option>{npcTargetOptions.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </div>
      <div className="fit-v2-target-grid"><label>Range km<input type="number" min="0" value={targetProfile.rangeM/1000} onChange={event=>onTargetProfileChange({...targetProfile,rangeM:Math.max(0,Number(event.target.value)*1000)})}/></label><label>Signature m<input type="number" min="1" value={targetProfile.signatureRadiusM} onChange={event=>onTargetProfileChange({...targetProfile,signatureRadiusM:Math.max(1,Number(event.target.value))})}/></label><label>Transversal<input type="number" min="0" value={targetProfile.transverseVelocityMps} onChange={event=>onTargetProfileChange({...targetProfile,transverseVelocityMps:Math.max(0,Number(event.target.value))})}/></label><label>Velocity<input type="number" min="0" value={targetProfile.velocityMps} onChange={event=>onTargetProfileChange({...targetProfile,velocityMps:Math.max(0,Number(event.target.value))})}/></label></div>
    </section>

    <section className="fit-rail-section pyfa-section-defense">
      <header className="fit-rail-section-head"><div><span>Defense</span><strong>{defence?fmt(defence.totalEhp)+" EHP":"--"}</strong></div><em>Profile effective H</em></header>
      <div className="fit-rail-resist-head"><strong>Layer</strong><span>EM</span><span>TH</span><span>KI</span><span>EX</span><b>EHP</b></div>
      <ResistRow label="Shield" resists={defence?.shieldResists} ehp={defence?.shieldEhp}/>
      <ResistRow label="Armor" resists={defence?.armorResists} ehp={defence?.armorEhp}/>
      <ResistRow label="Hull" resists={defence?.hullResists} ehp={defence?.structureEhp}/>
    </section>

        <div className="fit-rail-columns">
      <div className="fit-rail-column fit-rail-column-left">
        <section className="fit-rail-section pyfa-section-firepower">
              <header className="fit-rail-section-head"><div><span>Firepower</span><strong>{damage?fmt(damage.totalDps,1)+" paper DPS":"--"}</strong></div>{averageTarget&&<em>{fmt(averageTarget.trueDps,1)} scenario DPS</em>}</header>
              <div className="fit-rail-metric-grid">
                <Metric label="Paper DPS" value={damage?fmt(damage.totalDps,1):"--"}/>
                <Metric label={averageTarget||damage?.target?"Scenario DPS":"Applied profile DPS"} value={averageTarget?fmt(averageTarget.trueDps,1):damage?.target?fmt(damage.target.trueDps,1):scenarioActive&&damage?fmt(profileAppliedDps,1):"--"} sub={averageTarget?scenarioLabel:damage?.target?.name??(scenarioActive?scenarioLabel:undefined)} tone="primary" featured/>
                <Metric label="Weapon DPS" value={damage?fmt(damage.weaponDps,1):"--"}/>
                <Metric label="Drone DPS" value={damage?fmt(damage.droneDps,1):"--"}/>
                <Metric label="Applied weapon" value={damage?fmt(appliedWeaponDps,1)+" DPS":"--"} tone={damage?.target||averageTarget?"good":"muted"}/>
              </div>
              <div className="firepower-loadout">
                <div className="firepower-loadout-head"><span>Damage loadout</span><div><button type="button" onClick={()=>onBrowseDamageItems("drones")}>Change drones</button><button type="button" onClick={()=>onBrowseDamageItems("weapons")}>Change weapons</button></div></div>
                {weaponEntries.length>0&&<div className="firepower-weapon-list">{weaponEntries.map(({item,index})=>{const options=item.typeId?weaponChargeOptions[item.typeId]??[]:[];return <div className="firepower-weapon-row" key={index+":"+(item.typeId??item.name)}><span><strong>{item.name}</strong><small>{item.charge??"No ammo loaded"}</small></span><select aria-label={item.name+" state"} value={item.state??"active"} onChange={event=>onModuleStateChange("high",index,event.target.value as ModuleState)}><option value="active">Active</option><option value="overheated">Overheated</option><option value="online">Online / not firing</option><option value="offline">Offline</option></select><select aria-label={item.name+" ammo"} value={item.chargeTypeId??0} disabled={!options.length} onChange={event=>{const charge=options.find(option=>option.id===Number(event.target.value));if(charge)void onLoadCharge("high",index,{id:charge.id,name:charge.name,groupId:0,categoryId:8,categoryName:"Charge"} as FittingSearchResult);}}><option value={0}>{options.length?"Choose ammo...":"No compatible ammo"}</option>{options.map(option=><option key={option.id} value={option.id}>{option.name}</option>)}</select></div>})}</div>}
                {!fit.drones.length&&!weaponEntries.length&&<small className="firepower-loadout-empty">No drones or weapon modules are fitted. Use the controls above to add a damage source.</small>}
              </div>
            </section>

        <section className="fit-rail-section pyfa-section-capacitor">
              <header className="fit-rail-section-head"><div><span>Capacitor</span><strong>{cap?(cap.stable?"Stable":duration(cap.depletionSeconds)+" to empty"):"--"}</strong></div><em>{capacitorPeakMargin==null?"":(capacitorPeakMargin>=0?"+":"")+fmt(capacitorPeakMargin,2)+" GJ/s peak margin"}</em></header>
              <div className="fit-rail-metric-grid">
                <Metric label="Capacity" value={cap?fmt(cap.capacityGj,0)+" GJ":"--"}/>
                <Metric label="Demand" value={cap?fmt(cap.demandGjPerSecond,2)+" GJ/s":"--"}/>
                <Metric label="Peak recharge" value={cap?fmt(cap.peakRechargeGjPerSecond,2)+" GJ/s":"--"}/>
                <Metric label="Cap state" value={cap?(cap.stable?`Stable ${fmt(cap.stablePercent,1)}%`:duration(cap.depletionSeconds)):"--"} tone={cap?.stable?"good":cap?"danger":"muted"}/>
              </div>
            </section>
      </div>
      <div className="fit-rail-column fit-rail-column-right">
        <section className="fit-rail-section pyfa-section-tank">
              <header className="fit-rail-section-head"><div><span>Recharge &amp; tank</span><strong>{scenarioTank>0?fmt(scenarioTank,1)+" EHP/s":"Tank output"}</strong></div>{incoming>0&&<em>{fmt(tankRatio,1)}x average incoming</em>}</header>
              <div className="fit-rail-metric-grid">
                <Metric label="Shield repair" value={defence?fmt(defence.effectiveShieldRepairPerSecond,1)+" EHP/s":"--"} tone={Number(defence?.effectiveShieldRepairPerSecond??0)>0?"good":"muted"}/>
                <Metric label="Passive shield" value={defence?fmt(defence.effectivePassiveShieldPeak,1)+" EHP/s":"--"}/>
                <Metric label="Armor repair" value={defence?fmt(defence.effectiveArmorRepairPerSecond,1)+" EHP/s":"--"}/>
                {incoming>0&&<Metric label="Average incoming" value={fmt(incoming,1)+" DPS"} sub={tankRatio>=1.5?"Healthy average tank margin":tankRatio>=1?"Thin average tank margin":"Average room pressure exceeds tank"} tone={tankRatio>=1.5?"good":tankRatio>=1?"warn":"danger"}/>}
              </div>
            </section>

        <section className="fit-rail-section pyfa-section-targeting">
              <header className="fit-rail-section-head"><div><span>Targeting &amp; navigation</span><strong>{nav?fmt(nav.maximumVelocity,0)+" m/s":"--"}</strong></div><em>{nav?fmt(nav.alignSeconds,2)+" s align":""}</em></header>
              <div className="fit-rail-metric-grid">
                <Metric label="Targets" value={targeting?fmt(targeting.maximumLockedTargets):"--"}/>
                <Metric label="Lock range" value={targeting?fmt(targeting.maximumRangeM/1000,1)+" km":"--"}/>
                <Metric label="Speed" value={nav?fmt(nav.maximumVelocity,0)+" m/s":"--"}/>
                <Metric label="Align" value={nav?fmt(nav.alignSeconds,2)+" s":"--"}/>
              </div>
            </section>
      </div>
    </div>

    <div className="fit-drone-flight-bar">
      <span>Active drone flight</span>
      <select value={quickDroneTypeId} disabled={!fit.drones.length} onChange={event=>selectDroneFlight(Number(event.target.value))}>
        {fit.drones.length===0?<option value={0}>No drones fitted</option>:<>
          <option value={0} title="Auto / best legal flight">Auto</option>
          {fit.drones.filter(item=>item.typeId).map(item=><option key={item.typeId} value={item.typeId}>{item.name} x{item.quantity}</option>)}
        </>}
      </select>
    </div>

    <section className="fit-rail-section fit-rail-fitting">
      <header className="fit-rail-section-head"><div><span>Fitting resources</span><strong>{fit.high.length}H / {fit.mid.length}M / {fit.low.length}L / {fit.rig.length}R</strong></div><em>{hardpoints?.turret??"--"} turret / {hardpoints?.launcher??"--"} launcher</em></header>
      <div className="fit-rail-resource-grid">
        <Resource label="CPU" used={res?.used.cpu} total={res?.capacity.cpu} unit="tf"/>
        <Resource label="Powergrid" used={res?.used.powergrid} total={res?.capacity.powergrid} unit="MW"/>
        <Resource label="Calibration" used={res?.used.calibration} total={res?.capacity.calibration} unit=""/>
        <Resource label="Drone bay" used={storage?.droneBayUsedM3} total={storage?.droneBayCapacityM3??hullProfile?.storage.droneBayM3} unit="m3"/>
        <Resource label="Bandwidth" used={storage?.droneBandwidthUsed} total={storage?.droneBandwidthCapacity??hullProfile?.storage.droneBandwidth} unit="Mbit/s"/>
        <Resource label="Cargo" used={storage?.cargoUsedM3} total={storage?.cargoCapacityM3??hullProfile?.storage.cargoM3} unit="m3"/>
      </div>
    </section>
  </aside>;
}

function FitCombatScenario({
  analysis,
  fit,
  scenario,
  onScenarioChange,
  abyssSelection,
  onAbyssSelectionChange,
  damageProfilePreset,
  onDamageProfilePresetChange,
  targetProfile,
  onTargetProfileChange,
  onNpcTargetChange,
  onDroneFlightChange,
  onBrowseDrones,
}: {
  analysis:any;
  fit:Fit;
  scenario:FitCombatScenarioState;
  onScenarioChange(value:FitCombatScenarioState):void;
  abyssSelection:AbyssFitterSelection;
  onAbyssSelectionChange(value:AbyssFitterSelection):void;
  damageProfilePreset:NpcDamagePreset;
  onDamageProfilePresetChange(value:NpcDamagePreset):void;
  targetProfile:CombatTargetProfile;
  onTargetProfileChange(value:CombatTargetProfile):void;
  onNpcTargetChange(typeId:number):void;
  onDroneFlightChange(typeId:number|null,activeCount?:number):void;
  onBrowseDrones():void;
}) {
  const activity=combatActivity(scenario.activity);
  const selectedSite=combatSite(scenario);
  const abyss=analysis?.abyss;
  const averageTarget=abyssSelection.enabled?abyss?.summary?.averageTarget:undefined;
  const averageIncoming=abyssSelection.enabled?abyss?.summary?.averageIncoming:undefined;
  const scenarioTank=Number(averageIncoming?.playerTank?.effectiveShieldRepairPerSecond??analysis?.defence?.effectiveShieldRepairPerSecond??0)
    +Number(averageIncoming?.playerTank?.effectiveArmorRepairPerSecond??analysis?.defence?.effectiveArmorRepairPerSecond??0)
    +Number(averageIncoming?.playerTank?.effectiveStructureRepairPerSecond??analysis?.defence?.effectiveStructureRepairPerSecond??0)
    +Number(averageIncoming?.playerTank?.effectivePassiveShieldPeak??analysis?.defence?.effectivePassiveShieldPeak??0);
  const averageIncomingDps=Number(averageIncoming?.totalDps??0);
  const averageTankHolds=averageIncomingDps>0&&scenarioTank>=averageIncomingDps;
  const averageTankCapStable=Boolean(analysis?.capacitor?.stable);
  const appliedWeaponDps=analysis?.damage?.weaponProfiles?.reduce((sum:number,weapon:any)=>sum+Number(weapon.targetApplication?.appliedDps??0),0)??0;
  const profileAppliedDps=appliedWeaponDps+Number(analysis?.damage?.droneDps??0);
  const explicitDroneFlight=fit.drones.some(item=>item.activeQuantity!=null);
  const activeDroneTypeId=explicitDroneFlight?(fit.drones.find(item=>Number(item.activeQuantity??0)>0)?.typeId??0):0;
  const seconds=(value:number|undefined)=>{
    if(value==null||!Number.isFinite(value))return "--";
    const safe=Math.abs(Math.round(value));
    return `${Math.floor(safe/60)}m ${String(safe%60).padStart(2,"0")}s`;
  };
  const averageTankStable=averageTankHolds&&averageTankCapStable;
  const averageTankMargin=averageIncomingDps>0?scenarioTank/averageIncomingDps:0;
  const averageTankShortfall=Math.max(0,averageIncomingDps-scenarioTank);
  const averageTankStatus=averageTankStable
    ? "Tank stable indefinitely"
    : averageTankHolds
      ? `Tank holds while cap lasts - ${seconds(Number(analysis?.capacitor?.depletionSeconds??0))}`
      : `Tank breaks - ${averageTankShortfall.toFixed(1)} EHP/s short`;
  const averageTankComparison=averageIncomingDps>0
    ? `${scenarioTank.toFixed(1)} EHP/s effective tank vs ${averageIncomingDps.toFixed(1)} DPS incoming${averageTankHolds?` - ${averageTankMargin.toFixed(1)}x margin`:""}`
    : `${scenarioTank.toFixed(1)} EHP/s effective tank`;
  const averageTankStatusClass=averageTankStable?"tank-stable":averageTankHolds?"tank-cap-limited":"tank-breaks";
  const selectDroneFlight=(typeId:number)=>{
    if(!typeId){onDroneFlightChange(null);return;}
    const bay=fit.drones.find(item=>item.typeId===typeId);
    if(!bay)return;
    const limits=analysis?.damage?.droneLimits;
    const maxActive=Math.max(0,Math.floor(Number(limits?.maxActiveDrones??5)));
    const bandwidthEntry=(limits?.bandwidthByType??[]).find((item:any)=>Number(item.typeId)===typeId);
    const bandwidth=Math.max(0,Number(bandwidthEntry?.bandwidth??0));
    const byBandwidth=bandwidth>0?Math.floor(Number(limits?.bandwidthCapacity??0)/bandwidth):maxActive;
    const activeCount=Math.max(0,Math.min(Number(bay.quantity||0),maxActive,byBandwidth||maxActive));
    onDroneFlightChange(typeId,activeCount);
  };
  const applyScenario=(next:FitCombatScenarioState)=>{
    const nextActivity=combatActivity(next.activity);
    const nextSite=combatSite(next);
    onScenarioChange(next);
    onNpcTargetChange(0);
    onDamageProfilePresetChange(nextActivity.factionSelectable?next.faction:nextActivity.defaultFaction);
    onTargetProfileChange(nextSite.profile);
    if(next.activity==="abyss"){
      const tier=abyssSelection.enabled?abyssSelection.tier:5;
      const validPenalties=(tier<=3?[0.3,0.5]:[0.5,0.7]) as Array<0.3|0.5|0.7>;
      onAbyssSelectionChange({...abyssSelection,enabled:true,tier,penalty:validPenalties.includes(abyssSelection.penalty)?abyssSelection.penalty:validPenalties.at(-1)!,roomKey:"all"});
    }else{
      onAbyssSelectionChange({...abyssSelection,enabled:false,roomKey:"all"});
    }
  };
  const chooseActivity=(id:CombatActivityId)=>{
    const nextActivity=combatActivity(id);
    applyScenario({
      activity:id,
      space:nextActivity.spaces[0]?.value??"any",
      faction:nextActivity.defaultFaction,
      site:(id==="ded"?(DED_COMPLEX_NAMES[nextActivity.defaultFaction]?.[0]?.rating?`ded-${DED_COMPLEX_NAMES[nextActivity.defaultFaction]![0].rating}`:nextActivity.sites[0]?.id):nextActivity.sites[0]?.id)??"manual",
      abyssHull:scenario.abyssHull,
    });
  };
  const chooseSpace=(space:string)=>{
    const option=activity.spaces.find(item=>item.value===space);
    if(option?.faction){
      const candidate={...scenario,space,faction:option.faction};
      const sites=combatSitesFor(candidate);
      const resolved={...candidate,site:sites.some(item=>item.id===candidate.site)?candidate.site:(sites[0]?.id??candidate.site)};
      onScenarioChange(resolved);
      onNpcTargetChange(0);
      onDamageProfilePresetChange(option.faction);
      onTargetProfileChange(combatSite(resolved).profile);
      return;
    }
    onScenarioChange({...scenario,space});
  };
  const chooseSite=(siteId:string)=>{
    const next={...scenario,site:siteId};
    onScenarioChange(next);
    onNpcTargetChange(0);
    onTargetProfileChange(combatSite(next).profile);
  };
  const chooseFaction=(faction:NpcDamagePreset)=>{
    const candidate={...scenario,faction};
    const sites=combatSitesFor(candidate);
    const resolved={...candidate,site:sites.some(item=>item.id===candidate.site)?candidate.site:(sites[0]?.id??candidate.site)};
    onScenarioChange(resolved);
    onNpcTargetChange(0);
    onDamageProfilePresetChange(faction);
    onTargetProfileChange(combatSite(resolved).profile);
  };
  const chooseAbyssTier=(tier:AbyssFitterSelection["tier"])=>{
    const validPenalties=(tier<=3?[0.3,0.5]:[0.5,0.7]) as Array<0.3|0.5|0.7>;
    onNpcTargetChange(0);
    onAbyssSelectionChange({...abyssSelection,enabled:true,tier,penalty:validPenalties.includes(abyssSelection.penalty)?abyssSelection.penalty:validPenalties.at(-1)!,roomKey:"all"});
  };
  const strategy=[...activity.strategy,...(selectedSite.strategy??[])];
  const recommendation=NPC_DAMAGE_PRESETS[damageProfilePreset];
  const recommendedDamage = scenario.activity==="abyss"
    ? ({electrical:"EM",exotic:"Kinetic",firestorm:"Thermal",gamma:"Explosive",dark:"Application / strongest flight"} as const)[abyssSelection.weather]
    : recommendation.dealLabel;
  const recommendedDroneTokens = recommendedDamage.startsWith("EM") ? ["Praetor","Infiltrator","Acolyte"]
    : recommendedDamage.startsWith("Kinetic") ? ["Wasp","Vespa","Hornet"]
    : recommendedDamage.startsWith("Thermal") ? ["Ogre","Hammerhead","Hobgoblin"]
    : recommendedDamage.startsWith("Explosive") ? ["Berserker","Valkyrie","Warrior"] : [];
  const recommendedFittedDrone = fit.drones.find(item=>recommendedDroneTokens.some(token=>item.name.includes(token)));
  const modeledDroneSwitchLegs=(abyss?.rooms??[]).flatMap((candidate:any)=>Array.isArray(candidate?.droneNavigation?.route)?candidate.droneNavigation.route.slice(1):[]);
  const averageTargetTravelSeconds=modeledDroneSwitchLegs.length
    ? modeledDroneSwitchLegs.reduce((sum:number,leg:any)=>sum+Number(leg?.travelSeconds??0),0)/modeledDroneSwitchLegs.length
    : 0;
  const room=abyss?.selectedRoom??abyss?.summary?.worstIncoming;
  return <div className="fit-combat-scenario-stage">
    <section className="combat-scenario-builder">
      <header className="combat-scenario-builder-head">
        <div><span>Combat Scenario</span><strong>{activity.label}</strong><small>{activity.description}</small></div>
        <b>{selectedSite.label}</b>
      </header>
      <div className="combat-scenario-picker-grid">
        <label><span>Scenario</span><select value={scenario.activity} onChange={event=>chooseActivity(event.target.value as CombatActivityId)}>{FIT_COMBAT_ACTIVITIES.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        {scenario.activity==="abyss" ? <>
          <label><span>Tier</span><select value={abyssSelection.tier} onChange={event=>chooseAbyssTier(Number(event.target.value) as AbyssFitterSelection["tier"])}>{([0,1,2,3,4,5,6] as AbyssFitterSelection["tier"][]).map(tier=><option key={tier} value={tier}>T{tier}</option>)}</select></label>
          <label><span>Weather</span><select value={abyssSelection.weather} onChange={event=>onAbyssSelectionChange({...abyssSelection,enabled:true,weather:event.target.value as AbyssFitterSelection["weather"],roomKey:"all"})}>{ABYSS_WEATHER_OPTIONS.map(weather=><option key={weather.value} value={weather.value}>{weather.label}</option>)}</select></label>
          <label><span>Ship class</span><select value={scenario.abyssHull} onChange={event=>onScenarioChange({...scenario,abyssHull:event.target.value as FitCombatScenarioState["abyssHull"]})}><option value="cruiser">Cruiser filament</option><option value="destroyer">Destroyer filament</option><option value="frigate">Frigate filament</option></select></label>
          <label><span>Weather strength</span><select value={abyssSelection.penalty} onChange={event=>onAbyssSelectionChange({...abyssSelection,penalty:Number(event.target.value) as AbyssFitterSelection["penalty"]})}>{((abyssSelection.tier<=3?[0.3,0.5]:[0.5,0.7]) as Array<0.3|0.5|0.7>).map(value=><option key={value} value={value}>{Math.round(value*100)}%</option>)}</select></label>
          <label className="combat-scenario-wide-control"><span>Room set</span><select value={abyssSelection.roomKey} onChange={event=>onAbyssSelectionChange({...abyssSelection,roomKey:event.target.value})}><option value="all">Average all documented rooms</option>{abyss?.rooms?.map((item:any)=><option key={item.key} value={item.key}>{item.name}</option>)}</select></label>
        </> : <>
          {activity.spaces.length>0&&<label><span>Area of space</span><select value={scenario.space} onChange={event=>chooseSpace(event.target.value)}>{activity.spaces.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
          {activity.factionSelectable&&<label><span>Enemy / local faction</span><select value={scenario.faction} onChange={event=>chooseFaction(event.target.value as NpcDamagePreset)}><option value="omni">Unknown / mixed - omni</option>{COMBAT_FACTION_OPTIONS.map(key=><option key={key} value={key}>{NPC_DAMAGE_PRESETS[key].label}</option>)}</select></label>}
          <label className="combat-scenario-wide-control"><span>Site / escalation</span><select value={scenario.site} onChange={event=>chooseSite(event.target.value)}>{combatSitesFor(scenario).map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        </>}
      </div>
      <div className="combat-scenario-selection-note"><strong>{selectedSite.label}</strong><span>{selectedSite.detail}</span></div>
    </section>

    <div className="combat-scenario-dashboard">
      <section className="combat-scenario-strategy">
        <header><span>Run strategy</span><strong>Fit this encounter, not the paper number</strong></header>
        <div className="combat-scenario-tags">
          <span><small>Deal</small><b>{recommendedDamage}</b></span>
          <span><small>Tank</small><b>{scenario.activity==="abyss"?"Abyss room average":recommendation.incomingLabel}</b></span>
          <span><small>Target model</small><b>{Math.round(targetProfile.signatureRadiusM)} m sig · {Math.round(targetProfile.rangeM/1000)} km range</b></span>
        </div>
        <ol>{strategy.map((line,index)=><li key={index}>{line}</li>)}</ol>
      </section>

      <section className="combat-scenario-loadout">
        <header><span>Damage loadout</span><strong>Use what you will actually launch</strong></header>
        <div className="combat-scenario-drone-guidance"><span><small>Recommended damage</small><b>{recommendedDamage}</b></span><span><small>Best matching fitted flight</small><b>{recommendedFittedDrone?.name??"No matching fitted flight"}</b></span></div>
        <label className="combat-scenario-drone-select"><span>Active fitted drone flight</span><select value={activeDroneTypeId} disabled={!fit.drones.length} onChange={event=>selectDroneFlight(Number(event.target.value))}>{fit.drones.length===0?<option value={0}>No drones fitted</option>:<><option value={0}>Auto / best legal flight</option>{fit.drones.filter(item=>item.typeId).map(item=><option key={item.typeId} value={item.typeId}>{item.name} x{item.quantity}</option>)}</>}</select></label>
        <div className="combat-scenario-loadout-actions"><button type="button" onClick={onBrowseDrones}>Browse drones</button><small>Changing the flight updates drone DPS and the right-rail combat readout immediately.</small></div>
        <div className="combat-scenario-live-grid">
          <article><span>Paper DPS</span><strong>{analysis?.damage?analysis.damage.totalDps.toFixed(1):"--"}</strong></article>
          <article><span>{abyssSelection.enabled?"Scenario DPS":"Applied profile DPS"}</span><strong>{averageTarget?averageTarget.trueDps.toFixed(1):analysis?.damage?profileAppliedDps.toFixed(1):"--"}</strong></article>
          <article><span>Drone DPS</span><strong>{analysis?.damage?analysis.damage.droneDps.toFixed(1):"--"}</strong></article>
          <article><span>Profile EHP</span><strong>{analysis?.defence?Math.round(analysis.defence.totalEhp).toLocaleString():"--"}</strong></article>
          <article><span>Tank output</span><strong>{analysis?.defence?scenarioTank.toFixed(1)+" EHP/s":"--"}</strong></article>
          <article><span>Cap state</span><strong>{analysis?.capacitor?(analysis.capacitor.stable?"Stable":seconds(analysis.capacitor.depletionSeconds)):"--"}</strong></article>
        </div>
      </section>
    </div>

    {scenario.activity==="abyss"&&<section className="combat-scenario-abyss-intel">
      <header><div><span>Abyss live analysis</span><strong>{abyssScenarioLabel(abyssSelection.tier,abyssSelection.weather)}</strong></div><small>{abyss?.summary?.roomCount??0} documented room profiles</small></header>
      {averageTarget&&averageIncoming?<>
        <div className="combat-scenario-abyss-metrics">
          <article><span>Average target DPS</span><strong>{averageTarget.trueDps.toFixed(1)}</strong><small>weather-adjusted target mix</small></article>
          <article className={averageTankStatusClass} title="Effective tank includes current active reps, passive shield regeneration and the current resistance/hardener profile."><span>Average incoming</span><strong>{averageIncoming.totalDps.toFixed(1)} DPS</strong><small>{averageTankStatus}</small><small>{averageTankComparison}</small><small>includes current reps, passive regen and resists</small></article>
          <article><span>Average hostiles</span><strong>{averageTarget.averageHostilesPerRoom.toFixed(1)}</strong><small>per documented room</small></article>
          <article><span>Avg drone travel</span><strong>{seconds(averageTargetTravelSeconds)}</strong><small>target-to-target drone switch</small></article>
          <article className="clear-time"><span>Representative clear</span><strong>{seconds(abyss?.siteEstimate?.representative?.estimatedClearSeconds)}</strong><small>3-room estimate</small></article>
          <article className="worst-clear-time"><span>Worst-case 3-room total</span><strong>{seconds(abyss?.siteEstimate?.heavyKnown?.estimatedClearSeconds)}</strong><small>3x longest documented room</small></article>
          <article><span>Timer margin</span><strong>{seconds(abyss?.siteEstimate?.representative?.timerMarginSeconds)}</strong><small>{Number(abyss?.siteEstimate?.representative?.timerMarginSeconds??0)>=0?"spare":"over 20-minute limit"}</small></article>
        </div>
        <div className="combat-scenario-clear-time-caveat" title={abyss?.clearTimeCaveat ?? ""}>
          <strong>Clear-time estimate</strong>
          <span>Includes mobile-drone launch and target-to-target travel. The hull is not assumed to move between targets. These times are estimates, not a guarantee.</span>
        </div>
        <details className="combat-scenario-room-breakdown">
          <summary><span>Room breakdown & exact NPC data</span><small>{abyss?.summary?.roomCount??0} room profiles</small></summary>
          <div className="abyss-all-rooms-table">
            <div className="abyss-table-row head"><span>Room</span><span>Hostiles</span><span>Incoming</span><span>Max ramp</span><span>Clear est.</span><span>Fit EHP</span></div>
            {abyss?.rooms?.map((item:any)=><button type="button" className="abyss-table-row" key={item.key} onClick={()=>onAbyssSelectionChange({...abyssSelection,roomKey:item.key})}><span><strong>{item.name}</strong><small>{item.family}{item.variable?" · variable envelope":""}</small></span><span>{item.totalHostiles}</span><span>{item.incoming.totalDps.toFixed(1)}</span><span>{item.incoming.maxRamp.totalDps.toFixed(1)}</span><span>{seconds(item.clearSeconds)}</span><span>{Math.round(item.playerTank.totalEhp).toLocaleString()}</span></button>)}
          </div>
          {room&&<details className="abyss-exact-npc-breakdown"><summary>Exact enemies for {room.name}</summary><div className="abyss-target-table"><div className="abyss-target-row head"><span>Enemy</span><span>Count</span><span>Weather HP</span><span>Resists S/A/H</span><span>NPC DPS</span><span>True DPS</span><span>TTK</span></div>{room.targets.map((target:any)=><div className="abyss-target-row" key={target.typeId}><span><strong>{target.name}</strong><small>Type {target.typeId}</small></span><span>{target.count}</span><span>{Math.round(target.weatherHp.total).toLocaleString()}</span><span><small>S {target.weatherResists.shield.map((v:number)=>Math.round(v*100)+"%").join(" / ")}</small><small>A {target.weatherResists.armor.map((v:number)=>Math.round(v*100)+"%").join(" / ")}</small><small>H {target.weatherResists.hull.map((v:number)=>Math.round(v*100)+"%").join(" / ")}</small></span><span>{target.outgoingDpsTotal.toFixed(1)} / {target.outgoingDpsMaxTotal.toFixed(1)}</span><span>{target.trueDps.toFixed(1)}</span><span>{seconds(target.ttkSeconds)}</span></div>)}</div></details>}
        </details>
      </>:<div className="combat-scenario-empty">Calculating the selected Abyss tier and weather against the current fit...</div>}
    </section>}
  </div>;
}


function FitPerformance({
  analysis,
  status,
  fit,
  characters,
  characterId,
  onCharacterChange,
  externalEffects,
  boosterSideEffects,
  selectedBoosterSideEffectKeys,
  onSelectedBoosterSideEffectKeysChange,
  onAddExternalEffect,
  onUpdateExternalEffect,
  onRemoveExternalEffect,
  onModuleStateChange,
  onExportToEve,
  eveExporting,
  eveExportStatus,
  onExportToPlanner,
}: {
  analysis: any;
  status: string;
  fit: Fit;
  characters: FittingCharacter[];
  characterId: string;
  onCharacterChange(id:string):void;
  externalEffects: ExternalEffectSelection[];
  boosterSideEffects: BoosterSideEffectOption[];
  selectedBoosterSideEffectKeys: string[];
  onSelectedBoosterSideEffectKeysChange(value:string[]):void;
  onAddExternalEffect(input: { kind: ExternalEffectKind; name: string; chargeName?: string }): Promise<string | null>;
  onUpdateExternalEffect(id: string, patch: Partial<ExternalEffectSelection>): void;
  onRemoveExternalEffect(id: string): void;
  onModuleStateChange(rack: FitModuleRack, index: number, state: ModuleState): void;
  onExportToEve(): Promise<void>;
  eveExporting: boolean;
  eveExportStatus: string;
  onExportToPlanner(): void;
}) {
  const [externalKind, setExternalKind] = useState<ExternalEffectKind>("environment");
  const [externalName, setExternalName] = useState("");
  const [externalCharge, setExternalCharge] = useState("");
  const [externalStatus, setExternalStatus] = useState("");
  const [fleetBurstOptions, setFleetBurstOptions] = useState<FittingSearchResult[]>([]);
  const [fleetBurstTypeId, setFleetBurstTypeId] = useState(0);
  const [fleetBurstCharges, setFleetBurstCharges] = useState<Array<{ id:number; name:string }>>([]);
  const [fleetBurstChargeTypeId, setFleetBurstChargeTypeId] = useState(0);
  useEffect(() => {
    let cancelled=false;
    void window.sage.searchFittingTypesLocal("Command Burst", 120).then((items) => {
      if(cancelled)return;
      const bursts=items.filter((item) => item.categoryId===7 && item.rack==="high" && /Command Burst/i.test(item.name)).sort((a,b)=>a.name.localeCompare(b.name));
      setFleetBurstOptions(bursts);
      setFleetBurstTypeId((current)=>current&&bursts.some(item=>item.id===current)?current:(bursts[0]?.id??0));
    }).catch(()=>{ if(!cancelled)setFleetBurstOptions([]); });
    return()=>{cancelled=true;};
  },[]);
  useEffect(() => {
    if(!fleetBurstTypeId){setFleetBurstCharges([]);setFleetBurstChargeTypeId(0);return;}
    let cancelled=false;
    void window.sage.getFittingChargesForModulesLocal([fleetBurstTypeId]).then(async (result)=>{
      const resolved=result.compatibleTypeIds.length?await window.sage.resolveFittingTypeIdsLocal(result.compatibleTypeIds):[];
      if(cancelled)return;
      const charges=resolved.map(item=>({id:item.id,name:item.name})).filter(item=>/Charge$/i.test(item.name)).sort((a,b)=>a.name.localeCompare(b.name));
      setFleetBurstCharges(charges);
      setFleetBurstChargeTypeId((current)=>current&&charges.some(item=>item.id===current)?current:(charges[0]?.id??0));
    }).catch(()=>{if(!cancelled){setFleetBurstCharges([]);setFleetBurstChargeTypeId(0);}});
    return()=>{cancelled=true;};
  },[fleetBurstTypeId]);
  const addFleetBoost = async () => {
    const burst=fleetBurstOptions.find(item=>item.id===fleetBurstTypeId);
    const charge=fleetBurstCharges.find(item=>item.id===fleetBurstChargeTypeId);
    if(!burst||!charge){setExternalStatus("Select a command burst and charge.");return;}
    setExternalStatus("Applying fleet boost...");
    const error=await onAddExternalEffect({kind:"command",name:burst.name,chargeName:charge.name});
    setExternalStatus(error??(burst.name+" + "+charge.name+" applied to this fit."));
  };
  const toggleBoosterSideEffect=(option:BoosterSideEffectOption)=>{
    const key=option.boosterTypeId+":"+option.effectId;
    onSelectedBoosterSideEffectKeysChange(selectedBoosterSideEffectKeys.includes(key)?selectedBoosterSideEffectKeys.filter(item=>item!==key):[...selectedBoosterSideEffectKeys,key]);
  };
  const submitExternalEffect = async () => {
    setExternalStatus("Resolving effect...");
    try {
      const error = await onAddExternalEffect({ kind: externalKind, name: externalName, chargeName: externalCharge || undefined });
      if (error) setExternalStatus(error);
      else { setExternalStatus("External effect added."); setExternalName(""); setExternalCharge(""); }
    } catch (error) { setExternalStatus(error instanceof Error ? error.message : "Could not add external effect."); }
  };
  return (
    <div className="fit-performance">
      <div className="performance-status"><strong>{status}</strong></div>
      <details className="performance-toolbox">
        <summary><span>Run modifiers</span><small>{externalEffects.length} active effect{externalEffects.length === 1 ? "" : "s"} · boosts, boosters & environments</small></summary>
        <div className="external-effects-panel">
        {boosterSideEffects.length>0&&<div className="booster-side-effect-picker">
          <div><strong>Booster side effects</strong><small>Tick the penalties that actually rolled. Base booster bonuses are always applied; these are source-specific random side effects.</small></div>
          <div className="booster-side-effect-options">{boosterSideEffects.map(option=>{const key=option.boosterTypeId+":"+option.effectId;return <label key={key}><input type="checkbox" checked={selectedBoosterSideEffectKeys.includes(key)} onChange={()=>toggleBoosterSideEffect(option)}/><span><strong>{option.effectName}</strong><small>{option.boosterName} - {(option.chance*100).toFixed(0)}% roll chance</small></span></label>})}</div>
        </div>}
        <div className="fleet-boost-quick-pick">
          <div><strong>Fleet boosts</strong><small>Pick a command burst and charge to model the active boost.</small></div>
          <select aria-label="Fleet command burst" value={fleetBurstTypeId} onChange={(event)=>setFleetBurstTypeId(Number(event.target.value))} disabled={!fleetBurstOptions.length}>
            {!fleetBurstOptions.length&&<option value={0}>No command bursts found</option>}
            {fleetBurstOptions.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select aria-label="Fleet command burst charge" value={fleetBurstChargeTypeId} onChange={(event)=>setFleetBurstChargeTypeId(Number(event.target.value))} disabled={!fleetBurstCharges.length}>
            {!fleetBurstCharges.length&&<option value={0}>No compatible charges</option>}
            {fleetBurstCharges.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <button type="button" onClick={()=>void addFleetBoost()} disabled={!fleetBurstTypeId||!fleetBurstChargeTypeId}>Apply fleet boost</button>
        </div>
        <div className="external-effect-add">
          <label>Type<select value={externalKind} onChange={(event) => setExternalKind(event.target.value as ExternalEffectKind)}><option value="environment">Environment</option><option value="booster">Booster</option><option value="projected">Projected module</option><option value="command">Command burst</option></select></label>
          <label>Effect name<input value={externalName} onChange={(event) => setExternalName(event.target.value)} placeholder={externalKind === "environment" ? "Class 1 Pulsar Effects" : externalKind === "booster" ? "Strong Blue Pill Booster" : externalKind === "command" ? "Shield Command Burst II" : "Stasis Webifier II"} /></label>
          {(externalKind === "projected" || externalKind === "command") && <label>Charge / script<input value={externalCharge} onChange={(event) => setExternalCharge(event.target.value)} placeholder={externalKind === "command" ? "Shield Extension Charge" : "Optional script"} /></label>}
          <button type="button" onClick={submitExternalEffect}>Add effect</button>
        </div>
        {externalStatus && <small className="external-effect-status">{externalStatus}</small>}
        {externalEffects.length > 0 && <div className="external-effect-list">{externalEffects.map((item) => <div className="external-effect-row" key={item.id}><div><strong>{item.name}</strong><small>{item.kind}{item.chargeName ? <> - {item.chargeName}</> : null}</small></div>{(item.kind === "projected" || item.kind === "command") && <><label>State<select value={item.state ?? "active"} onChange={(event) => onUpdateExternalEffect(item.id, { state: event.target.value as ModuleState })}><option value="active">Active</option><option value="overheated">Overheated</option></select></label><label>Effect %<input type="number" min="0" max="100" step="1" value={Math.round((item.effectiveness ?? 1) * 100)} onChange={(event) => onUpdateExternalEffect(item.id, { effectiveness: Math.max(0, Math.min(1, Number(event.target.value) / 100)) })} /></label></>}<button type="button" onClick={() => onRemoveExternalEffect(item.id)}>Remove</button></div>)}</div>}
        </div>
      </details>
      {analysis && (
        <>
          <div className="performance-summary fit-performance-overview">
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
          <div className="fit-performance-section-title"><span>Ship performance</span><small>Current fit with selected pilot skills</small></div>
          <div className="fit-performance-matrix">
          {analysis.resources && (
            <div className="base-stat-grid fit-performance-group performance-resources" data-title="Fitting resources">
              {(["cpu", "powergrid", "calibration"] as const).map((key) => (
                <article key={key}>
                  <span>{key}</span>
                  <strong>{analysis.resources.used[key].toFixed(1)} / {analysis.resources.capacity[key].toFixed(1)}</strong>
                </article>
              ))}
            </div>
          )}
          {analysis.capacitor && (
            <div className="base-stat-grid fit-performance-group performance-capacitor" data-title="Capacitor">
              <article><span>Capacitor capacity</span><strong>{analysis.capacitor.capacityGj.toFixed(1)} GJ</strong></article>
              <article><span>Recharge time</span><strong>{analysis.capacitor.rechargeSeconds.toFixed(1)} s</strong></article>
              <article><span>Capacitor demand</span><strong>{analysis.capacitor.demandGjPerSecond.toFixed(2)} GJ/s</strong></article>
              <article><span>Peak recharge</span><strong>{analysis.capacitor.peakRechargeGjPerSecond.toFixed(2)} GJ/s</strong></article>
              <article><span>Net capacitor</span><strong>{analysis.capacitor.stable ? `+${analysis.capacitor.deltaGjPerSecond.toFixed(2)} GJ/s` : `-${(analysis.capacitor.netDemandGjPerSecond-analysis.capacitor.peakRechargeGjPerSecond).toFixed(2)} GJ/s`}</strong></article>
              <article><span>Capacitor state</span><strong>{analysis.capacitor.stable ? `Stable +${analysis.capacitor.stablePercent.toFixed(1)}%` : `${Math.round(analysis.capacitor.depletionSeconds)}s`}</strong></article>
            </div>
          )}
          {analysis.damage && (
            <div className="base-stat-grid fit-performance-group performance-firepower" data-title="Firepower">
              <article><span>Raw paper DPS</span><strong>{analysis.damage.totalDps.toFixed(1)}</strong></article>
              <article><span>Weapon / drone DPS</span><strong>{analysis.damage.weaponDps.toFixed(1)} / {analysis.damage.droneDps.toFixed(1)}</strong></article>
              <article><span>Total volley</span><strong>{analysis.damage.totalVolley.toFixed(1)}</strong></article>
              <article><span>Active drones</span><strong>{analysis.damage.activeDrones.length}</strong><small>{analysis.damage.activeDrones.map((drone: any) => drone.name).join(", ") || "None selected"}</small></article>
              {analysis.damage.weaponProfiles.map((weapon: any, index: number) => <article key={`${weapon.typeId}-${index}`}><span>{weapon.name}</span><strong>{weapon.kind === "turret" ? `${(weapon.optimalM / 1000).toFixed(1)} + ${(weapon.falloffM / 1000).toFixed(1)} km` : `${(weapon.maximumRangeM / 1000).toFixed(1)} km`}</strong><small>{weapon.kind === "turret" ? `${weapon.tracking.toFixed(3)} tracking` : `${weapon.explosionRadiusM.toFixed(0)} m explosion - ${weapon.explosionVelocity.toFixed(0)} m/s`}</small></article>)}
            </div>
          )}
          {analysis.defence && (
            <div className="base-stat-grid fit-performance-group performance-defense" data-title="Defense">
              <article><span>Profile EHP</span><strong>{Math.round(analysis.defence.totalEhp).toLocaleString()}</strong></article>
              <article><span>Shield / armor / hull</span><strong>{analysis.defence.shieldHp} / {analysis.defence.armorHp} / {analysis.defence.structureHp}</strong></article>
              <article><span>Raw active repair</span><strong>{(analysis.defence.shieldRepairPerSecond + analysis.defence.armorRepairPerSecond + analysis.defence.structureRepairPerSecond).toFixed(1)} HP/s</strong></article>
              <article><span>Effective active tank</span><strong>{(analysis.defence.effectiveShieldRepairPerSecond + analysis.defence.effectiveArmorRepairPerSecond + analysis.defence.effectiveStructureRepairPerSecond).toFixed(1)} EHP/s</strong></article>
              <article><span>Peak passive shield</span><strong>{analysis.defence.passiveShieldPeak.toFixed(1)} HP/s - {analysis.defence.effectivePassiveShieldPeak.toFixed(1)} EHP/s</strong></article>
            </div>
          )}
          {analysis.navigation && analysis.targeting && (
            <div className="base-stat-grid fit-performance-group performance-navigation" data-title="Navigation & targeting">
              <article><span>Align time</span><strong>{analysis.navigation.alignSeconds.toFixed(2)} s</strong></article>
              <article><span>Base speed / warp</span><strong>{analysis.navigation.maximumVelocity.toFixed(0)} m/s - {analysis.navigation.warpSpeedAuPerSecond.toFixed(1)} AU/s</strong></article>
              <article><span>Targeting</span><strong>{(analysis.targeting.maximumRangeM / 1000).toFixed(1)} km - {analysis.targeting.scanResolution.toFixed(0)} mm</strong></article>
              <article><span>Signature / sensors</span><strong>{analysis.targeting.signatureRadiusM.toFixed(0)} m - {analysis.targeting.sensorStrength.toFixed(1)}</strong></article>
            </div>
          )}
          </div>
          {analysis.heat && (
            <details className="performance-detail">
              <summary><span>Heat & overload</span><small>Rack heat and expected burnout</small></summary>
              <div className="performance-detail-body">
              <div className="performance-overheat-controls">
                {(["high","mid","low"] as const).map((rack) => {
                  const heatRack = analysis.heat.racks.find((row:any) => row.rack === rack);
                  const rows = fit[rack].map((item,index) => ({ item, index, heat: heatRack?.modules?.find((module:any) => Number(module.typeId) === Number(item.typeId)) })).filter((row) => Number(row.heat?.heatDamage ?? 0) > 0 && Number(row.heat?.cycleSeconds ?? 0) > 0);
                  if (!rows.length) return null;
                  const heated = rows.filter((row) => row.item.state === "overheated").length;
                  return <section className={"performance-overheat-rack "+rack} key={rack}>
                    <header><span>{rack.toUpperCase()} RACK</span><small>{heated}/{rows.length} overheated</small></header>
                    <div>{rows.map(({item,index,heat}) => <button type="button" className={item.state === "overheated" ? "active" : ""} key={rack+"-"+index+"-"+(item.typeId ?? item.name)} onClick={() => onModuleStateChange(rack,index,item.state === "overheated" ? "active" : "overheated")}>
                      <span>{item.name}</span><b>{item.state === "overheated" ? "OVERHEATED" : "OVERHEAT"}</b><small>{Number(heat?.cycleSeconds ?? 0).toFixed(1)}s cycle</small>
                    </button>)}</div>
                  </section>;
                })}
              </div>
              {analysis.heat.racks.some((rack: any) => rack.overheatedModules > 0) ? analysis.heat.racks.filter((rack: any) => rack.overheatedModules > 0).map((rack: any) => (
                <div key={rack.rack}>
                  <div className="base-stat-grid">
                    <article><span>{rack.rack} rack heat - 30s</span><strong>{(rack.heatAt30Seconds * 100).toFixed(1)}%</strong></article>
                    <article><span>{rack.rack} rack heat - 60s</span><strong>{(rack.heatAt60Seconds * 100).toFixed(1)}%</strong></article>
                    <article><span>Expected first burnout</span><strong>{rack.firstExpectedBurnoutSeconds > 0 ? Math.floor(rack.firstExpectedBurnoutSeconds / 60) + "m " + Math.round(rack.firstExpectedBurnoutSeconds % 60) + "s" : "Beyond 60m / none"}</strong></article>
                    <article><span>Heat attenuation</span><strong>{rack.attenuation.toFixed(2)}</strong><small>{rack.overheatedModules} overloaded - {(rack.occupiedSlotFactor * 100).toFixed(1)}% occupied-slot factor</small></article>
                  </div>
                  <div className="requirement-list">
                    {rack.modules.filter((module: any) => module.state === "overheated" || module.expectedBurnoutSeconds > 0).map((module: any) => (
                      <article className={module.state === "overheated" ? "missing" : "ready"} key={rack.rack + "-" + module.position + "-" + module.typeId}>
                        <strong>{module.name}</strong>
                        <span>{module.state === "overheated" ? "Overheated source" : "Rack position " + (module.position + 1)}</span>
                        <small>{module.heatDamage.toFixed(2)} heat damage - {module.cycleSeconds.toFixed(2)}s cycle - {module.expectedBurnoutSeconds > 0 ? "expected burnout " + Math.floor(module.expectedBurnoutSeconds / 60) + "m " + Math.round(module.expectedBurnoutSeconds % 60) + "s" : "no expected burnout within 60m"}</small>
                      </article>
                    ))}
                  </div>
                </div>
              )) : <div className="performance-note"><small>No fitted modules are currently set to Overheated.</small></div>}
              </div>
            </details>
          )}
          {(analysis.magazines?.length > 0 || analysis.capacitor?.capacitorInjectors?.length > 0 || analysis.commandBurstSources?.length > 0 || analysis.projectedSources?.length > 0 || analysis.environmentSources?.length > 0 || analysis.fighterSystem?.capacityM3 > 0) && (
            <details className="performance-detail">
              <summary><span>Advanced simulation</span><small>Ammo, injectors and external effects</small></summary>
              <div className="performance-detail-body">
                <div className="base-stat-grid">
                {analysis.magazines?.map((magazine:any,index:number)=><article key={`mag-${magazine.typeId}-${index}`}><span>{magazine.name} magazine</span><strong>{magazine.rawCharges} x {magazine.charge}</strong><small>{magazine.cycleSeconds>0?`${magazine.cyclesPerMagazine} cycles - ${magazine.reloadSeconds.toFixed(1)}s reload - ${(magazine.sustainedDutyCycle*100).toFixed(1)}% duty`:"Loaded script / non-cycling charge"}</small></article>)}
                {analysis.capacitor?.capacitorInjectors?.map((injector:any,index:number)=><article key={`cap-${injector.typeId}-${index}`}><span>{injector.name}</span><strong>{injector.sustainedGjPerSecond.toFixed(1)} GJ/s sustained</strong><small>{injector.injectionPerCycleGj.toFixed(0)} GJ per cycle - {injector.charge}</small></article>)}
                {analysis.commandBurstSources?.map((source:any,index:number)=><article key={`burst-${source.typeId}-${index}`}><span>Fleet boost - {source.name}</span><strong>{source.charge??"Command burst"}</strong><small>{source.buffs.map((buff:any)=>`${buff.description}: ${Number(buff.value).toFixed(2)}`).join(" - ")}</small></article>)}
                {analysis.projectedSources?.map((source:any,index:number)=><article key={`projected-${source.typeId}-${index}`}><span>Projected - {source.name}</span><strong>{Math.round(Number(source.effectiveness??1)*100)}% effectiveness</strong><small>{source.effects?.join(" - ")||"Projected effects applied"}</small></article>)}
                {analysis.environmentSources?.map((source:any,index:number)=><article key={`environment-${source.typeId}-${index}`}><span>Environment</span><strong>{source.name}</strong><small>Environment modifiers active</small></article>)}
                {analysis.fighterSystem?.capacityM3>0&&<article><span>Fighter system</span><strong>{analysis.fighterSystem.activeSquadrons} / {analysis.fighterSystem.tubes} active tubes</strong><small>{analysis.fighterSystem.usedM3.toFixed(0)} / {analysis.fighterSystem.capacityM3.toFixed(0)} m3 fighter hangar used</small></article>}
              </div>
              </div>
            </details>
          )}
          {analysis.issues?.length > 0 && <div className="requirement-list">{analysis.issues.map((issue: any, index: number) => <article className={issue.level === "error" ? "missing" : "ready"} key={`${issue.code}-${index}`}><strong>{issue.item ?? issue.code}</strong><small>{issue.message}</small></article>)}</div>}
          <div className="fit-eve-export-panel">
            <div><p className="eyebrow">EVE FIT EXPORT</p><h3>Send this fit straight to EVE</h3></div>
            <label><span>Character</span><select value={characterId} onChange={(event)=>onCharacterChange(event.target.value)} aria-label="EVE export character">{characters.map((character)=><option key={character.characterId} value={character.characterId}>{character.character.name}</option>)}</select></label>
            <button className="primary" type="button" disabled={!characterId || eveExporting} onClick={()=>void onExportToEve()}>{eveExporting ? "Exporting..." : "Export fit to EVE"}</button>
            <button className="secondary" type="button" onClick={onExportToPlanner}>Send to Activity Command</button>
            {eveExportStatus && <small className="fit-eve-export-status">{eveExportStatus}</small>}
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
  characters: FittingCharacter[];
  onBack(): void;
}) {
  const [characterId, setCharacterId] = useState(
    characters[0]?.characterId ?? "",
  );
  const [buyEntireFit, setBuyEntireFit] = useState(false);
  const [highSecOnly, setHighSecOnly] = useState(true);
  const [eveAction, setEveAction] = useState<"route" | "fit" | null>(null);
  const [result, setResult] = useState<any>(null);
  const [status, setStatus] = useState(
    "Choose a character whose current location will be the route origin.",
  );
  async function calculate() {
    setStatus(`Comparing owned assets, prices and ${highSecOnly ? "high-sec-only" : "unrestricted"} routes...`);
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
        highSecOnly,
        items,
      });
      setResult(next);
      setStatus(`Route calculated from ${next.origin}${highSecOnly ? " using high-sec-only travel" : " using unrestricted shortest routes"}.`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Route calculation failed.",
      );
    }
  }
  async function exportRouteToEve() {
    if (!result?.routeStops?.length || !characterId) return;
    setEveAction("route");
    try {
      const exported = await window.sage.exportShoppingRouteToEve({ characterId, stops: result.routeStops });
      setStatus(`Exported ${exported.waypoints} shopping waypoint${exported.waypoints === 1 ? "" : "s"} to ${result.character} in EVE.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not export the shopping route to EVE.");
    } finally {
      setEveAction(null);
    }
  }
  async function exportFitToEve() {
    if (!characterId) return;
    setEveAction("fit");
    try {
      await window.sage.exportFitToEve({ characterId, fit });
      const characterName = characters.find((character) => character.characterId === characterId)?.character.name ?? "the selected character";
      setStatus(`Saved ${fit.name} to ${characterName}'s EVE fitting library.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not export the fit to EVE.");
    } finally {
      setEveAction(null);
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
            onChange={(event) => { setBuyEntireFit(event.target.checked); setResult(null); setStatus("Purchase options changed. Recalculate the shopping route."); }}
          />
          Buy the entire fit; ignore owned assets
        </label>
        <label title="Only choose sellers reachable without entering low-sec or null-sec.">
          <input
            type="checkbox"
            checked={highSecOnly}
            onChange={(event) => { setHighSecOnly(event.target.checked); setResult(null); setStatus("Route safety changed. Recalculate the shopping route."); }}
          />
          High-sec only shopping
        </label>
        <button onClick={calculate} disabled={!characterId}>
          Calculate optimal route
        </button>
        <button onClick={exportRouteToEve} disabled={!characterId || !result?.routeStops?.length || eveAction !== null}>
          {eveAction === "route" ? "Exporting route..." : "Export route to EVE"}
        </button>
        <button onClick={exportFitToEve} disabled={!characterId || eveAction !== null}>
          {eveAction === "fit" ? "Exporting fit..." : "Export fit to EVE"}
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

type ModuleHoverStat = { label:string; value:string; wide?:boolean };
type ModuleHoverContent = { primary:ModuleHoverStat[]; fitting:ModuleHoverStat[] };
type ModuleHoverAttribute = FittingTypeInfo["attributes"][number];
const moduleHoverNumber=(value:unknown,digits=1)=>{const number=Number(value);return Number.isFinite(number)?number.toLocaleString(undefined,{maximumFractionDigits:digits}):"n/a";};
const moduleHoverDistance=(value:unknown)=>{const number=Number(value);if(!Number.isFinite(number))return "n/a";return number>=1000?`${moduleHoverNumber(number/1000,1)} km`:`${moduleHoverNumber(number,0)} m`;};
const moduleHoverValue=(value:number,unit?:string)=>{const shown=Math.abs(value)>=1000?value.toLocaleString(undefined,{maximumFractionDigits:2}):Number(value.toFixed(4)).toLocaleString();return unit?`${shown} ${unit}`:shown;};
const moduleHoverSeconds=(milliseconds:unknown)=>{const value=Number(milliseconds);return Number.isFinite(value)&&value>0?`${moduleHoverNumber(value/1000,2)} s`:"n/a";};
const moduleHoverPercent=(value:unknown,{absolute=false,invert=false}:{absolute?:boolean;invert?:boolean}={})=>{let number=Number(value);if(!Number.isFinite(number))return "n/a";if(invert)number=-number;if(absolute)number=Math.abs(number);return `${number>0?"+":""}${moduleHoverNumber(number,2)}%`;};
const moduleHoverAttributeText=(attribute:ModuleHoverAttribute)=>`${attribute.name} ${attribute.internalName??""}`.toLowerCase();
const moduleHoverAttribute=(typeInfo:FittingTypeInfo|null,attributeId:number)=>typeInfo?.attributes?.find(attribute=>Number(attribute.attributeId)===attributeId);
const moduleHoverAttributeMatch=(typeInfo:FittingTypeInfo|null,...patterns:RegExp[])=>typeInfo?.attributes?.find(attribute=>patterns.some(pattern=>pattern.test(moduleHoverAttributeText(attribute))));
const moduleHoverAttributesMatch=(typeInfo:FittingTypeInfo|null,...patterns:RegExp[])=>(typeInfo?.attributes??[]).filter(attribute=>patterns.some(pattern=>pattern.test(moduleHoverAttributeText(attribute))));
const moduleHoverSemanticText=(item:FitItem,typeInfo:FittingTypeInfo|null)=>[item.name,typeInfo?.group?.name,typeInfo?.category?.name,typeInfo?.marketGroup?.name,...(typeInfo?.marketGroup?.path??[])].filter(Boolean).join(" ").toLowerCase();
const moduleHoverStatValue=(attribute:ModuleHoverAttribute)=>{
  const value=Number(attribute.value);
  const internal=String(attribute.internalName??"");
  if([51,73,1795,669].includes(Number(attribute.attributeId)))return moduleHoverSeconds(value);
  if([54,158,2044].includes(Number(attribute.attributeId)))return moduleHoverDistance(value);
  if(Number(attribute.attributeId)===160)return moduleHoverNumber(value/1000,3);
  // CCP DOGMA frequently stores percentage effects as multipliers (0.85 = 15% reduction, 1.10 = 10% increase).
  // Never print those raw as "0.85%" / "1.10%" in a pilot-facing card.
  if(attribute.unit==="%"&&/multiplier/i.test(internal)&&value>0&&value<3)return moduleHoverPercent((value-1)*100);
  if(/warpspeedadd/i.test(internal))return `${value>0?"+":""}${moduleHoverNumber(value,2)} AU/s`;
  return moduleHoverValue(value,attribute.unit);
};
const moduleHoverAttributeIsNeutral=(attribute:ModuleHoverAttribute)=>{
  const value=Number(attribute.value);
  if(!Number.isFinite(value))return true;
  if(Math.abs(value)<1e-9)return true;
  if(attribute.unit==="%"&&/multiplier/i.test(String(attribute.internalName??""))&&Math.abs(value-1)<1e-9)return true;
  return false;
};
const MODULE_HOVER_FALLBACK_EXCLUDE=/required skill|requiredskill|meta level|metagroup|tech level|structure hitpoints|\bhp\b|maxgroup|charge group|used with|charge size|charges per cycle|charge rate|can fit|can only be fitted|heat damage|thermodynamics|overload|typecolorscheme|slots|skill level|entitycapacitorlevel|remote resistance id|deadspaceunsafe|canactivate|cannot auto repeat|disallowrepeating|disallow.*activation|thrust|stabilize cloak duration|critical success/i;
const MODULE_HOVER_FALLBACK_PRIORITY=/damage|repair|shield|armor|armour|resist|resonan|capacitor|recharge|neutral|drain|transfer|velocity|speed|inertia|agility|warp|scram|web|signature|target|scan|sensor|tracking|optimal|falloff|range|jam|ecm|mining|harvest|yield|tractor|salvag|cloak|cycle|duration|access difficulty/i;
function buildModuleHoverStats(item:FitItem,rack:FitModuleRack|undefined,analysis:any,typeInfo:FittingTypeInfo|null):ModuleHoverContent{
  const primary:ModuleHoverStat[]=[];
  const fitting:ModuleHoverStat[]=[];
  const consumedAttributeIds=new Set<number>();
  const consumeAttribute=(attribute:ModuleHoverAttribute)=>{consumedAttributeIds.add(Number(attribute.attributeId));return attribute;};
  const consumeAttributeId=(attributeId:number)=>{const attribute=moduleHoverAttribute(typeInfo,attributeId);if(attribute)consumeAttribute(attribute);return attribute;};
  const displayValueIsZero=(value:string)=>/^[+-]?0(?:\.0+)?(?:\s*(?:%|gj|mw|tf|hp|hp\/s|m|km|m\/s|s|au\/s|x))?$/i.test(value.trim());
  const push=(label:string,value:string,wide=false)=>{if(value&&value!=="n/a"&&!displayValueIsZero(value)&&!primary.some(row=>row.label.toLowerCase()===label.toLowerCase()))primary.push({label,value,wide});};
  const pushFitting=(label:string,value:string)=>{if(value&&value!=="n/a"&&!fitting.some(row=>row.label===label))fitting.push({label,value});};
  const attr=(id:number)=>moduleHoverAttribute(typeInfo,id);
  const pushAttr=(label:string,id:number,format?:(attribute:ModuleHoverAttribute)=>string)=>{const attribute=attr(id);if(attribute&&!consumedAttributeIds.has(Number(attribute.attributeId))){consumeAttribute(attribute);push(label,format?format(attribute):moduleHoverStatValue(attribute));}};
  const match=(...patterns:RegExp[])=>moduleHoverAttributesMatch(typeInfo,...patterns).find(attribute=>!consumedAttributeIds.has(Number(attribute.attributeId)));
  const pushMatch=(label:string,patterns:RegExp[],format?:(attribute:ModuleHoverAttribute)=>string)=>{const attribute=match(...patterns);if(attribute){consumeAttribute(attribute);push(label,format?format(attribute):moduleHoverStatValue(attribute));}};
  const consumeNeutralMultiplier=(id:number)=>{const attribute=attr(id);if(!attribute||consumedAttributeIds.has(id))return null;consumeAttribute(attribute);const raw=Number(attribute.value);if(!Number.isFinite(raw)||raw<=0)return null;const delta=(raw-1)*100;return Math.abs(delta)<0.005?null:{attribute,delta};};
  const pushMultiplier=(label:string,id:number)=>{const effect=consumeNeutralMultiplier(id);if(effect)push(label,moduleHoverPercent(effect.delta));};
  const text=moduleHoverSemanticText(item,typeInfo);
  const cycle=()=>attr(73)??attr(51);
  const capNeed=()=>attr(6);
  const pushCycle=()=>{const value=cycle();if(value){consumeAttribute(value);push("Cycle",moduleHoverSeconds(value.value));}};
  const pushCap=()=>{const value=capNeed();if(value&&Number(value.value)!==0){consumeAttribute(value);push("Cap / cycle",`${moduleHoverNumber(value.value,1)} GJ`);}};
  const pushRange=()=>{const value=attr(54);if(value){consumeAttribute(value);push("Range",moduleHoverDistance(value.value));}};

  const profile=(analysis?.damage?.weaponProfiles??[]).find((row:any)=>Number(row?.typeId)===Number(item.typeId));
  if(profile){
    push("DPS",moduleHoverNumber(profile.paperDps,1));
    push("Volley",moduleHoverNumber(profile.volley,1));
    if(profile.kind==="turret"){
      push("Optimal",moduleHoverDistance(profile.optimalM));
      push("Falloff",moduleHoverDistance(profile.falloffM));
      push("Tracking",moduleHoverNumber(profile.tracking,3));
    }else if(profile.kind==="missile"){
      push("Max range",moduleHoverDistance(profile.maximumRangeM));
      push("Explosion radius",moduleHoverDistance(profile.explosionRadiusM));
      push("Explosion velocity",`${moduleHoverNumber(profile.explosionVelocity,0)} m/s`);
    }
    if(Number(profile.cycleSeconds)>0){consumeAttributeId(51);consumeAttributeId(73);push("Cycle",`${moduleHoverNumber(profile.cycleSeconds,2)} s`);}
  }

  const isLauncher=/missile launcher|rocket launcher|torpedo launcher|cruise launcher|rapid .*launcher/.test(text);
  const isTurret=!isLauncher&&/autocannon|artillery|blaster|railgun|rail gun|pulse laser|beam laser|turret/.test(text);
  if(!profile&&isTurret){
    pushAttr("Damage multiplier",64,attribute=>`${moduleHoverNumber(attribute.value,3)}x`);
    pushAttr("Optimal",54,attribute=>moduleHoverDistance(attribute.value));
    pushAttr("Falloff",158,attribute=>moduleHoverDistance(attribute.value));
    pushAttr("Tracking",160,attribute=>moduleHoverNumber(Number(attribute.value)/1000,3));
    const rof=attr(51);if(rof){consumeAttribute(rof);push("Cycle",moduleHoverSeconds(rof.value));}
  }
  if(!profile&&isLauncher){
    const rof=attr(51);if(rof){consumeAttribute(rof);push("Cycle",moduleHoverSeconds(rof.value));}
    const reload=attr(1795);if(reload&&!consumedAttributeIds.has(1795)){consumeAttribute(reload);push("Reload",moduleHoverSeconds(reload.value));}
    if(!item.charge)push("Combat stats","Load a missile for DPS, volley, range & explosion stats",true);
  }
  if(!profile&&isTurret&&!item.charge)push("DPS / volley","Depends on loaded ammo / crystal",true);

  if(/fighter support unit/.test(text)){
    const fighterMultiplier=(label:string,id:number)=>{const attribute=attr(id);if(!attribute||consumedAttributeIds.has(id))return;consumeAttribute(attribute);const delta=(Number(attribute.value)-1)*100;if(Math.abs(delta)>=0.005)push(label,moduleHoverPercent(delta));};
    fighterMultiplier("Fighter cycle time",2337);
    fighterMultiplier("Fighter shield HP",2335);
    fighterMultiplier("Fighter shield recharge",2338);
    fighterMultiplier("Fighter velocity",2336);
  }

  if(attr(1255))pushAttr("Drone damage",1255,attribute=>moduleHoverPercent(attribute.value));
  if(/drone navigation computer/.test(text))pushAttr("Drone velocity",20,attribute=>moduleHoverPercent(attribute.value));
  if(/omnidirectional tracking (link|enhancer)/.test(text)){
    pushAttr("Drone optimal",351,attribute=>moduleHoverPercent(attribute.value));
    pushAttr("Drone falloff",349,attribute=>moduleHoverPercent(attribute.value));
    pushAttr("Drone tracking",767,attribute=>moduleHoverPercent(attribute.value));
    pushAttr("Drone explosion velocity",847,attribute=>moduleHoverPercent(attribute.value));
    pushAttr("Drone explosion radius",848,attribute=>moduleHoverPercent(attribute.value));
    if(/omnidirectional tracking link/.test(text)){pushCap();pushCycle();}
  }
  if(/drone link augmentor/.test(text))pushMatch("Drone control range",[/drone.*control.*range|drone.*range.*bonus/],attribute=>moduleHoverDistance(attribute.value));

  if(attr(77)||/miner|strip miner|ice harvester|gas cloud harvester|gas harvester/.test(text)){
    pushAttr("Yield / cycle",77,attribute=>`${moduleHoverNumber(attribute.value,2)} m\u00B3`);
    pushCycle();
    pushRange();
    pushCap();
  }
  if(/mining survey chipset/.test(text)){
    pushAttr("Critical chance",6049,attribute=>moduleHoverPercent(attribute.value));
    pushAttr("Critical yield",6050,attribute=>moduleHoverPercent(attribute.value));
    pushAttr("Residue probability",6053,attribute=>moduleHoverPercent(attribute.value));
  }

  if(/afterburner|microwarpdrive|micro warp drive|mwd/.test(text)){
    pushAttr("Speed bonus",20,attribute=>moduleHoverPercent(attribute.value));
    const prop=(analysis?.navigation?.activePropulsion??[]).find((row:any)=>Number(row?.typeId)===Number(item.typeId));
    if(prop?.maximumVelocity>0)push("Resulting max velocity",`${moduleHoverNumber(prop.maximumVelocity,0)} m/s`);
    pushCap();pushCycle();
    if(attr(554))pushAttr("Signature radius",554,attribute=>moduleHoverPercent(attribute.value));
    pushMultiplier("Capacitor capacity",147);
  }

  if(attr(72))pushAttr("Shield HP",72,attribute=>`+${moduleHoverNumber(attribute.value,0)} HP`);
  if(attr(983))pushAttr("Signature radius",983,attribute=>`+${moduleHoverNumber(attribute.value,0)} m`);
  if(attr(68)){
    const amount=consumeAttribute(attr(68)!);push(/remote.*shield/.test(text)?"Remote shield / cycle":"Shield boost / cycle",`${moduleHoverNumber(amount.value,1)} HP`);
    const duration=cycle();if(duration&&Number(duration.value)>0)push("Boost / second",`${moduleHoverNumber(Number(amount.value)/(Number(duration.value)/1000),1)} HP/s`);
    pushCycle();pushCap();if(/remote/.test(text)){pushRange();const falloff=attr(2044);if(falloff&&!consumedAttributeIds.has(2044)){consumeAttribute(falloff);push("Falloff",moduleHoverDistance(falloff.value));}}
  }
  const resistBonusIds:[[number,string],[number,string],[number,string],[number,string]]=[[984,"EM resist"],[987,"Thermal resist"],[986,"Kinetic resist"],[985,"Explosive resist"]];
  if(resistBonusIds.some(([id])=>Boolean(attr(id))))for(const [id,label] of resistBonusIds)pushAttr(label,id,attribute=>moduleHoverPercent(Math.abs(Number(attribute.value))));
  const resonanceLayer=(ids:number[],label:string)=>{const values=ids.map(id=>attr(id)).filter(Boolean) as ModuleHoverAttribute[];if(!values.length)return;values.forEach(consumeAttribute);const bonuses=values.map(attribute=>(1-Number(attribute.value))*100);const first=bonuses[0];if(bonuses.every(value=>Math.abs(value-first)<0.001))push(label,moduleHoverPercent(first));else values.forEach((attribute,index)=>push(`${label} ${["EM","Therm","Kin","Exp"][index]}`,moduleHoverPercent((1-Number(attribute.value))*100)));};
  resonanceLayer([271,274,273,272],"Shield resists");
  resonanceLayer([267,270,269,268],"Armor resists");
  resonanceLayer([974,977,976,975],"Hull resists");
  if(/reactive armor hardener/.test(text))push("Adaptive behaviour","Resists redistribute toward recent incoming damage",true);
  if(/hardener/.test(text)){pushCap();pushCycle();}
  // Passive shield/cap modules commonly expose time multipliers rather than human-readable percentages.
  pushMultiplier("Shield recharge time",134);
  if(attr(338)&&!consumedAttributeIds.has(338))pushAttr("Shield recharge time",338,attribute=>moduleHoverPercent(attribute.value));
  pushMultiplier("Shield HP",146);

  if(attr(1159))pushAttr("Armor HP",1159,attribute=>`+${moduleHoverNumber(attribute.value,0)} HP`);
  if(attr(84)){
    const amount=consumeAttribute(attr(84)!);push(/remote/.test(text)?"Remote armor / cycle":"Armor repair / cycle",`${moduleHoverNumber(amount.value,1)} HP`);
    const duration=cycle();if(duration&&Number(duration.value)>0)push("Repair / second",`${moduleHoverNumber(Number(amount.value)/(Number(duration.value)/1000),1)} HP/s`);
    pushCycle();pushCap();if(/remote/.test(text)){pushRange();const falloff=attr(2044);if(falloff&&!consumedAttributeIds.has(2044)){consumeAttribute(falloff);push("Falloff",moduleHoverDistance(falloff.value));}}
  }
  pushMultiplier("Hull HP",150);
  if(!consumedAttributeIds.has(150))pushMatch("Hull HP",[/structure.*hitpoint.*bonus|hull.*hitpoint.*bonus|structurehpbonus/],attribute=>moduleHoverStatValue(attribute));

  pushMultiplier("Cap recharge time",144);
  pushMultiplier("Capacitor amount",147);
  if(/cap battery/.test(text)){
    pushAttr("Capacitor bonus",67,attribute=>`+${moduleHoverNumber(attribute.value,0)} GJ`);
    pushAttr("Cap warfare resistance",2267,attribute=>moduleHoverPercent(Math.abs(Number(attribute.value))));
  }
  pushMultiplier("Powergrid output",145);
  pushMultiplier("CPU output",202);
  if(attr(549)&&!consumedAttributeIds.has(549))pushAttr("Powergrid bonus",549,attribute=>`+${moduleHoverNumber(attribute.value,1)} MW`);
  const injector=(analysis?.capacitor?.capacitorInjectors??[]).find((row:any)=>Number(row?.typeId)===Number(item.typeId));
  if(injector){
    push("Cap injected / charge",`${moduleHoverNumber(injector.injectionPerCycleGj,0)} GJ`);
    push("Sustained injection",`${moduleHoverNumber(injector.sustainedGjPerSecond,1)} GJ/s`);
    if(Number(injector.cycleSeconds)>0)push("Cycle",`${moduleHoverNumber(injector.cycleSeconds,2)} s`);
  }else if(/capacitor booster/.test(text)){pushCycle();const reload=attr(1795);if(reload){consumeAttribute(reload);push("Reload",moduleHoverSeconds(reload.value));}if(!item.charge)push("Cap injection","Depends on loaded booster charge",true);}

  if(/warp scrambler|warp disruptor/.test(text)){
    pushRange();pushAttr("Warp strength",105,attribute=>moduleHoverNumber(attribute.value,0));
    if(/warp scrambler/.test(text))push("MWD shutdown","Yes");
    pushCap();pushCycle();
  }
  if(/stasis webifier/.test(text)){pushAttr("Speed reduction",20,attribute=>`${moduleHoverNumber(Math.abs(Number(attribute.value)),1)}%`);pushRange();pushCap();pushCycle();}
  if(/target painter/.test(text)){pushMatch("Signature radius",[/signature radius (?:bonus|modifier)/],attribute=>moduleHoverPercent(attribute.value));pushRange();const falloff=attr(2044);if(falloff&&!consumedAttributeIds.has(2044)){consumeAttribute(falloff);push("Falloff",moduleHoverDistance(falloff.value));}pushCap();pushCycle();}
  if(/tracking disruptor|weapon disruptor/.test(text)){
    pushAttr("Turret optimal",351,attribute=>moduleHoverPercent(attribute.value));
    pushAttr("Turret falloff",349,attribute=>moduleHoverPercent(attribute.value));
    pushAttr("Turret tracking",767,attribute=>moduleHoverPercent(attribute.value));
    pushRange();const falloff=attr(2044);if(falloff&&!consumedAttributeIds.has(2044)){consumeAttribute(falloff);push("Falloff",moduleHoverDistance(falloff.value));}pushCap();pushCycle();
  }
  if(/sensor dampener/.test(text)){pushAttr("Targeting range",309,attribute=>moduleHoverPercent(attribute.value));pushAttr("Scan resolution",566,attribute=>moduleHoverPercent(attribute.value));pushRange();const falloff=attr(2044);if(falloff&&!consumedAttributeIds.has(2044)){consumeAttribute(falloff);push("Falloff",moduleHoverDistance(falloff.value));}pushCap();pushCycle();}
  if(/ecm|jammer/.test(text)){
    for(const attribute of moduleHoverAttributesMatch(typeInfo,/(gravimetric|ladar|magnetometric|radar).*(jam|ecm)|(?:jam|ecm).*(gravimetric|ladar|magnetometric|radar)/).slice(0,4)){consumeAttribute(attribute);push(attribute.name.replace(/strength.*$/i,"strength"),moduleHoverStatValue(attribute));}
    pushRange();const falloff=attr(2044)??attr(158);if(falloff&&!consumedAttributeIds.has(Number(falloff.attributeId))){consumeAttribute(falloff);push("Falloff",moduleHoverDistance(falloff.value));}pushCap();pushCycle();
  }

  if(/sensor booster|signal amplifier|eccm/.test(text)){
    pushAttr("Targeting range",309,attribute=>moduleHoverPercent(attribute.value));
    pushAttr("Scan resolution",566,attribute=>moduleHoverPercent(attribute.value));
    const sensorStrengths=[1027,1028,1029,1030].map(id=>attr(id)).filter(Boolean) as ModuleHoverAttribute[];
    if(sensorStrengths.length){sensorStrengths.forEach(consumeAttribute);const values=sensorStrengths.map(attribute=>Number(attribute.value));if(values.every(value=>Math.abs(value-values[0])<0.001))push("Sensor strength",moduleHoverPercent(values[0]));else sensorStrengths.forEach(attribute=>push(attribute.name,moduleHoverPercent(attribute.value)));}
    pushAttr("Locked targets",235,attribute=>`+${moduleHoverNumber(attribute.value,0)}`);
    pushCap();pushCycle();
  }

  if(/inertial stabilizer|nanofiber|overdrive|warp core stabilizer|hyperspatial/.test(text)){
    pushMatch("Inertia / agility",[/inertia.*modifier|agility.*(?:bonus|modifier)/],attribute=>attribute.unit==="%"?moduleHoverPercent(attribute.value):moduleHoverStatValue(attribute));
    if(!/drone navigation/.test(text))pushMatch("Velocity",[/maximum velocity (?:bonus|modifier)|velocity modifier|maxvelocitymodifier|implantbonusvelocity/],attribute=>attribute.unit==="%"?moduleHoverPercent(attribute.value):moduleHoverStatValue(attribute));
    pushMatch("Warp speed",[/warp speed.*(?:bonus|multiplier|increase)|warpspeed/],attribute=>attribute.unit==="%"?moduleHoverPercent(attribute.value):moduleHoverStatValue(attribute));
    if(/inertial stabilizer/.test(text))pushAttr("Signature radius",554,attribute=>moduleHoverPercent(attribute.value));
    if(/overdrive injector/.test(text))pushMultiplier("Cargo capacity",149);
    if(/warp core stabilizer/.test(text)){
      pushAttr("Warp core strength",105,attribute=>`+${moduleHoverNumber(Math.abs(Number(attribute.value)),0)}`);
      pushAttr("Targeting range",309,attribute=>moduleHoverPercent(attribute.value));
      pushAttr("Scan resolution",565,attribute=>moduleHoverPercent((Number(attribute.value)-1)*100));
      pushAttr("Drone bandwidth",3124,attribute=>moduleHoverPercent(attribute.value));
      pushCap();pushCycle();
      const delay=attr(669);if(delay&&!consumedAttributeIds.has(669)){consumeAttribute(delay);push("Reactivation delay",moduleHoverSeconds(delay.value));}
    }
  }
  if(/reinforced bulkhead/.test(text)){
    pushMultiplier("Hull HP",150);
    pushMultiplier("Cargo capacity",149);
    pushMatch("Inertia / agility",[/inertia.*modifier|agility.*(?:bonus|modifier)/],attribute=>attribute.unit==="%"?moduleHoverPercent(attribute.value):moduleHoverStatValue(attribute));
  }

  if(/remote.*armor/.test(text)&&!attr(84)){pushMatch("Repair / transfer",[/armor.*(?:repair|transfer).*amount/],attribute=>moduleHoverStatValue(attribute));pushRange();pushCycle();pushCap();}
  if(/remote.*shield/.test(text)&&!attr(68)){pushMatch("Repair / transfer",[/shield.*(?:repair|transfer).*amount/],attribute=>moduleHoverStatValue(attribute));pushRange();pushCycle();pushCap();}
  if(/remote.*capacitor|energy transfer|capacitor transmitter/.test(text)){pushMatch("Cap transferred",[/power transfer amount|capacitor.*transfer.*amount|energy.*transfer.*amount/],attribute=>`${moduleHoverNumber(attribute.value,1)} GJ`);pushRange();pushCycle();pushCap();}

  if(/energy neutralizer|energy nosferatu|nosferatu/.test(text)){
    if(attr(97))pushAttr(/nosferatu/.test(text)?"Energy drained":"Energy neutralized",97,attribute=>`${moduleHoverNumber(attribute.value,1)} GJ`);
    else pushMatch(/nosferatu/.test(text)?"Energy drained":"Energy neutralized",[/neutralization amount|energy.*(?:drain|transfer).*amount|power transfer amount/],attribute=>`${moduleHoverNumber(attribute.value,1)} GJ`);
    pushRange();const effectiveness=attr(2044);if(effectiveness){consumeAttribute(effectiveness);push("Falloff",moduleHoverDistance(effectiveness.value));}pushCycle();pushCap();
  }

  if(/smartbomb/.test(text)){
    const damage=moduleHoverAttributesMatch(typeInfo,/^(em|thermal|kinetic|explosive) damage /i,/^(em|thermal|kinetic|explosive) damage$/i).filter(attribute=>!/resist|bonus/i.test(moduleHoverAttributeText(attribute)));
    if(damage.length){damage.forEach(consumeAttribute);push("Damage / cycle",`${moduleHoverNumber(damage.reduce((sum,attribute)=>sum+Math.max(0,Number(attribute.value)),0),1)} HP`);}
    pushMatch("Radius",[/area of effect radius|smartbomb.*radius/],attribute=>moduleHoverDistance(attribute.value));pushCycle();pushCap();
  }
  if(/tractor beam/.test(text)){pushRange();pushMatch("Tractor velocity",[/tractor.*velocity/],attribute=>`${moduleHoverNumber(attribute.value,0)} m/s`);pushCap();pushCycle();}
  if(/salvager/.test(text)){pushCycle();pushMatch("Access / salvage bonus",[/access difficulty|salvag.*(?:chance|bonus)/],attribute=>attribute.unit==="%"?moduleHoverPercent(attribute.value):moduleHoverStatValue(attribute));pushRange();pushCap();}
  if(/cloak|cloaking device/.test(text)){
    const cloakSpeed=attr(306);if(cloakSpeed&&!consumedAttributeIds.has(306)){consumeAttribute(cloakSpeed);push("Cloaked speed",`${moduleHoverNumber(Number(cloakSpeed.value)*100,1)}% normal`);}
    const recalibration=attr(560);if(recalibration&&!consumedAttributeIds.has(560)){consumeAttribute(recalibration);push("Lock recalibration",moduleHoverSeconds(recalibration.value));}
    const reactivation=attr(669);if(reactivation&&!consumedAttributeIds.has(669)){consumeAttribute(reactivation);push("Reactivation delay",moduleHoverSeconds(reactivation.value));}
    push("Cloak type",/covert ops|covert.*cloak/.test(text)?"Covert Ops":"Standard cloak");
  }

  if(primary.length<6){
    const fallback=(typeInfo?.attributes??[])
      .filter(attribute=>![30,50,1153,1132,1547,128,56].includes(Number(attribute.attributeId)))
      .filter(attribute=>!consumedAttributeIds.has(Number(attribute.attributeId)))
      .filter(attribute=>!moduleHoverAttributeIsNeutral(attribute))
      .filter(attribute=>!MODULE_HOVER_FALLBACK_EXCLUDE.test(moduleHoverAttributeText(attribute)))
      .map(attribute=>({attribute,score:MODULE_HOVER_FALLBACK_PRIORITY.test(moduleHoverAttributeText(attribute))?2:0}))
      .filter(row=>row.score>0)
      .sort((a,b)=>b.score-a.score||String(a.attribute.category??"").localeCompare(String(b.attribute.category??""))||a.attribute.name.localeCompare(b.attribute.name));
    for(const {attribute} of fallback){if(primary.length>=8)break;const label=attribute.name.replace(/\s+/g," ").trim();if(!primary.some(row=>row.label.toLowerCase()===label.toLowerCase()))push(label,moduleHoverStatValue(attribute));}
  }
  if(!primary.length&&typeInfo?.description){const purpose=typeInfo.description.replace(/\s+/g," ").trim().split(/(?<=[.!?])\s/)[0]?.slice(0,150);if(purpose)push("Purpose",purpose,true);}

  for(const value of typeInfo?.fitting??[]){
    if(value.attributeId===50)pushFitting("CPU",moduleHoverValue(value.value,value.unit));
    else if(value.attributeId===30)pushFitting("Powergrid",moduleHoverValue(value.value,value.unit));
    else if(value.attributeId===1153)pushFitting("Calibration",moduleHoverValue(value.value,value.unit));
  }
  return {primary:primary.slice(0,8),fitting:fitting.slice(0,3)};
}
function ModuleHoverCard({ item, rack, currentState, analysis, typeInfo, anchor }: { item:FitItem; rack?:FitModuleRack; currentState?:ModuleState; analysis:any; typeInfo:FittingTypeInfo|null; anchor:DOMRect }) {
  const content=useMemo(()=>buildModuleHoverStats(item,rack,analysis,typeInfo),[item,rack,analysis,typeInfo]);
  const width=320;
  const roomRight=anchor.right+12+width<=window.innerWidth-8;
  const left=roomRight?anchor.right+10:Math.max(8,anchor.left-width-10);
  const top=Math.max(8,Math.min(anchor.top-8,window.innerHeight-410));
  const stateLabel=currentState==="overheated"?"OVERHEAT":currentState==="offline"?"OFF":currentState==="active"?"ON":currentState==="online"?"ONLINE":"";
  const categoryLabel=typeInfo?.group?.name??typeInfo?.marketGroup?.name??typeInfo?.category?.name??"Module";
  return createPortal(
    <aside className="fit-module-hover-card" style={{left,top,width}} role="tooltip" aria-hidden="true">
      <header className="fit-module-hover-head">
        <span className="fit-module-hover-icon">{item.typeId?<img src={imageUrl(item.typeId,"icon",64)} />:<b>?</b>}</span>
        <span className="fit-module-hover-title"><strong>{item.name}</strong>{item.mutation?<em>Abyssal module</em>:<em>{categoryLabel}</em>}</span>
        {currentState&&<i className={`fit-module-hover-state state-${currentState}`}>{stateLabel}</i>}
      </header>
      {item.charge&&<div className="fit-module-hover-charge">{item.chargeTypeId?<img src={imageUrl(item.chargeTypeId,"icon",32)} />:null}<span><small>Loaded charge / script / crystal</small><strong>{item.charge}</strong></span></div>}
      {content.primary.length>0?<div className="fit-module-hover-stats primary">{content.primary.map(stat=><span className={stat.wide?"wide":""} key={stat.label}><small>{stat.label}</small><strong>{stat.value}</strong></span>)}</div>:<div className="fit-module-hover-loading">{typeInfo?"No compact effect stats are published for this type.":"Loading module stats..."}</div>}
      {content.fitting.length>0&&<div className="fit-module-hover-fitting"><small>Fitting cost</small><div>{content.fitting.map(stat=><span key={stat.label}><em>{stat.label}</em><strong>{stat.value}</strong></span>)}</div></div>}
      <footer><span>{categoryLabel}</span><span>Right-click for full Show Info</span></footer>
    </aside>,
    document.body,
  );
}
function SlotRack({ title, side, items, limit, onStateChange, onRemove, onDropItem, onLoadCharge, onShowInfo, analysis }: { title:string; side:FitModuleRack; items:FitItem[]; limit:number; onStateChange(rack:FitModuleRack,index:number,state:ModuleState):void; onRemove(target:BuilderTarget,index:number):void; onDropItem(target:BuilderTarget,item:FittingSearchResult):Promise<boolean>; onLoadCharge(target:FitModuleRack,index:number,item:FittingSearchResult):Promise<boolean>; onShowInfo(typeId:number,name?:string):void; analysis:any }) {
  const states:ModuleState[]=side==="rig"||side==="subsystem"?["online"]:["offline","online","active","overheated"];
  const count=Math.max(items.length,Math.max(0,Math.floor(limit||0)));
  const allowDrag=(event:DragEvent<HTMLElement>)=>{if(event.dataTransfer.types.includes(FITTING_DRAG_MIME)){event.preventDefault();event.dataTransfer.dropEffect="copy";}};
  return <div className={"slot-rack "+side} onDragOver={allowDrag}><span>{title}<small>{items.length} / {limit || count}</small></span><div>{Array.from({length:count},(_,index)=>{const item=items[index];return item?<FittedSlotTile item={item} rack={side} analysis={analysis} states={states} onStateChange={state=>onStateChange(side,index,state)} onRemove={()=>onRemove(side,index)} onChargeDrop={charge=>onLoadCharge(side,index,charge)} onShowInfo={onShowInfo} key={(item.name)+"-"+index}/>:<div className="fit-item fitted-slot-empty fit-empty-slot" key={"empty-"+side+"-"+index} title={"Drop a "+side+" module here"} onDragOver={allowDrag} onDrop={(event)=>{event.preventDefault();const dragged=readFittingDrag(event);if(dragged)void onDropItem(side,dragged);}}><b>+</b><span>Drop / Empty</span></div>;})}</div></div>;
}
function FittedSlotTile({
  item,
  rack,
  analysis,
  states,
  onStateChange,
  onRemove,
  onChargeDrop,
  onShowInfo,
}: {
  item: FitItem;
  rack: FitModuleRack;
  analysis: any;
  states: ModuleState[];
  onStateChange(state: ModuleState): void;
  onRemove(): void;
  onChargeDrop(item:FittingSearchResult): Promise<boolean>;
  onShowInfo(typeId:number,name?:string):void;
}) {
  const [capabilities,setCapabilities]=useState<ModuleStateCapabilities|null>(null);
  const [hoverAnchor,setHoverAnchor]=useState<DOMRect|null>(null);
  const [typeInfo,setTypeInfo]=useState<FittingTypeInfo|null>(null);
  useEffect(()=>{
    if(!item.typeId||!states.includes("active")){setCapabilities(null);return;}
    let cancelled=false;
    void getModuleStateCapabilities(item.typeId).then((value)=>{if(!cancelled)setCapabilities(value);});
    return()=>{cancelled=true;};
  },[item.typeId,states.includes("active")]);
  useEffect(()=>{setTypeInfo(null);},[item.typeId]);
  useEffect(()=>{
    if(!hoverAnchor||!item.typeId)return;
    let cancelled=false;
    void getFittingTypeInfoCached(item.typeId).then((value)=>{if(!cancelled)setTypeInfo(value);}).catch(()=>undefined);
    return()=>{cancelled=true;};
  },[hoverAnchor!==null,item.typeId]);
  const allowedStates:ModuleState[]=states.includes("active")&&capabilities
    ? ["offline","online",...(capabilities.canActivate?["active" as ModuleState]:[]),...(capabilities.canOverheat?["overheated" as ModuleState]:[])]
    : states;
  const defaultState: ModuleState = capabilities ? (capabilities.canActivate ? "active" : "online") : (states.includes("active") ? "active" : "online");
  const currentState=allowedStates.includes(item.state??defaultState)?(item.state??defaultState):defaultState;
  const controlOnState:ModuleState=capabilities?.canActivate?"active":"online";
  const controlState:ModuleState=currentState==="offline"?"offline":currentState==="overheated"?"overheated":controlOnState;
  const stateLights:Array<{state:ModuleState;className:string;title:string}>=capabilities&&states.includes("offline")?[
    {state:controlOnState,className:"fit-module-state-light-on",title:"ON"},
    ...(capabilities.canOverheat?[{state:"overheated" as ModuleState,className:"fit-module-state-light-overheat",title:"OVERHEAT"}]:[]),
    {state:"offline",className:"fit-module-state-light-off",title:"OFF"},
  ]:[];
  useEffect(()=>{if(item.state&&!allowedStates.includes(item.state))onStateChange(defaultState);},[item.state,defaultState,allowedStates.join("|")]);
  const allowCharge=(event:DragEvent<HTMLElement>)=>{if(event.dataTransfer.types.includes(FITTING_DRAG_MIME)){event.preventDefault();event.dataTransfer.dropEffect="copy";}};
  return (
    <div
      className={`fit-item fitted-slot-tile state-${currentState}`}
      onMouseEnter={(event)=>setHoverAnchor(event.currentTarget.getBoundingClientRect())}
      onMouseLeave={()=>setHoverAnchor(null)}
      onDragOver={allowCharge}
      onContextMenu={(event)=>{if(!item.typeId)return;event.preventDefault();onShowInfo(item.typeId,item.name);}}
      onDrop={(event)=>{event.preventDefault();const dragged=readFittingDrag(event);if(dragged)void onChargeDrop(dragged);}}
    >
      {item.typeId ? <img src={imageUrl(item.typeId, "icon", 64)} /> : <b>?</b>}
      {item.charge && <span className="fitted-slot-charge-indicator" aria-label={`Loaded charge ${item.charge}`} />}
      {item.quantity > 1 && <em>{item.quantity}</em>}{item.mutation && <i className="abyssal-badge" title={item.mutation.mutaplasmidName}>A</i>}
      <span className="fit-item-copy"><strong className="fit-module-name">{item.name}</strong><small className="fit-loaded-charge" onContextMenu={(event)=>{if(!item.chargeTypeId)return;event.preventDefault();event.stopPropagation();onShowInfo(item.chargeTypeId,item.charge);}}>{item.charge ?? "\u00a0"}</small></span>
      <button type="button" className="fit-item-remove" aria-label={`Remove ${item.name}`} onClick={onRemove}>X</button>
      {stateLights.length > 0 && <div className="fit-module-state-lights" role="group" aria-label={`${item.name} module state`}>
        {stateLights.map((light)=><button
          type="button"
          className={`fit-module-state-light ${light.className}${light.state===controlState?" active":""}`}
          aria-pressed={light.state===controlState}
          aria-label={`${item.name}: ${light.title}`}
          title={light.title}
          key={light.state}
          onClick={(event)=>{event.stopPropagation();onStateChange(light.state);}}
        />)}
      </div>}
      {hoverAnchor&&<ModuleHoverCard item={item} rack={rack} currentState={currentState} analysis={analysis} typeInfo={typeInfo} anchor={hoverAnchor} />}
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
