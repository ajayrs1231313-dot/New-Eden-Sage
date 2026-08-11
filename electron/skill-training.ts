export type CharacterAttributes = {
  charisma: number;
  intelligence: number;
  memory: number;
  perception: number;
  willpower: number;
};

export type SkillDogmaMetadata = {
  rank: number;
  primaryAttributeId?: number;
  secondaryAttributeId?: number;
};

export type CloneState = "alpha" | "omega";

const ATTRIBUTE_NAMES: Record<
  number,
  keyof CharacterAttributes
> = {
  164: "charisma",
  165: "intelligence",
  166: "memory",
  167: "perception",
  168: "willpower",
};

export const BASE_SKILL_POINTS = [0, 250, 1415, 8000, 45255, 256000];

export function skillPointsForLevel(rank: number, level: number) {
  return BASE_SKILL_POINTS[Math.max(0, Math.min(5, level))] * rank;
}

export function estimateTrainingSeconds(
  skill: SkillDogmaMetadata,
  attributes: CharacterAttributes,
  currentSkillPoints: number,
  targetLevel: number,
  cloneState: CloneState = "omega",
) {
  const primaryName = skill.primaryAttributeId
    ? ATTRIBUTE_NAMES[skill.primaryAttributeId]
    : undefined;
  const secondaryName = skill.secondaryAttributeId
    ? ATTRIBUTE_NAMES[skill.secondaryAttributeId]
    : undefined;
  const primary = primaryName ? attributes[primaryName] : undefined;
  const secondary = secondaryName ? attributes[secondaryName] : undefined;
  if (!primary || !secondary) return null;

  const remainingSp = Math.max(
    0,
    skillPointsForLevel(skill.rank, targetLevel) - currentSkillPoints,
  );
  const omegaSpPerMinute = primary + secondary / 2;
  const speedMultiplier = cloneState === "alpha" ? 0.5 : 1;
  return Math.ceil((remainingSp / (omegaSpPerMinute * speedMultiplier)) * 60);
}

export function trainingTimesToLevels(
  skill: SkillDogmaMetadata & {
    trained_skill_level: number;
    skillpoints_in_skill: number;
  },
  attributes: CharacterAttributes,
  queue: Array<{ finished_level: number; finish_date?: string }>,
) {
  return [1, 2, 3, 4, 5]
    .filter((level) => level > skill.trained_skill_level)
    .map((level) => ({
      level,
      seconds: estimateTrainingSeconds(
        skill,
        attributes,
        skill.skillpoints_in_skill,
        level,
        "omega",
      ),
      queuedFinishDate: queue.find((item) => item.finished_level === level)
        ?.finish_date,
    }));
}
