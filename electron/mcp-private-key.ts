import { promises as fs } from "node:fs";
import path from "node:path";
import { USER_DATA_ROOT } from "./data-paths";
import { unprotectCurrentUserDpapi } from "./windows-dpapi";

export async function loadMcpPrivateDataEncryptionKey() {
  const settingsPath = path.join(USER_DATA_ROOT, "settings.json");
  const parsed = JSON.parse(await fs.readFile(settingsPath, "utf8")) as { dpapiPrivateDataKey?: unknown };
  if (typeof parsed.dpapiPrivateDataKey !== "string" || !parsed.dpapiPrivateDataKey) {
    throw new Error("Sage private-data encryption needs its Windows compatibility wrap. Open the Sage desktop app once, then reconnect this MCP client.");
  }
  const key = unprotectCurrentUserDpapi(parsed.dpapiPrivateDataKey);
  if (Buffer.from(key, "base64").length !== 32) throw new Error("The Windows-protected Sage private-data key is invalid.");
  return key;
}
