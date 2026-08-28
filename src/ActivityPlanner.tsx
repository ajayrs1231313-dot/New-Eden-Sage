import { useEffect, useMemo, useState } from "react";
import type { ActivityReadinessResult, CharacterSnapshot, HullAccessPreview } from "./types";
import {
  activityDefinitions,
  type ActivityContent,
  type ActivityDefinition,
  type ActivitySkillTarget,
  type ActivitySubcategory,
} from "./activity-planner-data";
import { recommendationMetaPicks, recommendationSelectors, recommendationShips } from "./activity-recommendations";
import { categorizeReadinessSkill } from "./skill-intelligence";

type CloneState = "alpha" | "omega";
type Props = { snapshot: CharacterSnapshot; cloneState?: CloneState };
type ShipOption = { typeId: number; name: string; groupId?: number; groupName?: string; metaGroupId?: number; metaGroupName?: string; factionId?: number; factionName?: string };
type ShipPreview = { ship: ShipOption; preview: HullAccessPreview; owned: boolean; metaPick: boolean; metaReason?: string; order: number };
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
  else if (/armor repair|armour repair|armor plate|armour plate|energized|membrane|armor hardener|armour hardener|reactive armor|reactive armour/.test(text)) roles.push("armour tank");
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

function ActivityFitRack({ label, items }: { label: string; items: Array<{ name: string; quantity?: number; typeId?: number }> }) {
  if (!items.length) return null;
  return (
    <div className="activity-fit-rack">
      <strong>{label}</strong>
      <div>{items.map((item, index) => (
        <span key={`${label}-${item.typeId ?? item.name}-${index}`}>
          {(item.quantity ?? 1) > 1 ? `${item.quantity ?? 1}× ` : ""}{item.name}
        </span>
      ))}</div>
    </div>
  );
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
  const [shipPreviews, setShipPreviews] = useState<ShipPreview[]>([]);
  const [selectedShipId, setSelectedShipId] = useState(0);
  const [selectedAnalysis, setSelectedAnalysis] = useState<ActivityReadinessResult | null>(null);
  const [shipPickerOpen, setShipPickerOpen] = useState(false);
  const [routeProgress, setRouteProgress] = useState(0);
  const [selectedArchetypeId, setSelectedArchetypeId] = useState("");
  const [selectedFitId, setSelectedFitId] = useState("");
  const [archetypeBusy, setArchetypeBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [error, setError] = useState("");

  const activity =
    activityDefinitions.find((item) => item.id === activityId) ?? activityDefinitions[0];
  const subcategory =
    activity.subcategories.find((item) => item.id === subcategoryId) ?? firstSubcategory(activity);
  const content =
    subcategory.content.find((item) => item.id === contentId) ?? firstContent(subcategory);
  const selectors = recommendationSelectors(content).map((selector) =>
    content.id === "fw-scout-small" && selector.id === "accessRule" && selectorValues.shipClass === "Frigate"
      ? { ...selector, options: selector.options.slice(0, 1) }
      : selector,
  );
  const selectorKey = JSON.stringify(selectorValues);

  useEffect(() => {
    if (content.id !== "fw-scout-small" || selectorValues.shipClass !== "Frigate" || !selectorValues.accessRule?.startsWith("ADV")) return;
    const gate = recommendationSelectors(content).find((selector) => selector.id === "accessRule");
    if (gate?.options[0]) setSelectorValues((current) => ({ ...current, accessRule: gate.options[0] }));
  }, [content.id, selectorValues.shipClass, selectorValues.accessRule]);

  useEffect(() => {
    let cancelled = false;
    window.sage
      .listShips()
      .then((items) => !cancelled && setShips(items))
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load ship data.");
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const available = new Map(ships.map((ship) => [ship.name.toLowerCase(), ship]));
    const recommendedNames = recommendationShips(content, selectorValues, ships);
    const recommendationOrder = new Map(recommendedNames.map((name, index) => [name.toLowerCase(), index]));
    const metaPicks = new Map(recommendationMetaPicks(content, selectorValues, ships).map((pick) => [pick.name.toLowerCase(), pick.reason]));
    const candidates = recommendedNames
      .map((name) => available.get(name.toLowerCase()))
      .filter((ship): ship is ShipOption => Boolean(ship));
    if (!candidates.length) {
      setShipPreviews([]);
      setSelectedShipId(0);
      setSelectedAnalysis(null);
      return;
    }

    let cancelled = false;
    setBusy(true);
    setError("");
    window.sage.getActivityHullPreviews({
      characterId: snapshot.characterId,
      hullTypeIds: candidates.map((ship) => ship.typeId),
    }).then((previews) => {
      if (cancelled) return;
      const byType = new Map(previews.map((preview) => [preview.hullTypeId, preview]));
      const ranked = candidates.flatMap((ship) => {
        const preview = byType.get(ship.typeId);
        if (!preview) return [];
        const metaReason = metaPicks.get(ship.name.toLowerCase());
        return [{
          ship, preview,
          owned: Boolean(snapshot.extended?.assetSummary?.ownedShips?.some((owned) => owned.item === ship.name)),
          metaPick: Boolean(metaReason),
          metaReason,
          order: recommendationOrder.get(ship.name.toLowerCase()) ?? 9999,
        }];
      }).sort((a, b) =>
        Number(b.metaPick) - Number(a.metaPick) ||
        Number(b.preview.hullAccessReady) - Number(a.preview.hullAccessReady) ||
        b.preview.competencyPercent - a.preview.competencyPercent ||
        b.preview.hullTrainingPercent - a.preview.hullTrainingPercent ||
        Number(b.owned) - Number(a.owned) ||
        a.order - b.order ||
        a.ship.name.localeCompare(b.ship.name),
      );
      setShipPreviews(ranked);
      setSelectedShipId((current) => ranked.some((item) => item.ship.typeId === current) ? current : ranked[0]?.ship.typeId ?? 0);
    }).catch((caught) => {
      if (!cancelled) {
        setShipPreviews([]);
        setError(caught instanceof Error ? caught.message : "Could not calculate ship training previews.");
      }
    }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [activity.id, subcategory.id, content.id, selectorKey, ships, snapshot.characterId, snapshot.updatedAt]);

  const selectedShipPreview = shipPreviews.find((item) => item.ship.typeId === selectedShipId) ?? shipPreviews[0];

  useEffect(() => {
    if (!selectedShipPreview) { setSelectedAnalysis(null); return; }
    let cancelled = false;
    setAnalysisBusy(true);
    setError("");
    setSelectedAnalysis(null);
    setSelectedArchetypeId("");
    setSelectedFitId("");
    window.sage.getActivityReadiness({
      characterId: snapshot.characterId,
      hullTypeId: selectedShipPreview.ship.typeId,
      cloneState: cloneState ?? "omega",
      coreSkills: content.coreSkills,
      supportSkills: content.supportSkills,
      context: { activityId: activity.id, subcategoryId: subcategory.id, contentId: content.id, selectorValues },
    }).then((analysis) => {
      if (cancelled) return;
      setSelectedAnalysis(analysis);
      setSelectedArchetypeId(analysis.selectedArchetype?.id ?? "");
      setSelectedFitId(analysis.selectedArchetype?.recommendedFit?.id ?? "");
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not calculate contextual readiness for this hull.");
    }).finally(() => { if (!cancelled) setAnalysisBusy(false); });
    return () => { cancelled = true; };
  }, [selectedShipPreview?.ship.typeId, activity.id, subcategory.id, content.id, selectorKey, snapshot.characterId, snapshot.updatedAt, cloneState]);

  const selectedShip: ShipAnalysis | undefined = selectedShipPreview && selectedAnalysis
    ? { ship: selectedShipPreview.ship, analysis: selectedAnalysis }
    : undefined;
  const fitChoices = selectedShip?.analysis.selectedArchetype?.fitChoices ??
    (selectedShip?.analysis.selectedArchetype?.recommendedFit ? [selectedShip.analysis.selectedArchetype.recommendedFit] : []);
  const selectedFit = fitChoices.find((fit) => fit.id === selectedFitId) ??
    selectedShip?.analysis.selectedArchetype?.recommendedFit ?? fitChoices[0];

  useEffect(() => {
    setSelectedArchetypeId(selectedShip?.analysis.selectedArchetype?.id ?? "");
    setSelectedFitId(selectedShip?.analysis.selectedArchetype?.recommendedFit?.id ?? "");
  }, [selectedShip?.ship.typeId, selectedShip?.analysis.selectedArchetype?.id, content.id, selectorKey]);

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
  const shipIsScored = selectedAnalysis ? selectedAnalysis.components.hull.weight > 0 : true;

  function chooseActivity(nextId: string) {
    if (nextId === activity.id) { setRouteProgress((current) => Math.max(current, 1)); return; }
    setRouteProgress(1);
    const nextActivity =
      activityDefinitions.find((item) => item.id === nextId) ?? activityDefinitions[0];
    const nextSubcategory = firstSubcategory(nextActivity);
    const nextContent = firstContent(nextSubcategory);
    setActivityId(nextActivity.id);
    setSubcategoryId(nextSubcategory.id);
    setContentId(nextContent.id);
    setSelectorValues(selectorDefaults(nextContent));
    setShipPreviews([]);
    setSelectedAnalysis(null);
    setSelectedShipId(0);
    setSelectedArchetypeId("");
    setSelectedFitId("");
    setShipPickerOpen(false);
  }
  function chooseSubcategory(nextId: string) {
    if (nextId === subcategory.id) { setRouteProgress((current) => Math.max(current, 2)); return; }
    setRouteProgress(2);
    const nextSubcategory =
      activity.subcategories.find((item) => item.id === nextId) ?? firstSubcategory(activity);
    const nextContent = firstContent(nextSubcategory);
    setSubcategoryId(nextSubcategory.id);
    setContentId(nextContent.id);
    setSelectorValues(selectorDefaults(nextContent));
    setShipPreviews([]);
    setSelectedAnalysis(null);
    setSelectedShipId(0);
    setSelectedArchetypeId("");
    setSelectedFitId("");
    setShipPickerOpen(false);
  }
  function chooseContent(nextId: string) {
    if (nextId === content.id) { setRouteProgress((current) => Math.max(current, 3)); return; }
    setRouteProgress(3);
    const nextContent =
      subcategory.content.find((item) => item.id === nextId) ?? firstContent(subcategory);
    setContentId(nextContent.id);
    setSelectorValues(selectorDefaults(nextContent));
    setShipPreviews([]);
    setSelectedAnalysis(null);
    setSelectedShipId(0);
    setSelectedArchetypeId("");
    setSelectedFitId("");
    setShipPickerOpen(false);
  }

  async function chooseArchetype(archetypeId: string) {
    setRouteProgress((current) => Math.max(current, 5));
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
      setSelectedAnalysis(analysis);
      setSelectedArchetypeId(analysis.selectedArchetype?.id ?? archetypeId);
      setSelectedFitId(analysis.selectedArchetype?.recommendedFit?.id ?? "");
    } catch (caught) {
      setSelectedArchetypeId(previousArchetypeId);
      setError(caught instanceof Error ? caught.message : "Could not switch fitting route.");
    } finally {
      setArchetypeBusy(false);
    }
  }

  async function exportRecommendedFit() {
    const recommendation = selectedFit;
    if (!selectedShip?.analysis.hullAccessReady || !recommendation) return;
    setError("");

    const fittedRacks = ["low", "mid", "high", "rig", "subsystem"] as const;
    const fittedTypeIds = [...new Set(fittedRacks.flatMap((rack) => recommendation.fit[rack].map((item) => item.typeId)))];
    let fittingMetadata: Awaited<ReturnType<typeof window.sage.resolveFittingTypeIdsLocal>>;
    try {
      fittingMetadata = fittedTypeIds.length ? await window.sage.resolveFittingTypeIdsLocal(fittedTypeIds) : [];
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not validate the recommended fit against the local CCP SDE.");
      return;
    }
    const metadataByTypeId = new Map(fittingMetadata.map((item) => [item.id, item]));
    const validatedRacks = { low: [] as typeof recommendation.fit.low, mid: [] as typeof recommendation.fit.mid, high: [] as typeof recommendation.fit.high, rig: [] as typeof recommendation.fit.rig, subsystem: [] as typeof recommendation.fit.subsystem };
    const exportedCargo = [...(recommendation.fit.cargo ?? [])];
    for (const sourceRack of fittedRacks) {
      for (const item of recommendation.fit[sourceRack]) {
        const metadata = metadataByTypeId.get(item.typeId);
        if (metadata?.categoryId === 8 || metadata?.categoryName?.toLowerCase() === "charge") {
          exportedCargo.push(item);
          continue;
        }
        const targetRack = metadata?.rack ?? sourceRack;
        validatedRacks[targetRack].push(item);
      }
    }

    const contextText = [activity.label, subcategory.label, content.label, ...Object.values(selectorValues).filter(Boolean)].join(" · ");
    const payload = {
      id: crypto.randomUUID(),
      characterId: snapshot.characterId,
      characterName: snapshot.character.name,
      name: `${selectedShip.ship.name} · ${content.label} · Sage recommended`,
      hull: { name: selectedShip.ship.name, typeId: selectedShip.ship.typeId, quantity: 1 },
      low: validatedRacks.low,
      mid: validatedRacks.mid,
      high: validatedRacks.high,
      rig: validatedRacks.rig,
      subsystem: validatedRacks.subsystem,
      drones: recommendation.fit.drones ?? [],
      fighters: recommendation.fit.fighters ?? [],
      cargo: exportedCargo,
      implants: [],
      boosters: [],
      instructions: [
        `Generated for ${snapshot.character.name}: ${contextText}.`,
        `Selected archetype: ${selectedShip.analysis.selectedArchetype?.label ?? "observed fit"}.`,
        "Recommendation uses the full selected activity route, every route option and this pilot's current synced skills; verify final fitting resources in Fitting Command.",
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
    <div className="activity-planner task4-activity-planner activity-command-atlas">
      <header className="activity-command-context">
        <div className="activity-command-title">
          <p className="eyebrow">CAPSULEER INTELLIGENCE</p>
          <h3>Activity Command</h3>
          <small>Plan the route, prove readiness, then fit and train only what matters.</small>
        </div>
        <div className="activity-command-pilot" title="Pilot used for all Activity Command calculations">
          <img
            src={`https://images.evetech.net/characters/${snapshot.characterId}/portrait?size=64`}
            alt=""
            onError={(event) => { event.currentTarget.style.display = "none"; }}
          />
          <span><small>ANALYSING PILOT</small><strong>{snapshot.character.name}</strong></span>
        </div>
      </header>

      <div className="activity-route-bar" aria-label="Activity planner progression">
        <RouteStep number="1" label="Activity" value="What do you want to do?" active={routeProgress >= 1} />
        <RouteStep number="2" label="Sub-Activity" value="Narrow the route" active={routeProgress >= 2} />
        <RouteStep number="3" label="Content" value="Choose the content" active={routeProgress >= 3} />
        <RouteStep number="4" label="Readiness" value="Route & Readiness" active={routeProgress >= 4} />
        <RouteStep number="5" label="Training" value="Fitting & Next Steps" active={routeProgress >= 5} />
      </div>

      <div className="activity-command-top-grid">
        <section className="activity-command-panel activity-command-activities">
          <div className="activity-section-heading">
            <div><StepEyebrow number="1" label="ACTIVITY" title="WHAT DO YOU WANT TO DO?" /></div>
            <small>{activityDefinitions.length} career routes</small>
          </div>
          <div className="activity-primary-grid">
            {activityDefinitions.map((item, index) => (
              <button key={item.id} className={routeProgress >= 1 && activity.id === item.id ? "active" : ""} onClick={() => chooseActivity(item.id)}>
                <ActivityGlyph label={item.label} index={index} />
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
              </button>
            ))}
          </div>
        </section>

        <section className="activity-command-panel activity-command-subactivities">
          <div className="activity-section-heading"><div><StepEyebrow number="2" label="SUB-ACTIVITY" title="NARROW THE ROUTE" /></div></div>
          <div className="activity-subcategory-grid">
            {activity.subcategories.map((item, index) => (
              <button key={item.id} className={routeProgress >= 2 && subcategory.id === item.id ? "active" : ""} onClick={() => chooseSubcategory(item.id)}>
                <ActivityGlyph label={item.label} index={index} compact />
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
              </button>
            ))}
          </div>
        </section>

        <section className="activity-command-panel activity-command-content">
          <div className="activity-section-heading"><div><StepEyebrow number="3" label="CONTENT" title="CHOOSE THE CONTENT" /></div></div>
          <div className="activity-content-grid">
            {subcategory.content.map((item, index) => (
              <button key={item.id} className={routeProgress >= 3 && content.id === item.id ? "active" : ""} onClick={() => chooseContent(item.id)}>
                <ActivityGlyph label={item.label} index={index} compact />
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
              </button>
            ))}
          </div>
        </section>

        <section className="activity-command-panel activity-command-options">
          <div className="activity-section-heading"><div><StepEyebrow number="3" label="CONTENT" title="CONTENT OPTIONS" /></div></div>
          <div className="activity-option-stack">
            {selectors.length > 0 ? selectors.map((selector) => (
              <label key={selector.id}>
                <span>{selector.label}</span>
                <select
                  value={selectorValues[selector.id] ?? selector.options[0]}
                  onChange={(event) => { setSelectorValues((current) => ({ ...current, [selector.id]: event.target.value })); setRouteProgress(3); }}
                >
                  {selector.options.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
            )) : (
              <div className="activity-option-static"><span>Route variation</span><strong>Default route</strong></div>
            )}
            <div className="activity-option-static"><span>Difficulty</span><strong>{content.difficulty}</strong></div>
            <div className="activity-value-list">
              <span>INCOME / VALUE COMES FROM</span>
              {content.incomeHooks.map((hook) => <strong key={hook}>{hook}</strong>)}
            </div>
          </div>
        </section>

        <section className="activity-command-panel activity-command-summary">
          <div className="activity-section-heading"><div><StepEyebrow number="4" label="READINESS" title="ROUTE SUMMARY" /></div></div>
          {selectedShipPreview ? (
            <>
              <div className="activity-summary-ship">
                <img
                  src={`https://images.evetech.net/types/${selectedShipPreview.ship.typeId}/render?size=128`}
                  alt=""
                  onError={(event) => { event.currentTarget.style.display = "none"; }}
                />
                <div>
                  <strong>{selectedShipPreview.ship.name}</strong>
                  <b>{selectedShip ? `${selectedShip.analysis.overallPercent}% readiness` : "Analysing..."}</b>
                  <small>{selectedShipPreview.ship.groupName ?? "Recommended hull"}</small>
                </div>
              </div>
              {selectedShip ? (
                <>
                  <div className="activity-summary-line">
                    <span>{selectedShip.analysis.compatible ? selectedShip.analysis.tier.label : "Role mismatch"}</span>
                    <strong>{selectedShip.analysis.hullAccessReady ? "CAN FLY" : "HULL BLOCKED"}</strong>
                  </div>
                  <div className="activity-summary-metrics">
                    <ReadinessMetric label="Hull Access" value={selectedShip.analysis.components.hull.percent} />
                    <ReadinessMetric label="Fitting" value={selectedShip.analysis.components.fit.percent} />
                    <ReadinessMetric label="Activity Skills" value={selectedShip.analysis.components.activity.percent} />
                    <ReadinessMetric label="Route Context" value={selectedShip.analysis.components.context.weight ? selectedShip.analysis.components.context.percent : 100} />
                  </div>
                  <div className={`activity-moment ${selectedShip.analysis.missingSkills.length === 0 && selectedShip.analysis.hullAccessReady && selectedShip.analysis.compatible ? "ready" : ""}`}>
                    <span>THE MOMENT OF TRUTH</span>
                    <strong>{selectedShip.analysis.missingSkills.length === 0 && selectedShip.analysis.hullAccessReady && selectedShip.analysis.compatible ? "Ready now" : duration(selectedShip.analysis.totalEstimatedSeconds)}</strong>
                    <small>{selectedShip.analysis.missingSkills.length ? `${selectedShip.analysis.missingSkills.length} blocking target${selectedShip.analysis.missingSkills.length === 1 ? "" : "s"} remain` : "No blockers identified for this route"}</small>
                  </div>
                </>
              ) : <div className="planner-analysis-state compact">Calculating route readiness...</div>}
            </>
          ) : (
            <div className="planner-analysis-state compact">{busy ? "Ranking valid hulls..." : "No valid hull is available for this route."}</div>
          )}
        </section>
      </div>

      {error && <div className="planner-analysis-state error">{error}</div>}

      <div className="activity-command-middle-grid">
        <section className="activity-command-panel activity-command-skill-focus">
          <div className="activity-section-heading">
            <div><p className="eyebrow">SKILL FOCUS</p></div>
            <small>Core {coreMet}/{coreProgress.length} · Support {supportMet}/{supportProgress.length}</small>
          </div>
          <div className="activity-skill-columns">
            <SkillTargetList title="Core skills" targets={coreProgress} />
            <SkillTargetList title="Useful support skills" targets={supportProgress} />
          </div>
        </section>

        <section className="activity-command-panel activity-command-ships">
          <div className="activity-section-heading">
            <div><p className="eyebrow">RECOMMENDED SHIPS</p></div>
            <small>{busy ? "Ranking..." : `${shipPreviews.length} valid hull${shipPreviews.length === 1 ? "" : "s"}`}</small>
          </div>
          {shipPreviews.length > 0 ? (
            <div className="activity-ship-picker">
              <span className="activity-ship-picker-label">{shipIsScored ? "Ranked valid hull" : "Useful hull"}</span>
              <button
                type="button"
                className={`activity-ship-picker-trigger${selectedShipPreview?.metaPick ? " meta-pick" : ""}`}
                aria-expanded={shipPickerOpen}
                onClick={() => setShipPickerOpen((open) => !open)}
              >
                <span><strong>{selectedShipPreview?.ship.name ?? "Choose a hull"}</strong>{selectedShipPreview?.metaPick && <em>META PICK</em>}</span>
                {selectedShipPreview && <small>{selectedShipPreview.preview.competencyPercent}% ship competency · {selectedShipPreview.preview.hullAccessReady ? "CAN FLY" : "BLOCKED"}{selectedShipPreview.owned ? " · OWNED" : ""}</small>}
                <b aria-hidden="true">⌄</b>
              </button>
              {shipPickerOpen && (
                <div className="activity-ship-picker-menu" role="listbox" aria-label="Valid ships for this activity">
                  {shipPreviews.map((item, index) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={item.ship.typeId === selectedShipPreview?.ship.typeId}
                      key={item.ship.typeId}
                      title={item.metaReason}
                      className={`activity-ship-picker-option${item.ship.typeId === selectedShipPreview?.ship.typeId ? " selected" : ""}${item.metaPick ? " meta-pick" : ""}`}
                      onClick={() => { setSelectedShipId(item.ship.typeId); setSelectedAnalysis(null); setShipPickerOpen(false); setRouteProgress(4); }}
                    >
                      <span className="activity-ship-picker-rank">{index + 1}</span>
                      <span className="activity-ship-picker-name"><strong>{item.ship.name}</strong><small>{item.ship.groupName ?? "Ship"}</small></span>
                      <span className="activity-ship-picker-score"><b>{item.preview.competencyPercent}%</b><small>{item.preview.hullAccessReady ? "CAN FLY" : "BLOCKED"}{item.owned ? " · OWNED" : ""}</small></span>
                      {item.metaPick && <em className="activity-meta-pick-badge">META PICK</em>}
                    </button>
                  ))}
                </div>
              )}
              {selectedShipPreview && (
                <div className="activity-ranked-hull">
                  <img src={`https://images.evetech.net/types/${selectedShipPreview.ship.typeId}/render?size=128`} alt="" />
                  <div><strong>{selectedShipPreview.preview.competencyPercent}%</strong><small>SHIP COMPETENCY</small></div>
                </div>
              )}
            </div>
          ) : <div className="planner-analysis-state compact">{busy ? "Building valid hull pool..." : "No matching hulls found."}</div>}
        </section>

        <section className="activity-command-panel activity-command-capability">
          <div className="activity-section-heading"><div><p className="eyebrow">SHIP & CAPABILITY READINESS</p></div></div>
          {selectedShip ? (
            <div className="activity-capability-body">
              <div className="activity-capability-orbit">
                <img src={`https://images.evetech.net/types/${selectedShip.ship.typeId}/render?size=128`} alt="" />
                <strong>{selectedShip.analysis.overallPercent}%</strong>
              </div>
              <div className="activity-capability-bars">
                <CapabilityBar label="Hull" value={selectedShip.analysis.components.hull.percent} />
                <CapabilityBar label="Fitting" value={selectedShip.analysis.components.fit.percent} />
                <CapabilityBar label="Activity" value={selectedShip.analysis.components.activity.percent} />
                <CapabilityBar label="Context" value={selectedShip.analysis.components.context.weight ? selectedShip.analysis.components.context.percent : 100} />
              </div>
              <small className="activity-capability-note">{selectedShip.analysis.explanation.formula}</small>
            </div>
          ) : <div className="planner-analysis-state compact">{analysisBusy ? "Analysing selected hull..." : "Select a valid hull to score readiness."}</div>}
        </section>

        <section className="activity-command-panel activity-command-training-brief">
          <div className="activity-section-heading">
            <div><StepEyebrow number="5" label="TRAINING" title="FITTING & NEXT STEPS" /><h3>{selectedShip ? `${selectedShip.ship.name} progression route` : content.label}</h3></div>
            {selectedShip && <button className="activity-copy-queue" onClick={copyTrainingPlan} disabled={!selectedShip.analysis.recommendedQueue.length}>Copy queue</button>}
          </div>
          {selectedShip ? (
            <div className="activity-training-brief-body">
              <div><span>MANDATORY TRAINING</span><strong>{duration(selectedShip.analysis.totalEstimatedSeconds)}</strong><small>{selectedShip.analysis.missingSkills.length ? `${selectedShip.analysis.missingSkills.length} blocking target${selectedShip.analysis.missingSkills.length === 1 ? "" : "s"}` : "No blockers"}</small></div>
              <div><span>EXTRA / MASTERY</span><strong>{selectedShip.analysis.masteryPercent}%</strong><small>Useful improvements beyond minimum</small></div>
              <div><span>FIT EVIDENCE</span><strong>{selectedShip.analysis.components.fit.percent === null ? "Unknown" : `${selectedShip.analysis.components.fit.percent}%`}</strong><small>{selectedShip.analysis.fitEvidence.sampleCount} observed sample{selectedShip.analysis.fitEvidence.sampleCount === 1 ? "" : "s"} · {selectedShip.analysis.fitEvidence.confidence}</small></div>
            </div>
          ) : <div className="planner-analysis-state compact">Readiness appears here after a hull is ranked.</div>}
        </section>
      </div>

      {selectedShip && (
        <>
          <div className="activity-command-bottom-grid">
            <section className="activity-command-panel activity-command-archetypes">
              <div className="activity-section-heading">
                <div><p className="eyebrow">FIT ARCHETYPE</p><h3>Choose the fitting route Sage should score</h3></div>
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
                        <small>{archetype.sampleCount} observed · {archetype.representativeFitCount} representative · {archetype.usableFitCount} usable now</small>
                      </button>
                    ))}
                  </div>
                  <div className="archetype-meta"><span>{selectedShip.analysis.selectedArchetype.contextSpecific ? "Context matched" : "Hull fallback"}</span><strong>{selectedShip.analysis.selectedArchetype.fitPercent}% fitting competency</strong></div>
                  <small className="activity-evidence-note">{sourceLabel(selectedShip.analysis.fitEvidence.source)} · {selectedShip.analysis.fitEvidence.confidence} confidence</small>
                </>
              ) : <div className="community-fit-unavailable">{selectedShip.analysis.fitEvidence.note ?? "No sufficiently reliable fitting evidence is available. Sage will not invent a perfect score."}</div>}
              {archetypeBusy && <div className="archetype-switch-state">Recalculating this fitting route...</div>}
            </section>

            <section className="activity-command-panel activity-command-fit-competency">
              <div className="activity-section-heading">
                <div><p className="eyebrow">{selectedShip.analysis.components.fit.percent === null ? "FITTING COMPETENCY" : `${selectedShip.analysis.components.fit.percent}% FITTING COMPETENCY`}</p></div>
              </div>
              {selectedFit ? (
                <div className="activity-fit-family-grid">
                  <FitFamilyTile label="High" items={selectedFit.fit.high} />
                  <FitFamilyTile label="Mid" items={selectedFit.fit.mid} />
                  <FitFamilyTile label="Low" items={selectedFit.fit.low} />
                  <FitFamilyTile label="Rigs" items={selectedFit.fit.rig} />
                  <FitFamilyTile label="Drones" items={selectedFit.fit.drones} />
                  <FitFamilyTile label="Cargo" items={selectedFit.fit.cargo} />
                </div>
              ) : <div className="planner-analysis-state compact">No fully usable fit is available yet.</div>}
            </section>

            <section className="activity-command-panel activity-command-recommended-fit">
              <div className="activity-section-heading">
                <div><p className="eyebrow">RECOMMENDED FIT</p><h3>{selectedShip.ship.name} for this exact activity route</h3></div>
                <button type="button" onClick={exportRecommendedFit} disabled={!selectedShip.analysis.hullAccessReady || !selectedFit}>
                  {selectedFit ? "Export selected fit to Fitting Command" : "Fit unavailable"}
                </button>
              </div>
              {selectedShip.analysis.hullAccessReady ? (
                selectedFit ? (
                  <>
                    <div className="archetype-choice-grid recommended-fit-choice-grid">
                      {fitChoices.map((fit, index) => {
                        const copy = fitChoiceCopy(fit, index);
                        return (
                          <button type="button" key={fit.id} className={selectedFit?.id === fit.id ? "active" : ""} aria-pressed={selectedFit?.id === fit.id} onClick={() => { setSelectedFitId(fit.id); setRouteProgress(5); }}>
                            <strong>{copy.title}</strong>
                            <span>{copy.description}</span>
                            <small>{fit.itemTypeIds.length} fitted item type{fit.itemTypeIds.length === 1 ? "" : "s"}{index === 0 ? " · best match for your skills" : ""}</small>
                          </button>
                        );
                      })}
                    </div>
                    <div className="activity-fit-racks">
                      <ActivityFitRack label="High" items={selectedFit.fit.high} />
                      <ActivityFitRack label="Mid" items={selectedFit.fit.mid} />
                      <ActivityFitRack label="Low" items={selectedFit.fit.low} />
                      <ActivityFitRack label="Rigs" items={selectedFit.fit.rig} />
                      <ActivityFitRack label="Subsystems" items={selectedFit.fit.subsystem} />
                      <ActivityFitRack label="Drones" items={selectedFit.fit.drones} />
                      <ActivityFitRack label="Fighters" items={selectedFit.fit.fighters} />
                      <ActivityFitRack label="Cargo" items={selectedFit.fit.cargo} />
                    </div>
                  </>
                ) : <p className="activity-panel-copy">No observed fit for this route is fully usable with this pilot's current skills. Train the blocking route or try another archetype.</p>
              ) : <p className="activity-panel-copy">This pilot cannot currently sit in the selected hull. Fit export remains unavailable until hull access is trained.</p>}
            </section>

            <section className="activity-command-panel activity-command-optional-training">
              <div className="activity-section-heading"><div><p className="eyebrow">OPTIONAL TRAINING</p><h3>Useful next skills</h3></div><strong className="activity-mastery-score">{selectedShip.analysis.masteryPercent}%</strong></div>
              <p className="activity-panel-copy">Not required to start, but useful for performance, fitting margin and efficiency.</p>
              {selectedShip.analysis.masteryQueue.length > 0 ? (
                <div className="mastery-targets">{selectedShip.analysis.masteryQueue.slice(0, 8).map((skill) => <span key={skill.skillId}>{skill.name} · L{skill.targetLevel}</span>)}</div>
              ) : <div className="planner-ready-state">No optional mastery targets remain.</div>}
              <details className="activity-readiness-work">
                <summary>Show Work — why {selectedShip.analysis.overallPercent}%?</summary>
                <p>{selectedShip.analysis.explanation.formula}</p>
                {selectedShip.analysis.explanation.reasons.map((reason) => <small key={reason}>{reason}</small>)}
                {selectedShip.analysis.explanation.caveats.map((caveat) => <small className="readiness-caveat" key={caveat}>{caveat}</small>)}
              </details>
            </section>
          </div>

          <section className="activity-command-panel activity-command-route-intelligence">
            <div className="activity-section-heading">
              <div><p className="eyebrow">ROUTE INTELLIGENCE</p><h3>Exact blockers, evidence and training order</h3></div>
              <small>{content.label} · {selectedShip.ship.name}</small>
            </div>
            <div className="activity-route-intel-grid">
              <div className="activity-route-copy">
                <p>{content.description}</p>
                <small>{content.experience}</small>
                {content.notes?.map((note) => <p className="activity-note" key={note}>{note}</p>)}
                {!selectedShip.analysis.compatible && selectedShip.analysis.compatibilityReason && <div className="planner-analysis-state error">{selectedShip.analysis.compatibilityReason}</div>}
                {selectedShip.analysis.components.context.targets.length > 0 && (
                  <div className="context-target-chips">{selectedShip.analysis.components.context.targets.map((target) => <span key={`${target.skill}-${target.level}`}>{target.skill} · L{target.level}</span>)}</div>
                )}
              </div>

              {selectedShip.analysis.activityEvidence.status === "ready" ? (
                <div className="activity-evidence-panel">
                  <strong>{selectedShip.analysis.activityEvidence.label}</strong>
                  <small>{selectedShip.analysis.activityEvidence.sampleCount} public runs · {selectedShip.analysis.activityEvidence.confidence} confidence</small>
                  <div className="activity-evidence-entries">
                    {selectedShip.analysis.activityEvidence.entries.slice(0, 6).map((entry) => (
                      <div key={entry.name}><strong>{entry.name}</strong><span>{entry.runs} observed · {entry.survivedRuns} survived{entry.level !== null ? ` · level ${entry.level}` : ""}</span></div>
                    ))}
                  </div>
                  {selectedShip.analysis.activityEvidence.note && <small className="activity-evidence-note">{selectedShip.analysis.activityEvidence.note}</small>}
                </div>
              ) : (
                <div className="activity-evidence-panel muted"><strong>Observed activity evidence</strong><small>{selectedShip.analysis.activityEvidence.note ?? "No route-specific public activity evidence is required or available."}</small></div>
              )}
            </div>

            {selectedShip.analysis.components.hull.gaps.length > 0 && (
              <details className="activity-readiness-work hull-gap-breakdown">
                <summary>Show {selectedShip.analysis.components.hull.gaps.length} exact hull/prerequisite gap{selectedShip.analysis.components.hull.gaps.length === 1 ? "" : "s"}</summary>
                <ol className="activity-training-queue practical-training-queue">
                  {selectedShip.analysis.components.hull.gaps.map((skill) => (
                    <li key={skill.skillId}><div><strong>{skill.name}</strong><small>Current L{skill.currentLevel} → required L{skill.targetLevel} · blocks hull access</small></div><span className="training-skill-time">{duration(skill.estimatedSeconds)}</span></li>
                  ))}
                </ol>
              </details>
            )}

            {selectedShip.analysis.recommendedQueue.length ? (
              <details className="activity-readiness-work activity-training-details">
                <summary>Open mandatory training queue · {selectedShip.analysis.recommendedQueue.length} skills</summary>
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
                        <header><div><strong>{category.label}</strong><small>{category.description}</small></div><span>{skills.length} skill{skills.length === 1 ? "" : "s"}</span></header>
                        <ol className="activity-training-queue practical-training-queue categorized-training-queue">
                          {skills.map(({ skill, queueIndex }) => {
                            const reasons = displayedSkillReasons(skill, content.label, selectorValues);
                            return (
                              <li key={skill.skillId}>
                                <span className="training-queue-index">#{queueIndex + 1}</span>
                                <div><strong>{skill.name}</strong><small>L{skill.currentLevel} → L{skill.targetLevel}</small><small className="training-skill-why"><b>Why:</b> {reasons.slice(0, 3).join(" · ")}{reasons.length > 3 ? ` · +${reasons.length - 3} more` : ""}</small></div>
                                <span className="training-skill-time">{skill.alreadyQueued ? `Already queued to L${skill.queuedToLevel}` : duration(skill.estimatedSeconds)}</span>
                              </li>
                            );
                          })}
                        </ol>
                      </section>
                    ))}
                </div>
              </details>
            ) : <div className="planner-ready-state">{snapshot.character.name} meets every identified mandatory requirement for this exact route.</div>}
          </section>
        </>
      )}
    </div>
  );
}

function ActivityGlyph({ label, index, compact = false }: { label: string; index: number; compact?: boolean }) {
  const letters = label.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || String(index + 1);
  return <span className={`activity-glyph${compact ? " compact" : ""}`} aria-hidden="true"><i>{letters}</i></span>;
}

function ReadinessMetric({ label, value }: { label: string; value: number | null }) {
  return <div><span>{label}</span><strong>{value === null ? "—" : `${value}%`}</strong></div>;
}

function CapabilityBar({ label, value }: { label: string; value: number | null }) {
  const safe = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="activity-capability-bar">
      <span>{label}</span>
      <i><b style={{ width: `${safe}%` }} /></i>
      <strong>{value === null ? "—" : `${value}%`}</strong>
    </div>
  );
}

function FitFamilyTile({ label, items }: { label: string; items: Array<{ name: string; quantity?: number; typeId?: number }> }) {
  if (!items.length) return null;
  const first = items[0];
  return (
    <div className="activity-fit-family-tile">
      <span className="activity-fit-family-icon" aria-hidden="true">{label.slice(0, 1)}</span>
      <strong>{first.name}</strong>
      <small>{items.length > 1 ? `+${items.length - 1} more · ${label}` : label}</small>
    </div>
  );
}

function RouteStep({ number, label, value, active = false }: { number: string; label: string; value: string; active?: boolean }) {
  return <div className={active ? "active" : ""}><span>{number}</span><small>{label}</small><strong>{value}</strong></div>;
}

function StepEyebrow({ number, label, title }: { number: string; label: string; title: string }) {
  return <p className="eyebrow activity-step-eyebrow"><span className="activity-step-number">{number}</span><b>{label}</b><em>{title}</em></p>;
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
