import { availableParallelism } from "node:os";
import { decrypt, encrypt, readConfig, writeConfig } from "./config";
import { fetchCharacterSnapshot, refreshEveToken } from "./eve";
import { saveSnapshot } from "./database";
import { logEvent } from "./logger";
import { ensureCurrentSharedMarketData } from "./shared-market-data";

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

async function refreshConnectedCharacters(onProgress: (completed: number, total: number, message: string) => void) {
  const totalStartedAt = Date.now();
  const config = await readConfig();
  const characterIds = Object.keys(config.encryptedRefreshTokens ?? {});
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

function marketStage(message: string) {
  const value = message.toLowerCase();
  if (value.includes("downloading")) return "market-download";
  if (value.includes("validating")) return "market-validation";
  if (value.includes("installing")) return "market-install";
  return "market-check";
}

export async function runMasterUpdate(onProgress: ProgressCallback) {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const cpuWorkers = Math.max(1, availableParallelism());
  const marketDownloadWorkers = 0;
  const timings: TimedResult[] = [];
  const characters: BranchState = { active: true, percent: 0, stage: "characters", message: "Refreshing characters" };
  const market: BranchState = { active: true, percent: 0, stage: "market-check", message: "Checking shared market" };

  const emit = (running: boolean, stage: string, message: string, percent: number, extra: Partial<MasterUpdateProgress> = {}) => onProgress({
    running,
    stage,
    message,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    startedAt,
    cpuWorkers,
    ...extra,
  });

  const emitOwned = () => {
    const combined = (characters.percent + market.percent) / 2;
    // Downloads/validation/install are explicit and must never hide behind a completed character message.
    if (market.active && market.stage !== "market-check") {
      emit(true, market.stage, market.message, combined, { completed: market.completed, total: market.total });
      return;
    }
    if (characters.active) {
      emit(true, "characters", characters.message, combined, { completed: characters.completed, total: characters.total });
      return;
    }
    if (market.active) {
      emit(true, market.stage, market.message, combined, { completed: market.completed, total: market.total });
      return;
    }
    emit(true, "ready", "Ready", 100);
  };

  emit(true, "starting", "Refreshing characters and checking shared market", 0);
  await logEvent("info", "master_update.started", { cpuWorkers, marketDownloadWorkers, publicMarketSource: "shared-server", publicMarketCompute: "server-only" });

  const characterJob = timed("Connected characters", async () => {
    const result = await refreshConnectedCharacters((completed, total, message) => {
      characters.completed = completed;
      characters.total = total;
      characters.percent = total ? (completed / total) * 100 : 100;
      characters.message = message;
      emitOwned();
    });
    if (result.failed.length) throw new Error(`${result.failed.length} connected character refresh${result.failed.length === 1 ? "" : "es"} failed: ${result.failed.map((item) => `${item.characterId}: ${item.error}`).join(" | ")}`);
    return result;
  }).then((result) => {
    characters.active = false;
    characters.percent = 100;
    timings.push(result);
    emitOwned();
    return result;
  });

  const marketJob = timed("Shared public market", async () => ensureCurrentSharedMarketData((message, completed, total) => {
    market.stage = marketStage(message);
    market.message = message;
    market.completed = completed;
    market.total = total;
    if (total && completed != null) market.percent = Math.max(market.percent, (completed / Math.max(1, total)) * 100);
    else market.percent = Math.max(market.percent, market.stage === "market-check" ? 10 : 25);
    emitOwned();
  })).then((result) => {
    market.active = false;
    market.percent = 100;
    timings.push(result);
    emitOwned();
    return result;
  });

  await Promise.all([characterJob, marketJob]);
  const totalDurationMs = Date.now() - startedAtMs;
  const failures = timings.filter((item) => !item.ok);
  const result = {
    cpuWorkers,
    marketDownloadWorkers,
    downloadDurationMs: timings.find((item) => item.name === "Shared public market")?.durationMs ?? 0,
    totalDurationMs,
    timings,
    failures,
    publicMarketSource: "shared-server" as const,
  };
  emit(false, failures.length ? "complete-with-errors" : "ready", failures.length ? `Sync finished with ${failures.length} failed source(s).` : "Ready", 100, { totalDurationMs });
  await logEvent("info", "master_update.completed", result);
  return result;
}
