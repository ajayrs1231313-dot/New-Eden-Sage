import AdmZip from "adm-zip";
import path from "node:path";
import { STATIC_DATA_ROOT } from "./data-paths";
import { ensureStaticDataArchive } from "./type-volumes";

const SDE_ARCHIVE = path.join(STATIC_DATA_ROOT, "eve-static-data-jsonl.zip");

export type PveSystemStatic = {
  systemId: number;
  name: string;
  systemName: string;
  regionId: number;
  regionName: string;
  constellationId: number;
  constellationName: string;
  securityStatus: number;
  securityBand: "high" | "low" | "null";
};

export type MissionStagingStatic = {
  systemId: number;
  corporationId: number;
  corporationName: string;
  factionId: number | null;
  factionName: string | null;
  stationCount: number;
};

type PveStaticIndex = {
  systems: Map<number, PveSystemStatic>;
  missionStaging: MissionStagingStatic[];
};

let indexPromise: Promise<PveStaticIndex> | null = null;

function en(value?: { en?: string } | string) {
  return typeof value === "string" ? value : value?.en ?? "";
}

function securityBand(value: number): PveSystemStatic["securityBand"] {
  if (value >= 0.45) return "high";
  if (value > 0) return "low";
  return "null";
}

export async function getPveStaticIndex(): Promise<PveStaticIndex> {
  if (indexPromise) return indexPromise;
  indexPromise = Promise.resolve().then(async () => {
    await ensureStaticDataArchive();
    const zip = new AdmZip(SDE_ARCHIVE);
    const regionsEntry = zip.getEntry("mapRegions.jsonl");
    const constellationsEntry = zip.getEntry("mapConstellations.jsonl");
    const systemsEntry = zip.getEntry("mapSolarSystems.jsonl");
    const corporationsEntry = zip.getEntry("npcCorporations.jsonl");
    const factionsEntry = zip.getEntry("factions.jsonl");
    const stationsEntry = zip.getEntry("npcStations.jsonl");
    if (!regionsEntry || !constellationsEntry || !systemsEntry || !corporationsEntry || !factionsEntry || !stationsEntry)
      throw new Error("Official EVE static data is missing PvE location lookup data.");

    const regionNames = new Map<number, string>();
    for (const line of regionsEntry.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const row = JSON.parse(line) as { _key: number; name?: { en?: string } };
      regionNames.set(row._key, en(row.name) || `Region ${row._key}`);
    }

    const constellationNames = new Map<number, string>();
    for (const line of constellationsEntry.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const row = JSON.parse(line) as { _key: number; name?: { en?: string } };
      constellationNames.set(row._key, en(row.name) || `Constellation ${row._key}`);
    }

    const systems = new Map<number, PveSystemStatic>();
    for (const line of systemsEntry.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const row = JSON.parse(line) as {
        _key: number;
        name?: { en?: string };
        regionID: number;
        constellationID: number;
        securityStatus: number;
      };
      const name = en(row.name);
      if (!name) continue;
      systems.set(row._key, {
        systemId: row._key,
        name,
        systemName: name,
        regionId: row.regionID,
        regionName: regionNames.get(row.regionID) ?? `Region ${row.regionID}`,
        constellationId: row.constellationID,
        constellationName: constellationNames.get(row.constellationID) ?? `Constellation ${row.constellationID}`,
        securityStatus: Number(row.securityStatus ?? -1),
        securityBand: securityBand(Number(row.securityStatus ?? -1)),
      });
    }

    const factions = new Map<number, string>();
    for (const line of factionsEntry.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const row = JSON.parse(line) as { _key: number; name?: { en?: string } };
      factions.set(row._key, en(row.name) || `Faction ${row._key}`);
    }

    const corporations = new Map<number, { name: string; factionId: number | null; mainActivityId: number | null }>();
    for (const line of corporationsEntry.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const row = JSON.parse(line) as { _key: number; name?: { en?: string }; factionID?: number; mainActivityID?: number };
      corporations.set(row._key, {
        name: en(row.name) || `NPC corporation ${row._key}`,
        factionId: row.factionID ?? null,
        mainActivityId: row.mainActivityID ?? null,
      });
    }

    const staging = new Map<string, MissionStagingStatic>();
    for (const line of stationsEntry.getData().toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      const row = JSON.parse(line) as { ownerID: number; solarSystemID: number };
      const corp = corporations.get(row.ownerID);
      const system = systems.get(row.solarSystemID);
      if (!corp || !system || corp.mainActivityId !== 5 || system.securityBand !== "high") continue;
      const key = `${row.solarSystemID}:${row.ownerID}`;
      const current = staging.get(key) ?? {
        systemId: row.solarSystemID,
        corporationId: row.ownerID,
        corporationName: corp.name,
        factionId: corp.factionId,
        factionName: corp.factionId ? factions.get(corp.factionId) ?? `Faction ${corp.factionId}` : null,
        stationCount: 0,
      };
      current.stationCount += 1;
      staging.set(key, current);
    }

    return { systems, missionStaging: [...staging.values()] };
  });
  return indexPromise;
}
