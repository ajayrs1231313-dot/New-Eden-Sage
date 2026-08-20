import { FormEvent, memo, useEffect, useRef, useState } from "react";
import type {
  CharacterSnapshot,
  MarketItem,
  MarketSummary,
  PublicConfig,
  FitResolutionIntent,
  ClaudeCompatibilityStatus,
} from "./types";
import { FittingsWorkspace } from "./Fittings";
import { IskLab } from "./IskLab";
import { CommandIntelligence } from "./CommandIntelligence";
import { SkillsWorkspace } from "./SkillsWorkspace";
import { CapabilityCommandCenter } from "./CapabilityCommandCenter";
import { IndustrialCommand } from "./IndustrialCommand";
import { Loot } from "./Loot";
import { CorporationManagement } from "./CorporationManagement";
import { NavigationCommand } from "./NavigationCommand";

type View =
  | "overview"
  | "augments"
  | "skills"
  | "isk"
  | "market"
  | "regional"
  | "navigation"
  | "industrial"
  | "corporation"
  | "fittings"
  | "loot"
  | "settings";
type CloneState = "alpha" | "omega";
type SyncTrack = { id: string; label: string; percent: number; status: "waiting" | "running" | "done" | "error"; message: string };
type SyncProgress = { running: boolean; message: string; percent: number; completed?: number; total?: number; tracks?: SyncTrack[] };

const nav: Array<{ id: View; label: string; mark: string }> = [
  { id: "overview", label: "Command", mark: "\u2726" },
  { id: "augments", label: "Augments", mark: "\u25C8" },
  { id: "skills", label: "Progression", mark: "\u25B3" },
  { id: "isk", label: "ISK Lab", mark: "\u25C8" },
  { id: "market", label: "Market", mark: "\u25C6" },
  { id: "navigation", label: "Navigation Command", mark: "⌖" },
  { id: "fittings", label: "Fittings", mark: "\u2318" },
  { id: "loot", label: "Loot", mark: "\u2727" },
  { id: "industrial", label: "Industrial Command", mark: "\u2692" },
  { id: "corporation", label: "Corporation Management", mark: "\u25C9" },
  { id: "settings", label: "Settings", mark: "\u2699" },
];

const money = (value: number) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);

const RetainedSkillsWorkspace = memo(SkillsWorkspace);
const RetainedIskLab = memo(IskLab);
const RetainedFittingsWorkspace = memo(FittingsWorkspace, () => true);
const RetainedLoot = memo(Loot, () => true);
const RetainedIndustrialCommand = memo(IndustrialCommand, (a, b) => a.snapshots === b.snapshots && a.activeCharacterId === b.activeCharacterId);
const RetainedNavigationCommand = memo(NavigationCommand, () => true);

export default function App() {
  const [view, setView] = useState<View>("overview");
  useEffect(() => {
    const navigateToFittings = () => setView("fittings");
    const navigateToCorpDoctrines = () => setView("corporation");
    window.addEventListener("sage:navigate-fittings", navigateToFittings);
    window.addEventListener("sage:navigate-corp-doctrines", navigateToCorpDoctrines);
    return () => {
      window.removeEventListener("sage:navigate-fittings", navigateToFittings);
      window.removeEventListener("sage:navigate-corp-doctrines", navigateToCorpDoctrines);
    };
  }, []);
  const [marketDataRevision, setMarketDataRevision] = useState(0);
  const [plannerHullTypeId, setPlannerHullTypeId] = useState<number>();
  const [plannerFitIntent, setPlannerFitIntent] = useState<FitResolutionIntent>();
  const mountedViews = useRef(new Set<View>(["overview"]));
  mountedViews.current.add(view);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [snapshots, setSnapshots] = useState<CharacterSnapshot[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Local systems ready");
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [initialSetupComplete, setInitialSetupComplete] = useState(true);
  const [cloneStates, setCloneStates] = useState<Record<string, CloneState>>(
    () => {
      try {
        return JSON.parse(localStorage.getItem("new-eden-sage-clone-states") ?? "{}");
      } catch {
        return {};
      }
    },
  );
  const [resolvedTypeNames, setResolvedTypeNames] = useState<Record<number, string>>({});

  useEffect(() => {
    Promise.all([window.sage.getConfig(), window.sage.listSnapshots()]).then(
      ([nextConfig, nextSnapshots]) => {
        setConfig(nextConfig);
        setSnapshots(nextSnapshots);
        setActiveId(nextSnapshots[0]?.characterId ?? "");
        setInitialSetupComplete(nextSnapshots.length > 0);
      },
    );
  }, []);

  useEffect(() => {
    const ids = snapshots.flatMap((snapshot) =>
      Array.isArray(snapshot.extended?.implants)
        ? snapshot.extended.implants
            .map((implant) => typeof implant === "number" ? implant : implant.typeId)
            .filter((id) => !resolvedTypeNames[id])
        : [],
    );
    if (!ids.length) return;
    window.sage.resolveTypeIds(ids).then((resolved) => {
      setResolvedTypeNames((current) => ({
        ...current,
        ...Object.fromEntries(resolved.map((item) => [item.id, item.name])),
      }));
    }).catch(() => undefined);
  }, [snapshots]);


  async function connect() {
    setBusy(true);
    setMessage("Waiting for EVE authorization\u2026");
    try {
      const result = await window.sage.loginWithEve();
      setSnapshots((current) => [
        ...current.filter((item) => item.characterId !== result.characterId),
        result.snapshot,
      ]);
      setActiveId(result.characterId);
      setConfig(await window.sage.getConfig());
      setView("overview");
      setMessage(result.onlineIdentityError
        ? `${result.characterName} connected locally · Sage Online: ${result.onlineIdentityError}`
        : result.becamePrimaryIdentity
          ? `${result.characterName} connected · Sage Account ID ${result.sageAccountId} created`
          : `${result.characterName} connected · linked to Sage Account ${result.sageAccountId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "EVE login failed");
    } finally {
      setBusy(false);
    }
  }

  async function syncAll() {
    setBusy(true);
    setMessage("Syncing and preparing all Sage intelligence\u2026");
    try {
      const result = await window.sage.runMasterUpdate({ cloneStates }) as { alreadySynced?: boolean; preparationFailures?: unknown[] } | undefined;
      if (result?.alreadySynced) {
        setInitialSetupComplete(true);
        setMessage("Sage is already current. Sync All will be available again in a few seconds.");
        return;
      }
      const nextSnapshots = await window.sage.listSnapshots();
      setSnapshots(nextSnapshots);
      setActiveId((current) => nextSnapshots.some((item) => item.characterId === current) ? current : nextSnapshots[0]?.characterId ?? "");
      setMarketDataRevision((value) => value + 1);
      setMessage(result?.preparationFailures?.length ? "Update finished with preparation warnings. The affected bars show what needs retrying." : "Everything is synced and prepared.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Character sync failed",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => window.sage.onMasterUpdateProgress((progress) => {
    setSyncProgress(progress);
    if (progress.running) {
      setBusy(true);
      setMessage(progress.message);
    } else {
      setBusy(false);
      setMessage(progress.message);
      setInitialSetupComplete(true);
      void window.sage.listSnapshots().then(setSnapshots);
      setMarketDataRevision((value) => value + 1);
    }
  }), []);

  async function removeCharacter(characterId: string) {
    const remaining = await window.sage.removeCharacter(characterId);
    setSnapshots(remaining);
    setActiveId(remaining[0]?.characterId ?? "");
    setMessage("Character removed from this PC");
  }

  function selectCharacter(characterId: string) {
    setActiveId(characterId);
    const character = snapshots.find((snapshot) => snapshot.characterId === characterId);
    const savedState = cloneStates[characterId];
    setMessage(
      savedState
        ? (character?.character.name ?? "Character") + ": " + (savedState === "omega" ? "Omega" : "Alpha") + " training speed active"
        : "Confirm Alpha or Omega clone state for accurate training times",
    );
  }

  function confirmCloneState(characterId: string, state: CloneState) {
    const character = snapshots.find((snapshot) => snapshot.characterId === characterId);
    if (!character) return;
    setActiveId(characterId);
    const next = { ...cloneStates, [characterId]: state };
    setCloneStates(next);
    localStorage.setItem("new-eden-sage-clone-states", JSON.stringify(next));
    setMessage(`${character.character.name}: ${state === "omega" ? "Omega" : "Alpha"} training speed selected`);
  }

  if (!config) return <div className="boot">Waking New Eden Sage…</div>;
  const active =
    snapshots.find((item) => item.characterId === activeId) ?? snapshots[0];
  const cloneConfirmationRequired = Boolean(
    active && !cloneStates[active.characterId],
  );

  return (
    <div className="app-shell">
      {(!initialSetupComplete || syncProgress?.running) && (
        <div className="sync-overlay" role="status" aria-live="polite">
          <div className="sync-dialog">
            <span className="pulse" />
            <p className="eyebrow">SETTING UP NEW EDEN SAGE</p>
            <h2>{syncProgress?.running ? "Syncing your live intelligence" : "Add your EVE characters"}</h2>
            <p>{syncProgress?.running ? syncProgress.message : "Add the EVE characters you want Sage to track, then begin one complete sync."}</p>
            {!syncProgress?.running && !config.primaryCharacterId && (
              <div className="sync-identity-note">
                <strong>Choose your main character first</strong>
                <span>The first character you add becomes your main New Eden Sage account identity. Sage keys that account to the character's permanent EVE Character ID. Every character you add afterwards is linked to that Sage account.</span>
              </div>
            )}
            {syncProgress?.running ? (
              <>
                <div className="sync-overall-row"><span>Overall preparation</span><strong>{Math.round(syncProgress.percent)}%</strong></div>
                <div className="sync-progress-track sync-progress-overall"><i style={{ width: `${Math.max(2, syncProgress.percent)}%` }} /></div>
                {syncProgress.tracks?.length ? <div className="sync-track-grid">
                  {syncProgress.tracks.map((track) => <div className={`sync-track-card ${track.status}`} key={track.id} title={track.message}>
                    <div className="sync-track-head"><span>{track.label}</span><strong>{track.status === "done" ? "Ready" : track.status === "error" ? "Retry" : track.status === "waiting" ? "Waiting" : `${Math.round(track.percent)}%`}</strong></div>
                    <div className="sync-track-bar"><i style={{ width: `${Math.max(track.status === "waiting" ? 0 : 2, track.percent)}%` }} /></div>
                    <small>{track.message}</small>
                  </div>)}
                </div> : null}
              </>
            ) : <div className="sync-setup-actions"><button className="connect sync-add-character" onClick={connect}>+ Add character</button><button className="sync" onClick={() => void syncAll()} disabled={!snapshots.length}>Begin Sync{snapshots.length ? ` (${snapshots.length})` : ""}</button></div>}
            <small className="sync-footnote">{syncProgress?.running ? "This can take up to 5 minutes on some machines." : snapshots.length ? `${snapshots.length} character${snapshots.length === 1 ? "" : "s"} ready. You can add more before starting.` : "You can add more characters at any time. Sage keeps each character’s data separate and refreshes them together."}</small>
          </div>
        </div>
      )}
      <aside>
        <div className="brand">
          <span className="brand-glyph">{"\u2726"}</span>
          <div>
            <strong>NEW EDEN</strong>
            <small>SAGE</small>
          </div>
        </div>
        <nav>
          {nav.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              onClick={() => setView(item.id)}
            >
              <span>{item.mark}</span>
              {item.label}
            </button>
          ))}
        </nav>
        {snapshots.length > 0 && (
          <div className="characters">
            <small>CONNECTED CHARACTERS</small>
            {snapshots.map((snapshot) => (
              <div className="character-entry" key={snapshot.characterId}>
                <button
                  className={
                    active?.characterId === snapshot.characterId
                      ? "selected"
                      : ""
                  }
                  onClick={() => selectCharacter(snapshot.characterId)}
                >
                  <span>{snapshot.character.name.slice(0, 1)}</span>
                  <div>
                    <strong>{snapshot.character.name}</strong>
                    <small>
                      {snapshot.character.corporation_name ?? "EVE character"}
                      {config.primaryCharacterId === snapshot.characterId ? " · PRIMARY SAGE ID" : ""}
                    </small>
                  </div>
                </button>
                <div className="character-controls">
                  <div
                    className={`clone-switch ${
                      active?.characterId === snapshot.characterId &&
                      cloneConfirmationRequired
                        ? "needs-confirmation"
                        : ""
                    }`}
                    aria-label={`Clone state for ${snapshot.character.name}`}
                  >
                    <button
                      className={
                        cloneStates[snapshot.characterId] === "alpha"
                          ? "active"
                          : ""
                      }
                      title={`Use Alpha training speed for ${snapshot.character.name}`}
                      onClick={() =>
                        confirmCloneState(snapshot.characterId, "alpha")
                      }
                    >
                      Alpha
                    </button>
                    <button
                      className={
                        cloneStates[snapshot.characterId] === "omega"
                          ? "active"
                          : ""
                      }
                      title={`Use Omega training speed for ${snapshot.character.name}`}
                      onClick={() =>
                        confirmCloneState(snapshot.characterId, "omega")
                      }
                    >
                      Omega
                    </button>
                  </div>
                  <button
                    className="remove-character"
                    title={`Remove ${snapshot.character.name}`}
                    onClick={() => removeCharacter(snapshot.characterId)}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="local-card">
          <span className="pulse" />
          <div>
            <strong>LOCAL-FIRST</strong>
            <small>Secrets stay on this PC</small>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">CAPSULEER INTELLIGENCE</p>
            <h1>{nav.find((item) => item.id === view)?.label}</h1>
          </div>
          <div className="header-actions">
            <UpdateControl />
            <button
              className="support-developer"
              onClick={() => void window.sage.openSupportPage()}
              title="Support New Eden Sage development via PayPal"
            >
              Support Developer
            </button>
            <button className="sync" onClick={() => void syncAll()} disabled={busy}>
              {"\u21bb"} {busy ? "Syncing all\u2026" : "Sync All"}
            </button>
            <button
              className="connect"
              onClick={connect}
              disabled={busy}
            >
              {busy ? "Connecting\u2026" : "+ Add character"}
            </button>
          </div>
        </header>
        {mountedViews.current.has("overview") && (
          <div className="cached-view" hidden={view !== "overview"}>
            <RetainedOverview
              snapshot={active}
              onConnect={connect}
              cloneState={active ? cloneStates[active.characterId] : undefined}
              onNavigate={setView}
            />
          </div>
        )}
        {view === "augments" && (
          <Augments snapshot={active} resolvedTypeNames={resolvedTypeNames} />
        )}
        {view === "settings" && (
          <Settings config={config} onSaved={setConfig} />
        )}
        {mountedViews.current.has("skills") && (
          <div className="cached-view" hidden={view !== "skills"}>
            <RetainedSkillsWorkspace
              snapshot={active}
              cloneState={active ? cloneStates[active.characterId] : undefined}
              confirmationRequired={cloneConfirmationRequired}
              initialHullTypeId={plannerHullTypeId}
              initialFitIntent={plannerFitIntent}
            />
          </div>
        )}
        {mountedViews.current.has("isk") && (
          <div className="cached-view" hidden={view !== "isk"}>
            <RetainedIskLab
              snapshot={active}
              cloneState={active ? cloneStates[active.characterId] : undefined}
              marketDataRevision={marketDataRevision}
            />
          </div>
        )}
        {mountedViews.current.has("market") && (
          <div className="cached-view" hidden={view !== "market"}>
            <RetainedMarketWorkspace
              snapshot={active}
              cloneState={active ? cloneStates[active.characterId] : undefined}
              marketDataRevision={marketDataRevision}
              onMarketDataUpdated={() => setMarketDataRevision((value) => value + 1)}
            />
          </div>
        )}
        {mountedViews.current.has("regional") && (
          <div className="cached-view" hidden={view !== "regional"}>
            <RegionalMarket
              snapshot={active}
              onMarketDataUpdated={() => setMarketDataRevision((value) => value + 1)}
            />
          </div>
        )}
        {mountedViews.current.has("fittings") && (
          <div className="cached-view" hidden={view !== "fittings"}>
            <RetainedFittingsWorkspace onExportToPlanner={(intent) => { if (intent.characterId) setActiveId(intent.characterId); setPlannerHullTypeId(intent.hullTypeId); setPlannerFitIntent(intent); setView("skills"); }} />
          </div>
        )}
        {mountedViews.current.has("loot") && (
          <div className="cached-view" hidden={view !== "loot"}>
            <RetainedLoot />
          </div>
        )}
        {mountedViews.current.has("navigation") && (
          <div className="cached-view" hidden={view !== "navigation"}>
            <RetainedNavigationCommand />
          </div>
        )}
        {mountedViews.current.has("industrial") && (
          <div className="cached-view" hidden={view !== "industrial"}>
            <RetainedIndustrialCommand
              snapshots={snapshots}
              activeCharacterId={active?.characterId}
              onSelectCharacter={selectCharacter}
            />
          </div>
        )}
        {view === "corporation" && <CorporationManagement />}
        <footer>
          <span className="pulse" />
          {message}
          <span className="footer-right">Tranquility · local database</span>
        </footer>
      </main>
    </div>
  );
}

function UpdateControl() {
  const [state, setState] = useState<{ status: string; detail?: any }>({ status: "idle" });
  const [version, setVersion] = useState("");
  useEffect(() => {
    window.sage.getUpdateState().then((value) => setVersion(value.version));
    return window.sage.onUpdateStatus(setState);
  }, []);
  const progress = state.status === "downloading" ? Math.round(state.detail?.percent ?? 0) : 0;
  async function act() {
    if (state.status === "available") await window.sage.downloadUpdate();
    else if (state.status === "downloaded") await window.sage.installUpdate();
    else {
      setState({ status: "checking" });
      try {
        const result = await Promise.race([
          window.sage.checkForUpdates(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Update check timed out.")), 20000)),
        ]) as { status?: string; detail?: any };
        if (result?.status === "available" || result?.status === "current")
          setState({ status: result.status, detail: result.detail });
      } catch (error) {
        setState({ status: "error", detail: error instanceof Error ? error.message : "Update check failed." });
      }
    }
  }
  const label = state.status === "available" ? "Download update" : state.status === "downloading" ? `Downloading ${progress}%` : state.status === "downloaded" ? "Install & restart" : state.status === "checking" ? "Checking\u2026" : state.status === "current" ? `Up to date \u00b7 v${version}` : state.status === "error" ? "Update failed \u00b7 retry" : `Check updates \u00b7 v${version}`;
  return <button className="update-control" onClick={act} disabled={state.status === "checking" || state.status === "downloading"} title={state.status === "error" ? String(state.detail) : "Install the latest full Sage release from GitHub"}>{label}</button>;
}

function MarketWorkspace({ snapshot, marketDataRevision, onMarketDataUpdated }: { snapshot?: CharacterSnapshot; cloneState?: CloneState; marketDataRevision: number; onMarketDataUpdated: () => void }) {
  return <section className="market-workspace">
    <RegionalMarket snapshot={snapshot} marketDataRevision={marketDataRevision} onMarketDataUpdated={onMarketDataUpdated} />
  </section>;
}

const RetainedMarketWorkspace = memo(MarketWorkspace, (a, b) => a.snapshot === b.snapshot && a.marketDataRevision === b.marketDataRevision);
function Augments({
  snapshot,
  resolvedTypeNames,
}: {
  snapshot?: CharacterSnapshot;
  resolvedTypeNames: Record<number, string>;
}) {
  if (!snapshot) {
    return (
      <section className="empty">
        <p className="eyebrow">NO CAPSULEER SELECTED</p>
        <h2>Connect a character to view augments</h2>
      </section>
    );
  }
  const implants = Array.isArray(snapshot.extended?.implants)
    ? snapshot.extended.implants
    : [];
  return (
    <section className="augments-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ACTIVE CLONE</p>
          <h2>{snapshot.character.name}'s augments</h2>
          <p>Implants currently installed in this character's active clone.</p>
        </div>
        <strong>{implants.length} installed</strong>
      </div>
      {implants.length ? (
        <div className="augment-grid">
          {implants.map((implant, index) => {
            const typeId = typeof implant === "number" ? implant : implant.typeId;
            const name =
              typeof implant === "number"
                ? resolvedTypeNames[typeId]
                : implant.name || resolvedTypeNames[typeId];
            return (
              <article className="augment-card" key={typeId}>
                <span>SLOT {index + 1}</span>
                <strong>{name ?? "Resolving implant name…"}</strong>
                <small>Installed and active</small>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-panel">No implants are installed in this active clone.</div>
      )}
    </section>
  );
}

function Overview({
  snapshot,
  onConnect,
  cloneState,
  onNavigate,
}: {
  snapshot?: CharacterSnapshot;
  onConnect(): void;
  cloneState?: CloneState;
  onNavigate(target: "skills" | "market" | "regional" | "fittings"): void;
}) {
  if (!snapshot)
    return (
      <section className="empty">
        <div className="orb">✦</div>
        <p className="eyebrow">AWAITING CAPSULEER</p>
        <h2>Connect your first character</h2>
        <p>
          Authorize through EVE Online to build your private command dashboard.
        </p>
        <button className="primary" onClick={onConnect}>
          Log in with EVE Online
        </button>
      </section>
    );
  const queueFinish = snapshot.queue.find(
    (item) => item.finish_date,
  )?.finish_date;
  return (
    <section className="dashboard">
      <div className="hero-panel">
        <div>
          <p className="eyebrow">ACTIVE CAPSULEER</p>
          <h2>{snapshot.character.name}</h2>
          <p>
            {snapshot.character.corporation_name ??
              "Sync to resolve corporation"}
          </p>
        </div>
        <div className="wallet-focus">
          <span>LIQUID ISK</span>
          <strong>{money(snapshot.wallet)}</strong>
          <small>ISK</small>
        </div>
        <div className="security">
          <span>SEC STATUS</span>
          <strong>
            {snapshot.character.security_status?.toFixed(2) ?? "—"}
          </strong>
        </div>
      </div>
      <div className="metrics">
        <Metric
          label="Skill points"
          value={money(snapshot.skills.total_sp)}
          detail={`${snapshot.queue.length} skills queued`}
        />
        <Metric
          label="Current ship"
          value={
            snapshot.ship.ship_type_name ??
            snapshot.ship.ship_name ??
            "Sync required"
          }
          detail={
            snapshot.ship.ship_type_name &&
            snapshot.ship.ship_name &&
            snapshot.ship.ship_name !== snapshot.ship.ship_type_name
              ? snapshot.ship.ship_name
              : "Active ship"
          }
        />
        <Metric
          label="Location"
          value={
            snapshot.location.place_name ??
            snapshot.location.solar_system_name ??
            "Sync required"
          }
          detail={
            snapshot.location.place_name &&
            snapshot.location.place_name !== snapshot.location.solar_system_name
              ? snapshot.location.solar_system_name
              : "Current solar system"
          }
        />
        <Metric
          label="Corporation"
          value={snapshot.character.corporation_name ?? "Sync required"}
          detail="Current corporation"
        />
      </div>
      <CommandIntelligence snapshot={snapshot} onNavigate={onNavigate} />
      <CapabilityCommandCenter
        snapshot={snapshot}
        cloneState={cloneState}
        onOpenProgression={() => onNavigate("skills")}
      />
    </section>
  );
}

const RetainedOverview = memo(Overview, (a, b) => a.snapshot === b.snapshot && a.cloneState === b.cloneState);
function duration(seconds: number | null) {
  if (seconds === null) return "Unavailable";
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.ceil((seconds % 86400) / 3600)}h`;
}

function Skills({
  snapshot,
  cloneState,
}: {
  snapshot?: CharacterSnapshot;
  cloneState?: CloneState;
}) {
  const [filter, setFilter] = useState("");
  if (!snapshot)
    return (
      <ComingSoon
        title="Skill planner"
        text="Connect a character to load skills."
      />
    );
  const skills = snapshot.skills.skills.filter((skill) =>
    (skill.name ?? `Skill ${skill.skill_id}`)
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  return (
    <section className="skills-page">
      <div className="skills-head">
        <div>
          <p className="eyebrow">CAPSULEER TRAINING RECORD</p>
          <h2>{snapshot.character.name}</h2>
          <p>
            {money(snapshot.skills.total_sp)} total skill points ·{" "}
            {snapshot.skills.skills.length} trained skills
          </p>
        </div>
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter skills…"
        />
      </div>
      <div className="skill-table">
        <div className="skill-row heading">
          <span>Skill</span>
          <span>Level</span>
          <span>Skill points</span>
          <span>Time to subsequent levels</span>
        </div>
        {skills.map((skill) => (
          <div className="skill-row" key={skill.skill_id}>
            <span>
              <strong>{skill.name ?? `Skill ${skill.skill_id}`}</strong>
              <small>Rank {skill.rank ?? "—"}</small>
            </span>
            <span className="level">
              {"●".repeat(skill.trained_skill_level)}
              {"○".repeat(5 - skill.trained_skill_level)}
            </span>
            <span>{money(skill.skillpoints_in_skill)}</span>
            <span className="times">
              {skill.timeToLevels?.length ? (
                skill.timeToLevels.map((item) => (
                  <em key={item.level}>
                    L{item.level}:{" "}
                    {item.queuedFinishDate
                      ? new Date(item.queuedFinishDate).toLocaleString()
                      : duration(
                          item.seconds === null || !cloneState
                            ? item.seconds
                            : item.seconds /
                                (cloneState === "alpha" ? 0.5 : 1),
                        )}
                  </em>
                ))
              ) : skill.trained_skill_level === 5 ? (
                <em>Level V complete</em>
              ) : (
                <em>Sync for estimates</em>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="metric">
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Settings({
  config,
}: {
  config: PublicConfig;
  onSaved(config: PublicConfig): void;
}) {
  const [mcpSetup, setMcpSetup] = useState<{ command: string; args: string[]; json: string; codex: string; access: string; claudeDesktop: string; claudeCode: string } | null>(null);
  const [mcpMessage, setMcpMessage] = useState("");
  const [tunnelId, setTunnelId] = useState("");
  const [runtimeKey, setRuntimeKey] = useState("");
  const [tunnelReady, setTunnelReady] = useState(false);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeCompatibilityStatus | null>(null);
  useEffect(() => {
    void window.sage.getMcpSetup().then(setMcpSetup);
    void window.sage.getMcpTunnelStatus().then((value) => { setTunnelId(value.tunnelId); setTunnelReady(value.ready); });
    void window.sage.getClaudeMcpStatus().then(setClaudeStatus);
  }, []);
  async function copyMcp(value: string, label: string) {
    await window.sage.copyText(value);
    setMcpMessage(`${label} copied.`);
  }
  async function repairClaude() {
    setMcpMessage("Preparing the New Eden Sage Claude Desktop extension...");
    try {
      const status = await window.sage.repairClaudeMcp();
      setClaudeStatus(status);
      const desktop = !status.desktop.detected
        ? "Claude Desktop not detected"
        : status.desktop.installPending
          ? "Claude Desktop configured automatically"
          : status.desktop.configured
            ? "Claude Desktop configured"
            : status.desktop.error ?? "Claude Desktop is ready to configure";
      const code = status.code.detected ? (status.code.configured ? "Claude Code configured" : "Claude Code needs attention") : "Claude Code not detected";
      setMcpMessage(`${desktop}. ${code}.`);
    } catch (error) {
      setMcpMessage(error instanceof Error ? error.message : "Could not install/repair Claude integration.");
    }
  }
  async function connectChatGpt() {
    setMcpMessage("Starting secure ChatGPT tunnel...");
    try {
      const result = await window.sage.configureMcpTunnel({ tunnelId, runtimeKey });
      setRuntimeKey("");
      setTunnelReady(result.ready);
      setMcpMessage(result.ready ? "Secure ChatGPT tunnel is ready." : "Tunnel started. Allow a moment, then add it in ChatGPT Plugins.");
    } catch (error) {
      setMcpMessage(error instanceof Error ? error.message : "Could not start the ChatGPT tunnel.");
    }
  }
  return (
    <section className="settings settings-page">
      <header className="settings-page-head">
        <div>
          <p className="eyebrow">SAGE CONFIGURATION</p>
          <h2>Settings</h2>
          <p>Connection, authorization and AI integration controls for this Sage installation.</p>
        </div>
      </header>

      <div className="settings-layout">
        <article className="settings-connection-card settings-sso-card">
          <div className="settings-card-head">
            <div><p className="eyebrow">EVE ONLINE</p><h3>Character authorization</h3></div>
            <span className="settings-state ready">OFFICIAL SSO</span>
          </div>
          <p>Use Add Character in the app header to sign in on EVE Online's official authorization page. Sage never asks for your EVE password.</p>
          <div className="settings-detail-row"><span>Authorization</span><strong>Secure desktop OAuth / ESI</strong></div>
          <div className="settings-detail-row"><span>Token storage</span><strong>Windows secure storage · local only</strong></div>
          <div className="settings-callback"><span>Callback URL</span><code>{config.callbackUrl}</code></div>
        </article>

        <article className="settings-connection-card mcp-settings-card settings-ai-card">
          <div className="settings-card-head">
            <div><p className="eyebrow">AI INTEGRATIONS</p><h3>AI / MCP access</h3></div>
            <span className={`settings-state ${tunnelReady ? "ready" : "muted"}`}>{tunnelReady ? "CHATGPT READY" : "LOCAL MCP"}</span>
          </div>
          <p>Connect ChatGPT, Claude or Codex to Sage's local dataset. Character snapshots, ESI datasets, imported information and retained market data are exposed; credentials and encrypted values are removed.</p>

          <div className="settings-integration-grid">
            <section className="mcp-tunnel-panel settings-integration-card">
              <div className="settings-integration-head"><div><span>CHATGPT</span><strong>Secure MCP Tunnel</strong></div><b className={tunnelReady ? "ready" : "muted"}>{tunnelReady ? "Ready" : "Not connected"}</b></div>
              <label><span>Tunnel ID</span><input value={tunnelId} onChange={(event) => setTunnelId(event.target.value)} placeholder="OpenAI tunnel ID (tunnel_...)" /></label>
              <label><span>Runtime key</span><input type="password" value={runtimeKey} onChange={(event) => setRuntimeKey(event.target.value)} placeholder="OpenAI runtime API key" autoComplete="off" /></label>
              <div className="mcp-setup-actions">
                <button onClick={() => void window.sage.openOpenAiTunnels()}>Create / view tunnel</button>
                <button onClick={() => void window.sage.openOpenAiApiKeys()}>Create runtime key</button>
                <button className="primary" onClick={() => void connectChatGpt()}>Save and start</button>
                <button onClick={() => void window.sage.openChatGptPlugins()}>Add in ChatGPT</button>
              </div>
              <small>The runtime key is encrypted with Windows secure storage and remains only on this PC.</small>
            </section>

            <section className="mcp-claude-panel settings-integration-card">
              <div className="settings-integration-head"><div><span>CLAUDE</span><strong>Desktop & Code</strong></div><b className={claudeStatus?.desktop.configured || claudeStatus?.code.configured ? "ready" : "muted"}>{claudeStatus?.desktop.configured || claudeStatus?.code.configured ? "Configured" : "Detecting"}</b></div>
              <p>Sage configures Claude Desktop automatically on this PC and preserves your existing Claude settings and MCP servers. Claude Code is registered separately at user scope.</p>
              <div className="mcp-client-status-grid">
                <div><span>Claude Desktop</span><b className={claudeStatus?.desktop.configured ? "ready" : claudeStatus?.desktop.installPending ? "attention" : claudeStatus?.desktop.detected ? "attention" : "muted"}>{claudeStatus?.desktop.configured ? "Configured" : claudeStatus?.desktop.installPending ? "Configured" : claudeStatus?.desktop.detected ? "Ready to configure" : "Not detected"}</b>{claudeStatus?.desktop.bundlePath && <small>MCPB: {claudeStatus.desktop.bundlePath}</small>}{claudeStatus?.desktop.installPending && <small>Sage has configured Claude Desktop directly.</small>}{claudeStatus?.desktop.error && <small className="mcp-client-error">{claudeStatus.desktop.error}</small>}</div>
                <div><span>Claude Code</span><b className={claudeStatus?.code.configured ? "ready" : claudeStatus?.code.detected ? "attention" : "muted"}>{claudeStatus?.code.configured ? "Configured (user scope)" : claudeStatus?.code.detected ? "Needs repair" : "Not detected"}</b>{claudeStatus?.code.path && <small>{claudeStatus.code.path}</small>}{claudeStatus?.code.error && <small className="mcp-client-error">{claudeStatus.code.error}</small>}</div>
              </div>
              <div className="mcp-setup-actions">
                <button className="primary" onClick={() => void repairClaude()}>Install / repair Claude</button>
                {mcpSetup && <button onClick={() => void copyMcp(mcpSetup.claudeCode, "Claude Code command")}>Copy Code command</button>}
              </div>
            </section>
          </div>

          {mcpSetup && <details className="mcp-advanced-settings">
            <summary><span>Advanced MCP configuration</span><small>Codex, generic stdio config and manual setup</small></summary>
            <div className="mcp-advanced-body">
              <small>Transport: local stdio · Server: new-eden-sage · {mcpSetup.access}</small>
              <div className="mcp-setup-actions"><button onClick={() => void copyMcp(mcpSetup.json, "Generic MCP configuration")}>Copy MCP config</button><button onClick={() => void copyMcp(mcpSetup.codex, "Codex configuration")}>Copy Codex config</button></div>
              <div className="mcp-instructions"><strong>Manual connection notes</strong><ol><li>Sync characters and refresh any market data the AI needs.</li><li>For ChatGPT, create a tunnel and runtime key above, then choose <b>Add in ChatGPT</b>.</li><li>For Claude Desktop, use <b>Install / repair Claude</b>. Sage detects the installed Claude app and configures New Eden Sage automatically.</li><li>For Codex, copy the Codex configuration into its <code>config.toml</code>.</li><li>Ask the AI to list Sage characters or available Sage data before detailed analysis.</li></ol><small>Sage can serve already-saved read data through the configured MCP transport; keep the desktop app available for workflows that require live Sage writes.</small></div>
              <code className="mcp-command-preview">{mcpSetup.command} {mcpSetup.args.join(" ")}</code>
            </div>
          </details>}
          {mcpMessage && <div className="mcp-copy-status settings-message">{mcpMessage}</div>}
        </article>
      </div>
    </section>
  );
}

function ComingSoon({ title, text }: { title: string; text: string }) {
  return (
    <section className="empty">
      <div className="orb small">◇</div>
      <p className="eyebrow">MODULE RESERVED</p>
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  );
}

/* Embedded API chat removed; ChatGPT exports are the sole AI workflow.
function Chat({
  snapshot,
  hasKey,
  onOpenSettings,
}: {
  snapshot?: CharacterSnapshot;
  hasKey: boolean;
  onOpenSettings(): void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<Awaited<
    ReturnType<typeof window.sage.prepareForAI>
  > | null>(null);
  async function prepare(event: FormEvent) {
    event.preventDefault();
    setPrepared(
      await window.sage.prepareForAI({
        message: question,
        characterId: snapshot?.characterId,
      }),
    );
  }
  async function sendPaid() {
    if (!hasKey) {
      onOpenSettings();
      return;
    }
    let approvedOverBudget = false;
    if (prepared?.cost.requiresApproval) {
      approvedOverBudget = window.confirm(
        `Estimated maximum API cost: $${prepared.cost.estimatedMaximumCost.toFixed(2)}.\n\nThis exceeds your $${prepared.cost.approvalThreshold.toFixed(2)} approval threshold. Continue with the paid request?`,
      );
      if (!approvedOverBudget) return;
    }
    setBusy(true);
    setAnswer("");
    try {
      setAnswer(
        await window.sage.askSage({
          message: question,
          characterId: snapshot?.characterId,
          approvedOverBudget,
        }),
      );
    } catch (error) {
      setAnswer(
        error instanceof Error ? error.message : "Sage could not answer.",
      );
    } finally {
      setBusy(false);
      setPrepared(null);
    }
  }
  return (
    <section className="chat">
      <div className="chat-intro">
        <p className="eyebrow">PRIVATE ADVISOR</p>
        <h2>Ask about your next move</h2>
        <p>
          Sage can request a narrow overview of{" "}
          {snapshot?.character.name ?? "your connected character"}. More data
          tools arrive with each module.
        </p>
      </div>
      <div className="conversation">
        {answer ? (
          <div className="answer">
            <span>✦</span>
            <p>{answer}</p>
          </div>
        ) : (
          <div className="suggestions">
            <button
              onClick={() =>
                setQuestion(
                  "What should I train next, based on my current skills and queue?",
                )
              }
            >
              Plan my next skills
            </button>
            <button
              onClick={() =>
                setQuestion(
                  "Give me three realistic ISK-making directions for this character and explain what data is still missing.",
                )
              }
            >
              Find an ISK direction
            </button>
            <button
              onClick={() =>
                setQuestion(
                  "Review my current character snapshot and flag anything that needs attention.",
                )
              }
            >
              Review my character
            </button>
          </div>
        )}
      </div>
      {prepared && (
        <div
          className={`cost-gate ${prepared.cost.requiresApproval ? "over-budget" : ""}`}
        >
          <div>
            <strong>
              {prepared.cost.requiresApproval
                ? "Approval required — estimated cost exceeds $0.40"
                : "Prepared locally — no API charge yet"}
            </strong>
            <p>
              Model: {prepared.model} · estimated maximum $
              {`$${prepared.cost.estimatedMaximumCost.toFixed(2)}`} ·{" "}
              {prepared.availableLocalSources} local sources
            </p>
            <small>
              {prepared.cost.pricingBasis} {prepared.disclosure}
            </small>
          </div>
          <button className="paid" onClick={sendPaid} disabled={busy}>
            {busy
              ? "Sending…"
              : hasKey
                ? prepared.cost.requiresApproval
                  ? "Review and approve"
                  : "Send paid API request"
                : "Add API key first"}
          </button>
          <button className="cancel" onClick={() => setPrepared(null)}>
            Cancel
          </button>
        </div>
      )}
      <form className="composer" onSubmit={prepare}>
        <textarea
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
            setPrepared(null);
          }}
          placeholder="Ask Sage about skills, ships, ISK, industry…"
        />
        <button className="primary" disabled={busy || !question.trim()}>
          Prepare for AI
        </button>
      </form>
    </section>
  );
}

*/
function RegionalMarket({ snapshot, marketDataRevision = 0, onMarketDataUpdated }: { snapshot?: CharacterSnapshot; marketDataRevision?: number; onMarketDataUpdated: () => void }) {
  const [regions, setRegions] = useState<
    Array<{ regionId: number; name: string }>
  >([]);
  const [selected, setSelected] = useState(10000002);
  const [summaries, setSummaries] = useState<MarketSummary[]>([]);
  const [activeRegion, setActiveRegion] = useState<number>(10000002);
  const [busy, setBusy] = useState(false);
  const marketProgressLocked = useRef(false);
  const [progress, setProgress] = useState(
    "Ready to pull public ESI market data",
  );
  const [itemSearch, setItemSearch] = useState("");
  const [sideFilter, setSideFilter] = useState<"all" | "sell" | "buy">("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [itemSort, setItemSort] = useState<
    | "name"
    | "orders"
    | "buy"
    | "sell"
    | "spread"
    | "buyVolume"
    | "sellVolume"
  >("orders");
  const [includeLowSec, setIncludeLowSec] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MarketItem | null>(null);
  const [storage, setStorage] = useState<{
    path: string;
    retainedDatasets: number;
    raw?: {
      root: string;
      snapshotId: string;
      createdAt: string;
      orderCount: number;
      regionCount: number;
      complete: boolean;
    } | null;
  } | null>(null);
  useEffect(() => {
    Promise.all([
      window.sage.listMarketSummaries(),
      window.sage.getMarketStorage(),
    ]).then(([cached, storageInfo]) => {
      setRegions(
        cached.map((region) => ({
          regionId: region.regionId,
          name: region.regionName,
        })),
      );
      setSummaries(cached);
      setStorage(storageInfo);
      void showRegion(selected);
    });
    window.sage
      .listMarketRegions()
      .then(setRegions)
      .catch(() => undefined);
    return window.sage.onMarketProgress((item) => {
      if (!marketProgressLocked.current) setProgress(
        `${item.regionName}: page ${item.pagesDone}/${item.pagesTotal} · regions ${item.regionsDone}/${item.regionsTotal}`,
      );
    });
  }, []);
  async function showRegion(regionId: number) {
    setActiveRegion(regionId);
    setSelectedItem(null);
    const detail = await window.sage.getMarketRegion(regionId);
    if (!detail) return;
    setSummaries((current) => {
      const next = current.filter((item) => item.regionId !== regionId);
      next.push(detail);
      return next.sort((a, b) => a.regionName.localeCompare(b.regionName));
    });
  }
  async function pull(mode: "single" | "all" | "radius" | "contracts") {
    if (mode === "radius" && !snapshot) {
      setProgress("Connect and sync a character before using a radius pull.");
      return;
    }
    marketProgressLocked.current = false;
    setBusy(true);
    setProgress(
      mode === "all"
        ? "Starting all-region pull…"
        : mode === "contracts"
          ? "Starting full high-sec contract pull..."
          : mode === "radius"
            ? "Mapping systems within 20 jumps…"
            : "Starting regional pull…",
    );
    try {
      const result = await window.sage.pullMarket({
        mode,
        regionId: selected,
        characterId: snapshot?.characterId,
        includeLowSec,
      });
      setSummaries(result.summaries);
      onMarketDataUpdated();
      await showRegion(selected);
      setProgress(
        `Dataset saved to ${result.storage.path}. ${result.storage.retained} total snapshots retained.`,
      );
      marketProgressLocked.current = true;
    } catch (error) {
      setProgress(
        error instanceof Error ? error.message : "Market pull failed",
      );
    } finally {
      setBusy(false);
    }
  }
  const summary =
    summaries.find((item) => item.regionId === activeRegion) ??
    summaries.find((item) => item.regionId === selected);
  const indexedItems =
    summary?.items ??
    Array.from(
      new Map(
        (summary?.topOrders ?? []).map((order) => [
          order.typeName,
          {
            typeId: 0,
            typeName: order.typeName,
            categoryId: 0,
            categoryName: "Other",
            buyOrderCount: order.is_buy_order ? 1 : 0,
            sellOrderCount: order.is_buy_order ? 0 : 1,
            buyVolume: order.is_buy_order ? order.volume_remain : 0,
            sellVolume: order.is_buy_order ? 0 : order.volume_remain,
            bestBuy: order.is_buy_order ? order.price : null,
            bestSell: order.is_buy_order ? null : order.price,
            spreadPercent: null,
          },
        ]),
      ).values(),
    );
  const categories = [
    ...new Set(indexedItems.map((item) => item.categoryName ?? "Other")),
  ].sort((a, b) => a.localeCompare(b));
  const filteredItems = indexedItems
    .filter(
      (item) =>
        item.typeName.toLowerCase().includes(itemSearch.toLowerCase()) &&
        (categoryFilter === "all" ||
          (item.categoryName ?? "Other") === categoryFilter) &&
        (sideFilter === "all" ||
          (sideFilter === "sell" && item.sellOrderCount > 0) ||
          (sideFilter === "buy" && item.buyOrderCount > 0)),
    )
    .sort((a, b) => {
      if (itemSort === "name") return a.typeName.localeCompare(b.typeName);
      if (itemSort === "buy") return (b.bestBuy ?? -1) - (a.bestBuy ?? -1);
      if (itemSort === "sell")
        return (a.bestSell ?? Infinity) - (b.bestSell ?? Infinity);
      if (itemSort === "spread")
        return (b.spreadPercent ?? -Infinity) - (a.spreadPercent ?? -Infinity);
      if (itemSort === "buyVolume") return b.buyVolume - a.buyVolume;
      if (itemSort === "sellVolume") return b.sellVolume - a.sellVolume;
      return (
        b.buyOrderCount +
        b.sellOrderCount -
        (a.buyOrderCount + a.sellOrderCount)
      );
    });
  const visibleItems = filteredItems
    .slice(0, 500);
  return (
    <section className="market-page">
      <div className="market-head">
        <div>
          <p className="eyebrow">PUBLIC TRANQUILITY DATA</p>
          <h2>Regional market intelligence</h2>
          <p>
            No character authorization is required. Results are cached locally.
          </p>
        </div>
        <div className="market-controls">
          <select
            value={selected}
            onChange={(event) => {
              const id = Number(event.target.value);
              setSelected(id);
              void showRegion(id);
            }}
          >
            {regions.map((region) => (
              <option key={region.regionId} value={region.regionId}>
                {region.name}
              </option>
            ))}
          </select>
          <button onClick={() => pull("single")} disabled={busy}>
            Pull region
          </button>
          <button onClick={() => pull("contracts")} disabled={busy} title="Contracts are a slower, separate dataset">
            Refresh contracts
          </button>
          <label className="lowsec-check">
            <input
              type="checkbox"
              checked={includeLowSec}
              onChange={(event) => setIncludeLowSec(event.target.checked)}
            />
            Include low-sec
          </label>
        </div>
      </div>
      <div className="market-progress">
        <span className={busy ? "pulse" : ""} />
        <div>
          {progress}
          {storage && (
            <small>
              Storage: {storage.path} · {storage.retainedDatasets} derived datasets retained
              {storage.raw ? ` · raw order book: ${money(storage.raw.orderCount)} orders across ${storage.raw.regionCount} regions` : ""}
            </small>
          )}
        </div>
      </div>
      {summaries.length > 0 && (
        <div className="region-tabs">
          {summaries.map((item) => (
            <button
              className={item.regionId === activeRegion ? "active" : ""}
              key={item.regionId}
              onClick={() => void showRegion(item.regionId)}
            >
              {item.regionName}
            </button>
          ))}
        </div>
      )}
      {summary ? (
        <>
          <div className="market-metrics">
            <Metric
              label="Public orders"
              value={money(summary.orderCount)}
              detail={`${summary.pageCount} ESI pages`}
            />
            <Metric
              label="Buy / sell"
              value={`${money(summary.buyOrders)} / ${money(summary.sellOrders)}`}
              detail="Active orders"
            />
            <Metric
              label="Unique types"
              value={money(summary.uniqueTypes)}
              detail="Items represented"
            />
            <Metric
              label="Last updated"
              value={new Date(summary.updatedAt).toLocaleTimeString()}
              detail={new Date(summary.updatedAt).toLocaleDateString()}
            />
          </div>
          <div className="item-tools">
            <input
              value={itemSearch}
              onChange={(event) => setItemSearch(event.target.value)}
              placeholder="Search items in the selected region…"
            />
            <select
              value={categoryFilter}
              onChange={(event) => {
                setCategoryFilter(event.target.value);
                setSelectedItem(null);
              }}
              aria-label="Item category"
            >
              <option value="all">All categories</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <select
              value={itemSort}
              onChange={(event) =>
                setItemSort(event.target.value as typeof itemSort)
              }
              aria-label="Sort market items"
            >
              <option value="orders">Most orders</option>
              <option value="name">Item name</option>
              <option value="buy">Highest buyer</option>
              <option value="sell">Lowest seller</option>
              <option value="spread">Largest spread</option>
              <option value="buyVolume">Largest wanted volume</option>
              <option value="sellVolume">Largest sale volume</option>
            </select>
            <button
              className={sideFilter === "all" ? "active" : ""}
              onClick={() => setSideFilter("all")}
            >
              All
            </button>
            <button
              className={sideFilter === "sell" ? "active" : ""}
              onClick={() => setSideFilter("sell")}
            >
              For sale
            </button>
            <button
              className={sideFilter === "buy" ? "active" : ""}
              onClick={() => setSideFilter("buy")}
            >
              Wanted
            </button>
            <small>
              {money(visibleItems.length)} shown of {money(filteredItems.length)}
            </small>
          </div>
          {!summary.items && (
            <div className="reindex-note">
              This snapshot predates the searchable index. Pull the region again
              to index all {money(summary.uniqueTypes)} item types.
            </div>
          )}
          <div className="orders">
            <div className="item-row order-heading">
              <span>Item</span>
              <span>Best buy</span>
              <span>Best sell</span>
              <span>Buy orders / volume</span>
              <span>Sell orders / volume</span>
              <span>Spread</span>
            </div>
            {visibleItems.map((item) => (
              <div
                className={`item-row item-result ${selectedItem?.typeId === item.typeId ? "selected" : ""}`}
                key={item.typeId || item.typeName}
                onClick={() => setSelectedItem(item)}
              >
                <strong>{item.typeName}</strong>
                <span className="buy">
                  {item.bestBuy === null ? "—" : `${money(item.bestBuy)} ISK`}
                </span>
                <span className="sell">
                  {item.bestSell === null ? "—" : `${money(item.bestSell)} ISK`}
                </span>
                <span>
                  {money(item.buyOrderCount)} / {money(item.buyVolume)}
                </span>
                <span>
                  {money(item.sellOrderCount)} / {money(item.sellVolume)}
                </span>
                <span>
                  {item.spreadPercent === null
                    ? "—"
                    : `${item.spreadPercent.toFixed(1)}%`}
                </span>
              </div>
            ))}
          </div>
          {selectedItem && (
            <div className="order-depth">
              <div className="depth-title">
                <div>
                  <p className="eyebrow">SELECTED REGION QUICK DEPTH</p>
                  <h3>{selectedItem.typeName}</h3>
                </div>
                <button onClick={() => setSelectedItem(null)}>Close</button>
              </div>
              {!selectedItem.topBuyOrders && !selectedItem.topSellOrders ? (
                <div className="reindex-note">
                  Pull this region again to rebuild its quick-depth index.
                </div>
              ) : (
                <div className="depth-columns">
                  <OrderDepth
                    title="Top buyers"
                    side="buy"
                    orders={selectedItem.topBuyOrders ?? []}
                    omitted={selectedItem.omittedBuyOrders ?? 0}
                  />
                  <OrderDepth
                    title="Top sellers"
                    side="sell"
                    orders={selectedItem.topSellOrders ?? []}
                    omitted={selectedItem.omittedSellOrders ?? 0}
                  />
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="market-empty">
          Choose a region and pull its current public orders.
        </div>
      )}
    </section>
  );
}

function OrderDepth({
  title,
  side,
  orders,
  omitted,
}: {
  title: string;
  side: "buy" | "sell";
  orders: NonNullable<MarketItem["topBuyOrders"]>;
  omitted: number;
}) {
  return (
    <div className="depth-column">
      <h4>{title}</h4>
      <div className="depth-heading">
        <span>#</span>
        <span>Price / volume</span>
        <span>Location</span>
      </div>
      {orders.length ? (
        orders.map((order, index) => (
          <div className="depth-row" key={order.orderId}>
            <span>{index + 1}</span>
            <span className={side}>
              <strong>{money(order.price)} ISK</strong>
              <small>{money(order.volumeRemain)} remaining</small>
            </span>
            <span>
              <strong>{order.systemName}</strong>
              <small>{order.locationName}</small>
            </span>
          </div>
        ))
      ) : (
        <p className="no-depth">No {side} orders.</p>
      )}
      {omitted > 0 && (
        <small className="omitted">
          {money(omitted)} additional orders exist in the retained raw order book
        </small>
      )}
    </div>
  );
}
