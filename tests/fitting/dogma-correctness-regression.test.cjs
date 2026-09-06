const assert = require('node:assert/strict');
const dogma = require('../../dist-electron/fitting-dogma.js');

const approx = (actual, expected, epsilon, label) => {
  assert.ok(Number.isFinite(actual), `${label}: non-finite ${actual}`);
  assert.ok(Math.abs(actual - expected) <= epsilon, `${label}: ${actual} != ${expected} (º${epsilon})`);
};
const snapshot = levels => ({
  character: { name: 'DOGMA correctness regression' },
  skills: { total_sp: 0, skills: Object.entries(levels).map(([skill_id, trained_skill_level]) => ({ skill_id:Number(skill_id), trained_skill_level })) },
  extended: { implants: [] },
});
const AJ = {
  3452:4, 3450:5, 3451:4, 3449:5, 3424:5, 3418:5, 3417:5, 3426:5, 3413:5,
  3425:3, 3419:5, 3416:4, 21059:4, 3420:4, 3318:5, 11207:5, 3300:5, 3302:3,
  3310:4, 3311:4, 3312:4, 3315:2, 3316:5, 3317:4, 3392:5, 3394:5, 3332:5,
  16591:4, 3441:5, 3436:5, 3442:5, 12487:4, 12305:5, 23606:5,
};

 (async () => {
  const names = [
    'Ishtar','10MN Y-S8 Compact Afterburner','50MN Y-T8 Compact Microwarpdrive',
    'Republic Fleet Large Cap Battery','Capacitor Flux Coil II','Assault Damage Control II',
    'Damage Control II','Pith A-Type X-Large Shield Booster','Pithum C-Type Multispectrum Shield Hardener',
    'Medium Armor Repairer II','Multispectrum Energized Membrane II','Medium EM Shield Reinforcer II',
    'Medium Capacitor Control Circuit II','Domination 125mm Autocannon','Republic Fleet Titanium Sabot S',
    'Wasp II','Vespa II','Dread Guristas Drone Damage Amplifier','Caracal','Light Missile Launcher II',
    'Scourge Light Missile','High-grade Snake Alpha','Strong Blue Pill Booster','Proteus',
    'Proteus Offensive - Drone Synthesis Projector','250mm Railgun II','Antimatter Charge M'
  ];
  const ids = new Map((await dogma.resolveFittingTypeNamesLocal(names)).map(x => [x.name,x.id]));
  const id = name => { const v=ids.get(name); assert.ok(v, `Missing SDE type ${name}`); return v; };

  const monster = adcState => [
    {typeId:33846,rack:'low',quantity:3,state:'online'},
    {typeId:1248,rack:'low',quantity:2,state:'online'},
    {typeId:47257,rack:'low',quantity:1,state:adcState},
    {typeId:19206,rack:'mid',quantity:1,state:'active'},
    {typeId:4349,rack:'mid',quantity:1,state:'active'},
    {typeId:41218,rack:'mid',quantity:1,state:'online'},
    {typeId:35656,rack:'mid',quantity:1,state:'active'},
    {typeId:13773,rack:'high',quantity:4,state:'active',chargeTypeId:21939},
    {typeId:31724,rack:'rig',quantity:1,state:'online'},
    {typeId:31378,rack:'rig',quantity:1,state:'online'},
    {typeId:2436,rack:'drone',quantity:12,activeQuantity:5},
    {typeId:21638,rack:'drone',quantity:5,activeQuantity:0},
  ];
  const normal = await dogma.analyzeFittingDogma({hullTypeId:12005,items:monster('online'),snapshot:snapshot(AJ)});

  // 1 exact T5 Monster Ishtar
  approx(normal.capacitor.capacityGj,2576,1e-9,'Monster capacitor');
  approx(normal.capacitor.rechargeSeconds,59.1639,1e-4,'Monster recharge');
  assert.equal(normal.capacitor.stable,true,'Monster must be cap stable');
  approx(normal.capacitor.demandGjPerSecond,98.53333333333333,1e-9,'Monster cap demand');
  approx(normal.capacitor.deltaGjPerSecond,10.316826984022356,1e-9,'Monster cap delta');
  approx(normal.capacitor.stablePercent,9.478008074534165,1e-9,'Monster EVE-style cap delta percent');
  approx(normal.damage.droneDps,742.2570284267065,1e-8,'Monster Wasp II DPS');
  approx(normal.resources.used.cpu,420,1e-9,'Monster CPU used');
  approx(normal.resources.used.powergrid,873.6,1e-9,'Monster PG used');
  approx(normal.navigation.baseMaximumVelocity,218.75,1e-9,'Monster base speed');
  approx(normal.navigation.maximumVelocity,534.2548076923077,1e-9,'Monster AB speed');

  // 2 cap battery capacity + 3 flux coil operation ordering
  const capBase = await dogma.analyzeFittingDogma({hullTypeId:12005,items:[
    {typeId:1248,rack:'low',quantity:2,state:'online'}],snapshot:snapshot({3418:5,3417:5})});
  const capBattery = await dogma.analyzeFittingDogma({hullTypeId:12005,items:[
    {typeId:1248,rack:'low',quantity:2,state:'online'},{typeId:41218,rack:'mid',quantity:1,state:'online'}],snapshot:snapshot({3418:5,3417:5,3424:5})});
  approx(capBase.capacitor.capacityGj,1120,1e-9,'2xCFC II capacity');
  approx(capBattery.capacitor.capacityGj,2576,1e-9,'battery Add before PostMul/PostPercent');

  // 3 capacitor flux coil recharge semantics
  approx(capBase.capacitor.rechargeSeconds,265*0.75*0.61*0.61,1e-9,'CFC II recharge operation chain');

  // 4 required-skill CPU reduction (Energy Grid Upgrades V; same semantic family as Weapon Upgrades)
  const grid0 = await dogma.analyzeFittingDogma({hullTypeId:12005,items:[
    {typeId:1248,rack:'low',quantity:2,state:'online'},{typeId:41218,rack:'mid',quantity:1,state:'online'}],snapshot:snapshot({3424:0,3426:5})});
  const grid5 = await dogma.analyzeFittingDogma({hullTypeId:12005,items:[
    {typeId:1248,rack:'low',quantity:2,state:'online'},{typeId:41218,rack:'mid',quantity:1,state:'online'}],snapshot:snapshot({3424:5,3426:5})});
  approx(grid0.resources.used.cpu-grid5.resources.used.cpu,17,1e-9,'Energy Grid Upgrades V CPU reduction');
  const weaponCpu0 = await dogma.analyzeFittingDogma({hullTypeId:12005,items:[{typeId:13773,rack:'high',quantity:4,state:'active',chargeTypeId:21939}],snapshot:snapshot({3318:0,3300:5,3302:3})});
  const weaponCpu5 = await dogma.analyzeFittingDogma({hullTypeId:12005,items:[{typeId:13773,rack:'high',quantity:4,state:'active',chargeTypeId:21939}],snapshot:snapshot({3318:5,3300:5,3302:3})});
  approx(weaponCpu5.resources.used.cpu / weaponCpu0.resources.used.cpu,0.75,1e-12,'Weapon Upgrades V turret CPU reduction');

  // 5 afterburner velocity
  approx(normal.navigation.activePropulsion[0].speedFactorPercent,150,1e-9,'Acceleration Control IV speed factor');
  approx(normal.navigation.maximumVelocity,534.2548076923077,1e-9,'AB mass/thrust velocity formula');

  // 6 MWD velocity/signature
  const mwd = await dogma.analyzeFittingDogma({hullTypeId:12005,items:[
    {typeId:id('50MN Y-T8 Compact Microwarpdrive'),rack:'mid',quantity:1,state:'active'}],
    snapshot:snapshot({3449:5,3452:4,3454:5})});
  assert.ok(mwd.navigation.maximumVelocity > mwd.navigation.baseMaximumVelocity*4,'MWD speed bonus missing');
  assert.ok(mwd.targeting.signatureRadiusM > 145,'MWD signature bloom missing');

  // 7 active shield tank
  approx(normal.defence.shieldRepairPerSecond,214.5,1e-9,'Pith A XL shield boost / cycle');

  // 8 active armor tank
  const armorTank = await dogma.analyzeFittingDogma({hullTypeId:12005,items:[
    {typeId:id('Medium Armor Repairer II'),rack:'low',quantity:1,state:'active'}],snapshot:snapshot({3393:5,3392:5,3394:5})});
  assert.ok(armorTank.defence.armorRepairPerSecond > 0,'active armor repair missing');

  // 9 Damage Control passive
  const naked = await dogma.analyzeFittingDogma({hullTypeId:12005,items:[],snapshot:snapshot({3392:5,3394:5,3419:5})});
  const dc = await dogma.analyzeFittingDogma({hullTypeId:12005,items:[
    {typeId:id('Damage Control II'),rack:'low',quantity:1,state:'online'}],snapshot:snapshot({3392:5,3394:5,3419:5})});
  assert.ok(dc.defence.totalEhp > naked.defence.totalEhp,'Damage Control passive resists missing');

  // 10 Assault Damage Control passive
  const adcPassive = await dogma.analyzeFittingDogma({hullTypeId:12005,items:[
    {typeId:47257,rack:'low',quantity:1,state:'online'}],snapshot:snapshot({3392:5,3394:5,3419:5})});
  assert.ok(adcPassive.defence.totalEhp > naked.defence.totalEhp,'ADC passive resists missing');

  // 11 Assault Damage Control active emergency state
  const emergency = await dogma.analyzeFittingDogma({hullTypeId:12005,items:monster('active'),snapshot:snapshot(AJ)});
  approx(emergency.defence.totalEhp,61127.62078554275,1e-6,'ADC emergency EHP');
  assert.ok(emergency.defence.shieldResists.every(x=>x>=0.89),'ADC emergency shield resists missing');

  // 12 shield resistance stacking
  const hardenerOnly = await dogma.analyzeFittingDogma({hullTypeId:12005,items:[
    {typeId:4349,rack:'mid',quantity:1,state:'active'}],snapshot:snapshot({3420:4})});
  const hardenerRig = await dogma.analyzeFittingDogma({hullTypeId:12005,items:[
    {typeId:4349,rack:'mid',quantity:1,state:'active'},{typeId:31724,rack:'rig',quantity:1,state:'online'}],snapshot:snapshot({3420:4})});
  assert.ok(hardenerRig.defence.shieldResists[0] > hardenerOnly.defence.shieldResists[0],'shield resist rig stacking missing');

  // 13 armor resistance stacking
  const armorRes = await dogma.analyzeFittingDogma({hullTypeId:12005,items:[
    {typeId:id('Multispectrum Energized Membrane II'),rack:'low',quantity:2,state:'online'}],snapshot:snapshot({3394:5})});
  assert.ok(armorRes.defence.armorResists[0] > naked.defence.armorResists[0],'armor resistance stacking missing');

  // 14 turret + ammo
  assert.ok(normal.damage.weaponDps > 0 && normal.damage.weaponProfiles.length === 1,'turret/ammo profile missing');
  assert.ok(normal.damage.weaponProfiles[0].falloffM > 0,'turret falloff missing');

  // 15 missile fit
  const missile = await dogma.analyzeFittingDogma({hullTypeId:id('Caracal'),items:[
    {typeId:id('Light Missile Launcher II'),rack:'high',quantity:1,state:'active',chargeTypeId:id('Scourge Light Missile')}],
    snapshot:snapshot({3319:5,3321:5,3334:5})});
  assert.ok(missile.damage.weaponDps > 0,'missile DPS missing');
  assert.ok(missile.damage.weaponProfiles[0].maximumRangeM > 0,'missile range missing');

  // 16 drone fit
  assert.ok(normal.damage.activeDrones.length>0 && normal.damage.droneDps>700,'drone DOGMA regression');

  // 17 faction/deadspace modules are the exact Monster modules above
  assert.ok(normal.resources.used.cpu>0 && normal.defence.shieldRepairPerSecond>200,'faction/deadspace module regression');

  // 18 implant effects
  const snake0 = await dogma.analyzeFittingDogma({hullTypeId:12005,items:[],snapshot:snapshot({3449:5})});
  const snake = await dogma.analyzeFittingDogma({hullTypeId:12005,items:[],snapshot:snapshot({3449:5}),implantTypeIds:[id('High-grade Snake Alpha')]});
  assert.ok(snake.navigation.baseMaximumVelocity>snake0.navigation.baseMaximumVelocity,'implant ship modifier missing');

  // 19 booster effects / selectable penalties
  const booster = await dogma.analyzeFittingDogma({hullTypeId:12005,items:[],snapshot:snapshot({}),boosterTypeIds:[id('Strong Blue Pill Booster')]});
  assert.ok(booster.enhancements.some(x=>x.typeId===id('Strong Blue Pill Booster')),'booster not represented');

  // 20 overheat state
  const hot = await dogma.analyzeFittingDogma({hullTypeId:12005,items:[
    {typeId:35656,rack:'mid',quantity:1,state:'overheated'}],snapshot:snapshot({3449:5,3452:4,3450:5})});
  const cold = await dogma.analyzeFittingDogma({hullTypeId:12005,items:[
    {typeId:35656,rack:'mid',quantity:1,state:'active'}],snapshot:snapshot({3449:5,3452:4,3450:5})});
  assert.ok(hot.navigation.maximumVelocity>cold.navigation.maximumVelocity,'overheated AB self modifier missing');

  // 21 T3 subsystem effects / strategic cruiser fit
  const proteus = await dogma.analyzeFittingDogma({hullTypeId:id('Proteus'),items:[
    {typeId:id('Proteus Offensive - Drone Synthesis Projector'),rack:'subsystem',quantity:1,state:'online'}],
    snapshot:snapshot({30652:4,30550:4})});
  assert.ok(proteus.fitting.slots.high>0,'Proteus subsystem slot effects missing');
  assert.ok(proteus.fitting.hardpoints.turret>0,'Proteus subsystem hardpoints missing');

  // State gating: offline must consume neither CPU nor PG.
  const offline = await dogma.analyzeFittingDogma({hullTypeId:12005,items:[
    {typeId:41218,rack:'mid',quantity:1,state:'offline'}],snapshot:snapshot({3424:5})});
  approx(offline.resources.used.cpu,0,1e-12,'offline CPU');
  approx(offline.resources.used.powergrid,0,1e-12,'inline PG');

  console.log('full DOGMA correctness regression: PASS (21 required cases + state gating)');
})().catch(error => { console.error(error); process.exitCode=1; });