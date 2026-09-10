export function advanceFitterActiveQuantity(stored: number | undefined, baseline: number, delta: number, itemQuantity: number, maxAllowed: number) {
  const current = stored == null ? Math.max(0, Math.floor(baseline)) : Math.max(0, Math.floor(stored));
  const legalMax = Math.max(0, Math.min(Math.floor(itemQuantity), Math.floor(maxAllowed)));
  return Math.max(0, Math.min(legalMax, current + Math.sign(delta)));
}
