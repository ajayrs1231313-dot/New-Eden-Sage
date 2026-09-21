const assert = require('node:assert/strict');
const dogma = require('../../dist-electron/fitting-dogma.js');

const snapshot = { character:{name:'fighter-ability-deep-regression'}, skills:{total_sp:0,skills:[]}, extended:{implants:[]} };
const resolve = async (names) => new Map((await dogma.resolveFittingTypeNamesLocal(names)).map((entry)=>[entry.name,entry.id]));

(async()=>{
  const names=['Thanatos','Nyx','Equite I','Siren I','Firbolg I','Ametat I','Shadow'];
  const m=await resolve(names);
  for(const name of names) assert.ok(m.get(name),`Missing SDE type ${name}`);
  const analyze=(hull,fighter)=>dogma.analyzeFittingDogma({hullTypeId:m.get(hull),items:[{typeId:m.get(fighter),rack:'fighter-active',quantity:1,state:'active'}],snapshot});

  const equite=await analyze('Thanatos','Equite I');
  const equiteProfile=equite.fighterSystem.abilityProfiles.find((row)=>row.typeId===m.get('Equite I'));
  assert.ok(equiteProfile,'space-superiority fighter ability profile missing');
  const tackle=equiteProfile.abilities.find((ability)=>ability.ability==='tackle');
  assert.ok(tackle,'fighterAbilityTackle must be surfaced');
  assert.equal(tackle.cycleSeconds,10);
  assert.equal(tackle.rangeM,18000);
  assert.equal(tackle.speedPenaltyPerFighter,-4);
  assert.equal(tackle.warpStrengthPerFighter,1);
  const tackleSystem=equite.fighterSystem.supportSystems.find((system)=>system.fighterAbility==='tackle');
  assert.ok(tackleSystem,'space-superiority combined tackle must reach support systems');
  assert.equal(tackleSystem.strength,.04);
  assert.equal(tackleSystem.warpStrength,1);
  assert.equal(tackleSystem.fighterCount,12);

  const siren=await analyze('Thanatos','Siren I');
  const point=siren.fighterSystem.supportSystems.find((system)=>system.fighterAbility==='warp-disruption');
  assert.ok(point && point.warpStrength===1,'support-fighter warp disruption must be per-fighter and exported');
  assert.equal(point.fighterCount,3);

  const firbolg=await analyze('Thanatos','Firbolg I');
  const firbolgProfile=firbolg.fighterSystem.abilityProfiles.find((row)=>row.typeId===m.get('Firbolg I'));
  const mwd=firbolgProfile.abilities.find((ability)=>ability.ability==='microwarpdrive');
  assert.ok(mwd,'fighter mobility ability metadata missing');
  assert.equal(mwd.durationSeconds,20);
  assert.equal(mwd.speedBonusPercent,500);
  assert.ok(firbolg.fighterSystem.damageSources.every((source)=>source.fighterMaximumVelocityMps>0 && source.fighterOrbitRangeM>0 && source.fighterCountInitial===source.fighterCountRemaining));

  const ametat=await analyze('Nyx','Ametat I');
  const bomb=ametat.fighterSystem.abilityProfiles.flatMap((row)=>row.abilities).find((ability)=>ability.ability==='launch-bomb');
  assert.ok(bomb,'fighter launch-bomb special ability missing');
  assert.equal(bomb.automatic,false,'bomb ability must never be folded into automatic DPS');
  assert.equal(bomb.cooldownSeconds,60);
  assert.equal(bomb.bombName,'Micro Electron Bomb');
  assert.equal(bomb.damagePerBomb,640);
  assert.equal(bomb.radiusM,15000);
  assert.equal(ametat.fighterSystem.damageSources.some((source)=>source.ability==='launch-bomb'),false,'bomb must remain explicit/manual rather than paper DPS');

  const shadow=await analyze('Nyx','Shadow');
  const kamikaze=shadow.fighterSystem.abilityProfiles.flatMap((row)=>row.abilities).find((ability)=>ability.ability==='kamikaze');
  assert.ok(kamikaze,'kamikaze special ability metadata missing');
  assert.equal(kamikaze.automatic,false);
  assert.equal(kamikaze.oneShot,true);
  assert.equal(kamikaze.selfDestructive,true);
  assert.ok(kamikaze.damagePerFighter>0);

  console.log('fighter ability deep regression: PASS (superiority tackle, support EWAR, mobility, bombs, kamikaze)');
})().catch((error)=>{console.error(error);process.exitCode=1;});
