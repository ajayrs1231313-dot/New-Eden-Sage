const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const logRoot = path.join(process.env.APPDATA || process.env.LOCALAPPDATA || root, 'new-eden-sage', 'Logs');
const launcherLockFile = path.join(logRoot, 'dev-launcher.lock');
const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function viteAlive() {
  try {
    const response = await fetch('http://localhost:42814', { signal: AbortSignal.timeout(750) });
    return response.ok;
  } catch { return false; }
}

function launcherAlive() {
  try {
    const value = JSON.parse(fs.readFileSync(launcherLockFile, 'utf8'));
    return pidAlive(Number(value?.pid));
  } catch { return false; }
}

function runNode(args) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: false });
  child.on('exit', (code, signal) => process.exitCode = code ?? (signal ? 1 : 0));
}

(async () => {
  const vite = await viteAlive();
  const launcher = launcherAlive();
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
