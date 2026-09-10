const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('src/App.tsx', 'utf8');
const main = fs.readFileSync('electron/main-task9.ts', 'utf8');
const distDb = fs.readFileSync('dist-electron/database.js', 'utf8');

assert.ok(app.includes('function useVisibleValue<T>(value: T, visible: boolean): T'), 'cached workspaces need a visible-only character value');
assert.ok(app.includes('const overviewSnapshot = useVisibleValue(active, view === "overview")'), 'hidden Character Command must not receive character switches');
assert.ok(app.includes('const fittingsCharacterId = useVisibleValue(activeId, view === "fittings")'), 'hidden Fitting Command must not receive character switches');
assert.ok(app.includes('const wormholeCharacterId = useVisibleValue(active?.characterId, view === "wormholes")'), 'hidden Wormhole Command must not receive character switches');
assert.ok(app.includes('const industrialCharacterId = useVisibleValue(active?.characterId, view === "industrial")'), 'hidden Industrial Command must not receive character switches');
assert.ok(app.includes('const killmailSnapshots = useVisibleValue(snapshots, active && tab === "killmails")'), 'hidden Character Command subtabs must retain their previous character data');
assert.ok(app.includes('const walletSnapshot = useVisibleValue(snapshot, active && tab === "wallet")'), 'hidden Asset Command wallet must retain its previous character data');

const refresh = app.slice(app.indexOf('async function refreshPrivateData()'), app.indexOf('useEffect(() => window.sage.onMasterUpdateProgress'));
assert.ok(refresh.includes('config.connectedCharacterIds.includes(selectedCharacterId)'), 'private refresh must check whether the selected character is connected');
assert.ok(refresh.includes('config.reauthorizationRequiredCharacterIds.includes(selectedCharacterId)'), 'private refresh must detect one-time ESI reauthorization');
assert.ok(refresh.includes('await connect();'), 'refresh should route reauthorization directly through EVE SSO instead of hammering the worker');

const migration = main.slice(main.indexOf('const ESI_SCOPE_MIGRATION_LOCK_PATH'), main.indexOf('async function planetaryCorporationContext'));
assert.ok(migration.includes('fs.open(ESI_SCOPE_MIGRATION_LOCK_PATH, "wx")'), 'ESI scope migration must use a cross-process exclusive lock');
const lockedRead = migration.indexOf('const config = await readConfig()');
const lockAcquire = migration.indexOf('fs.open(ESI_SCOPE_MIGRATION_LOCK_PATH, "wx")');
assert.ok(lockedRead > lockAcquire, 'scope migration must re-read shared settings only after acquiring the lock');

const listStart = distDb.indexOf('function listSnapshots()');
const getStart = distDb.indexOf('function getSnapshot(');
const migrateStart = distDb.indexOf('function migratePlaintextSnapshotsToEncrypted');
assert.ok(listStart >= 0 && getStart > listStart && migrateStart > getStart, 'compiled snapshot reader functions must exist');
const listBlock = distDb.slice(listStart, getStart);
const getBlock = distDb.slice(getStart, migrateStart);
assert.ok(listBlock.includes('decryptSnapshotPayload'), 'compiled listSnapshots must decrypt encrypted snapshot payloads');
assert.ok(getBlock.includes('decryptSnapshotPayload'), 'compiled getSnapshot must decrypt encrypted snapshot payloads');
assert.ok(!listBlock.includes('JSON.parse(row.payload)'), 'compiled listSnapshots must never raw-parse encrypted snapshot payloads');
assert.ok(!getBlock.includes('JSON.parse(row.payload)'), 'compiled getSnapshot must never raw-parse encrypted snapshot payloads');

console.log('Private refresh, encrypted snapshot runtime, and character-switch isolation checks passed');
