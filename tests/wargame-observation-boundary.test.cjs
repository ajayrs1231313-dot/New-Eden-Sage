const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const repo = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-wargame-observation-'));
try {
  const tsc = path.join(repo, 'node_modules', 'typescript', 'lib', 'tsc.js');
  const compile = spawnSync(process.execPath, [
    tsc,
    path.join(repo, 'src', 'wargame-command-model.ts'),
    path.join(repo, 'src', 'wargame-types.ts'),
    path.join(repo, 'src', 'wargame-observation.ts'),
    '--ignoreConfig', '--module', 'Node16', '--moduleResolution', 'node16', '--target', 'ES2022', '--outDir', temp, '--skipLibCheck', '--esModuleInterop',
  ], { encoding:'utf8' });
  assert.equal(compile.status, 0, `Wargame observation test compile failed:\n${compile.stdout}\n${compile.stderr}`);
  const { getWargameObservation } = require(path.join(temp, 'wargame-observation.js'));
  const base = { count:1, shipsAlive:1, x:10, y:10, dps:100, ehp:1000, maxEhp:1000, speed:1000, range:50, em:60, therm:60, kin:60, exp:60, role:'mainline' };
  const red = { ...base, id:'red', name:'Red', side:'red', targetId:'blue', destinationX:90, destinationY:90, capacitorCapacity:1000, capacitorCurrent:123, fitText:'SECRET RED FIT', orderChain:[{id:'r1',label:'Secret red plan',trigger:'immediate',sourceTargets:{},completion:'manual'}] };
  const blue = { ...base, id:'blue', name:'Blue', side:'blue', targetId:'red', destinationX:1, destinationY:1, capacitorCapacity:1000, capacitorCurrent:321, fitText:'SECRET BLUE FIT', supportTargetIds:{web:'red'}, orderChain:[{id:'b1',label:'Secret blue plan',trigger:'immediate',sourceTargets:{},completion:'manual'}] };
  const redView = getWargameObservation('red',[red,blue]);
  const own = redView.find((unit)=>unit.id==='red');
  const enemy = redView.find((unit)=>unit.id==='blue');
  assert.equal(own.fitText,'SECRET RED FIT','own-side controller may receive its private state');
  assert.equal(own.orderChain[0].label,'Secret red plan');
  assert.equal(enemy.fitText,undefined,'enemy fit text must never cross observation boundary');
  assert.equal(enemy.orderChain,undefined,'enemy FC order chain must never cross observation boundary');
  assert.equal(enemy.destinationX,undefined,'enemy planned destination must remain hidden');
  assert.equal(enemy.targetId,undefined,'enemy target assignment must remain hidden');
  assert.equal(enemy.supportTargetIds,undefined,'enemy support assignments must remain hidden');
  assert.equal(enemy.capacitorCurrent,undefined,'exact enemy capacitor state must remain hidden');
  const hidden = getWargameObservation('red',[red,blue],{visibleEnemyIds:new Set()});
  assert.deepEqual(hidden.map((unit)=>unit.id),['red'],'visibility filter must be able to hide unobserved enemies completely');
  console.log('wargame observation boundary regression: PASS');
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
