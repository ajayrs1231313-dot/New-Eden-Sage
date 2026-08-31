import { USER_DATA_ROOT } from "./data-paths";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { app } from "electron";
import { decrypt, encrypt, readConfig, writeConfig } from "./config";
import { refreshEveToken } from "./eve";
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
type PrivateRefreshFailure = { characterId: string; error: string };
type WorkerProgress = { stage?: string; percent?: number; message?: string; completed?: number; total?: number };
type WorkerResult = { refreshed: number; failed: PrivateRefreshFailure[] };

let activePrivateRefreshProcess: ChildProcess | undefined;

export function disposePrivateRefreshProcess() {
  const child = activePrivateRefreshProcess;
  activePrivateRefreshProcess = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try { if (child.connected) child.disconnect(); } catch { /* already disconnected */ }
  try { child.kill(); } catch { /* already gone */ }
}

async function runPrivateRefreshProcess(
  characters: Array<{ characterId: string; accessToken: string }>,
  onProgress: (progress: WorkerProgress) => void,
): Promise<WorkerResult> {
  if (!characters.length) return { refreshed: 0, failed: [] };
  if (activePrivateRefreshProcess && activePrivateRefreshProcess.exitCode === null && activePrivateRefreshProcess.signalCode === null) {
    throw new Error("A private-data refresh is already running.");
  }

  return new Promise<WorkerResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = fork(path.join(__dirname, "private-refresh-process.js"), [], {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          NEW_EDEN_SAGE_USER_DATA: USER_DATA_ROOT,
        },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        execArgv: ["--max-old-space-size=2048"],
      });
    } catch (error) {
      reject(error);
      return;
    }

    activePrivateRefreshProcess = child;
    let settled = false;
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4_000);
    });

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (activePrivateRefreshProcess === child) activePrivateRefreshProcess = undefined;
      child.removeAllListeners("message");
      child.removeAllListeners("error");
      child.removeAllListeners("exit");
      try { if (child.connected) child.disconnect(); } catch { /* already disconnected */ }
      callback();
    };

    child.on("message", (message: any) => {
      if (message?.type === "progress") {
        onProgress(message as WorkerProgress);
        return;
      }
      if (message?.type === "complete") {
        finish(() => resolve({
          refreshed: Math.max(0, Number(message.refreshed ?? 0)),
          failed: Array.isArray(message.failed) ? message.failed : [],
        }));
        return;
      }
      if (message?.type === "error") {
        finish(() => reject(new Error(String(message.error ?? "Private refresh worker failed."))));
      }
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code, signal) => {
      if (settled) return;
      const detail = stderr.trim() ? ` ${stderr.trim()}` : "";
      finish(() => reject(new Error(`Private refresh worker exited unexpectedly (${signal ?? code ?? "unknown"}).${detail}`)));
    });

    try {
      child.send({ characters });
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

async function refreshConnectedCharacters(
  onProgress: (progress: WorkerProgress) => void,
  requestedCharacterIds?: string[],
) {
  const totalStartedAt = Date.now();
  const config = await readConfig();
  const connectedCharacterIds = Object.keys(config.encryptedRefreshTokens ?? {});
  const requested = [...new Set((requestedCharacterIds ?? []).map((value) => String(value)).filter(Boolean))];
  const characterIds = requested.length
    ? connectedCharacterIds.filter((characterId) => requested.includes(characterId))
    : connectedCharacterIds;
  if (requested.length && !characterIds.length) throw new Error("The selected character is not connected.");
  if (!characterIds.length) {
    onProgress({ stage: "private-empty", percent: 100, completed: 0, total: 0, message: "No connected characters to refresh." });
    void logEvent("info", "character_refresh.total", { durationMs: Date.now() - totalStartedAt, characters: 0, refreshed: 0, failed: 0 });
    return { refreshed: 0, failed: [] as PrivateRefreshFailure[] };
  }

  const failed: PrivateRefreshFailure[] = [];
  const prepared: Array<{ characterId: string; accessToken: string }> = [];
  let authCompleted = 0;
  let configChanged = false;

  onProgress({ stage: "private-auth", percent: 1, completed: 0, total: characterIds.length, message: "Refreshing local character authorization." });
  await Promise.all(characterIds.map(async (characterId) => {
    try {
      const stored = config.encryptedRefreshTokens[characterId];
      if (!stored) throw new Error("Character refresh token is missing.");
      const tokens = await refreshEveToken(config.eveClientId, decrypt(stored));
      if (tokens.refresh_token) {
        config.encryptedRefreshTokens[characterId] = encrypt(tokens.refresh_token);
        configChanged = true;
      }
      prepared.push({ characterId, accessToken: tokens.access_token });
    } catch (error) {
      failed.push({ characterId, error: error instanceof Error ? error.message : String(error) });
    } finally {
      authCompleted += 1;
      onProgress({
        stage: "private-auth",
        percent: Math.min(8, 1 + Math.round((authCompleted / characterIds.length) * 7)),
        completed: authCompleted,
        total: characterIds.length,
        message: `Authorization ready ${authCompleted}/${characterIds.length}.`,
      });
    }
  }));

  // EVE refresh tokens may rotate. Persist replacements before the heavier worker
  // starts so a worker crash cannot strand the user with an obsolete token.
  if (configChanged) await writeConfig(config);

  let refreshed = 0;
  if (prepared.length) {
    const workerResult = await runPrivateRefreshProcess(prepared, (progress) => {
      const workerPercent = Math.max(0, Math.min(100, Number(progress.percent ?? 0)));
      onProgress({
        ...progress,
        percent: Math.min(99, Math.round(8 + workerPercent * 0.91)),
        message: String(progress.message ?? "Refreshing private data locally."),
      });
    });
    refreshed = workerResult.refreshed;
    failed.push(...workerResult.failed);
  }

  onProgress({
    stage: failed.length ? "private-complete-with-errors" : "private-complete",
    percent: 100,
    completed: characterIds.length,
    total: characterIds.length,
    message: failed.length ? `Private refresh completed with ${failed.length} failed character source(s).` : "Private character data is ready.",
  });
  void logEvent("info", "character_refresh.total", {
    durationMs: Date.now() - totalStartedAt,
    characters: characterIds.length,
    refreshed,
    failed: failed.length,
    execution: "child-process",
  });
  return { refreshed, failed };
}

async function timed(name: string, work: () => Promise<unknown>): Promise<TimedResult> {
  const started = Date.now();
  try {
    const detail = await work();
    return { name, durationMs: Date.now() - started, ok: true, detail };
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
  await logEvent("info", "private_refresh.started", { cpuWorkers, publicDataSource: "shared-server", privateDataDestination: "local-only", execution: "child-process" });

  const characterResult = await timed("Private character data", async () => {
    const result = await refreshConnectedCharacters((progress) => {
      emit(true, String(progress.stage ?? "private-characters"), String(progress.message ?? "Refreshing private data locally."), Number(progress.percent ?? 0), {
        completed: progress.completed,
        total: progress.total,
      });
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
  emit(false, failures.length ? "complete-with-errors" : "ready", failures.length ? "Private refresh finished with " + failures.length + " failed source(s)." : "Private data refreshed", failures.length ? 0 : 100, { totalDurationMs });
  await logEvent("info", "private_refresh.completed", result);
  return result;
}
