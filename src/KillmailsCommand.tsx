import { Fragment, useEffect, useMemo, useState } from "react";
import type { CharacterSnapshot } from "./types";
import { KillmailReader } from "./KillmailReader";
import { appendShoppingList, OPEN_SHOPPING_LIST_EVENT, OPEN_SHOPPING_LIST_PENDING_KEY, type ShoppingListAdd } from "./shopping-list";

type Side = "ours" | "others";
type CommandKillmail = {
  killmailId:number;
  killmailTime?:string;
  solarSystemId:number;
  victim?:any;
  attackers?:any[];
  source:string;
  sourceCharacters:string[];
};

function asArray(value:unknown):any[]{ return Array.isArray(value) ? value : []; }
function typeImage(typeId:number,size=64){ return typeId > 0 ? `sage-asset://type/${typeId}/icon?size=${size}` : ""; }
function compact(value:number){ return new Intl.NumberFormat("en-GB", { notation:"compact", maximumFractionDigits:1 }).format(value); }

function collectReplacementItems(items:any[], totals:Map<number,number>) {
  for (const item of items ?? []) {
    const typeId = Number(item?.item_type_id ?? 0);
    const quantity = Math.max(0, Number(item?.quantity_destroyed ?? 0)) + Math.max(0, Number(item?.quantity_dropped ?? 0));
    if (typeId > 0 && quantity > 0) totals.set(typeId, (totals.get(typeId) ?? 0) + quantity);
    if (Array.isArray(item?.items)) collectReplacementItems(item.items, totals);
  }
}

function normalizeKillmail(record:any, sourceCharacter:string):CommandKillmail|null {
  const detail = record?.detail ?? record;
  if (!detail || typeof detail !== "object" || detail.unavailable) return null;
  const killmailId = Number(detail.killmail_id ?? record?.killmail_id ?? detail.killmailId ?? 0);
  if (!killmailId) return null;
  return {
    killmailId,
    killmailTime: String(detail.killmail_time ?? detail.killmailTime ?? "") || undefined,
    solarSystemId: Number(detail.solar_system_id ?? detail.solarSystemId ?? 0),
    victim: detail.victim,
    attackers: asArray(detail.attackers),
    source: "Connected character ESI",
    sourceCharacters: [sourceCharacter],
  };
}

export function KillmailsCommand({ snapshots }: { snapshots: CharacterSnapshot[] }) {
  const [side,setSide] = useState<Side>("ours");
  const [selected,setSelected] = useState<CommandKillmail|null>(null);
  const [filter,setFilter] = useState("");
  const [names,setNames] = useState<Map<number,string>>(new Map());
  const [systems,setSystems] = useState<Map<number,string>>(new Map());
  const [exportStatus,setExportStatus] = useState("");
  const [exportBusy,setExportBusy] = useState(false);

  const connectedIds = useMemo(() => new Set(snapshots.map((snapshot) => Number(snapshot.characterId)).filter((id) => id > 0)), [snapshots]);
  const allKillmails = useMemo(() => {
    const byId = new Map<number, CommandKillmail>();
    for (const snapshot of snapshots) {
      for (const record of asArray(snapshot.extended?.killmailDetails)) {
        const item = normalizeKillmail(record, snapshot.character.name);
        if (!item) continue;
        const existing = byId.get(item.killmailId);
        if (existing) {
          for (const name of item.sourceCharacters) if (!existing.sourceCharacters.includes(name)) existing.sourceCharacters.push(name);
        } else byId.set(item.killmailId, item);
      }
    }
    return [...byId.values()].sort((a,b) => new Date(b.killmailTime ?? 0).getTime() - new Date(a.killmailTime ?? 0).getTime());
  }, [snapshots]);

  const ourDeaths = useMemo(() => allKillmails.filter((item) => connectedIds.has(Number(item.victim?.character_id ?? 0))), [allKillmails, connectedIds]);
  const otherDeaths = useMemo(() => allKillmails.filter((item) => !connectedIds.has(Number(item.victim?.character_id ?? 0))), [allKillmails, connectedIds]);

  useEffect(() => {
    let cancelled = false;
    const ids = new Set<number>();
    for (const item of allKillmails) {
      for (const value of [item.victim?.character_id, item.victim?.corporation_id, item.victim?.alliance_id, item.victim?.ship_type_id]) {
        const id = Number(value ?? 0); if (id > 0) ids.add(id);
      }
    }
    void (async () => {
      const resolved:Array<{id:number;name:string}> = [];
      const unique = [...ids];
      for (let index=0; index<unique.length; index+=900) {
        const batch = await window.sage.resolveTypeIds(unique.slice(index,index+900));
        if (Array.isArray(batch)) resolved.push(...batch);
      }
      if (!cancelled) setNames(new Map(resolved.map((item) => [Number(item.id), String(item.name)])));
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [allKillmails]);

  useEffect(() => {
    let cancelled = false;
    const ids = [...new Set(allKillmails.map((item) => item.solarSystemId).filter((id) => id > 0))];
    void Promise.all(ids.map(async (id) => {
      try { const system = await window.sage.getNavigationSystem(id); return [id, system?.name ?? `System ${id}`] as const; }
      catch { return [id, `System ${id}`] as const; }
    })).then((rows) => { if (!cancelled) setSystems(new Map(rows)); });
    return () => { cancelled = true; };
  }, [allKillmails]);

  const rows = side === "ours" ? ourDeaths : otherDeaths;
  const filtered = rows.filter((item) => {
    const victimId = Number(item.victim?.character_id ?? 0);
    const shipId = Number(item.victim?.ship_type_id ?? 0);
    const text = `${names.get(victimId) ?? ""} ${names.get(shipId) ?? ""} ${systems.get(item.solarSystemId) ?? ""} ${item.sourceCharacters.join(" ")} ${item.killmailId}`.toLowerCase();
    return text.includes(filter.trim().toLowerCase());
  });

  useEffect(() => {
    if (selected && !rows.some((item) => item.killmailId === selected.killmailId)) setSelected(null);
  }, [side, rows, selected]);

  async function exportLossToShoppingList(killmail:CommandKillmail) {
    const victim = killmail.victim ?? {};
    const totals = new Map<number,number>();
    const hullTypeId = Number(victim.ship_type_id ?? 0);
    if (hullTypeId > 0) totals.set(hullTypeId, 1);
    collectReplacementItems(asArray(victim.items), totals);
    if (!totals.size) throw new Error("This killmail has no reconstructable hull or fitting items.");

    const typeIds = [...totals.keys()];
    const resolved:Array<{id:number;name:string}> = [];
    for (let index=0; index<typeIds.length; index+=900) {
      const batch = await window.sage.resolveTypeIds(typeIds.slice(index,index+900));
      if (Array.isArray(batch)) resolved.push(...batch);
    }
    const typeNames = new Map(resolved.map((item) => [Number(item.id), String(item.name)]));
    const additions:ShoppingListAdd[] = typeIds.map((typeId) => ({ typeId, name:typeNames.get(typeId) ?? `Type ${typeId}`, quantity:totals.get(typeId) ?? 1 }));
    const victimName = names.get(Number(victim.character_id ?? 0)) ?? "connected character";
    const result = appendShoppingList(additions, `${victimName}'s complete loss from killmail #${killmail.killmailId} was added to Shopping List.`);
    sessionStorage.setItem(OPEN_SHOPPING_LIST_PENDING_KEY, "1");
    window.dispatchEvent(new CustomEvent(OPEN_SHOPPING_LIST_EVENT));
    setExportStatus(`Added ${result.addedLines} item lines (${result.addedUnits.toLocaleString()} units) from killmail #${killmail.killmailId}.`);
    return result;
  }

  async function runLossExport(killmail:CommandKillmail) {
    if (exportBusy) return;
    setExportBusy(true);
    setExportStatus("Adding the complete loss to Shopping List...");
    try {
      await exportLossToShoppingList(killmail);
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : "Could not add this loss to Shopping List.");
    } finally {
      setExportBusy(false);
    }
  }

  if (!snapshots.length) return <div className="market-no-results">Connect and sync a character to view personal killmail history.</div>;

  return <section className="killmails-command">
    <header className="killmails-command-head">
      <div><p className="eyebrow">CONNECTED COMBAT HISTORY</p><h3>Killmails</h3><p>Recent full ESI killmail details from every connected character, deduplicated into losses and other combat deaths.</p></div>
      <strong>{allKillmails.length.toLocaleString()} retained</strong>
    </header>

    <div className="killmails-command-subtabs" role="tablist" aria-label="Killmail categories">
      <button type="button" className={side === "ours" ? "active" : ""} onClick={() => setSide("ours")}><strong>Our Deaths</strong><span>{ourDeaths.length}</span></button>
      <button type="button" className={side === "others" ? "active" : ""} onClick={() => setSide("others")}><strong>Other Deaths</strong><span>{otherDeaths.length}</span></button>
    </div>

    <div className="killmails-command-summary">
      <article><span>Our deaths</span><strong>{ourDeaths.length}</strong><small>Victim is a connected character</small></article>
      <article><span>Other deaths</span><strong>{otherDeaths.length}</strong><small>Kills / assists from connected characters</small></article>
      <article><span>Connected pilots</span><strong>{snapshots.length}</strong><small>{snapshots.map((item) => item.character.name).join(" · ")}</small></article>
    </div>

    {exportStatus && <div className="killmails-export-status">{exportStatus}</div>}

    <div className="killmails-command-tools">
      <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter victim, hull, system or character..." />
      <span>{filtered.length} shown</span>
    </div>

    <div className="killmails-command-list">
      {filtered.map((item) => {
        const victimId = Number(item.victim?.character_id ?? 0);
        const shipId = Number(item.victim?.ship_type_id ?? 0);
        const damage = Number(item.victim?.damage_taken ?? 0);
        return <Fragment key={item.killmailId}>
          <button type="button" className={selected?.killmailId === item.killmailId ? "selected" : ""} onClick={() => setSelected((current) => current?.killmailId === item.killmailId ? null : item)}>
          <div className="killmails-command-identity">{shipId > 0 && <img src={typeImage(shipId,64)} alt="" />}<div><strong>{names.get(victimId) ?? (victimId ? `Character ${victimId}` : "Unknown victim")}</strong><small>{names.get(shipId) ?? (shipId ? `Type ${shipId}` : "Ship unavailable")}</small></div></div>
          <div><strong>{systems.get(item.solarSystemId) ?? `System ${item.solarSystemId}`}</strong><small>{item.killmailTime ? new Date(item.killmailTime).toLocaleString() : "Time unavailable"}</small></div>
          <div><strong>{damage ? compact(damage) : "-"}</strong><small>damage taken</small></div>
          <div><strong>#{item.killmailId}</strong><small>{item.sourceCharacters.join(" · ")}</small></div>
          </button>
          {selected?.killmailId === item.killmailId && <div className="killmails-command-reader inline">{side === "ours" && <div className="killmails-command-reader-actions"><button type="button" className="killmail-shopping-export" disabled={exportBusy} onClick={() => void runLossExport(item)}>{exportBusy ? "Adding loss..." : "Add entire loss to Shopping List"}</button><small>Hull + all fitted modules, rigs, subsystems, drones and recorded cargo from this loss.</small></div>}<KillmailReader killmail={item} systemName={systems.get(item.solarSystemId) ?? `System ${item.solarSystemId}`} onClose={() => setSelected(null)} /></div>}
        </Fragment>;
      })}
      {!filtered.length && <div className="market-no-results">{rows.length ? "No killmails match this filter." : side === "ours" ? "No connected-character deaths are present in the latest synced killmail history." : "No other combat deaths are present in the latest synced killmail history."}</div>}
    </div>
  </section>;
}
