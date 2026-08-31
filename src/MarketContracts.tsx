import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { MarketContractOpportunity, MarketContractSearchResult, MarketContractWorkspace } from "./types";
import { IskGlyph } from "./IskIcons";
import "./market-contracts-polish.css";

const money=(value:number|null|undefined)=>value==null?"â€”":new Intl.NumberFormat("en-GB",{maximumFractionDigits:0}).format(value);
const percent=(value:number|null|undefined)=>value==null?"â€”":`${value.toFixed(1)}%`;
const cargoVolume=(value:number|null|undefined)=>value==null||!Number.isFinite(value)?"â€”":new Intl.NumberFormat("en-GB",{maximumFractionDigits:2}).format(value);
type RecommendedExit={kind:"immediate"|"haul";profit:number;roi:number|null;revenue:number;system:string|null};
const recommendedExitFor=(row:MarketContractOpportunity):RecommendedExit|null=>{
  const immediate=row.immediateProfit==null?null:{kind:"immediate" as const,profit:row.immediateProfit,roi:row.immediateRoiPercent,revenue:row.immediateGross,system:row.systemName};
  const haul=row.bestBuyProfit==null?null:{kind:"haul" as const,profit:row.bestBuyProfit,roi:row.bestBuyRoiPercent,revenue:row.bestBuyGross,system:row.bestBuySystem};
  // Immediate means the contract can be liquidated profitably from its own location now.
  // A slightly better remote buy order must not turn an immediate arbitrage into a haul-only signal.
  if(immediate && immediate.profit>0)return immediate;
  if(haul && haul.profit>0)return haul;
  return immediate ?? haul;
};
const profitFor=(row:MarketContractOpportunity)=>recommendedExitFor(row)?.profit ?? Number.NEGATIVE_INFINITY;
const roiFor=(row:MarketContractOpportunity)=>recommendedExitFor(row)?.roi ?? Number.NEGATIVE_INFINITY;
let contractRefreshActive=false;
type SecurityKey="high"|"low"|"null"|"unknown";
type WorkspaceTab="search"|"profit";
const ALL_SECURITY:Record<SecurityKey,boolean>={high:true,low:true,null:true,unknown:true};

function contractTypeLabel(value:string){return value==="item_exchange"?"Item Exchange":value==="auction"?"Auction":value.replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());}
function availabilityLabel(value:string){return value.replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());}
function securityKey(row:MarketContractOpportunity):SecurityKey{return row.securityBand??"unknown";}
function million(value:string){if(!value.trim())return null;const parsed=Number(value);return Number.isFinite(parsed)&&parsed>=0?parsed*1_000_000:null;}

const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
function compactIsk(value:number|null|undefined){
  if(value==null||!Number.isFinite(value))return "—";
  const abs=Math.abs(value);const sign=value<0?"-":"";
  if(abs>=1_000_000_000)return sign+(abs/1_000_000_000).toFixed(abs>=10_000_000_000?1:2).replace(/\.0+$/,"").replace(/(\.\d)0$/,"$1")+"B";
  if(abs>=1_000_000)return sign+(abs/1_000_000).toFixed(abs>=100_000_000?0:abs>=10_000_000?1:2).replace(/\.0+$/,"").replace(/(\.\d)0$/,"$1")+"M";
  if(abs>=1_000)return sign+(abs/1_000).toFixed(abs>=100_000?0:1).replace(/\.0+$/,"")+"K";
  return sign+Math.round(abs).toLocaleString("en-GB");
}
function ageLabel(value:string|null|undefined){
  if(!value)return "Awaiting snapshot";
  const time=new Date(value).getTime();if(!Number.isFinite(time))return "Updated";
  const minutes=Math.max(0,Math.round((Date.now()-time)/60_000));
  if(minutes<1)return "just now";if(minutes<60)return minutes+" min ago";
  const hours=Math.floor(minutes/60);if(hours<24)return hours+"h "+(minutes%60)+"m ago";
  return Math.floor(hours/24)+"d "+(hours%24)+"h ago";
}
function expiryMeta(value:string){
  const remaining=new Date(value).getTime()-Date.now();
  if(!Number.isFinite(remaining))return {label:"Unknown",tone:"normal"};
  if(remaining<=0)return {label:"Expired",tone:"urgent"};
  const minutes=Math.floor(remaining/60_000);
  if(minutes<60)return {label:minutes+"m",tone:"urgent"};
  const hours=Math.floor(minutes/60);
  if(hours<24)return {label:hours+"h "+(minutes%60)+"m",tone:hours<3?"urgent":"warning"};
  const days=Math.floor(hours/24);return {label:days+"d "+(hours%24)+"h",tone:"normal"};
}
function signalScore(row:MarketContractOpportunity){return Math.round(clamp(Number.isFinite(row.score)?row.score:0,0,100));}
function signalTone(score:number){return score>=85?"excellent":score>=70?"good":score>=55?"steady":"watch";}
function signalLabel(score:number){return score>=90?"HIGH":score>=82?"VERY HIGH":score>=70?"HIGH":score>=55?"GOOD":"WATCH";}
function itemSummary(row:MarketContractOpportunity){
  const names=row.items.filter(item=>item.included).slice(0,2).map(item=>item.quantity+"× "+item.typeName);
  return names.join(" + ")+(row.receivedItemCount>2?" + "+(row.receivedItemCount-2)+" more":"");
}

export function MarketContracts({characterId,marketDataRevision}:{characterId?:string;marketDataRevision:number}){
  const [data,setData]=useState<MarketContractWorkspace|null>(null);
  const [searchResult,setSearchResult]=useState<MarketContractSearchResult>({total:0,rows:[]});
  const searchSequence=useRef(0);
  const [workspace,setWorkspace]=useState<WorkspaceTab>("search");
  const [searchDensity,setSearchDensity]=useState<"comfortable"|"compact">("comfortable");
  const [busy,setBusy]=useState(contractRefreshActive);
  const [status,setStatus]=useState("Preparing server data…");
  const [selected,setSelected]=useState<MarketContractOpportunity|null>(null);
  const [findingContractId,setFindingContractId]=useState<number|null>(null);
  const [findStatus,setFindStatus]=useState("");
  const [completionStatus,setCompletionStatus]=useState<Record<number,string>>({});

  const [itemSearch,setItemSearch]=useState("");
  const [regionId,setRegionId]=useState("all");
  const [locationSearch,setLocationSearch]=useState("");
  const [contractType,setContractType]=useState("all");
  const [category,setCategory]=useState("all");
  const [availability,setAvailability]=useState("all");
  const [issuerSearch,setIssuerSearch]=useState("");
  const [minPrice,setMinPrice]=useState("");
  const [maxPrice,setMaxPrice]=useState("");
  const [excludeMultiple,setExcludeMultiple]=useState(false);
  const [exactType,setExactType]=useState(false);
  const [cleanOnly,setCleanOnly]=useState(false);
  const [searchSecurity,setSearchSecurity]=useState<Record<SecurityKey,boolean>>({...ALL_SECURITY});

  const [opportunityMode,setOpportunityMode]=useState<"all"|"immediate"|"haul">("all");
  const [opportunitySort,setOpportunitySort]=useState<"profit"|"roi">("profit");
  const [opportunitySystem,setOpportunitySystem]=useState("");
  const [opportunitySecurity,setOpportunitySecurity]=useState<Record<SecurityKey,boolean>>({...ALL_SECURITY});
  const [minOpportunityProfit,setMinOpportunityProfit]=useState("");
  const [minOpportunityRoi,setMinOpportunityRoi]=useState("");

  async function load(){
    setBusy(true);
    try{
      const value=await window.sage.getContractMarketWorkspace();
      setData(value);
      setSearchResult(value.search);
      setStatus(value.contractsCreatedAt?`${value.counts.contracts.toLocaleString()} public buy/sell contracts loaded · ${value.counts.opportunities.toLocaleString()} strong opportunities.`:"No server-prepared public contract snapshot is installed yet. Refresh Contracts checks for the latest published generation.");
      setSelected(current=>current?(value.search.rows.find(row=>row.contractId===current.contractId)??value.opportunities.find(row=>row.contractId===current.contractId)??null):null);
    }catch(error){setData(null);setSearchResult({total:0,rows:[]});setStatus(error instanceof Error?error.message:"Contract data is unavailable.");}
    finally{setBusy(false);contractRefreshActive=false;}
  }
  useEffect(()=>{void load();},[marketDataRevision]);
  useEffect(()=>window.sage.onMarketProgress(progress=>{if(progress.mode!=="contracts")return;const complete=progress.regionsTotal>0&&progress.regionsDone>=progress.regionsTotal;contractRefreshActive=!complete;setBusy(!complete);setStatus(complete?"Contract data is ready.":`Preparing server data…`);}),[]);

  async function refresh(){
    contractRefreshActive=true;setBusy(true);setFindStatus("");setStatus("Preparing server data…");
    try{await window.sage.checkPublicData();await load();}
    catch(error){setStatus(error instanceof Error?error.message:"Contract refresh failed.");}
    finally{contractRefreshActive=false;setBusy(false);}
  }
  async function findInEve(row:MarketContractOpportunity){
    if(!characterId){setFindStatus("Select a connected character before using Find in EVE.");return;}
    setFindingContractId(row.contractId);setFindStatus(`Opening Contract ${row.contractId} in EVE...`);
    try{const result=await window.sage.openEveContract({characterId,contractId:row.contractId});setFindStatus(`Opened Contract ${row.contractId} in EVE for ${result.characterName}${result.usedFallback?" (online character)":""}.`);}
    catch(error){const raw=error instanceof Error?error.message:String(error);setFindStatus(raw.replace(/^Error invoking remote method .*?: Error: /,""));}
    finally{setFindingContractId(null);}
  }

  async function completeDeal(row:MarketContractOpportunity){
    if(!characterId){setCompletionStatus(current=>({...current,[row.contractId]:"Select the character that completed this deal."}));return;}
    const exit=recommendedExitFor(row); if(!exit){setCompletionStatus(current=>({...current,[row.contractId]:"No executable sale exit is available to record."}));return;}
    const estimatedCost=row.price+(row.requestedItemsFullyPriced?row.requestedItemCost:0);
    setCompletionStatus(current=>({...current,[row.contractId]:"Recording..."}));
    try{
      const record=await window.sage.completeProfitDeal({characterId,source:"contract",sourceKey:String(row.contractId),title:row.title||`Contract ${row.contractId}`,estimatedCost,estimatedRevenue:exit.revenue,estimatedProfit:exit.profit,items:row.items.filter(item=>item.included&&item.marketLiquidatable&&item.recoverableForResale).map(item=>({typeId:item.typeId,name:item.typeName,quantity:item.quantity})),metadata:{contractId:row.contractId,originSystem:row.systemName,exitSystem:exit.system,exitKind:exit.kind}});
      setCompletionStatus(current=>({...current,[row.contractId]:record.reconciliationStatus==="exact"?"Recorded — wallet sale matched.":"Recorded — awaiting/using synced wallet reconciliation."}));
      window.dispatchEvent(new Event("sage:profit-ledger-updated"));
    }catch(error){setCompletionStatus(current=>({...current,[row.contractId]:error instanceof Error?error.message:"Could not record this deal."}));}
  }

  const regions=data?.options.regions??[];
  const categories=data?.options.categories??[];
  const contractTypes=data?.options.contractTypes??["auction","item_exchange"];
  const availabilities=data?.options.availabilities??[];

  useEffect(()=>{
    if(!data)return;
    const sequence=++searchSequence.current;
    const timer=window.setTimeout(()=>{
      void window.sage.searchMarketContracts({
        itemSearch,regionId,locationSearch,contractType,category,availability,issuerSearch,
        minPrice:million(minPrice),maxPrice:million(maxPrice),excludeMultiple,exactType,cleanOnly,security:searchSecurity,limit:800,
      }).then(result=>{if(sequence===searchSequence.current)setSearchResult(result);}).catch(error=>{if(sequence===searchSequence.current)setStatus(error instanceof Error?error.message:"Contract search failed.");});
    },120);
    return()=>window.clearTimeout(timer);
  },[data?.generatedAt,itemSearch,regionId,locationSearch,contractType,category,availability,issuerSearch,minPrice,maxPrice,excludeMultiple,exactType,cleanOnly,searchSecurity]);

  const shownContracts=searchResult.rows;

  const visibleOpportunities=useMemo(()=>{
    const needle=opportunitySystem.trim().toLowerCase();
    const minProfit= million(minOpportunityProfit);
    const parsedRoi=Number(minOpportunityRoi);const minRoi=Number.isFinite(parsedRoi)&&minOpportunityRoi.trim()!==""?parsedRoi:null;
    const rows=(data?.opportunities??[]).filter(row=>{
      const recommended=recommendedExitFor(row);
      const modeMatch=opportunityMode==="all"||recommended?.kind===opportunityMode;
      const systemMatch=!needle||`${row.systemName} ${row.regionName} ${row.station}`.toLowerCase().includes(needle);
      return modeMatch&&systemMatch&&opportunitySecurity[securityKey(row)]&&(minProfit==null||profitFor(row)>=minProfit)&&(minRoi==null||roiFor(row)>=minRoi);
    });
    return [...rows].sort((a,b)=>opportunitySort==="roi"?roiFor(b)-roiFor(a)||profitFor(b)-profitFor(a):profitFor(b)-profitFor(a)||roiFor(b)-roiFor(a));
  },[data,opportunityMode,opportunitySort,opportunitySystem,opportunitySecurity,minOpportunityProfit,minOpportunityRoi]);

  const resetSearch=()=>{setItemSearch("");setRegionId("all");setLocationSearch("");setContractType("all");setCategory("all");setAvailability("all");setIssuerSearch("");setMinPrice("");setMaxPrice("");setExcludeMultiple(false);setExactType(false);setCleanOnly(false);setSearchSecurity({...ALL_SECURITY});};
  const resetProfit=()=>{setOpportunityMode("all");setOpportunitySort("profit");setOpportunitySystem("");setOpportunitySecurity({...ALL_SECURITY});setMinOpportunityProfit("");setMinOpportunityRoi("");};

  const topProfit=data?.topProfit??0;
  const averageRoi=data?.averageRoi??0;
  const refreshedAt=data?.generatedAt||data?.contractsCreatedAt;
  const showStatus=busy||!data||/failed|unavailable|no server-prepared/i.test(status);

  return <section className={`contracts-page contracts-page-v2 contracts-reference workspace-${workspace}`}>
    <ContractsHero workspace={workspace} data={data} busy={busy} refreshedAt={refreshedAt} topProfit={topProfit} averageRoi={averageRoi} onRefresh={()=>void refresh()}/>
    {showStatus&&<div className={`contracts-status contracts-status-compact ${busy?"busy":""}`}><span className={busy?"pulse":""}/><div>{status}</div></div>}

    <div className="contract-subtabs contract-subtabs-reference" role="tablist" aria-label="Contract workspace">
      <button type="button" className={workspace==="search"?"active":""} onClick={()=>setWorkspace("search")}><span className="contract-subtab-icon"><IskGlyph name="search"/></span><span><strong>CONTRACT SEARCH</strong><small>Search public contracts</small></span></button>
      <button type="button" className={workspace==="profit"?"active":""} onClick={()=>setWorkspace("profit")}><span className="contract-subtab-icon"><IskGlyph name="contract"/></span><span><strong>PROFIT OPPORTUNITIES</strong><small>Find profitable arbitrage</small></span></button>
    </div>

    {workspace==="search"&&<div className="contract-search-workspace contract-search-reference">
      <aside className="contract-filter-panel contract-filter-reference">
        <div className="contract-filter-heading"><div><p className="eyebrow"><IskGlyph name="bars"/> SEARCH FILTERS</p><h3>EVE-style contract search</h3></div><button type="button" onClick={resetSearch}><IskGlyph name="reset"/> Reset</button></div>
        <label className="contract-filter-wide"><span>Search</span><div className="contract-filter-search"><IskGlyph name="search"/><input value={itemSearch} onChange={event=>setItemSearch(event.target.value)} placeholder="Search item, type or contract ID…"/></div></label>
        <label><span>Contract Type</span><select value={contractType} onChange={event=>setContractType(event.target.value)}><option value="all">All Types</option>{contractTypes.map(type=><option key={type} value={type}>{contractTypeLabel(type)}</option>)}</select></label>
        <label><span>Item Category</span><select value={category} onChange={event=>setCategory(event.target.value)}><option value="all">All Categories</option>{categories.map(value=><option key={value}>{value}</option>)}</select></label>
        <label className="contract-filter-wide"><span>Availability</span><select value={availability} onChange={event=>setAvailability(event.target.value)}><option value="all">All Availability</option>{availabilities.map(value=><option key={value} value={value}>{availabilityLabel(value)}</option>)}</select></label>
        <fieldset className="contract-price-filter"><legend>Price (million ISK)</legend><input inputMode="decimal" value={minPrice} onChange={event=>setMinPrice(event.target.value)} placeholder="Min"/><span>to</span><input inputMode="decimal" value={maxPrice} onChange={event=>setMaxPrice(event.target.value)} placeholder="Max"/></fieldset>
        <SecurityFilters value={searchSecurity} onChange={setSearchSecurity}/>
        <label className="contract-filter-check"><input type="checkbox" checked={excludeMultiple} onChange={event=>setExcludeMultiple(event.target.checked)}/><span>Exclude Multiple Items</span></label>
        <label className="contract-filter-check sage"><input type="checkbox" checked={cleanOnly} onChange={event=>setCleanOnly(event.target.checked)}/><span>Clean sales only <small>Sage</small></span></label>
        <details className="contract-search-advanced">
          <summary>More filters <small>Location, issuer & exact type</small></summary>
          <div>
            <label><span>Region</span><select value={regionId} onChange={event=>setRegionId(event.target.value)}><option value="all">All Regions</option>{regions.map(region=><option key={region.id} value={region.id}>{region.name}</option>)}</select></label>
            <label><span>System / station</span><input value={locationSearch} onChange={event=>setLocationSearch(event.target.value)} placeholder="Any system or station"/></label>
            <label className="wide"><span>Issuer</span><input value={issuerSearch} onChange={event=>setIssuerSearch(event.target.value)} placeholder="Name, corporation or ID"/></label>
            <label className="contract-filter-check"><input type="checkbox" checked={exactType} onChange={event=>setExactType(event.target.checked)}/><span>Exact Type Match</span></label>
          </div>
        </details>
      </aside>
      <main className="contract-search-results contract-results-reference">
        <div className="contract-results-head"><div><p className="eyebrow">RESULTS</p><h3>{searchResult.total.toLocaleString()} matching contracts</h3></div><div className="contract-results-actions"><small>{searchResult.total>shownContracts.length?`Showing first ${shownContracts.length.toLocaleString()}`:`${shownContracts.length.toLocaleString()} shown`}</small><div className="contract-density-toggle" aria-label="Contract row density"><button type="button" className={searchDensity==="compact"?"active":""} onClick={()=>setSearchDensity("compact")} title="Compact rows"><IskGlyph name="bars"/></button><button type="button" className={searchDensity==="comfortable"?"active":""} onClick={()=>setSearchDensity("comfortable")} title="Comfortable rows"><IskGlyph name="cubes"/></button></div></div></div>
        <div className={`contract-list contract-list-v2 contract-list-reference density-${searchDensity}`}>{shownContracts.map(row=><Fragment key={row.contractId}><ContractSearchRow row={row} selected={selected?.contractId===row.contractId} onSelect={()=>setSelected(row)}/>{selected?.contractId===row.contractId&&<ContractDetail row={row} finding={findingContractId===row.contractId} findStatus={findStatus} completionStatus={completionStatus[row.contractId]??""} onFind={()=>void findInEve(row)} onComplete={()=>void completeDeal(row)}/>}</Fragment>)}{!shownContracts.length&&<div className="market-empty">No retained contracts match these filters.</div>}</div>
      </main>
    </div>}

    {workspace==="profit"&&<section className="contract-profit-workspace contract-profit-reference">
      <div className="contract-profit-toolbar contract-profit-filterbar">
        <div className="contract-filterbar-title"><IskGlyph name="bars"/><span>FILTER & SORT</span></div>
        <SecurityFilters value={opportunitySecurity} onChange={setOpportunitySecurity} compact/>
        <label><span>Min Profit (ISK)</span><input inputMode="decimal" value={minOpportunityProfit} onChange={event=>setMinOpportunityProfit(event.target.value)} placeholder="Min amount"/></label>
        <label><span>Min ROI %</span><input inputMode="decimal" value={minOpportunityRoi} onChange={event=>setMinOpportunityRoi(event.target.value)} placeholder="Any"/></label>
        <label><span>Signal Type</span><select value={opportunityMode} onChange={event=>setOpportunityMode(event.target.value as "all"|"immediate"|"haul")}><option value="all">All Signals</option><option value="immediate">Immediate</option><option value="haul">Haul</option></select></label>
        <label className="profit-system-search"><span>Search</span><div className="contract-filter-search"><IskGlyph name="search"/><input value={opportunitySystem} onChange={event=>setOpportunitySystem(event.target.value)} placeholder="Search signal or route…"/></div></label>
        <label><span>Rank</span><select value={opportunitySort} onChange={event=>setOpportunitySort(event.target.value as "profit"|"roi")}><option value="profit">Most profit</option><option value="roi">Best ROI</option></select></label>
        <button type="button" className="contract-reset-filter" onClick={resetProfit}><IskGlyph name="reset"/> Reset Filters</button>
      </div>
      <div className="contract-opportunity-list contract-profit-list contract-opportunity-reference">{visibleOpportunities.map(row=><Fragment key={row.contractId}><OpportunityRow row={row} selected={selected?.contractId===row.contractId} onSelect={()=>setSelected(row)}/>{selected?.contractId===row.contractId&&<ContractDetail row={row} finding={findingContractId===row.contractId} findStatus={findStatus} completionStatus={completionStatus[row.contractId]??""} onFind={()=>void findInEve(row)} onComplete={()=>void completeDeal(row)}/>}</Fragment>)}{data&&visibleOpportunities.length===0&&<div className="market-empty">No opportunities match these filters.</div>}</div>
    </section>}
  </section>;
}

function ContractsHero({workspace,data,busy,refreshedAt,topProfit,averageRoi,onRefresh}:{workspace:WorkspaceTab;data:MarketContractWorkspace|null;busy:boolean;refreshedAt:string|null|undefined;topProfit:number;averageRoi:number;onRefresh():void}){
  const profit=workspace==="profit";
  return <header className={`contracts-reference-hero ${profit?"profit":"search"}`}>
    <div className="contracts-hero-mark"><IskGlyph name={profit?"target":"contract"}/></div>
    <div className="contracts-hero-copy">
      <p className="eyebrow">{profit?"PROFIT OPPORTUNITIES INTELLIGENCE":"PUBLIC CONTRACT INTELLIGENCE"}</p>
      <h2>{profit?"OPPORTUNITIES & SIGNALS":"CONTRACTS"}</h2>
      <p>{profit?"Real-time profit opportunities ranked by potential and signal quality. Updated from the retained public contract book.":"Search the retained public contract book or switch to profit opportunities for Sage-ranked arbitrage."}</p>
    </div>
    {profit?<div className="contracts-profit-kpis">
      <article><span>TOTAL OPPORTUNITIES</span><strong>{data?.counts.opportunities.toLocaleString()??"—"}</strong><small>ranked signals</small></article>
      <article><span>TOP PROFIT (ISK)</span><strong>{topProfit>0?compactIsk(topProfit):"—"}</strong><small>best current exit</small></article>
      <article><span>AVG ROI</span><strong>{averageRoi>0?averageRoi.toFixed(1)+"%":"—"}</strong><small>positive signals</small></article>
      <button type="button" className="contracts-update-kpi" disabled={busy} onClick={onRefresh}><span>LAST UPDATE</span><strong>{ageLabel(refreshedAt)}</strong><small><IskGlyph name="reset"/>{busy?"Refreshing…":"Refresh data"}</small></button>
    </div>:<div className="contracts-refresh-block"><button type="button" className="contracts-refresh-button" disabled={busy} onClick={onRefresh}><IskGlyph name="reset"/>{busy?"REFRESHING CONTRACTS…":"REFRESH CONTRACTS"}</button><small><i/> Last refreshed: {ageLabel(refreshedAt)}</small></div>}
  </header>;
}

function SecurityFilters({value,onChange,compact=false}:{value:Record<SecurityKey,boolean>;onChange(value:Record<SecurityKey,boolean>):void;compact?:boolean}){
  const toggle=(key:SecurityKey)=>onChange({...value,[key]:!value[key]});
  return <fieldset className={`contract-security-filter ${compact?"compact":""}`}><legend>{compact?"SECURITY":"Security"}</legend><div>{(["high","low","null","unknown"] as SecurityKey[]).map(key=><button type="button" key={key} className={value[key]?`active ${key}`:key} onClick={()=>toggle(key)}>{key==="high"?"High":key==="low"?"Low":key==="null"?"Null":"Unknown"}</button>)}</div></fieldset>;
}

function ContractSearchRow({row,selected,onSelect}:{row:MarketContractOpportunity;selected:boolean;onSelect():void}){
  const expiry=expiryMeta(row.expires);
  const volume=row.volume>0?row.volume:row.haulVolumeM3;
  return <button type="button" className={`contract-search-row ${selected?"selected":""}`} onClick={onSelect}>
    <span className="contract-row-icon"><IskGlyph name="contract"/></span>
    <span className="contract-row-copy"><span className="contract-row-title"><strong>{row.title||`Contract ${row.contractId}`}</strong><em>{contractTypeLabel(row.contractType||"item_exchange")}</em>{row.securityBand&&row.securityBand!=="high"&&<SecurityBadge band={row.securityBand}/>}</span><small>{row.systemName} · {row.station}</small><span className="contract-row-issued">{row.issuerName?`Issued by: ${row.issuerName}`:itemSummary(row)||row.regionName}</span></span>
    <span className="contract-row-metric volume"><small>VOLUME</small><strong>{cargoVolume(volume)} m³</strong></span>
    <span className={`contract-row-metric expiry ${expiry.tone}`}><small>EXPIRES</small><strong>{expiry.label}</strong></span>
    <span className="contract-row-price"><strong>{compactIsk(row.price)} ISK</strong><small>{row.cleanSale?"Clean sale":row.requestedItemCount+" requested item"+(row.requestedItemCount===1?"":"s")}</small></span>
    <span className="contract-row-chevron"><IskGlyph name="chevron"/></span>
  </button>;
}

function OpportunityRow({row,selected,onSelect}:{row:MarketContractOpportunity;selected:boolean;onSelect():void}){
  const recommended=recommendedExitFor(row);
  const kind=recommended?.kind??"haul";
  const score=signalScore(row);
  const tone=signalTone(score);
  const expiry=expiryMeta(row.expires);
  const cargo=row.haulCargoVolumeM3>0?row.haulCargoVolumeM3:row.volume;
  const itemText=itemSummary(row);
  return <button type="button" className={`contract-opportunity-row ${kind} score-${tone} ${selected?"selected":""}`} onClick={onSelect}>
    <span className="contract-opportunity-score"><small>{signalLabel(score)}</small><em>{kind==="immediate"?"PROFIT":"SIGNAL"}</em><strong>{score}%</strong></span>
    <span className="contract-opportunity-copy"><span className="contract-opportunity-titleline"><strong>{row.title||`Contract ${row.contractId}`}</strong><em>{contractTypeLabel(row.contractType||"item_exchange")}</em></span><small>{row.systemName}{recommended?.system&&recommended.system!==row.systemName?" → "+recommended.system:""} · {row.station}</small><span className="contract-opportunity-tags"><i>{kind==="immediate"?"Immediate":"Haul"}</i>{row.cleanSale&&<i>Clean sale</i>}{row.securityBand&&<i>{row.securityBand.toUpperCase()} SEC</i>}{!row.originResolved&&<i className="warning">Origin unverified</i>}{row.bestBuyUsesPlayerStructure&&kind==="haul"&&<i className="warning">Structure access</i>}</span><small className={`contract-opportunity-expiry ${expiry.tone}`}>Expires in {expiry.label}{itemText?" · "+itemText:""}</small></span>
    <span className="contract-opportunity-metric positive"><small>PROFIT</small><strong>{recommended?compactIsk(recommended.profit)+" ISK":"—"}</strong><em>Potential</em></span>
    <span className="contract-opportunity-metric roi"><small>ROI</small><strong>{recommended?.roi==null?"—":recommended.roi.toFixed(1)+"%"}</strong><em>{recommended?.roi!=null&&recommended.roi>=50?"Very High":recommended?.roi!=null&&recommended.roi>=25?"Good":"Moderate"}</em></span>
    <span className="contract-opportunity-metric reliability"><small>RELIABILITY</small><strong>{score}%</strong><em>{tone==="excellent"?"Excellent":tone==="good"?"Very Good":tone==="steady"?"Good":"Watch"}</em></span>
    <span className="contract-signal-bars" aria-label={`Signal score ${score} percent`}>{[1,2,3,4,5].map(value=><i className={score>=value*20?"active":""} key={value}/>)}</span>
    <span className="contract-opportunity-note"><strong>Cargo: {cargoVolume(cargo)} m³</strong><small>{row.note||itemText||"Ranked from retained contract and market data."}</small></span>
    <span className="contract-row-chevron"><IskGlyph name="chevron"/></span>
  </button>;
}

function SecurityBadge({band}:{band:"low"|"null"}){return <span className={`contract-security-badge ${band}`}>{band==="low"?"LOW SEC":"NULL SEC"}</span>;}

function ContractDetail({row,finding,findStatus,completionStatus,onFind,onComplete}:{row:MarketContractOpportunity;finding:boolean;findStatus:string;completionStatus:string;onFind():void;onComplete():void}){
  const recommended=recommendedExitFor(row);
  const exit = recommended;
  const contractCost = row.price + (row.requestedItemsFullyPriced ? row.requestedItemCost : 0);
  const haulRequired = recommended?.kind === "haul";
  const hasCapitalPilot=row.pilotRequiredShips.some(ship=>ship.capital);
  const pilotLabel=hasCapitalPilot?"CAPITAL â€” PILOT REQUIRED":"LARGE HULL â€” PILOT REQUIRED";
  return <div className="contract-detail"><div className="contract-detail-head"><div><p className="eyebrow">CONTRACT {row.contractId}</p><h3>{row.title}</h3><small className="contract-detail-location">{row.station} Â· {row.systemName}{row.securityBand!=="high"&&row.securityBand&&<SecurityBadge band={row.securityBand}/>} Â· expires {new Date(row.expires).toLocaleString()}</small><div className="contract-detail-meta"><span>{contractTypeLabel(row.contractType||"item_exchange")}</span><span>{availabilityLabel(row.availability||"public")}</span>{row.issuerName&&<span>Issuer: {row.issuerName}</span>}{row.issuerCorporationName&&row.issuerCorporationName!==row.issuerName&&<span>{row.issuerCorporationName}</span>}{row.dateIssued&&<span>Issued {new Date(row.dateIssued).toLocaleString()}</span>}</div></div><div className="contract-detail-actions"><strong>{money(row.price)} ISK</strong><button type="button" className="find-in-eve" disabled={finding} onClick={onFind}>{finding?"Opening in EVE...":"Find in EVE"}</button>{exit&&exit.profit>0&&<button type="button" className="contract-complete-deal" onClick={onComplete}>I completed this deal</button>}</div></div>
    <div className="contract-value-grid"><span><small>COST OF CONTRACT</small><strong>{money(contractCost)} ISK</strong></span><span><small>REVENUE FROM SALE</small><strong>{exit==null?"-":money(exit.revenue)+" ISK"}</strong></span><span><small>PROFIT</small><strong>{exit==null?"-":(exit.profit>=0?"+":"")+money(exit.profit)+" ISK"}</strong></span>{haulRequired&&<span><small>HAUL CARGO (REPACKAGED)</small><strong>{cargoVolume(row.haulCargoVolumeM3)} mÂ³</strong></span>}{haulRequired&&row.pilotRequiredShips.length>0&&<span className="contract-pilot-value"><small>{pilotLabel}</small><strong>{row.pilotRequiredShips.map(ship=>`${ship.quantity}Ã— ${ship.typeName}`).join(", ")}</strong></span>}</div>
    <div className="contract-item-table"><div className="contract-item-row heading"><span>Side</span><span>Item</span><span>Qty</span><span>Best buy</span><span>Best sell</span></div>{row.items.map((item,index)=><div className="contract-item-row" key={`${item.typeId}-${index}`}><span className={item.included?"included":"requested"}>{item.included?"YOU GET":"YOU GIVE"}</span><strong>{item.typeName}</strong><span>{item.quantity.toLocaleString()}</span><span>{!item.recoverableForResale?(item.valuationNote??"NON-RECOVERABLE"):item.bestBuy==null?"â€”":`${money(item.bestBuy)} ISK`}</span><span>{!item.recoverableForResale?"EXCLUDED":item.bestSell==null?"â€”":`${money(item.bestSell)} ISK`}</span></div>)}</div>
    <small className="contract-detail-note">{row.note}</small>{findStatus&&<div className="contract-find-status" role="status">{findStatus}</div>}{completionStatus&&<div className="contract-completion-status" role="status">{completionStatus}</div>}
  </div>;
}
