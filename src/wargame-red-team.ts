import type { WargameUnit } from "./wargame-types";

export type WargameRedTeamDecision = {
  unitId: string;
  targetId: string;
  reason: "support-pressure" | "range-application";
};

export type WargameRedTeamContext = {
  distanceKm(a: WargameUnit, b: WargameUnit): number;
  weaponApplication(attacker: WargameUnit, target: WargameUnit, rangeKm: number): number;
  healthPercent(unit: WargameUnit): number;
  primaryHealthPercent(unit: WargameUnit): number;
};

const OFFENSIVE_SUPPORT = new Set([
  "web",
  "tackle",
  "targetPainter",
  "sensorDamp",
  "trackingDisruptor",
  "ecm",
  "energyNeutralizer",
  "energyNosferatu",
]);

export function planReactiveRedTeam(units: WargameUnit[], context: WargameRedTeamContext): WargameRedTeamDecision[] {
  const blueLiving = units.filter((unit) => unit.side === "blue" && unit.ehp > 0 && (unit.shipsAlive ?? unit.count) > 0 && unit.movementState !== "warping");
  const redLiving = units.filter((unit) => unit.side === "red" && unit.ehp > 0 && (unit.shipsAlive ?? unit.count) > 0 && unit.movementState !== "warping");
  const redMainTarget = redLiving.find((unit) => unit.role.toLowerCase().includes("mainline"))?.targetId;
  const decisions: WargameRedTeamDecision[] = [];

  for (const red of redLiving) {
    if ((red.orderChain?.length ?? 0) > (red.activeOrderIndex ?? 0)) continue;
    if ((red.stance ?? "kite") === "support" || (red.repPerSecond ?? 0) > 0) continue;

    const supportKinds = new Set((red.supportSystems ?? []).map((system) => system.kind));
    const hasOffensiveSupport = [...supportKinds].some((kind) => OFFENSIVE_SUPPORT.has(kind));
    let best: WargameUnit | undefined;
    let bestScore = -Infinity;

    for (const candidate of blueLiving) {
      const rangeKm = context.distanceKm(red, candidate);
      const application = context.weaponApplication(red, candidate, Math.min(rangeKm, red.range));
      const role = candidate.role.toLowerCase();
      let score = (hasOffensiveSupport ? application * 15 : application * 55)
        - rangeKm * .18
        + (100 - context.healthPercent(candidate)) * .22
        + (100 - context.primaryHealthPercent(candidate)) * .18;

      if (supportKinds.has("web") || supportKinds.has("tackle")) {
        score += Math.min(70, candidate.speed / 100);
        if (role.includes("tackle") || role.includes("interceptor")) score += 35;
        if ((candidate.stance ?? "") === "pursue") score += 22;
      }
      if (supportKinds.has("targetPainter")) {
        if (candidate.id === redMainTarget) score += 75;
        score += Math.max(0, 220 - (candidate.signature ?? 160)) * .08;
      }
      if (supportKinds.has("sensorDamp")) {
        if (role.includes("logistics")) score += 70;
        if ((candidate.range ?? 0) > 55) score += 35;
      }
      if (supportKinds.has("trackingDisruptor")) {
        if ((candidate.weaponModel ?? "turret") === "turret") score += 65;
        score += Math.min(40, (candidate.dps / Math.max(1, candidate.count)) / 20);
      }
      if (supportKinds.has("ecm")) {
        if (role.includes("logistics")) score += 75;
        else score += Math.min(55, (candidate.dps / Math.max(1, candidate.count)) / 15);
      }
      if (supportKinds.has("energyNeutralizer") || supportKinds.has("energyNosferatu")) {
        if (role.includes("logistics")) score += 65;
        if ((candidate.capacitorCapacity ?? 0) > 0) score += 25;
      }
      if (!hasOffensiveSupport && role.includes("logistics")) score += red.webStrength ? 70 : 18;
      if (!hasOffensiveSupport && role.includes("tackle")) score += 8;
      if (rangeKm <= red.range) score += 18;

      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    if (best && red.targetId !== best.id) {
      decisions.push({
        unitId: red.id,
        targetId: best.id,
        reason: hasOffensiveSupport ? "support-pressure" : "range-application",
      });
    }
  }

  return decisions;
}
