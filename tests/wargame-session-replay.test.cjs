const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-wargame-session-'));
try {
  const tsc = path.join(repo, 'node_modules', 'typescript', 'lib', 'tsc.js');
  const compile = spawnSync(process.execPath, [
    tsc,
    path.join(repo, 'src', 'wargame-command-model.ts'),
    path.join(repo, 'src', 'wargame-types.ts'),
    path.join(repo, 'src', 'wargame-red-team.ts'),
    path.join(repo, 'src', 'wargame-engine.ts'),
    path.join(repo, 'src', 'wargame-session.ts'),
    '--ignoreConfig',
    '--module', 'Node16',
    '--moduleResolution', 'node16',
    '--target', 'ES2022',
    '--outDir', temp,
    '--skipLibCheck',
    '--esModuleInterop',
  ], { encoding:'utf8' });
  assert.equal(compile.status, 0, `Wargame session test compile failed:\n${compile.stdout}\n${compile.stderr}`);
  const session = require(path.join(temp, 'wargame-session.js'));

  const unit = (id, side, x) => ({
    id,
    name:id,
    side,
    count:1,
    shipsAlive:1,
    x,
    y:50,
    dps:75,
    ehp:1500,
    maxEhp:1500,
    speed:0,
    range:50,
    em:60,
    therm:60,
    kin:60,
    exp:60,
    role:'mainline',
    weaponModel:'turret',
    optimalRange:30,
    falloffRange:20,
    tracking:1,
    signature:200,
    signatureResolution:125,
    weaponCycle:2,
    targetSwitchDelay:0,
    targetId: side === 'blue' ? 'red' : 'blue',
  });

  const initial = session.createWargameSession([unit('blue','blue',48), unit('red','red',52)]);
  const tenSecond = session.applyWargameCommand(initial, { id:'ten', kind:'advance', source:'human', seconds:10, redAiEnabled:false });

  const oneSecondCommands = Array.from({length:10}, (_,index) => ({ id:`one-${index}`, kind:'advance', source:'human', seconds:1, redAiEnabled:false }));
  const replayA = session.replayWargameCommands(initial, oneSecondCommands);
  const replayB = session.replayWargameCommands(initial, oneSecondCommands);
  const finalA = replayA.at(-1).state;
  const finalB = replayB.at(-1).state;

  assert.deepEqual(finalA.units, finalB.units, 'replaying the same command stream must produce identical units');
  assert.equal(finalA.rngSeed, finalB.rngSeed, 'replay must preserve deterministic RNG progression');
  assert.deepEqual(tenSecond.state.units, finalA.units, '+10s must equal ten fixed 1s engine steps');
  assert.equal(tenSecond.state.elapsedSeconds, 10);
  assert.equal(finalA.elapsedSeconds, 10);
  assert.equal(replayA.length, 10);
  assert.ok(replayA.every((row, index) => row.command.sequence === index + 1), 'command records must preserve sequence numbers');

  console.log('wargame session/replay regression: PASS');
} finally {
  fs.rmSync(temp, { recursive:true, force:true });
}
