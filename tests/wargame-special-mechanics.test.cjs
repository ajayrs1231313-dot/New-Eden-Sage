const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-wargame-special-'));
try {
  const tsc = path.join(repo, 'node_modules', 'typescript', 'lib', 'tsc.js');
  const compile = spawnSync(process.execPath, [
    tsc,
    path.join(repo, 'src', 'wargame-command-model.ts'),
    path.join(repo, 'src', 'wargame-types.ts'),
    path.join(repo, 'src', 'wargame-engine.ts'),
    '--ignoreConfig', '--module', 'Node16', '--moduleResolution', 'node16', '--target', 'ES2022', '--outDir', temp, '--skipLibCheck', '--esModuleInterop',
  ], { encoding:'utf8' });
  assert.equal(compile.status,0,`Wargame special-mechanics compile failed:\n${compile.stdout}\n${compile.stderr}`);
  const engine = require(path.join(temp,'wargame-engine.js'));

  const baseUnit = (id,side,x,extra={}) => ({
    id,name:id,side,count:1,x,y:10,dps:0,ehp:10000,maxEhp:10000,speed:0,range:100,
    em:1,therm:0,kin:0,exp:0,role:'test',signature:400,tracking:100,stance:'hold',simulationReady:true,targetingRange:200,targetSwitchDelay:0,
    ...extra,
  });
  const step = (units,elapsed=0) => engine.advanceWargameSimulation(units,{elapsedSeconds:elapsed,seconds:1,redAiEnabled:false,rngSeed:12345}).units;
  const approx = (actual,expected,message) => assert.ok(Math.abs(actual-expected)<1e-9, message ?? `${actual} != ${expected}`);
  const sourceOf = (units,id='gun') => units.find((unit)=>unit.id==='attacker').damageSources.find((source)=>source.id===id);
  const targetHp = (units,id) => units.find((unit)=>unit.id===id).primaryEhp;

  // Weapon magazines consume actual loaded cycles and stop firing for reload downtime.
  let units=[
    baseUnit('attacker','blue',10,{damageSources:[{id:'gun',name:'magazine gun',kind:'turret',dpsPerShip:100,volleyPerShip:100,cycleSeconds:1,maxRangeKm:100,optimalKm:100,falloffKm:1,tracking:100,signatureResolutionM:40,damageProfile:{em:1,thermal:0,kinetic:0,explosive:0},targetId:'target',magazineCycles:2,loadedCyclesRemaining:2,reloadSeconds:3}]}),
    baseUnit('target','red',11),
  ];
  units=step(units,0); assert.equal(targetHp(units,'target'),9900); assert.equal(sourceOf(units).loadedCyclesRemaining,1);
  units=step(units,1); assert.equal(targetHp(units,'target'),9800); assert.equal(sourceOf(units).loadedCyclesRemaining,0); assert.ok(sourceOf(units).reloadRemaining>0);
  units=step(units,2); assert.equal(targetHp(units,'target'),9800,'weapon must not deal paper DPS during reload');
  units=step(units,3); assert.equal(targetHp(units,'target'),9800,'weapon reload downtime must persist');
  units=step(units,4); assert.equal(targetHp(units,'target'),9800,'weapon reload downtime must cover the full configured duration');
  units=step(units,5); assert.equal(targetHp(units,'target'),9700,'weapon must resume only after magazine reload completes');

  // Entropic-style spool rises each consecutive cycle and resets on target swap.
  units=[
    baseUnit('attacker','blue',10,{damageSources:[{id:'gun',name:'entropic',kind:'turret',dpsPerShip:100,volleyPerShip:100,cycleSeconds:1,maxRangeKm:100,optimalKm:100,falloffKm:1,tracking:100,signatureResolutionM:40,damageProfile:{em:1,thermal:0,kinetic:0,explosive:0},targetId:'target',rampPerCycle:.1,maxRampMultiplier:1.3,spoolCycles:0}]}),
    baseUnit('target','red',11), baseUnit('target2','red',12),
  ];
  units=step(units,0); assert.equal(sourceOf(units).lastVolleyDamage,100); assert.equal(sourceOf(units).spoolCycles,1);
  units=step(units,1); approx(sourceOf(units).lastVolleyDamage,110); assert.equal(sourceOf(units).spoolCycles,2);
  units=step(units,2); approx(sourceOf(units).lastVolleyDamage,120); assert.equal(sourceOf(units).spoolCycles,3);
  sourceOf(units).targetId='target2';
  units=step(units,3); approx(sourceOf(units).lastVolleyDamage,100,'spool must reset on target swap'); assert.equal(sourceOf(units).spoolCycles,1);

  // Multiple ramping guns maintain independent cycle/spool state.
  units=[
    baseUnit('attacker','blue',10,{damageSources:['a','b'].map((id)=>({id,name:id,kind:'turret',dpsPerShip:100,volleyPerShip:100,cycleSeconds:1,maxRangeKm:100,optimalKm:100,falloffKm:1,tracking:100,signatureResolutionM:40,damageProfile:{em:1,thermal:0,kinetic:0,explosive:0},targetId:'target',rampPerCycle:.1,maxRampMultiplier:1.3,spoolCycles:0}))}),
    baseUnit('target','red',11),
  ];
  units=step(step(units,0),1);
  const rampSources=units.find((unit)=>unit.id==='attacker').damageSources;
  assert.deepEqual(rampSources.map((source)=>source.spoolCycles),[2,2]);
  rampSources.forEach((source)=>approx(source.lastVolleyDamage,110));

  // Smartbomb/AoE pulses hit every eligible object in radius, including friendlies when enabled.
  units=[
    baseUnit('attacker','blue',10,{damageSources:[{id:'aoe',name:'smartbomb',kind:'aoe',dpsPerShip:10,volleyPerShip:100,cycleSeconds:10,maxRangeKm:6,radiusKm:6,friendlyFireEligible:true,damageProfile:{em:1,thermal:0,kinetic:0,explosive:0}}]}),
    baseUnit('ally','blue',11), baseUnit('near-enemy','red',12), baseUnit('far-enemy','red',13),
  ];
  units=step(units,0);
  assert.equal(targetHp(units,'ally'),9900,'AoE friendly-fire eligible pulse must hit friendly object in radius');
  assert.equal(targetHp(units,'near-enemy'),9900,'AoE pulse must hit hostile object in radius');
  assert.equal(targetHp(units,'far-enemy'),10000,'AoE pulse must not hit object outside radius');

  // Ancillary remote reps consume loaded cycles and honor reload downtime.
  const ancillary={typeId:9000,name:'ancillary remote rep',groupId:1698,quantity:1,kind:'remoteArmorRep',cycleSeconds:1,optimalM:100000,falloffM:0,amountPerCycle:100,baseAmountPerCycle:100,ancillary:true,charged:true,loadedCyclesRemaining:1,magazineCycles:1,reloadSeconds:2,reloadRemaining:0};
  const originalAncillary={...ancillary};
  units=[
    baseUnit('logi','blue',10,{repLockTime:0,supportSystems:[ancillary]}),
    baseUnit('ally','blue',11,{ehp:500,maxEhp:1000,primaryEhp:500}),
    baseUnit('enemy','red',20),
  ];
  units=step(units,0); assert.equal(targetHp(units,'ally'),600); let sys=units.find((unit)=>unit.id==='logi').supportSystems[0]; assert.equal(sys.loadedCyclesRemaining,0); assert.ok(sys.reloadRemaining>0);
  units=step(units,1); assert.equal(targetHp(units,'ally'),600,'remote ancillary rep must stop during reload');
  units=step(units,2); assert.equal(targetHp(units,'ally'),600,'remote ancillary reload must consume the configured downtime');
  units=step(units,3); assert.equal(targetHp(units,'ally'),700,'remote ancillary rep must resume after reload');
  assert.deepEqual(ancillary,originalAncillary,'simulation must not mutate caller-owned support-system state');

  // Mutadaptive remote reps spool on the same target and reset when reassigned.
  const mutadaptive={typeId:9001,name:'mutadaptive remote rep',groupId:2018,quantity:1,kind:'remoteArmorRep',cycleSeconds:1,optimalM:100000,falloffM:0,amountPerCycle:100,perSecond:100,mutadaptive:true,rampPerCycle:.1,maxMultiplier:1.3,spoolCycles:0};
  const key='remoteArmorRep:9001:0';
  units=[
    baseUnit('logi','blue',10,{repLockTime:0,supportSystems:[mutadaptive],supportTargetIds:{[key]:'ally'}}),
    baseUnit('ally','blue',11,{ehp:500,maxEhp:1000,primaryEhp:500}),
    baseUnit('ally2','blue',12,{ehp:500,maxEhp:1000,primaryEhp:500}),
    baseUnit('enemy','red',20),
  ];
  units=step(units,0); assert.equal(targetHp(units,'ally'),600); sys=units.find((unit)=>unit.id==='logi').supportSystems[0]; assert.equal(sys.spoolCycles,1);
  units=step(units,1); assert.equal(targetHp(units,'ally'),710); sys=units.find((unit)=>unit.id==='logi').supportSystems[0]; assert.equal(sys.spoolCycles,2);
  units.find((unit)=>unit.id==='logi').supportTargetIds[key]='ally2';
  units=step(units,2); assert.equal(targetHp(units,'ally2'),600,'mutadaptive rep must reset to base amount on target swap'); sys=units.find((unit)=>unit.id==='logi').supportSystems[0]; assert.equal(sys.spoolCycles,1);

  console.log('wargame special mechanics regression: PASS');
} finally {
  fs.rmSync(temp,{recursive:true,force:true});
}
