import { availableParallelism } from "node:os";
import { decrypt, encrypt, readConfig, writeConfig } from "./config";
import { fetchCharacterSnapshot, refreshEveToken } from "./eve";
import { saveSnapshot } from "./database";
import { logEvent } from "./logger";

export type MasterUpdateProgress = {
  running: boolean;
  stage: string;
  message: string;
  percent: number;
  startedAt: string;
  cpuWorkers: number;
  downloadDurationMs?: number;
  totalDurationMs?: number;
  completed?: number;
  total?: number;
};

type ProgressCallback = (progress: MasterUpdateProgress) => void;
type TimedResult = { name: string; durationMs: number; ok: boolean; detail?: unknown; error?: string };

type BranchState = {
  active: boolean;
  percent: number;
  stage: string;
  message: string;
  completed?: number;
  total?: number;
};

async function refreshConnectedCharacters(onProgress: (completed: number, total: number, message: string) => void, requestedCharacterIds?: string[]) {
  const totalStartedAt = Date.now();
  const config = await readConfig();
  const connectedCharacterIds = Object.keys(config.encryptedRefreshTokens ?? {});
  const requested = [...new Set((requestedCharacterIds ?? []).map((value) => String(value)).filter(Boolean))];
  const characterIds = requested.length ? connectedCharacterIds.filter((characterId) => requested.includes(characterId)) : connectedCharacterIds;
  if (requested.length && !characterIds.length) throw new Error("The selected character is not connected.");
  if (!characterIds.length) {
    onProgress(0, 0, "No connected characters to refresh.");
    void logEvent("info", "character_refresh.total", { durationMs: Date.now() - totalStartedAt, characters: 0, refreshed: 0, failed: 0 });
    return { refreshed: 0, failed: [] as Array<{ characterId: string; error: string }> };
  }

  let completed = 0;
  let refreshed = 0;
  const failed: Array<{ characterId: string; error: string }> = [];
  await Promise.all(characterIds.map(async (characterId) => {
    const startedAt = Date.now();
    let ok = false;
    try {
      const stored = config.encryptedRefreshTokens[characterId];
      if (!stored) throw new Error("Character refresh token is missing.");
      const tokens = await refreshEveToken(config.eveClientId, decrypt(stored));
      if (tokens.refresh_token) config.encryptedRefreshTokens[characterId] = encrypt(tokens.refresh_token);
      const snapshot = await fetchCharacterSnapshot(characterId, tokens.access_token);
      saveSnapshot(snapshot);
      refreshed += 1;
      ok = true;
    } catch (error) {
      failed.push({ characterId, error: error instanceof Error ? error.message : String(error) });
    } finally {
      const durationMs = Date.now() - startedAt;
      void logEvent("info", "character_refresh.per_character", { characterId, durationMs, ok });
      completed += 1;
      onProgress(completed, characterIds.length, `Refreshing characters: ${completed}/${characterIds.length}`);
    }
  }));
  await writeConfig(config);
  void logEvent("info", "character_refresh.total", {
    durationMs: Date.now() - totalStartedAt,
    characters: characterIds.length,
    refreshed,
    failed: failed.length,
  });
  return { refreshed, failed };
}

async function timed(name: string, work: () => Promise<unknown>): Promise<TimedResult> {
  const started = Date.now();
  try {
    return { name, durationMs: Date.now() - started, ok: true, detail: await work() };
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    const durationMs = Date.now() - started;
    await logEvent("error", "master_update.job_failed", { job: name, durationMs, error: normalizedError });
    return { name, durationMs, ok: false, error: normalizedError.message };
  }
}

export async function runMasterUpdate(onProgress: ProgressCallback, characterIds?: string[]) {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const cpuWorkers = Math.max(1, availableParallelism());
  const timings: TimedResult[] = [];
  const emit = (running: boolean, stage: string, message: string, percent: number, extra: Partial<MasterUpdateProgress> = {}) => onProgress({
    running,
    stage,
    message,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    startedAt,
    cpuWorkers,
    ...extra,
  });

  emit(true, "private-starting", "Refreshing private data", 0);
  await logEvent("info", "private_refresh.started", { cpuWorkers, publicDataSource: "shared-server", privateDataDestination: "local-only" });

  const characterResult = await timed("Private character data", async () => {
    const result = await refreshConnectedCharacters((completed, total, message) => {
      const percent = total ? (completed / total) * 100 : 100;
      emit(true, "private-characters", message.replace("Refreshing characters", "Refreshing private data"), percent, { completed, total });
    }, characterIds);
    if (result.failed.length) throw new Error(result.failed.length + " connected character refresh" + (result.failed.length === 1 ? "" : "es") + " failed: " + result.failed.map((item) => item.characterId + ": " + item.error).join(" | "));
    return result;
  });
  timings.push(characterResult);

  const totalDurationMs = Date.now() - startedAtMs;
  const failures = timings.filter((item) => !item.ok);
  const result = {
    cpuWorkers,
    marketDownloadWorkers: 0,
    downloadDurationMs: 0,
    totalDurationMs,
    timings,
    failures,
    publicMarketSource: "shared-server" as const,
    privateDataOnly: true as const,
  };
  emit(false, failures.length ? "complete-with-errors" : "ready", failures.length ? "Private refresh finished with " + failures.length + " failed source(s)." : "Private data refreshed", 100, { totalDurationMs });
  await logEvent("info", "private_refresh.completed", result);
  return result;
}
