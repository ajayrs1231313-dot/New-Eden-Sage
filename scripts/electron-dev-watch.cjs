const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist-electron');
const electronPath = require('electron');
const logRoot = path.join(process.env.APPDATA || process.env.LOCALAPPDATA || root, 'new-eden-sage', 'Logs');
const monitorRoot = path.join(logRoot, 'Crash Monitor');
const monitorScript = path.join(root, 'scripts', 'electron-crash-monitor.cjs');
const processSessionId = currentWindowsSessionId();
const launcherLockFile = path.join(logRoot, process.platform === 'win32' && Number.isInteger(processSessionId) ? `dev-launcher-session-${processSessionId}.lock` : 'dev-launcher.lock');
const launcherCommandFile = path.join(logRoot, process.platform === 'win32' && Number.isInteger(processSessionId) ? `dev-launcher-command-session-${processSessionId}.json` : 'dev-launcher-command.json');
const defaultDevUserData = path.join(process.env.APPDATA || process.env.LOCALAPPDATA || root, 'new-eden-sage-dev');
const devUserData = process.platform === 'win32' && processSessionId === 0
  ? path.join(process.env.APPDATA || process.env.LOCALAPPDATA || root, 'new-eden-sage-dev-session-0')
  : defaultDevUserData;
const sharedUserData = path.dirname(logRoot);
const sharedLocalState = path.join(sharedUserData, 'Local State');
const devLocalState = path.join(devUserData, 'Local State');

function currentWindowsSessionId() {
  if (process.platform !== 'win32') return null;
  try {
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${process.pid}).SessionId`], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 3000,
    }).trim();
    const value = Number(raw);
    return Number.isInteger(value) && value >= 0 ? value : null;
  } catch { return null; }
}

// Chromium safeStorage derives its AES key from Local State. The dev stack keeps
// Chromium session/cache files isolated so it can coexist with an installed Sage
// build, but settings.json remains shared. Keep only the secure-storage key in sync
// so refresh tokens encrypted by either build remain readable in both profiles.
function syncSharedSafeStorageKey() {
  if (!fs.existsSync(sharedLocalState)) return;
  try {
    const sharedState = JSON.parse(fs.readFileSync(sharedLocalState, 'utf8'));
    const encryptedKey = sharedState?.os_crypt?.encrypted_key;
    if (typeof encryptedKey !== 'string' || !encryptedKey) return;

    fs.mkdirSync(devUserData, { recursive: true });
    let devState = {};
    try { devState = JSON.parse(fs.readFileSync(devLocalState, 'utf8')); } catch {}
    if (devState?.os_crypt?.encrypted_key === encryptedKey) return;

    const nextState = {
      ...devState,
      os_crypt: { ...(devState?.os_crypt || {}), encrypted_key: encryptedKey },
    };
    const temp = `${devLocalState}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(nextState), 'utf8');
    fs.renameSync(temp, devLocalState);
    console.log('[sage-dev] Synchronized Chromium secure-storage key with shared Sage profile.');
  } catch (error) {
    console.error('[sage-dev] Could not synchronize Chromium secure-storage key.', error);
  }
}

function electronLaunchArgs(extraArgs = []) {
  return [`--user-data-dir=${devUserData}`, '.', '--dev', ...extraArgs];
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function pidIsElectronDevWatcher(pid) {
  if (!pidAlive(pid)) return false;
  if (process.platform !== 'win32') return true;
  try {
    const commandLine = execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      '(Get-CimInstance Win32_Process -Filter \"ProcessId = ' + pid + '\").CommandLine',
    ], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 3000 }).trim().toLowerCase();
    if (!commandLine) return null;
    return commandLine.includes('electron-dev-watch.cjs');
  } catch {
    // A transient CIM timeout must not make a second launcher steal a live lock.
    // null means the owner identity could not be proven either way.
    return null;
  }
}

function acquireLauncherLock() {
  fs.mkdirSync(logRoot, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(launcherLockFile, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), root, sessionId: processSessionId }), 'utf8');
      fs.closeSync(fd);
      return true;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const owner = JSON.parse(fs.readFileSync(launcherLockFile, 'utf8'));
        const ownerPid = Number(owner?.pid);
        const sameRoot = !owner?.root || path.resolve(String(owner.root)) === root;
        const watcherStatus = pidIsElectronDevWatcher(ownerPid);
        if (sameRoot && (watcherStatus === true || (watcherStatus === null && pidAlive(ownerPid)))) return false;
      } catch {}
      try { fs.unlinkSync(launcherLockFile); } catch {}
    }
  }
  return false;
}

function releaseLauncherLock() {
  try {
    const owner = JSON.parse(fs.readFileSync(launcherLockFile, 'utf8'));
    if (Number(owner?.pid) === process.pid) fs.unlinkSync(launcherLockFile);
  } catch {}
}

if (!acquireLauncherLock()) {
  try {
    fs.mkdirSync(logRoot, { recursive: true });
    fs.writeFileSync(launcherCommandFile, JSON.stringify({ action: 'open', requestedAt: new Date().toISOString(), requesterPid: process.pid }), 'utf8');
    console.log('[sage-dev] Existing Electron launcher found; sent open/focus request instead of starting a duplicate.');
  } catch (error) {
    console.error('[sage-dev] Existing launcher found but open/focus request could not be written.', error);
  }
  process.exit(0);
}
let child = null;
let stopping = false;
let restartTimer = null;
const compiledFingerprints = new Map();
const pendingCompiledEvents = new Set();
let restartQueued = false;
let restartInFlight = null;
let queuedRestartReason = null;
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
  syncSharedSafeStorageKey();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(monitorRoot, { recursive: true });
  child = spawn(electronPath, electronLaunchArgs(), {
    cwd: root,
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: false,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1',
      NEW_EDEN_SAGE_USER_DATA: sharedUserData,
    },
  });
  const sessionId = `${stamp}-${child.pid}`;
  const sessionRoot = path.join(monitorRoot, sessionId);
  fs.mkdirSync(sessionRoot, { recursive: true });
  const ioLog = path.join(sessionRoot, 'electron-output.log');
  const exitFile = path.join(sessionRoot, 'electron-exit.json');
  const controlFile = path.join(sessionRoot, 'control.json');
  activeSession = { sessionId, sessionRoot, ioLog, exitFile, controlFile, pid: child.pid };
  let singletonCollision = false;
  child.stderr?.on('data', (chunk) => {
    const text = String(chunk || '').toLowerCase();
    if (text.includes('process_singleton_win.cc') || text.includes('lock file can not be created!')) {
      singletonCollision = true;
    }
  });
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
    if (singletonCollision) {
      console.error('[sage-dev] Chromium profile lock collision detected. Releasing the launcher lock so the next dev start can reconcile the existing Sage process.');
      stopping = true;
      releaseLauncherLock();
      setImmediate(() => process.exit(1));
      return;
    }
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
  queuedRestartReason = reason;
  if (restartInFlight) return restartInFlight;

  restartInFlight = (async () => {
    while (!stopping && queuedRestartReason) {
      const nextReason = queuedRestartReason;
      queuedRestartReason = null;
      console.log(`[sage-dev] Electron source changed (${nextReason}); restarting Electron/preload...`);
      await stopChild(`compiled Electron source changed: ${nextReason}`);
      await waitForReady();
      if (stopping) break;
      launch();
      // TypeScript emits several compiled files in one build. Give that burst
      // time to settle so a second watcher callback cannot launch another
      // Electron main process alongside the first.
      await sleep(400);
    }
  })().finally(() => {
    restartInFlight = null;
    if (!stopping && queuedRestartReason) void restart(queuedRestartReason);
  });

  return restartInFlight;
}

function compiledFingerprint(filename) {
  const target = path.resolve(dist, filename);
  const relative = path.relative(dist, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  try {
    return createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  } catch {
    return null;
  }
}

function seedCompiledFingerprints(directory = dist) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      seedCompiledFingerprints(target);
      continue;
    }
    if (!entry.name.endsWith('.js')) continue;
    const relative = path.relative(dist, target);
    const fingerprint = compiledFingerprint(relative);
    if (fingerprint) compiledFingerprints.set(relative, fingerprint);
  }
}

function scheduleRestart(filename) {
  if (!filename || !filename.endsWith('.js')) return;
  pendingCompiledEvents.add(filename);
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    const events = [...pendingCompiledEvents];
    pendingCompiledEvents.clear();
    const changed = [];
    for (const candidate of events) {
      const fingerprint = compiledFingerprint(candidate);
      if (!fingerprint) continue;
      const previous = compiledFingerprints.get(candidate);
      compiledFingerprints.set(candidate, fingerprint);
      if (previous !== fingerprint) changed.push(candidate);
    }
    if (!changed.length) {
      console.log('[sage-dev] Ignoring compiled-file notification with unchanged content.');
      return;
    }
    void restart(changed.join(', '));
  }, 220);
}

async function handleLauncherCommand() {
  let command = null;
  try {
    command = JSON.parse(fs.readFileSync(launcherCommandFile, 'utf8'));
    fs.unlinkSync(launcherCommandFile);
  } catch { return; }
  if (command?.action !== 'open' || stopping) return;
  if (!child) {
    console.log('[sage-dev] Open request received with no Electron child; launching it against the existing Vite server.');
    await waitForReady();
    if (!stopping && !child) launch();
    return;
  }
  console.log('[sage-dev] Open request received; asking the running Sage instance to show/focus itself.');
  const pulse = spawn(electronPath, electronLaunchArgs(['--focus-existing']), { cwd: root, stdio: 'ignore', windowsHide: true, env: { ...process.env, NEW_EDEN_SAGE_USER_DATA: sharedUserData } });
  pulse.unref();
}

async function main() {
  await waitForReady();
  seedCompiledFingerprints();
  launch();
  fs.watch(dist, { recursive: true }, (_event, filename) => scheduleRestart(String(filename || '')));
  const commandTimer = setInterval(() => void handleLauncherCommand(), 500);
  commandTimer.unref();
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
  releaseLauncherLock();
  if (child) {
    if (activeSession) writeJson(activeSession.controlFile, { expected: true, reason: 'development launcher exited', timestamp: new Date().toISOString() });
    child.kill();
  }
});

main().catch((error) => {
  console.error('[sage-dev] launcher failed', error);
  process.exit(1);
});
