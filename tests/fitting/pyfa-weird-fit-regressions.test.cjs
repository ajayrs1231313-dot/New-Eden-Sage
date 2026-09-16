const assert = require('node:assert/strict');
const catalogue = require('../../src/fitting-catalogue-items-static.json');
const dogma = require('../../dist-electron/fitting-dogma.js');

const blankSnapshot = { character:{name:'pyfa-regression'}, skills:{total_sp:0,skills:[]}, extended:{implants:[]} };
const resolve = async names => new Map((await dogma.resolveFittingTypeNamesLocal(names)).map(x=>[x.name,x.id]));
const skill = (id,level=5)=>({skill_id:id,trained_skill_level:level,active_skill_level:level,skillpoints_in_skill:0});

(async()=>{
  // pyfa v2.68.0: Hawk RoF bonus must affect the Civilian Light Missile Launcher.
  {
    const m=await resolve(['Hawk','Civilian Light Missile Launcher','Civilian Scourge Light Missile','Caldari Frigate','Assault Frigates']);
    const run=async level=>dogma.analyzeFittingDogma({
      hullTypeId:m.get('Hawk'),
      items:[{typeId:m.get('Civilian Light Missile Launcher'),rack:'high',quantity:1,state:'active',chargeTypeId:m.get('Civilian Scourge Light Missile')}],
      snapshot:{...blankSnapshot,skills:{total_sp:0,skills:[skill(m.get('Caldari Frigate'),level),skill(m.get('Assault Frigates'),level)]}},
    });
    const zero=await run(0), five=await run(5);
    assert.ok(five.damage.weaponDps > zero.damage.weaponDps*1.3,`Hawk civilian launcher RoF bonus missing: ${zero.damage.weaponDps} -> ${five.damage.weaponDps}`);
  }

  // pyfa v2.68.0/#2774: Medium Deep Core Mining Optimization I must affect both deep-core strip-miner families.
  {
    const m=await resolve(['Hulk','ORE Deep Core Strip Miner','Modulated Deep Core Strip Miner II','Medium Deep Core Mining Optimization I']);
    const run=async (miner,rigs)=>{
      const items=[{typeId:m.get(miner),rack:'high',quantity:1,state:'active'}];
      if(rigs)items.push({typeId:m.get('Medium Deep Core Mining Optimization I'),rack:'rig',quantity:rigs,state:'online'});
      const a=await dogma.analyzeFittingDogma({hullTypeId:m.get('Hulk'),items,snapshot:blankSnapshot});
      assert.equal(a.mining.sources.length,1,`${miner} missing mining analysis source`);
      return a.mining.sources[0].yieldPerCycleM3;
    };
    for(const miner of ['ORE Deep Core Strip Miner','Modulated Deep Core Strip Miner II']){
      const zero=await run(miner,0), one=await run(miner,1), two=await run(miner,2);
      assert.ok(one>zero*1.159 && one<zero*1.161,`${miner} did not get the rig's 16% yield bonus: ${zero} -> ${one}`);
      assert.ok(two>one,`${miner} ignored the second mining rig: ${zero}, ${one}, ${two}`);
    }
  }
  // Polarized weapons set shield/armor resonance to 100%; displayed resistance must clamp to 0%, never -9900%.
  {
    const m=await resolve(['Praxis','Polarized 200mm AutoCannon']);
    const a=await dogma.analyzeFittingDogma({hullTypeId:m.get('Praxis'),items:[{typeId:m.get('Polarized 200mm AutoCannon'),rack:'high',quantity:1,state:'online'}],snapshot:blankSnapshot});
    assert.deepEqual(a.defence.shieldResists,[0,0,0,0]);
    assert.deepEqual(a.defence.armorResists,[0,0,0,0]);
    assert.deepEqual(a.defence.hullResists,[0,0,0,0]);
  }

  // pyfa #2754/#2756: cycle-reducing solidifiers must reduce heated booster cycle time and burn time monotonically.
  {
    const m=await resolve(['Vargur','Nanofiber Internal Structure II','Pith X-Type X-Large Shield Booster','Auto Targeting System I','Large Core Defense Operational Solidifier II','AIR Repairer Booster III']);
    const run=async rigs=>{
      const items=[
        {typeId:m.get('Nanofiber Internal Structure II'),rack:'low',quantity:6,state:'online'},
        {typeId:m.get('Pith X-Type X-Large Shield Booster'),rack:'mid',quantity:1,state:'overheated'},
        {typeId:m.get('Auto Targeting System I'),rack:'high',quantity:7,state:'online'},
      ];
      if(rigs)items.push({typeId:m.get('Large Core Defense Operational Solidifier II'),rack:'rig',quantity:rigs,state:'online'});
      const a=await dogma.analyzeFittingDogma({hullTypeId:m.get('Vargur'),items,snapshot:blankSnapshot,boosterTypeIds:[m.get('AIR Repairer Booster III')]});
      const rack=a.heat.racks.find(x=>x.rack==='mid');
      const booster=rack.modules.find(x=>x.typeId===m.get('Pith X-Type X-Large Shield Booster'));
      return {cycle:booster.cycleSeconds,burn:rack.firstExpectedBurnoutSeconds};
    };
    const zero=await run(0), one=await run(1), two=await run(2);
    assert.ok(zero.cycle>one.cycle && one.cycle>two.cycle,`Solidifier cycle stacking broken: ${JSON.stringify({zero,one,two})}`);
    assert.ok(zero.burn>one.burn && one.burn>two.burn,`Solidifier heat-time direction broken: ${JSON.stringify({zero,one,two})}`);
  }

  // Historical pyfa battery regression: adding batteries must not make this Legion's cap duration worse.
  {
    const names=['Legion','Medium Ancillary Armor Repairer','Medium Armor Repairer II','Inertial Stabilizers II','50MN Microwarpdrive II','Medium Cap Battery II','Small Cap Battery II','Covert Ops Cloaking Device II','Sisters Expanded Probe Launcher','Medium Energy Nosferatu II','Medium Energy Neutralizer II','Medium Hyperspatial Velocity Optimizer II','Legion Core - Energy Parasitic Complex','Legion Defensive - Covert Reconfiguration','Legion Offensive - Assault Optimization','Legion Propulsion - Interdiction Nullifier','Vespa EC-600'];
    const m=await resolve(names);
    const base=[['Medium Ancillary Armor Repairer','low',1,'active'],['Medium Armor Repairer II','low',1,'active'],['Inertial Stabilizers II','low',3,'online'],['50MN Microwarpdrive II','mid',1,'active'],['Covert Ops Cloaking Device II','high',1,'online'],['Sisters Expanded Probe Launcher','high',1,'online'],['Medium Energy Nosferatu II','high',5,'active'],['Medium Energy Neutralizer II','high',1,'active'],['Medium Hyperspatial Velocity Optimizer II','rig',3,'online'],['Legion Core - Energy Parasitic Complex','subsystem',1,'online'],['Legion Defensive - Covert Reconfiguration','subsystem',1,'online'],['Legion Offensive - Assault Optimization','subsystem',1,'online'],['Legion Propulsion - Interdiction Nullifier','subsystem',1,'online'],['Vespa EC-600','drone',5,'active']];
    const run=async batteries=>{
      const items=base.map(([n,r,q,s])=>({typeId:m.get(n),rack:r,quantity:q,state:s,activeQuantity:r==='drone'?q:undefined}));
      for(const n of batteries)items.push({typeId:m.get(n),rack:'mid',quantity:1,state:'online'});
      const a=await dogma.analyzeFittingDogma({hullTypeId:m.get('Legion'),items,snapshot:blankSnapshot});
      return {capacity:a.capacitor.capacityGj,peak:a.capacitor.peakRechargeGjPerSecond,duration:a.capacitor.depletionSeconds};
    };
    const none=await run([]), small=await run(['Small Cap Battery II']), medium=await run(['Medium Cap Battery II']), both=await run(['Small Cap Battery II','Medium Cap Battery II']);
    assert.ok(none.capacity<small.capacity && small.capacity<both.capacity,`Battery capacity direction broken: ${JSON.stringify({none,small,medium,both})}`);
    assert.ok(none.duration<small.duration && small.duration<medium.duration && medium.duration<both.duration,`Battery duration regression: ${JSON.stringify({none,small,medium,both})}`);
  }

  // pyfa #2762 class: even bonused webs must never exceed the engine's 95% safety cap.
  {
    const m=await resolve(['Daredevil','Stasis Webifier II','Gallente Frigate','Minmatar Frigate']);
    const a=await dogma.analyzeFittingDogma({
      hullTypeId:m.get('Daredevil'),
      items:[{typeId:m.get('Stasis Webifier II'),rack:'mid',quantity:1,state:'active'}],
      snapshot:{...blankSnapshot,skills:{total_sp:0,skills:[skill(m.get('Gallente Frigate')),skill(m.get('Minmatar Frigate'))]}},
    });
    const web=a.supportSystems.find(x=>x.kind==='web');
    assert.ok(web && web.strength>0 && web.strength<=0.95,`Web strength outside sane range: ${web?.strength}`);
    assert.equal(web.strength,0.9,'Daredevil + Web II all-V bonused strength changed unexpectedly');
  }

  // pyfa #2746: Stasis Drone Augmentor rigs must affect the newer hybrid combat-web drones.
  {
    const m=await resolve(['Vexor','Orbweaver SW-300-I','Medium Stasis Drone Augmentor II','Drones']);
    const snapshot={...blankSnapshot,skills:{total_sp:0,skills:[skill(m.get('Drones'))]}};
    const run=async rigs=>{
      const items=[{typeId:m.get('Orbweaver SW-300-I'),rack:'drone',quantity:5,activeQuantity:5}];
      if(rigs)items.push({typeId:m.get('Medium Stasis Drone Augmentor II'),rack:'rig',quantity:rigs,state:'online'});
      const a=await dogma.analyzeFittingDogma({hullTypeId:m.get('Vexor'),items,snapshot});
      const web=a.supportSystems.find(x=>x.kind==='web' && x.sourceKind==='drone');
      assert.ok(web,`Hybrid web drone support source missing with ${rigs} rig(s)`);
      assert.equal(web.quantity,5);
      assert.ok(a.damage.droneDps>0,'Hybrid combat-web drone lost its combat damage');
      return web.strength;
    };
    const zero=await run(0), one=await run(1), two=await run(2);
    assert.equal(zero,0.05,'Orbweaver base web strength changed unexpectedly');
    assert.equal(one,0.06,'One T2 stasis drone rig should raise Orbweaver web strength by 20%');
    assert.ok(two>one && two<0.08,`Stacked stasis-drone rig strength is wrong: ${zero}, ${one}, ${two}`);
  }
  // Missile flight uses whole-second server ticks: guaranteed range, expected fractional-tick range, then hard maximum.
  {
    const m=await resolve(['Raven','Cruise Missile Launcher II','Scourge Fury Cruise Missile','Caldari Battleship','Missile Bombardment','Missile Projection','Cruise Missiles']);
    const snapshot={...blankSnapshot,skills:{total_sp:0,skills:['Caldari Battleship','Missile Bombardment','Missile Projection','Cruise Missiles'].map(name=>skill(m.get(name)))}};
    const items=[{typeId:m.get('Cruise Missile Launcher II'),rack:'high',quantity:1,state:'active',chargeTypeId:m.get('Scourge Fury Cruise Missile')}];
    const analyzeAt=rangeM=>dogma.analyzeFittingDogma({hullTypeId:m.get('Raven'),items,snapshot,targetProfile:{rangeM,signatureRadiusM:400,transverseVelocityMps:0,velocityMps:0}});
    const inside=await analyzeAt(10000);
    const profile=inside.damage.weaponProfiles.find(x=>x.kind==='missile');
    assert.ok(profile,'Raven Fury cruise missile profile missing');
    assert.ok(profile.fullDamageRangeM < profile.expectedRangeM && profile.expectedRangeM < profile.maximumRangeM,
      `Whole-second missile ranges are not ordered: ${JSON.stringify(profile)}`);
    assert.ok(profile.extraFlightTickChance >= 0 && profile.extraFlightTickChance < 1,
      `Missile extra-flight tick chance outside [0,1): ${profile.extraFlightTickChance}`);
    const beyond=await analyzeAt(profile.maximumRangeM + 1);
    const beyondProfile=beyond.damage.weaponProfiles.find(x=>x.kind==='missile');
    assert.equal(beyondProfile.targetApplication.hitChance,0,'Missile hit chance must be zero beyond maximum range');
    assert.equal(beyondProfile.targetApplication.applicationFactor,0,'Missile application must be zero beyond maximum range');
    assert.equal(beyondProfile.targetApplication.appliedDps,0,'Missile applied DPS must be zero beyond maximum range');
  }

  // Catalogue roots contain blueprints/skills; they must never masquerade as fittable hull/drone/fighter/subsystem entries.
  for(const [placement,category] of [['ship','Ship'],['drone','Drone'],['fighter','Fighter'],['subsystem','Subsystem']]){
    const leaks=catalogue.items.filter(x=>x.placement===placement && x.categoryName!==category);
    assert.equal(leaks.length,0,`${placement} catalogue contains non-${category} records: ${JSON.stringify(leaks.slice(0,5))}`);
  }

  console.log('Pyfa weird-fit regressions: PASS (Hawk civilian launcher, deep-core mining rig, polarized resists, Vargur heat/solidifiers, Legion batteries, web cap, hybrid web-drone rigs, whole-second missile ticks, catalogue placement)');
})().catch(error=>{console.error(error);process.exitCode=1;});
