export type FitItem = {
  name: string;
  typeId?: number;
  quantity: number;
  charge?: string;
  chargeTypeId?: number;
  chargeQuantity?: number;
  attributeOverrides?: Record<string, number>;
  originalName?: string;
  repairReason?: string;
  originalCharge?: string;
  chargeRepairReason?: string;
  state?: "offline" | "online" | "active" | "overheated";
};

export type Fit = {
  id: string;
  name: string;
  hull: FitItem;
  low: FitItem[];
  mid: FitItem[];
  high: FitItem[];
  rig: FitItem[];
  subsystem: FitItem[];
  drones: FitItem[];
  fighters: FitItem[];
  cargo: FitItem[];
  implants: FitItem[];
  boosters: FitItem[];
  instructions: string[];
  source: string;
};

export type FitValidationIssue = {
  level: "error" | "warning" | "info";
  code: string;
  message: string;
  item?: string;
};

export type FitValidationResult = {
  valid: boolean;
  issues: FitValidationIssue[];
  errors: FitValidationIssue[];
  warnings: FitValidationIssue[];
  infos: FitValidationIssue[];
};

export type LegacyFitRepair = { original: string; current: string; reason: string };

const VERIFIED_LEGACY_EXACT = new Map<string, string>([
  ["adaptive invulnerability field i", "Multispectrum Shield Hardener I"],
  ["adaptive invulnerability field ii", "Multispectrum Shield Hardener II"],
  ["adaptive invulnerability shield hardener i", "Multispectrum Shield Hardener I"],
  ["adaptive invulnerability shield hardener ii", "Multispectrum Shield Hardener II"],
  ["limited adaptive invulnerability field i", "Compact Multispectrum Shield Hardener"],
  ["em ward amplifier i", "EM Shield Amplifier I"],
  ["em ward amplifier ii", "EM Shield Amplifier II"],
  ["explosive deflection amplifier i", "Explosive Shield Amplifier I"],
  ["explosive deflection amplifier ii", "Explosive Shield Amplifier II"],
  ["kinetic deflection amplifier i", "Kinetic Shield Amplifier I"],
  ["kinetic deflection amplifier ii", "Kinetic Shield Amplifier II"],
  ["thermal dissipation amplifier i", "Thermal Shield Amplifier I"],
  ["thermal dissipation amplifier ii", "Thermal Shield Amplifier II"],
  ["armor em hardener i", "EM Armor Hardener I"],
  ["armor em hardener ii", "EM Armor Hardener II"],
  ["armor explosive hardener i", "Explosive Armor Hardener I"],
  ["armor explosive hardener ii", "Explosive Armor Hardener II"],
  ["armor kinetic hardener i", "Kinetic Armor Hardener I"],
  ["armor kinetic hardener ii", "Kinetic Armor Hardener II"],
  ["armor thermal hardener i", "Thermal Armor Hardener I"],
  ["armor thermal hardener ii", "Thermal Armor Hardener II"],
]);

const LEGACY_RIG_CORES: Array<[RegExp, string]> = [
  [/^Anti-EM Screen Reinforcer (I|II)$/i, "EM Shield Reinforcer"],
  [/^Anti-Explosive Screen Reinforcer (I|II)$/i, "Explosive Shield Reinforcer"],
  [/^Anti-Kinetic Screen Reinforcer (I|II)$/i, "Kinetic Shield Reinforcer"],
  [/^Anti-Thermal Screen Reinforcer (I|II)$/i, "Thermal Shield Reinforcer"],
  [/^Anti-EM Pump (I|II)$/i, "EM Armor Reinforcer"],
  [/^Anti-Explosive Pump (I|II)$/i, "Explosive Armor Reinforcer"],
  [/^Anti-Kinetic Pump (I|II)$/i, "Kinetic Armor Reinforcer"],
  [/^Anti-Thermal Pump (I|II)$/i, "Thermal Armor Reinforcer"],
];

export function repairLegacyFitName(value: string): LegacyFitRepair | null {
  const original = value.trim();
  const exact = VERIFIED_LEGACY_EXACT.get(original.toLowerCase());
  if (exact && exact !== original) return { original, current: exact, reason: "Verified CCP item rename" };
  const sized = original.match(/^(Small|Medium|Large|Capital)\s+(.+)$/i);
  if (sized) {
    const size = sized[1][0].toUpperCase() + sized[1].slice(1).toLowerCase();
    for (const [pattern, currentCore] of LEGACY_RIG_CORES) {
      const match = sized[2].match(pattern);
      if (match) return { original, current: size + " " + currentCore + " " + match[1].toUpperCase(), reason: "Verified CCP rig rename" };
    }
  }
  return null;
}

const MAX_STACK_QUANTITY = 1_000_000_000;
const SLOT_GROUPS = ["low", "mid", "high", "rig", "subsystem"] as const;

type SlotGroup = (typeof SLOT_GROUPS)[number];

type RawItem = {
  name?: unknown;
  typeName?: unknown;
  type_id?: unknown;
  typeId?: unknown;
  quantity?: unknown;
  qty?: unknown;
  charge?: unknown;
  chargeTypeId?: unknown;
  chargeQuantity?: unknown;
  attributeOverrides?: unknown;
  mutatedAttributes?: unknown;
  state?: unknown;
};

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `fit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cleanCodeFence(text: string) {
  const trimmed = text.trim();
  const blocks = [...trimmed.matchAll(/```(?:json|eft|xml|txt|text|pyfa|fit)?\s*([\s\S]*?)\s*```/gi)]
    .map((match) => match[1].trim())
    .filter((block) => block.startsWith("{") || block.startsWith("[") || block.startsWith("<") || /(?:ship|hull|fit\s*name|high\s*slots?|low\s*slots?)[\s:=]/i.test(block));
  return (blocks.length ? blocks.join("\n\n") : trimmed).replace(/^>\s?/gm, "").trim();
}

function positiveInteger(value: unknown, fallback = 1) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const rounded = Math.trunc(numeric);
  if (rounded <= 0) return fallback;
  return Math.min(rounded, MAX_STACK_QUANTITY);
}

function positiveTypeId(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  const rounded = Math.trunc(numeric);
  return rounded > 0 ? rounded : undefined;
}

function requiredName(value: unknown) {
  const name = String(value ?? "").trim();
  return name || "Unknown item";
}

function attributeOverrides(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, number> = {};
  for (const [rawId, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const id = Number(rawId);
    const numeric = Number(rawValue);
    if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(numeric)) continue;
    result[String(id)] = numeric;
  }
  return Object.keys(result).length ? result : undefined;
}

export function parseEftItem(line: string): FitItem {
  const cleanLine = line.trim();
  const quantityMatch = cleanLine.match(/\s+x(\d+)\s*$/i);
  const quantity = quantityMatch ? positiveInteger(quantityMatch[1]) : 1;
  let withoutQuantity = cleanLine.replace(/\s+x\d+\s*$/i, "").trim();
  const offline = /\s+\/offline\s*$/i.test(withoutQuantity);
  withoutQuantity = withoutQuantity.replace(/\s+\/offline\s*$/i, "").trim();
  const [namePart, ...chargeParts] = withoutQuantity.split(",").map((part) => part.trim());
  const rawName = requiredName(namePart);
  const rawCharge = chargeParts.join(", ") || undefined;
  const itemRepair = repairLegacyFitName(rawName);
  const chargeRepair = rawCharge ? repairLegacyFitName(rawCharge) : null;
  return {
    name: itemRepair?.current ?? rawName,
    originalName: itemRepair?.original,
    repairReason: itemRepair?.reason,
    quantity,
    charge: chargeRepair?.current ?? rawCharge,
    originalCharge: chargeRepair?.original,
    chargeRepairReason: chargeRepair?.reason,
    state: offline ? "offline" : undefined,
  };
}

export function parseItem(value: unknown): FitItem {
  if (typeof value === "string") return parseEftItem(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { name: "Unknown item", quantity: 1 };
  }
  const item = value as RawItem;
  const rawName = requiredName(item.name ?? item.typeName);
  const nameRepair = repairLegacyFitName(rawName);
  const charge = typeof item.charge === "string" ? item.charge.trim() : undefined;
  const chargeRepair = charge ? repairLegacyFitName(charge) : null;
  const state = ["offline", "online", "active", "overheated"].includes(String(item.state)) ? item.state as FitItem["state"] : undefined;
  return {
    name: nameRepair?.current ?? rawName,
    originalName: nameRepair?.original,
    repairReason: nameRepair?.reason,
    typeId: positiveTypeId(item.typeId ?? item.type_id),
    quantity: positiveInteger(item.quantity ?? item.qty),
    charge: (chargeRepair?.current ?? charge) || undefined,
    originalCharge: chargeRepair?.original,
    chargeRepairReason: chargeRepair?.reason,
    chargeTypeId: positiveTypeId(item.chargeTypeId),
    chargeQuantity: item.chargeQuantity == null ? undefined : positiveInteger(item.chargeQuantity),
    attributeOverrides: attributeOverrides(item.attributeOverrides ?? item.mutatedAttributes),
    state,
  };
}

function itemArray(value: unknown): FitItem[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(parseItem);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const itemFields = ["name", "typeName", "typeId", "type_id", "quantity", "qty"];
    if (!itemFields.some((field) => field in record)) {
      // Common compact JSON shape: { "Hobgoblin II": 5, "Nanite Repair Paste": 50 }
      return Object.entries(record).map(([name, quantity]) => parseItem({ name, quantity }));
    }
  }
  return [parseItem(value)];
}

function stringArray(value: unknown): string[] {
  if (value == null) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((entry) => String(entry).trim()).filter(Boolean);
}

function parseJsonFit(source: string, raw: Record<string, unknown>): Fit {
  if (Array.isArray(raw.items) && (raw.ship_type_id || raw.shipTypeId)) {
    const groups: Record<SlotGroup | "drones" | "cargo", FitItem[]> = { low: [], mid: [], high: [], rig: [], subsystem: [], drones: [], cargo: [] };
    for (const entry of raw.items as Array<Record<string, unknown>>) {
      const flag = String(entry.flag ?? entry.location_flag ?? "cargo").toLowerCase();
      const item = parseItem({ name: entry.name ?? `Type ${entry.type_id ?? entry.typeId}`, typeId: entry.type_id ?? entry.typeId, quantity: entry.quantity ?? entry.qty ?? 1 });
      const target = flag.includes("low") ? "low" : flag.includes("med") || flag.includes("mid") ? "mid" : flag.includes("hi") || flag.includes("high") ? "high" : flag.includes("rig") ? "rig" : flag.includes("subsystem") ? "subsystem" : flag.includes("drone") || flag.includes("fighter") ? "drones" : "cargo";
      groups[target].push(item);
    }
    const hullId = positiveTypeId(raw.ship_type_id ?? raw.shipTypeId);
    return { id: randomId(), name: String(raw.name ?? raw.fitName ?? `Imported fit ${hullId ?? ""}`).trim(), hull: { name: hullId ? `Type ${hullId}` : requiredName(raw.ship_name), typeId: hullId, quantity: 1 }, ...groups, fighters: [], implants: [], boosters: [], instructions: stringArray(raw.description ?? raw.instructions ?? raw.notes), source };
  }
  const rawModules = raw.modules;
  const modules = rawModules && typeof rawModules === "object" && !Array.isArray(rawModules)
    ? rawModules as Record<string, unknown>
    : raw;
  const hull = parseItem(raw.ship ?? raw.hull ?? raw.shipType ?? "Unknown hull");
  const fitName = String(raw.name ?? raw.fitName ?? `${hull.name} fitting`).trim();
  return {
    id: randomId(),
    name: fitName || `${hull.name} fitting`,
    hull: { ...hull, quantity: 1 },
    low: itemArray(modules.low ?? modules.lows ?? modules.lowSlots ?? modules.low_slots),
    mid: itemArray(modules.mid ?? modules.mids ?? modules.med ?? modules.medium ?? modules.midSlots ?? modules.mid_slots),
    high: itemArray(modules.high ?? modules.highs ?? modules.highSlots ?? modules.high_slots),
    rig: itemArray(modules.rig ?? modules.rigs ?? modules.rigSlots ?? modules.rig_slots),
    subsystem: itemArray(modules.subsystem ?? modules.subsystems ?? modules.subsystem_slots),
    drones: itemArray(raw.drones ?? raw.droneBay ?? raw.dronebay),
    fighters: itemArray(raw.fighters ?? raw.fighterBay ?? raw.fighterbay),
    cargo: itemArray(raw.cargo ?? raw.charges ?? raw.ammo),
    implants: itemArray(raw.implants),
    boosters: itemArray(raw.boosters ?? raw.drugs),
    instructions: stringArray(raw.instructions ?? raw.notes ?? raw.usage),
    source,
  };
}

function flushGroup(groups: string[][], current: string[]) {
  if (current.length) groups.push([...current]);
  current.length = 0;
}

function parseEftFit(source: string, trimmed: string): Fit {
  const lines = trimmed.split(/\r?\n/);
  while (lines.length && !lines[0].trim()) lines.shift();
  const headerLine = lines.shift()?.trim() ?? "";
  const header = headerLine.match(/^\[(.+?),\s*(.+?)\]$/);
  if (!header) {
    throw new Error("Use an EFT fit beginning with [Ship, Fit name], or a Sage JSON fit block.");
  }

  const groups: string[][] = [];
  const current: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushGroup(groups, current);
      continue;
    }
    if (/^\[Empty .* slot\]$/i.test(line)) {
      current.push(line);
      continue;
    }
    current.push(line);
  }
  flushGroup(groups, current);

  const cleanedGroups = groups.map((group) =>
    group.filter((line) => !/^\[Empty .* slot\]$/i.test(line)),
  );
  let low: string[] = [];
  let mid: string[] = [];
  let high: string[] = [];
  let rig: string[] = [];
  let subsystem: string[] = [];
  let drones: string[] = [];
  let cargo: string[] = [];

  if (cleanedGroups.length >= 7) {
    [low = [], mid = [], high = [], rig = [], subsystem = [], drones = [], cargo = []] = cleanedGroups;
    if (cleanedGroups.length > 7) cargo.push(...cleanedGroups.slice(7).flat());
  } else {
    [low = [], mid = [], high = [], rig = [], drones = [], cargo = []] = cleanedGroups;
    if (cleanedGroups.length > 6) cargo.push(...cleanedGroups.slice(6).flat());
  }

  return {
    id: randomId(),
    name: header[2].trim(),
    hull: { name: header[1].trim(), quantity: 1 },
    low: low.map(parseEftItem),
    mid: mid.map(parseEftItem),
    high: high.map(parseEftItem),
    rig: rig.map(parseEftItem),
    subsystem: subsystem.map(parseEftItem),
    drones: drones.map(parseEftItem),
    fighters: [],
    cargo: cargo.map(parseEftItem),
    implants: [],
    boosters: [],
    instructions: [],
    source,
  };
}

function parseXmlFits(source: string, xml: string): Fit[] {
  if (typeof DOMParser === "undefined") throw new Error("XML fitting import is only available in the desktop interface.");
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const parseError = document.querySelector("parsererror");
  if (parseError) throw new Error("Invalid EVE/Pyfa XML fitting file.");
  const nodes = [...document.querySelectorAll("fitting")];
  if (!nodes.length) throw new Error("The XML file does not contain any fittings.");
  return nodes.map((node, index) => {
    const shipNode = node.querySelector("shipType, shiptype, ship, shipTypeID, shiptypeid");
    const hullValue = shipNode?.getAttribute("value") ?? shipNode?.getAttribute("name") ?? "Unknown hull";
    const numericHullId = positiveTypeId(hullValue);
    const hull = numericHullId ? { name: `Type ${numericHullId}`, typeId: numericHullId, quantity: 1 } : { ...parseItem(hullValue), quantity: 1 };
    const hullName = hull.name;
    const groups: Record<SlotGroup | "drones" | "cargo", FitItem[]> = { low: [], mid: [], high: [], rig: [], subsystem: [], drones: [], cargo: [] };
    for (const hardware of node.querySelectorAll("hardware")) {
      const slot = (hardware.getAttribute("slot") ?? "").toLowerCase();
      const name = hardware.getAttribute("type") ?? hardware.getAttribute("name") ?? "Unknown item";
      const typeId = positiveTypeId(hardware.getAttribute("typeID") ?? hardware.getAttribute("typeId") ?? hardware.getAttribute("type_id"));
      const item = parseItem({ name, typeId, quantity: positiveInteger(hardware.getAttribute("qty") ?? 1) });
      const target = slot.includes("low") ? "low" : slot.includes("med") || slot.includes("mid") ? "mid" : slot.includes("hi") || slot.includes("high") ? "high" : slot.includes("rig") ? "rig" : slot.includes("subsystem") ? "subsystem" : slot.includes("drone") || slot.includes("fighter") ? "drones" : "cargo";
      groups[target].push(item);
    }
    const description = node.querySelector("description")?.getAttribute("value")?.trim();
    return { id: randomId(), name: node.getAttribute("name")?.trim() || `${hullName} fitting ${index + 1}`, hull, ...groups, fighters: [], implants: [], boosters: [], instructions: description ? [description] : [], source };
  });
}

function parseDnaFit(source: string, value: string): Fit {
  const dna = value.trim().replace(/^dna\s*[:=]\s*/i, "");
  const parts = dna.split(":");
  const hullId = positiveTypeId(parts.shift());
  if (!hullId) throw new Error("The DNA fitting does not contain a valid ship type ID.");
  const cargo: FitItem[] = [];
  for (const segment of parts) {
    if (!segment.trim()) continue;
    const [rawId, rawQuantity] = segment.split(";");
    const typeId = positiveTypeId(rawId);
    if (typeId) cargo.push({ name: `Type ${typeId}`, typeId, quantity: positiveInteger(rawQuantity) });
  }
  return { id: randomId(), name: `Imported DNA fit ${hullId}`, hull: { name: `Type ${hullId}`, typeId: hullId, quantity: 1 }, low: [], mid: [], high: [], rig: [], subsystem: [], drones: [], fighters: [], cargo, implants: [], boosters: [], instructions: [], source };
}

function parseSectionedFit(source: string, value: string): Fit {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let hull = "";
  let name = "Imported fitting";
  const groups: Record<SlotGroup | "drones" | "cargo", FitItem[]> = { low: [], mid: [], high: [], rig: [], subsystem: [], drones: [], cargo: [] };
  let target: keyof typeof groups | null = null;
  const hasSections = lines.some((candidate) => sectionName(candidate) != null);
  function sectionName(line: string) {
    const key = line.replace(/^#+\s*/, "").replace(/^\[|\]$/g, "").replace(/:$/, "").trim().toLowerCase();
    if (/^(low|low slots?)$/.test(key)) return "low";
    if (/^(mid|med|middle|mid slots?|med slots?)$/.test(key)) return "mid";
    if (/^(high|hi|high slots?|hi slots?)$/.test(key)) return "high";
    if (/^rigs?$/.test(key)) return "rig";
    if (/^subsystems?$/.test(key)) return "subsystem";
    if (/^(drones?|fighters?|drone bay|fighter bay)$/.test(key)) return "drones";
    if (/^(cargo|ammo|charges?|cargo bay)$/.test(key)) return "cargo";
    return null;
  }
  for (const line of lines) {
    const shipMatch = line.match(/^(?:ship|hull|ship type)\s*[:=]\s*(.+)$/i);
    if (shipMatch) { hull = shipMatch[1].trim(); continue; }
    const nameMatch = line.match(/^(?:fit|fit name|fitting|name)\s*[:=]\s*(.+)$/i);
    if (nameMatch) { name = nameMatch[1].trim(); continue; }
    const next = sectionName(line);
    if (next) { target = next; continue; }
    if (!hull && target == null) { hull = line.replace(/^[-*•]\s*/, ""); continue; }
    if (target && !/^[-=]{3,}$/.test(line)) groups[target].push(parseEftItem(line.replace(/^[-*•]\s*/, "")));
    else if (!hasSections && hull && line !== hull && !/^[-=]{3,}$/.test(line)) groups.cargo.push(parseEftItem(line.replace(/^[-*•]\s*/, "")));
  }
  if (!hull) throw new Error("Could not identify the ship. Add a [Ship, Fit name] header or a Ship: line.");
  return { id: randomId(), name, hull: { name: hull, quantity: 1 }, ...groups, fighters: [], implants: [], boosters: [], instructions: [], source };
}

function payloadStart(value: string) {
  const markers = [value.search(/^\s*\[[^\r\n]+?,\s*[^\r\n]+?\]\s*$/m), value.search(/^\s*[<{]/m), value.search(/^\s*(?:dna\s*[:=]\s*)?\d+:(?:\d+;\d*:)+/mi), value.search(/^\s*(?:ship|hull|ship type)\s*[:=]/mi)].filter((index) => index >= 0);
  return markers.length ? value.slice(Math.min(...markers)).trim() : value.trim();
}

export function parseFit(text: string): Fit {
  const trimmed = cleanCodeFence(text);
  if (!trimmed) throw new Error("Paste a fitting before importing.");

  if (trimmed.startsWith("{")) {
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON fitting.");
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Sage fitting JSON must be a single JSON object.");
    }
    return parseJsonFit(text, raw as Record<string, unknown>);
  }

  return parseEftFit(text, trimmed);
}

export function parseFits(text: string): Fit[] {
  const trimmed = payloadStart(cleanCodeFence(text));
  if (!trimmed) throw new Error("Paste a fitting before importing.");
  if (trimmed.startsWith("<")) return parseXmlFits(text, trimmed);
  if (/^(?:dna\s*[:=]\s*)?\d+:(?:\d+;\d*:)+/i.test(trimmed)) return [parseDnaFit(text, trimmed.split(/\s+/)[0])];
  if (/^\[\s*\{/.test(trimmed)) {
    let raw: unknown;
    try { raw = JSON.parse(trimmed); } catch (error) { throw new Error(error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON fittings."); }
    if (!Array.isArray(raw) || !raw.length) throw new Error("A multi-fit JSON import must contain at least one fitting object.");
    return raw.map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`JSON fitting ${index + 1} is not an object.`);
      return parseJsonFit(text, entry as Record<string, unknown>);
    });
  }
  if (trimmed.startsWith("{")) {
    let raw: any;
    try { raw = JSON.parse(trimmed); } catch (error) { throw new Error(error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON fitting."); }
    const collection = raw?.fits ?? raw?.fittings;
    if (Array.isArray(collection)) return collection.map((entry: unknown, index: number) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`JSON fitting ${index + 1} is not an object.`);
      return parseJsonFit(text, entry as Record<string, unknown>);
    });
    if (raw?.fit && typeof raw.fit === "object") return [parseJsonFit(text, raw.fit)];
    return [parseJsonFit(text, raw)];
  }
  const starts = [...trimmed.matchAll(/^\[[^\r\n]+?,\s*[^\r\n]+?\]\s*$/gm)].map((match) => match.index ?? 0);
  if (!starts.length) return [parseSectionedFit(text, trimmed)];
  return starts.map((start, index) => parseEftFit(text, trimmed.slice(start, starts[index + 1] ?? trimmed.length).trim()));
}

export function fitFingerprint(fit: Fit) {
  const rack = (items: FitItem[]) => items.map((item) => `${item.typeId ?? item.name.toLowerCase()}:${item.quantity}:${item.chargeTypeId ?? item.charge?.toLowerCase() ?? ""}:${item.chargeQuantity ?? ""}:${item.attributeOverrides ? JSON.stringify(Object.entries(item.attributeOverrides).sort(([a], [b]) => Number(a) - Number(b))) : ""}`).sort();
  return JSON.stringify({ hull: fit.hull.typeId ?? fit.hull.name.toLowerCase(), low: rack(fit.low), mid: rack(fit.mid), high: rack(fit.high), rig: rack(fit.rig), subsystem: rack(fit.subsystem), drones: rack(fit.drones), cargo: rack(fit.cargo) });
}

export function fitItems(fit: Fit) {
  return [
    fit.hull,
    ...fit.low,
    ...fit.mid,
    ...fit.high,
    ...fit.rig,
    ...fit.subsystem,
    ...fit.drones,
    ...fit.fighters,
    ...fit.cargo,
    ...fit.implants,
    ...fit.boosters,
  ];
}

function duplicateWarnings(fit: Fit): FitValidationIssue[] {
  const issues: FitValidationIssue[] = [];
  for (const group of [...SLOT_GROUPS, "drones", "cargo"] as const) {
    const counts = new Map<string, number>();
    for (const item of fit[group]) {
      const key = item.name.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [name, count] of counts) {
      if (count > 1) {
        issues.push({
          level: "info",
          code: "duplicate-lines",
          item: name,
          message: `${count} separate ${group} entries use the same item name; quantities are preserved as imported.`,
        });
      }
    }
  }
  return issues;
}

export function validateFit(fit: Fit): FitValidationResult {
  const issues: FitValidationIssue[] = [];
  const hullName = fit.hull.name.trim();
  if (!hullName || hullName.toLowerCase() === "unknown hull" || hullName.toLowerCase() === "unknown item") {
    issues.push({ level: "error", code: "missing-hull", message: "The fitting does not identify a valid ship hull." });
  }
  if (!fit.name.trim()) {
    issues.push({ level: "warning", code: "missing-name", message: "The fitting has no display name." });
  }

  for (const item of fitItems(fit)) {
    if (!item.name.trim() || item.name.toLowerCase() === "unknown item") {
      issues.push({ level: "error", code: "missing-item-name", message: "One or more fitting entries have no item name." });
      continue;
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      issues.push({ level: "error", code: "bad-quantity", item: item.name, message: `${item.name} has an invalid quantity.` });
    }
    if (item.typeId !== undefined && (!Number.isInteger(item.typeId) || item.typeId <= 0)) {
      issues.push({ level: "warning", code: "bad-type-id", item: item.name, message: `${item.name} has an invalid EVE type ID and will be resolved by name instead.` });
    }
  }

  const fittedModules = fit.low.length + fit.mid.length + fit.high.length + fit.rig.length + fit.subsystem.length;
  if (!fittedModules) {
    issues.push({ level: "warning", code: "no-modules", message: "This fitting contains a hull but no fitted modules." });
  }
  if (fit.high.length > 8) issues.push({ level: "warning", code: "high-count", message: `Imported ${fit.high.length} high-slot entries; EVE hulls cannot expose more than 8 high slots.` });
  if (fit.mid.length > 8) issues.push({ level: "warning", code: "mid-count", message: `Imported ${fit.mid.length} mid-slot entries; EVE hulls cannot expose more than 8 mid slots.` });
  if (fit.low.length > 8) issues.push({ level: "warning", code: "low-count", message: `Imported ${fit.low.length} low-slot entries; EVE hulls cannot expose more than 8 low slots.` });
  if (fit.rig.length > 3) issues.push({ level: "warning", code: "rig-count", message: `Imported ${fit.rig.length} rig entries; verify this hull's rig layout.` });
  if (fit.subsystem.length > 4) issues.push({ level: "warning", code: "subsystem-count", message: `Imported ${fit.subsystem.length} subsystem entries; verify this strategic-cruiser layout.` });

  for (const item of fitItems(fit)) {
    if (item.repairReason && item.originalName) issues.push({ level: "info", code: "legacy-item-repaired", item: item.name, message: item.originalName + " was renamed to " + item.name + " (" + item.repairReason + ")." });
    if (item.chargeRepairReason && item.originalCharge && item.charge) issues.push({ level: "info", code: "legacy-charge-repaired", item: item.charge, message: item.originalCharge + " was renamed to " + item.charge + " (" + item.chargeRepairReason + ")." });
    if (!item.typeId) issues.push({ level: "info", code: "unresolved-item", item: item.name, message: item.name + " has no resolved EVE type ID yet" + (item.originalName ? "; imported legacy name was " + item.originalName : "") + ". Current-name lookup will be attempted before import completes." });
    if (item.charge && !item.chargeTypeId) issues.push({ level: "info", code: "unresolved-charge", item: item.charge, message: item.charge + " has no resolved charge/script type ID yet" + (item.originalCharge ? "; imported legacy name was " + item.originalCharge : "") + "." });
  }
  const unresolved = fitItems(fit).filter((item) => !item.typeId);
  if (unresolved.length) {
    issues.push({
      level: "info",
      code: "unresolved-type-ids",
      message: `${unresolved.length} item name${unresolved.length === 1 ? "" : "s"} still need EVE type-ID resolution.`,
    });
  }

  issues.push(...duplicateWarnings(fit));
  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");
  const infos = issues.filter((issue) => issue.level === "info");
  return { valid: errors.length === 0, issues, errors, warnings, infos };
}
