import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadMarketIndexHeaders, loadMarketRegion, loadLatestMarketDatasetByMode } from "./market-storage";
import { loadCurrentRawMarketManifest, loadRawMarketRegion } from "./raw-market-storage";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
const FIT_IMPORT_INSTRUCTIONS = `When creating or importing a fit into New Eden Sage, call save_sage_fit. The fit payload is intentionally flexible: you may send a normal LLM JSON object, Sage JSON, ESI fitting JSON, a JSON array or wrapped collection of fits, EFT/PYFA text, PYFA XML, EVE DNA, fenced code blocks, or clearly labelled plain text sections. Prefer exact current EVE item names and realistic quantities. Type IDs are optional; omit uncertain IDs rather than inventing them. For JSON, preferred fields are: name, ship or hull, modules.high/mid/low/rig/subsystem, drones, fighters, cargo, implants, boosters, and instructions. Each item may be a string or an object such as { name, typeId?, quantity?, charge?, chargeTypeId?, chargeQuantity?, state? }. Multiple fits may be supplied at once. Sage normalizes all supported formats into its canonical fitting shape before saving.`;
const database = new DatabaseSync(path.join(process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd(), "new-eden-sage", "new-eden-sage.sqlite"), { readOnly: true });
const rendererDataPath = path.join(process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd(), "new-eden-sage", "mcp-renderer-data.json");
const execFileAsync = promisify(execFile);

async function wranglerPaths() {
  const roots = [
    process.env.NEW_EDEN_SAGE_WRANGLER_ROOT,
    path.resolve(__dirname, "..", "backend"),
    path.resolve(process.cwd(), "backend"),
  ].filter((value): value is string => Boolean(value));
  const node = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "nodejs", "node.exe");
  await access(node);
  for (const root of roots) {
    const script = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
    try {
      await access(script);
      return { node, root, script };
    } catch { /* Try the next supported Sage backend location. */ }
  }
  throw new Error("Wrangler is not installed in the New Eden Sage backend directory.");
}

async function runWrangler(args: string[], timeoutMs: number) {
  if (!args.length) throw new Error("Provide a Wrangler command or --version.");
  if (args.some((value) => /[\r\n\0]/.test(value))) throw new Error("Wrangler arguments cannot contain control characters.");
  const command = args.find((value) => !value.startsWith("-"))?.toLowerCase();
  if (command === "login" || command === "logout") throw new Error("Wrangler login and logout are interactive and are not exposed through MCP.");
  const { node, root, script } = await wranglerPaths();
  const safeOutput = (value: unknown) => String(value ?? "")
    .replace(/^.*Credentials are stored in:.*$/gmi, "Credentials are stored locally and are not exposed through MCP.")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_ -]?token|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret)\s*[:=]\s*)\S+/gi, "$1[REDACTED]")
    .trim();
  try {
    const output = await execFileAsync(node, [script, ...args], {
      cwd: root,
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1", CI: "1" },
    });
    return { command: ["wrangler", ...args], exitCode: 0, stdout: safeOutput(output.stdout), stderr: safeOutput(output.stderr) };
  } catch (error) {
    const failure = error as Error & { code?: string | number; stdout?: string; stderr?: string };
    return {
      command: ["wrangler", ...args],
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      stdout: safeOutput(failure.stdout),
      stderr: safeOutput(failure.stderr ?? failure.message),
    };
  }
}

function listSnapshots() {
  return (database.prepare("SELECT payload FROM character_snapshots ORDER BY updated_at DESC").all() as Array<{ payload: string }>).map((row) => JSON.parse(row.payload));
}
function getSnapshot(characterId: string) {
  const row = database.prepare("SELECT payload FROM character_snapshots WHERE character_id = ?").get(characterId) as { payload?: string } | undefined;
  return row?.payload ? JSON.parse(row.payload) : null;
}
function listImportedInformation() {
  return database.prepare("SELECT id, source_name, content, imported_at FROM imported_information ORDER BY imported_at DESC").all();
}
function exportDatabaseData() {
  return { schemaVersion: 1, exportedAt: new Date().toISOString(), application: "New Eden Sage", characterSnapshots: listSnapshots(), importedInformation: listImportedInformation() };
}
async function rendererData() {
  try { return JSON.parse(await readFile(rendererDataPath, "utf8")); } catch { return { savedFits: [], fitLibraryMeta: {} }; }
}

async function writeAction(action: string, input: Record<string, unknown>) {
  const bridgePath = path.join(process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd(), "new-eden-sage", "mcp-write-bridge.json");
  let bridge: { port: number; token: string };
  try { bridge = JSON.parse(await readFile(bridgePath, "utf8")); }
  catch { throw new Error("Open New Eden Sage before using write or live EVE actions."); }
  const response = await fetch(`http://127.0.0.1:${bridge.port}/action`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bridge.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, input }),
  });
  const value = await response.json() as { error?: string } & Record<string, unknown>;
  if (!response.ok) throw new Error(value.error ?? `Sage write action failed (${response.status}).`);
  return value;
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/token|secret|authorization|password|api.?key|encrypted/i.test(key))
    .map(([key, child]) => [key, sanitize(child)]));
}

function result(value: unknown) {
  const safe = sanitize(value);
  return { content: [{ type: "text" as const, text: JSON.stringify(safe, null, 2) }], structuredContent: { data: safe } };
}

function dataPaths(value: unknown, prefix = "", output = new Set<string>()) {
  if (Array.isArray(value)) {
    output.add(`${prefix}[]`);
    if (value[0] != null) dataPaths(value[0], `${prefix}[]`, output);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      output.add(path);
      dataPaths(child, path, output);
    }
  }
  return [...output].sort();
}

export async function startMcpServer() {
  const server = new McpServer({ name: "new-eden-sage", version: "0.1.0" });

  server.registerTool("list_characters", {
    title: "List Sage characters", description: "List every locally synced EVE character and snapshot timestamp.", inputSchema: {}, annotations: READ_ONLY,
  }, async () => result((listSnapshots() as any[]).map((snapshot) => ({ characterId: snapshot.characterId, name: snapshot.character?.name, updatedAt: snapshot.updatedAt }))));

  server.registerTool("get_character_data", {
    title: "Read character data", description: "Read the complete locally synced snapshot for one character, or one top-level dataset such as skills, assets, blueprints, jobs, wallet, orders, fittings, clones, location or corporation data.",
    inputSchema: { characterId: z.string(), section: z.string().optional() }, annotations: READ_ONLY,
  }, async ({ characterId, section }) => {
    const snapshot = getSnapshot(characterId) as Record<string, unknown> | null;
    if (!snapshot) throw new Error("Character not found in Sage.");
    if (!section) return result(snapshot);
    const direct = snapshot[section];
    const extended = (snapshot.extended as Record<string, unknown> | undefined)?.[section];
    return result({ characterId, section, data: direct ?? extended ?? null });
  });

  server.registerTool("list_character_data_points", {
    title: "List character data points", description: "List every readable JSON field path captured for a synced character so an AI can discover all available Sage data without guessing schemas.",
    inputSchema: { characterId: z.string() }, annotations: READ_ONLY,
  }, async ({ characterId }) => {
    const snapshot = getSnapshot(characterId);
    if (!snapshot) throw new Error("Character not found in Sage.");
    return result({ characterId, paths: dataPaths(sanitize(snapshot)) });
  });

  server.registerTool("get_all_sage_data", {
    title: "Read complete Sage export", description: "Read all locally stored character snapshots and imported reference information. Credentials and encrypted values are always removed.", inputSchema: {}, annotations: READ_ONLY,
  }, async () => result(exportDatabaseData()));

  server.registerTool("get_imported_information", {
    title: "Read imported information", description: "Read all user-imported notes and reference documents stored in Sage.", inputSchema: {}, annotations: READ_ONLY,
  }, async () => result(listImportedInformation()));

  server.registerTool("get_saved_fittings", {
    title: "Read saved fittings", description: "Read every fit and fitting-library metadata saved in the Sage renderer. For importing or creating fits, use save_sage_fit; call get_fit_import_instructions if you need the accepted formats and preferred fields.", inputSchema: {}, annotations: READ_ONLY,
  }, async () => result(await rendererData()));

  server.registerTool("save_sage_fit", {
    title: "Create or update a Sage fit",
    description: FIT_IMPORT_INSTRUCTIONS + " Sage must be open.",
    inputSchema: { fit: z.unknown() }, annotations: WRITE,
  }, async ({ fit }) => result(await writeAction("save_sage_fit", { fit })));

  server.registerTool("delete_sage_fit", {
    title: "Delete a Sage fit",
    description: "Permanently remove one fitting and its library metadata from New Eden Sage. Sage must be open.",
    inputSchema: { fitId: z.string().min(1) }, annotations: DESTRUCTIVE,
  }, async ({ fitId }) => result(await writeAction("delete_sage_fit", { fitId })));

  server.registerTool("push_eve_fitting", {
    title: "Push a fitting to EVE Online",
    description: "Create a fitting in a connected character's live EVE Online fitting library. The character must be reconnected after this update to grant fitting write permission, and Sage must be open.",
    inputSchema: {
      characterId: z.string().regex(/^\d+$/),
      fitting: z.object({
        name: z.string().min(1).max(50),
        description: z.string().max(1000),
        ship_type_id: z.number().int().positive(),
        items: z.array(z.object({ type_id: z.number().int().positive(), flag: z.string().min(1), quantity: z.number().int().positive() })).min(1),
      }),
    }, annotations: WRITE,
  }, async ({ characterId, fitting }) => result(await writeAction("push_eve_fitting", { characterId, fitting })));

  server.registerTool("delete_eve_fitting", {
    title: "Delete an EVE Online fitting",
    description: "Permanently delete one fitting from a connected character's live EVE Online fitting library. Sage must be open.",
    inputSchema: { characterId: z.string().regex(/^\d+$/), fittingId: z.number().int().positive() }, annotations: DESTRUCTIVE,
  }, async ({ characterId, fittingId }) => result(await writeAction("delete_eve_fitting", { characterId, fittingId })));

  server.registerTool("list_market_regions", {
    title: "List market regions", description: "List retained regional market summaries and timestamps.", inputSchema: {}, annotations: READ_ONLY,
  }, async () => result(await loadMarketIndexHeaders()));

  server.registerTool("get_market_region", {
    title: "Read regional market data", description: "Read the complete retained order-book summary for one EVE region.", inputSchema: { regionId: z.number().int().positive() }, annotations: READ_ONLY,
  }, async ({ regionId }) => result(await loadMarketRegion(regionId)));

  server.registerTool("get_raw_market_region", {
    title: "Read raw regional order book", description: "Read every retained raw public market order for one region from the current complete snapshot. This can be a large response.", inputSchema: { regionId: z.number().int().positive() }, annotations: READ_ONLY,
  }, async ({ regionId }) => result(await loadRawMarketRegion(regionId, await loadCurrentRawMarketManifest("all") ?? undefined)));

  server.registerTool("get_market_dataset_status", {
    title: "Read market dataset status", description: "Read current raw-market manifest plus the latest all-region, radius and contract dataset metadata.", inputSchema: {}, annotations: READ_ONLY,
  }, async () => result({ raw: await loadCurrentRawMarketManifest(), all: await loadLatestMarketDatasetByMode("all"), radius: await loadLatestMarketDatasetByMode("radius"), contracts: await loadLatestMarketDatasetByMode("contracts") }));

  server.registerTool("cloudflare_wrangler_status", {
    title: "Check Cloudflare Wrangler",
    description: "Report the locally installed Wrangler version and authenticated Cloudflare account. OAuth credentials and token files are never returned.",
    inputSchema: {}, annotations: READ_ONLY,
  }, async () => result({ version: await runWrangler(["--version"], 15_000), account: await runWrangler(["whoami"], 30_000) }));

  server.registerTool("cloudflare_wrangler_run", {
    title: "Run Cloudflare Wrangler",
    description: "Run a non-interactive Wrangler command in the isolated New Eden Sage backend. Arguments are passed directly to Wrangler without a shell. Login/logout and interactive credential entry are blocked. Cloudflare mutations may deploy, change, or delete remote resources and should require user approval.",
    inputSchema: {
      args: z.array(z.string().min(1).max(500)).min(1).max(32),
      timeoutMs: z.number().int().min(1_000).max(300_000).default(120_000),
    }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async ({ args, timeoutMs }) => result(await runWrangler(args, timeoutMs)));

  await server.connect(new StdioServerTransport());
}
