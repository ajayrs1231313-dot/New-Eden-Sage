const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const dogma = require('../../dist-electron/fitting-dogma.js');

const SDE = 'F:/New Eden Sage Data/Static Data/eve-static-data-jsonl.zip';
const SEED = 0x5A6E2026;
const RUNS = 3;
const EPS = 1e-9;
const snapshot = (name, levels) => ({
  character: { name },
  skills: { total_sp: 0, skills: Object.entries(levels).map(([skill_id, trained_skill_level]) => ({ skill_id:Number(skill_id), trained_skill_level })) },
  extended: { implants: [] },
});
const approx = (actual, expected, label, epsilon = EPS) => {
  assert.ok(Number.isFinite(actual), `${label}: non-finite ${actual}`);
  assert.ok(Math.abs(actual - expected) <= epsilon, `${label}: ${actual} != ${expected}`);
};
function rng32(seed) {
  let x = seed >>> 0;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 0x100000000; };
}
const rng = rng32(SEED);
const pick = values => values[Math.floor(rng() * values.length)];
const shuffle = values => {
  const out = [...values];
  for (let i=out.length-1;i>0;i--) { const j=Math.floor(rng()*(i+1)); [out[i],out[j]]=[out[j],out[i]]; }
  return out;
};

const profiles = [
  {ship:'Tristan',size:'frigate',role:'drone/turret',weapon:['Light Neutron Blaster II','Antimatter Charge S'],prop:'1MN Afterburner II',tank:['Small Armor Repairer II','low','active'],damage:['Drone Damage Amplifier II','low'],rig:'Small Capacitor Control Circuit I',drone:['Hobgoblin II',5]},
  {ship:'Merlin',size:'frigate',role:'shield/turret',weapon:['Light Neutron Blaster II','Antimatter Charge S'],prop:'1MN Afterburner II',tank:['Medium Shield Extender II','mid','online'],damage:['Magnetic Field Stabilizer II','low'],rig:'Small Core Defense Field Extender I'},
  {ship:'Kestrel',size:'frigate',role:'shield/missile',weapon:['Light Missile Launcher II','Scourge Light Missile'],prop:'1MN Afterburner II',tank:['Medium Shield Extender II','mid','online'],damage:['Ballistic Control System II','low'],rig:'Small Capacitor Control Circuit I'},
  {ship:'Rifter',size:'frigate',role:'armor/projectile',weapon:['200mm AutoCannon II','Republic Fleet EMP S'],prop:'1MN Afterburner II',tank:['Small Armor Repairer II','low','active'],damage:['Gyrostabilizer II','low'],rig:'Small Capacitor Control Circuit I'},

  {ship:'Algos',size:'destroyer',role:'drone/turret',weapon:['Light Neutron Blaster II','Antimatter Charge S'],prop:'1MN Afterburner II',tank:['Medium Shield Extender II','mid','online'],damage:['Drone Damage Amplifier II','low'],rig:'Small Capacitor Control Circuit I',drone:['Hobgoblin II',5]},
  {ship:'Cormorant',size:'destroyer',role:'shield/turret',weapon:['Light Neutron Blaster II','Antimatter Charge S'],prop:'1MN Afterburner II',tank:['Medium Shield Extender II','mid','online'],damage:['Magnetic Field Stabilizer II','low'],rig:'Small Core Defense Field Extender I'},
  {ship:'Corax',size:'destroyer',role:'shield/missile',weapon:['Light Missile Launcher II','Scourge Light Missile'],prop:'1MN Afterburner II',tank:['Medium Shield Extender II','mid','online'],damage:['Ballistic Control System II','low'],rig:'Small Core Defense Field Extender I'},
  {ship:'Thrasher',size:'destroyer',role:'shield/projectile',weapon:['200mm AutoCannon II','Republic Fleet EMP S'],prop:'1MN Afterburner II',tank:['Medium Shield Extender II','mid','online'],damage:['Gyrostabilizer II','low'],rig:'Small Capacitor Control Circuit I'},

  {ship:'Vexor',size:'cruiser',role:'drone/armor',weapon:['Heavy Neutron Blaster II','Antimatter Charge M'],prop:'10MN Afterburner II',tank:['Medium Armor Repairer II','low','active'],damage:['Drone Damage Amplifier II','low'],rig:'Medium Capacitor Control Circuit I',drone:['Hammerhead II',5]},
  {ship:'Caracal',size:'cruiser',role:'shield/missile',weapon:['Heavy Missile Launcher II','Scourge Heavy Missile'],prop:'10MN Afterburner II',tank:['Large Shield Extender II','mid','online'],damage:['Ballistic Control System II','low'],rig:'Medium Core Defense Field Extender I'},
  {ship:'Thorax',size:'cruiser',role:'armor/turret',weapon:['Heavy Neutron Blaster II','Antimatter Charge M'],prop:'10MN Afterburner II',tank:['Medium Armor Repairer II','low','active'],damage:['Magnetic Field Stabilizer II','low'],rig:'Medium Capacitor Control Circuit I'},
  {ship:'Rupture',size:'cruiser',role:'shield/projectile',weapon:['425mm AutoCannon II','Republic Fleet EMP M'],prop:'10MN Afterburner II',tank:['Large Shield Extender II','mid','online'],damage:['Gyrostabilizer II','low'],rig:'Medium Capacitor Control Circuit I'},
  {ship:'Ishtar',size:'cruiser',role:'drone/shield',weapon:['200mm AutoCannon II','Republic Fleet EMP S'],prop:'10MN Afterburner II',tank:['Large Shield Extender II','mid','online'],damage:['Drone Damage Amplifier II','low'],rig:'Medium Capacitor Control Circuit I',drone:['Wasp II',5]},
  {ship:'Gila',size:'cruiser',role:'drone/missile/shield',weapon:['Heavy Missile Launcher II','Scourge Heavy Missile'],prop:'10MN Afterburner II',tank:['Large Shield Extender II','mid','online'],damage:['Drone Damage Amplifier II','low'],rig:'Medium Core Defense Field Extender I',drone:['Hammerhead II',2]},

  {ship:'Myrmidon',size:'battlecruiser',role:'drone/armor',weapon:['Heavy Neutron Blaster II','Antimatter Charge M'],prop:'10MN Afterburner II',tank:['Medium Armor Repairer II','low','active'],damage:['Drone Damage Amplifier II','low'],rig:'Medium Capacitor Control Circuit I',drone:['Hammerhead II',5]},
  {ship:'Drake',size:'battlecruiser',role:'shield/missile',weapon:['Heavy Missile Launcher II','Scourge Heavy Missile'],prop:'10MN Afterburner II',tank:['Large Shield Extender II','mid','online'],damage:['Ballistic Control System II','low'],rig:'Medium Core Defense Field Extender I'},
  {ship:'Hurricane',size:'battlecruiser',role:'projectile/armor',weapon:['425mm AutoCannon II','Republic Fleet EMP M'],prop:'10MN Afterburner II',tank:['Medium Armor Repairer II','low','active'],damage:['Gyrostabilizer II','low'],rig:'Medium Capacitor Control Circuit I'},
  {ship:'Ferox',size:'battlecruiser',role:'shield/turret',weapon:['250mm Railgun II','Antimatter Charge M'],prop:'10MN Afterburner II',tank:['Large Shield Extender II','mid','online'],damage:['Magnetic Field Stabilizer II','low'],rig:'Medium Core Defense Field Extender I'},

  {ship:'Dominix',size:'battleship',role:'drone/armor',weapon:['Neutron Blaster Cannon II','Antimatter Charge L'],prop:'100MN Afterburner II',tank:['Large Armor Repairer II','low','active'],damage:['Drone Damage Amplifier II','low'],rig:'Large Capacitor Control Circuit I',drone:['Ogre II',5]},
  {ship:'Raven',size:'battleship',role:'shield/missile',weapon:['Cruise Missile Launcher II','Scourge Cruise Missile'],prop:'100MN Afterburner II',tank:['X-Large Shield Booster II','mid','active'],damage:['Ballistic Control System II','low'],rig:'Large Capacitor Control Circuit I'},
  {ship:'Megathron',size:'battleship',role:'armor/turret',weapon:['Neutron Blaster Cannon II','Antimatter Charge L'],prop:'100MN Afterburner II',tank:['Large Armor Repairer II','low','active'],damage:['Magnetic Field Stabilizer II','low'],rig:'Large Capacitor Control Circuit I'},
  {ship:'Maelstrom',size:'battleship',role:'shield/projectile',weapon:['800mm Repeating Cannon II','Republic Fleet EMP L'],prop:'100MN Afterburner II',tank:['X-Large Shield Booster II','mid','active'],damage:['Gyrostabilizer II','low'],rig:'Large Capacitor Control Circuit I'},

  {ship:'Retriever',size:'mining',role:'mining/shield',weapon:['Strip Miner I',null],prop:null,tank:['Medium Shield Extender II','mid','online'],damage:['Mining Laser Upgrade II','low'],rig:'Medium Capacitor Control Circuit I',drone:['Hobgoblin II',5]},
  {ship:'Procurer',size:'mining',role:'mining/shield',weapon:['Strip Miner I',null],prop:null,tank:['Medium Shield Extender II','mid','online'],damage:['Mining Laser Upgrade II','low'],rig:'Medium Core Defense Field Extender I',drone:['Hobgoblin II',5]},
  {ship:'Iteron Mark V',size:'industrial',role:'hauler',weapon:null,prop:'10MN Afterburner II',tank:null,damage:['Expanded Cargohold II','low'],rig:'Medium Cargohold Optimization I'},
];

const quotas = {frigate:3,destroyer:3,cruiser:5,battlecruiser:4,battleship:3,mining:1,industrial:1};
const selected = Object.entries(quotas).flatMap(([size,count]) => shuffle(profiles.filter(p=>p.size===size)).slice(0,count));
assert.equal(selected.length,20);

function collectNames() {
  const names = new Set(['Navigation','Afterburner','Capacitor Management','Capacitor Systems Operation','CPU Management','Power Grid Management','Weapon Upgrades','Drone Interfacing']);
  for (const p of selected) {
    names.add(p.ship);
    if (p.weapon) { names.add(p.weapon[0]); if (p.weapon[1]) names.add(p.weapon[1]); }
    if (p.prop) names.add(p.prop);
    if (p.tank) names.add(p.tank[0]);
    if (p.damage) names.add(p.damage[0]);
    if (p.rig) names.add(p.rig);
    if (p.drone) names.add(p.drone[0]);
  }
  return [...names];
}
function buildItems(p, id) {
  const items=[];
  if (p.weapon) {
    const quantity = p.size==='battleship' ? 2 : (rng() < 0.45 ? 2 : 1);
    const weapon={typeId:id(p.weapon[0]),rack:'high',quantity,state:'active'};
    if (p.weapon[1]) weapon.chargeTypeId=id(p.weapon[1]);
    items.push(weapon);
  }
  if (p.prop) items.push({typeId:id(p.prop),rack:'mid',quantity:1,state:'active'});
  if (p.tank) items.push({typeId:id(p.tank[0]),rack:p.tank[1],quantity:1,state:p.tank[2]});
  if (p.damage) items.push({typeId:id(p.damage[0]),rack:p.damage[1],quantity:1,state:'online'});
  if (p.rig) items.push({typeId:id(p.rig),rack:'rig',quantity:1,state:'online'});
  if (p.drone) items.push({typeId:id(p.drone[0]),rack:'drone',quantity:p.drone[1],activeQuantity:p.drone[1]});
  return items;
}
const seriousCodes = new Set(['cpu-overload','powergrid-overload','calibration-overload','high-slots','mid-slots','low-slots','rig-slots','turret-hardpoints','launcher-hardpoints','drone-bandwidth','drone-bay-capacity','rig-size','module-size']);
function numericalView(a) {
  return {
    cpu:[a.resources.used.cpu,a.resources.capacity.cpu], pg:[a.resources.used.powergrid,a.resources.capacity.powergrid], calibration:[a.resources.used.calibration,a.resources.capacity.calibration],
    slots:a.fitting.slots, hardpoints:a.fitting.hardpoints,
    capacitor:[a.capacitor.capacityGj,a.capacitor.rechargeSeconds,a.capacitor.demandGjPerSecond,a.capacitor.deltaGjPerSecond,a.capacitor.stable,a.capacitor.stablePercent],
    hp:[a.defence.shieldHp,a.defence.armorHp,a.defence.structureHp], shieldResists:a.defence.shieldResists, armorResists:a.defence.armorResists, hullResists:a.defence.hullResists,
    ehp:a.defence.totalEhp, dps:[a.damage.weaponDps,a.damage.droneDps,a.damage.totalDps], speed:a.navigation.maximumVelocity,
    bandwidth:[a.storage.droneBandwidthUsed,a.storage.droneBandwidthCapacity], issues:a.issues.map(x=>x.code).sort(),
  };
}
function rawAttrs(typeDogma, typeId) {
  const row=typeDogma.get(typeId); assert.ok(row,`SDE missing typeDogma ${typeId}`);
  return new Map((row.dogmaAttributes||[]).map(x=>[x.attributeID,x.value]));
}

(async()=>{
  const resolved = await dogma.resolveFittingTypeNamesLocal(collectNames());
  const ids = new Map(resolved.map(x=>[x.name,x.id]));
  const missing = collectNames().filter(n=>!ids.has(n));
  assert.deepEqual(missing,[],`Missing SDE names: ${missing.join(', ')}`);
  const id = name => ids.get(name);

  const zip = new AdmZip(SDE);
  const typeDogma = new Map(zip.readAsText('typeDogma.jsonl').split(/\r?\n/).filter(Boolean).map(JSON.parse).map(x=>[x._key,x]));
  const coreSkillNames=['Navigation','Afterburner','Capacitor Management','Capacitor Systems Operation','CPU Management','Power Grid Management','Weapon Upgrades','Drone Interfacing'];
  const profileLevels={minimum:1,trained:4,elite:5};
  const rows=[];

  for (let index=0; index<selected.length; index++) {
    const p=selected[index]; const items=buildItems(p,id); const hull=id(p.ship);

    // Independent CCP SDE bare-hull checks: direct raw typeDogma -> Sage zero-skill/no-module result.
    const bare=await dogma.analyzeFittingDogma({hullTypeId:hull,items:[],snapshot:snapshot('SDE bare',{})});
    const raw=rawAttrs(typeDogma,hull); const rawv=(attr,def=0)=>raw.has(attr)?raw.get(attr):def;
    approx(bare.resources.capacity.cpu,rawv(48),`${p.ship} raw CPU`);
    approx(bare.resources.capacity.powergrid,rawv(11),`${p.ship} raw PG`);
    approx(bare.resources.capacity.calibration,rawv(1132),`${p.ship} raw calibration`);
    assert.deepEqual(bare.fitting.slots,{high:rawv(14),mid:rawv(13),low:rawv(12),rig:rawv(1137),subsystem:0},`${p.ship} raw slots`);
    assert.equal(bare.fitting.hardpoints.turret,rawv(102),`${p.ship} raw turret hardpoints`);
    assert.equal(bare.fitting.hardpoints.launcher,rawv(101),`${p.ship} raw launcher hardpoints`);
    approx(bare.capacitor.capacityGj,rawv(482),`${p.ship} raw capacitor`);
    approx(bare.capacitor.rechargeSeconds,rawv(55)/1000,`${p.ship} raw capacitor recharge`);
    approx(bare.defence.shieldHp,rawv(263),`${p.ship} raw shield HP`);
    approx(bare.defence.armorHp,rawv(265),`${p.ship} raw armor HP`);
    approx(bare.defence.structureHp,rawv(9),`${p.ship} raw structure HP`);
    approx(bare.navigation.baseMaximumVelocity,rawv(37),`${p.ship} raw velocity`);
    approx(bare.storage.droneBayCapacityM3,rawv(283),`${p.ship} raw drone bay`);
    approx(bare.storage.droneBandwidthCapacity,rawv(1271),`${p.ship} raw drone bandwidth`);
    approx(bare.targeting.signatureRadiusM,rawv(552,100),`${p.ship} raw signature radius`);
    const expectedShield=[271,274,273,272].map(a=>1-rawv(a,1));
    const expectedArmor=[267,270,269,268].map(a=>1-rawv(a,1));
    const expectedHull=[113,110,109,111].map(a=>1-rawv(a,1));
    expectedShield.forEach((v,i)=>approx(bare.defence.shieldResists[i],v,`${p.ship} raw shield resist ${i}`));
    expectedArmor.forEach((v,i)=>approx(bare.defence.armorResists[i],v,`${p.ship} raw armor resist ${i}`));
    expectedHull.forEach((v,i)=>approx(bare.defence.hullResists[i],v,`${p.ship} raw hull resist ${i}`));

    // Resolve the fit's own required skills, then test it with one of three deterministic character profiles.
    const requirementProbe=await dogma.analyzeFittingDogma({hullTypeId:hull,items,snapshot:snapshot('requirements',{})});
    const profileName=['minimum','trained','elite'][index%3];
    const levels={};
    for (const req of requirementProbe.requirements) for (const s of req.skills||[]) levels[s.skillId]=Math.max(levels[s.skillId]||0, profileName==='minimum'?s.requiredLevel:profileName==='trained'?Math.max(s.requiredLevel,4):5);
    for (const skillName of coreSkillNames) levels[id(skillName)]=Math.max(levels[id(skillName)]||0,profileLevels[profileName]);
    const snap=snapshot(`${profileName}-${index+1}`,levels);

    let reference=null;
    for(let run=0;run<RUNS;run++) {
      const analysis=await dogma.analyzeFittingDogma({hullTypeId:hull,items,snapshot:snap});
      assert.equal(analysis.missingRequirements.length,0,`${p.ship}: character cannot use deterministic fit`);
      const severe=analysis.issues.filter(x=>seriousCodes.has(x.code));
      assert.deepEqual(severe,[],`${p.ship}: illegal fit issues ${JSON.stringify(analysis.issues)}`);
      assert.ok(analysis.resources.used.cpu<=analysis.resources.capacity.cpu+EPS,`${p.ship}: CPU overload`);
      assert.ok(analysis.resources.used.powergrid<=analysis.resources.capacity.powergrid+EPS,`${p.ship}: PG overload`);
      assert.ok(analysis.resources.used.calibration<=analysis.resources.capacity.calibration+EPS,`${p.ship}: calibration overload`);
      assert.ok(Number.isFinite(analysis.defence.totalEhp)&&analysis.defence.totalEhp>0,`${p.ship}: invalid EHP`);
      assert.ok(Number.isFinite(analysis.capacitor.capacityGj)&&analysis.capacitor.capacityGj>0,`${p.ship}: invalid capacitor`);
      assert.ok(Number.isFinite(analysis.navigation.maximumVelocity)&&analysis.navigation.maximumVelocity>=0,`${p.ship}: invalid speed`);
      if (p.weapon && p.weapon[1]) assert.ok(analysis.damage.weaponDps>0,`${p.ship}: charged weapon has no DPS`);
      if (p.drone) assert.ok(analysis.damage.droneDps>0,`${p.ship}: active drones have no DPS`);
      const view=numericalView(analysis);
      if(run===0) reference=view; else assert.deepEqual(view,reference,`${p.ship}: nondeterministic numerical result run ${run+1}`);
    }
    rows.push({n:index+1,ship:p.ship,class:p.size,role:p.role,profile:profileName,items:items.length,cpu:`${reference.cpu[0].toFixed(2)}/${reference.cpu[1].toFixed(2)}`,pg:`${reference.pg[0].toFixed(2)}/${reference.pg[1].toFixed(2)}`,cal:`${reference.calibration[0].toFixed(0)}/${reference.calibration[1].toFixed(0)}`,cap:`${reference.capacitor[0].toFixed(1)} GJ / ${reference.capacitor[1].toFixed(1)}s`,ehp:reference.ehp.toFixed(1),weaponDps:reference.dps[0].toFixed(2),droneDps:reference.dps[1].toFixed(2),speed:reference.speed.toFixed(1),issues:reference.issues.join(',')||'-'});
  }
  console.table(rows);
  console.log(`deterministic 20-fit numerical smoke: PASS (${selected.length} stratified-random ships, seed 0x${SEED.toString(16)}, ${RUNS} identical runs each, raw CCP SDE hull cross-checks)`);
})().catch(error=>{console.error(error);process.exitCode=1;});
