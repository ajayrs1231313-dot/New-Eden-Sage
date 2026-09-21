const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const installerPath = path.resolve(process.argv[2] ?? "");
if (!installerPath || !fs.existsSync(installerPath)) {
  console.error("Usage: node scripts/verify-windows-installer.cjs <installer.exe>");
  process.exit(2);
}

const stamp = `${process.pid}-${Date.now()}`;
const installRoot = path.join(os.tmpdir(), `new-eden-sage-install-smoke-${stamp}`);
const profileRoot = path.join(os.tmpdir(), `new-eden-sage-profile-smoke-${stamp}`);
const productExe = path.join(installRoot, "New Eden Sage.exe");
const uninstallerExe = path.join(installRoot, "Uninstall New Eden Sage.exe");
const uninstallRoots = [
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
];
let passed = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    windowsHide: true,
    encoding: "utf8",
    timeout: options.timeout ?? 120_000,
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function findInstallRecords() {
  const records = [];
  for (const root of uninstallRoots) {
    const result = run("reg.exe", ["query", root, "/s", "/f", "New Eden Sage", "/d"], { timeout: 30_000 });
    if (result.status !== 0 || !result.stdout.trim()) continue;
    let current = null;
    for (const rawLine of result.stdout.split(/\r?\n/)) {
      const line = rawLine.trimEnd();
      if (/^HKEY_/i.test(line.trim())) {
        if (current) records.push(current);
        current = { key: line.trim(), values: {} };
        continue;
      }
      if (!current) continue;
      const match = line.match(/^\s+([^\s].*?)\s{2,}REG_\w+\s{2,}(.*)$/);
      if (match) current.values[match[1].trim()] = match[2].trim();
    }
    if (current) records.push(current);
  }
  return records.filter((record) => /New Eden Sage/i.test(record.values.DisplayName ?? ""));
}

function uninstallExecutable(record) {
  const value = record.values.QuietUninstallString || record.values.UninstallString || "";
  const quoted = value.match(/^"([^"]+\.exe)"/i);
  if (quoted) return quoted[1];
  const bare = value.match(/^(.+?\.exe)(?:\s|$)/i);
  return bare ? bare[1] : "";
}

function isSmokeRecord(record) {
  const text = [
    record.values.UninstallString,
    record.values.QuietUninstallString,
    record.values.DisplayIcon,
  ].filter(Boolean).join(" ");
  return /new-eden-sage-install-smoke-/i.test(text);
}

function removeSmokeShortcuts() {
  const ps = [
    "$w=New-Object -ComObject WScript.Shell",
    "$paths=@((Join-Path ([Environment]::GetFolderPath('Desktop')) 'New Eden Sage.lnk'),(Join-Path ([Environment]::GetFolderPath('Programs')) 'New Eden Sage.lnk'))",
    "foreach($p in $paths){if(Test-Path $p){try{$t=$w.CreateShortcut($p).TargetPath;if($t -like '*new-eden-sage-install-smoke-*'){Remove-Item -LiteralPath $p -Force}}catch{}}}",
  ].join(";");
  run("powershell.exe", ["-NoProfile", "-Command", ps], { timeout: 30_000 });
}

async function cleanupStaleSmokeInstalls() {
  const records = findInstallRecords();
  for (const record of records.filter(isSmokeRecord)) {
    const uninstaller = uninstallExecutable(record);
    if (uninstaller && fs.existsSync(uninstaller)) {
      run(uninstaller, ["/currentuser", "/S"], { timeout: 180_000 });
      await sleep(750);
    }
    run("reg.exe", ["delete", record.key, "/f"], { timeout: 30_000 });
    if (uninstaller) {
      const staleRoot = path.dirname(uninstaller);
      if (/new-eden-sage-install-smoke-/i.test(staleRoot)) {
        try { await fsp.rm(staleRoot, { recursive: true, force: true }); } catch {}
      }
    }
  }
  removeSmokeShortcuts();
}

async function removeWithRetry(target) {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await fsp.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 10) throw error;
      await sleep(200 * attempt);
    }
  }
}

async function uninstallCurrentSmoke() {
  if (fs.existsSync(uninstallerExe)) {
    run(uninstallerExe, ["/currentuser", "/S"], { timeout: 180_000 });
    for (let attempt = 1; attempt <= 20 && fs.existsSync(productExe); attempt += 1) await sleep(250);
  }
  await cleanupStaleSmokeInstalls();
}

async function main() {
  await cleanupStaleSmokeInstalls();
  const before = findInstallRecords();
  if (before.length) {
    throw new Error(
      "Installer smoke test refused to overwrite an existing New Eden Sage installation. " +
      "Run this release gate on a disposable Windows user/VM, or uninstall the existing production copy first."
    );
  }

  await removeWithRetry(installRoot);
  await removeWithRetry(profileRoot);
  await fsp.mkdir(profileRoot, { recursive: true });

  console.log(`Smoke installing:\n  ${installerPath}\ninto:\n  ${installRoot}`);
  const install = run(installerPath, ["/S", `/D=${installRoot}`], { timeout: 180_000 });
  if (install.status !== 0) {
    throw new Error(`Silent installer exited with code ${install.status}.\n${install.stderr || install.stdout || ""}`);
  }

  await sleep(1_500);

  const required = [
    productExe,
    uninstallerExe,
    path.join(installRoot, "resources", "app.asar"),
    path.join(installRoot, "resources", "tunnel-client", "tunnel-client.exe"),
    path.join(installRoot, "resources", "fitting-data", "fitting-dogma-prepared-v1.json.gz"),
    path.join(installRoot, "resources", "fitting-data", "fitting-catalogue-prepared-v1.json.gz"),
    path.join(installRoot, "resources", "market-data", "market-static-prepared-v1.json.gz"),
  ];
  for (const requiredPath of required) {
    const stat = await fsp.stat(requiredPath).catch(() => null);
    if (!stat || !stat.isFile() || stat.size <= 0) {
      throw new Error(`Installed release resource is missing or empty: ${requiredPath}`);
    }
  }

  console.log("Installed payload is complete. Launching installed application...");
  const child = spawn(productExe, [`--user-data-dir=${profileRoot}`], {
    cwd: installRoot,
    windowsHide: true,
    env: { ...process.env, NEW_EDEN_SAGE_USER_DATA: profileRoot, ELECTRON_ENABLE_LOGGING: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });

  await sleep(6_000);
  if (child.exitCode !== null) {
    throw new Error(
      `Installed application exited during launch smoke test with code ${child.exitCode}.\nSTDOUT:\n${stdout.slice(-3000)}\nSTDERR:\n${stderr.slice(-3000)}`
    );
  }

  const kill = run("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { timeout: 30_000 });
  if (kill.status !== 0 && child.exitCode === null) child.kill();

  console.log("Installed application stayed alive through launch smoke window. Running silent uninstall...");
  await uninstallCurrentSmoke();

  if (fs.existsSync(productExe)) {
    throw new Error("Silent uninstall reported success but New Eden Sage.exe is still installed.");
  }
  if (findInstallRecords().length) {
    throw new Error("Silent uninstall left a New Eden Sage uninstall registry entry behind.");
  }

  passed = true;
  console.log("WINDOWS INSTALLER SMOKE PASS: install, payload, launch and uninstall all succeeded.");
}

main()
  .catch((error) => {
    console.error("\nWINDOWS INSTALLER SMOKE FAILED");
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await uninstallCurrentSmoke(); } catch (error) { console.error(`Smoke cleanup warning: ${error.message}`); }
    try { await removeWithRetry(profileRoot); } catch {}
    try { await removeWithRetry(installRoot); } catch {}
    if (!passed) console.error("Smoke-test install was cleaned; caller retains the packaged release directory for diagnosis.");
  });
