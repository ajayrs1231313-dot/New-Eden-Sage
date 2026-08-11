const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist-electron');
const electronPath = require('electron');
let child = null;
let stopping = false;
let restartTimer = null;
let restartQueued = false;

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

function launch() {
  if (stopping) return;
  child = spawn(electronPath, ['.', '--dev'], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: false,
    env: process.env,
  });
  child.once('exit', (code, signal) => {
    child = null;
    if (stopping || restartQueued) return;
    console.log(`[sage-dev] Electron exited (${code ?? signal ?? 'unknown'}).`);
  });
}

async function stopChild() {
  const current = child;
  if (!current) return;
  restartQueued = true;
  current.kill();
  const deadline = Date.now() + 2500;
  while (child && Date.now() < deadline) await sleep(50);
  restartQueued = false;
}

async function restart(reason) {
  if (stopping) return;
  console.log(`[sage-dev] Electron source changed (${reason}); restarting Electron/preload...`);
  await stopChild();
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
  await stopChild();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.on('exit', () => { if (child) child.kill(); });

main().catch((error) => {
  console.error('[sage-dev] launcher failed', error);
  process.exit(1);
});
