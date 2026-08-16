import path from "node:path";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { app } from "electron";
import { decrypt, encrypt, readConfig, writeConfig } from "./config";
import { fetchCharacterSnapshot, refreshEveToken } from "./eve";
import { saveSnapshot } from "./database";
import { logEvent } from "./logger";
import { stageStaticDataRefreshLowImpact } from "./type-volumes";

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

const DERIVED_TASKS = [
  "market-static",
  "full-market-index",
  "pve-static",
  "readiness-static",
  "routes",
] as const;

const MARKET_DOWNLOAD_WORKERS = 2;

type DerivedTask = (typeof DERIVED_TASKS)[number];

function runWorker<T>(file: string, workerData: unknown, onMessage?: (message: any) => void) {
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, file), {
      workerData,
      env: {
        ...process.env,
        NEW_EDEN_SAGE_USER_DATA: app.getPath("userData"),
      },
    });
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      callback();
      void worker.terminate().catch(() => undefined);
    };
    timeout = setTimeout(() => {
      finish(() => reject(new Error(`Master update worker timed out after 15 minutes (${file}).`)));
    }, 15 * 60_000);
    timeout.unref();
    worker.on("message", (message: any) => {
      onMessage?.(message);
      if (message?.type === "complete") finish(() => resolve(message.result as T));
      if (message?.type === "fatal" || message?.type === "error") finish(() => reject(new Error(message.error ?? "Master update worker failed.")));
    });
    worker.once("error", (error) => finish(() => reject(error)));
    worker.once("exit", (code) => {
      finish(() => reject(new Error(
        code === 0
          ? `Master update worker exited cleanly before returning a result (${file}).`
          : `Master update worker exited (${code}) (${file}).`,
      )));
    });
  });
}

async function refreshConnectedCharacters(onProgress: (completed: number, total: number, message: string) => void) {
  const config = await readConfig();
  const characterIds = Object.keys(config.encryptedRefreshTokens ?? {});
  if (!characterIds.length) {
    onProgress(0, 0, "No connected characters to refresh.");
    return { refreshed: 0, failed: [] as Array<{ characterId: string; error: string }> };
  }
  let completed = 0;
  let refreshed = 0;
  const failed: Array<{ characterId: string; error: string }> = [];
  await Promise.all(characterIds.map(async (characterId) => {
    try {
      const stored = config.encryptedRefreshTokens[characterId];
      if (!stored) throw new Error("Character refresh token is missing.");
      const tokens = await refreshEveToken(config.eveClientId, decrypt(stored));
      if (tokens.refresh_token) config.encryptedRefreshTokens[characterId] = encrypt(tokens.refresh_token);
      const snapshot = await fetchCharacterSnapshot(characterId, tokens.access_token);
      saveSnapshot(snapshot);
      refreshed += 1;
    } catch (error) {
      failed.push({ characterId, error: error instanceof Error ? error.message : String(error) });
    } finally {
      completed += 1;
      onProgress(completed, characterIds.length, `Refreshing characters: ${completed}/${characterIds.length}`);
    }
  }));
  await writeConfig(config);
  return { refreshed, failed };
}

async function timed(name: string, work: () => Promise<unknown>): Promise<TimedResult> {
  const started = Date.now();
  try {
    const detail = await work();
    return { name, durationMs: Date.now() - started, ok: true, detail };
  } catch (error) {
    const durationMs = Date.now() - started;
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    await logEvent("error", "master_update.job_failed", {
      job: name,
      durationMs,
      error: normalizedError,
    });
    return { name, durationMs, ok: false, error: normalizedError.message };
  }
}

export async function runMasterUpdate(onProgress: ProgressCallback) {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const cpuWorkers = Math.max(1, availableParallelism());
  let marketPercent = 0;
  let characterPercent = 0;
  let staticPercent = 0;
  let downloadDurationMs: number | undefined;
  const timings: TimedResult[] = [];

  const emit = (progress: Omit<MasterUpdateProgress, "startedAt" | "cpuWorkers">) => onProgress({ ...progress, startedAt, cpuWorkers });
  const sourcePercent = () => Math.min(75, Math.round(marketPercent * 0.60 + characterPercent * 0.10 + staticPercent * 0.05));
  const emitSource = (stage: string, message: string, completed?: number, total?: number) => emit({ running: true, stage, message, percent: sourcePercent(), completed, total });

  emit({ running: true, stage: "starting", message: `Master Update starting with up to ${cpuWorkers} compute workers…`, percent: 0 });
  await logEvent("info", "master_update.started", { cpuWorkers });

  const sourceStartedAt = Date.now();
  const staticJob = timed("CCP static data", async () => {
    const result = await stageStaticDataRefreshLowImpact(true, true);
    staticPercent = 100;
    emitSource("static-data", "CCP static-data check/download complete.");
    return result;
  }).then((result) => {
    if (!result.ok) {
      staticPercent = 100;
      emitSource("static-data", `CCP static data failed: ${result.error}`);
    }
    timings.push(result);
    return result;
  });

  const characterJob = timed("Connected characters", async () => refreshConnectedCharacters((completed, total, message) => {
    characterPercent = total ? (completed / total) * 100 : 100;
    emitSource("characters", message, completed, total);
  })).then((result) => {
    characterPercent = 100;
    if (!result.ok) emitSource("characters", `Character refresh failed: ${result.error}`);
    timings.push(result);
    return result;
  });

  const marketJob = timed("All-region market databases", async () => runWorker<any>("master-market-update-worker.js", { workerCount: MARKET_DOWNLOAD_WORKERS }, (message) => {
    if (message?.type === "market-start") {
      emitSource("market", `Downloading ${message.regionCount} market regions across ${message.workerCount} workers…`, 0, message.regionCount);
    } else if (message?.type === "region-complete") {
      marketPercent = Number(message.percent ?? 0);
      emitSource("market", `Market: ${message.completed}/${message.total} regions complete (${message.regionName})`, message.completed, message.total);
    } else if (message?.type === "progress" && message.regionName) {
      emitSource("market", `${message.regionName}: page ${message.pagesDone}/${message.pagesTotal}`);
    }
  })).then((result) => {
    marketPercent = 100;
    if (!result.ok) emitSource("market", `Market download failed: ${result.error}`);
    else emitSource("market", "All-region market databases downloaded and saved.");
    timings.push(result);
    return result;
  });

  let completedTasks = 0;
  const derivedResults: TimedResult[] = [];
  const runDerivedTask = async (task: DerivedTask, workerCount = 1) => {
    const result = await timed(task, () => runWorker<any>("master-derived-worker.js", { task, workerCount }, (message) => {
      if (message?.type === "progress" && message.message) {
        emit({
          running: true,
          stage: `prepare:${task}`,
          message: String(message.message),
          percent: 75 + Math.round((completedTasks / DERIVED_TASKS.length) * 25),
          downloadDurationMs,
          completed: completedTasks,
          total: DERIVED_TASKS.length,
        });
      }
    }));
    derivedResults.push(result);
    timings.push(result);
    completedTasks += 1;
    emit({
      running: true,
      stage: `prepare:${task}`,
      message: result.ok ? `${task} ready (${(result.durationMs / 1000).toFixed(1)}s)` : `${task} failed: ${result.error}`,
      percent: 75 + Math.round((completedTasks / DERIVED_TASKS.length) * 25),
      downloadDurationMs,
      completed: completedTasks,
      total: DERIVED_TASKS.length,
    });
  };

  const sourceResults = await Promise.all([staticJob, characterJob, marketJob]);
  downloadDurationMs = Date.now() - sourceStartedAt;
  emit({
    running: true,
    stage: "downloads-complete",
    message: sourceResults.every((item) => item.ok) ? `All source databases downloaded. Processing the shared snapshot across ${cpuWorkers} cores…` : "Downloads finished with at least one failure. Processing everything that can still be prepared…",
    percent: 75,
    downloadDurationMs,
  });

  // The market snapshot is immutable once the download stage has completed.
  // Full Market/Regional consumes that live snapshot; the remaining jobs only
  // consume CCP static data or their own prepared local index. Run all six
  // independent preparations together so total time follows the longest job,
  // not the sum of six separate worker lifetimes.
  await Promise.all(DERIVED_TASKS.map((task) => runDerivedTask(task, task === "full-market-index" ? cpuWorkers : 1)));

  const totalDurationMs = Date.now() - startedAtMs;
  const failures = timings.filter((item) => !item.ok);
  const result = { cpuWorkers, downloadDurationMs, totalDurationMs, timings, failures };
  emit({
    running: false,
    stage: failures.length ? "complete-with-errors" : "complete",
    message: failures.length ? `Master Update finished with ${failures.length} failed job(s).` : "Master Update complete.",
    percent: 100,
    downloadDurationMs,
    totalDurationMs,
    completed: DERIVED_TASKS.length,
    total: DERIVED_TASKS.length,
  });
  await logEvent("info", "master_update.completed", result);
  return result;
}
