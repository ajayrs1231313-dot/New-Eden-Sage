import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const fittingsPath=path.join(root,"src","Fittings.tsx");
const dogmaPath=path.join(root,"dist-electron","fitting-dogma.js");
assert.ok(fs.existsSync(dogmaPath),"Run the Electron build before the module-hover resolver integration audit.");

const source=fs.readFileSync(fittingsPath,"utf8");
const start=source.indexOf("type ModuleHoverStat");
const end=source.indexOf("function ModuleHoverCard",start);
assert.ok(start>=0&&end>start,"Could not isolate the module-hover resolver from Fittings.tsx");
const resolver=source.slice(start,end);
const dogmaUrl=pathToFileURL(dogmaPath).href;

const audit=String.raw`
const dogma=await import(${JSON.stringify(dogmaUrl)});
const catalogue=await dogma.getFittingCatalogueLocal();
const placements=new Set(["high","mid","low","rig","subsystem"]);
const items=catalogue.items.filter((item:any)=>placements.has(item.placement));
const get=async(typeId:number,analysis:any=null,extra:any={})=>{
  const info=await dogma.getFittingTypeInfoLocal(typeId);
  return {info,out:buildModuleHoverStats({name:info.name,typeId,quantity:1,...extra} as any,extra.rack,analysis,info as any)};
};
const row=(out:any,label:string)=>out.primary.find((item:any)=>item.label===label);
const labels=(out:any)=>out.primary.map((item:any)=>item.label);
const expectLabels=async(typeId:number,expected:string[])=>{
  const {info,out}=await get(typeId);
  for(const label of expected)assert.ok(labels(out).includes(label),info.name+" missing primary tooltip stat: "+label+"; got "+labels(out).join(", "));
  return {info,out};
};

const semanticLabel=(label:string)=>{
  const value=label.trim().toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  if(/^(drone damage|drone damage bonus)$/.test(value))return "drone-damage";
  if(/^(cycle|activation time duration|rate of fire)$/.test(value))return "cycle";
  if(/^(cap cycle|activation cost|capacitor need)$/.test(value))return "cap-use";
  if(/^(range|optimal range)$/.test(value))return "range";
  if(/^(shield hp|shield hitpoint bonus)$/.test(value))return "shield-hp";
  if(/^(armor hp|armor hitpoint bonus)$/.test(value))return "armor-hp";
  if(/^(hull hp|structure hitpoint bonus)$/.test(value))return "hull-hp";
  if(/^(targeting range|maximum targeting range bonus)$/.test(value))return "target-range";
  if(/^(scan resolution|scan resolution bonus)$/.test(value))return "scan-resolution";
  if(/^(signature radius|signature radius modifier|signature radius bonus)$/.test(value))return "signature-radius";
  if(/^(warp strength|warp scramble strength|warp core strength)$/.test(value))return "warp-strength";
  if(/^(energy neutralized|neutralization amount)$/.test(value))return "neutralization";
  if(/^(yield cycle|mining amount)$/.test(value))return "mining-yield";
  if(/^(drone control range|drone control range bonus)$/.test(value))return "drone-control-range";
  return value;
};

let audited=0;
for(const item of items){
  const info=await dogma.getFittingTypeInfoLocal(item.id);
  const out=buildModuleHoverStats({name:item.name,typeId:item.id,quantity:1} as any,item.rack,null,info as any);
  assert.ok(out.primary.length>0,item.name+" has an empty primary tooltip block");
  const seen=new Set<string>();
  const semanticSeen=new Set<string>();
  for(const stat of out.primary){
    const normalizedValue=String(stat.value).trim().toLowerCase();
    const key=stat.label.trim().toLowerCase()+"|"+normalizedValue;
    assert.ok(!seen.has(key),item.name+" repeats tooltip stat "+key);
    seen.add(key);
    const semanticKey=semanticLabel(stat.label)+"|"+normalizedValue;
    assert.ok(!semanticSeen.has(semanticKey),item.name+" repeats the same semantic effect under different labels: "+semanticKey);
    semanticSeen.add(semanticKey);
    assert.doesNotMatch(stat.label+" "+stat.value,/required skill|overload|heat damage|maxgroup|typecolorscheme|entitycapacitor|remote resistance|deadspaceunsafe|1=true|cannot auto repeat|disallow.*activation|stabilize cloak duration|\bthrust\b/i,item.name+" leaked internal DOGMA metadata into compact tooltip");
    assert.doesNotMatch(String(stat.value),/^[+-]?0(?:\.0+)?\s*(?:%|gj|mw|m\/s|s)?$/i,item.name+" displays a zero-effect tooltip row: "+stat.label+"="+stat.value);
    if(/recharge|output|hitpoint|capacity|rate of fire|scan resolution|multiplier/i.test(stat.label))assert.doesNotMatch(String(stat.value),/^0\.\d+\s*%$/i,item.name+" displays a raw DOGMA multiplier: "+stat.label+"="+stat.value);
  }
  audited++;
}
assert.equal(audited,items.length,"Catalogue audit count mismatch");
assert.ok(audited>3000,"Expected a full published fitting-module audit, not a small sample");

// Named acceptance modules from the fitter/catalogue tooltip task.
await expectLabels(13773,["Damage multiplier","Optimal","Falloff","Tracking","Cycle"]); // Domination 125mm Autocannon
const dda=await expectLabels(4405,["Drone damage"]);
assert.equal(dda.out.primary.filter((x:any)=>/drone damage/i.test(x.label)).length,1,"DDA must not repeat drone damage under a second DOGMA label");
await expectLabels(24417,["Drone velocity"]);
await expectLabels(24438,["Drone optimal","Drone falloff","Drone tracking"]);
await expectLabels(12058,["Speed bonus","Cap / cycle","Cycle"]);
await expectLabels(12076,["Speed bonus","Signature radius","Capacitor capacity"]);
await expectLabels(3841,["Shield HP"]);
await expectLabels(2281,["EM resist","Thermal resist","Kinetic resist","Explosive resist"]);
await expectLabels(3530,["Armor repair / cycle","Repair / second","Cycle","Cap / cycle"]);
await expectLabels(20353,["Armor HP"]);
await expectLabels(2048,["Shield resists","Armor resists","Hull resists"]);
await expectLabels(2032,["Cap recharge time"]);
await expectLabels(2024,["Cycle","Reload","Cap injection"]);
await expectLabels(448,["Range","Warp strength","MWD shutdown"]);
await expectLabels(527,["Speed reduction","Range"]);
await expectLabels(1952,["Targeting range","Scan resolution","Sensor strength"]);
const hml=await expectLabels(2410,["Cycle","Reload","Combat stats"]);
assert.ok(!labels(hml.out).includes("DPS / volley"),"Missile launcher must not inherit the turret ammo/crystal placeholder");
await expectLabels(17482,["Yield / cycle","Cycle","Range"]);
await expectLabels(12267,["Energy neutralized","Range","Falloff","Cycle"]);
await expectLabels(26913,["Remote armor / cycle","Repair / second","Range","Cycle"]);

// Additional semantic regression cases found by the full-catalogue pass.
const recharger=await expectLabels(394,["Shield recharge time"]);
assert.equal(row(recharger.out,"Shield recharge time")?.value,"-15%","Shield Recharger II must render 0.85x DOGMA as -15% recharge time, not 0.85%");
const relay=await expectLabels(1422,["Shield recharge time","Cap recharge time"]);
assert.equal(row(relay.out,"Shield recharge time")?.value,"-25%");
assert.equal(row(relay.out,"Cap recharge time")?.value,"+35%");
const pds=await expectLabels(1541,["Shield recharge time","Shield HP","Cap recharge time","Capacitor amount","Powergrid output"]);
assert.equal(row(pds.out,"Powergrid output")?.value,"+6%");
const rcu=await expectLabels(1355,["Powergrid output"]);
assert.deepEqual(labels(rcu.out),["Powergrid output"],"RCU should not be padded with neutral 0% cap/shield stats");
const cpu=await expectLabels(3888,["CPU output"]);assert.equal(row(cpu.out,"CPU output")?.value,"+10%");
const mapc=await expectLabels(4254,["Powergrid bonus"]);assert.equal(row(mapc.out,"Powergrid bonus")?.value,"+12 MW");
const wcs=await expectLabels(11640,["Warp core strength","Targeting range","Scan resolution","Drone bandwidth","Reactivation delay"]);
assert.equal(row(wcs.out,"Warp core strength")?.value,"+2");
const cloak=await expectLabels(11578,["Cloaked speed","Lock recalibration","Reactivation delay","Cloak type"]);
assert.equal(row(cloak.out,"Lock recalibration")?.value,"10 s","Cloak recalibration must convert DOGMA milliseconds to seconds");
assert.equal(row(cloak.out,"Cloaked speed")?.value,"100% normal");
const battery=await expectLabels(3504,["Capacitor bonus","Cap warfare resistance"]);
assert.equal(row(battery.out,"Cap warfare resistance")?.value,"+25%");
const remoteCap=await expectLabels(12221,["Cap transferred","Range","Cycle"]);
assert.match(row(remoteCap.out,"Cap transferred")?.value??"",/GJ$/,"Remote capacitor transfer must use GJ, not raw DOGMA points");
const nos=await expectLabels(12259,["Energy drained","Range","Falloff","Cycle"]);
assert.match(row(nos.out,"Energy drained")?.value??"",/GJ$/,"Nosferatu transfer must use GJ, not raw DOGMA points");
const ecm=await expectLabels(2567,["Range","Falloff"]);assert.equal(row(ecm.out,"Falloff")?.value,"21.6 km");
const signal=await expectLabels(1987,["Targeting range","Scan resolution","Sensor strength","Locked targets"]);assert.equal(row(signal.out,"Locked targets")?.value,"+2");
const painter=await expectLabels(19806,["Signature radius","Range","Falloff"]);assert.equal(row(painter.out,"Signature radius")?.value,"+30%");
const hyperspatial=await expectLabels(31169,["Warp speed"]);assert.equal(row(hyperspatial.out,"Warp speed")?.value,"+25%");
const bulkhead=await expectLabels(1335,["Hull HP"]);assert.equal(row(bulkhead.out,"Hull HP")?.value,"+25%");
const smartbomb=await expectLabels(3955,["Damage / cycle","Radius","Cycle"]);assert.match(row(smartbomb.out,"Damage / cycle")?.value??"",/HP$/);
const tractor=await expectLabels(24348,["Range","Tractor velocity","Cap / cycle","Cycle"]);
const salvager=await expectLabels(30836,["Cycle","Access / salvage bonus","Range","Cap / cycle"]);
const droneLink=await expectLabels(24427,["Drone control range"]);assert.equal(row(droneLink.out,"Drone control range")?.value,"24 km");

// Live-fit computed values must outrank static catalogue fallbacks when analysis is available.
const turretInfo=(await dogma.getFittingTypeInfoLocal(13773));
const turretLive=buildModuleHoverStats({name:turretInfo.name,typeId:13773,quantity:1,charge:"Republic Fleet EMP S"} as any,"high",{damage:{weaponProfiles:[{typeId:13773,kind:"turret",paperDps:123.4,volley:246.8,optimalM:5000,falloffM:12000,tracking:0.456,cycleSeconds:2.5}]}} as any,turretInfo as any);
for(const label of ["DPS","Volley","Optimal","Falloff","Tracking","Cycle"])assert.ok(labels(turretLive).includes(label),"Live turret analysis missing "+label);
assert.equal(row(turretLive,"DPS")?.value,"123.4");

const missileInfo=(await dogma.getFittingTypeInfoLocal(2410));
const missileLive=buildModuleHoverStats({name:missileInfo.name,typeId:2410,quantity:1,charge:"Scourge Fury Heavy Missile"} as any,"high",{damage:{weaponProfiles:[{typeId:2410,kind:"missile",paperDps:88.8,volley:444,maximumRangeM:65000,explosionRadiusM:140,explosionVelocity:90,cycleSeconds:5}]}} as any,missileInfo as any);
for(const label of ["DPS","Volley","Max range","Explosion radius","Explosion velocity","Cycle"])assert.ok(labels(missileLive).includes(label),"Live missile analysis missing "+label);
assert.ok(!labels(missileLive).includes("Combat stats"),"Loaded live missile profile must replace the catalogue dependency placeholder");

const propInfo=await dogma.getFittingTypeInfoLocal(12058);
const propLive=buildModuleHoverStats({name:propInfo.name,typeId:12058,quantity:1} as any,"mid",{navigation:{activePropulsion:[{typeId:12058,maximumVelocity:1234}]}} as any,propInfo as any);
assert.equal(row(propLive,"Resulting max velocity")?.value,"1,234 m/s");

const boosterInfo=await dogma.getFittingTypeInfoLocal(2024);
const boosterLive=buildModuleHoverStats({name:boosterInfo.name,typeId:2024,quantity:1,charge:"Navy Cap Booster 800"} as any,"mid",{capacitor:{capacitorInjectors:[{typeId:2024,injectionPerCycleGj:800,sustainedGjPerSecond:40,cycleSeconds:12,charge:"Navy Cap Booster 800"}]}} as any,boosterInfo as any);
assert.equal(row(boosterLive,"Cap injected / charge")?.value,"800 GJ");
assert.ok(!labels(boosterLive).includes("Cap injection"),"Loaded live cap booster must replace the charge-dependent catalogue placeholder");

console.log("Module hover resolver integration audit: PASS ("+audited+" fitting modules + acceptance/live-analysis cases)");
`;

const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),"sage-hover-audit-"));
const tempFile=path.join(tempDir,"resolver-audit.ts");
try{
  fs.writeFileSync(tempFile,'import assert from "node:assert/strict";\n'+resolver+"\n"+audit,"utf8");
  const result=spawnSync(process.execPath,["--experimental-strip-types",tempFile],{cwd:root,encoding:"utf8",maxBuffer:16*1024*1024});
  if(result.stdout)process.stdout.write(result.stdout);
  if(result.stderr)process.stderr.write(result.stderr);
  assert.equal(result.status,0,"Module-hover resolver integration audit failed");
}finally{
  fs.rmSync(tempDir,{recursive:true,force:true});
}
