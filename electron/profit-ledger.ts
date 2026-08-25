import { randomUUID } from "node:crypto";
import {
  deleteOpportunityProfitRecord,
  getSnapshot,
  listOpportunityProfitRecords,
  saveOpportunityProfitRecord,
} from "./database";

export type ProfitLedgerSource = "contract" | "market-opportunity" | "planetary" | "industry" | "lp-store";
export type ProfitLedgerItem = { typeId:number; name:string; quantity:number; expectedUnitSell?:number|null };
export type ProfitLedgerAllocation = {
  productionLotId?: string;
  walletTransactionId: number;
  quantityAllocated: number;
  unitPrice: number;
  revenue: number;
  transactionDate?: string;
  confidence: "strong" | "compatible";
  evidence: string;
};
export type ProfitMaterialProvenance = { mined:boolean; donated:boolean; owned:boolean; bought:boolean; updatedAt?:string };
export type ProfitPurchaseAllocation = {
  productionLotId?:string; walletTransactionId:number; typeId:number; materialName:string; quantityAllocated:number; unitPrice:number; cost:number; transactionDate?:string; evidence:string;
};
export type ProfitLedgerRecord = {
  id:string; characterId:string; characterName:string; source:ProfitLedgerSource; sourceKey:string; title:string;
  completedAt:string; estimatedCost:number; estimatedRevenue:number; estimatedProfit:number;
  actualRevenue:number|null; actualCost?:number|null; actualTax:number|null; actualBrokerFees:number|null; actualProfit:number|null;
  reconciliationStatus:"exact"|"partial"|"estimated"; reconciliationNote:string; items:ProfitLedgerItem[];
  walletTransactionIds:number[]; walletJournalIds:number[]; allocations?:ProfitLedgerAllocation[];
  materialProvenance?:ProfitMaterialProvenance; purchaseAllocations?:ProfitPurchaseAllocation[]; cashMaterialCost?:number|null; economicMaterialValue?:number|null; cashProfit?:number|null; economicProfit?:number|null;
  metadata?:Record<string,unknown>;
};

type WalletTransaction={
  transaction_id?:number; journal_ref_id?:number; order_id?:number; date?:string; is_buy?:boolean; quantity?:number; type_id?:number; unit_price?:number; _walletScope?:"character"|"corporation"; _walletDivision?:number;
};
type WalletJournal={id?:number;date?:string;ref_type?:string;amount?:number;context_id?:number;context_id_type?:string};

type ReservationState = { transactions:Set<number>; purchaseTransactions:Set<number>; journals:Set<number> };

function asArray<T>(value:unknown):T[]{return Array.isArray(value)?value as T[]:[];}
function closeEnough(actual:number, expected:number|null|undefined){ if(expected==null||expected<=0)return true; return Math.abs(actual-expected)/expected<0.08; }
function positiveInt(value:unknown){const parsed=Math.floor(Number(value));return Number.isFinite(parsed)&&parsed>0?parsed:0;}
function finiteNumber(value:unknown){const parsed=Number(value);return Number.isFinite(parsed)?parsed:null;}
function recordUnits(record:ProfitLedgerRecord){return record.items.reduce((sum,item)=>sum+Math.max(0,positiveInt(item.quantity)),0);}
function productionFloor(record:ProfitLedgerRecord){
  if(record.source!=="industry")return null;
  const explicit=String(record.metadata?.productionCompletedAt??record.completedAt??"");
  const parsed=Date.parse(explicit); return Number.isFinite(parsed)?parsed:null;
}
function strongTransactionIds(record:ProfitLedgerRecord){
  const values=[...(asArray<number>(record.metadata?.walletTransactionIds)),...(asArray<number>(record.metadata?.transactionIds))];
  return new Set(values.map(Number).filter((value)=>Number.isSafeInteger(value)&&value>0));
}
function strongOrderIds(record:ProfitLedgerRecord){
  const values=[...(asArray<number>(record.metadata?.orderIds))];
  const single=Number(record.metadata?.orderId??0); if(single>0)values.push(single);
  return new Set(values.map(Number).filter((value)=>Number.isSafeInteger(value)&&value>0));
}
function rejectedTransactionIds(record:ProfitLedgerRecord){return new Set(asArray<number>(record.metadata?.rejectedWalletTransactionIds).map(positiveInt).filter(Boolean));}
function confirmedTransactionIds(record:ProfitLedgerRecord){return new Set(asArray<number>(record.metadata?.confirmedWalletTransactionIds).map(positiveInt).filter(Boolean));}
function rejectedPurchaseIds(record:ProfitLedgerRecord){return new Set(asArray<number>(record.metadata?.rejectedMaterialPurchaseTransactionIds).map(positiveInt).filter(Boolean));}
function materialRequirements(record:ProfitLedgerRecord){
  return asArray<any>(record.metadata?.materialRequirements).flatMap((row)=>{const typeId=positiveInt(row?.typeId),quantity=Math.max(0,positiveInt(row?.required??row?.quantity));return typeId&&quantity?[{typeId,name:String(row?.name??("Type "+typeId)),quantity}]:[];});
}
function auditMetadata(metadata:Record<string,unknown>|undefined,action:string,detail:Record<string,unknown>={}){
  const history=asArray<any>(metadata?.bookkeepingAudit).slice(-49);
  return {...(metadata??{}),lastBookkeepingUpdatedAt:new Date().toISOString(),bookkeepingAudit:[...history,{at:new Date().toISOString(),action,...detail}]};
}
function snapshotWalletTransactions(snapshot:any){
  const rows:WalletTransaction[]=asArray<WalletTransaction>(snapshot?.extended?.walletTransactions).map((row)=>({...row,_walletScope:"character" as const}));
  for(const division of asArray<any>(snapshot?.extended?.corporation?.walletHistory)){
    for(const row of asArray<WalletTransaction>(division?.transactions)) rows.push({...row,_walletScope:"corporation",_walletDivision:positiveInt(division?.division)||undefined});
  }
  const deduped=new Map<number,WalletTransaction>();
  for(const row of rows){const id=positiveInt(row?.transaction_id);if(id&&!deduped.has(id))deduped.set(id,row);}
  return [...deduped.values()];
}
function snapshotWalletJournal(snapshot:any){
  const rows:WalletJournal[]=[...asArray<WalletJournal>(snapshot?.extended?.walletJournal)];
  for(const division of asArray<any>(snapshot?.extended?.corporation?.walletHistory)){
    for(const row of asArray<WalletJournal>(division?.journal)) rows.push(row);
  }
  const deduped=new Map<number,WalletJournal>();
  for(const row of rows){const id=positiveInt(row?.id);if(id&&!deduped.has(id))deduped.set(id,row);}
  return [...deduped.values()];
}
function expectedForType(record:ProfitLedgerRecord,typeId:number){
  return record.items.find((item)=>Number(item.typeId)===typeId)?.expectedUnitSell??null;
}
function transactionEvidence(record:ProfitLedgerRecord,row:WalletTransaction){
  const txId=Number(row.transaction_id??0), orderId=Number(row.order_id??0);
  if(strongTransactionIds(record).has(txId))return {confidence:"strong" as const,evidence:"explicit wallet transaction ID"};
  if(orderId>0&&strongOrderIds(record).has(orderId))return {confidence:"strong" as const,evidence:"matching market order ID"};
  return {confidence:"compatible" as const,evidence:"product, quantity, price and chronology"};
}
function validSaleForRecord(record:ProfitLedgerRecord,row:WalletTransaction,typeId:number){
  const txId=positiveInt(row.transaction_id);
  if(txId&&rejectedTransactionIds(record).has(txId))return false;
  if(row?.is_buy!==false||Number(row.type_id)!==typeId||positiveInt(row.quantity)<=0||!(Number(row.unit_price??0)>=0))return false;
  const explicit=strongTransactionIds(record).has(positiveInt(row.transaction_id))||(positiveInt(row.order_id)>0&&strongOrderIds(record).has(positiveInt(row.order_id)));
  if(!explicit&&!closeEnough(Number(row.unit_price??0),expectedForType(record,typeId)))return false;
  const floor=productionFloor(record);
  if(floor!=null){const at=Date.parse(String(row.date??""));if(!Number.isFinite(at)||at<floor)return false;}
  return true;
}

function reservePersistedAllocations(record:ProfitLedgerRecord,transactions:WalletTransaction[],state:ReservationState){
  const byId=new Map(transactions.map((row)=>[Number(row.transaction_id??0),row]));
  const remainingByType=new Map<number,number>();
  for(const item of record.items){const typeId=Number(item.typeId);remainingByType.set(typeId,(remainingByType.get(typeId)??0)+positiveInt(item.quantity));}
  const kept:ProfitLedgerAllocation[]=[];
  const keepTransaction=(txId:number,requestedQuantity:number,previous?:ProfitLedgerAllocation)=>{
    if(!txId||state.transactions.has(txId))return;
    const row=byId.get(txId); if(!row)return;
    const typeId=Number(row.type_id??0),remaining=remainingByType.get(typeId)??0;
    if(remaining<=0||!validSaleForRecord(record,row,typeId))return;
    const quantity=Math.min(remaining,requestedQuantity||positiveInt(row.quantity),positiveInt(row.quantity)); if(quantity<=0)return;
    const unitPrice=Math.max(0,Number(row.unit_price??previous?.unitPrice??0));
    const evidence=transactionEvidence(record,row);
    kept.push({
      productionLotId:String(record.metadata?.productionLotId??previous?.productionLotId??"")||undefined,
      walletTransactionId:txId,quantityAllocated:quantity,unitPrice,revenue:quantity*unitPrice,
      transactionDate:String(row.date??previous?.transactionDate??"")||undefined,confidence:evidence.confidence,evidence:evidence.evidence,
    });
    remainingByType.set(typeId,remaining-quantity); state.transactions.add(txId);
  };
  for(const allocation of asArray<ProfitLedgerAllocation>(record.allocations)){
    keepTransaction(positiveInt(allocation.walletTransactionId),positiveInt(allocation.quantityAllocated),allocation);
  }
  // Manual transaction IDs are explicit user evidence. Reserve them before any heuristic match so a
  // generic ledger row cannot steal a transaction the user already assigned deliberately.
  for(const txId of [...strongTransactionIds(record)].sort((a,b)=>a-b)){
    if(kept.some((allocation)=>allocation.walletTransactionId===txId))continue;
    keepTransaction(txId,positiveInt(byId.get(txId)?.quantity));
  }
  return {kept,remainingByType};
}

function validPurchaseForRecord(record:ProfitLedgerRecord,row:WalletTransaction,typeId:number){
  const txId=positiveInt(row.transaction_id);
  if(txId&&rejectedPurchaseIds(record).has(txId))return false;
  if(record.source!=="industry"||row?.is_buy!==true||Number(row.type_id)!==typeId||positiveInt(row.quantity)<=0||!(Number(row.unit_price??0)>=0))return false;
  const at=Date.parse(String(row.date??"")); if(!Number.isFinite(at))return false;
  const complete=productionFloor(record); if(complete!=null&&at>complete)return false;
  const projectFloor=Date.parse(String(record.metadata?.projectCreatedAt??"")); if(Number.isFinite(projectFloor)&&at<projectFloor-5*60_000)return false;
  return true;
}
function reservePersistedPurchaseAllocations(record:ProfitLedgerRecord,transactions:WalletTransaction[],state:ReservationState){
  const byId=new Map(transactions.map((row)=>[positiveInt(row.transaction_id),row]));
  const remaining=new Map(materialRequirements(record).map((row)=>[row.typeId,row.quantity]));
  const kept:ProfitPurchaseAllocation[]=[];
  const keep=(txId:number,requested:number,previous?:ProfitPurchaseAllocation)=>{
    if(!txId||state.purchaseTransactions.has(txId))return; const row=byId.get(txId); if(!row)return;
    const typeId=positiveInt(row.type_id),needed=remaining.get(typeId)??0; if(needed<=0||!validPurchaseForRecord(record,row,typeId))return;
    const quantity=Math.min(needed,requested||positiveInt(row.quantity),positiveInt(row.quantity)); if(quantity<=0)return;
    const unitPrice=Math.max(0,Number(row.unit_price??previous?.unitPrice??0)); const material=materialRequirements(record).find((item)=>item.typeId===typeId);
    kept.push({productionLotId:String(record.metadata?.productionLotId??previous?.productionLotId??"")||undefined,walletTransactionId:txId,typeId,materialName:material?.name??previous?.materialName??("Type "+typeId),quantityAllocated:quantity,unitPrice,cost:quantity*unitPrice,transactionDate:String(row.date??previous?.transactionDate??"")||undefined,evidence:"persisted material purchase allocation"});
    remaining.set(typeId,needed-quantity); state.purchaseTransactions.add(txId);
  };
  for(const allocation of asArray<ProfitPurchaseAllocation>(record.purchaseAllocations))keep(positiveInt(allocation.walletTransactionId),positiveInt(allocation.quantityAllocated),allocation);
  for(const txId of asArray<number>(record.metadata?.materialPurchaseTransactionIds).map(positiveInt).filter(Boolean).sort((a,b)=>a-b)){if(!kept.some((row)=>row.walletTransactionId===txId))keep(txId,positiveInt(byId.get(txId)?.quantity));}
  return {kept,remaining};
}
function allocateMaterialPurchases(record:ProfitLedgerRecord,snapshot:any,state:ReservationState,reserved?:ReturnType<typeof reservePersistedPurchaseAllocations>){
  if(record.source!=="industry"||!materialRequirements(record).length)return {allocations:[] as ProfitPurchaseAllocation[],complete:false};
  const transactions=snapshotWalletTransactions(snapshot).filter((row)=>row?.is_buy===true);
  const {kept,remaining}=reserved??reservePersistedPurchaseAllocations(record,transactions,state); const allocations=[...kept];
  for(const requirement of materialRequirements(record)){let needed=remaining.get(requirement.typeId)??0;if(needed<=0)continue;
    const candidates=transactions.filter((row)=>{const id=positiveInt(row.transaction_id);return id&&!state.purchaseTransactions.has(id)&&validPurchaseForRecord(record,row,requirement.typeId);}).sort((a,b)=>Date.parse(String(b.date??0))-Date.parse(String(a.date??0))||positiveInt(b.transaction_id)-positiveInt(a.transaction_id));
    for(const row of candidates){if(needed<=0)break;const id=positiveInt(row.transaction_id),available=positiveInt(row.quantity);if(!id||!available)continue;const quantity=Math.min(needed,available),unitPrice=Math.max(0,Number(row.unit_price??0));allocations.push({productionLotId:String(record.metadata?.productionLotId??"")||undefined,walletTransactionId:id,typeId:requirement.typeId,materialName:requirement.name,quantityAllocated:quantity,unitPrice,cost:quantity*unitPrice,transactionDate:String(row.date??"")||undefined,evidence:"BOM type, quantity and pre-production purchase chronology"});state.purchaseTransactions.add(id);needed-=quantity;}
    remaining.set(requirement.typeId,needed);
  }
  return {allocations,complete:[...remaining.values()].every((quantity)=>quantity<=0)};
}

function reconcileOne(record:ProfitLedgerRecord,snapshot:any,state:ReservationState,reserved?:ReturnType<typeof reservePersistedAllocations>,reservedPurchases?:ReturnType<typeof reservePersistedPurchaseAllocations>):ProfitLedgerRecord{
  const transactions=snapshotWalletTransactions(snapshot).filter((row)=>row?.is_buy===false);
  const journal=snapshotWalletJournal(snapshot);
  const {kept,remainingByType}=reserved??reservePersistedAllocations(record,transactions,state);
  const allocations=[...kept];
  const types=[...remainingByType.keys()].sort((a,b)=>a-b);
  for(const typeId of types){
    let needed=remainingByType.get(typeId)??0; if(needed<=0)continue;
    const candidates=transactions
      .filter((row)=>{const txId=positiveInt(row.transaction_id);return txId&&!state.transactions.has(txId)&&validSaleForRecord(record,row,typeId);})
      .map((row)=>({row,evidence:transactionEvidence(record,row)}))
      .sort((a,b)=>Number(b.evidence.confidence==="strong")-Number(a.evidence.confidence==="strong")||Date.parse(String(a.row.date??0))-Date.parse(String(b.row.date??0))||Number(a.row.transaction_id??0)-Number(b.row.transaction_id??0));
    for(const candidate of candidates){
      if(needed<=0)break;
      const row=candidate.row, txId=positiveInt(row.transaction_id), available=positiveInt(row.quantity); if(!txId||!available)continue;
      const quantity=Math.min(needed,available),unitPrice=Math.max(0,Number(row.unit_price??0));
      allocations.push({
        productionLotId:String(record.metadata?.productionLotId??"")||undefined,
        walletTransactionId:txId,quantityAllocated:quantity,unitPrice,revenue:quantity*unitPrice,
        transactionDate:String(row.date??"")||undefined,confidence:candidate.evidence.confidence,evidence:candidate.evidence.evidence,
      });
      state.transactions.add(txId); needed-=quantity;
    }
    remainingByType.set(typeId,needed);
  }

  if(!allocations.length){
    const purchaseState=allocateMaterialPurchases(record,snapshot,state,reservedPurchases);
    return {...record,actualRevenue:null,actualCost:null,actualTax:null,actualBrokerFees:null,actualProfit:null,cashProfit:null,economicProfit:null,cashMaterialCost:null,economicMaterialValue:null,reconciliationStatus:"estimated",reconciliationNote:"No safe post-production sale allocation was found in the latest synced wallet history. Estimated figures are preserved until wallet evidence is available.",walletTransactionIds:[],walletJournalIds:[],allocations:[],purchaseAllocations:purchaseState.allocations};
  }

  const ownedTransactions=allocations.map((allocation)=>transactions.find((row)=>Number(row.transaction_id)===allocation.walletTransactionId)).filter(Boolean) as WalletTransaction[];
  const txIds=[...new Set(allocations.map((allocation)=>allocation.walletTransactionId))];
  const transactionIds=new Set<number>(),journalRefs=new Set<number>(),orderIds=new Set<number>();
  for(const row of ownedTransactions){
    const txId=positiveInt(row.transaction_id),ref=positiveInt(row.journal_ref_id),orderId=positiveInt(row.order_id);
    if(txId)transactionIds.add(txId); if(ref)journalRefs.add(ref); if(orderId)orderIds.add(orderId);
  }
  const relevantJournal=journal.filter((row)=>{
    const id=positiveInt(row.id); if(!id||state.journals.has(id))return false;
    const kind=String(row.ref_type??""); if(kind!=="transaction_tax"&&kind!=="brokers_fee")return false;
    const context=positiveInt(row.context_id); if(!context)return false;
    const contextType=String(row.context_id_type??"").toLowerCase();
    if(contextType.includes("market_transaction"))return transactionIds.has(context);
    if(contextType.includes("market_order"))return orderIds.has(context);
    // journal_ref_id is itself an exact ESI linkage. Unknown/legacy context types are accepted only
    // when they equal that reference, never merely because a fee happened near the sale in time.
    return journalRefs.has(context);
  });
  for(const row of relevantJournal){const id=positiveInt(row.id);if(id)state.journals.add(id);}
  const actualRevenue=allocations.reduce((sum,row)=>sum+row.revenue,0);
  const actualTax=Math.abs(relevantJournal.filter((row)=>String(row.ref_type)==="transaction_tax").reduce((sum,row)=>sum+Number(row.amount??0),0));
  const actualBrokerFees=Math.abs(relevantJournal.filter((row)=>String(row.ref_type)==="brokers_fee").reduce((sum,row)=>sum+Number(row.amount??0),0));
  const totalUnits=Math.max(1,recordUnits(record)),allocatedUnits=allocations.reduce((sum,row)=>sum+row.quantityAllocated,0),soldFraction=Math.min(1,allocatedUnits/totalUnits);
  const attributedCost=Math.max(0,Number(finiteNumber(record.metadata?.attributedProductionCost)??finiteNumber(record.metadata?.materialCost)??record.estimatedCost)||0);
  const frozenMaterialReference=Math.max(0,Number(finiteNumber(record.metadata?.materialReferenceValue)??attributedCost)||0);
  const frozenJobCost=Math.max(0,Number(finiteNumber(record.metadata?.jobCost)??Math.max(0,attributedCost-frozenMaterialReference))||0);
  const provenance=record.materialProvenance;
  const purchaseState=allocateMaterialPurchases(record,snapshot,state,reservedPurchases);
  const actualBoughtMaterialCost=purchaseState.allocations.reduce((sum,row)=>sum+Math.max(0,Number(row.cost??0)),0)*soldFraction;
  const economicMaterialValue=frozenMaterialReference*soldFraction;
  const legacyMaterialCost=Math.max(0,attributedCost-frozenJobCost)*soldFraction;
  const hasNonCash=Boolean(provenance?.mined||provenance?.donated||provenance?.owned);
  let cashMaterialCost=legacyMaterialCost;
  if(provenance){
    if(provenance.bought){cashMaterialCost=hasNonCash?actualBoughtMaterialCost:purchaseState.complete?actualBoughtMaterialCost:Math.max(actualBoughtMaterialCost,economicMaterialValue);}
    else if(hasNonCash){cashMaterialCost=0;}
  }
  const actualJobCost=frozenJobCost*soldFraction;
  const actualCost=cashMaterialCost+actualJobCost;
  const cashProfit=actualRevenue-actualTax-actualBrokerFees-actualCost;
  const economicProfit=actualRevenue-actualTax-actualBrokerFees-economicMaterialValue-actualJobCost;
  const complete=[...remainingByType.values()].every((quantity)=>quantity<=0);
  const allStrong=allocations.every((allocation)=>allocation.confidence==="strong");
  const status:ProfitLedgerRecord["reconciliationStatus"]=complete&&allStrong?"exact":"partial";
  const note=complete
    ? allStrong
      ? "Fully reconciled from explicit wallet/order evidence. Transaction and journal IDs are globally reserved to this ledger record."
      : "All produced units are allocated, but one or more matches rely on compatible product/quantity/price/chronology evidence, so Sage keeps the reconciliation partial rather than inventing exactness."
    : "Only part of the expected output has sold or matched safely. Remaining units stay unreconciled until later wallet syncs.";
  return {...record,actualRevenue,actualCost,actualTax,actualBrokerFees,actualProfit:cashProfit,cashProfit,economicProfit,cashMaterialCost,economicMaterialValue,reconciliationStatus:status,reconciliationNote:note,walletTransactionIds:txIds,walletJournalIds:relevantJournal.map((row)=>positiveInt(row.id)).filter(Boolean),allocations,purchaseAllocations:purchaseState.allocations};
}

export function reconcileProfitRecords(records:ProfitLedgerRecord[],snapshot:any){
  const state:ReservationState={transactions:new Set(),purchaseTransactions:new Set(),journals:new Set()};
  const transactions=snapshotWalletTransactions(snapshot).filter((row)=>row?.is_buy===false);
  const sorted=[...records].sort((a,b)=>String(a.completedAt).localeCompare(String(b.completedAt))||a.id.localeCompare(b.id));
  // Phase 1 reserves all persisted/manual ownership before any heuristic match. Conflicting persisted
  // claims resolve oldest-first; valid non-conflicting allocations remain stable across repeated runs.
  const reserved=new Map<string,ReturnType<typeof reservePersistedAllocations>>();
  const reservedPurchases=new Map<string,ReturnType<typeof reservePersistedPurchaseAllocations>>();
  for(const record of sorted){reserved.set(record.id,reservePersistedAllocations(record,transactions,state));reservedPurchases.set(record.id,reservePersistedPurchaseAllocations(record,transactions,state));}
  // Phase 2 allocates only still-unclaimed wallet sales and material purchases, also oldest-first.
  return sorted.map((record)=>reconcileOne(record,snapshot,state,reserved.get(record.id),reservedPurchases.get(record.id)));
}

export function completeProfitDeal(input:{characterId:string;source:ProfitLedgerSource;sourceKey:string;title:string;estimatedCost:number;estimatedRevenue:number;estimatedProfit:number;items?:ProfitLedgerItem[];metadata?:Record<string,unknown>}){
  const snapshot=getSnapshot(String(input.characterId)) as any; if(!snapshot)throw new Error("Select and sync the character that completed this deal.");
  const base:ProfitLedgerRecord={id:randomUUID(),characterId:String(input.characterId),characterName:String(snapshot?.character?.name??input.characterId),source:input.source,sourceKey:String(input.sourceKey),title:String(input.title),completedAt:new Date().toISOString(),estimatedCost:Number(input.estimatedCost)||0,estimatedRevenue:Number(input.estimatedRevenue)||0,estimatedProfit:Number(input.estimatedProfit)||0,actualRevenue:null,actualCost:null,actualTax:null,actualBrokerFees:null,actualProfit:null,reconciliationStatus:"estimated",reconciliationNote:"Awaiting synced wallet reconciliation.",items:(input.items??[]).map((item)=>({...item,typeId:Number(item.typeId),quantity:Math.max(0,positiveInt(item.quantity))})),walletTransactionIds:[],walletJournalIds:[],allocations:[],metadata:input.metadata};
  saveOpportunityProfitRecord(base);
  return reconcileProfitLedger(base.characterId).find((row)=>row.id===base.id)??base;
}

export function upsertIndustryProductionLot(input:{characterId:string;characterName:string;sourceKey:string;title:string;productionLotId:string;productionCompletedAt:string;productTypeId:number;productName:string;quantity:number;attributedProductionCost?:number|null;materialReferenceValue?:number|null;jobCost?:number|null;materialRequirements?:Array<{typeId:number;name:string;required:number}>;projectCreatedAt?:string;industryJobId?:number;projectId?:string}){
  const rows=listOpportunityProfitRecords(String(input.characterId)) as ProfitLedgerRecord[];
  const existing=rows.find((row)=>row.source==="industry"&&row.sourceKey===input.sourceKey);
  const cost=Math.max(0,Number(input.attributedProductionCost??existing?.estimatedCost??0)||0);
  const quantity=Math.max(1,positiveInt(input.quantity));
  const next:ProfitLedgerRecord={
    ...(existing??{id:randomUUID(),actualRevenue:null,actualCost:null,actualTax:null,actualBrokerFees:null,actualProfit:null,reconciliationStatus:"estimated" as const,reconciliationNote:"Awaiting synced wallet reconciliation.",walletTransactionIds:[],walletJournalIds:[],allocations:[]}),
    characterId:String(input.characterId),characterName:String(input.characterName),source:"industry",sourceKey:input.sourceKey,title:input.title,
    completedAt:input.productionCompletedAt,estimatedCost:cost,estimatedRevenue:existing?.estimatedRevenue??0,estimatedProfit:existing?.estimatedProfit??-cost,
    items:[{typeId:Number(input.productTypeId),name:String(input.productName),quantity}],
    metadata:{...(existing?.metadata??{}),productionLotId:input.productionLotId,productionCompletedAt:input.productionCompletedAt,industryJobId:input.industryJobId,projectId:input.projectId,projectCreatedAt:input.projectCreatedAt??existing?.metadata?.projectCreatedAt,attributedProductionCost:cost,materialReferenceValue:Math.max(0,Number(input.materialReferenceValue??existing?.metadata?.materialReferenceValue??cost)||0),jobCost:Math.max(0,Number(input.jobCost??existing?.metadata?.jobCost??0)||0),materialRequirements:Array.isArray(input.materialRequirements)?input.materialRequirements:existing?.metadata?.materialRequirements},
  };
  saveOpportunityProfitRecord(next); return next;
}

export function reconcileProfitLedger(characterId?:string){
  const rows=listOpportunityProfitRecords(characterId) as ProfitLedgerRecord[];
  const grouped=new Map<string,ProfitLedgerRecord[]>();
  for(const row of rows){const list=grouped.get(row.characterId)??[];list.push(row);grouped.set(row.characterId,list);}
  const updated:ProfitLedgerRecord[]=[];
  for(const [id,records] of grouped){
    const snapshot=getSnapshot(id) as any;
    const next=snapshot?reconcileProfitRecords(records,snapshot):records;
    for(const row of next){saveOpportunityProfitRecord(row);updated.push(row);}
  }
  return updated.sort((a,b)=>String(b.completedAt).localeCompare(String(a.completedAt)));
}
export function getProfitLedger(characterId?:string){return listOpportunityProfitRecords(characterId) as ProfitLedgerRecord[];}
export function removeProfitLedgerRecord(id:string){return deleteOpportunityProfitRecord(id);}

export type ProfitReconciliationCandidate = {
  walletTransactionId:number;
  date:string;
  typeId:number;
  itemName:string;
  quantity:number;
  unitPrice:number;
  revenue:number;
  walletScope:"character"|"corporation";
  walletDivision?:number;
  selected:boolean;
  reservedByOther:boolean;
  priceCompatible:boolean;
};

function recordById(recordId:string){
  const record=(listOpportunityProfitRecords() as ProfitLedgerRecord[]).find((row)=>row.id===recordId);
  if(!record)throw new Error("Profit ledger record no longer exists.");
  return record;
}

export function getProfitReconciliationReview(recordId:string){
  const record=recordById(String(recordId));
  const snapshot=getSnapshot(record.characterId) as any;
  if(!snapshot)throw new Error("Sync the owning character before reviewing wallet matches.");
  const all=listOpportunityProfitRecords(record.characterId) as ProfitLedgerRecord[];
  const reservedByOthers=new Set<number>();
  for(const other of all){
    if(other.id===record.id)continue;
    for(const id of other.walletTransactionIds??[])reservedByOthers.add(positiveInt(id));
    for(const allocation of other.allocations??[])reservedByOthers.add(positiveInt(allocation.walletTransactionId));
    for(const id of asArray<number>(other.metadata?.walletTransactionIds))reservedByOthers.add(positiveInt(id));
  }
  const selected=new Set(asArray<number>(record.metadata?.walletTransactionIds).map(positiveInt).filter(Boolean));
  const items=new Map(record.items.map((item)=>[Number(item.typeId),item] as const));
  const floor=productionFloor(record);
  const candidates:ProfitReconciliationCandidate[]=snapshotWalletTransactions(snapshot).flatMap((row)=>{
    const id=positiveInt(row.transaction_id),typeId=positiveInt(row.type_id),quantity=positiveInt(row.quantity),unitPrice=Math.max(0,Number(row.unit_price??0));
    const item=items.get(typeId);
    if(!id||row.is_buy!==false||!item||!quantity)return [];
    const at=Date.parse(String(row.date??""));
    if(floor!=null&&(!Number.isFinite(at)||at<floor))return [];
    return [{
      walletTransactionId:id,date:String(row.date??""),typeId,itemName:item.name,quantity,unitPrice,revenue:quantity*unitPrice,
      walletScope:row._walletScope??"character",walletDivision:row._walletDivision,selected:selected.has(id),reservedByOther:reservedByOthers.has(id),
      priceCompatible:closeEnough(unitPrice,item.expectedUnitSell),
    }];
  }).sort((a,b)=>Number(b.selected)-Number(a.selected)||Number(a.reservedByOther)-Number(b.reservedByOther)||Date.parse(a.date)-Date.parse(b.date)||a.walletTransactionId-b.walletTransactionId);
  return { recordId:record.id, characterId:record.characterId, title:record.title, reconciliationStatus:record.reconciliationStatus, candidates };
}

export function setProfitTransactionOverride(input:{recordId:string;walletTransactionId:number;assigned:boolean}){
  const record=recordById(String(input.recordId));
  const snapshot=getSnapshot(record.characterId) as any;
  if(!snapshot)throw new Error("Sync the owning character before changing wallet matches.");
  const transactionId=positiveInt(input.walletTransactionId);
  if(!transactionId)throw new Error("A valid wallet transaction is required.");
  const row=snapshotWalletTransactions(snapshot).find((candidate)=>positiveInt(candidate.transaction_id)===transactionId);
  if(!row||row.is_buy!==false)throw new Error("That synced wallet sale is no longer available.");
  const item=record.items.find((candidate)=>Number(candidate.typeId)===Number(row.type_id));
  if(!item)throw new Error("That wallet transaction sells a different item than this ledger record.");
  const floor=productionFloor(record),at=Date.parse(String(row.date??""));
  if(floor!=null&&(!Number.isFinite(at)||at<floor))throw new Error("A sale before production completion cannot be assigned to this production lot.");
  if(input.assigned){
    const others=listOpportunityProfitRecords(record.characterId) as ProfitLedgerRecord[];
    const owner=others.find((other)=>other.id!==record.id&&(
      (other.walletTransactionIds??[]).some((id)=>positiveInt(id)===transactionId)
      ||(other.allocations??[]).some((allocation)=>positiveInt(allocation.walletTransactionId)===transactionId)
      ||asArray<number>(other.metadata?.walletTransactionIds).some((id)=>positiveInt(id)===transactionId)
    ));
    if(owner)throw new Error(`Transaction ${transactionId} is already owned by ${owner.title}. Remove that allocation before reassigning it.`);
  }
  const manual=new Set(asArray<number>(record.metadata?.walletTransactionIds).map(positiveInt).filter(Boolean));
  const rejected=new Set(asArray<number>(record.metadata?.rejectedWalletTransactionIds).map(positiveInt).filter(Boolean));
  if(input.assigned){manual.add(transactionId);rejected.delete(transactionId);}else manual.delete(transactionId);
  saveOpportunityProfitRecord({...record,metadata:auditMetadata({...record.metadata,walletTransactionIds:[...manual],rejectedWalletTransactionIds:[...rejected]},input.assigned?"sale-manually-assigned":"sale-manually-released",{walletTransactionId:transactionId})});
  const rows=reconcileProfitLedger(record.characterId);
  return { record:rows.find((candidate)=>candidate.id===record.id)??record, review:getProfitReconciliationReview(record.id) };
}

export type ProfitPurchaseCandidate={walletTransactionId:number;date:string;typeId:number;materialName:string;quantity:number;unitPrice:number;cost:number;walletScope:"character"|"corporation";walletDivision?:number;selected:boolean;reservedByOther:boolean};

export function setProfitMatchDecision(input:{recordId:string;walletTransactionId:number;decision:"confirmed"|"rejected"}){
  const record=recordById(String(input.recordId));
  const txId=positiveInt(input.walletTransactionId);
  if(!txId)throw new Error("A valid wallet transaction is required.");
  const allocation=(record.allocations??[]).find((row)=>positiveInt(row.walletTransactionId)===txId);
  if(!allocation&&input.decision==="confirmed")throw new Error("That sale is no longer allocated to this production record.");
  const manual=new Set(asArray<number>(record.metadata?.walletTransactionIds).map(positiveInt).filter(Boolean));
  const confirmed=new Set(asArray<number>(record.metadata?.confirmedWalletTransactionIds).map(positiveInt).filter(Boolean));
  const rejected=new Set(asArray<number>(record.metadata?.rejectedWalletTransactionIds).map(positiveInt).filter(Boolean));
  let allocations=[...(record.allocations??[])];
  if(input.decision==="confirmed"){manual.add(txId);confirmed.add(txId);rejected.delete(txId);}
  else{manual.delete(txId);confirmed.delete(txId);rejected.add(txId);allocations=allocations.filter((row)=>positiveInt(row.walletTransactionId)!==txId);}
  saveOpportunityProfitRecord({...record,allocations,metadata:auditMetadata({...record.metadata,walletTransactionIds:[...manual],confirmedWalletTransactionIds:[...confirmed],rejectedWalletTransactionIds:[...rejected]},"sale-match-"+input.decision,{walletTransactionId:txId})});
  return reconcileProfitLedger(record.characterId).find((row)=>row.id===record.id)??record;
}

export function setProfitMaterialProvenance(input:{recordId:string;mined:boolean;donated:boolean;owned:boolean;bought:boolean}){
  const record=recordById(String(input.recordId));
  if(record.source!=="industry")throw new Error("Material provenance applies to Industry production records.");
  const materialProvenance:ProfitMaterialProvenance={mined:Boolean(input.mined),donated:Boolean(input.donated),owned:Boolean(input.owned),bought:Boolean(input.bought),updatedAt:new Date().toISOString()};
  saveOpportunityProfitRecord({...record,materialProvenance,metadata:auditMetadata(record.metadata,"material-provenance",{mined:materialProvenance.mined,donated:materialProvenance.donated,owned:materialProvenance.owned,bought:materialProvenance.bought})});
  return reconcileProfitLedger(record.characterId).find((row)=>row.id===record.id)??record;
}

export function getProfitPurchaseReview(recordId:string){
  const record=recordById(String(recordId));
  const snapshot=getSnapshot(record.characterId) as any;
  if(!snapshot)throw new Error("Sync the owning character before reviewing material purchases.");
  const requirements=new Map(materialRequirements(record).map((row)=>[row.typeId,row]));
  const floor=productionFloor(record);
  const projectFloor=Date.parse(String(record.metadata?.projectCreatedAt??""));
  const selected=new Set((record.purchaseAllocations??[]).map((row)=>positiveInt(row.walletTransactionId)).filter(Boolean));
  const all=listOpportunityProfitRecords(record.characterId) as ProfitLedgerRecord[];
  const reservedByOthers=new Set<number>();
  for(const other of all){
    if(other.id===record.id)continue;
    for(const row of other.purchaseAllocations??[])reservedByOthers.add(positiveInt(row.walletTransactionId));
    for(const id of asArray<number>(other.metadata?.materialPurchaseTransactionIds))reservedByOthers.add(positiveInt(id));
  }
  const candidates:ProfitPurchaseCandidate[]=snapshotWalletTransactions(snapshot).flatMap((row)=>{
    const id=positiveInt(row.transaction_id),typeId=positiveInt(row.type_id),quantity=positiveInt(row.quantity),unitPrice=Math.max(0,Number(row.unit_price??0)),req=requirements.get(typeId);
    if(!id||row.is_buy!==true||!req||!quantity)return[];
    const at=Date.parse(String(row.date??""));
    if(!Number.isFinite(at)||(floor!=null&&at>floor)||(Number.isFinite(projectFloor)&&at<projectFloor-5*60_000))return[];
    return[{walletTransactionId:id,date:String(row.date??""),typeId,materialName:req.name,quantity,unitPrice,cost:quantity*unitPrice,walletScope:row._walletScope??"character",walletDivision:row._walletDivision,selected:selected.has(id),reservedByOther:reservedByOthers.has(id)}];
  }).sort((a,b)=>Number(b.selected)-Number(a.selected)||Number(a.reservedByOther)-Number(b.reservedByOther)||Date.parse(b.date)-Date.parse(a.date));
  return{recordId:record.id,characterId:record.characterId,title:record.title,candidates};
}

export function setProfitPurchaseTransactionOverride(input:{recordId:string;walletTransactionId:number;assigned:boolean}){
  const record=recordById(String(input.recordId));
  const snapshot=getSnapshot(record.characterId) as any;
  if(!snapshot)throw new Error("Sync the owning character before changing material purchases.");
  const txId=positiveInt(input.walletTransactionId);
  if(!txId)throw new Error("A valid wallet transaction is required.");
  const row=snapshotWalletTransactions(snapshot).find((candidate)=>positiveInt(candidate.transaction_id)===txId);
  if(!row||row.is_buy!==true)throw new Error("That synced wallet purchase is no longer available.");
  if(!materialRequirements(record).some((item)=>item.typeId===positiveInt(row.type_id)))throw new Error("That purchase is not part of this production lot BOM.");
  if(input.assigned){
    const owner=(listOpportunityProfitRecords(record.characterId) as ProfitLedgerRecord[]).find((other)=>other.id!==record.id&&((other.purchaseAllocations??[]).some((allocation)=>positiveInt(allocation.walletTransactionId)===txId)||asArray<number>(other.metadata?.materialPurchaseTransactionIds).some((id)=>positiveInt(id)===txId)));
    if(owner)throw new Error("Purchase transaction "+txId+" is already owned by "+owner.title+". Release it there before reassigning it.");
  }
  const manual=new Set(asArray<number>(record.metadata?.materialPurchaseTransactionIds).map(positiveInt).filter(Boolean));
  const rejected=new Set(asArray<number>(record.metadata?.rejectedMaterialPurchaseTransactionIds).map(positiveInt).filter(Boolean));
  if(input.assigned){manual.add(txId);rejected.delete(txId);}else{manual.delete(txId);rejected.add(txId);}
  const purchaseAllocations=input.assigned?(record.purchaseAllocations??[]):(record.purchaseAllocations??[]).filter((allocation)=>positiveInt(allocation.walletTransactionId)!==txId);
  saveOpportunityProfitRecord({...record,purchaseAllocations,metadata:auditMetadata({...record.metadata,materialPurchaseTransactionIds:[...manual],rejectedMaterialPurchaseTransactionIds:[...rejected]},input.assigned?"material-purchase-assigned":"material-purchase-rejected",{walletTransactionId:txId})});
  const rows=reconcileProfitLedger(record.characterId);
  return{record:rows.find((candidate)=>candidate.id===record.id)??record,review:getProfitPurchaseReview(record.id)};
}

export function applyProfitBulkBookkeeping(input:{recordIds:string[];matchDecision?:"confirmed"|"rejected";transactionDecisions?:Array<{recordId:string;walletTransactionId:number;decision:"confirmed"|"rejected"}>;provenance?:{mined:boolean;donated:boolean;owned:boolean;bought:boolean}}){
  const transactionDecisions=asArray<{recordId:string;walletTransactionId:number;decision:"confirmed"|"rejected"}>(input.transactionDecisions).flatMap((row)=>{
    const recordId=String(row?.recordId??"").trim(),walletTransactionId=positiveInt(row?.walletTransactionId),decision=row?.decision;
    return recordId&&walletTransactionId&&(decision==="confirmed"||decision==="rejected")?[{recordId,walletTransactionId,decision}]:[];
  });
  const ids=[...new Set([...asArray<string>(input.recordIds).map(String).filter(Boolean),...transactionDecisions.map((row)=>row.recordId)])];
  if(!ids.length)return[];
  const affected=new Set<string>();
  for(const id of ids){
    const record=recordById(id);
    affected.add(record.characterId);
    let next:ProfitLedgerRecord={...record};
    let metadata={...(record.metadata??{})};
    const recordDecisions=transactionDecisions.filter((row)=>row.recordId===id);
    const allDecisionIds=input.matchDecision?(record.allocations??[]).map((row)=>({walletTransactionId:positiveInt(row.walletTransactionId),decision:input.matchDecision!})):[];
    const decisions=[...allDecisionIds,...recordDecisions];
    if(decisions.length){
      const manual=new Set(asArray<number>(metadata.walletTransactionIds).map(positiveInt).filter(Boolean));
      const confirmed=new Set(asArray<number>(metadata.confirmedWalletTransactionIds).map(positiveInt).filter(Boolean));
      const rejected=new Set(asArray<number>(metadata.rejectedWalletTransactionIds).map(positiveInt).filter(Boolean));
      const rejectedNow=new Set<number>();
      for(const item of decisions){
        const txId=positiveInt(item.walletTransactionId); if(!txId)continue;
        if(item.decision==="confirmed"){manual.add(txId);confirmed.add(txId);rejected.delete(txId);}
        else{manual.delete(txId);confirmed.delete(txId);rejected.add(txId);rejectedNow.add(txId);}
      }
      metadata={...metadata,walletTransactionIds:[...manual],confirmedWalletTransactionIds:[...confirmed],rejectedWalletTransactionIds:[...rejected]};
      if(rejectedNow.size)next.allocations=(record.allocations??[]).filter((row)=>!rejectedNow.has(positiveInt(row.walletTransactionId)));
    }
    if(input.provenance&&record.source==="industry")next.materialProvenance={mined:Boolean(input.provenance.mined),donated:Boolean(input.provenance.donated),owned:Boolean(input.provenance.owned),bought:Boolean(input.provenance.bought),updatedAt:new Date().toISOString()};
    metadata=auditMetadata(metadata,"bulk-bookkeeping",{matchDecision:input.matchDecision??null,transactionDecisions:recordDecisions,provenance:input.provenance??null});
    saveOpportunityProfitRecord({...next,metadata});
  }
  const output:ProfitLedgerRecord[]=[];
  for(const characterId of affected)output.push(...reconcileProfitLedger(characterId));
  return output;
}
