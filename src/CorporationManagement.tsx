import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { KillmailReader } from "./KillmailReader";

type SystemHit = { systemId: number; name: string; regionName: string; constellationName: string; securityStatus: number };
type Intel = any;
type Watched = { systemId: number; name: string };
type CorpSection = "system-news" | "overview" | "members" | "structures";
type KillmailStatus = {
  cooldownMs?: number;
  lookbackSeconds?: number;
  backfillDays?: number;
  lastRequestAt?: string | null;
  lastCycleRequestedAt?: string | null;
  nextRequestAt?: string | null;
  remainingMs?: number;
  queuedBackfills?: number;
  backfillSystems?: number;
  queuedRegions?: number;
  queuedSystems?: number;
  inFlight?: boolean;
  lastRegionId?: number | null;
  lastError?: string | null;
  cycleAccepted?: boolean;
};

type CorpRecord = {
  corporationId: number;
  name: string;
  snapshot: any;
  publicData: any;
  data: any;
};

const STORAGE_KEY = "new-eden-sage-watched-systems";
type KillmailWindowKey = "1h" | "24h" | "7d" | "30d";
const KILLMAIL_WINDOW_MS: Record<KillmailWindowKey, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

function loadWatched(): Watched[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function number(value: number) {
  return new Intl.NumberFormat("en-GB").format(Number(value ?? 0));
}

function duration(value?: number) {
  const seconds = Math.max(0, Math.ceil(Number(value ?? 0) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatDate(value: unknown, includeTime = true) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return "—";
  return includeTime ? date.toLocaleString() : date.toLocaleDateString();
}

function formatPercent(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(numeric * 100 % 1 ? 1 : 0)}%` : "—";
}

function formatCorporationTax(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  const percent = numeric > 1 ? numeric : numeric * 100;
  return percent.toFixed(percent % 1 ? 1 : 0) + "%";
}

function asArray(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function decodeCorporationDescription(value: unknown) {
  if (value == null || value === "") return "No corporation description returned by ESI.";
  let text = String(value).trim();
  if ((text.startsWith("u\"") && text.endsWith("\"")) || (text.startsWith("u'") && text.endsWith("'"))) text = text.slice(2, -1);
  text = text
    .replace(/\\U([0-9a-fA-F]{8})/g, (_match, hex) => { try { return String.fromCodePoint(Number.parseInt(hex, 16)); } catch { return ""; } })
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\n/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  if (typeof document !== "undefined") {
    const decoder = document.createElement("textarea");
    decoder.innerHTML = text;
    text = decoder.value;
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function unavailable(value: any) {
  return Boolean(value && typeof value === "object" && value.unavailable);
}

function unavailableText(value: any, fallback: string) {
  if (!unavailable(value)) return fallback;
  if (Number(value.status) === 403) return "This connected character does not currently have the required corporation role/scope. Reconnect a CEO/Director character to grant Sage the current corporation membership scopes.";
  return `ESI did not return this corporation dataset${value.status ? ` (HTTP ${value.status})` : ""}.`;
}

function assetUrl(typeId: number, variation: "icon" | "render" = "icon", size = 64) {
  return typeId > 0 ? `sage-asset://type/${typeId}/${variation}?size=${size}` : "";
}

function refreshMessage(status: KillmailStatus | undefined, systems: number) {
  if (!status) return `Refreshed ${systems} watched system${systems === 1 ? "" : "s"}.`;
  if (status.lastError) return `ESI refreshed. Killmail cache kept safely; last zKillboard request reported: ${status.lastError}`;
  const backfillSystems = status.backfillSystems ?? status.queuedSystems ?? 0;
  if ((status.queuedBackfills ?? 0) > 0) return `ESI refreshed for ${systems} system${systems === 1 ? "" : "s"}. 30-day kill history is backfilling for ${backfillSystems} watched system${backfillSystems === 1 ? "" : "s"}; Sage still makes only one zKillboard request every five minutes.`;
  if (status.cycleAccepted === false) return `ESI refreshed for ${systems} system${systems === 1 ? "" : "s"}. Killmails stayed cached - the five-minute zKillboard courtesy cooldown has ${duration(status.remainingMs)} remaining.`;
  if ((status.queuedRegions ?? 0) > 0) return `ESI refreshed for ${systems} system${systems === 1 ? "" : "s"}. Recent killmail refresh queued across ${status.queuedRegions} remaining region${status.queuedRegions === 1 ? "" : "s"}; Sage will make only one zKillboard request every five minutes.`;
  return `ESI and killmail intelligence refreshed for ${systems} watched system${systems === 1 ? "" : "s"}.`;
}

function useResolvedNames(ids: number[]) {
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const key = useMemo(() => [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b).join(","), [ids]);
  useEffect(() => {
    let cancelled = false;
    const unique = key ? key.split(",").map(Number) : [];
    if (!unique.length || typeof (window.sage as any).resolveTypeIds !== "function") {
      setNames(new Map());
      return;
    }
    void (async () => {
      const resolved: Array<{ id: number; name: string }> = [];
      for (let index = 0; index < unique.length; index += 900) {
        const batch = await (window.sage as any).resolveTypeIds(unique.slice(index, index + 900));
        if (Array.isArray(batch)) resolved.push(...batch);
      }
      if (!cancelled) setNames(new Map(resolved.map((item) => [Number(item.id), String(item.name)])));
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [key]);
  return names;
}

export function CorporationManagement() {
  const [section, setSection] = useState<CorpSection>("system-news");
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [corpId, setCorpId] = useState<number | null>(null);

  async function reloadSnapshots() {
    try {
      const values = await (window.sage as any).listSnapshots();
      setSnapshots(Array.isArray(values) ? values : []);
    } catch {
      setSnapshots([]);
    }
  }

  useEffect(() => { void reloadSnapshots(); }, []);

  const corporations = useMemo<CorpRecord[]>(() => {
    const newest = new Map<number, any>();
    for (const snapshot of snapshots) {
      const id = Number(snapshot?.character?.corporation_id ?? 0);
      if (!id) continue;
      const previous = newest.get(id);
      if (!previous || Date.parse(snapshot?.updatedAt ?? "") > Date.parse(previous?.updatedAt ?? "")) newest.set(id, snapshot);
    }
    return [...newest.entries()].map(([corporationId, snapshot]) => {
      const data = snapshot?.extended?.corporation ?? {};
      const publicData = data.publicData ?? snapshot?.character?.corporation_data ?? {};
      return {
        corporationId,
        name: String(publicData?.name ?? snapshot?.character?.corporation_name ?? `Corporation ${corporationId}`),
        snapshot,
        publicData,
        data,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [snapshots]);

  useEffect(() => {
    if (!corporations.length) { setCorpId(null); return; }
    if (!corpId || !corporations.some((corp) => corp.corporationId === corpId)) setCorpId(corporations[0].corporationId);
  }, [corporations, corpId]);

  const corporation = corporations.find((item) => item.corporationId === corpId) ?? corporations[0] ?? null;

  return <section className="corp-command">
    <div className="corp-subtabs">
      <button className={section === "system-news" ? "active" : ""} onClick={() => setSection("system-news")}>System News</button>
      <button className={section === "overview" ? "active" : ""} onClick={() => setSection("overview")}>Overview</button>
      <button className={section === "members" ? "active" : ""} onClick={() => setSection("members")}>Members</button>
      <button className={section === "structures" ? "active" : ""} onClick={() => setSection("structures")}>Structures</button>
    </div>

    {section === "system-news" ? <SystemNews /> : <>
      <div className="corp-data-head">
        <div>
          <p className="eyebrow">CORPORATION · MANAGEMENT</p>
          <h2>{corporation?.name ?? "Corporation data"}</h2>
          <p>{corporation ? `Synced through ${corporation.snapshot?.character?.name ?? "connected character"} · ${formatDate(corporation.snapshot?.updatedAt)}` : "Connect and sync an EVE character to populate corporation management."}</p>
        </div>
        <div className="corp-data-actions">
          {corporations.length > 1 && <select value={corpId ?? ""} onChange={(event) => setCorpId(Number(event.target.value))}>
            {corporations.map((corp) => <option key={corp.corporationId} value={corp.corporationId}>{corp.name}</option>)}
          </select>}
          <button onClick={() => void reloadSnapshots()}>Reload local data</button>
        </div>
      </div>
      {!corporation ? <div className="system-empty">No synced corporation snapshot is available yet.</div> : section === "overview"
        ? <CorporationOverview corporation={corporation} />
        : section === "members"
          ? <CorporationMembers corporation={corporation} snapshots={snapshots} />
          : <CorporationStructures corporation={corporation} />}
    </>}
  </section>;
}

function CorporationOverview({ corporation }: { corporation: CorpRecord }) {
  const p = corporation.publicData ?? {};
  const d = corporation.data ?? {};
  const ids = [p.ceo_id, p.creator_id, p.alliance_id, p.home_station_id].map(Number).filter((id) => id > 0);
  const names = useResolvedNames(ids);
  const name = (id: unknown, fallback = "—") => Number(id ?? 0) > 0 ? names.get(Number(id)) ?? fallback : fallback;
  const structures = asArray(d.structures);
  const starbases = asArray(d.starbases);
  const assets = asArray(d.assets);
  const blueprints = asArray(d.blueprints);
  const jobs = asArray(d.industryJobs);
  const orders = asArray(d.marketOrders);
  const contracts = asArray(d.contracts);
  const wallets = asArray(d.wallets);

  return <div className="corp-data-view">
    <div className="corp-identity-card">
      <div className="corp-monogram">{String(p.ticker ?? corporation.name).slice(0, 4).toUpperCase()}</div>
      <div><p className="eyebrow">CORPORATION {corporation.corporationId}</p><h3>{corporation.name}</h3><strong>{p.ticker ? `[${p.ticker}]` : "Ticker unavailable"}</strong></div>
      <div className="corp-identity-stats"><span>Members <strong>{number(p.member_count ?? 0)}</strong></span><span>Tax <strong>{formatPercent(p.tax_rate)}</strong></span><span>War eligible <strong>{p.war_eligible == null ? "—" : p.war_eligible ? "Yes" : "No"}</strong></span></div>
    </div>

    <div className="corp-overview-grid">
      <Metric label="Members" value={number(p.member_count ?? 0)} detail="Public corporation count" />
      <Metric label="Structures" value={number(structures.length)} detail={`${starbases.length} legacy starbase${starbases.length === 1 ? "" : "s"}`} />
      <Metric label="Assets" value={number(assets.length)} detail="Corporation asset stacks visible to this token" />
      <Metric label="Blueprints" value={number(blueprints.length)} detail="Corporation blueprint records" />
      <Metric label="Industry jobs" value={number(jobs.length)} detail={`${jobs.filter((job) => !job.completed_date && !["delivered", "cancelled", "reverted"].includes(String(job.status))).length} currently active`} />
      <Metric label="Market orders" value={number(orders.length)} detail="Corporation orders currently captured" />
      <Metric label="Contracts" value={number(contracts.length)} detail="Corporation contract records" />
      <Metric label="Wallet divisions" value={number(wallets.length)} detail="Visible corporation wallet divisions" />
    </div>

    <div className="corp-detail-grid">
      <article><h4>Leadership</h4><CorpField label="CEO" value={name(p.ceo_id, p.ceo_id ? `Character ${p.ceo_id}` : "—")} /><CorpField label="Founder" value={name(p.creator_id, p.creator_id ? `Character ${p.creator_id}` : "—")} /><CorpField label="Alliance" value={name(p.alliance_id, p.alliance_id ? `Alliance ${p.alliance_id}` : "Independent")} /><CorpField label="Home station" value={name(p.home_station_id, p.home_station_id ? `Station ${p.home_station_id}` : "—")} /></article>
      <article><h4>Corporation profile</h4><CorpField label="Founded" value={formatDate(p.date_founded, false)} /><CorpField label="Shares" value={p.shares != null ? number(p.shares) : "—"} /><CorpField label="Ticker" value={String(p.ticker ?? "—")} /><CorpField label="URL" value={String(p.url ?? "—")} /></article>
      <article className="corp-description"><h4>Description</h4><p>{decodeCorporationDescription(p.description)}</p></article>
    </div>
  </div>;
}

function CorporationMembers({ corporation, snapshots }: { corporation: CorpRecord; snapshots: any[] }) {
  const [query, setQuery] = useState("");
  const d = corporation.data ?? {};
  const rawMembers = d.members;
  const members = asArray(rawMembers).map(Number).filter((id) => id > 0);
  const tracking = asArray(d.memberTracking);
  const titleRows = asArray(d.memberTitles);
  const titleDefinitions = asArray(d.titles);
  const connected = snapshots.filter((snapshot) => Number(snapshot?.character?.corporation_id) === corporation.corporationId);
  const connectedIds = connected.map((snapshot) => Number(snapshot.characterId)).filter((id) => id > 0);
  const memberIds = [...new Set([...members, ...connectedIds])];
  const trackingById = new Map(tracking.map((entry) => [Number(entry.character_id), entry]));
  const titleById = new Map(titleDefinitions.map((entry) => [Number(entry.title_id), String(entry.name ?? `Title ${entry.title_id}`)]));
  const memberTitles = new Map(titleRows.map((entry) => [Number(entry.character_id), asArray(entry.titles).map(Number)]));
  const extraIds = tracking.flatMap((entry) => [Number(entry.ship_type_id ?? 0), Number(entry.location_id ?? 0), Number(entry.base_id ?? 0)]).filter((id) => id > 0);
  const names = useResolvedNames([...memberIds, ...extraIds]);
  const displayName = (id: number, fallback: string) => names.get(id) ?? fallback;
  const rows = memberIds.map((id) => {
    const track = trackingById.get(id);
    const connectedSnapshot = connected.find((snapshot) => Number(snapshot.characterId) === id);
    const titles = (memberTitles.get(id) ?? []).map((titleId) => titleById.get(titleId) ?? `Title ${titleId}`);
    const name = displayName(id, connectedSnapshot?.character?.name ?? `Character ${id}`);
    return { id, name, track, connectedSnapshot, titles };
  }).filter((row) => {
    const needle = query.trim().toLowerCase();
    return !needle || row.name.toLowerCase().includes(needle) || row.titles.some((title) => title.toLowerCase().includes(needle));
  }).sort((a, b) => a.name.localeCompare(b.name));

  return <div className="corp-data-view">
    <div className="corp-members-toolbar">
      <div><p className="eyebrow">MEMBER ROSTER</p><h3>{members.length ? `${number(members.length)} ESI members` : `${number(rows.length)} visible members`}</h3><small>{tracking.length ? "Director member-tracking data is available." : unavailableText(d.memberTracking, "Member-tracking detail is not available for this token/role.")}</small></div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search members or titles…" />
    </div>

    {unavailable(rawMembers) && <div className="corp-data-warning">{unavailableText(rawMembers, "Member list unavailable.")}</div>}
    <div className="member-table">
      <div className="member-table-head"><span>Member</span><span>Titles / role</span><span>Last activity</span><span>Last known state</span></div>
      {rows.map((row) => {
        const track = row.track ?? {};
        const online = track.logon_date && (!track.logoff_date || Date.parse(track.logon_date) > Date.parse(track.logoff_date));
        const shipId = Number(track.ship_type_id ?? row.connectedSnapshot?.ship?.ship_type_id ?? 0);
        const locationId = Number(track.location_id ?? 0);
        return <div className="member-row" key={row.id}>
          <div className="member-identity"><div className={`member-status-dot ${online ? "online" : ""}`} /><div><strong>{row.name}</strong>{row.connectedSnapshot ? <span className="member-connected-badge">Sage connected</span> : <small>Character {row.id}</small>}</div></div>
          <div className="member-role"><strong>{row.titles.length ? row.titles.join(" · ") : "Member"}</strong><small>{track.start_date ? `Joined ${formatDate(track.start_date, false)}` : "No corporation titles recorded"}</small></div>
          <div className="member-activity"><strong>{track.logon_date ? formatDate(track.logon_date) : row.connectedSnapshot?.updatedAt ? formatDate(row.connectedSnapshot.updatedAt) : "—"}</strong><small>{track.logoff_date ? `Last logoff ${formatDate(track.logoff_date)}` : online ? "Currently online" : row.connectedSnapshot?.updatedAt ? "Last Sage sync · tracking unavailable" : "No tracking detail"}</small></div>
          <div className="member-state">{shipId > 0 && <img src={assetUrl(shipId, "icon", 48)} alt="" />}<div><strong>{shipId > 0 ? row.connectedSnapshot?.ship?.ship_type_name ?? displayName(shipId, `Type ${shipId}`) : "Ship unavailable"}</strong><small>{locationId > 0 ? displayName(locationId, `Location ${locationId}`) : row.connectedSnapshot?.location?.solar_system_name ?? "Location unavailable"}</small></div></div>
        </div>;
      })}
      {!rows.length && <div className="system-empty compact">No corporation members are currently visible in the local snapshot.</div>}
    </div>
  </div>;
}

function CorporationStructures({ corporation }: { corporation: CorpRecord }) {
  const d = corporation.data ?? {};
  const structures = asArray(d.structures);
  const starbases = asArray(d.starbases);
  const facilities = asArray(d.facilities);
  const ids = [...structures, ...starbases, ...facilities].flatMap((item) => [Number(item.type_id ?? 0), Number(item.system_id ?? item.solar_system_id ?? 0)]).filter((id) => id > 0);
  const names = useResolvedNames(ids);
  const resolve = (id: unknown, fallback: string) => Number(id ?? 0) > 0 ? names.get(Number(id)) ?? fallback : fallback;

  return <div className="corp-data-view">
    <div className="structure-summary">
      <Metric label="Upwell / corporation structures" value={number(structures.length)} detail={unavailable(d.structures) ? "Dataset unavailable" : "Corporation structures returned by ESI"} />
      <Metric label="Legacy starbases" value={number(starbases.length)} detail={unavailable(d.starbases) ? "Dataset unavailable" : "POS/starbase records"} />
      <Metric label="Industry facilities" value={number(facilities.length)} detail={unavailable(d.facilities) ? "Dataset unavailable" : "Corporation facilities"} />
      <Metric label="Services" value={number(structures.reduce((sum, item) => sum + asArray(item.services).length, 0))} detail="Structure service records" />
    </div>

    {unavailable(d.structures) && <div className="corp-data-warning">{unavailableText(d.structures, "Corporation structure list unavailable.")}</div>}
    <div className="structure-card-grid">
      {structures.map((item, index) => {
        const typeId = Number(item.type_id ?? 0);
        const systemId = Number(item.system_id ?? 0);
        const services = asArray(item.services);
        return <article className="structure-card" key={String(item.structure_id ?? index)}>
          <div className="structure-render">{typeId > 0 ? <img src={assetUrl(typeId, "render", 256)} alt="" /> : <span>?</span>}</div>
          <div className="structure-card-body">
            <p className="eyebrow">STRUCTURE {item.structure_id ?? ""}</p>
            <h3>{String(item.name ?? resolve(typeId, `Structure ${item.structure_id ?? ""}`))}</h3>
            <strong>{resolve(typeId, typeId ? `Type ${typeId}` : "Structure type unavailable")}</strong>
            <div className="structure-pills"><span>{resolve(systemId, systemId ? `System ${systemId}` : "System unavailable")}</span><span>{String(item.state ?? "state unavailable").replaceAll("_", " ")}</span></div>
            <div className="structure-details"><CorpField label="Fuel expires" value={formatDate(item.fuel_expires)} /><CorpField label="Unanchors" value={formatDate(item.unanchors_at)} /><CorpField label="State timer" value={formatDate(item.state_timer_end)} /><CorpField label="Reinforce hour" value={item.reinforce_hour != null ? `${item.reinforce_hour}:00` : "—"} /></div>
            <div className="structure-services"><span>SERVICES</span>{services.length ? services.map((service, serviceIndex) => <div key={`${service.name}-${serviceIndex}`}><strong>{String(service.name ?? "Service")}</strong><small>{String(service.state ?? "unknown")}</small></div>) : <p>No service detail returned.</p>}</div>
          </div>
        </article>;
      })}
      {!structures.length && !unavailable(d.structures) && <div className="system-empty">No corporation structures were returned for this corporation.</div>}
    </div>

    {(starbases.length > 0 || facilities.length > 0) && <div className="corp-detail-grid compact-grid">
      <article><h4>Legacy starbases</h4>{starbases.map((item, index) => <div className="intel-row" key={String(item.starbase_id ?? index)}><strong>{resolve(item.type_id, `Starbase ${item.starbase_id ?? ""}`)}</strong><span>{resolve(item.system_id, `System ${item.system_id ?? ""}`)}</span><small>{String(item.state ?? "State unavailable")}</small></div>)}</article>
      <article><h4>Industry facilities</h4>{facilities.map((item, index) => <div className="intel-row" key={String(item.facility_id ?? index)}><strong>{resolve(item.type_id, `Facility ${item.facility_id ?? ""}`)}</strong><span>{resolve(item.solar_system_id, `System ${item.solar_system_id ?? ""}`)}</span><small>Facility {item.facility_id ?? "—"}</small></div>)}</article>
    </div>}
  </div>;
}

function CorpField({ label, value }: { label: string; value: string }) {
  return <div className="corp-field"><span>{label}</span><strong>{value}</strong></div>;
}

function SystemNews() {
  const [watched, setWatched] = useState<Watched[]>(loadWatched);
  const [active, setActive] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SystemHit[]>([]);
  const [intel, setIntel] = useState<Record<number, Intel>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Add solar systems to begin building local intelligence history.");
  const [killmailStatus, setKillmailStatus] = useState<KillmailStatus | null>(null);
  const sage = window.sage as any;

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(watched)); }, [watched]);
  useEffect(() => { if (watched.length) void refreshSystems(watched.map((item) => item.systemId), false); }, []);
  useEffect(() => {
    if (typeof sage.onSystemKillmailsUpdated !== "function") return;
    return sage.onSystemKillmailsUpdated((payload: any) => {
      const status = payload?.status as KillmailStatus | undefined;
      if (status) setKillmailStatus(status);
      setIntel((current) => {
        const next = { ...current };
        for (const rawId of payload?.systemIds ?? []) {
          const systemId = Number(rawId);
          if (!next[systemId]) continue;
          const key = String(systemId);
          next[systemId] = {
            ...next[systemId],
            killmails: payload?.killmailsBySystem?.[key] ?? next[systemId].killmails,
            killmailRefresh: { ...next[systemId].killmailRefresh, lastUpdatedAt: payload?.updatedAtBySystem?.[key] ?? next[systemId].killmailRefresh?.lastUpdatedAt ?? null, queued: Boolean(payload?.queuedBySystem?.[key]), global: status ?? next[systemId].killmailRefresh?.global },
          };
        }
        return next;
      });
      if (status?.lastError) setMessage(`Killmail refresh warning: ${status.lastError}. Cached killmails were preserved.`);
      else if ((status?.queuedBackfills ?? 0) > 0) setMessage(`Killmail cache updated. 30-day history backfill has ${status?.queuedBackfills ?? 0} request${status?.queuedBackfills === 1 ? "" : "s"} queued for ${status?.backfillSystems ?? 0} system${status?.backfillSystems === 1 ? "" : "s"}.`);
      else if ((status?.queuedRegions ?? 0) > 0) setMessage(`Killmail cache updated. ${status?.queuedRegions ?? 0} recent region${status?.queuedRegions === 1 ? "" : "s"} remain in the five-minute courtesy queue.`);
      else setMessage("Killmail refresh queue complete. Watched-system kill history is up to date.");
    });
  }, []);

  async function search(event?: FormEvent) {
    event?.preventDefault();
    if (!query.trim()) { setHits([]); return; }
    try { setHits(await sage.searchSolarSystems(query.trim())); }
    catch (error) { setMessage(error instanceof Error ? error.message : "System search failed."); }
  }

  function addSystem(hit: SystemHit) {
    if (!watched.some((item) => item.systemId === hit.systemId)) setWatched((current) => [...current, { systemId: hit.systemId, name: hit.name }]);
    setActive(String(hit.systemId)); setQuery(""); setHits([]); void refreshSystems([hit.systemId], true);
  }

  function removeSystem(systemId: number) {
    setWatched((current) => current.filter((item) => item.systemId !== systemId));
    setIntel((current) => { const next = { ...current }; delete next[systemId]; return next; });
    if (active === String(systemId)) setActive("all");
  }

  async function refreshSystems(systemIds: number[], showStatus = true) {
    const unique = [...new Set(systemIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    if (!unique.length) return [];
    if (showStatus) setMessage(`Refreshing ${unique.length} watched system${unique.length === 1 ? "" : "s"}…`);
    try {
      const result = await sage.refreshWatchedSystemIntelligence(unique);
      const systems = Array.isArray(result?.systems) ? result.systems : [];
      setIntel((current) => { const next = { ...current }; for (const value of systems) next[Number(value.system.systemId)] = value; return next; });
      const status = result?.killmailRefresh as KillmailStatus | undefined;
      if (status) setKillmailStatus(status);
      if (showStatus) setMessage(refreshMessage(status, unique.length));
      return systems;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "System intelligence refresh failed.");
      return [];
    }
  }

  async function refreshAll(showStatus = true) {
    if (!watched.length) return;
    setBusy(true);
    try { await refreshSystems(watched.map((item) => item.systemId), showStatus); }
    finally { setBusy(false); }
  }

  const loaded = useMemo(() => watched.map((item) => intel[item.systemId]).filter(Boolean), [watched, intel]);
  const totals = loaded.reduce((sum, item) => ({ shipKills: sum.shipKills + item.current.shipKills, podKills: sum.podKills + item.current.podKills, npcKills: sum.npcKills + item.current.npcKills, jumps: sum.jumps + item.current.jumps }), { shipKills: 0, podKills: 0, npcKills: 0, jumps: 0 });
  const selected = active === "all" ? null : intel[Number(active)];

  return <>
    <div className="system-news-head">
      <div><p className="eyebrow">CORPORATION · SYSTEM INTELLIGENCE</p><h2>System News</h2><p>Watch as many solar systems as you need. Sage combines official static universe data, public ESI activity and evidence captured by your connected characters.</p></div>
      <div className="system-refresh-control"><button className="system-refresh-button" onClick={() => void refreshAll()} disabled={busy || !watched.length}>{busy ? "Refreshing..." : "Refresh watched systems"}</button><div className="system-refresh-meta">{killmailStatus && <small><strong>zKillboard</strong><span>1 request / 5 min{(killmailStatus.queuedBackfills ?? 0) > 0 ? ` · 30d backfill ${killmailStatus.queuedBackfills} request${killmailStatus.queuedBackfills === 1 ? "" : "s"} / ${killmailStatus.backfillSystems ?? 0} system${killmailStatus.backfillSystems === 1 ? "" : "s"}` : (killmailStatus.queuedRegions ?? 0) > 0 ? ` · ${killmailStatus.queuedRegions} recent region${killmailStatus.queuedRegions === 1 ? "" : "s"} queued` : ""}{(killmailStatus.remainingMs ?? 0) > 0 ? ` · next in ${duration(killmailStatus.remainingMs)}` : ""}</span></small>}<button type="button" className="zkillboard-love-link" onClick={() => void (window.sage as any).openZkillboard()}>Visit zKillboard · show some love ↗</button></div></div>
    </div>
    <form className="system-watch-search" onSubmit={search}><input value={query} onChange={(event) => { setQuery(event.target.value); if (!event.target.value) setHits([]); }} placeholder="Add a solar system…" /><button>Search</button></form>
    {hits.length > 0 && <div className="system-search-results">{hits.map((hit) => <button key={hit.systemId} type="button" onClick={() => addSystem(hit)}><strong>{hit.name}</strong><span>{hit.regionName} · {hit.constellationName} · {hit.securityStatus.toFixed(2)}</span></button>)}</div>}
    <div className="watched-tabs"><button className={active === "all" ? "active" : ""} onClick={() => setActive("all")}>All Watched</button>{watched.map((item) => <div className="watched-tab" key={item.systemId}><button className={active === String(item.systemId) ? "active" : ""} onClick={() => setActive(String(item.systemId))}>{item.name}</button><button className="remove" title={`Stop watching ${item.name}`} onClick={() => removeSystem(item.systemId)}>×</button></div>)}</div>
    {active === "all" ? <div className="system-overview"><div className="intel-metrics"><Metric label="Watched systems" value={String(watched.length)} detail={`${loaded.length} currently loaded`} /><Metric label="Ship / pod kills" value={`${number(totals.shipKills)} / ${number(totals.podKills)}`} detail="Last hour · Public ESI" /><Metric label="NPC kills" value={number(totals.npcKills)} detail="Last hour · Public ESI" /><Metric label="Jumps" value={number(totals.jumps)} detail="Last hour · Public ESI" /></div><div className="system-card-grid">{watched.map((item) => { const data = intel[item.systemId]; return <button className="system-summary-card" key={item.systemId} onClick={() => setActive(String(item.systemId))}><strong>{item.name}</strong>{data ? <><span>{data.system.regionName} · {data.system.securityStatus.toFixed(2)}</span><small>{number(data.current.shipKills)} ship kills · {number(data.current.npcKills)} NPC kills · {number(data.current.jumps)} jumps · {number(data.killmails?.length ?? 0)} cached killmails</small></> : <small>Refresh to load intelligence.</small>}</button>; })}</div>{!watched.length && <div className="system-empty">Search for a solar system above to create your first watched-system tab.</div>}</div> : selected ? <SystemDetail intel={selected} /> : <div className="system-empty">Loading system intelligence…</div>}
    <div className="system-status">{message}</div>
  </>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function LocalCorporations({ corporations }: { corporations: any[] }) {
  const values = asArray(corporations);
  const relatedIds = useMemo(() => values.flatMap((item) => [Number(item?.allianceId ?? 0), Number(item?.ceoId ?? 0), Number(item?.homeStationId ?? 0)]).filter((id) => id > 0), [corporations]);
  const names = useResolvedNames(relatedIds);
  if (!values.length) return <article><h4>Local Corporations</h4><p>No player corporation presence can currently be proven from Sage's available evidence yet. This intelligence improves automatically as Sage observes structures, connected pilots and new killmails in this system.</p></article>;
  return <article className="local-corporations-panel">
    <div className="local-corporations-title"><div><h4>Local Corporations</h4><small>{number(values.length)} corporation{values.length === 1 ? "" : "s"} observed from structures, connected pilots and cached killmail evidence. Sage keeps building this picture over time: newly observed corporations, pilots, structures and killmail activity are folded into the system intelligence automatically.</small></div></div>
    <div className="local-corporation-list">{values.map((item) => {
      const alliance = item.allianceId ? names.get(Number(item.allianceId)) ?? ("Alliance " + item.allianceId) : "Independent";
      const ceo = item.ceoId ? names.get(Number(item.ceoId)) ?? ("Character " + item.ceoId) : "—";
      const home = item.homeStationId ? names.get(Number(item.homeStationId)) ?? ("Station " + item.homeStationId) : "—";
      const accent = String(item?.palette?.main_color ?? "rgba(83,214,190,.55)");
      return <div className="local-corporation-card" key={item.corporationId} style={{ borderLeftColor: accent }}>
        <div className="local-corporation-head"><div><strong>{item.name}{item.ticker ? " [" + item.ticker + "]" : ""}</strong><span>{alliance}</span></div><div className="local-corporation-tags"><em className="confidence-tag">{number(item.confidencePercent ?? 0)}% {item.confidenceLabel ?? "confidence"}</em>{item.state && <em>{String(item.state).replaceAll("_", " ")}</em>}{item.type && <em>{String(item.type).replaceAll("_", " ")}</em>}{typeof item.warEligible === "boolean" && <em>{item.warEligible ? "War eligible" : "Not war eligible"}</em>}</div></div>
        <div className="local-corporation-facts">
          <span>Members<strong>{item.memberCount != null ? number(item.memberCount) : "—"}</strong></span>
          <span>ISK tax<strong>{formatCorporationTax(item.iskTaxRate)}</strong></span>
          <span>LP tax<strong>{formatCorporationTax(item.lpTaxRate)}</strong></span>
          <span>CEO<strong>{ceo}</strong></span>
          <span>Founded<strong>{item.dateFounded ? formatDate(item.dateFounded, false) : "—"}</strong></span>
          <span>Home<strong>{home}</strong></span>
        </div>
        <div className="local-corporation-confidence"><div><strong>Presence confidence</strong><span>{number(item.confidencePercent ?? 0)}%</span></div><i><b style={{ width: String(Math.max(0, Math.min(100, Number(item.confidencePercent ?? 0)))) + "%" }} /></i><small>Heuristic confidence that this corporation has meaningful presence/activity in this system; repeated independent observations raise it over time.</small></div>
        <div className="local-corporation-evidence"><strong>System evidence</strong><span>{item.evidence}</span>{item.firstSeenAt && <small>First observed {formatDate(item.firstSeenAt)}</small>}{item.lastSeenAt && <small>Last observed {formatDate(item.lastSeenAt)}</small>}{item.friendlyFire && <small>Friendly fire: {String(item.friendlyFire).replaceAll("_", " ")}</small>}</div>
      </div>;
    })}</div>
  </article>;
}

function SystemDetail({ intel }: { intel: Intel }) {
  const [killmail, setKillmail] = useState<any>(null);
  const [killmailWindow, setKillmailWindow] = useState<"all" | KillmailWindowKey>("all");
  const [killmailNames, setKillmailNames] = useState<Map<number, string>>(new Map());
  const killmailPanelRef = useRef<HTMLElement | null>(null);
  const killmailUpdated = intel.killmailRefresh?.lastUpdatedAt ? new Date(intel.killmailRefresh.lastUpdatedAt).toLocaleString() : "Not refreshed yet";
  useEffect(() => {
    let cancelled = false;
    const ids = asArray(intel.killmails).flatMap((item) => [Number(item?.victim?.character_id ?? 0), Number(item?.victim?.ship_type_id ?? 0)]).filter((id) => id > 0);
    const unique = [...new Set(ids)];
    if (!unique.length) { setKillmailNames(new Map()); return; }
    void (window.sage as any).resolveTypeIds(unique).then((rows: any[]) => { if (!cancelled && Array.isArray(rows)) setKillmailNames(new Map(rows.map((row) => [Number(row.id), String(row.name)]))); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [intel.killmails]);

  const cachedKillmails = asArray(intel.killmails);
  const filteredKillmails = killmailWindow === "all"
    ? cachedKillmails
    : cachedKillmails.filter((item) => {
        const time = Date.parse(String(item?.killmailTime ?? ""));
        return Number.isFinite(time) && time >= Date.now() - KILLMAIL_WINDOW_MS[killmailWindow];
      });
  function chooseKillmailWindow(key: KillmailWindowKey) {
    setKillmailWindow((current) => current === key ? "all" : key);
    setKillmail(null);
    requestAnimationFrame(() => killmailPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return <div className="system-detail">
    <div className="system-title"><div><p className="eyebrow">{intel.system.regionName} · {intel.system.constellationName}</p><h3>{intel.system.name}</h3></div><strong>{intel.system.securityStatus.toFixed(2)} · {intel.system.securityBand}</strong></div>
    <div className="intel-metrics"><Metric label="Ship kills" value={number(intel.current.shipKills)} detail="Last hour · Public ESI" /><Metric label="Pod kills" value={number(intel.current.podKills)} detail="Last hour · Public ESI" /><Metric label="NPC kills" value={number(intel.current.npcKills)} detail="Last hour · Public ESI" /><Metric label="Jumps" value={number(intel.current.jumps)} detail="Last hour · Public ESI" /></div>
    <div className="intel-window-grid">{(["1h", "24h", "7d", "30d"] as KillmailWindowKey[]).map((key) => {
      const value = intel.windows[key];
      const cutoff = Date.now() - KILLMAIL_WINDOW_MS[key];
      const killCount = cachedKillmails.filter((item) => Date.parse(String(item?.killmailTime ?? "")) >= cutoff).length;
      const activity = [
        { label: "Ships", first: value.first?.shipKills, last: value.last?.shipKills, delta: value.delta?.shipKills },
        { label: "NPC", first: value.first?.npcKills, last: value.last?.npcKills, delta: value.delta?.npcKills },
        { label: "Jumps", first: value.first?.jumps, last: value.last?.jumps, delta: value.delta?.jumps },
      ];
      return <button type="button" className={"intel-window-card " + (killmailWindow === key ? "active" : "")} key={key} onClick={() => chooseKillmailWindow(key)}>
        <div className="intel-window-topline">
          <div className="intel-window-period"><strong>{key}</strong><span>LOCAL HISTORY</span></div>
          <div className="intel-window-kill-count"><strong>{number(killCount)}</strong><span>killmail{killCount === 1 ? "" : "s"}</span></div>
        </div>
        <div className="intel-window-activity">
          {activity.map((item) => <div key={item.label} className="intel-window-stat">
            <span>{item.label}</span>
            <strong>{item.first == null || item.last == null ? "—" : item.first === item.last ? number(item.last) : number(item.first) + " → " + number(item.last)}</strong>
            <em className={item.delta == null ? "baseline" : item.delta > 0 ? "up" : item.delta < 0 ? "down" : "flat"}>
              {item.delta == null ? "baseline" : item.delta === 0 ? "no change" : (item.delta > 0 ? "+" : "") + number(item.delta)}
            </em>
          </div>)}
        </div>
        <div className="intel-window-footer"><span>{number(value.samples)} snapshot{value.samples === 1 ? "" : "s"}</span><span>View killmails →</span></div>
      </button>;
    })}</div>
    <div className="intel-columns"><article><h4>Known Structures</h4><p className="structure-discovery-note">Sage combines corporation records, authenticated accessible-structure search and an incremental scan of CCP's public structure index. Coverage improves as watched systems are refreshed.</p>{intel.knownStructures.length ? intel.knownStructures.map((item: any, index: number) => <div className="intel-row" key={String(item.structureId) + "-" + index}><strong>{item.name}</strong><span>{item.ownerName ?? "Owner unresolved"}</span><small>{item.source}</small></div>) : <p>No structures in this system are currently visible to Sage's authorized datasets.</p>}</article><LocalCorporations corporations={intel.localCorporations} /></div>
    <article className="killmail-panel" ref={killmailPanelRef}><div className="killmail-panel-title"><div><h4>{killmailWindow === "all" ? "Recent Killmails" : `${killmailWindow} Killmails`}</h4><p>zKillboard provides a 30-day per-system history backfill, then Sage keeps the same local archive topped up with recent discovery. Killmail IDs are enriched with full CCP ESI detail and retained without age-based pruning.{killmailWindow !== "all" ? " Click the active history card again to clear the time filter." : ""}</p></div><div><strong>{number(filteredKillmails.length)}</strong><small>{killmailWindow === "all" ? "All cached" : `Last ${killmailWindow}`} · Last refresh: {killmailUpdated}{intel.killmailRefresh?.queued ? " · queued" : ""}</small></div></div>{filteredKillmails.length ? filteredKillmails.map((item: any) => { const shipId = Number(item?.victim?.ship_type_id ?? 0); const victimId = Number(item?.victim?.character_id ?? 0); return <button key={item.killmailId} onClick={() => setKillmail(item)}><div className="killmail-list-identity">{shipId > 0 && <img src={assetUrl(shipId, "icon", 48)} alt="" />}<div><strong>{victimId > 0 ? killmailNames.get(victimId) ?? `Killmail ${item.killmailId}` : killmailNames.get(shipId) ?? `Killmail ${item.killmailId}`}</strong><small>{shipId > 0 ? killmailNames.get(shipId) ?? `Type ${shipId}` : `Killmail ${item.killmailId}`}</small></div></div><span>{item.killmailTime ? new Date(item.killmailTime).toLocaleString() : "Time unavailable"} · {item.totalValue ? `${new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(item.totalValue)} ISK · ` : ""}{item.source}</span></button>; }) : <div className="system-empty compact">No cached killmails fall inside this time period.</div>}</article>
    {killmail && <KillmailReader killmail={killmail} systemName={intel.system.name} onClose={() => setKillmail(null)} />}
  </div>;
}
