import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync(new URL("../../electron/main-task9.ts", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../../src/App.tsx", import.meta.url), "utf8");
const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

assert.match(
  main,
  /ipcMain\.handle\("update:install"[\s\S]*?autoUpdater\.quitAndInstall\(true,\s*true\)/,
  "Downloaded application updates must run the NSIS installer silently and relaunch Sage.",
);
assert.doesNotMatch(
  main,
  /autoUpdater\.quitAndInstall\(false,\s*true\)/,
  "The in-app updater must not reopen the assisted installer wizard.",
);
assert.equal(pkg.build?.nsis?.oneClick, false, "First-time installs should keep the assisted setup wizard.");
assert.equal(pkg.build?.nsis?.allowToChangeInstallationDirectory, true, "First-time installs should keep install-directory choice.");
assert.match(app, /state\.status === "downloaded" \? "Restart to update"/, "Updater copy should describe the user-visible restart flow.");

console.log("Updater silent-install regression checks passed.");
