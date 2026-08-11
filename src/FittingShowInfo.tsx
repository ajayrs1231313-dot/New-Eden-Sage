import { useEffect, useMemo, useState } from "react";
import "./fitting-show-info.css";

type ShowInfoTarget = { typeId:number; name?:string };
type FittingTypeInfo = Awaited<ReturnType<typeof window.sage.getFittingTypeInfoLocal>>;
type InfoTab = "description" | "attributes" | "requirements" | "effects";

const typeImage = (typeId:number) => `sage-asset://type/${typeId}/icon?size=128`;
const fmt = (value:number|undefined, digits=2) => value == null || !Number.isFinite(value) ? "—" : value.toLocaleString(undefined,{maximumFractionDigits:digits});
const placementLabel:Record<string,string> = {
  ship:"Ship hull", high:"High slot", mid:"Mid slot", low:"Low slot", rig:"Rig slot", subsystem:"Subsystem slot",
  drone:"Drone bay", fighter:"Fighter hangar", implant:"Implant", booster:"Booster", charge:"Charge / ammunition", cargo:"Cargo",
};
function valueText(value:number, unit?:string){
  const shown = Math.abs(value) >= 1000 ? value.toLocaleString(undefined,{maximumFractionDigits:2}) : Number(value.toFixed(4)).toLocaleString();
  return unit ? `${shown} ${unit}` : shown;
}

export function FittingShowInfo({ target, onClose }: { target:ShowInfoTarget|null; onClose():void }) {
  const [info,setInfo]=useState<FittingTypeInfo|null>(null);
  const [status,setStatus]=useState("");
  const [tab,setTab]=useState<InfoTab>("description");
  useEffect(()=>{
    if(!target){ setInfo(null); setStatus(""); return; }
    let cancelled=false; setInfo(null); setTab("description"); setStatus("Reading local CCP SDE…");
    void window.sage.getFittingTypeInfoLocal(target.typeId).then(result=>{if(!cancelled){setInfo(result);setStatus("");}}).catch(error=>{if(!cancelled)setStatus(error instanceof Error?error.message:"Could not load Show Info.");});
    return()=>{cancelled=true;};
  },[target?.typeId]);
  const attributeGroups=useMemo(()=>{
    const groups=new Map<string,FittingTypeInfo["attributes"]>();
    for(const attribute of info?.attributes ?? []){const key=attribute.category || "Other";const list=groups.get(key)??[];list.push(attribute);groups.set(key,list);}
    return [...groups.entries()];
  },[info]);
  if(!target)return null;
  return <div className="fitting-show-info-backdrop" onMouseDown={onClose}>
    <section className="fitting-show-info" onMouseDown={event=>event.stopPropagation()} aria-label={`Show info ${target.name ?? target.typeId}`}>
      <header>
        <img src={typeImage(target.typeId)} />
        <div><p className="eyebrow">SHOW INFO · LOCAL CCP SDE</p><h2>{info?.name ?? target.name ?? `Type ${target.typeId}`}</h2><span>{info ? `${info.group.name} · ${info.category.name}` : status}</span></div>
        <button type="button" onClick={onClose} aria-label="Close Show Info">×</button>
      </header>
      {info && <>
        <div className="show-info-summary">
          <span><small>Fit destination</small><strong>{placementLabel[info.placement] ?? info.placement}</strong></span>
          <span><small>Meta / tech</small><strong>{info.metaLevel ?? 0} / {info.techLevel ?? "—"}</strong></span>
          <span><small>Volume</small><strong>{fmt(info.physical.volumeM3)} m³</strong></span>
          <span><small>Mass</small><strong>{fmt(info.physical.massKg)} kg</strong></span>
          <span><small>Base price</small><strong>{info.physical.basePrice == null ? "—" : `${fmt(info.physical.basePrice,0)} ISK`}</strong></span>
        </div>
        <nav className="show-info-tabs">
          {(["description","attributes","requirements","effects"] as InfoTab[]).map(value=><button type="button" className={tab===value?"active":""} onClick={()=>setTab(value)} key={value}>{value}</button>)}
        </nav>
        <div className="show-info-body">
          {tab==="description" && <div className="show-info-description">
            <p>{info.description || "No description is published in the current CCP SDE."}</p>
            <div className="show-info-route"><strong>Market group</strong><span>{info.marketGroup?.path.join(" › ") || "Not assigned to a market group"}</span></div>
            <div className="show-info-properties">
              <article><span>Group</span><strong>{info.group.name}</strong><small>ID {info.group.id}</small></article>
              <article><span>Category</span><strong>{info.category.name}</strong><small>ID {info.category.id}</small></article>
              <article><span>Capacity</span><strong>{info.physical.capacityM3 == null ? "—" : `${fmt(info.physical.capacityM3)} m³`}</strong></article>
              <article><span>Radius</span><strong>{info.physical.radiusM == null ? "—" : `${fmt(info.physical.radiusM)} m`}</strong></article>
              <article><span>Portion size</span><strong>{fmt(info.physical.portionSize,0)}</strong></article>
              <article><span>Type ID</span><strong>{info.typeId}</strong></article>
            </div>
            {info.fitting.length>0 && <><h3>Fitting</h3><div className="show-info-properties">{info.fitting.map(item=><article key={item.attributeId}><span>{item.label}</span><strong>{valueText(item.value,item.unit)}</strong></article>)}</div></>}
          </div>}
          {tab==="attributes" && <div className="show-info-attribute-groups">{attributeGroups.length ? attributeGroups.map(([category,attributes])=><section key={category}><h3>{category}</h3>{attributes.map(attribute=><div className="show-info-attribute" key={attribute.attributeId} title={attribute.description || attribute.internalName}><span>{attribute.name}</span><strong>{valueText(attribute.value,attribute.unit)}</strong></div>)}</section>) : <p>No published DOGMA attributes.</p>}</div>}
          {tab==="requirements" && <div className="show-info-requirements">{info.requirements.length ? info.requirements.map(requirement=><article key={requirement.skillId}><img src={typeImage(requirement.skillId)} /><span><strong>{requirement.name}</strong><small>Required level {requirement.level}</small></span><b>{requirement.level}</b></article>) : <p>No skill prerequisites are published for this item.</p>}</div>}
          {tab==="effects" && <div className="show-info-effects">{info.effects.length ? info.effects.map(effect=><article key={effect.effectId}><span><strong>{effect.name}</strong><small>Effect ID {effect.effectId} · category {effect.category}</small>{effect.description && <p>{effect.description}</p>}</span></article>) : <p>No DOGMA effects are attached to this type.</p>}</div>}
        </div>
      </>}
      {!info && <div className="show-info-loading">{status || "Loading…"}</div>}
    </section>
  </div>;
}

export type { ShowInfoTarget };
