import crypto from "node:crypto";
import http from "node:http";
import { app, type BrowserWindow } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

import { decrypt, encrypt, readConfig, writeConfig } from "./config";
import { refreshEveToken } from "./eve";
import { importFits, validateImportedFit } from "./fitting-import";

type BridgeAction =
  | "save_sage_fit"
  | "delete_sage_fit"
  | "push_eve_fitting"
  | "delete_eve_fitting";

type RendererData = { savedFits: Array<Record<string, unknown>>; fitLibraryMeta: Record<string, unknown> };
let server: http.Server | null = null;

function bridgePath() { return path.join(app.getPath("userData"), "mcp-write-bridge.json"); }
function rendererPath() { return path.join(app.getPath("userData"), "mcp-renderer-data.json"); }

async function readRendererData(): Promise<RendererData> {
  try {
    const value = JSON.parse(await fs.readFile(rendererPath(), "utf8")) as Partial<RendererData>;
    return { savedFits: Array.isArray(value.savedFits) ? value.savedFits : [], fitLibraryMeta: value.fitLibraryMeta ?? {} };
  } catch { return { savedFits: [], fitLibraryMeta: {} }; }
}

async function mergeWindowRendererData(value: RendererData, getWindow: () => BrowserWindow | null): Promise<RendererData> {
  const window = getWindow();
  if (!window || window.isDestroyed()) return value;
  try {
    const local = await window.webContents.executeJavaScript(`(() => {
      try {
        return {
          savedFits: JSON.parse(localStorage.getItem("new-eden-sage-fits") || "[]"),
          fitLibraryMeta: JSON.parse(localStorage.getItem("new-eden-sage-fit-library-meta") || "{}")
        };
      } catch { return { savedFits: [], fitLibraryMeta: {} }; }
    })()`, true) as Partial<RendererData>;
    const merged = [...value.savedFits];
    for (const fit of Array.isArray(local.savedFits) ? local.savedFits : []) {
      if (!merged.some((item) => item.id === fit.id)) merged.push(fit);
    }
    return { savedFits: merged, fitLibraryMeta: { ...(local.fitLibraryMeta ?? {}), ...value.fitLibraryMeta } };
  } catch { return value; }
}

async function saveRendererData(value: RendererData, getWindow: () => BrowserWindow | null) {
  await fs.writeFile(rendererPath(), JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  const window = getWindow();
  if (window && !window.isDestroyed()) {
    const fitsJson = JSON.stringify(JSON.stringify(value.savedFits));
    const metaJson = JSON.stringify(JSON.stringify(value.fitLibraryMeta));
    const script = "localStorage.setItem(\"new-eden-sage-fits\", " + fitsJson + "); localStorage.setItem(\"new-eden-sage-fit-library-meta\", " + metaJson + ");";
    await window.webContents.executeJavaScript(script, true).catch(() => undefined);
    window.webContents.send("mcp:fit-data-updated", value);
  }
  return value;
}

async function accessToken(characterId: string) {
  const config = await readConfig();
  const stored = config.encryptedRefreshTokens[characterId];
  if (!stored) throw new Error("Character is not connected to Sage. Reconnect it in Settings first.");
  const tokens = await refreshEveToken(config.eveClientId, decrypt(stored));
  if (tokens.refresh_token) {
    config.encryptedRefreshTokens[characterId] = encrypt(tokens.refresh_token);
    await writeConfig(config);
  }
  return tokens.access_token;
}

async function eveRequest(characterId: string, pathname: string, method: "POST" | "DELETE", body?: unknown) {
  const response = await fetch(`https://esi.evetech.net${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken(characterId)}`,
      "Content-Type": "application/json",
      "X-Compatibility-Date": "2026-08-02",
      "X-User-Agent": "NewEdenSage/0.1.12",
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`EVE fitting action failed (${response.status})${detail ? `: ${detail}` : "."}`);
  }
  if (response.status === 204) return { success: true };
  return response.json() as Promise<unknown>;
}

async function perform(action: BridgeAction, input: Record<string, unknown>, getWindow: () => BrowserWindow | null) {
  if (action === "save_sage_fit") {
    const payload = input.fit ?? input.payload ?? input.text;
    const imported = importFits(payload).map(validateImportedFit);
    if (!imported.length) throw new Error("No fitting could be parsed from the MCP payload.");
    const data = await mergeWindowRendererData(await readRendererData(), getWindow);
    const operations: Array<{ fitId: string; operation: "created" | "updated" }> = [];
    for (const fit of imported) {
      const index = data.savedFits.findIndex((item) => item.id === fit.id);
      if (index >= 0) data.savedFits[index] = fit; else data.savedFits.push(fit);
      operations.push({ fitId: fit.id, operation: index >= 0 ? "updated" : "created" });
    }
    await saveRendererData(data, getWindow);
    return { success: true, count: imported.length, fits: operations, fitId: operations[0]?.fitId, operation: operations[0]?.operation };
  }
  if (action === "delete_sage_fit") {
    const fitId = String(input.fitId ?? "");
    const data = await mergeWindowRendererData(await readRendererData(), getWindow);
    const before = data.savedFits.length;
    data.savedFits = data.savedFits.filter((item) => item.id !== fitId);
    delete data.fitLibraryMeta[fitId];
    await saveRendererData(data, getWindow);
    return { success: true, fitId, deleted: data.savedFits.length < before };
  }
  const characterId = String(input.characterId ?? "");
  if (!/^\d+$/.test(characterId)) throw new Error("A valid connected character ID is required.");
  if (action === "push_eve_fitting") {
    return eveRequest(characterId, `/characters/${characterId}/fittings/`, "POST", input.fitting);
  }
  const fittingId = Number(input.fittingId);
  if (!Number.isSafeInteger(fittingId) || fittingId <= 0) throw new Error("A valid EVE fitting ID is required.");
  return eveRequest(characterId, `/characters/${characterId}/fittings/${fittingId}/`, "DELETE");
}

export async function startMcpWriteBridge(getWindow: () => BrowserWindow | null) {
  if (server) return;
  const token = crypto.randomBytes(32).toString("base64url");
  server = http.createServer((request, response) => {
    void (async () => {
      try {
        if (request.method !== "POST" || request.url !== "/action" || request.headers.authorization !== `Bearer ${token}`) {
          response.writeHead(404).end(); return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { action: BridgeAction; input?: Record<string, unknown> };
        const result = await perform(body.action, body.input ?? {}, getWindow);
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
      } catch (error) {
        response.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
    })();
  });
  await new Promise<void>((resolve, reject) => server!.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start the Sage MCP write bridge.");
  await fs.writeFile(bridgePath(), JSON.stringify({ port: address.port, token }), { encoding: "utf8", mode: 0o600 });
}

export async function stopMcpWriteBridge() {
  await fs.rm(bridgePath(), { force: true });
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
}
