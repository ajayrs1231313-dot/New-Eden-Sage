import { randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { USER_DATA_ROOT } from "./data-paths";
import { protectCurrentUserDpapi, unprotectCurrentUserDpapi } from "./windows-dpapi";

const OWNER_ACCOUNT_ID = "569399317";
export const EXTERNAL_MCP_ACCESS_DENIED = "You ain't AJ or Sage AI access denied.";

type TunnelOwnerConfig = {
  dpapiOwnerAccessToken?: string;
};

type SageSettings = {
  sageAccountId?: string;
  primaryCharacterId?: string;
};

function tunnelConfigPath() {
  return path.join(USER_DATA_ROOT, "mcp-tunnel.json");
}

function settingsPath() {
  return path.join(USER_DATA_ROOT, "settings.json");
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

export async function assertOwnerSageIdentity() {
  const settings = await readJson<SageSettings>(settingsPath()).catch(() => ({} as SageSettings));
  const owner = [settings.sageAccountId, settings.primaryCharacterId]
    .some((value) => String(value ?? "").trim() === OWNER_ACCOUNT_ID);
  if (!owner) throw new Error(EXTERNAL_MCP_ACCESS_DENIED);
}

export async function ensureExternalMcpOwnerToken() {
  await assertOwnerSageIdentity();
  const file = tunnelConfigPath();
  const config = await readJson<Record<string, unknown> & TunnelOwnerConfig>(file)
    .catch(() => ({} as Record<string, unknown> & TunnelOwnerConfig));
  if (typeof config.dpapiOwnerAccessToken === "string" && config.dpapiOwnerAccessToken) {
    return unprotectCurrentUserDpapi(config.dpapiOwnerAccessToken);
  }

  const token = randomBytes(32).toString("base64url");
  const next = { ...config, dpapiOwnerAccessToken: protectCurrentUserDpapi(token) };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  return token;
}

export async function loadExternalMcpOwnerToken() {
  await assertOwnerSageIdentity();
  const config = await readJson<TunnelOwnerConfig>(tunnelConfigPath())
    .catch(() => ({} as TunnelOwnerConfig));
  if (typeof config.dpapiOwnerAccessToken !== "string" || !config.dpapiOwnerAccessToken) {
    throw new Error(EXTERNAL_MCP_ACCESS_DENIED);
  }
  return unprotectCurrentUserDpapi(config.dpapiOwnerAccessToken);
}

export async function assertExternalMcpOwnerProof(proof?: string) {
  await assertOwnerSageIdentity();
  if (!proof) throw new Error(EXTERNAL_MCP_ACCESS_DENIED);
  const expected = await loadExternalMcpOwnerToken();
  const left = Buffer.from(proof);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error(EXTERNAL_MCP_ACCESS_DENIED);
  }
}
