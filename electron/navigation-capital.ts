import AdmZip from "adm-zip";
import path from "node:path";
import { STATIC_DATA_ROOT } from "./data-paths";
import { ensureStaticDataArchive } from "./type-volumes";
import { getNavigationStaticMetadata } from "./navigation-static-metadata";
import { getNavigationRouteIntelligence, type NavigationRouteIntelligence } from "./navigation-route-intelligence";
import {
  calculateNavigationRoute,
  displayedSecurityStatus,
  getNavigationMapData,
  getNavigationSystem,
  type NavigationRouteEdge,
  type NavigationSystemNode,
} from "./universe-route-graph";

const SDE_ARCHIVE = path.join(STATIC_DATA_ROOT, "eve-static-data-jsonl.zip");
const JUMP_DRIVE_CALIBRATION_TYPE_ID = 21611;
const JUMP_FUEL_CONSERVATION_TYPE_ID = 21610;
const LIGHT_YEAR_METERS = 9.4607304725808e15;
const SPATIAL_CELL_LY = 2;
const FATIGUE_CAP_MINUTES = 5 * 60;
const ACTIVATION_CAP_MINUTES = 30;

export type NavigationCapitalHull = {
  typeId: number;
  name: string;
  groupId: number;
  groupName: string;
  baseRangeLy: number;
  fuelTypeId?: number;
  fuelTypeName?: string;
  fuelPerLy?: number;
  fatigueMultiplier: number;
  jumpFreighter: boolean;
};

export type NavigationCapitalContext = {
  characterId: string;
  characterName: string;
  jumpDriveCalibrationLevel: number;
  jumpFuelConservationLevel: number;
  currentShipTypeId?: number;
  currentShipName?: string;
  hulls: NavigationCapitalHull[];
  formula: string;
  fuelFormula: string;
  fatigueFormula: string;
  source: string;
};

export type NavigationCapitalFatigueLeg = {
  effectiveFatigueDistanceLy: number;
  fatigueBeforeMinutes: number;
  activationCooldownMinutes: number;
  fatigueAfterJumpMinutes: number;
  fatigueAfterCooldownMinutes: number;
};

export type NavigationCapitalLeg = {
  from: number;
  to: number;
  fromName: string;
  toName: string;
  distanceLy: number;
  type: "jump-drive";
  fuelUnits: number;
  fatigue: NavigationCapitalFatigueLeg;
};

export type NavigationMidpointQuality = {
  systemId: number;
  name: string;
  npcStations: number;
  knownStructures: number;
  kills2h: number;
  jumps: number;
  gateDanger: string;
  score: number;
  reasons: string[];
};

export type NavigationCapitalCandidate = {
  candidateId: string;
  label: string;
  systems: NavigationSystemNode[];
  legs: NavigationCapitalLeg[];
  jumps: number;
  totalDistanceLy: number;
  totalFuelUnits: number;
  fuelTypeId?: number;
  fuelTypeName?: string;
  finalFatigueMinutes: number;
  totalActivationWaitMinutes: number;
  midpointQuality: NavigationMidpointQuality[];
  qualityScore: number;
};

export type NavigationJumpFreighterTransition = {
  lowSecSystem: NavigationSystemNode;
  highSecSystem: NavigationSystemNode;
  capitalCandidate: NavigationCapitalCandidate;
  gateRoute: {
    systems: NavigationSystemNode[];
    legs: NavigationRouteEdge[];
    jumps: number;
    transitionDanger: string;
    transitionDangerScore: number;
  };
  totalTravelLegs: number;
};

export type NavigationCapitalPlan = {
  found: boolean;
  reason?: string;
  characterId: string;
  characterName: string;
  ship: NavigationCapitalHull;
  jumpDriveCalibrationLevel: number;
  jumpFuelConservationLevel: number;
  effectiveRangeLy: number;
  origin: NavigationSystemNode | null;
  destination: NavigationSystemNode | null;
  systems: NavigationSystemNode[];
  legs: NavigationCapitalLeg[];
  jumps: number;
  totalDistanceLy: number;
  totalFuelUnits: number;
  fuelTypeId?: number;
  fuelTypeName?: string;
  finalFatigueMinutes: number;
  totalActivationWaitMinutes: number;
  reachableFromOriginCount: number;
  reachableFromOrigin: Array<{ systemId: number; name: string; regionName: string; securityStatus: number; distanceLy: number; distanceToDestinationLy: number }>;
  candidateMidpoints: Array<{ systemId: number; name: string; regionName: string; securityStatus: number }>;
  alternatives: NavigationCapitalCandidate[];
  jumpFreighterTransitions: NavigationJumpFreighterTransition[];
  formula: string;
  fuelFormula: string;
  fatigueFormula: string;
};

type CapitalIndex = { hulls: NavigationCapitalHull[]; byTypeId: Map<number, NavigationCapitalHull> };
type SpatialIndex = Map<string, NavigationSystemNode[]>;
type SearchOptions = { bannedSystemIds?: Set<number>; preferDockable?: boolean; minimiseDistance?: boolean };
type RawPath = { systems: NavigationSystemNode[]; distances: number[] };
let capitalIndexPromise: Promise<CapitalIndex> | null = null;

function english(value: any) { return typeof value === "string" ? value : String(value?.en ?? ""); }
function clampSkill(value: unknown) { return Math.max(0, Math.min(5, Number(value) || 0)); }
function round3(value: number) { return Math.round(value * 1000) / 1000; }
function displaySec(value: number) { return displayedSecurityStatus(value); }

async function getCapitalIndex(): Promise<CapitalIndex> {
  if (capitalIndexPromise) return capitalIndexPromise;
  capitalIndexPromise = (async () => {
    await ensureStaticDataArchive();
    const zip = new AdmZip(SDE_ARCHIVE);
    const typesEntry = zip.getEntry("types.jsonl");
    const groupsEntry = zip.getEntry("groups.jsonl");
    const dogmaEntry = zip.getEntry("typeDogma.jsonl");
    if (!typesEntry || !groupsEntry || !dogmaEntry) throw new Error("Official EVE static data is missing jump-drive ship data.");

    const groupNames = new Map<number, string>();
    const shipGroups = new Set<number>();
    for (const line of groupsEntry.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const row = JSON.parse(line) as { _key: number; name?: any; categoryID?: number };
      groupNames.set(Number(row._key), english(row.name) || `Group ${row._key}`);
      if (Number(row.categoryID) === 6) shipGroups.add(Number(row._key));
    }

    const typeNames = new Map<number, string>();
    const publishedShips = new Map<number, { name: string; groupId: number }>();
    for (const line of typesEntry.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const row = JSON.parse(line) as { _key: number; name?: any; groupID?: number; published?: boolean };
      const typeId = Number(row._key); const name = english(row.name);
      if (name) typeNames.set(typeId, name);
      const groupId = Number(row.groupID ?? 0);
      if (row.published === true && shipGroups.has(groupId) && name) publishedShips.set(typeId, { name, groupId });
    }

    const hulls: NavigationCapitalHull[] = [];
    for (const line of dogmaEntry.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const row = JSON.parse(line) as { _key: number; dogmaAttributes?: Array<{ attributeID: number; value: number }> };
      const type = publishedShips.get(Number(row._key));
      if (!type) continue;
      const attrs = new Map((row.dogmaAttributes ?? []).map((attribute) => [Number(attribute.attributeID), Number(attribute.value)]));
      if (attrs.get(861) !== 1 || Number(attrs.get(867) ?? 0) <= 0 || Number(attrs.get(2453) ?? 0) > 0) continue;
      const fuelTypeId = Number(attrs.get(866) ?? 0) || undefined;
      const groupName = groupNames.get(type.groupId) ?? `Group ${type.groupId}`;
      hulls.push({
        typeId: Number(row._key), name: type.name, groupId: type.groupId, groupName,
        baseRangeLy: Number(attrs.get(867)), fuelTypeId, fuelTypeName: fuelTypeId ? typeNames.get(fuelTypeId) : undefined,
        fuelPerLy: Number(attrs.get(868) ?? 0) || undefined,
        fatigueMultiplier: Math.max(0, Number(attrs.get(1971) ?? 1) || 1),
        jumpFreighter: /jump freighter/i.test(groupName),
      });
    }
    hulls.sort((a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name));
    return { hulls, byTypeId: new Map(hulls.map((hull) => [hull.typeId, hull])) };
  })();
  return capitalIndexPromise;
}

function findSnapshot(characterId: string, snapshots: any[]) { return snapshots.find((snapshot) => String(snapshot?.characterId ?? "") === String(characterId)); }
function skillLevel(snapshot: any, typeId: number) {
  const skill = (snapshot?.skills?.skills ?? []).find((row: any) => Number(row?.skill_id) === typeId);
  return clampSkill(skill?.active_skill_level ?? skill?.trained_skill_level ?? 0);
}

export async function getNavigationCapitalContext(characterId: string, snapshots: any[]): Promise<NavigationCapitalContext> {
  const snapshot = findSnapshot(characterId, snapshots);
  if (!snapshot) throw new Error("Choose a connected character with a local Sage snapshot.");
  const index = await getCapitalIndex();
  return {
    characterId: String(snapshot.characterId), characterName: String(snapshot?.character?.name ?? snapshot.characterId),
    jumpDriveCalibrationLevel: skillLevel(snapshot, JUMP_DRIVE_CALIBRATION_TYPE_ID),
    jumpFuelConservationLevel: skillLevel(snapshot, JUMP_FUEL_CONSERVATION_TYPE_ID),
    currentShipTypeId: Number(snapshot?.ship?.ship_type_id ?? 0) || undefined,
    currentShipName: snapshot?.ship?.ship_type_name ? String(snapshot.ship.ship_type_name) : undefined,
    hulls: index.hulls,
    formula: "effective range = hull base range × (1 + 0.20 × Jump Drive Calibration level)",
    fuelFormula: "fuel units per leg = ceil(SDE fuel/LY × distance LY × (1 - 0.10 × Jump Fuel Conservation level))",
    fatigueFormula: "fatigue uses SDE jump-fatigue distance multiplier; activation cooldown is at least 1 + effective LY, capped at 30m; fatigue is capped at 5h",
    source: "CCP SDE typeDogma + connected Sage character skills",
  };
}

export function navigationEffectiveJumpRange(ship: NavigationCapitalHull, jumpDriveCalibrationLevel: number) { return ship.baseRangeLy * (1 + 0.20 * clampSkill(jumpDriveCalibrationLevel)); }

function distanceLy(a: NavigationSystemNode, b: NavigationSystemNode) { return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z) / LIGHT_YEAR_METERS; }
function capitalDestinationEligible(system: NavigationSystemNode) { return system.systemId >= 30_000_000 && system.systemId < 31_000_000 && displaySec(system.securityStatus) < 0.5; }
function cellCoordinate(valueMeters: number) { return Math.floor((valueMeters / LIGHT_YEAR_METERS) / SPATIAL_CELL_LY); }
function cellKey(x: number, y: number, z: number) { return `${x}:${y}:${z}`; }
function makeSpatialIndex(systems: NavigationSystemNode[]): SpatialIndex {
  const cells: SpatialIndex = new Map();
  for (const system of systems) { const key = cellKey(cellCoordinate(system.position.x), cellCoordinate(system.position.y), cellCoordinate(system.position.z)); const bucket = cells.get(key) ?? []; bucket.push(system); cells.set(key, bucket); }
  return cells;
}
function systemsInRange(origin: NavigationSystemNode, rangeLy: number, cells: SpatialIndex) {
  const cx = cellCoordinate(origin.position.x), cy = cellCoordinate(origin.position.y), cz = cellCoordinate(origin.position.z), radius = Math.ceil(rangeLy / SPATIAL_CELL_LY);
  const rows: Array<{ system: NavigationSystemNode; distanceLy: number }> = [];
  for (let x=cx-radius;x<=cx+radius;x++) for(let y=cy-radius;y<=cy+radius;y++) for(let z=cz-radius;z<=cz+radius;z++) for(const system of cells.get(cellKey(x,y,z)) ?? []) {
    if (system.systemId === origin.systemId) continue; const distance = distanceLy(origin, system); if (distance <= rangeLy + 1e-9) rows.push({ system, distanceLy: distance });
  }
  return rows;
}

class MinHeap {
  private data: Array<{ id: number; score: number; cost: number }> = [];
  get size(){return this.data.length;}
  push(value:{id:number;score:number;cost:number}){this.data.push(value);let i=this.data.length-1;while(i>0){const p=(i-1)>>1;if(this.data[p].score<=value.score)break;this.data[i]=this.data[p];i=p;}this.data[i]=value;}
  pop(){if(!this.data.length)return undefined;const root=this.data[0],last=this.data.pop()!;if(this.data.length){let i=0;while(true){let c=i*2+1;if(c>=this.data.length)break;if(c+1<this.data.length&&this.data[c+1].score<this.data[c].score)c++;if(this.data[c].score>=last.score)break;this.data[i]=this.data[c];i=c;}this.data[i]=last;}return root;}
}

async function findCapitalPath(origin: NavigationSystemNode, destination: NavigationSystemNode, rangeLy: number, eligible: NavigationSystemNode[], cells: SpatialIndex, options: SearchOptions = {}): Promise<RawPath | null> {
  const banned = options.bannedSystemIds ?? new Set<number>();
  const staticMetadata = options.preferDockable ? await getNavigationStaticMetadata() : null;
  const byId = new Map(eligible.map((system)=>[system.systemId,system])); byId.set(origin.systemId,origin); byId.set(destination.systemId,destination);
  const g = new Map<number,number>([[origin.systemId,0]]), previous = new Map<number,{from:number;distanceLy:number}>(); const open=new MinHeap();
  open.push({id:origin.systemId,cost:0,score:distanceLy(origin,destination)/rangeLy}); const closed=new Set<number>();
  while(open.size){const current=open.pop();if(!current||closed.has(current.id))continue;closed.add(current.id);if(current.id===destination.systemId)break;const node=current.id===origin.systemId?origin:byId.get(current.id);if(!node)continue;
    for(const neighbour of systemsInRange(node,rangeLy,cells)){const next=neighbour.system;if(next.systemId!==destination.systemId&&banned.has(next.systemId))continue;
      let step=1; if(options.minimiseDistance) step=0.35+neighbour.distanceLy/rangeLy; if(options.preferDockable){const stations=staticMetadata?.npcStationCountBySystem.get(next.systemId)??0;if(stations>0)step-=0.12;step+=Math.max(0,0.1-displaySec(next.securityStatus))*0.03;}
      const tentative=(g.get(current.id)??Infinity)+Math.max(0.05,step);if(tentative>=(g.get(next.systemId)??Infinity))continue;g.set(next.systemId,tentative);previous.set(next.systemId,{from:current.id,distanceLy:neighbour.distanceLy});const heuristic=distanceLy(next,destination)/rangeLy;open.push({id:next.systemId,cost:tentative,score:tentative+heuristic});
    }
  }
  if(!g.has(destination.systemId))return null;const ids=[destination.systemId],distances:number[]=[];while(ids[0]!==origin.systemId){const p=previous.get(ids[0]);if(!p)return null;ids.unshift(p.from);distances.unshift(p.distanceLy);}const systems=ids.map(id=>id===origin.systemId?origin:byId.get(id)).filter((s):s is NavigationSystemNode=>Boolean(s));return {systems,distances};
}

export function navigationFuelForLeg(ship: NavigationCapitalHull, distance: number, jfcLevel: number) { if(!ship.fuelPerLy)return 0;return Math.max(0,Math.ceil(ship.fuelPerLy*distance*(1-0.10*jfcLevel))); }

export function simulateJumpFatigue(distancesLy: number[], fatigueMultiplier: number, startingFatigueMinutes = 0): NavigationCapitalFatigueLeg[] {
  let fatigue=Math.max(0,startingFatigueMinutes); const rows:NavigationCapitalFatigueLeg[]=[];
  for(const distance of distancesLy){const effective=Math.max(0,distance*fatigueMultiplier);const before=fatigue;const minimumCooldown=1+effective;const cooldown=Math.min(ACTIVATION_CAP_MINUTES,Math.max(minimumCooldown,before/10));const post=Math.min(FATIGUE_CAP_MINUTES,before<10?10*(1+effective):before*(1+effective));const afterWait=Math.max(0,post-cooldown);rows.push({effectiveFatigueDistanceLy:effective,fatigueBeforeMinutes:before,activationCooldownMinutes:cooldown,fatigueAfterJumpMinutes:post,fatigueAfterCooldownMinutes:afterWait});fatigue=afterWait;}
  return rows;
}

function rawCandidate(id:string,label:string,path:RawPath,ship:NavigationCapitalHull,jfcLevel:number,startingFatigueMinutes:number):NavigationCapitalCandidate{
  const fatigue=simulateJumpFatigue(path.distances,ship.fatigueMultiplier,startingFatigueMinutes);const legs=path.systems.slice(1).map((system,index)=>({from:path.systems[index].systemId,to:system.systemId,fromName:path.systems[index].name,toName:system.name,distanceLy:path.distances[index],type:"jump-drive" as const,fuelUnits:navigationFuelForLeg(ship,path.distances[index],jfcLevel),fatigue:fatigue[index]}));
  return {candidateId:id,label,systems:path.systems,legs,jumps:legs.length,totalDistanceLy:legs.reduce((s,l)=>s+l.distanceLy,0),totalFuelUnits:legs.reduce((s,l)=>s+l.fuelUnits,0),fuelTypeId:ship.fuelTypeId,fuelTypeName:ship.fuelTypeName,finalFatigueMinutes:legs.at(-1)?.fatigue.fatigueAfterJumpMinutes??startingFatigueMinutes,totalActivationWaitMinutes:legs.reduce((s,l)=>s+l.fatigue.activationCooldownMinutes,0),midpointQuality:[],qualityScore:0};
}

function dangerPenalty(label:string){return label==="Active camp"?35:label==="Camp likely"?25:label==="Dangerous"?15:label==="Activity"?6:0;}
async function decorateCandidates(candidates:NavigationCapitalCandidate[],includeLiveIntelligence:boolean,snapshots:any[]){
  const metadata=await getNavigationStaticMetadata(); let intel:NavigationRouteIntelligence|null=null;
  if(includeLiveIntelligence){const ids=[...new Set(candidates.flatMap(c=>c.systems.map(s=>s.systemId)))];try{intel=await getNavigationRouteIntelligence({systemIds:ids},snapshots);}catch{intel=null;}}
  const intelById=new Map((intel?.systems??[]).map(row=>[Number(row.system?.system?.systemId??0),row]));
  for(const candidate of candidates){candidate.midpointQuality=candidate.systems.slice(1,-1).map(system=>{const row=intelById.get(system.systemId);const stations=metadata.npcStationCountBySystem.get(system.systemId)??0;const structures=Number(row?.infrastructure.knownStructures??0);const kills2h=Number(row?.killWindows["2h"].kills??0);const jumps=Number(row?.activity.jumps??0);const gateDanger=row?.routeGate?.danger.label??(includeLiveIntelligence?"Unavailable":"Not requested");let score=50+Math.min(20,stations*12)+Math.min(15,structures*8)-Math.min(30,kills2h*5)-dangerPenalty(gateDanger);const reasons:string[]=[];if(stations)reasons.push(`${stations} NPC station${stations===1?"":"s"}`);if(structures)reasons.push(`${structures} known structure${structures===1?"":"s"}`);if(kills2h)reasons.push(`${kills2h} kills / 2h`);if(gateDanger!=="Clear")reasons.push(gateDanger);if(!reasons.length)reasons.push("No extra infrastructure or danger evidence cached");return {systemId:system.systemId,name:system.name,npcStations:stations,knownStructures:structures,kills2h,jumps,gateDanger,score:Math.max(0,Math.min(100,Math.round(score))),reasons};});const avg=candidate.midpointQuality.length?candidate.midpointQuality.reduce((s,r)=>s+r.score,0)/candidate.midpointQuality.length:70;candidate.qualityScore=Math.round(Math.max(0,Math.min(100,avg-candidate.jumps*1.5-Math.log10(Math.max(1,candidate.totalFuelUnits))*0.5)));}
  candidates.sort((a,b)=>b.qualityScore-a.qualityScore||a.jumps-b.jumps||a.totalFuelUnits-b.totalFuelUnits);
}

async function buildAlternatives(origin:NavigationSystemNode,destination:NavigationSystemNode,rangeLy:number,eligible:NavigationSystemNode[],cells:SpatialIndex,ship:NavigationCapitalHull,jfcLevel:number,startingFatigueMinutes:number,includeLiveIntelligence:boolean,snapshots:any[]){
  const candidates:NavigationCapitalCandidate[]=[];const seen=new Set<string>();const add=(label:string,path:RawPath|null)=>{if(!path)return;const key=path.systems.map(s=>s.systemId).join(">");if(seen.has(key))return;seen.add(key);candidates.push(rawCandidate(`capital-${candidates.length+1}`,label,path,ship,jfcLevel,startingFatigueMinutes));};
  const shortest=await findCapitalPath(origin,destination,rangeLy,eligible,cells);add("Fewest jumps",shortest);add("Fuel efficient",await findCapitalPath(origin,destination,rangeLy,eligible,cells,{minimiseDistance:true}));add("Docking preferred",await findCapitalPath(origin,destination,rangeLy,eligible,cells,{preferDockable:true}));
  for(const midpoint of shortest?.systems.slice(1,-1).slice(0,4)??[]) add(`Alternate via different midpoint`,await findCapitalPath(origin,destination,rangeLy,eligible,cells,{bannedSystemIds:new Set([midpoint.systemId])}));
  await decorateCandidates(candidates,includeLiveIntelligence,snapshots);return candidates.slice(0,6);
}

function routeGateDanger(intel:NavigationRouteIntelligence|null,systemId:number){
  if(!intel)return {label:"Not requested",score:0};
  const row=intel.systems.find(r=>Number(r.system?.system?.systemId??0)===systemId);
  if(!row)return {label:"Unavailable",score:0};
  if(!row.routeGate)return {label:"Unclassified",score:0};
  return {label:row.routeGate.danger.label,score:Number(row.routeGate.danger.score??0)};
}

async function buildJumpFreighterTransitions(origin:NavigationSystemNode,destination:NavigationSystemNode,rangeLy:number,eligible:NavigationSystemNode[],cells:SpatialIndex,ship:NavigationCapitalHull,jfcLevel:number,startingFatigueMinutes:number,includeLiveIntelligence:boolean,snapshots:any[]):Promise<NavigationJumpFreighterTransition[]>{
  if(!ship.jumpFreighter)return[];
  const originHigh=displaySec(origin.securityStatus)>=0.5,destinationHigh=displaySec(destination.securityStatus)>=0.5;
  if(!originHigh&&!destinationHigh)return[];
  const map=await getNavigationMapData({scope:"universe"});
  const byId=new Map(map.systems.map(s=>[s.systemId,s]));
  const pairs:Array<{low:NavigationSystemNode;high:NavigationSystemNode}>=[];const seen=new Set<string>();
  for(const edge of map.edges){
    const a=byId.get(edge.from),b=byId.get(edge.to);if(!a||!b)continue;
    const ah=displaySec(a.securityStatus)>=0.5,bh=displaySec(b.securityStatus)>=0.5;if(ah===bh)continue;
    const low=ah?b:a,high=ah?a:b;const key=`${low.systemId}:${high.systemId}`;
    if(!seen.has(key)){seen.add(key);pairs.push({low,high});}
  }
  const relevant=pairs.sort((a,b)=>distanceLy(destinationHigh?a.high:a.low,destination)-distanceLy(destinationHigh?b.high:b.low,destination)).slice(0,32);
  const rows:NavigationJumpFreighterTransition[]=[];
  for(const pair of relevant){
    let capPath:RawPath|null=null;
    let gateSystems:NavigationSystemNode[]=[];
    let gateLegs:NavigationRouteEdge[]=[];
    let transitionOriginId=pair.low.systemId;
    if(destinationHigh){
      capPath=await findCapitalPath(origin,pair.low,rangeLy,eligible,cells);if(!capPath)continue;
      const transition=await calculateNavigationRoute({from:pair.low.systemId,to:pair.high.systemId,mode:"shortest"});
      const highRoute=await calculateNavigationRoute({from:pair.high.systemId,to:destination.systemId,mode:"high-sec",minSecurity:0.5});
      if(!transition.found||!highRoute.found)continue;
      gateSystems=[pair.low,...highRoute.systems];gateLegs=[...transition.legs,...highRoute.legs];transitionOriginId=pair.low.systemId;
    }else{
      const highRoute=await calculateNavigationRoute({from:origin.systemId,to:pair.high.systemId,mode:"high-sec",minSecurity:0.5});
      const transition=await calculateNavigationRoute({from:pair.high.systemId,to:pair.low.systemId,mode:"shortest"});
      if(!highRoute.found||!transition.found)continue;
      capPath=await findCapitalPath(pair.low,destination,rangeLy,eligible,cells);if(!capPath)continue;
      gateSystems=[...highRoute.systems,pair.low];gateLegs=[...highRoute.legs,...transition.legs];transitionOriginId=pair.high.systemId;
    }
    const candidate=rawCandidate(`jf-${rows.length+1}`,destinationHigh?"Low-sec entry + high-sec gates":"High-sec gates + low-sec jump chain",capPath,ship,jfcLevel,startingFatigueMinutes);
    let intel:NavigationRouteIntelligence|null=null;
    if(includeLiveIntelligence){try{intel=await getNavigationRouteIntelligence({systemIds:gateSystems.map(s=>s.systemId),legs:gateLegs},snapshots);}catch{intel=null;}}
    const danger=routeGateDanger(intel,transitionOriginId);
    rows.push({lowSecSystem:pair.low,highSecSystem:pair.high,capitalCandidate:candidate,gateRoute:{systems:gateSystems,legs:gateLegs,jumps:gateLegs.length,transitionDanger:danger.label,transitionDangerScore:danger.score},totalTravelLegs:candidate.jumps+gateLegs.length});
  }
  rows.sort((a,b)=>a.totalTravelLegs-b.totalTravelLegs||a.capitalCandidate.totalFuelUnits-b.capitalCandidate.totalFuelUnits||a.gateRoute.transitionDangerScore-b.gateRoute.transitionDangerScore);
  return rows.slice(0,5);
}

export async function calculateNavigationCapitalPlan(input:{characterId:string;shipTypeId:number;fromSystemId:number;toSystemId:number;startingFatigueMinutes?:number;includeLiveIntelligence?:boolean},snapshots:any[]):Promise<NavigationCapitalPlan>{
  const context=await getNavigationCapitalContext(String(input?.characterId??""),snapshots);const index=await getCapitalIndex();const ship=index.byTypeId.get(Number(input?.shipTypeId));if(!ship)throw new Error("Choose a jump-capable ship from the CCP SDE catalogue.");const origin=await getNavigationSystem(Number(input?.fromSystemId)),destination=await getNavigationSystem(Number(input?.toSystemId));const range=navigationEffectiveJumpRange(ship,context.jumpDriveCalibrationLevel);const startingFatigue=Math.max(0,Number(input?.startingFatigueMinutes??0)||0);const includeLive=input?.includeLiveIntelligence!==false;
  const base={characterId:context.characterId,characterName:context.characterName,ship,jumpDriveCalibrationLevel:context.jumpDriveCalibrationLevel,jumpFuelConservationLevel:context.jumpFuelConservationLevel,effectiveRangeLy:range,origin,destination,formula:context.formula,fuelFormula:context.fuelFormula,fatigueFormula:context.fatigueFormula};const empty=(reason:string):NavigationCapitalPlan=>({...base,found:false,reason,systems:[],legs:[],jumps:0,totalDistanceLy:0,totalFuelUnits:0,fuelTypeId:ship.fuelTypeId,fuelTypeName:ship.fuelTypeName,finalFatigueMinutes:startingFatigue,totalActivationWaitMinutes:0,reachableFromOriginCount:0,reachableFromOrigin:[],candidateMidpoints:[],alternatives:[],jumpFreighterTransitions:[]});if(!origin||!destination)return empty("Choose an origin and destination present in the local CCP universe graph.");
  const map=await getNavigationMapData({scope:"universe"});const eligible=map.systems.filter(capitalDestinationEligible);const cells=makeSpatialIndex(eligible);const reachable=systemsInRange(origin,range,cells).map(({system,distanceLy:distance})=>({systemId:system.systemId,name:system.name,regionName:system.regionName,securityStatus:system.securityStatus,distanceLy:distance,distanceToDestinationLy:distanceLy(system,destination)})).sort((a,b)=>a.distanceToDestinationLy-b.distanceToDestinationLy||a.distanceLy-b.distanceLy);
  if(ship.jumpFreighter&&(displaySec(origin.securityStatus)>=0.5||displaySec(destination.securityStatus)>=0.5)){const transitions=await buildJumpFreighterTransitions(origin,destination,range,eligible,cells,ship,context.jumpFuelConservationLevel,startingFatigue,includeLive,snapshots);if(!transitions.length)return {...empty("No viable Jump Freighter high-sec transition was found for the selected origin and destination."),reachableFromOriginCount:reachable.length,reachableFromOrigin:reachable.slice(0,250)};const primary=transitions[0].capitalCandidate;return {...base,found:true,systems:primary.systems,legs:primary.legs,jumps:primary.jumps,totalDistanceLy:primary.totalDistanceLy,totalFuelUnits:primary.totalFuelUnits,fuelTypeId:ship.fuelTypeId,fuelTypeName:ship.fuelTypeName,finalFatigueMinutes:primary.finalFatigueMinutes,totalActivationWaitMinutes:primary.totalActivationWaitMinutes,reachableFromOriginCount:reachable.length,reachableFromOrigin:reachable.slice(0,250),candidateMidpoints:primary.systems.slice(1,-1).map(s=>({systemId:s.systemId,name:s.name,regionName:s.regionName,securityStatus:s.securityStatus})),alternatives:transitions.map(t=>t.capitalCandidate),jumpFreighterTransitions:transitions,formula:context.formula,fuelFormula:context.fuelFormula,fatigueFormula:context.fatigueFormula};}
  if(!capitalDestinationEligible(destination))return {...empty(`${destination.name} is not an eligible standard jump-drive destination. Standard capital destinations must be K-space below 0.5 security; Jump Freighters can instead use the high-sec transition planner.`),reachableFromOriginCount:reachable.length,reachableFromOrigin:reachable.slice(0,250)};if(origin.systemId===destination.systemId)return {...empty(""),found:true,reason:undefined,systems:[origin],reachableFromOriginCount:reachable.length,reachableFromOrigin:reachable.slice(0,250)};
  const alternatives=await buildAlternatives(origin,destination,range,eligible,cells,ship,context.jumpFuelConservationLevel,startingFatigue,includeLive,snapshots);if(!alternatives.length)return {...empty(`No standard jump-drive chain was found within ${range.toFixed(2)} LY per jump.`),reachableFromOriginCount:reachable.length,reachableFromOrigin:reachable.slice(0,250)};const primary=alternatives[0];return {...base,found:true,systems:primary.systems,legs:primary.legs,jumps:primary.jumps,totalDistanceLy:primary.totalDistanceLy,totalFuelUnits:primary.totalFuelUnits,fuelTypeId:ship.fuelTypeId,fuelTypeName:ship.fuelTypeName,finalFatigueMinutes:primary.finalFatigueMinutes,totalActivationWaitMinutes:primary.totalActivationWaitMinutes,reachableFromOriginCount:reachable.length,reachableFromOrigin:reachable.slice(0,250),candidateMidpoints:primary.systems.slice(1,-1).map(s=>({systemId:s.systemId,name:s.name,regionName:s.regionName,securityStatus:s.securityStatus})),alternatives,jumpFreighterTransitions:[],formula:context.formula,fuelFormula:context.fuelFormula,fatigueFormula:context.fatigueFormula};
}

export const NAVIGATION_LIGHT_YEAR_METERS=LIGHT_YEAR_METERS;
export const NAVIGATION_JDC_SKILL_TYPE_ID=JUMP_DRIVE_CALIBRATION_TYPE_ID;
export const NAVIGATION_JFC_SKILL_TYPE_ID=JUMP_FUEL_CONSERVATION_TYPE_ID;
export const NAVIGATION_FATIGUE_CAP_MINUTES=FATIGUE_CAP_MINUTES;
export const NAVIGATION_ACTIVATION_CAP_MINUTES=ACTIVATION_CAP_MINUTES;
