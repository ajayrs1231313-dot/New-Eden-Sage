import AdmZip from "adm-zip";
import { parentPort, workerData } from "node:worker_threads";

export type Ship = {
  typeId: number;
  name: string;
  groupId: number;
  groupName: string;
  metaGroupId?: number;
  metaGroupName?: string;
  factionId?: number;
  factionName?: string;
};

try {
  const zip = new AdmZip(String(workerData.archive));
  const typesEntry = zip.getEntry("types.jsonl");
  const groupsEntry = zip.getEntry("groups.jsonl");
  const metaGroupsEntry = zip.getEntry("metaGroups.jsonl");
  const factionsEntry = zip.getEntry("factions.jsonl");
  if (!typesEntry || !groupsEntry)
    throw new Error("Official EVE static data is missing ship types.");

  const shipGroups = new Map<number, string>();
  for (const line of groupsEntry.getData().toString("utf8").split(/\r?\n/)) {
    if (!line) continue;
    const group = JSON.parse(line) as { _key: number; categoryID: number; name?: { en?: string } };
    if (group.categoryID === 6) shipGroups.set(group._key, group.name?.en ?? `Group ${group._key}`);
  }

  const metaGroups = new Map<number, string>();
  for (const line of metaGroupsEntry?.getData().toString("utf8").split(/\r?\n/) ?? []) {
    if (!line) continue;
    const metaGroup = JSON.parse(line) as { _key: number; name?: { en?: string } };
    metaGroups.set(metaGroup._key, metaGroup.name?.en ?? `Meta ${metaGroup._key}`);
  }

  const factions = new Map<number, string>();
  for (const line of factionsEntry?.getData().toString("utf8").split(/\r?\n/) ?? []) {
    if (!line) continue;
    const faction = JSON.parse(line) as { _key: number; name?: { en?: string } };
    factions.set(faction._key, faction.name?.en ?? `Faction ${faction._key}`);
  }

  const ships: Ship[] = [];
  for (const line of typesEntry.getData().toString("utf8").split(/\r?\n/)) {
    if (!line) continue;
    const type = JSON.parse(line) as {
      _key: number;
      groupID: number;
      published?: boolean;
      name?: { en?: string };
      metaGroupID?: number;
      factionID?: number;
    };
    if (type.published && shipGroups.has(type.groupID) && type.name?.en)
      ships.push({
        typeId: type._key,
        name: type.name.en,
        groupId: type.groupID,
        groupName: shipGroups.get(type.groupID)!,
        metaGroupId: type.metaGroupID,
        metaGroupName: type.metaGroupID ? metaGroups.get(type.metaGroupID) : undefined,
        factionId: type.factionID,
        factionName: type.factionID ? factions.get(type.factionID) : undefined,
      });
  }
  ships.sort((a, b) => a.name.localeCompare(b.name));
  parentPort?.postMessage({ ships });
} catch (error) {
  parentPort?.postMessage({
    error: error instanceof Error ? error.message : "Could not build the EVE ship catalogue.",
  });
}
