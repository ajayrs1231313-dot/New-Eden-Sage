import { decrypt, encrypt, readConfig, writeConfig } from "./config";
import { getSnapshot } from "./database";
import { refreshEveToken } from "./eve";
import { getNavigationSystem } from "./universe-route-graph";

const ESI_HEADERS = {
  "X-Compatibility-Date": "2026-08-02",
  "X-User-Agent": "NewEdenSage/1.1.7",
};
const TOKEN_CACHE_MS = 10 * 60 * 1000;
const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

export type NavigationCharacterLocation = {
  characterId: string;
  characterName: string;
  systemId: number;
  systemName: string;
  stationId?: number;
  structureId?: number;
  source: "live-esi" | "synced-snapshot";
  observedAt: string;
};

async function accessToken(characterId: string) {
  const cached = tokenCache.get(characterId);
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;
  const config = await readConfig();
  const stored = config.encryptedRefreshTokens[characterId];
  if (!stored) throw new Error("This character is not connected. Reconnect it in Settings first.");
  const tokens = await refreshEveToken(config.eveClientId, decrypt(stored));
  if (tokens.refresh_token) {
    config.encryptedRefreshTokens[characterId] = encrypt(tokens.refresh_token);
    await writeConfig(config);
  }
  tokenCache.set(characterId, { accessToken: tokens.access_token, expiresAt: Date.now() + TOKEN_CACHE_MS });
  return tokens.access_token;
}

export async function getNavigationCharacterLocation(characterIdInput: string, forceLive = true): Promise<NavigationCharacterLocation> {
  const characterId = String(characterIdInput ?? "");
  if (!characterId) throw new Error("Choose a connected character first.");
  const snapshot = getSnapshot(characterId) as any;
  const snapshotSystemId = Number(snapshot?.location?.solar_system_id ?? 0);
  const characterName = String(snapshot?.character?.name ?? characterId);

  if (!forceLive && snapshotSystemId > 0) {
    return {
      characterId,
      characterName,
      systemId: snapshotSystemId,
      systemName: String(snapshot?.location?.solar_system_name ?? (await getNavigationSystem(snapshotSystemId))?.name ?? `System ${snapshotSystemId}`),
      stationId: Number(snapshot?.location?.station_id ?? 0) || undefined,
      structureId: Number(snapshot?.location?.structure_id ?? 0) || undefined,
      source: "synced-snapshot",
      observedAt: String(snapshot?.updatedAt ?? new Date().toISOString()),
    };
  }

  try {
    const token = await accessToken(characterId);
    const response = await fetch(`https://esi.evetech.net/characters/${encodeURIComponent(characterId)}/location/`, {
      headers: { ...ESI_HEADERS, Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      if (response.status === 403) throw new Error("EVE denied location access. Reconnect this character in Sage once to refresh its location permission.");
      throw new Error(`EVE location request failed (${response.status}).`);
    }
    const live = await response.json() as { solar_system_id?: number; station_id?: number; structure_id?: number };
    const systemId = Number(live.solar_system_id ?? 0);
    if (!systemId) throw new Error("EVE did not return a current solar system for this character.");
    const system = await getNavigationSystem(systemId);
    return {
      characterId,
      characterName,
      systemId,
      systemName: system?.name ?? `System ${systemId}`,
      stationId: Number(live.station_id ?? 0) || undefined,
      structureId: Number(live.structure_id ?? 0) || undefined,
      source: "live-esi",
      observedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (snapshotSystemId > 0) {
      return {
        characterId,
        characterName,
        systemId: snapshotSystemId,
        systemName: String(snapshot?.location?.solar_system_name ?? (await getNavigationSystem(snapshotSystemId))?.name ?? `System ${snapshotSystemId}`),
        stationId: Number(snapshot?.location?.station_id ?? 0) || undefined,
        structureId: Number(snapshot?.location?.structure_id ?? 0) || undefined,
        source: "synced-snapshot",
        observedAt: String(snapshot?.updatedAt ?? new Date().toISOString()),
      };
    }
    throw error;
  }
}
