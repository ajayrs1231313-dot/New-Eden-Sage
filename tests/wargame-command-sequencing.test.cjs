const assert = require('node:assert/strict');
const fs = require('node:fs');

const fleet = fs.readFileSync('src/FleetCommand.tsx', 'utf8');
const bridge = fs.readFileSync('src/wargame-fit-bridge.ts', 'utf8');
const model = fs.readFileSync('src/wargame-command-model.ts', 'utf8');

assert.match(bridge, /damageSources: WargameDamageSource\[\]/, 'fit bridge must expose independent damage sources');
assert.match(bridge, /weaponDamageSources/, 'fit bridge must retain fitted weapons as sources');
assert.match(bridge, /droneDamageSources/, 'fit bridge must retain drones as a separate source family');
assert.match(bridge, /environmentTypeIds/, 'fit bridge must pass system/environment effects into DOGMA');
assert.match(fleet, /source\.targetId/, 'simulation must resolve targets per damage source');
assert.match(fleet, /droneArrivalRemaining/, 'drone channel must model travel before application');
assert.match(model, /sourceTargets: Record<string, string \| undefined>/, 'order model must carry per-source targets');
assert.match(model, /completion: WargameOrderCompletion/, 'order steps must have completion conditions');
assert.match(fleet, /FC ORDER CHAIN/, 'command inspector must expose the FC sequence editor');
assert.match(fleet, /SYSTEM EFFECTS/, 'wargame must expose system effects');
assert.match(fleet, /TACKLE \/ OFFENSIVE EWAR/, 'order steps must separate tackle\/EWAR from weapon targets');

console.log('wargame command sequencing regression: PASS');
