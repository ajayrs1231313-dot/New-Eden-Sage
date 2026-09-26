import AdmZip from "adm-zip";
import path from "node:path";
import { STATIC_DATA_ROOT } from "./data-paths";
import { ensureStaticDataArchive, prepareStaticDataForProcess } from "./type-volumes";

const SDE_ARCHIVE = path.join(STATIC_DATA_ROOT, "eve-static-data-jsonl.zip");
export const ANSIBLEX_CAPACITY_TJ = 1250;
export const ANSIBLEX_BASE_COST_ATTRIBUTE_ID = 6364;

const CAPITAL_RESTRICTED_GROUP_IDS = new Set([
  30,   // Titan
  485,  // Dreadnought
  547,  // Carrier
  659,  // Supercarrier
  883,  // Capital Industrial Ship (Rorqual is the explicit exception)
  1538, // Force Auxiliary
  4594, // Lancer Dreadnought
  5120, // Command Carrier
]);
const ANSIBLEX_CAPITAL_EXCEPTION_GROUP_IDS = new Set([
  513, // Freighter
  902, // Jump Freighter
]);
const RORQUAL_TYPE_ID = 28352;

export type NavigationAnsiblexShipContext = {
  shipTypeId: number;
  shipName: string;
  shipGroupId: number;
  shipGroupName: string;
  baseActivationCostTj: number | null;
  capitalRestricted: boolean;
  capitalException: boolean;
  source: "CCP SDE";
};

type ShipIndex = {
  names: Map<number,string>;
  groupByType: Map<number,number>;
  groupNames: Map<number,string>;
  baseCostByType: Map<number,number>;
};

let indexPromise: Promise<ShipIndex> | undefined;

function jsonlRows<T=any>(zip: AdmZip, name:string): T[] {
  const entry=zip.getEntry(name);
  if(!entry) throw new Error(`Official EVE static data is missing ${name}.`);
  return entry.getData().toString("utf8").split(/\r?\n/).filter(Boolean).map((line)=>JSON.parse(line) as T);
}

async function index() {
  return (indexPromise ??= Promise.resolve().then(async()=>{
    await prepareStaticDataForProcess();
    await ensureStaticDataArchive();
    const zip=new AdmZip(SDE_ARCHIVE);
    const names=new Map<number,string>();
    const groupByType=new Map<number,number>();
    const groupNames=new Map<number,string>();
    const baseCostByType=new Map<number,number>();
    for(const row of jsonlRows<any>(zip,"groups.jsonl")){
      groupNames.set(Number(row._key),String(row.name?.en ?? row.name ?? `Group ${row._key}`));
    }
    for(const row of jsonlRows<any>(zip,"types.jsonl")){
      const typeId=Number(row._key);
      names.set(typeId,String(row.name?.en ?? row.name ?? `Type ${typeId}`));
      groupByType.set(typeId,Number(row.groupID));
    }
    for(const row of jsonlRows<any>(zip,"typeDogma.jsonl")){
      const typeId=Number(row._key);
      const attr=(Array.isArray(row.dogmaAttributes)?row.dogmaAttributes:[]).find((value:any)=>Number(value?.attributeID)===ANSIBLEX_BASE_COST_ATTRIBUTE_ID);
      const costGj=Number(attr?.value);
      // DOGMA stores attribute 6364 in GJ; CCP publishes Ansiblex activation costs in TJ.
      if(Number.isFinite(costGj) && costGj>=0) baseCostByType.set(typeId,costGj/1000);
    }
    return {names,groupByType,groupNames,baseCostByType};
  }));
}

export async function getNavigationAnsiblexShipContext(shipTypeId:number):Promise<NavigationAnsiblexShipContext|null>{
  const id=Number(shipTypeId);
  if(!Number.isSafeInteger(id)||id<=0) return null;
  const data=await index();
  const groupId=data.groupByType.get(id);
  if(groupId==null) return null;
  const capitalException=id===RORQUAL_TYPE_ID || ANSIBLEX_CAPITAL_EXCEPTION_GROUP_IDS.has(groupId);
  return {
    shipTypeId:id,
    shipName:data.names.get(id) ?? `Type ${id}`,
    shipGroupId:groupId,
    shipGroupName:data.groupNames.get(groupId) ?? `Group ${groupId}`,
    baseActivationCostTj:data.baseCostByType.get(id) ?? null,
    capitalRestricted:CAPITAL_RESTRICTED_GROUP_IDS.has(groupId) && !capitalException,
    capitalException,
    source:"CCP SDE",
  };
}

export function ansiblexDistanceMultiplier(distanceLy:number|null|undefined){
  const distance=Number(distanceLy);
  if(!Number.isFinite(distance) || distance<0) return null;
  if(distance<=5) return 0;
  if(distance<=10) return 2;
  if(distance<=15) return 6;
  if(distance<=20) return 9;
  return 15;
}

export type NavigationAnsiblexAssessment = {
  usable:boolean;
  baseCostTj:number|null;
  distanceLy:number|null;
  multiplier:number|null;
  activationCostTj:number|null;
  availableCapacitorTj:number|null;
  capacityTj:number;
  blockers:string[];
  warnings:string[];
};

export function assessNavigationAnsiblex(input:{
  baseCostTj?:number|null;
  endpointDistanceFromCapitalLy?:number|null;
  availableCapacitorTj?:number|null;
  travellerAllianceId?:number|null;
  owningAllianceId?:number|null;
  startingSystemSovereigntyAllianceId?:number|null;
  capitalRestricted?:boolean|null;
  shipName?:string|null;
}):NavigationAnsiblexAssessment{
  const base=Number(input.baseCostTj);
  const baseCostTj=Number.isFinite(base)&&base>=0?base:null;
  const distance=Number(input.endpointDistanceFromCapitalLy);
  const distanceLy=Number.isFinite(distance)&&distance>=0?distance:null;
  const multiplier=ansiblexDistanceMultiplier(distanceLy);
  const activationCostTj=baseCostTj!=null&&multiplier!=null?baseCostTj*multiplier:null;
  const available=Number(input.availableCapacitorTj);
  const availableCapacitorTj=Number.isFinite(available)&&available>=0?Math.min(ANSIBLEX_CAPACITY_TJ,available):null;
  const traveller=Number(input.travellerAllianceId);
  const owner=Number(input.owningAllianceId);
  const sov=Number(input.startingSystemSovereigntyAllianceId);
  const travellerAllianceId=Number.isSafeInteger(traveller)&&traveller>0?traveller:null;
  const owningAllianceId=Number.isSafeInteger(owner)&&owner>0?owner:null;
  const startingSovAllianceId=Number.isSafeInteger(sov)&&sov>0?sov:null;
  const blockers:string[]=[];
  const warnings:string[]=[];

  if(input.capitalRestricted===true) blockers.push(`${input.shipName||"Current ship"} is a capital class that cannot use Ansiblex bridges.`);
  if(travellerAllianceId!=null&&owningAllianceId!=null&&travellerAllianceId!==owningAllianceId)
    blockers.push("Pilot alliance does not match the Ansiblex owning alliance.");
  if(travellerAllianceId!=null&&startingSovAllianceId!=null&&travellerAllianceId!==startingSovAllianceId)
    blockers.push("Pilot alliance does not hold sovereignty over the departure system.");
  if(activationCostTj!=null&&availableCapacitorTj!=null&&activationCostTj>availableCapacitorTj)
    blockers.push(`Ansiblex needs ${activationCostTj.toFixed(2)} TJ but only ${availableCapacitorTj.toFixed(2)} TJ is recorded at the departure bridge.`);

  if(baseCostTj==null) warnings.push("Current ship Ansiblex base cost is unknown.");
  if(distanceLy==null) warnings.push("Endpoint distance from the owning alliance capital is unknown, so activation cost cannot be calculated.");
  if(travellerAllianceId==null) warnings.push("Pilot alliance is unknown.");
  if(owningAllianceId==null) warnings.push("Ansiblex owning alliance is unknown.");
  if(startingSovAllianceId==null) warnings.push("Departure-system sovereignty owner is unknown.");
  if(availableCapacitorTj==null) warnings.push("Departure Ansiblex capacitor is unknown.");

  return {usable:blockers.length===0,baseCostTj,distanceLy,multiplier,activationCostTj,availableCapacitorTj,capacityTj:ANSIBLEX_CAPACITY_TJ,blockers,warnings};
}
