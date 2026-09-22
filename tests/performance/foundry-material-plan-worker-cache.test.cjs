const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const main = read("electron/main-task9.ts");
const manager = read("electron/foundry-material-plan-manager.ts");
const processSource = read("electron/foundry-material-plan-process.ts");
const guideWorker = read("electron/foundry-material-guide-worker.ts");
const cache = read("electron/foundry-material-cache.ts");
const renderer = read("src/IndustrialProjectFoundry.tsx");

const handlerStart = main.indexOf('ipcMain.handle("industrial:foundry-material-plan"');
const handlerEnd = main.indexOf('ipcMain.handle("industrial:refinery-catalogue"', handlerStart);
assert(handlerStart >= 0 && handlerEnd > handlerStart, "Foundry material-plan IPC handler must exist");
const handler = main.slice(handlerStart, handlerEnd);

assert.match(handler, /getFoundryMaterialPlanCached\(/, "Foundry material plan must delegate to the cache/worker manager");
assert.doesNotMatch(handler, /planRefineryAcquisition\(/, "Refinery acquisition calculation must not run in Electron main");
assert.doesNotMatch(handler, /getPlanetaryAcquisitionGuide\(/, "PI acquisition calculation must not run in Electron main");
assert.doesNotMatch(handler, /buildFoundryT2ComponentGuides\(/, "T2 component calculation must not run in Electron main");

assert.match(manager, /loadPersistedResult<FoundryMaterialCacheEnvelope>/, "Manager must read the persistent disk cache before calculating");
assert.match(manager, /memoryCache = new Map/, "Manager must retain hot material plans in memory across page changes");
assert.match(manager, /inFlight = new Map/, "Manager must deduplicate repeated requests while a calculation is already running");
assert.match(manager, /pageLoadCpuBudget\(\)/, "Foundry calculation must use Sage's all-but-one-core interactive CPU budget");
assert.match(manager, /fork\(path\.join\(__dirname, "foundry-material-plan-process\.js"\)/, "Cache misses must execute in a child process");

assert.match(processSource, /planRefineryAcquisition\(/, "Refinery calculation belongs in the isolated child process");
assert.match(processSource, /new Worker\(path\.join\(__dirname, "foundry-material-guide-worker\.js"\)/, "Acquisition work must use worker threads");
assert.match(processSource, /runTaskQueue\(tasks, workerBudget\)/, "Worker fan-out must be bounded by the full all-but-one-core budget");
assert.match(processSource, /Math\.min\(tasks\.length, Math\.floor\(Number\(workerBudget\)/, "Worker queue must use every useful worker slot up to the CPU budget");
assert.match(guideWorker, /operation: "acquisition" \| "t2"/, "Both acquisition and T2 component work must run in background worker threads");
assert.match(processSource, /savePersistedResult\(FOUNDRY_MATERIAL_CACHE_KIND/, "Completed calculations must be persisted for restart reuse");

assert.match(cache, /staticDataRevision\(\)/, "Cache key must include the installed SDE revision");
assert.match(cache, /marketRevision:/, "Cache key must include the installed market-data revision for buy prices");
assert.match(cache, /requiredMaterials:/, "Cache key must include project material requirements");
assert.match(cache, /componentMaterials:/, "Cache key must include T2 component requirements");
assert.match(cache, /yieldOverride:/, "Cache key must include manual refinery overrides");
assert.match(cache, /skills: snapshot\.skills\.skills/, "Cache key must include relevant refining skills");
assert.match(cache, /implants,/, "Cache key must include refinery implant state");

assert.doesNotMatch(renderer, /Cached in memory/, "Internal cache notes must never be rendered to users");
assert.doesNotMatch(renderer, /Loaded from persistent cache/, "Internal persistent-cache notes must never be rendered to users");
assert.doesNotMatch(renderer, /Calculated off-main using up to/, "Internal worker/core notes must never be rendered to users");
assert.doesNotMatch(renderer, /foundry-material-plan-status/, "Developer material-plan status strip must not exist in the front end");

console.log("Foundry material-plan cache/worker architecture verified.");
