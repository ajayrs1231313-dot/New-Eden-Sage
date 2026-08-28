import { useEffect, useState, type CSSProperties } from "react";
import type { CharacterSnapshot, PublicDataStatus } from "./types";
import { SystemClock } from "./SystemClock";
import "./character-command-header.css";

type Props = {
  title?: string;
  subtitle?: string;
  kicker?: string;
  snapshot?: CharacterSnapshot;
  busy: boolean;
  privateRefreshing: boolean;
  privateProgress: number;
  marketDataRevision: number;
  onRefreshPrivate: () => void | Promise<void>;
  onAddCharacter: () => void | Promise<void>;
  onSupportDeveloper: () => void | Promise<void>;
};

function validTimestamp(value?: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function ageText(value: string | null | undefined, now: number) {
  const timestamp = validTimestamp(value);
  if (timestamp == null) return "--";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function FreshnessNode({ tone, label, value, title }: { tone: "public" | "private"; label: string; value: string; title: string }) {
  return (
    <div className={`cc-freshness-node ${tone}`} title={title}>
      <span className="cc-freshness-label">{label}</span>
      <div className="cc-freshness-value-row">
        <i className="cc-freshness-orb" aria-hidden="true"><span /></i>
        <div>
          <strong>{value}</strong>
          <small>AGE</small>
        </div>
      </div>
    </div>
  );
}

function AppUpdatePod() {
  const [state, setState] = useState<{ status: string; detail?: any }>({ status: "idle" });
  const [version, setVersion] = useState("");
  useEffect(() => {
    void window.sage.getUpdateState().then((value) => setVersion(value.version));
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
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Application update check timed out.")), 20000)),
        ]) as { status?: string; detail?: any };
        if (result?.status === "available" || result?.status === "current") setState({ status: result.status, detail: result.detail });
      } catch (error) {
        setState({ status: "error", detail: error instanceof Error ? error.message : "Application update check failed." });
      }
    }
  }
  const statusLabel = state.status === "available" ? "Update available"
    : state.status === "downloading" ? `${progress}%`
      : state.status === "downloaded" ? "Restart to update"
        : state.status === "checking" ? "Checking app"
          : state.status === "current" ? "Latest"
            : state.status === "error" ? "Update error"
              : "App update";
  return (
    <button
      type="button"
      className={`cc-update-pod ${state.status}`}
      onClick={() => void act()}
      disabled={state.status === "checking" || state.status === "downloading"}
      title={state.status === "error" ? String(state.detail) : "Application version and GitHub release update status"}
    >
      <span className="cc-update-dot" aria-hidden="true" />
      <strong>{version ? `v${version}` : "v--"}</strong>
      <span>{statusLabel}</span>
    </button>
  );
}

function DataActionIcon({ kind }: { kind: "public" | "private" }) {
  if (kind === "public") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h3l2-5 4 10 2-5h5" /><path d="M4 5v14M20 5v14" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8a8 8 0 1 0 1 7" /><path d="M19 4v4h-4" /></svg>;
}

export function CharacterCommandHeader({ title = "Character Command", subtitle = "Command and control for your capsuleer assets", kicker = "COMMAND DECK", snapshot, busy, privateRefreshing, privateProgress, marketDataRevision, onRefreshPrivate, onAddCharacter, onSupportDeveloper }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [publicStatus, setPublicStatus] = useState<PublicDataStatus | null>(null);
  const [publicBusy, setPublicBusy] = useState(false);
  const [publicProgress, setPublicProgress] = useState({ running: false, percent: 0, message: "" });
  const [publicFeedback, setPublicFeedback] = useState("");

  async function loadPublicStatus() {
    try {
      setPublicStatus(await window.sage.getPublicDataStatus());
    } catch {
      setPublicStatus(null);
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void loadPublicStatus();
  }, [marketDataRevision]);

  useEffect(() => {
    const stopStatus = window.sage.onPublicDataStatus((value) => setPublicStatus(value));
    const stopProgress = window.sage.onPublicDataProgress((value) => {
      setPublicProgress({ running: value.running, percent: Math.max(0, Math.min(100, value.percent ?? 0)), message: value.message ?? "" });
      if (!value.running && value.message) setPublicFeedback(value.error ? value.error : value.message);
    });
    return () => { stopStatus(); stopProgress(); };
  }, []);

  async function actOnPublicData() {
    setPublicBusy(true);
    try {
      if (publicStatus?.updateAvailable) {
        setPublicProgress({ running: true, percent: 1, message: "Starting public update..." });
        setPublicFeedback("Installing the newest public intelligence...");
        const result = await window.sage.checkPublicData();
        setPublicStatus(result);
        setPublicFeedback(result.changed ? "Public intelligence updated." : "Public intelligence is already current.");
      } else {
        setPublicFeedback("Checking Sage server for a newer public generation...");
        const status = await window.sage.checkPublicDataAvailability();
        setPublicStatus(status);
        setPublicFeedback(status.updateAvailable ? "Update available - click the blue button to install it." : "Public intelligence is current.");
      }
    } catch (error) {
      setPublicFeedback(error instanceof Error ? error.message : "Could not check public data.");
    } finally {
      setPublicBusy(false);
    }
  }

  const publicAge = ageText(publicStatus?.createdAt, now);
  const privateTimestamp = snapshot?.snapshotState === "bootstrap" ? null : snapshot?.updatedAt;
  const privateAge = ageText(privateTimestamp, now);
  const publicTitle = publicStatus?.createdAt
    ? `Loaded server-prepared public generation ${publicStatus.generation ?? "unknown"} · source data ${new Date(publicStatus.createdAt).toLocaleString()}`
    : "No server-prepared public dataset is currently loaded.";
  const privateTitle = privateTimestamp
    ? `${snapshot?.character.name ?? "Selected character"} private ESI data refreshed ${new Date(privateTimestamp).toLocaleString()}`
    : snapshot ? `${snapshot.character.name} has not completed a private data refresh yet.` : "No character selected.";
  const updateAvailable = Boolean(publicStatus?.updateAvailable) && !publicProgress.running;
  const publicActionLabel = publicProgress.running ? "Updating public data..." : publicBusy ? "Checking for new data..." : updateAvailable ? "Update available" : "Check for new data";
  const publicActionHint = publicProgress.running ? publicProgress.message || "Installing server-prepared intelligence" : updateAvailable ? "Click to install the newest public generation" : "Check for newer public intelligence";
  const publicActionStyle = { "--cc-progress": `${publicProgress.running ? publicProgress.percent : 0}%` } as CSSProperties;
  const privateActionStyle = { "--cc-progress": `${privateRefreshing ? Math.max(0, Math.min(100, privateProgress)) : 0}%` } as CSSProperties;

  return (
    <header className="character-command-deck">
      <div className="cc-utility-rail">
        <div className="cc-product-mark">
          <span className="cc-brand-diamond" aria-hidden="true"><i /></span>
          <strong>NEW EDEN SAGE</strong>
          <span className="cc-utility-divider" aria-hidden="true" />
          <span>CAPSULEER INTELLIGENCE</span>
        </div>
        <div className="cc-utility-clock">
          <small>LOCAL</small>
          <SystemClock />
        </div>
      </div>

      <div className="cc-command-stage">
        <div className="cc-title-sector">
          <span className="cc-title-kicker">{kicker}</span>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>

        <div className="cc-data-sector">
          <div className="cc-status-spine" aria-label="Public and private data freshness">
            <FreshnessNode tone="public" label="PUBLIC DATA" value={publicAge} title={publicTitle} />
            <span className="cc-spine-junction" aria-hidden="true" />
            <FreshnessNode tone="private" label="PRIVATE DATA" value={privateAge} title={privateTitle} />
          </div>

          <div className="cc-data-control">
            <div className="cc-data-control-label">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></svg>
              <span>DATA CONTROL</span>
            </div>
            <button type="button" className={`cc-public-data-action${updateAvailable ? " update-available" : ""}${publicProgress.running ? " installing" : ""}`} style={publicActionStyle} onClick={() => void actOnPublicData()} disabled={publicBusy || publicProgress.running}>
              <span className="cc-data-progress-fill" aria-hidden="true" />
              <DataActionIcon kind="public" />
              <span className="cc-data-action-copy"><strong>{publicActionLabel}</strong><small>{publicActionHint}</small></span>
            </button>
            <button type="button" className={`cc-private-data-action${privateRefreshing ? " refreshing" : ""}`} style={privateActionStyle} onClick={() => void onRefreshPrivate()} disabled={busy || privateRefreshing || !snapshot}>
              <span className="cc-data-progress-fill" aria-hidden="true" />
              <DataActionIcon kind="private" />
              <span className="cc-data-action-copy"><strong>{privateRefreshing ? "Refreshing private data..." : "Refresh private data"}</strong><small>{privateRefreshing ? `${Math.round(Math.max(0, Math.min(100, privateProgress)))}% complete` : "Update private ESI data"}</small></span>
            </button>
          </div>
          <div className="cc-data-feedback" aria-live="polite">{publicFeedback}</div>
        </div>

        <div className="cc-action-sector">
          <div className="cc-primary-actions">
            <button type="button" className="cc-support-action" onClick={() => void onSupportDeveloper()} title="Support New Eden Sage development via PayPal">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 19 7v5c0 4.5-2.8 7.3-7 9-4.2-1.7-7-4.5-7-9V7l7-4Z" /><path d="M9 12h6M12 9v6" /></svg>
              <span>Support Developer</span>
            </button>
            <button type="button" className="cc-add-action" onClick={() => void onAddCharacter()} disabled={busy}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              <span>Add character</span>
            </button>
          </div>
          <AppUpdatePod />
        </div>
      </div>
    </header>
  );
}
