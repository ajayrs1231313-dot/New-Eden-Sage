import { useEffect, useMemo, useState } from "react";
import type {
  CharacterSnapshot,
  ShipReadinessResult,
  SkillDetail,
  FitResolutionIntent,
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
    <section className="skills-workspace">
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
  const implants = intent.remedies.filter((item) => item.kind === "implant");
  const rigs = intent.remedies.filter((item) => item.kind === "rig");
  const hardIssues = intent.issues.filter((issue) => issue.code !== "cpu-exceeded" && issue.code !== "powergrid-exceeded");
  const shortage = (code:string) => {
    const resources = intent.resources;
    if (!resources) return 0;
    const key = code === "cpu-exceeded" ? "cpu" : "powergrid";
    const used = resources.used[key]; const cap = resources.capacity[key];
    return cap > 0 ? Math.max(0, (used / cap - 1) * 100) : 0;
  };
  const remedyNote = (item:any) => {
    const issue = item.solves?.[0];
    const need = shortage(issue);
    const directOutput = (item.affectedAttributeId === 48 || item.affectedAttributeId === 11) && item.operation === 6;
    if (directOutput && need > 0 && item.effectValue >= need) return `Covers the current ${issue === "cpu-exceeded" ? "CPU" : "powergrid"} shortfall alone (${need.toFixed(1)}% needed).`;
    return item.reason;
  };
  return <section className="fit-resolution-plan">
    <div className="fit-resolution-title"><div><p className="eyebrow">{intent.source === "dream-fit" ? "DREAM FIT RESOLUTION" : "FIT ISSUE RESOLUTION"}</p><h3>{intent.fitName}</h3><small>{intent.hullName} · exact fitting blockers carried from Fitting Command</small></div><strong>{intent.issues.length + missing.length} blockers</strong></div>
    {intent.issues.length === 0 && missing.length === 0 ? <div className="fit-resolution-ready">This fit is already viable for the selected pilot.</div> : <div className="fit-resolution-grid">
      <article><h4>Train these skills</h4>{missing.length === 0 && supportSkills.length === 0 ? <small>No training fix identified.</small> : <>{missing.map((item) => <div key={`required-${item.skillId}-${item.requiredLevel}`}><strong>{item.skill}</strong><span>L{item.trainedLevel} → L{item.requiredLevel}</span><small>Required by {item.item}</small></div>)}{supportSkills.map((item) => <div key={`support-${item.typeId}-${item.solves.join("-")}`}><strong>{item.name}</strong><span>L{item.currentLevel ?? 0} → L{item.targetLevel ?? 1}</span><small>{item.reason}</small></div>)}</>}</article>
      <article><h4>Augments that can help</h4>{implants.length ? implants.map((item) => <div key={`implant-${item.typeId}`}><strong>{item.name}</strong><span>{item.solves.map(code => code === "cpu-exceeded" ? "CPU" : "Powergrid").join(" + ")}</span><small>{remedyNote(item)}</small></div>) : <small>No relevant fitting implant was found in the current local CCP SDE.</small>}</article>
      <article><h4>Rigs that can help</h4>{rigs.length ? rigs.map((item) => <div key={`rig-${item.typeId}`}><strong>{item.name}</strong><span>{item.solves.map(code => code === "cpu-exceeded" ? "CPU" : "Powergrid").join(" + ")}</span><small>{remedyNote(item)}</small></div>) : <small>No compatible fitting rig was identified for this hull and current issue set.</small>}</article>
      <article><h4>Fit changes required</h4>{hardIssues.length ? hardIssues.map((issue,index) => <div key={`${issue.code}-${index}`}><strong>{issue.item ?? issue.code}</strong><small>{issue.message}</small></div>) : <small>No hard slot, calibration, hardpoint or compatibility blocker remains beyond the resource/skill issues above.</small>}</article>
    </div>}
    <p className="fit-resolution-note">Sage only lists augments and rigs whose current CCP DOGMA modifiers target the failing fitting resource. Apply a suggested change in Fitting Command and the live analysis will verify whether the complete fit is resolved.</p>
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
      <div className="planner-intro-card">
        <p className="eyebrow">SHIP PLANNER</p>
        <h3>Choose a hull and Sage builds the dependency-correct route</h3>
        <p>
          Hull access and practical competency are separate. Competency uses CCP's
          official ship mastery certificates across every published hull.
        </p>
      </div>

      {fitIntent && <FitResolutionPlan intent={fitIntent} />}

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

