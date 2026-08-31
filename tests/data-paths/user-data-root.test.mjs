import assert from "node:assert/strict";
import path from "node:path";
import { resolveUserDataRoot } from "../../electron/data-paths.ts";

const home = path.resolve("C:/Users/TestUser");

assert.equal(
  resolveUserDataRoot({ NEW_EDEN_SAGE_USER_DATA: "C:/Sage/Explicit", APPDATA: "C:/Roaming", LOCALAPPDATA: "C:/Local" }, home),
  path.resolve("C:/Sage/Explicit"),
  "explicit worker/main userData contract must win",
);

assert.equal(
  resolveUserDataRoot({ APPDATA: "C:/Roaming", LOCALAPPDATA: "C:/Local" }, home),
  path.join("C:/Roaming", "new-eden-sage"),
  "Windows fallback must match Electron userData in Roaming AppData",
);

assert.equal(
  resolveUserDataRoot({ LOCALAPPDATA: "C:/Local" }, home),
  path.join("C:/Local", "new-eden-sage"),
  "Local AppData remains a fallback when APPDATA is unavailable",
);

assert.equal(
  resolveUserDataRoot({}, home),
  path.join(home, ".new-eden-sage"),
  "last-resort storage must stay in a writable user profile",
);

console.log("user-data-root regression tests passed");
