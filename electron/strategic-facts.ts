import { mentionsName } from "./strategic-router";

type HullEvidence = {
  name: string;
  group?: { name?: string };
  characterRequirementCheck?: { missing: Array<{ name?: string; skillId: number; level: number }> } | null;
};

// Only answer a closed set of factual questions. Recommendations and event eligibility
// still need the normal reasoning/research path, even when they mention these hulls.
export function answerShipFacts(message: string, characterName: string | undefined, hulls: HullEvidence[]) {
  let query = message.trim().toLowerCase().replace(/\s+/g, " ")
    .replace(/[?.!]+\s*use the supplied sage evidence[.!]?$/i, "")
    .replace(/[?.!]+$/, "");
  const namedHulls = hulls.filter((hull) => mentionsName(message, hull.name));
  if (!namedHulls.length || namedHulls.some((hull) => !hull.group?.name)) return undefined;
  for (const hull of [...namedHulls].sort((a, b) => b.name.length - a.name.length)) {
    query = query.replaceAll(hull.name.toLowerCase(), "HULL");
  }
  if (characterName) query = query.replaceAll(characterName.toLowerCase(), "CHARACTER");
  const hullList = "HULL(?:(?:, ?|,? and | or )HULL)*";
  const classes = new RegExp(`^what (?:classes|types|kinds)(?: of ships)? are ${hullList}(?:,? and can CHARACTER (?:fly|pilot) (?:them|those))?$`);
  const capability = new RegExp(`^can CHARACTER (?:fly|pilot) ${hullList}$`);
  if (!classes.test(query) && !capability.test(query)) return undefined;
  const asksCapability = query.includes("CHARACTER");
  const lines = namedHulls.map((hull) => {
    let text = `**${hull.name}** — ${hull.group!.name}.`;
    if (!asksCapability) return text;
    const check = hull.characterRequirementCheck;
    if (!check) return `${text} ${characterName}'s synced skills are unavailable, so I can't verify the hull requirements.`;
    if (check.missing.length) {
      text += ` ${characterName} does not meet the hull requirements in Sage's synced skills. Missing: ${check.missing.map((skill) => `${skill.name || `Skill ${skill.skillId}`} ${skill.level}`).join(", ")}.`;
    } else {
      text += ` ${characterName} meets the hull's direct skill requirements in Sage's synced skills.`;
    }
    return text;
  });
  return lines.join("\n\n") + (asksCapability ? "\n\nThis checks hull skills. Module skills and event entry restrictions are separate; changes since the last EVE sync are not included." : "");
}
