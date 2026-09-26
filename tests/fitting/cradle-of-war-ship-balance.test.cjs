const assert = require('node:assert/strict');
const dogma = require('../../dist-electron/fitting-dogma.js');

const approx = (actual, expected, tolerance = 1e-9, label = 'value') => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
};

(async () => {
  const names = [
    'Harpy','Hawk','Ishkur','Vengeance','Cerberus','Sacrilege','Eagle','Deimos','Vigilant','Phobos',
    'Bane','Karura','Hubris','Valravn',
    '150mm Railgun II','250mm Railgun II','Antimatter Charge S','Antimatter Charge M',
    'Light Missile Launcher II','Inferno Light Missile',
    'Heavy Assault Missile Launcher II','Inferno Heavy Assault Missile',
    'Hobgoblin II','Drones','Light Drone Operation',
    'Caldari Frigate','Gallente Frigate','Amarr Frigate','Assault Frigates',
    'Caldari Cruiser','Gallente Cruiser','Heavy Assault Cruisers','Heavy Interdiction Cruisers',
  ];
  const resolved = await dogma.resolveFittingTypeNamesLocal(names);
  const id = new Map(resolved.map((row) => [row.name, row.id]));
  for (const name of names) assert.ok(id.get(name), `Missing current SDE type: ${name}`);

  const snapshot = (levels = {}) => ({
    character: { name: 'Cradle of War ship balance' },
    skills: { total_sp: 0, skills: Object.entries(levels).map(([skill_id, trained_skill_level]) => ({ skill_id: Number(skill_id), trained_skill_level })) },
    extended: { implants: [] },
  });
  const level = (name, value) => ({ [id.get(name)]: value });
  const fit = (hull, items, levels) => dogma.analyzeFittingDogma({ hullTypeId: id.get(hull), items, snapshot: snapshot(levels) });
  const smallRail = { typeId:id.get('150mm Railgun II'), rack:'high', quantity:1, state:'active', chargeTypeId:id.get('Antimatter Charge S') };
  const mediumRail = { typeId:id.get('250mm Railgun II'), rack:'high', quantity:1, state:'active', chargeTypeId:id.get('Antimatter Charge M') };
  const lightMissile = { typeId:id.get('Light Missile Launcher II'), rack:'high', quantity:1, state:'active', chargeTypeId:id.get('Inferno Light Missile') };
  const ham = { typeId:id.get('Heavy Assault Missile Launcher II'), rack:'high', quantity:1, state:'active', chargeTypeId:id.get('Inferno Heavy Assault Missile') };

  const compare = async (hull, item, skill) => {
    const zero = await fit(hull, [item], level(skill, 0));
    const five = await fit(hull, [item], level(skill, 5));
    return { zero, five, p0:zero.damage.weaponProfiles[0], p5:five.damage.weaponProfiles[0] };
  };

  const harpyCf = await compare('Harpy', smallRail, 'Caldari Frigate');
  approx(harpyCf.p5.optimalM / harpyCf.p0.optimalM, 1.75, 1e-9, 'Harpy Caldari Frigate optimal');
  const harpyAf = await compare('Harpy', smallRail, 'Assault Frigates');
  approx(harpyAf.p5.tracking / harpyAf.p0.tracking, 1.25, 1e-9, 'Harpy Assault Frigates tracking');

  const hawkAf = await compare('Hawk', lightMissile, 'Assault Frigates');
  approx(hawkAf.p5.volley / hawkAf.p0.volley, 1.375, 1e-9, 'Hawk Assault Frigates all-damage volley');
  const hawkCf = await compare('Hawk', lightMissile, 'Caldari Frigate');
  approx(hawkCf.p5.volley / hawkCf.p0.volley, 1, 1e-9, 'Hawk Caldari Frigate must not scale all-damage volley');

  const droneItem = { typeId:id.get('Hobgoblin II'), rack:'drone', quantity:5, activeQuantity:5 };
  const droneCore = { [id.get('Drones')]:5, [id.get('Light Drone Operation')]:5 };
  const ishkur0 = await fit('Ishkur', [droneItem], { ...droneCore, [id.get('Gallente Frigate')]:0 });
  const ishkur5 = await fit('Ishkur', [droneItem], { ...droneCore, [id.get('Gallente Frigate')]:5 });
  assert.equal(ishkur0.damage.activeDrones.length, 5);
  approx(ishkur5.damage.activeDrones[0].tracking / ishkur0.damage.activeDrones[0].tracking, 1.5, 1e-9, 'Ishkur Gallente Frigate drone tracking');

  const vengeance = await compare('Vengeance', lightMissile, 'Amarr Frigate');
  approx(vengeance.p5.volley / vengeance.p0.volley, 1.375, 1e-9, 'Vengeance Light Missile damage');

  const cerberus = await compare('Cerberus', lightMissile, 'Caldari Cruiser');
  approx(cerberus.p5.volley / cerberus.p0.volley, 1.125, 1e-9, 'Cerberus all-damage missile bonus');

  const sacrilege = await compare('Sacrilege', ham, 'Heavy Assault Cruisers');
  approx(sacrilege.p5.cycleSeconds / sacrilege.p0.cycleSeconds, 0.625, 1e-9, 'Sacrilege HAC RoF');

  const eagle = await compare('Eagle', mediumRail, 'Heavy Assault Cruisers');
  approx(eagle.p5.volley / eagle.p0.volley, 1.375, 1e-9, 'Eagle HAC hybrid damage');

  const deimos = await compare('Deimos', mediumRail, 'Heavy Assault Cruisers');
  approx(deimos.p5.falloffM / deimos.p0.falloffM, 1.75, 1e-9, 'Deimos HAC falloff');

  const vigilant = await compare('Vigilant', mediumRail, 'Gallente Cruiser');
  approx(vigilant.p5.falloffM / vigilant.p0.falloffM, 1.75, 1e-9, 'Vigilant Gallente Cruiser falloff');

  const phobos = await compare('Phobos', mediumRail, 'Heavy Interdiction Cruisers');
  approx(phobos.p5.optimalM / phobos.p0.optimalM, 1.75, 1e-9, 'Phobos HIC optimal');

  const expectedResists = {
    Bane:   { shield:[null,null,0.55,0.725], armor:[null,null,0.475,0.55] },
    Karura: { shield:[null,0.60,0.55,null], armor:[null,0.625,0.50,null] },
    Hubris: { shield:[null,0.40,0.70,null], armor:[null,0.55,0.65,null] },
    Valravn:{ shield:[0.45,0.40,null,null], armor:[0.80,0.50,null,null] },
  };
  for (const [hull, expected] of Object.entries(expectedResists)) {
    const result = await fit(hull, [], {});
    expected.shield.forEach((value, index) => { if (value != null) approx(result.defence.shieldResists[index], value, 1e-9, `${hull} shield resist ${index}`); });
    expected.armor.forEach((value, index) => { if (value != null) approx(result.defence.armorResists[index], value, 1e-9, `${hull} armor resist ${index}`); });
  }

  console.log(JSON.stringify({
    assaultFrigates:['Harpy','Hawk','Ishkur','Vengeance'],
    heavyAssaultCruisers:['Cerberus','Sacrilege','Eagle','Deimos'],
    rangeHullChanges:['Vigilant','Phobos'],
    lancerResists:Object.keys(expectedResists),
    hawkAuthoritativePatchOverlay:true,
  }, null, 2));
  console.log('CRADLE OF WAR SHIP BALANCE REGRESSION: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
