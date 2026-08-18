import { useEffect, useMemo, useState } from "react";

type Killmail = {
  killmailId: number;
  killmailTime?: string;
  solarSystemId: number;
  victim?: any;
  attackers?: any[];
  source?: string;
  sourceCharacter?: string;
  totalValue?: number;
  points?: number;
  labels?: string[];
  solo?: boolean;
  npc?: boolean;
  awox?: boolean;
  locationId?: number;
};

type NameRecord = { id: number; name: string; category?: string };
type FlatItem = {
  typeId: number;
  destroyed: number;
  dropped: number;
  flag?: number;
  singleton?: number;
  depth: number;
};
type HullProfile = {
  slots: { high: number; mid: number; low: number; rig: number; subsystem: number };
  storage: { cargoM3: number; droneBayM3: number; droneBandwidth: number; fighterHangarM3: number; fighterTubes: number };
};
type RackName = "high" | "mid" | "low" | "rig" | "subsystem";

type SlotInfo = { rack: RackName; index: number };

const RACK_FLAGS: Record<RackName, { first: number; last: number; label: string }> = {
  high: { first: 27, last: 34, label: "HIGH" },
  mid: { first: 19, last: 26, label: "MID" },
  low: { first: 11, last: 18, label: "LOW" },
  rig: { first: 92, last: 94, label: "RIG" },
  subsystem: { first: 125, last: 128, label: "SUBSYSTEM" },
};

function typeImage(typeId: number, variation: "icon" | "render" = "icon", size = 64) {
  return typeId > 0 ? `sage-asset://type/${typeId}/${variation}?size=${size}` : "";
}

function formatIsk(value?: number) {
  if (!value || !Number.isFinite(value)) return "Value unavailable";
  return `${new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 2 }).format(value)} ISK`;
}

function formatNumber(value?: number) {
  return new Intl.NumberFormat("en-GB").format(Number(value ?? 0));
}

function collectItemIds(items: any[], target: Set<number>) {
  for (const item of items ?? []) {
    const typeId = Number(item?.item_type_id ?? 0);
    if (typeId > 0) target.add(typeId);
    if (Array.isArray(item?.items)) collectItemIds(item.items, target);
  }
}

function flattenItems(items: any[], depth = 0): FlatItem[] {
  const result: FlatItem[] = [];
  for (const item of items ?? []) {
    const typeId = Number(item?.item_type_id ?? 0);
    if (typeId > 0) {
      result.push({
        typeId,
        destroyed: Number(item?.quantity_destroyed ?? 0),
        dropped: Number(item?.quantity_dropped ?? 0),
        flag: Number.isFinite(Number(item?.flag)) ? Number(item.flag) : undefined,
        singleton: Number.isFinite(Number(item?.singleton)) ? Number(item.singleton) : undefined,
        depth,
      });
    }
    if (Array.isArray(item?.items)) result.push(...flattenItems(item.items, depth + 1));
  }
  return result;
}

function entityIds(killmail: Killmail) {
  const ids = new Set<number>();
  const victim = killmail.victim ?? {};
  for (const value of [victim.character_id, victim.corporation_id, victim.alliance_id, victim.faction_id, victim.ship_type_id]) {
    const id = Number(value ?? 0);
    if (id > 0) ids.add(id);
  }
  collectItemIds(Array.isArray(victim.items) ? victim.items : [], ids);
  for (const attacker of Array.isArray(killmail.attackers) ? killmail.attackers : []) {
    for (const value of [attacker?.character_id, attacker?.corporation_id, attacker?.alliance_id, attacker?.faction_id, attacker?.ship_type_id, attacker?.weapon_type_id]) {
      const id = Number(value ?? 0);
      if (id > 0) ids.add(id);
    }
  }
  return [...ids];
}

function slotInfo(flag?: number): SlotInfo | null {
  if (!Number.isFinite(flag)) return null;
  for (const rack of Object.keys(RACK_FLAGS) as RackName[]) {
    const range = RACK_FLAGS[rack];
    if (Number(flag) >= range.first && Number(flag) <= range.last) return { rack, index: Number(flag) - range.first };
  }
  return null;
}

function bayLabel(flag?: number) {
  if (flag === 5) return "Cargo";
  if (flag === 87) return "Drone bay";
  return "Other inventory";
}

function lossState(item: FlatItem) {
  if (item.destroyed > 0 && item.dropped > 0) return "mixed";
  return item.dropped > 0 ? "dropped" : "destroyed";
}

function totalQuantity(item: FlatItem) {
  return Math.max(1, item.destroyed + item.dropped);
}

export function KillmailReader({ killmail, systemName, onClose }: { killmail: Killmail; systemName: string; onClose: () => void }) {
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const [resolving, setResolving] = useState(false);
  const [profile, setProfile] = useState<HullProfile | null>(null);
  const sage = window.sage as any;

  const victim = killmail.victim ?? {};
  const victimShipId = Number(victim.ship_type_id ?? 0);

  useEffect(() => {
    let cancelled = false;
    const ids = entityIds(killmail);
    setNames(new Map());
    setProfile(null);
    setResolving(true);
    void (async () => {
      const resolved: NameRecord[] = [];
      if (ids.length && typeof sage.resolveTypeIds === "function") {
        for (let index = 0; index < ids.length; index += 900) {
          const batch = await sage.resolveTypeIds(ids.slice(index, index + 900));
          if (Array.isArray(batch)) resolved.push(...batch);
        }
      }
      let hullProfile: HullProfile | null = null;
      if (victimShipId > 0 && typeof sage.getHullFittingProfileLocal === "function") {
        try { hullProfile = await sage.getHullFittingProfileLocal(victimShipId); } catch { hullProfile = null; }
      }
      if (!cancelled) {
        setNames(new Map(resolved.map((item) => [Number(item.id), String(item.name)])));
        setProfile(hullProfile);
      }
    })()
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setResolving(false); });
    return () => { cancelled = true; };
  }, [killmail.killmailId, victimShipId]);

  const attackers = useMemo(
    () => [...(Array.isArray(killmail.attackers) ? killmail.attackers : [])].sort((a, b) =>
      Number(Boolean(b?.final_blow)) - Number(Boolean(a?.final_blow)) || Number(b?.damage_done ?? 0) - Number(a?.damage_done ?? 0),
    ),
    [killmail],
  );
  const items = useMemo(() => flattenItems(Array.isArray(victim.items) ? victim.items : []), [killmail]);
  const fitted = useMemo(() => items.filter((item) => slotInfo(item.flag)), [items]);
  const bayItems = useMemo(() => items.filter((item) => !slotInfo(item.flag)), [items]);
  const totalDamage = Math.max(1, Number(victim.damage_taken ?? attackers.reduce((sum, item) => sum + Number(item?.damage_done ?? 0), 0)));

  const label = (id: unknown, fallback: string) => {
    const numeric = Number(id ?? 0);
    return numeric > 0 ? names.get(numeric) ?? `${fallback} ${numeric}` : fallback;
  };
  const victimName = victim.character_id
    ? label(victim.character_id, "Character")
    : victim.corporation_id
      ? label(victim.corporation_id, "Corporation")
      : "Unknown victim";
  const badges = [
    killmail.solo ? "SOLO" : null,
    killmail.awox ? "AWOX" : null,
    killmail.npc ? "NPC" : null,
    killmail.labels?.some((item) => /gank/i.test(item)) ? "GANK" : null,
  ].filter(Boolean) as string[];

  const rackCount = (rack: RackName) => {
    const configured = Number(profile?.slots?.[rack] ?? 0);
    const used = fitted.reduce((max, item) => {
      const info = slotInfo(item.flag);
      return info?.rack === rack ? Math.max(max, info.index + 1) : max;
    }, 0);
    return Math.max(configured, used);
  };

  return <section className="killmail-reader">
    <header className="killmail-reader-head">
      <div className="killmail-victim-hero">
        <div className="killmail-ship-render">
          {victimShipId > 0 ? <img src={typeImage(victimShipId, "render", 512)} alt="" /> : <span>?</span>}
        </div>
        <div className="killmail-victim-copy">
          <p className="eyebrow">KILLMAIL {killmail.killmailId}</p>
          <h3>{victimName}</h3>
          <strong>{label(victim.ship_type_id, "Ship")}</strong>
          <p>
            {victim.corporation_id ? label(victim.corporation_id, "Corporation") : "Corporation unavailable"}
            {victim.alliance_id ? ` · ${label(victim.alliance_id, "Alliance")}` : ""}
          </p>
          <div className="killmail-badges">{badges.map((badge) => <span key={badge}>{badge}</span>)}</div>
        </div>
      </div>
      <button className="killmail-close" onClick={onClose}>Close reader</button>
    </header>

    <div className="killmail-facts">
      <article><span>Loss value</span><strong>{formatIsk(killmail.totalValue)}</strong><small>{killmail.points ? `${formatNumber(killmail.points)} zKill points` : "zKillboard estimate"}</small></article>
      <article><span>Damage taken</span><strong>{formatNumber(victim.damage_taken)}</strong><small>{attackers.length} attacker{attackers.length === 1 ? "" : "s"}</small></article>
      <article><span>Location</span><strong>{systemName}</strong><small>{killmail.locationId ? `Location ${killmail.locationId}` : `System ${killmail.solarSystemId}`}</small></article>
      <article><span>Time</span><strong>{killmail.killmailTime ? new Date(killmail.killmailTime).toLocaleString() : "Unavailable"}</strong><small>{killmail.source ?? "Public killmail"}</small></article>
    </div>

    {resolving && <div className="killmail-name-status">Resolving local fitting data and EVE names…</div>}

    <div className="killmail-workspace">
      <article className="loss-fit-panel">
        <div className="killmail-section-title">
          <div><h4>Destroyed fitting</h4><small>{profile ? `${label(victim.ship_type_id, "Hull")} slot profile` : "Slot layout reconstructed from ESI flags"}</small></div>
          <span>{fitted.length} fitted item{fitted.length === 1 ? "" : "s"}</span>
        </div>
        <div className="loss-fit-racks">
          {(["high", "mid", "low", "rig", "subsystem"] as RackName[]).map((rack) => {
            const count = rackCount(rack);
            if (!count) return null;
            const range = RACK_FLAGS[rack];
            return <div className={`loss-fit-rack ${rack}`} key={rack}>
              <span className="rack-label">{range.label}</span>
              <div className="loss-slot-row">
                {Array.from({ length: count }, (_, index) => {
                  const item = fitted.find((entry) => slotInfo(entry.flag)?.rack === rack && slotInfo(entry.flag)?.index === index);
                  return <div className={`loss-slot ${item ? lossState(item) : "empty"}`} key={index} title={item ? `${label(item.typeId, "Type")} · ${lossState(item)}` : `Empty ${rack} slot ${index + 1}`}>
                    {item ? <>
                      <img src={typeImage(item.typeId, "icon", 64)} alt="" />
                      <span className="loss-slot-name">{label(item.typeId, "Type")}</span>
                      {totalQuantity(item) > 1 && <b>×{formatNumber(totalQuantity(item))}</b>}
                      <i>{item.dropped > 0 ? "DROPPED" : "DESTROYED"}</i>
                    </> : <span className="slot-empty-mark">+</span>}
                  </div>;
                })}
              </div>
            </div>;
          })}
          {!fitted.length && <div className="system-empty compact">No fitted module detail was returned on this killmail.</div>}
        </div>

        <div className="loss-bay-title"><h4>Cargo / drone bay / other</h4><span>{bayItems.length}</span></div>
        <div className="loss-bay-grid">
          {bayItems.map((item, index) => <div className={`loss-bay-item ${lossState(item)}`} key={`${item.typeId}-${item.flag}-${index}`}>
            <img src={typeImage(item.typeId, "icon", 48)} alt="" />
            <div><strong>{label(item.typeId, "Type")}</strong><small>{bayLabel(item.flag)}{item.flag != null ? ` · flag ${item.flag}` : ""}</small></div>
            <div className="killmail-item-counts">
              {item.destroyed > 0 && <span className="destroyed">×{formatNumber(item.destroyed)} destroyed</span>}
              {item.dropped > 0 && <span className="dropped">×{formatNumber(item.dropped)} dropped</span>}
            </div>
          </div>)}
          {!bayItems.length && <p>No cargo, drones or other inventory was recorded.</p>}
        </div>
      </article>

      <article className="killmail-section attacker-panel">
        <div className="killmail-section-title"><div><h4>Attackers</h4><small>Final blow first, then damage dealt</small></div><span>{attackers.length}</span></div>
        <div className="killmail-attacker-list">
          {attackers.map((attacker, index) => {
            const shipId = Number(attacker?.ship_type_id ?? 0);
            const attackerName = attacker?.character_id
              ? label(attacker.character_id, "Character")
              : attacker?.corporation_id
                ? label(attacker.corporation_id, "Corporation")
                : "NPC / environment";
            const damage = Number(attacker?.damage_done ?? 0);
            const percent = Math.min(100, Math.max(0, damage / totalDamage * 100));
            return <div className={`killmail-attacker${attacker?.final_blow ? " final-blow" : ""}`} key={`${attacker?.character_id ?? attacker?.corporation_id ?? "npc"}-${index}`}>
              {shipId > 0 ? <img src={typeImage(shipId, "icon", 64)} alt="" /> : <div className="killmail-icon-placeholder" />}
              <div className="killmail-attacker-main">
                <div><strong>{attackerName}</strong>{attacker?.final_blow && <span className="final-blow-badge">FINAL BLOW</span>}</div>
                <span>{shipId ? label(shipId, "Ship") : "No ship recorded"}{attacker?.weapon_type_id ? ` · ${label(attacker.weapon_type_id, "Weapon")}` : ""}</span>
                <small>{attacker?.corporation_id && attacker?.character_id ? label(attacker.corporation_id, "Corporation") : ""}{attacker?.alliance_id ? ` · ${label(attacker.alliance_id, "Alliance")}` : ""}</small>
                <div className="attacker-damage-bar"><i style={{ width: `${percent}%` }} /></div>
              </div>
              <div className="killmail-attacker-damage"><strong>{formatNumber(damage)}</strong><span>{percent.toFixed(percent >= 10 ? 0 : 1)}%</span></div>
            </div>;
          })}
          {!attackers.length && <p>No attacker detail was returned with this killmail.</p>}
        </div>
      </article>
    </div>
  </section>;
}
