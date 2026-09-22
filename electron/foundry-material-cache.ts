import { promises as fs } from "node:fs";
import path from "node:path";
import { STATIC_DATA_ROOT } from "./data-paths";
import { loadCurrentMarketRevision } from "./shared-market-data";

export const FOUNDRY_MATERIAL_CACHE_SCHEMA = 1;
export const FOUNDRY_MATERIAL_CACHE_KIND = "foundry-material-plan-v1";

export type FoundryMaterialCalculationInput = {
  snapshot: any;
  requiredMaterials: Array<{ typeId: number; name: string; required: number }>;
  componentMaterials?: Array<{ typeId: number; name: string; required: number }>;
  facility: "npc" | "athanor" | "tatara";
  rig: "none" | "t1" | "t2";
  security: "high" | "low" | "null";
  miningReach: "high" | "low" | "null";
  yieldOverride?: any;
};

export type FoundryMaterialCacheEnvelope = {
  schema: number;
  generatedAt: string;
  workerBudget: number;
  result: any;
};

function normalizedYieldOverride(value: any) {
  if (!value?.enabled) return null;
  return {
    enabled: true,
    reprocessingLevel: Number(value.reprocessingLevel ?? 0),
    efficiencyLevel: Number(value.efficiencyLevel ?? 0),
    processingLevel: Number(value.processingLevel ?? 0),
    processingLevels: Object.fromEntries(
      Object.entries(value.processingLevels ?? {})
        .map(([key, level]) => [String(key), Number(level ?? 0)] as const)
        .sort((a, b) => a[0].localeCompare(b[0])),
    ),
    baseYieldPercent: Number(value.baseYieldPercent ?? 50),
    structureBonusPercent: Number(value.structureBonusPercent ?? 0),
    rigBonusPercent: Number(value.rigBonusPercent ?? 0),
    securityMultiplierPercent: Number(value.securityMultiplierPercent ?? 100),
    implantBonusPercent: Number(value.implantBonusPercent ?? 0),
  };
}

export function foundryRefinerySnapshot(snapshot: any) {
  return {
    skills: {
      skills: (snapshot?.skills?.skills ?? [])
        .map((skill: any) => ({
          skill_id: Number(skill?.skill_id ?? 0),
          trained_skill_level: Number(skill?.trained_skill_level ?? 0),
        }))
        .filter((skill: any) => skill.skill_id > 0)
        .sort((a: any, b: any) => a.skill_id - b.skill_id),
    },
    extended: {
      implants: Array.isArray(snapshot?.extended?.implants) ? snapshot.extended.implants : [],
    },
  };
}

async function staticDataRevision() {
  const archive = path.join(STATIC_DATA_ROOT, "eve-static-data-jsonl.zip");
  try {
    const stat = await fs.stat(archive);
    return { size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) };
  } catch {
    return { size: 0, mtimeMs: 0 };
  }
}

export async function foundryMaterialCacheKey(input: FoundryMaterialCalculationInput) {
  const snapshot = foundryRefinerySnapshot(input.snapshot);
  const implants = (snapshot.extended.implants ?? []).map((implant: any) =>
    typeof implant === "number"
      ? { typeId: Number(implant) }
      : {
          typeId: Number(implant?.type_id ?? implant?.typeId ?? 0),
          name: String(implant?.name ?? implant?.typeName ?? implant?.type_name ?? ""),
        },
  );
  return {
    schema: FOUNDRY_MATERIAL_CACHE_SCHEMA,
    staticData: await staticDataRevision(),
    marketRevision: (await loadCurrentMarketRevision().catch(() => null))?.id ?? "none",
    requiredMaterials: (input.requiredMaterials ?? [])
      .map((row) => ({
        typeId: Number(row.typeId),
        name: String(row.name ?? ""),
        required: Math.max(0, Math.ceil(Number(row.required ?? 0))),
      }))
      .filter((row) => row.typeId > 0 && row.required > 0)
      .sort((a, b) => a.typeId - b.typeId),
    componentMaterials: (input.componentMaterials ?? [])
      .map((row) => ({
        typeId: Number(row.typeId),
        name: String(row.name ?? ""),
        required: Math.max(0, Math.ceil(Number(row.required ?? 0))),
      }))
      .filter((row) => row.typeId > 0 && row.required > 0)
      .sort((a, b) => a.typeId - b.typeId),
    refinery: {
      facility: input.facility,
      rig: input.rig,
      security: input.security,
      miningReach: input.miningReach,
      yieldOverride: normalizedYieldOverride(input.yieldOverride),
    },
    skills: snapshot.skills.skills,
    implants,
  };
}
