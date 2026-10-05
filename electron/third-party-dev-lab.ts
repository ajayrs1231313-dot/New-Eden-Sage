import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { DATA_ROOT, USER_DATA_ROOT } from "./data-paths";

const execFileAsync = promisify(execFile);

type RunningProject = {
  project: string;
  pid: number;
  startedAt: string;
  command: string[];
};

const runningProjects = new Map<string, RunningProject>();
const OWNER_ACCOUNT_IDS = new Set(["569399317"]);
export const THIRD_PARTY_DEV_LAB_ROOT = path.join(DATA_ROOT, "Third Party Dev Lab");

export const THIRD_PARTY_DEV_PROJECTS = [
  { id: "pyfa", folder: "Pyfa", name: "Pyfa", repo: "https://github.com/pyfa-org/Pyfa.git", role: "Fitting engine, dogma calculations and fit UX", license: "GPL-3.0" },
  { id: "zkillboard", folder: "zKillboard", name: "zKillboard", repo: "https://github.com/zKillboard/zKillboard.git", role: "Killboard, battle reports, killmail ingestion and PvP intelligence", license: "AGPL-3.0" },
  { id: "jeveassets", folder: "jEveAssets", name: "jEveAssets", repo: "https://github.com/GoldenGnu/jeveassets.git", role: "Asset management, valuation, stockpiles and industry/accounting UX", license: "GPL-2.0" },
  { id: "evemon", folder: "EVEMon", name: "EVEMon", repo: "https://github.com/peterhaneve/evemon.git", role: "Character progression, skills, plans and ESI integration", license: "GPL-2.0" },
  { id: "smt", folder: "SMT", name: "SMT", repo: "https://github.com/Slazanger/SMT.git", role: "Map, intel, routing and spatial EVE tooling", license: "MIT" },
  { id: "seat", folder: "SeAT", name: "SeAT", repo: "https://github.com/eveseat/seat.git", role: "Corporation management, ESI architecture and permissions/workflows", license: "GPL-2.0" },
  { id: "eve-ref", folder: "EVE-Ref", name: "EVE Ref", repo: "https://github.com/autonomouslogic/eve-ref.git", role: "Static data/reference architecture", license: "MIT-0" },
  { id: "eve-o-preview", folder: "EVE-O-Preview", name: "EVE-O Preview", repo: "https://github.com/EveOPlus/eve-o-preview.git", role: "Multi-client window preview/switching architecture", license: "GPL-3.0" },
] as const;

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".php", ".cs", ".java", ".kt", ".kts",
  ".cpp", ".cc", ".c", ".h", ".hpp", ".rs", ".go", ".rb", ".sh", ".ps1", ".cmd", ".bat",
  ".json", ".jsonc", ".yaml", ".yml", ".toml", ".xml", ".html", ".htm", ".css", ".scss",
  ".sql", ".md", ".txt", ".ini", ".conf", ".config", ".gradle", ".sln", ".csproj", ".props",
  ".targets", ".vue", ".twig", ".pug", ".lock",
]);

const IGNORED_DIRS = new Set([
  ".git", "node_modules", "vendor", "dist", "build", "target", "bin", "obj", ".idea", ".vs",
  "__pycache__", ".pytest_cache", ".mypy_cache", "coverage", ".next", ".cache",
]);

async function ownerIdentity() {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(USER_DATA_ROOT, "settings.json"), "utf8")) as Record<string, unknown>;
    const ids = [parsed.sageAccountId, parsed.primaryCharacterId].map((value) => String(value ?? "").trim()).filter(Boolean);
    return ids.some((id) => OWNER_ACCOUNT_IDS.has(id));
  } catch {
    return false;
  }
}

export async function assertThirdPartyDevLabOwner() {
  if (!(await ownerIdentity())) {
    throw new Error("The EVE third-party development lab is restricted to the Sage owner account.");
  }
}

function projectById(projectId: string) {
  const project = THIRD_PARTY_DEV_PROJECTS.find((entry) => entry.id === projectId);
  if (!project) throw new Error(`Unknown third-party development project: ${projectId}`);
  return project;
}

function projectRoot(projectId: string) {
  return path.join(THIRD_PARTY_DEV_LAB_ROOT, projectById(projectId).folder);
}

async function gitInfo(root: string) {
  try {
    const [head, remote] = await Promise.all([
      execFileAsync("git", ["-C", root, "rev-parse", "HEAD"], { windowsHide: true, timeout: 10_000 }),
      execFileAsync("git", ["-C", root, "remote", "get-url", "origin"], { windowsHide: true, timeout: 10_000 }),
    ]);
    return { commit: String(head.stdout).trim(), remote: String(remote.stdout).trim() };
  } catch {
    return { commit: null, remote: null };
  }
}

export async function listThirdPartyDevProjects() {
  await assertThirdPartyDevLabOwner();
  const output = [];
  for (const project of THIRD_PARTY_DEV_PROJECTS) {
    const root = projectRoot(project.id);
    let installed = false;
    try { installed = (await fs.stat(root)).isDirectory(); } catch {}
    output.push({
      ...project,
      installed,
      root,
      ...(installed ? await gitInfo(root) : { commit: null, remote: null }),
    });
  }
  return output;
}

function safeProjectFile(projectId: string, relativePath: string) {
  const root = path.resolve(projectRoot(projectId));
  const normalized = String(relativePath || "").replace(/^[\\/]+/, "");
  const target = path.resolve(root, normalized);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error("Path traversal is not allowed.");
  if (target.includes(path.sep + ".git" + path.sep) || target.endsWith(path.sep + ".git")) throw new Error("Git internals are not exposed.");
  return { root, target, relative: path.relative(root, target).replace(/\\/g, "/") };
}

function likelyTextFile(file: string) {
  const ext = path.extname(file).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const base = path.basename(file).toLowerCase();
  return ["license", "copying", "readme", "makefile", "dockerfile", "gemfile", "rakefile"].some((name) => base === name || base.startsWith(name + "."));
}

export async function readThirdPartyDevSource(input: {
  project: string;
  file: string;
  startLine?: number;
  maxLines?: number;
}) {
  await assertThirdPartyDevLabOwner();
  const { target, relative } = safeProjectFile(input.project, input.file);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error("Requested path is not a file.");
  if (stat.size > 2 * 1024 * 1024) throw new Error("Source reader limit is 2 MiB per file.");
  if (!likelyTextFile(target)) throw new Error("Only text/source files are exposed through the development lab.");

  const raw = await fs.readFile(target, "utf8");
  const lines = raw.split(/\r?\n/);
  const startLine = Math.max(1, Math.trunc(Number(input.startLine) || 1));
  const maxLines = Math.max(1, Math.min(800, Math.trunc(Number(input.maxLines) || 250)));
  const selected = lines.slice(startLine - 1, startLine - 1 + maxLines);
  return {
    project: input.project,
    file: relative,
    startLine,
    endLine: startLine + selected.length - 1,
    totalLines: lines.length,
    truncated: startLine - 1 + selected.length < lines.length,
    content: selected.join("\n"),
  };
}

async function walkFiles(root: string, maxFiles = 80_000) {
  const files: string[] = [];
  const stack = [root];
  while (stack.length && files.length < maxFiles) {
    const current = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) stack.push(full);
      } else if (entry.isFile() && likelyTextFile(full)) {
        files.push(full);
      }
    }
  }
  return files;
}

export async function searchThirdPartyDevSource(input: {
  query: string;
  project?: string;
  limit?: number;
}) {
  await assertThirdPartyDevLabOwner();
  const query = String(input.query || "").trim();
  if (query.length < 2) throw new Error("Search query must contain at least two characters.");
  const lower = query.toLowerCase();
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(input.limit) || 40)));
  const projects = input.project ? [projectById(input.project)] : [...THIRD_PARTY_DEV_PROJECTS];
  const matches: Array<{ project: string; file: string; line: number; excerpt: string }> = [];

  for (const project of projects) {
    const root = projectRoot(project.id);
    const files = await walkFiles(root);
    for (const file of files) {
      if (matches.length >= limit) break;
      let stat;
      try { stat = await fs.stat(file); } catch { continue; }
      if (stat.size > 2 * 1024 * 1024) continue;
      let raw = "";
      try { raw = await fs.readFile(file, "utf8"); } catch { continue; }
      const lines = raw.split(/\r?\n/);
      for (let index = 0; index < lines.length && matches.length < limit; index += 1) {
        const line = lines[index];
        if (!line.toLowerCase().includes(lower)) continue;
        matches.push({
          project: project.id,
          file: path.relative(root, file).replace(/\\/g, "/"),
          line: index + 1,
          excerpt: line.trim().slice(0, 500),
        });
      }
    }
    if (matches.length >= limit) break;
  }

  return { query, returned: matches.length, matches };
}

export async function listThirdPartyDevTree(input: {
  project: string;
  directory?: string;
  limit?: number;
}) {
  await assertThirdPartyDevLabOwner();
  const project = projectById(input.project);
  const { target, relative } = safeProjectFile(project.id, input.directory || "");
  const stat = await fs.stat(target);
  if (!stat.isDirectory()) throw new Error("Requested path is not a directory.");
  const limit = Math.max(1, Math.min(500, Math.trunc(Number(input.limit) || 200)));
  const entries = (await fs.readdir(target, { withFileTypes: true }))
    .filter((entry) => entry.name !== ".git")
    .slice(0, limit)
    .map((entry) => ({
      name: entry.name,
      path: path.posix.join(relative, entry.name).replace(/^\.\//, ""),
      kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
    }));
  return { project: project.id, directory: relative || ".", entries };
}


function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function pyfaLaunchSpec() {
  return {
    command: "python",
    args: ["-m", "uv", "run", "python", "pyfa.py"],
  };
}

export async function launchThirdPartyDevProject(input: {
  project: string;
  command?: string;
  args?: string[];
}) {
  await assertThirdPartyDevLabOwner();
  const project = projectById(input.project);
  const root = projectRoot(project.id);

  const existing = runningProjects.get(project.id);
  if (existing && processAlive(existing.pid)) {
    return { ...existing, alreadyRunning: true };
  }
  if (existing) runningProjects.delete(project.id);

  const spec = project.id === "pyfa" && !input.command
    ? pyfaLaunchSpec()
    : {
        command: String(input.command || "").trim(),
        args: Array.isArray(input.args) ? input.args.map(String) : [],
      };

  if (!spec.command) {
    throw new Error("No built-in launch profile exists for this project yet. Supply a command and arguments or use the developer shell.");
  }

  const child = spawn(spec.command, spec.args, {
    cwd: root,
    detached: true,
    windowsHide: false,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();

  if (!child.pid) throw new Error("The project process did not start.");

  const running: RunningProject = {
    project: project.id,
    pid: child.pid,
    startedAt: new Date().toISOString(),
    command: [spec.command, ...spec.args],
  };
  runningProjects.set(project.id, running);

  await new Promise((resolve) => setTimeout(resolve, 800));
  return {
    ...running,
    running: processAlive(running.pid),
    root,
    alreadyRunning: false,
  };
}

export async function listThirdPartyDevProcesses() {
  await assertThirdPartyDevLabOwner();
  const output = [];
  for (const [project, entry] of runningProjects) {
    const running = processAlive(entry.pid);
    output.push({ ...entry, running });
    if (!running) runningProjects.delete(project);
  }
  return output;
}

export async function stopThirdPartyDevProject(input: { project: string; force?: boolean }) {
  await assertThirdPartyDevLabOwner();
  const project = projectById(input.project);
  const running = runningProjects.get(project.id);
  if (!running) return { project: project.id, stopped: false, reason: "No tracked process is running." };

  if (!processAlive(running.pid)) {
    runningProjects.delete(project.id);
    return { project: project.id, stopped: false, reason: "Tracked process has already exited." };
  }

  if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/PID", String(running.pid), "/T", ...(input.force === false ? [] : ["/F"])], {
      windowsHide: true,
      timeout: 30_000,
    }).catch(() => undefined);
  } else {
    try { process.kill(running.pid, input.force === false ? "SIGTERM" : "SIGKILL"); } catch {}
  }

  runningProjects.delete(project.id);
  return { project: project.id, pid: running.pid, stopped: !processAlive(running.pid) };
}
