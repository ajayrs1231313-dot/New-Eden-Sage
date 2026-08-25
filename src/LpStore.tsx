import { useEffect, useMemo, useState } from "react";
import type { CharacterSnapshot } from "./types";
import { appendShoppingList, OPEN_SHOPPING_LIST_PENDING_KEY } from "./shopping-list";
import "./lp-store.css";

type HubName = "Best" | "Jita" | "Amarr" | "Dodixie" | "Rens" | "Hek";
type NamedHub = Exclude<HubName, "Best">;
type SaleMode = "quick" | "patient";
type LpBalance = { corporation_id: number; loyalty_points: number };
type CorpName = { corporationId: number; corporationName: string };
type RequiredItem = { typeId:number; name:string; quantity:number; unitMarketCost:number|null; marketCost:number|null };
type HubMetric = {
  hub:NamedHub; systemId:number; quickProceeds:number|null; quickUnitPrice:number|null; quickCoveredUnits:number; quickCoveragePercent:number;
  patientProceeds:number|null; patientUnitPrice:number|null; buyDepthUnits:number; sellDepthUnits:number; buyOrderCount:number; sellOrderCount:number; spreadPercent:number|null;
};
type Offer = {
  offerId:number; outputTypeId:number; outputName:string; outputQuantity:number; lpCost:number; iskCost:number; akCost:number;
  requiredItems:RequiredItem[]; requiredItemsCost:number|null; requiredItemsFullyPriced:boolean; capitalRequired:number|null;
  categoryName:string; groupName:string; packagedVolumeM3:number; isBlueprint:boolean; hubs:Record<NamedHub,HubMetric>;
  bestHub:NamedHub|null; bestQuickHub:NamedHub|null; bestPatientHub:NamedHub|null; quickProceeds:number|null; patientProceeds:number|null;
  quickNetProfit:number|null; patientNetProfit:number|null; quickIskPerLp:number|null; patientIskPerLp:number|null; roiPercent:number|null; marketValue:number|null;
  dailyVolume:number|null; saleTimeDays:number|null; saleTimeLabel:string; liquidityLabel:string; score:number;
  scoreComponents:{profitability:number;liquidity:number;absoluteProfit:number;capitalEfficiency:number;stability:number;confidence:number};
  classifications:string[]; warnings:string[];
};
type Analysis = { corporationId:number; corporationName:string; generatedAt:string; marketAsOf:string|null; hubSystems:Array<{name:NamedHub;systemId:number}>; offers:Offer[]; warnings:string[] };
type RouteRow = {systemId:number;systemName:string;jumps:number;withinRange:boolean};
type EarnCandidate = { corporationId:number; corporationName:string; factionId:number|null; factionName:string|null; standingEntity:"npc_corp"|"faction"|null; standingName:string|null; standingValue:number|null; corporationStanding:number|null; factionStanding:number|null; blockedByLowStanding:boolean; indicativeAgentLevel:number; accessLabel:string; stationCount:number; stagingSystems:Array<{systemId:number;systemName:string;stationCount:number}>; hasCurrentLp:boolean };
type EarnRow = EarnCandidate & { bestOffer?:Offer; quickRate:number|null; patientRate:number|null; routeJumps:number|null; routeSystem:string|null; error?:string };

type Props = {
  snapshot?: CharacterSnapshot;
  marketDataRevision:number;
  onOpenShoppingList():void;
  onOpenIndustry():void;
};

const HUBS: HubName[] = ["Best","Jita","Amarr","Dodixie","Rens","Hek"];
const int = new Intl.NumberFormat("en-GB",{maximumFractionDigits:0});
const compact = new Intl.NumberFormat("en-GB",{notation:"compact",maximumFractionDigits:2});
const pct = new Intl.NumberFormat("en-GB",{maximumFractionDigits:1});
const isk = (value:number|null|undefined) => value == null || !Number.isFinite(value) ? "—" : `${compact.format(value)} ISK`;
const iskFull = (value:number|null|undefined) => value == null || !Number.isFinite(value) ? "—" : `${int.format(value)} ISK`;
const iskLp = (value:number|null|undefined) => value == null || !Number.isFinite(value) ? "—" : `${int.format(value)} ISK/LP`;
const icon = (typeId:number) => `sage-asset://type/${typeId}/icon?size=64`;
const offerKey = (offer:Offer) => String(offer.offerId);

function asBalances(snapshot?:CharacterSnapshot):LpBalance[]{
  const value=(snapshot?.extended as any)?.loyaltyPoints;
  if(!Array.isArray(value)) return [];
  return value.map((row:any)=>({corporation_id:Number(row?.corporation_id??0),loyalty_points:Math.max(0,Math.floor(Number(row?.loyalty_points??0)||0))}))
    .filter(row=>row.corporation_id>0&&row.loyalty_points>0)
    .sort((a,b)=>b.loyalty_points-a.loyalty_points);
}

function ownedByType(snapshot?:CharacterSnapshot){
  const map=new Map<number,number>();
  const assets=Array.isArray(snapshot?.extended?.assets)?snapshot!.extended!.assets!:[];
  for(const row of assets as any[]){
    const typeId=Number(row?.type_id??0); const quantity=Math.max(0,Math.floor(Number(row?.quantity??0)||0));
    if(typeId>0&&quantity>0) map.set(typeId,(map.get(typeId)??0)+quantity);
  }
  return map;
}

function selectedMetric(offer:Offer, hub:HubName, mode:SaleMode):HubMetric|null{
  if(hub!=="Best") return offer.hubs[hub]??null;
  const name=mode==="quick"?offer.bestQuickHub:offer.bestPatientHub;
  return name?offer.hubs[name]??null:null;
}
function proceedsOf(offer:Offer,hub:HubName,mode:SaleMode){const metric=selectedMetric(offer,hub,mode);return mode==="quick"?metric?.quickProceeds??null:metric?.patientProceeds??null;}
function capitalOf(offer:Offer){return offer.capitalRequired;}
function profitOf(offer:Offer,hub:HubName,mode:SaleMode){const proceeds=proceedsOf(offer,hub,mode);const capital=capitalOf(offer);return proceeds==null||capital==null?null:proceeds-capital;}
function iskLpOf(offer:Offer,hub:HubName,mode:SaleMode){const profit=profitOf(offer,hub,mode);return profit==null||offer.lpCost<=0?null:profit/offer.lpCost;}

function maxAffordableRedemptions(offer:Offer,lpBalance:number,wallet:number,owned:Map<number,number>){
  if(offer.lpCost<=0) return 0;
  const maxLp=Math.max(0,Math.floor(lpBalance/offer.lpCost));
  if(!maxLp) return 0;
  const cost=(quantity:number)=>{
    let total=quantity*offer.iskCost;
    for(const item of offer.requiredItems){
      const needed=Math.max(0,quantity*item.quantity-(owned.get(item.typeId)??0));
      if(needed&&item.unitMarketCost==null) return Infinity;
      total+=needed*Number(item.unitMarketCost??0);
    }
    return total;
  };
  let low=0,high=maxLp;
  while(low<high){const mid=Math.ceil((low+high)/2);if(cost(mid)<=wallet)low=mid;else high=mid-1;}
  return low;
}

type BasketRow={offerId:number;quantity:number};
function optimizeBasket(offers:Offer[],lpBalance:number,wallet:number,ownedInput:Map<number,number>,hub:HubName,mode:SaleMode):BasketRow[]{
  let lpLeft=lpBalance; let walletLeft=Math.max(0,wallet); const owned=new Map(ownedInput); const out:BasketRow[]=[];
  const candidates=offers.filter(offer=>!offer.isBlueprint&&offer.lpCost>0&&offer.score>=35&&(profitOf(offer,hub,mode)??0)>0)
    .sort((a,b)=>b.score-a.score||(iskLpOf(b,hub,mode)??-Infinity)-(iskLpOf(a,hub,mode)??-Infinity));
  const purchaseCost=(offer:Offer,quantity:number)=>{
    let total=quantity*offer.iskCost;
    for(const item of offer.requiredItems){const need=Math.max(0,quantity*item.quantity-(owned.get(item.typeId)??0));if(need&&item.unitMarketCost==null)return Infinity;total+=need*Number(item.unitMarketCost??0);}return total;
  };
  for(const offer of candidates){
    if(lpLeft<offer.lpCost) continue;
    const metric=selectedMetric(offer,hub,mode); if(!metric) continue;
    const depth=mode==="quick"?metric.buyDepthUnits:Math.max(metric.buyDepthUnits,metric.sellDepthUnits);
    const impactFraction=mode==="quick"?0.35:0.15;
    const depthCap=Math.max(1,Math.floor((depth*impactFraction)/Math.max(1,offer.outputQuantity)));
    const lpCap=Math.floor(lpLeft/offer.lpCost); const upper=Math.min(depthCap,lpCap,5000); if(upper<=0)continue;
    let low=0,high=upper;while(low<high){const mid=Math.ceil((low+high)/2);if(purchaseCost(offer,mid)<=walletLeft)low=mid;else high=mid-1;}const take=low;if(!take)continue;
    const cash=purchaseCost(offer,take); walletLeft-=cash; lpLeft-=take*offer.lpCost;
    for(const item of offer.requiredItems){const need=take*item.quantity;const have=owned.get(item.typeId)??0;owned.set(item.typeId,Math.max(0,have-need));}
    out.push({offerId:offer.offerId,quantity:take});
  }
  return out;
}

export function LpStore({snapshot,marketDataRevision,onOpenShoppingList,onOpenIndustry}:Props){
  const balances=useMemo(()=>asBalances(snapshot),[snapshot]);
  const owned=useMemo(()=>ownedByType(snapshot),[snapshot]);
  const [names,setNames]=useState<Record<number,string>>({});
  const [corporationId,setCorporationId]=useState<number|null>(null);
  const [analysisByCorp,setAnalysisByCorp]=useState<Record<number,Analysis>>({});
  const [loading,setLoading]=useState(false);
  const [status,setStatus]=useState("");
  const [hub,setHub]=useState<HubName>("Best");
  const [saleMode,setSaleMode]=useState<SaleMode>("patient");
  const [query,setQuery]=useState("");
  const [filter,setFilter]=useState("ALL");
  const [sort,setSort]=useState<"score"|"isklp"|"profit"|"liquidity">("score");
  const [advanced,setAdvanced]=useState(false);
  const [expanded,setExpanded]=useState<number|null>(null);
  const [basket,setBasket]=useState<Record<number,number>>({});
  const [routes,setRoutes]=useState<Record<number,RouteRow>>({});
  const [bpcPlans,setBpcPlans]=useState<Record<number,{loading?:boolean;plan?:any;error?:string}>>({});
  const [earnRows,setEarnRows]=useState<EarnRow[]>([]);
  const [earnBusy,setEarnBusy]=useState(false);
  const [earnStatus,setEarnStatus]=useState("");

  useEffect(()=>{
    const first=balances[0]?.corporation_id??null;
    if(corporationId==null||!balances.some(row=>row.corporation_id===corporationId)) setCorporationId(first);
    setBasket({}); setExpanded(null); setStatus(""); setEarnRows([]); setEarnStatus("");
  },[snapshot?.characterId]);

  useEffect(()=>{
    const ids=balances.map(row=>row.corporation_id); if(!ids.length){setNames({});return;}
    let cancelled=false;
    void window.sage.getLpCorporations(ids).then((rows:CorpName[])=>{if(cancelled)return;setNames(Object.fromEntries(rows.map(row=>[row.corporationId,row.corporationName])));})
      .catch(()=>{if(!cancelled)setNames(Object.fromEntries(ids.map(id=>[id,`Corporation ${id}`])));});
    return()=>{cancelled=true;};
  },[snapshot?.characterId,balances.map(row=>row.corporation_id).join(",")]);

  useEffect(()=>{
    if(!corporationId)return; let cancelled=false;setLoading(true);setStatus("");
    void window.sage.getLpStoreOffers(corporationId, marketDataRevision).then((result:Analysis)=>{if(cancelled)return;setAnalysisByCorp(current=>({...current,[corporationId]:result}));setLoading(false);})
      .catch(error=>{if(cancelled)return;setLoading(false);setStatus(error instanceof Error?error.message:"LP Store intelligence could not be loaded.");});
    return()=>{cancelled=true;};
  },[corporationId,marketDataRevision]);

  const analysis=corporationId?analysisByCorp[corporationId]:undefined;
  useEffect(()=>{
    const offer=analysis?.offers.find(row=>row.offerId===expanded);
    if(!offer?.isBlueprint||bpcPlans[offer.offerId])return;
    let cancelled=false;setBpcPlans(current=>({...current,[offer.offerId]:{loading:true}}));
    void window.sage.getManufacturingPlan({characterId:snapshot?.characterId,blueprintTypeId:offer.outputTypeId,runs:1,availableRuns:1})
      .then((plan:any)=>{if(!cancelled)setBpcPlans(current=>({...current,[offer.offerId]:{plan}}));})
      .catch((error:any)=>{if(!cancelled)setBpcPlans(current=>({...current,[offer.offerId]:{error:error instanceof Error?error.message:"Manufacturing baseline unavailable."}}));});
    return()=>{cancelled=true;};
  },[expanded,analysis?.corporationId,snapshot?.characterId]);
  useEffect(()=>{
    if(!snapshot?.location?.solar_system_name||!analysis?.hubSystems.length)return; let cancelled=false;
    void window.sage.getIndustrialOpportunityRouteScope({systemQuery:snapshot.location.solar_system_name,targetSystemIds:analysis.hubSystems.map(row=>row.systemId),maxJumps:50})
      .then((result:any)=>{if(cancelled)return;setRoutes(Object.fromEntries((Array.isArray(result?.routes)?result.routes:[]).map((row:RouteRow)=>[row.systemId,row])));})
      .catch(()=>{if(!cancelled)setRoutes({});});
    return()=>{cancelled=true;};
  },[snapshot?.location?.solar_system_name,analysis?.corporationId]);

  if(!snapshot)return <section className="lp-store-empty"><p className="eyebrow">LP STORE</p><h2>Connect a character to analyse loyalty points</h2><p>Sage uses the selected character's synced LP, wallet and assets.</p></section>;
  if(!balances.length)return <section className="lp-store-empty"><p className="eyebrow">LP STORE</p><h2>No loyalty-point balances in the synced snapshot</h2><p>Run a normal character sync after earning LP. Opening this tab does not force another sync.</p></section>;

  const activeBalance=balances.find(row=>row.corporation_id===corporationId)?.loyalty_points??0;
  const offers=analysis?.offers??[];
  const classificationOptions=["ALL","BEST PICK","FAST SALE","INSTANT CASH","LOW VOLUME","THIN MARKET","PRICE SPIKE","BPC"];
  const visibleOffers=offers.filter(offer=>{
    const needle=query.trim().toLowerCase(); if(needle&&!`${offer.outputName} ${offer.groupName} ${offer.requiredItems.map(item=>item.name).join(" ")}`.toLowerCase().includes(needle))return false;
    return filter==="ALL"||offer.classifications.includes(filter);
  }).sort((a,b)=>{
    if(sort==="score")return b.score-a.score;
    if(sort==="isklp")return (iskLpOf(b,hub,saleMode)??-Infinity)-(iskLpOf(a,hub,saleMode)??-Infinity);
    if(sort==="profit")return (profitOf(b,hub,saleMode)??-Infinity)-(profitOf(a,hub,saleMode)??-Infinity);
    const rank=(x:Offer)=>x.liquidityLabel==="High"?3:x.liquidityLabel==="Moderate"?2:x.liquidityLabel==="Thin"?1:0;return rank(b)-rank(a)||b.score-a.score;
  });
  const bestQuickOffer=offers.filter(row=>row.quickIskPerLp!=null).sort((a,b)=>(b.quickIskPerLp??-Infinity)-(a.quickIskPerLp??-Infinity))[0];
  const bestPatientOffer=offers.filter(row=>row.patientIskPerLp!=null).sort((a,b)=>(b.patientIskPerLp??-Infinity)-(a.patientIskPerLp??-Infinity))[0];
  const totalLp=balances.reduce((sum,row)=>sum+row.loyalty_points,0);

  function addToPlan(offer:Offer,delta=1){setBasket(current=>{const next=Math.max(0,(current[offer.offerId]??0)+delta);const copy={...current};if(next)copy[offer.offerId]=next;else delete copy[offer.offerId];return copy;});}
  function runOptimizer(){if(!analysis)return;const rows=optimizeBasket(analysis.offers,activeBalance,snapshot!.wallet,owned,hub,saleMode);setBasket(Object.fromEntries(rows.map(row=>[row.offerId,row.quantity])));setStatus(rows.length?`Optimised across ${rows.length} offer${rows.length===1?"":"s"} with market-depth caps to reduce self-impact.`:"No safely priced, profitable basket fits the current LP, capital and retained market depth.");}
  async function loadEarnRecommendations(){
    if(!snapshot||earnBusy)return;
    setEarnBusy(true); setEarnRows([]); setEarnStatus("Matching synced standings to authoritative mission-staging corporations...");
    try{
      const candidates=(await window.sage.getLpEarningCandidates((snapshot.extended as any)?.standings??[],balances.map(row=>row.corporation_id))) as EarnCandidate[];
      const shortlist=candidates.slice(0,8);
      const targetSystemIds=[...new Set(shortlist.flatMap(row=>row.stagingSystems.map(system=>system.systemId)))];
      let routeMap=new Map<number,RouteRow>();
      if(snapshot.location?.solar_system_name&&targetSystemIds.length){
        try{
          const routed=await window.sage.getIndustrialOpportunityRouteScope({systemQuery:snapshot.location.solar_system_name,targetSystemIds,maxJumps:100});
          routeMap=new Map((Array.isArray((routed as any)?.routes)?(routed as any).routes:[]).map((row:RouteRow)=>[Number(row.systemId),row]));
        }catch{}
      }
      const rows:EarnRow[]=[];
      for(let index=0;index<shortlist.length;index++){
        const candidate=shortlist[index];
        const routes=candidate.stagingSystems.map(system=>({system,route:routeMap.get(system.systemId)})).filter(item=>item.route&&Number.isFinite(item.route.jumps)).sort((a,b)=>Number(a.route!.jumps)-Number(b.route!.jumps));
        const nearest=routes[0];
        if(candidate.blockedByLowStanding){
          rows.push({...candidate,quickRate:null,patientRate:null,routeJumps:nearest?.route?.jumps??null,routeSystem:nearest?.system.systemName??candidate.stagingSystems[0]?.systemName??null});
          continue;
        }
        setEarnStatus("Pricing LP economics "+(index+1)+"/"+shortlist.length+": "+candidate.corporationName);
        try{
          const corpAnalysis=await window.sage.getLpStoreOffers(candidate.corporationId,marketDataRevision) as Analysis;
          setAnalysisByCorp(current=>({...current,[candidate.corporationId]:corpAnalysis}));
          const bestOffer=corpAnalysis.offers.find(offer=>!offer.isBlueprint&&offer.score>=35&&Math.max(offer.quickNetProfit??-Infinity,offer.patientNetProfit??-Infinity)>0)??corpAnalysis.offers.find(offer=>!offer.isBlueprint);
          rows.push({...candidate,bestOffer,quickRate:bestOffer?.quickIskPerLp??null,patientRate:bestOffer?.patientIskPerLp??null,routeJumps:nearest?.route?.jumps??null,routeSystem:nearest?.system.systemName??candidate.stagingSystems[0]?.systemName??null});
        }catch(error){
          rows.push({...candidate,quickRate:null,patientRate:null,routeJumps:nearest?.route?.jumps??null,routeSystem:nearest?.system.systemName??candidate.stagingSystems[0]?.systemName??null,error:error instanceof Error?error.message:"LP economics unavailable"});
        }
      }
      rows.sort((a,b)=>{const score=(row:EarnRow)=>(row.blockedByLowStanding?-1000:0)+(row.indicativeAgentLevel*8)+(row.bestOffer?.score??0)+(row.hasCurrentLp?5:0)-((row.routeJumps??20)*0.25);return score(b)-score(a);});
      setEarnRows(rows);
      setEarnStatus(rows.length?"Ranked by practical LP offer quality, standing tier and travel. Exact normal-agent availability is not claimed because the current CCP public dataset does not expose a dependable enumerable agent list.":"No standing-backed mission corporations were found for this character.");
    }catch(error){
      setEarnStatus(error instanceof Error?error.message:"LP earning recommendations could not be prepared.");
    }finally{
      setEarnBusy(false);
    }
  }
  const basketRows=Object.entries(basket).map(([id,quantity])=>({offer:offers.find(row=>row.offerId===Number(id)),quantity})).filter((row):row is {offer:Offer;quantity:number}=>Boolean(row.offer&&row.quantity>0));
  const plannedLp=basketRows.reduce((sum,row)=>sum+row.quantity*row.offer.lpCost,0);
  const plannedIsk=basketRows.reduce((sum,row)=>sum+row.quantity*row.offer.iskCost,0);
  const requirements=new Map<number,{typeId:number;name:string;required:number;owned:number;missing:number;unitCost:number|null}>();
  for(const row of basketRows)for(const item of row.offer.requiredItems){const current=requirements.get(item.typeId)??{typeId:item.typeId,name:item.name,required:0,owned:owned.get(item.typeId)??0,missing:0,unitCost:item.unitMarketCost};current.required+=row.quantity*item.quantity;current.missing=Math.max(0,current.required-current.owned);if(current.unitCost==null)current.unitCost=item.unitMarketCost;requirements.set(item.typeId,current);}
  const requirementRows=[...requirements.values()];
  const missingRows=requirementRows.filter(row=>row.missing>0);
  const missingCostKnown=missingRows.every(row=>row.unitCost!=null);
  const missingCost=missingCostKnown?missingRows.reduce((sum,row)=>sum+row.missing*Number(row.unitCost),0):null;
  const plannedRevenue=basketRows.reduce<number|null>((sum,row)=>{const proceeds=proceedsOf(row.offer,hub,saleMode);return sum==null||proceeds==null?null:sum+proceeds*row.quantity;},0);
  const plannedCapital=missingCost==null?null:plannedIsk+missingCost;
  const plannedProfit=plannedRevenue==null||plannedCapital==null?null:plannedRevenue-plannedCapital;
  const ready=basketRows.length>0&&plannedLp<=activeBalance&&plannedIsk<=snapshot.wallet&&missingRows.length===0;

  function exportMissing(){if(!missingRows.length){setStatus("This redemption plan already has every required item in the selected character's synced assets.");return;}const valid=missingRows.filter(row=>row.typeId>0&&row.missing>0);appendShoppingList(valid.map(row=>({typeId:row.typeId,name:row.name,quantity:row.missing})),"LP redemption ingredients exported to Shopping List.");sessionStorage.setItem(OPEN_SHOPPING_LIST_PENDING_KEY,"1");onOpenShoppingList();}
  async function recordCompleted(){if(!basketRows.length||plannedRevenue==null||plannedCapital==null||plannedProfit==null){setStatus("Sage needs a fully priced sale plan before it can record expected profit.");return;}const items=basketRows.map(row=>{const metric=selectedMetric(row.offer,hub,saleMode);const unit=saleMode==="quick"?metric?.quickUnitPrice:metric?.patientUnitPrice;return{typeId:row.offer.outputTypeId,name:row.offer.outputName,quantity:row.offer.outputQuantity*row.quantity,expectedUnitSell:unit??null};});try{await window.sage.completeProfitDeal({characterId:snapshot!.characterId,source:"lp-store",sourceKey:`lp:${corporationId}:${Date.now()}`,title:`${analysis?.corporationName??"LP Store"} conversion`,estimatedCost:plannedCapital,estimatedRevenue:plannedRevenue,estimatedProfit:plannedProfit,items,metadata:{lpSpent:plannedLp,saleMode,hub,basket:basketRows.map(row=>({offerId:row.offer.offerId,redemptions:row.quantity}))}});window.dispatchEvent(new Event("sage:profit-ledger-updated"));setStatus("LP conversion recorded in the shared Wallet profit ledger. Sync after the sale to reconcile actual revenue, tax and broker fees.");}catch(error){setStatus(error instanceof Error?error.message:"Could not record this LP conversion.");}}

  return <section className="lp-store-page">
    <header className="lp-store-head"><div><p className="eyebrow">LOYALTY POINT COMMAND</p><h2>{snapshot.character.name} · LP Store</h2><p>Turn retained LP into realistic redemption plans using your wallet, assets and Sage's retained market depth.</p></div><div className="lp-store-head-total"><span>Total LP</span><strong>{int.format(totalLp)}</strong><small>{balances.length} corporation{balances.length===1?"":"s"}</small></div></header>

    <div className="lp-summary-grid">
      <article><span>Selected LP</span><strong>{int.format(activeBalance)}</strong><small>{analysis?.corporationName??(corporationId?names[corporationId]:"")}</small></article>
      <article><span>Available capital</span><strong>{isk(snapshot.wallet)}</strong><small>Selected character wallet</small></article>
      <article><span>Best quick-cash rate</span><strong>{iskLp(bestQuickOffer?.quickIskPerLp)}</strong><small>{bestQuickOffer?`${bestQuickOffer.outputName} - optimizer limits quantity by depth`:"Analyse offers to price"}</small></article>
      <article><span>Best patient rate</span><strong>{iskLp(bestPatientOffer?.patientIskPerLp)}</strong><small>{bestPatientOffer?`${bestPatientOffer.outputName} - current ask, not full-balance promise`:"Analyse offers to price"}</small></article>
    </div>

    <section className="lp-corporations">
      <div className="section-heading"><div><p className="eyebrow">CHARACTER LP BALANCES</p><h3>Choose a corporation</h3></div></div>
      <div className="lp-corp-list">{balances.map(row=><button type="button" key={row.corporation_id} className={row.corporation_id===corporationId?"active":""} onClick={()=>setCorporationId(row.corporation_id)}><span><strong>{names[row.corporation_id]??`Corporation ${row.corporation_id}`}</strong><small>{row.corporation_id===corporationId&&analysis?`${analysis.offers.length} offers analysed`:"Select to analyse offers"}</small></span><strong>{int.format(row.loyalty_points)} LP</strong></button>)}</div>
    </section>

    <section className="lp-command-bar">
      <div className="lp-mode-toggle"><button type="button" className={saleMode==="quick"?"active":""} onClick={()=>setSaleMode("quick")}><strong>Quick cash</strong><span>Sell into retained buy depth</span></button><button type="button" className={saleMode==="patient"?"active":""} onClick={()=>setSaleMode("patient")}><strong>Patient / max profit</strong><span>Use current sell-order pricing</span></button></div>
      <div className="lp-hubs" aria-label="LP market hub"><span>Market</span>{HUBS.map(name=><button type="button" key={name} className={hub===name?"active":""} onClick={()=>setHub(name)}>{name}</button>)}</div>
      <button type="button" className="primary lp-optimize" disabled={!analysis||loading} onClick={runOptimizer}>Optimise My LP</button>
    </section>

    {status&&<div className="lp-status">{status}</div>}
    {loading&&<div className="lp-loading"><strong>Preparing LP intelligence…</strong><span>Using cached public LP offers and the latest market dataset already retained by Sage.</span></div>}
    {analysis&&<>
      <div className="lp-table-controls"><label><span>Find offer</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Reward or required item…"/></label><label><span>Class</span><select value={filter} onChange={event=>setFilter(event.target.value)}>{classificationOptions.map(value=><option key={value}>{value}</option>)}</select></label><label><span>Sort</span><select value={sort} onChange={event=>setSort(event.target.value as any)}><option value="score">Sage Score</option><option value="isklp">ISK / LP</option><option value="profit">Net profit</option><option value="liquidity">Liquidity</option></select></label><button type="button" className={advanced?"active":""} onClick={()=>setAdvanced(value=>!value)}>Advanced</button></div>
      <div className="lp-redemption-table"><div className="lp-redemption-head"><span>Offer</span><span>LP / ISK cost</span><span>Required items</span><span>Market value</span><span>Net profit</span><span>ISK / LP</span><span>ROI</span><span>Daily volume</span><span>Sale time</span><span>Redeemable</span><span>Sage Score</span><span></span></div>
        <div className="lp-redemption-body">{visibleOffers.map(offer=>{const metric=selectedMetric(offer,hub,saleMode);const profit=profitOf(offer,hub,saleMode);const conversion=iskLpOf(offer,hub,saleMode);const redeemable=maxAffordableRedemptions(offer,activeBalance,snapshot.wallet,owned);const currentHub=metric?.hub??offer.bestHub;const route=currentHub?routes[offer.hubs[currentHub].systemId]:undefined;return <article key={offer.offerId} className={expanded===offer.offerId?"expanded":""}>
          <div className="lp-offer-name"><img src={icon(offer.outputTypeId)} alt="" loading="lazy"/><span><strong>{offer.outputQuantity>1?`${offer.outputQuantity} × `:""}{offer.outputName}</strong><small>{offer.classifications.map(tag=><em key={tag} className={`lp-tag ${tag.toLowerCase().replaceAll(" ","-")}`}>{tag}</em>)}{currentHub&&<em className="lp-hub-tag">{currentHub}{route?` · ${route.jumps} jumps`:""}</em>}</small></span></div>
          <div><strong>{int.format(offer.lpCost)} LP</strong><small>{iskFull(offer.iskCost)}</small></div>
          <div className="lp-required"><strong>{offer.requiredItems.length?`${offer.requiredItems.length} type${offer.requiredItems.length===1?"":"s"}`:"None"}</strong><small>{offer.requiredItems.length?isk(offer.requiredItemsCost):"No ingredients"}</small></div>
          <div><strong>{isk(proceedsOf(offer,hub,saleMode))}</strong><small>{saleMode==="quick"?`${metric?.quickCoveragePercent??0}% buy-depth cover`:metric?.patientUnitPrice?`${iskFull(metric.patientUnitPrice)} / unit`:"No retained sell"}</small></div>
          <div><strong className={profit!=null&&profit>0?"positive":profit!=null&&profit<0?"negative":""}>{isk(profit)}</strong><small>Before character-specific fees</small></div>
          <div><strong>{iskLp(conversion)}</strong><small>{offer.liquidityLabel} liquidity</small></div>
          <div><strong>{offer.roiPercent==null?"—":`${pct.format(offer.roiPercent)}%`}</strong><small>on redemption capital</small></div>
          <div><strong>—</strong><small>Not retained</small></div>
          <div><strong>{saleMode==="quick"&&metric?.quickCoveragePercent===100?"Immediate":"—"}</strong><small>{offer.saleTimeLabel}</small></div>
          <div><strong>{int.format(redeemable)}</strong><small>{Math.floor(activeBalance/Math.max(1,offer.lpCost))} by LP</small></div>
          <div className={`lp-score score-${offer.score>=80?"high":offer.score>=55?"mid":"low"}`}><strong>{offer.score}</strong><small>/ 100</small></div>
          <div className="lp-row-actions"><button type="button" onClick={()=>addToPlan(offer)}>Plan</button><button type="button" onClick={()=>setExpanded(current=>current===offer.offerId?null:offer.offerId)}>{expanded===offer.offerId?"Less":"Details"}</button></div>
          {expanded===offer.offerId&&<div className="lp-offer-detail"><div className="lp-detail-grid"><div><span>Quick cash</span><strong>{isk(metric?.quickProceeds)}</strong><small>{metric?`${metric.quickCoveredUnits}/${offer.outputQuantity} units covered · ${int.format(metric.buyDepthUnits)} buy depth`:"No hub quote"}</small></div><div><span>Patient sale</span><strong>{isk(metric?.patientProceeds)}</strong><small>{metric?.patientUnitPrice?`${iskFull(metric.patientUnitPrice)} current ask · ${int.format(metric.sellDepthUnits)} sell depth`:"No retained ask"}</small></div><div><span>Cargo</span><strong>{compact.format(offer.packagedVolumeM3)} m³</strong><small>{currentHub&&route?`${route.jumps} jumps from ${snapshot.location.solar_system_name}`:"Route unavailable"}</small></div><div><span>Pricing confidence</span><strong>{int.format(offer.scoreComponents.confidence)}%</strong><small>{offer.requiredItemsFullyPriced?"Ingredients priced":"Missing ingredient pricing"}</small></div></div>
            {offer.requiredItems.length>0&&<div className="lp-detail-required"><strong>Redemption ingredients</strong>{offer.requiredItems.map(item=>{const have=owned.get(item.typeId)??0;return <span key={item.typeId}>{item.name}<small>{item.quantity} required · {int.format(have)} owned · {isk(item.marketCost)}</small></span>;})}</div>}
            {advanced&&<>
              <div className="lp-score-breakdown"><span>Profitability <strong>{int.format(offer.scoreComponents.profitability)}</strong></span><span>Liquidity <strong>{int.format(offer.scoreComponents.liquidity)}</strong></span><span>Absolute profit <strong>{int.format(offer.scoreComponents.absoluteProfit)}</strong></span><span>Capital efficiency <strong>{int.format(offer.scoreComponents.capitalEfficiency)}</strong></span><span>Stability <strong>{int.format(offer.scoreComponents.stability)}</strong></span><span>Confidence <strong>{int.format(offer.scoreComponents.confidence)}</strong></span></div>
              <div className="lp-hub-compare"><div className="lp-hub-compare-head"><strong>Hub comparison</strong><span>Profit includes LP-store ISK + required-item market cost; fees and hauling are not deducted.</span></div>{(["Jita","Amarr","Dodixie","Rens","Hek"] as NamedHub[]).map(name=>{const hm=offer.hubs[name];const hp=profitOf(offer,name,saleMode);const hi=iskLpOf(offer,name,saleMode);const rr=routes[hm.systemId];const bestProfit=Math.max(...(["Jita","Amarr","Dodixie","Rens","Hek"] as NamedHub[]).map(other=>profitOf(offer,other,saleMode)??-Infinity));const isBest=hp!=null&&hp===bestProfit;return <div key={name} className={isBest?"best":""}><span><strong>{name}</strong>{isBest&&<em>BEST HUB</em>}</span><span><strong>{isk(hp)}</strong><small>{iskLp(hi)}</small></span><span><strong>{rr?`${rr.jumps} jumps`:"Route n/a"}</strong><small>{compact.format(offer.packagedVolumeM3)} m3 cargo</small></span><span><strong>{saleMode==="quick"?`${Math.round(hm.quickCoveragePercent)}% cover`:hm.spreadPercent==null?"Spread n/a":`${pct.format(hm.spreadPercent)}% spread`}</strong><small>{int.format(saleMode==="quick"?hm.buyDepthUnits:hm.sellDepthUnits)} units depth</small></span></div>;})}</div>
            </>}
            {offer.warnings.length>0&&<div className="lp-warnings">{offer.warnings.map(note=><span key={note}>{note}</span>)}</div>}
            {offer.isBlueprint&&(()=>{const state=bpcPlans[offer.offerId];const plan=state?.plan;const economicCost=plan?.market?.fullBomMarketCost??null;const revenue=plan?.market?.immediateSaleRevenue??null;const redemptionCapital=offer.capitalRequired;const buildProfit=economicCost!=null&&revenue!=null&&redemptionCapital!=null?revenue-economicCost-redemptionCapital:null;const buildIskLp=buildProfit!=null&&offer.lpCost>0?buildProfit/offer.lpCost:null;return <div className="lp-bpc-panel"><div><span>BPC manufacture baseline</span><strong>{state?.loading?"Preparing 1-run baseline...":plan?`${plan.productName} - ${iskLp(buildIskLp)}`:"Manufacturing baseline unavailable"}</strong><small>{plan?`1 run at ME 0 / TE 0: ${isk(revenue)} immediate output revenue, ${isk(economicCost)} full BOM. Public LP-offer data does not expose copy runs/ME/TE, so this is a conservative per-run baseline.`:state?.error??"Sage will not invent a public BPC sale price."}</small></div>{buildProfit!=null&&buildProfit>0&&<em className="lp-tag build-it">BUILD IT</em>}<button type="button" className="lp-industry-action" onClick={()=>{sessionStorage.setItem("new-eden-sage-lp-industry-handoff-v1",JSON.stringify({characterId:snapshot.characterId,blueprintTypeId:offer.outputTypeId,targetQuantity:plan?.outputQuantity??1,sentAt:Date.now()}));onOpenIndustry();}}>Send to Industry</button></div>;})()}
          </div>}
        </article>;})}{!visibleOffers.length&&!loading&&<div className="lp-no-results">No offers match the current filters.</div>}</div>
      </div>
      <div className="lp-data-note"><strong>Market basis</strong><span>{analysis.marketAsOf?`Retained market snapshot ${new Date(analysis.marketAsOf).toLocaleString()}. `:"No retained market timestamp. "}{analysis.warnings.join(" ")}</span></div>
    </>}

    <section className={`lp-planner ${basketRows.length?"has-plan":""}`}><div className="section-heading"><div><p className="eyebrow">REDEMPTION PLANNER</p><h3>{basketRows.length?"Your LP basket":"Build a redemption basket"}</h3><p>Optimise the whole balance or add individual offers. Ingredient ownership is checked only against this character.</p></div>{basketRows.length>0&&<button type="button" onClick={()=>setBasket({})}>Clear plan</button>}</div>
      {basketRows.length>0?<><div className="lp-plan-summary"><article><span>LP spent</span><strong>{int.format(plannedLp)}</strong><small>{int.format(Math.max(0,activeBalance-plannedLp))} left</small></article><article><span>ISK / material capital</span><strong>{isk(plannedCapital)}</strong><small>{isk(plannedIsk)} direct ISK cost</small></article><article><span>Expected revenue</span><strong>{isk(plannedRevenue)}</strong><small>{saleMode==="quick"?"Quick cash":"Patient sale"} · {hub}</small></article><article><span>Expected net profit</span><strong className={plannedProfit!=null&&plannedProfit>=0?"positive":"negative"}>{isk(plannedProfit)}</strong><small>{plannedLp>0&&plannedProfit!=null?iskLp(plannedProfit/plannedLp):"—"}</small></article></div>
        <div className="lp-plan-lines">{basketRows.map(({offer,quantity})=><article key={offer.offerId}><div><img src={icon(offer.outputTypeId)} alt=""/><span><strong>{quantity} × {offer.outputName}</strong><small>{int.format(quantity*offer.lpCost)} LP · produces {int.format(quantity*offer.outputQuantity)} units</small></span></div><label><span>Redemptions</span><input type="number" min="1" value={quantity} onChange={event=>setBasket(current=>({...current,[offer.offerId]:Math.max(1,Math.floor(Number(event.target.value)||1))}))}/></label><button type="button" onClick={()=>addToPlan(offer,-quantity)}>Remove</button></article>)}</div>
        <div className="lp-readiness"><div className={ready?"ready":"not-ready"}><span>{ready?"READY TO REDEEM":"REDEMPTION PREP"}</span><strong>{ready?"All required ingredients are owned":"Missing items or capital remain"}</strong><small>{int.format(plannedLp)} LP · {isk(plannedIsk)} direct ISK · {requirementRows.length} required item type{requirementRows.length===1?"":"s"}</small></div><div className="lp-readiness-actions"><button type="button" className="primary" disabled={!missingRows.length} onClick={exportMissing}>Export Missing to Shopping List</button><button type="button" disabled={plannedRevenue==null||plannedCapital==null} onClick={()=>void recordCompleted()}>Record completed sale</button></div></div>
        {requirementRows.length>0&&<div className="lp-requirement-table"><div><span>Required item</span><span>Required</span><span>Owned</span><span>Missing</span><span>Missing cost</span></div>{requirementRows.map(row=><div key={row.typeId} className={row.missing?"missing":"owned"}><span><img src={icon(row.typeId)} alt=""/><strong>{row.name}</strong></span><span>{int.format(row.required)}</span><span>{int.format(row.owned)}</span><span>{int.format(row.missing)}</span><span>{row.missing?isk(row.unitCost==null?null:row.unitCost*row.missing):"—"}</span></div>)}</div>}
      </>:<div className="lp-plan-empty"><strong>No redemption plan yet</strong><span>Use Optimise My LP for a diversified basket, or choose Plan on an individual offer.</span></div>}
    </section>

    <section className="lp-earn-panel"><div className="lp-earn-head"><div><p className="eyebrow">WHERE SHOULD I EARN LP?</p><h3>Standing-aware LP earning recommendations</h3><p>On demand only: Sage matches synced standings to authoritative high-sec military mission-staging corporations, then prices their LP stores with the same realistic market model.</p></div><button type="button" disabled={earnBusy} onClick={()=>void loadEarnRecommendations()}>{earnBusy?"Analysing...":earnRows.length?"Refresh recommendations":"Analyse earning options"}</button></div>{earnStatus&&<div className="lp-earn-status">{earnStatus}</div>}{earnRows.length>0&&<div className="lp-earn-grid">{earnRows.map(row=><article key={row.corporationId} className={row.blockedByLowStanding?"blocked":""}><div className="lp-earn-title"><span><strong>{row.corporationName}</strong><small>{row.factionName??"Independent / faction unknown"}</small></span>{row.hasCurrentLp&&<em>CURRENT LP</em>}{row.blockedByLowStanding&&<em className="blocked">ACCESS BLOCK</em>}</div><div className="lp-earn-metrics"><span><small>Standing</small><strong>{row.standingValue==null?"Unknown":row.standingValue.toFixed(2)}</strong></span><span><small>Standing tier</small><strong>{row.blockedByLowStanding?"Blocked":"Up to L"+row.indicativeAgentLevel}</strong></span><span><small>Quick cash</small><strong>{iskLp(row.quickRate)}</strong></span><span><small>Patient</small><strong>{iskLp(row.patientRate)}</strong></span></div><p>{row.accessLabel}</p><small>{row.routeSystem?(row.routeSystem+(row.routeJumps!=null?" - "+row.routeJumps+" jumps":"")+" - "+row.stationCount+" military-corp station"+(row.stationCount===1?"":"s")):"Mission staging location unavailable"}{row.bestOffer?(" - best practical offer: "+row.bestOffer.outputName+" (Sage Score "+row.bestOffer.score+")"):""}{row.error?(" - "+row.error):""}</small></article>)}</div>}<div className="lp-earn-caveat">Mission staging is authoritative SDE location/owner data, but it is not a claim that a specific Level 2-5 agent is present. Sage will not invent agent availability the public data cannot prove.</div></section>
  </section>;
}
