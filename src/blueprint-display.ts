export type BlueprintDisplaySource = {
  quantity?: number | null;
  runs?: number | null;
  lpStoreTarget?: boolean;
  blueprintKind?: string | null;
  blueprintRuns?: number | null;
};

function finiteRun(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

export function blueprintRunCount(source: BlueprintDisplaySource) {
  return finiteRun(source.blueprintRuns) ?? finiteRun(source.runs);
}

export function blueprintKind(source: BlueprintDisplaySource): "BPO" | "BPC" | "BLUEPRINT" {
  const explicit = String(source.blueprintKind ?? "").trim().toUpperCase();
  if (explicit === "BPO" || explicit === "BPC") return explicit;
  if (source.lpStoreTarget) return "BPC";
  const quantity = Number(source.quantity);
  if (quantity === -1) return "BPO";
  if (quantity === -2) return "BPC";
  if (blueprintRunCount(source) != null) return "BPC";
  return "BLUEPRINT";
}

export function blueprintRunLabel(source: BlueprintDisplaySource) {
  const kind = blueprintKind(source);
  if (kind === "BPO") return "BPO";
  if (kind === "BPC") {
    const runs = blueprintRunCount(source);
    return runs == null ? "BPC · runs unknown" : `BPC · ${runs} run${runs === 1 ? "" : "s"}`;
  }
  return "Blueprint";
}
