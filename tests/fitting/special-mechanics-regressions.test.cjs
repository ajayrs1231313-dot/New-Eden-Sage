const assert = require('node:assert/strict');
const dogma = require('../../dist-electron/fitting-dogma.js');
const catalogue = require('../../src/fitting-catalogue-items-static.json');

const blankSnapshot = { character:{name:'special-mechanics-regression'}, skills:{total_sp:0,skills:[]}, extended:{implants:[]} };
const skill = (id, level=5) => ({ skill_id:id, trained_skill_level:level, active_skill_level:level, skillpoints_in_skill:0 });
const snapshot = (levels = {}) => ({ ...blankSnapshot, skills:{ total_sp:0, skills:Object.entries(levels).map(([id,level])=>skill(Number(id),Number(level))) } });
const approx = (actual, expected, epsilon=1e-9, message='') => assert.ok(Math.abs(actual-expected) <= epsilon, `${message} expected ${expected}, got ${actual}`);
const resolve = async names => {
  const rows = await dogma.resolveFittingTypeNamesLocal(names);
  const ids = new Map(rows.map(row=>[row.name,row.id]));
  for (const name of names) assert.ok(ids.get(name), `Missing SDE type ${name}`);
  return ids;
};
const analyze = (hullTypeId, items, snap=blankSnapshot, extra={}) => dogma.analyzeFittingDogma({ hullTypeId, items, snapshot:snap, ...extra });

(async()=>{
  // A. Mining drones must use the same active selection/bandwidth path as combat drones.
  {
    const names=['Praxis','Orca','Industrial Command Ships','Mining Drone Operation','Drones','Mining Drone II',"'Augmented' Mining Drone",'Ice Harvesting Drone II',"'Excavator' Mining Drone","'Excavator' Ice Harvesting Drone"];
    const m=await resolve(names);
    const droneNames=['Mining Drone II',"'Augmented' Mining Drone",'Ice Harvesting Drone II',"'Excavator' Mining Drone","'Excavator' Ice Harvesting Drone"];
    for(const name of droneNames){
      const a=await analyze(m.get('Praxis'),[{typeId:m.get(name),rack:'drone',quantity:1,activeQuantity:1}],snapshot({[m.get('Drones')]:5,[m.get('Mining Drone Operation')]:5}));
      const source=a.mining.sources.find(source=>source.typeId===m.get(name));
      assert.ok(source,`${name} missing from mining output`);
      assert.equal(source.sourceKind,'drone');
      assert.equal(source.quantity,1);
      assert.ok(source.yieldPerCycleM3>0 && source.cycleSeconds>0 && source.yieldPerSecondM3>0,`${name} mining yield/cycle missing`);
    }
    const five=await analyze(m.get('Praxis'),[{typeId:m.get('Mining Drone II'),rack:'drone',quantity:10,activeQuantity:10}],snapshot({[m.get('Drones')]:5,[m.get('Mining Drone Operation')]:5}));
    const selected=five.mining.sources.find(source=>source.typeId===m.get('Mining Drone II'));
    assert.equal(selected.quantity,5,'mining drones must respect max active drone count');

    const skill0=await analyze(m.get('Praxis'),[{typeId:m.get('Mining Drone II'),rack:'drone',quantity:1,activeQuantity:1}],snapshot({[m.get('Drones')]:5,[m.get('Mining Drone Operation')]:0}));
    const skill5=await analyze(m.get('Praxis'),[{typeId:m.get('Mining Drone II'),rack:'drone',quantity:1,activeQuantity:1}],snapshot({[m.get('Drones')]:5,[m.get('Mining Drone Operation')]:5}));
    assert.ok(skill5.mining.totalYieldPerSecondM3>skill0.mining.totalYieldPerSecondM3,'Mining Drone Operation must increase mining-drone output');

    const orca0=await analyze(m.get('Orca'),[{typeId:m.get('Mining Drone II'),rack:'drone',quantity:1,activeQuantity:1}],snapshot({[m.get('Drones')]:5,[m.get('Mining Drone Operation')]:5,[m.get('Industrial Command Ships')]:0}));
    const orca5=await analyze(m.get('Orca'),[{typeId:m.get('Mining Drone II'),rack:'drone',quantity:1,activeQuantity:1}],snapshot({[m.get('Drones')]:5,[m.get('Mining Drone Operation')]:5,[m.get('Industrial Command Ships')]:5}));
    assert.ok(orca5.mining.totalYieldPerSecondM3>orca0.mining.totalYieldPerSecondM3,'Orca hull/Industrial Command Ships bonus must reach mining-drone yield');

    const mutation=(await dogma.getMutationOptionsLocal(m.get("'Augmented' Mining Drone"))).find(option=>option.mutaplasmidName==='Exigent Mining Drone Mutaplasmid');
    assert.ok(mutation,'Exigent Mining Drone Mutaplasmid option missing');
    const miningRule=mutation.attributes.find(attribute=>attribute.attributeId===77);
    assert.ok(miningRule,'mutaplasmid mining-amount rule missing');
    const runMutation=async value=>(await analyze(m.get('Praxis'),[{typeId:m.get("'Augmented' Mining Drone"),rack:'drone',quantity:1,activeQuantity:1,attributeOverrides:{77:value}}],snapshot({[m.get('Drones')]:5,[m.get('Mining Drone Operation')]:5}))).mining.totalYieldPerSecondM3;
    const min=await runMutation(miningRule.minValue), max=await runMutation(miningRule.maxValue);
    assert.ok(max>min,`min/max mining-drone mutation roll must affect yield: ${min} -> ${max}`);
  }

  // B. Reactive Armor Hardener begins omni and adapts deterministically by completed cycles.
  {
    const m=await resolve(['Praxis','Reactive Armor Hardener','Xarasier Reactive Armor Hardener','Resistance Phasing']);
    const rah=m.get('Reactive Armor Hardener');
    const base=await analyze(m.get('Praxis'),[],blankSnapshot,{damageProfile:{em:1,thermal:0,kinetic:0,explosive:0}});
    const run=(profile,cycles=0,level=0,typeId=rah)=>analyze(m.get('Praxis'),[{typeId,rack:'low',quantity:1,state:'active'}],snapshot({[m.get('Resistance Phasing')]:level}),{damageProfile:profile,mechanicState:{reactiveArmorCycles:cycles}});
    const initial=await run({em:1,thermal:0,kinetic:0,explosive:0},0,0);
    assert.ok(initial.defence.armorResists.every((value,index)=>value>base.defence.armorResists[index]),'RAH initial 15% omni pool missing');
    initial.defence.reactiveArmor.initialDistribution.forEach(value=>approx(value,.15,1e-12,'RAH initial distribution'));
    approx(initial.defence.reactiveArmor.pool,.6,1e-12,'RAH resistance pool');

    const em1=await run({em:1,thermal:0,kinetic:0,explosive:0},1,5);
    [0.33,0.09,0.09,0.09].forEach((value,index)=>approx(em1.defence.reactiveArmor.currentDistribution[index],value,1e-12,'RAH pure EM first cycle'));
    const exp1=await run({em:0,thermal:0,kinetic:0,explosive:1},1,5);
    [0.09,0.09,0.09,0.33].forEach((value,index)=>approx(exp1.defence.reactiveArmor.currentDistribution[index],value,1e-12,'RAH pure explosive first cycle'));
    const omni=await run({em:.25,thermal:.25,kinetic:.25,explosive:.25},10,5);
    omni.defence.reactiveArmor.currentDistribution.forEach(value=>approx(value,.15,1e-12,'RAH omni symmetry'));

    const ph0=await run({em:1,thermal:0,kinetic:0,explosive:0},0,0);
    const ph1=await run({em:1,thermal:0,kinetic:0,explosive:0},0,1);
    const ph5=await run({em:1,thermal:0,kinetic:0,explosive:0},0,5);
    approx(ph0.defence.reactiveArmor.cycleSeconds,10,1e-12,'Resistance Phasing 0');
    approx(ph1.defence.reactiveArmor.cycleSeconds,9,1e-12,'Resistance Phasing 1');
    approx(ph5.defence.reactiveArmor.cycleSeconds,5,1e-12,'Resistance Phasing 5');
    assert.equal(ph5.defence.reactiveArmor.cyclesToAdapt,3);
    approx(ph5.defence.reactiveArmor.timeToAdaptSeconds,15,1e-12,'RAH pure adaptation time');

    const xar=await run({em:1,thermal:0,kinetic:0,explosive:0},0,5,m.get('Xarasier Reactive Armor Hardener'));
    xar.defence.reactiveArmor.initialDistribution.forEach(value=>approx(value,.16,1e-12,'Xarasier initial distribution'));
    approx(xar.defence.reactiveArmor.pool,.64,1e-12,'Xarasier pool');

    const duplicate=await analyze(m.get('Praxis'),[
      {typeId:rah,rack:'low',quantity:1,state:'active'},
      {typeId:m.get('Xarasier Reactive Armor Hardener'),rack:'low',quantity:1,state:'active'},
    ],blankSnapshot);
    assert.ok(duplicate.issues.some(issue=>issue.code==='max-group-fitted'),'RAH max-group fitting restriction regressed');
  }

  // C. Ancillary local modules must obey actual loaded charge/paste state.
  {
    const m=await resolve(['Praxis','Medium Ancillary Shield Booster','Navy Cap Booster 50','Medium Ancillary Armor Repairer','Nanite Repair Paste']);
    const asb=async q=>analyze(m.get('Praxis'),[{typeId:m.get('Medium Ancillary Shield Booster'),rack:'mid',quantity:1,state:'active',chargeTypeId:m.get('Navy Cap Booster 50'),chargeQuantity:q}],blankSnapshot);
    const a0=await asb(0), a1=await asb(1), a4=await asb(4), a9=await asb(9);
    assert.equal(a0.defence.localRepairSystems[0].magazine.cyclesLoaded,0);
    assert.ok(a0.capacitor.demandGjPerSecond>0,'empty ASB with a charge type selected must consume capacitor');
    assert.equal(a1.capacitor.demandGjPerSecond,0,'loaded ASB charged cycles must be capacitor-free');
    assert.equal(a1.defence.localRepairSystems[0].magazine.cyclesLoaded,1);
    assert.equal(a4.defence.localRepairSystems[0].magazine.cyclesLoaded,4);
    assert.equal(a9.defence.localRepairSystems[0].magazine.cyclesLoaded,9);
    assert.equal(a9.defence.localRepairSystems[0].magazine.reloadSeconds,60);
    assert.ok(a1.defence.localRepairSystems[0].magazine.activeSeconds<a4.defence.localRepairSystems[0].magazine.activeSeconds);
    assert.ok(a4.defence.localRepairSystems[0].magazine.activeSeconds<a9.defence.localRepairSystems[0].magazine.activeSeconds);

    const aar=async q=>analyze(m.get('Praxis'),[{typeId:m.get('Medium Ancillary Armor Repairer'),rack:'low',quantity:1,state:'active',chargeTypeId:m.get('Nanite Repair Paste'),chargeQuantity:q}],blankSnapshot);
    const aar0=await aar(0), aar1=await aar(1), aar3=await aar(3), aar4=await aar(4), aar8=await aar(8), aar32=await aar(32);
    for(const result of [aar0,aar1,aar3]){
      assert.equal(result.defence.localRepairSystems[0].chargedCycles,0);
      assert.equal(result.defence.localRepairSystems[0].armor.charged,false);
      approx(result.defence.localRepairSystems[0].armor.burstPerSecond,result.defence.localRepairSystems[0].armor.unchargedPerSecond,1e-12,'AAR below one paste cycle');
    }
    assert.equal(aar4.defence.localRepairSystems[0].chargedCycles,1);
    assert.equal(aar8.defence.localRepairSystems[0].chargedCycles,2);
    assert.equal(aar32.defence.localRepairSystems[0].chargedCycles,8);
    approx(aar4.defence.localRepairSystems[0].armor.chargedMultiplier,3,1e-12,'AAR paste multiplier');
    approx(aar4.defence.localRepairSystems[0].armor.burstPerSecond,aar4.defence.localRepairSystems[0].armor.unchargedPerSecond*3,1e-12,'AAR charged burst');
  }

  // D. T3 covert defensive subsystems must modify overload rep attributes after skill scaling.
  {
    const names=['Legion','Legion Defensive - Covert Reconfiguration','Tengu','Tengu Defensive - Covert Reconfiguration','Proteus','Proteus Defensive - Covert Reconfiguration','Loki','Loki Defensive - Covert Reconfiguration','Medium Armor Repairer II','Large Shield Booster II','Amarr Defensive Systems','Caldari Defensive Systems','Gallente Defensive Systems','Minmatar Defensive Systems'];
    const m=await resolve(names);
    const cases=[
      ['Legion','Legion Defensive - Covert Reconfiguration','Medium Armor Repairer II','low','Amarr Defensive Systems','armorRepairPerSecond'],
      ['Proteus','Proteus Defensive - Covert Reconfiguration','Medium Armor Repairer II','low','Gallente Defensive Systems','armorRepairPerSecond'],
      ['Tengu','Tengu Defensive - Covert Reconfiguration','Large Shield Booster II','mid','Caldari Defensive Systems','shieldRepairPerSecond'],
      ['Loki','Loki Defensive - Covert Reconfiguration','Large Shield Booster II','mid','Minmatar Defensive Systems','shieldRepairPerSecond'],
    ];
    for(const [hull,subsystem,rep,rack,skillName,field] of cases){
      const run=(level,state)=>analyze(m.get(hull),[
        {typeId:m.get(subsystem),rack:'subsystem',quantity:1,state:'online'},
        {typeId:m.get(rep),rack,quantity:1,state},
      ],snapshot({[m.get(skillName)]:level}));
      const active0=await run(0,'active'), hot0=await run(0,'overheated'), active5=await run(5,'active'), hot5=await run(5,'overheated');
      assert.ok(active5.defence[field]>=active0.defence[field],`${hull} normal covert rep bonus regressed`);
      const ratio0=hot0.defence[field]/active0.defence[field], ratio5=hot5.defence[field]/active5.defence[field];
      assert.ok(ratio5>ratio0+1e-6,`${hull} covert extra overload rep bonus missing: ${ratio0} -> ${ratio5}`);
      assert.ok(ratio5<2,`${hull} overload modifier appears double-applied: ${ratio5}`);
      const hotSystem=hot5.defence.localRepairSystems.find(system=>system.typeId===m.get(rep));
      assert.ok(hotSystem && hotSystem.cycleSeconds>0,`${hull} heated local rep state missing`);
    }
  }

  // E/F. Remote ancillary groups and mutadaptive repairers must become real support channels.
  {
    const names=['Praxis','Navy Cap Booster 50','Nanite Repair Paste','Medium Remote Armor Repairer II','Zarmazd','Logistics Cruisers','Precursor Cruiser',
      'Small Ancillary Remote Shield Booster','Medium Ancillary Remote Shield Booster','Large Ancillary Remote Shield Booster','Capital Ancillary Remote Shield Booster',
      'Small Ancillary Remote Armor Repairer','Medium Ancillary Remote Armor Repairer','Large Ancillary Remote Armor Repairer','Capital Ancillary Remote Armor Repairer',
      'Heavy Mutadaptive Compact Remote Armor Repairer','Heavy Mutadaptive Remote Armor Repairer I','Heavy Mutadaptive Remote Armor Repairer II','Heavy Mutadaptive Scoped Remote Armor Repairer','Perun Heavy Mutadaptive Remote Armor Repairer'];
    const m=await resolve(names);
    for(const name of names.filter(name=>/Ancillary Remote (Shield Booster|Armor Repairer)$/.test(name))){
      const shield=name.includes('Shield');
      const item={typeId:m.get(name),rack:'high',quantity:1,state:'active',chargeTypeId:m.get(shield?'Navy Cap Booster 50':'Nanite Repair Paste')};
      const a=await analyze(m.get('Praxis'),[item],blankSnapshot);
      const system=a.supportSystems.find(system=>system.typeId===m.get(name));
      assert.ok(system,`${name} missing supportSystems`);
      assert.equal(system.kind,shield?'remoteShieldRep':'remoteArmorRep');
      assert.equal(system.ancillary,true);
      assert.ok(system.magazine && system.magazine.cyclesLoaded>=1,`${name} loaded-state metadata missing`);
    }
    const remoteAsb0=await analyze(m.get('Praxis'),[{typeId:m.get('Medium Ancillary Remote Shield Booster'),rack:'high',quantity:1,state:'active',chargeTypeId:m.get('Navy Cap Booster 50'),chargeQuantity:0}],blankSnapshot);
    const remoteAsb1=await analyze(m.get('Praxis'),[{typeId:m.get('Medium Ancillary Remote Shield Booster'),rack:'high',quantity:1,state:'active',chargeTypeId:m.get('Navy Cap Booster 50'),chargeQuantity:1}],blankSnapshot);
    assert.ok(remoteAsb0.capacitor.demandGjPerSecond>0 && remoteAsb1.capacitor.demandGjPerSecond===0,'remote ASB charged/empty capacitor semantics wrong');

    const standard=await analyze(m.get('Praxis'),[{typeId:m.get('Medium Remote Armor Repairer II'),rack:'high',quantity:1,state:'active'}],blankSnapshot);
    const standardRep=standard.supportSystems.find(system=>system.kind==='remoteArmorRep');
    assert.ok(standardRep && !standardRep.mutadaptive,'standard remote armor rep must remain standard');
    approx(standardRep.amountPerCycle,256,1e-9,'standard Medium Remote Armor Repairer II amount');

    const mutadaptiveNames=['Heavy Mutadaptive Compact Remote Armor Repairer','Heavy Mutadaptive Remote Armor Repairer I','Heavy Mutadaptive Remote Armor Repairer II','Heavy Mutadaptive Scoped Remote Armor Repairer','Perun Heavy Mutadaptive Remote Armor Repairer'];
    for(const name of mutadaptiveNames){
      const a=await analyze(m.get('Praxis'),[{typeId:m.get(name),rack:'high',quantity:1,state:'active'}],blankSnapshot);
      const system=a.supportSystems.find(system=>system.typeId===m.get(name));
      assert.ok(system && system.kind==='remoteArmorRep' && system.mutadaptive,`${name} mutadaptive support channel missing`);
      assert.ok(system.amountPerCycle>0 && system.perSecond>0 && system.maxPerSecond>system.perSecond,`${name} ramp output missing`);
      assert.ok(system.rampPerCycle>0 && system.maxMultiplier>1 && system.cyclesToMax>0 && system.secondsToMax>0,`${name} spool metadata missing`);
    }

    const zar0=await analyze(m.get('Zarmazd'),[{typeId:m.get('Heavy Mutadaptive Remote Armor Repairer II'),rack:'high',quantity:1,state:'active'}],snapshot({[m.get('Precursor Cruiser')]:5,[m.get('Logistics Cruisers')]:0}));
    const zar5=await analyze(m.get('Zarmazd'),[{typeId:m.get('Heavy Mutadaptive Remote Armor Repairer II'),rack:'high',quantity:1,state:'active'}],snapshot({[m.get('Precursor Cruiser')]:5,[m.get('Logistics Cruisers')]:5}));
    const z0=zar0.supportSystems.find(system=>system.mutadaptive), z5=zar5.supportSystems.find(system=>system.mutadaptive);
    assert.ok(z0&&z5,'Zarmazd mutadaptive support profile missing');
    assert.ok(z5.amountPerCycle>=z0.amountPerCycle && z5.cycleSeconds<=z0.cycleSeconds,'Zarmazd/logistics skill modifiers must reach mutadaptive reps');
    assert.ok(z5.perSecond>z0.perSecond,'Zarmazd Logistics Cruisers V must improve mutadaptive rep throughput');
  }

  // G/H. Weapon profiles preserve paper DPS while exposing loaded magazine and spool state.
  {
    const names=['Praxis','Rapid Light Missile Launcher II','Caldari Navy Scourge Light Missile','Rapid Heavy Missile Launcher II','Caldari Navy Scourge Heavy Missile','Heavy Missile Launcher II','425mm AutoCannon II','Republic Fleet EMP L','Heavy Entropic Disintegrator II','Occult M'];
    const m=await resolve(names);
    const weapon=async(module,charge,q)=>{
      const item={typeId:m.get(module),rack:'high',quantity:1,state:'active',chargeTypeId:m.get(charge)};
      if(q!==undefined)item.chargeQuantity=q;
      const a=await analyze(m.get('Praxis'),[item],blankSnapshot);
      return a.damage.weaponProfiles[0];
    };
    const rl0=await weapon('Rapid Light Missile Launcher II','Caldari Navy Scourge Light Missile',0);
    const rl1=await weapon('Rapid Light Missile Launcher II','Caldari Navy Scourge Light Missile',1);
    const rl20=await weapon('Rapid Light Missile Launcher II','Caldari Navy Scourge Light Missile',20);
    const rlfull=await weapon('Rapid Light Missile Launcher II','Caldari Navy Scourge Light Missile',undefined);
    approx(rl0.paperDps,rl20.paperDps,1e-12,'RLML paper DPS must remain paper DPS');
    assert.equal(rl0.currentDps,0,'empty RLML must not currently fire');
    assert.equal(rl0.loadedCycles,0);
    assert.equal(rl1.loadedCycles,1);
    assert.equal(rl20.loadedCycles,20);
    assert.equal(rlfull.magazineCycles,20);
    approx(rlfull.reloadSeconds,35,1e-12,'RLML reload');
    assert.ok(rl1.sustainedDps<rl20.sustainedDps && rl20.sustainedDps<rl20.burstDps,'RLML partial/full sustained duty wrong');

    for(const [module,charge] of [
      ['Rapid Heavy Missile Launcher II','Caldari Navy Scourge Heavy Missile'],
      ['Heavy Missile Launcher II','Caldari Navy Scourge Heavy Missile'],
      ['425mm AutoCannon II','Republic Fleet EMP L'],
    ]){
      const p=await weapon(module,charge,undefined);
      assert.ok(p.magazineCycles>0 && p.loadedCycles>0,`${module} magazine cycles missing`);
      assert.ok(p.burstDps>0 && p.sustainedDps>0,`${module} burst/sustained DPS missing`);
    }

    const entropic=await weapon('Heavy Entropic Disintegrator II','Occult M',undefined);
    approx(entropic.rampPerCycle,.07,1e-12,'Heavy Entropic ramp/cycle');
    approx(entropic.maxRampMultiplier,2.125,1e-12,'Heavy Entropic max multiplier');
    assert.equal(entropic.cyclesToMaxRamp,17);
    approx(entropic.secondsToMaxRamp,entropic.cycleSeconds*17,1e-9,'Heavy Entropic seconds to max');
    approx(entropic.maxRampDps,entropic.paperDps*2.125,1e-9,'Heavy Entropic max-ramp DPS');
  }

  // I. Every current fighter catalogue entry must expose either damage or support combat state without regressing launch legality.
  {
    const m=await resolve(['Thanatos','Nyx','Templar I','Cenobite I']);
    const fighters=catalogue.items.filter(item=>item.placement==='fighter');
    assert.ok(fighters.length>=94,`fighter catalogue unexpectedly shrank: ${fighters.length}`);
    let damageCount=0, supportCount=0;
    for(const fighter of fighters){
      let represented=false;
      for(const hullName of ['Thanatos','Nyx']){
        const a=await analyze(m.get(hullName),[{typeId:fighter.id,rack:'fighter-active',quantity:1,state:'active'}],blankSnapshot);
        const damage=(a.fighterSystem.damageSources??[]).filter(source=>source.typeId===fighter.id);
        const support=(a.fighterSystem.supportSystems??[]).filter(system=>system.typeId===fighter.id);
        if(damage.length||support.length){
          represented=true; damageCount+=damage.length?1:0; supportCount+=support.length?1:0; break;
        }
      }
      assert.ok(represented,`fighter ${fighter.name} has neither damage nor support combat output`);
    }
    assert.ok(damageCount+supportCount>=fighters.length,'every fighter must map to at least one current combat/support channel; ability fighters may legitimately expose both');
    const thanatos=await analyze(m.get('Thanatos'),[{typeId:m.get('Templar I'),rack:'fighter-active',quantity:4,state:'active'}],blankSnapshot);
    assert.ok(thanatos.issues.some(issue=>issue.code==='fighter-light-limit'),'Thanatos fighter light-slot legality regressed');
    const templar=await analyze(m.get('Thanatos'),[{typeId:m.get('Templar I'),rack:'fighter-active',quantity:1,state:'active'}],blankSnapshot);
    const fighterSource=templar.fighterSystem.damageSources.find(source=>source.typeId===m.get('Templar I'));
    assert.ok(fighterSource&&fighterSource.fighterCount===fighterSource.squadronSize&&fighterSource.dps>0&&fighterSource.squadronHp>0,'fighter squadron damage/HP state missing');
    const cenobite=await analyze(m.get('Thanatos'),[{typeId:m.get('Cenobite I'),rack:'fighter-active',quantity:1,state:'active'}],blankSnapshot);
    assert.ok(cenobite.fighterSystem.supportSystems.some(system=>system.kind==='energyNeutralizer'&&system.amountPerCycle>0),'fighter EWAR/support channel missing');
  }

  // J. Smartbombs are AoE-only damage sources and must not leak into single-target weapon DPS.
  {
    const m=await resolve(['Praxis','Large EMP Smartbomb II']);
    const smartbombs=catalogue.items.filter(item=>item.groupId===72);
    assert.ok(smartbombs.length>=121,`smartbomb catalogue unexpectedly shrank: ${smartbombs.length}`);
    for(const item of smartbombs){
      const a=await analyze(m.get('Praxis'),[{typeId:item.id,rack:'high',quantity:1,state:'active'}],blankSnapshot);
      const aoe=a.damage.aoeDamageSources.find(source=>source.typeId===item.id);
      assert.ok(aoe&&aoe.damagePerPulse>0&&aoe.cycleSeconds>0&&aoe.radiusM>0,`smartbomb AoE profile missing for ${item.name}`);
      assert.equal(aoe.friendlyFireEligible,true,`smartbomb friendly-fire eligibility missing for ${item.name}`);
      assert.ok(aoe.capacitorPerCycleGj>=0,`smartbomb capacitor metadata missing for ${item.name}`);
      assert.equal(a.damage.weaponProfiles.some(profile=>profile.typeId===item.id),false,`smartbomb leaked into targeted weapon profiles: ${item.name}`);
      assert.equal(a.damage.weaponDps,0,`smartbomb polluted normal single-target DPS: ${item.name}`);
    }
    const large=await analyze(m.get('Praxis'),[{typeId:m.get('Large EMP Smartbomb II'),rack:'high',quantity:1,state:'active'}],blankSnapshot);
    const aoe=large.damage.aoeDamageSources[0];
    approx(aoe.damagePerPulse,300,1e-9,'Large EMP Smartbomb II pulse');
    approx(aoe.radiusM,6000,1e-9,'Large EMP Smartbomb II radius');
  }

  console.log('special mechanics regressions: PASS');
})().catch(error=>{ console.error(error); process.exitCode=1; });
