import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { ANALYSIS_CACHE_ROOT } from "./data-paths";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const root = ANALYSIS_CACHE_ROOT;

function file(kind: string, key: unknown) {
  const hash = createHash("sha256").update(JSON.stringify(key)).digest("hex");
  return path.join(root, `${kind}-${hash}.json.gz`);
}

export async function loadPersistedResult<T>(kind: string, key: unknown): Promise<T | undefined> {
  try { return JSON.parse((await gunzipAsync(await fs.readFile(file(kind, key)))).toString("utf8")) as T; }
  catch { return undefined; }
}

export async function savePersistedResult(kind: string, key: unknown, value: unknown) {
  await fs.mkdir(root, { recursive: true });
  const target = file(kind, key);
  const partial = `${target}.${process.pid}.${randomUUID()}.partial`;
  await fs.writeFile(partial, await gzipAsync(Buffer.from(JSON.stringify(value), "utf8"), { level: 6 }));
  try {
    await fs.rename(partial, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "EPERM" && code !== "EACCES") throw error;
    const backup = `${target}.${process.pid}.${randomUUID()}.backup`;
    let backedUp = false;
    try {
      await fs.rename(target, backup);
      backedUp = true;
    } catch (targetError) {
      if ((targetError as NodeJS.ErrnoException).code !== "ENOENT") throw targetError;
    }
    try {
      await fs.rename(partial, target);
    } catch (replaceError) {
      if (backedUp) await fs.rename(backup, target).catch(() => undefined);
      throw replaceError;
    }
    if (backedUp) await fs.rm(backup, { force: true }).catch(() => undefined);
  }
}

export async function loadRecentPersistedResults<T>(kind: string, limit = 40): Promise<Array<{ value: T; path: string; mtimeMs: number }>> {
  let entries: import("node:fs").Dirent[];
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return []; }
  const prefix = `${kind}-`;
  const candidates = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && /^[a-f0-9]{64}\.json\.gz$/i.test(entry.name.slice(prefix.length)))
    .map(async (entry) => {
      const target = path.join(root, entry.name);
      try { return { target, mtimeMs: (await fs.stat(target)).mtimeMs }; } catch { return null; }
    }));
  const output: Array<{ value: T; path: string; mtimeMs: number }> = [];
  for (const candidate of candidates.filter(Boolean).sort((a: any, b: any) => b.mtimeMs - a.mtimeMs).slice(0, Math.max(1, limit)) as Array<{ target: string; mtimeMs: number }>) {
    try {
      const value = JSON.parse((await gunzipAsync(await fs.readFile(candidate.target))).toString("utf8")) as T;
      output.push({ value, path: candidate.target, mtimeMs: candidate.mtimeMs });
    } catch { /* skip corrupt cache files */ }
  }
  return output;
}
