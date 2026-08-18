import { app } from "electron";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const SERVER_NAME = "new-eden-sage";

export type ClaudeClientStatus = {
  detected: boolean;
  configured: boolean;
  changed?: boolean;
  restartRequired?: boolean;
  path?: string;
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

function desktopConfigDirectory() {
  if (process.platform === "win32") {
    const base = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(base, "Claude");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Claude");
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "Claude");
}

function sameArray(a: unknown, b: string[]) {
  return Array.isArray(a) && a.length === b.length && a.every((value, index) => value === b[index]);
}

function matchesDesktopEntry(entry: unknown, launch = sageMcpLaunch()) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const value = entry as Record<string, unknown>;
  const env = value.env && typeof value.env === "object" && !Array.isArray(value.env)
    ? value.env as Record<string, unknown>
    : {};
  return value.command === launch.command
    && sameArray(value.args, launch.args)
    && env.ELECTRON_RUN_AS_NODE === "1";
}

async function readJsonObject(file: string) {
  const text = await fs.readFile(file, "utf8");
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Configuration root must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

async function getClaudeDesktopStatus(): Promise<ClaudeClientStatus> {
  const directory = desktopConfigDirectory();
  const configPath = path.join(directory, "claude_desktop_config.json");
  try {
    await fs.access(directory);
  } catch {
    return { detected: false, configured: false, path: configPath };
  }
  try {
    const config = await readJsonObject(configPath);
    const servers = config.mcpServers && typeof config.mcpServers === "object" && !Array.isArray(config.mcpServers)
      ? config.mcpServers as Record<string, unknown>
      : {};
    return {
      detected: true,
      configured: matchesDesktopEntry(servers[SERVER_NAME]),
      path: configPath,
    };
  } catch (error) {
    try {
      await fs.access(configPath);
    } catch {
      return { detected: true, configured: false, path: configPath };
    }
    return {
      detected: true,
      configured: false,
      path: configPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function ensureClaudeDesktop(): Promise<ClaudeClientStatus> {
  const directory = desktopConfigDirectory();
  const configPath = path.join(directory, "claude_desktop_config.json");
  try {
    await fs.access(directory);
  } catch {
    return { detected: false, configured: false, path: configPath };
  }

  let config: Record<string, unknown> = {};
  let existed = true;
  try {
    config = await readJsonObject(configPath);
  } catch (error) {
    try {
      await fs.access(configPath);
    } catch {
      existed = false;
    }
    if (existed) {
      return {
        detected: true,
        configured: false,
        path: configPath,
        error: `Claude Desktop configuration is not valid JSON. Sage left it unchanged: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const servers = config.mcpServers && typeof config.mcpServers === "object" && !Array.isArray(config.mcpServers)
    ? { ...(config.mcpServers as Record<string, unknown>) }
    : {};
  const launch = sageMcpLaunch();
  if (matchesDesktopEntry(servers[SERVER_NAME], launch)) {
    return { detected: true, configured: true, changed: false, restartRequired: false, path: configPath };
  }

  servers[SERVER_NAME] = {
    command: launch.command,
    args: launch.args,
    env: launch.env,
  };
  const next = { ...config, mcpServers: servers };
  await fs.mkdir(directory, { recursive: true });

  if (existed) {
    await fs.copyFile(configPath, `${configPath}.sage-backup`).catch(() => undefined);
  }
  const temporary = `${configPath}.sage-${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await fs.rename(temporary, configPath);

  return {
    detected: true,
    configured: true,
    changed: true,
    restartRequired: true,
    path: configPath,
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
  if (!executable) return { detected: false, configured: false };
  const result = await runCommand(executable, ["mcp", "get", SERVER_NAME], 5000);
  return {
    detected: true,
    configured: result.code === 0,
    path: executable,
    error: result.code === 0 ? undefined : (result.stderr.trim() || undefined),
  };
}

async function ensureClaudeCode(): Promise<ClaudeClientStatus> {
  const executable = await findClaudeCode();
  if (!executable) return { detected: false, configured: false };
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
      path: executable,
      error: result.stderr.trim() || result.stdout.trim() || "Claude Code rejected the MCP configuration.",
    };
  }
  return {
    detected: true,
    configured: true,
    changed: !existing.configured,
    restartRequired: false,
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

export async function ensureClaudeCompatibility(): Promise<ClaudeCompatibilityStatus> {
  const [desktop, code] = await Promise.all([
    ensureClaudeDesktop(),
    ensureClaudeCode(),
  ]);
  return { desktop, code, launch: sageMcpLaunch() };
}

export function claudeSetupText() {
  const launch = sageMcpLaunch();
  const desktopJson = JSON.stringify({
    mcpServers: {
      [SERVER_NAME]: {
        command: launch.command,
        args: launch.args,
        env: launch.env,
      },
    },
  }, null, 2);
  const codeJson = claudeCodeServerJson();
  const claudeCodeCommand = `claude mcp add-json --scope user ${SERVER_NAME} '${codeJson}'`;
  return { desktopJson, claudeCodeCommand };
}
