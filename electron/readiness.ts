import {
  estimateTrainingSeconds,
  type CharacterAttributes,
  type CloneState,
} from "./skill-training";
import AdmZip from "adm-zip";
import path from "node:path";
import { STATIC_DATA_ROOT } from "./data-paths";
import { ensureStaticDataArchive } from "./type-volumes";
import { getFittingTypeInfoLocal } from "./fitting-dogma";

const REQUIREMENT_PAIRS = [
  [182, 277],
  [183, 278],
  [184, 279],
  [1285, 1286],
  [1289, 1287],
  [1290, 1288],
] as const;

const RANK_ATTRIBUTE = 275;
const PRIMARY_ATTRIBUTE = 180;
const SECONDARY_ATTRIBUTE = 181;
const TYPE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type SnapshotSkill = {
  skill_id: number;
  name?: string;
  trained_skill_level: number;
  active_skill_level: number;
  skillpoints_in_skill: number;
  rank?: number;
};

export type SnapshotLike = {
  characterId: string;
  character: { name: string };
  skills: { skills: SnapshotSkill[] };
  queue: Array<{
    skill_id: number;
    finish_date?: string;
    finished_level: number;
  }>;
  attributes?: CharacterAttributes;
};

export type TypeDetail = {
  type_id: number;
  name: string;
  group_id?: number;
  dogma_attributes?: Array<{ attribute_id: number; value: number }>;
};

type RequirementNode = {
  skillId: number;
  name: string;
  targetLevel: number;
  direct: boolean;
  rank: number;
  primaryAttributeId?: number;
  secondaryAttributeId?: number;
  prerequisites: Map<number, number>;
  requiredBy: Set<number>;
  sources: Set<"item" | "activity">;
  reasons: Set<string>;
};

export type ExplicitSkillTarget = {
  skill: string;
  level: number;
  reason?: string;
};

export type ShipReadinessSkill = {
  skillId: number;
  name: string;
  currentLevel: number;
  targetLevel: number;
  currentSkillPoints: number;
  rank: number;
  direct: boolean;
  met: boolean;
  missingLevels: number;
  estimatedSeconds: number | null;
  queuedToLevel: number;
  alreadyQueued: boolean;
  prerequisiteSkillIds: number[];
  requiredBySkillIds: number[];
  sources?: Array<"item" | "activity">;
  reasons?: string[];
};

export type TrainingPlanResult = {
  readinessPercent: number;
  ready: boolean;
  relevantSkills: ShipReadinessSkill[];
  missingSkills: ShipReadinessSkill[];
  prerequisiteSkills: ShipReadinessSkill[];
  dependencyOrder: ShipReadinessSkill[];
  recommendedQueue: ShipReadinessSkill[];
  totalEstimatedSeconds: number | null;
  directRequirements: number;
  metDirectRequirements: number;
  explanation: {
    formula: string;
    reasons: string[];
    strengths: string[];
    weaknesses: string[];
  };
};

export type ShipReadinessResult = TrainingPlanResult & {
  hullTypeId: number;
  hull: string;
  characterId: string;
  character: string;
  hullAccessPercent: number;
  hullTrainingPercent: number;
  hullAccessReady: boolean;
  hullAccessSkills: ShipReadinessSkill[];
  missingHullAccessSkills: ShipReadinessSkill[];
  hullAccessTrainingSkills: ShipReadinessSkill[];
  targetMasteryLevel: number;
  masteryLevel: number;
  masteryLabel: string;
};

const MASTERY_LABELS = ["No mastery", "Mastery I", "Mastery II", "Mastery III", "Mastery IV", "Mastery V"];
const MASTERY_KEYS = ["basic", "standard", "improved", "advanced", "elite"] as const;
let masteryPromise: Promise<Map<number, Array<Map<number, number>>>> | undefined;

export type HullAccessPreview = {
  hullTypeId: number;
  hullTrainingPercent: number;
  hullAccessReady: boolean;
  directRequirements: number;
  missingDirectRequirements: number;
};

type LocalRequirementEntry = {
  rank: number;
  primaryAttributeId?: number;
  secondaryAttributeId?: number;
  requirements: Array<{ skillId: number; level: number }>;
};
type LocalTypeEntry = { name: string; groupId?: number };
let localRequirementIndexPromise: Promise<Map<number, LocalRequirementEntry>> | undefined;
let localTypeIndexPromise: Promise<Map<number, LocalTypeEntry>> | undefined;

async function loadLocalRequirementIndex() {
  if (localRequirementIndexPromise) return localRequirementIndexPromise;
  localRequirementIndexPromise = Promise.resolve().then(async () => {
    await ensureStaticDataArchive();
    const zip = new AdmZip(path.join(STATIC_DATA_ROOT, "eve-static-data-jsonl.zip"));
    const entry = zip.getEntry("typeDogma.jsonl");
    if (!entry) throw new Error("Official EVE type DOGMA data is unavailable.");
    const index = new Map<number, LocalRequirementEntry>();
    for (const line of entry.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const row = JSON.parse(line) as { _key: number; dogmaAttributes?: Array<{ attributeID: number; value: number }> };
      const attributes = new Map((row.dogmaAttributes ?? []).map((attribute) => [attribute.attributeID, attribute.value]));
      const requirements = REQUIREMENT_PAIRS.flatMap(([skillAttribute, levelAttribute]) => {
        const skillId = Number(attributes.get(skillAttribute) ?? 0);
        if (!Number.isSafeInteger(skillId) || skillId <= 0) return [];
        return [{ skillId, level: Math.max(1, Math.min(5, Math.round(Number(attributes.get(levelAttribute) ?? 1)))) }];
      });
      const rank = Math.max(1, Number(attributes.get(RANK_ATTRIBUTE) ?? 1));
      if (requirements.length || attributes.has(RANK_ATTRIBUTE)) index.set(row._key, {
        rank,
        primaryAttributeId: attributes.get(PRIMARY_ATTRIBUTE),
        secondaryAttributeId: attributes.get(SECONDARY_ATTRIBUTE),
        requirements,
      });
    }
    return index;
  });
  return localRequirementIndexPromise;
}

async function loadLocalTypeIndex() {
  if (localTypeIndexPromise) return localTypeIndexPromise;
  localTypeIndexPromise = Promise.resolve().then(async () => {
    await ensureStaticDataArchive();
    const zip = new AdmZip(path.join(STATIC_DATA_ROOT, "eve-static-data-jsonl.zip"));
    const entry = zip.getEntry("types.jsonl");
    if (!entry) throw new Error("Official EVE type data is unavailable.");
    const index = new Map<number, LocalTypeEntry>();
    for (const line of entry.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const row = JSON.parse(line) as { _key: number; name?: string | Record<string, string>; groupID?: number };
      const rawName = row.name;
      const name = typeof rawName === "string" ? rawName : rawName?.en;
      if (name) index.set(row._key, { name, groupId: row.groupID });
    }
    return index;
  });
  return localTypeIndexPromise;
}

export async function analyzeHullAccessPreviews(snapshot: SnapshotLike, hullTypeIds: number[]): Promise<HullAccessPreview[]> {
  const [index, masteries] = await Promise.all([loadLocalRequirementIndex(), loadMasteries()]);
  const trained = new Map(snapshot.skills.skills.map((skill) => [skill.skill_id, skill.trained_skill_level]));
  const trainedDetails = new Map(snapshot.skills.skills.map((skill) => [skill.skill_id, skill]));
  const unique = [...new Set(hullTypeIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  return unique.map((hullTypeId) => {
    const direct = index.get(hullTypeId)?.requirements ?? [];
    const targets = new Map<number, number>();
    const visiting = new Set<number>();
    const collect = (skillId: number, level: number) => {
      targets.set(skillId, Math.max(targets.get(skillId) ?? 0, level));
      if (visiting.has(skillId)) return;
      visiting.add(skillId);
      for (const requirement of index.get(skillId)?.requirements ?? []) collect(requirement.skillId, requirement.level);
      visiting.delete(skillId);
    };
    for (const requirement of direct) collect(requirement.skillId, requirement.level);
    let totalWeight = 0;
    let earnedWeight = 0;
    for (const [skillId, targetLevel] of targets) {
      const rank = index.get(skillId)?.rank ?? 1;
      totalWeight += rank * targetLevel;
      earnedWeight += rank * Math.min(trained.get(skillId) ?? 0, targetLevel);
    }
    const hullTrainingPercent = totalWeight ? Math.round((earnedWeight / totalWeight) * 100) : 100;
    const masteryTarget = masteries.get(hullTypeId)?.[2] ?? new Map<number, number>();
    let masteryTargetSp = 0;
    let masteryEarnedSp = 0;
    for (const [skillId, level] of masteryTarget) {
      const rank = index.get(skillId)?.rank ?? trainedDetails.get(skillId)?.rank ?? 1;
      const targetSp = Math.ceil(250 * rank * Math.pow(2, 2.5 * (level - 1)));
      masteryTargetSp += targetSp;
      masteryEarnedSp += Math.min(trainedDetails.get(skillId)?.skillpoints_in_skill ?? 0, targetSp);
    }
    const competencyPercent = masteryTargetSp ? Math.round((masteryEarnedSp / masteryTargetSp) * 100) : hullTrainingPercent;
    const missingDirectRequirements = direct.filter((requirement) => (trained.get(requirement.skillId) ?? 0) < requirement.level).length;
    return {
      hullTypeId,
      hullTrainingPercent,
      competencyPercent,
      hullAccessReady: missingDirectRequirements === 0,
      directRequirements: direct.length,
      missingDirectRequirements,
    };
  });
}


async function loadMasteries() {
  if (masteryPromise) return masteryPromise;
  masteryPromise = Promise.resolve().then(async () => {
    await ensureStaticDataArchive();
    const zip = new AdmZip(path.join(STATIC_DATA_ROOT, "eve-static-data-jsonl.zip"));
    const masteries = zip.getEntry("masteries.jsonl");
    const certificates = zip.getEntry("certificates.jsonl");
    if (!masteries || !certificates) throw new Error("Official EVE mastery data is unavailable.");
    const certificateSkills = new Map<number, Array<Record<(typeof MASTERY_KEYS)[number], number> & { skillId: number }>>();
    for (const line of certificates.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const row = JSON.parse(line) as { _key: number; skillTypes?: Array<{ _key: number; basic: number; standard: number; improved: number; advanced: number; elite: number }> };
      certificateSkills.set(row._key, (row.skillTypes ?? []).map((skill) => ({ skillId: skill._key, ...skill })));
    }
    const result = new Map<number, Array<Map<number, number>>>();
    for (const line of masteries.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const row = JSON.parse(line) as { _key: number; _value: Array<{ _key: number; _value: number[] }> };
      const tiers = MASTERY_KEYS.map((key, tier) => {
        const targets = new Map<number, number>();
        const certIds = row._value.find((item) => item._key === tier)?._value ?? [];
        for (const certId of certIds) for (const skill of certificateSkills.get(certId) ?? []) {
          const level = skill[key];
          if (level > 0) targets.set(skill.skillId, Math.max(targets.get(skill.skillId) ?? 0, level));
        }
        return targets;
      });
      result.set(row._key, tiers);
    }
    return result;
  });
  return masteryPromise;
}

export async function prepareReadinessStaticData() {
  const [masteries, requirementIndex] = await Promise.all([loadMasteries(), loadLocalRequirementIndex()]);
  return {
    masteryHulls: masteries.size,
    masteryTiers: [...masteries.values()].reduce((sum, tiers) => sum + tiers.length, 0),
    requirementTypes: requirementIndex.size,
  };
}

const typeCache = new Map<number, { expiresAt: number; detail: TypeDetail }>();
const pendingTypes = new Map<number, Promise<TypeDetail>>();

export async function fetchTypeDetail(typeId: number): Promise<TypeDetail> {
  const cached = typeCache.get(typeId);
  if (cached && cached.expiresAt > Date.now()) return cached.detail;
  const pending = pendingTypes.get(typeId);
  if (pending) return pending;

  const request = (async () => {
    const local = await getFittingTypeInfoLocal(typeId);
    const detail: TypeDetail = {
      type_id: local.typeId,
      name: local.name,
      group_id: local.group.id,
      dogma_attributes: local.attributes.map((attribute) => ({
        attribute_id: attribute.attributeId,
        value: attribute.value,
      })),
    };
    typeCache.set(typeId, { expiresAt: Date.now() + TYPE_CACHE_TTL_MS, detail });
    return detail;
  })();
  pendingTypes.set(typeId, request);
  try {
    return await request;
  } finally {
    pendingTypes.delete(typeId);
  }
}

function dogmaMap(detail: TypeDetail) {
  return new Map(
    (detail.dogma_attributes ?? []).map((attribute) => [
      attribute.attribute_id,
      attribute.value,
    ]),
  );
}

function requirements(detail: TypeDetail) {
  const dogma = dogmaMap(detail);
  return REQUIREMENT_PAIRS.flatMap(([skillAttribute, levelAttribute]) => {
    const skillId = dogma.get(skillAttribute);
    if (!skillId) return [];
    return [
      {
        skillId,
        level: Math.max(1, Math.min(5, Math.round(dogma.get(levelAttribute) ?? 1))),
      },
    ];
  });
}

function metadata(detail: TypeDetail) {
  const dogma = dogmaMap(detail);
  return {
    rank: dogma.get(RANK_ATTRIBUTE) ?? 1,
    primaryAttributeId: dogma.get(PRIMARY_ATTRIBUTE),
    secondaryAttributeId: dogma.get(SECONDARY_ATTRIBUTE),
  };
}

async function resolveSkillTargets(
  targets: ExplicitSkillTarget[],
  typeIndex: Map<number, LocalTypeEntry>,
) {
  if (!targets.length) return [] as Array<{ skillId: number; name: string; level: number; reason?: string }>;
  const byName = new Map(
    [...typeIndex.entries()].map(([id, item]) => [item.name.toLowerCase(), { id, name: item.name }]),
  );
  const unresolved = [...new Set(targets.map((target) => target.skill.trim()).filter(Boolean))]
    .filter((name) => !byName.has(name.toLowerCase()));
  if (unresolved.length)
    throw new Error(`Progression contains invalid current EVE skill target${unresolved.length === 1 ? "" : "s"}: ${unresolved.join(",  ")}.`);
  return targets.map((target) => {
    const item = byName.get(target.skill.toLowerCase())!;
    return {
      skillId: item.id,
      name: item.name,
      level: Math.max(1, Math.min(5, Math.round(target.level))),
      reason: target.reason,
    };
  });
}

export async function analyzeTrainingPlan(
  snapshot: SnapshotLike,
  itemTypeIds: number[],
  explicitSkillTargets: ExplicitSkillTarget[] = [],
  cloneState: CloneState = "omega",
): Promise<TrainingPlanResult> {
  if (!snapshot.attributes)
    throw new Error(
      "Sync this character again so Sage has training attributes for readiness estimates.",
    );

  const [localRequirements, localTypes] = await Promise.all([loadLocalRequirementIndex(), loadLocalTypeIndex()]);
  const trained = new Map(snapshot.skills.skills.map((skill) => [skill.skill_id, skill]));
  const nodes = new Map<number, RequirementNode>();
  const roots = new Set<number>();

  async function ensureNode(
    skillId: number,
    targetLevel: number,
    isDirect: boolean,
    source: "item" | "activity",
    requiredBy?: number,
    reason?: string,
    stack = new Set<number>(),
  ) {
    const existing = nodes.get(skillId);
    if (existing) {
      existing.targetLevel = Math.max(existing.targetLevel, targetLevel);
      existing.direct ||= isDirect;
      existing.sources.add(source);
      if (reason) existing.reasons.add(reason);
      if (requiredBy) existing.requiredBy.add(requiredBy);
      if (isDirect) roots.add(skillId);
      // Do not walk backwards through prerequisites of a skill that is already
      // trained to the level this path needs. This matters for grandfathered
      // or changed prerequisite trees (for example an already-trained
      // Freighter skill). If another path raises the target above the trained
      // level, expand it exactly once at that point.
      const existingLevel = trained.get(skillId)?.trained_skill_level ?? 0;
      if (existingLevel >= existing.targetLevel || existing.prerequisites.size > 0) return;
      const nextStack = new Set(stack);
      nextStack.add(skillId);
      const requirement = localRequirements.get(skillId);
      for (const prerequisite of requirement?.requirements ?? []) {
        existing.prerequisites.set(prerequisite.skillId, prerequisite.level);
        await ensureNode(
          prerequisite.skillId,
          prerequisite.level,
          false,
          source,
          skillId,
          `Prerequisite for ${existing.name}`,
          nextStack,
        );
      }
      return;
    }
    if (stack.has(skillId)) return;
    const nextStack = new Set(stack);
    nextStack.add(skillId);

    const requirement = localRequirements.get(skillId);
    const type = localTypes.get(skillId);
    if (!type) throw new Error(`Official EVE type data is missing skill ${skillId}.`);
    const node: RequirementNode = {
      skillId,
      name: type.name,
      targetLevel,
      direct: isDirect,
      rank: requirement?.rank ?? 1,
      primaryAttributeId: requirement?.primaryAttributeId,
      secondaryAttributeId: requirement?.secondaryAttributeId,
      prerequisites: new Map(),
      requiredBy: new Set(requiredBy ? [requiredBy] : []),
      sources: new Set([source]),
      reasons: new Set(reason ? [reason] : []),
    };
    nodes.set(skillId, node);
    if (isDirect) roots.add(skillId);

    const currentLevel = trained.get(skillId)?.trained_skill_level ?? 0;
    if (currentLevel >= targetLevel) return;

    for (const prerequisite of requirement?.requirements ?? []) {
      node.prerequisites.set(prerequisite.skillId, prerequisite.level);
      await ensureNode(
        prerequisite.skillId,
        prerequisite.level,
        false,
        source,
        skillId,
        `Prerequisite for ${type.name}`,
        nextStack,
      );
    }
  }

  for (const itemTypeId of [...new Set(itemTypeIds.filter((id) => Number.isInteger(id) && id > 0))]) {
    const item = localTypes.get(itemTypeId);
    if (!item) throw new Error(`Official EVE type data is missing item ${itemTypeId}.`);
    for (const requirement of localRequirements.get(itemTypeId)?.requirements ?? [])
      await ensureNode(
        requirement.skillId,
        requirement.level,
        true,
        "item",
        undefined,
        `Required to use ${item.name}`,
      );
  }

  const resolvedTargets = await resolveSkillTargets(explicitSkillTargets, localTypes);
  for (const target of resolvedTargets)
    await ensureNode(
      target.skillId,
      target.level,
      true,
      "activity",
      undefined,
      target.reason ?? "Selected activity/context target",
    );

  const queueBySkill = new Map<number, number>();
  for (const item of snapshot.queue) {
    queueBySkill.set(
      item.skill_id,
      Math.max(queueBySkill.get(item.skill_id) ?? 0, item.finished_level),
    );
  }

  const mapped = new Map<number, ShipReadinessSkill>();
  for (const node of nodes.values()) {
    const current = trained.get(node.skillId);
    const currentLevel = current?.trained_skill_level ?? 0;
    const currentSkillPoints = current?.skillpoints_in_skill ?? 0;
    const queuedToLevel = queueBySkill.get(node.skillId) ?? 0;
    const met = currentLevel >= node.targetLevel;
    const estimatedSeconds = met
      ? 0
      : estimateTrainingSeconds(
          {
            rank: node.rank,
            primaryAttributeId: node.primaryAttributeId,
            secondaryAttributeId: node.secondaryAttributeId,
          },
          snapshot.attributes,
          currentSkillPoints,
          node.targetLevel,
          cloneState,
        );
    mapped.set(node.skillId, {
      skillId: node.skillId,
      name: node.name,
      currentLevel,
      targetLevel: node.targetLevel,
      currentSkillPoints,
      rank: node.rank,
      direct: node.direct,
      met,
      missingLevels: Math.max(0, node.targetLevel - currentLevel),
      estimatedSeconds,
      queuedToLevel,
      alreadyQueued: queuedToLevel >= node.targetLevel,
      prerequisiteSkillIds: [...node.prerequisites.keys()],
      requiredBySkillIds: [...node.requiredBy],
      sources: [...node.sources],
      reasons: [...node.reasons],
    });
  }

  const orderedIds: number[] = [];
  const visiting = new Set<number>();
  const visited = new Set<number>();
  function visit(skillId: number) {
    if (visited.has(skillId) || visiting.has(skillId)) return;
    visiting.add(skillId);
    const node = nodes.get(skillId);
    // A requirement that is already trained is a satisfied boundary. Do not
    // retroactively require its historical prerequisites: EVE permits the
    // already-trained skill to satisfy the item/hull requirement even when
    // prerequisite trees later change. Only recurse while the target itself
    // still needs training.
    if (!mapped.get(skillId)?.met) {
      const prerequisites = [...(node?.prerequisites.keys() ?? [])].sort((a, b) =>
        (nodes.get(a)?.name ?? "").localeCompare(nodes.get(b)?.name ?? ""),
      );
      for (const prerequisiteId of prerequisites) visit(prerequisiteId);
    }
    visiting.delete(skillId);
    visited.add(skillId);
    orderedIds.push(skillId);
  }
  for (const root of [...roots].sort((a, b) =>
    (nodes.get(a)?.name ?? "").localeCompare(nodes.get(b)?.name ?? ""),
  ))
    visit(root);

  const dependencyOrder = orderedIds.map((id) => mapped.get(id)!).filter(Boolean);
  // Only score requirements that are on an active path to an unmet target.
  // Nodes beneath an already-satisfied skill are intentionally excluded.
  const relevantSkills = [...dependencyOrder].sort((a, b) => {
    if (a.direct !== b.direct) return a.direct ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const missingSkills = relevantSkills.filter((skill) => !skill.met);
  const prerequisiteSkills = relevantSkills.filter((skill) => !skill.direct);
  const recommendedQueue = dependencyOrder.filter((skill) => !skill.met);

  const totalWeight = relevantSkills.reduce(
    (sum, skill) => sum + skill.rank * skill.targetLevel,
    0,
  );
  const earnedWeight = relevantSkills.reduce(
    (sum, skill) =>
      sum + skill.rank * Math.min(skill.currentLevel, skill.targetLevel),
    0,
  );
  const readinessPercent = totalWeight
    ? Math.round((earnedWeight / totalWeight) * 100)
    : 100;

  const directSkills = relevantSkills.filter((skill) => skill.direct);
  const metDirectRequirements = directSkills.filter((skill) => skill.met).length;
  const secondsValues = recommendedQueue.map((skill) => skill.estimatedSeconds);
  const totalEstimatedSeconds = secondsValues.some((seconds) => seconds === null)
    ? null
    : secondsValues.reduce<number>((sum, seconds) => sum + (seconds ?? 0), 0);

  const strengths = relevantSkills
    .filter((skill) => skill.met)
    .slice(0, 8)
    .map((skill) => `${skill.name} meets L${skill.targetLevel}`);
  const weaknesses = missingSkills
    .slice(0, 8)
    .map((skill) => `${skill.name}: L${skill.currentLevel} / L${skill.targetLevel}`);
  const reasons = [
    `${metDirectRequirements} of ${directSkills.length} direct target skills are currently met.`,
    `${prerequisiteSkills.filter((skill) => skill.met).length} of ${prerequisiteSkills.length} prerequisite targets are met.`,
    missingSkills.length
      ? `${missingSkills.length} skill target${missingSkills.length === 1 ? " remains" : "s remain"} in the dependency-correct plan.`
      : "Every identified target and prerequisite is satisfied.",
  ];

  return {
    readinessPercent,
    ready: missingSkills.length === 0,
    relevantSkills,
    missingSkills,
    prerequisiteSkills,
    dependencyOrder,
    recommendedQueue,
    totalEstimatedSeconds,
    directRequirements: directSkills.length,
    metDirectRequirements,
    explanation: {
      formula:
        "Readiness = rank-weighted completed target skill levels divided by rank-weighted required levels, including recursive prerequisites.",
      reasons,
      strengths,
      weaknesses,
    },
  };
}

export async function analyzeShipReadiness(
  snapshot: SnapshotLike,
  hullTypeId: number,
  cloneState: CloneState = "omega",
  targetMasteryLevel = 5,
): Promise<ShipReadinessResult> {
  const localTypes = await loadLocalTypeIndex();
  const hull = localTypes.get(hullTypeId);
  if (!hull) throw new Error(`Official EVE type data is missing hull ${hullTypeId}.`);
  const hullAccessPlan = await analyzeTrainingPlan(snapshot, [hullTypeId], [], cloneState);
  // Hull usability is determined by the hull's DIRECT required skills. Recursive
  // prerequisites are useful training guidance, but once the direct skill is trained
  // they must not make an already-flyable hull appear inaccessible.
  const hullAccessSkills = hullAccessPlan.relevantSkills.filter((skill) => skill.direct);
  const missingHullAccessSkills = hullAccessSkills.filter((skill) => !skill.met);
  const hullAccessReady = missingHullAccessSkills.length === 0;
  // Boardability is binary, while training progress is continuous. Keeping both
  // prevents an almost-trained hull from looking identical to an untouched route.
  const hullAccessPercent = hullAccessReady ? 100 : 0;
  const hullTrainingPercent = hullAccessPlan.readinessPercent;
  const trained = new Map(snapshot.skills.skills.map((skill) => [skill.skill_id, skill.trained_skill_level]));
  const tiers = (await loadMasteries()).get(hullTypeId) ?? [];
  let masteryLevel = 0;
  for (let index = 0; index < tiers.length; index += 1) {
    const met = [...tiers[index].entries()].every(([skillId, level]) => (trained.get(skillId) ?? 0) >= level);
    if (met) masteryLevel = index + 1;
  }
  const selectedMasteryLevel = Math.max(1, Math.min(5, Math.round(targetMasteryLevel)));
  const masteryTarget = tiers[selectedMasteryLevel - 1] ?? new Map<number, number>();
  const masteryTargets = await Promise.all([...masteryTarget.entries()].map(async ([skillId, level]) => ({
    skill: localTypes.get(skillId)?.name ?? `Skill ${skillId}`,
    level,
    reason: `Official CCP Mastery ${MASTERY_LABELS[selectedMasteryLevel].replace("Mastery ", "")} requirement for ${hull.name}`,
  })));
  const plan = masteryTargets.length
    ? await analyzeTrainingPlan(snapshot, [hullTypeId], masteryTargets, cloneState)
    : hullAccessPlan;
  const masteryTargetSkillPoints = (rank: number, level: number) =>
    Math.ceil(250 * rank * Math.pow(2, 2.5 * (level - 1)));
  const masteryTargetSp = plan.relevantSkills.reduce(
    (sum, skill) => sum + masteryTargetSkillPoints(skill.rank, skill.targetLevel),
    0,
  );
  const masteryEarnedSp = plan.relevantSkills.reduce((sum, skill) => {
    const target = masteryTargetSkillPoints(skill.rank, skill.targetLevel);
    return sum + Math.min(skill.currentSkillPoints, target);
  }, 0);
  const competencyPercent = masteryTargetSp
    ? Math.round((masteryEarnedSp / masteryTargetSp) * 100)
    : plan.readinessPercent;
  return {
    hullTypeId,
    hull: hull.name,
    characterId: snapshot.characterId,
    character: snapshot.character.name,
    ...plan,
    readinessPercent: competencyPercent,
    hullAccessPercent,
    hullTrainingPercent,
    hullAccessReady,
    hullAccessSkills,
    missingHullAccessSkills,
    hullAccessTrainingSkills: hullAccessPlan.missingSkills,
    targetMasteryLevel: selectedMasteryLevel,
    ready: masteryLevel >= selectedMasteryLevel,
    masteryLevel,
    masteryLabel: MASTERY_LABELS[masteryLevel],
    explanation: {
      ...plan.explanation,
      reasons: [
        `${hullAccessSkills.length - missingHullAccessSkills.length} of ${hullAccessSkills.length} minimum hull-access requirements are currently met.`,
        `${plan.missingSkills.length} of ${plan.relevantSkills.length} Mastery ${MASTERY_LABELS[selectedMasteryLevel].replace("Mastery ", "")} skill targets remain below their official target level.`,
        ...plan.explanation.reasons.slice(1),
      ],
      formula:
        `Practical competency is skill-point-weighted progress across the selected official ${MASTERY_LABELS[selectedMasteryLevel]} skill set. Hull boardability is ${hullAccessReady ? "READY" : "BLOCKED"}; the dependency-correct hull-access training route is ${hullTrainingPercent}% complete. Higher skill levels carry their real exponentially larger training weight.`,
    },
  };
}
