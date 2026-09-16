import type { CharacterSnapshot } from "./types";

export type CurrentEveFitItem = {
  name: string;
  typeId?: number;
  quantity: number;
  activeQuantity?: number;
};

export type CurrentEveFitDraft = {
  id: string;
  name: string;
  hull: CurrentEveFitItem;
  low: CurrentEveFitItem[];
  mid: CurrentEveFitItem[];
  high: CurrentEveFitItem[];
  rig: CurrentEveFitItem[];
  subsystem: CurrentEveFitItem[];
  drones: CurrentEveFitItem[];
  fighters: CurrentEveFitItem[];
  cargo: CurrentEveFitItem[];
  implants: CurrentEveFitItem[];
  boosters: CurrentEveFitItem[];
  instructions: string[];
  source: string;
};

function itemName(row: { item?: string; type_id: number }) {
  const value = String(row.item ?? "").trim();
  return value || `Type ${row.type_id}`;
}

function slotFor(flag: string): keyof Pick<CurrentEveFitDraft, "low"|"mid"|"high"|"rig"|"subsystem"|"drones"|"fighters"|"cargo"> | null {
  if (/^hislot\d+$/i.test(flag)) return "high";
  if (/^medslot\d+$/i.test(flag)) return "mid";
  if (/^loslot\d+$/i.test(flag)) return "low";
  if (/^rigslot\d+$/i.test(flag)) return "rig";
  if (/^subsystemslot\d+$/i.test(flag)) return "subsystem";
  if (/^dronebay$/i.test(flag)) return "drones";
  if (/^fighterbay$/i.test(flag) || /^fightertube\d+$/i.test(flag)) return "fighters";
  if (/^cargo$/i.test(flag)) return "cargo";
  return null;
}

export function currentEveFitFromSnapshot(snapshot: CharacterSnapshot, id = `eve-current-${snapshot.characterId}-${Date.now()}`): CurrentEveFitDraft {
  const shipTypeId = Number(snapshot.ship?.ship_type_id ?? 0);
  if (!shipTypeId) throw new Error("The selected character does not have a current EVE ship in the synced snapshot.");
  const rows = snapshot.extended?.currentShipFit;
  if (!Array.isArray(rows)) throw new Error("Current ship fitting assets are unavailable. Refresh the character's private data and try again.");

  const fit: CurrentEveFitDraft = {
    id,
    name: `${snapshot.ship.ship_name || snapshot.ship.ship_type_name || "Current ship"} - current EVE fit`,
    hull: { name: snapshot.ship.ship_type_name || `Type ${shipTypeId}`, typeId: shipTypeId, quantity: 1 },
    low: [], mid: [], high: [], rig: [], subsystem: [], drones: [], fighters: [], cargo: [], implants: [], boosters: [],
    instructions: ["Imported from the character's current EVE ship assets. Loaded charges and live module activation/overheat state are not exposed reliably by the asset endpoint and may need review."],
    source: "esi-current-ship",
  };

  for (const row of rows as Array<(typeof rows)[number] & { categoryName?: string }>) {
    if (Number(row.item_id) === Number(snapshot.ship.ship_item_id)) continue;
    const typeId = Number(row.type_id ?? 0);
    if (!typeId) continue;
    const category = String(row.categoryName ?? "").toLowerCase();
    const slot = category === "charge" ? "cargo" : category === "drone" ? "drones" : category === "fighter" ? "fighters" : slotFor(String(row.location_flag ?? ""));
    if (!slot) continue;
    const quantity = Math.max(1, Math.floor(Number(row.quantity ?? 1)));
    const entry: CurrentEveFitItem = { name: itemName(row), typeId, quantity };
    if (slot === "fighters" && /^fightertube\d+$/i.test(String(row.location_flag ?? ""))) entry.activeQuantity = quantity;
    fit[slot].push(entry);
  }

  return fit;
}
