import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const root = path.join(process.env.NEW_EDEN_SAGE_USER_DATA ?? process.cwd(), "Analysis Cache");

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
