const assert = require('node:assert/strict');
const dogma = require('../../dist-electron/fitting-dogma.js');

const snapshot = (levels = {}) => ({
  character: { name: 'Wargame command burst regression' },
  skills: { total_sp: 0, skills: Object.entries(levels).map(([skill_id, trained_skill_level]) => ({ skill_id:Number(skill_id), trained_skill_level })) },
  extended: { implants: [] },
});

(async () => {
  const wanted = [
    'Vulture',
    'Shield Command Burst II',
    'Shield Harmonizing Charge',
    'Shield Command',
    'Shield Command Specialist',
    'Command Burst Specialist',
    'Leadership',
  ];
  const resolved = await dogma.resolveFittingTypeNamesLocal(wanted);
  const ids = new Map(resolved.map((entry) => [entry.name, entry.id]));
  const id = (name) => { const value=ids.get(name); assert.ok(value, `Missing SDE type ${name}`); return value; };

  const result = await dogma.analyzeFittingDogma({
    hullTypeId:id('Vulture'),
    items:[{
      typeId:id('Shield Command Burst II'),
      chargeTypeId:id('Shield Harmonizing Charge'),
      rack:'high',
      quantity:1,
      state:'active',
    }],
    snapshot:snapshot({
      [id('Leadership')]:5,
      [id('Shield Command')]:5,
      [id('Shield Command Specialist')]:5,
      [id('Command Burst Specialist')]:5,
    }),
  });

  const burst = result.supportSystems.find((system) => system.kind === 'commandBurst');
  assert.ok(burst, 'fitted command burst must be exported to Wargame support systems');
  assert.ok(burst.optimalM > 0, 'command burst range must be exported');
  assert.ok(Array.isArray(burst.buffs) && burst.buffs.length > 0, 'loaded warfare charge must expose its DBuff payload');
  const harmonizing = burst.buffs.find((buff) => buff.buffId === 10);
  assert.ok(harmonizing, 'Shield Harmonizing must expose CCP DBuff 10');
  assert.notEqual(harmonizing.value, 0, 'skill/hull-adjusted Shield Harmonizing value must be non-zero');
  assert.match(String(harmonizing.description), /Shield Burst: Shield Harmonizing/i, 'DBuff description should come from CCP DBuff data');

  console.log('wargame command burst regression: PASS');
})().catch((error) => { console.error(error); process.exitCode=1; });
