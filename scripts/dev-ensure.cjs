const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const logRoot = path.join(process.env.APPDATA || process.env.LOCALAPPDATA || root, 'new-eden-sage', 'Logs');
const launcherLockFile = path.join(logRoot, 'dev-launcher.lock');
const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

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
    return pidAlive(pid) ? pid : null;
  } catch { return null; }
}

function windowsProcessSnapshot() {
  if (process.platform !== 'win32') return [];
  try {
    const script = [
      "Get-CimInstance Win32_Process |",
      "Where-Object { $_.Name -in @('node.exe','electron.exe') } |",
      'Select-Object ProcessId,ParentProcessId,Name,CommandLine |',
      'ConvertTo-Json -Depth 3 -Compress',
    ].join(' ');
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 4000,
    }).trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function findLocklessDevStacks(lockOwnerPid) {
  const processes = windowsProcessSnapshot();
  if (!processes.length) return [];
  const rootLower = root.toLowerCase();
  const watchers = new Map();
  for (const entry of processes) {
    const pid = Number(entry?.ProcessId);
    const commandLine = String(entry?.CommandLine || '').toLowerCase();
    if (!Number.isInteger(pid) || !commandLine.includes('electron-dev-watch.cjs')) continue;
    if (pid === lockOwnerPid) continue;
    watchers.set(pid, { watcherPid: pid, electronPids: [] });
  }
  for (const entry of processes) {
    const pid = Number(entry?.ProcessId);
    const parentPid = Number(entry?.ParentProcessId);
    const name = String(entry?.Name || '').toLowerCase();
    const commandLine = String(entry?.CommandLine || '').toLowerCase();
    if (name !== 'electron.exe' || !Number.isInteger(pid)) continue;
    if (!commandLine.includes(rootLower) || !/(?:^|\s)--dev(?:\s|$)/.test(commandLine)) continue;
    const stack = watchers.get(parentPid);
    if (stack) stack.electronPids.push(pid);
  }
  return [...watchers.values()];
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

  // Older Sage dev stacks predate dev-launcher.lock. They can coexist with a
  // newer locked watcher and leave Chromium fighting over the same userData
  // ProcessSingleton. Reconcile those stacks before any reuse/launch decision.
  if (vite) {
    const locklessStacks = findLocklessDevStacks(launcher);
    if (locklessStacks.length) {
      await stopLocklessDevStacks(locklessStacks);
      vite = await viteAlive();
      launcher = launcherPid();
      if (!vite && launcher) {
        // The removed legacy watcher belonged to the old `concurrently -k`
        // stack and took Vite down with it. A standalone launcher would now
        // wait forever for that vanished Vite server, so retire it as well.
        await stopLauncher(launcher);
        launcher = null;
      }
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
