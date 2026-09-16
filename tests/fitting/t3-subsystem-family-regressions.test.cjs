const assert = require('node:assert/strict');
const dogma = require('../../dist-electron/fitting-dogma.js');

const blankSnapshot={character:{name:'t3-subsystem-family-regression'},skills:{total_sp:0,skills:[]},extended:{implants:[]}};
const snapshot=(levels={})=>({...blankSnapshot,skills:{total_sp:0,skills:Object.entries(levels).map(([id,level])=>({skill_id:Number(id),trained_skill_level:Number(level),active_skill_level:Number(level),skillpoints_in_skill:0}))}});
const approx=(actual,expected,epsilon=1e-9,message='')=>assert.ok(Math.abs(actual-expected)<=epsilon,`${message} expected ${expected}, got ${actual}`);
const item=(typeId,rack,state='online',extra={})=>({typeId,rack,quantity:1,state,...extra});
const names=[
  'Praxis','Legion','Tengu','Proteus','Loki',
  'Amarr Defensive Systems','Caldari Defensive Systems','Gallente Defensive Systems','Minmatar Defensive Systems',
  'Amarr Offensive Systems','Caldari Offensive Systems','Gallente Offensive Systems','Minmatar Offensive Systems',
  'Amarr Propulsion Systems','Caldari Propulsion Systems','Gallente Propulsion Systems','Minmatar Propulsion Systems',
  'Legion Defensive - Augmented Plating','Proteus Defensive - Augmented Plating','Tengu Defensive - Supplemental Screening','Loki Defensive - Augmented Durability',
  'Legion Defensive - Nanobot Injector','Proteus Defensive - Nanobot Injector','Tengu Defensive - Amplification Node','Loki Defensive - Adaptive Defense Node',
  'Legion Offensive - Assault Optimization','Legion Offensive - Liquid Crystal Magnifiers','Legion Offensive - Support Processor',
  'Tengu Offensive - Accelerated Ejection Bay','Tengu Offensive - Magnetic Infusion Basin','Tengu Offensive - Support Processor',
  'Proteus Offensive - Drone Synthesis Projector','Proteus Offensive - Hybrid Encoding Platform','Proteus Offensive - Support Processor',
  'Loki Offensive - Launcher Efficiency Configuration','Loki Offensive - Projectile Scoping Array','Loki Offensive - Support Processor',
  'Legion Propulsion - Wake Limiter','Loki Propulsion - Wake Limiter','Tengu Propulsion - Fuel Catalyst',
  'EM Armor Hardener II','Multispectrum Shield Hardener II','Medium Armor Repairer II','Large Shield Booster II',
  'Medium Remote Armor Repairer II','Medium Remote Shield Booster II',
  'Heavy Assault Missile Launcher II','Scourge Rage Heavy Assault Missile','Heavy Missile Launcher II','Scourge Fury Heavy Missile',
  'Heavy Pulse Laser II','Conflagration M','Heavy Neutron Blaster II','Void M','425mm AutoCannon II','Republic Fleet EMP M',
  'Hammerhead II','Drones','10MN Afterburner II','50MN Microwarpdrive II','Armor Command Burst II','Armor Reinforcement Charge',
];

(async()=>{
  const resolved=await dogma.resolveFittingTypeNamesLocal(names);
  const m=new Map(resolved.map(row=>[row.name,row.id]));
  for(const name of names) assert.ok(m.get(name),`Missing SDE type ${name}`);

  // Defensive hardener-overheat bonus: skill V must strengthen only the heated state.
  const hardenerCases=[
    ['Legion','Legion Defensive - Augmented Plating','Amarr Defensive Systems','EM Armor Hardener II','low','armorResists'],
    ['Proteus','Proteus Defensive - Augmented Plating','Gallente Defensive Systems','EM Armor Hardener II','low','armorResists'],
    ['Tengu','Tengu Defensive - Supplemental Screening','Caldari Defensive Systems','Multispectrum Shield Hardener II','mid','shieldResists'],
    ['Loki','Loki Defensive - Augmented Durability','Minmatar Defensive Systems','Multispectrum Shield Hardener II','mid','shieldResists'],
  ];
  for(const [hull,subsystem,skillName,module,rack,resistField] of hardenerCases){
    const run=(level,state)=>dogma.analyzeFittingDogma({
      hullTypeId:m.get(hull),
      items:[item(m.get(subsystem),'subsystem'),item(m.get(module),rack,state)],
      snapshot:snapshot({[m.get(skillName)]:level}),
    });
    const active0=await run(0,'active'),active5=await run(5,'active'),hot0=await run(0,'overheated'),hot5=await run(5,'overheated');
    assert.deepEqual(active5.defence[resistField],active0.defence[resistField],`${hull} hardener subsystem changed normal active resistance`);
    assert.ok(hot5.defence[resistField].some((value,index)=>value>hot0.defence[resistField][index]+1e-12),`${hull} defensive hardener-overheat bonus missing`);
  }

  // Alternate local-repair subsystem branches must improve normal repair and extra-overheat ratio.
  const localRepCases=[
    ['Legion','Legion Defensive - Nanobot Injector','Amarr Defensive Systems','Medium Armor Repairer II','low','armorRepairPerSecond'],
    ['Proteus','Proteus Defensive - Nanobot Injector','Gallente Defensive Systems','Medium Armor Repairer II','low','armorRepairPerSecond'],
    ['Tengu','Tengu Defensive - Amplification Node','Caldari Defensive Systems','Large Shield Booster II','mid','shieldRepairPerSecond'],
    ['Loki','Loki Defensive - Adaptive Defense Node','Minmatar Defensive Systems','Medium Armor Repairer II','low','armorRepairPerSecond'],
    ['Loki','Loki Defensive - Adaptive Defense Node','Minmatar Defensive Systems','Large Shield Booster II','mid','shieldRepairPerSecond'],
  ];
  for(const [hull,subsystem,skillName,module,rack,field] of localRepCases){
    const run=(level,state)=>dogma.analyzeFittingDogma({hullTypeId:m.get(hull),items:[item(m.get(subsystem),'subsystem'),item(m.get(module),rack,state)],snapshot:snapshot({[m.get(skillName)]:level})});
    const a0=await run(0,'active'),h0=await run(0,'overheated'),a5=await run(5,'active'),h5=await run(5,'overheated');
    assert.ok(a5.defence[field]>a0.defence[field],`${hull} local-repair amount bonus missing`);
    assert.ok(h5.defence[field]/a5.defence[field]>h0.defence[field]/a0.defence[field],`${hull} local-repair extra-overheat bonus missing`);
  }

  // Support Processor remote reps: cap-use and overload bonuses must scale through supportSystems.
  const supportCases=[
    ['Legion','Legion Offensive - Support Processor','Amarr Offensive Systems','Medium Remote Armor Repairer II','remoteArmorRep'],
    ['Proteus','Proteus Offensive - Support Processor','Gallente Offensive Systems','Medium Remote Armor Repairer II','remoteArmorRep'],
    ['Tengu','Tengu Offensive - Support Processor','Caldari Offensive Systems','Medium Remote Shield Booster II','remoteShieldRep'],
    ['Loki','Loki Offensive - Support Processor','Minmatar Offensive Systems','Medium Remote Armor Repairer II','remoteArmorRep'],
    ['Loki','Loki Offensive - Support Processor','Minmatar Offensive Systems','Medium Remote Shield Booster II','remoteShieldRep'],
  ];
  for(const [hull,subsystem,skillName,module,kind] of supportCases){
    const run=(level,state)=>dogma.analyzeFittingDogma({hullTypeId:m.get(hull),items:[item(m.get(subsystem),'subsystem'),item(m.get(module),'high',state)],snapshot:snapshot({[m.get(skillName)]:level})});
    const a0=await run(0,'active'),h0=await run(0,'overheated'),a5=await run(5,'active'),h5=await run(5,'overheated');
    const s0=a0.supportSystems.find(x=>x.kind===kind),sh0=h0.supportSystems.find(x=>x.kind===kind),s5=a5.supportSystems.find(x=>x.kind===kind),sh5=h5.supportSystems.find(x=>x.kind===kind);
    assert.ok(s0&&sh0&&s5&&sh5,`${hull} Support Processor remote-rep channel missing`);
    assert.ok(a5.capacitor.demandGjPerSecond<a0.capacitor.demandGjPerSecond,`${hull} Support Processor remote-rep cap reduction missing`);
    assert.ok(sh5.perSecond/s5.perSecond>sh0.perSecond/s0.perSecond,`${hull} Support Processor remote-rep overload bonus missing`);
  }

  // Weapon capacitor: energy/hybrid turrets consume cap, projectiles do not; Legion reduces laser cap need.
  const turret=async(hull,module,charge,items=[],snap=blankSnapshot)=>dogma.analyzeFittingDogma({hullTypeId:m.get(hull),items:[...items,item(m.get(module),'high','active',{chargeTypeId:m.get(charge)})],snapshot:snap});
  const laser=await turret('Praxis','Heavy Pulse Laser II','Conflagration M');
  const hybrid=await turret('Praxis','Heavy Neutron Blaster II','Void M');
  const projectile=await turret('Praxis','425mm AutoCannon II','Republic Fleet EMP M');
  assert.ok(laser.capacitor.demandGjPerSecond>0,'energy turret capacitor demand missing');
  assert.ok(hybrid.capacitor.demandGjPerSecond>0,'hybrid turret capacitor demand missing');
  approx(projectile.capacitor.demandGjPerSecond,0,1e-12,'projectile turret capacitor demand');
  const legionLaser0=await turret('Legion','Heavy Pulse Laser II','Conflagration M',[item(m.get('Legion Offensive - Liquid Crystal Magnifiers'),'subsystem')],snapshot({[m.get('Amarr Offensive Systems')]:0}));
  const legionLaser5=await turret('Legion','Heavy Pulse Laser II','Conflagration M',[item(m.get('Legion Offensive - Liquid Crystal Magnifiers'),'subsystem')],snapshot({[m.get('Amarr Offensive Systems')]:5}));
  assert.ok(legionLaser5.capacitor.demandGjPerSecond<legionLaser0.capacitor.demandGjPerSecond*.51,'Legion energy-weapon cap-use bonus missing');
  assert.ok(legionLaser5.damage.weaponDps>legionLaser0.damage.weaponDps&&legionLaser5.damage.weaponProfiles[0].optimalM>legionLaser0.damage.weaponProfiles[0].optimalM,'Legion laser damage/range bonus missing');

  // Other offensive branches: DPS plus a distinct secondary statistic for each family.
  const offensiveCases=[
    ['Legion','Legion Offensive - Assault Optimization','Amarr Offensive Systems','Heavy Assault Missile Launcher II','Scourge Rage Heavy Assault Missile','missile','cycleSeconds','down'],
    ['Tengu','Tengu Offensive - Accelerated Ejection Bay','Caldari Offensive Systems','Heavy Missile Launcher II','Scourge Fury Heavy Missile','missile','maximumRangeM','up'],
    ['Tengu','Tengu Offensive - Magnetic Infusion Basin','Caldari Offensive Systems','Heavy Neutron Blaster II','Void M','turret','optimalM','up'],
    ['Proteus','Proteus Offensive - Hybrid Encoding Platform','Gallente Offensive Systems','Heavy Neutron Blaster II','Void M','turret','tracking','up'],
    ['Loki','Loki Offensive - Launcher Efficiency Configuration','Minmatar Offensive Systems','Heavy Missile Launcher II','Scourge Fury Heavy Missile','missile','explosionVelocity','up'],
    ['Loki','Loki Offensive - Projectile Scoping Array','Minmatar Offensive Systems','425mm AutoCannon II','Republic Fleet EMP M','turret','falloffM','up'],
  ];
  for(const [hull,subsystem,skillName,module,charge,kind,field,direction] of offensiveCases){
    const run=level=>dogma.analyzeFittingDogma({hullTypeId:m.get(hull),items:[item(m.get(subsystem),'subsystem'),item(m.get(module),'high','active',{chargeTypeId:m.get(charge)})],snapshot:snapshot({[m.get(skillName)]:level})});
    const zero=await run(0),five=await run(5);
    const p0=zero.damage.weaponProfiles.find(profile=>profile.kind===kind),p5=five.damage.weaponProfiles.find(profile=>profile.kind===kind);
    assert.ok(p0&&p5,`${hull} offensive weapon profile missing`);
    assert.ok(five.damage.weaponDps>zero.damage.weaponDps,`${hull} offensive subsystem DPS bonus missing`);
    assert.ok(direction==='up'?p5[field]>p0[field]:p5[field]<p0[field],`${hull} offensive subsystem ${field} bonus missing`);
  }

  // Proteus drone branch must change damage, tracking and maximum velocity.
  const droneRun=level=>dogma.analyzeFittingDogma({hullTypeId:m.get('Proteus'),items:[item(m.get('Proteus Offensive - Drone Synthesis Projector'),'subsystem'),{typeId:m.get('Hammerhead II'),rack:'drone',quantity:5,activeQuantity:5,state:'active'}],snapshot:snapshot({[m.get('Gallente Offensive Systems')]:level,[m.get('Drones')]:5})});
  const d0=await droneRun(0),d5=await droneRun(5);
  assert.ok(d5.damage.droneDps>d0.damage.droneDps,'Proteus Drone Synthesis damage bonus missing');
  assert.ok(d5.damage.activeDrones[0].tracking>d0.damage.activeDrones[0].tracking,'Proteus Drone Synthesis tracking bonus missing');
  assert.ok(d5.damage.activeDrones[0].maximumVelocityMps>d0.damage.activeDrones[0].maximumVelocityMps,'Proteus Drone Synthesis velocity bonus missing');

  // Wake/Fuel propulsion branches: AB speed scales with subsystem skill.
  for(const [hull,subsystem,skillName] of [
    ['Legion','Legion Propulsion - Wake Limiter','Amarr Propulsion Systems'],
    ['Loki','Loki Propulsion - Wake Limiter','Minmatar Propulsion Systems'],
    ['Tengu','Tengu Propulsion - Fuel Catalyst','Caldari Propulsion Systems'],
  ]){
    const run=level=>dogma.analyzeFittingDogma({hullTypeId:m.get(hull),items:[item(m.get(subsystem),'subsystem'),item(m.get('10MN Afterburner II'),'mid','active')],snapshot:snapshot({[m.get(skillName)]:level})});
    const zero=await run(0),five=await run(5);
    assert.ok(five.navigation.activePropulsion[0].speedFactorPercent>zero.navigation.activePropulsion[0].speedFactorPercent,`${hull} AB propulsion bonus missing`);
  }

  // Support Processor command-burst buff value must scale with offensive subsystem skill.
  const burstRun=level=>dogma.analyzeFittingDogma({hullTypeId:m.get('Legion'),items:[item(m.get('Legion Offensive - Support Processor'),'subsystem'),item(m.get('Armor Command Burst II'),'high','active',{chargeTypeId:m.get('Armor Reinforcement Charge')})],snapshot:snapshot({[m.get('Amarr Offensive Systems')]:level})});
  const b0=await burstRun(0),b5=await burstRun(5);
  const value0=b0.supportSystems.find(system=>system.kind==='commandBurst').buffs[0].value;
  const value5=b5.supportSystems.find(system=>system.kind==='commandBurst').buffs[0].value;
  assert.ok(Math.abs(value5)>Math.abs(value0),'Support Processor command-burst strength bonus missing');

  console.log('T3 subsystem family regressions: PASS (defence, support, weapons, drones, propulsion, command bursts, weapon capacitor)');
})().catch(error=>{console.error(error);process.exitCode=1;});
