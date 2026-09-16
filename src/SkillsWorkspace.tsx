import { useEffect, useMemo, useState } from "react";
import type {
  CharacterSnapshot,
  ShipReadinessResult,
  SkillDetail,
  FitResolutionIntent,
  FitRemedyCandidate,
} from "./types";
import { describeSkill, getSkillTrainingState } from "./skill-intelligence";
import { ActivityPlanner } from "./ActivityPlanner";
import { TrainingTimeNotice } from "./TrainingTimeNotice";
import { ProgressionPriorities } from "./ProgressionPriorities";

export type SkillsTab = "my-skills" | "planner" | "activity-planner";
type CloneState = "alpha" | "omega";

type Props = {
  snapshot?: CharacterSnapshot;
  cloneState?: CloneState;
  confirmationRequired?: boolean;
  activeTab?: SkillsTab;
  onTabChange?(tab: SkillsTab): void;
  initialHullTypeId?: number;
  initialFitIntent?: FitResolutionIntent;
};

const money = (value: number) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);

function duration(seconds: number | null) {
  if (seconds === null) return "Unavailable";
  if (seconds <= 0) return "Ready now";
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.ceil((seconds % 86400) / 3600)}h`;
}

export function SkillsWorkspace({ snapshot, cloneState, confirmationRequired, activeTab, onTabChange, initialHullTypeId, initialFitIntent }: Props) {
  const [localTab, setLocalTab] = useState<SkillsTab>(initialHullTypeId ? "planner" : "activity-planner");
  const tab = activeTab ?? localTab;
  const setTab = (next: SkillsTab) => { if (onTabChange) onTabChange(next); else setLocalTab(next); };
  useEffect(() => { if (initialHullTypeId) setTab("planner"); }, [initialHullTypeId]);

  if (!snapshot) {
    return (
      <section className="empty">
        <p className="eyebrow">NO CAPSULEER SELECTED</p>
        <h2>Connect a character to use Activity Command</h2>
        <p>
          Activity Planner, Ship Planner and My Skills use your locally synced EVE
          character data.
        </p>
      </section>
    );
  }

  return (
    <section className={`skills-workspace${tab === "activity-planner" ? " activity-command-workspace" : ""}`}>
      {tab !== "activity-planner" && (
        <>
          <div className="skills-workspace-head">
        <div>
          <p className="eyebrow">CAPSULEER DEVELOPMENT</p>
          <h2>{snapshot.character.name}</h2>
          <p>
            {money(snapshot.skills.total_sp)} total skill points · {snapshot.skills.skills.length} trained skills · {snapshot.queue.length} queue entries
          </p>
        </div>
      </div>
      <ProgressionPriorities snapshot={snapshot} cloneState={cloneState} />
      {(confirmationRequired || !cloneState) && <TrainingTimeNotice cloneState={cloneState} />}
        </>
      )}
      <div className="skills-tabs" role="tablist" aria-label="Activity Command sections">
        <button
          className={tab === "activity-planner" ? "active" : ""}
          onClick={() => setTab("activity-planner")}
        >
          Activity Planner
        </button>
        <button
          className={tab === "planner" ? "active" : ""}
          onClick={() => setTab("planner")}
        >
          Ship Planner
        </button>
        <button
          className={tab === "my-skills" ? "active" : ""}
          onClick={() => setTab("my-skills")}
        >
          My Skills
        </button>
      </div>
      <div className="cached-view" hidden={tab !== "my-skills"}>
        <MySkills snapshot={snapshot} cloneState={cloneState} />
      </div>
      <div className="cached-view" hidden={tab !== "planner"}>
        <ShipPlanner snapshot={snapshot} cloneState={cloneState} initialHullTypeId={initialHullTypeId} initialFitIntent={initialFitIntent} />
      </div>
      <div className="cached-view" hidden={tab !== "activity-planner"}>
        <ActivityPlanner snapshot={snapshot} cloneState={cloneState} />
      </div>
    </section>
  );
}

function MySkills({
  snapshot,
  cloneState,
}: {
  snapshot: CharacterSnapshot;
  cloneState?: CloneState;
}) {
  const [filter, setFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState<"all" | "2" | "3" | "4" | "5">("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const skills = useMemo(
    () =>
      snapshot.skills.skills.filter((skill) => {
        const name = skill.name ?? `Skill ${skill.skill_id}`;
        if (!name.toLowerCase().includes(filter.toLowerCase())) return false;
        if (levelFilter === "all") return true;
        return skill.trained_skill_level === Number(levelFilter);
      }),
    [snapshot, filter, levelFilter],
  );

  const selected =
    selectedId === null
      ? undefined
      : snapshot.skills.skills.find((skill) => skill.skill_id === selectedId);

  return (
    <div className="my-skills-layout">
      <div className="my-skills-main">
        <div className="skill-toolbar">
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter skills..."
          />
          <div className="skill-level-filters" aria-label="Skill level filter">
            {(["all", "2", "3", "4", "5"] as const).map((level) => (
              <button
                key={level}
                className={levelFilter === level ? "active" : ""}
                onClick={() => setLevelFilter(level)}
              >
                {level === "all" ? "All" : `L${level}`}
              </button>
            ))}
          </div>
          <small>{skills.length} shown</small>
        </div>
        <div className="skill-table task2-skill-table">
          <div className="skill-row task2-skill-row heading">
            <span>Skill</span>
            <span>Level</span>
            <span>SP</span>
            <span>Training / next levels</span>
            <span>State</span>
          </div>
          {skills.map((skill) => {
            const training = getSkillTrainingState(snapshot, skill);
            return (
              <button
                className={`skill-row task2-skill-row skill-select-row ${selectedId === skill.skill_id ? "selected" : ""}`}
                key={skill.skill_id}
                onClick={() => setSelectedId(skill.skill_id)}
              >
                <span>
                  <strong>{skill.name ?? `Skill ${skill.skill_id}`}</strong>
                  <small>Rank {skill.rank ?? "-"}</small>
                </span>
                <span className="level">
                  <b>L{skill.trained_skill_level}</b>
                  <i>
                    {"●".repeat(skill.trained_skill_level)}
                    {"○".repeat(5 - skill.trained_skill_level)}
                  </i>
                </span>
                <span>{money(skill.skillpoints_in_skill)}</span>
                <span className="times">
                  {skill.timeToLevels?.length ? (
                    skill.timeToLevels.slice(0, 3).map((item) => (
                      <em key={item.level}>
                        L{item.level}: {item.queuedFinishDate
                          ? new Date(item.queuedFinishDate).toLocaleString()
                          : duration(
                              item.seconds === null || !cloneState
                                ? item.seconds
                                : item.seconds /
                                    (cloneState === "alpha" ? 0.5 : 1),
                            )}
                      </em>
                    ))
                  ) : (
                    <em>
                      {skill.trained_skill_level === 5
                        ? "Level V complete"
                        : "Sync for estimates"}
                    </em>
                  )}
                </span>
                <span className={`skill-state ${training.queued ? "queued" : ""}`}>
                  {training.trainingNow
                    ? "Training"
                    : training.queued
                      ? `Queued L${training.queuedLevel ?? ""}`
                      : skill.trained_skill_level === 5
                        ? "Complete"
                        : "Available"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <SkillDetailPanel
        snapshot={snapshot}
        skill={selected}
        cloneState={cloneState}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}

function SkillDetailPanel({
  snapshot,
  skill,
  cloneState,
  onClose,
}: {
  snapshot: CharacterSnapshot;
  skill?: SkillDetail;
  cloneState?: CloneState;
  onClose(): void;
}) {
  if (!skill) {
    return (
      <aside className="skill-detail-panel empty-detail">
        <p className="eyebrow">SKILL DETAIL</p>
        <h3>Select a skill</h3>
        <p>
          Choose any row to inspect training state, bonuses, affected ships/modules
          and activity relevance.
        </p>
      </aside>
    );
  }

  const impact = describeSkill(skill);
  const training = getSkillTrainingState(snapshot, skill);
  const next = skill.timeToLevels?.[0];

  const selectedSkill = skill;
  async function copyQueueInstruction() {
    const nextLevel = Math.min(
      5,
      Math.max(selectedSkill.trained_skill_level + 1, training.queuedLevel ?? 0),
    );
    await window.sage.copyText(`${selectedSkill.name} ${nextLevel}`);
  }

  return (
    <aside className="skill-detail-panel">
      <div className="skill-detail-title">
        <div>
          <p className="eyebrow">SKILL DETAIL</p>
          <h3>{skill.name}</h3>
        </div>
        <button onClick={onClose}>×</button>
      </div>
      <div className="skill-detail-level">
        <strong>Level {skill.trained_skill_level}</strong>
        <span>
          {money(skill.skillpoints_in_skill)} SP · Rank {skill.rank}
        </span>
      </div>
      <p className="skill-detail-summary">{impact.summary}</p>
      <DetailGroup title="Bonuses" items={impact.bonuses} />
      <DetailGroup title="Ships affected" items={impact.ships} />
      <DetailGroup title="Modules / systems" items={impact.modules} />
      <DetailGroup title="Activities" items={impact.activities} />
      <div className="skill-training-detail">
        <strong>Training state</strong>
        <span>
          {training.trainingNow
            ? `Training to L${training.queuedLevel}`
            : training.queued
              ? `Queued to L${training.queuedLevel}`
              : skill.trained_skill_level === 5
                ? "Level V complete"
                : "Not currently queued"}
        </span>
        {training.queuedFinishDate && (
          <small>
            Queue finish: {new Date(training.queuedFinishDate).toLocaleString()}
          </small>
        )}
        {!training.queued && next && skill.trained_skill_level < 5 && (
          <small>
            Next level estimate: {duration(
              next.seconds === null || !cloneState
                ? next.seconds
                : next.seconds / (cloneState === "alpha" ? 0.5 : 1),
            )}
          </small>
        )}
      </div>
      {skill.trained_skill_level < 5 && (
        <button className="skill-queue-action" onClick={copyQueueInstruction}>
          Copy next-level queue instruction
        </button>
      )}
      <small className="skill-action-note">
        EVE skill queues remain read-only in Sage; this copies an exact skill/level
        instruction rather than pretending to alter the live queue.
      </small>
    </aside>
  );
}

function DetailGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="skill-detail-group">
      <strong>{title}</strong>
      <div>
        {items.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </div>
  );
}

function FitResolutionPlan({ intent }: { intent: FitResolutionIntent }) {
  const missing = [...new Map(intent.missingRequirements.map((item) => [`${item.skillId}:${item.requiredLevel}`, item])).values()];
  const supportSkills = intent.remedies.filter((item) => item.kind === "skill");
  const implants = intent.remedies.filter((item) => item.kind === "implant" || item.kind === "implant-set");
  const rigs = intent.remedies.filter((item) => item.kind === "rig");
  const moduleChanges = intent.remedies.filter((item) => item.kind === "module");
  const hardIssues = intent.issues.filter((issue) => issue.code !== "cpu-exceeded" && issue.code !== "powergrid-exceeded");
  const blockerCount = intent.issues.length + missing.length;
  const abyss = intent.abyss;
  const performance = intent.performance;
  const fmt = (value: number | undefined, digits = 0) => value == null || !Number.isFinite(value) ? "--" : value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const clock = (seconds: number | undefined) => {
    if (seconds == null || !Number.isFinite(seconds)) return "--";
    const safe = Math.max(0, Math.round(seconds));
    return `${Math.floor(safe / 60)}m ${String(safe % 60).padStart(2, "0")}s`;
  };
  const signedClock = (seconds: number | undefined) => {
    if (seconds == null || !Number.isFinite(seconds)) return "--";
    const sign = seconds < 0 ? "-" : "+";
    return `${sign}${clock(Math.abs(seconds))}`;
  };
  const resourceLabel = (item: FitRemedyCandidate) => item.solves.map((code) => code === "cpu-exceeded" ? "CPU" : code === "powergrid-exceeded" ? "Powergrid" : code).join(" + ");
  const resultLabel = (item: FitRemedyCandidate) => item.result
    ? `${item.result.used.toFixed(1)} / ${item.result.capacity.toFixed(1)} ${item.result.resource === "cpu" ? "tf" : "MW"} (${item.result.headroom.toFixed(1)} spare)`
    : "";
  const rigRackFull = Boolean(intent.rigSlots && intent.rigSlots.capacity > 0 && intent.rigSlots.used >= intent.rigSlots.capacity);

  const tankRatio = abyss && performance && abyss.averageIncomingDps > 0
    ? performance.scenarioTankEhpPerSecond / abyss.averageIncomingDps
    : 0;
  const representativeMargin = abyss?.representativeTimerMarginSeconds;
  const heavyMargin = abyss?.heavyKnownTimerMarginSeconds;
  const capFailsRepresentative = Boolean(
    abyss && performance && !performance.capStable && performance.capDepletionSeconds > 0 &&
    performance.capDepletionSeconds < abyss.representativeClearSeconds,
  );

  let verdict: "ready" | "marginal" | "not-ready" | "blocked" = "ready";
  if (blockerCount > 0) verdict = "blocked";
  else if (abyss && (
    Number(representativeMargin ?? 0) < 0 ||
    (tankRatio > 0 && tankRatio < 1) ||
    capFailsRepresentative
  )) verdict = "not-ready";
  else if (abyss && (
    Number(representativeMargin ?? 0) < 180 ||
    (tankRatio > 0 && tankRatio < 1.25) ||
    Boolean(performance && !performance.capStable && performance.capDepletionSeconds > 0)
  )) verdict = "marginal";

  const verdictLabel = verdict === "ready" ? "MODELED READY" : verdict === "marginal" ? "MARGINAL" : verdict === "blocked" ? "FIT BLOCKED" : "NOT READY";
  const improvements: Array<{ tone: "danger" | "warn" | "good" | "info"; area: string; title: string; body: string }> = [];

  if (blockerCount > 0) {
    improvements.push({
      tone: "danger",
      area: "Fit blockers",
      title: `${blockerCount} fitting or skill blocker${blockerCount === 1 ? "" : "s"} must be cleared first`,
      body: "Resolve the exact requirements below before treating any Abyss performance number as operational.",
    });
  }
  if (abyss) {
    if (abyss.representativeTimerMarginSeconds < 0) {
      improvements.push({
        tone: "danger",
        area: "Clear speed",
        title: `Representative clear misses the timer by ${clock(Math.abs(abyss.representativeTimerMarginSeconds))}`,
        body: performance?.droneDps && performance.droneDps >= performance.weaponDps
          ? "Damage is drone-led. Prioritise drone damage, application and travel-time improvements before adding more tank."
          : "Prioritise applied damage, ammunition/application and target-clear time before adding more tank.",
      });
    } else if (abyss.representativeTimerMarginSeconds < 180) {
      improvements.push({
        tone: "warn",
        area: "Clear speed",
        title: `Only ${clock(abyss.representativeTimerMarginSeconds)} representative timer margin`,
        body: "That leaves little recovery room for slow target selection, bad positioning or a harder-than-average room. More applied DPS is the first useful gain.",
      });
    } else if (abyss.representativeTimerMarginSeconds < 300) {
      improvements.push({
        tone: "info",
        area: "Clear speed",
        title: `${clock(abyss.representativeTimerMarginSeconds)} representative timer margin`,
        body: "Workable, but another damage/application improvement would make the run less sensitive to room variance.",
      });
    }

    if (tankRatio > 0 && tankRatio < 1) {
      improvements.push({
        tone: "danger",
        area: "Tank",
        title: `Modeled tank covers only ${fmt(tankRatio, 2)}x average incoming pressure`,
        body: "Average room pressure exceeds modeled effective repair. Increase weather-relevant tank or reduce incoming damage through range, speed or kill priority.",
      });
    } else if (tankRatio > 0 && tankRatio < 1.5) {
      improvements.push({
        tone: "warn",
        area: "Tank",
        title: `${fmt(tankRatio, 2)}x average tank coverage is thin`,
        body: "The average is covered, but room spikes can erase that margin. Improve effective repair/resists or shorten hostile time-on-grid.",
      });
    }

    if (performance && !performance.capStable) {
      if (capFailsRepresentative) {
        improvements.push({
          tone: "danger",
          area: "Capacitor",
          title: `Cap depletes in ${clock(performance.capDepletionSeconds)} before the modeled site clears`,
          body: `The representative site estimate is ${clock(abyss.representativeClearSeconds)}. Reduce active cap demand or add sustainable capacitor before relying on this setup.`,
        });
      } else {
        improvements.push({
          tone: "warn",
          area: "Capacitor",
          title: `Cap is not stable (${clock(performance.capDepletionSeconds)} from full)`,
          body: "The modeled run may fit inside the capacitor window, but neut pressure and imperfect module cycling can remove that buffer.",
        });
      }
    }

    if (Number.isFinite(heavyMargin) && Number(heavyMargin) < 180) {
      improvements.push({
        tone: Number(heavyMargin) < 0 ? "danger" : "warn",
        area: "Room variance",
        title: Number(heavyMargin) < 0
          ? `Known heavy-room envelope misses timer by ${clock(Math.abs(Number(heavyMargin)))}`
          : `Known heavy-room envelope leaves only ${clock(Number(heavyMargin))}`,
        body: "The representative average is not the whole risk picture. Keep extra clear-speed and tank headroom for the heavier documented compositions.",
      });
    }
  }

  if (improvements.length === 0 && abyss) {
    improvements.push({
      tone: "good",
      area: "Overall",
      title: "No obvious modeled weak point is dominating this fit",
      body: "Representative clear speed, average tank coverage and capacitor are all within the current review thresholds. Extra margin should now be aimed at the known heavy-room envelope and piloting comfort.",
    });
  }

  const FixRows = ({ items, empty }: { items: FitRemedyCandidate[]; empty: string }) => <div className="fit-review-fix-list">
    {items.length ? items.map((item, index) => <div key={`${item.kind}-${item.typeId}-${index}`}>
      <strong>{item.replacement ? `${item.replacement.count}x ${item.replacement.fromName} → ${item.replacement.count}x ${item.replacement.toName}` : item.kind === "implant-set" ? `${item.components?.length ?? 0}-implant set` : item.name}</strong>
      <span>{resourceLabel(item)}</span>
      <small>{item.reason}</small>
      {item.kind === "implant-set" && item.components?.length ? <em>{item.components.map((part) => `${part.name}${part.slot ? ` (slot ${part.slot})` : ""}`).join(" + ")}</em> : null}
      {item.result && <em>{resultLabel(item)}</em>}
    </div>) : <small>{empty}</small>}
  </div>;

  if (!abyss) {
    return <section className="fit-resolution-plan fit-review-generic">
      <div className="fit-resolution-title"><div><p className="eyebrow">FIT RESOLUTION</p><h3>{intent.fitName}</h3><small>{intent.hullName} - exact fitting blockers from Fitting Command</small></div><strong>{blockerCount} blockers</strong></div>
      {blockerCount === 0 ? <div className="fit-resolution-ready">This fit is already viable for the selected pilot.</div> : <p className="fit-review-summary-copy">Resolve the blockers below before using the fit. Detailed alternatives are grouped so the page stays readable.</p>}
      <details className="fit-review-detail" open={blockerCount > 0}><summary>Required skills <span>{missing.length + supportSkills.length}</span></summary>
        <div className="fit-review-fix-list">{missing.map((item) => <div key={`${item.skillId}:${item.requiredLevel}`}><strong>{item.skill}</strong><span>L{item.trainedLevel} → L{item.requiredLevel}</span><small>Required by {item.item}</small></div>)}</div>
      </details>
      <details className="fit-review-detail"><summary>Exact fitting remedies <span>{implants.length + rigs.length + moduleChanges.length}</span></summary>
        <div className="fit-review-fix-grid"><article><h4>Implants</h4><FixRows items={implants} empty="No verified implant fix." /></article><article><h4>Rigs</h4><FixRows items={rigRackFull ? [] : rigs} empty={rigRackFull ? `Rig rack is full (${intent.rigSlots!.used}/${intent.rigSlots!.capacity}).` : "No verified free-slot rig fix."} /></article><article><h4>Module swaps</h4><FixRows items={moduleChanges} empty="No verified same-group module swap." /></article></div>
      </details>
    </section>;
  }

  return <section className={`fit-resolution-plan abyss-fit-review verdict-${verdict}`}>
    <div className="abyss-review-hero">
      <div>
        <p className="eyebrow">ACTIVITY COMMAND - ABYSS FIT REVIEW</p>
        <h2>T{abyss.tier} {abyss.weather.charAt(0).toUpperCase() + abyss.weather.slice(1)} - {intent.fitName}</h2>
        <p>{intent.hullName} against the exact scenario exported from Fitting Command. This review keeps run risk, clear speed and fit fixes separate instead of mixing everything together.</p>
      </div>
      <div className={`abyss-review-verdict ${verdict}`}><span>RUN VERDICT</span><strong>{verdictLabel}</strong><small>{blockerCount ? `${blockerCount} blockers before launch` : verdict === "ready" ? "Healthy representative margins" : "Review priority items below"}</small></div>
    </div>

    <div className="abyss-review-metrics">
      <article className="primary"><span>Scenario DPS</span><strong>{fmt(abyss.averageTargetDps, 1)}</strong><small>against averaged weather-adjusted targets</small></article>
      <article><span>3-room clear</span><strong>{clock(abyss.representativeClearSeconds)}</strong><small>representative modeled site</small></article>
      <article className={abyss.representativeTimerMarginSeconds < 180 ? "risk" : "good"}><span>Timer margin</span><strong>{signedClock(abyss.representativeTimerMarginSeconds)}</strong><small>against 20-minute limit</small></article>
      <article><span>Average incoming</span><strong>{fmt(abyss.averageIncomingDps, 1)} DPS</strong><small>{fmt(abyss.averageHostilesPerRoom, 1)} hostiles / room average</small></article>
      <article className={tankRatio > 0 && tankRatio < 1 ? "risk" : tankRatio > 0 && tankRatio < 1.5 ? "warn" : "good"}><span>Tank coverage</span><strong>{tankRatio > 0 ? `${fmt(tankRatio, 2)}x` : "--"}</strong><small>{performance ? `${fmt(performance.scenarioTankEhpPerSecond, 1)} EHP/s modeled tank` : "scenario tank unavailable"}</small></article>
      <article className={performance?.capStable ? "good" : capFailsRepresentative ? "risk" : "warn"}><span>Capacitor</span><strong>{performance ? performance.capStable ? `Stable ${fmt(performance.capStablePercent, 1)}%` : clock(performance.capDepletionSeconds) : "--"}</strong><small>{performance?.capStable ? `${fmt(performance.capPeakMarginGjPerSecond, 2)} GJ/s peak margin` : "from full capacitor"}</small></article>
    </div>

    <section className="abyss-review-priority">
      <header><div><p className="eyebrow">PRIORITY REVIEW</p><h3>What to improve first</h3></div><span>{improvements.length} findings</span></header>
      <div>{improvements.map((item, index) => <article className={item.tone} key={`${item.area}-${index}`}>
        <b>{String(index + 1).padStart(2, "0")}</b>
        <div><span>{item.area}</span><strong>{item.title}</strong><p>{item.body}</p></div>
      </article>)}</div>
    </section>

    <div className="abyss-review-context-grid">
      <article><span>Damage split</span><strong>{performance ? `${fmt(performance.weaponDps, 1)} weapon / ${fmt(performance.droneDps, 1)} drone DPS` : "--"}</strong><small>{performance?.activeDrones.length ? `Active: ${[...new Set(performance.activeDrones)].join(", ")}` : "No active drone flight recorded"}</small></article>
      <article><span>Known heavy-room envelope</span><strong>{signedClock(abyss.heavyKnownTimerMarginSeconds)}</strong><small>{clock(abyss.heavyKnownClearSeconds)} estimated clear</small></article>
      <article><span>Mobility</span><strong>{performance ? `${fmt(performance.maximumVelocityMps)} m/s` : "--"}</strong><small>{performance ? `${fmt(performance.alignSeconds, 2)} s align - ${fmt(performance.signatureRadiusM)} m signature` : "navigation data unavailable"}</small></article>
      <article><span>Population model</span><strong>{abyss.targetSample} NPC types</strong><small>{abyss.roomCount} documented room profiles; {abyss.unclearableRoomCount} currently unclearable</small></article>
    </div>

    <details className="fit-review-detail">
      <summary>Exact fitting blockers & verified remedies <span>{blockerCount + implants.length + rigs.length + moduleChanges.length}</span></summary>
      <div className="fit-review-fix-grid">
        <article><h4>Required skills</h4><div className="fit-review-fix-list">{missing.length ? missing.map((item) => <div key={`${item.skillId}:${item.requiredLevel}`}><strong>{item.skill}</strong><span>L{item.trainedLevel} → L{item.requiredLevel}</span><small>Required by {item.item}</small></div>) : <small>No missing module or hull skills.</small>}{supportSkills.map((item, index) => <div key={`support-${item.typeId}-${index}`}><strong>{item.name}</strong><span>L{item.currentLevel ?? 0} → L{item.targetLevel ?? 1}</span><small>{item.reason}</small>{item.result && <em>{resultLabel(item)}</em>}</div>)}</div></article>
        <article><h4>Implants</h4><FixRows items={implants} empty="No verified implant fix is required." /></article>
        <article><h4>Rigs</h4><FixRows items={rigRackFull ? [] : rigs} empty={rigRackFull ? `Rig rack is full (${intent.rigSlots!.used}/${intent.rigSlots!.capacity}); impossible extra rigs are excluded.` : "No verified free-slot rig fix is required."} /></article>
        <article><h4>Module swaps</h4><FixRows items={moduleChanges} empty="No verified same-group module swap is required." /></article>
        {hardIssues.length > 0 && <article><h4>Other blockers</h4><div className="fit-review-fix-list">{hardIssues.map((issue, index) => <div key={`${issue.code}-${index}`}><strong>{issue.item ?? issue.code}</strong><small>{issue.message}</small></div>)}</div></article>}
      </div>
    </details>

    <details className="fit-review-detail fit-review-model">
      <summary>How this Abyss estimate is built <span>{abyss.roomCount} rooms</span></summary>
      <p>{abyss.basis ?? "Documented room compositions are averaged with hostile-count weighting inside each room."}</p>
      <p>It is not spawn-frequency weighted, so the representative clear is a planning estimate rather than a promise. The known heavy-room envelope is shown separately to stop a friendly average hiding a bad composition.</p>
    </details>
  </section>;
}

function ShipPlanner({
  snapshot,
  cloneState,
  initialHullTypeId,
  initialFitIntent,
}: {
  snapshot: CharacterSnapshot;
  cloneState?: CloneState;
  initialHullTypeId?: number;
  initialFitIntent?: FitResolutionIntent;
}) {
  const ownedShips =
    snapshot.extended?.assetSummary?.ownedShips?.map((item) => item.item) ?? [];
  const [ships, setShips] = useState<Array<{ typeId: number; name: string }>>([]);
  const [selectedTypeId, setSelectedTypeId] = useState<number>(
    initialHullTypeId || snapshot.ship.ship_type_id || 0,
  );
  const [search, setSearch] = useState("");
  const [analysis, setAnalysis] = useState<ShipReadinessResult | null>(null);
  const [targetMasteryLevel, setTargetMasteryLevel] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    window.sage
      .listShips()
      .then((items) => {
        if (cancelled) return;
        setShips(items);
        if (!selectedTypeId) {
          const current = items.find(
            (item) => item.name === snapshot.ship.ship_type_name,
          );
          setSelectedTypeId(current?.typeId ?? items[0]?.typeId ?? 0);
        }
      })
      .catch((caught) =>
        !cancelled &&
        setError(caught instanceof Error ? caught.message : "Could not load ships."),
      );
    return () => {
      cancelled = true;
    };
  }, [snapshot.characterId]);

  useEffect(() => {
    setSelectedTypeId(initialHullTypeId || snapshot.ship.ship_type_id || 0);
    setAnalysis(null);
  }, [snapshot.characterId, snapshot.updatedAt, initialHullTypeId]);

  useEffect(() => {
    if (!selectedTypeId) return;
    let cancelled = false;
    setBusy(false);
    const busyTimer = setTimeout(() => { if (!cancelled) setBusy(true); }, 150);
    setError("");
    window.sage
      .getShipReadiness({
        characterId: snapshot.characterId,
        hullTypeId: selectedTypeId,
        cloneState: cloneState ?? "omega",
        masteryLevel: targetMasteryLevel,
      })
      .then((result) => {
        if (!cancelled) setAnalysis(result);
      })
      .catch((caught) => {
        if (!cancelled) {
          setAnalysis(null);
          setError(
            caught instanceof Error
              ? caught.message
              : "Ship readiness analysis failed.",
          );
        }
      })
      .finally(() => {
        clearTimeout(busyTimer);
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
      clearTimeout(busyTimer);
    };
  }, [selectedTypeId, snapshot.characterId, snapshot.updatedAt, cloneState, targetMasteryLevel]);

  const filteredShips = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return ships;
    return ships.filter((item) => item.name.toLowerCase().includes(query));
  }, [ships, search]);

  const selectedShip = ships.find((item) => item.typeId === selectedTypeId);
  const fitIntent = initialFitIntent?.hullTypeId === selectedTypeId ? initialFitIntent : undefined;

  async function copyRecommendedQueue() {
    if (!analysis?.recommendedQueue.length) return;
    const text = analysis.recommendedQueue
      .map(
        (skill, index) =>
          `${index + 1}. ${skill.name} ${skill.targetLevel}${skill.alreadyQueued ? " (already queued)" : ""}`,
      )
      .join("\n");
    await window.sage.copyText(text);
  }

  return (
    <div className="ship-planner">
      <div className={`planner-intro-card${fitIntent ? " fit-review-intro" : ""}`}>
        <p className="eyebrow">{fitIntent ? fitIntent.abyss ? "ACTIVITY COMMAND - FIT REVIEW" : "ACTIVITY COMMAND - FIT RESOLUTION" : "SHIP PLANNER"}</p>
        <h3>{fitIntent ? fitIntent.abyss ? `${fitIntent.fitName}: T${fitIntent.abyss.tier} ${fitIntent.abyss.weather.charAt(0).toUpperCase() + fitIntent.abyss.weather.slice(1)} review` : `${fitIntent.fitName}: fit resolution` : "Choose a hull and Sage builds the dependency-correct route"}</h3>
        <p>{fitIntent ? fitIntent.abyss ? "Scenario-first review of the exact fit you exported. Run performance and improvement priorities are first; general hull mastery is kept below as a separate tool." : "Exact fitting blockers and fixes from Fitting Command. General hull mastery remains available below." : "Hull access and practical competency are separate. Competency uses CCP's official ship mastery certificates across every published hull."}</p>
      </div>

      {fitIntent && <FitResolutionPlan intent={fitIntent} />}

      {fitIntent && <div className="fit-review-secondary-label"><div><p className="eyebrow">PILOT & HULL MASTERY</p><strong>General ship training tools</strong></div><small>Separate from the fit-specific Abyss review above</small></div>}

      <div className="planner-selector-card task3-selector">
        <label>
          Search ships
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Gila, Ishtar, Orca..."
          />
        </label>
        <label>
          Selected ship
          <select
            value={selectedTypeId || ""}
            onChange={(event) => setSelectedTypeId(Number(event.target.value))}
          >
            <option value="">Choose a ship</option>
            {filteredShips.map((item) => (
              <option key={item.typeId} value={item.typeId}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Target mastery
          <select value={targetMasteryLevel} onChange={(event) => setTargetMasteryLevel(Number(event.target.value))}>
            {[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>Mastery {level}</option>)}
          </select>
        </label>
        <div className="planner-selected-context">
          <span>Hull context</span>
          <strong>{selectedShip?.name ?? "None"}</strong>
          <small>
            {selectedShip && ownedShips.includes(selectedShip.name)
              ? "Owned by this character"
              : "Not detected in synced owned ships"}
          </small>
        </div>
      </div>

      {busy && (
        <div className="planner-analysis-state">
          Resolving EVE skill requirements and prerequisites...
        </div>
      )}
      {error && <div className="planner-analysis-state error">{error}</div>}

      {analysis && !busy && (
        <>
          <div className="readiness-metrics">
            <article className="readiness-score-card">
              <span>Practical competency</span>
              <strong>{analysis.readinessPercent}%</strong>
              <small>{analysis.missingSkills.length} Mastery {analysis.targetMasteryLevel} targets remain · skill-point weighted</small>
            </article>
            <details className="readiness-metric-details">
              <summary><span>Hull readiness</span><strong>{analysis.hullAccessPercent}%</strong><small>{analysis.hullAccessReady ? "Can fly this hull" : `${analysis.missingHullAccessSkills.length} skills remain · click to view`}</small></summary>
              <div className="hull-ready-skill-list">
                {analysis.missingHullAccessSkills.length ? analysis.missingHullAccessSkills.map((skill) => (
                  <div key={skill.skillId}><strong>{skill.name}</strong><span>L{skill.currentLevel} → L{skill.targetLevel}</span><small>{skill.alreadyQueued ? "Already queued" : duration(skill.estimatedSeconds)}</small></div>
                )) : <small>All minimum hull-access skills are trained.</small>}
              </div>
            </details>
            <article>
              <span>Mastery targets</span>
              <strong>
                {analysis.prerequisiteSkills.filter((skill) => skill.met).length}/
                {analysis.prerequisiteSkills.length}
              </strong>
              <small>Official mastery and dependency coverage</small>
            </article>
            <article>
              <span>Estimated training</span>
              <strong>{duration(analysis.totalEstimatedSeconds)}</strong>
              <small>{cloneState === "alpha" ? "Alpha training speed" : "Omega training speed"}</small>
            </article>
          </div>

          <details className="readiness-explanation" open>
            <summary>Show Work — why {analysis.readinessPercent}%?</summary>
            <p>{analysis.explanation.formula}</p>
            <div className="readiness-reasons">
              {analysis.explanation.reasons.map((reason) => (
                <span key={reason}>{reason}</span>
              ))}
            </div>
            <div className="readiness-strengths">
              <div>
                <strong>Strengths</strong>
                {analysis.explanation.strengths.length ? (
                  analysis.explanation.strengths.map((item) => (
                    <small key={item}>{item}</small>
                  ))
                ) : (
                  <small>No requirement targets are fully met yet.</small>
                )}
              </div>
              <div>
                <strong>Weaknesses</strong>
                {analysis.explanation.weaknesses.length ? (
                  analysis.explanation.weaknesses.map((item) => (
                    <small key={item}>{item}</small>
                  ))
                ) : (
                  <small>No missing requirement targets.</small>
                )}
              </div>
            </div>
          </details>

          <div className="planner-results-grid">
            <section className="planner-queue-panel">
              <div className="planner-panel-title">
                <div>
                  <p className="eyebrow">RECOMMENDED TRAINING QUEUE</p>
                  <h3>Dependency order</h3>
                </div>
                <button
                  onClick={copyRecommendedQueue}
                  disabled={!analysis.recommendedQueue.length}
                >
                  Copy queue
                </button>
              </div>
              {analysis.recommendedQueue.length ? (
                <ol>
                  {analysis.recommendedQueue.map((skill) => (
                    <li key={skill.skillId} className={skill.alreadyQueued ? "already-queued" : ""}>
                      <div>
                        <strong>{skill.name}</strong>
                        <small>
                          L{skill.currentLevel} → L{skill.targetLevel} · Rank {skill.rank} · {skill.direct ? "Hull requirement" : "Prerequisite"}
                        </small>
                      </div>
                      <span>{skill.alreadyQueued ? `Queued to L${skill.queuedToLevel}` : duration(skill.estimatedSeconds)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="planner-ready-state">
                  All ship and prerequisite requirements are already trained.
                </div>
              )}
            </section>

            <section className="planner-skill-panel">
              <div className="planner-panel-title">
                <div>
                  <p className="eyebrow">RELEVANT SKILLS</p>
                  <h3>Current vs required</h3>
                </div>
                <span>{analysis.relevantSkills.length} targets</span>
              </div>
              <div className="readiness-skill-list">
                {analysis.relevantSkills.map((skill) => (
                  <div key={skill.skillId} className={skill.met ? "met" : "missing"}>
                    <strong>{skill.name}</strong>
                    <span>
                      L{skill.currentLevel} / L{skill.targetLevel}
                    </span>
                    <small>{skill.direct ? "Direct" : "Prerequisite"}</small>
                    <em>{skill.met ? "Ready" : skill.alreadyQueued ? "Queued" : duration(skill.estimatedSeconds)}</em>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

