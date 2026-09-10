import { USER_DATA_ROOT } from "./data-paths";
import { safeStorage } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { protectCurrentUserDpapi } from "./windows-dpapi";

export const CURRENT_IDENTITY_SCHEMA_VERSION = 1;

export interface AppConfig {
  eveClientId: string;
  callbackUrl: string;
  encryptedRefreshTokens: Record<string, string>;
  esiScopeSchemaVersion: number;
  esiScopeMigratedAt?: string;
  reauthorizationRequiredCharacterIds: string[];
  eveAuthorizations: Record<string, { scopeSchemaVersion:number; authorisedAt:string; grantedScopes:string[]; lastFullPrivateSyncAt?:string; lastRefreshStatus?:"ready"|"error"; lastRefreshError?:string }>;
  encryptedPrivateDataKey?: string;
  dpapiPrivateDataKey?: string;
  privateDataKeyVersion: number;
  encryptedSageSessionToken?: string;
  identitySchemaVersion: number;
  sageAccountId?: string;
  primaryCharacterId?: string;
  identityMigratedAt?: string;
  characterResetMigrationId?: string;
  characterResetMigratedAt?: string;
}

const defaults: AppConfig = {
  // Public application identifier for New Eden Sage's PKCE desktop SSO flow.
  // This is application metadata, not an EVE client secret.
  eveClientId: "0fd88c89991b420f89d6f8d85fccbae6",
  callbackUrl: "http://localhost:42813/auth/eve/callback",
  encryptedRefreshTokens: {},
  esiScopeSchemaVersion: 0,
  reauthorizationRequiredCharacterIds: [],
  eveAuthorizations: {},
  privateDataKeyVersion: 1,
  identitySchemaVersion: 0,
};

function configPath() {
  return path.join(USER_DATA_ROOT, "settings.json");
}

export async function readConfig(): Promise<AppConfig> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(configPath(), "utf8"),
    ) as Partial<AppConfig> & Record<string, unknown>;
    const clean: AppConfig = {
      eveClientId: parsed.eveClientId?.trim() || defaults.eveClientId,
      callbackUrl: parsed.callbackUrl ?? defaults.callbackUrl,
      encryptedRefreshTokens: parsed.encryptedRefreshTokens ?? {},
      esiScopeSchemaVersion: Number.isFinite(parsed.esiScopeSchemaVersion) ? Number(parsed.esiScopeSchemaVersion) : 0,
      esiScopeMigratedAt: typeof parsed.esiScopeMigratedAt === "string" ? parsed.esiScopeMigratedAt : undefined,
      reauthorizationRequiredCharacterIds: Array.isArray(parsed.reauthorizationRequiredCharacterIds) ? [...new Set(parsed.reauthorizationRequiredCharacterIds.map((value) => String(value)).filter(Boolean))] : [],
      eveAuthorizations: parsed.eveAuthorizations && typeof parsed.eveAuthorizations === "object" ? parsed.eveAuthorizations as AppConfig["eveAuthorizations"] : {},
      encryptedPrivateDataKey: typeof parsed.encryptedPrivateDataKey === "string" ? parsed.encryptedPrivateDataKey : undefined,
      dpapiPrivateDataKey: typeof parsed.dpapiPrivateDataKey === "string" ? parsed.dpapiPrivateDataKey : undefined,
      privateDataKeyVersion: Number.isFinite(parsed.privateDataKeyVersion) ? Number(parsed.privateDataKeyVersion) : 1,
      encryptedSageSessionToken: typeof parsed.encryptedSageSessionToken === "string" ? parsed.encryptedSageSessionToken : undefined,
      identitySchemaVersion: Number.isFinite(parsed.identitySchemaVersion)
        ? Number(parsed.identitySchemaVersion)
        : 0,
      sageAccountId: typeof parsed.sageAccountId === "string" ? parsed.sageAccountId : undefined,
      primaryCharacterId: typeof parsed.primaryCharacterId === "string" ? parsed.primaryCharacterId : undefined,
      identityMigratedAt: typeof parsed.identityMigratedAt === "string" ? parsed.identityMigratedAt : undefined,
      characterResetMigrationId: typeof parsed.characterResetMigrationId === "string" ? parsed.characterResetMigrationId : undefined,
      characterResetMigratedAt: typeof parsed.characterResetMigratedAt === "string" ? parsed.characterResetMigratedAt : undefined,
    };
    if ("encryptedOpenAIKey" in parsed || "openAIModel" in parsed) {
      await fs.writeFile(configPath(), JSON.stringify(clean, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
    }
    return clean;
  } catch {
    return { ...defaults };
  }
}

export async function writeConfig(next: AppConfig) {
  await fs.mkdir(path.dirname(configPath()), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(next, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function encrypt(value: string) {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("Windows secure storage is unavailable.");
  return safeStorage.encryptString(value).toString("base64");
}

export function decrypt(value?: string) {
  if (!value) return "";
  return safeStorage.decryptString(Buffer.from(value, "base64"));
}

export async function getOrCreatePrivateDataEncryptionKey() {
  const config = await readConfig();
  const key = config.encryptedPrivateDataKey ? decrypt(config.encryptedPrivateDataKey) : randomBytes(32).toString("base64");
  let changed = false;
  if (!config.encryptedPrivateDataKey) {
    config.encryptedPrivateDataKey = encrypt(key);
    config.privateDataKeyVersion = 1;
    changed = true;
  }
  // Keep Electron safeStorage as the desktop protection boundary and add a
  // CurrentUser-DPAPI wrapped copy for the stdio MCP process. Both protect the
  // same random DEK; neither stores the plaintext key on disk.
  if (process.platform === "win32" && !config.dpapiPrivateDataKey) {
    config.dpapiPrivateDataKey = protectCurrentUserDpapi(key);
    changed = true;
  }
  if (changed) await writeConfig(config);
  return key;
}

export function publicConfig(config: AppConfig) {
  return {
    eveClientId: config.eveClientId,
    callbackUrl: config.callbackUrl,
    connectedCharacterIds: Object.keys(config.encryptedRefreshTokens),
    esiScopeSchemaVersion: config.esiScopeSchemaVersion,
    reauthorizationRequiredCharacterIds: config.reauthorizationRequiredCharacterIds,
    eveAuthorizations: config.eveAuthorizations,
    sageOnlineConnected: Boolean(config.encryptedSageSessionToken),
    identitySchemaVersion: config.identitySchemaVersion,
    sageAccountId: config.sageAccountId ?? null,
    primaryCharacterId: config.primaryCharacterId ?? null,
  };
}
