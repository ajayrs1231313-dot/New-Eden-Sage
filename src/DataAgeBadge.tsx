import { useEffect, useMemo, useState } from "react";
import type { CharacterSnapshot } from "./types";

type Props={view:string;snapshot?:CharacterSnapshot;marketDataRevision:number};
function valid(value:unknown){const ms=Date.parse(String(value??""));return Number.isFinite(ms)?ms:null;}

export function DataAgeBadge({view,snapshot,marketDataRevision}:Props){
  const [sourceTimes,setSourceTimes]=useState<Array<{source:string;at:number}>>([]);
  const [tick,setTick]=useState(0);
  useEffect(()=>{const timer=window.setInterval(()=>setTick(value=>value+1),60_000);return()=>window.clearInterval(timer);},[]);
  useEffect(()=>{
    let cancelled=false;
    void (async()=>{
      if(view==="settings"){if(!cancelled)setSourceTimes([]);return;}
      const rows:Array<{source:string;at:number}>=[];
      const snapshotAt=valid(snapshot?.updatedAt);
      const characterViews=new Set(["overview","augments","skills","isk","navigation","wormholes","fittings","loot","industrial","corporation"]);
      if(snapshotAt!=null&&characterViews.has(view))rows.push({source:"character sync",at:snapshotAt});
      if(view==="market"||view==="isk"||view==="industrial"){
        try{const storage=await window.sage.getMarketStorage();const at=valid(storage.raw?.createdAt);if(at!=null)rows.push({source:"market",at});}catch{}
      }
      if(view==="navigation"){
        try{const live=await window.sage.getNavigationLiveMapMetrics(false);const at=valid(live.fetchedAt);if(at!=null)rows.push({source:"navigation live",at});}catch{}
      }
      if(view==="wormholes"){
        try{const store=await window.sage.getWormholeCommandStore();const at=valid((store as any)?.updatedAt);if(at!=null)rows.push({source:"wormhole chain",at});}catch{}
      }
      if(!cancelled)setSourceTimes(rows);
    })();
    return()=>{cancelled=true;};
  },[view,snapshot?.characterId,snapshot?.updatedAt,snapshot?.snapshotState,marketDataRevision]);
  const oldest=useMemo(()=>sourceTimes.length?sourceTimes.reduce((a,b)=>a.at<=b.at?a:b):null,[sourceTimes,tick]);
  if(view==="settings")return <div className="data-age-badge local" title="Settings use local configuration rather than synced EVE data.">LOCAL DATA</div>;
  if(snapshot?.snapshotState==="bootstrap")return <div className="data-age-badge required" title="Character is connected but has not completed its first Sync All yet.">SYNC REQUIRED</div>;
  if(!oldest)return <div className="data-age-badge missing" title="No relevant synced dataset is loaded for this view.">NO DATA</div>;
  const minutes=Math.max(0,Math.floor((Date.now()-oldest.at)/60_000));
  const title=`Oldest relevant source: ${oldest.source} · ${new Date(oldest.at).toLocaleString()}`;
  if(minutes>=1440)return <div className="data-age-badge required" title={title}>DATA SYNC REQUIRED</div>;
  const text=minutes<60?`${minutes}m`:`${Math.floor(minutes/60)}h`;
  return <div className="data-age-badge" title={title}><span>DATA AGE</span><strong>{text}</strong></div>;
}
