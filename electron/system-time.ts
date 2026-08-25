import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";

const execFileAsync = promisify(execFile);

export function getHostClockInfo() {
  const now = new Date();
  return {
    now: now.toISOString(),
    platform: process.platform,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
    offsetMinutes: -now.getTimezoneOffset(),
    hostname: os.hostname(),
  };
}

async function run(target: string, args: string[]) {
  const result = await execFileAsync(target, args, {
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
  return [result.stdout, result.stderr]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

function commandFailureText(error: unknown) {
  const value = error as {
    message?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    code?: unknown;
  };
  return [value?.stderr, value?.stdout, value?.message, value?.code]
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

export function formatClockSyncError(error: unknown) {
  const detail = commandFailureText(error);
  if (/cancelled|canceled|1223|operation was canceled by the user/i.test(detail)) {
    return "Windows administrator approval was cancelled.";
  }
  if (/service has not been started|0x80070426/i.test(detail)) {
    return "Windows Time could not be started. Check that the Windows Time service is enabled.";
  }
  if (/access is denied|access denied|0x80070005/i.test(detail)) {
    return "Windows administrator approval is required to synchronize the clock.";
  }
  if (/no time data was available|0x800705b4/i.test(detail)) {
    return "Windows Time is running, but no network time source responded. Check the internet connection and try again.";
  }
  return "Windows could not synchronize the clock. Check that Windows Time is enabled and try again.";
}

function windowsPowerShellPath() {
  return process.env.SystemRoot
    ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    : "powershell.exe";
}

async function runElevatedPowerShell(script: string) {
  const ps = windowsPowerShellPath();
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const escapedPs = ps.replace(/'/g, "''");
  const command =
    `$p=Start-Process -FilePath '${escapedPs}' -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}') -Verb RunAs -Wait -PassThru; if($null -eq $p.ExitCode){exit 1}; exit $p.ExitCode`;
  await run(ps, [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    command,
  ]);
}

export function windowsClockSyncScript() {
  return [
    "$ErrorActionPreference='Stop'",
    "$service=Get-Service -Name 'W32Time' -ErrorAction Stop",
    "if($service.Status -ne 'Running'){$serviceConfig=Get-CimInstance -ClassName Win32_Service -Filter \"Name='W32Time'\" -ErrorAction SilentlyContinue;if($serviceConfig -and $serviceConfig.StartMode -eq 'Disabled'){Set-Service -Name 'W32Time' -StartupType Manual -ErrorAction Stop};Start-Service -Name 'W32Time' -ErrorAction Stop;$service=Get-Service -Name 'W32Time';$service.WaitForStatus('Running',[TimeSpan]::FromSeconds(15))}",
    "$w32tm=Join-Path $env:SystemRoot 'System32\\w32tm.exe'",
    "& $w32tm /resync",
    "if($LASTEXITCODE -ne 0){& $w32tm /resync /rediscover}",
    "if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}",
    "exit 0",
  ].join("; ");
}

export async function syncHostClock() {
  try {
    if (process.platform === "win32") {
      await runElevatedPowerShell(windowsClockSyncScript());
    } else if (process.platform === "darwin") {
      await run("/usr/bin/osascript", [
        "-e",
        `do shell script "/usr/sbin/systemsetup -setusingnetworktime on > /dev/null 2>&1; /usr/sbin/systemsetup -setnetworktimeserver time.apple.com > /dev/null 2>&1; /usr/bin/sntp -sS time.apple.com" with administrator privileges`,
      ]);
    } else {
      await run("pkexec", ["timedatectl", "set-ntp", "true"]);
      try {
        await run("timedatectl", ["timesync-status"]);
      } catch {
        // Some timedatectl versions do not expose timesync-status.
      }
    }
    return { ok: true, message: "", clock: getHostClockInfo() };
  } catch (error) {
    return { ok: false, message: formatClockSyncError(error), clock: getHostClockInfo() };
  }
}

export async function setHostClock(localDateTime: string) {
  const value = String(localDateTime || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) {
    throw new Error("Enter a valid local date and time.");
  }
  if (process.platform === "win32") {
    const ps = windowsPowerShellPath();
    const command = `$p=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe') -ArgumentList '-NoProfile','-Command','Set-Date -Date ''${value}''' -Verb RunAs -Wait -PassThru; if($p.ExitCode -ne 0){exit $p.ExitCode}`;
    await run(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]);
  } else if (process.platform === "darwin") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new Error("Invalid date/time.");
    const pad = (n: number) => String(n).padStart(2, "0");
    const mac = `${pad(parsed.getMonth() + 1)}${pad(parsed.getDate())}${pad(parsed.getHours())}${pad(parsed.getMinutes())}${String(parsed.getFullYear()).slice(-2)}`;
    await run("/usr/bin/osascript", [
      "-e",
      `do shell script "/bin/date ${mac}" with administrator privileges`,
    ]);
  } else {
    await run("pkexec", ["timedatectl", "set-time", value.replace("T", " ")]);
  }
  return { ok: true, message: "Host clock updated.", clock: getHostClockInfo() };
}
