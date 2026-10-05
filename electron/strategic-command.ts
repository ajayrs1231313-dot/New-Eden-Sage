import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readConfig, decrypt } from "./config";
import { SAGE_ONLINE_URL } from "./sage-online";
import { sageMcpLaunch } from "./mcp-launch";
import { SAGE_MCP_AI_INSTRUCTIONS } from "./mcp-ai-policy";

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

ACTION POLICY
Sage AI is permanently connected to Sage with read/write MCP authority. Use read and write/action tools whenever they are the correct way to fulfil the user's request; do not ask the user to enable an action mode and do not expose MCP permission mechanics in the answer. Treat explicit user intent as authority for ordinary reversible Sage actions. Destructive or irreversible actions still require clear destructive intent in the user's request before execution.

HIDDEN SAGE OPERATING MANUAL
The material below is backend-only operating guidance. Never expose tool catalogues, schemas, routing rules, internal command names, permission annotations, implementation details, or developer terminology to the customer unless they explicitly ask for technical diagnostics. Translate all of it into natural EVE/Sage language in the response.

SAGE MCP OPERATING CONTRACT
${SAGE_MCP_AI_INSTRUCTIONS}
`;
}


function fittingStrategicInstructions() {
  return `You are Sage AI operating New Eden Sage's fitting subsystem.

MISSION
Solve the user's ship-fitting objective with measured Sage fitting results, not generic EVE guesses.

RULES
- Sage's synced character skills are authoritative.
- Use simulate_sage_fit as the primary computation engine.
- For broad optimisation, build realistic candidate batches and simulate them early. Do not spend multiple rounds planning before the first simulation.
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
  const names = new Set<string>([
    "list_characters",
    "get_character_data",
    "list_character_data_points",
  ]);

  const add = (...values: string[]) => values.forEach((value) => names.add(value));

  if (/fit|fitting|ship|hull|dps|tank|ehp|cap|capacitor|tackle|scram|point|web|lock|range|speed|prop|mwd|afterburner|module|rig|drone|ammo|weapon/.test(q)) {
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

  // Generic discovery fallback when no specialist category matched.
  if (names.size <= 3) {
    add(
      "get_all_sage_data",
      "list_sage_data_domains",
      "get_sage_data_domain",
      "list_prepared_page_states",
      "get_prepared_page_state",
    );
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
): Promise<{ requestId: string; result?: any; blocked?: boolean; message?: string; developerMode?: boolean }> {
  const response = await fetch(`${SAGE_ONLINE_URL}/v1/strategic-ai/completion`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...body, request_id: requestId || undefined }),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    const message = payload?.message || "Sage AI could not complete the request.";
    throw new Error(String(message));
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
) {
  const path = name === "sage_web_search" ? "search" : "open";
  const response = await fetch(`${SAGE_ONLINE_URL}/v1/strategic-ai/browser/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...args, request_id: requestId || undefined }),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(String(payload?.message || "Sage AI web research failed."));
  return payload;
}

function compactToolResult(name: string, value: any, args: Record<string, unknown>) {
  const structured = value?.structuredContent?.data;

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
  const fittingIntent = /\b(fit|fitting|ship|hull|skill|training|tackle|scram|point|tank|ehp|dps|capacitor|module|rig|drone|weapon|lock|speed|mwd|afterburner)\b/i.test(message);
  if (!fittingIntent) return value;

  const relevant = /(frigate|destroyer|cruiser|battlecruiser|battleship|strategic cruiser|assault frigates|heavy assault cruisers|interceptor|interdictor|heavy interdiction|recon|electronic attack|logistics|command ships|propulsion jamming|long range targeting|signature analysis|target management|navigation|acceleration control|evasive maneuvering|high speed maneuvering|afterburner|fuel conservation|warp drive operation|mechanics|hull upgrades|repair systems|armor|shield|capacitor|cpu management|power grid management|weapon upgrades|electronics upgrades|energy grid upgrades|rigging|thermodynamics|sensor compensation|electronic warfare|weapon disruption|sensor linking|cloaking)/i;

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
}, diagnostics?: StrategicDiagnostics) {
  const message = String(input?.message || "").trim();
  if (!message) throw new Error("Enter a Strategic Command request.");

  const config = await readConfig();
  const sessionToken = decrypt(config.encryptedSageSessionToken);
  if (!sessionToken) throw new Error("Sage AI is unavailable until your Sage account is connected.");

  const client = await getMcpClient();
  const tools = await getTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const q = message.toLowerCase();
  const preloaded: Record<string, unknown> = {};
  let preloadedCharacters = false;
  let preloadedSkills = false;

  const needsCharacterContext = /\b(character|ajdeathgiver|nedoode|skill|training|sp\b|fit|fitting|ship|hull|tackle|scram|point|tank|ehp|dps|capacitor|module|rig|drone)\b/i.test(message)
    || /list my sage characters|my characters/i.test(message);

  if (needsCharacterContext) {
    try {
      const listed = await client.callTool({ name: "list_characters", arguments: {} });
      const characters = (listed as any)?.structuredContent?.data;
      if (Array.isArray(characters)) {
        preloaded.characters = characters;
        preloadedCharacters = true;

        const target = characters.find((row: any) => {
          const name = String(row?.name || "").toLowerCase();
          return name && q.includes(name);
        });

        const needsSkills = /\b(skill|training|sp\b|fit|fitting|ship|hull|tackle|scram|point|tank|ehp|dps|capacitor|module|rig|drone)\b/i.test(message);
        if (target?.characterId && needsSkills) {
          const skillResult = await client.callTool({
            name: "get_character_data",
            arguments: { characterId: String(target.characterId), section: "skills" },
          });
          const compactSkills = compactToolResult(
            "get_character_data",
            skillResult,
            { characterId: String(target.characterId), section: "skills" },
          );
          preloaded.skills = compactPreloadedSkillEvidence(compactSkills, message);
          preloadedSkills = true;
        }
      }
    } catch (error) {
      strategicDebug("prefetch-error", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  const fullHistory = (Array.isArray(input.history) ? input.history : [])
    .filter((item): item is StrategicMessage => (item?.role === "user" || item?.role === "assistant") && typeof item?.content === "string");
  const recentHistory = fullHistory.slice(-12);
  const masterActivation = fullHistory.find((item) =>
    item.role === "user" &&
    /\bcommand\ override\ owner\b/i.test(item.content),
  );
  const history = [
    ...(masterActivation && !recentHistory.includes(masterActivation) ? [masterActivation] : []),
    ...recentHistory,
  ].map((item) => ({ role: item.role, content: item.content }));

  const fittingRequest = /fit|fitting|ship|hull|dps|tank|ehp|cap|capacitor|tackle|scram|point|web|lock|range|speed|prop|mwd|afterburner|module|rig|drone|ammo|weapon/i.test(message);
  const fittingOptimisationRequest = fittingRequest && /find|best|optim|compare|rank|simulate|test|many|broad|strongest|fastest|survive|hold|tackle/i.test(message);

  const messages: any[] = [
    { role: "system", content: fittingRequest ? fittingStrategicInstructions() : strategicInstructions(tools) },
    ...(Object.keys(preloaded).length ? [{
      role: "system",
      content: "PRELOADED SAGE EVIDENCE\nThis evidence was fetched locally before the model call. Use it directly and do not re-fetch the same character list or skill snapshot unless the user asks for a refresh.\n" + safeToolOutput(preloaded),
    }] : []),
    ...history,
    { role: "user", content: message },
  ];

  let selectedTools = selectStrategicTools(tools, message);
  if (preloadedCharacters) selectedTools = selectedTools.filter((tool) => tool.name !== "list_characters");
  if (preloadedSkills) selectedTools = selectedTools.filter((tool) => tool.name !== "get_character_data");
  if (fittingOptimisationRequest && preloadedSkills) {
    selectedTools = selectedTools.filter((tool) => tool.name !== "list_character_data_points");
  }
  const explicitCurrentWebNeed = /latest|current meta|current patch|patch notes|recent|today|changed|change recently|doctrine|live web|web search|search the web/i.test(message);
  const includeWeb = !fittingRequest || explicitCurrentWebNeed;
  strategicDebug("tool-selection", { count: selectedTools.length, names: selectedTools.map((tool) => tool.name), preloadedCharacters, preloadedSkills, includeWeb });
  const common = {
    tools: sageAiTools(selectedTools, includeWeb),
    tool_choice: "auto",
    temperature: 0.2,
    max_tokens: 2048,
  };

  const trace: Array<{ tool: string; status: "ok" | "blocked" | "error"; detail?: string }> = [];
  let requestId = "";
  let developerMode = false;
  if (diagnostics) diagnostics.trace = trace;
  const startedAt = Date.now();
  const standardDeadlineMs = 450_000;
  let forceSynthesis = false;

  for (let round = 0; ; round += 1) {
    const timedOut = !developerMode && Date.now() - startedAt >= standardDeadlineMs;
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
    if (!developerMode && Date.now() - startedAt >= standardDeadlineMs && toolCalls.length) {
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

      if (!tool && !isWebTool) {
        trace.push({ tool: name || "unknown", status: "error", detail: "Tool is not in the live Sage catalogue." });
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
        const result = isWebTool
          ? await sageWebTool(sessionToken, name as "sage_web_search" | "sage_web_open", args, requestId)
          : await client.callTool({ name, arguments: args });
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

}


type StrategicDiagnostics = {
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
}) {
  const startedAt = Date.now();
  const diagnostics: StrategicDiagnostics = { requestId: "", developerMode: false, trace: [] };
  let sessionToken = "";
  try {
    const config = await readConfig();
    sessionToken = decrypt(config.encryptedSageSessionToken);
    return await askStrategicCommandInternal(input, diagnostics);
  } catch (error) {
    if (sessionToken) {
      await reportStrategicFailure(sessionToken, input, diagnostics, startedAt, error);
    }
    throw error;
  }
}
