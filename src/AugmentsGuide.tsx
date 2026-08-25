import { useEffect, useMemo, useState } from "react";
import type { AugmentGoal, AugmentGuideItem, AugmentGuideResult, CharacterSnapshot } from "./types";

const isk=(value:number|null|undefined)=>value==null?"—":`${new Intl.NumberFormat("en-GB",{maximumFractionDigits:0}).format(value)} ISK`;

export function AugmentsGuide({snapshot,marketDataRevision=0}:{snapshot?:CharacterSnapshot;marketDataRevision?:number}){
  const [guide,setGuide]=useState<AugmentGuideResult|null>(null);
  const [goals,setGoals]=useState<AugmentGoal[]>([]);
  const [quotes,setQuotes]=useState(new Map<number,{bestBuy:number|null;bestSell:number|null;bestBuySystem:string|null;bestSellSystem:string|null}>());
  const [selected,setSelected]=useState<AugmentGuideItem|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const installedIds=useMemo(()=>new Set((snapshot?.extended?.implants??[]).map(value=>typeof value==="number"?value:value.typeId)),[snapshot?.characterId,snapshot?.updatedAt]);
  useEffect(()=>{
    let cancelled=false;
    if(!snapshot){setGuide(null);setSelected(null);return;}
    setBusy(true);setMessage("Reading CCP DOGMA implant effects…");
    const ids=[...installedIds];
    void window.sage.getAugmentGuideLocal(ids).then(async value=>{
      if(cancelled)return;setGuide(value);setMessage(`${value.items.length.toLocaleString()} published implants indexed from CCP DOGMA.`);
      const priceIds=value.items.map(item=>item.typeId);
      const priced=await window.sage.getGlobalMarketQuotes(priceIds);
      if(cancelled)return;setQuotes(new Map(priced.quotes.map(row=>[row.typeId,row])));
    }).catch(error=>{if(!cancelled)setMessage(error instanceof Error?error.message:"Augment guide is unavailable.");}).finally(()=>{if(!cancelled)setBusy(false);});
    return()=>{cancelled=true;};
  },[snapshot?.characterId,snapshot?.updatedAt,marketDataRevision]);
  const recommendations=useMemo(()=>{
    if(!guide||!goals.length)return[];
    return guide.items.filter(item=>!installedIds.has(item.typeId)&&goals.some(goal=>item.goals.includes(goal))).map(item=>({item,matches:goals.filter(goal=>item.goals.includes(goal)).length})).sort((a,b)=>b.matches-a.matches||b.item.score-a.item.score||a.item.name.localeCompare(b.item.name)).slice(0,80);
  },[guide,goals,installedIds]);
  if(!snapshot)return <section className="empty"><p className="eyebrow">NO CAPSULEER SELECTED</p><h2>Connect a character to plan augments</h2></section>;
  const installed=guide?.installed??[];
  const quote=selected?quotes.get(selected.typeId):null;
  return <section className="augments-page augment-guide-page">
    <div className="section-heading"><div><p className="eyebrow">ACTIVE CLONE AUGMENTATIONS</p><h2>Augments guide</h2><p>See what your installed implants are doing, choose the outcome you want, then compare CCP-DOGMA-backed options and retained market prices.</p></div><strong>{installedIds.size} installed</strong></div>
    <div className="augment-installed-grid">
      {(guide?installed:[...installedIds].map(typeId=>({typeId,name:`Implant ${typeId}`,slot:null,effects:[],goals:[],score:0,metaLevel:0,description:"",requirements:[]} as AugmentGuideItem))).map(item=>{
        const q=quotes.get(item.typeId);return <button type="button" className="augment-installed-card" key={item.typeId} onClick={()=>setSelected(item)}>
          <span>{item.slot?`SLOT ${item.slot}`:"INSTALLED"}</span><strong>{item.name}</strong>
          <div>{item.effects.filter(effect=>effect.helpful!==false).slice(0,4).map((effect,index)=><small key={`${effect.targetAttributeId}-${index}`}>{effect.summary}{effect.appliesTo?` · ${effect.appliesTo}`:""}</small>)}</div>
          {!item.effects.length&&<small>Installed · effect detail loading from local CCP DOGMA</small>}
          {q&&<em>Market replacement: {isk(q.bestSell)}</em>}
        </button>;
      })}
      {!installedIds.size&&<div className="empty-panel">No implants are installed in the active clone snapshot.</div>}
    </div>
    <div className="augment-planner">
      <div className="augment-goal-panel"><div><p className="eyebrow">WHAT DO YOU WANT THE AUGMENTS TO DO?</p><h3>Choose one or more goals</h3></div>
        <div className="augment-goal-grid">{guide?.goals.map(goal=><button type="button" key={goal.id} className={goals.includes(goal.id)?"active":""} onClick={()=>setGoals(current=>current.includes(goal.id)?current.filter(id=>id!==goal.id):[...current,goal.id])}><strong>{goal.label}</strong><small>{goal.description}</small></button>)}</div>
        <div className="augment-guide-status">{busy?"Preparing guide…":message}</div>
      </div>
      <div className="augment-recommendations">
        <div className="augment-recommendation-head"><div><p className="eyebrow">OPTIONS</p><h3>{goals.length ? `${recommendations.length} matching options` : "Choose goals above"}</h3></div>{goals.length>0&&<button type="button" onClick={()=>setGoals([])}>Clear goals</button>}</div>
        {!goals.length?<div className="empty-panel">Select the outcomes you care about. Sage will rank implants that affect those DOGMA attributes.</div>:<div className="augment-option-list">{recommendations.map(({item,matches})=>{const q=quotes.get(item.typeId);const conflict=installed.some(installedItem=>item.slot&&installedItem.slot===item.slot);return <button type="button" key={item.typeId} className={selected?.typeId===item.typeId?"selected":""} onClick={()=>setSelected(item)}><span>{item.slot?`Slot ${item.slot}`:"Implant"}{conflict?" · REPLACES INSTALLED":""}</span><strong>{item.name}</strong><small>{matches}/{goals.length} selected goals · {item.effects.slice(0,2).map(effect=>effect.summary).join(" · ")||"Published implant"}</small><em>{q?.bestSell!=null?`Buy from ${q.bestSellSystem??"market"}: ${isk(q.bestSell)}`:"No retained sell quote"}</em></button>;})}</div>}
      </div>
      <aside className="augment-detail">{selected?<><p className="eyebrow">SELECTED AUGMENT</p><h3>{selected.name}</h3><div className="augment-detail-meta"><span>{selected.slot?`Slot ${selected.slot}`:"Slot unknown"}</span><span>{quote?.bestSell!=null?`Buy ${isk(quote.bestSell)}`:"No sell quote"}</span><span>{quote?.bestBuy!=null?`Buy order ${isk(quote.bestBuy)}`:"No buy quote"}</span></div><p>{selected.description||"No CCP description."}</p><strong>Effects</strong><div className="augment-effect-list">{selected.effects.length?selected.effects.map((effect,index)=><div key={`${effect.effectName}-${index}`}><b>{effect.summary}</b><small>{effect.appliesTo?`Applies to ${effect.appliesTo} · `:""}{effect.effectName}</small></div>):<small>No supported modifier rows were exposed for this implant.</small>}</div>{selected.requirements.length>0&&<><strong>Requirements</strong><small>{selected.requirements.map(req=>`${req.name} ${req.level}`).join(" · ")}</small></>}</>:<><p className="eyebrow">DETAIL</p><h3>Select an implant</h3><p>Installed and recommended implants can be opened here for effect and market detail.</p></>}</aside>
    </div>
  </section>;
}
