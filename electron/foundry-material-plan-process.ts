import path from "node:path";
import { Worker } from "node:worker_threads";
import { planRefineryAcquisition } from "./refinery-engine";
import {
  attachFoundryAcquisitionGuides,
  attachFoundryPurchaseCosts,
  type FoundryAcquisitionReach,
  type FoundryBaseMaterial,
} from "./foundry-material-acquisition";
import {
  FOUNDRY_MATERIAL_CACHE_KIND,
  FOUNDRY_MATERIAL_CACHE_SCHEMA,
  type FoundryMaterialCalculationInput,
} from "./foundry-material-cache";
import { savePersistedResult } from "./persistent-result-cache";

type FoundryMaterialProcessInput = {
  calculation: FoundryMaterialCalculationInput;
  cacheKey: unknown;
  workerCount: number;
};

type WorkerTask = {
  operation: "acquisition" | "t2";
  materials: FoundryBaseMaterial[];
  selectedReach?: FoundryAcquisitionReach;
};

function sendAndExit(message: unknown) {
  if (typeof process.send !== "function") {
    process.exitCode = 1;
    return;
  }
  process.send(message, () => {
    if (process.connected) process.disconnect?.();
  });
}

function runGuideTask(task: WorkerTask, requestId: number) {
  return new Promise<any[]>((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "foundry-material-guide-worker.js"), {
      name: `new-eden-sage-foundry-${task.operation}-${requestId}`,
      env: process.env,
      resourceLimits: { maxOldGenerationSizeMb: 768, maxYoungGenerationSizeMb: 64 },
    });
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      worker.removeAllListeners();
      void worker.terminate().catch(() => undefined);
      callback();
    };
    worker.on("message", (message: any) => {
      if (Number(message?.requestId) !== requestId) return;
      if (message?.type === "error") {
        finish(() => reject(new Error(String(message.error ?? "Foundry guide worker failed."))));
        return;
      }
      if (message?.type === "complete") {
        finish(() => resolve(Array.isArray(message.result) ? message.result : []));
      }
    });
    worker.once("error", (error) => finish(() => reject(error)));
    worker.once("exit", (code) => {
      if (!settled && code !== 0) finish(() => reject(new Error(`Foundry guide worker exited with code ${code}.`)));
    });
    worker.postMessage({
      requestId,
      operation: task.operation,
      materials: task.materials,
      selectedReach: task.selectedReach,
    });
  });
}

function splitIntoChunks<T>(rows: T[], count: number) {
  const chunks = Array.from({ length: Math.max(1, count) }, () => [] as T[]);
  for (let index = 0; index < rows.length; index += 1) chunks[index % chunks.length].push(rows[index]);
  return chunks.filter((chunk) => chunk.length > 0);
}

function allocateSlots(acquisitionItems: number, componentItems: number, workerBudget: number) {
  const budget = Math.max(1, Math.floor(Number(workerBudget) || 1));
  if (!acquisitionItems) return { acquisition: 0, components: Math.min(componentItems, budget) };
  if (!componentItems) return { acquisition: Math.min(acquisitionItems, budget), components: 0 };
  if (budget === 1) return { acquisition: 1, components: 1 };

  const total = acquisitionItems + componentItems;
  let acquisition = Math.max(1, Math.min(acquisitionItems, Math.round((budget * acquisitionItems) / total)));
  let components = Math.max(1, Math.min(componentItems, budget - acquisition));

  while (acquisition + components > budget) {
    if (acquisition > components && acquisition > 1) acquisition -= 1;
    else if (components > 1) components -= 1;
    else break;
  }
  while (acquisition + components < budget) {
    const acquisitionRoom = acquisition < acquisitionItems;
    const componentRoom = components < componentItems;
    if (!acquisitionRoom && !componentRoom) break;
    if (acquisitionRoom && (!componentRoom || acquisitionItems / Math.max(1, acquisition) >= componentItems / Math.max(1, components))) acquisition += 1;
    else components += 1;
  }
  return { acquisition, components };
}

async function runTaskQueue(tasks: WorkerTask[], workerBudget: number) {
  if (!tasks.length) return [] as any[][];
  const concurrency = Math.max(1, Math.min(tasks.length, Math.floor(Number(workerBudget) || 1)));
  const results = new Array<any[]>(tasks.length);
  let cursor = 0;

  const runners = Array.from({ length: concurrency }, async (_, runnerIndex) => {
    while (true) {
      const taskIndex = cursor;
      cursor += 1;
      if (taskIndex >= tasks.length) return;
      results[taskIndex] = await runGuideTask(tasks[taskIndex], taskIndex + 1 + runnerIndex * 10_000);
    }
  });
  await Promise.all(runners);
  return results;
}

async function parallelFoundryGuides(
  materials: FoundryBaseMaterial[],
  componentMaterials: FoundryBaseMaterial[],
  selectedReach: FoundryAcquisitionReach,
  requestedWorkers: number,
) {
  const workerBudget = Math.max(1, Math.floor(Number(requestedWorkers) || 1));
  const slots = allocateSlots(materials.length, componentMaterials.length, workerBudget);
  const tasks: WorkerTask[] = [
    ...splitIntoChunks(materials, Math.max(1, slots.acquisition)).map((chunk) => ({
      operation: "acquisition" as const,
      materials: chunk,
    })),
    ...splitIntoChunks(componentMaterials, Math.max(1, slots.components)).map((chunk) => ({
      operation: "t2" as const,
      materials: chunk,
      selectedReach,
    })),
  ].filter((task) => task.materials.length > 0);

  const resultGroups = await runTaskQueue(tasks, workerBudget);
  const acquisitionGuides: any[] = [];
  const t2ComponentGuides: any[] = [];
  for (let index = 0; index < tasks.length; index += 1) {
    if (tasks[index].operation === "t2") t2ComponentGuides.push(...(resultGroups[index] ?? []));
    else acquisitionGuides.push(...(resultGroups[index] ?? []));
  }
  return { acquisitionGuides: acquisitionGuides.filter(Boolean), t2ComponentGuides: t2ComponentGuides.filter(Boolean) };
}

async function calculate(input: FoundryMaterialProcessInput) {
  const calculation = input.calculation;
  const plan = await planRefineryAcquisition({
    snapshot: calculation.snapshot,
    requiredMaterials: calculation.requiredMaterials,
    facility: calculation.facility,
    rig: calculation.rig,
    security: calculation.security,
    miningReach: calculation.miningReach,
    implant: "auto",
    yieldOverride: calculation.yieldOverride,
  });

  const materials = (plan.nonOreMaterials ?? []).map((row: any) => ({
    typeId: Number(row.typeId),
    name: String(row.name ?? `Type ${row.typeId}`),
    required: Math.max(0, Math.ceil(Number(row.required ?? 0))),
  }));
  const componentMaterials = (calculation.componentMaterials ?? []).map((row) => ({
    typeId: Number(row.typeId),
    name: String(row.name ?? `Type ${row.typeId}`),
    required: Math.max(0, Math.ceil(Number(row.required ?? 0))),
  }));

  const { acquisitionGuides, t2ComponentGuides } = await parallelFoundryGuides(
    materials,
    componentMaterials,
    calculation.miningReach,
    input.workerCount,
  );
  const guidedPlan = attachFoundryAcquisitionGuides(plan, [...acquisitionGuides, ...t2ComponentGuides]);
  const result = await attachFoundryPurchaseCosts(guidedPlan);

  await savePersistedResult(FOUNDRY_MATERIAL_CACHE_KIND, input.cacheKey, {
    schema: FOUNDRY_MATERIAL_CACHE_SCHEMA,
    generatedAt: new Date().toISOString(),
    workerBudget: Math.max(1, Math.floor(Number(input.workerCount) || 1)),
    result,
  });

  return result;
}

process.once("message", (message) => {
  void calculate(message as FoundryMaterialProcessInput)
    .then((result) => sendAndExit({ type: "complete", result }))
    .catch((error) => sendAndExit({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    }));
});
