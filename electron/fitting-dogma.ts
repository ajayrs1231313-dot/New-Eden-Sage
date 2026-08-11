import AdmZip from "adm-zip";
import path from "node:path";
import { STATIC_DATA_ROOT } from "./data-paths";
import { ensureStaticDataArchive } from "./type-volumes";

const ARCHIVE = path.join(STATIC_DATA_ROOT, "eve-static-data-jsonl.zip");
const REQUIREMENTS = [
  [182, 277],
  [183, 278],
  [184, 279],
  [1285, 1286],
  [1289, 1287],
  [1290, 1288],
] as const;
const RACK_EFFECT: Record<string, number> = {
  low: 11,
  high: 12,
  mid: 13,
  rig: 2663,
  subsystem: 3772,
};

type Dogma = {
  attributes: Map<number, number>;
  effects: Set<number>;
};
type Modifier = {
  domain?: string;
  func?: string;
  modifiedAttributeID?: number;
  modifyingAttributeID?: number;
  operation?: number;
  skillTypeID?: number;
  groupID?: number;
};
type EffectDefinition = {
  category: number;
  modifiers: Modifier[];
  guid?: string;
  name?: string;
  fittingUsageChanceAttributeID?: number;
};
type DamageProfile = { em: number; thermal: number; kinetic: number; explosive: number };

type TargetProfile = { rangeM: number; signatureRadiusM: number; transverseVelocityMps: number; velocityMps: number };

type FittingItem = {
  typeId: number;
  quantity?: number;
  rack?: string;
  chargeTypeId?: number;
  chargeQuantity?: number;
  activeQuantity?: number;
  attributeOverrides?: Record<string, number>;
  state?: "offline" | "online" | "active" | "overheated";
};
type RequiredAttributeModifier = {
  skillTypeId: number;
  attributeId: number;
  value: number;
  operation: number;
  stacking: boolean;
};
type DBuffDefinition = {
  aggregateMode: "Minimum" | "Maximum";
  developerDescription?: string;
  operationName: string;
  itemModifiers: Array<{ dogmaAttributeID: number }>;
  locationRequiredSkillModifiers: Array<{ dogmaAttributeID: number; skillID: number }>;
  locationGroupModifiers: Array<{ dogmaAttributeID: number; groupID: number }>;
};
type GroupAttributeModifier = { groupId: number; attributeId: number; value: number; operation: number };

type FittingDogmaIndex = {
  dogma: Map<number, Dogma>;
  names: Map<number, string>;
  groups: Map<number, number>;
  groupCategories: Map<number, number>;
  categoryNames: Map<number, string>;
  volumes: Map<number, number>;
  masses: Map<number, number>;
  capacities: Map<number, number>;
  modifiers: Map<number, EffectDefinition>;
  penalized: Set<number>;
  dbuffs: Map<number, DBuffDefinition>;
};

let cache: Promise<FittingDogmaIndex> | undefined;
const attributeDefaults = new Map<number, number>();

function index() {
  return (cache ??= Promise.resolve().then(async () => {
    await ensureStaticDataArchive();
    const zip = new AdmZip(ARCHIVE);
    const dogma = new Map<number, Dogma>();
    const names = new Map<number, string>();
    const groups = new Map<number, number>();
    const groupCategories = new Map<number, number>();
    const categoryNames = new Map<number, string>();
    const volumes = new Map<number, number>();
    const masses = new Map<number, number>();
    const capacities = new Map<number, number>();
    const modifiers = new Map<number, EffectDefinition>();
    const penalized = new Set<number>();
    const dbuffs = new Map<number, DBuffDefinition>();

    const dogmaEntry = zip.getEntry("typeDogma.jsonl");
    const typesEntry = zip.getEntry("types.jsonl");
    if (!dogmaEntry || !typesEntry) {
      throw new Error("Official EVE static data is missing dogma fitting data.");
    }

    const effectsEntry = zip.getEntry("dogmaEffects.jsonl");
    const attributesEntry = zip.getEntry("dogmaAttributes.jsonl");
    const groupsEntry = zip.getEntry("groups.jsonl");
    const categoriesEntry = zip.getEntry("categories.jsonl");
    const dbuffsEntry = zip.getEntry("dbuffCollections.jsonl");
    if (dbuffsEntry) {
      for (const line of dbuffsEntry.getData().toString("utf8").split(/\r?\n/)) {
        if (!line) continue;
        const row = JSON.parse(line);
        dbuffs.set(row._key, {
          aggregateMode: row.aggregateMode === "Minimum" ? "Minimum" : "Maximum",
          developerDescription: row.developerDescription,
          operationName: row.operationName ?? "PostPercent",
          itemModifiers: row.itemModifiers ?? [],
          locationRequiredSkillModifiers: row.locationRequiredSkillModifiers ?? [],
          locationGroupModifiers: row.locationGroupModifiers ?? [],
        });
      }
    }
    if (groupsEntry) {
      for (const line of groupsEntry.getData().toString("utf8").split(/\r?\n/)) {
        if (!line) continue;
        const row = JSON.parse(line);
        groupCategories.set(row._key, row.categoryID ?? 0);
      }
    }
    if (categoriesEntry) {
      for (const line of categoriesEntry.getData().toString("utf8").split(/\r?\n/)) {
        if (!line) continue;
        const row = JSON.parse(line);
        if (row.name?.en) categoryNames.set(row._key, row.name.en);
      }
    }
    if (effectsEntry) {
      for (const line of effectsEntry.getData().toString("utf8").split(/\r?\n/)) {
        if (!line) continue;
        const row = JSON.parse(line);
        if (row.modifierInfo?.length || row.effectCategoryID === 2) {
          modifiers.set(row._key, {
            category: row.effectCategoryID ?? 0,
            modifiers: row.modifierInfo ?? [],
            guid: row.guid,
            name: row.name,
            fittingUsageChanceAttributeID: row.fittingUsageChanceAttributeID,
          });
        }
      }
    }
    if (attributesEntry) {
      for (const line of attributesEntry.getData().toString("utf8").split(/\r?\n/)) {
        if (!line) continue;
        const row = JSON.parse(line);
        attributeDefaults.set(row._key, row.defaultValue ?? 0);
        if (row.stackable === false) penalized.add(row._key);
      }
    }
    for (const line of dogmaEntry.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const row = JSON.parse(line);
      dogma.set(row._key, {
        attributes: new Map(
          (row.dogmaAttributes ?? []).map((item: any) => [item.attributeID, item.value]),
        ),
        effects: new Set((row.dogmaEffects ?? []).map((item: any) => item.effectID)),
      });
    }
    for (const line of typesEntry.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const row = JSON.parse(line);
      if (row.name?.en) names.set(row._key, row.name.en);
      groups.set(row._key, row.groupID ?? 0);
      volumes.set(row._key, row.volume ?? 0);
      masses.set(row._key, row.mass ?? 0);
      capacities.set(row._key, row.capacity ?? 0);
    }
    return { dogma, names, groups, groupCategories, categoryNames, volumes, masses, capacities, modifiers, penalized, dbuffs };
  }));
}

const attr = (dogma: Dogma | undefined, attributeId: number) =>
  dogma?.attributes.get(attributeId) ?? attributeDefaults.get(attributeId) ?? 0;

const DOGMA_OPERATION_ORDER = [-1, 0, 2, 3, 4, 5, 6, 7, 9] as const;

function applyVerifiedOperation(current: number, value: number, operation: number) {
  if (operation === -1 || operation === 7) return value;
  if (operation === 0 || operation === 4) return current * value;
  if (operation === 2) return current + value;
  if (operation === 3) return current - value;
  if (operation === 5) return value === 0 ? current : current / value;
  if (operation === 6) return current * (1 + value / 100);
  return current;
}

function operationStrength(value: number, operation: number) {
  if (operation === 0 || operation === 4 || operation === 5) return Math.abs(value - 1);
  if (operation === 2 || operation === 3 || operation === 6) return Math.abs(value);
  return Number.POSITIVE_INFINITY;
}

function applyOperationWithPenalty(current: number, value: number, operation: number, penalty: number) {
  if (penalty >= 0.999999 || operation === -1 || operation === 7) return applyVerifiedOperation(current, value, operation);
  if (operation === 0 || operation === 4) return current * (1 + (value - 1) * penalty);
  if (operation === 5) { const divisor = 1 + (value - 1) * penalty; return divisor === 0 ? current : current / divisor; }
  if (operation === 2) return current + value * penalty;
  if (operation === 3) return current - value * penalty;
  if (operation === 6) return current * (1 + (value / 100) * penalty);
  return current;
}

function applyOrderedChanges(current: number, changes: Array<{ value: number; operation: number }>, stackingPenalized: boolean, penalties: number[]) {
  for (const operation of DOGMA_OPERATION_ORDER) {
    if (operation === 9) continue;
    const phase = changes.filter((change) => change.operation === operation).sort((left, right) => operationStrength(right.value, operation) - operationStrength(left.value, operation));
    phase.forEach((change, index) => { current = applyOperationWithPenalty(current, change.value, operation, stackingPenalized ? (penalties[index] ?? 0) : 1); });
  }
  return current;
}

function requiredSkillIds(dogma: Dogma | undefined) {
  return REQUIREMENTS.map(([skillAttribute]) => attr(dogma, skillAttribute)).filter(Boolean);
}

function evaluateTrainedSkillSource(
  sourceRaw: Dogma,
  level: number,
  modifiers: Map<number, EffectDefinition>,
) {
  const source: Dogma = {
    attributes: new Map(sourceRaw.attributes),
    effects: sourceRaw.effects,
  };

  // Attribute 280 is the runtime skill level. CCP skill effects use it to turn
  // per-level attributes (e.g. -5% CPU) into their trained-level value.
  source.attributes.set(280, level);

  for (const effectId of source.effects) {
    const effect = modifiers.get(effectId);
    if (!effect) continue;
    for (const modifier of effect.modifiers) {
      if (
        modifier.domain !== "itemID" ||
        modifier.func !== "ItemModifier" ||
        modifier.modifiedAttributeID == null ||
        modifier.modifyingAttributeID == null ||
        modifier.modifiedAttributeID === 280
      ) {
        continue;
      }
      const current = attr(source, modifier.modifiedAttributeID);
      const value = attr(source, modifier.modifyingAttributeID);
      source.attributes.set(
        modifier.modifiedAttributeID,
        applyVerifiedOperation(current, value, modifier.operation ?? 0),
      );
    }
  }
  return source;
}

export async function resolveFittingTypeNamesLocal(requestedNames: string[]) {
  const { names, groups, groupCategories, categoryNames } = await index();
  const byName = new Map<string, { id: number; name: string; groupId: number; categoryId: number; categoryName: string }>();
  for (const [id, name] of names) {
    const groupId = groups.get(id) ?? 0;
    const categoryId = groupCategories.get(groupId) ?? 0;
    byName.set(name.toLowerCase(), { id, name, groupId, categoryId, categoryName: categoryNames.get(categoryId) ?? "Unknown" });
  }
  const unique = [...new Set(requestedNames.map((name) => name.trim()).filter(Boolean))];
  return unique.flatMap((requested) => {
    const match = byName.get(requested.toLowerCase());
    return match ? [match] : [];
  });
}
export async function analyzeFittingDogma(input: {
  hullTypeId: number;
  items: FittingItem[];
  snapshot: any;
  targetProfile?: TargetProfile;
  damageProfile?: DamageProfile;
  boosterTypeIds?: number[];
  boosterSideEffectIds?: number[];
  projectedItems?: Array<FittingItem & { effectiveness?: number }>;
  commandBurstItems?: Array<FittingItem & { effectiveness?: number }>;
  environmentTypeIds?: number[];
}) {
  const { dogma, names, groups, volumes, masses, capacities, modifiers, penalized, dbuffs } = await index();
  const targetProfile = input.targetProfile ?? { rangeM: 10_000, signatureRadiusM: 125, transverseVelocityMps: 0, velocityMps: 0 };
  const rawDamageProfile = input.damageProfile ?? { em: 0.25, thermal: 0.25, kinetic: 0.25, explosive: 0.25 };
  const damageProfileTotal = Math.max(1e-12, rawDamageProfile.em + rawDamageProfile.thermal + rawDamageProfile.kinetic + rawDamageProfile.explosive);
  const damageProfile = [rawDamageProfile.em, rawDamageProfile.thermal, rawDamageProfile.kinetic, rawDamageProfile.explosive].map((value) => Math.max(0, value) / damageProfileTotal);
  const hull = dogma.get(input.hullTypeId);
  if (!hull) throw new Error("Hull not found in local CCP dogma data.");

  const trained = new Map<number, number>(
    (input.snapshot.skills?.skills ?? []).map((skill: any) => [
      skill.skill_id,
      skill.trained_skill_level,
    ]),
  );

  const skillSources = new Map<number, Dogma>();
  // Hull-required skills must also be evaluated at level 0 when untrained so
  // per-level hull bonus attributes become zero instead of leaking one free level.
  const skillIdsToEvaluate = new Set<number>([...trained.keys(), ...requiredSkillIds(hull)]);
  for (const skillId of skillIdsToEvaluate) {
    const level = trained.get(skillId) ?? 0;
    const sourceRaw = dogma.get(skillId);
    if (!sourceRaw) continue;
    skillSources.set(skillId, evaluateTrainedSkillSource(sourceRaw, level, modifiers));
  }

  const snapshotImplantTypeIds = Array.isArray(input.snapshot.extended?.implants)
    ? input.snapshot.extended.implants.flatMap((implant: any) => {
        if (typeof implant === "number") return implant > 0 ? [implant] : [];
        const typeId = Number(implant?.typeId ?? implant?.type_id ?? 0);
        return Number.isInteger(typeId) && typeId > 0 ? [typeId] : [];
      })
    : [];
  const boosterTypeIds = (input.boosterTypeIds ?? []).filter((typeId) => Number.isInteger(typeId) && typeId > 0);
  const enhancementTypeIds = [...new Set([...snapshotImplantTypeIds, ...boosterTypeIds])];
  const enhancementSources = enhancementTypeIds.flatMap((typeId) => {
    const source = dogma.get(typeId);
    return source ? [{ typeId, source, kind: snapshotImplantTypeIds.includes(typeId) ? "implant" as const : "booster" as const }] : [];
  });
  const selectedBoosterSideEffects = new Set((input.boosterSideEffectIds ?? []).filter((effectId) => Number.isInteger(effectId) && effectId > 0));
  const enhancementEffectAllowed = (enhancement: typeof enhancementSources[number], effectId: number, effect: EffectDefinition) => enhancement.kind !== "booster" || effect.fittingUsageChanceAttributeID == null || selectedBoosterSideEffects.has(effectId);

  const moduleDogmaFor = (item: FittingItem): Dogma | undefined => {
    const raw = dogma.get(item.typeId);
    if (!raw) return raw;
    const hasOverrides = Boolean(item.attributeOverrides && Object.keys(item.attributeOverrides).length);
    const base: Dogma = hasOverrides ? { attributes: new Map(raw.attributes), effects: raw.effects } : raw;
    if (hasOverrides) {
      for (const [rawAttributeId, rawValue] of Object.entries(item.attributeOverrides!)) {
        const attributeId = Number(rawAttributeId);
        const value = Number(rawValue);
        if (Number.isInteger(attributeId) && attributeId > 0 && Number.isFinite(value)) base.attributes.set(attributeId, value);
      }
    }
    let loaded: Dogma = base;
    if (item.chargeTypeId) {
      const charge = dogma.get(item.chargeTypeId);
      if (charge) {
        loaded = { attributes: new Map(base.attributes), effects: base.effects };
        for (const effectId of charge.effects) {
          const effect = modifiers.get(effectId);
          if (!effect) continue;
          for (const modifier of effect.modifiers) {
            if (modifier.domain !== "otherID" || modifier.func !== "ItemModifier" || modifier.modifiedAttributeID == null || modifier.modifyingAttributeID == null) continue;
            const current = attr(loaded, modifier.modifiedAttributeID);
            const value = attr(charge, modifier.modifyingAttributeID);
            loaded.attributes.set(modifier.modifiedAttributeID, applyVerifiedOperation(current, value, modifier.operation ?? 0));
          }
        }
      }
    }
    if (item.state === "overheated") {
      const heated: Dogma = { attributes: new Map(loaded.attributes), effects: loaded.effects };
      for (const effectId of loaded.effects) {
        const effect = modifiers.get(effectId);
        if (!effect || effect.category !== 5) continue;
        for (const modifier of effect.modifiers) {
          if (modifier.domain !== "itemID" || modifier.func !== "ItemModifier" || modifier.modifiedAttributeID == null || modifier.modifyingAttributeID == null) continue;
          const current = attr(heated, modifier.modifiedAttributeID);
          heated.attributes.set(modifier.modifiedAttributeID, applyVerifiedOperation(current, attr(heated, modifier.modifyingAttributeID), modifier.operation ?? 0));
        }
      }
      loaded = heated;
    }
    return loaded;
  };

  const projectedSourceDogmaFor = (item: FittingItem): Dogma | undefined => moduleDogmaFor(item);
  const ids = [...new Set([input.hullTypeId, ...input.items.map((item) => item.typeId)])];
  const requirements = ids.map((typeId) => {
    const itemDogma = dogma.get(typeId);
    const skills = REQUIREMENTS.flatMap(([skillAttribute, levelAttribute]) => {
      const skillId = attr(itemDogma, skillAttribute);
      if (!skillId) return [];
      const requiredLevel = attr(itemDogma, levelAttribute) || 1;
      const trainedLevel = trained.get(skillId) ?? 0;
      return [
        {
          skillId,
          skill: names.get(skillId) ?? `Skill ${skillId}`,
          requiredLevel,
          trainedLevel,
          met: trainedLevel >= requiredLevel,
        },
      ];
    });
    return {
      typeId,
      item: names.get(typeId) ?? `Type ${typeId}`,
      usable: skills.every((skill) => skill.met),
      skills,
    };
  });

  const fitted = input.items.filter((item) => RACK_EFFECT[item.rack ?? ""]);
  const online = fitted.filter((item) => item.state !== "offline");
  const used = { cpu: 0, powergrid: 0, calibration: 0 };
  const shipAttributes = new Map(hull.attributes);

  // Skills can modify the ship directly. This covers generic support skills such
  // as Power Grid Management and also scales hull bonus attributes. Example:
  // Gallente Cruiser V multiplies an Ishtar's 7.5% GC bonus attribute by 5.
  for (const source of skillSources.values()) {
    for (const effectId of source.effects) {
      const effect = modifiers.get(effectId);
      if (!effect) continue;
      for (const modifier of effect.modifiers) {
        if (
          modifier.domain !== "shipID" ||
          modifier.func !== "ItemModifier" ||
          modifier.modifiedAttributeID == null ||
          modifier.modifyingAttributeID == null
        ) {
          continue;
        }
        const current =
          shipAttributes.get(modifier.modifiedAttributeID) ??
          attributeDefaults.get(modifier.modifiedAttributeID) ??
          0;
        shipAttributes.set(
          modifier.modifiedAttributeID,
          applyVerifiedOperation(
            current,
            attr(source, modifier.modifyingAttributeID),
            modifier.operation ?? 0,
          ),
        );
      }
    }
  }

  for (const enhancement of enhancementSources) {
    for (const effectId of enhancement.source.effects) {
      const effect = modifiers.get(effectId);
      if (!effect || effect.category !== 0 || !enhancementEffectAllowed(enhancement, effectId, effect)) continue;
      for (const modifier of effect.modifiers) {
        if (modifier.domain !== "shipID" || modifier.func !== "ItemModifier" || modifier.modifiedAttributeID == null || modifier.modifyingAttributeID == null) continue;
        const current = shipAttributes.get(modifier.modifiedAttributeID) ?? attributeDefaults.get(modifier.modifiedAttributeID) ?? 0;
        shipAttributes.set(modifier.modifiedAttributeID, applyVerifiedOperation(current, attr(enhancement.source, modifier.modifyingAttributeID), modifier.operation ?? 0));
      }
    }
  }

  const pending = new Map<number, Array<{ value: number; operation: number }>>();
  const projectedItemChanges = new Map<number, Array<{ value: number; operation: number }>>();
  const projectedSources: Array<{ typeId: number; name: string; effectiveness: number; effects: string[] }> = [];
  for (const item of online) {
    const module = moduleDogmaFor(item);
    if (!module) continue;
    for (const effectId of module.effects) {
      const effect = modifiers.get(effectId);
      if (
        !effect ||
        effect.category === 2 ||
        effect.category === 3 ||
        effect.category > 5 ||
        ((effect.category === 1 || effect.category === 5) &&
          item.state !== "active" &&
          item.state !== "overheated") ||
        (effect.category === 5 && item.state !== "overheated")
      ) {
        continue;
      }
      for (const modifier of effect.modifiers) {
        if (
          modifier.domain !== "shipID" ||
          modifier.func !== "ItemModifier" ||
          modifier.modifiedAttributeID == null ||
          modifier.modifyingAttributeID == null
        ) {
          continue;
        }
        const list = pending.get(modifier.modifiedAttributeID) ?? [];
        for (let count = 0; count < (item.quantity ?? 1); count += 1) {
          list.push({
            value: attr(module, modifier.modifyingAttributeID),
            operation: modifier.operation ?? 0,
          });
        }
        pending.set(modifier.modifiedAttributeID, list);
      }
    }
  }

  for (const projected of input.projectedItems ?? []) {
    if (projected.state === "offline" || projected.state === "online") continue;
    const source = projectedSourceDogmaFor(projected);
    if (!source) continue;
    const effectiveness = Math.max(0, Math.min(1, Number(projected.effectiveness ?? 1)));
    const effectNames: string[] = [];
    const addShip = (attributeId: number, value: number) => {
      const list = pending.get(attributeId) ?? [];
      list.push({ value: value * effectiveness, operation: 6 });
      pending.set(attributeId, list);
    };
    const addItem = (attributeId: number, value: number) => {
      const list = projectedItemChanges.get(attributeId) ?? [];
      list.push({ value: value * effectiveness, operation: 6 });
      projectedItemChanges.set(attributeId, list);
    };
    for (const effectId of source.effects) {
      const effect = modifiers.get(effectId);
      if (!effect || effect.category !== 2) continue;
      const guid = effect.guid ?? "";
      if (guid.endsWith("ModifyTargetSpeed")) { addShip(37, attr(source, 20)); effectNames.push("velocity"); }
      else if (guid.endsWith("TargetPaint")) { addShip(552, attr(source, 554)); effectNames.push("signature radius"); }
      else if (guid.endsWith("ElectronicAttributeModifyTarget")) {
        addShip(76, attr(source, 309)); addShip(564, attr(source, 566));
        [[208,1027],[209,1028],[210,1029],[211,1030]].forEach(([target, strength]) => { const value = attr(source, strength); if (value) addShip(target, value); });
        effectNames.push("targeting");
      } else if (guid.endsWith("SensorDampening")) {
        addShip(76, attr(source, 309)); addShip(564, attr(source, 566)); effectNames.push("sensor dampening");
      } else if (guid.endsWith("TurretWeaponRangeTrackingSpeedMultiplyTarget") || guid.endsWith("TrackingDisruption")) {
        addItem(54, attr(source, 351)); addItem(158, attr(source, 349)); addItem(160, attr(source, 767)); effectNames.push(guid.endsWith("TrackingDisruption") ? "tracking disruption" : "remote tracking");
      }
    }
    if (effectNames.length) projectedSources.push({ typeId: projected.typeId, name: names.get(projected.typeId) ?? `Type ${projected.typeId}`, effectiveness, effects: effectNames });
  }

  const commandRequiredModifiers: RequiredAttributeModifier[] = [];
  const commandGroupModifiers: GroupAttributeModifier[] = [];
  const commandBurstSources: Array<{ typeId: number; name: string; chargeTypeId?: number; charge?: string; buffs: Array<{ buffId: number; description: string; value: number }> }> = [];
  const commandCandidates = new Map<number, Array<{ value: number; source: FittingItem; definition: DBuffDefinition }>>();
  const operationFromName = (name: string) => name === "PreAssignment" ? -1 : name === "PreMul" ? 0 : name === "Add" ? 2 : name === "Subtract" ? 3 : name === "PostMul" ? 4 : name === "PostDiv" ? 5 : name === "PostAssignment" ? 7 : 6;
  for (const burst of input.commandBurstItems ?? []) {
    if (burst.state === "offline" || burst.state === "online") continue;
    const source = moduleDogmaFor(burst);
    if (!source) continue;
    const effectiveness = Math.max(0, Math.min(1, Number(burst.effectiveness ?? 1)));
    const buffs: Array<{ buffId: number; description: string; value: number }> = [];
    for (const [idAttr, valueAttr] of [[2468,2469],[2470,2471],[2472,2473],[2536,2537]] as const) {
      const buffId = Math.trunc(attr(source, idAttr));
      if (!buffId) continue;
      const definition = dbuffs.get(buffId);
      if (!definition) continue;
      const value = attr(source, valueAttr) * effectiveness;
      const list = commandCandidates.get(buffId) ?? [];
      list.push({ value, source: burst, definition });
      commandCandidates.set(buffId, list);
      buffs.push({ buffId, description: definition.developerDescription ?? `Buff ${buffId}`, value });
    }
    if (buffs.length) commandBurstSources.push({ typeId: burst.typeId, name: names.get(burst.typeId) ?? `Type ${burst.typeId}`, chargeTypeId: burst.chargeTypeId, charge: burst.chargeTypeId ? names.get(burst.chargeTypeId) : undefined, buffs });
  }
  for (const [buffId, candidates] of commandCandidates) {
    const definition = candidates[0].definition;
    const selected = candidates.reduce((best, candidate) => definition.aggregateMode === "Minimum" ? (candidate.value < best.value ? candidate : best) : (candidate.value > best.value ? candidate : best));
    const operation = operationFromName(definition.operationName);
    for (const modifier of definition.itemModifiers) {
      const list = pending.get(modifier.dogmaAttributeID) ?? [];
      list.push({ value: selected.value, operation });
      pending.set(modifier.dogmaAttributeID, list);
    }
    for (const modifier of definition.locationRequiredSkillModifiers) commandRequiredModifiers.push({ skillTypeId: modifier.skillID, attributeId: modifier.dogmaAttributeID, value: selected.value, operation, stacking: false });
    for (const modifier of definition.locationGroupModifiers) commandGroupModifiers.push({ groupId: modifier.groupID, attributeId: modifier.dogmaAttributeID, value: selected.value, operation });
  }

  const environmentOwnerModifiers: RequiredAttributeModifier[] = [];
  const environmentSources = [...new Set((input.environmentTypeIds ?? []).filter((typeId) => Number.isInteger(typeId) && typeId > 0))].flatMap((typeId) => {
    const source = dogma.get(typeId);
    return source ? [{ typeId, name: names.get(typeId) ?? `Type ${typeId}`, source }] : [];
  });
  for (const environment of environmentSources) {
    for (const effectId of environment.source.effects) {
      const effect = modifiers.get(effectId);
      if (!effect || effect.category !== 7) continue;
      for (const modifier of effect.modifiers) {
        if (modifier.modifiedAttributeID == null || modifier.modifyingAttributeID == null) continue;
        const value = attr(environment.source, modifier.modifyingAttributeID);
        const operation = modifier.operation ?? 0;
        if (modifier.func === "ItemModifier" && modifier.domain === "shipID") {
          const list = pending.get(modifier.modifiedAttributeID) ?? [];
          list.push({ value, operation });
          pending.set(modifier.modifiedAttributeID, list);
        } else if (modifier.func === "LocationRequiredSkillModifier" && modifier.domain === "shipID" && modifier.skillTypeID) {
          commandRequiredModifiers.push({ skillTypeId: modifier.skillTypeID, attributeId: modifier.modifiedAttributeID, value, operation, stacking: false });
        } else if (modifier.func === "OwnerRequiredSkillModifier" && modifier.domain === "charID" && modifier.skillTypeID) {
          environmentOwnerModifiers.push({ skillTypeId: modifier.skillTypeID, attributeId: modifier.modifiedAttributeID, value, operation, stacking: false });
        } else if (modifier.func === "LocationModifier" && modifier.domain === "shipID") {
          const list = projectedItemChanges.get(modifier.modifiedAttributeID) ?? [];
          list.push({ value, operation });
          projectedItemChanges.set(modifier.modifiedAttributeID, list);
        } else if (modifier.func === "LocationGroupModifier" && modifier.domain === "shipID" && modifier.groupID) {
          commandGroupModifiers.push({ groupId: modifier.groupID, attributeId: modifier.modifiedAttributeID, value, operation });
        }
      }
    }
  }

  const penalties = [
    1,
    0.86911998,
    0.57058314,
    0.28295515,
    0.10599265,
    0.029994,
    0.006403,
    0.001,
  ];
  for (const [attributeId, changes] of pending) {
    const current = shipAttributes.get(attributeId) ?? attributeDefaults.get(attributeId) ?? 0;
    shipAttributes.set(attributeId, applyOrderedChanges(current, changes, penalized.has(attributeId), penalties));
  }

  const shipAttr = (attributeId: number) =>
    shipAttributes.get(attributeId) ?? attributeDefaults.get(attributeId) ?? 0;

  const locationSkillModifiers: RequiredAttributeModifier[] = [...commandRequiredModifiers];
  const ownerModifiers: RequiredAttributeModifier[] = [...environmentOwnerModifiers];
  const locationItemModifiers: Array<{ attributeId: number; value: number; operation: number }> = [];

  const collectLocationItemModifiers = (source: Dogma, effectFilter?: (effectId: number, effect: EffectDefinition) => boolean) => {
    for (const effectId of source.effects) {
      const effect = modifiers.get(effectId);
      if (!effect || (effectFilter && !effectFilter(effectId, effect))) continue;
      for (const modifier of effect.modifiers) {
        if (modifier.domain !== "shipID" || modifier.modifiedAttributeID == null || modifier.modifyingAttributeID == null) continue;
        if (modifier.func === "LocationModifier") {
          locationItemModifiers.push({ attributeId: modifier.modifiedAttributeID, value: attr(source, modifier.modifyingAttributeID), operation: modifier.operation ?? 0 });
        } else if (modifier.func === "LocationGroupModifier" && modifier.groupID) {
          commandGroupModifiers.push({ groupId: modifier.groupID, attributeId: modifier.modifiedAttributeID, value: attr(source, modifier.modifyingAttributeID), operation: modifier.operation ?? 0 });
        }
      }
    }
  };

  const collectRequiredModifiers = (
    source: Dogma,
    func: "LocationRequiredSkillModifier" | "OwnerRequiredSkillModifier",
    stacking: boolean,
    state?: FittingItem["state"],
    effectFilter?: (effectId: number, effect: EffectDefinition) => boolean,
  ) => {
    for (const effectId of source.effects) {
      const effect = modifiers.get(effectId);
      if (!effect || (effectFilter && !effectFilter(effectId, effect))) continue;
      if (state) {
        if (effect.category === 5 && state !== "overheated") continue;
        if (effect.category === 1 && state !== "active" && state !== "overheated") continue;
        if (effect.category === 2 || effect.category === 3) continue;
      }
      for (const modifier of effect.modifiers) {
        if (
          modifier.func !== func ||
          modifier.skillTypeID == null ||
          modifier.modifiedAttributeID == null ||
          modifier.modifyingAttributeID == null
        ) continue;
        if (func === "LocationRequiredSkillModifier" && modifier.domain !== "shipID") continue;
        if (func === "OwnerRequiredSkillModifier" && modifier.domain !== "charID") continue;
        const destination = func === "LocationRequiredSkillModifier" ? locationSkillModifiers : ownerModifiers;
        destination.push({
          skillTypeId: modifier.skillTypeID,
          attributeId: modifier.modifiedAttributeID,
          value: attr(source, modifier.modifyingAttributeID),
          operation: modifier.operation ?? 0,
          stacking,
        });
      }
    }
  };

  // The modifier skillTypeID describes the skill required by the target item.
  // The level/value comes from the trained source skill above. Do not use the
  // target required-skill level as the modifier source level.
  for (const source of skillSources.values()) {
    collectRequiredModifiers(source, "LocationRequiredSkillModifier", false);
    collectRequiredModifiers(source, "OwnerRequiredSkillModifier", false);
    collectLocationItemModifiers(source);
  }

  for (const enhancement of enhancementSources) {
    const filter = (effectId: number, effect: EffectDefinition) => enhancementEffectAllowed(enhancement, effectId, effect);
    collectRequiredModifiers(enhancement.source, "LocationRequiredSkillModifier", false, undefined, filter);
    collectRequiredModifiers(enhancement.source, "OwnerRequiredSkillModifier", false, undefined, filter);
    collectLocationItemModifiers(enhancement.source, filter);
  }

  // Active fitted modules can project required-skill modifiers onto other fitted
  // items. Loaded scripts have already changed the source module attributes.
  for (const item of online) {
    const source = moduleDogmaFor(item);
    if (!source) continue;
    collectRequiredModifiers(source, "LocationRequiredSkillModifier", true, item.state ?? "active");
  }
  // Hull OwnerRequiredSkillModifier effects use hull bonus attributes after the
  // character's hull skills have scaled them.
  const scaledHullSource = { attributes: shipAttributes, effects: hull.effects };
  collectRequiredModifiers(scaledHullSource, "OwnerRequiredSkillModifier", false);
  collectRequiredModifiers(scaledHullSource, "LocationRequiredSkillModifier", false);
  collectLocationItemModifiers(scaledHullSource);

  // Fitted module owner modifiers remain stacking-penalty candidates.
  for (const item of online) {
    const source = moduleDogmaFor(item);
    if (!source) continue;
    for (let count = 0; count < (item.quantity ?? 1); count += 1) {
      collectRequiredModifiers(source, "OwnerRequiredSkillModifier", true);
    }
  }

  const skilledAttribute = (target: Dogma | undefined, attributeId: number) => {
    let current = attr(target, attributeId);
    if (!target) return current;
    const targetSkills = requiredSkillIds(target);
    const matching = locationSkillModifiers.filter(
      (change) => change.attributeId === attributeId && targetSkills.includes(change.skillTypeId),
    );
    for (const change of matching.filter((change) => !change.stacking)) {
      current = applyVerifiedOperation(current, change.value, change.operation);
    }
    const stacked = matching.filter((change) => change.stacking);
    current = applyOrderedChanges(current, stacked, penalized.has(attributeId), penalties);
    return current;
  };

  const effectiveItemAttr = (target: Dogma | undefined, attributeId: number, targetTypeId?: number) => {
    let current = skilledAttribute(target, attributeId);
    if (!target) return current;
    const targetSkills = requiredSkillIds(target);
    const matching = ownerModifiers.filter(
      (change) =>
        change.attributeId === attributeId && targetSkills.includes(change.skillTypeId),
    );

    for (const change of matching.filter((change) => !change.stacking)) {
      current = applyVerifiedOperation(current, change.value, change.operation);
    }

    const stacked = matching.filter((change) => change.stacking);
    current = applyOrderedChanges(current, stacked, penalized.has(attributeId), penalties);
    const locationChanges = locationItemModifiers.filter((change) => change.attributeId === attributeId);
    if (locationChanges.length) current = applyOrderedChanges(current, locationChanges, false, penalties);
    const projected = projectedItemChanges.get(attributeId) ?? [];
    if (projected.length) current = applyOrderedChanges(current, projected, penalized.has(attributeId), penalties);
    if (targetTypeId) {
      const groupId = groups.get(targetTypeId) ?? 0;
      const grouped = commandGroupModifiers.filter((change) => change.attributeId === attributeId && change.groupId === groupId);
      if (grouped.length) current = applyOrderedChanges(current, grouped, false, penalties);
    }
    return current;
  };

  for (const item of online) {
    const itemDogma = moduleDogmaFor(item);
    const quantity = item.quantity ?? 1;
    used.cpu += effectiveItemAttr(itemDogma, 50, item.typeId) * quantity;
    used.powergrid += effectiveItemAttr(itemDogma, 30, item.typeId) * quantity;
    if (item.rack === "rig") {
      used.calibration += effectiveItemAttr(itemDogma, 1153, item.typeId) * quantity;
    }
  }

  const capacity = {
    cpu: shipAttr(48),
    powergrid: shipAttr(11),
    calibration: shipAttr(1132),
  };
  const issues: Array<{
    level: "error" | "warning";
    code: string;
    message: string;
    item?: string;
  }> = [];
  for (const key of Object.keys(used) as Array<keyof typeof used>) {
    if (used[key] > capacity[key]) {
      issues.push({
        level: "error",
        code: `${key}-exceeded`,
        message: `${key} usage ${used[key].toFixed(1)} exceeds ${capacity[key].toFixed(1)}.`,
      });
    }
  }

  const limits: Record<string, number> = {
    low: attr(hull, 12),
    mid: attr(hull, 13),
    high: attr(hull, 14),
    rig: attr(hull, 1137),
    subsystem: attr(hull, 1367),
  };
  for (const [rack, limit] of Object.entries(limits)) {
    const rackItems = input.items.filter((item) => item.rack === rack);
    const count = rackItems.reduce((total, item) => total + (item.quantity ?? 1), 0);
    if (count > limit) {
      issues.push({
        level: "error",
        code: `${rack}-slots`,
        message: `${count} ${rack} modules exceed ${limit} slots.`,
      });
    }
    for (const item of rackItems) {
      const itemDogma = moduleDogmaFor(item);
      if (itemDogma && !itemDogma.effects.has(RACK_EFFECT[rack])) {
        issues.push({
          level: "error",
          code: "wrong-rack",
          item: names.get(item.typeId),
          message: `${names.get(item.typeId) ?? item.typeId} is not a ${rack}-slot item.`,
        });
      }
    }
  }

  const fittedByGroup = new Map<number, number>();
  const onlineByGroup = new Map<number, number>();
  for (const item of fitted) {
    const groupId = groups.get(item.typeId) ?? 0;
    const quantity = item.quantity ?? 1;
    fittedByGroup.set(groupId, (fittedByGroup.get(groupId) ?? 0) + quantity);
    if (item.state !== "offline") onlineByGroup.set(groupId, (onlineByGroup.get(groupId) ?? 0) + quantity);
  }
  const reportedFittedGroups = new Set<number>();
  const reportedOnlineGroups = new Set<number>();
  for (const item of fitted) {
    const itemDogma = moduleDogmaFor(item);
    if (!itemDogma) continue;
    const groupId = groups.get(item.typeId) ?? 0;
    const maxFitted = effectiveItemAttr(itemDogma, 1544, item.typeId);
    const maxOnline = effectiveItemAttr(itemDogma, 978, item.typeId);
    const fittedCount = fittedByGroup.get(groupId) ?? 0;
    const onlineCount = onlineByGroup.get(groupId) ?? 0;
    if (maxFitted > 0 && fittedCount > maxFitted && !reportedFittedGroups.has(groupId)) {
      reportedFittedGroups.add(groupId);
      issues.push({ level: "error", code: "max-group-fitted", item: names.get(item.typeId), message: `Only ${maxFitted} module(s) from this fitting group may be fitted; this fit has ${fittedCount}.` });
    }
    if (maxOnline > 0 && onlineCount > maxOnline && !reportedOnlineGroups.has(groupId)) {
      reportedOnlineGroups.add(groupId);
      issues.push({ level: "error", code: "max-group-online", item: names.get(item.typeId), message: `Only ${maxOnline} module(s) from this group may be online; this fit has ${onlineCount}.` });
    }
  }

  const subsystemSlots = new Map<number, FittingItem[]>();
  for (const item of fitted.filter((candidate) => candidate.rack === "subsystem")) {
    const itemDogma = moduleDogmaFor(item);
    if (!itemDogma) continue;
    const subsystemSlot = attr(itemDogma, 1366);
    const requiredHullType = attr(itemDogma, 1380);
    if (requiredHullType && requiredHullType !== input.hullTypeId) {
      issues.push({ level: "error", code: "subsystem-hull", item: names.get(item.typeId), message: `${names.get(item.typeId) ?? item.typeId} belongs to ${names.get(requiredHullType) ?? requiredHullType}, not ${names.get(input.hullTypeId) ?? input.hullTypeId}.` });
    }
    if (subsystemSlot) {
      const list = subsystemSlots.get(subsystemSlot) ?? []; list.push(item); subsystemSlots.set(subsystemSlot, list);
    }
  }
  for (const [slotId, slotItems] of subsystemSlots) {
    const count = slotItems.reduce((sum, item) => sum + (item.quantity ?? 1), 0);
    if (count > 1) issues.push({ level: "error", code: "subsystem-slot-duplicate", item: names.get(slotItems[0].typeId), message: `Subsystem slot ${slotId} has ${count} fitted subsystems; only one is allowed.` });
  }

  const hullGroup = groups.get(input.hullTypeId) ?? 0;
  for (const item of fitted) {
    const itemDogma = moduleDogmaFor(item);
    if (!itemDogma) continue;
    const allowedGroups = [
      1298, 1299, 1300, 1301, 1872, 1879, 1880, 1881, 2065, 2396, 2463, 2476,
      2477, 2478, 2479, 2480, 2481, 2482, 2483, 2484, 2485,
    ]
      .map((attributeId) => attr(itemDogma, attributeId))
      .filter(Boolean);
    const allowedTypes = [
      1302, 1303, 1304, 1305, 1380, 1944, 2103, 2463, 2486, 2487, 2488, 2758, 5948,
    ]
      .map((attributeId) => attr(itemDogma, attributeId))
      .filter(Boolean);
    if (
      (allowedGroups.length || allowedTypes.length) &&
      !allowedGroups.includes(hullGroup) &&
      !allowedTypes.includes(input.hullTypeId)
    ) {
      issues.push({
        level: "error",
        code: "ship-restriction",
        item: names.get(item.typeId),
        message: `${names.get(item.typeId) ?? item.typeId} cannot be fitted to ${names.get(input.hullTypeId) ?? input.hullTypeId}.`,
      });
    }
    if (
      item.rack === "rig" &&
      attr(itemDogma, 1547) &&
      attr(hull, 1547) &&
      attr(itemDogma, 1547) !== attr(hull, 1547)
    ) {
      issues.push({
        level: "error",
        code: "rig-size",
        item: names.get(item.typeId),
        message: `${names.get(item.typeId) ?? item.typeId} has the wrong rig size for this hull.`,
      });
    }
  }

  for (const item of fitted) {
    if (!item.chargeTypeId) continue;
    const module = moduleDogmaFor(item);
    const charge = dogma.get(item.chargeTypeId);
    const chargeGroup = groups.get(item.chargeTypeId) ?? 0;
    const allowed = [604, 605, 606, 609, 610]
      .map((attributeId) => attr(module, attributeId))
      .filter(Boolean);
    if (allowed.length && !allowed.includes(chargeGroup)) {
      issues.push({
        level: "error",
        code: "charge-group",
        item: names.get(item.chargeTypeId),
        message: `${names.get(item.chargeTypeId) ?? item.chargeTypeId} is not compatible with ${names.get(item.typeId) ?? item.typeId}.`,
      });
    }
    const moduleSize = attr(module, 128);
    const chargeSize = attr(charge, 128);
    if (moduleSize && chargeSize && moduleSize !== chargeSize) {
      issues.push({
        level: "error",
        code: "charge-size",
        item: names.get(item.chargeTypeId),
        message: `${names.get(item.chargeTypeId) ?? item.chargeTypeId} has the wrong charge size for ${names.get(item.typeId) ?? item.typeId}.`,
      });
    }
  }

  const turret = input.items.filter(
    (item) => item.rack === "high" && dogma.get(item.typeId)?.effects.has(42),
  ).length;
  const launcher = input.items.filter(
    (item) => item.rack === "high" && dogma.get(item.typeId)?.effects.has(40),
  ).length;
  if (turret > attr(hull, 102)) {
    issues.push({
      level: "error",
      code: "turret-hardpoints",
      message: `${turret} turrets exceed ${attr(hull, 102)} hardpoints.`,
    });
  }
  if (launcher > attr(hull, 101)) {
    issues.push({
      level: "error",
      code: "launcher-hardpoints",
      message: `${launcher} launchers exceed ${attr(hull, 101)} hardpoints.`,
    });
  }

  const fighterItems = input.items.filter((item) => item.rack === "fighter" || item.rack === "fighter-active");
  const fighterBayUsedM3 = fighterItems.reduce((sum, item) => sum + (volumes.get(item.typeId) ?? 0) * (item.quantity ?? 1), 0);
  const fighterCapacityM3 = shipAttr(2055);
  if (fighterItems.length && fighterCapacityM3 <= 0) {
    issues.push({ level: "error", code: "fighter-bay-unavailable", message: `${names.get(input.hullTypeId) ?? input.hullTypeId} has no fighter hangar.` });
  } else if (fighterBayUsedM3 > fighterCapacityM3) {
    issues.push({ level: "error", code: "fighter-capacity", message: `Fighter volume ${fighterBayUsedM3} m³ exceeds the ${fighterCapacityM3} m³ fighter hangar.` });
  }
  const fighterClass = (fighter: Dogma | undefined) => attr(fighter, 2214) || attr(fighter, 2742) ? "heavy" : attr(fighter, 2213) || attr(fighter, 2741) ? "support" : attr(fighter, 2212) || attr(fighter, 2740) ? "light" : "unknown";
  const fighterInventory = fighterItems.map((item) => { const fighter = dogma.get(item.typeId); return { typeId: item.typeId, name: names.get(item.typeId) ?? `Type ${item.typeId}`, quantity: item.quantity ?? 1, class: fighterClass(fighter), squadronSize: attr(fighter, 2215), volumeM3: volumes.get(item.typeId) ?? 0, active: item.rack === "fighter-active" }; });
  const activeSquadrons = fighterInventory.filter((fighter) => fighter.active);
  const fighterTubes = shipAttr(2216);
  const fighterLightSlots = shipAttr(2217) || shipAttr(2737);
  const fighterSupportSlots = shipAttr(2218) || shipAttr(2738);
  const fighterHeavySlots = shipAttr(2219) || shipAttr(2739);
  const activeCount = activeSquadrons.reduce((sum, fighter) => sum + fighter.quantity, 0);
  const activeByClass = { light: activeSquadrons.filter((fighter) => fighter.class === "light").reduce((sum, fighter) => sum + fighter.quantity, 0), support: activeSquadrons.filter((fighter) => fighter.class === "support").reduce((sum, fighter) => sum + fighter.quantity, 0), heavy: activeSquadrons.filter((fighter) => fighter.class === "heavy").reduce((sum, fighter) => sum + fighter.quantity, 0) };
  if (activeCount > fighterTubes) issues.push({ level: "error", code: "fighter-tubes", message: `${activeCount} active fighter squadrons exceed ${fighterTubes} launch tubes.` });
  if (activeByClass.light > fighterLightSlots) issues.push({ level: "error", code: "fighter-light-limit", message: `${activeByClass.light} light fighter squadrons exceed the ${fighterLightSlots} light-fighter limit.` });
  if (activeByClass.support > fighterSupportSlots) issues.push({ level: "error", code: "fighter-support-limit", message: `${activeByClass.support} support fighter squadrons exceed the ${fighterSupportSlots} support-fighter limit.` });
  if (activeByClass.heavy > fighterHeavySlots) issues.push({ level: "error", code: "fighter-heavy-limit", message: `${activeByClass.heavy} heavy fighter squadrons exceed the ${fighterHeavySlots} heavy-fighter limit.` });
  const fighterSystem = { capacityM3: fighterCapacityM3, usedM3: fighterBayUsedM3, tubes: fighterTubes, lightSlots: fighterLightSlots, supportSlots: fighterSupportSlots, heavySlots: fighterHeavySlots, inventory: fighterInventory, activeSquadrons: activeCount, activeByClass };

  const droneBandwidth = input.items
    .filter((item) => item.rack === "drone")
    .reduce(
      (total, item) => total + attr(dogma.get(item.typeId), 1272) * (item.quantity ?? 1),
      0,
    );
  if (droneBandwidth > attr(hull, 1271)) {
    issues.push({
      level: "warning",
      code: "drone-bandwidth",
      message: `All imported drones require ${droneBandwidth} Mbit/s; the hull can operate ${attr(hull, 1271)} Mbit/s at once.`,
    });
  }
  const droneVolume = input.items
    .filter((item) => item.rack === "drone")
    .reduce(
      (total, item) => total + (volumes.get(item.typeId) ?? 0) * (item.quantity ?? 1),
      0,
    );
  if (droneVolume > attr(hull, 283)) {
    issues.push({
      level: "error",
      code: "drone-capacity",
      message: `Drone volume ${droneVolume} mÂ³ exceeds the ${attr(hull, 283)} mÂ³ drone bay.`,
    });
  }

  const stats = [
    [263, "Shield HP", "HP"],
    [265, "Armor HP", "HP"],
    [9, "Structure HP", "HP"],
    [37, "Maximum velocity", "m/s"],
    [482, "Capacitor capacity", "GJ"],
    [55, "Capacitor recharge", "ms"],
    [283, "Drone bay", "mÂ³"],
    [1271, "Drone bandwidth", "Mbit/s"],
    [12, "Low slots", ""],
    [13, "Mid slots", ""],
    [14, "High slots", ""],
    [1137, "Rig slots", ""],
    [102, "Turret hardpoints", ""],
    [101, "Launcher hardpoints", ""],
    [48, "CPU output", "tf"],
    [11, "Powergrid output", "MW"],
    [1132, "Calibration", "points"],
  ] as const;

  const magazineFor = (item: FittingItem, module: Dogma | undefined) => {
    if (!item.chargeTypeId || !module) return null;
    const moduleCapacityM3 = capacities.get(item.typeId) ?? 0;
    const chargeVolumeM3 = volumes.get(item.chargeTypeId) ?? 0;
    const chargesPerCycle = Math.max(1, effectiveItemAttr(module, 56, item.typeId) || 1);
    const rawCharges = moduleCapacityM3 > 0 && chargeVolumeM3 > 0 ? Math.floor(moduleCapacityM3 / chargeVolumeM3 + 1e-9) : 0;
    const loadedCharges = item.chargeQuantity == null ? rawCharges : Math.max(0, Math.floor(item.chargeQuantity));
    const cyclesLoaded = loadedCharges > 0 ? Math.floor(loadedCharges / chargesPerCycle) : 0;
    const cyclesPerMagazine = rawCharges > 0 ? Math.floor(rawCharges / chargesPerCycle) : 0;
    const cycleSeconds = (effectiveItemAttr(module, 73, item.typeId) || effectiveItemAttr(module, 51, item.typeId)) / 1000;
    const reloadSeconds = effectiveItemAttr(module, 1795, item.typeId) / 1000;
    const activeSeconds = cyclesPerMagazine * cycleSeconds;
    const sustainedDutyCycle = activeSeconds > 0 ? activeSeconds / (activeSeconds + reloadSeconds) : 1;
    return { moduleCapacityM3, chargeVolumeM3, chargesPerCycle, rawCharges, loadedCharges, cyclesLoaded, cyclesPerMagazine, cycleSeconds, reloadSeconds, activeSeconds, sustainedDutyCycle };
  };
  for (const item of fitted) {
    if (!item.chargeTypeId || item.chargeQuantity == null) continue;
    const module = moduleDogmaFor(item);
    const magazine = magazineFor(item, module);
    if (magazine && magazine.rawCharges > 0 && magazine.loadedCharges > magazine.rawCharges) issues.push({ level: "error", code: "charge-capacity", item: names.get(item.typeId), message: `${names.get(item.typeId) ?? item.typeId} can load at most ${magazine.rawCharges} of ${names.get(item.chargeTypeId) ?? item.chargeTypeId}; ${magazine.loadedCharges} were requested.` });
  }
  const magazines = online.flatMap((item) => {
    const module = moduleDogmaFor(item);
    const magazine = magazineFor(item, module);
    if (!magazine || !item.chargeTypeId) return [];
    return [{ typeId: item.typeId, name: names.get(item.typeId) ?? `Type ${item.typeId}`, chargeTypeId: item.chargeTypeId, charge: names.get(item.chargeTypeId) ?? `Type ${item.chargeTypeId}`, quantity: item.quantity ?? 1, ...magazine }];
  });

  const capacitorCapacity = shipAttr(482);
  const rechargeSeconds = shipAttr(55) / 1000;
  const demandGjPerSecond = online
    .filter((item) => item.state === "active" || item.state === "overheated")
    .reduce((total, item) => {
      const itemDogma = moduleDogmaFor(item);
      const cycleSeconds = effectiveItemAttr(itemDogma, 73, item.typeId) / 1000;
      return (
        total +
        (cycleSeconds > 0
          ? (effectiveItemAttr(itemDogma, 6, item.typeId) / cycleSeconds) * (item.quantity ?? 1)
          : 0)
      );
    }, 0);
  const capacitorInjectors = online.flatMap((item) => {
    if (item.state !== "active" && item.state !== "overheated") return [];
    const module = moduleDogmaFor(item);
    if (!module?.effects.has(48) || !item.chargeTypeId) return [];
    const charge = dogma.get(item.chargeTypeId);
    const magazine = magazineFor(item, module);
    if (!charge || !magazine || magazine.cycleSeconds <= 0) return [];
    const quantity = item.quantity ?? 1;
    const injectionPerCycleGj = attr(charge, 67) * Math.max(1, magazine.chargesPerCycle);
    const burstGjPerSecond = injectionPerCycleGj / magazine.cycleSeconds * quantity;
    const sustainedGjPerSecond = burstGjPerSecond * magazine.sustainedDutyCycle;
    return [{ typeId: item.typeId, name: names.get(item.typeId) ?? `Type ${item.typeId}`, charge: names.get(item.chargeTypeId) ?? `Type ${item.chargeTypeId}`, injectionPerCycleGj, burstGjPerSecond, sustainedGjPerSecond, ...magazine }];
  });
  const injectedGjPerSecond = capacitorInjectors.reduce((sum, injector) => sum + injector.sustainedGjPerSecond, 0);
  const netDemandGjPerSecond = Math.max(0, demandGjPerSecond - injectedGjPerSecond);
  const peakRechargeGjPerSecond =
    rechargeSeconds > 0 ? (2.5 * capacitorCapacity) / rechargeSeconds : 0;
  const stable = netDemandGjPerSecond <= peakRechargeGjPerSecond;
  const rechargeRatio =
    peakRechargeGjPerSecond > 0 ? netDemandGjPerSecond / peakRechargeGjPerSecond : Infinity;
  const equilibriumRoot = stable
    ? (1 + Math.sqrt(Math.max(0, 1 - rechargeRatio))) / 2
    : 0;
  const stablePercent = !netDemandGjPerSecond
    ? 100
    : stable
      ? equilibriumRoot * equilibriumRoot * 100
      : 0;
  let depletionSeconds = 0;
  if (!stable && netDemandGjPerSecond > 0) {
    let capacitor = capacitorCapacity;
    for (let second = 1; second <= 86400; second += 1) {
      const fraction = Math.max(0, capacitor / capacitorCapacity);
      const recharge =
        rechargeSeconds > 0
          ? ((10 * capacitorCapacity) / rechargeSeconds) *
            (Math.sqrt(fraction) - fraction)
          : 0;
      capacitor += recharge - netDemandGjPerSecond;
      if (capacitor <= 0) {
        depletionSeconds = second;
        break;
      }
    }
  }

  const damageOf = (itemDogma: Dogma | undefined) =>
    attr(itemDogma, 114) +
    attr(itemDogma, 116) +
    attr(itemDogma, 117) +
    attr(itemDogma, 118);

  let weaponVolley = 0;
  let weaponDps = 0;
  const weaponProfiles: Array<Record<string, unknown>> = [];
  for (const item of online.filter(
    (candidate) =>
      candidate.rack === "high" &&
      candidate.chargeTypeId &&
      (candidate.state === "active" || candidate.state === "overheated"),
  )) {
    const module = moduleDogmaFor(item);
    const charge = dogma.get(item.chargeTypeId!);
    const quantity = item.quantity ?? 1;
    const multiplier = effectiveItemAttr(module, 64, item.typeId) || effectiveItemAttr(module, 212, item.typeId) || 1;
    const volley = damageOf(charge) * multiplier * quantity;
    const cycleSeconds = effectiveItemAttr(module, 51, item.typeId) / 1000;
    weaponVolley += volley;
    if (cycleSeconds > 0) weaponDps += volley / cycleSeconds;

    const common = {
      typeId: item.typeId,
      name: names.get(item.typeId) ?? `Type ${item.typeId}`,
      charge: names.get(item.chargeTypeId!),
      quantity,
      cycleSeconds,
      volley,
      paperDps: cycleSeconds > 0 ? volley / cycleSeconds : 0,
    };
    if (module?.effects.has(42)) {
      weaponProfiles.push({
        ...common,
        kind: "turret",
        optimalM: effectiveItemAttr(module, 54, item.typeId),
        falloffM: effectiveItemAttr(module, 158, item.typeId) * (attr(charge, 779) || 1),
        tracking: effectiveItemAttr(module, 160, item.typeId),
        signatureResolutionM: attr(module, 620) / 1000,
      });
    } else if (module?.effects.has(40)) {
      weaponProfiles.push({
        ...common,
        kind: "missile",
        maximumRangeM: attr(charge, 37) * (attr(charge, 281) / 1000) * attr(charge, 646),
        explosionRadiusM: attr(charge, 654),
        explosionVelocity: attr(charge, 653),
        damageReductionFactor: attr(charge, 1353),
      });
    }
  }
  for (const profile of weaponProfiles) {
    if (profile.kind !== "turret") continue;
    profile.falloffM = effectiveItemAttr(dogma.get(profile.typeId as number), 158, profile.typeId as number);
    profile.tracking = (profile.tracking as number) / 1000;
  }

  const turretExpectedDamageFactor = (hitChance: number) => hitChance <= 0.01 ? 3 * hitChance : 0.5 * hitChance * hitChance + 0.49 * hitChance + 0.02505;
  for (const profile of weaponProfiles) {
    const paperDps = Number(profile.paperDps ?? 0);
    if (profile.kind === "turret") {
      const rangeM = Math.max(1, targetProfile.rangeM);
      const tracking = Math.max(1e-12, Number(profile.tracking));
      const signatureResolutionM = Math.max(1e-12, Number(profile.signatureResolutionM));
      const angular = Math.abs(targetProfile.transverseVelocityMps) / rangeM;
      const trackingTerm = angular * signatureResolutionM / (tracking * Math.max(1e-12, targetProfile.signatureRadiusM));
      const falloff = Math.max(1e-12, Number(profile.falloffM));
      const rangeTerm = Math.max(0, rangeM - Number(profile.optimalM)) / falloff;
      const hitChance = Math.pow(0.5, trackingTerm * trackingTerm + rangeTerm * rangeTerm);
      const applicationFactor = turretExpectedDamageFactor(hitChance);
      profile.targetApplication = { hitChance, applicationFactor, appliedDps: paperDps * applicationFactor, angularVelocityRadPerSecond: angular };
    } else if (profile.kind === "missile") {
      const explosionRadius = Math.max(1e-12, Number(profile.explosionRadiusM));
      const explosionVelocity = Math.max(1e-12, Number(profile.explosionVelocity));
      const drf = Math.max(1e-12, Number(profile.damageReductionFactor));
      const signatureRatio = Math.max(0, targetProfile.signatureRadiusM) / explosionRadius;
      const speed = Math.max(0, targetProfile.velocityMps);
      const velocityTerm = speed <= 0 ? 1 : Math.pow(Math.max(0, signatureRatio * explosionVelocity / speed), drf);
      const applicationFactor = Math.min(1, signatureRatio, velocityTerm);
      profile.targetApplication = { hitChance: targetProfile.rangeM <= Number(profile.maximumRangeM) ? 1 : 0, applicationFactor: targetProfile.rangeM <= Number(profile.maximumRangeM) ? applicationFactor : 0, appliedDps: targetProfile.rangeM <= Number(profile.maximumRangeM) ? paperDps * applicationFactor : 0 };
    }
  }

  const droneItems = input.items.filter((item) => item.rack === "drone");
  const explicitDroneSelection = droneItems.some((item) => item.activeQuantity != null);
  const droneCandidates = droneItems
    .flatMap((item) => {
      const itemDogma = moduleDogmaFor(item);
      const bandwidth = attr(itemDogma, 1272);
      const cycle = effectiveItemAttr(itemDogma, 51, item.typeId) / 1000;
      const volley = damageOf(itemDogma) * (effectiveItemAttr(itemDogma, 64, item.typeId) || 1);
      const dps = cycle > 0 ? volley / cycle : 0;
      const candidateQuantity = explicitDroneSelection ? Math.max(0, Math.min(item.quantity ?? 1, Math.floor(item.activeQuantity ?? 0))) : Math.min(item.quantity ?? 1, 50);
      return Array.from({ length: candidateQuantity }, () => ({
        typeId: item.typeId,
        name: names.get(item.typeId) ?? `Type ${item.typeId}`,
        bandwidth,
        volley,
        dps,
      }));
    })
    .sort((left, right) => right.dps - left.dps);

  const activeDrones: typeof droneCandidates = [];
  let bandwidthRemaining = shipAttr(1271);
  if (explicitDroneSelection) {
    const requestedBandwidth = droneCandidates.reduce((sum, drone) => sum + drone.bandwidth, 0);
    if (droneCandidates.length > 5) issues.push({ level: "error", code: "active-drone-count", message: `${droneCandidates.length} drones are marked active; ships can control at most 5 at once.` });
    if (requestedBandwidth > shipAttr(1271)) issues.push({ level: "error", code: "active-drone-bandwidth", message: `Selected active drones require ${requestedBandwidth} Mbit/s; the hull provides ${shipAttr(1271)} Mbit/s.` });
    activeDrones.push(...droneCandidates.slice(0, 5));
  } else {
    for (const drone of droneCandidates) {
      if (activeDrones.length >= 5) break;
      if (drone.bandwidth <= bandwidthRemaining) {
        activeDrones.push(drone);
        bandwidthRemaining -= drone.bandwidth;
      }
    }
  }
  const droneVolley = activeDrones.reduce((sum, drone) => sum + drone.volley, 0);
  const droneDps = activeDrones.reduce((sum, drone) => sum + drone.dps, 0);

  const resistance = (attributeIds: number[]) =>
    attributeIds.map((attributeId) => (shipAttributes.has(attributeId) ? 1 - shipAttr(attributeId) : 0));
  const shieldResists = resistance([271, 274, 273, 272]);
  const armorResists = resistance([267, 270, 269, 268]);
  const hullResists = resistance([113, 110, 109, 111]);
  const incomingDamageFraction = (resists: number[]) => damageProfile.reduce((sum, weight, index) => sum + weight * (1 - (resists[index] ?? 0)), 0);
  const layerEhp = (hp: number, resists: number[]) => hp / Math.max(1e-12, incomingDamageFraction(resists));
  const effectiveRepair = (rawRepair: number, resists: number[]) => rawRepair / Math.max(1e-12, incomingDamageFraction(resists));
  const shieldHp = shipAttr(263);
  const armorHp = shipAttr(265);
  const structureHp = shipAttr(9);

  let shieldRepair = 0;
  let armorRepair = 0;
  let structureRepair = 0;
  for (const item of online.filter(
    (candidate) => candidate.state === "active" || candidate.state === "overheated",
  )) {
    const itemDogma = moduleDogmaFor(item);
    const cycle =
      (effectiveItemAttr(itemDogma, 73, item.typeId) || effectiveItemAttr(itemDogma, 51, item.typeId)) / 1000;
    if (cycle <= 0) continue;
    const magazine = magazineFor(item, itemDogma);
    const charge = item.chargeTypeId ? dogma.get(item.chargeTypeId) : undefined;
    const chargedArmorMultiplier = charge && groups.get(item.chargeTypeId!) === 916 ? (effectiveItemAttr(itemDogma, 1886, item.typeId) || 1) : 1;
    const shieldPerSecond = (effectiveItemAttr(itemDogma, 68, item.typeId) / cycle) * (item.quantity ?? 1);
    const armorPerSecond = (effectiveItemAttr(itemDogma, 84, item.typeId) * chargedArmorMultiplier / cycle) * (item.quantity ?? 1);
    const structurePerSecond = (effectiveItemAttr(itemDogma, 83, item.typeId) / cycle) * (item.quantity ?? 1);
    const duty = magazine && magazine.reloadSeconds > 0 ? magazine.sustainedDutyCycle : 1;
    shieldRepair += shieldPerSecond * duty;
    armorRepair += armorPerSecond * duty;
    structureRepair += structurePerSecond * duty;
  }

  const shieldRechargeSeconds = shipAttr(479) / 1000;
  const passiveShieldPeak =
    shieldRechargeSeconds > 0 ? (2.5 * shieldHp) / shieldRechargeSeconds : 0;
  const baseMassKg = masses.get(input.hullTypeId) ?? 0;
  const activePropulsion = online.flatMap((item) => {
    if (item.state !== "active" && item.state !== "overheated") return [];
    const module = moduleDogmaFor(item);
    if (!module || (!module.effects.has(6730) && !module.effects.has(6731))) return [];
    const speedFactorPercent = effectiveItemAttr(module, 20, item.typeId);
    return [{
      typeId: item.typeId,
      name: names.get(item.typeId) ?? `Type ${item.typeId}`,
      quantity: item.quantity ?? 1,
      speedFactorPercent,
      thrust: effectiveItemAttr(module, 567, item.typeId),
      massAdditionKg: effectiveItemAttr(module, 796, item.typeId) * (item.quantity ?? 1),
      signatureRadiusBonusPercent: module.effects.has(6730) ? effectiveItemAttr(module, 554, item.typeId) : 0,
      kind: module.effects.has(6730) ? "mwd" : "afterburner",
    }];
  });
  const propMassAdditionKg = activePropulsion.reduce((sum, prop) => sum + prop.massAdditionKg, 0);
  const massKg = baseMassKg + propMassAdditionKg;
  const agility = shipAttr(70);
  const alignSeconds = massKg && agility ? (Math.log(4) * massKg * agility) / 1_000_000 : 0;
  const baseMaximumVelocity = shipAttr(37);
  const propulsionSpeeds = activePropulsion.map((prop) => ({
    ...prop,
    maximumVelocity: baseMaximumVelocity * (1 + (prop.speedFactorPercent / 100) * (prop.thrust / Math.max(1, massKg))),
  }));
  const maximumVelocity = propulsionSpeeds.length ? Math.max(baseMaximumVelocity, ...propulsionSpeeds.map((prop) => prop.maximumVelocity)) : baseMaximumVelocity;
  const navigation = {
    baseMaximumVelocity,
    maximumVelocity,
    baseMassKg,
    massKg,
    massAdditionKg: propMassAdditionKg,
    agility,
    alignSeconds,
    warpSpeedAuPerSecond: (shipAttr(1281) || 1) * shipAttr(600),
    activePropulsion: propulsionSpeeds,
  };
  const mwdSignatureMultiplier = activePropulsion.filter((prop) => prop.kind === "mwd").reduce((current, prop) => current * (1 + prop.signatureRadiusBonusPercent / 100), 1);
  const targeting = {
    maximumRangeM: shipAttr(76),
    scanResolution: shipAttr(564),
    signatureRadiusM: shipAttr(552) * mwdSignatureMultiplier,
    maximumLockedTargets: shipAttr(192),
    sensorStrength:
      shipAttr(1371) || Math.max(shipAttr(208), shipAttr(209), shipAttr(210), shipAttr(211)),
  };

  // Heat is stochastic in EVE. These values are expected outcomes using CCP's
  // rack heat attributes and the observed server heat equations: rack heat grows
  // continuously while any module is overloaded, then each overloaded module's
  // completed cycle rolls heat * occupied-slot-factor * attenuation^distance.
  const heatRackConfig = {
    high: { capacity: 1178, dissipation: 1179, attenuation: 1259 },
    mid: { capacity: 1199, dissipation: 1196, attenuation: 1261 },
    low: { capacity: 1200, dissipation: 1198, attenuation: 1262 },
  } as const;
  const totalHeatSlots = Math.max(1, shipAttr(14) + shipAttr(13) + shipAttr(12) + shipAttr(1137));
  const onlineHeatSlotCount = input.items
    .filter((item) => (item.rack === "high" || item.rack === "mid" || item.rack === "low") && item.state !== "offline")
    .reduce((sum, item) => sum + (item.quantity ?? 1), 0);
  const occupiedSlotFactor = onlineHeatSlotCount / totalHeatSlots;
  const heatGenerationMultiplier = shipAttr(1224) || 1;
  const heatRacks = (Object.keys(heatRackConfig) as Array<keyof typeof heatRackConfig>).map((rack) => {
    const config = heatRackConfig[rack];
    const capacity = shipAttr(config.capacity) || 100;
    const capacityAbsolute = capacity / 100;
    const dissipationRate = shipAttr(config.dissipation) || 0.01;
    const attenuation = shipAttr(config.attenuation) || 1;
    const expanded = input.items
      .filter((item) => item.rack === rack)
      .flatMap((item) => Array.from({ length: Math.max(0, item.quantity ?? 1) }, () => item))
      .map((item, position) => {
        const module = moduleDogmaFor(item);
        const cycleSeconds = (effectiveItemAttr(module, 73, item.typeId) || effectiveItemAttr(module, 51, item.typeId)) / 1000;
        return {
          position,
          typeId: item.typeId,
          name: names.get(item.typeId) ?? `Type ${item.typeId}`,
          state: item.state ?? "active",
          online: item.state !== "offline",
          overheated: item.state === "overheated",
          hp: effectiveItemAttr(module, 9, item.typeId) || 40,
          initialDamage: Math.max(0, effectiveItemAttr(module, 3, item.typeId)),
          heatDamage: Math.max(0, effectiveItemAttr(module, 1211, item.typeId)),
          heatAbsorption: Math.max(0, effectiveItemAttr(module, 1180, item.typeId)),
          cycleSeconds,
          expectedDamage: Math.max(0, effectiveItemAttr(module, 3, item.typeId)),
          expectedBurnoutSeconds: 0,
          burned: false,
          nextCycle: cycleSeconds,
        };
      });
    const initialSources = expanded.filter((module) => module.overheated && module.online && module.cycleSeconds > 0 && module.heatAbsorption > 0);
    const initialAbsorption = initialSources.reduce((sum, module) => sum + module.heatAbsorption, 0);
    const initialHeatRate = heatGenerationMultiplier * initialAbsorption;
    const heatAt = (seconds: number) => initialHeatRate > 0 ? capacityAbsolute * (1 - Math.exp(-initialHeatRate * seconds)) : 0;
    const timeToFraction = (fraction: number) => {
      if (initialHeatRate <= 0 || fraction <= 0) return 0;
      const target = Math.min(capacityAbsolute * 0.999999, capacityAbsolute * fraction);
      return -Math.log(Math.max(1e-12, 1 - target / capacityAbsolute)) / initialHeatRate;
    };
    let heat = 0;
    let elapsed = 0;
    let iterations = 0;
    while (iterations++ < 100000 && elapsed < 3600) {
      const sources = expanded.filter((module) => module.overheated && module.online && !module.burned && module.cycleSeconds > 0 && module.heatAbsorption > 0 && module.nextCycle > elapsed - 1e-9);
      if (!sources.length) break;
      const nextTime = Math.min(...sources.map((module) => module.nextCycle));
      const dt = Math.max(0, nextTime - elapsed);
      const absorption = sources.reduce((sum, module) => sum + module.heatAbsorption, 0);
      const rate = heatGenerationMultiplier * absorption;
      if (rate > 0) heat = capacityAbsolute - (capacityAbsolute - heat) * Math.exp(-rate * dt);
      else heat *= Math.exp(-dissipationRate * dt);
      elapsed = nextTime;
      const ending = sources.filter((module) => Math.abs(module.nextCycle - nextTime) < 1e-7);
      const pendingDamage = new Map<number, number>();
      for (const source of ending) {
        if (source.burned || source.heatDamage <= 0) continue;
        for (const target of expanded) {
          if (!target.online || target.burned) continue;
          const distance = Math.abs(target.position - source.position);
          const probability = Math.max(0, Math.min(1, heat * occupiedSlotFactor * Math.pow(attenuation, distance)));
          if (probability <= 0) continue;
          pendingDamage.set(target.position, (pendingDamage.get(target.position) ?? 0) + source.heatDamage * probability);
        }
      }
      for (const [position, damage] of pendingDamage) {
        const target = expanded[position];
        target.expectedDamage += damage;
      }
      for (const target of expanded) {
        if (!target.burned && target.expectedDamage >= target.hp) {
          target.burned = true;
          target.expectedBurnoutSeconds = elapsed;
        }
      }
      for (const source of ending) if (!source.burned) source.nextCycle += source.cycleSeconds;
    }
    const burnoutTimes = expanded.map((module) => module.expectedBurnoutSeconds).filter((seconds) => seconds > 0);
    return {
      rack,
      capacity,
      dissipationRate,
      attenuation,
      heatGenerationMultiplier,
      occupiedSlotFactor,
      overheatedModules: initialSources.length,
      heatAt30Seconds: heatAt(30),
      heatAt60Seconds: heatAt(60),
      timeTo50PercentSeconds: timeToFraction(0.5),
      timeTo90PercentSeconds: timeToFraction(0.9),
      firstExpectedBurnoutSeconds: burnoutTimes.length ? Math.min(...burnoutTimes) : 0,
      modules: expanded.map((module) => ({
        position: module.position,
        typeId: module.typeId,
        name: module.name,
        state: module.state,
        hp: module.hp,
        initialDamage: module.initialDamage,
        heatDamage: module.heatDamage,
        heatAbsorption: module.heatAbsorption,
        cycleSeconds: module.cycleSeconds,
        expectedBurnoutSeconds: module.expectedBurnoutSeconds,
        expectedDamageAtSimulationEnd: module.expectedDamage,
      })),
    };
  });
  const heat = {
    stochastic: true,
    occupiedSlotFactor,
    generationMultiplier: heatGenerationMultiplier,
    racks: heatRacks,
  };

  return {
    character: input.snapshot.character.name,
    totalSkillPoints: input.snapshot.skills?.total_sp ?? 0,
    hull: names.get(input.hullTypeId) ?? "Unknown hull",
    baseStats: stats.flatMap(([id, label, unit]) =>
      hull.attributes.has(id) ? [{ id, label, value: attr(hull, id), unit }] : [],
    ),
    requirements,
    missingRequirements: requirements.flatMap((requirement) =>
      requirement.skills
        .filter((skill) => !skill.met)
        .map((skill) => ({ item: requirement.item, ...skill })),
    ),
    resources: { used, capacity },
    capacitor: {
      capacityGj: capacitorCapacity,
      rechargeSeconds,
      demandGjPerSecond,
      injectedGjPerSecond,
      netDemandGjPerSecond,
      capacitorInjectors,
      peakRechargeGjPerSecond,
      stable,
      stablePercent,
      depletionSeconds,
    },
    magazines,
    fighterSystem,
    damage: {
      weaponDps,
      weaponVolley,
      droneDps,
      droneVolley,
      totalDps: weaponDps + droneDps,
      totalVolley: weaponVolley + droneVolley,
      weaponProfiles,
      activeDrones: activeDrones.map((drone) => ({
        typeId: drone.typeId,
        name: drone.name,
        bandwidth: drone.bandwidth,
      })),
      explicitDroneSelection,
    },
    defence: {
      shieldHp,
      armorHp,
      structureHp,
      shieldResists,
      armorResists,
      hullResists,
      shieldEhp: layerEhp(shieldHp, shieldResists),
      armorEhp: layerEhp(armorHp, armorResists),
      structureEhp: layerEhp(structureHp, hullResists),
      totalEhp:
        layerEhp(shieldHp, shieldResists) +
        layerEhp(armorHp, armorResists) +
        layerEhp(structureHp, hullResists),
      damageProfile: { em: damageProfile[0], thermal: damageProfile[1], kinetic: damageProfile[2], explosive: damageProfile[3] },
      shieldRepairPerSecond: shieldRepair,
      armorRepairPerSecond: armorRepair,
      structureRepairPerSecond: structureRepair,
      effectiveShieldRepairPerSecond: effectiveRepair(shieldRepair, shieldResists),
      effectiveArmorRepairPerSecond: effectiveRepair(armorRepair, armorResists),
      effectiveStructureRepairPerSecond: effectiveRepair(structureRepair, hullResists),
      passiveShieldPeak,
      effectivePassiveShieldPeak: effectiveRepair(passiveShieldPeak, shieldResists),
    },
    navigation,
    targeting,
    heat,
    issues,
    enhancements: enhancementSources.map((enhancement) => ({ typeId: enhancement.typeId, name: names.get(enhancement.typeId) ?? `Type ${enhancement.typeId}`, kind: enhancement.kind })),
    projectedSources,
    commandBurstSources,
    environmentSources: environmentSources.map((environment) => ({ typeId: environment.typeId, name: environment.name })),
    source: "CCP EVE static data (offline)",
  };
}



