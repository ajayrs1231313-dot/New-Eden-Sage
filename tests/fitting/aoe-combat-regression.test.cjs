const assert = require('node:assert/strict');
const catalogue = require('../../src/fitting-catalogue-items-static.json');
const dogma = require('../../dist-electron/fitting-dogma.js');

const snapshot = {character:{name:'aoe-special-mechanics'},skills:{total_sp:0,skills:[]},extended:{implants:[]}};

(async()=>{
  const resolved = await dogma.resolveFittingTypeNamesLocal(['Praxis','Large EMP Smartbomb II']);
  const m = new Map(resolved.map((entry)=>[entry.name,entry.id]));
  assert.ok(m.get('Praxis') && m.get('Large EMP Smartbomb II'),'required SDE types missing');

  const single = await dogma.analyzeFittingDogma({
    hullTypeId:m.get('Praxis'),
    items:[{typeId:m.get('Large EMP Smartbomb II'),rack:'high',quantity:1,state:'active'}],
    snapshot,
  });
  assert.equal(single.damage.weaponDps,0,'smartbomb must not pollute ordinary single-target weapon DPS');
  assert.equal(single.damage.weaponProfiles.length,0,'smartbomb must not masquerade as targeted turret/missile profile');
  assert.equal(single.damage.aoeDamageSources.length,1,'smartbomb AoE channel missing');
  const source=single.damage.aoeDamageSources[0];
  assert.ok(source.damagePerPulse>0 && source.cycleSeconds>0 && source.radiusM>0,'smartbomb pulse/cycle/radius output missing');
  assert.ok(source.damageVector.reduce((sum,value)=>sum+value,0)>0,'smartbomb damage vector missing');
  assert.ok(source.capacitorPerCycleGj>0,'smartbomb capacitor cost missing');
  assert.equal(source.friendlyFireEligible,true,'smartbomb simulator channel must permit friendly-fire eligibility');

  const smartbombs = catalogue.items.filter((item)=>item.groupId===72);
  assert.equal(smartbombs.length,125,'current smartbomb catalogue count changed; audit this regression intentionally');
  const failures=[];
  for(const item of smartbombs){
    const analysis=await dogma.analyzeFittingDogma({hullTypeId:m.get('Praxis'),items:[{typeId:item.id,rack:'high',quantity:1,state:'active'}],snapshot});
    const aoe=(analysis.damage.aoeDamageSources??[])[0];
    if(!(aoe && aoe.damagePerPulse>0 && aoe.cycleSeconds>0 && aoe.radiusM>0 && aoe.damageVector?.reduce((sum,value)=>sum+value,0)>0 && analysis.damage.weaponDps===0 && analysis.damage.weaponProfiles.length===0)) failures.push(`${item.id} ${item.name}`);
  }
  assert.deepEqual(failures,[],'all smartbomb catalogue entries must expose only a valid AoE combat channel');
  console.log(`AoE combat regression: PASS (${smartbombs.length}/${smartbombs.length} smartbomb catalogue entries covered)`);
})().catch((error)=>{console.error(error);process.exitCode=1;});
