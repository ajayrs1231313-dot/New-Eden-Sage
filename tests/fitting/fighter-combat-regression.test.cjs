const assert = require('node:assert/strict');
const catalogue = require('../../src/fitting-catalogue-items-static.json');
const dogma = require('../../dist-electron/fitting-dogma.js');

const snapshot = (levels = {}) => ({
  character:{name:'fighter-special-mechanics'},
  skills:{total_sp:0,skills:Object.entries(levels).map(([skill_id,trained_skill_level])=>({skill_id:Number(skill_id),trained_skill_level}))},
  extended:{implants:[]},
});
const resolve = async (names) => new Map((await dogma.resolveFittingTypeNamesLocal(names)).map((entry)=>[entry.name,entry.id]));

(async()=>{
  const m = await resolve(['Thanatos','Firbolg I','Templar I','Cenobite I','Gallente Carrier','Fighters']);
  for (const name of ['Thanatos','Firbolg I','Templar I','Cenobite I','Gallente Carrier','Fighters']) assert.ok(m.get(name), `Missing SDE type ${name}`);

  const base = await dogma.analyzeFittingDogma({
    hullTypeId:m.get('Thanatos'),
    items:[{typeId:m.get('Firbolg I'),rack:'fighter-active',quantity:1,state:'active'}],
    snapshot:snapshot(),
  });
  assert.equal(base.fighterSystem.damageSources.length,2,'Firbolg must expose both regular missile and attack-missile fighter channels');
  assert.deepEqual(new Set(base.fighterSystem.damageSources.map((source)=>source.ability)),new Set(['missiles','attack-missile']));
  assert.ok(base.damage.fighterDps>0,'active fighter squadron must contribute DPS');
  assert.equal(base.fighterSystem.damageSources[0].fighterCount,base.fighterSystem.damageSources[0].squadronSize,'one active squadron must multiply per-fighter damage by squadron size');
  assert.ok(base.fighterSystem.damageSources.every((source)=>source.sourceKind==='fighter' && source.damageVector.reduce((sum,value)=>sum+value,0)>0));

  const fightersV = await dogma.analyzeFittingDogma({
    hullTypeId:m.get('Thanatos'),
    items:[{typeId:m.get('Firbolg I'),rack:'fighter-active',quantity:1,state:'active'}],
    snapshot:snapshot({[m.get('Fighters')]:5}),
  });
  const carrierV = await dogma.analyzeFittingDogma({
    hullTypeId:m.get('Thanatos'),
    items:[{typeId:m.get('Firbolg I'),rack:'fighter-active',quantity:1,state:'active'}],
    snapshot:snapshot({[m.get('Gallente Carrier')]:5}),
  });
  const bothV = await dogma.analyzeFittingDogma({
    hullTypeId:m.get('Thanatos'),
    items:[{typeId:m.get('Firbolg I'),rack:'fighter-active',quantity:1,state:'active'}],
    snapshot:snapshot({[m.get('Fighters')]:5,[m.get('Gallente Carrier')]:5}),
  });
  assert.ok(fightersV.damage.fighterDps>base.damage.fighterDps*1.24,'Fighters V must increase fighter damage');
  assert.ok(carrierV.damage.fighterDps>base.damage.fighterDps*1.24,'Thanatos Gallente Carrier hull bonus must increase fighter damage');
  assert.ok(bothV.damage.fighterDps>fightersV.damage.fighterDps && bothV.damage.fighterDps>carrierV.damage.fighterDps,'fighter skill and carrier hull bonus must combine');

  const fourLights = await dogma.analyzeFittingDogma({
    hullTypeId:m.get('Thanatos'),
    items:[{typeId:m.get('Templar I'),rack:'fighter-active',quantity:4,state:'active'}],
    snapshot:snapshot(),
  });
  assert.ok(fourLights.issues.some((issue)=>issue.code==='fighter-light-limit'),'existing fighter-light legality restriction must remain intact');

  const support = await dogma.analyzeFittingDogma({
    hullTypeId:m.get('Thanatos'),
    items:[{typeId:m.get('Cenobite I'),rack:'fighter-active',quantity:1,state:'active'}],
    snapshot:snapshot(),
  });
  assert.equal(support.fighterSystem.damageSources.length,0,'pure support fighter must not invent weapon DPS');
  assert.ok(support.fighterSystem.supportSystems.some((system)=>system.kind==='energyNeutralizer' && system.amountPerCycle>0),'fighter EWAR/support ability must be exported');

  const fighters = catalogue.items.filter((item)=>item.placement==='fighter');
  assert.equal(fighters.length,94,'current fighter catalogue count changed; audit this regression intentionally');
  const neither=[];
  for(const item of fighters){
    const analysis=await dogma.analyzeFittingDogma({hullTypeId:m.get('Thanatos'),items:[{typeId:item.id,rack:'fighter-active',quantity:1,state:'active'}],snapshot:snapshot()});
    const hasDamage=(analysis.fighterSystem.damageSources??[]).length>0;
    const hasSupport=(analysis.fighterSystem.supportSystems??[]).length>0;
    if(!hasDamage&&!hasSupport) neither.push(`${item.id} ${item.name}`);
  }
  assert.deepEqual(neither,[],'every fighter catalogue entry must expose either combat damage or a supported fighter ability');

  console.log(`fighter combat regression: PASS (${fighters.length}/${fighters.length} fighter catalogue entries covered)`);
})().catch((error)=>{console.error(error);process.exitCode=1;});
