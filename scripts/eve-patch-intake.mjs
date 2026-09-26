import AdmZip from "adm-zip";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SDE_URL = "https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip";
const REQUIRED = [
  "types.jsonl", "groups.jsonl", "categories.jsonl", "typeDogma.jsonl",
  "dogmaAttributes.jsonl", "dogmaEffects.jsonl", "blueprints.jsonl",
  "typeMaterials.jsonl", "marketGroups.jsonl",
];
const legacyRoot = "F:\\New Eden Sage Data\\Static Data";
const staticRoot = process.env.NEW_EDEN_SAGE_STATIC_DATA?.trim()
  || (fs.existsSync(legacyRoot)
    ? legacyRoot
    : path.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(), "New Eden Sage Data", "Static Data"));
const active = path.join(staticRoot, "eve-static-data-jsonl.zip");
const previous = path.join(staticRoot, "eve-static-data-jsonl.previous.zip");
const partial = path.join(staticRoot, `eve-static-data-jsonl.patch-${process.pid}.partial.zip`);
const statePath = path.join(staticRoot, "sde-update-state.json");
const reportPath = path.join(staticRoot, "sde-patch-diff-latest.json");

function signatureFrom(response) {
  return [response.headers.get("etag"), response.headers.get("last-modified"), response.headers.get("content-length")]
    .filter(Boolean).join("|");
}
function sha256(buffer) { return crypto.createHash("sha256").update(buffer).digest("hex"); }
function entry(zip, name) {
  const item = zip.getEntry(name);
  if (!item) throw new Error(`SDE missing required entry ${name}`);
  return item;
}
function keyFor(row, index) {
  for (const key of ["_key","typeID","groupID","categoryID","attributeID","effectID","blueprintTypeID","marketGroupID","solarSystemID","constellationID","regionID"]) {
    if (row?.[key] !== undefined) return String(row[key]);
  }
  return String(index);
}
function summarizeJsonl(oldZip, newZip, name) {
  const oldLines = entry(oldZip, name).getData().toString("utf8").split(/\r?\n/).filter(Boolean);
  const newLines = entry(newZip, name).getData().toString("utf8").split(/\r?\n/).filter(Boolean);
  const oldMap = new Map();
  const newMap = new Map();
  oldLines.forEach((line, index) => {
    try { const row=JSON.parse(line); oldMap.set(keyFor(row,index), {hash:sha256(Buffer.from(line)), row}); } catch {}
  });
  newLines.forEach((line, index) => {
    try { const row=JSON.parse(line); newMap.set(keyFor(row,index), {hash:sha256(Buffer.from(line)), row}); } catch {}
  });
  const added=[], removed=[], changed=[];
  for (const [key,value] of newMap) {
    const before=oldMap.get(key);
    if (!before) added.push(key);
    else if (before.hash !== value.hash) changed.push(key);
  }
  for (const key of oldMap.keys()) if (!newMap.has(key)) removed.push(key);
  return {oldRows:oldMap.size,newRows:newMap.size,addedCount:added.length,removedCount:removed.length,changedCount:changed.length,added:added.slice(0,1000),removed:removed.slice(0,1000),changed:changed.slice(0,3000)};
}
function definitionDetails(oldZip,newZip,name,ids) {
  const read=(zip)=>{
    const map=new Map();
    for(const line of entry(zip,name).getData().toString("utf8").split(/\r?\n/)){
      if(!line) continue;
      try{ const row=JSON.parse(line); map.set(String(keyFor(row,0)),row); }catch{}
    }
    return map;
  };
  const before=read(oldZip), after=read(newZip);
  return ids.map(id=>({id,before:before.get(String(id)) ?? null,after:after.get(String(id)) ?? null}));
}
function changedNamedTypes(oldZip,newZip,names) {
  const parse=(zip)=>{
    const map=new Map();
    for(const line of entry(zip,"types.jsonl").getData().toString("utf8").split(/\r?\n/)){
      if(!line) continue;
      try{
        const row=JSON.parse(line);
        const name=String(row.name?.en ?? row.name ?? "");
        if(names.has(name.toLowerCase())) map.set(name.toLowerCase(),row);
      }catch{}
    }
    return map;
  };
  const before=parse(oldZip), after=parse(newZip), out={};
  for(const name of names){
    const a=before.get(name), b=after.get(name);
    out[name]={before:a ?? null,after:b ?? null,changed:JSON.stringify(a)!==JSON.stringify(b)};
  }
  return out;
}
async function main(){
  await fsp.mkdir(staticRoot,{recursive:true});
  if(!fs.existsSync(active)) throw new Error(`No active SDE at ${active}`);
  const activeBytes=await fsp.readFile(active);

  const response=await fetch(SDE_URL,{headers:{"X-User-Agent":"NewEdenSage/1.1.27 patch-intake"}});
  if(!response.ok || !response.body) throw new Error(`CCP SDE download failed (${response.status})`);
  const remoteSignature=signatureFrom(response);
  const body=Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(partial,body);
  const replacingActive=sha256(activeBytes)!==sha256(body);
  let oldBytes;
  if(replacingActive){
    oldBytes=activeBytes;
    await fsp.writeFile(previous,activeBytes);
  }else{
    if(!fs.existsSync(previous)){
      await fsp.rm(partial,{force:true});
      let existingReport=null;
      try{ existingReport=JSON.parse(await fsp.readFile(reportPath,"utf8")); }catch{}
      console.log(JSON.stringify({
        ok:true,
        status:"current-no-previous",
        staticRoot,
        remoteSignature,
        activeSha256:sha256(activeBytes),
        reportPath:existingReport?reportPath:null,
        note:"Active SDE already matches CCP. No previous archive exists from before retention was enabled; preserving the existing diff report instead of fabricating a new baseline."
      },null,2));
      return;
    }
    oldBytes=await fsp.readFile(previous);
  }

  const oldZip=new AdmZip(previous);
  const newZip=new AdmZip(partial);
  const available=new Set(newZip.getEntries().map(x=>x.entryName));
  const missing=REQUIRED.filter(x=>!available.has(x));
  if(missing.length) throw new Error(`Downloaded SDE missing doctrine-required entries: ${missing.join(", ")}`);
  entry(newZip,"categories.jsonl").getData();

  const diffs={};
  for(const name of REQUIRED) diffs[name]=summarizeJsonl(oldZip,newZip,name);
  const mapEntries=[...available].filter(name=>/solar.?systems|constellations|regions/i.test(name)).sort();
  const npcEntries=[...available].filter(name=>/npc|corporation|faction|station/i.test(name)).sort();

  const targetNames=new Set([
    "harpy","hawk","ishkur","vengeance","cerberus","sacrilege","eagle","deimos",
    "bane","karura","hubris","valravn","kronos","vargur","paladin","golem","babaroga",
    "marshal","panther","python","redeemer","sin","widow","vigilant","phobos",
    "zero-point field manipulator"
  ]);
  const typeNames=new Map();
  for(const line of entry(newZip,"types.jsonl").getData().toString("utf8").split(/\r?\n/)){
    if(!line) continue;
    try{ const row=JSON.parse(line); typeNames.set(String(keyFor(row,0)),String(row.name?.en ?? row.name ?? keyFor(row,0))); }catch{}
  }
  const changedTypeDogmaNames=diffs["typeDogma.jsonl"].changed.map(id=>({typeId:id,name:typeNames.get(id) ?? null}));
  const changedTypeMaterialNames=diffs["typeMaterials.jsonl"].changed.map(id=>({typeId:id,name:typeNames.get(id) ?? null}));
  const changedBlueprintNames=diffs["blueprints.jsonl"].changed.map(id=>({blueprintTypeId:id,name:typeNames.get(id) ?? null}));

  const report={
    generatedAt:new Date().toISOString(),
    source:SDE_URL,
    previousArchive:previous,
    activeArchive:active,
    previousSha256:sha256(oldBytes),
    downloadedSha256:sha256(body),
    remoteSignature,
    requiredEntries:REQUIRED,
    mapEntriesReviewed:mapEntries,
    npcReferenceEntriesReviewed:npcEntries,
    diffs,
    changedTypeDogmaNames,
    changedTypeMaterialNames,
    changedBlueprintNames,
    dogmaAttributeDefinitions: definitionDetails(oldZip,newZip,"dogmaAttributes.jsonl",[...diffs["dogmaAttributes.jsonl"].added,...diffs["dogmaAttributes.jsonl"].changed]),
    dogmaEffectDefinitions: definitionDetails(oldZip,newZip,"dogmaEffects.jsonl",[...diffs["dogmaEffects.jsonl"].added,...diffs["dogmaEffects.jsonl"].changed]),
    targetedTypes:changedNamedTypes(oldZip,newZip,targetNames),
  };

  if(replacingActive){
    await fsp.rm(active,{force:true});
    await fsp.rename(partial,active);
  }else{
    await fsp.rm(partial,{force:true});
  }
  let state={};
  try{ state=JSON.parse(await fsp.readFile(statePath,"utf8")); }catch{}
  state.lastCheckedAt=report.generatedAt;
  state.remoteSignature=remoteSignature;
  state.activeSignature=remoteSignature;
  state.previousArchive=previous;
  state.patchDiffReport=reportPath;
  delete state.stagedAt;
  delete state.stagedSignature;
  await fsp.writeFile(statePath,JSON.stringify(state,null,2),"utf8");
  await fsp.writeFile(reportPath,JSON.stringify(report,null,2),"utf8");
  console.log(JSON.stringify({ok:true,staticRoot,remoteSignature,previousSha256:report.previousSha256,activeSha256:report.downloadedSha256,diffSummary:Object.fromEntries(Object.entries(diffs).map(([k,v])=>[k,{added:v.addedCount,removed:v.removedCount,changed:v.changedCount}])),targetedChanged:Object.entries(report.targetedTypes).filter(([,v])=>v.changed).map(([k])=>k),reportPath},null,2));
}
main().catch(async error=>{ await fsp.rm(partial,{force:true}).catch(()=>{}); console.error(error); process.exitCode=1; });
