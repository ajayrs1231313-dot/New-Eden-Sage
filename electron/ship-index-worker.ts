import AdmZip from "adm-zip";
import { parentPort, workerData } from "node:worker_threads";

type Ship = { typeId: number; name: string };

try {
  const zip = new AdmZip(String(workerData.archive));
  const typesEntry = zip.getEntry("types.jsonl");
  const groupsEntry = zip.getEntry("groups.jsonl");
  if (!typesEntry || !groupsEntry)
    throw new Error("Official EVE static data is missing ship types.");

  const shipGroups = new Set<number>();
  for (const line of groupsEntry.getData().toString("utf8").split(/\r?\n/)) {
    if (!line) continue;
    const group = JSON.parse(line) as { _key: number; categoryID: number };
    if (group.categoryID === 6) shipGroups.add(group._key);
  }

  const ships: Ship[] = [];
  for (const line of typesEntry.getData().toString("utf8").split(/\r?\n/)) {
    if (!line) continue;
    const type = JSON.parse(line) as {
      _key: number;
      groupID: number;
      published?: boolean;
      name?: { en?: string };
    };
    if (type.published && shipGroups.has(type.groupID) && type.name?.en)
      ships.push({ typeId: type._key, name: type.name.en });
  }
  ships.sort((a, b) => a.name.localeCompare(b.name));
  parentPort?.postMessage({ ships });
} catch (error) {
  parentPort?.postMessage({
    error: error instanceof Error ? error.message : "Could not build the EVE ship catalogue.",
  });
}
