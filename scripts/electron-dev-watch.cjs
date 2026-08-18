const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist-electron');
const electronPath = require('electron');
const logRoot = path.join(process.env.APPDATA || process.env.LOCALAPPDATA || root, 'new-eden-sage', 'Logs');
const monitorRoot = path.join(logRoot, 'Crash Monitor');
const monitorScript = path.join(root, 'scripts', 'electron-crash-monitor.cjs');
let child = null;
let stopping = false;
let restartTimer = null;
let restartQueued = false;
let activeSession = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForReady() {
  while (!fs.existsSync(path.join(dist, 'main.js')) || !fs.existsSync(path.join(dist, 'preload.js'))) await sleep(100);
  while (true) {
    try {
      const response = await fetch('http://localhost:42814', { signal: AbortSignal.timeout(750) });
      if (response.ok) return;
    } catch {}
    await sleep(150);
  }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
  } catch {}
}

function tee(stream, target, destination) {
  stream?.on('data', (chunk) => {
    try { destination.write(chunk); } catch {}
    try { fs.appendFileSync(target, chunk); } catch {}
  });
}

function launch() {
  if (stopping) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(monitorRoot, { recursive: true });
  child = spawn(electronPath, ['.', '--dev'], {
    cwd: root,
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: false,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1',
    },
  });
  const sessionId = `${stamp}-${child.pid}`;
  const sessionRoot = path.join(monitorRoot, sessionId);
  fs.mkdirSync(sessionRoot, { recursive: true });
  const ioLog = path.join(sessionRoot, 'electron-output.log');
  const exitFile = path.join(sessionRoot, 'electron-exit.json');
  const controlFile = path.join(sessionRoot, 'control.json');
  activeSession = { sessionId, sessionRoot, ioLog, exitFile, controlFile, pid: child.pid };
  tee(child.stdout, ioLog, process.stdout);
  tee(child.stderr, ioLog, process.stderr);

  const monitor = spawn(process.execPath, [monitorScript,
    '--pid', String(child.pid),
    '--session', sessionId,
    '--log-root', logRoot,
    '--io-log', ioLog,
    '--exit-file', exitFile,
    '--control-file', controlFile,
    '--heartbeat-file', path.join(logRoot, `electron-heartbeat-${child.pid}.json`),
  ], {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
    env: process.env,
  });
  monitor.unref();

  child.once('exit', (code, signal) => {
    const session = activeSession?.pid === child?.pid ? activeSession : { sessionId, exitFile, controlFile, pid: child?.pid };
    const expected = Boolean(stopping || restartQueued || safeExpected(session.controlFile));
    writeJson(session.exitFile, {
      timestamp: new Date().toISOString(),
      pid: session.pid,
      code,
      signal,
      expected,
      stopping,
      restartQueued,
    });
    child = null;
    if (activeSession?.sessionId === sessionId) activeSession = null;
    if (stopping || restartQueued) return;
    console.log(`[sage-dev] Electron exited (${code ?? signal ?? 'unknown'}). Crash monitor is collecting the evidence bundle.`);
  });
}

function safeExpected(file) {
  try { return Boolean(JSON.parse(fs.readFileSync(file, 'utf8'))?.expected); } catch { return false; }
}

async function stopChild(reason = 'source restart') {
  const current = child;
  if (!current) return;
  restartQueued = true;
  if (activeSession) writeJson(activeSession.controlFile, { expected: true, reason, timestamp: new Date().toISOString() });
  current.kill();
  const deadline = Date.now() + 2500;
  while (child && Date.now() < deadline) await sleep(50);
  restartQueued = false;
}

async function restart(reason) {
  if (stopping) return;
  console.log(`[sage-dev] Electron source changed (${reason}); restarting Electron/preload...`);
  await stopChild(`compiled Electron source changed: ${reason}`);
  await waitForReady();
  launch();
}

function scheduleRestart(filename) {
  if (!filename || !filename.endsWith('.js')) return;
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => void restart(filename), 220);
}

async function main() {
  await waitForReady();
  launch();
  fs.watch(dist, { recursive: true }, (_event, filename) => scheduleRestart(String(filename || '')));
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearTimeout(restartTimer);
  await stopChild('development launcher shutting down');
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.on('exit', () => {
  if (child) {
    if (activeSession) writeJson(activeSession.controlFile, { expected: true, reason: 'development launcher exited', timestamp: new Date().toISOString() });
    child.kill();
  }
});

main().catch((error) => {
  console.error('[sage-dev] launcher failed', error);
  process.exit(1);
});
