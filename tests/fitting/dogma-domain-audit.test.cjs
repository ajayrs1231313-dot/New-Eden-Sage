const assert=require('node:assert/strict');
const dogma=require('../../dist-electron/fitting-dogma.js');
const EPS=1e-9;
const approx=(a,e,label,eps=EPS)=>{assert.ok(Number.isFinite(a),`${label}: non-finite ${a}`);assert.ok(Math.abs(a-e)<=eps,`${label}: ${a} != ${e}`)};
const snapshot=levels=>({character:{name:'DOGMA domain audit'},skills:{total_sp:0,skills:Object.entries(levels).map(([skill_id,trained_skill_level])=>({skill_id:Number(skill_id),trained_skill_level}))},extended:{implants:[]}});
(async()=>{
 const names=[
  'Ishtar','Merlin','Caracal','Dominix','Tengu','Loki','Guardian-Vexor','Iteron Mark V',
  'Navigation','Capacitor Management','Capacitor Systems Operation','CPU Management','Power Grid Management','Drone Interfacing','Drones','Target Management','Gallente Cruiser','Heavy Assault Cruisers','Heavy Drone Operation','Caldari Drone Specialization','Small Blaster Specialization','Light Missile Specialization',
  'Wasp II','Hammerhead II','Light Neutron Blaster II','Antimatter Charge S','Light Missile Launcher II','Scourge Light Missile','Heavy Missile Launcher II','Scourge Heavy Missile','Ballistic Control System II','Medium Warhead Calefaction Catalyst I','Drone Link Augmentor I',
  '10MN Y-S8 Compact Afterburner','Pithum C-Type Multispectrum Shield Hardener','Tracking Computer II','Optimal Range Script','Tracking Speed Script','250mm Railgun II','Antimatter Charge M',
  "Inherent Implants 'Squire' Power Grid Management EG-603","Zainou 'Gnome' Weapon Upgrades WU-1003","Inherent Implants 'Squire' Capacitor Management EM-803",
  'Large Capacitor Control Circuit II','X-Large Shield Booster II','Ogre II',
  'Tengu Core - Augmented Graviton Reactor','Tengu Defensive - Amplification Node','Tengu Offensive - Accelerated Ejection Bay','Tengu Offensive - Magnetic Infusion Basin','Tengu Propulsion - Chassis Optimization','Caldari Offensive Systems',
  'Loki Core - Augmented Nuclear Reactor','Loki Defensive - Adaptive Defense Node','Loki Offensive - Launcher Efficiency Configuration','Loki Offensive - Projectile Scoping Array','Loki Propulsion - Wake Limiter','Minmatar Offensive Systems'
 ];
 const resolved=await dogma.resolveFittingTypeNamesLocal(names); const ids=new Map(resolved.map(x=>[x.name,x.id]));
 const missing=names.filter(n=>!ids.has(n)); assert.deepEqual(missing,[],`Missing SDE names: ${missing.join(', ')}`); const id=n=>ids.get(n);
 const analyze=(hull,items=[],levels={},extra={})=>dogma.analyzeFittingDogma({hullTypeId:id(hull),items,snapshot:snapshot(levels),...extra});

 // Skill level 0..5 scaling plus domain isolation.
 const bare0=await analyze('Ishtar');
 for(let level=0;level<=5;level++){
  const nav=await analyze('Ishtar',[],{[id('Navigation')]:level});
  approx(nav.navigation.baseMaximumVelocity,bare0.navigation.baseMaximumVelocity*(1+0.05*level),`Navigation ${level}`);
  approx(nav.capacitor.capacityGj,bare0.capacitor.capacityGj,`Navigation ${level} must not alter cap`);
  const cm=await analyze('Ishtar',[],{[id('Capacitor Management')]:level});
  approx(cm.capacitor.capacityGj,bare0.capacitor.capacityGj*(1+0.05*level),`Capacitor Management ${level}`);
  approx(cm.navigation.baseMaximumVelocity,bare0.navigation.baseMaximumVelocity,`Capacitor Management ${level} must not alter speed`);
  const cso=await analyze('Ishtar',[],{[id('Capacitor Systems Operation')]:level});
  approx(cso.capacitor.rechargeSeconds,bare0.capacitor.rechargeSeconds*(1-0.05*level),`Capacitor Systems Operation ${level}`);
  const cpu=await analyze('Ishtar',[],{[id('CPU Management')]:level});
  approx(cpu.resources.capacity.cpu,bare0.resources.capacity.cpu*(1+0.05*level),`CPU Management ${level}`);
  const pg=await analyze('Ishtar',[],{[id('Power Grid Management')]:level});
  approx(pg.resources.capacity.powergrid,bare0.resources.capacity.powergrid*(1+0.05*level),`Power Grid Management ${level}`);
 }

 const droneItems=[{typeId:id('Wasp II'),rack:'drone',quantity:5,activeQuantity:5}];
 const droneBaseLevels={[id('Drones')]:5,[id('Heavy Drone Operation')]:5,[id('Caldari Drone Specialization')]:4};
 const di0=await analyze('Ishtar',droneItems,{...droneBaseLevels,[id('Drone Interfacing')]:0,[id('Gallente Cruiser')]:0});
 for(let level=0;level<=5;level++){
  const a=await analyze('Ishtar',droneItems,{...droneBaseLevels,[id('Drone Interfacing')]:level,[id('Gallente Cruiser')]:0});
  approx(a.damage.droneDps/di0.damage.droneDps,1+0.1*level,`Drone Interfacing ${level}`);
 }
 const hull0=await analyze('Ishtar',droneItems,{...droneBaseLevels,[id('Drone Interfacing')]:0,[id('Gallente Cruiser')]:0});
 for(let level=0;level<=5;level++){
  const a=await analyze('Ishtar',droneItems,{...droneBaseLevels,[id('Drone Interfacing')]:0,[id('Gallente Cruiser')]:level});
  approx(a.damage.droneDps/hull0.damage.droneDps,1+0.1*level,`Gallente Cruiser Ishtar drone bonus ${level}`);
 }

 const blaster=[{typeId:id('Light Neutron Blaster II'),rack:'high',quantity:1,state:'active',chargeTypeId:id('Antimatter Charge S')}];
 const blaster0=await analyze('Merlin',blaster,{[id('Small Blaster Specialization')]:0});
 for(let level=0;level<=5;level++){
  const a=await analyze('Merlin',blaster,{[id('Small Blaster Specialization')]:level});
  approx(a.damage.weaponDps/blaster0.damage.weaponDps,1+0.02*level,`Small Blaster Specialization ${level}`,1e-12);
 }
 const launcher=[{typeId:id('Light Missile Launcher II'),rack:'high',quantity:1,state:'active',chargeTypeId:id('Scourge Light Missile')}];
 const missile0=await analyze('Caracal',launcher,{[id('Light Missile Specialization')]:0});
 for(let level=0;level<=5;level++){
  const a=await analyze('Caracal',launcher,{[id('Light Missile Specialization')]:level});
  approx(a.damage.weaponDps/missile0.damage.weaponDps,1/(1-0.02*level),`Light Missile Specialization ${level}`,1e-12);
 }

 // Generic charID ItemModifier regression: missile damage, drone range/count, targeting and stacking.
 const heavyLauncher={typeId:id('Heavy Missile Launcher II'),rack:'high',quantity:1,state:'active',chargeTypeId:id('Scourge Heavy Missile')};
 const heavyBare=await analyze('Caracal',[heavyLauncher]);
 approx(heavyBare.damage.weaponProfiles[0].cycleSeconds,12,'bare heavy missile cycle',1e-12);
 approx(heavyBare.damage.weaponProfiles[0].volley,149,'bare heavy missile volley',1e-12);
 const bcsOne=await analyze('Caracal',[heavyLauncher,{typeId:id('Ballistic Control System II'),rack:'low',quantity:1,state:'online'}]);
 approx(bcsOne.damage.weaponProfiles[0].cycleSeconds,10.74,'BCS II missile ROF',1e-12);
 approx(bcsOne.damage.weaponProfiles[0].volley,163.9,'BCS II charID missile damage',1e-12);
 const warheadRig=await analyze('Caracal',[heavyLauncher,{typeId:id('Medium Warhead Calefaction Catalyst I'),rack:'rig',quantity:1,state:'online'}]);
 approx(warheadRig.damage.weaponProfiles[0].volley,163.9,'Warhead Calefaction charID missile damage',1e-12);
 const bcsTwo=await analyze('Caracal',[heavyLauncher,{typeId:id('Ballistic Control System II'),rack:'low',quantity:2,state:'online'}]);
 approx(bcsTwo.damage.weaponProfiles[0].volley/heavyBare.damage.weaponProfiles[0].volley,1.1*(1+0.1*0.86911998),'BCS charID stacking penalty',1e-10);

 const ishtarRange0=await analyze('Ishtar',[],{[id('Heavy Assault Cruisers')]:0});
 const ishtarRange1=await analyze('Ishtar',[],{[id('Heavy Assault Cruisers')]:1});
 const ishtarRange5=await analyze('Ishtar',[],{[id('Heavy Assault Cruisers')]:5});
 approx(ishtarRange0.damage.droneControlDistanceM,20000,'Ishtar HAC 0 drone control range');
 approx(ishtarRange1.damage.droneControlDistanceM,25000,'Ishtar HAC 1 drone control range');
 approx(ishtarRange5.damage.droneControlDistanceM,45000,'Ishtar HAC 5 drone control range');
 const droneLink=await analyze('Ishtar',[{typeId:id('Drone Link Augmentor I'),rack:'high',quantity:1,state:'online'}],{[id('Heavy Assault Cruisers')]:0});
 approx(droneLink.damage.droneControlDistanceM,40000,'Drone Link Augmentor charID range');

 for(const [level,expected] of [[0,0],[1,1],[5,5]]){
  const tm=await analyze('Ishtar',[],{[id('Target Management')]:level});
  assert.equal(tm.targeting.maximumLockedTargets,expected,'Target Management '+level);
 }
 const targetHullCap=await analyze('Iteron Mark V',[],{[id('Target Management')]:5});
 assert.equal(targetHullCap.targeting.maximumLockedTargets,2,'hull targeting cap must limit character maximum');

 const fiveHammerheads=[{typeId:id('Hammerhead II'),rack:'drone',quantity:5,activeQuantity:5}];
 for(const [level,expected] of [[0,0],[1,1],[5,5]]){
  const dr=await analyze('Ishtar',fiveHammerheads,{[id('Drones')]:level});
  assert.equal(dr.damage.activeDrones.length,expected,'Drones active-count skill '+level);
 }
 const guardian=await analyze('Guardian-Vexor',[{typeId:id('Hammerhead II'),rack:'drone',quantity:10,activeQuantity:10}],{[id('Drones')]:5,[id('Gallente Cruiser')]:5});
 assert.equal(guardian.damage.activeDrones.length,10,'Guardian-Vexor scaled charID drone allowance');
 assert.equal(guardian.issues.some(x=>x.code==='active-drone-count'),false,'Guardian-Vexor legal ten-drone allowance must not be rejected');

 // Offline -> online -> active -> overloaded state gating.
 const prop=(state)=>analyze('Ishtar',[{typeId:id('10MN Y-S8 Compact Afterburner'),rack:'mid',quantity:1,state}],{[id('Navigation')]:5});
 const off=await prop('offline'), online=await prop('online'), active=await prop('active'), hot=await prop('overheated');
 approx(off.resources.used.cpu,0,'offline prop CPU'); approx(off.resources.used.powergrid,0,'offline prop PG');
 assert.ok(online.resources.used.cpu>0&&online.resources.used.powergrid>0,'online prop must consume fitting resources');
 approx(online.navigation.maximumVelocity,online.navigation.baseMaximumVelocity,'online prop must not propel');
 assert.ok(active.navigation.maximumVelocity>active.navigation.baseMaximumVelocity,'active prop speed missing');
 assert.ok(hot.navigation.maximumVelocity>active.navigation.maximumVelocity,'overheated prop bonus missing');
 assert.ok(active.capacitor.demandGjPerSecond>online.capacitor.demandGjPerSecond,'active prop capacitor cost missing');

 const hard=(state)=>analyze('Ishtar',[{typeId:id('Pithum C-Type Multispectrum Shield Hardener'),rack:'mid',quantity:1,state}]);
 const hardOnline=await hard('online'),hardActive=await hard('active'),hardHot=await hard('overheated');
 assert.ok(hardActive.defence.totalEhp>hardOnline.defence.totalEhp,'active hardener effect missing');
 assert.ok(hardHot.defence.totalEhp>hardActive.defence.totalEhp,'overheated hardener effect missing');

 // Charges and scripts: no ammo, ammo, unscripted, script swap, script removal.
 const rail=(script)=>analyze('Caracal',[{typeId:id('250mm Railgun II'),rack:'high',quantity:1,state:'active',chargeTypeId:id('Antimatter Charge M')},{typeId:id('Tracking Computer II'),rack:'mid',quantity:1,state:'active',...(script?{chargeTypeId:id(script)}:{})}]);
 const noAmmo=await analyze('Caracal',[{typeId:id('250mm Railgun II'),rack:'high',quantity:1,state:'active'}]);
 const unscripted=await rail(null),optimal=await rail('Optimal Range Script'),tracking=await rail('Tracking Speed Script'),unscriptedAgain=await rail(null);
 assert.equal(noAmmo.damage.weaponDps,0,'turret without charge must not produce DPS');
 assert.ok(unscripted.damage.weaponDps>0,'loaded turret DPS missing');
 assert.ok(optimal.damage.weaponProfiles[0].optimalM>tracking.damage.weaponProfiles[0].optimalM,'Optimal Range Script domain wrong');
 assert.ok(tracking.damage.weaponProfiles[0].tracking>optimal.damage.weaponProfiles[0].tracking,'Tracking Speed Script domain wrong');
 assert.deepEqual(unscriptedAgain.damage.weaponProfiles[0],unscripted.damage.weaponProfiles[0],'script removal must restore unscripted weapon attributes');
 assert.equal((await dogma.checkFittingChargeCompatibilityLocal(id('Tracking Computer II'),id('Optimal Range Script'))).compatible,true);
 assert.equal((await dogma.checkFittingChargeCompatibilityLocal(id('Tracking Computer II'),id('Tracking Speed Script'))).compatible,true);

 // Implants: fitting, capacitor, weapon CPU. Ratios are encoded by CCP implant DOGMA values.
 const pgBase=await analyze('Ishtar',[],{[id('Power Grid Management')]:5});
 const pgImplant=await analyze('Ishtar',[],{[id('Power Grid Management')]:5},{implantTypeIds:[id("Inherent Implants 'Squire' Power Grid Management EG-603")]});
 approx(pgImplant.resources.capacity.powergrid/pgBase.resources.capacity.powergrid,1.03,'EG-603 PG implant',1e-12);
 const capBase=await analyze('Ishtar',[],{[id('Capacitor Management')]:5});
 const capImplant=await analyze('Ishtar',[],{[id('Capacitor Management')]:5},{implantTypeIds:[id("Inherent Implants 'Squire' Capacitor Management EM-803")]});
 approx(capImplant.capacitor.capacityGj/capBase.capacitor.capacityGj,1.03,'EM-803 capacitor implant',1e-12);
 const weaponCpuBase=await analyze('Merlin',blaster,{});
 const weaponCpuImplant=await analyze('Merlin',blaster,{}, {implantTypeIds:[id("Zainou 'Gnome' Weapon Upgrades WU-1003")]});
 approx(weaponCpuImplant.resources.used.cpu/weaponCpuBase.resources.used.cpu,0.97,'WU-1003 weapon CPU implant',1e-12);

 // Fitting legality: CPU/PG, slots/hardpoints, calibration, drone bandwidth/bay.
 const overloaded=await analyze('Ishtar',[{typeId:id('X-Large Shield Booster II'),rack:'mid',quantity:4,state:'active'}]);
 assert.ok(overloaded.resources.used.cpu>overloaded.resources.capacity.cpu||overloaded.resources.used.powergrid>overloaded.resources.capacity.powergrid,'overload fixture is not overloaded');
 assert.ok(overloaded.issues.length>0,'CPU/PG overload must produce fitting issue');
 const turretOverflow=await analyze('Ishtar',[{typeId:id('Light Neutron Blaster II'),rack:'high',quantity:5,state:'active',chargeTypeId:id('Antimatter Charge S')}]);
 assert.ok(turretOverflow.issues.length>0,'slot/hardpoint overflow must be illegal');
 const calibration=await analyze('Dominix',[{typeId:id('Large Capacitor Control Circuit II'),rack:'rig',quantity:3,state:'online'}]);
 assert.ok(calibration.resources.used.calibration>calibration.resources.capacity.calibration,'calibration fixture did not exceed capacity');
 assert.ok(calibration.issues.length>0,'calibration overload must be illegal');
 const bandwidth=await analyze('Ishtar',[{typeId:id('Ogre II'),rack:'drone',quantity:6,activeQuantity:6}]);
 assert.ok(bandwidth.issues.some(x=>x.code==='active-drone-count'),'active drone count overflow issue missing');
 assert.ok(bandwidth.issues.some(x=>x.code==='active-drone-bandwidth'),'drone bandwidth overflow issue missing');
 const bay=await analyze('Ishtar',[{typeId:id('Ogre II'),rack:'drone',quantity:20,activeQuantity:5}]);
 assert.ok(bay.storage.droneBayUsedM3>bay.storage.droneBayCapacityM3,'drone bay fixture did not exceed capacity');
 assert.ok(bay.issues.length>0,'drone bay overflow issue missing');

 // Multiple T3 configurations and subsystem-skill scaling.
 const tenguCommon=['Tengu Core - Augmented Graviton Reactor','Tengu Defensive - Amplification Node','Tengu Propulsion - Chassis Optimization'];
 const t3items=offensive=>[...tenguCommon,offensive].map(name=>({typeId:id(name),rack:'subsystem',quantity:1,state:'online'}));
 const tenguMissile=await analyze('Tengu',t3items('Tengu Offensive - Accelerated Ejection Bay'));
 const tenguHybrid=await analyze('Tengu',t3items('Tengu Offensive - Magnetic Infusion Basin'));
 assert.ok(tenguMissile.fitting.hardpoints.launcher>tenguHybrid.fitting.hardpoints.launcher,'Tengu launcher subsystem hardpoint effect missing');
 assert.ok(tenguHybrid.fitting.hardpoints.turret>tenguMissile.fitting.hardpoints.turret,'Tengu hybrid subsystem hardpoint effect missing');
 assert.ok(tenguMissile.resources.capacity.cpu>0&&tenguMissile.resources.capacity.powergrid>0,'Tengu subsystem CPU/PG missing');
 const tenguWeaponItems=[...t3items('Tengu Offensive - Accelerated Ejection Bay'),{typeId:id('Light Missile Launcher II'),rack:'high',quantity:1,state:'active',chargeTypeId:id('Scourge Light Missile')}];
 const t0=await analyze('Tengu',tenguWeaponItems,{[id('Caldari Offensive Systems')]:0});
 const t5=await analyze('Tengu',tenguWeaponItems,{[id('Caldari Offensive Systems')]:5});
 assert.ok(t5.damage.weaponDps>t0.damage.weaponDps,'Tengu offensive subsystem skill scaling missing');
 const lokiCommon=['Loki Core - Augmented Nuclear Reactor','Loki Defensive - Adaptive Defense Node','Loki Propulsion - Wake Limiter'];
 const lokiItems=offensive=>[...lokiCommon,offensive].map(name=>({typeId:id(name),rack:'subsystem',quantity:1,state:'online'}));
 const lokiLauncher=await analyze('Loki',lokiItems('Loki Offensive - Launcher Efficiency Configuration'));
 const lokiProjectile=await analyze('Loki',lokiItems('Loki Offensive - Projectile Scoping Array'));
 assert.ok(lokiLauncher.fitting.hardpoints.launcher>lokiProjectile.fitting.hardpoints.launcher,'Loki launcher subsystem hardpoint effect missing');
 assert.ok(lokiProjectile.fitting.hardpoints.turret>lokiLauncher.fitting.hardpoints.turret,'Loki projectile subsystem hardpoint effect missing');

 console.log('DOGMA domain audit: PASS (0-5 skills, domain isolation, 4 module states, charges/scripts, fitting implants, legality, multi-T3)');
})().catch(e=>{console.error(e);process.exitCode=1});
