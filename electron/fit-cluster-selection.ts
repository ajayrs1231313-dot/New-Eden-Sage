export type FitTankFamily = "shield" | "armor" | "other";

export function fitTankFamilyFromNames(names: string[]): FitTankFamily {
  const text = names.join(" ").toLowerCase();
  if (/armor repair|armour repair|armor plate|armour plate|energized|membrane|armor hardener|armour hardener|reactive armor|reactive armour/.test(text)) return "armor";
  if (/shield booster|shield extender|shield hardener|multispectrum shield|shield resistance/.test(text)) return "shield";
  return "other";
}

export function selectDiverseFitClusters<T>(
  clusters: T[][],
  classify: (cluster: T[]) => FitTankFamily,
  limit = 4,
): T[][] {
  if (limit <= 0) return [];
  const ranked = [...clusters].sort((a, b) => b.length - a.length);
  const selected: T[][] = [];
  const add = (cluster: T[] | undefined) => {
    if (cluster && !selected.includes(cluster) && selected.length < limit) selected.push(cluster);
  };

  const shield = ranked.find((cluster) => classify(cluster) === "shield");
  const armor = ranked.find((cluster) => classify(cluster) === "armor");
  if (shield && armor) {
    add(shield);
    add(armor);
  }

  for (const cluster of ranked) add(cluster);
  return selected.sort((a, b) => b.length - a.length);
}
