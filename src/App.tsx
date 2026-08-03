import { FormEvent, useEffect, useState } from "react";
import type {
  CharacterSnapshot,
  MarketItem,
  MarketSummary,
  PublicConfig,
} from "./types";
import { FittingsWorkspace } from "./Fittings";
import { IskLab } from "./IskLab";

type View =
  | "overview"
  | "skills"
  | "market"
  | "regional"
  | "fittings"
  | "data"
  | "settings";
type CloneState = "alpha" | "omega";

const nav: Array<{ id: View; label: string; mark: string }> = [
  { id: "overview", label: "Command", mark: "◇" },
  { id: "skills", label: "Skills", mark: "△" },
  { id: "market", label: "ISK Lab", mark: "◈" },
  { id: "regional", label: "Regional Market", mark: "▦" },
  { id: "fittings", label: "Fittings", mark: "⌁" },
  { id: "data", label: "Data Vault", mark: "▣" },
  { id: "settings", label: "Settings", mark: "⚙" },
];

const money = (value: number) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);

type TrainingTarget = { skill: string; level: number };
type ActivityProfile = {
  id: string;
  label: string;
  detail: string;
  skills: TrainingTarget[];
};

const activityProfiles: ActivityProfile[] = [
  {
    id: "abyssal",
    label: "Abyssal Deadspace",
    detail: "Solo cruiser or small-ship PvE with strong tank, capacitor and damage support.",
    skills: [
      { skill: "Capacitor Management", level: 4 },
      { skill: "Capacitor Systems Operation", level: 4 },
      { skill: "Navigation", level: 4 },
      { skill: "Afterburner", level: 4 },
      { skill: "Shield Management", level: 4 },
      { skill: "Drones", level: 5 },
      { skill: "Weapon Upgrades", level: 4 },
    ],
  },
  {
    id: "missions",
    label: "Security missions",
    detail: "Reliable high-sec PvE progression through tank, application and sustained damage.",
    skills: [
      { skill: "Navigation", level: 4 },
      { skill: "Target Management", level: 4 },
      { skill: "Weapon Upgrades", level: 4 },
      { skill: "Capacitor Management", level: 4 },
      { skill: "Drones", level: 4 },
      { skill: "Social", level: 4 },
      { skill: "Security Connections", level: 4 },
    ],
  },
  {
    id: "exploration",
    label: "Exploration and hacking",
    detail: "Scanning, relic/data sites and safe movement through dangerous space.",
    skills: [
      { skill: "Astrometrics", level: 4 },
      { skill: "Astrometric Rangefinding", level: 3 },
      { skill: "Hacking", level: 4 },
      { skill: "Archaeology", level: 4 },
      { skill: "Cloaking", level: 4 },
      { skill: "Evasive Maneuvering", level: 4 },
    ],
  },
  {
    id: "mining",
    label: "Mining and resource harvesting",
    detail: "Barges, yield, crystals and survivability for sustained resource gathering.",
    skills: [
      { skill: "Mining", level: 5 },
      { skill: "Astrogeology", level: 5 },
      { skill: "Mining Barge", level: 4 },
      { skill: "Mining Upgrades", level: 4 },
      { skill: "Drones", level: 4 },
      { skill: "Shield Management", level: 4 },
    ],
  },
  {
    id: "hauling",
    label: "Hauling and market trading",
    detail: "Cargo movement, safer travel, order capacity and reduced trading costs.",
    skills: [
      { skill: "Navigation", level: 5 },
      { skill: "Evasive Maneuvering", level: 4 },
      { skill: "Warp Drive Operation", level: 4 },
      { skill: "Spaceship Command", level: 5 },
      { skill: "Trade", level: 4 },
      { skill: "Retail", level: 4 },
      { skill: "Accounting", level: 4 },
      { skill: "Broker Relations", level: 4 },
    ],
  },
  {
    id: "industry",
    label: "Manufacturing and industry",
    detail: "Production throughput, more concurrent jobs and remote industrial control.",
    skills: [
      { skill: "Industry", level: 5 },
      { skill: "Advanced Industry", level: 4 },
      { skill: "Mass Production", level: 4 },
      { skill: "Advanced Mass Production", level: 3 },
      { skill: "Science", level: 4 },
      { skill: "Supply Chain Management", level: 3 },
    ],
  },
  {
    id: "faction-warfare",
    label: "Faction Warfare and small-gang PvP",
    detail: "Core fitting, navigation, heat and weapon support for PvP frigates and cruisers.",
    skills: [
      { skill: "CPU Management", level: 5 },
      { skill: "Power Grid Management", level: 5 },
      { skill: "Mechanics", level: 5 },
      { skill: "Hull Upgrades", level: 4 },
      { skill: "Navigation", level: 5 },
      { skill: "Weapon Upgrades", level: 5 },
      { skill: "Thermodynamics", level: 4 },
    ],
  },
  {
    id: "incursions",
    label: "Incursions and fleet PvE",
    detail: "Fleet-ready tank, capacitor, targeting and damage or logistics support.",
    skills: [
      { skill: "CPU Management", level: 5 },
      { skill: "Power Grid Management", level: 5 },
      { skill: "Capacitor Management", level: 5 },
      { skill: "Shield Management", level: 5 },
      { skill: "Long Range Targeting", level: 4 },
      { skill: "Signature Analysis", level: 4 },
      { skill: "Advanced Weapon Upgrades", level: 4 },
    ],
  },
  {
    id: "homefront",
    label: "Homefront Operations",
    detail: "Accessible cooperative high-sec sites using combat, logistics or hacking roles.",
    skills: [
      { skill: "Navigation", level: 4 },
      { skill: "Capacitor Management", level: 4 },
      { skill: "Target Management", level: 4 },
      { skill: "Signature Analysis", level: 4 },
      { skill: "Shield Management", level: 4 },
      { skill: "Hacking", level: 3 },
    ],
  },
  {
    id: "nullsec-ratting",
    label: "Null-sec anomaly ratting",
    detail: "Sustained PvE damage, drone control, tank and mobility for anomalies.",
    skills: [
      { skill: "Drones", level: 5 },
      { skill: "Drone Interfacing", level: 4 },
      { skill: "Heavy Drone Operation", level: 4 },
      { skill: "Navigation", level: 4 },
      { skill: "Capacitor Management", level: 4 },
      { skill: "Weapon Upgrades", level: 4 },
    ],
  },
];

const activityMastery: Record<string, TrainingTarget[]> = {
  abyssal: [
    { skill: "CPU Management", level: 5 },
    { skill: "Power Grid Management", level: 5 },
    { skill: "Capacitor Management", level: 5 },
    { skill: "Capacitor Systems Operation", level: 5 },
    { skill: "Acceleration Control", level: 4 },
    { skill: "Fuel Conservation", level: 4 },
    { skill: "Thermodynamics", level: 4 },
    { skill: "Advanced Weapon Upgrades", level: 4 },
    { skill: "Drone Interfacing", level: 5 },
    { skill: "Drone Navigation", level: 5 },
    { skill: "Drone Sharpshooting", level: 5 },
    { skill: "Tactical Shield Manipulation", level: 4 },
  ],
  missions: [
    { skill: "CPU Management", level: 5 },
    { skill: "Power Grid Management", level: 5 },
    { skill: "Capacitor Systems Operation", level: 5 },
    { skill: "Signature Analysis", level: 4 },
    { skill: "Long Range Targeting", level: 4 },
    { skill: "Advanced Weapon Upgrades", level: 4 },
    { skill: "Drone Interfacing", level: 4 },
  ],
  exploration: [
    { skill: "Astrometric Acquisition", level: 4 },
    { skill: "Astrometric Pinpointing", level: 4 },
    { skill: "Astrometric Rangefinding", level: 4 },
    { skill: "Covert Ops", level: 4 },
    { skill: "Warp Drive Operation", level: 5 },
    { skill: "Navigation", level: 5 },
    { skill: "Interceptors", level: 4 },
  ],
  mining: [
    { skill: "Exhumers", level: 4 },
    { skill: "Reprocessing", level: 5 },
    { skill: "Mining Drone Operation", level: 5 },
    { skill: "Mining Drone Specialization", level: 4 },
    { skill: "Drone Interfacing", level: 4 },
    { skill: "Tactical Shield Manipulation", level: 4 },
  ],
  hauling: [
    { skill: "Transport Ships", level: 4 },
    { skill: "Cloaking", level: 4 },
    { skill: "Acceleration Control", level: 4 },
    { skill: "Cybernetics", level: 4 },
    { skill: "Marketing", level: 4 },
    { skill: "Daytrading", level: 4 },
    { skill: "Wholesale", level: 4 },
  ],
  industry: [
    { skill: "Advanced Mass Production", level: 4 },
    { skill: "Laboratory Operation", level: 5 },
    { skill: "Advanced Laboratory Operation", level: 4 },
    { skill: "Scientific Networking", level: 4 },
    { skill: "Metallurgy", level: 4 },
    { skill: "Research", level: 4 },
    { skill: "Invention", level: 4 },
  ],
  "faction-warfare": [
    { skill: "Acceleration Control", level: 4 },
    { skill: "High Speed Maneuvering", level: 4 },
    { skill: "Evasive Maneuvering", level: 5 },
    { skill: "Advanced Weapon Upgrades", level: 4 },
    { skill: "Signature Analysis", level: 5 },
    { skill: "Long Range Targeting", level: 4 },
  ],
  incursions: [
    { skill: "Logistics Cruisers", level: 4 },
    { skill: "Thermodynamics", level: 4 },
    { skill: "Shield Compensation", level: 4 },
    { skill: "Advanced Weapon Upgrades", level: 5 },
    { skill: "Signature Analysis", level: 5 },
  ],
  homefront: [
    { skill: "Remote Armor Repair Systems", level: 4 },
    { skill: "Shield Emission Systems", level: 4 },
    { skill: "Logistics Cruisers", level: 3 },
    { skill: "Hacking", level: 4 },
    { skill: "Thermodynamics", level: 4 },
  ],
  "nullsec-ratting": [
    { skill: "CPU Management", level: 5 },
    { skill: "Power Grid Management", level: 5 },
    { skill: "Heavy Drone Operation", level: 5 },
    { skill: "Sentry Drone Interfacing", level: 5 },
    { skill: "Drone Navigation", level: 5 },
    { skill: "Drone Sharpshooting", level: 5 },
    { skill: "Advanced Weapon Upgrades", level: 4 },
    { skill: "Thermodynamics", level: 4 },
  ],
};

const shipTraining: Record<string, TrainingTarget[]> = {
  Orca: [
    { skill: "Industrial Command Ships", level: 4 },
    { skill: "Mining Director", level: 5 },
    { skill: "Mining Foreman", level: 5 },
    { skill: "Leadership", level: 5 },
    { skill: "Drone Interfacing", level: 4 },
    { skill: "Shield Management", level: 4 },
  ],
  Gila: [
    { skill: "Caldari Cruiser", level: 4 },
    { skill: "Gallente Cruiser", level: 4 },
    { skill: "Drones", level: 5 },
    { skill: "Medium Drone Operation", level: 5 },
    { skill: "Shield Management", level: 4 },
  ],
  Ishtar: [
    { skill: "Gallente Cruiser", level: 5 },
    { skill: "Heavy Assault Cruisers", level: 4 },
    { skill: "Drones", level: 5 },
    { skill: "Heavy Drone Operation", level: 5 },
    { skill: "Drone Interfacing", level: 5 },
  ],
  Viator: [
    { skill: "Gallente Industrial", level: 5 },
    { skill: "Transport Ships", level: 4 },
    { skill: "Cloaking", level: 4 },
    { skill: "Evasive Maneuvering", level: 5 },
  ],
  Hulk: [
    { skill: "Mining Barge", level: 5 },
    { skill: "Exhumers", level: 4 },
    { skill: "Mining", level: 5 },
    { skill: "Astrogeology", level: 5 },
  ],
};

const popularPlannerShips = [
  "Gila",
  "Ishtar",
  "Orca",
  "Hulk",
  "Retriever",
  "Venture",
  "Heron",
  "Astero",
  "Drake",
  "Raven",
  "Viator",
];

export default function App() {
  const [view, setView] = useState<View>("overview");
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [snapshots, setSnapshots] = useState<CharacterSnapshot[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Local systems ready");
  const [cloneStates, setCloneStates] = useState<Record<string, CloneState>>(
    () => {
      try {
        return JSON.parse(localStorage.getItem("new-eden-sage-clone-states") ?? "{}");
      } catch {
        return {};
      }
    },
  );
  const [cloneConfirmationRequired, setCloneConfirmationRequired] =
    useState(true);
  const [resolvedTypeNames, setResolvedTypeNames] = useState<Record<number, string>>({});

  useEffect(() => {
    Promise.all([window.sage.getConfig(), window.sage.listSnapshots()]).then(
      ([nextConfig, nextSnapshots]) => {
        setConfig(nextConfig);
        setSnapshots(nextSnapshots);
        setActiveId(nextSnapshots[0]?.characterId ?? "");
        setCloneConfirmationRequired(Boolean(nextSnapshots[0]));
        if (!nextConfig.eveClientId) setView("settings");
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
    setMessage("Waiting for EVE authorization…");
    try {
      const result = await window.sage.loginWithEve();
      setSnapshots((current) => [
        ...current.filter((item) => item.characterId !== result.characterId),
        result.snapshot,
      ]);
      setActiveId(result.characterId);
      setCloneConfirmationRequired(true);
      setConfig(await window.sage.getConfig());
      setView("overview");
      setMessage(`${result.characterName} connected`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "EVE login failed");
    } finally {
      setBusy(false);
    }
  }

  async function refreshActive() {
    if (!active) return;
    setBusy(true);
    setMessage(`Syncing ${active.character.name}…`);
    try {
      const snapshot = await window.sage.refreshCharacter(active.characterId);
      setSnapshots((current) =>
        current.map((item) =>
          item.characterId === snapshot.characterId ? snapshot : item,
        ),
      );
      setMessage(`${snapshot.character.name} synced`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Character sync failed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeCharacter(characterId: string) {
    const remaining = await window.sage.removeCharacter(characterId);
    setSnapshots(remaining);
    setActiveId(remaining[0]?.characterId ?? "");
    setMessage("Character removed from this PC");
  }

  function selectCharacter(characterId: string) {
    setActiveId(characterId);
    setCloneConfirmationRequired(true);
    setMessage("Confirm Alpha or Omega clone state for accurate training times");
  }

  function confirmCloneState(characterId: string, state: CloneState) {
    const character = snapshots.find((snapshot) => snapshot.characterId === characterId);
    if (!character) return;
    setActiveId(characterId);
    const next = { ...cloneStates, [characterId]: state };
    setCloneStates(next);
    localStorage.setItem("new-eden-sage-clone-states", JSON.stringify(next));
    setCloneConfirmationRequired(false);
    setMessage(`${character.character.name}: ${state === "omega" ? "Omega" : "Alpha"} training speed selected`);
  }

  if (!config) return <div className="boot">Waking New Eden Sage…</div>;
  const active =
    snapshots.find((item) => item.characterId === activeId) ?? snapshots[0];

  return (
    <div className="app-shell">
      <aside>
        <div className="brand">
          <span className="brand-glyph">✦</span>
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
                    </small>
                  </div>
                </button>
                <div
                  className={`character-clone-state ${
                    active?.characterId === snapshot.characterId &&
                    cloneConfirmationRequired
                      ? "needs-confirmation"
                      : ""
                  }`}
                >
                  <button
                    className={
                      cloneStates[snapshot.characterId] === "alpha" &&
                      !(
                        active?.characterId === snapshot.characterId &&
                        cloneConfirmationRequired
                      )
                        ? "active"
                        : ""
                    }
                    title={`Alpha clone: ${snapshot.character.name}`}
                    onClick={() =>
                      confirmCloneState(snapshot.characterId, "alpha")
                    }
                  >
                    A
                  </button>
                  <button
                    className={
                      cloneStates[snapshot.characterId] === "omega" &&
                      !(
                        active?.characterId === snapshot.characterId &&
                        cloneConfirmationRequired
                      )
                        ? "active"
                        : ""
                    }
                    title={`Omega clone: ${snapshot.character.name}`}
                    onClick={() =>
                      confirmCloneState(snapshot.characterId, "omega")
                    }
                  >
                    Ω
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
            {active && (
              <button className="sync" onClick={refreshActive} disabled={busy}>
                ↻ Sync {active.character.name}
              </button>
            )}
            <button
              className="connect"
              onClick={connect}
              disabled={busy || !config.eveClientId}
            >
              {busy ? "Working…" : "+ Connect character"}
            </button>
          </div>
        </header>
        {view === "overview" && (
          <Overview
            snapshot={active}
            onConnect={connect}
            cloneState={active ? cloneStates[active.characterId] : undefined}
            confirmationRequired={cloneConfirmationRequired}
            resolvedTypeNames={resolvedTypeNames}
          />
        )}
        {view === "settings" && (
          <Settings config={config} onSaved={setConfig} />
        )}
        {view === "data" && (
          <DataVault
            activeCharacterId={active?.characterId}
            onImported={async () =>
              setSnapshots(await window.sage.listSnapshots())
            }
          />
        )}
        {view === "skills" && (
          <Skills
            snapshot={active}
            cloneState={active ? cloneStates[active.characterId] : undefined}
          />
        )}
        {view === "market" && <IskLab />}
        {view === "regional" && <RegionalMarket snapshot={active} />}
        {view === "fittings" && <FittingsWorkspace />}
        <footer>
          <span className="pulse" />
          {message}
          <span className="footer-right">Tranquility · local database</span>
        </footer>
      </main>
    </div>
  );
}

function Overview({
  snapshot,
  onConnect,
  cloneState,
  confirmationRequired,
  resolvedTypeNames,
}: {
  snapshot?: CharacterSnapshot;
  onConnect(): void;
  cloneState?: CloneState;
  confirmationRequired: boolean;
  resolvedTypeNames: Record<number, string>;
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
  const overviewSkillLevels = new Map(
    snapshot.skills.skills.map((skill) => [
      skill.name,
      skill.trained_skill_level,
    ]),
  );
  const rankedCurrentActivities = activityProfiles
    .map((profile) => ({
      profile,
      score:
        profile.skills.reduce(
          (sum, target) =>
            sum +
            Math.min(
              1,
              (overviewSkillLevels.get(target.skill) ?? 0) / target.level,
            ),
          0,
        ) / profile.skills.length,
    }))
    .sort((a, b) => b.score - a.score);
  const bestCurrentActivity = rankedCurrentActivities[0];
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
        <div className="augment-panel">
          <span>AUGMENTS</span>
          <div>
            {Array.isArray(snapshot.extended?.implants) &&
            snapshot.extended.implants.length ? (
              snapshot.extended.implants.slice(0, 7).map((implant: any) => (
                <small key={implant.typeId ?? implant}>
                  {implant.name ??
                    resolvedTypeNames[implant.typeId ?? implant] ??
                    "Resolving implant name…"}
                </small>
              ))
            ) : (
              <small>No active implants</small>
            )}
          </div>
          {confirmationRequired && (
            <em>Select A or Ω beside this character for accurate training times.</em>
          )}
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
      <div className="split">
        <TrainingVector
          snapshot={snapshot}
          queueFinish={queueFinish}
          cloneState={cloneState}
          confirmationRequired={confirmationRequired}
        />
        <article className="capability-radar">
          <p className="eyebrow">CAPABILITY RADAR</p>
          <h3>Top 5 current activity matches</h3>
          <ol>
            {rankedCurrentActivities.slice(0, 5).map((item) => (
              <li key={item.profile.id}>
                <span>{item.profile.label}</span>
                <div><i style={{ width: `${Math.round(item.score * 100)}%` }} /></div>
                <strong>{Math.round(item.score * 100)}%</strong>
              </li>
            ))}
          </ol>
          <p>
            Rankings compare the currently synced skill levels against each
            activity’s core skill profile.
          </p>
        </article>
      </div>
    </section>
  );
}

function TrainingVector({
  snapshot,
  queueFinish,
  cloneState,
  confirmationRequired,
}: {
  snapshot: CharacterSnapshot;
  queueFinish?: string;
  cloneState?: CloneState;
  confirmationRequired: boolean;
}) {
  const skillByName = new Map(
    snapshot.skills.skills.map((skill) => [skill.name, skill]),
  );
  const activityScores = activityProfiles.map((profile) => ({
    profile,
    score:
      profile.skills.reduce((sum, target) => {
        const level = skillByName.get(target.skill)?.trained_skill_level ?? 0;
        return sum + Math.min(1, level / target.level);
      }, 0) / profile.skills.length,
  }));
  const best = [...activityScores].sort((a, b) => b.score - a.score)[0];
  const ownedShips =
    snapshot.extended?.assetSummary?.ownedShips?.map((ship) => ship.item) ?? [];
  const initialShips = [
    ...new Set(
      [snapshot.ship.ship_type_name, ...ownedShips, ...popularPlannerShips].filter(
        Boolean,
      ),
    ),
  ] as string[];
  const [shipOptions, setShipOptions] = useState<
    Array<{ typeId?: number; name: string }>
  >(initialShips.map((name) => ({ name })));
  const [activityId, setActivityId] = useState(best.profile.id);
  const [ship, setShip] = useState(
    snapshot.ship.ship_type_name || initialShips[0],
  );
  const [hullTargets, setHullTargets] = useState<TrainingTarget[]>([]);
  useEffect(() => {
    window.sage.listShips().then((allShips) => {
      const byName = new Map(allShips.map((item) => [item.name, item]));
      for (const name of initialShips)
        if (!byName.has(name)) byName.set(name, { name, typeId: undefined as any });
      setShipOptions([...byName.values()].sort((a, b) => a.name.localeCompare(b.name)));
    });
  }, []);
  useEffect(() => {
    setActivityId(best.profile.id);
    setShip(snapshot.ship.ship_type_name || initialShips[0]);
  }, [snapshot.characterId, snapshot.updatedAt]);
  useEffect(() => {
    const selectedHull = shipOptions.find((item) => item.name === ship);
    if (!selectedHull?.typeId) {
      setHullTargets([]);
      return;
    }
    let cancelled = false;
    window.sage
      .analyzeFitting({
        characterId: snapshot.characterId,
        hullTypeId: selectedHull.typeId,
        itemTypeIds: [],
      })
      .then((analysis) => {
        if (cancelled) return;
        setHullTargets(
          (analysis.requirements ?? []).flatMap((requirement: any) =>
            (requirement.skills ?? []).map((skill: any) => ({
              skill: skill.skill,
              level: skill.requiredLevel,
            })),
          ),
        );
      })
      .catch(() => !cancelled && setHullTargets([]));
    return () => {
      cancelled = true;
    };
  }, [ship, shipOptions, snapshot.characterId]);
  const selectedActivity =
    activityProfiles.find((profile) => profile.id === activityId) ?? best.profile;
  const combinedTargets = new Map<string, number>();
  for (const target of [
    ...selectedActivity.skills,
    ...(activityMastery[activityId] ?? []),
    ...(shipTraining[ship] ?? []),
    ...hullTargets,
  ])
    combinedTargets.set(
      target.skill,
      Math.max(combinedTargets.get(target.skill) ?? 0, target.level),
    );
  const path = [...combinedTargets]
    .map(([skill, level]) => {
      const trained = skillByName.get(skill);
      const current = trained?.trained_skill_level ?? 0;
      const estimate = trained?.timeToLevels?.find(
        (item) => item.level === level,
      );
      return { skill, level, current, seconds: estimate?.seconds ?? null };
    })
    .filter((target) => target.current < target.level)
    .sort((a, b) => a.level - b.level || a.current - b.current);
  const readiness = Math.round(
    (activityScores.find((item) => item.profile.id === activityId)?.score ?? 0) *
      100,
  );
  return (
    <article className="training-vector">
      <p className="eyebrow">SKILL PATH PLANNER</p>
      <div className="training-selectors">
        <label>
          Ship
          <input
            list="eve-ship-types"
            value={ship}
            onChange={(event) => setShip(event.target.value)}
            placeholder="Search every EVE ship…"
          />
          <datalist id="eve-ship-types">
            {shipOptions.map((item) => (
              <option key={`${item.typeId ?? "local"}-${item.name}`} value={item.name} />
            ))}
          </datalist>
        </label>
        <label>
          Activity
          <select
            value={activityId}
            onChange={(event) => setActivityId(event.target.value)}
          >
            {activityProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="training-summary">
        <h3>{readiness}% ready for {selectedActivity.label}</h3>
        <span>
          Best current match: {best.profile.label} ({Math.round(best.score * 100)}%)
        </span>
        <p>{selectedActivity.detail}</p>
      </div>
      <div className="recommended-queue">
        <strong>Recommended path for {ship}</strong>
        {path.length ? (
          <ol>
            {path.slice(0, 14).map((target) => (
              <li key={target.skill}>
                <span>{target.skill}</span>
                <small>
                  Level {target.current} → {target.level}
                  {target.seconds !== null && cloneState && !confirmationRequired
                    ? ` · about ${duration(target.seconds / (cloneState === "alpha" ? 0.5 : 1))}`
                    : " · confirm clone state for time"}
                </small>
              </li>
            ))}
          </ol>
        ) : (
          <p>All selected activity and ship targets are already trained.</p>
        )}
      </div>
      <small className="queue-state">
        {queueFinish
          ? `Live EVE queue: next completion ${new Date(queueFinish).toLocaleString()}`
          : "Live EVE queue has no active completion date."}
      </small>
    </article>
  );
}

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
  onSaved,
}: {
  config: PublicConfig;
  onSaved(config: PublicConfig): void;
}) {
  const [clientId, setClientId] = useState(config.eveClientId);
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    onSaved(
      await window.sage.saveConfig({
        eveClientId: clientId,
      }),
    );
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }
  return (
    <section className="settings">
      <div className="settings-copy">
        <p className="eyebrow">PRIVATE CONFIGURATION</p>
        <h2>Connect EVE Online</h2>
        <p>
          EVE refresh tokens are encrypted using Windows secure storage. The EVE
          Client ID is public application metadata.
        </p>
      </div>
      <form onSubmit={submit}>
        <label>
          EVE Client ID
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Paste the Client ID from CCP"
          />
        </label>
        <label>
          Callback URL
          <input value={config.callbackUrl} readOnly />
        </label>
        <div className="form-note">
          Do not enter your EVE Client Secret. New Eden Sage uses PKCE.
        </div>
        <button className="primary" type="submit">
          {saved ? "Saved" : "Save securely"}
        </button>
      </form>
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
function DataVault({
  onImported,
  activeCharacterId,
}: {
  onImported(): void;
  activeCharacterId?: string;
}) {
  const [status, setStatus] = useState(
    "Everything exported here excludes API keys and EVE tokens.",
  );
  async function exportAs(format: "json" | "chatgpt" | "chatgpt-radius") {
    try {
      const file = await window.sage.exportData(format, activeCharacterId);
      if (file) setStatus(`Saved to ${file}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Export failed.");
    }
  }
  async function importFiles() {
    const result = await window.sage.importData();
    if (result) {
      setStatus(
        `Imported ${result.files} file(s): ${result.snapshots} snapshots and ${result.information} information records.`,
      );
      onImported();
    }
  }
  async function exportDebugLog() {
    const file = await window.sage.exportDebugLog();
    if (file) setStatus(`Diagnostic log saved to ${file}`);
  }
  return (
    <section className="vault">
      <div>
        <p className="eyebrow">PORTABLE LOCAL DATA</p>
        <h2>Own your information</h2>
        <p>
          Back up everything New Eden Sage currently knows, bring notes back in,
          or create a strategy pack for ChatGPT Plus.
        </p>
      </div>
      <div className="vault-grid">
        <article>
          <span>01</span>
          <h3>Complete backup</h3>
          <p>
            Export all locally stored character snapshots and imported
            information as JSON. Secrets are always excluded.
          </p>
          <button onClick={() => exportAs("json")}>Export all data</button>
        </article>
        <article>
          <span>02</span>
          <h3>Character pack</h3>
          <p>
            Create readable character Markdown that you can upload to ChatGPT
            Plus.
          </p>
          <button onClick={() => exportAs("chatgpt")}>
            Export character data
          </button>
        </article>
        <article>
          <span>03</span>
          <h3>Trade pack</h3>
          <p>
            Export two ChatGPT-compatible Excel workbooks with one worksheet per
            region: station orders and public contracts.
          </p>
          <button onClick={() => exportAs("chatgpt-radius")}>
            Export full station + contract workbooks
          </button>
        </article>
        <article>
          <span>04</span>
          <h3>Import information</h3>
          <p>
            Import a previous Sage backup, Markdown strategy notes, text
            documents, or JSON reference data.
          </p>
          <button onClick={importFiles}>Import information</button>
        </article>
        <article>
          <span>05</span>
          <h3>Diagnostic log</h3>
          <p>
            Export the local activity and error log for debugging. Secrets and
            authentication tokens are excluded.
          </p>
          <button onClick={exportDebugLog}>Export diagnostic log</button>
        </article>
      </div>
      <div className="vault-status">{status}</div>
    </section>
  );
}

function RegionalMarket({ snapshot }: { snapshot?: CharacterSnapshot }) {
  const [regions, setRegions] = useState<
    Array<{ regionId: number; name: string }>
  >([]);
  const [selected, setSelected] = useState(10000002);
  const [summaries, setSummaries] = useState<MarketSummary[]>([]);
  const [activeRegion, setActiveRegion] = useState<number>(10000002);
  const [busy, setBusy] = useState(false);
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
    return window.sage.onMarketProgress((item) =>
      setProgress(
        `${item.regionName}: page ${item.pagesDone}/${item.pagesTotal} · regions ${item.regionsDone}/${item.regionsTotal}`,
      ),
    );
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
      await showRegion(selected);
      setProgress(
        `Dataset saved to ${result.storage.path}. ${result.storage.retained} total snapshots retained.`,
      );
    } catch (error) {
      setProgress(
        error instanceof Error ? error.message : "Market pull failed",
      );
    } finally {
      setBusy(false);
    }
  }
  async function refreshEverything() {
    if (!snapshot) {
      setProgress("Connect and sync a character before refreshing everything.");
      return;
    }
    setBusy(true);
    setSelectedItem(null);
    try {
      setProgress("Step 1 of 4: syncing character location and information...");
      await window.sage.refreshCharacter(snapshot.characterId);
      setProgress("Step 2 of 4: pulling the 20-jump character market...");
      await window.sage.pullMarket({
        mode: "radius",
        characterId: snapshot.characterId,
        includeLowSec,
      });
      setProgress("Step 3 of 4: pulling every high-sec station market...");
      const stations = await window.sage.pullMarket({ mode: "all" });
      setSummaries(stations.summaries);
      setProgress("Step 4 of 4: pulling every high-sec public contract...");
      const contracts = await window.sage.pullMarket({ mode: "contracts" });
      setSummaries(contracts.summaries);
      const storageInfo = await window.sage.getMarketStorage();
      setStorage(storageInfo);
      await showRegion(selected);
      setProgress(
        `Everything refreshed: 20-jump market, full high-sec station orders and full high-sec contracts. ${storageInfo.retainedDatasets} historical datasets stored.`,
      );
    } catch (error) {
      setProgress(
        error instanceof Error
          ? error.message
          : "Complete market refresh failed.",
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
          <label className="lowsec-check">
            <input
              type="checkbox"
              checked={includeLowSec}
              onChange={(event) => setIncludeLowSec(event.target.checked)}
            />
            Include low-sec
          </label>
          <button
            className="all-regions refresh-everything"
            onClick={refreshEverything}
            disabled={busy || !snapshot}
          >
            {busy ? "Refreshing everything..." : "Refresh everything"}
          </button>
        </div>
      </div>
      <div className="market-progress">
        <span className={busy ? "pulse" : ""} />
        <div>
          {progress}
          {storage && (
            <small>
              Storage: {storage.path} · {storage.retainedDatasets} datasets
              currently retained
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
              placeholder="Search all items in this region…"
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
                  <p className="eyebrow">RETAINED MARKET DEPTH</p>
                  <h3>{selectedItem.typeName}</h3>
                </div>
                <button onClick={() => setSelectedItem(null)}>Close</button>
              </div>
              {!selectedItem.topBuyOrders && !selectedItem.topSellOrders ? (
                <div className="reindex-note">
                  Pull this market again to store its top 10 buyers and sellers.
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
          {money(omitted)} lower-priority orders omitted from storage
        </small>
      )}
    </div>
  );
}
