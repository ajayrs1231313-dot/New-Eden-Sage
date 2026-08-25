import AdmZip from "adm-zip";
import path from "node:path";
import { STATIC_DATA_ROOT } from "./data-paths";

export type LocalSkillDogmaMetadata = {
  rank: number;
  primaryAttributeId?: number;
  secondaryAttributeId?: number;
};

const SDE_ARCHIVE = path.join(STATIC_DATA_ROOT, "eve-static-data-jsonl.zip");
const RANK_ATTRIBUTE = 275;
const PRIMARY_ATTRIBUTE = 180;
const SECONDARY_ATTRIBUTE = 181;
let metadataPromise: Promise<Map<number, LocalSkillDogmaMetadata>> | undefined;

async function loadSkillMetadata() {
  return (metadataPromise ??= Promise.resolve().then(() => {
    const zip = new AdmZip(SDE_ARCHIVE);
    const entry = zip.getEntry("typeDogma.jsonl");
    if (!entry) throw new Error("Official EVE skill DOGMA data is unavailable.");
    const result = new Map<number, LocalSkillDogmaMetadata>();
    for (const line of entry.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const row = JSON.parse(line) as {
        _key: number;
        dogmaAttributes?: Array<{ attributeID: number; value: number }>;
      };
      const attributes = new Map(
        (row.dogmaAttributes ?? []).map((attribute) => [attribute.attributeID, attribute.value]),
      );
      if (!attributes.has(RANK_ATTRIBUTE)) continue;
      result.set(Number(row._key), {
        rank: Math.max(1, Number(attributes.get(RANK_ATTRIBUTE) ?? 1)),
        primaryAttributeId: attributes.has(PRIMARY_ATTRIBUTE)
          ? Number(attributes.get(PRIMARY_ATTRIBUTE))
          : undefined,
        secondaryAttributeId: attributes.has(SECONDARY_ATTRIBUTE)
          ? Number(attributes.get(SECONDARY_ATTRIBUTE))
          : undefined,
      });
    }
    return result;
  }));
}

export async function getLocalSkillDogmaMetadata(typeIds: number[]) {
  const index = await loadSkillMetadata();
  return new Map(
    [...new Set(typeIds)]
      .map((typeId) => [typeId, index.get(typeId)] as const)
      .filter((entry): entry is readonly [number, LocalSkillDogmaMetadata] => Boolean(entry[1])),
  );
}
