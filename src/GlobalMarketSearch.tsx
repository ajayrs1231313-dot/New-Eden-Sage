import { type FormEvent, useEffect, useMemo, useState } from "react";
import type { CharacterSnapshot, NavigationSystem, RawMarketSearchOrder, RawMarketSearchResult } from "./types";
import { friendlyAnalysisError, isExpectedAnalysisCancellation } from "./analysis-errors";
import type { ShoppingListAdd } from "./shopping-list";
export type { ShoppingListAdd } from "./shopping-list";
import { effectiveMarketOriginId, sortMarketBuyRows, type MarketBuyRanking } from "./market-search-ordering";
import { queueNavigationRouteIntent } from "./navigation-intent";
import { MarketAlertDialog } from "./MarketAlertDialog";
import "./custom-notifications.css";

type HubScope="all-hubs"|"jita"|"amarr"|"dodixie"|"rens"|"hek"|"new-eden";

const HUBS:Record<Exclude<HubScope,"all-hubs"|"new-eden">,string>={jita:"Jita",amarr:"Amarr",dodixie:"Dodixie",rens:"Rens",hek:"Hek"};
const money=(value:number|null|undefined)=>value==null?"—":`${new Intl.NumberFormat("en-GB",{maximumFractionDigits:2}).format(value)} ISK`;
const nullable=(value:string)=>{const parsed=Number(value.replace(/,/g,""));return value.trim()&&Number.isFinite(parsed)?parsed:null;};
const jumps=(value:number|null|undefined)=>value==null?"—":value>=999?"UNREACHABLE":String(value);
const securityLabel=(status:number|null,band:string)=>`${status==null?"?":status.toFixed(1)} · ${band.toUpperCase()}`;

type RegionalBestSignal=NonNullable<RawMarketSearchResult["regionalBest"]>[number];
type MarketDestinationTarget={systemId:number;systemName:string;locationId:number|null;locationName:string};
function displayMarketLocation(locationName:string|undefined,locationId:number|null|undefined,systemName:string){
  const raw=String(locationName??"").trim();
  if(raw&&!/^Unresolved market location$/i.test(raw)&&!/^(?:Location|Structure) \d+$/i.test(raw))return raw;
  if(locationId!=null)return `${systemName} · ${locationId>=1_000_000_000_000?"Structure":"Station"} ${locationId}`;
  return systemName;
}

function scopeSystems(scope:HubScope){
  if(scope==="all-hubs")return Object.values(HUBS);
  if(scope==="new-eden")return [];
  return [HUBS[scope]];
}
function DetailedOrderTable({orders,side,originName,onRoutePlanner,onEveDestination,onAlert,canExportRoute,canExportEve}:{orders:RawMarketSearchOrder[];side:"sell"|"buy";originName:string;onRoutePlanner:(order:RawMarketSearchOrder)=>void;onEveDestination:(order:RawMarketSearchOrder)=>void;onAlert:(order:RawMarketSearchOrder)=>void;canExportRoute:boolean;canExportEve:boolean}){
  return <div className="market-v2-order-table">
    <div className="market-v2-depth-head"><span>Price / unit</span><span>Remaining</span><span>Station / system / actions</span><span>Security</span><span>Jumps</span></div>
    {orders.slice(0,60).map((order,index)=><div className={`market-v2-depth-row${index===0?" best":""}`} key={order.orderId}>
      <span className="market-v2-price"><strong>{money(order.price)}</strong><small>{side==="buy"?`range ${order.range||"station"}`:"seller ask"}</small></span>
      <span><strong>{order.volumeRemain.toLocaleString()}</strong><small>min {order.minVolume.toLocaleString()} · total {order.volumeTotal.toLocaleString()}</small></span>
      <span className="market-v2-location">
        <small className="market-v2-location-kicker">STATION / STRUCTURE</small>
        <strong className="market-v2-station-name" title={displayMarketLocation(order.locationName,order.locationId,order.systemName)}>{displayMarketLocation(order.locationName,order.locationId,order.systemName)}</strong>
        <small>{order.systemName} · {order.regionName}</small>
        <span className="market-v2-order-actions">
          <button type="button" disabled={!canExportRoute} title={canExportRoute?`Send ${order.systemName} to Sage Route Planner`:`Choose a sell-from origin before exporting a route`} onClick={()=>onRoutePlanner(order)}>Export to Route Planner</button>
          <button type="button" disabled={!canExportEve} title={canExportEve?`Set ${order.locationName||order.systemName} as the EVE destination`:`Choose a connected character first`} onClick={()=>onEveDestination(order)}>Add Destination in EVE</button>
          <button type="button" className="market-alert-row-button" title={side==="sell"?"Create a sell price and volume alert":"Create a buy price and volume alert"} onClick={()=>onAlert(order)}>🔔 Set alert</button>
        </span>
      </span>
      <span><strong>{securityLabel(order.securityStatus,order.securityBand)}</strong><small>{order.regionName}</small></span>
      <span className="market-v2-jumps"><strong>{jumps(order.jumpsFromOrigin)}</strong><small>{originName?`from ${originName}`:"origin unavailable"}</small></span>
    </div>)}
    {!orders.length&&<div className="market-v2-empty">No {side} orders match the active filters.</div>}
  </div>;
}
function RegionalSignals({signals,originName,onRoutePlanner,onEveDestination,canExportRoute,canExportEve}:{signals:NonNullable<RawMarketSearchResult["regionalBest"]>;originName:string;onRoutePlanner:(signal:RegionalBestSignal)=>void;onEveDestination:(signal:RegionalBestSignal)=>void;canExportRoute:boolean;canExportEve:boolean}){
  const [expandedKey,setExpandedKey]=useState<string|null>(null);
  const [constellations,setConstellations]=useState<Record<number,string>>({});
  const keyFor=(signal:RegionalBestSignal)=>`${signal.regionId}:${signal.systemId}:${signal.locationId??"system"}`;
  function toggleSignal(signal:RegionalBestSignal){
    const key=keyFor(signal);
    if(expandedKey===key){setExpandedKey(null);return;}
    setExpandedKey(key);
    if(!constellations[signal.systemId]){
      void window.sage.getNavigationSystem(signal.systemId).then(system=>{
        if(system?.constellationName)setConstellations(current=>({...current,[signal.systemId]:system.constellationName}));
      }).catch(()=>undefined);
    }
  }
  return <section className="market-v2-regional-signals">
    <header><div><span>BEST BUYERS BY REGION</span><strong>Best prices near your sell-from system</strong></div><small>Click a buyer to see location and routing options.</small></header>
    <div className="market-v2-signal-head"><span>Jumps</span><span>Buyer location</span><span>Price / unit</span><span>Remaining</span><span>Region</span></div>
    {signals.slice(0,14).map(signal=>{
      const key=keyFor(signal);
      const expanded=expandedKey===key;
      const rawLocationName=String(signal.locationName??"").trim();
      const namedLocation=signal.locationResolved&&rawLocationName&&!/^Unresolved market location$/i.test(rawLocationName)&&!/^(?:Location|Structure) \d+$/i.test(rawLocationName);
      const locationLabel=namedLocation?rawLocationName:signal.systemName;
      const locationHint=namedLocation?`${signal.systemName} · ${signal.regionName} · ${securityLabel(signal.securityStatus,signal.securityBand)}`:signal.locationId!=null?`${signal.locationId>=1_000_000_000_000?"Structure":"Station"} ${signal.locationId} · ${signal.regionName} · ${securityLabel(signal.securityStatus,signal.securityBand)}`:`Solar system · ${signal.regionName} · ${securityLabel(signal.securityStatus,signal.securityBand)}`;
      const routeEnabled=canExportRoute;
      const eveEnabled=canExportEve;
      return <div className={`market-v2-signal-card${expanded?" expanded":""}`} key={key}>
        <div className="market-v2-signal-row" role="button" tabIndex={0} aria-expanded={expanded} onClick={()=>toggleSignal(signal)} onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();toggleSignal(signal);}}}>
          <span className="market-v2-signal-jumps"><strong>{jumps(signal.jumpsFromOrigin)}</strong><small>{originName?`from ${originName}`:"origin unavailable"}</small></span>
          <span className="market-v2-signal-location"><strong title={locationLabel}>{locationLabel}</strong><small>{locationHint}</small></span>
          <span><strong>{money(signal.price)}</strong><small>best regional buy</small></span>
          <span><strong>{signal.volumeRemain.toLocaleString()}</strong><small>at best price</small></span>
          <span><strong>{signal.regionName}</strong><small>{securityLabel(signal.securityStatus,signal.securityBand)}</small></span>
        </div>
        {expanded&&<div className="market-v2-signal-detail">
          <div className="market-v2-signal-detail-grid">
            <span><small>{namedLocation?"STATION / STRUCTURE":"BUYER LOCATION"}</small><strong>{locationLabel}</strong><small>{namedLocation?signal.systemName:signal.locationId!=null?`Location ID ${signal.locationId}`:"Solar system"}</small></span>
            <span><small>SOLAR SYSTEM</small><strong>{signal.systemName}</strong></span>
            <span><small>CONSTELLATION</small><strong>{constellations[signal.systemId]||"Loading / unavailable"}</strong></span>
            <span><small>REGION / SECURITY</small><strong>{signal.regionName} · {securityLabel(signal.securityStatus,signal.securityBand)}</strong></span>
            <span><small>JUMPS FROM {originName||"ORIGIN"}</small><strong>{jumps(signal.jumpsFromOrigin)}</strong></span>
            <span><small>BUY PRICE</small><strong>{money(signal.price)}</strong></span>
            <span><small>REMAINING AT BEST PRICE</small><strong>{signal.volumeRemain.toLocaleString()}</strong></span>
          </div>
          <div className="market-v2-signal-detail-actions">
            <button type="button" disabled={!routeEnabled} title={routeEnabled?`Send ${locationLabel} to Sage Route Planner`:"Choose a sell-from origin before exporting a route"} onClick={event=>{event.stopPropagation();onRoutePlanner(signal);}}>Export to Route Planner</button>
            <button type="button" disabled={!eveEnabled} title={eveEnabled?`Set ${locationLabel} as the EVE destination`:"Choose a connected character first"} onClick={event=>{event.stopPropagation();onEveDestination(signal);}}>Add Destination in EVE</button>
          </div>
        </div>}
      </div>;
    })}
  </section>;
}

function mergeSides(sell:RawMarketSearchResult,buy:RawMarketSearchResult):RawMarketSearchResult{
  const regions=new Map<number,string>();
  for(const row of [...sell.regionOptions,...buy.regionOptions])regions.set(row.regionId,row.regionName);
  return {
    ...sell,
    available:sell.available||buy.available,
    message:buy.message||sell.message,
    snapshot:buy.snapshot||sell.snapshot,
    selectedType:sell.selectedType||buy.selectedType,
    filters:{...sell.filters,side:"all"},
    regionOptions:[...regions].map(([regionId,regionName])=>({regionId,regionName})).sort((a,b)=>a.regionName.localeCompare(b.regionName)),
    totalOrders:sell.sellOrders+buy.buyOrders,
    buyOrders:buy.buyOrders,
    sellOrders:sell.sellOrders,
    regionsWithOrders:Math.max(sell.regionsWithOrders,buy.regionsWithOrders),
    bestBuy:buy.bestBuy,
    bestSell:sell.bestSell,
    orders:[...sell.orders.filter(order=>order.side==="sell"),...buy.orders.filter(order=>order.side==="buy")],
    coverage:buy.coverage??sell.coverage,
    regionalBest:[...(sell.regionalBest??[]).filter(row=>row.side==="sell"),...(buy.regionalBest??[]).filter(row=>row.side==="buy")],
  };
}

export function GlobalMarketSearch({snapshot,onAddToShoppingList}:{snapshot?:CharacterSnapshot;onAddToShoppingList:(item:ShoppingListAdd)=>void}){
  const [query,setQuery]=useState("");
  const [selectedTypeId,setSelectedTypeId]=useState<number|null>(null);
  const [scope,setScope]=useState<HubScope>("all-hubs");
  const [advanced,setAdvanced]=useState(false);
  const [security,setSecurity]=useState<"all"|"high"|"low"|"null">("all");
  const [regionId,setRegionId]=useState("");
  const [systemQuery,setSystemQuery]=useState("");
  const [locationQuery,setLocationQuery]=useState("");
  const [minPrice,setMinPrice]=useState("");
  const [maxPrice,setMaxPrice]=useState("");
  const [minVolume,setMinVolume]=useState("");
  const [maxJumps,setMaxJumps]=useState("");
  const [quantity,setQuantity]=useState("1");
  const [manualOrigin,setManualOrigin]=useState<NavigationSystem|null>(null);
  const [originQuery,setOriginQuery]=useState("");
  const [originHits,setOriginHits]=useState<NavigationSystem[]>([]);
  const [buyRanking,setBuyRanking]=useState<MarketBuyRanking>("nearest");
  const [result,setResult]=useState<RawMarketSearchResult|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [eveStatus,setEveStatus]=useState("");
  const [alertOrder,setAlertOrder]=useState<RawMarketSearchOrder|null>(null);

  const characterOriginId=Number(snapshot?.location?.solar_system_id??0)||null;
  const characterOriginName=String(snapshot?.location?.solar_system_name??"").trim()||(characterOriginId?`System ${characterOriginId}`:"");
  const effectiveOriginId=effectiveMarketOriginId(manualOrigin?.systemId,characterOriginId);
  const effectiveOriginName=manualOrigin?.name||characterOriginName;
  const originSource=manualOrigin?"MANUAL ORIGIN":characterOriginId?"CHARACTER LOCATION":"NO ORIGIN";

  useEffect(()=>{
    const needle=originQuery.trim();
    if(!needle||needle.length<2||manualOrigin?.name.toLowerCase()===needle.toLowerCase()){setOriginHits([]);return;}
    let cancelled=false;
    const timer=window.setTimeout(()=>{
      void window.sage.searchNavigationSystems(needle,8).then(rows=>{if(!cancelled)setOriginHits(rows);}).catch(()=>{if(!cancelled)setOriginHits([]);});
    },140);
    return()=>{cancelled=true;window.clearTimeout(timer);};
  },[originQuery,manualOrigin?.systemId]);

  const sellers=useMemo(()=>[...(result?.orders??[])].filter(order=>order.side==="sell").sort((a,b)=>a.price-b.price||b.volumeRemain-a.volumeRemain),[result]);
  const buyers=useMemo(()=>sortMarketBuyRows([...(result?.orders??[])].filter(order=>order.side==="buy"),buyRanking),[result,buyRanking]);
  const regionalBuySignals=useMemo(()=>sortMarketBuyRows([...(result?.regionalBest??[])].filter(row=>row.side==="buy"),buyRanking),[result,buyRanking]);
  const nearestBuy=useMemo(()=>sortMarketBuyRows([...(result?.regionalBest??[]).filter(row=>row.side==="buy"),...(result?.orders??[]).filter(order=>order.side==="buy")],"nearest")[0],[result]);
  const resultOriginId=result?.filters.originSystemId??null;
  const resultOriginMatches=!result||resultOriginId===effectiveOriginId;

  function chooseOrigin(system:NavigationSystem){
    setManualOrigin(system);
    setOriginQuery(system.name);
    setOriginHits([]);
    setError("");
  }
  function useCharacterOrigin(){setManualOrigin(null);setOriginQuery("");setOriginHits([]);setError("");}
  async function resolveManualOrigin(){
    if(manualOrigin)return manualOrigin;
    const needle=originQuery.trim();
    if(!needle)return null;
    const hits=await window.sage.searchNavigationSystems(needle,12);
    const exact=hits.find(hit=>hit.name.toLowerCase()===needle.toLowerCase())??(hits.length===1?hits[0]:null);
    if(!exact){setOriginHits(hits);throw new Error("Choose the exact sell-from solar system from the location matches before searching.");}
    chooseOrigin(exact);
    return exact;
  }

  async function search(typeId?:number|null){
    if(!query.trim()&&!typeId)return;
    setBusy(true);setError("");setEveStatus("");
    try{
      const requestedManual=await resolveManualOrigin();
      const originSystemId=requestedManual?.systemId??characterOriginId;
      const base={
        query:query.trim(),
        typeId:typeId??undefined,
        security,
        regionId:regionId?Number(regionId):null,
        systemNames:advanced&&systemQuery.trim()?[]:scopeSystems(scope),
        systemQuery:advanced?systemQuery.trim():"",
        locationQuery:advanced?locationQuery.trim():"",
        minPrice:advanced?nullable(minPrice):null,
        maxPrice:advanced?nullable(maxPrice):null,
        minVolume:advanced?nullable(minVolume):null,
        originSystemId,
        maxJumps:originSystemId?nullable(maxJumps):null,
        offset:0,
        limit:500,
      } as const;
      const sellResult=await window.sage.searchRawMarket({...base,side:"sell",sort:"sell-lowest"});
      if(!sellResult.selectedType){setResult(sellResult);setSelectedTypeId(null);return;}
      const selected=sellResult.selectedType.typeId;
      setSelectedTypeId(selected);
      const buyResult=await window.sage.searchRawMarket({...base,typeId:selected,side:"buy",sort:buyRanking==="nearest"&&originSystemId?"distance":"buy-highest"});
      setResult(mergeSides(sellResult,buyResult));
    }catch(caught){if(!isExpectedAnalysisCancellation(caught))setError(caught instanceof Error&&caught.message.startsWith("Choose the exact sell-from")?caught.message:friendlyAnalysisError(caught,"Market search failed."));}
    finally{setBusy(false);}
  }
  function submit(event:FormEvent){event.preventDefault();void search(null);}
  async function openSelectedInEve(){
    if(!snapshot?.characterId||!result?.selectedType)return;
    setEveStatus(`Opening ${result.selectedType.name} in EVE...`);
    try{
      const opened=await window.sage.openEveMarketType({characterId:snapshot.characterId,typeId:result.selectedType.typeId});
      setEveStatus(`Opened ${result.selectedType.name} for ${opened.characterName}${opened.usedFallback?" (online character)":""}.`);
    }catch(caught){setEveStatus(caught instanceof Error?caught.message:"Could not open the EVE market.");}
  }

  function exportOrderToRoutePlanner(order:MarketDestinationTarget){
    if(!effectiveOriginId){setEveStatus("Choose a sell-from origin before exporting this market destination to Route Planner.");return;}
    queueNavigationRouteIntent({
      originSystemId:effectiveOriginId,
      originSystemName:effectiveOriginName||`System ${effectiveOriginId}`,
      destinationSystemId:order.systemId,
      destinationSystemName:order.systemName,
      destinationLocationId:order.locationId??undefined,
      destinationLocationName:displayMarketLocation(order.locationName,order.locationId,order.systemName),
    });
    setEveStatus(`Sent ${displayMarketLocation(order.locationName,order.locationId,order.systemName)} to Sage Route Planner.`);
  }
  async function addOrderDestinationInEve(order:MarketDestinationTarget){
    if(!snapshot?.characterId){setEveStatus("Choose a connected character before setting an EVE destination.");return;}
    const destinationName=displayMarketLocation(order.locationName,order.locationId,order.systemName);
    setEveStatus(`Setting EVE destination to ${destinationName}...`);
    try{
      await window.sage.exportShoppingRouteToEve({
        characterId:snapshot.characterId,
        stops:[{...(order.locationId!=null?{locationId:order.locationId}:{}),systemId:order.systemId,station:destinationName,system:order.systemName}],
      });
      setEveStatus(`EVE destination set to ${destinationName} (${order.systemName}).`);
    }catch(caught){setEveStatus(caught instanceof Error?caught.message:"Could not set the EVE destination.");}
  }
  return <section className="global-market-search market-search-polished">
    <header className="market-v2-hero">
      <div><p className="eyebrow">PUBLIC MARKET INTELLIGENCE</p><h2>Market Search</h2><p>Search the public New Eden order book, compare market depth, and find buyers from the system you are actually selling from.</p></div>
    </header>

    <form className="market-v2-query" onSubmit={submit}>
      <label className="market-v2-item-search"><span>ITEM SEARCH</span><input value={query} onChange={event=>{setQuery(event.target.value);setSelectedTypeId(null);}} placeholder="Raven, Tritanium, PLEX..."/></label>
      <label><span>SCOPE</span><select value={scope} onChange={event=>setScope(event.target.value as HubScope)}><option value="all-hubs">Major trade hubs</option><option value="jita">Jita</option><option value="amarr">Amarr</option><option value="dodixie">Dodixie</option><option value="rens">Rens</option><option value="hek">Hek</option><option value="new-eden">All New Eden</option></select></label>
      <button className="market-v2-advanced-toggle" type="button" onClick={()=>setAdvanced(value=>!value)}>{advanced?"Hide advanced":"Advanced filters"}</button>
      <button className="primary market-v2-search-button" type="submit" disabled={busy}>{busy?"Searching...":"Search market"}</button>
    </form>

    <section className="market-v2-contextbar">
      <div className="market-v2-origin-control">
        <div className="market-v2-context-label"><span>SELL FROM SOLAR SYSTEM</span><em>{originSource}</em></div>
        <div className="market-v2-origin-input"><input value={originQuery} onChange={event=>{const value=event.target.value;setOriginQuery(value);if(manualOrigin&&value.toLowerCase()!==manualOrigin.name.toLowerCase())setManualOrigin(null);}} placeholder={characterOriginName?`Character fallback: ${characterOriginName}`:"e.g. Shedoo, Rens, Jita..."}/>{manualOrigin&&<button type="button" onClick={useCharacterOrigin}>Use character</button>}</div>
        {originHits.length>0&&<div className="market-v2-origin-hits">{originHits.map(hit=><button type="button" key={hit.systemId} onClick={()=>chooseOrigin(hit)}><strong>{hit.name}</strong><small>{hit.regionName} · {hit.securityStatus.toFixed(1)}</small></button>)}</div>}
        <div className="market-v2-active-origin"><strong>Origin: {effectiveOriginName||"Not available"}</strong><small>{manualOrigin?"Manual selection overrides character location for routing and max-jump filters.":characterOriginId?`Using ${snapshot?.character.name??"selected character"}'s current system until you choose a manual origin.`:"Choose a solar system to enable distance ranking."}</small></div>
      </div>
      <label><span>SECURITY</span><select value={security} onChange={event=>setSecurity(event.target.value as typeof security)}><option value="all">Any security</option><option value="high">High-sec</option><option value="low">Low-sec</option><option value="null">Null-sec</option></select></label>
      <label><span>REGION</span><select value={regionId} onChange={event=>setRegionId(event.target.value)}><option value="">Any region</option>{(result?.regionOptions??[]).map(region=><option value={region.regionId} key={region.regionId}>{region.regionName}</option>)}</select></label>
      <label><span>MAX JUMPS FROM ORIGIN</span><input type="number" min="0" value={maxJumps} onChange={event=>setMaxJumps(event.target.value)} placeholder={effectiveOriginId?"Any":"Origin required"} disabled={!effectiveOriginId}/></label>
    </section>

    {advanced&&<section className="market-v2-advanced">
      <label><span>System contains</span><input value={systemQuery} onChange={event=>setSystemQuery(event.target.value)} placeholder="Optional exact-area filter"/></label>
      <label><span>Station / structure contains</span><input value={locationQuery} onChange={event=>setLocationQuery(event.target.value)} placeholder="Station or structure"/></label>
      <label><span>Min price</span><input type="number" min="0" value={minPrice} onChange={event=>setMinPrice(event.target.value)}/></label>
      <label><span>Max price</span><input type="number" min="0" value={maxPrice} onChange={event=>setMaxPrice(event.target.value)}/></label>
      <label><span>Min order units</span><input type="number" min="0" value={minVolume} onChange={event=>setMinVolume(event.target.value)}/></label>
      <div className="market-v2-advanced-note"><strong>Filters apply when you press Apply</strong><small>Adjust the filters, then update the results.</small></div>
      <button type="button" onClick={()=>void search(selectedTypeId)} disabled={busy}>Apply filters</button>
    </section>}

    {error&&<div className="market-v2-status error">{error}</div>}
    {result?.message&&<div className="market-v2-status">{result.message}</div>}
    {result&&!resultOriginMatches&&<div className="market-v2-origin-stale"><strong>Origin changed to {effectiveOriginName||"another system"}.</strong><span>Recalculate to refresh jump counts and distance filters.</span><button type="button" onClick={()=>void search(selectedTypeId)} disabled={busy}>Recalculate market view</button></div>}

    {result&&result.typeMatches.length>1&&!result.selectedType&&<div className="market-v2-type-matches"><header><strong>Choose the exact item</strong><small>{result.typeMatches.length} matching market types</small></header><div>{result.typeMatches.map(match=><button key={match.typeId} type="button" onClick={()=>void search(match.typeId)}><strong>{match.name}</strong><small>{match.categoryName} · Type {match.typeId}</small></button>)}</div></div>}

    {result?.selectedType&&resultOriginMatches&&<>
      <section className="market-v2-selected">
        <div className="market-v2-selected-item"><span>SELECTED ITEM</span><h3>{result.selectedType.name}</h3><small>Type {result.selectedType.typeId} · {result.selectedType.categoryName}</small></div>
        <div><span>BEST SELL</span><strong>{money(result.bestSell)}</strong><small>{result.sellOrders.toLocaleString()} matching sell orders</small></div>
        <div><span>BEST BUY</span><strong>{money(result.bestBuy)}</strong><small>{result.buyOrders.toLocaleString()} matching buy orders</small></div>
        <div><span>NEAREST BUY</span><strong>{nearestBuy?`${jumps(nearestBuy.jumpsFromOrigin)} jumps`:"—"}</strong><small>{nearestBuy?`${money(nearestBuy.price)} · ${"systemName" in nearestBuy?nearestBuy.systemName:""}`:"No buyer found"}</small></div>
        <div><span>ACTIVE ORIGIN</span><strong>{effectiveOriginName||"Not available"}</strong><small>{manualOrigin?"manual origin":"character fallback"}</small></div>
        <div className="market-v2-actions"><label><span>QTY</span><input type="number" min="1" value={quantity} onChange={event=>setQuantity(event.target.value)}/></label><button type="button" onClick={()=>onAddToShoppingList({typeId:result.selectedType!.typeId,name:result.selectedType!.name,quantity:Math.max(1,Math.floor(Number(quantity)||1))})}>Add to Shopping List</button><button type="button" disabled={!snapshot?.characterId} onClick={()=>void openSelectedInEve()}>Open in EVE</button></div>
      </section>
      {eveStatus&&<div className="market-v2-status">{eveStatus}</div>}

      <section className="market-v2-depth">
        <article className="market-v2-order-column sell">
          <header><div><span>SELL ORDERS</span><h4>Cheapest sellers</h4><small>Lowest asks first within the active search filters.</small></div><strong>{sellers.length.toLocaleString()} loaded</strong></header>
          <DetailedOrderTable orders={sellers} side="sell" originName={effectiveOriginName} onRoutePlanner={exportOrderToRoutePlanner} onEveDestination={order=>void addOrderDestinationInEve(order)} onAlert={setAlertOrder} canExportRoute={Boolean(effectiveOriginId)} canExportEve={Boolean(snapshot?.characterId)}/>
        </article>
        <article className="market-v2-order-column buy">
          <header className="market-v2-buy-head"><div><span>BUY ORDERS</span><h4>{buyRanking==="nearest"?"Closest buyers":"Highest-paying buyers"}</h4><small>Rank buyers by distance from your origin or by price.</small></div><div className="market-v2-buy-ranking"><span>RANK BUYERS</span><div><button type="button" className={buyRanking==="nearest"?"active":""} disabled={!effectiveOriginId} onClick={()=>setBuyRanking("nearest")}>Nearest</button><button type="button" className={buyRanking==="highest"?"active":""} onClick={()=>setBuyRanking("highest")}>Highest price</button></div></div></header>
          {regionalBuySignals.length>0&&<RegionalSignals signals={regionalBuySignals} originName={effectiveOriginName} onRoutePlanner={exportOrderToRoutePlanner} onEveDestination={signal=>void addOrderDestinationInEve(signal)} canExportRoute={Boolean(effectiveOriginId)} canExportEve={Boolean(snapshot?.characterId)}/>}
          <DetailedOrderTable orders={buyers} side="buy" originName={effectiveOriginName} onRoutePlanner={exportOrderToRoutePlanner} onEveDestination={order=>void addOrderDestinationInEve(order)} onAlert={setAlertOrder} canExportRoute={Boolean(effectiveOriginId)} canExportEve={Boolean(snapshot?.characterId)}/>
        </article>
      </section>
    </>}
    {alertOrder&&<MarketAlertDialog order={alertOrder} onClose={()=>setAlertOrder(null)} onCreated={(message)=>setEveStatus(message)} />}
  </section>;
}
