import { randomUUID } from "node:crypto";

export type ImportedFitItem = {
  name: string;
  typeId?: number;
  quantity: number;
  charge?: string;
  chargeTypeId?: number;
  chargeQuantity?: number;
  activeQuantity?: number;
  attributeOverrides?: Record<string, number>;
  state?: "offline" | "online" | "active" | "overheated";
};

export type ImportedFit = {
  id: string;
  name: string;
  hull: ImportedFitItem;
  low: ImportedFitItem[];
  mid: ImportedFitItem[];
  high: ImportedFitItem[];
  rig: ImportedFitItem[];
  subsystem: ImportedFitItem[];
  drones: ImportedFitItem[];
  fighters: ImportedFitItem[];
  cargo: ImportedFitItem[];
  implants: ImportedFitItem[];
  boosters: ImportedFitItem[];
  instructions: string[];
  source: string;
};

const MAX_STACK = 1_000_000_000;
const id = () => randomUUID();
const positive = (value: unknown, fallback = 1) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_STACK, Math.trunc(n)) : fallback;
};
const typeId = (value: unknown) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};
const strings = (value: unknown) => (value == null ? [] : (Array.isArray(value) ? value : [value])).map(String).map((v) => v.trim()).filter(Boolean);

function item(value: unknown): ImportedFitItem {
  if (typeof value === "string") {
    const quantityMatch = value.trim().match(/\s+x(\d+)\s*$/i);
    let clean = value.trim().replace(/\s+x\d+\s*$/i, "").trim();
    const offline = /\s+\/offline\s*$/i.test(clean);
    clean = clean.replace(/\s+\/offline\s*$/i, "").trim();
    const [name, ...charge] = clean.split(",").map((part) => part.trim());
    return { name: name || "Unknown item", quantity: quantityMatch ? positive(quantityMatch[1]) : 1, charge: charge.join(", ") || undefined, state: offline ? "offline" : undefined };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { name: String(value ?? "Unknown item"), quantity: 1 };
  const raw = value as Record<string, unknown>;
  const tid = typeId(raw.typeId ?? raw.type_id ?? raw.id);
  const rawName = String(raw.name ?? raw.typeName ?? raw.type_name ?? (tid ? `Type ${tid}` : "Unknown item")).trim() || "Unknown item";
  const state = ["offline", "online", "active", "overheated"].includes(String(raw.state)) ? String(raw.state) as ImportedFitItem["state"] : undefined;
  return {
    name: rawName,
    typeId: tid,
    quantity: positive(raw.quantity ?? raw.qty ?? raw.count),
    charge: typeof raw.charge === "string" && raw.charge.trim() ? raw.charge.trim() : undefined,
    chargeTypeId: typeId(raw.chargeTypeId ?? raw.charge_type_id),
    chargeQuantity: raw.chargeQuantity == null ? undefined : positive(raw.chargeQuantity),
    activeQuantity: raw.activeQuantity == null ? undefined : Math.max(0, Math.trunc(Number(raw.activeQuantity) || 0)),
    attributeOverrides: raw.attributeOverrides && typeof raw.attributeOverrides === "object" && !Array.isArray(raw.attributeOverrides) ? raw.attributeOverrides as Record<string, number> : undefined,
    state,
  };
}

function items(value: unknown): ImportedFitItem[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(item);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (!["name", "typeName", "typeId", "type_id", "quantity", "qty"].some((key) => key in record)) {
      return Object.entries(record).map(([name, quantity]) => item({ name, quantity }));
    }
  }
  return [item(value)];
}

function blank(source: string, name = "Imported fitting"): ImportedFit {
  return { id: id(), name, hull: { name: "Unknown hull", quantity: 1 }, low: [], mid: [], high: [], rig: [], subsystem: [], drones: [], fighters: [], cargo: [], implants: [], boosters: [], instructions: [], source };
}

function jsonFit(source: string, raw: Record<string, unknown>): ImportedFit {
  const wrapped = raw.fit && typeof raw.fit === "object" && !Array.isArray(raw.fit) ? raw.fit as Record<string, unknown> : raw;
  const modules = wrapped.modules && typeof wrapped.modules === "object" && !Array.isArray(wrapped.modules) ? wrapped.modules as Record<string, unknown> : wrapped;
  const esiHullId = typeId(wrapped.ship_type_id ?? wrapped.shipTypeId);
  const hull = item(wrapped.ship ?? wrapped.hull ?? wrapped.shipType ?? (esiHullId ? { typeId: esiHullId } : "Unknown hull"));
  hull.quantity = 1;
  const fit: ImportedFit = {
    id: String(wrapped.id ?? id()).trim() || id(),
    name: String(wrapped.name ?? wrapped.fitName ?? `${hull.name} fitting`).trim() || `${hull.name} fitting`,
    hull,
    low: items(modules.low ?? modules.lows ?? modules.lowSlots ?? modules.low_slots),
    mid: items(modules.mid ?? modules.mids ?? modules.med ?? modules.medium ?? modules.midSlots ?? modules.mid_slots),
    high: items(modules.high ?? modules.highs ?? modules.highSlots ?? modules.high_slots),
    rig: items(modules.rig ?? modules.rigs ?? modules.rigSlots ?? modules.rig_slots),
    subsystem: items(modules.subsystem ?? modules.subsystems ?? modules.subsystem_slots),
    drones: items(wrapped.drones ?? wrapped.droneBay ?? wrapped.dronebay),
    fighters: items(wrapped.fighters ?? wrapped.fighterBay ?? wrapped.fighterbay),
    cargo: items(wrapped.cargo ?? wrapped.charges ?? wrapped.ammo),
    implants: items(wrapped.implants),
    boosters: items(wrapped.boosters ?? wrapped.drugs),
    instructions: strings(wrapped.instructions ?? wrapped.notes ?? wrapped.usage ?? wrapped.description),
    source,
  };
  if (Array.isArray(wrapped.items)) {
    for (const rawEntry of wrapped.items) {
      if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
      const entry = rawEntry as Record<string, unknown>;
      const flag = String(entry.flag ?? entry.location_flag ?? entry.slot ?? "cargo").toLowerCase();
      const parsed = item(entry);
      if (flag.includes("low")) fit.low.push(parsed);
      else if (flag.includes("med") || flag.includes("mid")) fit.mid.push(parsed);
      else if (flag.includes("hi") || flag.includes("high")) fit.high.push(parsed);
      else if (flag.includes("rig")) fit.rig.push(parsed);
      else if (flag.includes("subsystem")) fit.subsystem.push(parsed);
      else if (flag.includes("fighter")) fit.fighters.push(parsed);
      else if (flag.includes("drone")) fit.drones.push(parsed);
      else fit.cargo.push(parsed);
    }
  }
  return fit;
}

function cleanText(text: string) {
  const trimmed = text.trim();
  const blocks = [...trimmed.matchAll(/```(?:json|eft|xml|txt|text|pyfa|fit)?\s*([\s\S]*?)\s*```/gi)].map((m) => m[1].trim()).filter(Boolean);
  return (blocks.length ? blocks.join("\n\n") : trimmed).replace(/^>\s?/gm, "").trim();
}

function eftFit(source: string, text: string): ImportedFit {
  const lines = text.split(/\r?\n/);
  while (lines.length && !lines[0].trim()) lines.shift();
  const header = (lines.shift()?.trim() ?? "").match(/^\[(.+?),\s*(.+?)\]$/);
  if (!header) throw new Error("Could not identify an EFT/PYFA header.");
  const groups: string[][] = [];
  let current: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { if (current.length) groups.push(current); current = []; continue; }
    if (!/^\[Empty .* slot\]$/i.test(line)) current.push(line);
  }
  if (current.length) groups.push(current);
  const result = blank(source, header[2].trim());
  result.hull = { name: header[1].trim(), quantity: 1 };
  const [low = [], mid = [], high = [], rig = [], subsystem = [], drones = [], cargo = []] = groups;
  result.low = low.map(item); result.mid = mid.map(item); result.high = high.map(item); result.rig = rig.map(item); result.subsystem = subsystem.map(item); result.drones = drones.map(item); result.cargo = [...cargo, ...groups.slice(7).flat()].map(item);
  return result;
}

function dnaFit(source: string, text: string): ImportedFit {
  const dna = text.trim().replace(/^dna\s*[:=]\s*/i, "").split(/\s+/)[0];
  const parts = dna.split(":");
  const hullId = typeId(parts.shift());
  if (!hullId) throw new Error("DNA fitting does not contain a valid hull type ID.");
  const result = blank(source, `Imported DNA fit ${hullId}`);
  result.hull = { name: `Type ${hullId}`, typeId: hullId, quantity: 1 };
  for (const segment of parts) {
    const [rawId, rawQuantity] = segment.split(";");
    const tid = typeId(rawId);
    if (tid) result.cargo.push({ name: `Type ${tid}`, typeId: tid, quantity: positive(rawQuantity) });
  }
  return result;
}

function sectionedFit(source: string, text: string): ImportedFit {
  const result = blank(source);
  let target: "low" | "mid" | "high" | "rig" | "subsystem" | "drones" | "fighters" | "cargo" | "implants" | "boosters" | null = null;
  const section = (line: string): typeof target => {
    const key = line.replace(/^#+\s*/, "").replace(/^\[|\]$/g, "").replace(/:$/, "").trim().toLowerCase();
    if (/^(low|low slots?)$/.test(key)) return "low";
    if (/^(mid|med|middle|mid slots?|med slots?)$/.test(key)) return "mid";
    if (/^(high|hi|high slots?|hi slots?)$/.test(key)) return "high";
    if (/^rigs?$/.test(key)) return "rig";
    if (/^subsystems?$/.test(key)) return "subsystem";
    if (/^(drones?|drone bay)$/.test(key)) return "drones";
    if (/^(fighters?|fighter bay)$/.test(key)) return "fighters";
    if (/^(cargo|ammo|charges?|cargo bay)$/.test(key)) return "cargo";
    if (/^implants?$/.test(key)) return "implants";
    if (/^(boosters?|drugs?)$/.test(key)) return "boosters";
    return null;
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const ship = line.match(/^(?:ship|hull|ship type)\s*[:=\-]\s*(.+)$/i);
    if (ship) { result.hull = { name: ship[1].trim(), quantity: 1 }; continue; }
    const name = line.match(/^(?:fit|fit name|fitting|name)\s*[:=\-]\s*(.+)$/i);
    if (name) { result.name = name[1].trim(); continue; }
    const next = section(line);
    if (next) { target = next; continue; }
    if (target && !/^[-=]{3,}$/.test(line)) result[target].push(item(line.replace(/^[-*•]\s*/, "")));
    else if (result.hull.name === "Unknown hull" && !/^[-=]{3,}$/.test(line)) result.hull = { name: line.replace(/^[-*•]\s*/, ""), quantity: 1 };
    else if (!/^[-=]{3,}$/.test(line) && /\b(module|launcher|turret|booster|hardener|repairer|drive|afterburner|scrambler|webifier|amplifier|computer|link|rig|drone|charge|script|probe)\b/i.test(line)) result.cargo.push(item(line.replace(/^[-*•]\s*/, "")));
  }
  if (result.hull.name === "Unknown hull") throw new Error("Could not identify the ship hull in the LLM fit.");
  return result;
}

function xmlFits(source: string, xml: string): ImportedFit[] {
  const blocks = [...xml.matchAll(/<fitting\b([^>]*)>([\s\S]*?)<\/fitting>/gi)];
  if (!blocks.length) throw new Error("XML contains no fitting elements.");
  const attr = (text: string, name: string) => text.match(new RegExp(`${name}\\s*=\\s*[\"']([^\"']*)[\"']`, "i"))?.[1];
  return blocks.map((match, index) => {
    const result = blank(source, attr(match[1], "name") || `Imported fitting ${index + 1}`);
    const body = match[2];
    const shipTag = body.match(/<(?:shipType|shiptype|ship)\b([^>]*)\/?>(?:[^<]*)/i);
    const shipValue = shipTag ? (attr(shipTag[1], "value") ?? attr(shipTag[1], "name") ?? attr(shipTag[1], "typeID")) : undefined;
    const sid = typeId(shipValue);
    result.hull = sid ? { name: `Type ${sid}`, typeId: sid, quantity: 1 } : { name: shipValue || "Unknown hull", quantity: 1 };
    for (const hw of body.matchAll(/<hardware\b([^>]*)\/?>(?:[\s\S]*?<\/hardware>)?/gi)) {
      const attrs = hw[1];
      const slot = String(attr(attrs, "slot") ?? "cargo").toLowerCase();
      const tid = typeId(attr(attrs, "typeID") ?? attr(attrs, "typeId"));
      const parsed = item({ name: attr(attrs, "type") ?? attr(attrs, "name") ?? (tid ? `Type ${tid}` : "Unknown item"), typeId: tid, quantity: attr(attrs, "qty") ?? 1 });
      if (slot.includes("low")) result.low.push(parsed); else if (slot.includes("med") || slot.includes("mid")) result.mid.push(parsed); else if (slot.includes("hi") || slot.includes("high")) result.high.push(parsed); else if (slot.includes("rig")) result.rig.push(parsed); else if (slot.includes("subsystem")) result.subsystem.push(parsed); else if (slot.includes("fighter")) result.fighters.push(parsed); else if (slot.includes("drone")) result.drones.push(parsed); else result.cargo.push(parsed);
    }
    return result;
  });
}

export function importFits(value: unknown): ImportedFit[] {
  if (typeof value === "string") {
    const text = cleanText(value);
    if (!text) throw new Error("Fit payload is empty.");
    if (text.startsWith("<")) return xmlFits(value, text);
    if (/^(?:dna\s*[:=]\s*)?\d+:(?:\d+;\d*:)+/i.test(text)) return [dnaFit(value, text)];
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        const parsed = JSON.parse(text);
        return importFits(parsed).map((fit) => ({ ...fit, source: value }));
      } catch {
        if (/^\[[^\r\n]+?,\s*[^\r\n]+?\]\s*$/m.test(text)) {
          const starts = [...text.matchAll(/^\[[^\r\n]+?,\s*[^\r\n]+?\]\s*$/gm)].map((m) => m.index ?? 0);
          return starts.map((start, index) => eftFit(value, text.slice(start, starts[index + 1] ?? text.length).trim()));
        }
      }
    }
    const eftStarts = [...text.matchAll(/^\[[^\r\n]+?,\s*[^\r\n]+?\]\s*$/gm)].map((m) => m.index ?? 0);
    if (eftStarts.length) return eftStarts.map((start, index) => eftFit(value, text.slice(start, eftStarts[index + 1] ?? text.length).trim()));
    return [sectionedFit(value, text)];
  }
  if (Array.isArray(value)) {
    if (!value.length) throw new Error("Fit collection is empty.");
    return value.flatMap(importFits);
  }
  if (!value || typeof value !== "object") throw new Error("Fit must be text, JSON, or a fitting object.");
  const raw = value as Record<string, unknown>;
  const collection = raw.fits ?? raw.fittings ?? raw.loadouts ?? raw.fit_collection;
  if (Array.isArray(collection)) return collection.flatMap(importFits);
  if (typeof raw.text === "string" && !raw.ship && !raw.hull && !raw.modules && !raw.items) return importFits(raw.text);
  return [jsonFit(JSON.stringify(value), raw)];
}

export function validateImportedFit(fit: ImportedFit) {
  if (!fit.hull?.name || /^(unknown hull|unknown item)$/i.test(fit.hull.name)) throw new Error("Fit does not identify a ship hull.");
  for (const rack of ["low", "mid", "high", "rig", "subsystem", "drones", "fighters", "cargo", "implants", "boosters"] as const) {
    if (!Array.isArray(fit[rack])) fit[rack] = [];
  }
  fit.instructions = Array.isArray(fit.instructions) ? fit.instructions.map(String) : [];
  fit.id = String(fit.id || id());
  fit.name = String(fit.name || `${fit.hull.name} fitting`);
  fit.source = String(fit.source ?? "Sage MCP");
  return fit;
}
