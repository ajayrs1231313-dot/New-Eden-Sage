const assert = require('node:assert/strict');
const catalogue = require('../../src/fitting-catalogue-items-static.json');
const dogma = require('../../dist-electron/fitting-dogma.js');

const fingerprint = analysis => JSON.stringify({
  resources:analysis.resources?.used,
  capacitor:{demand:analysis.capacitor?.demandGjPerSecond,injection:analysis.capacitor?.injectionGjPerSecond,capacity:analysis.capacitor?.capacityGj,recharge:analysis.capacitor?.rechargeSeconds},
  defence:{
    shieldHp:analysis.defence?.shieldHp,armorHp:analysis.defence?.armorHp,structureHp:analysis.defence?.structureHp,
    shieldResists:analysis.defence?.shieldResists,armorResists:analysis.defence?.armorResists,hullResists:analysis.defence?.hullResists,
    shieldRep:analysis.defence?.shieldRepairPerSecond,armorRep:analysis.defence?.armorRepairPerSecond,
    localRepairSystems:analysis.defence?.localRepairSystems,
  },
  navigation:analysis.navigation,
  targeting:analysis.targeting,
  mining:analysis.mining,
  damage:{
    weaponDps:analysis.damage?.weaponDps,droneDps:analysis.damage?.droneDps,
    weaponProfiles:analysis.damage?.weaponProfiles,activeDrones:analysis.damage?.activeDrones,
    aoeDamageSources:analysis.damage?.aoeDamageSources,
  },
  supportSystems:analysis.supportSystems,
  storage:analysis.storage,
  heat:analysis.heat,
});

(async()=>{
  const resolved=await dogma.resolveFittingTypeNamesLocal(['Praxis','Drones','Mining Drone Operation','Ice Harvesting Drone Operation']);
  const ids=new Map(resolved.map(row=>[row.name,row.id]));
  for(const name of ['Praxis','Drones','Mining Drone Operation']) assert.ok(ids.get(name),`Missing SDE type ${name}`);
  const skills=['Drones','Mining Drone Operation','Ice Harvesting Drone Operation']
    .filter(name=>ids.get(name))
    .map(name=>({skill_id:ids.get(name),trained_skill_level:5,active_skill_level:5,skillpoints_in_skill:0}));
  const snapshot={character:{name:'mutaplasmid-catalogue-stress'},skills:{total_sp:0,skills},extended:{implants:[]}};

  const candidates=catalogue.items.filter(item=>['high','mid','low','drone'].includes(item.placement));
  let mutableTypes=0;
  let mappingCount=0;
  const failures=[];

  for(const candidate of candidates){
    const options=await dogma.getMutationOptionsLocal(candidate.id);
    if(!options.length) continue;
    mutableTypes++;
    for(const option of options){
      const attributes=option.attributes.filter(attribute=>Math.abs(attribute.maxValue-attribute.minValue)>1e-12);
      if(!attributes.length) continue;
      mappingCount++;
      for(const attribute of attributes){
        assert.ok(Number.isFinite(attribute.baseValue)&&Number.isFinite(attribute.minValue)&&Number.isFinite(attribute.maxValue),`${candidate.name} / ${option.mutaplasmidName} has non-finite mutation endpoint`);
        assert.ok(attribute.minValue<=attribute.maxValue,`${candidate.name} / ${option.mutaplasmidName} mutation endpoints reversed for ${attribute.name}`);
      }
      const makeItem=which=>{
        const fitted={
          typeId:candidate.id,
          rack:candidate.placement,
          quantity:1,
          state:'active',
          attributeOverrides:Object.fromEntries(attributes.map(attribute=>[attribute.attributeId,attribute[which+'Value']])),
        };
        if(candidate.placement==='drone') fitted.activeQuantity=1;
        return fitted;
      };
      try{
        const min=await dogma.analyzeFittingDogma({hullTypeId:ids.get('Praxis'),items:[makeItem('min')],snapshot});
        const max=await dogma.analyzeFittingDogma({hullTypeId:ids.get('Praxis'),items:[makeItem('max')],snapshot});
        if(fingerprint(min)===fingerprint(max)) failures.push(`${candidate.id} ${candidate.name} / ${option.mutaplasmidName}: endpoint rolls invisible`);
      }catch(error){
        failures.push(`${candidate.id} ${candidate.name} / ${option.mutaplasmidName}: ${error?.stack||error}`);
      }
    }
  }

  assert.equal(mutableTypes,945,'current mutable base-type count changed; audit the SDE mutation catalogue intentionally');
  assert.equal(mappingCount,5227,'current mutaplasmid mapping count changed; audit the SDE mutation catalogue intentionally');
  assert.deepEqual(failures,[],`mutaplasmid catalogue endpoint failures:\n${failures.slice(0,30).join('\n')}`);
  console.log(`Mutaplasmid catalogue stress: PASS (${mutableTypes} mutable types, ${mappingCount} mutation mappings, min/max endpoints)`);
})().catch(error=>{console.error(error);process.exitCode=1;});
