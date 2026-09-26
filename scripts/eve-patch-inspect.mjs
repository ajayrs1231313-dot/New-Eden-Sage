import AdmZip from "adm-zip";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const legacy="F:\\New Eden Sage Data\\Static Data";
const root=fs.existsSync(legacy)?legacy:path.join(process.env.LOCALAPPDATA||process.env.APPDATA||os.homedir(),"New Eden Sage Data","Static Data");
const zip=new AdmZip(path.join(root,"eve-static-data-jsonl.zip"));
const report=JSON.parse(await fsp.readFile(path.join(root,"sde-patch-diff-latest.json"),"utf8"));
function rows(name){const e=zip.getEntry(name);if(!e)throw new Error("Missing "+name);return e.getData().toString("utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);}
function key(r){return String(r._key??r.typeID??r.attributeID??r.effectID??r.blueprintTypeID??"");}
function pick(name,ids){const wanted=new Set(ids.map(String));return rows(name).filter(r=>wanted.has(key(r)));}
const attrs=[...report.diffs["dogmaAttributes.jsonl"].added,...report.diffs["dogmaAttributes.jsonl"].changed];
const effects=[...report.diffs["dogmaEffects.jsonl"].added,...report.diffs["dogmaEffects.jsonl"].changed];
const typeRows=rows("types.jsonl");
const groupNames=new Map(rows("groups.jsonl").map(r=>[String(r._key),String(r.name?.en??r.name??r._key)]));
const typeNames=new Map(typeRows.map(r=>[String(r._key),String(r.name?.en??r.name??r._key)]));
const typeByName=new Map(typeRows.map(r=>[String(r.name?.en??r.name??r._key).toLowerCase(),r]));
const changedDogma=report.diffs["typeDogma.jsonl"].changed.map(String);
console.log(JSON.stringify({
 attributes:pick("dogmaAttributes.jsonl",attrs),
 effects:pick("dogmaEffects.jsonl",effects),
 changedTypeDogma:changedDogma.map(id=>({typeId:id,name:typeNames.get(id)??null})).filter(x=>x.name),
 shipGroups:["Rorqual","Obelisk","Ark","Revelation","Phoenix Navy Issue","Hel","Avatar","Ninazu","Bane","Simurgh"].map(name=>{const row=typeByName.get(name.toLowerCase());return {name,typeId:row?._key??null,groupId:row?.groupID??null,groupName:row?.groupID!=null?groupNames.get(String(row.groupID))??null:null};}),
 capitalLikeGroups:[...groupNames].filter(([,name])=>/capital|dreadnought|carrier|titan|freighter/i.test(name)).map(([id,name])=>({id:Number(id),name})).sort((a,b)=>a.id-b.id),
},null,2));
