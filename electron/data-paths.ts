import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LEGACY_DATA_ROOT = "F:\\New Eden Sage Data";
const DEFAULT_DATA_ROOT = path.join(
  process.env.LOCALAPPDATA ?? process.env.APPDATA ?? os.homedir(),
  "New Eden Sage Data",
);

export const DATA_ROOT = fs.existsSync(LEGACY_DATA_ROOT)
  ? LEGACY_DATA_ROOT
  : DEFAULT_DATA_ROOT;
export const MARKET_DATA_ROOT = path.join(DATA_ROOT, "Market Datasets");
export const STATIC_DATA_ROOT = path.join(DATA_ROOT, "Static Data");

export function resolveUserDataRoot(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = os.homedir(),
) {
  const explicit = environment.NEW_EDEN_SAGE_USER_DATA?.trim();
  if (explicit) return path.resolve(explicit);

  // Electron's default Windows userData directory is rooted in APPDATA (Roaming).
  // Child workers receive that exact path through NEW_EDEN_SAGE_USER_DATA. Keep the
  // main-process fallback aligned with it so snapshots and prepared intelligence
  // are never split between Roaming and Local AppData.
  const profileRoot = environment.APPDATA?.trim() || environment.LOCALAPPDATA?.trim();
  if (profileRoot) return path.join(profileRoot, "new-eden-sage");

  // Writable runtime data must never fall back to process.cwd(): packaged Sage may
  // be running from Program Files. The user profile remains writable in that case.
  return path.join(homeDirectory, ".new-eden-sage");
}

export const USER_DATA_ROOT = resolveUserDataRoot();
export const ANALYSIS_CACHE_ROOT = path.join(USER_DATA_ROOT, "Analysis Cache");
export const LOG_ROOT = path.join(USER_DATA_ROOT, "Logs");
