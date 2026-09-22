import { createHash } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { USER_DATA_ROOT } from "./data-paths";
import { pageLoadCpuBudget } from "./interactive-processing-policy";
import { logEvent } from "./logger";
import { loadPersistedResult } from "./persistent-result-cache";
import {
  FOUNDRY_MATERIAL_CACHE_KIND,
  FOUNDRY_MATERIAL_CACHE_SCHEMA,
  foundryMaterialCacheKey,
  foundryRefinerySnapshot,
  type FoundryMaterialCacheEnvelope,
  type FoundryMaterialCalculationInput,
} from "./foundry-material-cache";

type CacheSource = "memory" | "disk" | "calculated";
type FoundryMaterialPlanResult = {
  result: any;
  cacheSource: CacheSource;
  workerBudget: number;
};

const memoryCache = new Map<string, any>();
const inFlight = new Map<string, Promise<FoundryMaterialPlanResult>>();
const activeChildren = new Set<ChildProcess>();
let calculationQueue: Promise<void> = Promise.resolve();

function tokenFor(key: unknown) {
  return createHash("sha256").update(JSON.stringify(key)).digest("hex");
}

function remember(token: string, value: any) {
  if (memoryCache.has(token)) memoryCache.delete(token);
  memoryCache.set(token, value);
  while (memoryCache.size > 24) {
    const first = memoryCache.keys().next().value;
    if (!first) break;
    memoryCache.delete(first);
  }
}

function runFoundryMaterialProcess(
  calculation: FoundryMaterialCalculationInput,
  cacheKey: unknown,
  workerBudget: number,
) {
  return new Promise<any>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = fork(path.join(__dirname, "foundry-material-plan-process.js"), [], {
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

    activeChildren.add(child);
    let settled = false;
    let stderr = "";
    let timeout: NodeJS.Timeout | undefined;
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = `${stderr}${String(chunk)}`.slice(-6_000);
    });

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      activeChildren.delete(child);
      if (timeout) clearTimeout(timeout);
      child.removeAllListeners("message");
      child.removeAllListeners("error");
      child.removeAllListeners("exit");
      try {
        if (child.connected) child.disconnect();
      } catch {
        // IPC can already be closed by the worker process.
      }
      if (child.exitCode === null && child.signalCode === null) child.kill();
      callback();
    };

    timeout = setTimeout(
      () => finish(() => reject(new Error("Foundry material calculation timed out after 10 minutes."))),
      10 * 60_000,
    );
    timeout.unref();

    child.on("message", (message: any) => {
      if (message?.type === "complete") {
        finish(() => resolve(message.result));
        return;
      }
      if (message?.type === "error") {
        finish(() => reject(new Error(String(message.error ?? "Foundry material calculation failed."))));
      }
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code, signal) => {
      if (!settled) {
        finish(() => reject(new Error(
          `Foundry material process exited before completion (${code ?? signal ?? "unknown"}).${stderr ? " " + stderr : ""}`,
        )));
      }
    });
    child.once("spawn", () => {
      child.send?.({ calculation, cacheKey, workerCount: workerBudget }, (error) => {
        if (error) finish(() => reject(error));
      });
    });
  });
}

async function calculateQueued(
  calculation: FoundryMaterialCalculationInput,
  cacheKey: unknown,
  workerBudget: number,
) {
  const queued = calculationQueue.then(
    () => runFoundryMaterialProcess(calculation, cacheKey, workerBudget),
    () => runFoundryMaterialProcess(calculation, cacheKey, workerBudget),
  );
  calculationQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

export async function getFoundryMaterialPlanCached(input: FoundryMaterialCalculationInput): Promise<FoundryMaterialPlanResult> {
  const cacheKey = await foundryMaterialCacheKey(input);
  const token = tokenFor(cacheKey);
  const workerBudget = pageLoadCpuBudget();

  const memory = memoryCache.get(token);
  if (memory) {
    return { result: memory, cacheSource: "memory", workerBudget };
  }

  const existing = inFlight.get(token);
  if (existing) return existing;

  const promise = (async () => {
    const cached = await loadPersistedResult<FoundryMaterialCacheEnvelope>(FOUNDRY_MATERIAL_CACHE_KIND, cacheKey);
    if (cached?.schema === FOUNDRY_MATERIAL_CACHE_SCHEMA && cached.result) {
      remember(token, cached.result);
      return {
        result: cached.result,
        cacheSource: "disk" as const,
        workerBudget: Number(cached.workerBudget ?? workerBudget),
      };
    }

    const calculation: FoundryMaterialCalculationInput = {
      ...input,
      snapshot: foundryRefinerySnapshot(input.snapshot),
      requiredMaterials: (input.requiredMaterials ?? []).map((row) => ({
        typeId: Number(row.typeId),
        name: String(row.name ?? ""),
        required: Math.max(0, Math.ceil(Number(row.required ?? 0))),
      })),
      componentMaterials: (input.componentMaterials ?? []).map((row) => ({
        typeId: Number(row.typeId),
        name: String(row.name ?? ""),
        required: Math.max(0, Math.ceil(Number(row.required ?? 0))),
      })),
    };

    const startedAt = Date.now();
    const result = await calculateQueued(calculation, cacheKey, workerBudget);
    remember(token, result);
    void logEvent("info", "foundry.material_plan_calculated", {
      durationMs: Date.now() - startedAt,
      workerBudget,
      materialTypes: calculation.requiredMaterials.length,
      cacheToken: token.slice(0, 12),
    });
    return { result, cacheSource: "calculated" as const, workerBudget };
  })().finally(() => {
    inFlight.delete(token);
  });

  inFlight.set(token, promise);
  return promise;
}

export function getFoundryMaterialPlanCacheStatus() {
  return {
    memoryEntries: memoryCache.size,
    inFlight: inFlight.size,
    activeProcesses: activeChildren.size,
    workerBudget: pageLoadCpuBudget(),
  };
}

export async function disposeFoundryMaterialPlanProcesses() {
  const children = [...activeChildren];
  activeChildren.clear();
  await Promise.all(children.map(async (child) => {
    try {
      if (child.connected) child.disconnect();
    } catch {
      // already disconnected
    }
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }));
}
