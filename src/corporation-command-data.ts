export const CORPORATION_SHARED_DATASETS = [
  "assetNames",
  "assets",
  "blueprints",
  "contacts",
  "contracts",
  "divisions",
  "facilities",
  "industryJobs",
  "marketOrders",
  "medals",
  "memberLimit",
  "members",
  "memberTitles",
  "memberTracking",
  "standings",
  "starbases",
  "structures",
  "titles",
  "walletHistory",
  "wallets",
] as const;

function snapshotTime(snapshot: any) {
  const value = Date.parse(String(snapshot?.updatedAt ?? ""));
  return Number.isFinite(value) ? value : 0;
}

function unavailable(value: any) {
  return Boolean(value && typeof value === "object" && value.unavailable);
}

function usableSharedDataset(value: any) {
  if (value == null) return false;
  if (unavailable(value)) return false;
  return true;
}

export function buildCorporationReadData(
  snapshots: any[],
  corporationId: number,
  selectedCharacterId?: string | null,
) {
  const sameCorporation = snapshots
    .filter((snapshot) => Number(snapshot?.character?.corporation_id ?? 0) === Number(corporationId))
    .sort((a, b) => snapshotTime(b) - snapshotTime(a));

  const selected = sameCorporation.find((snapshot) => String(snapshot?.characterId ?? "") === String(selectedCharacterId ?? ""))
    ?? sameCorporation[0]
    ?? null;
  const selectedData = selected?.extended?.corporation ?? {};
  const merged: Record<string, any> = { ...selectedData };
  const datasetSources: Record<string, string> = {};

  for (const key of CORPORATION_SHARED_DATASETS) {
    const successful = sameCorporation.find((snapshot) => usableSharedDataset(snapshot?.extended?.corporation?.[key]));
    const fallback = successful ?? sameCorporation.find((snapshot) => snapshot?.extended?.corporation?.[key] !== undefined);
    if (!fallback) continue;
    merged[key] = fallback.extended.corporation[key];
    datasetSources[key] = String(fallback.characterId ?? "");
  }

  const publicSource = sameCorporation.find((snapshot) => {
    const value = snapshot?.extended?.corporation?.publicData ?? snapshot?.character?.corporation_data;
    return value && typeof value === "object";
  });
  const publicData = publicSource?.extended?.corporation?.publicData
    ?? publicSource?.character?.corporation_data
    ?? selectedData.publicData
    ?? selected?.character?.corporation_data
    ?? {};

  merged.publicData = publicData;

  return {
    data: merged,
    publicData,
    selectedSnapshot: selected,
    connectedCharacterCount: sameCorporation.length,
    datasetSources,
  };
}
