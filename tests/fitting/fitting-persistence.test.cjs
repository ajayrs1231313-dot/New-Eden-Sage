const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../../dist-electron/fitting-persistence.js');

const fit = (id, name, extra = {}) => ({ id, name, hull: { name: 'Ishtar', quantity: 1 }, low: [], mid: [], high: [], rig: [], subsystem: [], drones: [], fighters: [], cargo: [], implants: [], boosters: [], ...extra });
const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sage-fit-store-'));

(async () => {
  {
    const root = tempRoot();
    await store.saveCanonicalFittingStore({ savedFits: [fit('a', 'Canonical')], fitLibraryMeta: { a: { createdAt: 'one' } } }, root, { allowEmptyOverwrite: true });
    const loaded = await store.hydrateCanonicalFittingStore({ savedFits: [], fitLibraryMeta: {} }, root);
    assert.equal(loaded.savedFits.length, 1);
    assert.equal(loaded.savedFits[0].name, 'Canonical');
    const protectedState = await store.saveCanonicalFittingStore({ savedFits: [], fitLibraryMeta: {} }, root);
    assert.equal(protectedState.savedFits.length, 1, 'empty browser state must not erase canonical fits');
  }

  {
    const root = tempRoot();
    const legacy = { savedFits: [fit('legacy-a', 'Legacy A'), fit('legacy-b', 'Legacy B')], fitLibraryMeta: { 'legacy-a': { createdAt: 'old' } } };
    const migrated = await store.hydrateCanonicalFittingStore(legacy, root);
    assert.deepEqual(migrated.savedFits.map((item) => item.id), ['legacy-a', 'legacy-b']);
    const again = await store.hydrateCanonicalFittingStore(legacy, root);
    assert.equal(again.savedFits.length, 2, 'repeated migration must not duplicate fits');
    assert.equal(fs.readdirSync(path.join(root, 'Backups', 'Fittings')).length, 1, 'only the actual migration should create a backup');
  }

  {
    const root = tempRoot();
    await store.saveCanonicalFittingStore({ savedFits: [fit('same', 'Canonical', { customCanonical: true }), fit('only-canonical', 'Only Canonical')], fitLibraryMeta: { same: { createdAt: 'canonical', readiness: 'ready' } } }, root, { allowEmptyOverwrite: true });
    const merged = await store.hydrateCanonicalFittingStore({ savedFits: [fit('same', 'Legacy', { legacyOnlyField: 42 }), fit('only-legacy', 'Only Legacy')], fitLibraryMeta: { same: { createdAt: 'legacy', missingRequirements: 3 }, 'only-legacy': { createdAt: 'legacy-only' } } }, root);
    assert.equal(merged.savedFits.length, 3);
    const same = merged.savedFits.find((item) => item.id === 'same');
    assert.equal(same.name, 'Canonical', 'canonical fit wins stable-ID conflicts');
    assert.equal(same.legacyOnlyField, 42, 'missing top-level legacy fields are retained safely');
    assert.equal(merged.fitLibraryMeta.same.createdAt, 'canonical');
    assert.equal(merged.fitLibraryMeta.same.missingRequirements, 3);
  }

  {
    const rootA = tempRoot();
    const rootB = tempRoot();
    await store.saveCanonicalFittingStore({ savedFits: [fit('profile-independent', 'Profile Independent')], fitLibraryMeta: {} }, rootA, { allowEmptyOverwrite: true });
    const canonicalPath = store.fittingStorePath(rootA);
    fs.mkdirSync(rootB, { recursive: true });
    assert.ok(fs.existsSync(canonicalPath));
    const fromCanonical = await store.readCanonicalFittingStore(rootA);
    assert.equal(fromCanonical.savedFits[0].id, 'profile-independent', 'canonical store is independent of Chromium profile paths');
  }

  console.log('fitting persistence regression: PASS');
})().catch((error) => { console.error(error); process.exitCode = 1; });