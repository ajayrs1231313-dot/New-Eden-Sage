const assert = require('node:assert/strict');
const catalogue = require('../../src/fitting-catalogue-items-static.json');
const dogma = require('../../dist-electron/fitting-dogma.js');

const snapshot = { character:{name:'Full catalogue DOGMA stress'}, skills:{total_sp:0,skills:[]}, extended:{implants:[]} };
const finite = (value,label) => assert.ok(Number.isFinite(Number(value)), `${label}: non-finite ${value}`);
const saneAnalysis = (analysis,label) => {
  finite(analysis.resources.used.cpu,`${label} CPU used`);
  finite(analysis.resources.used.powergrid,`${label} PG used`);
  finite(analysis.resources.used.calibration,`${label} calibration used`);
  finite(analysis.resources.capacity.cpu,`${label} CPU cap`);
  finite(analysis.resources.capacity.powergrid,`${label} PG cap`);
  finite(analysis.capacitor.capacityGj,`${label} capacitor`);
  finite(analysis.capacitor.rechargeSeconds,`${label} cap recharge`);
  finite(analysis.capacitor.demandGjPerSecond,`${label} cap demand`);
  finite(analysis.capacitor.peakRechargeGjPerSecond,`${label} cap peak`);
  finite(analysis.defence.shieldHp,`${label} shield HP`);
  finite(analysis.defence.armorHp,`${label} armor HP`);
  finite(analysis.defence.structureHp,`${label} structure HP`);
  finite(analysis.defence.totalEhp,`${label} EHP`);
  finite(analysis.damage.weaponDps,`${label} weapon DPS`);
  finite(analysis.damage.droneDps,`${label} drone DPS`);
  finite(analysis.damage.totalDps,`${label} total DPS`);
  finite(analysis.navigation.baseMaximumVelocity,`${label} base velocity`);
  finite(analysis.navigation.maximumVelocity,`${label} max velocity`);
  finite(analysis.targeting.maximumRangeM,`${label} target range`);
  finite(analysis.targeting.scanResolution,`${label} scan resolution`);
  finite(analysis.targeting.signatureRadiusM,`${label} signature`);
  assert.ok(analysis.defence.shieldHp >= 0 && analysis.defence.armorHp >= 0 && analysis.defence.structureHp >= 0, `${label}: negative HP`);
  assert.ok(analysis.damage.weaponDps >= 0 && analysis.damage.droneDps >= 0, `${label}: negative DPS`);
  assert.ok(analysis.navigation.maximumVelocity >= 0, `${label}: negative velocity`);
  for (const [layer,values] of [['shield',analysis.defence.shieldResists],['armor',analysis.defence.armorResists],['hull',analysis.defence.hullResists]]) {
    for (const value of values) assert.ok(Number.isFinite(value) && value >= -1e-9 && value <= 1.000000001, `${label}: ${layer} resist outside 0..1 (${value})`);
  }
};

(async()=>{
  const hullNames=['Praxis','Ishtar','Thanatos'];
  const resolved=await dogma.resolveFittingTypeNamesLocal(hullNames);
  const ids=new Map(resolved.map(x=>[x.name,x.id]));
  for(const name of hullNames) assert.ok(ids.get(name),`Missing stress hull ${name}`);
  const genericHull=ids.get('Praxis');
  const droneHull=ids.get('Ishtar');
  const fighterHull=ids.get('Thanatos');
  const counts={};
  let typeInfoChecked=0, analyses=0;
  const failures=[];
  const items=[...catalogue.items];
  assert.ok(items.length > 8000,`Expected full catalogue, got ${items.length}`);
  assert.equal(new Set(items.map(x=>x.id)).size,items.length,'Catalogue contains duplicate type IDs');

  for(const item of items){
    counts[item.placement]=(counts[item.placement]||0)+1;
    try{
      const info=await dogma.getFittingTypeInfoLocal(item.id);
      assert.equal(Number(info.typeId),Number(item.id),`${item.name}: type-info ID mismatch`);
      assert.ok(info.name,`${item.id}: missing type-info name`);
      typeInfoChecked++;
      let analysis=null;
      if(item.placement==='ship'){
        analysis=await dogma.analyzeFittingDogma({hullTypeId:item.id,items:[],snapshot});
      }else if(['low','mid','high','rig','subsystem'].includes(item.placement)){
        const effects=info.effects||[];
        const active=effects.some(e=>Number(e.effectId)!==16 && (Number(e.category)===1||Number(e.category)===2));
        const state=(item.placement==='rig'||item.placement==='subsystem')?'online':(active?'active':'online');
        analysis=await dogma.analyzeFittingDogma({hullTypeId:genericHull,items:[{typeId:item.id,rack:item.placement,quantity:1,state}],snapshot});
      }else if(item.placement==='drone'){
        analysis=await dogma.analyzeFittingDogma({hullTypeId:droneHull,items:[{typeId:item.id,rack:'drone',quantity:1,activeQuantity:1}],snapshot});
      }else if(item.placement==='fighter'){
        analysis=await dogma.analyzeFittingDogma({hullTypeId:fighterHull,items:[{typeId:item.id,rack:'fighter',quantity:1,activeQuantity:1}],snapshot});
      }else if(item.placement==='implant'){
        analysis=await dogma.analyzeFittingDogma({hullTypeId:genericHull,items:[],snapshot,implantTypeIds:[item.id]});
      }else if(item.placement==='booster'){
        analysis=await dogma.analyzeFittingDogma({hullTypeId:genericHull,items:[],snapshot,boosterTypeIds:[item.id]});
      }
      if(analysis){saneAnalysis(analysis,`${item.id} ${item.name}`);analyses++;}
    }catch(error){
      failures.push({id:item.id,name:item.name,placement:item.placement,error:String(error?.stack||error)});
      if(failures.length>=50) break;
    }
  }
  if(failures.length) console.error(JSON.stringify(failures,null,2));
  assert.deepEqual(failures,[],'Full catalogue DOGMA stress found failures');

  // Charge/script/crystal stress: pair every compatible ship charge with a module that accepts
  // its CCP charge group/size, then execute the full analysis with that charge loaded.
  const chargeModules=items.filter(item=>['high','mid','low'].includes(item.placement));
  const moduleByChargeGroup=new Map();
  for(const item of chargeModules){
    const info=await dogma.getFittingTypeInfoLocal(item.id);
    const accepted=(info.attributes||[]).filter(attribute=>/chargegroup/i.test(attribute.internalName||attribute.name||'')).map(attribute=>Number(attribute.value)).filter(Boolean);
    const size=Number((info.attributes||[]).find(attribute=>Number(attribute.attributeId)===128)?.value||0);
    for(const groupId of accepted){const list=moduleByChargeGroup.get(groupId)||[];list.push({item,size});moduleByChargeGroup.set(groupId,list);}
  }
  let loadedCharges=0;
  const unsupportedCharges=[];
  for(const charge of items.filter(item=>item.placement==='charge')){
    const info=await dogma.getFittingTypeInfoLocal(charge.id);
    const size=Number((info.attributes||[]).find(attribute=>Number(attribute.attributeId)===128)?.value||0);
    const match=(moduleByChargeGroup.get(Number(info.group?.id))||[]).find(candidate=>!candidate.size||!size||candidate.size===size);
    if(!match){unsupportedCharges.push(charge);continue;}
    const analysis=await dogma.analyzeFittingDogma({hullTypeId:genericHull,items:[{typeId:match.item.id,rack:match.item.placement,quantity:1,state:'active',chargeTypeId:charge.id}],snapshot});
    saneAnalysis(analysis,`charge ${charge.id} ${charge.name} in ${match.item.name}`);
    loadedCharges++;
  }
  assert.ok(loadedCharges>950,`Expected broad charge coverage, got ${loadedCharges}`);
  assert.ok(unsupportedCharges.every(charge=>/^Standup /.test(charge.name)),`Unexpected non-structure charge without a compatible ship module: ${JSON.stringify(unsupportedCharges.slice(0,10))}`);

  console.log(`Full catalogue DOGMA stress: PASS (${typeInfoChecked} type infos, ${analyses} direct analyses, ${loadedCharges} compatible charges/scripts/crystals loaded; placements ${JSON.stringify(counts)})`);
})().catch(error=>{console.error(error);process.exitCode=1;});
