export type DoctrineFit = {
  id: string;
  fitName: string;
  hullName: string;
  hullTypeId: number;
  fit: any;
  addedAt: string;
};

export type DoctrineRecord = {
  id: string;
  slot: number;
  name: string;
  notes: string;
  fits: DoctrineFit[];
  updatedAt: string | null;
  publishedObjectId?: string;
  publishedVersion?: number;
  assignments?: Record<string, string>;
};

function safeSlot(value: unknown, fallback: number) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultName(slot: number) {
  return `Doctrine ${slot}`;
}

function recordIsMeaningful(value: any, fallbackSlot: number) {
  if (!value || typeof value !== "object") return false;
  const slot = safeSlot(value.slot, fallbackSlot);
  const name = String(value.name ?? "").trim();
  const notes = String(value.notes ?? "").trim();
  const fits = Array.isArray(value.fits) ? value.fits : [];
  const assignments = value.assignments && typeof value.assignments === "object" ? Object.keys(value.assignments) : [];
  return Boolean(
    fits.length
    || notes
    || assignments.length
    || value.publishedObjectId
    || value.publishedVersion
    || (name && name !== defaultName(slot)),
  );
}

export function createDoctrineRecord(slot: number, now = new Date().toISOString()): DoctrineRecord {
  const nextSlot = Math.max(1, Math.floor(Number(slot) || 1));
  return {
    id: `doctrine-${nextSlot}-${Date.now().toString(36)}`,
    slot: nextSlot,
    name: defaultName(nextSlot),
    notes: "",
    fits: [],
    updatedAt: now,
    assignments: {},
  };
}

export function migrateDoctrineRecords(raw: unknown, now = new Date().toISOString()): DoctrineRecord[] {
  const source = Array.isArray(raw) ? raw : [];
  const kept = source.flatMap((value, index) => {
    if (!recordIsMeaningful(value, index + 1)) return [];
    const slot = safeSlot(value?.slot, index + 1);
    const name = String(value?.name ?? "").trim() || defaultName(slot);
    return [{
      ...value,
      id: String(value?.id ?? `doctrine-${slot}-legacy`),
      slot,
      name,
      notes: String(value?.notes ?? ""),
      fits: Array.isArray(value?.fits) ? value.fits : [],
      updatedAt: value?.updatedAt == null ? null : String(value.updatedAt),
      assignments: value?.assignments && typeof value.assignments === "object" ? value.assignments : {},
    } as DoctrineRecord];
  });
  if (!kept.length) return [createDoctrineRecord(1, now)];
  kept.sort((a, b) => a.slot - b.slot || a.id.localeCompare(b.id));
  const seen = new Set<number>();
  let next = Math.max(0, ...kept.map((item) => item.slot)) + 1;
  return kept.map((item) => {
    if (!seen.has(item.slot)) {
      seen.add(item.slot);
      return item;
    }
    const slot = next++;
    seen.add(slot);
    return { ...item, slot };
  });
}

export function nextDoctrineSlot(records: DoctrineRecord[]) {
  return Math.max(0, ...records.map((item) => Number(item.slot) || 0)) + 1;
}

export function appendDoctrine(records: DoctrineRecord[], now = new Date().toISOString()) {
  const next = createDoctrineRecord(nextDoctrineSlot(records), now);
  return { records: [...records, next], created: next };
}

export function removeDoctrineById(records: DoctrineRecord[], id: string, now = new Date().toISOString()) {
  const remaining = records.filter((item) => item.id !== id);
  return remaining.length ? remaining : [createDoctrineRecord(1, now)];
}
