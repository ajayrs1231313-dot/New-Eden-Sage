import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { access, readFile, readdir } from "node:fs/promises";
import { gunzip } from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadMarketIndexHeaders, loadMarketRegion, loadLatestMarketDatasetByMode } from "./market-storage";
import { loadCurrentRawMarketManifest, loadRawMarketRegion } from "./raw-market-storage";
import { loadMcpMarketRegion, loadMcpMarketRegionSummaries } from "./mcp-market-reader";
import { filterMcpRawMarketOrders, type McpRawMarketOrderFilterOptions } from "./mcp-raw-market-filter";
import { searchMcpMarketOrders } from "./mcp-market-search";
import { loadCurrentMarketRevision, loadCurrentSharedMarketManifest, loadSharedPreparedShortageDataset, loadSharedPreparedTradeDataset, loadSharedPublicContractsDataset, loadSharedPublicDataset, loadSharedPublicSource } from "./shared-market-data";
import { ANALYSIS_CACHE_ROOT, USER_DATA_ROOT } from "./data-paths";
import { calculateNavigationRoute, getNavigationNeighbours, getNavigationSystem, searchNavigationSystems } from "./universe-route-graph";
import { getWormholeReference, getWormholeReferenceEntry, getWormholeSystemReferences } from "./wormhole-reference";
import { PAGE_STATE_CACHE_KIND } from "./page-state-persistence";
import { getSnapshot as getDatabaseSnapshot, listSnapshots as listDatabaseSnapshots } from "./database";
import { SAGE_MCP_AI_INSTRUCTIONS, SAGE_CHARACTER_LIST_GUIDANCE, SAGE_CHARACTER_DATA_GUIDANCE, SAGE_SAVED_FITTINGS_GUIDANCE, SAGE_FIT_SKILL_GUIDANCE } from "./mcp-ai-policy";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
const FIT_IMPORT_INSTRUCTIONS = `When creating or importing a fit into New Eden Sage, call save_sage_fit. The fit payload is intentionally flexible: you may send a normal LLM JSON object, Sage JSON, ESI fitting JSON, a JSON array or wrapped collection of fits, EFT/PYFA text, PYFA XML, EVE DNA, fenced code blocks, or clearly labelled plain text sections. Prefer exact current EVE item names and realistic quantities. Type IDs are optional; omit uncertain IDs rather than inventing them. For JSON, preferred fields are: name, ship or hull, modules.high/mid/low/rig/subsystem, drones, fighters, cargo, implants, boosters, and instructions. Each item may be a string or an object such as { name, typeId?, quantity?, charge?, chargeTypeId?, chargeQuantity?, state? }. Multiple fits may be supplied at once. Sage normalizes all supported formats into its canonical fitting shape before saving.`;
const database = new DatabaseSync(path.join(process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd(), "new-eden-sage", "new-eden-sage.sqlite"), { readOnly: true });
const rendererDataPath = path.join(process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd(), "new-eden-sage", "mcp-renderer-data.json");
const execFileAsync = promisify(execFile);
const gunzipAsync = promisify(gunzip);

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

function listSnapshots() { return listDatabaseSnapshots(); }
function getSnapshot(characterId: string) { return getDatabaseSnapshot(characterId); }
function listImportedInformation() {
  return database.prepare("SELECT id, source_name, content, imported_at FROM imported_information ORDER BY imported_at DESC").all();
}
function parseJsonPayload(value: unknown) {
  if (typeof value !== "string") return null;
  try { return JSON.parse(value); } catch { return null; }
}

function readPlanetaryPlans(characterId?: string) {
  const rows = characterId
    ? database.prepare("SELECT id, name, character_id, payload, saved_at, updated_at FROM planetary_plans WHERE character_id = ? ORDER BY updated_at DESC").all(characterId)
    : database.prepare("SELECT id, name, character_id, payload, saved_at, updated_at FROM planetary_plans ORDER BY updated_at DESC").all();
  return (rows as any[]).map((row) => ({ id: row.id, name: row.name, characterId: row.character_id, savedAt: row.saved_at, updatedAt: row.updated_at, ...(parseJsonPayload(row.payload) ?? {}) }));
}

function readPlanetaryObservations(characterId?: string) {
  const rows = characterId
    ? database.prepare("SELECT payload FROM planetary_resource_observations WHERE character_id = ? ORDER BY observed_at DESC, id DESC").all(characterId)
    : database.prepare("SELECT payload FROM planetary_resource_observations ORDER BY observed_at DESC, id DESC").all();
  return (rows as any[]).map((row) => parseJsonPayload(row.payload)).filter(Boolean);
}

function readPlanetarySettings() {
  return (database.prepare("SELECT key, payload, updated_at FROM planetary_settings ORDER BY key").all() as any[]).map((row) => ({ key: row.key, updatedAt: row.updated_at, value: parseJsonPayload(row.payload) }));
}

function readProfitLedger(characterId?: string) {
  const rows = characterId
    ? database.prepare("SELECT payload FROM opportunity_profit_records WHERE character_id = ? ORDER BY completed_at DESC").all(characterId)
    : database.prepare("SELECT payload FROM opportunity_profit_records ORDER BY completed_at DESC").all();
  return (rows as any[]).map((row) => parseJsonPayload(row.payload)).filter(Boolean);
}

function readFoundryProjects(corporationId?: string) {
  const rows = corporationId
    ? database.prepare("SELECT payload FROM project_foundry_projects WHERE corporation_id = ? ORDER BY updated_at DESC").all(corporationId)
    : database.prepare("SELECT payload FROM project_foundry_projects ORDER BY updated_at DESC").all();
  return (rows as any[]).map((row) => parseJsonPayload(row.payload)).filter(Boolean);
}

function tableCount(table: string) {
  return Number((database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count?: number } | undefined)?.count ?? 0);
}

function listStoredDataDomains() {
  return [
    { domain: "characters", count: tableCount("character_snapshots"), description: "Synced EVE character snapshots and all private character datasets Sage retains." },
    { domain: "imported-information", count: tableCount("imported_information"), description: "User-imported notes and reference information." },
    { domain: "planetary-plans", count: tableCount("planetary_plans"), description: "Saved Planetary Industry plans and templates." },
    { domain: "planetary-observations", count: tableCount("planetary_resource_observations"), description: "Saved planetary resource survey observations." },
    { domain: "planetary-settings", count: tableCount("planetary_settings"), description: "Saved Planetary Industry alert and optimizer settings." },
    { domain: "profit-ledger", count: tableCount("opportunity_profit_records"), description: "Completed opportunity Profit & Loss ledger records." },
    { domain: "project-foundry", count: tableCount("project_foundry_projects"), description: "Saved industrial Project Foundry projects." },
    { domain: "legacy-market-summaries", count: tableCount("market_region_summaries"), description: "Legacy local market summaries retained for compatibility; prefer shared market MCP tools." },
  ];
}

function readStoredDataDomain(domain: string, characterId?: string, corporationId?: string) {
  switch (domain) {
    case "characters": return listSnapshots();
    case "imported-information": return listImportedInformation();
    case "planetary-plans": return readPlanetaryPlans(characterId);
    case "planetary-observations": return readPlanetaryObservations(characterId);
    case "planetary-settings": return readPlanetarySettings();
    case "profit-ledger": return readProfitLedger(characterId);
    case "project-foundry": return readFoundryProjects(corporationId);
    case "legacy-market-summaries": return (database.prepare("SELECT payload FROM market_region_summaries ORDER BY region_name").all() as any[]).map((row) => parseJsonPayload(row.payload)).filter(Boolean);
    default: throw new Error(`Unknown Sage data domain: ${domain}`);
  }
}

async function readWormholeCommandState() {
  try { return JSON.parse(await readFile(path.join(USER_DATA_ROOT, "wormhole-command-store-v1.json"), "utf8")); }
  catch { return null; }
}

function exportDatabaseData() {
  return {
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    application: "New Eden Sage",
    characterSnapshots: listSnapshots(),
    importedInformation: listImportedInformation(),
    planetaryPlans: readPlanetaryPlans(),
    planetaryResourceObservations: readPlanetaryObservations(),
    planetarySettings: readPlanetarySettings(),
    opportunityProfitRecords: readProfitLedger(),
    projectFoundryProjects: readFoundryProjects(),
  };
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

async function preparedPageStates() {
  let entries: import("node:fs").Dirent[] = [];
  try { entries = await readdir(ANALYSIS_CACHE_ROOT, { withFileTypes: true }); } catch { return []; }
  const prefix = `${PAGE_STATE_CACHE_KIND}-`;
  const states: Array<Record<string, unknown>> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith(".json.gz")) continue;
    try {
      const value = JSON.parse((await gunzipAsync(await readFile(path.join(ANALYSIS_CACHE_ROOT, entry.name)))).toString("utf8")) as Record<string, unknown>;
      if (value && typeof value.moduleId === "string" && value.scope && typeof value.savedAt === "string") states.push(value);
    } catch { /* Ignore corrupt or obsolete cached page state. */ }
  }
  return states.sort((a, b) => String(b.savedAt ?? "").localeCompare(String(a.savedAt ?? "")));
}

async function listPreparedPageStateHeaders() {
  return (await preparedPageStates()).map(({ payload: _payload, ...header }) => header);
}

async function getPreparedPageState(moduleId: string, scopeKind?: string, scopeId?: string) {
  return (await preparedPageStates()).find((value) => {
    if (value.moduleId !== moduleId) return false;
    const scope = value.scope as Record<string, unknown> | undefined;
    if (scopeKind && String(scope?.kind ?? "") !== scopeKind) return false;
    if (scopeId != null && String(scope?.id ?? "") !== scopeId) return false;
    return true;
  }) ?? null;
}

async function listReadableMarketRegions() {
  const shared = await loadMcpMarketRegionSummaries();
  if (shared.length) return shared.map(({ items: _items, topOrders: _topOrders, ...header }) => ({ ...header, source: "shared-prepared" }));
  return (await loadMarketIndexHeaders()).map((header: Record<string, unknown>) => ({ ...header, source: "legacy-local" }));
}

type MarketRegionReadOptions = { typeId?: number; query?: string; offset?: number; limit?: number };

function selectMarketRegionItems(region: any, options: MarketRegionReadOptions = {}) {
  const allItems = Array.isArray(region?.items) ? region.items : [];
  const query = String(options.query ?? "").trim().toLowerCase();
  const typeId = Number(options.typeId ?? 0);
  const filtered = allItems.filter((item: any) => {
    if (typeId > 0 && Number(item?.typeId) !== typeId) return false;
    if (query && !String(item?.typeName ?? "").toLowerCase().includes(query)) return false;
    return true;
  });
  const offset = Math.max(0, Number(options.offset ?? 0));
  const limit = Math.max(1, Math.min(1000, Number(options.limit ?? 250)));
  const items = filtered.slice(offset, offset + limit);
  return {
    ...region,
    items,
    itemPage: { offset, limit, returned: items.length, filteredItems: filtered.length, totalItems: allItems.length, hasMore: offset + items.length < filtered.length },
  };
}

async function readMarketRegion(regionId: number, options: MarketRegionReadOptions = {}) {
  const shared = await loadMcpMarketRegion(regionId);
  if (shared) return { source: "shared-prepared", ...selectMarketRegionItems(shared, options) };
  const legacy = await loadMarketRegion(regionId);
  return legacy ? { source: "legacy-local", ...selectMarketRegionItems(legacy, options) } : null;
}

type RawMarketRegionReadOptions = McpRawMarketOrderFilterOptions & { offset?: number; limit?: number };

async function readRawMarketRegion(regionId: number, options: RawMarketRegionReadOptions = {}) {
  const rawManifest = await loadCurrentRawMarketManifest("all");
  const raw = await loadRawMarketRegion(regionId, rawManifest ?? undefined);
  const offset = Math.max(0, Number(options.offset ?? 0));
  const limit = Math.max(1, Math.min(5000, Number(options.limit ?? 1000)));
  if (raw) {
    const selection = await filterMcpRawMarketOrders(Array.isArray(raw.orders) ? raw.orders : [], options);
    const orders = selection.orders.slice(offset, offset + limit);
    return {
      ...raw, source: "legacy-raw", rawOrdersAvailable: true, orders,
      orderPage: {
        offset, limit, returned: orders.length, filteredOrders: selection.filteredOrders, totalOrders: selection.totalOrders,
        hasMore: offset + orders.length < selection.filteredOrders, filters: selection.filters,
      },
    };
  }
  const shared = await loadMcpMarketRegion(regionId);
  if (!shared) return null;
  return {
    source: "shared-prepared",
    rawOrdersAvailable: false,
    note: "The server-managed shared generation is healthy. MCP streams authoritative regional aggregates directly so it does not load the complete raw order book or the global candidate-depth graph into the connector process. typeId can still target an aggregate item; system/security filters require a retained raw regional snapshot.",
    requestedRawFilters: {
      typeId: options.typeId ?? null, systemId: options.systemId ?? null, security: options.security ?? null,
      minSecurity: options.minSecurity ?? null, maxSecurity: options.maxSecurity ?? null,
    },
    ...selectMarketRegionItems(shared, { typeId: options.typeId, offset, limit: Math.min(limit, 1000) }),
  };
}

function legacyDatasetMetadata(value: any) {
  if (!value) return null;
  return {
    schemaVersion: value.schemaVersion ?? null,
    mode: value.mode ?? null,
    createdAt: value.createdAt ?? null,
    summaryCount: Array.isArray(value.summaries) ? value.summaries.length : 0,
  };
}

function rawManifestMetadata(value: any) {
  if (!value) return null;
  return {
    schemaVersion: value.schemaVersion ?? null,
    id: value.id ?? null,
    mode: value.mode ?? null,
    createdAt: value.createdAt ?? null,
    completedAt: value.completedAt ?? null,
    complete: value.complete === true,
    regionCount: Number(value.regionCount ?? 0),
    orderCount: Number(value.orderCount ?? 0),
  };
}

async function marketDatasetStatus() {
  const [current, shared, raw] = await Promise.all([
    loadCurrentMarketRevision(),
    loadCurrentSharedMarketManifest(),
    loadCurrentRawMarketManifest(),
  ]);
  const [all, radius, legacyContracts] = shared
    ? [null, null, null]
    : await Promise.all([
        loadLatestMarketDatasetByMode("all"),
        loadLatestMarketDatasetByMode("radius"),
        loadLatestMarketDatasetByMode("contracts"),
      ]);
  const publicData = shared?.files["public-shared"] ? await loadSharedPublicDataset() : null;
  const preparedArtifact = (key: string) => {
    const value = shared?.files[key];
    return value ? {
      snapshotId: value.version,
      createdAt: shared?.sourceCreatedAt ?? shared?.publishedAt ?? null,
      artifactBytes: value.bytes,
    } : null;
  };
  const tradeArtifact = preparedArtifact("market-trades");
  const shortageArtifact = preparedArtifact("market-shortages");
  const contractArtifact = preparedArtifact("public-contracts");
  return {
    current,
    shared: shared ? {
      schemaVersion: shared.schemaVersion, generation: shared.generation, publishedAt: shared.publishedAt, sourceCreatedAt: shared.sourceCreatedAt ?? null,
      source: shared.source, orderCount: shared.orderCount, regionCount: shared.regionCount, itemCount: shared.itemCount, regionalRowCount: shared.regionalRowCount,
      artifacts: Object.keys(shared.files).sort(),
    } : null,
    prepared: {
      trades: tradeArtifact ? { ...tradeArtifact, opportunityCount: shared?.tradeCandidateCount ?? null } : null,
      shortages: shortageArtifact ? { ...shortageArtifact, signalCount: shared?.shortageSignalCount ?? null } : null,
      contracts: contractArtifact ? { ...contractArtifact, regionCount: shared?.regionCount ?? null, contractCount: shared?.contractCount ?? null, pendingDetailCount: shared?.contractPendingDetailCount ?? null } : null,
      publicSources: publicData ? Object.keys(publicData.sources).sort() : [],
    },
    legacy: {
      raw: rawManifestMetadata(raw),
      all: legacyDatasetMetadata(all),
      radius: legacyDatasetMetadata(radius),
      contracts: legacyDatasetMetadata(legacyContracts),
      skippedBecauseSharedGenerationIsActive: Boolean(shared),
    },
  };
}

export async function startMcpServer() {
  const server = new McpServer({ name: "new-eden-sage", version: "0.1.0" }, { instructions: SAGE_MCP_AI_INSTRUCTIONS });

  server.registerTool("list_characters", {
    title: "List Sage characters", description: SAGE_CHARACTER_LIST_GUIDANCE, inputSchema: {}, annotations: READ_ONLY,
  }, async () => result((listSnapshots() as any[]).map((snapshot) => ({ characterId: snapshot.characterId, name: snapshot.character?.name, updatedAt: snapshot.updatedAt }))));

  server.registerTool("get_character_data", {
    title: "Read character data", description: SAGE_CHARACTER_DATA_GUIDANCE,
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

  server.registerTool("list_sage_data_domains", {
    title: "List Sage data domains", description: "Discover persisted New Eden Sage data domains and record counts, including PI, profit ledger and Project Foundry state that is not part of character snapshots.", inputSchema: {}, annotations: READ_ONLY,
  }, async () => result(listStoredDataDomains()));

  server.registerTool("get_sage_data_domain", {
    title: "Read Sage data domain", description: "Read one persisted Sage data domain. Use characterId to scope character-owned PI/profit data or corporationId to scope Project Foundry projects.",
    inputSchema: {
      domain: z.enum(["characters", "imported-information", "planetary-plans", "planetary-observations", "planetary-settings", "profit-ledger", "project-foundry", "legacy-market-summaries"]),
      characterId: z.string().optional(), corporationId: z.string().optional(),
    }, annotations: READ_ONLY,
  }, async ({ domain, characterId, corporationId }) => result(readStoredDataDomain(domain, characterId, corporationId)));

  server.registerTool("get_imported_information", {
    title: "Read imported information", description: "Read all user-imported notes and reference documents stored in Sage.", inputSchema: {}, annotations: READ_ONLY,
  }, async () => result(listImportedInformation()));

  server.registerTool("get_saved_fittings", {
    title: "Read saved fittings", description: SAGE_SAVED_FITTINGS_GUIDANCE, inputSchema: {}, annotations: READ_ONLY,
  }, async () => result(await rendererData()));

  server.registerTool("list_sage_controls", {
    title: "List live Sage controls",
    description: "Discover the complete live New Eden Sage renderer control surface: buttons, tabs, links, inputs, selects, checkboxes, switches, menu items, sliders and other actionable elements. Control IDs remain valid while those elements remain mounted. Use includeHidden=true to include controls in cached/hidden Sage views. Sage must be open.",
    inputSchema: {
      query: z.string().max(300).optional(),
      includeHidden: z.boolean().default(false),
      limit: z.number().int().min(1).max(2000).default(500),
    },
    annotations: READ_ONLY,
  }, async (input) => result(await writeAction("list_sage_controls", input)));

  server.registerTool("invoke_sage_control", {
    title: "Operate a live Sage control",
    description: "Operate any control returned by list_sage_controls. Supports click, text/value entry, select changes, checkbox/radio state, focus/blur, key presses and scrolling. This is the generic UI control path for every Sage page, including controls added in future releases. Sage must be open.",
    inputSchema: {
      controlId: z.string().min(1),
      action: z.enum(["click", "set_value", "select_option", "set_checked", "focus", "blur", "press_key", "scroll_into_view"]),
      value: z.unknown().optional(),
      key: z.string().max(100).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async (input) => result(await writeAction("invoke_sage_control", input)));

  server.registerTool("list_sage_actions", {
    title: "List Sage renderer actions",
    description: "Discover every function exposed by Sage's renderer bridge. This includes app commands and data operations behind the visible UI; event-subscription functions are identified separately. Sage must be open.",
    inputSchema: {},
    annotations: READ_ONLY,
  }, async () => result(await writeAction("list_sage_actions", {})));

  server.registerTool("invoke_sage_action", {
    title: "Invoke a Sage renderer action",
    description: "Invoke any one-shot function exposed by Sage's renderer bridge using its exact action name and positional JSON arguments. This provides direct MCP access to Sage actions that may not have a dedicated MCP tool. Event subscriptions are discoverable but are not one-shot actions. Sage must be open.",
    inputSchema: {
      actionName: z.string().min(1).max(200),
      args: z.array(z.unknown()).max(32).default([]),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async ({ actionName, args }) => result(await writeAction("invoke_sage_action", { actionName, args })));

  server.registerTool("save_sage_fit", {
    title: "Create or update a Sage fit",
    description: SAGE_FIT_SKILL_GUIDANCE + " " + FIT_IMPORT_INSTRUCTIONS + " Sage must be open.",
    inputSchema: { fit: z.unknown() }, annotations: WRITE,
  }, async ({ fit }) => result(await writeAction("save_sage_fit", { fit })));

  server.registerTool("delete_sage_fit", {
    title: "Delete a Sage fit",
    description: "Permanently remove one fitting and its library metadata from New Eden Sage. Sage must be open.",
    inputSchema: { fitId: z.string().min(1) }, annotations: DESTRUCTIVE,
  }, async ({ fitId }) => result(await writeAction("delete_sage_fit", { fitId })));

  server.registerTool("push_eve_fitting", {
    title: "Push a fitting to EVE Online",
    description: SAGE_FIT_SKILL_GUIDANCE + " Create a fitting in the selected connected character's live EVE Online fitting library. The character must be reconnected after this update to grant fitting write permission, and Sage must be open.",
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

  server.registerTool("search_navigation_systems", {
    title: "Search EVE systems", description: "Search the same local CCP SDE universe graph used by Sage Navigation Command.", inputSchema: { query: z.string().min(1).max(200), limit: z.number().int().min(1).max(100).default(20) }, annotations: READ_ONLY,
  }, async ({ query, limit }) => result(await searchNavigationSystems(query, limit)));

  server.registerTool("get_navigation_system", {
    title: "Read navigation system", description: "Read static navigation metadata and coordinates for one solar system from Sage's prepared universe graph.", inputSchema: { systemId: z.number().int().positive() }, annotations: READ_ONLY,
  }, async ({ systemId }) => result(await getNavigationSystem(systemId)));

  server.registerTool("get_navigation_neighbours", {
    title: "Read navigation neighbours", description: "Read direct stargate neighbours for one solar system from Sage's prepared universe graph.", inputSchema: { systemId: z.number().int().positive() }, annotations: READ_ONLY,
  }, async ({ systemId }) => result(await getNavigationNeighbours(systemId)));

  server.registerTool("calculate_navigation_route", {
    title: "Calculate navigation route", description: "Calculate a route with the same local route engine used by Sage Navigation Command. Supports shortest, safer, less-secure and high-sec profiles plus avoidance lists.",
    inputSchema: {
      from: z.number().int().positive(), to: z.number().int().positive(), mode: z.enum(["shortest", "safer", "less-secure", "high-sec"]).default("shortest"),
      minSecurity: z.number().min(-1).max(1).nullable().optional(), avoidSystemIds: z.array(z.number().int().positive()).max(500).optional(),
      avoidConstellationIds: z.array(z.number().int().positive()).max(200).optional(), avoidRegionIds: z.array(z.number().int().positive()).max(200).optional(), excludedSystemIds: z.array(z.number().int().positive()).max(500).optional(),
    }, annotations: READ_ONLY,
  }, async (input) => result(await calculateNavigationRoute(input)));

  server.registerTool("get_wormhole_reference", {
    title: "Read wormhole reference", description: "Read Sage's CCP-SDE-derived wormhole reference. Supply a code for one wormhole type, systemIds for wormhole-system metadata, or neither for the complete wormhole type list.",
    inputSchema: { code: z.string().max(20).optional(), systemIds: z.array(z.number().int().positive()).max(500).optional() }, annotations: READ_ONLY,
  }, async ({ code, systemIds }) => {
    if (code) return result(await getWormholeReferenceEntry(code));
    if (systemIds?.length) return result(await getWormholeSystemReferences(systemIds));
    return result(await getWormholeReference());
  });

  server.registerTool("get_wormhole_command_state", {
    title: "Read Wormhole Command state", description: "Read the persisted local Wormhole Command chain, signatures, connections, watches, alerts and map state. Returns null if no local wormhole workspace has been created.", inputSchema: {}, annotations: READ_ONLY,
  }, async () => result(await readWormholeCommandState()));

  server.registerTool("search_market_orders", {
    title: "Search Sage market orders",
    description: "Search Sage market orders using the same controls as the desktop Market Search: item/type, buy/sell side, security band, region, exact named systems, system text, station/structure text, price range, minimum remaining volume, origin-system jump distance, sorting and pagination. Exact retained raw orders are used when present; otherwise the installed server-managed generation supplies retained top order candidates plus exact all-order regional/security best-price signals in regionalBest. Always inspect coverage before treating an order-level filtered result as exhaustive.",
    inputSchema: {
      query: z.string().max(200).default(""),
      typeId: z.number().int().positive().optional(),
      side: z.enum(["all", "buy", "sell"]).default("all"),
      security: z.enum(["all", "high", "low", "null"]).default("all"),
      regionId: z.number().int().positive().nullable().optional(),
      minPrice: z.number().min(0).nullable().optional(),
      maxPrice: z.number().min(0).nullable().optional(),
      minVolume: z.number().min(0).nullable().optional(),
      systemNames: z.array(z.string().min(1).max(100)).max(100).optional(),
      systemQuery: z.string().max(200).optional(),
      locationQuery: z.string().max(200).optional(),
      originSystemId: z.number().int().positive().nullable().optional(),
      maxJumps: z.number().int().min(0).nullable().optional(),
      sort: z.enum(["sell-lowest", "buy-highest", "price-low", "price-high", "volume", "newest", "distance"]).default("sell-lowest"),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(25).max(500).default(200),
    },
    annotations: READ_ONLY,
  }, async (input) => result(await searchMcpMarketOrders(input)));
  server.registerTool("list_market_regions", {
    title: "List market regions", description: "List the currently installed Sage market regions from the same server-managed shared generation used by the desktop UI, with legacy local fallback.", inputSchema: {}, annotations: READ_ONLY,
  }, async () => result(await listReadableMarketRegions()));

  server.registerTool("get_market_region", {
    title: "Read regional market data", description: "Read retained regional market aggregates for one EVE region from the same server-managed dataset used by Sage. Item rows are paginated; use typeId or query to target an item without returning the entire region.",
    inputSchema: { regionId: z.number().int().positive(), typeId: z.number().int().positive().optional(), query: z.string().max(200).optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(1000).default(250) }, annotations: READ_ONLY,
  }, async ({ regionId, typeId, query, offset, limit }) => result(await readMarketRegion(regionId, { typeId, query, offset, limit })));

  server.registerTool("get_raw_market_region", {
    title: "Read regional order data", description: "Read retained raw regional market orders with filtering before pagination. Filter by exact typeId, exact systemId, security band (high/low/null), and/or displayed EVE security range via minSecurity/maxSecurity. On server-managed generations without retained raw orders, typeId still targets aggregate item data while system/security filters are reported as unavailable.",
    inputSchema: {
      regionId: z.number().int().positive(),
      typeId: z.number().int().positive().optional(),
      systemId: z.number().int().positive().optional(),
      security: z.enum(["high", "low", "null"]).optional(),
      minSecurity: z.number().min(-1).max(1).optional(),
      maxSecurity: z.number().min(-1).max(1).optional(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(5000).default(1000),
    }, annotations: READ_ONLY,
  }, async ({ regionId, typeId, systemId, security, minSecurity, maxSecurity, offset, limit }) => result(await readRawMarketRegion(regionId, { typeId, systemId, security, minSecurity, maxSecurity, offset, limit })));

  server.registerTool("get_market_dataset_status", {
    title: "Read market dataset status", description: "Read the active shared market generation, prepared trade/shortage/contract coverage, public source catalog, and legacy fallback metadata.", inputSchema: {}, annotations: READ_ONLY,
  }, async () => result(await marketDatasetStatus()));

  server.registerTool("get_market_trade_opportunities", {
    title: "Read prepared trade opportunities", description: "Read server-prepared market trade opportunities from the installed shared generation.",
    inputSchema: { limit: z.number().int().min(1).max(500).default(100) }, annotations: READ_ONLY,
  }, async ({ limit }) => { const value = await loadSharedPreparedTradeDataset(); return result(value ? { ...value, opportunities: value.opportunities.slice(0, limit), returned: Math.min(limit, value.opportunities.length), total: value.opportunities.length } : null); });

  server.registerTool("get_market_shortages", {
    title: "Read prepared market shortages", description: "Read server-prepared regional shortage signals from the installed shared generation.",
    inputSchema: { limit: z.number().int().min(1).max(500).default(100) }, annotations: READ_ONLY,
  }, async ({ limit }) => { const value = await loadSharedPreparedShortageDataset(); return result(value ? { ...value, signals: value.signals.slice(0, limit), returned: Math.min(limit, value.signals.length), total: value.signals.length } : null); });

  server.registerTool("get_public_contracts", {
    title: "Read public contracts", description: "Read server-prepared public contracts from the installed shared generation, optionally restricted to one region.",
    inputSchema: { regionId: z.number().int().positive().optional(), limit: z.number().int().min(1).max(1000).default(250) }, annotations: READ_ONLY,
  }, async ({ regionId, limit }) => {
    const value = await loadSharedPublicContractsDataset();
    if (!value) return result(null);
    const regions = regionId ? value.regions.filter((region) => region.regionId === regionId) : value.regions;
    let remaining = limit;
    const selected = regions.map((region) => { const publicContracts = region.publicContracts.slice(0, Math.max(0, remaining)); remaining -= publicContracts.length; return { ...region, publicContracts }; }).filter((region) => region.publicContracts.length > 0 || regionId != null);
    return result({ snapshotId: value.snapshotId, createdAt: value.createdAt, regionCount: value.regionCount, contractCount: value.contractCount, pendingDetailCount: value.pendingDetailCount, returned: limit - remaining, regions: selected });
  });

  server.registerTool("list_public_data_sources", {
    title: "List shared public data sources", description: "List every server-prepared public-data source installed in Sage so AI clients can discover available non-character data without guessing schemas.", inputSchema: {}, annotations: READ_ONLY,
  }, async () => { const value = await loadSharedPublicDataset(); return result(value ? Object.entries(value.sources).map(([source, entry]) => ({ source, fetchedAt: entry.fetchedAt })) : []); });

  server.registerTool("get_public_data_source", {
    title: "Read shared public data source", description: "Read one named server-prepared public-data source from the installed Sage generation.", inputSchema: { source: z.string().min(1) }, annotations: READ_ONLY,
  }, async ({ source }) => result(await loadSharedPublicSource(source)));

  server.registerTool("list_prepared_page_states", {
    title: "List prepared page states", description: "List persisted last-known-good prepared page states produced by Sage modules, without payloads, so AI clients can discover derived app intelligence across pages.", inputSchema: {}, annotations: READ_ONLY,
  }, async () => result(await listPreparedPageStateHeaders()));

  server.registerTool("get_prepared_page_state", {
    title: "Read prepared page state", description: "Read the newest persisted last-known-good prepared state for a Sage module and optional scope. Credentials and secrets are sanitized before return.",
    inputSchema: { moduleId: z.string().min(1), scopeKind: z.enum(["global", "account", "character", "region"]).optional(), scopeId: z.string().optional() }, annotations: READ_ONLY,
  }, async ({ moduleId, scopeKind, scopeId }) => result(await getPreparedPageState(moduleId, scopeKind, scopeId)));

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
