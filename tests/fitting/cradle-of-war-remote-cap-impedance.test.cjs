const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dogma = require('../../dist-electron/fitting-dogma.js');

(async () => {
  const resolved = await dogma.resolveFittingTypeNamesLocal([
    'Revelation', 'Siege Module I', 'Apostle', 'Triage Module I',
  ]);
  const ids = new Map(resolved.map((row) => [row.name, row.id]));
  const id = (name) => {
    const value = ids.get(name);
    assert.ok(value, 'Missing SDE type: ' + name);
    return value;
  };
  const snapshot = { character:{name:'Cradle remote cap'}, skills:{skills:[]}, extended:{implants:[]} };

  const cold = await dogma.analyzeFittingDogma({
    hullTypeId:id('Revelation'), items:[], snapshot,
  });
  const sieged = await dogma.analyzeFittingDogma({
    hullTypeId:id('Revelation'),
    items:[{ typeId:id('Siege Module I'), rack:'high', quantity:1, state:'active' }],
    snapshot,
  });
  const triaged = await dogma.analyzeFittingDogma({
    hullTypeId:id('Apostle'),
    items:[{ typeId:id('Triage Module I'), rack:'high', quantity:1, state:'active' }],
    snapshot,
  });

  assert.equal(cold.capacitor.remoteCapacitorReceiveMultiplier, 1);
  assert.ok(sieged.capacitor.remoteCapacitorReceiveMultiplier < 0.00001);
  assert.ok(triaged.capacitor.remoteCapacitorReceiveMultiplier < 0.00001);

  const repo = path.join(__dirname, '..', '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-cradle-remotecap-'));
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
    assert.equal(compile.status, 0, `Wargame compile failed:\n${compile.stdout}\n${compile.stderr}`);
    const engine = require(path.join(temp, 'wargame-engine.js'));

    const support = {
      typeId: 12217,
      name: 'Remote Capacitor Transmitter',
      kind: 'remoteCapacitor',
      amountPerCycle: 100,
      perSecond: 100,
      cycleSeconds: 1,
      optimalM: 100000,
      quantity: 1,
      state: 'active',
    };
    const supportKey = engine.wargameSupportSystemKey(support, 0);
    const baseUnit = {
      count:1, shipsAlive:1, x:10, y:10, dps:0, ehp:1000, maxEhp:1000,
      speed:0, range:0, em:0, therm:0, kin:0, exp:0, role:'test',
      weaponModel:'support', signature:100, tracking:0, stance:'hold',
      simulationReady:true,
    };
    const donor = engine.prepareWargameUnit({
      ...baseUnit,
      id:'donor', name:'Cap donor', side:'blue',
      capacitorCapacity:1000, capacitorCurrent:1000,
      supportSystems:[support],
      supportTargetIds:{ [supportKey]:'target' },
    });
    const target = engine.prepareWargameUnit({
      ...baseUnit,
      id:'target', name:'Sieged target', side:'blue',
      x:11,
      capacitorCapacity:1000, capacitorCurrent:0,
      remoteCapacitorReceiveMultiplier:sieged.capacitor.remoteCapacitorReceiveMultiplier,
    });
    const normalTarget = engine.prepareWargameUnit({
      ...baseUnit,
      id:'normal-target', name:'Normal target', side:'blue',
      x:11,
      capacitorCapacity:1000, capacitorCurrent:0,
      remoteCapacitorReceiveMultiplier:1,
    });
    const donorNormal = engine.prepareWargameUnit({
      ...donor,
      id:'donor-normal',
      supportTargetIds:{ [supportKey]:'normal-target' },
      supportCooldowns:{},
    });

    const blockedResult = engine.advanceWargameSimulation([donor,target], { elapsedSeconds:0, seconds:1, redAiEnabled:false, rngSeed:99 });
    const normalResult = engine.advanceWargameSimulation([donorNormal,normalTarget], { elapsedSeconds:0, seconds:1, redAiEnabled:false, rngSeed:99 });
    const blocked = blockedResult.units.find((u) => u.id === 'target').capacitorCurrent;
    const normal = normalResult.units.find((u) => u.id === 'normal-target').capacitorCurrent;

    assert.ok(normal > 99.9, 'Normal target should receive the full 100 GJ transfer');
    assert.ok(blocked < 0.001, 'Sieged target should receive effectively zero remote capacitor');
    assert.ok(blocked < normal * 0.00001, 'Cradle impedance must materially suppress the Wargames transfer');

    console.log(JSON.stringify({
      coldReceiveMultiplier:cold.capacitor.remoteCapacitorReceiveMultiplier,
      siegeReceiveMultiplier:sieged.capacitor.remoteCapacitorReceiveMultiplier,
      triageReceiveMultiplier:triaged.capacitor.remoteCapacitorReceiveMultiplier,
      normalTransferResult:normal,
      siegedTransferResult:blocked,
    }, null, 2));
    console.log('CRADLE OF WAR REMOTE CAPACITOR IMPEDANCE: PASS');
  } finally {
    fs.rmSync(temp, { recursive:true, force:true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
