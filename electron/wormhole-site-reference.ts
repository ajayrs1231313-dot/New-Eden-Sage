const SHEET_ID = "2PACX-1vSskkG0Lr8YTU1Qz1XrXGlIpqnHZsJePh9ipr1e2qUsmfVu8tzn0NNzAOeM7_omWbHxzWtQ5gO7V1SH";
const BASE_URL = `https://docs.google.com/spreadsheets/d/e/${SHEET_ID}/pub?output=csv&gid=`;
const CACHE_TTL_MS = 20 * 60_000;
const STALE_FALLBACK_MS = 24 * 60 * 60_000;

const SHEETS = [
  { label: "C1", gid: 2001647085, kind: "combat" as const },
  { label: "C2", gid: 981953365, kind: "combat" as const },
  { label: "C3", gid: 0, kind: "combat" as const },
  { label: "C4", gid: 816437863, kind: "combat" as const },
  { label: "C5", gid: 236665847, kind: "combat" as const },
  { label: "C6", gid: 26134341, kind: "combat" as const },
  { label: "Gas", gid: 265585191, kind: "resource" as const },
  { label: "Ore", gid: 1334578207, kind: "resource" as const },
] as const;

export type WormholePveSleeper = {
  qty: number;
  name: string;
  hullClass: string;
  trigger: boolean;
  scram: number;
  web: number;
  neutGjPerSec: number;
  remoteRepHpPerSec: number;
  effectRange?: string;
  signatureRadius?: string;
  chaseSpeed?: string;
  orbitDistance?: string;
  orbitVelocity?: string;
  dps: number;
  alpha: number;
  range?: string;
  ehp: number;
};

export type WormholePveWave = {
  label: string;
  number: number;
  scram: number;
  web: number;
  neutGjPerSec: number;
  remoteRepHpPerSec: number;
  effectRange?: string;
  dps: number;
  alpha: number;
  range?: string;
  ehp: number;
  sleepers: WormholePveSleeper[];
};

export type WormholePveResource = {
  name: string;
  quantity: number;
  volumeM3: number | null;
  cycles: number | null;
  iskPerM3: number | null;
  totalIsk: number | null;
};

export type WormholePveSite = {
  key: string;
  classLabel: "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "Gas" | "Ore";
  name: string;
  category: string;
  blueLootIsk: number | null;
  resourceValueIsk: number | null;
  bestPossibleTime?: string;
  miningTime?: string;
  peakDps: number;
  peakAlpha: number;
  peakNeutGjPerSec: number;
  maxScrams: number;
  maxWebs: number;
  totalEhp: number;
  waves: WormholePveWave[];
  resources: WormholePveResource[];
  source: "PhobiaCide's Versioned Rykki Guide";
  sourceSheet: string;
  sourceUpdatedAt?: string;
};

export type WormholePveReferenceSnapshot = {
  source: "PhobiaCide's Versioned Rykki Guide";
  sourceUrl: string;
  fetchedAt: string;
  stale: boolean;
  sites: WormholePveSite[];
  sheetUpdatedAt: Record<string, string | undefined>;
  errors: string[];
};

type Cache = { fetchedAtMs: number; snapshot: WormholePveReferenceSnapshot };
let cache: Cache | undefined;

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ""; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

function numeric(value: unknown) {
  const text = String(value ?? "").trim().replace(/,/g, "");
  if (!text) return 0;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function nullableNumeric(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? numeric(text) : null;
}

function parseSheetUpdatedAt(rows: string[][]) {
  const first = rows[0] ?? [];
  const index = first.findIndex((value) => /update/i.test(String(value)));
  const raw = index >= 0 ? String(first[index + 1] ?? "").trim() : "";
  if (!raw) return undefined;
  const ms = Date.parse(raw.endsWith("Z") ? raw : `${raw} UTC`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : raw;
}

const SITE_CATEGORIES = new Set(["Anomaly", "Data Signature", "Relic Signature", "Gas Signature", "Ore Anomaly", "Combat Anomaly"]);

function metricFromRow(row: string[], label: string) {
  const index = row.findIndex((value) => String(value).trim().toLowerCase() === label.toLowerCase());
  return index >= 0 ? nullableNumeric(row[index + 1]) : null;
}

function parseSleeper(row: string[]): WormholePveSleeper | null {
  const qty = numeric(row[2]);
  const name = String(row[3] ?? "").trim();
  if (!(qty > 0) || !name) return null;
  return {
    qty,
    name,
    hullClass: String(row[4] ?? "").trim(),
    trigger: String(row[1] ?? "").trim().includes("⚠"),
    scram: numeric(row[5]),
    web: numeric(row[6]),
    neutGjPerSec: Math.abs(numeric(row[7])),
    remoteRepHpPerSec: numeric(row[8]),
    effectRange: String(row[9] ?? "").trim() || undefined,
    signatureRadius: String(row[10] ?? "").trim() || undefined,
    chaseSpeed: String(row[11] ?? "").trim() || undefined,
    orbitDistance: String(row[12] ?? "").trim() || undefined,
    orbitVelocity: String(row[13] ?? "").trim() || undefined,
    dps: numeric(row[14]),
    alpha: numeric(row[15]),
    range: String(row[16] ?? "").trim() || undefined,
    ehp: numeric(row[17]),
  };
}

function isSiteStart(rows: string[][], index: number) {
  const name = String(rows[index]?.[1] ?? "").trim();
  const category = String(rows[index + 1]?.[1] ?? "").trim();
  return Boolean(name && SITE_CATEGORIES.has(category));
}

function buildCombatSite(rows: string[][], start: number, end: number, classLabel: WormholePveSite["classLabel"], updatedAt?: string): WormholePveSite {
  const header = rows[start] ?? [];
  const categoryRow = rows[start + 1] ?? [];
  const name = String(header[1] ?? "").trim();
  const category = String(categoryRow[1] ?? "").trim();
  const waves: WormholePveWave[] = [];
  let current: WormholePveWave | null = null;
  for (let index = start + 2; index < end; index += 1) {
    const row = rows[index] ?? [];
    const waveMatch = String(row[1] ?? "").trim().match(/^Wave\s+(\d+)/i);
    if (waveMatch) {
      current = {
        label: `Wave ${waveMatch[1]}`,
        number: Number(waveMatch[1]),
        scram: numeric(row[5]),
        web: numeric(row[6]),
        neutGjPerSec: Math.abs(numeric(row[7])),
        remoteRepHpPerSec: numeric(row[8]),
        effectRange: String(row[9] ?? "").trim() || undefined,
        dps: numeric(row[14]),
        alpha: numeric(row[15]),
        range: String(row[16] ?? "").trim() || undefined,
        ehp: numeric(row[17]),
        sleepers: [],
      };
      waves.push(current);
      continue;
    }
    const sleeper = parseSleeper(row);
    if (sleeper && current) current.sleepers.push(sleeper);
  }
  const allSleepers = waves.flatMap((wave) => wave.sleepers);
  return {
    key: `${classLabel}:${name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    classLabel,
    name,
    category,
    blueLootIsk: metricFromRow(categoryRow, "Blue Loot"),
    resourceValueIsk: null,
    bestPossibleTime: String(header[16] ?? "").trim() || undefined,
    peakDps: Math.max(0, ...waves.map((wave) => wave.dps)),
    peakAlpha: Math.max(0, ...waves.map((wave) => wave.alpha)),
    peakNeutGjPerSec: Math.max(0, ...waves.map((wave) => wave.neutGjPerSec)),
    maxScrams: Math.max(0, ...waves.map((wave) => wave.scram), ...allSleepers.map((row) => row.scram * row.qty)),
    maxWebs: Math.max(0, ...waves.map((wave) => wave.web), ...allSleepers.map((row) => row.web * row.qty)),
    totalEhp: waves.reduce((sum, wave) => sum + wave.ehp, 0),
    waves,
    resources: [],
    source: "PhobiaCide's Versioned Rykki Guide",
    sourceSheet: classLabel,
    sourceUpdatedAt: updatedAt,
  };
}

function resourceHeaderIndex(rows: string[][], start: number, end: number, resourceKind: "Gas" | "Ore") {
  for (let index = start; index < end; index += 1) if (String(rows[index]?.[1] ?? "").trim() === resourceKind) return index;
  return -1;
}

function buildResourceSite(rows: string[][], start: number, end: number, classLabel: "Gas" | "Ore", updatedAt?: string): WormholePveSite {
  const header = rows[start] ?? [];
  const categoryRow = rows[start + 1] ?? [];
  const name = String(header[1] ?? "").trim();
  const category = String(categoryRow[1] ?? "").trim();
  const waves: WormholePveWave[] = [];
  const defenderIndex = rows.findIndex((row, index) => index >= start && index < end && String(row[1] ?? "").trim() === "Defenders");
  if (defenderIndex >= start) {
    const row = rows[defenderIndex];
    const sleepers: WormholePveSleeper[] = [];
    for (let index = defenderIndex + 1; index < end; index += 1) {
      if (String(rows[index]?.[1] ?? "").trim() === classLabel) break;
      const sleeper = parseSleeper(rows[index] ?? []);
      if (sleeper) sleepers.push(sleeper);
    }
    waves.push({
      label: "Defenders",
      number: 1,
      scram: numeric(row[5]),
      web: numeric(row[6]),
      neutGjPerSec: Math.abs(numeric(row[7])),
      remoteRepHpPerSec: numeric(row[8]),
      effectRange: String(row[9] ?? "").trim() || undefined,
      dps: numeric(row[14]),
      alpha: numeric(row[15]),
      range: String(row[16] ?? "").trim() || undefined,
      ehp: numeric(row[17]),
      sleepers,
    });
  }
  const resources: WormholePveResource[] = [];
  const resourceStart = resourceHeaderIndex(rows, start, end, classLabel);
  if (resourceStart >= 0) {
    for (let index = resourceStart + 1; index < end; index += 1) {
      const row = rows[index] ?? [];
      const nameCell = String(row[4] ?? "").trim();
      if (!nameCell || /^Totals?:$/i.test(String(row[3] ?? "").trim())) continue;
      const quantity = numeric(row[3]);
      if (!(quantity > 0)) continue;
      resources.push({
        name: nameCell,
        quantity,
        volumeM3: nullableNumeric(row[classLabel === "Gas" ? 8 : 7]),
        cycles: nullableNumeric(row[classLabel === "Gas" ? 11 : 10]),
        iskPerM3: nullableNumeric(row[classLabel === "Gas" ? 14 : 12]),
        totalIsk: nullableNumeric(row[classLabel === "Gas" ? 16 : 14]),
      });
    }
  }
  const defender = waves[0];
  return {
    key: `${classLabel}:${name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    classLabel,
    name,
    category,
    blueLootIsk: metricFromRow(categoryRow, "Blue Loot") ?? metricFromRow(rows[start + 3] ?? [], "Blue Loot"),
    resourceValueIsk: metricFromRow(rows[start + 2] ?? [], `${classLabel} Value`),
    bestPossibleTime: String(header[16] ?? "").trim() || undefined,
    miningTime: String(categoryRow[16] ?? "").trim() || undefined,
    peakDps: defender?.dps ?? 0,
    peakAlpha: defender?.alpha ?? 0,
    peakNeutGjPerSec: defender?.neutGjPerSec ?? 0,
    maxScrams: defender?.scram ?? 0,
    maxWebs: defender?.web ?? 0,
    totalEhp: defender?.ehp ?? 0,
    waves,
    resources,
    source: "PhobiaCide's Versioned Rykki Guide",
    sourceSheet: classLabel,
    sourceUpdatedAt: updatedAt,
  };
}

function parseSheet(label: WormholePveSite["classLabel"], kind: "combat" | "resource", text: string) {
  const rows = parseCsv(text);
  const updatedAt = parseSheetUpdatedAt(rows);
  const starts = rows.flatMap((_, index) => isSiteStart(rows, index) ? [index] : []);
  const sites = starts.map((start, position) => {
    const end = starts[position + 1] ?? rows.length;
    return kind === "combat"
      ? buildCombatSite(rows, start, end, label, updatedAt)
      : buildResourceSite(rows, start, end, label as "Gas" | "Ore", updatedAt);
  });
  return { sites, updatedAt };
}

async function fetchSheet(sheet: typeof SHEETS[number]) {
  const response = await fetch(`${BASE_URL}${sheet.gid}`, { headers: { Accept: "text/csv", "User-Agent": "New-Eden-Sage/1.1 wormhole-site-reference" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${sheet.label}: HTTP ${response.status}`);
  const text = await response.text();
  if (!text.trim()) throw new Error(`${sheet.label}: empty sheet`);
  return parseSheet(sheet.label, sheet.kind, text);
}

export async function getWormholeSiteReference(force = false): Promise<WormholePveReferenceSnapshot> {
  const now = Date.now();
  if (!force && cache && now - cache.fetchedAtMs < CACHE_TTL_MS) return cache.snapshot;
  const settled = await Promise.allSettled(SHEETS.map((sheet) => fetchSheet(sheet)));
  const sites: WormholePveSite[] = [];
  const sheetUpdatedAt: Record<string, string | undefined> = {};
  const errors: string[] = [];
  settled.forEach((result, index) => {
    const sheet = SHEETS[index];
    if (result.status === "fulfilled") { sites.push(...result.value.sites); sheetUpdatedAt[sheet.label] = result.value.updatedAt; }
    else errors.push(result.reason instanceof Error ? result.reason.message : `${sheet.label}: ${String(result.reason)}`);
  });
  if (errors.length && cache && now - cache.fetchedAtMs <= STALE_FALLBACK_MS) {
    return { ...cache.snapshot, stale: true, errors: [...new Set([...cache.snapshot.errors, ...errors])] };
  }
  const snapshot: WormholePveReferenceSnapshot = {
    source: "PhobiaCide's Versioned Rykki Guide",
    sourceUrl: `https://docs.google.com/spreadsheets/d/e/${SHEET_ID}/pubhtml`,
    fetchedAt: new Date().toISOString(),
    stale: errors.length > 0,
    sites: sites.sort((a, b) => a.classLabel.localeCompare(b.classLabel) || a.name.localeCompare(b.name)),
    sheetUpdatedAt,
    errors,
  };
  if (sites.length && errors.length === 0) cache = { fetchedAtMs: now, snapshot };
  return snapshot;
}
