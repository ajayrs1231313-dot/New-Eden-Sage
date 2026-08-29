import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const main = fs.readFileSync(new URL("../../electron/main-task9.ts", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../../src/App.tsx", import.meta.url), "utf8");
const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const nsisUpdater = fs.readFileSync(require.resolve("electron-updater/out/NsisUpdater"), "utf8");
const baseUpdater = fs.readFileSync(require.resolve("electron-updater/out/BaseUpdater"), "utf8");

assert.match(
  main,
  /ipcMain\.handle\("update:install"[\s\S]*?autoUpdater\.quitAndInstall\(true,\s*true\)/,
  "Downloaded application updates must request a silent NSIS install and relaunch Sage.",
);
assert.match(
  main,
  /autoUpdater\.autoInstallOnAppQuit\s*=\s*false/,
  "Downloaded builds must only install through the explicit Restart to update path.",
);
assert.doesNotMatch(
  main,
  /autoUpdater\.quitAndInstall\(false,\s*true\)/,
  "The in-app updater must not reopen the assisted installer wizard.",
);

// Assisted NSIS remains intentional for a first manual install. The same installer is
// non-interactive during an update because electron-updater passes /S plus the existing
// install directory when quitAndInstall(true, true) is used.
assert.equal(pkg.build?.nsis?.oneClick, false, "First-time installs should keep the assisted setup wizard.");
assert.equal(pkg.build?.nsis?.allowToChangeInstallationDirectory, true, "First-time installs should keep install-directory choice.");
assert.equal(pkg.build?.nsis?.createDesktopShortcut, true, "The installer must preserve the desktop shortcut policy.");
assert.equal(pkg.build?.nsis?.createStartMenuShortcut, true, "The installer must preserve the Start Menu shortcut policy.");
assert.match(
  baseUpdater,
  /quitAndInstall\(isSilent[\s\S]*?this\.install\(isSilent,\s*isSilent\s*\?\s*isForceRunAfter/,
  "electron-updater must propagate Sage's silent/relaunch flags into the installer call.",
);
assert.match(
  nsisUpdater,
  /const args = \["--updated"\];[\s\S]*?if \(options\.isSilent\) \{[\s\S]*?args\.push\("\/S"\)/,
  "electron-updater's NSIS path must add /S for silent in-app updates.",
);
assert.match(
  nsisUpdater,
  /if \(options\.isForceRunAfter\) \{[\s\S]*?args\.push\("--force-run"\)/,
  "electron-updater's NSIS path must request Sage to reopen after replacement.",
);
assert.match(
  nsisUpdater,
  /if \(this\.installDirectory\) \{[\s\S]*?args\.push\(\`\/D=\$\{this\.installDirectory\}\`\)/,
  "electron-updater's NSIS path must retain the current installation directory.",
);
assert.match(app, /state\.status === "downloaded" \? "Restart to update"/, "Updater copy should describe the user-visible restart flow.");

console.log("Updater silent-install regression checks passed.");
