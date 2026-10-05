import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { USER_DATA_ROOT } from "./data-paths";

const execFileAsync = promisify(execFile);
const OWNER_ACCOUNT_IDS = new Set(["569399317"]);

const DEFAULT_WORKSPACE = path.resolve(
  process.env.NEW_EDEN_SAGE_DEV_WORKSPACE ||
  path.resolve(__dirname, ".."),
);

const BLOCKED_BASENAMES = new Set([
  ".env", ".env.local", ".env.production", ".env.development",
  "credentials", "credentials.json", "secrets.json",
]);

const BLOCKED_SEGMENTS = new Set([
  ".git", ".ssh", ".aws", ".azure", ".config", "AppData",
]);

const ALLOWED_COMMANDS = new Set([
  "git", "npm", "node", "npx", "tsc", "vite", "powershell", "pwsh", "cmd",
]);

async function ownerIdentity() {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(USER_DATA_ROOT, "settings.json"), "utf8")) as Record<string, unknown>;
    const ids = [parsed.sageAccountId, parsed.primaryCharacterId]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    return ids.some((id) => OWNER_ACCOUNT_IDS.has(id));
  } catch {
    return false;
  }
}

export async function assertDevelopmentWorkspaceOwner() {
  if (!(await ownerIdentity())) {
    throw new Error("The development workspace is restricted to the Sage owner account.");
  }
}

function workspaceRoot() {
  return DEFAULT_WORKSPACE;
}

function checkBlocked(relative: string) {
  const parts = relative.split(/[\\/]+/).filter(Boolean);
  for (const part of parts) {
    if (BLOCKED_SEGMENTS.has(part)) throw new Error("That path is not exposed in the development workspace.");
  }
  const base = parts.at(-1)?.toLowerCase() || "";
  if (BLOCKED_BASENAMES.has(base) || /token|secret|credential|password|api.?key/i.test(base)) {
    throw new Error("Credential and secret files are not exposed through Developer Mode.");
  }
}

function resolveWorkspacePath(relativePath = "") {
  const root = workspaceRoot();
  const normalized = String(relativePath || "").replace(/^[\\/]+/, "");
  const target = path.resolve(root, normalized);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("Path traversal outside the development workspace is not allowed.");
  }
  const relative = path.relative(root, target).replace(/\\/g, "/");
  checkBlocked(relative);
  return { root, target, relative: relative || "." };
}

function sanitizeOutput(value: string) {
  return String(value ?? "")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password)\s*[:=]\s*)\S+/gi, "$1[REDACTED]")
    .slice(0, 250_000);
}

export async function developmentWorkspaceStatus() {
  await assertDevelopmentWorkspaceOwner();
  const root = workspaceRoot();
  let stat: import("node:fs").Stats | null = null;
  try { stat = await fs.stat(root); } catch {}
  return {
    root,
    available: Boolean(stat?.isDirectory()),
    ownerOnly: true,
    commandAllowlist: [...ALLOWED_COMMANDS],
    shellAccess: ["PowerShell", "PowerShell Core", "CMD"],
  };
}

export async function developmentWorkspaceList(input: { directory?: string; limit?: number }) {
  await assertDevelopmentWorkspaceOwner();
  const { target, relative } = resolveWorkspacePath(input.directory || "");
  const stat = await fs.stat(target);
  if (!stat.isDirectory()) throw new Error("Requested workspace path is not a directory.");
  const limit = Math.max(1, Math.min(1000, Math.trunc(Number(input.limit) || 300)));
  const entries = await fs.readdir(target, { withFileTypes: true });
  return {
    directory: relative,
    entries: entries
      .filter((entry) => entry.name !== ".git")
      .slice(0, limit)
      .map((entry) => ({
        name: entry.name,
        path: path.posix.join(relative === "." ? "" : relative, entry.name),
        kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      })),
  };
}

export async function developmentWorkspaceRead(input: { file: string; startLine?: number; maxLines?: number }) {
  await assertDevelopmentWorkspaceOwner();
  const { target, relative } = resolveWorkspacePath(input.file);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error("Requested workspace path is not a file.");
  if (stat.size > 4 * 1024 * 1024) throw new Error("Developer Mode read limit is 4 MiB per file.");
  const raw = await fs.readFile(target, "utf8");
  const lines = raw.split(/\r?\n/);
  const startLine = Math.max(1, Math.trunc(Number(input.startLine) || 1));
  const maxLines = Math.max(1, Math.min(1500, Math.trunc(Number(input.maxLines) || 400)));
  const selected = lines.slice(startLine - 1, startLine - 1 + maxLines);
  return {
    file: relative,
    startLine,
    endLine: startLine + selected.length - 1,
    totalLines: lines.length,
    truncated: startLine - 1 + selected.length < lines.length,
    content: selected.join("\n"),
  };
}

export async function developmentWorkspaceWrite(input: { file: string; content: string; createDirectories?: boolean }) {
  await assertDevelopmentWorkspaceOwner();
  const { target, relative } = resolveWorkspacePath(input.file);
  if (input.createDirectories !== false) await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, String(input.content ?? ""), "utf8");
  const stat = await fs.stat(target);
  return { file: relative, bytes: stat.size };
}

export async function developmentWorkspaceMkdir(input: { directory: string }) {
  await assertDevelopmentWorkspaceOwner();
  const { target, relative } = resolveWorkspacePath(input.directory);
  await fs.mkdir(target, { recursive: true });
  return { directory: relative, created: true };
}

export async function developmentWorkspaceDelete(input: { path: string; recursive?: boolean }) {
  await assertDevelopmentWorkspaceOwner();
  const resolved = resolveWorkspacePath(input.path);
  if (resolved.relative === ".") throw new Error("The development workspace root cannot be deleted.");
  const stat = await fs.stat(resolved.target);
  if (stat.isDirectory() && !input.recursive) {
    await fs.rmdir(resolved.target);
  } else {
    await fs.rm(resolved.target, { recursive: Boolean(input.recursive), force: false });
  }
  return { path: resolved.relative, deleted: true };
}

export async function developmentWorkspaceMove(input: { from: string; to: string }) {
  await assertDevelopmentWorkspaceOwner();
  const source = resolveWorkspacePath(input.from);
  const destination = resolveWorkspacePath(input.to);
  await fs.mkdir(path.dirname(destination.target), { recursive: true });
  await fs.rename(source.target, destination.target);
  return { from: source.relative, to: destination.relative };
}

export async function developmentWorkspaceCopy(input: { from: string; to: string }) {
  await assertDevelopmentWorkspaceOwner();
  const source = resolveWorkspacePath(input.from);
  const destination = resolveWorkspacePath(input.to);
  const stat = await fs.stat(source.target);
  await fs.mkdir(path.dirname(destination.target), { recursive: true });
  if (stat.isDirectory()) {
    await fs.cp(source.target, destination.target, { recursive: true, errorOnExist: true });
  } else {
    await fs.copyFile(source.target, destination.target);
  }
  return { from: source.relative, to: destination.relative };
}

async function walk(root: string, maxFiles = 60_000) {
  const files: string[] = [];
  const stack = [root];
  const ignored = new Set([".git", "node_modules", "dist", "release", "coverage", ".cache"]);
  while (stack.length && files.length < maxFiles) {
    const current = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) stack.push(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }
  return files;
}

export async function developmentWorkspaceSearch(input: { query: string; directory?: string; limit?: number }) {
  await assertDevelopmentWorkspaceOwner();
  const query = String(input.query || "").trim();
  if (query.length < 2) throw new Error("Search query must contain at least two characters.");
  const { target, relative } = resolveWorkspacePath(input.directory || "");
  const limit = Math.max(1, Math.min(200, Math.trunc(Number(input.limit) || 60)));
  const files = await walk(target);
  const matches: Array<{ file: string; line: number; excerpt: string }> = [];
  const lower = query.toLowerCase();

  for (const file of files) {
    if (matches.length >= limit) break;
    const rel = path.relative(workspaceRoot(), file).replace(/\\/g, "/");
    try { checkBlocked(rel); } catch { continue; }
    let stat;
    try { stat = await fs.stat(file); } catch { continue; }
    if (stat.size > 2 * 1024 * 1024) continue;
    let raw: string;
    try { raw = await fs.readFile(file, "utf8"); } catch { continue; }
    const lines = raw.split(/\r?\n/);
    for (let index = 0; index < lines.length && matches.length < limit; index += 1) {
      if (!lines[index].toLowerCase().includes(lower)) continue;
      matches.push({ file: rel, line: index + 1, excerpt: lines[index].trim().slice(0, 600) });
    }
  }

  return { directory: relative, query, returned: matches.length, matches };
}

export async function developmentWorkspaceCommand(input: {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
}) {
  await assertDevelopmentWorkspaceOwner();
  const command = String(input.command || "").trim().toLowerCase();
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new Error(`Command is not in the Developer Mode allowlist: ${command}`);
  }
  const cwd = resolveWorkspacePath(input.cwd || "").target;
  const args = Array.isArray(input.args) ? input.args.map((value) => String(value)) : [];
  if (args.some((value) => /[\r\n\0]/.test(value))) throw new Error("Command arguments cannot contain control characters.");
  const timeout = Math.max(1_000, Math.min(300_000, Math.trunc(Number(input.timeoutMs) || 120_000)));

  try {
    const result = await execFileAsync(command, args, {
      cwd,
      windowsHide: true,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, CI: "1", NO_COLOR: "1" },
    });
    return {
      command: [command, ...args],
      cwd: path.relative(workspaceRoot(), cwd).replace(/\\/g, "/") || ".",
      exitCode: 0,
      stdout: sanitizeOutput(result.stdout),
      stderr: sanitizeOutput(result.stderr),
    };
  } catch (error) {
    const failure = error as Error & { code?: number | string; stdout?: string; stderr?: string };
    return {
      command: [command, ...args],
      cwd: path.relative(workspaceRoot(), cwd).replace(/\\/g, "/") || ".",
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      stdout: sanitizeOutput(failure.stdout || ""),
      stderr: sanitizeOutput(failure.stderr || failure.message),
    };
  }
}
