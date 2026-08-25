import { Fragment, useEffect, useMemo, useState } from "react";
import type { MarketContractIntelligence, MarketContractOpportunity } from "./types";

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

export function MarketContracts({characterId,marketDataRevision,onMarketDataUpdated}:{characterId?:string;marketDataRevision:number;onMarketDataUpdated():void}){
  const [data,setData]=useState<MarketContractIntelligence|null>(null);
  const [workspace,setWorkspace]=useState<WorkspaceTab>("search");
  const [busy,setBusy]=useState(contractRefreshActive);
  const [status,setStatus]=useState("Loading retained public contractsâ€¦");
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
    try{
      const value=await window.sage.getContractMarketIntelligence();
      setData(value);
      setStatus(value.contractsCreatedAt?`${value.counts.contracts.toLocaleString()} public buy/sell contracts loaded Â· ${value.counts.opportunities.toLocaleString()} strong opportunities.`:"No retained contract snapshot yet. Refresh Contracts to scan EVE-wide public contracts.");
      if(selected){const updated=value.contracts.find(row=>row.contractId===selected.contractId);setSelected(updated??null);}
    }catch(error){setData(null);setStatus(error instanceof Error?error.message:"Contract data is unavailable.");}
  }
  useEffect(()=>{void load();},[marketDataRevision]);
  useEffect(()=>window.sage.onMarketProgress(progress=>{if(progress.mode!=="contracts")return;const complete=progress.regionsTotal>0&&progress.regionsDone>=progress.regionsTotal;contractRefreshActive=!complete;setBusy(!complete);setStatus(complete?"Contract refresh complete. Loading the new snapshotâ€¦":`${progress.regionName} Â· ${progress.regionsDone}/${progress.regionsTotal} regions Â· showing previous snapshot until refresh completes`);if(complete)void load();}),[]);

  async function refresh(){
    contractRefreshActive=true;setBusy(true);setFindStatus("");setStatus("Starting EVE-wide public contract scan. Showing previous snapshot until refresh completes.");
    try{await window.sage.pullMarket({mode:"contracts"});onMarketDataUpdated();await load();}
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
  const regions=useMemo(()=>[...new Map((data?.contracts??[]).map(row=>[row.regionId,row.regionName])).entries()].map(([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name)),[data]);
  const categories=useMemo(()=>[...new Set((data?.contracts??[]).flatMap(row=>row.items.map(item=>item.categoryName||"Other")))].sort((a,b)=>a.localeCompare(b)),[data]);
  const contractTypes=useMemo(()=>[...new Set(["item_exchange","auction",...(data?.contracts??[]).map(row=>row.contractType||"item_exchange")])].sort(),[data]);
  const availabilities=useMemo(()=>[...new Set((data?.contracts??[]).map(row=>row.availability||"public"))].sort(),[data]);

  const searchMatches=useMemo(()=>{
    const itemNeedle=itemSearch.trim().toLowerCase();
    const locationNeedle=locationSearch.trim().toLowerCase();
    const issuerNeedle=issuerSearch.trim().toLowerCase();
    const minIsk=million(minPrice),maxIsk=million(maxPrice);
    return (data?.contracts??[]).filter(row=>{
      const type=row.contractType||"item_exchange";
      const avail=row.availability||"public";
      const itemMatch=!itemNeedle||(exactType?row.items.some(item=>item.typeName.toLowerCase()===itemNeedle):`${row.contractId} ${row.title} ${row.items.map(item=>`${item.typeName} ${item.categoryName??""} ${item.groupName??""} ${item.marketGroup??""}`).join(" ")}`.toLowerCase().includes(itemNeedle));
      const locationMatch=!locationNeedle||`${row.regionName} ${row.systemName} ${row.station}`.toLowerCase().includes(locationNeedle);
      const issuerMatch=!issuerNeedle||`${row.issuerName??""} ${row.issuerId??""} ${row.issuerCorporationName??""} ${row.issuerCorporationId??""}`.toLowerCase().includes(issuerNeedle);
      return itemMatch&&locationMatch&&issuerMatch
        &&(regionId==="all"||row.regionId===Number(regionId))
        &&(contractType==="all"||type===contractType)
        &&(category==="all"||row.items.some(item=>(item.categoryName||"Other")===category))
        &&(availability==="all"||avail===availability)
        &&searchSecurity[securityKey(row)]
        &&(!excludeMultiple||row.receivedItemCount+row.requestedItemCount<=1)
        &&(!cleanOnly||row.cleanSale)
        &&(minIsk==null||row.price>=minIsk)
        &&(maxIsk==null||row.price<=maxIsk);
    });
  },[data,itemSearch,locationSearch,issuerSearch,regionId,contractType,category,availability,searchSecurity,excludeMultiple,exactType,cleanOnly,minPrice,maxPrice]);
  const shownContracts=searchMatches.slice(0,800);

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

  return <section className="contracts-page contracts-page-v2">
    <div className="contracts-head"><div><p className="eyebrow">PUBLIC CONTRACT INTELLIGENCE</p><h2>Contracts</h2><p>Search the retained public contract book or switch to profit opportunities for Sage-ranked arbitrage.</p></div><button type="button" className="primary" disabled={busy} onClick={()=>void refresh()}>{busy?"Refreshing contractsâ€¦":"Refresh Contracts"}</button></div>
    <div className="contracts-status"><span className={busy?"pulse":""}/><div>{status}{data?.contractsCreatedAt&&<small>Contracts {new Date(data.contractsCreatedAt).toLocaleString()} Â· Market {data.marketCreatedAt?new Date(data.marketCreatedAt).toLocaleString():"unavailable"}</small>}</div></div>
    <div className="contract-subtabs" role="tablist" aria-label="Contract workspace">
      <button type="button" className={workspace==="search"?"active":""} onClick={()=>setWorkspace("search")}><strong>Contract Search</strong><span>Find exact public contracts</span></button>
      <button type="button" className={workspace==="profit"?"active":""} onClick={()=>setWorkspace("profit")}><strong>Profit Opportunities</strong><span>{data?.counts.opportunities.toLocaleString()??0} current signals</span></button>
    </div>

    {workspace==="search"&&<div className="contract-search-workspace">
      <aside className="contract-filter-panel">
        <div className="contract-filter-heading"><div><p className="eyebrow">SEARCH FILTERS</p><h3>EVE-style contract search</h3></div><button type="button" onClick={resetSearch}>Reset</button></div>
        <label className="contract-filter-wide"><span>Item / contract</span><input value={itemSearch} onChange={event=>setItemSearch(event.target.value)} placeholder="Item name, title or contract ID"/></label>
        <label><span>Location</span><select value={regionId} onChange={event=>setRegionId(event.target.value)}><option value="all">All Regions</option>{regions.map(region=><option key={region.id} value={region.id}>{region.name}</option>)}</select></label>
        <label><span>System / station</span><input value={locationSearch} onChange={event=>setLocationSearch(event.target.value)} placeholder="Any system or station"/></label>
        <label><span>Contract Type</span><select value={contractType} onChange={event=>setContractType(event.target.value)}><option value="all">All retained types</option>{contractTypes.map(type=><option key={type} value={type}>{contractTypeLabel(type)}</option>)}</select></label>
        <label><span>Item Category</span><select value={category} onChange={event=>setCategory(event.target.value)}><option value="all">All</option>{categories.map(value=><option key={value}>{value}</option>)}</select></label>
        <label><span>Availability</span><select value={availability} onChange={event=>setAvailability(event.target.value)}><option value="all">All retained</option>{availabilities.map(value=><option key={value} value={value}>{availabilityLabel(value)}</option>)}</select></label>
        <label><span>Issuer</span><input value={issuerSearch} onChange={event=>setIssuerSearch(event.target.value)} placeholder="Name, corporation or ID"/></label>
        <fieldset className="contract-price-filter"><legend>Price (million ISK)</legend><input inputMode="decimal" value={minPrice} onChange={event=>setMinPrice(event.target.value)} placeholder="Min"/><span>to</span><input inputMode="decimal" value={maxPrice} onChange={event=>setMaxPrice(event.target.value)} placeholder="Max"/></fieldset>
        <SecurityFilters value={searchSecurity} onChange={setSearchSecurity}/>
        <label className="contract-filter-check"><input type="checkbox" checked={excludeMultiple} onChange={event=>setExcludeMultiple(event.target.checked)}/><span>Exclude Multiple Items</span></label>
        <label className="contract-filter-check"><input type="checkbox" checked={exactType} onChange={event=>setExactType(event.target.checked)}/><span>Exact Type Match</span></label>
        <label className="contract-filter-check sage"><input type="checkbox" checked={cleanOnly} onChange={event=>setCleanOnly(event.target.checked)}/><span>Clean sales only <small>Sage</small></span></label>
      </aside>
      <main className="contract-search-results">
        <div className="contract-results-head"><div><p className="eyebrow">RESULTS</p><h3>{searchMatches.length.toLocaleString()} matching contracts</h3></div><small>{searchMatches.length>shownContracts.length?`Showing first ${shownContracts.length.toLocaleString()}`:`${shownContracts.length.toLocaleString()} shown`}</small></div>
        <div className="contract-list contract-list-v2">{shownContracts.map(row=><Fragment key={row.contractId}><ContractSearchRow row={row} selected={selected?.contractId===row.contractId} onSelect={()=>setSelected(row)}/>{selected?.contractId===row.contractId&&<ContractDetail row={row} finding={findingContractId===row.contractId} findStatus={findStatus} completionStatus={completionStatus[row.contractId]??""} onFind={()=>void findInEve(row)} onComplete={()=>void completeDeal(row)}/>}</Fragment>)}{!shownContracts.length&&<div className="market-empty">No retained contracts match these filters.</div>}</div>
      </main>
    </div>}

    {workspace==="profit"&&<section className="contract-profit-workspace">
      <div className="contract-profit-toolbar">
        <div className="contract-profit-summary"><p className="eyebrow">PROFIT OPPORTUNITIES</p><h3>{visibleOpportunities.length.toLocaleString()} shown Â· {data?.counts.opportunities.toLocaleString()??0} signals</h3></div>
        <label className="profit-system-search"><span>System search</span><input value={opportunitySystem} onChange={event=>setOpportunitySystem(event.target.value)} placeholder="System, region or structure"/></label>
        <SecurityFilters value={opportunitySecurity} onChange={setOpportunitySecurity} compact/>
        <label><span>Min profit (m ISK)</span><input inputMode="decimal" value={minOpportunityProfit} onChange={event=>setMinOpportunityProfit(event.target.value)} placeholder="0"/></label>
        <label><span>Min ROI %</span><input inputMode="decimal" value={minOpportunityRoi} onChange={event=>setMinOpportunityRoi(event.target.value)} placeholder="0"/></label>
        <div className="contract-opportunity-filters" role="group" aria-label="Opportunity type"><button type="button" className={opportunityMode==="all"?"active":""} onClick={()=>setOpportunityMode("all")}>All</button><button type="button" className={opportunityMode==="immediate"?"active":""} onClick={()=>setOpportunityMode("immediate")}>Immediate</button><button type="button" className={opportunityMode==="haul"?"active":""} onClick={()=>setOpportunityMode("haul")}>Haul</button></div>
        <label><span>Sort</span><select value={opportunitySort} onChange={event=>setOpportunitySort(event.target.value as "profit"|"roi")}><option value="profit">Most profit</option><option value="roi">Best ROI</option></select></label>
        <button type="button" className="contract-reset-filter" onClick={resetProfit}>Reset filters</button>
      </div>
      <div className="contract-opportunity-list contract-profit-list">{visibleOpportunities.map(row=><Fragment key={row.contractId}><OpportunityRow row={row} selected={selected?.contractId===row.contractId} onSelect={()=>setSelected(row)}/>{selected?.contractId===row.contractId&&<ContractDetail row={row} finding={findingContractId===row.contractId} findStatus={findStatus} completionStatus={completionStatus[row.contractId]??""} onFind={()=>void findInEve(row)} onComplete={()=>void completeDeal(row)}/>}</Fragment>)}{data&&visibleOpportunities.length===0&&<div className="market-empty">No opportunities match these filters.</div>}</div>
    </section>}
  </section>;
}

function SecurityFilters({value,onChange,compact=false}:{value:Record<SecurityKey,boolean>;onChange(value:Record<SecurityKey,boolean>):void;compact?:boolean}){
  const toggle=(key:SecurityKey)=>onChange({...value,[key]:!value[key]});
  return <fieldset className={`contract-security-filter ${compact?"compact":""}`}><legend>Security Filters</legend><div>{(["high","low","null","unknown"] as SecurityKey[]).map(key=><button type="button" key={key} className={value[key]?`active ${key}`:key} onClick={()=>toggle(key)}>{key==="high"?"High":key==="low"?"Low":key==="null"?"Null":"Unknown"}</button>)}</div></fieldset>;
}

function ContractSearchRow({row,selected,onSelect}:{row:MarketContractOpportunity;selected:boolean;onSelect():void}){
  return <button type="button" className={selected?"selected":""} onClick={onSelect}>
    <div><span className="contract-location-line">{row.regionName} Â· {row.systemName}{row.securityBand!=="high"&&row.securityBand&&<SecurityBadge band={row.securityBand}/>}</span><strong>{row.title}</strong><small>{row.items.filter(item=>item.included).slice(0,3).map(item=>`${item.quantity}Ã— ${item.typeName}`).join(" Â· ")}{row.receivedItemCount>3?` Â· +${row.receivedItemCount-3} more`:""}</small><em>{contractTypeLabel(row.contractType||"item_exchange")}{row.issuerName?` Â· ${row.issuerName}`:""}</em></div>
    <div className="contract-price"><strong>{money(row.price)} ISK</strong><small>{row.cleanSale?"CLEAN SALE":`${row.requestedItemCount} REQUESTED ITEM${row.requestedItemCount===1?"":"S"}`}</small></div>
  </button>;
}

function OpportunityRow({row,selected,onSelect}:{row:MarketContractOpportunity;selected:boolean;onSelect():void}){
  const recommended=recommendedExitFor(row);
  const kind=recommended?.kind??"haul";
  const hasCapitalPilot=row.pilotRequiredShips.some(ship=>ship.capital);
  const pilotLabel=hasCapitalPilot?"CAPITAL â€” PILOT REQUIRED":"LARGE HULL â€” PILOT REQUIRED";
  const moveLabel=kind==="haul"&&hasCapitalPilot?"Capital move":kind==="haul"?"Haul":"";
  return <button type="button" className={kind+" "+(selected?"selected":"")} onClick={onSelect}>
    <div className="contract-opportunity-badges"><div className="contract-opportunity-badge">{kind==="immediate"?"IMMEDIATE":"HAUL"}</div>{row.securityBand!=="high"&&row.securityBand&&<SecurityBadge band={row.securityBand}/>} {kind==="haul"&&row.pilotRequiredShips.length>0&&<span className="contract-pilot-badge">{pilotLabel}</span>}{!row.originResolved&&<span className="contract-logistics-badge warning">ORIGIN ACCESS UNVERIFIED</span>}{kind==="haul"&&row.bestBuyUsesPlayerStructure&&<span className="contract-logistics-badge warning">STRUCTURE ACCESS</span>}{kind==="haul"&&row.bestBuyLocationCount>1&&<span className="contract-logistics-badge warning">SPLIT EXIT Ã—{row.bestBuyLocationCount}</span>}</div>
    <div className="contract-profit-main"><div><strong>{row.title}</strong><small>{row.systemName} Â· {row.regionName} Â· {row.items.filter(item=>item.included).slice(0,3).map(item=>item.quantity+"Ã— "+item.typeName).join(" + ")}</small></div><div className="profit-line"><span>{kind==="immediate"?"Local buy-order profit":"Best-buy profit"}</span><b>{recommended&&recommended.profit>=0?"+":""}{money(recommended?.profit)} ISK Â· {percent(recommended?.roi)}</b></div></div>
    <div className="contract-profit-note">{kind==="haul"&&<><em>{recommended?.system?`${moveLabel} to ${recommended.system}`:hasCapitalPilot?"Capital move required":"Haul required"}</em>{row.bestBuySecurityBand&&<span className={`contract-exit-security ${row.bestBuySecurityBand}`}>EXIT {row.bestBuySecurityBand.toUpperCase()} SEC</span>}<strong className="contract-haul-volume">Cargo: {cargoVolume(row.haulCargoVolumeM3)} mÂ³</strong>{row.pilotRequiredShips.length>0&&<strong className="contract-pilot-line">{row.pilotRequiredShips.map(ship=>`${ship.quantity}Ã— ${ship.typeName}`).join(", ")} â€” PILOT REQUIRED</strong>}</>}<small>{row.note}</small></div>
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
