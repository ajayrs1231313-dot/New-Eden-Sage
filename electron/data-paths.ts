import fs from "node:fs";
import path from "node:path";

const LEGACY_DATA_ROOT = "F:\\New Eden Sage Data";
const DEFAULT_DATA_ROOT = path.join(
  process.env.LOCALAPPDATA ?? process.env.APPDATA ?? process.cwd(),
  "New Eden Sage Data",
);

export const DATA_ROOT = fs.existsSync(LEGACY_DATA_ROOT)
  ? LEGACY_DATA_ROOT
  : DEFAULT_DATA_ROOT;
export const MARKET_DATA_ROOT = path.join(DATA_ROOT, "Market Datasets");
export const STATIC_DATA_ROOT = path.join(DATA_ROOT, "Static Data");
export const LOG_ROOT = path.join(DATA_ROOT, "Logs");
