import { USER_DATA_ROOT } from "./data-paths";
import { app, safeStorage } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

type TunnelConfig = { tunnelId: string; encryptedRuntimeKey: string };

let tunnelProcess: ChildProcess | null = null;

function runtimeRoot() {
  return path.join(process.env.LOCALAPPDATA || USER_DATA_ROOT, "NewEdenSageMcp");
}

function configPath() {
  return path.join(USER_DATA_ROOT, "mcp-tunnel.json");
}

function tunnelExecutable() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "tunnel-client", "tunnel-client.exe")
    : path.join(app.getAppPath(), "vendor", "tunnel-client", "tunnel-client.exe");
}

async function readTunnelConfig(): Promise<TunnelConfig | null> {
  try {
    const value = JSON.parse(await fs.readFile(configPath(), "utf8")) as TunnelConfig;
    return value.tunnelId && value.encryptedRuntimeKey ? value : null;
  } catch {
    return null;
  }
}

async function runClient(args: string[], runtimeKey?: string) {
  return new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn(tunnelExecutable(), args, {
      windowsHide: true,
      env: {
        ...process.env,
        ...(runtimeKey ? { CONTROL_PLANE_API_KEY: runtimeKey } : {}),
      },
    });
    let output = "";
    child.stdout?.on("data", (chunk) => (output += String(chunk)));
    child.stderr?.on("data", (chunk) => (output += String(chunk)));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code: code ?? 1, output }));
  });
}

async function resolveMcpNodeRuntime() {
  const explicit = process.env.NEW_EDEN_SAGE_MCP_NODE?.trim();
  const pathCandidates = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory.replace(/^"|"$/g, ""), "node.exe"));
  const candidates = [
    explicit,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "nodejs", "node.exe") : undefined,
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"]!, "nodejs", "node.exe") : undefined,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "nodejs", "node.exe") : undefined,
    ...pathCandidates,
  ].filter((value): value is string => Boolean(value));
  for (const candidate of [...new Set(candidates)]) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch { /* Try the next Node runtime. */ }
  }
  return null;
}

async function writeLauncher() {
  const root = runtimeRoot();
  await fs.mkdir(root, { recursive: true });
  const launcher = path.join(root, "sage-mcp.cmd");
  const nodeRuntime = await resolveMcpNodeRuntime();
  const executable = nodeRuntime ?? app.getPath("exe");
  const script = path.join(app.getAppPath(), "dist-electron", "mcp-cli.js");
  const runtimeEnv = nodeRuntime ? "" : "set ELECTRON_RUN_AS_NODE=1\r\n";
  await fs.writeFile(
    launcher,
    `@echo off\r\n${runtimeEnv}"${executable}" "${script}"\r\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return launcher.replaceAll("\\", "/");
}

function decryptRuntimeKey(config: TunnelConfig) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows secure storage is unavailable.");
  return safeStorage.decryptString(Buffer.from(config.encryptedRuntimeKey, "base64"));
}

export async function getMcpTunnelStatus() {
  const config = await readTunnelConfig();
  const healthFile = path.join(runtimeRoot(), "health.url");
  let healthUrl = "";
  let ready = false;
  try {
    healthUrl = (await fs.readFile(healthFile, "utf8")).trim();
    const response = await fetch(`${healthUrl}/readyz`, { signal: AbortSignal.timeout(1500) });
    ready = response.ok;
  } catch {
    ready = false;
  }
  return { configured: Boolean(config), tunnelId: config?.tunnelId ?? "", running: Boolean(tunnelProcess && !tunnelProcess.killed), ready, healthUrl };
}

export async function configureAndStartMcpTunnel(input: { tunnelId: string; runtimeKey: string }) {
  const tunnelId = input.tunnelId.trim();
  const runtimeKey = input.runtimeKey.trim();
  if (!/^tunnel_[a-zA-Z0-9]+$/.test(tunnelId)) throw new Error("Enter a valid OpenAI tunnel ID.");
  if (!runtimeKey) throw new Error("Enter the OpenAI runtime API key for this tunnel.");
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows secure storage is unavailable.");
  await fs.mkdir(path.dirname(configPath()), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify({ tunnelId, encryptedRuntimeKey: safeStorage.encryptString(runtimeKey).toString("base64") }, null, 2), { encoding: "utf8", mode: 0o600 });
  return startMcpTunnel();
}

export async function startMcpTunnel() {
  const config = await readTunnelConfig();
  if (!config) return { configured: false, running: false, ready: false, tunnelId: "", healthUrl: "" };
  const existing = await getMcpTunnelStatus();
  if (existing.ready) return existing;
  const root = runtimeRoot();
  const profileDir = path.join(root, "profiles");
  const healthFile = path.join(root, "health.url");
  await fs.mkdir(profileDir, { recursive: true });
  await fs.rm(healthFile, { force: true });
  const launcher = await writeLauncher();
  const initialized = await runClient(["init", "--sample", "sample_mcp_stdio_local", "--profile", "new-eden-sage", "--profile-dir", profileDir, "--tunnel-id", config.tunnelId, "--mcp-command", launcher, "--health-listen-addr", "127.0.0.1:0", "--force"]);
  if (initialized.code !== 0) throw new Error(initialized.output.trim() || "Could not configure the OpenAI tunnel client.");
  const profile = path.join(profileDir, "new-eden-sage.yaml");
  let yaml = await fs.readFile(profile, "utf8");
  yaml = yaml.replace(/# url_file:.*$/m, `url_file: "${healthFile.replaceAll("\\", "/")}"`);
  await fs.writeFile(profile, yaml, { encoding: "utf8", mode: 0o600 });
  const key = decryptRuntimeKey(config);
  // spawn() duplicates/inherits the supplied descriptors for the child. Keep the
  // parent FileHandle objects alive only until spawn returns, then close them
  // explicitly so Electron never relies on GC to release descriptors.
  const stdout = await fs.open(path.join(root, "tunnel.stdout.log"), "a");
  try {
    const stderr = await fs.open(path.join(root, "tunnel.stderr.log"), "a");
    try {
      tunnelProcess = spawn(tunnelExecutable(), ["run", "--profile-dir", profileDir, "--profile", "new-eden-sage"], {
        detached: true,
        windowsHide: true,
        stdio: ["ignore", stdout.fd, stderr.fd],
        env: { ...process.env, CONTROL_PLANE_API_KEY: key },
      });
      tunnelProcess.unref();
    } finally {
      await stderr.close().catch(() => undefined);
    }
  } finally {
    await stdout.close().catch(() => undefined);
  }
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return getMcpTunnelStatus();
}
