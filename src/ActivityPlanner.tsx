import { useEffect, useMemo, useState } from "react";
import type { ActivityReadinessResult, CharacterSnapshot } from "./types";
import {
  activityDefinitions,
  type ActivityContent,
  type ActivityDefinition,
  type ActivitySkillTarget,
  type ActivitySubcategory,
} from "./activity-planner-data";
import { recommendationSelectors, recommendationShips } from "./activity-recommendations";
import { categorizeReadinessSkill } from "./skill-intelligence";

type CloneState = "alpha" | "omega";
type Props = { snapshot: CharacterSnapshot; cloneState?: CloneState };
type ShipOption = { typeId: number; name: string };
type ShipAnalysis = { ship: ShipOption; analysis: ActivityReadinessResult };

function duration(seconds: number | null) {
  if (seconds === null) return "Unavailable";
  if (seconds <= 0) return "Ready now";
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.ceil((seconds % 86400) / 3600)}h`;
}

async function mapLimited<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await mapper(items[index]);
      }
    }),
  );
  return results;
}

function firstSubcategory(activity: ActivityDefinition) {
  return activity.subcategories[0];
}
function firstContent(subcategory: ActivitySubcategory) {
  return subcategory.content[0];
}
function selectorDefaults(content: ActivityContent) {
  return Object.fromEntries(
    recommendationSelectors(content).map((selector) => [selector.id, selector.options[0] ?? ""]),
  );
}
function sourceLabel(source: ActivityReadinessResult["fitEvidence"]["source"]) {
  if (source === "eve-workbench-abyss") return "Variation-specific Abyss run fits";
  if (source === "zkillboard-recent-losses") return "Recent observed hull fits";
  return "No fitted-ship evidence required";
}

function fitChoiceCopy(
  fit: ActivityReadinessResult["selectedArchetype"] extends infer _T
    ? NonNullable<ActivityReadinessResult["selectedArchetype"]>["fitChoices"][number]
    : never,
  index: number,
) {
  const fitted = [
    ...fit.fit.high,
    ...fit.fit.mid,
    ...fit.fit.low,
    ...fit.fit.rig,
    ...fit.fit.subsystem,
    ...fit.fit.drones,
    ...fit.fit.fighters,
  ];
  const text = fitted.map((item) => item.name.toLowerCase()).join(" ");
  const roles: string[] = [];
  if (/ice harvester/.test(text)) roles.push("ice harvesting");
  else if (/strip miner|mining laser/.test(text)) roles.push("ore mining");
  else if (/gas cloud harvester/.test(text)) roles.push("gas harvesting");
  else if (/missile|rocket|torpedo|launcher/.test(text)) roles.push("missiles");
  else if (/autocannon|artillery/.test(text)) roles.push("projectiles");
  else if (/blaster|railgun/.test(text)) roles.push("hybrids");
  else if (/laser|maser/.test(text)) roles.push("lasers");
  else if (fit.fit.drones.length) roles.push("drones");
  if (/shield booster|shield extender|shield hardener|invulnerability|multispectrum shield/.test(text)) roles.push("shield tank");
  else if (/armor repair|armor plate|energized|armor hardener/.test(text)) roles.push("armour tank");
  if (/micro ?warpdrive|afterburner/.test(text)) roles.push("propulsion");
  const profile = roles.slice(0, 3).join(" · ") || "general-purpose setup";
  const keyItems = fitted
    .map((item) => item.name)
    .filter((name) => name && !/^Type \d+$/i.test(name))
    .slice(0, 4);
  return {
    title: index === 0 ? `Recommended fit · ${profile}` : `Alternative fit ${index} · ${profile}`,
    description: keyItems.length
      ? `Key equipment: ${keyItems.join(", ")}.`
      : `${fitted.length} fitted item type${fitted.length === 1 ? "" : "s"} for this route.`,
  };
}

function orderedArchetypes(analysis: ActivityReadinessResult) {
  const all = [
    ...(analysis.selectedArchetype ? [analysis.selectedArchetype] : []),
    ...analysis.alternativeArchetypes,
  ];
  const evidenceOrder = new Map(
    analysis.fitEvidence.archetypes.map((item, index) => [item.id, index]),
  );
  return [...new Map(all.map((item) => [item.id, item])).values()].sort(
    (a, b) =>
      (evidenceOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (evidenceOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
      a.label.localeCompare(b.label),
  );
}

function displayedSkillReasons(
  skill: ActivityReadinessResult["recommendedQueue"][number],
  contentLabel: string,
  selectorValues: Record<string, string>,
) {
  const context = Object.values(selectorValues).filter(Boolean).join(" · ");
  const reasons = (skill.reasons ?? []).map((reason) => {
    if (reason === "Core competency target for the selected activity")
      return `Core competency target for ${contentLabel}`;
    if (reason === "Support competency target for the selected activity")
      return `Support competency target for ${contentLabel}`;
    if (reason === "Required by the selected variation or role")
      return context ? `Required by this variation / role: ${context}` : "Required by the selected variation or role";
    if (reason === "Selected activity/context target")
      return `Activity target for ${contentLabel}`;
    return reason;
  });
  if (!reasons.length) {
    if (skill.sources?.includes("activity")) reasons.push(`Activity target for ${contentLabel}`);
    else if (!skill.direct) reasons.push("Prerequisite in the dependency chain for another required skill");
    else reasons.push("Required by the selected hull or fitting route");
  }
  return [...new Set(reasons)];
}

export function ActivityPlanner({ snapshot, cloneState }: Props) {
  const initialActivity = activityDefinitions[0];
  const initialSubcategory = firstSubcategory(initialActivity);
  const initialContent = firstContent(initialSubcategory);
  const [activityId, setActivityId] = useState(initialActivity.id);
  const [subcategoryId, setSubcategoryId] = useState(initialSubcategory.id);
  const [contentId, setContentId] = useState(initialContent.id);
  const [selectorValues, setSelectorValues] = useState<Record<string, string>>(
    selectorDefaults(initialContent),
  );
  const [ships, setShips] = useState<ShipOption[]>([]);
  const [shipAnalyses, setShipAnalyses] = useState<ShipAnalysis[]>([]);
  const [selectedShipId, setSelectedShipId] = useState(0);
  const [selectedArchetypeId, setSelectedArchetypeId] = useState("");
  const [selectedFitId, setSelectedFitId] = useState("");
  const [archetypeBusy, setArchetypeBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const activity =
    activityDefinitions.find((item) => item.id === activityId) ?? activityDefinitions[0];
  const subcategory =
    activity.subcategories.find((item) => item.id === subcategoryId) ?? firstSubcategory(activity);
  const content =
    subcategory.content.find((item) => item.id === contentId) ?? firstContent(subcategory);
  const selectors = recommendationSelectors(content);
  const selectorKey = JSON.stringify(selectorValues);

  useEffect(() => {
    let cancelled = false;
    window.sage
      .listShips()
      .then((items) => !cancelled && setShips(items))
      .catch((caught) => {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : "Could not load ship data.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const available = new Map(ships.map((ship) => [ship.name, ship]));
    const recommendedNames = recommendationShips(content, selectorValues);
    const recommendationOrder = new Map(recommendedNames.map((name, index) => [name, index]));
    const candidates = recommendedNames
      .map((name) => available.get(name))
      .filter((ship): ship is ShipOption => Boolean(ship));
    if (!candidates.length) {
      setShipAnalyses([]);
      setSelectedShipId(0);
      return;
    }

    let cancelled = false;
    setBusy(false);
    const busyTimer = setTimeout(() => { if (!cancelled) setBusy(true); }, 150);
    setError("");
    mapLimited(candidates, 4, async (ship) => ({
        ship,
        analysis: await window.sage.getActivityReadiness({
          characterId: snapshot.characterId,
          hullTypeId: ship.typeId,
          cloneState: cloneState ?? "omega",
          coreSkills: content.coreSkills,
          supportSkills: content.supportSkills,
          context: {
            activityId: activity.id,
            subcategoryId: subcategory.id,
            contentId: content.id,
            selectorValues,
          },
        }),
      }))
      .then((results) => {
        if (cancelled) return;
        const ranked = results.sort((a, b) => {
          if (a.analysis.compatible !== b.analysis.compatible)
            return a.analysis.compatible ? -1 : 1;
          if (a.analysis.overallPercent !== b.analysis.overallPercent)
            return b.analysis.overallPercent - a.analysis.overallPercent;
          const aOwned = snapshot.extended?.assetSummary?.ownedShips?.some(
            (owned) => owned.item === a.ship.name,
          );
          const bOwned = snapshot.extended?.assetSummary?.ownedShips?.some(
            (owned) => owned.item === b.ship.name,
          );
          if (aOwned !== bOwned) return aOwned ? -1 : 1;
          return (recommendationOrder.get(a.ship.name) ?? 999) - (recommendationOrder.get(b.ship.name) ?? 999);
        });
        setShipAnalyses(ranked);
        setSelectedShipId((current) =>
          ranked.some((item) => item.ship.typeId === current)
            ? current
            : ranked[0]?.ship.typeId ?? 0,
        );
      })
      .catch((caught) => {
        if (!cancelled) {
          setShipAnalyses([]);
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not calculate contextual readiness for this activity.",
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
  }, [
    activity.id,
    subcategory.id,
    content.id,
    selectorKey,
    ships,
    snapshot.characterId,
    snapshot.updatedAt,
    cloneState,
  ]);

  const selectedShip =
    shipAnalyses.find((item) => item.ship.typeId === selectedShipId) ?? shipAnalyses[0];
  const fitChoices = selectedShip?.analysis.selectedArchetype?.fitChoices ??
    (selectedShip?.analysis.selectedArchetype?.recommendedFit
      ? [selectedShip.analysis.selectedArchetype.recommendedFit]
      : []);
  const selectedFit = fitChoices.find((fit) => fit.id === selectedFitId) ??
    selectedShip?.analysis.selectedArchetype?.recommendedFit ??
    fitChoices[0];

  useEffect(() => {
    setSelectedArchetypeId(selectedShip?.analysis.selectedArchetype?.id ?? "");
    setSelectedFitId(selectedShip?.analysis.selectedArchetype?.recommendedFit?.id ?? "");
  }, [selectedShip?.ship.typeId, content.id, selectorKey]);

  const skillByName = useMemo(
    () => new Map(snapshot.skills.skills.map((skill) => [skill.name, skill])),
    [snapshot.skills.skills],
  );
  const coreProgress = content.coreSkills.map((target) => ({
    ...target,
    current: skillByName.get(target.skill)?.trained_skill_level ?? 0,
  }));
  const supportProgress = content.supportSkills.map((target) => ({
    ...target,
    current: skillByName.get(target.skill)?.trained_skill_level ?? 0,
  }));
  const coreMet = coreProgress.filter((skill) => skill.current >= skill.level).length;
  const supportMet = supportProgress.filter((skill) => skill.current >= skill.level).length;
  const shipIsScored = (shipAnalyses[0]?.analysis.components.hull.weight ?? 0) > 0;

  function chooseActivity(nextId: string) {
    const nextActivity =
      activityDefinitions.find((item) => item.id === nextId) ?? activityDefinitions[0];
    const nextSubcategory = firstSubcategory(nextActivity);
    const nextContent = firstContent(nextSubcategory);
    setActivityId(nextActivity.id);
    setSubcategoryId(nextSubcategory.id);
    setContentId(nextContent.id);
    setSelectorValues(selectorDefaults(nextContent));
    setShipAnalyses([]);
    setSelectedShipId(0);
    setSelectedArchetypeId("");
    setSelectedFitId("");
  }
  function chooseSubcategory(nextId: string) {
    const nextSubcategory =
      activity.subcategories.find((item) => item.id === nextId) ?? firstSubcategory(activity);
    const nextContent = firstContent(nextSubcategory);
    setSubcategoryId(nextSubcategory.id);
    setContentId(nextContent.id);
    setSelectorValues(selectorDefaults(nextContent));
    setShipAnalyses([]);
    setSelectedShipId(0);
    setSelectedArchetypeId("");
    setSelectedFitId("");
  }
  function chooseContent(nextId: string) {
    const nextContent =
      subcategory.content.find((item) => item.id === nextId) ?? firstContent(subcategory);
    setContentId(nextContent.id);
    setSelectorValues(selectorDefaults(nextContent));
    setShipAnalyses([]);
    setSelectedShipId(0);
    setSelectedArchetypeId("");
    setSelectedFitId("");
  }

  async function chooseArchetype(archetypeId: string) {
    if (!selectedShip || archetypeBusy || selectedArchetypeId === archetypeId) return;
    const previousArchetypeId = selectedArchetypeId || selectedShip.analysis.selectedArchetype?.id || "";
    setSelectedArchetypeId(archetypeId);
    setArchetypeBusy(true);
    setError("");
    try {
      const analysis = await window.sage.getActivityReadiness({
        characterId: snapshot.characterId,
        hullTypeId: selectedShip.ship.typeId,
        cloneState: cloneState ?? "omega",
        coreSkills: content.coreSkills,
        supportSkills: content.supportSkills,
        context: {
          activityId: activity.id,
          subcategoryId: subcategory.id,
          contentId: content.id,
          selectorValues,
        },
        archetypeId,
      });
      setShipAnalyses((current) =>
        current.map((item) =>
          item.ship.typeId === selectedShip.ship.typeId ? { ...item, analysis } : item,
        ),
      );
      setSelectedArchetypeId(analysis.selectedArchetype?.id ?? archetypeId);
      setSelectedFitId(analysis.selectedArchetype?.recommendedFit?.id ?? "");
    } catch (caught) {
      setSelectedArchetypeId(previousArchetypeId);
      setError(caught instanceof Error ? caught.message : "Could not switch fitting route.");
    } finally {
      setArchetypeBusy(false);
    }
  }

  function exportRecommendedFit() {
    const recommendation = selectedFit;
    if (!selectedShip?.analysis.hullAccessReady || !recommendation) return;
    const contextText = [activity.label, subcategory.label, content.label, ...Object.values(selectorValues).filter(Boolean)].join(" · ");
    const payload = {
      id: crypto.randomUUID(),
      name: `${selectedShip.ship.name} · ${content.label} · Sage recommended`,
      hull: { name: selectedShip.ship.name, typeId: selectedShip.ship.typeId, quantity: 1 },
      low: recommendation.fit.low ?? [],
      mid: recommendation.fit.mid ?? [],
      high: recommendation.fit.high ?? [],
      rig: recommendation.fit.rig ?? [],
      subsystem: recommendation.fit.subsystem ?? [],
      drones: recommendation.fit.drones ?? [],
      fighters: recommendation.fit.fighters ?? [],
      cargo: recommendation.fit.cargo ?? [],
      implants: [],
      boosters: [],
      instructions: [
        `Generated for ${snapshot.character.name}: ${contextText}.`,
        `Selected archetype: ${selectedShip.analysis.selectedArchetype?.label ?? "observed fit"}.`,
        "Recommendation uses the full selected activity route, every route option and this pilot's current synced skills; verify final fitting resources in Fittings.",
      ],
      source: `Activity Planner · ${contextText}`,
    };
    localStorage.setItem("new-eden-sage-pending-fit", JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent("sage:navigate-fittings"));
  }
  async function copyTrainingPlan() {
    if (!selectedShip?.analysis.recommendedQueue.length) return;
    const header = `${activity.label} → ${subcategory.label} → ${content.label} → ${selectedShip.ship.name}`;
    const options = Object.values(selectorValues).filter(Boolean).join(" · ");
    const archetype = selectedShip.analysis.selectedArchetype?.label;
    const queue = selectedShip.analysis.recommendedQueue
      .map((skill, index) => {
        const category = categorizeReadinessSkill(skill.name);
        const why = displayedSkillReasons(skill, content.label, selectorValues)[0];
        return `${index + 1}. ${skill.name} ${skill.targetLevel} [${category.label}]${why ? ` — ${why}` : ""}${skill.alreadyQueued ? " (already queued)" : ""}`;
      })
      .join("\n");
    await window.sage.copyText(
      `${header}${options ? `\n${options}` : ""}${archetype ? `\nFit archetype: ${archetype}` : ""}\n\n${queue}`,
    );
  }

  return (
    <div className="activity-planner task4-activity-planner">
      <div className="planner-intro-card">
        <p className="eyebrow">ACTIVITY PLANNER</p>
        <h3>Start from what you want to do</h3>
        <p>
          Choose the exact content and variation you plan to run. Sage compares the
          skills, roles and fitting archetypes that matter for that context rather
          than treating hull access as activity readiness.
        </p>
      </div>

      <div className="activity-route-bar" aria-label="Activity planner progression">
        <RouteStep number="1" label="Activity" value={activity.label} />
        <RouteStep number="2" label="Sub-activity" value={subcategory.label} />
        <RouteStep number="3" label="Content" value={content.label} />
        <RouteStep
          number="4"
          label={shipIsScored ? "Ship" : "Utility ship"}
          value={selectedShip?.ship.name ?? (busy ? "Comparing..." : "Choose a hull")}
        />
        <RouteStep
          number="5"
          label="Readiness"
          value={
            selectedShip
              ? `${selectedShip.analysis.overallPercent}% · ${selectedShip.analysis.tier.label}`
              : "Pending"
          }
        />
      </div>

      <section className="activity-choice-section">
        <div className="activity-section-heading">
          <div><p className="eyebrow">1 · ACTIVITY</p><h3>What do you want to do?</h3></div>
          <small>{activityDefinitions.length} career routes</small>
        </div>
        <div className="activity-primary-grid">
          {activityDefinitions.map((item) => (
            <button key={item.id} className={activity.id === item.id ? "active" : ""} onClick={() => chooseActivity(item.id)}>
              <strong>{item.label}</strong><small>{item.description}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="activity-choice-section">
        <div className="activity-section-heading"><div><p className="eyebrow">2 · SUB-ACTIVITY</p><h3>Narrow the route</h3></div></div>
        <div className="activity-subcategory-grid">
          {activity.subcategories.map((item) => (
            <button key={item.id} className={subcategory.id === item.id ? "active" : ""} onClick={() => chooseSubcategory(item.id)}>
              <strong>{item.label}</strong><small>{item.description}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="activity-choice-section">
        <div className="activity-section-heading"><div><p className="eyebrow">3 · SPECIFIC CONTENT</p><h3>Choose the content</h3></div></div>
        <div className="activity-content-grid">
          {subcategory.content.map((item) => (
            <button key={item.id} className={content.id === item.id ? "active" : ""} onClick={() => chooseContent(item.id)}>
              <strong>{item.label}</strong><small>{item.description}</small>
            </button>
          ))}
        </div>
      </section>

      {selectors.length > 0 && (
        <section className="activity-variant-panel">
          <div><p className="eyebrow">CONTENT OPTIONS</p><h3>Set the version you plan to run</h3></div>
          <div className="activity-variant-controls">
            {selectors.map((selector) => (
              <label key={selector.id}>
                {selector.label}
                <select
                  value={selectorValues[selector.id] ?? selector.options[0]}
                  onChange={(event) =>
                    setSelectorValues((current) => ({ ...current, [selector.id]: event.target.value }))
                  }
                >
                  {selector.options.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
            ))}
          </div>
        </section>
      )}

      <section className="activity-detail-panel">
        <div className="activity-detail-copy">
          <p className="eyebrow">{content.label.toUpperCase()}</p>
          <h3>{content.description}</h3>
          <div className="activity-detail-meta">
            <span><b>Difficulty</b>{content.difficulty}</span>
            <span><b>Recommended experience</b>{content.experience}</span>
          </div>
          {content.notes?.map((note) => <p className="activity-note" key={note}>{note}</p>)}
        </div>
        <div className="activity-income-hooks">
          <span>Income / value comes from</span>
          {content.incomeHooks.map((hook) => <strong key={hook}>{hook}</strong>)}
        </div>
      </section>

      <section className="activity-skills-section">
        <div className="activity-section-heading">
          <div><p className="eyebrow">SKILL FOCUS</p><h3>Useful targets for this content</h3></div>
          <small>Core {coreMet}/{coreProgress.length} · Support {supportMet}/{supportProgress.length}</small>
        </div>
        <div className="activity-skill-columns">
          <SkillTargetList title="Core skills" targets={coreProgress} />
          <SkillTargetList title="Useful support skills" targets={supportProgress} />
        </div>
      </section>

      <section className="activity-ships-section">
        <div className="activity-section-heading">
          <div>
            <p className="eyebrow">4 · {shipIsScored ? "RECOMMENDED SHIPS" : "USEFUL SHIPS"}</p>
            <h3>{shipIsScored ? "Best practical route from your current character" : "Activity readiness first; ship choice is optional here"}</h3>
          </div>
          <small>{busy ? "Calculating exact context..." : `${shipAnalyses.length} hulls shown`}</small>
        </div>
        {error && <div className="planner-analysis-state error">{error}</div>}
        {busy && !shipAnalyses.length && (
          <div className="planner-analysis-state">
            Matching the selected variation, fitting archetypes and {snapshot.character.name}&apos;s synced skills...
          </div>
        )}
        {ships.length > 0 && !busy && !error && !shipAnalyses.length && (
          <div className="planner-analysis-state">
            No recommended hulls match this combination. Change the role, hull class or other content options to see compatible routes.
          </div>
        )}
        {!busy && !error && !shipAnalyses.length && (
          <div className="planner-analysis-state">
            No recommended hulls match this role and ship-class combination. Choose a different role or class.
          </div>
        )}
        <div className="activity-ship-grid practical-readiness-grid">
          {shipAnalyses.map(({ ship, analysis }) => {
            const owned = snapshot.extended?.assetSummary?.ownedShips?.some((item) => item.item === ship.name);
            return (
              <button
                key={ship.typeId}
                className={`${selectedShip?.ship.typeId === ship.typeId ? "active" : ""} readiness-${analysis.tier.id}`}
                onClick={() => { setSelectedShipId(ship.typeId); setSelectedArchetypeId(analysis.selectedArchetype?.id ?? ""); setSelectedFitId(analysis.selectedArchetype?.recommendedFit?.id ?? ""); }}
              >
                <div><strong>{ship.name}</strong>{owned && <em>Owned</em>}</div>
                <span>{analysis.overallPercent}% ready</span>
                <b className="readiness-tier-label">{analysis.compatible ? analysis.tier.label : "Role mismatch"}</b>
                <small>
                  {analysis.components.hull.weight
                    ? `Hull ${analysis.components.hull.percent ?? "?"}% · Fit ${analysis.components.fit.percent ?? "?"}% · Activity ${analysis.components.activity.percent}%`
                    : `Activity-led score · Mastery ${analysis.masteryPercent}%`}
                </small>
              </button>
            );
          })}
        </div>
      </section>

      {selectedShip && (
        <section className="activity-training-section practical-training-section">
          <div className="activity-section-heading">
            <div><p className="eyebrow">5 · CONTEXT READINESS & TRAINING</p><h3>{selectedShip.ship.name} progression route</h3></div>
            <button className="activity-copy-queue" onClick={copyTrainingPlan} disabled={!selectedShip.analysis.recommendedQueue.length}>Copy queue</button>
          </div>

          <div className={`practical-readiness-hero readiness-${selectedShip.analysis.tier.id}`}>
            <div><span>Readiness</span><strong>{selectedShip.analysis.overallPercent}%</strong></div>
            <div><b>{selectedShip.analysis.tier.label}</b><p>{selectedShip.analysis.tier.description}</p></div>
            <div className="mastery-readiness"><span>Extra training</span><strong>{selectedShip.analysis.masteryPercent}%</strong><small>Useful improvements beyond the minimum requirements</small></div>
          </div>

          {!selectedShip.analysis.compatible && selectedShip.analysis.compatibilityReason && (
            <div className="planner-analysis-state error">{selectedShip.analysis.compatibilityReason}</div>
          )}

          <div className="activity-training-summary readiness-components contextual-components">
            {selectedShip.analysis.components.hull.weight > 0 && (
              <article><span>Hull access · {selectedShip.analysis.components.hull.weight}% weight</span><strong>{selectedShip.analysis.components.hull.percent ?? "?"}%</strong><small>{selectedShip.analysis.components.hull.missing ?? "?"} hull/prerequisite gaps</small></article>
            )}
            {selectedShip.analysis.activityEvidence.status === "ready" && (
            <section className="activity-evidence-panel">
              <div className="activity-section-heading">
                <div><p className="eyebrow">OBSERVED ACTIVITY EVIDENCE</p><h3>{selectedShip.analysis.activityEvidence.label}</h3></div>
                <small>{selectedShip.analysis.activityEvidence.sampleCount} public runs · {selectedShip.analysis.activityEvidence.confidence} confidence</small>
              </div>
              <div className="activity-evidence-entries">
                {selectedShip.analysis.activityEvidence.entries.map((entry) => (
                  <div key={entry.name}>
                    <strong>{entry.name}</strong>
                    <span>{entry.runs} observed · {entry.survivedRuns} survived{entry.level !== null ? " · level " + entry.level : ""}</span>
                  </div>
                ))}
              </div>
              {selectedShip.analysis.activityEvidence.note && <small className="activity-evidence-note">{selectedShip.analysis.activityEvidence.note}</small>}
            </section>
          )}

          {selectedShip.analysis.components.fit.weight > 0 && (
              <article><span>Fit archetype · {selectedShip.analysis.components.fit.weight}% weight</span><strong>{selectedShip.analysis.components.fit.percent === null ? "Unknown" : `${selectedShip.analysis.components.fit.percent}%`}</strong><small>{selectedShip.analysis.components.fit.contextSpecific ? "Context-specific evidence" : "Hull-wide fallback evidence"}</small></article>
            )}
            <article><span>Activity skills · {selectedShip.analysis.components.activity.weight}% weight</span><strong>{selectedShip.analysis.components.activity.percent}%</strong><small>Core {selectedShip.analysis.components.activity.corePercent}% · Support {selectedShip.analysis.components.activity.supportPercent}%</small></article>
            {selectedShip.analysis.components.context.weight > 0 && (
              <article><span>Variation / role · {selectedShip.analysis.components.context.weight}% weight</span><strong>{selectedShip.analysis.components.context.percent}%</strong><small>{selectedShip.analysis.components.context.missing} contextual targets remain</small></article>
            )}
            <article><span>Estimated mandatory training</span><strong>{duration(selectedShip.analysis.totalEstimatedSeconds)}</strong><small>{selectedShip.analysis.missingSkills.length} combined targets remain</small></article>
          </div>

          {selectedShip.analysis.components.context.targets.length > 0 && (
            <section className="context-target-panel">
              <div className="activity-section-heading"><div><p className="eyebrow">SELECTED VARIATION</p><h3>What changes for this exact route</h3></div></div>
              <div className="context-target-chips">
                {selectedShip.analysis.components.context.targets.map((target) => <span key={`${target.skill}-${target.level}`}>{target.skill} · L{target.level}</span>)}
              </div>
            </section>
          )}

          {selectedShip.analysis.components.fit.weight > 0 && (
            <section className="community-fit-baseline archetype-baseline">
              <div className="activity-section-heading">
                <div>
                  <p className="eyebrow">FIT ARCHETYPE</p>
                  <h3>Choose the fitting route you want Sage to score</h3>
                </div>
                <small>{sourceLabel(selectedShip.analysis.fitEvidence.source)} · {selectedShip.analysis.fitEvidence.sampleCount} sample{selectedShip.analysis.fitEvidence.sampleCount === 1 ? "" : "s"} · {selectedShip.analysis.fitEvidence.confidence} confidence</small>
              </div>
              {selectedShip.analysis.selectedArchetype ? (
                <>
                  <div className="archetype-choice-grid">
                    {orderedArchetypes(selectedShip.analysis).map((archetype) => (
                      <button
                        key={archetype.id}
                        className={selectedArchetypeId === archetype.id ? "active" : ""}
                        aria-pressed={selectedArchetypeId === archetype.id}
                        onClick={() => void chooseArchetype(archetype.id)}
                        disabled={archetypeBusy}
                      >
                        <strong>{archetype.label}</strong>
                        <span>{archetype.overallPercent}% readiness · fit {archetype.fitPercent}%</span>
                        <small>{archetype.sampleCount} sample{archetype.sampleCount === 1 ? "" : "s"} · {archetype.contextSpecific ? "context matched" : "hull fallback"}</small>
                      </button>
                    ))}
                  </div>
                  {archetypeBusy && <div className="archetype-switch-state">Recalculating this fitting route...</div>}
                  <div className="archetype-meta">
                    <span>{selectedShip.analysis.selectedArchetype.contextSpecific ? "Matched to the selected context" : "Generic hull fallback"}</span>
                    <strong>{selectedShip.analysis.selectedArchetype.fitPercent}% fitting competency</strong>
                  </div>
                  <div className="community-fit-items">
                    {selectedShip.analysis.selectedArchetype.items.slice(0, 16).map((item) => (
                      <div key={item.typeId}><strong>{item.name}</strong><span>{item.presencePercent}% of archetype samples</span></div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="community-fit-unavailable">
                  {selectedShip.analysis.fitEvidence.note ?? "No sufficiently reliable fitting evidence is available. Sage caps readiness rather than inventing a perfect score."}
                </div>
              )}
            </section>
          )}

          {selectedShip.analysis.recommendedQueue.length ? (
            <div className="training-category-stack">
              {[...selectedShip.analysis.recommendedQueue.reduce((groups, skill, queueIndex) => {
                const category = categorizeReadinessSkill(skill.name);
                const current = groups.get(category.id) ?? { category, skills: [] as Array<{ skill: typeof skill; queueIndex: number }> };
                current.skills.push({ skill, queueIndex });
                groups.set(category.id, current);
                return groups;
              }, new Map<string, { category: ReturnType<typeof categorizeReadinessSkill>; skills: Array<{ skill: ActivityReadinessResult["recommendedQueue"][number]; queueIndex: number }> }>()).values()]
                .sort((a, b) => a.category.order - b.category.order)
                .map(({ category, skills }) => (
                  <section className="training-skill-category" key={category.id}>
                    <header>
                      <div>
                        <strong>{category.label}</strong>
                        <small>{category.description}</small>
                      </div>
                      <span>{skills.length} skill{skills.length === 1 ? "" : "s"}</span>
                    </header>
                    <ol className="activity-training-queue practical-training-queue categorized-training-queue">
                      {skills.map(({ skill, queueIndex }) => {
                        const reasons = displayedSkillReasons(skill, content.label, selectorValues);
                        return (
                          <li key={skill.skillId}>
                            <span className="training-queue-index">#{queueIndex + 1}</span>
                            <div>
                              <strong>{skill.name}</strong>
                              <small>L{skill.currentLevel} → L{skill.targetLevel}</small>
                              <small className="training-skill-why"><b>Why:</b> {reasons.slice(0, 3).join(" · ")}{reasons.length > 3 ? ` · +${reasons.length - 3} more` : ""}</small>
                            </div>
                            <span className="training-skill-time">{skill.alreadyQueued ? `Already queued to L${skill.queuedToLevel}` : duration(skill.estimatedSeconds)}</span>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                ))}
            </div>
          ) : (
            <div className="planner-ready-state">{snapshot.character.name} meets every identified mandatory requirement for this exact route.</div>
          )}

          <section className="activity-recommended-fit-panel">
            <div>
              <p className="eyebrow">RECOMMENDED FIT</p>
              <h3>{selectedShip.ship.name} for this exact activity route</h3>
              {selectedShip.analysis.hullAccessReady ? (
                selectedFit ? (
                  <>
                    <p>Choose one of the fits from <strong>{selectedShip.analysis.selectedArchetype?.label ?? "this route"}</strong>. Every choice shown is fully usable with this character&apos;s currently trained skills; Sage preselects the strongest match.</p>
                    <small>{Object.values(selectorValues).filter(Boolean).join(" · ")}</small>
                    <div className="archetype-choice-grid recommended-fit-choice-grid">
                      {fitChoices.map((fit, index) => {
                        const copy = fitChoiceCopy(fit, index);
                        return (
                          <button
                            type="button"
                            key={fit.id}
                            className={selectedFit?.id === fit.id ? "active" : ""}
                            aria-pressed={selectedFit?.id === fit.id}
                            onClick={() => setSelectedFitId(fit.id)}
                          >
                            <strong>{copy.title}</strong>
                            <span>{copy.description}</span>
                            <small>{fit.itemTypeIds.length} fitted item type{fit.itemTypeIds.length === 1 ? "" : "s"}{index === 0 ? " · best match for your skills" : ""}</small>
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p>No observed fit for this route is fully usable with this character&apos;s current skills, so Sage will not label or export one as recommended. Use the training route above or try another archetype.</p>
                )
              ) : (
                <p>This character cannot currently sit in the selected hull. Sage will keep showing the training route, but fitted export stays unavailable until hull access is trained.</p>
              )}
            </div>
            <button type="button" onClick={exportRecommendedFit} disabled={!selectedShip.analysis.hullAccessReady || !selectedFit}>
              {selectedFit ? "Export selected fit to Fittings" : "Fit unavailable"}
            </button>
          </section>
          <section className="mastery-panel">
            <div><p className="eyebrow">OPTIONAL TRAINING</p><h3>Useful next skills</h3><p>These aren't required to get started, but they'll improve performance and efficiency.</p></div>
            <strong>{selectedShip.analysis.masteryPercent}%</strong>
            {selectedShip.analysis.masteryQueue.length > 0 && (
              <div className="mastery-targets">
                {selectedShip.analysis.masteryQueue.slice(0, 8).map((skill) => <span key={skill.skillId}>{skill.name} → L{skill.targetLevel}</span>)}
              </div>
            )}
          </section>

          <details className="activity-readiness-work" open>
            <summary>Show Work — why {selectedShip.analysis.overallPercent}%?</summary>
            <p>{selectedShip.analysis.explanation.formula}</p>
            {selectedShip.analysis.explanation.reasons.map((reason) => <small key={reason}>{reason}</small>)}
            {selectedShip.analysis.explanation.caveats.map((caveat) => <small className="readiness-caveat" key={caveat}>{caveat}</small>)}
          </details>
        </section>
      )}
    </div>
  );
}

function RouteStep({ number, label, value }: { number: string; label: string; value: string }) {
  return <div><span>{number}</span><small>{label}</small><strong>{value}</strong></div>;
}

function SkillTargetList({ title, targets }: { title: string; targets: Array<ActivitySkillTarget & { current: number }> }) {
  return (
    <div className="activity-skill-list">
      <strong>{title}</strong>
      {targets.map((target) => {
        const met = target.current >= target.level;
        return (
          <div key={target.skill} className={met ? "met" : "missing"}>
            <span>{target.skill}</span><small>L{target.current} / L{target.level}</small>
            <em>{met ? "Ready" : `Train ${target.level - target.current} level${target.level - target.current === 1 ? "" : "s"}`}</em>
          </div>
        );
      })}
    </div>
  );
}
