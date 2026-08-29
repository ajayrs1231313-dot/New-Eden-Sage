import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { CharacterSnapshot } from "./types";
import { CommandIntelligence } from "./CommandIntelligence";
import { CapabilityCommandCenter } from "./CapabilityCommandCenter";
import type { CharacterNavigateTarget } from "./character-navigation";
import hulkCharacterBackground from "./hulk-character-background.png";
import stationCharacterBackground from "./station-character-background.png";

type CloneState = "alpha" | "omega";

const isk = (value: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);
const HERO_BACKGROUNDS = [hulkCharacterBackground, stationCharacterBackground] as const;
const DEFAULT_HERO_BACKGROUND_INDEX = 1; // Preserve persisted indexes; station is the default fallback.
const HERO_BACKGROUND_LOCK_KEY = "new-eden-sage:character-hero-background-lock:v1";
const HERO_BACKGROUND_CYCLE_MS = 30 * 60 * 1000;

type HeroBackgroundState = { index: number; locked: boolean };

function randomOtherBackgroundIndex(current: number) {
  if (HERO_BACKGROUNDS.length <= 1) return 0;
  const candidates = HERO_BACKGROUNDS.map((_, index) => index).filter((index) => index !== current);
  return candidates[Math.floor(Math.random() * candidates.length)] ?? 0;
}

function initialHeroBackgroundState(): HeroBackgroundState {
  try {
    const raw = localStorage.getItem(HERO_BACKGROUND_LOCK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<HeroBackgroundState>;
      const index = Number(parsed.index);
      if (parsed.locked === true && Number.isInteger(index) && index >= 0 && index < HERO_BACKGROUNDS.length) return { index, locked: true };
    }
  } catch { /* Background preference persistence is non-fatal. */ }
  return { index: DEFAULT_HERO_BACKGROUND_INDEX, locked: false };
}

function HudGlyph({ kind }: { kind: "target" | "scan" | "bell" | "intel" | "route" | "isk" | "fleet" | "fit" }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.55, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "target") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle {...common} cx="12" cy="12" r="7"/><circle {...common} cx="12" cy="12" r="2.4"/><path {...common} d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/></svg>;
  if (kind === "scan") return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M4 18.5 12 4l8 14.5H4Z"/><path {...common} d="M8.5 15h7M10.4 11.5h3.2"/></svg>;
  if (kind === "bell") return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M7 17h10l-1.2-2.1V10a3.8 3.8 0 0 0-7.6 0v4.9L7 17Z"/><path {...common} d="M10.2 19h3.6"/></svg>;
  if (kind === "intel") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle {...common} cx="12" cy="12" r="7.5"/><path {...common} d="m14.8 8.7-1.9 4.2-4.2 1.9 1.9-4.2 4.2-1.9Z"/></svg>;
  if (kind === "route") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle {...common} cx="6" cy="17" r="2"/><circle {...common} cx="18" cy="7" r="2"/><path {...common} d="M8 16c3.2-.8 3.5-6.5 8-8"/></svg>;
  if (kind === "isk") return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m12 4 7 8-7 8-7-8 7-8Z"/><circle {...common} cx="12" cy="12" r="2.3"/></svg>;
  if (kind === "fleet") return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M4 12h5M15 12h5M12 4v5M12 15v5"/><circle {...common} cx="12" cy="12" r="3"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M5 7h14M5 12h14M5 17h14M8 5v4M15 10v4M11 15v4"/></svg>;
}

type QuickLinkKind = "activity" | "fittings" | "isk" | "industrial" | "regional" | "profits";

function QuickLinkGlyph({ kind }: { kind: QuickLinkKind }) {
  const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.45, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  let symbol: ReactNode;
  if (kind === "activity") symbol = <><circle {...line} cx="16" cy="16" r="5"/><path {...line} d="M16 6v4M16 22v4M6 16h4M22 16h4M12.8 16.1l2.1 2.1 4.3-5"/></>;
  else if (kind === "fittings") symbol = <><path {...line} d="M9 8v16M16 6v20M23 9v14M6.5 12h5M13.5 19h5M20.5 14h5"/><circle {...line} cx="9" cy="12" r="1.4"/><circle {...line} cx="16" cy="19" r="1.4"/><circle {...line} cx="23" cy="14" r="1.4"/></>;
  else if (kind === "isk") symbol = <><path {...line} d="m16 7 8 9-8 9-8-9 8-9Z"/><circle {...line} cx="16" cy="16" r="3"/><path {...line} d="M16 11.5v9"/></>;
  else if (kind === "industrial") symbol = <><path {...line} d="M9 20v-8l7-4 7 4v8l-7 4-7-4Z"/><path {...line} d="M12 18v-4h8v4M16 9.5v13"/><circle {...line} cx="16" cy="16" r="2"/></>;
  else if (kind === "regional") symbol = <><circle {...line} cx="16" cy="16" r="8"/><path {...line} d="m19.5 11.5-2.3 5.7-5.7 2.3 2.3-5.7 5.7-2.3Z"/><circle {...line} cx="8" cy="23" r="1.5"/><path {...line} d="M9.3 22.2 12 20"/></>;
  else symbol = <><path {...line} d="M8 23V10M8 23h17M11 20l4-5 3 2 6-8"/><path {...line} d="m20.5 9 3.5-.2-.2 3.5"/><circle {...line} cx="11" cy="20" r="1"/><circle {...line} cx="15" cy="15" r="1"/></>;
  return <svg className="quick-link-glyph" viewBox="0 0 32 32" aria-hidden="true"><path className="quick-link-frame" {...line} d="M6 2h17l7 7v17l-4 4H7l-5-5V7l4-5Z"/><path className="quick-link-corners" {...line} d="M2 11h3M27 5v4M30 20h-3M5 27v3"/>{symbol}</svg>;
}

function CharacterPortraitFrame({ snapshot }: { snapshot: CharacterSnapshot }) {
  const initials = snapshot.character.name.split(/\s+/).map((part) => part.slice(0, 1)).join("").slice(0, 2).toUpperCase();
  return (
    <div className="character-hud-portrait" aria-label={`${snapshot.character.name} portrait`}>
      <img
        src={`https://images.evetech.net/characters/${snapshot.characterId}/portrait?size=256`}
        alt=""
        decoding="async"
        onError={(event) => { event.currentTarget.style.display = "none"; }}
      />
      <span className="character-hud-portrait-fallback">{initials || "NE"}</span>
      <svg className="character-hud-portrait-frame" viewBox="0 0 180 196" preserveAspectRatio="none" aria-hidden="true">
        <path className="outer" d="M13 1h143l23 25v155l-14 14H1V15L13 1Z"/>
        <path className="inner" d="M21 10h130l18 20v143l-12 12H11V22L21 10Z"/>
        <path className="accent" d="M1 47V15L13 1h34M179 57V26L156 1h-28M179 150v31l-14 14h-33M1 149v46h47"/>
        <path className="ticks" d="M15 16h18M15 23h10M146 181h15M154 174h8"/>
      </svg>
    </div>
  );
}

function CorporationIdentityBanner({ snapshot }: { snapshot: CharacterSnapshot }) {
  const corporationName = snapshot.character.corporation_name || "Corporation unresolved";
  const corporationTicker = String((snapshot.character as CharacterSnapshot["character"] & { corporation_data?: { ticker?: unknown } }).corporation_data?.ticker ?? "").trim();
  const copyRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [showTicker, setShowTicker] = useState(false);

  useLayoutEffect(() => {
    const copy = copyRef.current;
    const measure = measureRef.current;
    if (!copy || !measure) return;
    const update = () => {
      const next = Boolean(corporationTicker) && measure.scrollWidth > copy.clientWidth;
      setShowTicker((current) => current === next ? current : next);
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(copy);
    observer?.observe(measure);
    return () => observer?.disconnect();
  }, [corporationName, corporationTicker]);

  const displayName = showTicker && corporationTicker ? corporationTicker : corporationName;
  return (
    <section className="character-corporation-banner" aria-label={`${corporationName} corporation identity`}>
      <svg className="character-corporation-frame" viewBox="0 0 180 104" preserveAspectRatio="none" aria-hidden="true">
        <path className="outer" d="M12 1h147l20 18v73l-11 11H1V13L12 1Z"/>
        <path className="inner" d="M18 8h137l15 14v64l-8 8H9V18L18 8Z"/>
        <path className="accent" d="M1 32V13L12 1h31M179 38V19L159 1h-28M179 76v16l-11 11h-27M1 79v24h39"/>
        <path className="ticks" d="M16 13h18M16 18h10M146 90h15M153 85h9M69 8h18M91 8h8"/>
      </svg>
      <div className="character-corporation-scan" aria-hidden="true" />
      <div className="character-corporation-emblem">
        <img src={`https://images.evetech.net/corporations/${snapshot.character.corporation_id}/logo?size=128`} alt="" decoding="async" onError={(event) => { event.currentTarget.style.display = "none"; }}/>
        <span aria-hidden="true" />
      </div>
      <div ref={copyRef} className="character-corporation-copy">
        <small>CORPORATION</small>
        <strong title={corporationName}>{displayName}</strong>
        <span ref={measureRef} className="character-corporation-name-measure" aria-hidden="true">{corporationName}</span>
        <span>Current corporation</span>
      </div>
    </section>
  );
}

type JourneyState = "complete" | "active" | "pending";
function OnboardingJourney({ snapshot, allCommandTabsVisited }: { snapshot: CharacterSnapshot; allCommandTabsVisited: boolean }) {
  const synced = snapshot.snapshotState === "synced" || Boolean(snapshot.coreUpdatedAt);
  const states: JourneyState[] = [
    "complete",
    "complete",
    synced ? "complete" : "active",
    allCommandTabsVisited ? "complete" : synced ? "active" : "pending",
  ];
  const labels = ["Welcome", "Add Character", "Sync Data", "Visit All Command Tabs"];
  const completeCount = states.filter((state) => state === "complete").length;
  const progressSegments = labels.length - 1;
  const completedSegments = Math.max(0, Math.min(progressSegments, completeCount - 1));
  return (
    <section className="character-journey" aria-label="Character onboarding journey">
      <div className="character-journey-heading"><strong>YOUR ONBOARDING JOURNEY</strong><span>{completeCount} of {labels.length} complete</span></div>
      <div className="character-journey-rail">
        <div className="character-journey-track"><i style={{ width: `${(completedSegments / progressSegments) * 100}%` }} /></div>
        {labels.map((label, index) => {
          const state = states[index];
          return (
            <div className={`character-journey-node ${state}`} key={label}>
              <svg viewBox="0 0 42 42" aria-hidden="true">
                <circle className="halo" cx="21" cy="21" r="18"/>
                <circle className="ring" cx="21" cy="21" r="12.5"/>
                {state === "complete" ? <path className="check" d="m15.8 21.1 3.3 3.4 7.2-7.3"/> : <text x="21" y="24.6" textAnchor="middle">{index + 1}</text>}
                <path className="tick" d="M21 4v3M21 35v3M4 21h3M35 21h3"/>
              </svg>
              <strong>{label}</strong>
              <small>{state === "complete" ? "Complete" : state === "active" ? "In Progress" : "Pending"}</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StatusCell({ label, value, detail, visual, className = "" }: { label: string; value: string; detail: string; visual?: ReactNode; className?: string }) {
  return <div className={`character-status-cell ${className}`}>{visual}<div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></div>;
}

function CharacterStatusStrip({ snapshot }: { snapshot: CharacterSnapshot }) {
  const sec = snapshot.character.security_status;
  const secTone = sec == null ? "neutral" : sec < 0 ? "negative" : sec > 0 ? "positive" : "neutral";
  const shipName = snapshot.ship.ship_type_name || snapshot.ship.ship_name || "Sync required";
  return (
    <section className="character-status-strip-v2">
      <StatusCell label="CORPORATION" value={snapshot.character.corporation_name || "Sync required"} detail="Current corporation" visual={<img className="character-status-logo" src={`https://images.evetech.net/corporations/${snapshot.character.corporation_id}/logo?size=64`} alt=""/>}/>
      <StatusCell label="CURRENT SHIP" value={shipName} detail={snapshot.ship.ship_name && snapshot.ship.ship_name !== shipName ? snapshot.ship.ship_name : "Active ship"} visual={<img className="character-status-ship" src={`https://images.evetech.net/types/${snapshot.ship.ship_type_id}/render?size=64`} alt=""/>}/>
      <StatusCell label="LOCATION" value={snapshot.location.place_name || snapshot.location.solar_system_name || "Sync required"} detail={snapshot.location.solar_system_name || "Current solar system"} visual={<span className="character-status-hex"><HudGlyph kind="route"/></span>}/>
      <StatusCell label="LIQUID ISK" value={`${isk(snapshot.wallet)} ISK`} detail="Available wallet balance" className="wallet" visual={<svg className="character-wallet-spark" viewBox="0 0 86 30" aria-hidden="true"><path d="M1 25 12 22 20 24 28 14 36 17 44 10 52 13 60 6 69 10 85 3"/></svg>}/>
      <StatusCell label="SECURITY STATUS" value={sec?.toFixed(2) ?? "-"} detail={sec == null ? "Unavailable" : sec < 0 ? "Negative standing" : sec > 0 ? "Positive standing" : "Neutral"} className={`security ${secTone}`}/>
      <div className="character-status-readiness"><img src={`https://images.evetech.net/types/${snapshot.ship.ship_type_id}/render?size=128`} alt=""/><strong>ACTIVE</strong><small>Current hull</small></div>
    </section>
  );
}

function GettingStarted({ onNavigate, snapshot }: { onNavigate(target: CharacterNavigateTarget): void; snapshot: CharacterSnapshot }) {
  const rows: Array<{ icon: Parameters<typeof HudGlyph>[0]["kind"]; title: string; detail: string; action: CharacterNavigateTarget }> = [
    { icon: "target", title: snapshot.queue.length ? "Review your training route" : "Set your training priorities", detail: snapshot.queue.length ? `${snapshot.queue.length} skills currently queued.` : "Your skill queue is currently empty.", action: "activity" },
    { icon: "scan", title: "Explore your command center", detail: "Open Activity Command and see what is within reach.", action: "activity" },
    { icon: "bell", title: "Review fitting readiness", detail: "Check ship fits and character compatibility.", action: "fittings" },
    { icon: "intel", title: "Find your next opportunity", detail: "Use Sage intelligence to identify the next move.", action: "asset-market" },
  ];
  return <article className="character-start-panel character-console-panel"><h3>GETTING STARTED</h3><div>{rows.map((row) => <button key={row.title} onClick={() => onNavigate(row.action)}><span><HudGlyph kind={row.icon}/></span><div><strong>{row.title}</strong><small>{row.detail}</small></div><b>&gt;</b></button>)}</div></article>;
}

function QuickActions({ onNavigate }: { onNavigate(target: CharacterNavigateTarget): void }) {
  const actions: Array<{ icon: QuickLinkKind; label: string; sub: string; target: CharacterNavigateTarget }> = [
    { icon: "activity", label: "Activity", sub: "Readiness", target: "activity" },
    { icon: "fittings", label: "Fittings", sub: "Ships", target: "fittings" },
    { icon: "isk", label: "ISK Command", sub: "Wealth", target: "isk" },
    { icon: "industrial", label: "Industrial Feed", sub: "Production", target: "industrial" },
    { icon: "regional", label: "Regional", sub: "Routes", target: "navigation" },
    { icon: "profits", label: "Profits", sub: "Ledger", target: "asset-wallet-ledger" },
  ];
  return <article className="character-quick-panel character-console-panel"><h3>QUICK LINKS</h3><div className="character-quick-grid">{actions.map((action) => <button key={action.label} onClick={() => onNavigate(action.target)}><span><QuickLinkGlyph kind={action.icon}/></span><strong>{action.label}</strong><small>{action.sub}</small></button>)}</div></article>;
}

export function CharacterOverviewHud({ snapshot, cloneState, onNavigate, allCommandTabsVisited }: { snapshot: CharacterSnapshot; cloneState?: CloneState; onNavigate(target: CharacterNavigateTarget): void; allCommandTabsVisited: boolean }) {
  const shipName = snapshot.ship.ship_type_name || snapshot.ship.ship_name || "Active ship";
  const [heroBackground, setHeroBackground] = useState<HeroBackgroundState>(initialHeroBackgroundState);
  const [backgroundMenu, setBackgroundMenu] = useState<{ x: number; y: number } | null>(null);
  const heroSwipeStartX = useRef<number | null>(null);

  useEffect(() => {
    if (heroBackground.locked) return;
    const timer = window.setInterval(() => {
      setHeroBackground((current) => current.locked ? current : { ...current, index: randomOtherBackgroundIndex(current.index) });
    }, HERO_BACKGROUND_CYCLE_MS);
    return () => window.clearInterval(timer);
  }, [heroBackground.locked]);

  useEffect(() => {
    if (!backgroundMenu) return;
    const close = () => setBackgroundMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [backgroundMenu]);

  const forceRandomBackground = () => {
    setHeroBackground((current) => current.locked ? current : { ...current, index: randomOtherBackgroundIndex(current.index) });
  };

  const toggleBackgroundLock = () => {
    setHeroBackground((current) => {
      const next = { ...current, locked: !current.locked };
      try {
        if (next.locked) localStorage.setItem(HERO_BACKGROUND_LOCK_KEY, JSON.stringify(next));
        else localStorage.removeItem(HERO_BACKGROUND_LOCK_KEY);
      } catch { /* Background preference persistence is non-fatal. */ }
      return next;
    });
    setBackgroundMenu(null);
  };

  const heroStyle = { "--character-hero-background": `url("${HERO_BACKGROUNDS[heroBackground.index]}")` } as CSSProperties;

  return (
    <section className="dashboard character-overview-dashboard">
      <section
        className={`character-hero-v2${heroBackground.locked ? " background-locked" : ""}`}
        style={heroStyle}
        onContextMenu={(event) => {
          event.preventDefault();
          const bounds = event.currentTarget.getBoundingClientRect();
          setBackgroundMenu({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
        }}
        onPointerDown={(event) => {
          if (event.button === 0) heroSwipeStartX.current = event.clientX;
        }}
        onPointerUp={(event) => {
          const start = heroSwipeStartX.current;
          heroSwipeStartX.current = null;
          if (start == null || heroBackground.locked) return;
          if (Math.abs(event.clientX - start) >= 54) forceRandomBackground();
        }}
        onPointerCancel={() => { heroSwipeStartX.current = null; }}
      >
        {backgroundMenu && <div className="character-background-menu" style={{ left: backgroundMenu.x, top: backgroundMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" onClick={toggleBackgroundLock}>{heroBackground.locked ? "Unlock background" : "Lock background"}</button>
        </div>}
        <div className="character-hero-stars" aria-hidden="true"/>
        <div className="character-hero-telemetry" aria-hidden="true"><i/><i/><i/><i/></div>
        <div className="character-hero-planet" aria-hidden="true"/>
        <div className="character-hero-identity">
          <div className="character-identity-stack">
            <CharacterPortraitFrame snapshot={snapshot}/>
            <CorporationIdentityBanner snapshot={snapshot}/>
          </div>
          <div className="character-hero-copy">
            <span>Welcome back,</span>
            <div className="character-hero-name"><h2>{snapshot.character.name}</h2><i aria-hidden="true" /></div>
            <strong>Capsuleer <b>&middot;</b> {snapshot.character.corporation_name || "Corporation unresolved"}</strong>
            <small>{shipName} <b>&middot;</b> {cloneState ? `${cloneState.toUpperCase()} clone` : "Clone state unresolved"}</small>
          </div>
        </div>
        <OnboardingJourney snapshot={snapshot} allCommandTabsVisited={allCommandTabsVisited}/>
      </section>

      <CharacterStatusStrip snapshot={snapshot}/>

      <div className="character-reference-grid">
        <GettingStarted onNavigate={onNavigate} snapshot={snapshot}/>
        <CommandIntelligence snapshot={snapshot} onNavigate={onNavigate}/>
        <CapabilityCommandCenter snapshot={snapshot} cloneState={cloneState} onOpenProgression={() => onNavigate("activity")} compact/>
        <QuickActions onNavigate={onNavigate}/>
      </div>
    </section>
  );
}