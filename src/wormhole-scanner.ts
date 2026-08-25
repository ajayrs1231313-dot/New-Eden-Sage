import type { WormholeSignatureKind, WormholeSignatureObservation } from "./types";

const SIG_PATTERN = /^[A-Z0-9]{3}-[0-9]{3}$/i;

export function classifyWormholeSignature(fields: string[]): WormholeSignatureKind {
  const text = fields.join(" ").toLowerCase();
  if (text.includes("wormhole")) return "wormhole";
  if (text.includes("gas")) return "gas";
  if (text.includes("relic")) return "relic";
  if (text.includes("data")) return "data";
  if (text.includes("combat")) return "combat";
  if (text.includes("ore")) return "ore";
  return "unknown";
}

export function parseProbeScanner(text: string): WormholeSignatureObservation[] {
  const rows = text.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  const byId = new Map<string, WormholeSignatureObservation>();
  for (const raw of rows) {
    const tabFields = raw.split("\t").map((value) => value.trim());
    const fields = tabFields.length > 1 ? tabFields : raw.split(/\s{2,}/).map((value) => value.trim()).filter(Boolean);
    const idIndex = fields.findIndex((value) => SIG_PATTERN.test(value));
    if (idIndex < 0) continue;
    const id = fields[idIndex].toUpperCase();
    const after = fields.slice(idIndex + 1);
    const strength = after.find((value) => /%$/.test(value)) ?? "";
    const strengthIndex = strength ? after.indexOf(strength) : -1;
    const distance = strengthIndex >= 0 ? after[strengthIndex + 1] ?? "" : "";
    const descriptive = strengthIndex >= 0 ? after.slice(0, strengthIndex) : after;
    byId.set(id, {
      id,
      group: descriptive[0] ?? "",
      type: descriptive[1] ?? "",
      name: descriptive.slice(2).join(" · "),
      strength,
      distance,
      kind: classifyWormholeSignature(descriptive),
      raw,
    });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
