import { app, shell } from "electron";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildClaudeMcpbBuffer } from "./claude-mcpb";

const SERVER_NAME = "new-eden-sage";
const DISPLAY_NAME = "New Eden Sage";
const BUNDLE_NAME = "new-eden-sage.mcpb";

export type ClaudeDesktopState =
  | "not-detected"
  | "ready-to-install"
  | "install-pending"
  | "installed-unverified"
  | "configured-unverified"
  | "restart-required"
  | "verified"
  | "error";

export type ClaudeClientStatus = {
  detected: boolean;
  configured: boolean;
  verified?: boolean;
  state?: ClaudeDesktopState;
  changed?: boolean;
  restartRequired?: boolean;
  installPending?: boolean;
  manualInstallRequired?: boolean;
  extensionInstalled?: boolean;
  directConfigPresent?: boolean;
  running?: boolean;
  verifiedAt?: string;
  evidence?: string;
  path?: string;
  bundlePath?: string;
  configPath?: string;
  logPath?: string;
  method?: "mcpb" | "direct-config" | "claude-code";
  error?: string;
};

export type ClaudeCompatibilityStatus = {
  desktop: ClaudeClientStatus;
  code: ClaudeClientStatus;
  launch: { command: string; args: string[]; env: Record<string, string> };
};

export function sageMcpLaunch() {
  const command = app.getPath("exe");
  const script = path.join(app.getAppPath(), "dist-electron", "mcp-cli.js");
  return { command, args: [script], env: { ELECTRON_RUN_AS_NODE: "1" } };
}

function legacyDesktopConfigDirectory() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Claude");
  }
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Claude");
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "Claude");
}

function runCommand(command: string, args: string[], timeoutMs = 8000) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(command, args, { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stdout = ""; let stderr = ""; let settled = false;
    const finish = (value: { code: number; stdout: string; stderr: string }) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish({ code: -1, stdout, stderr: `${stderr}\nTimed out.`.trim() }); }, timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => finish({ code: -1, stdout, stderr: error.message }));
    child.on("exit", (code) => finish({ code: code ?? -1, stdout, stderr }));
  });
}

async function windowsStoreClaudeDirectories() {
  if (process.platform !== "win32") return [] as string[];
  const ps = process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell.exe";
  const script = "$p=Get-AppxPackage Claude -ErrorAction SilentlyContinue; $p | ForEach-Object { Join-Path $env:LOCALAPPDATA ('Packages\\'+$_.PackageFamilyName+'\\LocalCache\\Roaming\\Claude') }";
  const result = await runCommand(ps, ["-NoProfile", "-NonInteractive", "-Command", script], 5000);
  if (result.code !== 0) return [];
  return result.stdout.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
}

async function desktopConfigDirectories() {
  const store = await windowsStoreClaudeDirectories();
  const values = process.platform === "win32" ? [...store, legacyDesktopConfigDirectory()] : [legacyDesktopConfigDirectory()];
  return [...new Set(values.map(value => path.resolve(value)))];
}

async function pathExists(target: string) { try { await fs.access(target); return true; } catch { return false; } }

async function preferredDesktopConfigDirectory() {
  const directories = await desktopConfigDirectories();
  for (const directory of directories) {
    if (await pathExists(path.join(directory, "extensions-installations.json")) || await pathExists(path.join(directory, "Claude Extensions"))) return directory;
  }
  for (const directory of directories) if (await pathExists(directory)) return directory;
  return directories[0] ?? legacyDesktopConfigDirectory();
}

function desktopBundleDirectory() { return path.join(app.getPath("userData"), "mcp", "claude"); }
function desktopBundlePath() { return path.join(desktopBundleDirectory(), BUNDLE_NAME); }

async function prepareClaudeDesktopBundle() {
  const launch = sageMcpLaunch();
  const { buffer, manifest } = buildClaudeMcpbBuffer({ version: app.getVersion(), platform: process.platform, launch });
  const directory = desktopBundleDirectory(); const target = desktopBundlePath(); const partial = `${target}.${process.pid}.tmp`;
  await fs.mkdir(directory, { recursive: true }); await fs.writeFile(partial, buffer); await fs.rm(target, { force: true }).catch(() => undefined); await fs.rename(partial, target);
  return { path: target, manifest };
}

async function readManifestIfSage(file: string) {
  try { const value = JSON.parse(await fs.readFile(file, "utf8")) as { name?: string; display_name?: string }; return value?.name === SERVER_NAME || value?.display_name === DISPLAY_NAME; }
  catch { return false; }
}

async function findInstalledClaudeDesktopExtension() {
  for (const base of await desktopConfigDirectories()) {
    const roots = [path.join(base, "Claude Extensions"), path.join(base, "extensions")];
    for (const root of roots) {
      let entries: import("node:fs").Dirent[]; try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries.slice(0, 500)) {
        if (!entry.isDirectory()) continue;
        const first = path.join(root, entry.name, "manifest.json"); if (await readManifestIfSage(first)) return first;
        let nested: import("node:fs").Dirent[]; try { nested = await fs.readdir(path.join(root, entry.name), { withFileTypes: true }); } catch { continue; }
        for (const child of nested.slice(0, 100)) { if (!child.isDirectory()) continue; const candidate = path.join(root, entry.name, child.name, "manifest.json"); if (await readManifestIfSage(candidate)) return candidate; }
      }
    }
  }
  return "";
}

async function findClaudeDesktopDirectConfig() {
  for (const directory of await desktopConfigDirectories()) {
    const configPath = path.join(directory, "claude_desktop_config.json");
    try {
      const parsed = JSON.parse(await fs.readFile(configPath, "utf8")) as { mcpServers?: Record<string, unknown> };
      if (parsed?.mcpServers?.[SERVER_NAME]) return configPath;
    } catch { /* absent or invalid is not configured */ }
  }
  return "";
}

async function isClaudeDesktopRunning() {
  if (process.platform === "win32") {
    const ps = process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell.exe";
    const result = await runCommand(ps, ["-NoProfile", "-NonInteractive", "-Command", "$p=Get-Process claude -ErrorAction SilentlyContinue; if($p){exit 0}else{exit 1}"], 3000);
    return result.code === 0;
  }
  const result = await runCommand("pgrep", ["-i", "claude"], 3000).catch(() => ({ code: 1, stdout: "", stderr: "" }));
  return result.code === 0;
}

function lineTimestamp(line: string) {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/); if (!match) return null;
  const ms = Date.parse(match[1]); return Number.isFinite(ms) ? { iso: new Date(ms).toISOString(), ms } : null;
}

async function claudeVerificationEvidence(afterMs: number) {
  type Evidence = { verifiedAt: string; ms: number; logPath: string; evidence: string };
  let best: Evidence | null = null;
  for (const base of await desktopConfigDirectories()) {
    const logRoot = path.join(base, "logs");
    let files: import("node:fs").Dirent[]; try { files = await fs.readdir(logRoot, { withFileTypes: true }); } catch { continue; }
    const candidates = files.filter(entry => entry.isFile() && /^(?:mcp-server-(?:new-eden-sage|New Eden Sage)\.log|mcp\.log)$/i.test(entry.name));
    for (const entry of candidates) {
      const logPath = path.join(logRoot, entry.name); let text = "";
      try { const stat = await fs.stat(logPath); const handle = await fs.open(logPath, "r"); const length = Math.min(stat.size, 512 * 1024); const buffer = Buffer.alloc(length); await handle.read(buffer, 0, length, Math.max(0, stat.size - length)); await handle.close(); text = buffer.toString("utf8"); } catch { continue; }
      let initializedMs = 0; let toolsListMs = 0; let toolsCallMs = 0;
      for (const line of text.split(/\r?\n/)) {
        const stamp = lineTimestamp(line); if (!stamp) continue;
        if (/Message from client: method=["']initialize["']|Message from client: method=\"initialize\"/i.test(line)) initializedMs = Math.max(initializedMs, stamp.ms);
        if (/Message from client: method=["']tools\/list["']|Message from client: method=\"tools\/list\"/i.test(line)) toolsListMs = Math.max(toolsListMs, stamp.ms);
        if (/Message from client: method=["']tools\/call["']|Message from client: method=\"tools\/call\"/i.test(line)) toolsCallMs = Math.max(toolsCallMs, stamp.ms);
      }
      const verifiedMs = toolsListMs >= initializedMs && initializedMs > 0 ? Math.max(toolsListMs, toolsCallMs) : 0;
      if (verifiedMs >= Math.max(0, afterMs - 2000) && (!best || verifiedMs > best.ms)) {
        best = { verifiedAt: new Date(verifiedMs).toISOString(), ms: verifiedMs, logPath, evidence: toolsCallMs >= toolsListMs ? "Claude initialized Sage, listed its tools and called a Sage tool." : "Claude initialized Sage and successfully listed its tools." };
      }
    }
  }
  return best;
}

async function getClaudeDesktopStatus(): Promise<ClaudeClientStatus> {
  const [directories, installedManifest, directConfig, running] = await Promise.all([
    desktopConfigDirectories(), findInstalledClaudeDesktopExtension(), findClaudeDesktopDirectConfig(), isClaudeDesktopRunning().catch(() => false),
  ]);
  const existingDirectory = (await Promise.all(directories.map(async directory => ({ directory, exists: await pathExists(directory) })))).find(row => row.exists)?.directory;
  const detected = Boolean(existingDirectory || installedManifest || directConfig);
  const extensionInstalled = Boolean(installedManifest); const directConfigPresent = Boolean(directConfig); const configured = extensionInstalled || directConfigPresent;
  const method: ClaudeClientStatus["method"] = extensionInstalled ? "mcpb" : directConfigPresent ? "direct-config" : "mcpb";
  const activePath = installedManifest || directConfig;
  let baselineMs = 0; if (activePath) { try { baselineMs = (await fs.stat(activePath)).mtimeMs; } catch {} }
  const proof = configured ? await claudeVerificationEvidence(baselineMs) : null;
  const verified = Boolean(proof);
  const restartRequired = method === "direct-config" && configured && !verified && running;
  const state: ClaudeDesktopState = !detected ? "not-detected" : verified ? "verified" : restartRequired ? "restart-required" : extensionInstalled ? "installed-unverified" : directConfigPresent ? "configured-unverified" : "ready-to-install";
  return {
    detected, configured, verified, state, restartRequired, installPending: false, manualInstallRequired: false,
    extensionInstalled, directConfigPresent, running, verifiedAt: proof?.verifiedAt, evidence: proof?.evidence,
    path: activePath || existingDirectory, configPath: directConfig || path.join(await preferredDesktopConfigDirectory(), "claude_desktop_config.json"), bundlePath: desktopBundlePath(), logPath: proof?.logPath, method,
  };
}

export async function installClaudeDesktopExtension(): Promise<ClaudeClientStatus> {
  const before = await getClaudeDesktopStatus();
  if (!before.detected) return { ...before, error: "Claude Desktop was not detected. Install and open Claude Desktop once, then return here." };
  const prepared = await prepareClaudeDesktopBundle();
  const openError = await shell.openPath(prepared.path);
  if (openError) {
    shell.showItemInFolder(prepared.path);
    return { ...before, verified: false, state: "install-pending", installPending: true, manualInstallRequired: true, bundlePath: prepared.path, method: "mcpb", error: "Windows could not hand the MCPB directly to Claude. The bundle has been highlighted so you can install it manually using Claude Settings > Extensions > Advanced settings > Install Extension." };
  }
  return { ...before, verified: false, state: "install-pending", changed: true, installPending: true, manualInstallRequired: false, bundlePath: prepared.path, method: "mcpb", error: undefined };
}

export async function showClaudeDesktopBundle() {
  const prepared = await prepareClaudeDesktopBundle(); shell.showItemInFolder(prepared.path); return prepared.path;
}

export async function ensureClaudeDesktopDirectConfig() {
  const directory = await preferredDesktopConfigDirectory(); const configPath = path.join(directory, "claude_desktop_config.json"); const launch = sageMcpLaunch();
  let current: Record<string, unknown> = {};
  try { const raw = await fs.readFile(configPath, "utf8"); const parsed = JSON.parse(raw); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed as Record<string, unknown>; }
  catch (error) { if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error; }
  const existingServers = current.mcpServers && typeof current.mcpServers === "object" && !Array.isArray(current.mcpServers) ? current.mcpServers as Record<string, unknown> : {};
  const desired = { command: launch.command, args: launch.args, env: launch.env }; const unchanged = JSON.stringify(existingServers[SERVER_NAME]) === JSON.stringify(desired);
  if (!unchanged) {
    const next = { ...current, mcpServers: { ...existingServers, [SERVER_NAME]: desired } }; await fs.mkdir(directory, { recursive: true });
    const partial = `${configPath}.${process.pid}.tmp`; await fs.writeFile(partial, `${JSON.stringify(next, null, 2)}\n`, "utf8"); await fs.rename(partial, configPath);
  }
  return { directory, configPath, changed: !unchanged };
}

export async function repairClaudeDesktopDirectConfig(): Promise<ClaudeClientStatus> {
  const direct = await ensureClaudeDesktopDirectConfig(); const running = await isClaudeDesktopRunning().catch(() => false);
  const status = await getClaudeDesktopStatus();
  return { ...status, method: "direct-config", configured: true, directConfigPresent: true, changed: direct.changed, restartRequired: direct.changed ? running : status.restartRequired, state: status.verified ? "verified" : direct.changed && running ? "restart-required" : "configured-unverified", configPath: direct.configPath, path: direct.configPath };
}

async function findClaudeCode() {
  const finder = process.platform === "win32" ? "where.exe" : "which"; const result = await runCommand(finder, ["claude"], 3000); if (result.code !== 0) return "";
  return result.stdout.split(/\r?\n/).map(value => value.trim()).find(Boolean) ?? "";
}
function claudeCodeServerJson() { const launch = sageMcpLaunch(); return JSON.stringify({ type: "stdio", command: launch.command, args: launch.args, env: launch.env }); }
async function getClaudeCodeStatus(): Promise<ClaudeClientStatus> {
  const executable = await findClaudeCode(); if (!executable) return { detected: false, configured: false, verified: false, method: "claude-code" };
  const result = await runCommand(executable, ["mcp", "get", SERVER_NAME], 5000);
  return { detected: true, configured: result.code === 0, verified: result.code === 0, method: "claude-code", path: executable, evidence: result.code === 0 ? "Claude Code reports the Sage MCP server at user scope." : undefined, error: result.code === 0 ? undefined : (result.stderr.trim() || undefined) };
}
async function ensureClaudeCode(): Promise<ClaudeClientStatus> {
  const executable = await findClaudeCode(); if (!executable) return { detected: false, configured: false, verified: false, method: "claude-code" };
  const existing = await getClaudeCodeStatus(); if (existing.configured) return existing;
  const result = await runCommand(executable, ["mcp", "add-json", "--scope", "user", SERVER_NAME, claudeCodeServerJson()], 10000);
  if (result.code !== 0) return { detected: true, configured: false, verified: false, method: "claude-code", path: executable, error: result.stderr.trim() || result.stdout.trim() || "Claude Code rejected the MCP configuration." };
  return { detected: true, configured: true, verified: true, changed: true, method: "claude-code", path: executable, evidence: "Claude Code accepted the Sage MCP server at user scope." };
}

export async function getClaudeCompatibilityStatus(): Promise<ClaudeCompatibilityStatus> {
  const [desktop, code] = await Promise.all([getClaudeDesktopStatus(), getClaudeCodeStatus()]); return { desktop, code, launch: sageMcpLaunch() };
}

/** Startup-safe preparation. Desktop is inspected only; no Claude config is silently modified. */
export async function ensureClaudeCompatibility(): Promise<ClaudeCompatibilityStatus> {
  await prepareClaudeDesktopBundle().catch(() => undefined);
  const [desktop, code] = await Promise.all([getClaudeDesktopStatus(), ensureClaudeCode()]); return { desktop, code, launch: sageMcpLaunch() };
}

/** User-initiated path: MCPB/Desktop Extension first. Claude Code remains a separate user-scope registration. */
export async function installClaudeCompatibility(): Promise<ClaudeCompatibilityStatus> {
  const [desktop, code] = await Promise.all([installClaudeDesktopExtension(), ensureClaudeCode()]); return { desktop, code, launch: sageMcpLaunch() };
}

export function claudeSetupText() {
  const codeJson = claudeCodeServerJson();
  return {
    desktopJson: "Recommended: install the New Eden Sage MCPB/Desktop Extension from Sage Settings. Direct claude_desktop_config.json registration is retained only as a repair fallback.",
    claudeCodeCommand: `claude mcp add-json --scope user ${SERVER_NAME} '${codeJson}'`,
  };
}
