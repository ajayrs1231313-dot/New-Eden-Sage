import { app, safeStorage } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface AppConfig {
  eveClientId: string;
  callbackUrl: string;
  encryptedRefreshTokens: Record<string, string>;
}

const defaults: AppConfig = {
  // Public application identifier for New Eden Sage's PKCE desktop SSO flow.
  // This is application metadata, not an EVE client secret.
  eveClientId: "0fd88c89991b420f89d6f8d85fccbae6",
  callbackUrl: "http://localhost:42813/auth/eve/callback",
  encryptedRefreshTokens: {},
};

function configPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

export async function readConfig(): Promise<AppConfig> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(configPath(), "utf8"),
    ) as Partial<AppConfig> & Record<string, unknown>;
    const clean = {
      eveClientId: parsed.eveClientId?.trim() || defaults.eveClientId,
      callbackUrl: parsed.callbackUrl ?? defaults.callbackUrl,
      encryptedRefreshTokens: parsed.encryptedRefreshTokens ?? {},
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

export function publicConfig(config: AppConfig) {
  return {
    eveClientId: config.eveClientId,
    callbackUrl: config.callbackUrl,
    connectedCharacterIds: Object.keys(config.encryptedRefreshTokens),
  };
}
