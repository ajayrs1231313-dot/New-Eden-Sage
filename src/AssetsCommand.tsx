import { useMemo, useState } from "react";
import type { CharacterSnapshot } from "./types";
import "./assets-command.css";

type AssetRow={
  key:string;
  typeId:number;
  item:string;
  quantity:number;
  owners:string[];
  ownerIds:string[];
  station:string;
  system:string;
  locationFlag:string;
  locationId:number;
  totalVolume:number;
  estimatedValue:number;
};

const money=(value:number)=>new Intl.NumberFormat("en-GB",{maximumFractionDigits:0}).format(value||0);
const compact=(value:number)=>new Intl.NumberFormat("en-GB",{notation:"compact",maximumFractionDigits:1}).format(value||0);
const icon=(typeId:number)=>typeId>0?`sage-asset://type/${typeId}/icon?size=64`:"";

export function AssetsCommand({snapshots}:{snapshots:CharacterSnapshot[]}){
  const [characterId,setCharacterId]=useState("all");
  const [merge,setMerge]=useState(true);
  const [query,setQuery]=useState("");

  const source=useMemo(()=>snapshots.flatMap(snapshot=>{
    const assets=Array.isArray(snapshot.extended?.assets)?snapshot.extended!.assets!:[];
    return assets.map((asset:any)=>({
      typeId:Number(asset?.type_id??0),
      item:String(asset?.item??`Type ${asset?.type_id??"?"}`),
      quantity:Math.max(0,Number(asset?.quantity??0)||0),
      owner:snapshot.character.name,
      ownerId:snapshot.characterId,
      station:String(asset?.station??""),
      system:String(asset?.system??""),
      locationFlag:String(asset?.location_flag??""),
      locationId:Number(asset?.root_location_id??asset?.location_id??0),
      totalVolume:Number(asset?.total_volume_m3??0)||0,
      estimatedValue:Number(asset?.estimatedValue??0)||0,
    }));
  }),[snapshots]);

  const scoped=useMemo(()=>characterId==="all"?source:source.filter(row=>row.ownerId===characterId),[source,characterId]);
  const rows=useMemo<AssetRow[]>(()=>{
    const raw:AssetRow[]=scoped.map((row,index)=>({key:`${row.ownerId}:${row.typeId}:${row.locationId}:${row.locationFlag}:${index}`,typeId:row.typeId,item:row.item,quantity:row.quantity,owners:[row.owner],ownerIds:[row.ownerId],station:row.station,system:row.system,locationFlag:row.locationFlag,locationId:row.locationId,totalVolume:row.totalVolume,estimatedValue:row.estimatedValue}));
    if(!merge)return raw;
    const grouped=new Map<string,AssetRow>();
    for(const row of raw){
      const location=row.station||row.system||String(row.locationId);
      const key=`${row.typeId}|${location}|${row.locationFlag}`;
      const current=grouped.get(key);
      if(!current){grouped.set(key,{...row,key,owners:[...row.owners],ownerIds:[...row.ownerIds]});continue;}
      current.quantity+=row.quantity;
      current.totalVolume+=row.totalVolume;
      current.estimatedValue+=row.estimatedValue;
      for(const owner of row.owners)if(!current.owners.includes(owner))current.owners.push(owner);
      for(const ownerId of row.ownerIds)if(!current.ownerIds.includes(ownerId))current.ownerIds.push(ownerId);
    }
    return [...grouped.values()];
  },[scoped,merge]);
  const filtered=useMemo(()=>{
    const needle=query.trim().toLowerCase();
    const values=needle?rows.filter(row=>[row.item,...row.owners,row.station,row.system,row.locationFlag,String(row.locationId)].some(value=>String(value).toLowerCase().includes(needle))):rows;
    return values.sort((a,b)=>b.estimatedValue-a.estimatedValue||a.item.localeCompare(b.item));
  },[rows,query]);
  const visible=filtered.slice(0,1000);
  const totalQuantity=filtered.reduce((sum,row)=>sum+row.quantity,0);
  const totalValue=filtered.reduce((sum,row)=>sum+row.estimatedValue,0);
  const totalVolume=filtered.reduce((sum,row)=>sum+row.totalVolume,0);
  const syncedCharacters=snapshots.filter(snapshot=>Array.isArray(snapshot.extended?.assets));

  return <section className="assets-command-page">
    <header className="assets-command-head">
      <div><p className="eyebrow">SYNCED ASSET INTELLIGENCE</p><h2>Assets</h2><p>Search every connected character's retained EVE assets without triggering another sync.</p></div>
      <span>{filtered.length.toLocaleString()} STACKS</span>
    </header>
    <div className="assets-command-summary">
      <article><small>Characters</small><strong>{syncedCharacters.length}/{snapshots.length}</strong><span>with asset snapshots</span></article>
      <article><small>Matching quantity</small><strong>{compact(totalQuantity)}</strong><span>{totalQuantity.toLocaleString()} units</span></article>
      <article><small>Estimated value</small><strong>{compact(totalValue)} ISK</strong><span>{money(totalValue)} ISK</span></article>
      <article><small>Volume</small><strong>{compact(totalVolume)} m³</strong><span>{money(totalVolume)} m³</span></article>
    </div>
    <div className="assets-command-controls">
      <label><span>Character</span><select value={characterId} onChange={event=>setCharacterId(event.target.value)}><option value="all">All characters</option>{snapshots.map(snapshot=><option value={snapshot.characterId} key={snapshot.characterId}>{snapshot.character.name}</option>)}</select></label>
      <label className="assets-merge-toggle"><input type="checkbox" checked={merge} onChange={event=>setMerge(event.target.checked)}/><span><strong>Merge matching stacks</strong><small>Combines the same item at the same location across selected characters.</small></span></label>
      <label className="assets-search"><span>Search assets</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Item, character, station, system or location..."/></label>
    </div>
    <div className="assets-table">
      <div className="assets-table-head"><span>Asset</span><span>Character</span><span>Location</span><span>Qty</span><span>Est. value</span></div>
      <div className="assets-table-body">{visible.map(row=><article key={row.key}>
        <div className="assets-item">{row.typeId>0&&<img src={icon(row.typeId)} alt="" loading="lazy"/>}<span><strong>{row.item}</strong><small>{row.locationFlag||"Asset"} · Type {row.typeId}</small></span></div>
        <div className="assets-owner"><strong>{row.owners.length===1?row.owners[0]:`${row.owners.length} characters`}</strong><small>{row.owners.length>1?row.owners.join(", "):merge?"Merged view":"Individual stack"}</small></div>
        <div className="assets-location"><strong>{row.station||row.system||`Location ${row.locationId}`}</strong><small>{row.station&&row.system?row.system:row.locationFlag||"Unknown location"}</small></div>
        <div className="assets-number"><strong>{row.quantity.toLocaleString()}</strong><small>{compact(row.totalVolume)} m³</small></div>
        <div className="assets-number value"><strong>{money(row.estimatedValue)} ISK</strong><small>{row.quantity>0&&row.estimatedValue>0?`${money(row.estimatedValue/row.quantity)} / unit`:"No retained price"}</small></div>
      </article>)}
      {!filtered.length&&<div className="assets-empty"><strong>No matching assets</strong><span>{source.length?"Change the character or search filter.":"Sync character assets to populate this view."}</span></div>}</div>
    </div>
    {filtered.length>visible.length&&<div className="assets-limit-note">Showing the first {visible.length.toLocaleString()} of {filtered.length.toLocaleString()} matching stacks. Narrow the search to drill further.</div>}
  </section>;
}
