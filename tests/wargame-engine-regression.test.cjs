const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-wargame-engine-'));
try {
  const tsc = path.join(repo, 'node_modules', 'typescript', 'lib', 'tsc.js');
  const compile = spawnSync(process.execPath, [
    tsc,
    path.join(repo, 'src', 'wargame-command-model.ts'),
    path.join(repo, 'src', 'wargame-engine.ts'),
    '--ignoreConfig',
    '--module', 'Node16',
    '--moduleResolution', 'node16',
    '--target', 'ES2022',
    '--outDir', temp,
    '--skipLibCheck',
    '--esModuleInterop',
  ], { encoding:'utf8' });
  assert.equal(compile.status, 0, `Wargame engine test compile failed:\n${compile.stdout}\n${compile.stderr}`);
  const engine = require(path.join(temp, 'wargame-engine.js'));

  const blue = { id:'blue', side:'blue', x:10, y:10, ehp:1000, maxEhp:1000, count:10, shipsAlive:10, capacitorCapacity:100, capacitorCurrent:60 };
  const red = { id:'red', side:'red', x:14, y:10, ehp:1000, maxEhp:1000, count:10, shipsAlive:10 };
  assert.equal(engine.evaluateWargameCondition({kind:'range-below',targetId:'red',threshold:11}, blue, [blue,red], 0), true, '10 km range must satisfy < 11 km');
  assert.equal(engine.evaluateWargameCondition({kind:'range-below',targetId:'red',threshold:9}, blue, [blue,red], 0), false, '10 km range must not satisfy < 9 km');
  assert.equal(engine.evaluateWargameCondition({kind:'self-cap-below',threshold:61}, blue, [blue,red], 0), true, 'self capacitor condition must evaluate percentage');
  assert.equal(engine.evaluateWargameCondition({kind:'after-seconds',seconds:12}, blue, [blue,red], 11), false);
  assert.equal(engine.evaluateWargameCondition({kind:'after-seconds',seconds:12}, blue, [blue,red], 12), true);

  red.scrammed = true;
  const chain = [
    { id:'a', label:'A', trigger:'immediate', sourceTargets:{}, completion:'manual', branchWhen:{kind:'target-scrammed',targetId:'red'}, nextStepId:'caught', elseStepId:'escape' },
    { id:'escape', label:'Escape', trigger:'immediate', sourceTargets:{}, completion:'manual' },
    { id:'caught', label:'Caught', trigger:'immediate', sourceTargets:{}, completion:'manual' },
  ];
  assert.equal(engine.nextWargameOrderIndex(chain,0,blue,[blue,red],1),2,'true branch must jump to named step');
  red.scrammed = false;
  assert.equal(engine.nextWargameOrderIndex(chain,0,blue,[blue,red],1),1,'false branch must jump to else step');
  const oneSided = [{ ...chain[0], nextStepId:'caught', elseStepId:undefined }, chain[1], chain[2]];
  assert.equal(engine.nextWargameOrderIndex(oneSided,0,blue,[blue,red],1),1,'false branch with no ELSE destination must fall through to next step');

  assert.equal(engine.wargameSupportTargetSide('remoteShieldRep'),'friendly');
  assert.equal(engine.wargameSupportTargetSide('targetPainter'),'hostile');
  assert.equal(engine.wargameSupportTargetSide('commandBurst'),'none');
  assert.equal(engine.wargameSupportTargetAllowed(blue, red, 'web'), true);
  assert.equal(engine.wargameSupportTargetAllowed(blue, red, 'remoteShieldRep'), false);

  const lowDpsBlue = engine.prepareWargameUnit({ id:'low-blue', name:'Low DPS Blue', side:'blue', count:1, x:10, y:10, dps:250, ehp:50000, maxEhp:50000, speed:0, range:20, em:0, therm:0, kin:0, exp:0, role:'test', targetId:'low-red', weaponModel:'turret', signature:100, tracking:.05, stance:'hold' });
  const lowDpsRed = engine.prepareWargameUnit({ id:'low-red', name:'Low DPS Red', side:'red', count:1, x:90, y:90, dps:250, ehp:50000, maxEhp:50000, speed:0, range:20, em:0, therm:0, kin:0, exp:0, role:'test', targetId:'low-blue', weaponModel:'turret', signature:100, tracking:.05, stance:'hold' });
  const lowDpsResult = engine.advanceWargameSimulation([lowDpsBlue, lowDpsRed], { elapsedSeconds:0, seconds:1, redAiEnabled:false, rngSeed:12345 });
  assert.equal(lowDpsResult.combatResolved, false, 'living low-DPS forces must not auto-resolve merely because each side is below 1000 DPS');

  const unfittedNav = engine.prepareWargameUnit({ id:'unfitted-nav', name:'Unfitted hull', side:'blue', count:1, x:10, y:10, dps:0, ehp:10000, maxEhp:10000, speed:1000, baseSpeed:1000, range:0, em:0, therm:0, kin:0, exp:0, role:'FIT REQUIRED', simulationReady:false, movementOrder:'approach', destinationX:20, destinationY:10, stance:'hold' });
  const unfittedNavResult = engine.advanceWargameSimulation([unfittedNav], { elapsedSeconds:0, seconds:1, redAiEnabled:false, rngSeed:12345 });
  assert.ok(unfittedNavResult.units[0].x > 10, 'unfitted hull markers must still execute FC navigation using their bare-hull speed');
  assert.equal(unfittedNavResult.damageOccurred, false, 'unfitted hull markers must remain combat-inert while moving');

  const booster = {
    id:'booster', side:'blue', x:10, y:10, ehp:1000, maxEhp:1000, count:1, shipsAlive:1, name:'Claymore',
    supportSystems:[{ typeId:43556, name:'Skirmish Command Burst II', kind:'commandBurst', optimalM:30000, buffs:[
      {buffId:22,description:'Skirmish Burst: Rapid Deployment',value:12},
      {buffId:20,description:'Skirmish Burst: Evasive Maneuvers',value:-6},
    ]}],
  };
  const boosted = { ...blue, id:'boosted', x:18, y:10, name:'Hurricane' }; // 20 km
  const boost = engine.computeWargameCommandBurstModifiers(boosted,[booster,boosted]);
  assert.ok(Math.abs(boost.propulsionSpeedIncreaseMultiplier - 1.12) < 1e-9, 'Rapid Deployment should affect prop-speed increase');
  assert.ok(Math.abs(boost.signatureMultiplier - .94) < 1e-9, 'Evasive Maneuvers should reduce signature');
  assert.deepEqual(boost.sourceNames,['Claymore']);

  const far = { ...boosted, id:'far', x:30 };
  assert.equal(engine.computeWargameCommandBurstModifiers(far,[booster,far]).effects.length,0,'out-of-range formation must not receive burst');
  const hostile = { ...boosted, id:'hostile', side:'red' };
  assert.equal(engine.computeWargameCommandBurstModifiers(hostile,[booster,hostile]).effects.length,0,'hostile formation must not receive friendly burst');

  console.log('wargame engine regression: PASS');
} finally {
  fs.rmSync(temp, { recursive:true, force:true });
}
