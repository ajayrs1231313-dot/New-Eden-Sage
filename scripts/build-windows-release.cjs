const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const packageJson = require(path.join(projectRoot, "package.json"));
const releaseDir = path.join(projectRoot, "release");
const electronBuilderCli = require.resolve("electron-builder/out/cli/cli.js");
const smokeInstall = process.argv.includes("--smoke-install");
let succeeded = false;
const buildRoot = path.join(
  os.tmpdir(),
  `new-eden-sage-release-${packageJson.version}-${process.pid}-${Date.now()}`,
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function retry(label, fn, attempts = 12) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const delay = Math.min(2500, 150 * (2 ** Math.min(attempt - 1, 4)));
      console.warn(`${label} failed (attempt ${attempt}/${attempts}): ${error.code ?? error.message}. Retrying in ${delay} ms...`);
      await sleep(delay);
    }
  }
  throw lastError;
}

function runNode(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(script)} exited with code ${result.status}`);
}

function sha256(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

async function copyVerified(source, destination) {
  const sourceStat = await fsp.stat(source);
  if (!sourceStat.isFile() || sourceStat.size <= 0) throw new Error(`Invalid release artifact: ${source}`);

  await retry(`copy ${path.basename(source)}`, async () => {
    try {
      await fsp.unlink(destination);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await fsp.copyFile(source, destination);
  });

  const destinationStat = await fsp.stat(destination);
  if (destinationStat.size !== sourceStat.size) {
    throw new Error(`Release artifact copy size mismatch: ${path.basename(source)}`);
  }
  const sourceHash = sha256(source);
  const destinationHash = sha256(destination);
  if (sourceHash !== destinationHash) {
    throw new Error(`Release artifact copy hash mismatch: ${path.basename(source)}`);
  }
  console.log(`Published ${path.basename(destination)} (${destinationStat.size.toLocaleString()} bytes, sha256 ${destinationHash.slice(0, 16)}...)`);
}

async function main() {
  await fsp.mkdir(buildRoot, { recursive: true });
  console.log(`Packaging Windows release outside the indexed repo tree:\n  ${buildRoot}`);

  const builderArgs = [
    electronBuilderCli,
    "--win",
    "nsis",
    "--publish",
    "never",
    `--config.directories.output=${buildRoot}`,
  ];
  const build = spawnSync(process.execPath, builderArgs, {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error(`electron-builder exited with code ${build.status}`);

  const entries = await fsp.readdir(buildRoot, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const expectedInstaller = `New-Eden-Sage-Setup-${packageJson.version}.exe`;
  if (!files.includes(expectedInstaller)) {
    throw new Error(`Windows installer was not produced: ${expectedInstaller}\nProduced: ${files.join(", ") || "(none)"}`);
  }

  const installerPath = path.join(buildRoot, expectedInstaller);
  const installerStat = await fsp.stat(installerPath);
  if (installerStat.size < 5 * 1024 * 1024) {
    throw new Error(`Windows installer is unexpectedly small (${installerStat.size} bytes): ${installerPath}`);
  }
  const header = Buffer.alloc(2);
  const handle = await fsp.open(installerPath, "r");
  try {
    await handle.read(header, 0, 2, 0);
  } finally {
    await handle.close();
  }
  if (header.toString("ascii") !== "MZ") throw new Error("Windows installer does not have a valid PE header.");

  if (smokeInstall) {
    runNode(path.join(projectRoot, "scripts", "verify-windows-installer.cjs"), [installerPath]);
  }

  await fsp.mkdir(releaseDir, { recursive: true });
  const publishable = files
    .filter((name) => /\.(exe|blockmap|yml|yaml|7z)$/i.test(name))
    .sort((a, b) => {
      const aMeta = /^latest\.ya?ml$/i.test(a);
      const bMeta = /^latest\.ya?ml$/i.test(b);
      if (aMeta !== bMeta) return aMeta ? 1 : -1;
      return a.localeCompare(b);
    });

  for (const name of publishable) {
    await copyVerified(path.join(buildRoot, name), path.join(releaseDir, name));
  }

  succeeded = true;
  console.log(`Windows release ${packageJson.version} packaged and verified successfully.`);
}

main()
  .catch((error) => {
    console.error("\nWINDOWS RELEASE FAILED");
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (!succeeded) {
      console.error(`Retaining failed release build directory for diagnosis: ${buildRoot}`);
      return;
    }
    try {
      await retry("temporary release cleanup", () => fsp.rm(buildRoot, { recursive: true, force: true }), 6);
    } catch (error) {
      console.warn(`Could not remove temporary release directory ${buildRoot}: ${error.message}`);
    }
  });
