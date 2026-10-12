export type StrategicRoute =
  | "knowledge"
  | "character"
  | "fit_build"
  | "fit_evaluate"
  | "market"
  | "industry"
  | "navigation"
  | "live_research"
  | "action"
  | "developer";

export type StrategicPlan = {
  route: StrategicRoute;
  reason: string;
  characterName?: string;
  hullNames: string[];
  requiredCharacterSections: Array<"skills" | "wallet" | "location" | "ship" | "assets">;
  allowedTools: string[];
  allowWeb: boolean;
  modelTier: "fast" | "reasoning";
  maxModelRounds: number;
  requestBudgetMs: number;
  broadRequest?: boolean;
};

export type StrategicRoutingContext = {
  characterNames?: string[];
  hullNames?: string[];
  history?: Array<{ role: string; content: string }>;
};

export function mentionsName(message: string, name: string) {
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu").test(message);
}

function firstMention(message: string, values: string[]) {
  return [...values].sort((a, b) => b.length - a.length).find((value) => mentionsName(message, value));
}

function mentionedHulls(message: string, hullNames: string[]) {
  return hullNames.filter((name) => name.length >= 3 && mentionsName(message, name)).slice(0, 8);
}

export function isBroadStrategicRequest(message: string) {
  return /\b(broad|comprehensive|exhaustive|thorough|in.depth|deep (?:dive|analysis|research)|across|everything|all (?:my|our|the|available)|entire|end.to.end|hundreds|thousands|lots of|many (?:candidates|options|fits|ships|systems)|large (?:candidate|set|search)|compare|optimi[sz](?:e|ation)|strongest|best .*?(?:fit|ship|route|plan|project|opportunit)|strategic overview)\b/i.test(message)
    || message.length > 500;
}

export function planStrategicRequest(message: string, context: StrategicRoutingContext = {}): StrategicPlan {
  const plan = routeStrategicRequest(message, context);
  const broadRequest = isBroadStrategicRequest(message);
  if (broadRequest) {
    plan.modelTier = "reasoning";
    plan.allowedTools = [...new Set([...plan.allowedTools, "list_sage_data_domains", "get_sage_data_domain", "list_prepared_page_states", "get_prepared_page_state", "get_character_data", "list_character_data_points"])];
  }
  return { ...plan, broadRequest, requestBudgetMs: broadRequest ? 15 * 60_000 : 3 * 60_000,
    maxModelRounds: broadRequest ? 48 : Math.max(6, plan.maxModelRounds) };
}

function routeStrategicRequest(message: string, context: StrategicRoutingContext = {}): StrategicPlan {
  const followup = /\b(which|those|that|it|they|them|these|same|what about)\b/i.test(message);
  const previousUsers = (context.history ?? []).filter((item) => item.role === "user").slice(-3);
  const preceding = followup ? previousUsers.map((item) => item.content).join("\n") : "";
  const requestedCharacterFromSyntax = message.match(/\bfor\s+([A-Za-z][A-Za-z0-9_-]{2,31})\s+(?:skills?|skillset|skill\s+set)\b/i)?.[1];
  const characterName = firstMention(message, context.characterNames ?? []) ?? requestedCharacterFromSyntax
    ?? (followup ? firstMention(previousUsers.at(-1)?.content ?? "", context.characterNames ?? []) : undefined);
  const hullNames = mentionedHulls(`${preceding}\n${message}`, context.hullNames ?? []);

  if (/command\s+override\s+owner/i.test(message)) {
    return {
      route: "developer",
      reason: "Explicit owner developer override.",
      characterName,
      hullNames,
      requiredCharacterSections: [],
      allowedTools: ["developer"],
      allowWeb: true,
      modelTier: "reasoning",
      maxModelRounds: 6,
      requestBudgetMs: 450_000,
    };
  }

  const fitBuild = /\b(build|make|create|design|find|best|strongest|optimi[sz]e|optimi[sz]ation|compare|broad search|fit me|fit for|fitting for)\b/i.test(message)
    && /\b(fits?|fittings?|ships?|tackle|praxis|ishtar|gila|battleship|cruiser|frigate|destroyer|battlecruiser)\b/i.test(message);
  if (fitBuild) {
    return {
      route: "fit_build",
      reason: "User is asking Sage to construct a ship fitting.",
      characterName,
      hullNames,
      requiredCharacterSections: ["skills"],
      allowedTools: /\bmissile\b/i.test(message) && /\b(praxis|battleship)\b/i.test(message)
        ? ["optimise_sage_fit", "search_sage_fits", "simulate_sage_fit", "get_saved_fittings"]
        : ["search_sage_fits", "simulate_sage_fit", "get_saved_fittings"],
      allowWeb: false,
      modelTier: "reasoning",
      maxModelRounds: 2,
      requestBudgetMs: 45_000,
    };
  }

  if (/\b(simulate|evaluate|test|check)\b/i.test(message) && /\b(fit|fitting)\b/i.test(message)) {
    return {
      route: "fit_evaluate",
      reason: "User is asking Sage to evaluate an existing fit.",
      characterName,
      hullNames,
      requiredCharacterSections: ["skills"],
      allowedTools: ["simulate_sage_fit", "get_saved_fittings"],
      allowWeb: false,
      modelTier: "reasoning",
      maxModelRounds: 2,
      requestBudgetMs: 35_000,
    };
  }

  if (/\b(market|price|cost|buy|sell|order|trade|jita|amarr|hek|rens|dodixie|shortage|liquidity)\b/i.test(message)) {
    return {
      route: "market",
      reason: "Market/trade request.",
      characterName,
      hullNames,
      requiredCharacterSections: /\b(my|wallet|isk|afford|budget)\b/i.test(message) || characterName ? ["wallet", "location"] : [],
      allowedTools: ["get_market_dataset_status", "search_market_orders", "quote_market_depth", "get_market_region", "get_market_trade_opportunities", "get_market_shortages"],
      allowWeb: false,
      modelTier: "reasoning",
      maxModelRounds: 3,
      requestBudgetMs: 40_000,
    };
  }

  if (/\b(industry|manufactur|invent|reaction|blueprint|bpo|bpc|foundry|planet|pi\b|production)\b/i.test(message)) {
    return {
      route: "industry",
      reason: "Industry/planning request.",
      characterName,
      hullNames,
      requiredCharacterSections: characterName || /\b(my|can i|do i)\b/i.test(message) ? ["skills", "assets"] : [],
      allowedTools: ["list_sage_data_domains", "get_sage_data_domain", "list_prepared_page_states", "get_prepared_page_state", "search_public_contracts", "get_public_contracts"],
      allowWeb: false,
      modelTier: "reasoning",
      maxModelRounds: 3,
      requestBudgetMs: 45_000,
    };
  }

  if (/\b(route|jump|system|nearest|nearby|travel|gate|path|avoid|navigation|wormhole|w-space)\b/i.test(message)) {
    return {
      route: "navigation",
      reason: "Navigation request.",
      characterName,
      hullNames,
      requiredCharacterSections: characterName || /\b(my|from here|where am i)\b/i.test(message) ? ["location"] : [],
      allowedTools: ["search_navigation_systems", "get_navigation_system", "get_navigation_neighbours", "calculate_navigation_route", "get_wormhole_reference", "get_wormhole_command_state"],
      allowWeb: false,
      modelTier: "reasoning",
      maxModelRounds: 3,
      requestBudgetMs: 35_000,
    };
  }

  const currentInfo = /\b(latest|current patch|patch notes|today|recent|new event|event thing|news|changed|this event)\b/i.test(`${preceding}\n${message}`);
  if (currentInfo) {
    return {
      route: "live_research",
      reason: "Question depends on current EVE information.",
      characterName,
      hullNames,
      requiredCharacterSections: characterName ? ["skills"] : [],
      allowedTools: ["list_public_data_sources", "get_public_data_source"],
      allowWeb: true,
      modelTier: "reasoning",
      maxModelRounds: 3,
      requestBudgetMs: 35_000,
    };
  }

  const personal = Boolean(characterName) || /\b(my|me|character|skills?|training|can i|am i|do i|able to|can .* fly)\b/i.test(message);
  if (personal) {
    return {
      route: "character",
      reason: "Question depends on a Sage character.",
      characterName,
      hullNames,
      requiredCharacterSections: /\b(wallet|isk|money|income)\b/i.test(message) ? ["wallet"]
        : /\b(currently in|current ship)\b/i.test(message) ? ["ship", "location"]
        : /\b(where|location|docked)\b/i.test(message) ? ["location"] : ["skills"],
      allowedTools: [],
      allowWeb: false,
      modelTier: "fast",
      maxModelRounds: 1,
      requestBudgetMs: 15_000,
    };
  }

  if (/\b(click|open tab|navigate ui|operate sage|button|checkbox|select|send|save|delete|remove|revoke|cancel)\b/i.test(message)) {
    return {
      route: "action",
      reason: "Sage UI/action request.",
      characterName,
      hullNames,
      requiredCharacterSections: [],
      allowedTools: ["list_sage_controls", "invoke_sage_control", "list_sage_actions", "invoke_sage_action"],
      allowWeb: false,
      modelTier: "reasoning",
      maxModelRounds: 2,
      requestBudgetMs: 30_000,
    };
  }

  return {
    route: "knowledge",
    reason: "Ordinary EVE knowledge/conversation.",
    characterName,
    hullNames,
    requiredCharacterSections: [],
    allowedTools: [],
    allowWeb: false,
    modelTier: "fast",
    maxModelRounds: 1,
    requestBudgetMs: 15_000,
  };
}
