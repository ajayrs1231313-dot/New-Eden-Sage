const assert = require('node:assert/strict');
const catalogue = require('../../src/fitting-catalogue-items-static.json');
const dogma = require('../../dist-electron/fitting-dogma.js');

const blankSnapshot = { character:{name:'t3-mutaplasmid-regression'}, skills:{total_sp:0,skills:[]}, extended:{implants:[]} };
const skill = (skill_id, trained_skill_level) => ({skill_id,trained_skill_level,active_skill_level:trained_skill_level,skillpoints_in_skill:0});
const snapshot = (levels={}) => ({...blankSnapshot,skills:{total_sp:0,skills:Object.entries(levels).map(([id,level])=>skill(Number(id),Number(level)))}});
const approx = (actual,expected,epsilon=1e-9,message='') => assert.ok(Math.abs(actual-expected)<=epsilon,`${message} expected ${expected}, got ${actual}`);
const resolve = async names => {
  const rows=await dogma.resolveFittingTypeNamesLocal(names);
  const out=new Map(rows.map(row=>[row.name,row.id]));
  for(const name of names) assert.ok(out.get(name),`Missing SDE type ${name}`);
  return out;
};
const item=(id,rack,state='online',extra={})=>({typeId:id,rack,quantity:1,state,...extra});

(async()=>{
  const hullSkills={
    Legion:['Amarr Core Systems','Amarr Defensive Systems','Amarr Offensive Systems','Amarr Propulsion Systems'],
    Tengu:['Caldari Core Systems','Caldari Defensive Systems','Caldari Offensive Systems','Caldari Propulsion Systems'],
    Proteus:['Gallente Core Systems','Gallente Defensive Systems','Gallente Offensive Systems','Gallente Propulsion Systems'],
    Loki:['Minmatar Core Systems','Minmatar Defensive Systems','Minmatar Offensive Systems','Minmatar Propulsion Systems'],
  };
  const extraNames=[
    'Stasis Webifier II','Warp Scrambler II','Multispectral ECM II','Medium Energy Neutralizer II',
    '50MN Microwarpdrive II','Large Shield Booster II','Medium Armor Repairer II',
    'Loki Core - Immobility Drivers','Proteus Core - Friction Extension Processor',
    'Tengu Core - Obfuscation Manifold','Legion Core - Energy Parasitic Complex',
    'Tengu Propulsion - Fuel Catalyst','Proteus Propulsion - Localized Injectors',
  ];
  const m=await resolve([...Object.keys(hullSkills),...Object.values(hullSkills).flat(),...extraNames]);

  // Every current full four-subsystem combination must remain legal and numerically sane.
  // There are 3 choices in each of four subsystem families: 3^4 = 81 per hull, 324 total.
  let combinationCount=0;
  for(const [hull,skills] of Object.entries(hullSkills)){
    const subs=catalogue.items.filter(x=>x.placement==='subsystem'&&x.name.startsWith(hull+' '));
    assert.equal(subs.length,12,`${hull} current subsystem catalogue count changed`);
    const by={};
    for(const sub of subs){const family=sub.name.split(' - ')[0].split(' ').pop();(by[family]??=[]).push(sub);}
    for(const family of ['Core','Defensive','Offensive','Propulsion']) assert.equal(by[family]?.length,3,`${hull} ${family} subsystem family changed`);
    for(const core of by.Core) for(const defensive of by.Defensive) for(const offensive of by.Offensive) for(const propulsion of by.Propulsion){
      combinationCount++;
      const fitted=[core,defensive,offensive,propulsion].map(sub=>item(sub.id,'subsystem'));
      const levels=Object.fromEntries(skills.map(name=>[m.get(name),5]));
      const a=await dogma.analyzeFittingDogma({hullTypeId:m.get(hull),items:fitted,snapshot:snapshot(levels)});
      assert.equal(a.issues.filter(issue=>issue.level==='error').length,0,`${hull} subsystem combination illegal: ${fitted.map(x=>x.typeId).join(',')}`);
      const numbers=[
        a.resources.capacity.cpu,a.resources.capacity.powergrid,a.resources.capacity.calibration,
        a.fitting.slots.high,a.fitting.slots.mid,a.fitting.slots.low,a.fitting.slots.rig,
        a.fitting.hardpoints.turret,a.fitting.hardpoints.launcher,
        a.storage.cargoCapacityM3,a.storage.droneBayCapacityM3,a.storage.droneBandwidthCapacity,
        a.capacitor.capacityGj,a.capacitor.rechargeSeconds,
        a.defence.shieldHp,a.defence.armorHp,a.defence.structureHp,a.defence.totalEhp,
        a.navigation.maximumVelocity,a.navigation.massKg,a.navigation.agility,a.navigation.warpSpeedAuPerSecond,
        a.targeting.maximumRangeM,a.targeting.scanResolution,a.targeting.signatureRadiusM,a.targeting.sensorStrength,
      ];
      assert.ok(numbers.every(value=>Number.isFinite(value)&&value>=0),`${hull} subsystem combination produced invalid scalar output`);
    }
  }
  assert.equal(combinationCount,324);

  // Core subsystem special-overheat bonuses must be applied AFTER subsystem skill scaling.
  const supportCases=[
    ['Loki','Loki Core - Immobility Drivers','Minmatar Core Systems','Stasis Webifier II','mid','web','optimalM',1.30,1.45],
    ['Proteus','Proteus Core - Friction Extension Processor','Gallente Core Systems','Warp Scrambler II','mid','tackle','optimalM',1.20,1.35],
    ['Tengu','Tengu Core - Obfuscation Manifold','Caldari Core Systems','Multispectral ECM II','mid','ecm','strength',1.20,1.35],
  ];
  await resolve(supportCases.flatMap(row=>row.slice(1,4)));
  for(const [hull,subsystem,skillName,module,rack,kind,field,ratio0,ratio5] of supportCases){
    const run=async(level,state)=>{
      const a=await dogma.analyzeFittingDogma({
        hullTypeId:m.get(hull),
        items:[item(m.get(subsystem),'subsystem'),item(m.get(module),rack,state)],
        snapshot:snapshot({[m.get(skillName)]:level}),
      });
      return a.supportSystems.find(system=>system.kind===kind);
    };
    const active0=await run(0,'active'), hot0=await run(0,'overheated');
    const active5=await run(5,'active'), hot5=await run(5,'overheated');
    assert.ok(active0&&hot0&&active5&&hot5,`${hull} ${kind} support channel missing`);
    approx(hot0[field]/active0[field],ratio0,1e-12,`${hull} base heat ratio`);
    approx(hot5[field]/active5[field],ratio5,1e-12,`${hull} subsystem-V heat ratio`);
  }

  // Legion Energy Parasitic Complex uses the same stateful ordering on neut cycle/amount.
  {
    const hull='Legion', subsystem='Legion Core - Energy Parasitic Complex', skillName='Amarr Core Systems', module='Medium Energy Neutralizer II';
    await resolve([subsystem]);
    const run=async(level,state)=>{
      const a=await dogma.analyzeFittingDogma({hullTypeId:m.get(hull),items:[item(m.get(subsystem),'subsystem'),item(m.get(module),'high',state)],snapshot:snapshot({[m.get(skillName)]:level})});
      return a.supportSystems.find(system=>system.kind==='energyNeutralizer');
    };
    const active0=await run(0,'active'), hot0=await run(0,'overheated'), active5=await run(5,'active'), hot5=await run(5,'overheated');
    approx(active0.cycleSeconds,12,1e-12,'Legion neut active cycle');
    approx(hot0.cycleSeconds,10.2,1e-12,'Legion neut base overheat cycle');
    approx(active5.cycleSeconds,12,1e-12,'Legion neut skill-V active cycle');
    approx(hot5.cycleSeconds,9.3,1e-12,'Legion neut subsystem-V overheat cycle');
    assert.ok(active5.amountPerCycle>active0.amountPerCycle,'Legion subsystem skill must increase neut amount');
  }

  // Propulsion heat-benefit subsystems must modify the MWD's overload bonus after skill scaling.
  for(const [hull,subsystem,skillName] of [
    ['Tengu','Tengu Propulsion - Fuel Catalyst','Caldari Propulsion Systems'],
    ['Proteus','Proteus Propulsion - Localized Injectors','Gallente Propulsion Systems'],
  ]){
    await resolve([subsystem]);
    const run=async(level,state)=>dogma.analyzeFittingDogma({
      hullTypeId:m.get(hull),
      items:[item(m.get(subsystem),'subsystem'),item(m.get('50MN Microwarpdrive II'),'mid',state)],
      snapshot:snapshot({[m.get(skillName)]:level}),
    });
    const a0=await run(0,'active'), h0=await run(0,'overheated'), a5=await run(5,'active'), h5=await run(5,'overheated');
    const speed=x=>x.navigation.activePropulsion[0].speedFactorPercent;
    approx(speed(h0)/speed(a0),1.5,1e-12,`${hull} base MWD heat ratio`);
    approx(speed(h5)/speed(a5),1.75,1e-12,`${hull} subsystem-V MWD heat ratio`);
  }

  // The four specialized core subsystems also reduce generic rack heat damage through
  // a fitted shipID LocationModifier. The other two core choices per race lack this effect.
  for(const [hull,subsystem,skillName] of [
    ['Legion','Legion Core - Energy Parasitic Complex','Amarr Core Systems'],
    ['Tengu','Tengu Core - Obfuscation Manifold','Caldari Core Systems'],
    ['Proteus','Proteus Core - Friction Extension Processor','Gallente Core Systems'],
    ['Loki','Loki Core - Immobility Drivers','Minmatar Core Systems'],
  ]){
    await resolve([subsystem]);
    const run=async level=>dogma.analyzeFittingDogma({
      hullTypeId:m.get(hull),
      items:[item(m.get(subsystem),'subsystem'),item(m.get('Stasis Webifier II'),'mid','overheated')],
      snapshot:snapshot({[m.get(skillName)]:level}),
    });
    const zero=await run(0), five=await run(5);
    const heat=x=>x.heat.racks.find(r=>r.rack==='mid');
    const moduleHeat=x=>heat(x).modules.find(mod=>mod.typeId===m.get('Stasis Webifier II')).heatDamage;
    approx(moduleHeat(zero),5,1e-12,`${hull} base module heat damage`);
    approx(moduleHeat(five),3.75,1e-12,`${hull} subsystem-V heat damage reduction`);
    assert.ok(heat(five).firstExpectedBurnoutSeconds>heat(zero).firstExpectedBurnoutSeconds,`${hull} core heat reduction must extend expected burnout`);
  }

  // Mutaplasmid endpoint rolls must compose with subsystem range, heat, fitting and cap modifiers.
  const endpointOverrides=async(moduleName,optionPrefix='Decayed ')=>{
    const options=await dogma.getMutationOptionsLocal(m.get(moduleName));
    const option=options.find(row=>row.mutaplasmidName.startsWith(optionPrefix));
    assert.ok(option,`${moduleName} mutation option missing`);
    return {
      min:Object.fromEntries(option.attributes.map(a=>[a.attributeId,a.minValue])),
      max:Object.fromEntries(option.attributes.map(a=>[a.attributeId,a.maxValue])),
    };
  };

  {
    const overrides=await endpointOverrides('Stasis Webifier II');
    const subsystem='Loki Core - Immobility Drivers'; await resolve([subsystem]);
    const run=async(over,state)=>dogma.analyzeFittingDogma({hullTypeId:m.get('Loki'),items:[item(m.get(subsystem),'subsystem'),item(m.get('Stasis Webifier II'),'mid',state,{attributeOverrides:over})],snapshot:snapshot({[m.get('Minmatar Core Systems')]:5})});
    const min=await run(overrides.min,'active'), minHot=await run(overrides.min,'overheated'), max=await run(overrides.max,'active'), maxHot=await run(overrides.max,'overheated');
    const web=x=>x.supportSystems.find(s=>s.kind==='web');
    assert.ok(web(max).optimalM>web(min).optimalM,'mutated web range endpoint must reach support output');
    assert.notEqual(web(max).strength,web(min).strength,'mutated web strength endpoint must reach support output');
    approx(web(minHot).optimalM/web(min).optimalM,1.45,1e-12,'mutated Loki web heat ratio');
    approx(web(maxHot).optimalM/web(max).optimalM,1.45,1e-12,'mutated Loki web heat ratio max endpoint');
    assert.notEqual(min.resources.used.cpu,max.resources.used.cpu,'mutated web CPU endpoint must reach fitting resources');
    assert.notEqual(min.capacitor.demandGjPerSecond,max.capacitor.demandGjPerSecond,'mutated web cap endpoint must reach capacitor demand');
  }

  {
    const overrides=await endpointOverrides('Warp Scrambler II');
    const subsystem='Proteus Core - Friction Extension Processor'; await resolve([subsystem]);
    const run=async(over,state)=>dogma.analyzeFittingDogma({hullTypeId:m.get('Proteus'),items:[item(m.get(subsystem),'subsystem'),item(m.get('Warp Scrambler II'),'mid',state,{attributeOverrides:over})],snapshot:snapshot({[m.get('Gallente Core Systems')]:5})});
    const min=await run(overrides.min,'active'), minHot=await run(overrides.min,'overheated'), max=await run(overrides.max,'active'), maxHot=await run(overrides.max,'overheated');
    const scram=x=>x.supportSystems.find(s=>s.kind==='tackle');
    assert.ok(scram(max).optimalM>scram(min).optimalM,'mutated scram range endpoint missing');
    approx(scram(minHot).optimalM/scram(min).optimalM,1.35,1e-12,'mutated Proteus scram heat ratio');
    approx(scram(maxHot).optimalM/scram(max).optimalM,1.35,1e-12,'mutated Proteus scram heat ratio max endpoint');
  }

  {
    const overrides=await endpointOverrides('Medium Energy Neutralizer II');
    const subsystem='Legion Core - Energy Parasitic Complex'; await resolve([subsystem]);
    const run=async(over,state)=>dogma.analyzeFittingDogma({hullTypeId:m.get('Legion'),items:[item(m.get(subsystem),'subsystem'),item(m.get('Medium Energy Neutralizer II'),'high',state,{attributeOverrides:over})],snapshot:snapshot({[m.get('Amarr Core Systems')]:5})});
    const min=await run(overrides.min,'active'), max=await run(overrides.max,'active'), maxHot=await run(overrides.max,'overheated');
    const neut=x=>x.supportSystems.find(s=>s.kind==='energyNeutralizer');
    assert.ok(neut(max).amountPerCycle>neut(min).amountPerCycle,'mutated neut amount endpoint missing');
    assert.ok(neut(max).optimalM>neut(min).optimalM,'mutated neut range endpoint missing');
    // Energy Parasitic Complex halves neut CPU/PG before the mutated endpoint is reported as fitted usage.
    approx(min.resources.used.powergrid,Number(overrides.min[30])*.5,1e-9,'mutated neut PG + subsystem fitting reduction');
    approx(max.resources.used.powergrid,Number(overrides.max[30])*.5,1e-9,'mutated neut PG + subsystem fitting reduction max');
    assert.ok(neut(maxHot).perSecond>neut(max).perSecond,'mutated neut must retain subsystem heat-cycle benefit');
  }

  {
    const overrides=await endpointOverrides('50MN Microwarpdrive II');
    const subsystem='Proteus Propulsion - Localized Injectors'; await resolve([subsystem]);
    const run=async(over,level,state)=>dogma.analyzeFittingDogma({hullTypeId:m.get('Proteus'),items:[item(m.get(subsystem),'subsystem'),item(m.get('50MN Microwarpdrive II'),'mid',state,{attributeOverrides:over})],snapshot:snapshot({[m.get('Gallente Propulsion Systems')]:level})});
    const min0=await run(overrides.min,0,'active'), min5=await run(overrides.min,5,'active'), minHot5=await run(overrides.min,5,'overheated');
    const max0=await run(overrides.max,0,'active'), max5=await run(overrides.max,5,'active'), maxHot5=await run(overrides.max,5,'overheated');
    assert.ok(min5.capacitor.demandGjPerSecond<min0.capacitor.demandGjPerSecond,'Proteus propulsion skill must reduce mutated MWD cap demand');
    assert.ok(max5.capacitor.demandGjPerSecond<max0.capacitor.demandGjPerSecond,'Proteus propulsion skill must reduce max-roll MWD cap demand');
    const speed=x=>x.navigation.activePropulsion[0].speedFactorPercent;
    approx(speed(minHot5)/speed(min5),1.75,1e-12,'mutated MWD subsystem heat benefit');
    approx(speed(maxHot5)/speed(max5),1.75,1e-12,'mutated MWD subsystem heat benefit max');
    assert.notEqual(min5.targeting.signatureRadiusM,max5.targeting.signatureRadiusM,'mutated MWD signature endpoint missing');
  }

  console.log(`T3 + mutaplasmid regressions: PASS (${combinationCount} subsystem combinations plus stateful mutation/heat cases)`);
})().catch(error=>{console.error(error);process.exitCode=1;});
