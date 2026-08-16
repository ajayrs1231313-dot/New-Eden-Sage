import AdmZip from "adm-zip";
import fs from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";

const SDE_URL = "https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REQUIRED_ENTRIES = [
  "types.jsonl",
  "groups.jsonl",
  "categories.jsonl",
  "typeDogma.jsonl",
  "dogmaEffects.jsonl",
  "dogmaAttributes.jsonl",
  "marketGroups.jsonl",
];

type WorkerInput = {
  staticRoot: string;
  activeArchive: string;
  stagedArchive: string;
  partialArchive: string;
  statePath: string;
  force?: boolean;
  aggressive?: boolean;
};

type UpdateState = {
  lastCheckedAt?: string;
  remoteSignature?: string;
  stagedAt?: string;
  stagedSignature?: string;
};

const input = workerData as WorkerInput;

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function exists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readState(): Promise<UpdateState> {
  try {
    return JSON.parse(await fs.readFile(input.statePath, "utf8")) as UpdateState;
  } catch {
    return {};
  }
}

async function saveState(state: UpdateState) {
  const partial = `${input.statePath}.${process.pid}.partial`;
  await fs.writeFile(partial, JSON.stringify(state, null, 2), "utf8");
  await fs.rm(input.statePath, { force: true }).catch(() => undefined);
  await fs.rename(partial, input.statePath);
}

function signatureFrom(response: Response) {
  const etag = response.headers.get("etag") ?? "";
  const modified = response.headers.get("last-modified") ?? "";
  const length = response.headers.get("content-length") ?? "";
  return [etag, modified, length].filter(Boolean).join("|");
}

async function validateArchiveCheap(target: string) {
  // AdmZip must successfully parse the central directory, required core entries
  // must exist, and one small JSONL entry must inflate successfully. Avoid
  // archive.test(): it inflates every SDE file and needlessly hammers CPU/disk.
  const archive = new AdmZip(target);
  const entries = new Set(archive.getEntries().map((entry) => entry.entryName));
  const missing = REQUIRED_ENTRIES.filter((entry) => !entries.has(entry));
  if (missing.length) throw new Error(`CCP static data is missing ${missing.join(", ")}.`);
  const probe = archive.getEntry("categories.jsonl");
  if (!probe || probe.getData().byteLength < 100)
    throw new Error("CCP static-data ZIP failed its validation probe.");
}

async function downloadLowImpact() {
  await fs.rm(input.partialArchive, { force: true }).catch(() => undefined);
  const response = await fetch(SDE_URL, {
    headers: { "X-User-Agent": "NewEdenSage/1.0.1" },
  });
  if (!response.ok) throw new Error(`CCP static-data download failed (${response.status}).`);
  if (!response.body) throw new Error("CCP static-data download returned no body.");

  const expectedBytes = Number(response.headers.get("content-length") ?? 0);
  const handle = await fs.open(input.partialArchive, "w");
  let bytes = 0;
  try {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      await handle.write(value);
      bytes += value.byteLength;
      // Normal background maintenance yields between chunks. Master Update intentionally runs flat out.
      if (!input.aggressive) await sleep(3);
    }
  } finally {
    await handle.close();
  }
  if (expectedBytes > 0 && bytes !== expectedBytes)
    throw new Error(`CCP static-data download was incomplete (${bytes}/${expectedBytes} bytes).`);
  return { bytes, signature: signatureFrom(response) };
}

async function run() {
  await fs.mkdir(input.staticRoot, { recursive: true });
  const state = await readState();
  const lastChecked = state.lastCheckedAt ? Date.parse(state.lastCheckedAt) : 0;
  if (!input.force && Number.isFinite(lastChecked) && Date.now() - lastChecked < CHECK_INTERVAL_MS) {
    return { status: "recently-checked", checkedAt: state.lastCheckedAt };
  }

  let head: Response | undefined;
  try {
    head = await fetch(SDE_URL, {
      method: "HEAD",
      headers: { "X-User-Agent": "NewEdenSage/1.0.1" },
    });
  } catch {
    // Some CDNs/proxies reject HEAD. A normal GET below is still safe.
  }

  const remoteSignature = head?.ok ? signatureFrom(head) : "";
  state.lastCheckedAt = new Date().toISOString();
  const haveData = (await exists(input.activeArchive)) || (await exists(input.stagedArchive));
  if (!input.force && remoteSignature && haveData && state.remoteSignature === remoteSignature) {
    await saveState(state);
    return { status: "current", signature: remoteSignature, checkedAt: state.lastCheckedAt };
  }

  const downloaded = await downloadLowImpact();
  await validateArchiveCheap(input.partialArchive);
  await fs.rm(input.stagedArchive, { force: true }).catch(() => undefined);
  await fs.rename(input.partialArchive, input.stagedArchive);

  const signature = downloaded.signature || remoteSignature || `downloaded:${Date.now()}`;
  state.remoteSignature = signature;
  state.stagedSignature = signature;
  state.stagedAt = new Date().toISOString();
  state.lastCheckedAt = new Date().toISOString();
  await saveState(state);
  return { status: "staged", bytes: downloaded.bytes, signature, stagedAt: state.stagedAt };
}

void run()
  .then((result) => parentPort?.postMessage({ ok: true, result }))
  .catch(async (error) => {
    await fs.rm(input.partialArchive, { force: true }).catch(() => undefined);
    parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });
