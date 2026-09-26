const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const activity = fs.readFileSync(path.join(root, 'src', 'activity-planner-data.ts'), 'utf8');
const fittings = fs.readFileSync(path.join(root, 'src', 'Fittings.tsx'), 'utf8');

for (const token of [
  'fw-insurgency',
  'Moderate ADV-3',
  'Drekavac',
  '52,500 LP',
  '1.5% corruption/suppression',
  '1,500,000 LP',
  '150,000 LP',
  '4-hour respawn',
  'Mining Ambush is now ADV-5',
  'Small AF-1',
  '25,000 LP base / 37,500 LP frontline',
  '33% in C1-C3 / 25% in C4 / 20% in C5-C6',
  'Interdictors 20% NPC damage taken',
  '18/15/12/6-second',
  'updated engagement/warp distances',
]) assert.ok(activity.includes(token), 'Activity Planner missing Cradle of War reference: ' + token);

for (const token of [
  'Vigilance Point',
  'Optimal fleet size is now 12 (down from 15)',
  'Optimal fleet size is now 12 (up from 10)',
  'within 50 km of the Vigilance Spire',
  '30-minute interval',
  '75 km from the wormhole',
  'Stirring NPC damage to drones is doubled',
]) assert.ok(fittings.includes(token), 'Fitter Pochven surface missing Cradle of War reference: ' + token);

console.log(JSON.stringify({
  factionWarfareAndInsurgency: true,
  rampantDroneFabricator: true,
  pochvenFleetAndPayoutRules: true,
}, null, 2));
console.log('CRADLE OF WAR SURFACE REGRESSION: PASS');
