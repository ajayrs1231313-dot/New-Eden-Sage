import AdmZip from "adm-zip";
import path from "node:path";
import { STATIC_DATA_ROOT } from "./data-paths";
import { ensureStaticDataArchive } from "./type-volumes";

const SDE_ARCHIVE = path.join(STATIC_DATA_ROOT, "eve-static-data-jsonl.zip");

type NavigationStaticMetadata = {
  npcStationCountBySystem: Map<number, number>;
};

let metadataPromise: Promise<NavigationStaticMetadata> | null = null;

export async function getNavigationStaticMetadata(): Promise<NavigationStaticMetadata> {
  if (metadataPromise) return metadataPromise;
  metadataPromise = Promise.resolve().then(async () => {
    await ensureStaticDataArchive();
    const zip = new AdmZip(SDE_ARCHIVE);
    const stationsEntry = zip.getEntry("npcStations.jsonl");
    if (!stationsEntry) throw new Error("Official EVE static data is missing NPC station data.");
    const npcStationCountBySystem = new Map<number, number>();
    for (const line of stationsEntry.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const row = JSON.parse(line) as { solarSystemID?: number };
      const systemId = Number(row.solarSystemID ?? 0);
      if (!Number.isSafeInteger(systemId) || systemId <= 0) continue;
      npcStationCountBySystem.set(systemId, (npcStationCountBySystem.get(systemId) ?? 0) + 1);
    }
    return { npcStationCountBySystem };
  });
  return metadataPromise;
}
