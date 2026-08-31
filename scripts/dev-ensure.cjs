const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const logRoot = path.join(process.env.APPDATA || process.env.LOCALAPPDATA || root, 'new-eden-sage', 'Logs');
const processSessionId = currentWindowsSessionId();
const launcherLockFile = path.join(logRoot, process.platform === 'win32' && Number.isInteger(processSessionId) ? `dev-launcher-session-${processSessionId}.lock` : 'dev-launcher.lock');
const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

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

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function viteAlive() {
  try {
    const response = await fetch('http://localhost:42814', { signal: AbortSignal.timeout(750) });
    return response.ok;
  } catch { return false; }
}

function launcherPid() {
  try {
    const value = JSON.parse(fs.readFileSync(launcherLockFile, 'utf8'));
    const pid = Number(value?.pid);
    if (!pidAlive(pid)) return null;
    if (value?.root && path.resolve(String(value.root)) !== root) return null;
    if (process.platform === 'win32') {
      const processes = windowsProcessSnapshot();
      // Fail closed when CIM is temporarily unavailable: a live, root-matched
      // lock is safer to trust than starting a second Electron launcher.
      if (processes === null) return pid;
      const owner = processes.find((entry) => Number(entry?.ProcessId) === pid);
      const commandLine = String(owner?.CommandLine || '').toLowerCase();
      if (!commandLine.includes('electron-dev-watch.cjs')) return null;
    }
    return pid;
  } catch { return null; }
}

function windowsProcessSnapshot() {
  if (process.platform !== 'win32') return [];
  const script = [
    "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe' OR Name = 'electron.exe'\" |",
    'Select-Object ProcessId,ParentProcessId,Name,SessionId,CommandLine |',
    'ConvertTo-Json -Depth 3 -Compress',
  ].join(' ');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
      }).trim();
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {}
  }
  // Distinguish a transient CIM failure from a valid empty snapshot so callers
  // do not incorrectly treat a live launcher lock as stale.
  return null;
}
function findLocklessDevStacks(lockOwnerPid) {
  const processes = windowsProcessSnapshot();
  if (!processes?.length) return [];
  const rootLower = root.toLowerCase();
  const watchers = new Map();
  for (const entry of processes) {
    const pid = Number(entry?.ProcessId);
    const sessionId = Number(entry?.SessionId);
    const commandLine = String(entry?.CommandLine || '').toLowerCase();
    if (Number.isInteger(processSessionId) && sessionId !== processSessionId) continue;
    if (!Number.isInteger(pid) || !commandLine.includes('electron-dev-watch.cjs')) continue;
    if (pid === lockOwnerPid) continue;
    watchers.set(pid, { watcherPid: pid, electronPids: [] });
  }
  for (const entry of processes) {
    const pid = Number(entry?.ProcessId);
    const parentPid = Number(entry?.ParentProcessId);
    const sessionId = Number(entry?.SessionId);
    const name = String(entry?.Name || '').toLowerCase();
    if (Number.isInteger(processSessionId) && sessionId !== processSessionId) continue;
    const commandLine = String(entry?.CommandLine || '').toLowerCase();
    if (name !== 'electron.exe' || !Number.isInteger(pid)) continue;
    if (!commandLine.includes(rootLower) || !/(?:^|\s)--dev(?:\s|$)/.test(commandLine)) continue;
    const stack = watchers.get(parentPid);
    if (stack) stack.electronPids.push(pid);
  }
  // A relative watcher command line does not expose its working directory. Only
  // retire a legacy watcher when it owns an Electron main process from this repo.
  return [...watchers.values()].filter((stack) => stack.electronPids.length > 0);
}

async function stopLocklessDevStacks(stacks) {
  if (!stacks.length) return;
  const description = stacks.map((stack) => {
    const children = stack.electronPids.length ? `, Electron ${stack.electronPids.join('/')}` : '';
    return `watcher ${stack.watcherPid}${children}`;
  }).join('; ');
  console.log(`[sage-dev] Found an older lockless/duplicate dev launcher (${description}). Removing it before continuing.`);
  for (const stack of stacks) {
    for (const pid of stack.electronPids) {
      try { process.kill(pid); } catch {}
    }
    try { process.kill(stack.watcherPid); } catch {}
  }
  const pids = stacks.flatMap((stack) => [stack.watcherPid, ...stack.electronPids]);
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && pids.some(pidAlive)) await sleep(100);
  // If the duplicate watcher belonged to `concurrently -k`, terminating it can
  // also stop Vite/tsc. Give that parent stack time to settle before deciding
  // whether the remaining launcher can be reused.
  await sleep(500);
}

async function stopLauncher(pid) {
  if (!pidAlive(pid)) return;
  try { process.kill(pid); } catch {}
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && pidAlive(pid)) await sleep(100);
}

function runNode(args) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: false });
  child.on('exit', (code, signal) => process.exitCode = code ?? (signal ? 1 : 0));
}

(async () => {
  let vite = await viteAlive();
  let launcher = launcherPid();

  if (!vite && launcher) {
    console.log('[sage-dev] Electron launcher is alive but Vite is gone. Retiring the orphaned launcher before restarting the full stack.');
    await stopLauncher(launcher);
    launcher = null;
    try { fs.unlinkSync(launcherLockFile); } catch {}
  }

  // Older Sage dev stacks predate dev-launcher.lock. They can coexist with a
  // newer locked watcher and leave Chromium fighting over the same userData
  // ProcessSingleton. Reconcile those stacks before any reuse/launch decision,
  // even if Vite has already died.
  const locklessStacks = findLocklessDevStacks(launcher);
  if (locklessStacks.length) {
    await stopLocklessDevStacks(locklessStacks);
    vite = await viteAlive();
    launcher = launcherPid();
    if (!vite && launcher) {
      // The removed legacy watcher belonged to the old concurrently -k stack
      // and took Vite down with it. A standalone launcher would now wait
      // forever for that vanished Vite server, so retire it as well.
      await stopLauncher(launcher);
      launcher = null;
      try { fs.unlinkSync(launcherLockFile); } catch {}
    }
  }

  if (vite && launcher) {
    console.log('[sage-dev] Existing dev stack detected. Reusing Vite on 42814 and signalling the Electron launcher instead of starting duplicates.');
    runNode([path.join(root, 'scripts', 'electron-dev-watch.cjs'), '--open-existing']);
    return;
  }

  if (vite && !launcher) {
    console.log('[sage-dev] Vite is already running but the Electron launcher is not. Starting only the Electron launcher.');
    runNode([path.join(root, 'scripts', 'electron-dev-watch.cjs')]);
    return;
  }

  console.log('[sage-dev] No reusable dev stack detected. Starting the full stack once.');
  runNode([npmCli, 'run', 'dev:stack']);
})().catch((error) => { console.error('[sage-dev] ensure failed', error); process.exitCode = 1; });
