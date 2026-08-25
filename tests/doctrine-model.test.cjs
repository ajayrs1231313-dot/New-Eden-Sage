const assert = require('node:assert/strict');
const path = require('node:path');
const model = require(path.join(__dirname, '.tmp-doctrine-model', 'doctrine-model.js'));

const old = Array.from({ length: 5 }, (_, index) => ({ id: `legacy-${index + 1}`, slot: index + 1, name: `Doctrine ${index + 1}`, notes: '', fits: [], assignments: {}, updatedAt: null }));
old[0].fits = Array.from({ length: 12 }, (_, index) => ({ id: `fit-${index}`, fitName: `Fit ${index}`, hullName: 'Ship', hullTypeId: 1, fit: {}, addedAt: 'x' }));
old[2].notes = 'Keep this doctrine';
const migrated = model.migrateDoctrineRecords(old, '2026-08-24T00:00:00.000Z');
assert.equal(migrated.length, 2, 'empty legacy placeholders should disappear while meaningful slots survive');
assert.equal(migrated[0].fits.length, 12, 'legacy doctrine must retain more than ten fits');
assert.equal(migrated[1].notes, 'Keep this doctrine');

let rows = migrated;
for (let i = 0; i < 6; i += 1) rows = model.appendDoctrine(rows, '2026-08-24T00:00:00.000Z').records;
assert(rows.length > 5, 'doctrine count must be unbounded beyond five');
assert.equal(new Set(rows.map((row) => row.slot)).size, rows.length, 'new doctrines get distinct monotonically increasing slots');

const survivorId = rows[1].id;
const deleted = model.removeDoctrineById(rows, rows[0].id, '2026-08-24T00:00:00.000Z');
assert(deleted.some((row) => row.id === survivorId), 'deleting one doctrine cannot corrupt others');

const only = model.createDoctrineRecord(9);
const replacement = model.removeDoctrineById([only], only.id, '2026-08-24T00:00:00.000Z');
assert.equal(replacement.length, 1, 'deleting the final doctrine should leave one editable replacement');
assert.notEqual(replacement[0].id, only.id);

console.log(JSON.stringify({ migrated: true, fitsOverTen: true, doctrinesOverFive: true, deletionSafe: true }));
