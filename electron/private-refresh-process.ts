import { fetchCharacterSnapshot } from "./eve";
import { getSnapshot, saveSnapshot } from "./database";
import { configurePrivateEsiEncryptionKey } from "./private-esi-cache";
import { configureSnapshotEncryptionKey } from "./snapshot-crypto";

type PrivateRefreshInput = {
  characters: Array<{ characterId: string; accessToken: string }>;
  privateDataKey: string;
};

type PrivateRefreshFailure = { characterId: string; error: string };

function send(message: unknown) {
  process.send?.(message);
}

function finish(message: unknown) {
  if (typeof process.send !== "function") {
    process.exitCode = 1;
    return;
  }
  process.send(message, () => {
    if (process.connected) process.disconnect?.();
    setImmediate(() => process.exit(0));
  });
}

async function run(input: PrivateRefreshInput) {
  configurePrivateEsiEncryptionKey(String(input?.privateDataKey ?? ""));
  configureSnapshotEncryptionKey(String(input?.privateDataKey ?? ""));
  const characters = Array.isArray(input?.characters) ? input.characters : [];
  if (!characters.length) {
    finish({ type: "complete", refreshed: 0, failed: [] });
    return;
  }

  const failed: PrivateRefreshFailure[] = [];
  let refreshed = 0;

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const characterNumber = index + 1;
    try {
      send({
        type: "progress",
        characterId: character.characterId,
        stage: "private-character-start",
        percent: Math.round((index / characters.length) * 100),
        completed: index,
        total: characters.length,
        message: `Refreshing private data ${characterNumber}/${characters.length}.`,
      });

      const existingSnapshot = getSnapshot(character.characterId);
      const snapshot = await fetchCharacterSnapshot(character.characterId, character.accessToken, (progress) => {
        const overall = ((index + Math.max(0, Math.min(100, progress.percent)) / 100) / characters.length) * 100;
        send({
          type: "progress",
          characterId: character.characterId,
          stage: progress.stage,
          percent: Math.min(99, Math.round(overall)),
          completed: index,
          total: characters.length,
          message: progress.message,
        });
      }, existingSnapshot);

      send({
        type: "progress",
        characterId: character.characterId,
        stage: "private-save",
        percent: Math.min(99, Math.round(((index + 0.98) / characters.length) * 100)),
        completed: index,
        total: characters.length,
        message: "Saving refreshed private snapshot locally.",
      });
      saveSnapshot(snapshot);
      refreshed += 1;
      send({
        type: "progress",
        characterId: character.characterId,
        stage: "private-character-complete",
        percent: Math.round((characterNumber / characters.length) * 100),
        completed: characterNumber,
        total: characters.length,
        message: `Private data refreshed ${characterNumber}/${characters.length}.`,
      });
    } catch (error) {
      failed.push({
        characterId: character.characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      send({
        type: "progress",
        characterId: character.characterId,
        stage: "private-character-failed",
        percent: Math.round((characterNumber / characters.length) * 100),
        completed: characterNumber,
        total: characters.length,
        message: `Private refresh failed for character ${characterNumber}/${characters.length}.`,
      });
    }
  }

  finish({ type: "complete", refreshed, failed });
}

process.once("message", (message) => {
  void run(message as PrivateRefreshInput).catch((error) => {
    finish({ type: "error", error: error instanceof Error ? error.message : String(error) });
  });
});
