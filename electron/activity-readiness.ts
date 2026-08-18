import { getActivityContextEvidence, type ActivityContextEvidence } from "./activity-evidence";
import {
  buildMasteryTargets,
  contextualHullCompatibility,
  resolveContextRule,
  type ActivityContext,
} from "./activity-context";
import {
  getContextFitEvidence,
  type ContextFitArchetype,
  type ContextFitEvidence,
} from "./context-fit-provider";
import {
  analyzeShipReadiness,
  analyzeTrainingPlan,
  type ExplicitSkillTarget,
  type ShipReadinessSkill,
  type SnapshotLike,
} from "./readiness";
import type { CloneState } from "./skill-training";

export type ActivityReadinessInput = {
  hullTypeId: number;
  coreSkills: ExplicitSkillTarget[];
  supportSkills: ExplicitSkillTarget[];
  context: ActivityContext;
  cloneState?: CloneState;
  archetypeId?: string;
};

export type ActivityReadinessTier = {
  id:
    | "not-ready"
    | "early-training"
    | "developing"
    | "operational"
    | "strong"
    | "near-target"
    | "target-ready";
  label: string;
  description: string;
};

export type ActivityArchetypeReadiness = {
  id: string;
  label: string;
  source: ContextFitArchetype["source"];
  sampleCount: number;
  confidence: ContextFitArchetype["confidence"];
  contextSpecific: boolean;
  fitPercent: number;
  overallPercent: number;
  missingFitSkills: number;
  itemTypeIds: number[];
  items: ContextFitArchetype["items"];
  fitChoices: ContextFitArchetype["representativeFits"];
  recommendedFit?: ContextFitArchetype["representativeFits"][number];
};

export type ActivityReadinessResult = {
  hullTypeId: number;
  hull: string;
  hullAccessReady: boolean;
  context: ActivityContext;
  model: ReturnType<typeof resolveContextRule>["model"];
  overallPercent: number;
  masteryPercent: number;
  tier: ActivityReadinessTier;
  compatible: boolean;
  compatibilityReason?: string;
  components: {
    hull: { percent: number | null; weight: number; missing: number | null };
    fit: {
      percent: number | null;
      weight: number;
      missing: number | null;
      sampleCount: number;
      confidence: ContextFitEvidence["confidence"];
      status: ContextFitEvidence["status"];
      contextSpecific: boolean;
    };
    activity: {
      percent: number;
      weight: number;
      corePercent: number;
      supportPercent: number;
      missingCore: number;
      missingSupport: number;
    };
    context: {
      percent: number;
      weight: number;
      missing: number;
      targets: ExplicitSkillTarget[];
    };
  };
  fitEvidence: ContextFitEvidence;
  activityEvidence: ActivityContextEvidence;
  selectedArchetype: ActivityArchetypeReadiness | null;
  alternativeArchetypes: ActivityArchetypeReadiness[];
  recommendedQueue: ShipReadinessSkill[];
  totalEstimatedSeconds: number | null;
  missingSkills: ShipReadinessSkill[];
  masteryQueue: ShipReadinessSkill[];
  missingMasterySkills: ShipReadinessSkill[];
  explanation: {
    formula: string;
    reasons: string[];
    caveats: string[];
  };
};

type Coverage = { percent: number; missing: number };

function targetCoverage(snapshot: SnapshotLike, targets: ExplicitSkillTarget[]): Coverage {
  if (!targets.length) return { percent: 100, missing: 0 };
  const byName = new Map(
    snapshot.skills.skills.map((skill) => [skill.name?.toLowerCase() ?? "", skill]),
  );
  let earned = 0;
  let total = 0;
  let missing = 0;
  for (const target of targets) {
    const level = Math.max(1, Math.min(5, target.level));
    const current = byName.get(target.skill.toLowerCase())?.trained_skill_level ?? 0;
    earned += Math.min(current, level);
    total += level;
    if (current < level) missing += 1;
  }
  return {
    percent: total ? Math.round((earned / total) * 100) : 100,
    missing,
  };
}

function tierFor(percent: number): ActivityReadinessTier {
  if (percent < 40)
    return {
      id: "not-ready",
      label: "Not ready",
      description: "Major requirements for this exact activity context are still missing.",
    };
  if (percent < 60)
    return {
      id: "early-training",
      label: "Early training",
      description: "The route is started, but important practical requirements remain.",
    };
  if (percent < 75)
    return {
      id: "developing",
      label: "Developing",
      description: "Useful foundations are present, but meaningful gaps remain for this context.",
    };
  if (percent < 90)
    return {
      id: "operational",
      label: "Operational baseline",
      description: "The character is approaching a practical baseline for the selected activity.",
    };
  if (percent < 97)
    return {
      id: "strong",
      label: "Strong",
      description: "Most mandatory hull, fitting and contextual targets are covered.",
    };
  if (percent < 100)
    return {
      id: "near-target",
      label: "Near target",
      description: "Only small identified gaps remain before the selected target is fully met.",
    };
  return {
    id: "target-ready",
    label: "Target ready",
    description: "Every identified mandatory target for this exact context is met.",
  };
}

function effectiveWeights(
  base: { hull: number; fit: number; activity: number; context: number },
  active: { hull: boolean; fit: boolean; activity: boolean; context: boolean },
) {
  const raw = {
    hull: active.hull ? base.hull : 0,
    fit: active.fit ? base.fit : 0,
    activity: active.activity ? base.activity : 0,
    context: active.context ? base.context : 0,
  };
  const total = raw.hull + raw.fit + raw.activity + raw.context;
  if (!total) return { hull: 0, fit: 0, activity: 100, context: 0 };
  const scaled = {
    hull: Math.round((raw.hull / total) * 100),
    fit: Math.round((raw.fit / total) * 100),
    activity: Math.round((raw.activity / total) * 100),
    context: Math.round((raw.context / total) * 100),
  };
  const drift = 100 - (scaled.hull + scaled.fit + scaled.activity + scaled.context);
  if (drift) {
    const key = (Object.entries(scaled) as Array<[keyof typeof scaled, number]>).sort(
      (a, b) => b[1] - a[1],
    )[0]?.[0];
    if (key) scaled[key] += drift;
  }
  return scaled;
}

function weightedScore(
  values: { hull: number; fit: number; activity: number; context: number },
  weights: { hull: number; fit: number; activity: number; context: number },
) {
  return Math.round(
    (values.hull * weights.hull +
      values.fit * weights.fit +
      values.activity * weights.activity +
      values.context * weights.context) /
      100,
  );
}

function confidenceCap(
  score: number,
  fitRequired: boolean,
  evidence: ContextFitEvidence,
  mandatoryMissing: number,
) {
  if (mandatoryMissing > 0) return Math.min(score, 99);
  if (!fitRequired) return score;
  if (evidence.status !== "ready" || !evidence.archetypes.length) return Math.min(score, 84);
  if (!evidence.contextSpecific) return Math.min(score, 94);
  if (evidence.confidence === "none" || evidence.confidence === "low") return Math.min(score, 94);
  if (evidence.confidence === "medium") return Math.min(score, 99);
  return score;
}

export async function analyzeActivityReadiness(
  snapshot: SnapshotLike,
  input: ActivityReadinessInput,
): Promise<ActivityReadinessResult> {
  const cloneState = input.cloneState ?? "omega";
  const rule = resolveContextRule(input.context);
  const hull = rule.includeHull
    ? await analyzeShipReadiness(snapshot, input.hullTypeId, cloneState)
    : null;
  const hullName = hull?.hull ?? "Activity progression";
  const compatibility = rule.includeHull
    ? contextualHullCompatibility(hullName, input.context)
    : { compatible: true as const };

  const core = targetCoverage(snapshot, input.coreSkills);
  const support = targetCoverage(snapshot, input.supportSkills);
  const activityPercent = Math.round(core.percent * 0.7 + support.percent * 0.3);
  const contextCoverage = targetCoverage(snapshot, rule.contextTargets);

  const activityEvidence = await getActivityContextEvidence(input.context);

  const fitEvidence = await getContextFitEvidence(
    input.hullTypeId,
    hullName,
    input.context,
    rule.includeFit ? rule : { ...rule, includeFit: true },
  );

  const hasFitEvidence = rule.includeFit && fitEvidence.status === "ready" && fitEvidence.archetypes.length > 0;
  const weights = effectiveWeights(rule.weights, {
    hull: rule.includeHull,
    fit: hasFitEvidence,
    activity: true,
    context: rule.contextTargets.length > 0,
  });

  const archetypeResults: ActivityArchetypeReadiness[] = [];
  for (const archetype of fitEvidence.archetypes) {
    const fitPlan = await analyzeTrainingPlan(snapshot, archetype.itemTypeIds, [], cloneState);
    let recommendedFit: ContextFitArchetype["representativeFits"][number] | undefined;
    let recommendedFitReadiness = -1;
    let recommendedFitMissing = Number.MAX_SAFE_INTEGER;
    const scoredFits: Array<{ fit: ContextFitArchetype["representativeFits"][number]; readiness: number; missing: number; usable: boolean }> = [];
    for (const representative of archetype.representativeFits ?? []) {
      const representativePlan = await analyzeTrainingPlan(snapshot, representative.itemTypeIds, [], cloneState);
      scoredFits.push({ fit: representative, readiness: representativePlan.readinessPercent, missing: representativePlan.missingSkills.length, usable: representativePlan.ready });
      // A recommendation is skill-aware only when every requirement for every
      // fitted item is already trained. Partial readiness remains useful for the
      // progression score but must never become an exportable recommendation.
      if (representativePlan.ready && (representativePlan.readinessPercent > recommendedFitReadiness || (representativePlan.readinessPercent === recommendedFitReadiness && representativePlan.missingSkills.length < recommendedFitMissing))) {
        recommendedFit = representative;
        recommendedFitReadiness = representativePlan.readinessPercent;
        recommendedFitMissing = representativePlan.missingSkills.length;
      }
    }
    let overallPercent = weightedScore(
      {
        hull: hull ? (hull.hullAccessReady ? 100 : 0) : 100,
        fit: fitPlan.readinessPercent,
        activity: activityPercent,
        context: contextCoverage.percent,
      },
      effectiveWeights(rule.weights, {
        hull: rule.includeHull,
        fit: true,
        activity: true,
        context: rule.contextTargets.length > 0,
      }),
    );
    overallPercent = confidenceCap(
      overallPercent,
      true,
      { ...fitEvidence, confidence: archetype.confidence, contextSpecific: archetype.contextSpecific },
      (hull?.missingSkills.length ?? 0) + core.missing + support.missing + contextCoverage.missing + fitPlan.missingSkills.length,
    );
    if (!compatibility.compatible) overallPercent = 0;
    archetypeResults.push({
      id: archetype.id,
      label: archetype.label,
      source: archetype.source,
      sampleCount: archetype.sampleCount,
      confidence: archetype.confidence,
      contextSpecific: archetype.contextSpecific,
      fitPercent: fitPlan.readinessPercent,
      overallPercent,
      missingFitSkills: fitPlan.missingSkills.length,
      itemTypeIds: archetype.itemTypeIds,
      items: archetype.items,
      fitChoices: scoredFits
        .filter((item) => item.usable)
        .sort((a, b) => b.readiness - a.readiness || a.missing - b.missing || a.fit.name.localeCompare(b.fit.name))
        .map((item) => item.fit),
      recommendedFit,
    });
  }
  archetypeResults.sort((a, b) =>
    b.overallPercent - a.overallPercent ||
    b.fitPercent - a.fitPercent ||
    b.sampleCount - a.sampleCount,
  );
  const requestedArchetype = input.archetypeId
    ? archetypeResults.find((item) => item.id === input.archetypeId)
    : undefined;
  const selectedArchetype = requestedArchetype ?? archetypeResults[0] ?? null;
  const selectedFitPercent = selectedArchetype?.fitPercent ?? 100;
  const selectedItemTypeIds = selectedArchetype?.itemTypeIds ?? [];

  const mandatoryTargets = [
    ...input.coreSkills.map((target) => ({
      ...target,
      reason: target.reason ?? "Core competency target for the selected activity",
    })),
    ...input.supportSkills.map((target) => ({
      ...target,
      reason: target.reason ?? "Support competency target for the selected activity",
    })),
    ...rule.contextTargets.map((target) => ({
      ...target,
      reason: target.reason ?? "Required by the selected variation or role",
    })),
  ];
  const mandatoryItems = [
    ...(rule.includeHull ? [input.hullTypeId] : []),
    ...(hasFitEvidence ? selectedItemTypeIds : []),
  ];
  const combinedPlan = await analyzeTrainingPlan(
    snapshot,
    mandatoryItems,
    mandatoryTargets,
    cloneState,
  );

  let overallPercent = weightedScore(
    {
      hull: hull ? (hull.hullAccessReady ? 100 : 0) : 100,
      fit: selectedFitPercent,
      activity: activityPercent,
      context: contextCoverage.percent,
    },
    weights,
  );
  overallPercent = confidenceCap(
    overallPercent,
    rule.includeFit,
    fitEvidence,
    combinedPlan.missingSkills.length,
  );
  if (!compatibility.compatible) overallPercent = 0;

  const masteryTargets = buildMasteryTargets(input.coreSkills, input.supportSkills, rule);
  const masteryPlan = await analyzeTrainingPlan(snapshot, [], masteryTargets, cloneState);
  const masteryPercent = Math.min(overallPercent, masteryPlan.readinessPercent);

  const reasons: string[] = [];
  if (rule.includeHull)
    reasons.push(`Hull access contributes ${weights.hull}%: ${hull?.hullAccessPercent ?? 0}%.`);
  if (rule.includeFit) {
    if (selectedArchetype)
      reasons.push(
        `${selectedArchetype.label} fitting competency contributes ${weights.fit}%: ${selectedArchetype.fitPercent}%.`,
      );
    else
      reasons.push(
        "No trustworthy fitting archetype could be scored, so Sage redistributes the visible weights and caps readiness rather than claiming full practical readiness.",
      );
  }
  reasons.push(
    `Activity core/support competency contributes ${weights.activity}%: ${activityPercent}% (core ${core.percent}%, support ${support.percent}%).`,
  );
  if (rule.contextTargets.length)
    reasons.push(
      `The selected variation/role contributes ${weights.context}%: ${contextCoverage.percent}% across ${rule.contextTargets.length} contextual target${rule.contextTargets.length === 1 ? "" : "s"}.`,
    );
  if (!compatibility.compatible && "reason" in compatibility)
    reasons.push(compatibility.reason);

  if (activityEvidence.status === "ready")
    reasons.push(
      "Public activity evidence: " + activityEvidence.sampleCount + " matching observed run" + (activityEvidence.sampleCount === 1 ? "" : "s") + " (" + activityEvidence.confidence + " confidence) from " + activityEvidence.label + ".",
    );

  const caveats: string[] = [];
  if (rule.includeFit) {
    if (fitEvidence.note) caveats.push(fitEvidence.note);
    if (fitEvidence.status === "ready" && !fitEvidence.contextSpecific)
      caveats.push(
        "The selected activity has no strong variation-specific fitting signal in the available evidence, so the fitting layer is using hull-wide observed archetypes as fallback rather than pretending they are exact doctrine or site fits.",
      );
    if (fitEvidence.confidence !== "high")
      caveats.push(
        `Fitting evidence confidence is ${fitEvidence.confidence}; Sage limits the maximum readiness score when evidence is thin.`,
      );
  }

  return {
    hullTypeId: input.hullTypeId,
    hull: hullName,
    hullAccessReady: hull?.hullAccessReady ?? !rule.includeHull,
    context: input.context,
    model: rule.model,
    overallPercent,
    masteryPercent,
    tier: tierFor(overallPercent),
    compatible: compatibility.compatible,
    compatibilityReason: "reason" in compatibility ? compatibility.reason : undefined,
    components: {
      hull: {
        percent: hull ? (hull.hullAccessReady ? 100 : 0) : null,
        weight: weights.hull,
        missing: hull?.missingHullAccessSkills.length ?? null,
      },
      fit: {
        percent: selectedArchetype?.fitPercent ?? null,
        weight: weights.fit,
        missing: selectedArchetype?.missingFitSkills ?? null,
        sampleCount: fitEvidence.sampleCount,
        confidence: fitEvidence.confidence,
        status: fitEvidence.status,
        contextSpecific: fitEvidence.contextSpecific,
      },
      activity: {
        percent: activityPercent,
        weight: weights.activity,
        corePercent: core.percent,
        supportPercent: support.percent,
        missingCore: core.missing,
        missingSupport: support.missing,
      },
      context: {
        percent: contextCoverage.percent,
        weight: weights.context,
        missing: contextCoverage.missing,
        targets: rule.contextTargets,
      },
    },
    fitEvidence,
    activityEvidence,
    selectedArchetype,
    alternativeArchetypes: archetypeResults.filter(
      (item) => item.id !== selectedArchetype?.id,
    ),
    recommendedQueue: combinedPlan.recommendedQueue,
    totalEstimatedSeconds: combinedPlan.totalEstimatedSeconds,
    missingSkills: combinedPlan.missingSkills,
    masteryQueue: masteryPlan.recommendedQueue,
    missingMasterySkills: masteryPlan.missingSkills,
    explanation: {
      formula:
        "Readiness uses a context-specific component model. Hull and fitted-equipment competency are included only when the activity actually depends on them; activity and selected variation/role targets are scored separately. Fit archetypes are scored independently instead of averaging unrelated fits together.",
      reasons,
      caveats,
    },
  };
}
