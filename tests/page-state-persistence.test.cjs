const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { promisify } = require("node:util");

const gzip = promisify(zlib.gzip);
const tempRoot = path.join(os.tmpdir(), `new-eden-sage-page-state-${process.pid}-${Date.now()}`);
process.env.NEW_EDEN_SAGE_USER_DATA = tempRoot;

const {
  PAGE_STATE_CACHE_KIND,
  PAGE_STATE_SCHEMA_VERSION,
  loadLastKnownGoodPageState,
  pageStatePersistenceKey,
  saveLastKnownGoodPageState,
} = require("../dist-electron/page-state-persistence.js");
const { savePersistedResult } = require("../dist-electron/persistent-result-cache.js");

function scope(id) {
  return { kind: "character", id };
}

function validatorFor(characterId) {
  return (value) => Boolean(
    value
    && typeof value === "object"
    && value.characterId === characterId
    && value.complete === true
    && Array.isArray(value.rows)
  );
}

function cacheFile(moduleId, targetScope) {
  const key = pageStatePersistenceKey(moduleId, targetScope);
  const hash = crypto.createHash("sha256").update(JSON.stringify(key)).digest("hex");
  return path.join(tempRoot, "Analysis Cache", `${PAGE_STATE_CACHE_KIND}-${hash}.json.gz`);
}

async function rawEnvelope(moduleId, targetScope, payload, overrides = {}) {
  return {
    schemaVersion: PAGE_STATE_SCHEMA_VERSION,
    moduleId,
    scope: targetScope,
    source: { revision: "r1" },
    savedAt: "2026-08-31T12:00:00.000Z",
    payload,
    ...overrides,
  };
}

(async () => {
  try {
    const moduleId = "test.market";
    const alphaScope = scope("alpha");
    const betaScope = scope("beta");
    const alphaValidator = validatorFor("alpha");

    const first = { characterId: "alpha", complete: true, rows: [{ id: 1 }] };
    assert.equal(await saveLastKnownGoodPageState({
      moduleId,
      scope: alphaScope,
      source: { characterRevision: "a1", marketRevision: "m1" },
      payload: first,
      validatePayload: alphaValidator,
      savedAt: "2026-08-31T12:00:00.000Z",
    }), true, "valid coherent state should save");

    const roundTrip = await loadLastKnownGoodPageState({ moduleId, scope: alphaScope, validatePayload: alphaValidator });
    assert.deepEqual(roundTrip?.payload, first, "valid envelope should round-trip");
    assert.equal(roundTrip?.source.marketRevision, "m1", "source revision metadata should round-trip");

    const replacement = { characterId: "alpha", complete: true, rows: [{ id: 2 }] };
    assert.equal(await saveLastKnownGoodPageState({
      moduleId,
      scope: alphaScope,
      source: { characterRevision: "a2", marketRevision: "m2" },
      payload: replacement,
      validatePayload: alphaValidator,
      savedAt: "2026-08-31T12:05:00.000Z",
    }), true, "successful replacement should advance LKG");
    assert.deepEqual((await loadLastKnownGoodPageState({ moduleId, scope: alphaScope, validatePayload: alphaValidator }))?.payload, replacement);

    const partial = { characterId: "alpha", complete: false, rows: [] };
    assert.equal(await saveLastKnownGoodPageState({
      moduleId,
      scope: alphaScope,
      source: { characterRevision: "bad" },
      payload: partial,
      validatePayload: alphaValidator,
    }), false, "partial/invalid result must not replace LKG");
    assert.deepEqual((await loadLastKnownGoodPageState({ moduleId, scope: alphaScope, validatePayload: alphaValidator }))?.payload, replacement);

    const zeroResult = { characterId: "alpha", complete: true, rows: [] };
    assert.equal(await saveLastKnownGoodPageState({
      moduleId,
      scope: alphaScope,
      source: { characterRevision: "a3", marketRevision: "m3" },
      payload: zeroResult,
      validatePayload: alphaValidator,
    }), true, "legitimate completed zero-result state must be persistable");
    assert.deepEqual((await loadLastKnownGoodPageState({ moduleId, scope: alphaScope, validatePayload: alphaValidator }))?.payload, zeroResult);

    assert.equal(await loadLastKnownGoodPageState({ moduleId, scope: betaScope, validatePayload: validatorFor("beta") }), undefined, "another character must never receive alpha state");

    const badSavePayload = {
      characterId: "alpha",
      complete: true,
      rows: [{ id: 999 }],
      toJSON() { throw new Error("simulated serialization failure"); },
    };
    assert.equal(await saveLastKnownGoodPageState({
      moduleId,
      scope: alphaScope,
      source: { characterRevision: "failed-write" },
      payload: badSavePayload,
      validatePayload: alphaValidator,
    }), false, "serialization/write failure should be contained");
    assert.deepEqual((await loadLastKnownGoodPageState({ moduleId, scope: alphaScope, validatePayload: alphaValidator }))?.payload, zeroResult, "failed save must preserve the previous LKG");

    const schemaScope = scope("schema");
    await savePersistedResult(PAGE_STATE_CACHE_KIND, pageStatePersistenceKey(moduleId, schemaScope), await rawEnvelope(moduleId, schemaScope, { characterId: "schema", complete: true, rows: [] }, { schemaVersion: PAGE_STATE_SCHEMA_VERSION + 1 }));
    assert.equal(await loadLastKnownGoodPageState({ moduleId, scope: schemaScope, validatePayload: validatorFor("schema") }), undefined, "schema mismatch must be ignored");

    const wrongModuleScope = scope("wrong-module");
    await savePersistedResult(PAGE_STATE_CACHE_KIND, pageStatePersistenceKey(moduleId, wrongModuleScope), await rawEnvelope("another.module", wrongModuleScope, { characterId: "wrong-module", complete: true, rows: [] }));
    assert.equal(await loadLastKnownGoodPageState({ moduleId, scope: wrongModuleScope, validatePayload: validatorFor("wrong-module") }), undefined, "wrong module envelope must be ignored");

    const wrongScope = scope("wrong-scope-key");
    await savePersistedResult(PAGE_STATE_CACHE_KIND, pageStatePersistenceKey(moduleId, wrongScope), await rawEnvelope(moduleId, scope("someone-else"), { characterId: "wrong-scope-key", complete: true, rows: [] }));
    assert.equal(await loadLastKnownGoodPageState({ moduleId, scope: wrongScope, validatePayload: validatorFor("wrong-scope-key") }), undefined, "wrong embedded character scope must be ignored");

    const corruptGzipScope = scope("corrupt-gzip");
    await fs.mkdir(path.dirname(cacheFile(moduleId, corruptGzipScope)), { recursive: true });
    await fs.writeFile(cacheFile(moduleId, corruptGzipScope), Buffer.from("not-gzip"));
    assert.equal(await loadLastKnownGoodPageState({ moduleId, scope: corruptGzipScope, validatePayload: validatorFor("corrupt-gzip") }), undefined, "corrupt gzip must be ignored");

    const corruptJsonScope = scope("corrupt-json");
    await fs.writeFile(cacheFile(moduleId, corruptJsonScope), await gzip(Buffer.from("{not-json", "utf8")));
    assert.equal(await loadLastKnownGoodPageState({ moduleId, scope: corruptJsonScope, validatePayload: validatorFor("corrupt-json") }), undefined, "corrupt JSON must be ignored");

    console.log("Page-state persistence regression checks passed");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
