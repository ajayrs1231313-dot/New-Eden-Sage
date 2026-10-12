import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readConfig, decrypt } from "./config";
import { SAGE_ONLINE_URL } from "./sage-online";
import { sageMcpLaunch } from "./mcp-launch";
import { SAGE_MCP_AI_INSTRUCTIONS } from "./mcp-ai-policy";
import { getFittingCatalogueLocal, getFittingTypeInfoLocal } from "./fitting-dogma";
import { mentionsName, planStrategicRequest, type StrategicPlan } from "./strategic-router";
import { answerShipFacts } from "./strategic-facts";
import { estimateStrategicDuration, estimateLabel, requestComplexity, type StrategicProgress, type StrategicTiming } from "./strategic-timing";
import { USER_DATA_ROOT } from "./data-paths";
import { promises as timingFs } from "node:fs";
import timingPath from "node:path";

const timingFile = timingPath.join(USER_DATA_ROOT, "strategic-timings.json");
let timingWrites: Promise<unknown> = Promise.resolve();
async function readStrategicTimings(): Promise<StrategicTiming[]> {
  try { const rows = JSON.parse(await timingFs.readFile(timingFile, "utf8")); return Array.isArray(rows) ? rows.slice(-80) : []; }
  catch { return []; }
}
function recordStrategicTiming(row: StrategicTiming) {
  timingWrites = timingWrites.then(async () => {
    const rows = [...await readStrategicTimings(), row].slice(-80);
    await timingFs.mkdir(USER_DATA_ROOT, { recursive: true });
    await timingFs.writeFile(timingFile, JSON.stringify(rows));
  }).catch(() => undefined);
}

type StrategicMessage = { role: "user" | "assistant"; content: string };

type McpTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};

type SageAiToolCall = {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string | Record<string, unknown> };
};

type SageAiMessage = {
  role?: string;
  content?: string | null;
  tool_calls?: SageAiToolCall[];
  reasoning_content?: string | null;
};

let mcpClientPromise: Promise<Client> | null = null;
let cachedTools: McpTool[] | null = null;
let characterCacheSession = "";
let characterCacheExpiresAt = 0;
type StrategicCharacterSessionCache = {
  characters: any[] | null;
  sections: Map<string, unknown>;
};

const strategicCharacterSessionCache: StrategicCharacterSessionCache = {
  characters: null,
  sections: new Map(),
};

export function invalidateStrategicCharacterCache(characterId?: string) {
  if (!characterId) {
    strategicCharacterSessionCache.characters = null;
    strategicCharacterSessionCache.sections.clear();
    return;
  }
  const prefix = String(characterId) + ":";
  for (const key of strategicCharacterSessionCache.sections.keys()) {
    if (key.startsWith(prefix)) strategicCharacterSessionCache.sections.delete(key);
  }
}

async function cachedCharacterRoster(client: Client, force = false) {
  if (!force && strategicCharacterSessionCache.characters) return strategicCharacterSessionCache.characters;
  const listed = await client.callTool({ name: "list_characters", arguments: {} }, undefined, { timeout: 10_000 });
  if (listed.isError) throw new Error("Sage character roster could not be read.");
  const characters = (listed as any)?.structuredContent?.data;
  if (Array.isArray(characters)) strategicCharacterSessionCache.characters = characters;
  return Array.isArray(characters) ? characters : [];
}

async function cachedCharacterSection(client: Client, characterId: string, section: string, force = false) {
  const key = characterId + ":" + section;
  if (!force && strategicCharacterSessionCache.sections.has(key)) return strategicCharacterSessionCache.sections.get(key);
  const result = await client.callTool({ name: "get_character_data", arguments: { characterId, section } }, undefined, { timeout: 10_000 });
  if (result.isError) throw new Error(`Sage could not read character ${section}.`);
  const compact = compactToolResult("get_character_data", result, { characterId, section });
  if (section === "skills" && !Array.isArray((compact as any)?.skills)) {
    throw new Error("Character skills have not been synced in Sage.");
  }
  strategicCharacterSessionCache.sections.set(key, compact);
  return compact;
}

async function getMcpClient() {
  if (!mcpClientPromise) {
    mcpClientPromise = (async () => {
      const launch = sageMcpLaunch();
      const client = new Client({ name: "new-eden-sage-strategic-command", version: "1.0.0" });
      const transport = new StdioClientTransport({
        command: launch.command,
        args: launch.args,
        env: { ...process.env, ...launch.env } as Record<string, string>,
        stderr: "pipe",
        maxBufferSize: 32 * 1024 * 1024,
      });
      client.onclose = () => {
        mcpClientPromise = null;
        cachedTools = null;
        invalidateStrategicCharacterCache();
      };
      await client.connect(transport);
      return client;
    })().catch((error) => {
      mcpClientPromise = null;
      throw error;
    });
  }
  return mcpClientPromise;
}

async function getTools(refresh = false): Promise<McpTool[]> {
  if (!cachedTools || refresh) {
    const client = await getMcpClient();
    const listed = await client.listTools();
    cachedTools = listed.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      annotations: tool.annotations,
    }));
  }
  return cachedTools;
}


function toolCatalogue(tools: McpTool[]) {
  return tools.map((tool) => {
    const mode = tool.annotations?.destructiveHint
      ? "DESTRUCTIVE"
      : tool.annotations?.readOnlyHint
        ? "READ"
        : "ACTION";
    return `- ${tool.name} [${mode}]: ${tool.description || "No description supplied."}`;
  }).join("\n");
}

function strategicInstructions(_tools: McpTool[]) {
  return `You are Sage AI, the embedded strategic intelligence layer inside New Eden Sage.

YOUR JOB
You are not a generic EVE chatbot. You are the strategic operator for the user's Sage installation. Turn the user's intent into evidence-backed decisions by using Sage's MCP tools. Read Sage before guessing. Treat Sage data, timestamps, permissions, saved fittings, market generations, corporation workflows and local state as authoritative for this installation.

You should:
- understand which Sage command owns the request;
- use MCP tools proactively when Sage can answer from real data;
- combine information across Character, Fitting, Asset, ISK, Market, Navigation, Wormhole, Industrial, Corporation and Fleet Command when the task genuinely spans them;
- explain conclusions in operational terms: what to do, why, risks, blockers and the next useful action;
- distinguish observed Sage facts from general EVE knowledge;
- never invent character skills, assets, prices, fits, roles, permissions, routes, contracts or corporation state;
- prefer dedicated subsystem tools over generic UI control;
- use live UI controls only for last-mile application operation;
- keep answers concise unless the user asks for deep analysis;
- use Sage web search when current or external knowledge would materially improve the answer;
- open and read promising sources before relying on snippets, and include useful source URLs in the final answer when web research was used.

OPERATIONAL SCALE AND REALISM
Never recommend a theoretically optimal plan that assumes organisation, infrastructure, logistics, security or capital the user has not demonstrated. Before giving industrial, logistics, market, deployment, structure, moon, reaction, capital-production or null-sec advice, reason about the operator's real scale.

Use this capability ladder:
1. SOLO PLAYER
   - One player, often one or a few characters/accounts.
   - Limited simultaneous hauling, mining, scouting, cynos, defence and replacement capacity.
   - Assume no guaranteed structure ownership, standing fleet, jump-freighter chain, capital umbrella, SRP, moon control or safe null staging unless Sage proves otherwise.
   - Favour low-complexity, liquid, reversible plans with short logistics chains and limited assets at risk.

2. SMALL CORPORATION
   - Roughly a handful to a few dozen active pilots.
   - Can coordinate specialised roles and shared structures, but usually has limited timezone coverage, defence depth and logistics redundancy.
   - May operate in low/null/wormhole space, but must account for structure vulnerability, evacuation, fuel, hauling, market access and concentration risk.
   - Do not assume reliable JF service, capital umbrella, protected moons or permanent infrastructure unless Sage evidence shows it.

3. LARGE CORPORATION
   - Enough active members for specialist industry, hauling, mining, defence and scheduled operations.
   - Can sustain more infrastructure and stock, but still depends on alliance access, logistics and strategic security.
   - Optimise throughput only after validating structure access, hauling capacity, market exit and replacement plans.

4. SMALL ALLIANCE
   - Several corporations with shared infrastructure and logistics.
   - Can support distributed industry, reactions, moon programmes and organised defence, but cannot be treated like a major null bloc.
   - Check timezone coverage, route security, staging, cyno/JF availability, doctrine demand, fuel and evacuation capacity.

5. LARGE ALLIANCE / MAJOR NULL BLOC
   - Deep logistics, multiple structures, broad market access, defence fleets, SRP, capital support and redundant infrastructure may exist.
   - Only at this scale may Sage assume bloc-style vertical integration when the relevant infrastructure is actually verified.

For every recommendation:
- identify the minimum realistic scale required;
- distinguish "possible" from "sensible";
- prefer the simplest safe option that achieves the user's goal;
- compare local/high-sec/low-sec/null-sec/wormhole alternatives when location materially changes risk or economics;
- include logistics and extraction/evacuation cost, not just manufacturing bonus or tax savings;
- treat original blueprints and valuable BPC collections as strategic assets: do not recommend moving them into higher-risk space merely for marginal efficiency;
- never assume access to an engineering complex, Sotiyo/Azbel/Raitaru-class facility, reactions, moon drills, jump freighters, cyno chain, ansiblex network, capital umbrella, protected staging or alliance market unless Sage can verify it;
- if scale/infrastructure is unknown, either inspect Sage first or explicitly qualify the advice by scale instead of silently assuming a major alliance;
- when a plan becomes unrealistic below a certain scale, say so clearly and offer the smaller-scale alternative.

INDUSTRY REALISM
When evaluating manufacturing or blueprint use, include all of: blueprint transport risk, input hauling, output hauling, structure ownership/access, rig bonuses, job fees, taxes, fuel dependence, system security, asset-safety/extraction path, local demand, market liquidity, defence requirement, capital tied up and replacement time. A lower headline build cost does not make a location better if logistics or loss exposure overwhelms the saving.

MANUFACTURING DEPENDENCY RULES
Never treat possession of a hull BPO/BPC as proof that the user can manufacture the hull from raw minerals.
Before recommending any manufacturing job:
- expand the actual manufacturing inputs for that exact blueprint;
- distinguish raw materials from intermediate components;
- if intermediate components are required, determine whether the plan is BUY COMPONENTS or BUILD COMPONENTS;
- for BUILD COMPONENTS, verify the user has access to the required component blueprints/BPCs, the skills to use them, enough manufacturing slots, and a legal facility;
- for BUY COMPONENTS, include component purchase cost, market depth, hauling volume, hauling risk and local availability;
- include component build time in the schedule. Do not quote final-hull job time as total project time when components must first be manufactured;
- never multiply a profit signal by more runs than the user actually owns unless the recommendation explicitly includes acquiring additional BPCs and their cost;
- if Sage data reports an opportunity with a run count that conflicts with the user's owned blueprint runs, treat that as an opportunity-market signal, not as executable inventory.

CAPITAL AND INDUSTRIAL COMMAND SHIP RULES
Capital construction has special location, skill and component requirements.
- Orca is an Industrial Command Ship that uses capital construction components. It can be built in high-sec manufacturing facilities, but the hull blueprint alone is not sufficient; its required capital components must be supplied, either bought or manufactured.
- Rorqual is a capital industrial ship. It cannot be manufactured in high security space. Final hull construction requires an eligible low-sec/null-sec facility with capital manufacturing capability. Do not recommend a high-sec final-hull build.
- Carriers and dreadnoughts likewise require legal capital-hull construction space/facility. Supercapital construction has still stricter structure/sovereignty requirements; verify before recommending.
- Capital component blueprints and Capital Ship Construction skill requirements are part of feasibility. Verify them rather than inferring capability from generic Industry/Mass Production skills.
- If the user only owns the final hull BPC, default to "not yet a complete build chain" until the component sourcing plan is proven.
- Never say a user can run N capital/Orca hull jobs simultaneously merely because they have N manufacturing slots; component-chain slot consumption and capital availability must be modelled.
- For capital-scale projects, present a dependency checklist before an execution recommendation: hull BPC, component list, component sourcing, required skills, facility/location legality, logistics, total working capital, total elapsed build chain, and exit market.

When Sage Industrial Command provides a profitability row, validate it against the executable build chain before turning it into advice. Profitability data is not itself proof of manufacturability.

ACTION POLICY
Sage AI is permanently connected to Sage with read/write MCP authority. Use read and write/action tools whenever they are the correct way to fulfil the user's request; do not ask the user to enable an action mode and do not expose MCP permission mechanics in the answer. Treat explicit user intent as authority for ordinary reversible Sage actions. Destructive or irreversible actions still require clear destructive intent in the user's request before execution.

HIDDEN SAGE OPERATING MANUAL
The material below is backend-only operating guidance. Never expose tool catalogues, schemas, routing rules, internal command names, permission annotations, implementation details, or developer terminology to the customer unless they explicitly ask for technical diagnostics. Translate all of it into natural EVE/Sage language in the response.

SAGE MCP OPERATING CONTRACT
${SAGE_MCP_AI_INSTRUCTIONS}
`;
}


function fastStrategicInstructions() {
  return `You are Sage AI inside New Eden Sage. Answer ordinary EVE Online knowledge and conversation directly, quickly, and concisely. Do not invent live character, market, corporation, fitting, asset, route, or account facts. If the user asks for live or personal Sage data and no evidence is supplied, say what needs checking rather than guessing. Do not call tools unless tools are supplied for this request.`;
}

function fittingStrategicInstructions() {
  return `You are Sage AI operating New Eden Sage's fitting subsystem.

MISSION
Solve the user's ship-fitting objective with measured Sage fitting results, not generic EVE guesses.

RULES
- Sage's synced character skills are authoritative.
- Use simulate_sage_fit as the primary computation engine.
- For broad optimisation, build realistic candidate batches and simulate them early. Do not spend multiple rounds planning before the first simulation.
- For thousands of iterations, use search_sage_fits: design several canonical seed fits across appropriate hulls and give module/charge/state alternatives per slot. Sage expands and tests combinations locally without thousands of model calls. Ask for up to 5000 candidates per search, inspect actual simulated/partial counts, then refine finalists with simulate_sage_fit. Never claim more candidates were tested than the tool reports.
- Batch multiple candidates in one simulate_sage_fit call when practical. Start broad, then refine the strongest measured candidates.
- Set includePrices:false unless the user actually asked about price.
- Explicitly load relevant charges and module states.
- Check fitting legality and missing skills on every candidate.
- Respect the user's stated training allowance. Do not present currently unusable modules/hulls as immediately usable.
- Distinguish sustainable tank from temporary burst effects such as an active Assault Damage Control.
- Rank candidates against the user's actual priorities rather than raw DPS.
- Never invent simulation results.
- Do not use web research unless it is explicitly available and the user requested current/meta/patch verification.
- Once you have enough measured evidence, stop tool use and answer clearly with the winning fit(s), trade-offs, and any training blockers.

For the current request, move to simulation quickly.`;
}

const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "sage_web_search",
    description: "Search the public web for current information. Use this for EVE Online documentation, guides, patch notes, community information, and other web research permitted for this Sage account.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The web search query." },
        max_results: { type: "integer", minimum: 1, maximum: 10, default: 6 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

const WEB_OPEN_TOOL = {
  type: "function",
  function: {
    name: "sage_web_open",
    description: "Open and read a public web page returned by search or supplied by the user. State the research purpose so Sage can enforce the account's browsing policy.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Public http or https URL to open." },
        purpose: { type: "string", description: "Why this page is being opened and what information is needed." },
        max_chars: { type: "integer", minimum: 2000, maximum: 60000, default: 30000 },
      },
      required: ["url", "purpose"],
      additionalProperties: false,
    },
  },
};

function selectStrategicTools(tools: McpTool[], message: string) {
  const q = message.toLowerCase();
  const names = new Set<string>();

  const add = (...values: string[]) => values.forEach((value) => names.add(value));
  const personalContextRequest = /\b(my|me|character|characters|account|assets?|wallet|skills?|training|can i|do i|am i)\b/i.test(message);
  if (personalContextRequest) {
    add("list_characters", "get_character_data", "list_character_data_points");
  }

  if (/\b(fit|fitting|dps|tank|ehp|capacitor|tackle|scram|point|web|mwd|afterburner|module|rig|drone|ammo|weapon|simulate)\b/.test(q) || (personalContextRequest && /\b(ship|hull|fly|use)\b/.test(q))) {
    add("simulate_sage_fit");

    if (/saved|existing|current fit|my fit|my fitting|library|already have|already saved/.test(q)) {
      add("get_saved_fittings");
    }
    if (/save|import|store|add to (?:sage|library)/.test(q)) {
      add("save_sage_fit");
    }
    if (/push|send|upload|to eve|eve fitting/.test(q)) {
      add("push_eve_fitting");
    }
  }

  if (/market|price|cost|isk|buy|sell|order|trade|liquid|jita|amarr|hek|rens|dodixie|shortage/.test(q)) {
    add(
      "get_market_dataset_status",
      "search_market_orders",
      "quote_market_depth",
      "get_market_region",
      "get_market_trade_opportunities",
      "get_market_shortages",
    );
  }

  if (/(?:corp(?:oration)?\s+)?buyback|buy back|corp(?:oration)? payout|member payout|ore buyback|ice buyback|gas buyback|salvage buyback/.test(q)) {
    add("calculate_corp_ore_buyback");
  }

  if (/route|jump|system|nearest|nearby|travel|gate|path|avoid|navigation/.test(q)) {
    add(
      "search_navigation_systems",
      "get_navigation_system",
      "get_navigation_neighbours",
      "calculate_navigation_route",
    );
  }

  if (/wormhole|w-space|hole|static|mass|polariz|chain/.test(q)) {
    add("get_wormhole_reference", "get_wormhole_command_state");
  }

  if (/contract|bpo|bpc|blueprint|me10|te20/.test(q)) {
    add("search_public_contracts", "get_public_contracts");
  }

  if (/industry|manufactur|invent|reaction|planet|pi\b|foundry|profit|ledger|project/.test(q)) {
    add(
      "list_sage_data_domains",
      "get_sage_data_domain",
      "list_prepared_page_states",
      "get_prepared_page_state",
    );
  }

  if (/public data|source|dataset|patch|event|news/.test(q)) {
    add("list_public_data_sources", "get_public_data_source");
  }

  if (/control|click|open tab|navigate ui|operate sage|button|checkbox|select/.test(q)) {
    add("list_sage_controls", "invoke_sage_control", "list_sage_actions", "invoke_sage_action");
  }

  if (/command override owner/.test(q)) {
    for (const tool of tools) {
      if (
        tool.name.startsWith("dev_eve_third_party_") ||
        tool.name.startsWith("dev_workspace_") ||
        tool.name.startsWith("cloudflare_wrangler_")
      ) names.add(tool.name);
    }
  }

  return tools.filter((tool) => names.has(tool.name));
}

function aiFacingToolSchema(tool: McpTool) {
  if (tool.name === "simulate_sage_fit") {
    return {
      type: "object",
      properties: {
        characterId: { type: "string", description: "Resolved numeric Sage character ID." },
        fit: { type: "string", description: "One EFT/PYFA text fit. Use either fit or fits." },
        fitId: { type: "string", description: "One saved Sage fitting ID. Use either fitId or fits." },
        fits: {
          type: "array",
          maxItems: 100,
          description: "Batch of candidate fits. Prefer EFT/PYFA text in fit.",
          items: {
            type: "object",
            properties: {
              fit: { type: "string" },
              fitId: { type: "string" },
            },
          },
        },
        targetProfile: {
          type: "object",
          properties: {
            rangeM: { type: "number" },
            signatureRadiusM: { type: "number" },
            transverseVelocityMps: { type: "number" },
            velocityMps: { type: "number" },
          },
        },
        damageProfile: {
          type: "object",
          properties: {
            em: { type: "number" },
            thermal: { type: "number" },
            kinetic: { type: "number" },
            explosive: { type: "number" },
          },
        },
        includeCurrentImplants: { type: "boolean" },
        includePrices: { type: "boolean" },
        batchDetail: { type: "string", enum: ["summary", "full"] },
      },
      required: ["characterId"],
    };
  }
  return tool.inputSchema;
}

function sageAiTools(tools: McpTool[], includeWeb = true) {
  return [
    ...tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.name === "simulate_sage_fit"
          ? "Run Sage's real fitting engine for one or many candidate fits using the selected character's synced skills. Batch aggressively for optimisation."
          : (tool.description || `New Eden Sage MCP tool: ${tool.name}`),
        parameters: aiFacingToolSchema(tool),
      },
    })),
    ...(includeWeb ? [WEB_SEARCH_TOOL, WEB_OPEN_TOOL] : []),
  ];
}

async function sageAiCompletion(
  sessionToken: string,
  body: Record<string, unknown>,
  requestId?: string,
  timeoutMs = 120_000,
): Promise<{ requestId: string; result?: any; blocked?: boolean; message?: string; developerMode?: boolean }> {
  const response = await fetch(`${SAGE_ONLINE_URL}/v1/strategic-ai/completion`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...body, request_id: requestId || undefined, timeout_ms: Math.max(1000, timeoutMs - 3000) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    const message = payload?.message || "Sage AI could not complete the request.";
    const failure = new Error(String(message));
    (failure as any).requestId = String(payload?.request_id || requestId || "");
    throw failure;
  }
  return {
    requestId: String(payload.request_id || requestId || ""),
    result: payload.result,
    blocked: payload.blocked === true,
    message: typeof payload.message === "string" ? payload.message : undefined,
    developerMode: payload.developer_mode === true,
  };
}

async function sageWebTool(
  sessionToken: string,
  name: "sage_web_search" | "sage_web_open",
  args: Record<string, unknown>,
  requestId: string,
  timeoutMs: number,
) {
  const path = name === "sage_web_search" ? "search" : "open";
  const response = await fetch(`${SAGE_ONLINE_URL}/v1/strategic-ai/browser/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...args, request_id: requestId || undefined }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(String(payload?.message || "Sage AI web research failed."));
  return payload;
}

function compactToolResult(name: string, value: any, args: Record<string, unknown>) {
  const structured = value?.structuredContent?.data;
  if ((name === "search_sage_fits" || name === "optimise_sage_fit") && Array.isArray(structured?.top)) {
    const compact = { ...structured, top: [...structured.top], rejectionSamples: structured.rejectionSamples?.slice(0, 3), omittedFinalists: 0 };
    while (compact.top.length > 1 && JSON.stringify(compact).length > 22_000) {
      compact.top.pop(); compact.omittedFinalists++;
    }
    return compact;
  }

  if (name === "get_character_data" && structured && typeof structured === "object") {
    const section = String((structured as any).section || args.section || "");
    const characterId = String((structured as any).characterId || args.characterId || "");
    const inner = (structured as any).data;

    if (section === "skills" && inner && typeof inner === "object" && Array.isArray(inner.skills)) {
      return {
        characterId,
        section: "skills",
        total_sp: Number(inner.total_sp ?? 0),
        unallocated_sp: Number(inner.unallocated_sp ?? 0),
        skills: inner.skills.map((skill: any) => ({
          skillId: Number(skill?.skill_id ?? 0),
          name: String(skill?.name || ""),
          level: Number(skill?.active_skill_level ?? skill?.trained_skill_level ?? 0),
          trainedLevel: Number(skill?.trained_skill_level ?? 0),
          sp: Number(skill?.skillpoints_in_skill ?? 0),
          nextLevel: Array.isArray(skill?.timeToLevels) && skill.timeToLevels.length
            ? {
                level: Number(skill.timeToLevels[0]?.level ?? 0),
                seconds: skill.timeToLevels[0]?.seconds == null ? null : Number(skill.timeToLevels[0].seconds),
              }
            : null,
        })),
      };
    }

    return structured;
  }

  // MCP often returns the same payload twice: once as human-readable text and
  // again as structuredContent. Feed only the structured copy back to the model.
  if (structured !== undefined) return structured;
  return value;
}

function compactPreloadedSkillEvidence(value: any, message: string) {
  if (!value || typeof value !== "object" || !Array.isArray(value.skills)) return value;

  const q = message.toLowerCase();
  const fittingIntent = /\b(fit|fitting|ship|hull|skill|training|tackle|scram|point|tank|ehp|dps|capacitor|module|rig|drone|weapon|lock|speed|mwd|afterburner|can|able|fly|use|pilot|run|handle|do)\b/i.test(message);
  if (!fittingIntent) return value;

  const relevant = /(missile|torpedo|rocket|drone|gunnery|turret|surgical strike|rapid firing|motion prediction|controlled bursts|energy emission|frigate|destroyer|cruiser|battlecruiser|battleship|strategic cruiser|assault frigates|heavy assault cruisers|interceptor|interdictor|heavy interdiction|recon|electronic attack|logistics|command ships|propulsion jamming|long range targeting|signature analysis|target management|navigation|acceleration control|evasive maneuvering|high speed maneuvering|afterburner|fuel conservation|warp drive operation|mechanics|hull upgrades|repair systems|armor|shield|capacitor|cpu management|power grid management|weapon upgrades|electronics upgrades|energy grid upgrades|rigging|thermodynamics|sensor compensation|electronic warfare|weapon disruption|sensor linking|cloaking)/i;

  const selected = value.skills.filter((skill: any) => {
    const name = String(skill?.name || "");
    return relevant.test(name) || (name && q.includes(name.toLowerCase()));
  });

  return {
    characterId: value.characterId,
    section: value.section,
    total_sp: value.total_sp,
    unallocated_sp: value.unallocated_sp,
    relevantSkillCount: selected.length,
    omittedSkillCount: Math.max(0, value.skills.length - selected.length),
    skills: selected.map((skill: any) => ({
      skillId: skill.skillId,
      name: String(skill?.name || ""),
      level: Number(skill?.level ?? 0),
      nextLevel: skill?.nextLevel
        ? {
            level: Number(skill.nextLevel.level ?? 0),
            seconds: skill.nextLevel.seconds == null ? null : Number(skill.nextLevel.seconds),
          }
        : null,
    })),
  };
}

function normaliseStrategicToolArgs(name: string, args: Record<string, unknown>, message: string) {
  if (
    name === "get_character_data" &&
    !String(args.section || "").trim() &&
    /fit|fitting|ship|hull|skill|train|tackle|scram|point|tank|dps|cap|capacitor|module|rig|drone|weapon/i.test(message)
  ) {
    return { ...args, section: "skills" };
  }
  return args;
}

function safeToolOutput(value: unknown) {
  const raw = JSON.stringify(value);
  if (raw.length <= 24_000) return raw;
  return JSON.stringify({
    truncated: true,
    message: "Tool result exceeded Sage AI transfer limit; compact preview follows.",
    preview: raw.slice(0, 24_000),
  });
}

function destructiveIntent(message: string) {
  return /delete|remove|revoke|cancel|destroy|clear|withdraw|trash|terminate/i.test(message);
}

function strategicDebug(label: string, value: unknown) {
  if (process.env.SAGE_STRATEGIC_DEBUG !== "1") return;
  try { process.stderr.write(`[SAGE STRATEGIC] ${label} ${JSON.stringify(value)}\n`); }
  catch { process.stderr.write(`[SAGE STRATEGIC] ${label} [unserializable]\n`); }
}

export async function getStrategicCommandStatus() {
  const config = await readConfig();
  let mcpReady = false;
  let mcpError = "";
  try {
    await getTools();
    mcpReady = true;
  } catch (error) {
    mcpError = error instanceof Error ? error.message : String(error);
  }
  return {
    configured: Boolean(config.encryptedSageSessionToken),
    model: "Sage AI",
    mcpReady,
    mcpError,
  };
}

async function askStrategicCommandInternal(input: {
  message: string;
  history?: StrategicMessage[];
}, diagnostics?: StrategicDiagnostics, onProgress?: (progress: StrategicProgress) => void) {
  const startedAt = Date.now();
  const message = String(input?.message || "").trim();
  if (!message) throw new Error("Enter a Strategic Command request.");

  const config = await readConfig();
  const sessionToken = decrypt(config.encryptedSageSessionToken);
  if (!sessionToken) throw new Error("Sage AI is unavailable until your Sage account is connected.");

  if (characterCacheSession !== sessionToken || Date.now() >= characterCacheExpiresAt) {
    invalidateStrategicCharacterCache();
    characterCacheSession = sessionToken;
    characterCacheExpiresAt = Date.now() + 60_000;
  }
  const client = await getMcpClient();
  const tools = await getTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const q = message.toLowerCase();
  const forceCharacterRefresh = /\b(refresh|sync|latest|current|update|recheck|re-check)\b/i.test(message);
  let rosterError = "";
  const sessionCharacters = await cachedCharacterRoster(client, forceCharacterRefresh).catch(() => {
    rosterError = "Character roster is unavailable. Do not infer character ownership or capability.";
    return [] as any[];
  });
  const plan: StrategicPlan = planStrategicRequest(message, {
    history: input.history,
    characterNames: sessionCharacters.map((row: any) => String(row?.name || "")).filter(Boolean),
  });
  if (diagnostics) diagnostics.plan = plan;
  if (plan.broadRequest) {
    const estimate = estimateStrategicDuration(plan, message, await readStrategicTimings());
    onProgress?.({ message: "Checking the data needed for this job…", estimatedUpperMs: estimate.upperMs, estimate:
      `This is a bigger job. Initial estimate: ${estimateLabel(estimate.lowerMs, estimate.upperMs)}${estimate.learned ? ", based on similar completed requests" : ", based on the scope of your request"}. I'll revise it as the workload becomes clearer.` });
  } else onProgress?.({ message: "Checking Sage's data…" });
  if ((plan.route === "fit_build" || plan.route === "fit_evaluate") && plan.characterName) {
    const linked = sessionCharacters.find((row: any) => String(row?.name || "").toLowerCase() === plan.characterName!.toLowerCase());
    if (!linked) {
      const available = sessionCharacters.map((row: any) => String(row?.name || "")).filter(Boolean);
      return {
        answer: `I can build that fit, but **${plan.characterName}** is not linked/synced in this Sage session. Available characters: ${available.length ? available.map((name: string) => `**${name}**`).join(", ") : "none"}. Link/sync that character or tell me which available character to use.`,
        model: "Sage router",
        trace: [],
        usage: null,
      };
    }
  }
  const preloaded: Record<string, unknown> = {};
  if (rosterError) preloaded.unavailable = rosterError;
  let completeSkills: any;
  let preloadedCharacters = false;
  let preloadedSkills = false;
  const needsCharacterContext = plan.requiredCharacterSections.length > 0 || plan.route === "character" || plan.route === "fit_build" || plan.route === "fit_evaluate";
  if (needsCharacterContext) {
    try {
      const characters = sessionCharacters;
      if (Array.isArray(characters)) {
        preloaded.characters = characters;
        preloadedCharacters = true;

        const namedTarget = characters.find((row: any) => {
          const name = String(row?.name || "").toLowerCase();
          return name && name === plan.characterName?.toLowerCase();
        });
        const target = namedTarget ?? (characters.length === 1 ? characters[0] : undefined);

        const needsSkills = plan.requiredCharacterSections.includes("skills");

        if (target?.characterId && needsSkills) {
          const compactSkills = await cachedCharacterSection(
            client,
            String(target.characterId),
            "skills",
            forceCharacterRefresh,
          );
          completeSkills = compactSkills;
          preloaded.skills = compactPreloadedSkillEvidence(compactSkills, message);
          preloadedSkills = true;
        }

        if (target?.characterId) {
          for (const section of plan.requiredCharacterSections.filter((value) => value !== "skills")) {
            preloaded[section] = await cachedCharacterSection(client, String(target.characterId), section, forceCharacterRefresh);
          }
        }
      }
    } catch (error) {
      preloaded.unavailable = error instanceof Error ? error.message : String(error);
      strategicDebug("prefetch-error", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  // Resolve hull names from Sage's local CCP SDE so the model never guesses ship class or prerequisites.
  if (plan.route !== "developer") {
    try {
      const catalogue = await getFittingCatalogueLocal();
      const hullMatches = (catalogue?.items ?? []).filter((item: any) =>
        item?.rootName === "Ships" && String(item?.name || "").length >= 3 && mentionsName(message, String(item.name)),
      ).slice(0, 8);
      if (hullMatches.length) {
        const hulls = await Promise.all(hullMatches.map(async (item: any) => {
          const info = await getFittingTypeInfoLocal(Number(item.id));
          return {
            typeId: info.typeId,
            name: info.name,
            group: info.group,
            category: info.category,
            marketGroup: info.marketGroup,
            techLevel: info.techLevel,
            requirements: info.requirements,
            characterRequirementCheck: Array.isArray(completeSkills?.skills) ? {
              characterId: completeSkills.characterId,
              scope: "Direct hull prerequisites only; event entry rules and fitting requirements must be checked separately.",
              missing: (info.requirements ?? []).filter((req: any) =>
                Number(completeSkills.skills.find((skill: any) => skill.skillId === req.skillId)?.level ?? 0) < Number(req.level)),
            } : null,
          };
        }));
        preloaded.hulls = hulls;
      }
    } catch (error) {
      strategicDebug("hull-prefetch-error", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (plan.route === "knowledge" || plan.route === "character") {
    const factualAnswer = answerShipFacts(message, plan.characterName, (preloaded.hulls ?? []) as any[]);
    if (factualAnswer) return { answer: factualAnswer, model: "Sage verified data", trace: [], usage: null };
  }
  const fullHistory = (Array.isArray(input.history) ? input.history : [])
    .filter((item): item is StrategicMessage => (item?.role === "user" || item?.role === "assistant") && typeof item?.content === "string");
  const likelyFastFollowup = /\b(which|those|that|it|they|them|can|able|fly|use|do|run)\b/i.test(message);
  const recentHistory = fullHistory.slice(likelyFastFollowup ? -4 : -12);
  const masterActivation = fullHistory.find((item) =>
    item.role === "user" &&
    /\bcommand\ override\ owner\b/i.test(item.content),
  );
  const history = [
    ...(masterActivation && !recentHistory.includes(masterActivation) ? [masterActivation] : []),
    ...recentHistory,
  ].map((item) => ({ role: item.role, content: item.content }));

  const personalContextRequest = needsCharacterContext;
  const fittingRequest = plan.route === "fit_build" || plan.route === "fit_evaluate";
  const fittingOptimisationRequest = fittingRequest;
  const explicitCurrentWebNeed = plan.allowWeb;
  const fastKnowledgeRequest = plan.route === "knowledge" && !plan.broadRequest;
  const fastPersonalRequest = plan.route === "character" && !plan.broadRequest;

  const messages: any[] = [
    { role: "system", content: fastKnowledgeRequest ? fastStrategicInstructions() : fastPersonalRequest ? `You are Sage AI inside New Eden Sage. Answer this personal EVE capability question quickly from the PRELOADED SAGE EVIDENCE and recent conversation. Treat cached character skills and PRELOADED hull metadata as authoritative for this Sage session. Never infer a hull class or skill prerequisite from memory when hull metadata is present. Do not call tools for facts already present in the evidence. Keep the answer concise and directly answer the user's question.` : fittingRequest ? fittingStrategicInstructions() : strategicInstructions(tools) },
    ...(Object.keys(preloaded).length ? [{
      role: "system",
      content: "PRELOADED SAGE EVIDENCE\nThis evidence comes from Sage local snapshots, cached for at most one minute. Snapshot freshness still depends on the last successful EVE sync. Treat it as newer and more authoritative than any character SP, wallet, location or profile details mentioned earlier in the conversation. Never repeat conflicting older values. Omitted skills are unknown, not zero. Hull prerequisites do not establish event eligibility; verify current event restrictions separately. Never infer ship class or prerequisites from older assistant answers. Re-fetch a deeper character section when the question depends on fields not present here.\n" + safeToolOutput(preloaded),
    }] : []),
    ...history,
    { role: "user", content: message },
  ];

  let selectedTools = plan.route === "developer"
    ? selectStrategicTools(tools, message)
    : tools.filter((tool) => plan.allowedTools.includes(tool.name));
  if (preloadedCharacters) selectedTools = selectedTools.filter((tool) => tool.name !== "list_characters");
  if (preloadedSkills && !plan.broadRequest) selectedTools = selectedTools.filter((tool) => tool.name !== "get_character_data" && tool.name !== "list_character_data_points");
  const includeWeb = plan.allowWeb;
  const hasTools = selectedTools.length > 0 || includeWeb;
  strategicDebug("request-plan", { plan, count: selectedTools.length, names: selectedTools.map((tool) => tool.name), preloadedCharacters, preloadedSkills, includeWeb });
  const common = {
    tools: hasTools ? sageAiTools(selectedTools, includeWeb) : undefined,
    tool_choice: hasTools ? "auto" : "none",
    temperature: 0.2,
    max_tokens: (fastKnowledgeRequest || fastPersonalRequest) ? 900 : plan.broadRequest ? 8192 : 4096,
    fast_path: plan.modelTier === "fast",
  };

  const trace: Array<{ tool: string; status: "ok" | "blocked" | "error"; detail?: string }> = [];
  let requestId = "";
  let developerMode = false;
  if (diagnostics) diagnostics.trace = trace;
  const standardDeadlineMs = plan.requestBudgetMs;
  let forceSynthesis = false;

  for (let round = 0; round <= plan.maxModelRounds; round += 1) {
    if (round >= plan.maxModelRounds) forceSynthesis = true;
    const remainingForModel = standardDeadlineMs - (Date.now() - startedAt);
    if (remainingForModel <= 0) throw new Error("Sage reached the request's time budget. Narrow the request or continue from the results gathered.");
    const timedOut = remainingForModel <= 30_000;
    onProgress?.({ message: timedOut || forceSynthesis ? "Preparing the answer from the results gathered…" : round === 0 ? "Planning the work from Sage's data…" : "Comparing results and working through the next steps…" });
    let completion;
    const completionStartedAt = Date.now();
    try {
      completion = await sageAiCompletion(
        sessionToken,
        {
          ...common,
          messages: timedOut || forceSynthesis
            ? [...messages, {
                role: "system",
                content: "The normal Sage request time budget has expired. Do not call any more tools. Produce the best complete answer you can from the evidence already gathered, and clearly state anything you could not verify.",
              }]
            : messages,
          tools: timedOut || forceSynthesis ? undefined : common.tools,
          tool_choice: timedOut || forceSynthesis ? "none" : common.tool_choice,
        },
        requestId || undefined,
        Math.max(1, Math.min(180_000, remainingForModel)),
      );
    } catch (error) {
      strategicDebug("completion-error", {
        round,
        requestId,
        messageCount: messages.length,
        messages: messages.slice(-6),
        error: error instanceof Error ? error.message : String(error),
      });
      const enriched = error instanceof Error ? error : new Error(String(error));
      requestId = (enriched as any).requestId || requestId;
      if (diagnostics) diagnostics.requestId = requestId;
      (enriched as any).sageDiagnostics = {
        requestId,
        developerMode,
        round,
        elapsedMs: Date.now() - startedAt,
        messageCount: messages.length,
        trace: [...trace],
        forceSynthesis,
        timedOut,
      };
      throw enriched;
    }
    strategicDebug("model-round-timing", {
      round,
      elapsedMs: Date.now() - completionStartedAt,
      messageCount: messages.length,
      toolCount: timedOut || forceSynthesis ? 0 : selectedTools.length,
    });
    requestId = completion.requestId || requestId;
    developerMode = completion.developerMode === true;
    if (diagnostics) {
      diagnostics.requestId = requestId;
      diagnostics.developerMode = developerMode;
    }
    strategicDebug("completion", {
      round,
      requestId,
      developerMode,
      assistant: completion.result?.choices?.[0]?.message,
      usage: completion.result?.usage,
    });

    if (completion.blocked) {
      return { answer: completion.message || "I can't help with that request.", model: "Sage AI", trace, usage: null };
    }

    const response = completion.result;
    const assistant = response?.choices?.[0]?.message as SageAiMessage | undefined;
    if (!assistant) throw new Error("Sage AI returned no assistant message.");

    const toolCalls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
    if (toolCalls.length && (forceSynthesis || timedOut)) {
      throw new Error("Sage AI did not finish within its tool limit. Please retry with a narrower request.");
    }
    if (toolCalls.length > 12) throw new Error("Sage AI requested too many operations in one round.");
    if (Date.now() - startedAt >= standardDeadlineMs && toolCalls.length) {
      forceSynthesis = true;
      continue;
    }
    if (!toolCalls.length) {
      const answer = typeof assistant.content === "string" ? assistant.content.trim() : "";
      if (!answer) throw new Error("Sage AI completed without a text response.");
      return {
        answer,
        model: "Sage AI",
        trace,
        usage: response?.usage || null,
      };
    }

    messages.push({
      role: "assistant",
      content: assistant.content ?? null,
      tool_calls: toolCalls,
      ...(typeof assistant.reasoning_content === "string"
        ? { reasoning_content: assistant.reasoning_content }
        : {}),
    });

    const executeToolCall = async (call: SageAiToolCall) => {
      const callId = String(call.id || "");
      const name = String(call.function?.name || "");
      const tool = byName.get(name);
      const isWebTool = name === "sage_web_search" || name === "sage_web_open";

      if ((!tool || !selectedTools.some((allowed) => allowed.name === name)) && !(isWebTool && includeWeb)) {
        trace.push({ tool: name || "unknown", status: "error", detail: "Tool is not available for this request." });
        messages.push({
          role: "tool",
          tool_call_id: callId,
          content: JSON.stringify({ error: "Unknown Sage tool." }),
        });
        return;
      }

      if (tool?.annotations?.destructiveHint && !destructiveIntent(message)) {
        trace.push({ tool: name, status: "blocked", detail: "Destructive operation was not explicit in the user's request." });
        messages.push({
          role: "tool",
          tool_call_id: callId,
          content: JSON.stringify({ blocked: true, reason: "Destructive Sage actions require explicit destructive intent from the user." }),
        });
        return;
      }

      try {
        const rawArgs = call.function?.arguments;
        const parsedArgs = typeof rawArgs === "string" ? JSON.parse(rawArgs || "{}") : (rawArgs || {});
        const args = normaliseStrategicToolArgs(name, parsedArgs as Record<string, unknown>, message);
        if (name === "optimise_sage_fit" && plan.broadRequest && args.candidateLimit === undefined) args.candidateLimit = 5000;
        const remainingMs = standardDeadlineMs - (Date.now() - startedAt);
        if (name === "search_sage_fits") args.maxDurationMs = Math.max(1000, Math.min(Number(args.maxDurationMs) || 840_000, remainingMs - 30_000));
        if (remainingMs <= 0) throw new Error("Sage request time budget expired before this operation.");
        onProgress?.({ message: /fit/.test(name) ? "Testing fitting candidates with Sage's fitting engine…" : "Checking the next set of Sage data…" });
        const result = isWebTool
          ? await sageWebTool(sessionToken, name as "sage_web_search" | "sage_web_open", args, requestId, remainingMs)
          : await client.callTool({ name, arguments: args }, undefined, {
              timeout: remainingMs,
              onprogress: (progress) => onProgress?.({ message: progress.message || `Completed ${progress.progress}${progress.total ? ` of ${progress.total}` : ""} checks…` }),
            });
        const compactResult = compactToolResult(name, result, args);
        strategicDebug("tool-result", {
          round,
          name,
          callId,
          args,
          output: safeToolOutput(compactResult).slice(0, 4000),
        });
        const resultIsError = !isWebTool && result && typeof result === "object" && "isError" in result && Boolean((result as any).isError);
        const resultDetail = resultIsError ? safeToolOutput(compactResult).slice(0, 2000) : undefined;
        trace.push({ tool: name, status: resultIsError ? "error" : "ok", ...(resultDetail ? { detail: resultDetail } : {}) });
        messages.push({
          role: "tool",
          tool_call_id: callId,
          content: safeToolOutput(compactResult),
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        trace.push({ tool: name, status: "error", detail });
        messages.push({
          role: "tool",
          tool_call_id: callId,
          content: JSON.stringify({ error: detail }),
        });
      }
    };

    const canParallelise = toolCalls.length > 1 && toolCalls.every((call) => {
      const name = String(call.function?.name || "");
      if (name === "sage_web_search" || name === "sage_web_open") return true;
      return byName.get(name)?.annotations?.readOnlyHint === true;
    });

    const toolStartedAt = Date.now();
    if (canParallelise) {
      await Promise.all(toolCalls.map((call) => executeToolCall(call)));
    } else {
      for (const call of toolCalls) await executeToolCall(call);
    }
    strategicDebug("tool-batch-timing", {
      round,
      count: toolCalls.length,
      parallel: canParallelise,
      elapsedMs: Date.now() - toolStartedAt,
    });
  }

  throw new Error("Sage AI exhausted its response limit.");
}

type StrategicDiagnostics = {
  plan?: StrategicPlan;
  requestId: string;
  developerMode: boolean;
  trace: Array<{ tool: string; status: "ok" | "blocked" | "error"; detail?: string }>;
};

async function reportStrategicFailure(
  sessionToken: string,
  input: { message: string; history?: StrategicMessage[] },
  diagnostics: StrategicDiagnostics,
  startedAt: number,
  error: unknown,
) {
  try {
    await fetch(`${SAGE_ONLINE_URL}/v1/strategic-ai/failure-report`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        request_id: diagnostics.requestId || undefined,
        prompt: String(input?.message || "").slice(0, 8000),
        error: error instanceof Error ? error.message : String(error),
        elapsed_ms: Date.now() - startedAt,
        developer_mode: diagnostics.developerMode,
        trace: diagnostics.trace.slice(-80),
        client_context: {
          history_messages: Array.isArray(input.history) ? input.history.length : 0,
          mcp_tool_count: cachedTools?.length ?? null,
          platform: process.platform,
          node: process.version,
          app: "New Eden Sage Strategic Command",
        },
      }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined);
  } catch {
    // Failure reporting must never replace or delay the user's actual error.
  }
}

export async function askStrategicCommand(input: {
  message: string;
  history?: StrategicMessage[];
}, onProgress?: (progress: StrategicProgress) => void) {
  const startedAt = Date.now();
  const diagnostics: StrategicDiagnostics = { requestId: "", developerMode: false, trace: [] };
  let sessionToken = "";
  try {
    const config = await readConfig();
    sessionToken = decrypt(config.encryptedSageSessionToken);
    let latestProgress = "Working through Sage…";
    let estimatedUpperMs: number | undefined;
    const pulse = setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      const elapsed = Math.floor(elapsedMs / 60_000);
      const overEstimate = estimatedUpperMs && elapsedMs > estimatedUpperMs;
      onProgress?.({ message: `${latestProgress} ${elapsed ? `${elapsed} min elapsed.` : "Still working."}${overEstimate ? " This is taking longer than the initial estimate; work is continuing." : ""}` });
    }, 20_000);
    try {
      const result = await askStrategicCommandInternal(input, diagnostics, (progress) => {
        latestProgress = progress.message;
        if (progress.estimatedUpperMs) estimatedUpperMs = progress.estimatedUpperMs;
        onProgress?.(progress);
      });
      if (diagnostics.plan && result.model !== "Sage verified data" && result.model !== "Sage router") {
        recordStrategicTiming({ route: diagnostics.plan.route, broad: Boolean(diagnostics.plan.broadRequest), complexity: requestComplexity(input.message), elapsedMs: Date.now() - startedAt });
      }
      return result;
    } finally { clearInterval(pulse); }
  } catch (error) {
    if (sessionToken) {
      await reportStrategicFailure(sessionToken, input, diagnostics, startedAt, error);
    }
    throw error;
  }
}
