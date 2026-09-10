import { execFileSync } from "node:child_process";
import path from "node:path";

function powershellPath() {
  return process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
}

const PROTECT_SCRIPT = `Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=[Text.Encoding]::UTF8.GetBytes($s); $p=[System.Security.Cryptography.ProtectedData]::Protect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($p))`;
const UNPROTECT_SCRIPT = `Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($s); $p=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($p))`;

function invoke(script: string, input: string) {
  if (process.platform !== "win32") throw new Error("Windows DPAPI is only available on Windows.");
  return execFileSync(powershellPath(), ["-NoProfile", "-NonInteractive", "-Command", script], {
    input,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  }).trim();
}

export function protectCurrentUserDpapi(value: string) {
  const protectedValue = invoke(PROTECT_SCRIPT, value);
  if (!protectedValue) throw new Error("Windows DPAPI returned an empty protected value.");
  return protectedValue;
}

export function unprotectCurrentUserDpapi(value: string) {
  const plaintext = invoke(UNPROTECT_SCRIPT, value);
  if (!plaintext) throw new Error("Windows DPAPI returned an empty private-data key.");
  return plaintext;
}
