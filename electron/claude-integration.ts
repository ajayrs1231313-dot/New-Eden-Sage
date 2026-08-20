import { app, shell } from "electron";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildClaudeMcpbBuffer } from "./claude-mcpb";

const SERVER_NAME = "new-eden-sage";
const BUNDLE_NAME = "new-eden-sage.mcpb";

export type ClaudeClientStatus = {
  detected: boolean;
  configured: boolean;
  changed?: boolean;
  restartRequired?: boolean;
  installPending?: boolean;
  path?: string;
  bundlePath?: string;
  method?: "mcpb" | "claude-code";
  error?: string;
};

export type ClaudeCompatibilityStatus = {
  desktop: ClaudeClientStatus;
  code: ClaudeClientStatus;
  launch: {
    command: string;
    args: string[];
    env: Record<string, string>;
  };
};

export function sageMcpLaunch() {
  const command = app.getPath("exe");
  const script = path.join(app.getAppPath(), "dist-electron", "mcp-cli.js");
  return {
    command,
    args: [script],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  };
}

function legacyDesktopConfigDirectory() {
  if (process.platform === "win32") {
    const base = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(base, "Claude");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Claude");
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "Claude");
}

async function desktopConfigDirectory() {
  if (process.platform !== "win32") return legacyDesktopConfigDirectory();

  const script = [
    "$p = Get-AppxPackage Claude | Select-Object -First 1",
    "if ($p) {",
    "  $candidate = Join-Path $env:LOCALAPPDATA ('Packages\\' + $p.PackageFamilyName + '\\LocalCache\\Roaming\\Claude')",
    "  if (Test-Path -LiteralPath $candidate) { Write-Output $candidate; exit 0 }",
    "}",
    "exit 1",
  ].join("; ");
  const result = await runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 5000);
  if (result.code === 0) {
    const resolved = result.stdout.split(/\r?\n/).map((value) => value.trim()).find(Boolean);
    if (resolved) return resolved;
  }
  return legacyDesktopConfigDirectory();
}

function desktopBundleDirectory() {
  return path.join(app.getPath("userData"), "mcp", "claude");
}

function desktopBundlePath() {
  return path.join(desktopBundleDirectory(), BUNDLE_NAME);
}

async function prepareClaudeDesktopBundle() {
  const launch = sageMcpLaunch();
  const { buffer, manifest } = buildClaudeMcpbBuffer({
    version: app.getVersion(),
    platform: process.platform,
    launch,
  });
  const directory = desktopBundleDirectory();
  const target = desktopBundlePath();
  const partial = `${target}.${process.pid}.tmp`;
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(partial, buffer);
  await fs.rm(target, { force: true }).catch(() => undefined);
  await fs.rename(partial, target);
  return { path: target, manifest };
}

async function readManifestIfSage(file: string) {
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8")) as { name?: string; display_name?: string };
    return value?.name === SERVER_NAME || value?.display_name === "New Eden Sage";
  } catch {
    return false;
  }
}

async function findInstalledClaudeDesktopExtension() {
  const base = await desktopConfigDirectory();
  const roots = [
    path.join(base, "Claude Extensions"),
    path.join(base, "extensions"),
  ];
  for (const root of roots) {
    let entries: import("node:fs").Dirent[];
    try { entries = await fs.readdir(root, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries.slice(0, 500)) {
      if (!entry.isDirectory()) continue;
      const manifest = path.join(root, entry.name, "manifest.json");
      if (await readManifestIfSage(manifest)) return manifest;
      let nested: import("node:fs").Dirent[];
      try { nested = await fs.readdir(path.join(root, entry.name), { withFileTypes: true }); }
      catch { continue; }
      for (const child of nested.slice(0, 100)) {
        if (!child.isDirectory()) continue;
        const nestedManifest = path.join(root, entry.name, child.name, "manifest.json");
        if (await readManifestIfSage(nestedManifest)) return nestedManifest;
      }
    }
  }
  return "";
}

async function getClaudeDesktopStatus(): Promise<ClaudeClientStatus> {
  const directory = await desktopConfigDirectory();
  let configDirectoryExists = true;
  try { await fs.access(directory); }
  catch { configDirectoryExists = false; }
  const executable = await findClaudeDesktopExecutable().catch(() => "");
  const detected = Boolean(executable) || configDirectoryExists;
  const installedManifest = configDirectoryExists ? await findInstalledClaudeDesktopExtension() : "";
  const prepared = await prepareClaudeDesktopBundle().catch(() => null);
  return {
    detected,
    configured: Boolean(installedManifest),
    path: installedManifest || executable || directory,
    bundlePath: prepared?.path ?? desktopBundlePath(),
    method: "mcpb",
  };
}

async function findClaudeDesktopExecutable() {
  if (process.platform === "win32") {
    // Claude's Microsoft Store/MSIX package does not currently register .mcpb
    // as a Windows file type. Resolve the installed package directly instead.
    const script = [
      "$p = Get-AppxPackage Claude | Select-Object -First 1",
      "if ($p) {",
      "  $candidate = Join-Path $p.InstallLocation 'app\\claude.exe'",
      "  if (Test-Path -LiteralPath $candidate) { Write-Output $candidate; exit 0 }",
      "}",
      "exit 1",
    ].join("; " );
    const result = await runCommand(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      5000,
    );
    if (result.code === 0) {
      const executable = result.stdout.split(/\r?\n/).map((value) => value.trim()).find(Boolean);
      if (executable) return executable;
    }
    return "";
  }

  if (process.platform === "darwin") {
    return "/Applications/Claude.app";
  }

  return "";
}

async function openClaudeDesktopBundle(bundlePath: string) {
  if (process.platform === "win32") {
    const executable = await findClaudeDesktopExecutable();
    if (executable) {
      try {
        const child = spawn(executable, [bundlePath], {
          detached: true,
          stdio: "ignore",
          windowsHide: false,
          env: process.env,
        });
        child.unref();
        return "";
      } catch (error) {
        return error instanceof Error ? error.message : "Claude Desktop could not be launched.";
      }
    }
    return "Claude Desktop is installed but Sage could not resolve its Windows package executable.";
  }

  if (process.platform === "darwin") {
    const result = await runCommand("open", ["-a", "Claude", bundlePath], 5000);
    return result.code === 0 ? "" : (result.stderr.trim() || result.stdout.trim() || "Claude Desktop could not be launched.");
  }

  return shell.openPath(bundlePath);
}

async function ensureClaudeDesktopDirectConfig() {
  const directory = await desktopConfigDirectory();
  const configPath = path.join(directory, "claude_desktop_config.json");
  const launch = sageMcpLaunch();
  let current: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") throw error;
  }

  const existingServers = current.mcpServers && typeof current.mcpServers === "object" && !Array.isArray(current.mcpServers)
    ? current.mcpServers as Record<string, unknown>
    : {};
  const desired = { command: launch.command, args: launch.args, env: launch.env };
  const unchanged = JSON.stringify(existingServers[SERVER_NAME]) === JSON.stringify(desired);
  if (!unchanged) {
    const next = { ...current, mcpServers: { ...existingServers, [SERVER_NAME]: desired } };
    await fs.mkdir(directory, { recursive: true });
    const partial = configPath + "." + process.pid + ".tmp";
    await fs.writeFile(partial, JSON.stringify(next, null, 2) + "\n", "utf8");
    await fs.rename(partial, configPath);
  }
  return { directory, configPath, changed: !unchanged };
}

export async function installClaudeDesktopExtension(): Promise<ClaudeClientStatus> {
  const directory = await desktopConfigDirectory();
  const before = await findInstalledClaudeDesktopExtension();
  const prepared = await prepareClaudeDesktopBundle();

  try {
    const direct = await ensureClaudeDesktopDirectConfig();
    const executable = await findClaudeDesktopExecutable().catch(() => "");
    if (executable) {
      try {
        const child = spawn(executable, [], { detached: true, stdio: "ignore", windowsHide: false, env: process.env });
        child.unref();
      } catch { }
    }
    return {
      detected: Boolean(executable) || Boolean(before),
      configured: true,
      changed: direct.changed,
      installPending: false,
      restartRequired: direct.changed,
      method: "mcpb",
      path: direct.configPath,
      bundlePath: prepared.path,
    };
  } catch {
    // Managed/policy-restricted installs fall back to Claude Desktop Extension install.
  }

  const openError = await openClaudeDesktopBundle(prepared.path);
  if (openError) {
    shell.showItemInFolder(prepared.path);
    return {
      detected: true,
      configured: Boolean(before),
      changed: false,
      installPending: false,
      method: "mcpb",
      path: before || directory,
      bundlePath: prepared.path,
      error: `Sage prepared the Claude extension but could not open Claude automatically (${openError}). In Claude Desktop use Settings > Extensions > Advanced settings > Install Extension and select the highlighted ${BUNDLE_NAME} file.`,
    };
  }
  return {
    detected: true,
    configured: Boolean(before),
    changed: true,
    installPending: true,
    restartRequired: false,
    method: "mcpb",
    path: before || directory,
    bundlePath: prepared.path,
  };
}

function runCommand(command: string, args: string[], timeoutMs = 8000) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: -1, stdout, stderr: `${stderr}\nTimed out.`.trim() });
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: error.message });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function findClaudeCode() {
  const finder = process.platform === "win32" ? "where" : "which";
  const result = await runCommand(finder, ["claude"], 3000);
  if (result.code !== 0) return "";
  return result.stdout.split(/\r?\n/).map((value) => value.trim()).find(Boolean) ?? "";
}

function claudeCodeServerJson() {
  const launch = sageMcpLaunch();
  return JSON.stringify({
    type: "stdio",
    command: launch.command,
    args: launch.args,
    env: launch.env,
  });
}

async function getClaudeCodeStatus(): Promise<ClaudeClientStatus> {
  const executable = await findClaudeCode();
  if (!executable) return { detected: false, configured: false, method: "claude-code" };
  const result = await runCommand(executable, ["mcp", "get", SERVER_NAME], 5000);
  return {
    detected: true,
    configured: result.code === 0,
    method: "claude-code",
    path: executable,
    error: result.code === 0 ? undefined : (result.stderr.trim() || undefined),
  };
}

async function ensureClaudeCode(): Promise<ClaudeClientStatus> {
  const executable = await findClaudeCode();
  if (!executable) return { detected: false, configured: false, method: "claude-code" };
  const existing = await getClaudeCodeStatus();
  const result = await runCommand(
    executable,
    ["mcp", "add-json", "--scope", "user", SERVER_NAME, claudeCodeServerJson()],
    10000,
  );
  if (result.code !== 0) {
    return {
      detected: true,
      configured: existing.configured,
      method: "claude-code",
      path: executable,
      error: result.stderr.trim() || result.stdout.trim() || "Claude Code rejected the MCP configuration.",
    };
  }
  return {
    detected: true,
    configured: true,
    changed: !existing.configured,
    restartRequired: false,
    method: "claude-code",
    path: executable,
  };
}

export async function getClaudeCompatibilityStatus(): Promise<ClaudeCompatibilityStatus> {
  const [desktop, code] = await Promise.all([
    getClaudeDesktopStatus(),
    getClaudeCodeStatus(),
  ]);
  return { desktop, code, launch: sageMcpLaunch() };
}

/** Prepare the Desktop MCP bundle without popping Claude, and keep Claude Code registered. */
export async function ensureClaudeCompatibility(): Promise<ClaudeCompatibilityStatus> {
  const [desktop, code] = await Promise.all([
    getClaudeDesktopStatus(),
    ensureClaudeCode(),
  ]);
  return { desktop, code, launch: sageMcpLaunch() };
}

/** User-initiated install/repair: open the MCPB installer in Claude Desktop and repair Claude Code too. */
export async function installClaudeCompatibility(): Promise<ClaudeCompatibilityStatus> {
  const [desktop, code] = await Promise.all([
    installClaudeDesktopExtension(),
    ensureClaudeCode(),
  ]);
  return { desktop, code, launch: sageMcpLaunch() };
}

export function claudeSetupText() {
  const codeJson = claudeCodeServerJson();
  const claudeCodeCommand = `claude mcp add-json --scope user ${SERVER_NAME} '${codeJson}'`;
  return {
    desktopJson: "Claude Desktop now uses the New Eden Sage MCPB/Desktop Extension installer. Use Install / repair Claude in Sage Settings.",
    claudeCodeCommand,
  };
}
