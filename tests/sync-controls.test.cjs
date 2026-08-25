const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const systemTime = require(path.join(repoRoot, "dist-electron", "system-time.js"));

const script = systemTime.windowsClockSyncScript();
assert.match(script, /Get-Service -Name 'W32Time'/);
assert.match(script, /Start-Service -Name 'W32Time'/);
assert.match(script, /StartMode -eq 'Disabled'/);
assert.match(script, /WaitForStatus\('Running'/);
assert.match(script, /& \$w32tm \/resync;/);
assert.match(script, /if\(\$LASTEXITCODE -ne 0\)\{& \$w32tm \/resync \/rediscover\}/);
assert.doesNotMatch(script, /\/force/);

assert.equal(
  systemTime.formatClockSyncError({ stderr: "The service has not been started. (0x80070426)" }),
  "Windows Time could not be started. Check that the Windows Time service is enabled.",
);
assert.equal(
  systemTime.formatClockSyncError({ message: "The operation was canceled by the user.", code: 1223 }),
  "Windows administrator approval was cancelled.",
);
assert.doesNotMatch(
  systemTime.formatClockSyncError(new Error("Command failed: powershell.exe -EncodedCommand SECRET")),
  /powershell|EncodedCommand|SECRET/i,
);

const mainSource = fs.readFileSync(path.join(repoRoot, "electron", "main-task9.ts"), "utf8");
const manualHandler = mainSource.match(
  /ipcMain\.handle\("master:update-all"[\s\S]*?return runCompleteSync\([\s\S]*?\n\s*},\s*(true|false),\s*options\);/,
);
assert.ok(manualHandler, "manual Sync All handler should call runCompleteSync explicitly");
assert.equal(manualHandler[1], "false", "manual Sync All must never use the startup version guard");

const automaticCall = mainSource.match(
  /did-finish-load[\s\S]*?runCompleteSync\([\s\S]*?,\s*(true|false),\s*await readSyncPreparationOptions\(\)\);/,
);
assert.ok(automaticCall, "automatic startup sync should remain identifiable");
assert.equal(automaticCall[1], "true", "only automatic startup sync should use the version guard");

const syncStart = mainSource.indexOf("async function runCompleteSync(");
const syncEnd = mainSource.indexOf('\napp.on("render-process-gone"', syncStart);
assert.ok(syncStart >= 0 && syncEnd > syncStart, "runCompleteSync should remain identifiable");
const syncBody = mainSource.slice(syncStart, syncEnd);
assert.doesNotMatch(
  syncBody,
  /runOpportunityAnalysis|runPveLocationAnalysis|runCapabilityAnalysis|runFeaturePrepProcess|prepareIndustrialCommand|stopAnalysisWorkersForExclusiveTask/,
  "Sync All must end at character + shared-market readiness",
);
assert.match(syncBody, /sync_all\.total_ms/, "Sync All should log its acceptance timing");
assert.match(syncBody, /Prepared on demand when Invention is opened/);

const syncResources = require(path.join(repoRoot, "dist-electron", "sync-resources.js"));
assert.equal(syncResources.recommendedMarketDownloadWorkers(6, 16 * 1024 ** 3), 3);
assert.equal(syncResources.recommendedMarketDownloadWorkers(4, 8 * 1024 ** 3), 2);
assert.equal(syncResources.recommendedMarketDownloadWorkers(2, 4 * 1024 ** 3), 1);

const safeMemory = syncResources.syncMemoryHeadroom({
  rssMb: 1_200, heapUsedMb: 400, heapTotalMb: 500, externalMb: 20, arrayBuffersMb: 10,
  freeSystemMb: 4_000, totalSystemMb: 16_384,
});
assert.equal(safeMemory.ok, true);

const pressuredMemory = syncResources.syncMemoryHeadroom({
  rssMb: 3_000, heapUsedMb: 2_500, heapTotalMb: 2_800, externalMb: 20, arrayBuffersMb: 10,
  freeSystemMb: 775, totalSystemMb: 16_384,
});
assert.equal(pressuredMemory.ok, false);

assert.doesNotMatch(mainSource, /inventionPrep\(\)/, "Sync All must not launch Invention preparation");

const rawMarketStorageSource = fs.readFileSync(path.join(repoRoot, "electron", "raw-market-storage.ts"), "utf8");
const recentHistoryStart = rawMarketStorageSource.indexOf("export async function loadRecentRawMarketManifests");
assert.ok(recentHistoryStart >= 0, "raw-market history loader should remain identifiable");
const recentHistorySource = rawMarketStorageSource.slice(recentHistoryStart);
assert.doesNotMatch(recentHistorySource, /fs\.mkdir\(RAW_MARKET_ROOT/, "read-only legacy history lookup must not recreate Raw Orders");
assert.match(recentHistorySource, /ENOENT[\s\S]*?return \[\]/, "missing legacy history should be treated as an empty history set");

const iskLabSource = fs.readFileSync(path.join(repoRoot, "src", "IskLab.tsx"), "utf8");
assert.match(iskLabSource, /setTab\("invention"\)[\s\S]*?scanInvention\(\)/);

console.log("Sync controls and resource policy regression tests passed.");
