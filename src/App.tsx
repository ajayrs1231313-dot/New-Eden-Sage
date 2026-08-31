import { FormEvent, memo, useEffect, useRef, useState } from "react";
import type {
  CharacterSnapshot,
  MarketItem,
  MarketSummary,
  PublicConfig,
  FitResolutionIntent,
  ClaudeCompatibilityStatus,
  ProfitLedgerRecord,
  ProfitReconciliationReview,
  ProfitPurchaseReview,
} from "./types";
import { FittingsWorkspace } from "./Fittings";
import { IskLab } from "./IskLab";
import { KillmailsCommand } from "./KillmailsCommand";
import { CharacterOverviewHud } from "./CharacterOverviewHud";
import { CharacterQueue } from "./CharacterQueue";
import { SkillsWorkspace, type SkillsTab } from "./SkillsWorkspace";
import type { CharacterNavigateTarget } from "./character-navigation";
import { IndustrialCommand } from "./IndustrialCommand";
import { Loot } from "./Loot";
import { AssetsCommand } from "./AssetsCommand";
import { CorporationManagement } from "./CorporationManagement";
import { FleetCommand } from "./FleetCommand";
import { NavigationCommand } from "./NavigationCommand";
import { WormholeCommand } from "./WormholeCommand";
import { CharacterCommandHeader } from "./CharacterCommandHeader";
import { AugmentsGuide } from "./AugmentsGuide";
import { LpStore } from "./LpStore";
import { ClaudeIntegrationCard } from "./ClaudeIntegrationCard";
import "./feature-additions.css";
import "./asset-command-polish.css";
import "./character-command.css";
import { MarketWorkspaceV2 } from "./MarketWorkspaceV2";
import { OPEN_SHOPPING_LIST_EVENT, OPEN_SHOPPING_LIST_PENDING_KEY } from "./shopping-list";

type View =
  | "overview"
  | "augments"
  | "skills"
  | "isk"
  | "market"
  | "regional"
  | "navigation"
  | "wormholes"
  | "industrial"
  | "corporation"
  | "fleet"
  | "fittings"
  | "loot"
  | "settings";
type CloneState = "alpha" | "omega";
type CharacterCommandTab = "overview" | "queue" | "augments" | "killmails" | "lp-store";
type AssetCommandTab = "loot" | "assets" | "market" | "wallet";
type WalletCommandView = "full" | "ledger";
type SyncTrack = { id: string; label: string; percent: number; status: "waiting" | "running" | "done" | "error"; message: string };
type SyncProgress = { running: boolean; message: string; percent: number; completed?: number; total?: number; tracks?: SyncTrack[] };

const nav: Array<{ id: View; label: string }> = [
  { id: "overview", label: "Character Command" },
  { id: "skills", label: "Activity Command" },
  { id: "isk", label: "ISK Command" },
  { id: "navigation", label: "Navigation Command" },
  { id: "wormholes", label: "Wormhole Command" },
  { id: "fittings", label: "Fitting Command" },
  { id: "loot", label: "Asset Command" },
  { id: "industrial", label: "Industrial Command" },
  { id: "corporation", label: "Corporation Command" },
  { id: "fleet", label: "Fleet Command" },
  { id: "settings", label: "Settings" },
];
const commandNav = nav.filter((item) => item.id !== "settings");
const COMMAND_VISIT_STORAGE_KEY = "new-eden-sage:onboarding:command-tabs:v1";

function SidebarIcon({ id }: { id: View }) {
  const iconProps = { className: "nav-icon", viewBox: "0 0 24 24", "aria-hidden": true } as const;
  switch (id) {
    case "overview":
      return <svg {...iconProps}><circle cx="12" cy="12" r="3" /><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /></svg>;
    case "skills":
      return <svg {...iconProps}><path d="M5 18 12 5l7 13H5Z" /><path d="M9 14h6" /></svg>;
    case "isk":
      return <svg {...iconProps}><path d="m12 4 7 8-7 8-7-8 7-8Z" /><circle cx="12" cy="12" r="2.5" /></svg>;
    case "navigation":
      return <svg {...iconProps}><circle cx="12" cy="12" r="7" /><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2Z" /></svg>;
    case "wormholes":
      return <svg {...iconProps}><circle cx="8" cy="12" r="4.5" /><circle cx="16" cy="12" r="4.5" /><path d="M10.5 8.3c1.2-1 1.8-1 3 0M10.5 15.7c1.2 1 1.8 1 3 0" /></svg>;
    case "fittings":
      return <svg {...iconProps}><path d="M7 5v14M12 5v14M17 5v14M5 9h4M10 15h4M15 11h4" /></svg>;
    case "loot":
      return <svg {...iconProps}><path d="M5 8h14v11H5zM8 8l1.5-3h5L16 8M9 12h6" /></svg>;
    case "industrial":
      return <svg {...iconProps}><circle cx="8" cy="16" r="3" /><circle cx="16" cy="8" r="3" /><path d="M10.2 13.8 13.8 10.2M5 5h4v4" /></svg>;
    case "corporation":
      return <svg {...iconProps}><circle cx="9" cy="9" r="3" /><circle cx="16.5" cy="10" r="2.2" /><path d="M4.5 19c.7-3.3 2.3-5 4.5-5s3.8 1.7 4.5 5M14 15c1.8 0 3.2 1.3 4 3.8" /></svg>;
    case "settings":
      return <svg {...iconProps}><circle cx="12" cy="12" r="3" /><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4" /></svg>;
    default:
      return <svg {...iconProps}><circle cx="12" cy="12" r="4" /></svg>;
  }
}

const money = (value: number) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);

const RetainedSkillsWorkspace = memo(SkillsWorkspace);
const RetainedIskLab = memo(IskLab);
const RetainedFittingsWorkspace = memo(FittingsWorkspace, (a, b) => a.activeCharacterId === b.activeCharacterId);
const RetainedLoot = memo(Loot, () => true);
const RetainedAssetsCommand = memo(AssetsCommand, (a, b) => a.snapshots === b.snapshots);
const RetainedIndustrialCommand = memo(IndustrialCommand, (a, b) => a.snapshots === b.snapshots && a.activeCharacterId === b.activeCharacterId);
const RetainedNavigationCommand = memo(NavigationCommand, () => true);
const RetainedWormholeCommand = memo(WormholeCommand, (a, b) => a.snapshots === b.snapshots && a.activeCharacterId === b.activeCharacterId);

export default function App() {
  const [view, setView] = useState<View>("overview");
  const [fitToMonitor, setFitToMonitor] = useState(false);
  const [assetCommandTab, setAssetCommandTab] = useState<AssetCommandTab>("loot");
  const [walletCommandView, setWalletCommandView] = useState<WalletCommandView>("full");
  const [activityCommandTab, setActivityCommandTab] = useState<SkillsTab>("activity-planner");
  const [visitedCommandViews, setVisitedCommandViews] = useState<Set<View>>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(COMMAND_VISIT_STORAGE_KEY) ?? "[]");
      if (!Array.isArray(parsed)) return new Set<View>();
      return new Set<View>(parsed.filter((value) => commandNav.some((item) => item.id === value)) as View[]);
    } catch {
      return new Set<View>();
    }
  });
  useEffect(() => {
    if (!commandNav.some((item) => item.id === view)) return;
    setVisitedCommandViews((current) => {
      if (current.has(view)) return current;
      const next = new Set(current);
      next.add(view);
      try { localStorage.setItem(COMMAND_VISIT_STORAGE_KEY, JSON.stringify([...next])); } catch { /* Onboarding persistence is non-fatal. */ }
      return next;
    });
  }, [view]);
  useEffect(() => {
    document.documentElement.dataset.fitToMonitor = fitToMonitor ? "on" : "off";
    void window.sage.setDisplayFitEnabled(fitToMonitor);
  }, [fitToMonitor]);

  useEffect(() => window.sage.onDisplayFitChanged(setFitToMonitor), []);

  useEffect(() => {
    let timer = 0;
    const requestFit = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void window.sage.refreshDisplayFit(), 90);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(requestFit);
    const shell = document.querySelector(".app-shell");
    const main = document.querySelector(".app-shell > main");
    const aside = document.querySelector(".app-shell > aside");
    if (shell) observer?.observe(shell);
    if (main) observer?.observe(main);
    if (aside) observer?.observe(aside);
    requestFit();
    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    const navigateToFittings = () => setView("fittings");
    const navigateToCorpDoctrines = () => setView("fleet");
    const navigateToShoppingList = () => { sessionStorage.setItem(OPEN_SHOPPING_LIST_PENDING_KEY, "1"); setAssetCommandTab("market"); setView("loot"); };
    window.addEventListener("sage:navigate-fittings", navigateToFittings);
    window.addEventListener("sage:navigate-corp-doctrines", navigateToCorpDoctrines);
    window.addEventListener(OPEN_SHOPPING_LIST_EVENT, navigateToShoppingList);
    return () => {
      window.removeEventListener("sage:navigate-fittings", navigateToFittings);
      window.removeEventListener("sage:navigate-corp-doctrines", navigateToCorpDoctrines);
      window.removeEventListener(OPEN_SHOPPING_LIST_EVENT, navigateToShoppingList);
    };
  }, []);
  const [marketDataRevision, setMarketDataRevision] = useState(0);
  const [plannerHullTypeId, setPlannerHullTypeId] = useState<number>();
  const [plannerFitIntent, setPlannerFitIntent] = useState<FitResolutionIntent>();
  const mountedViews = useRef(new Set<View>(["overview"]));
  mountedViews.current.add(view);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [snapshots, setSnapshots] = useState<CharacterSnapshot[]>([]);
  useEffect(() => {
    const handleSnapshotUpdate = (event: Event) => {
      const snapshot = (event as CustomEvent<CharacterSnapshot>).detail;
      if (!snapshot?.characterId) return;
      setSnapshots((current) => current.some((item) => item.characterId === snapshot.characterId)
        ? current.map((item) => item.characterId === snapshot.characterId ? snapshot : item)
        : [...current, snapshot]);
    };
    window.addEventListener("sage:character-snapshot-updated", handleSnapshotUpdate);
    return () => window.removeEventListener("sage:character-snapshot-updated", handleSnapshotUpdate);
  }, []);
  const [activeId, setActiveId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [privateRefreshActive, setPrivateRefreshActive] = useState(false);
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
        setInitialSetupComplete(nextSnapshots.some((snapshot) => snapshot.snapshotState !== "bootstrap"));
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
        ? `${result.characterName} connected locally - ${result.onlineIdentityError}`
        : `${result.characterName} connected - ready for private data refresh`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "EVE login failed");
    } finally {
      setBusy(false);
    }
  }

  async function refreshPrivateData() {
    const selectedCharacterId = activeId || snapshots[0]?.characterId;
    if (!selectedCharacterId) {
      setMessage("Add a character before refreshing private data.");
      return;
    }
    setPrivateRefreshActive(true);
    setMessage("Refreshing selected character private EVE data locally...");
    try {
      const result = await window.sage.runMasterUpdate({ cloneStates, characterIds: [selectedCharacterId] }) as { alreadySynced?: boolean; preparationFailures?: unknown[] } | undefined;
      if (result?.alreadySynced) {
        setInitialSetupComplete(true);
        setMessage("Private data is already current for this app version.");
        return;
      }
      const nextSnapshots = await window.sage.listSnapshots();
      setSnapshots(nextSnapshots);
      setActiveId((current) => nextSnapshots.some((item) => item.characterId === current) ? current : nextSnapshots[0]?.characterId ?? "");
      setMarketDataRevision((value) => value + 1);
      const refreshedCharacter = nextSnapshots.find((item) => item.characterId === selectedCharacterId);
      setMessage(result?.preparationFailures?.length ? "Update finished with preparation warnings. The affected bars show what needs retrying." : (refreshedCharacter?.character.name ?? "Selected character") + " private data refreshed.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Character sync failed",
      );
    } finally {
      setPrivateRefreshActive(false);
    }
  }

  useEffect(() => window.sage.onMasterUpdateProgress((progress) => {
    setSyncProgress(progress);
    if (progress.running) {
      setPrivateRefreshActive(true);
      setMessage(progress.message);
    } else {
      setPrivateRefreshActive(false);
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

  function navigateFromCharacter(target: CharacterNavigateTarget) {
    switch (target) {
      case "activity":
        setActivityCommandTab("activity-planner");
        setView("skills");
        return;
      case "activity-skills":
        setActivityCommandTab("my-skills");
        setView("skills");
        return;
      case "isk":
        setView("isk");
        return;
      case "asset-market":
        setAssetCommandTab("market");
        setView("loot");
        return;
      case "asset-wallet-ledger":
        setWalletCommandView("ledger");
        setAssetCommandTab("wallet");
        setView("loot");
        return;
      case "fittings":
        setView("fittings");
        return;
      case "industrial":
        setView("industrial");
        return;
      case "navigation":
        setView("navigation");
        return;
    }
  }

  const allCommandTabsVisited = commandNav.every((item) => visitedCommandViews.has(item.id));
  if (!config) return <div className="boot">Waking New Eden Sage...</div>;
  const active =
    snapshots.find((item) => item.characterId === activeId) ?? snapshots[0];
  const cloneConfirmationRequired = Boolean(
    active && !cloneStates[active.characterId],
  );

  return (
    <div className="app-shell">
      {(!initialSetupComplete && !syncProgress?.running) && (
        <div className="sync-overlay" role="status" aria-live="polite">
          <div className="sync-dialog">
            <span className="pulse" />
            <p className="eyebrow">SETTING UP NEW EDEN SAGE</p>
            <h2>Add your EVE characters</h2>
            <p>Add the EVE characters you want Sage to track, then refresh their private data.</p>
            {!config.primaryCharacterId && (
              <div className="sync-identity-note">
                <strong>Choose your main character first</strong>
                <span>The first character you add becomes your main New Eden Sage account identity. Sage keys that account to the character's permanent EVE Character ID. Every character you add afterwards is linked to that Sage account.</span>
              </div>
            )}
            <div className="sync-setup-actions"><button className="connect sync-add-character" onClick={connect}>+ Add character</button><button className="sync" onClick={() => void refreshPrivateData()} disabled={!snapshots.length}>REFRESH PRIVATE DATA{snapshots.length ? ` (${snapshots.length})` : ""}</button></div>
            <small className="sync-footnote">{snapshots.length ? `${snapshots.length} character${snapshots.length === 1 ? "" : "s"} ready. You can add more before starting.` : "You can add more characters at any time. Sage keeps each character's data separate and refreshes them together."}</small>
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
              <SidebarIcon id={item.id} />
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
                      {config.primaryCharacterId === snapshot.characterId ? " / PRIMARY SAGE ID" : ""}
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
                    <svg className="remove-character-icon" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="sidebar-footer">
          <button
            type="button"
            className={`display-fit-toggle ${fitToMonitor ? "active" : ""}`}
            aria-pressed={fitToMonitor}
            title="Fit Sage to the current monitor and avoid page scrollbars where practical"
            onClick={() => setFitToMonitor((enabled) => !enabled)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="5" width="16" height="11" rx="1.5" />
              <path d="M9 20h6M12 16v4M7 9V7h2M17 9V7h-2M7 12v2h2M17 12v2h-2" />
            </svg>
            <span>
              <strong>FIT TO MONITOR</strong>
              <small>{fitToMonitor ? "Adaptive scale enabled" : "Natural scale"}</small>
            </span>
            <b>{fitToMonitor ? "ON" : "OFF"}</b>
          </button>
          <div className="local-card">
            <span className="pulse" />
            <div>
              <strong>LOCAL-FIRST</strong>
              <small>Secrets stay on this PC</small>
            </div>
          </div>
        </div>
      </aside>
      <main>
        <CharacterCommandHeader
          title={nav.find((item) => item.id === view)?.label ?? "New Eden Sage"}
          subtitle={
            view === "overview"
              ? "Command and control for your capsuleer assets"
              : view === "skills"
                ? "Plan activities, fittings and training for the selected capsuleer"
                : "Unified public and private data controls for this command workspace"
          }
          kicker={view === "overview" ? "COMMAND DECK" : "CAPSULEER INTELLIGENCE"}
          snapshot={active}
          busy={busy}
          privateRefreshing={privateRefreshActive}
          privateProgress={syncProgress?.running ? syncProgress.percent : privateRefreshActive ? 3 : 0}
          marketDataRevision={marketDataRevision}
          onRefreshPrivate={refreshPrivateData}
          onAddCharacter={connect}
          onSupportDeveloper={() => window.sage.openSupportPage()}
        />
        {mountedViews.current.has("overview") && (
          <div className="cached-view" hidden={view !== "overview"}>
            <CharacterCommand
              snapshot={active}
              snapshots={snapshots}
              onConnect={connect}
              active={view === "overview"}
              cloneState={active ? cloneStates[active.characterId] : undefined}
              marketDataRevision={marketDataRevision}
              allCommandTabsVisited={allCommandTabsVisited}
              onNavigate={navigateFromCharacter}
            />
          </div>
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
              activeTab={activityCommandTab}
              onTabChange={setActivityCommandTab}
              initialHullTypeId={plannerHullTypeId}
              initialFitIntent={plannerFitIntent}
            />
          </div>
        )}
        {mountedViews.current.has("isk") && (
          <div className="cached-view" hidden={view !== "isk"}>
            <RetainedIskLab
              snapshot={active}
              active={view === "isk"}
              cloneState={active ? cloneStates[active.characterId] : undefined}
              marketDataRevision={marketDataRevision}
              onMarketDataUpdated={() => setMarketDataRevision((value) => value + 1)}
            />
          </div>
        )}
        {mountedViews.current.has("fittings") && (
          <div className="cached-view" hidden={view !== "fittings"}>
            <RetainedFittingsWorkspace activeCharacterId={activeId} onExportToPlanner={(intent) => { if (intent.characterId) setActiveId(intent.characterId); setPlannerHullTypeId(intent.hullTypeId); setPlannerFitIntent(intent); setActivityCommandTab("planner"); setView("skills"); }} />
          </div>
        )}
        {mountedViews.current.has("loot") && (
          <div className="cached-view" hidden={view !== "loot"}>
            <AssetCommand
              snapshot={active}
              snapshots={snapshots}
              tab={assetCommandTab}
              onTabChange={setAssetCommandTab}
              walletView={walletCommandView}
              onWalletViewChange={setWalletCommandView}
              marketDataRevision={marketDataRevision}
              onMarketDataUpdated={() => setMarketDataRevision((value) => value + 1)}
            />
          </div>
        )}
        {mountedViews.current.has("navigation") && (
          <div className="cached-view" hidden={view !== "navigation"}>
            <RetainedNavigationCommand />
          </div>
        )}
        {mountedViews.current.has("wormholes") && (
          <div className="cached-view" hidden={view !== "wormholes"}>
            <RetainedWormholeCommand snapshots={snapshots} activeCharacterId={active?.characterId} onSelectCharacter={selectCharacter} />
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
        {view === "fleet" && <FleetCommand />}
        <footer>
          <span className="pulse" />
          {message}
          <span className="footer-right">Tranquility / local database</span>
        </footer>
      </main>
    </div>
  );
}


function CharacterCommand({
  snapshot,
  snapshots,
  onConnect,
  active,
  cloneState,
  onNavigate,
  marketDataRevision,
  allCommandTabsVisited,
}: {
  snapshot?: CharacterSnapshot;
  snapshots: CharacterSnapshot[];
  onConnect(): void;
  active: boolean;
  cloneState?: CloneState;
  onNavigate(target: CharacterNavigateTarget): void;
  marketDataRevision: number;
  allCommandTabsVisited: boolean;
}) {
  const [tab, setTab] = useState<CharacterCommandTab>("overview");
  const mountedTabs = useRef(new Set<CharacterCommandTab>(["overview"]));
  mountedTabs.current.add(tab);
  const [publicDataRevision, setPublicDataRevision] = useState(0);
  const publicDataDirty = useRef(false);
  const consumesPublicMarket = active && (tab === "augments" || tab === "lp-store");
  useEffect(() => window.sage.onPreparedDataUpdated((value) => {
    if (!value.publicDataUpdated) return;
    if (consumesPublicMarket) {
      publicDataDirty.current = false;
      setPublicDataRevision((revision) => revision + 1);
    } else {
      publicDataDirty.current = true;
    }
  }), [consumesPublicMarket]);
  const pendingPublicRevision = consumesPublicMarket && publicDataDirty.current ? 1 : 0;
  const effectiveMarketDataRevision = marketDataRevision + publicDataRevision + pendingPublicRevision;
  useEffect(() => {
    if (!pendingPublicRevision) return;
    publicDataDirty.current = false;
    setPublicDataRevision((revision) => revision + 1);
  }, [pendingPublicRevision]);
  return (
    <section className="command-workspace character-command">
      <div className="command-subtabs" role="tablist" aria-label="Character Command sections">
        <button type="button" className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Character</button>
        <button type="button" className={tab === "queue" ? "active" : ""} onClick={() => setTab("queue")}>Queue</button>
        <button type="button" className={tab === "augments" ? "active" : ""} onClick={() => setTab("augments")}>Augments</button>
        <button type="button" className={tab === "killmails" ? "active" : ""} onClick={() => setTab("killmails")}>Killmails</button>
        <button type="button" className={tab === "lp-store" ? "active" : ""} onClick={() => setTab("lp-store")}>LP Store</button>
      </div>
      {mountedTabs.current.has("lp-store") && (
        <div className="cached-view" hidden={tab !== "lp-store"}>
          <LpStore
            snapshot={snapshot}
            marketDataRevision={effectiveMarketDataRevision}
            onOpenShoppingList={() => onNavigate("asset-market")}
            onOpenIndustry={() => onNavigate("industrial")}
          />
        </div>
      )}
      <div className="cached-view" hidden={tab !== "overview"}>
        <RetainedOverview snapshot={snapshot} onConnect={onConnect} cloneState={cloneState} onNavigate={onNavigate} allCommandTabsVisited={allCommandTabsVisited} />
      </div>
      {mountedTabs.current.has("queue") && (
        <div className="cached-view" hidden={tab !== "queue"}>
          <CharacterQueue snapshot={snapshot} />
        </div>
      )}
      {mountedTabs.current.has("augments") && (
        <div className="cached-view" hidden={tab !== "augments"}>
          <AugmentsGuide snapshot={snapshot} marketDataRevision={effectiveMarketDataRevision} />
        </div>
      )}
      {mountedTabs.current.has("killmails") && (
        <div className="cached-view" hidden={tab !== "killmails"}>
          <KillmailsCommand snapshots={snapshots} />
        </div>
      )}
    </section>
  );
}

function AssetCommand({
  snapshot,
  snapshots,
  tab,
  onTabChange,
  walletView,
  onWalletViewChange,
  marketDataRevision,
  onMarketDataUpdated,
}: {
  snapshot?: CharacterSnapshot;
  snapshots: CharacterSnapshot[];
  tab: AssetCommandTab;
  onTabChange(tab: AssetCommandTab): void;
  walletView: WalletCommandView;
  onWalletViewChange(view: WalletCommandView): void;
  marketDataRevision: number;
  onMarketDataUpdated(): void;
}) {
  const mountedTabs = useRef(new Set<AssetCommandTab>([tab]));
  mountedTabs.current.add(tab);
  return (
    <section className="command-workspace asset-command">
      <div className="command-subtabs" role="tablist" aria-label="Asset Command sections">
        <button type="button" className={tab === "loot" ? "active" : ""} onClick={() => onTabChange("loot")}>Loot Sources</button>
        <button type="button" className={tab === "assets" ? "active" : ""} onClick={() => onTabChange("assets")}>Assets</button>
        <button type="button" className={tab === "market" ? "active" : ""} onClick={() => onTabChange("market")}>Market</button>
        <button type="button" className={tab === "wallet" ? "active" : ""} onClick={() => onTabChange("wallet")}>Wallet</button>
      </div>
      {mountedTabs.current.has("loot") && <div className="cached-view" hidden={tab !== "loot"}><RetainedLoot /></div>}
      {mountedTabs.current.has("assets") && <div className="cached-view" hidden={tab !== "assets"}><RetainedAssetsCommand snapshots={snapshots} /></div>}
      {mountedTabs.current.has("market") && (
        <div className="cached-view" hidden={tab !== "market"}>
          <RetainedMarketWorkspace snapshot={snapshot} marketDataRevision={marketDataRevision} onMarketDataUpdated={onMarketDataUpdated} />
        </div>
      )}
      {mountedTabs.current.has("wallet") && <div className="cached-view" hidden={tab !== "wallet"}><WalletCommand snapshot={snapshot} snapshots={snapshots} walletView={walletView} onWalletViewChange={onWalletViewChange} /></div>}
    </section>
  );
}

function WalletCommand({ snapshot, snapshots, walletView, onWalletViewChange }: { snapshot?: CharacterSnapshot; snapshots: CharacterSnapshot[]; walletView: WalletCommandView; onWalletViewChange(view: WalletCommandView): void }) {
  const [records,setRecords]=useState<ProfitLedgerRecord[]>([]);
  const [ledgerStatus,setLedgerStatus]=useState("");
  const [expandedKey,setExpandedKey]=useState("");
  const [selectedTransactionKeys,setSelectedTransactionKeys]=useState<Set<string>>(new Set());
  const [review,setReview]=useState<ProfitReconciliationReview|null>(null);
  const [purchaseReview,setPurchaseReview]=useState<ProfitPurchaseReview|null>(null);
  const [typeNames,setTypeNames]=useState<Record<number,string>>({});
  const [liveSnapshots,setLiveSnapshots]=useState<CharacterSnapshot[]>(snapshots);

  useEffect(()=>setLiveSnapshots(snapshots),[snapshots]);
  const activeSnapshot=snapshot ? (liveSnapshots.find((item)=>item.characterId===snapshot.characterId)??snapshot) : undefined;
  const loadLedger=()=>window.sage.getProfitLedger().then(setRecords).catch((error)=>setLedgerStatus(error instanceof Error?error.message:"Profit history unavailable."));

  useEffect(()=>{
    void loadLedger();
    const refresh=()=>void loadLedger();
    window.addEventListener("sage:profit-ledger-updated",refresh);
    const unsubscribeWallet=window.sage.onWalletReconciled(()=>{
      void loadLedger();
      void window.sage.listSnapshots().then(setLiveSnapshots).catch(()=>undefined);
    });
    return()=>{window.removeEventListener("sage:profit-ledger-updated",refresh);unsubscribeWallet();};
  },[]);

  useEffect(()=>{
    const rows=activeSnapshot?.extended?.walletTransactions??[];
    const ids=[...new Set(rows.map((row)=>Number(row.type_id)).filter((id)=>Number.isSafeInteger(id)&&id>0))];
    if(!ids.length){setTypeNames({});return;}
    let cancelled=false;
    void window.sage.resolveTypeIds(ids).then((resolved)=>{
      if(cancelled)return;
      setTypeNames(Object.fromEntries(resolved.map((item)=>[Number(item.id),String(item.name)])));
    }).catch(()=>{if(!cancelled)setTypeNames({});});
    return()=>{cancelled=true;};
  },[activeSnapshot?.characterId,activeSnapshot?.extended?.walletTransactions]);

  if (!activeSnapshot) return <section className="empty"><p className="eyebrow">NO CAPSULEER SELECTED</p><h2>Connect a character to view Wallet</h2></section>;

  const totalWallet = liveSnapshots.reduce((sum, item) => sum + Number(item.wallet || 0), 0);
  const profitOf=(row:ProfitLedgerRecord)=>row.actualProfit??row.estimatedProfit;
  const selectedRows=records.filter((row)=>row.characterId===activeSnapshot.characterId);
  const selectedProfit=selectedRows.reduce((sum,row)=>sum+profitOf(row),0);
  const allProfit=records.reduce((sum,row)=>sum+profitOf(row),0);
  const actualCount=records.filter((row)=>row.reconciliationStatus==="exact").length;
  const walletRows=[...(activeSnapshot.extended?.walletTransactions??[])].sort((a,b)=>Date.parse(String(b.date??0))-Date.parse(String(a.date??0))||Number(b.transaction_id)-Number(a.transaction_id));
  const ledgerTransactions=selectedRows.flatMap((record)=>(record.allocations??[]).map((allocation)=>({key:record.id+":"+allocation.walletTransactionId,record,allocation}))).sort((a,b)=>Date.parse(String(b.allocation.transactionDate??b.record.completedAt))-Date.parse(String(a.allocation.transactionDate??a.record.completedAt))||b.allocation.walletTransactionId-a.allocation.walletTransactionId);
  const pendingRows=selectedRows.filter((row)=>!(row.allocations?.length));

  function taxSaving(rows:ProfitLedgerRecord[]){
    const maxModifier=1-(0.11*5);
    return rows.reduce((sum,row)=>{
      const actualTax=Math.max(0,Number(row.actualTax??0));
      if(!actualTax||!(row.walletJournalIds?.length))return sum;
      const owner=liveSnapshots.find((item)=>item.characterId===row.characterId);
      const level=Math.max(0,Math.min(5,Number(owner?.skills?.skills?.find((skill)=>Number(skill.skill_id)===16622)?.trained_skill_level??0)));
      const currentModifier=1-(0.11*level);
      if(currentModifier<=0)return sum;
      return sum+Math.max(0,actualTax-(actualTax*(maxModifier/currentModifier)));
    },0);
  }
  const selectedTaxSaving=taxSaving(selectedRows);
  const allTaxSaving=taxSaving(records);

  async function reconcile(){
    setLedgerStatus("Reconciling against synced EVE wallet history...");
    try{setRecords(await window.sage.reconcileProfitLedger());setLedgerStatus("Reconciled using the wallet history already synced into Sage.");}
    catch(error){setLedgerStatus(error instanceof Error?error.message:"Reconciliation failed.");}
  }
  async function remove(id:string){await window.sage.removeProfitLedgerRecord(id);if(review?.recordId===id)setReview(null);if(purchaseReview?.recordId===id)setPurchaseReview(null);await loadLedger();}
  async function reviewMatches(id:string){
    if(review?.recordId===id){setReview(null);return;}
    setLedgerStatus("Loading compatible synced wallet sales...");
    try{const next=await window.sage.getProfitReconciliationReview(id);setReview(next);setLedgerStatus(next.candidates.length?"Compatible post-production sales loaded. Assigned transactions become persistent evidence.":"No post-production sales for this item are available in synced wallet history.");}
    catch(error){setLedgerStatus(error instanceof Error?error.message:"Could not load wallet candidates.");}
  }
  async function setTransactionOverride(recordId:string,walletTransactionId:number,assigned:boolean){
    setLedgerStatus(assigned?"Assigning wallet transaction...":"Releasing wallet transaction...");
    try{const result=await window.sage.setProfitTransactionOverride({recordId,walletTransactionId,assigned});setReview(result.review);await loadLedger();setLedgerStatus(assigned?"Wallet transaction assigned as explicit evidence.":"Wallet transaction released.");}
    catch(error){setLedgerStatus(error instanceof Error?error.message:"Could not update wallet assignment.");}
  }
  async function decideMatch(recordId:string,walletTransactionId:number,decision:"confirmed"|"rejected"){
    setLedgerStatus(decision==="confirmed"?"Confirming Sage production match...":"Rejecting Sage production match...");
    try{await window.sage.setProfitMatchDecision({recordId,walletTransactionId,decision});if(decision==="rejected")setExpandedKey("");await loadLedger();setLedgerStatus(decision==="confirmed"?"Production match confirmed and locked as strong evidence.":"Production match rejected. Sage will not recreate the same allocation without new evidence.");}
    catch(error){setLedgerStatus(error instanceof Error?error.message:"Could not update production match.");}
  }
  async function moveMatch(fromRecordId:string,toRecordId:string,walletTransactionId:number){
    setLedgerStatus("Moving this sale to the selected production lot...");
    try{
      await window.sage.setProfitMatchDecision({recordId:fromRecordId,walletTransactionId,decision:"rejected"});
      const assigned=await window.sage.setProfitTransactionOverride({recordId:toRecordId,walletTransactionId,assigned:true});
      if(assigned.record.allocations?.some((allocation)=>Number(allocation.walletTransactionId)===walletTransactionId))await window.sage.setProfitMatchDecision({recordId:toRecordId,walletTransactionId,decision:"confirmed"});
      setExpandedKey("");await loadLedger();setLedgerStatus("Sale moved to the chosen production lot and preserved as explicit evidence.");
    }catch(error){setLedgerStatus(error instanceof Error?error.message:"Could not move this sale to the selected lot.");}
  }
  async function setProvenance(row:ProfitLedgerRecord,field:"mined"|"donated"|"owned"|"bought"){
    const current=row.materialProvenance??{mined:false,donated:false,owned:false,bought:false};
    const next={mined:Boolean(current.mined),donated:Boolean(current.donated),owned:Boolean(current.owned),bought:Boolean(current.bought),[field]:!current[field]};
    setLedgerStatus("Updating material bookkeeping...");
    try{await window.sage.setProfitMaterialProvenance({recordId:row.id,...next});await loadLedger();setLedgerStatus("Material provenance saved; dependent profit totals were recalculated.");}
    catch(error){setLedgerStatus(error instanceof Error?error.message:"Could not update material bookkeeping.");}
  }
  async function reviewPurchases(recordId:string){
    if(purchaseReview?.recordId===recordId){setPurchaseReview(null);return;}
    setLedgerStatus("Loading material purchase candidates...");
    try{const next=await window.sage.getProfitPurchaseReview(recordId);setPurchaseReview(next);setLedgerStatus(next.candidates.length?"Material purchase candidates loaded from the production BOM and wallet chronology.":"No matching pre-production wallet purchases were found.");}
    catch(error){setLedgerStatus(error instanceof Error?error.message:"Could not review material purchases.");}
  }
  async function setPurchaseOverride(recordId:string,walletTransactionId:number,assigned:boolean){
    setLedgerStatus(assigned?"Assigning material purchase...":"Rejecting material purchase match...");
    try{const result=await window.sage.setProfitPurchaseTransactionOverride({recordId,walletTransactionId,assigned});setPurchaseReview(result.review);await loadLedger();setLedgerStatus(assigned?"Material purchase assigned to this production lot.":"Material purchase rejected for this lot and reserved from immediate rematching.");}
    catch(error){setLedgerStatus(error instanceof Error?error.message:"Could not update material purchase match.");}
  }
  function toggleSelected(key:string){setSelectedTransactionKeys((current)=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next;});}
  async function bulkDecide(decision:"confirmed"|"rejected"){
    const picked=ledgerTransactions.filter((entry)=>selectedTransactionKeys.has(entry.key));
    if(!picked.length)return;
    setLedgerStatus((decision==="confirmed"?"Confirming ":"Rejecting ")+picked.length+" selected transaction matches...");
    try{
      await window.sage.applyProfitBulkBookkeeping({recordIds:[...new Set(picked.map((entry)=>entry.record.id))],transactionDecisions:picked.map((entry)=>({recordId:entry.record.id,walletTransactionId:entry.allocation.walletTransactionId,decision}))});
      setSelectedTransactionKeys(new Set());setExpandedKey("");await loadLedger();setLedgerStatus("Bulk transaction decisions saved with per-transaction audit evidence.");
    }catch(error){setLedgerStatus(error instanceof Error?error.message:"Bulk transaction update failed.");}
  }
  async function bulkProvenance(provenance:{mined:boolean;donated:boolean;owned:boolean;bought:boolean},label:string){
    const picked=ledgerTransactions.filter((entry)=>selectedTransactionKeys.has(entry.key));
    const recordIds=[...new Set(picked.filter((entry)=>entry.record.source==="industry").map((entry)=>entry.record.id))];
    if(!recordIds.length){setLedgerStatus("Select at least one Industry ledger transaction for material bookkeeping.");return;}
    setLedgerStatus("Applying "+label+" provenance to selected production records...");
    try{await window.sage.applyProfitBulkBookkeeping({recordIds,provenance});await loadLedger();setLedgerStatus("Bulk provenance saved without collapsing the individual transaction audit trail.");}
    catch(error){setLedgerStatus(error instanceof Error?error.message:"Bulk material update failed.");}
  }
  function alternateLots(record:ProfitLedgerRecord,walletTransactionId:number,transactionDate?:string){
    const typeId=Number(record.items?.[0]?.typeId??0),saleAt=Date.parse(String(transactionDate??""));
    return selectedRows.filter((candidate)=>{
      if(candidate.id===record.id||candidate.source!=="industry"||!candidate.items.some((item)=>Number(item.typeId)===typeId))return false;
      const completed=Date.parse(String(candidate.metadata?.productionCompletedAt??candidate.completedAt));if(Number.isFinite(saleAt)&&Number.isFinite(completed)&&completed>saleAt)return false;
      const rejected=Array.isArray(candidate.metadata?.rejectedWalletTransactionIds)?candidate.metadata.rejectedWalletTransactionIds.map(Number):[];if(rejected.includes(walletTransactionId))return false;
      const produced=candidate.items.reduce((sum,item)=>sum+Math.max(0,Number(item.quantity)||0),0),allocated=(candidate.allocations??[]).reduce((sum,item)=>sum+Math.max(0,Number(item.quantityAllocated)||0),0);
      return produced>allocated;
    }).sort((a,b)=>Date.parse(a.completedAt)-Date.parse(b.completedAt));
  }

  return (
    <section className="wallet-command-page">
      <header className="wallet-command-head"><div><p className="eyebrow">SYNCED WALLET INTELLIGENCE</p><h2>{activeSnapshot.character.name}</h2><p>Balances plus realised Sage opportunity profit. Actual sale/tax values are used when synced wallet evidence can be matched safely.</p></div><strong>{money(activeSnapshot.wallet)} ISK</strong></header>
      <div className="wallet-command-summary">
        <article><span>Active character</span><strong>{money(activeSnapshot.wallet)} ISK</strong><small>{activeSnapshot.character.name}</small></article>
        <article><span>Connected total</span><strong>{money(totalWallet)} ISK</strong><small>Across synced characters</small></article>
        <article className="wallet-profit-total"><span>Sage profit — selected</span><strong>{selectedProfit>=0?"+":""}{money(selectedProfit)} ISK</strong><small>{selectedRows.length} completed deal{selectedRows.length===1?"":"s"}</small></article>
        <article className="wallet-profit-total"><span>Sage profit — all characters</span><strong>{allProfit>=0?"+":""}{money(allProfit)} ISK</strong><small>{actualCount} wallet-matched · {records.length} recorded</small></article>
        <article className="wallet-tax-saving"><span>MAX TAX SKILL SAVING</span><strong>+{money(selectedTaxSaving)} ISK</strong><small>Potential tax saved at Accounting V · all connected +{money(allTaxSaving)} ISK</small></article>
      </div>

      <section className="wallet-profit-ledger">
        <div className="wallet-view-tabs" role="tablist" aria-label="Wallet views">
          <button type="button" className={walletView==="full"?"active":""} onClick={()=>onWalletViewChange("full")}><strong>Full Wallet</strong><small>Complete synced transaction history</small></button>
          <button type="button" className={walletView==="ledger"?"active":""} onClick={()=>onWalletViewChange("ledger")}><strong>Ledger</strong><small>Sage-related reconciled activity only</small></button>
        </div>
        {ledgerStatus&&<div className="wallet-ledger-status">{ledgerStatus}</div>}

        {walletView==="full"&&<div className="wallet-full-wallet">
          <div className="section-heading"><div><p className="eyebrow">FULL WALLET</p><h3>{activeSnapshot.character.name} transaction history</h3><p>All synced character wallet buys and sells. This view is not filtered by Sage bookkeeping.</p></div><strong>{walletRows.length.toLocaleString()} transactions</strong></div>
          <div className="wallet-full-table">
            <div className="wallet-full-row heading"><span>Date</span><span>Transaction</span><span>Quantity</span><span>Unit price</span><span>Total</span></div>
            {walletRows.map((row)=><div className="wallet-full-row" key={row.transaction_id}>
              <span>{row.date?new Date(row.date).toLocaleString():"Unknown"}</span>
              <span><strong>{typeNames[Number(row.type_id)]??("Type "+row.type_id)}</strong><small className={row.is_buy?"buy":"sell"}>{row.is_buy?"BUY":"SELL"} · #{row.transaction_id}</small></span>
              <span>{Number(row.quantity??0).toLocaleString()}</span>
              <span>{money(Number(row.unit_price??0))} ISK</span>
              <strong className={row.is_buy?"negative":"positive"}>{row.is_buy?"−":"+"}{money(Math.abs(Number(row.quantity??0)*Number(row.unit_price??0)))} ISK</strong>
            </div>)}
            {!walletRows.length&&<div className="empty-panel">No synced wallet transactions are available for this character yet.</div>}
          </div>
        </div>}

        {walletView==="ledger"&&<div className="wallet-sage-ledger">
          <div className="section-heading"><div><p className="eyebrow">SAGE LEDGER</p><h3>Reconciled Sage transactions</h3><p>Only wallet sales Sage currently links to Sage-assisted activity are shown here. Click a transaction to expand its bookkeeping directly underneath it.</p></div><button type="button" onClick={()=>void reconcile()}>Reconcile now</button></div>

          {selectedTransactionKeys.size>0&&<div className="wallet-bulk-toolbar">
            <strong>{selectedTransactionKeys.size} transaction{selectedTransactionKeys.size===1?"":"s"} selected</strong>
            <div><button type="button" onClick={()=>void bulkDecide("confirmed")}>Confirm matches</button><button type="button" onClick={()=>void bulkDecide("rejected")}>Reject matches</button></div>
            <div className="wallet-bulk-materials"><span>Materials:</span><button type="button" onClick={()=>void bulkProvenance({mined:true,donated:false,owned:false,bought:false},"mined")}>Mined</button><button type="button" onClick={()=>void bulkProvenance({mined:false,donated:true,owned:false,bought:false},"donated")}>Donated</button><button type="button" onClick={()=>void bulkProvenance({mined:false,donated:false,owned:true,bought:false},"owned")}>Owned</button><button type="button" onClick={()=>void bulkProvenance({mined:false,donated:false,owned:false,bought:true},"bought")}>Bought</button><button type="button" onClick={()=>void bulkProvenance({mined:true,donated:false,owned:false,bought:true},"mixed")}>Mixed</button></div>
          </div>}

          <div className="wallet-ledger-transactions">
            {ledgerTransactions.map(({key,record,allocation})=>{
              const item=record.items?.[0];
              const productionLotId=String(record.metadata?.productionLotId??record.sourceKey??record.id);
              const confirmedIds=Array.isArray(record.metadata?.confirmedWalletTransactionIds)?record.metadata.confirmedWalletTransactionIds.map(Number):[];
              const isConfirmed=confirmedIds.includes(Number(allocation.walletTransactionId));
              const expanded=expandedKey===key;
              const alternatives=alternateLots(record,allocation.walletTransactionId,allocation.transactionDate);
              const provenance=record.materialProvenance??{mined:false,donated:false,owned:false,bought:false};
              return <article className={`wallet-ledger-entry ${record.reconciliationStatus}`} key={key}>
                <div className="wallet-ledger-transaction-row">
                  <label className="wallet-ledger-select" title="Select transaction for bulk bookkeeping"><input type="checkbox" checked={selectedTransactionKeys.has(key)} onChange={()=>toggleSelected(key)}/></label>
                  <button type="button" className="wallet-ledger-transaction-main" onClick={()=>setExpandedKey(expanded?"":key)}>
                    <span><small>{allocation.transactionDate?new Date(allocation.transactionDate).toLocaleString():new Date(record.completedAt).toLocaleString()}</small><strong>{item?.name??record.title} × {allocation.quantityAllocated.toLocaleString()}</strong></span>
                    <span><small>{record.source.replaceAll("-"," ")} · {record.characterName}</small><strong>{productionLotId}</strong></span>
                  </button>
                  <button type="button" className="wallet-ledger-transaction-amount" onClick={()=>setExpandedKey(expanded?"":key)}><strong>+{money(allocation.revenue)} ISK</strong><small>{isConfirmed?"PLAYER CONFIRMED":allocation.confidence==="strong"?"STRONG MATCH":"SAGE PROPOSAL"}</small></button>
                </div>

                {expanded&&<div className="wallet-ledger-inline">
                  <div className="wallet-ledger-proposal">
                    <div><p className="eyebrow">SAGE'S PROPOSED MATCH</p><h4>Sage believes this transaction came from:</h4><strong>{productionLotId}</strong><span>{record.title}</span><small>Completed {new Date(String(record.metadata?.productionCompletedAt??record.completedAt)).toLocaleString()} · {allocation.evidence}</small></div>
                    <div className="wallet-match-decision"><strong>{isConfirmed?"Match confirmed":"Is this correct?"}</strong><div><button type="button" className={isConfirmed?"active":""} onClick={()=>void decideMatch(record.id,allocation.walletTransactionId,"confirmed")}>Yes</button><button type="button" onClick={()=>void decideMatch(record.id,allocation.walletTransactionId,"rejected")}>No</button></div></div>
                  </div>

                  {alternatives.length>0&&<div className="wallet-alternate-lots"><strong>Other eligible production lots</strong><small>If Sage picked the wrong run, move this exact wallet transaction without losing its identity.</small><div>{alternatives.slice(0,6).map((candidate)=><button type="button" key={candidate.id} onClick={()=>void moveMatch(record.id,candidate.id,allocation.walletTransactionId)}><span>{String(candidate.metadata?.productionLotId??candidate.sourceKey)}</span><small>{candidate.title} · completed {new Date(candidate.completedAt).toLocaleDateString()}</small></button>)}</div></div>}

                  {record.source==="industry"&&<div className="wallet-material-bookkeeping">
                    <div><p className="eyebrow">MATERIAL PROVENANCE</p><h4>How were the materials obtained?</h4><small>Multiple choices can be active for mixed production. These choices alter the actual ledger totals, not just the notes.</small></div>
                    <div className="wallet-provenance-options">
                      {([['mined','Mined'],['donated','Donated'],['owned','Already owned'],['bought','Bought']] as const).map(([field,label])=><button type="button" key={field} className={provenance[field]?"active":""} onClick={()=>void setProvenance(record,field)}><strong>{label}</strong><small>{provenance[field]?"YES":"NO"}</small></button>)}
                    </div>
                    <div className="wallet-profit-basis">
                      <article><span>Cash profit</span><strong className={(record.cashProfit??record.actualProfit??0)>=0?"positive":"negative"}>{record.cashProfit??record.actualProfit??null==null?"—":((record.cashProfit??record.actualProfit??0)>=0?"+":"")+money(record.cashProfit??record.actualProfit??0)+" ISK"}</strong><small>Actual bought materials + job costs · non-cash materials have zero acquisition outflow</small></article>
                      <article><span>Economic profit</span><strong className={(record.economicProfit??0)>=0?"positive":"negative"}>{record.economicProfit==null?"—":(record.economicProfit>=0?"+":"")+money(record.economicProfit)+" ISK"}</strong><small>All consumed materials valued at the frozen production-time reference value</small></article>
                    </div>
                    {provenance.bought&&<div className="wallet-purchase-matches">
                      <div className="wallet-purchase-head"><span><strong>Attributed material purchases</strong><small>{record.purchaseAllocations?.length??0} wallet purchase match{(record.purchaseAllocations?.length??0)===1?"":"es"} · {money(record.cashMaterialCost??0)} ISK cash material cost</small></span><button type="button" onClick={()=>void reviewPurchases(record.id)}>{purchaseReview?.recordId===record.id?"Close purchase review":"Review purchases"}</button></div>
                      {(record.purchaseAllocations??[]).map((purchase)=><div className="wallet-purchase-allocation" key={purchase.walletTransactionId}><span><strong>{purchase.materialName} × {purchase.quantityAllocated.toLocaleString()}</strong><small>{purchase.transactionDate?new Date(purchase.transactionDate).toLocaleString():"Unknown date"} · #{purchase.walletTransactionId}</small></span><strong>{money(purchase.cost)} ISK</strong></div>)}
                      {purchaseReview?.recordId===record.id&&<div className="wallet-purchase-candidates">{purchaseReview.candidates.map((candidate)=><div key={candidate.walletTransactionId} className={candidate.selected?"selected":""}><span><strong>{candidate.materialName} × {candidate.quantity.toLocaleString()}</strong><small>{new Date(candidate.date).toLocaleString()} · {candidate.walletScope==="corporation"?"Corp wallet "+(candidate.walletDivision??""):"Character wallet"}</small></span><span><strong>{money(candidate.unitPrice)} ISK/unit</strong><small>{money(candidate.cost)} ISK total</small></span><button type="button" disabled={candidate.reservedByOther&&!candidate.selected} onClick={()=>void setPurchaseOverride(record.id,candidate.walletTransactionId,!candidate.selected)}>{candidate.selected?"Reject purchase":candidate.reservedByOther?"Owned elsewhere":"Assign purchase"}</button></div>)}</div>}
                    </div>}
                  </div>}

                  <div className="wallet-ledger-inline-footer"><button type="button" onClick={()=>void reviewMatches(record.id)}>{review?.recordId===record.id?"Close sale candidates":"Review alternate sale evidence"}</button><button type="button" onClick={()=>void remove(record.id)}>Undo / remove Sage record</button></div>
                  {review?.recordId===record.id&&<div className="wallet-ledger-review"><div className="wallet-ledger-review-head"><span><strong>Compatible sale evidence</strong><small>Only post-completion sales of the correct item are shown. A transaction already owned elsewhere cannot be stolen.</small></span><b>{review.candidates.length} candidate{review.candidates.length===1?"":"s"}</b></div>{review.candidates.length?<div className="wallet-ledger-review-list">{review.candidates.map((candidate)=><div key={candidate.walletTransactionId} className={candidate.selected?"selected":""}><span><strong>{candidate.itemName} × {candidate.quantity.toLocaleString()}</strong><small>{candidate.date?new Date(candidate.date).toLocaleString():"Unknown time"} · {candidate.walletScope==="corporation"?"Corp wallet "+(candidate.walletDivision??""):"Character wallet"}</small></span><span><strong>{money(candidate.unitPrice)} ISK/unit</strong><small>{money(candidate.revenue)} ISK gross{candidate.priceCompatible?"":" · outside expected price band"}</small></span><button type="button" disabled={candidate.reservedByOther&&!candidate.selected} onClick={()=>void setTransactionOverride(record.id,candidate.walletTransactionId,!candidate.selected)}>{candidate.selected?"Release":candidate.reservedByOther?"Owned elsewhere":"Assign sale"}</button></div>)}</div>:<div className="wallet-ledger-review-empty">No compatible post-completion sales are currently in synced wallet history.</div>}</div>}
                </div>}
              </article>;
            })}
            {!ledgerTransactions.length&&<div className="empty-panel">No wallet transactions are currently linked to Sage activity for this character.</div>}
          </div>

          {pendingRows.length>0&&<div className="wallet-pending-ledger"><div><p className="eyebrow">AWAITING RECONCILIATION</p><h4>{pendingRows.length} Sage record{pendingRows.length===1?"":"s"} not yet linked to a wallet sale</h4></div>{pendingRows.map((row)=><div key={row.id}><span><strong>{row.title}</strong><small>{String(row.metadata?.productionLotId??row.sourceKey)} · completed {new Date(row.completedAt).toLocaleString()}</small></span><button type="button" onClick={()=>void reviewMatches(row.id)}>{review?.recordId===row.id?"Close candidates":"Review sale candidates"}</button>{review?.recordId===row.id&&<div className="wallet-ledger-review pending">{review.candidates.map((candidate)=><div key={candidate.walletTransactionId}><span><strong>{candidate.itemName} × {candidate.quantity.toLocaleString()}</strong><small>{new Date(candidate.date).toLocaleString()} · {money(candidate.revenue)} ISK</small></span><button type="button" disabled={candidate.reservedByOther} onClick={()=>void setTransactionOverride(row.id,candidate.walletTransactionId,true)}>{candidate.reservedByOther?"Owned elsewhere":"Assign sale"}</button></div>)}</div>}</div>)}</div>}
        </div>}
      </section>

      <section className="wallet-character-panel"><div className="section-heading"><div><p className="eyebrow">CHARACTER WALLETS</p><h3>Connected balances</h3></div></div><div className="wallet-character-list">{liveSnapshots.map((item)=><div key={item.characterId} className={item.characterId===activeSnapshot.characterId?"active":""}><span><strong>{item.character.name}</strong><small>{item.character.corporation_name??"EVE character"}</small></span><strong>{money(item.wallet)} ISK</strong></div>)}</div></section>
    </section>
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
  const label = state.status === "available" ? "Download update" : state.status === "downloading" ? `Downloading ${progress}%` : state.status === "downloaded" ? "Restart to update" : state.status === "checking" ? "Checking\u2026" : state.status === "current" ? `Up to date \u00b7 v${version}` : state.status === "error" ? "Update failed \u00b7 retry" : `Check updates \u00b7 v${version}`;
  return <button className="update-control" onClick={act} disabled={state.status === "checking" || state.status === "downloading"} title={state.status === "error" ? String(state.detail) : "Install the latest full Sage release from GitHub"}>{label}</button>;
}

function MarketWorkspace({ snapshot }: { snapshot?: CharacterSnapshot; marketDataRevision: number; onMarketDataUpdated: () => void }) {
  return <MarketWorkspaceV2 snapshot={snapshot} />;
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
                <strong>{name ?? "Resolving implant name..."}</strong>
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
  allCommandTabsVisited,
}: {
  snapshot?: CharacterSnapshot;
  onConnect(): void;
  cloneState?: CloneState;
  onNavigate(target: CharacterNavigateTarget): void;
  allCommandTabsVisited: boolean;
}) {
  if (!snapshot)
    return (
      <section className="empty">
        <div className="orb">*</div>
        <p className="eyebrow">AWAITING CAPSULEER</p>
        <h2>Connect your first character</h2>
        <p>Authorize through EVE Online to build your private command dashboard.</p>
        <button className="primary" onClick={onConnect}>Log in with EVE Online</button>
      </section>
    );
  return <CharacterOverviewHud snapshot={snapshot} cloneState={cloneState} onNavigate={onNavigate} allCommandTabsVisited={allCommandTabsVisited} />;
}

const RetainedOverview = memo(Overview, (a, b) => a.snapshot === b.snapshot && a.cloneState === b.cloneState && a.allCommandTabsVisited === b.allCommandTabsVisited);

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
            {money(snapshot.skills.total_sp)} total skill points /{" "}
            {snapshot.skills.skills.length} trained skills
          </p>
        </div>
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter skills..."
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
              <small>Rank {skill.rank ?? "-"}</small>
            </span>
            <span className="level">
              {"\u25cf".repeat(skill.trained_skill_level)}
              {"\u25cb".repeat(5 - skill.trained_skill_level)}
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
  const [claudeBusy, setClaudeBusy] = useState(false);
  useEffect(() => {
    void window.sage.getMcpSetup().then(setMcpSetup);
    void window.sage.getMcpTunnelStatus().then((value) => { setTunnelId(value.tunnelId); setTunnelReady(value.ready); });
    void window.sage.getClaudeMcpStatus().then(setClaudeStatus);
  }, []);
  useEffect(() => {
    const desktop = claudeStatus?.desktop;
    if (!desktop || desktop.verified || (!desktop.installPending && !desktop.extensionInstalled && !desktop.directConfigPresent)) return;
    const timer = window.setInterval(() => { void window.sage.getClaudeMcpStatus().then((next) => { setClaudeStatus(next); if (next.desktop.verified) setMcpMessage("Claude Desktop connection verified: Sage initialized and tools were listed."); }).catch(() => undefined); }, 3000);
    return () => window.clearInterval(timer);
  }, [claudeStatus?.desktop.installPending, claudeStatus?.desktop.extensionInstalled, claudeStatus?.desktop.directConfigPresent, claudeStatus?.desktop.verified]);
  async function copyMcp(value: string, label: string) {
    await window.sage.copyText(value);
    setMcpMessage(`${label} copied.`);
  }
  async function verifyClaude() {
    setClaudeBusy(true);
    setMcpMessage("Checking Claude Desktop MCP connection...");
    try {
      const status = await window.sage.getClaudeMcpStatus();
      setClaudeStatus(status);
      setMcpMessage(status.desktop.verified ? "Claude Desktop connection verified: Sage initialized and tools were listed." : status.desktop.restartRequired ? "Claude has the direct config but has not loaded it yet. Fully quit and reopen Claude Desktop, then verify again." : status.desktop.installPending ? "Finish the extension install/approval in Claude Desktop, then verify again." : "Claude Desktop has not yet produced a verified Sage MCP connection.");
    } catch (error) { setMcpMessage(error instanceof Error ? error.message : "Could not verify Claude integration."); }
    finally { setClaudeBusy(false); }
  }
  async function repairClaude() {
    setClaudeBusy(true);
    setMcpMessage("Preparing the supported New Eden Sage Claude Desktop Extension...");
    try {
      const status = await window.sage.repairClaudeMcp();
      setClaudeStatus(status);
      const desktop = !status.desktop.detected ? "Claude Desktop not detected." : status.desktop.manualInstallRequired ? "Windows could not open the MCPB in Claude automatically. Use the manual install steps shown in the Claude card." : status.desktop.installPending ? "Claude should now be showing the New Eden Sage extension confirmation. Approve the install there." : status.desktop.verified ? "Claude Desktop is connected and verified." : "Claude Desktop extension prepared.";
      const code = status.code.detected ? (status.code.configured ? "Claude Code is configured." : "Claude Code needs attention.") : "Claude Code is not installed.";
      setMcpMessage(`${desktop} ${code}`);
    } catch (error) { setMcpMessage(error instanceof Error ? error.message : "Could not install/repair Claude integration."); }
    finally { setClaudeBusy(false); }
  }
  async function showClaudeBundle() {
    setClaudeBusy(true);
    try { const bundle = await window.sage.showClaudeMcpBundle(); setMcpMessage(`Claude MCPB highlighted: ${bundle}`); }
    catch (error) { setMcpMessage(error instanceof Error ? error.message : "Could not show the Claude MCPB file."); }
    finally { setClaudeBusy(false); }
  }
  async function repairClaudeDirect() {
    setClaudeBusy(true);
    setMcpMessage("Applying the direct Claude MCP configuration fallback...");
    try {
      const desktop = await window.sage.repairClaudeDirectMcp();
      const current = await window.sage.getClaudeMcpStatus();
      setClaudeStatus({ ...current, desktop });
      setMcpMessage(desktop.restartRequired ? "Direct config written safely. Fully quit and reopen Claude Desktop, then click Verify connection." : desktop.verified ? "Direct Claude MCP connection is verified." : "Direct config is present. Open/restart Claude Desktop, then click Verify connection.");
    } catch (error) { setMcpMessage(error instanceof Error ? error.message : "Could not apply the direct Claude config fallback."); }
    finally { setClaudeBusy(false); }
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
          <div className="settings-detail-row"><span>Token storage</span><strong>Windows secure storage / local only</strong></div>
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

            <ClaudeIntegrationCard
              status={claudeStatus}
              setup={mcpSetup}
              busy={claudeBusy}
              onInstall={() => void repairClaude()}
              onVerify={() => void verifyClaude()}
              onShowBundle={() => void showClaudeBundle()}
              onDirectRepair={() => void repairClaudeDirect()}
              onCopyCode={() => mcpSetup && void copyMcp(mcpSetup.claudeCode, "Claude Code command")}
            />
          </div>

          {mcpSetup && <details className="mcp-advanced-settings">
            <summary><span>Advanced MCP configuration</span><small>Codex, generic stdio config and manual setup</small></summary>
            <div className="mcp-advanced-body">
              <small>Transport: local stdio / Server: new-eden-sage / {mcpSetup.access}</small>
              <div className="mcp-setup-actions"><button onClick={() => void copyMcp(mcpSetup.json, "Generic MCP configuration")}>Copy MCP config</button><button onClick={() => void copyMcp(mcpSetup.codex, "Codex configuration")}>Copy Codex config</button></div>
              <div className="mcp-instructions"><strong>Manual connection notes</strong><ol><li>Sync characters and refresh any market data the AI needs.</li><li>For ChatGPT, create a tunnel and runtime key above, then choose <b>Add in ChatGPT</b>.</li><li>For Claude Desktop, use the Claude card above. The recommended MCPB install uses Claude's own approval screen; full manual steps and a direct-config fallback are included there.</li><li>For Codex, copy the Codex configuration into its <code>config.toml</code>.</li><li>Ask the AI to list Sage characters or available Sage data before detailed analysis.</li></ol><small>Sage can serve already-saved read data through the configured MCP transport; keep the desktop app available for workflows that require live Sage writes.</small></div>
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
      <div className="orb small">*</div>
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
            <span>*</span>
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
                ? "Approval required - estimated cost exceeds $0.40"
                : "Prepared locally - no API charge yet"}
            </strong>
            <p>
              Model: {prepared.model} / estimated maximum $
              {`$${prepared.cost.estimatedMaximumCost.toFixed(2)}`} /{" "}
              {prepared.availableLocalSources} local sources
            </p>
            <small>
              {prepared.cost.pricingBasis} {prepared.disclosure}
            </small>
          </div>
          <button className="paid" onClick={sendPaid} disabled={busy}>
            {busy
              ? "Sending..."
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
          placeholder="Ask Sage about skills, ships, ISK, industry..."
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
  const [progress, setProgress] = useState(
    "Using the installed server-prepared public market generation",
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
      setProgress(`${item.regionName}: public data ready`);
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
  async function refreshSharedMarket() {
    setBusy(true);
    setProgress("Checking for the latest server-prepared public market generation...");
    try {
      const result = await window.sage.pullMarket({ mode: "single", regionId: selected });
      setSummaries(result.summaries);
      onMarketDataUpdated();
      await showRegion(selected);
      setProgress(`Shared public market ready from ${result.storage.path}.`);
    } catch (error) {
      setProgress(error instanceof Error ? error.message : "Shared public market reconciliation failed");
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
            No character authorization is required. Server-prepared results are cached locally. Sage checks for a newer generation hourly; install updates from Data Control.
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
          <button onClick={() => void refreshSharedMarket()} disabled={busy}>
            Reload installed data
          </button>
        </div>
      </div>
      <div className="market-progress">
        <span className={busy ? "pulse" : ""} />
        <div>
          {progress}
          {storage && (
            <small>
              Storage: {storage.path} / {storage.retainedDatasets} derived datasets retained
              {storage.raw ? ` / raw order book: ${money(storage.raw.orderCount)} orders across ${storage.raw.regionCount} regions` : ""}
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
              placeholder="Search items in the selected region..."
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
                  {item.bestBuy === null ? "-" : `${money(item.bestBuy)} ISK`}
                </span>
                <span className="sell">
                  {item.bestSell === null ? "-" : `${money(item.bestSell)} ISK`}
                </span>
                <span>
                  {money(item.buyOrderCount)} / {money(item.buyVolume)}
                </span>
                <span>
                  {money(item.sellOrderCount)} / {money(item.sellVolume)}
                </span>
                <span>
                  {item.spreadPercent === null
                    ? "-"
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
