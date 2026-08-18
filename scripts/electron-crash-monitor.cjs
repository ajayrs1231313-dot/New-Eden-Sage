const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const targetPid = Number(arg('pid'));
const sessionId = arg('session', `${new Date().toISOString().replace(/[:.]/g, '-')}-${targetPid || 'unknown'}`);
const appData = process.env.APPDATA || process.env.LOCALAPPDATA || process.cwd();
const logRoot = arg('log-root', path.join(appData, 'new-eden-sage', 'Logs'));
const outputRoot = arg('output-dir', path.join(logRoot, 'Crash Monitor'));
const sessionRoot = path.join(outputRoot, sessionId);
const exitFile = arg('exit-file', path.join(sessionRoot, 'electron-exit.json'));
const controlFile = arg('control-file', path.join(sessionRoot, 'control.json'));
const heartbeatFile = arg('heartbeat-file', path.join(logRoot, 'electron-heartbeat.json'));
const healthLogFile = path.join(logRoot, 'electron-health.jsonl');
const crashLogFile = path.join(logRoot, 'crashes.jsonl');
const appLogFile = path.join(logRoot, 'new-eden-sage.log');
const ioLogFile = arg('io-log', path.join(sessionRoot, 'electron-output.log'));
const monitorLogFile = path.join(sessionRoot, 'monitor.jsonl');
const reportFile = path.join(sessionRoot, 'report.json');
const intervalMs = Math.max(2000, Number(arg('interval-ms', '5000')) || 5000);

if (!Number.isInteger(targetPid) || targetPid <= 0) {
  console.error('[sage-monitor] A valid --pid is required.');
  process.exit(2);
}

fs.mkdirSync(sessionRoot, { recursive: true });

function now() { return new Date().toISOString(); }
function safeJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function appendJson(file, value) {
  try { fs.appendFileSync(file, `${JSON.stringify(value)}\n`, 'utf8'); } catch {}
}
function tailLines(file, count) {
  try {
    const value = fs.readFileSync(file, 'utf8');
    const lines = value.split(/\r?\n/).filter(Boolean);
    return lines.slice(-count);
  } catch { return []; }
}
function recentJsonLines(file, count) {
  return tailLines(file, count).map((line) => { try { return JSON.parse(line); } catch { return { raw: line }; } });
}
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function powershell(script) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 12000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return { status: result.status, stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
}
function parsePowerShellJson(script) {
  const result = powershell(script);
  if (!result.stdout) return { data: null, error: result.stderr || null };
  try { return { data: JSON.parse(result.stdout), error: result.stderr || null }; }
  catch { return { data: null, error: `Could not parse PowerShell JSON: ${result.stdout.slice(0, 1000)}` }; }
}

function processSnapshot() {
  if (process.platform !== 'win32') return { unsupported: true };
  const script = `
$root=${targetPid}
$all=@(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue)
$ids=New-Object 'System.Collections.Generic.HashSet[int]'
[void]$ids.Add($root)
$changed=$true
while($changed){
  $changed=$false
  foreach($p in $all){
    if($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)){
      [void]$ids.Add([int]$p.ProcessId); $changed=$true
    }
  }
}
$rows=@()
foreach($p in $all | Where-Object {$ids.Contains([int]$_.ProcessId)}){
  $gp=Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
  $type='main'
  if($p.CommandLine -match '--type=([^ ]+)'){ $type=$Matches[1] }
  $rows += [pscustomobject]@{
    pid=[int]$p.ProcessId; parentPid=[int]$p.ParentProcessId; type=$type;
    workingSet=if($gp){[int64]$gp.WorkingSet64}else{$null};
    privateMemory=if($gp){[int64]$gp.PrivateMemorySize64}else{$null};
    cpuSeconds=if($gp){[double]$gp.CPU}else{$null};
    handles=if($gp){[int]$gp.HandleCount}else{$null};
    commandLine=[string]$p.CommandLine
  }
}
$otherRoots=@($all | Where-Object {$_.CommandLine -match [regex]::Escape('${process.cwd().replace(/'/g, "''")}') -and $_.CommandLine -match '\\.\s+--dev' -and $_.CommandLine -notmatch '--type=' -and [int]$_.ProcessId -ne $root} | ForEach-Object {[int]$_.ProcessId})
[pscustomobject]@{processes=$rows; otherProjectElectronRoots=$otherRoots} | ConvertTo-Json -Compress -Depth 5
`;
  const parsed = parsePowerShellJson(script);
  return parsed.data ?? { error: parsed.error };
}

function gpuBaseline() {
  if (process.platform !== 'win32') return null;
  return parsePowerShellJson(`Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | Select-Object Name,DriverVersion,DriverDate,Status,AdapterRAM,PNPDeviceID | ConvertTo-Json -Compress -Depth 4`).data;
}

function windowsEvents(seconds = 150) {
  if (process.platform !== 'win32') return [];
  const script = `
$start=(Get-Date).AddSeconds(-${seconds})
$events=@()
$events += Get-WinEvent -FilterHashtable @{LogName='Application';StartTime=$start} -ErrorAction SilentlyContinue | Where-Object {$_.ProviderName -in @('Application Error','Windows Error Reporting') -or $_.Message -match 'electron|New Eden Sage'}
$events += Get-WinEvent -FilterHashtable @{LogName='System';StartTime=$start} -ErrorAction SilentlyContinue | Where-Object {$_.ProviderName -match 'Display|nvlddmkm|DxgKrnl|WHEA' -or $_.Id -eq 4101}
$events | Sort-Object TimeCreated | Select-Object TimeCreated,LogName,ProviderName,Id,LevelDisplayName,Message | ConvertTo-Json -Compress -Depth 4
`;
  const parsed = parsePowerShellJson(script);
  if (!parsed.data) return [];
  return Array.isArray(parsed.data) ? parsed.data : [parsed.data];
}

function dumpFiles() {
  if (process.platform !== 'win32') return [];
  const root = path.join(appData, 'new-eden-sage');
  const escaped = root.replace(/'/g, "''");
  const parsed = parsePowerShellJson(`Get-ChildItem '${escaped}' -Recurse -File -Filter *.dmp -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 20 FullName,Length,LastWriteTime | ConvertTo-Json -Compress -Depth 3`);
  if (!parsed.data) return [];
  return Array.isArray(parsed.data) ? parsed.data : [parsed.data];
}

function classify(report) {
  const reasons = [];
  const crashEvents = report.recentCrashes || [];
  const windows = report.windowsEvents || [];
  const io = (report.electronOutputTail || []).join('\n');
  if (crashEvents.some((row) => row.event === 'electron.child_process_gone' && String(row.type).toUpperCase() === 'GPU')) {
    reasons.push({ kind: 'electron-gpu-process', confidence: 95, detail: 'Electron recorded one or more GPU child-process crashes.' });
  }
  if (windows.some((row) => String(row.ProviderName || '').match(/Display|nvlddmkm|DxgKrnl/i) && (Number(row.Id) === 4101 || String(row.Message || '').match(/stopped responding|recovered|reset|TDR/i)))) {
    reasons.push({ kind: 'windows-display-driver-reset', confidence: 100, detail: 'Windows recorded a display-driver reset/recovery in the crash window.' });
  }
  if (crashEvents.some((row) => row.event === 'renderer.process_gone')) {
    const rows = crashEvents.filter((row) => row.event === 'renderer.process_gone');
    reasons.push({ kind: 'renderer-process', confidence: 90, detail: `Renderer process loss recorded: ${rows.map((row) => `${row.reason || 'unknown'}:${row.exitCode ?? '?'}`).join(', ')}` });
  }
  if (crashEvents.some((row) => row.event === 'process.uncaught_exception' || row.event === 'process.unhandled_rejection')) {
    reasons.push({ kind: 'javascript-main-process', confidence: 90, detail: 'Main-process exception/rejection was recorded near the exit.' });
  }
  if (/gpu|direct3d|d3d|angle|vulkan|device removed|device lost|nvlddmkm/i.test(io)) {
    reasons.push({ kind: 'chromium-gpu-diagnostic', confidence: 80, detail: 'Electron/Chromium stderr contains GPU/graphics diagnostic text.' });
  }
  const health = report.healthTail || [];
  const maxRssKiB = health.reduce((max, row) => Math.max(max, Number(row?.processMemory?.workingSetSize || row?.processMemory?.residentSet || 0)), 0);
  if (maxRssKiB > 2.5 * 1024 * 1024) reasons.push({ kind: 'memory-pressure', confidence: 70, detail: `Main-process working set exceeded ${(maxRssKiB / 1024 / 1024).toFixed(1)} GiB.` });
  if (!reasons.length) reasons.push({ kind: 'unknown', confidence: 20, detail: 'No single cause was proven; inspect the captured process, event, health and stderr evidence.' });
  return reasons.sort((a, b) => b.confidence - a.confidence);
}

const baseline = {
  timestamp: now(),
  event: 'monitor.started',
  sessionId,
  targetPid,
  platform: process.platform,
  node: process.version,
  gpu: gpuBaseline(),
};
appendJson(monitorLogFile, baseline);
console.log(`[sage-monitor] monitoring Electron PID ${targetPid} (${sessionId})`);

let stopped = false;
let sampling = false;
const seenCrashEvents = new Set();
const incidentEvents = new Set([
  'electron.child_process_gone',
  'renderer.process_gone',
  'renderer.unresponsive',
  'renderer.javascript_error',
  'process.uncaught_exception',
  'process.unhandled_rejection',
  'master_update.crashed',
]);

function crashSignature(row) {
  return [row?.timestamp, row?.event, row?.pid, row?.type, row?.reason, row?.exitCode].join('|');
}

function captureIncidents(processTree, heartbeat) {
  const sessionStartMs = Date.parse(baseline.timestamp) - 1000;
  const rows = recentJsonLines(crashLogFile, 100).filter((row) =>
    incidentEvents.has(String(row?.event || '')) &&
    Number(row?.pid || 0) === targetPid &&
    (!row?.timestamp || Date.parse(row.timestamp) >= sessionStartMs)
  );
  for (const row of rows) {
    const signature = crashSignature(row);
    if (seenCrashEvents.has(signature)) continue;
    seenCrashEvents.add(signature);
    const incident = {
      capturedAt: now(),
      sessionId,
      targetPid,
      trigger: row,
      heartbeat,
      processTree,
      electronOutputTail: tailLines(ioLogFile, 160),
      windowsEvents: windowsEvents(100),
      crashDumps: dumpFiles(),
    };
    incident.diagnosis = classify({
      recentCrashes: [row],
      windowsEvents: incident.windowsEvents,
      electronOutputTail: incident.electronOutputTail,
      healthTail: heartbeat ? [heartbeat] : [],
    });
    const safeEvent = String(row.event).replace(/[^a-z0-9_.-]+/gi, '-');
    const file = path.join(sessionRoot, 'incident-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + safeEvent + '.json');
    try { fs.writeFileSync(file, JSON.stringify(incident, null, 2), 'utf8'); } catch {}
    appendJson(monitorLogFile, { timestamp: now(), event: 'monitor.incident', incidentFile: file, trigger: row, diagnosis: incident.diagnosis });
    console.log('[sage-monitor] captured ' + row.event + ' for Electron PID ' + targetPid + ': ' + file);
  }
}

function sample() {
  if (sampling || stopped) return;
  sampling = true;
  try {
    const heartbeat = safeJson(heartbeatFile);
    const processTree = processSnapshot();
    appendJson(monitorLogFile, {
      timestamp: now(),
      event: 'monitor.sample',
      targetAlive: pidAlive(targetPid),
      heartbeat,
      processTree,
    });
    captureIncidents(processTree, heartbeat);
  } finally {
    sampling = false;
  }
}

async function finish() {
  if (stopped) return;
  stopped = true;
  clearInterval(timer);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const exit = safeJson(exitFile);
  const control = safeJson(controlFile);
  const sessionStartMs = Date.parse(baseline.timestamp) - 5000;
  const recentCrashes = recentJsonLines(crashLogFile, 240).filter((row) => (!row?.timestamp || Date.parse(row.timestamp) >= sessionStartMs) && (!row?.pid || Number(row.pid) === targetPid));
  const appTail = recentJsonLines(appLogFile, 240).filter((row) => (!row?.timestamp || Date.parse(row.timestamp) >= sessionStartMs) && (!row?.pid || Number(row.pid) === targetPid));
  const healthTail = recentJsonLines(healthLogFile, 240).filter((row) => (!row?.timestamp || Date.parse(row.timestamp) >= sessionStartMs) && (!row?.mainPid || Number(row.mainPid) === targetPid));
  const report = {
    generatedAt: now(),
    sessionId,
    targetPid,
    expectedExit: Boolean(control?.expected || exit?.expected),
    control,
    exit,
    gpuBaseline: baseline.gpu,
    lastHeartbeat: safeJson(heartbeatFile),
    recentCrashes,
    appLogTail: appTail,
    healthTail,
    monitorTail: recentJsonLines(monitorLogFile, 120),
    electronOutputTail: tailLines(ioLogFile, 240),
    windowsEvents: windowsEvents(),
    crashDumps: dumpFiles(),
  };
  report.diagnosis = classify(report);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8');
  appendJson(monitorLogFile, { timestamp: now(), event: 'monitor.finished', reportFile, diagnosis: report.diagnosis, expectedExit: report.expectedExit });
  console.log(`[sage-monitor] Electron PID ${targetPid} ended. Report: ${reportFile}`);
  process.exit(0);
}

sample();
const timer = setInterval(() => {
  if (!pidAlive(targetPid)) void finish();
  else sample();
}, intervalMs);

process.on('SIGINT', () => void finish());
process.on('SIGTERM', () => void finish());
