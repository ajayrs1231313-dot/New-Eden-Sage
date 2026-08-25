export type RollingMathPass = { direction: "OUT" | "IN"; massKg: number };

export function parsePositiveMass(value: string | number) {
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

export function calculateRollingState(nominalMass: number, variancePercent: number, passes: RollingMathPass[]) {
  const nominal = Math.max(0, nominalMass);
  const variance = Math.max(0, Math.min(50, variancePercent));
  const lowerStart = nominal * (1 - variance / 100);
  const upperStart = nominal * (1 + variance / 100);
  const consumed = passes.reduce((sum, row) => sum + Math.max(0, row.massKg), 0);
  const remainingLow = Math.max(0, lowerStart - consumed);
  const remainingHigh = Math.max(0, upperStart - consumed);
  const currentSide = passes.at(-1)?.direction === "OUT" ? "FAR SIDE" : "HOME SIDE";
  const nextExpectedDirection: "OUT" | "IN" = currentSide === "HOME SIDE" ? "OUT" : "IN";
  const sequenceContradictions = passes.flatMap((pass, index) => index > 0 && passes[index - 1].direction === pass.direction ? [index] : []);
  return { nominal, variance, lowerStart, upperStart, consumed, remainingLow, remainingHigh, currentSide, nextExpectedDirection, sequenceContradictions };
}

export function rollingRiskForMass(remainingLow: number, remainingHigh: number, mass: number) {
  if (!(mass > 0)) return "ENTER MASS" as const;
  if (mass <= remainingLow) return "SAFE AGAINST CURRENT RANGE" as const;
  if (mass <= remainingHigh) return "MAY COLLAPSE" as const;
  return "EXCEEDS ENTIRE REMAINING RANGE" as const;
}

function nearInteger(value: number) {
  const rounded = Math.round(value);
  return Math.abs(value - rounded) <= 1e-10 * Math.max(1, Math.abs(value)) ? rounded : value;
}

export function rollingPassWindow(remainingLow: number, remainingHigh: number, mass: number) {
  if (!(mass > 0)) return null;
  const safeRatio = nearInteger(remainingLow / mass);
  const maxRatio = nearInteger(remainingHigh / mass);
  const guaranteedSafePasses = Math.max(0, Math.floor(safeRatio));
  const maximumPasses = Math.max(0, Math.ceil(maxRatio));
  return { guaranteedSafePasses, firstUncertainPass: guaranteedSafePasses + 1, maximumPasses };
}

export function directionalRollingRisk(direction: "OUT" | "IN", nextExpectedDirection: "OUT" | "IN", base: ReturnType<typeof rollingRiskForMass>) {
  if (direction !== nextExpectedDirection) return `SEQUENCE CONTRADICTION · EXPECTED ${nextExpectedDirection}`;
  if (direction === "OUT" && (base === "MAY COLLAPSE" || base === "EXCEEDS ENTIRE REMAINING RANGE")) return `${base} · STRAND RISK`;
  if (direction === "IN" && (base === "MAY COLLAPSE" || base === "EXCEEDS ENTIRE REMAINING RANGE")) return `${base} · RETURNS HOME IF TRANSIT COMPLETES`;
  return base;
}
