const assert = require('node:assert/strict');
const dogma = require('../../dist-electron/fitting-dogma.js');

const snapshot = (levels = {}) => ({
  character: { name: 'Wargame support regression' },
  skills: { total_sp: 0, skills: Object.entries(levels).map(([skill_id, trained_skill_level]) => ({ skill_id:Number(skill_id), trained_skill_level })) },
  extended: { implants: [] },
});

(async () => {
  const wanted = ['Huginn','Stasis Webifier II','Target Painter II','Recon Ships','Minmatar Cruiser','Long Distance Jamming','Scimitar','Large Remote Shield Booster II'];
  const resolved = await dogma.resolveFittingTypeNamesLocal(wanted);
  const ids = new Map(resolved.map((entry) => [entry.name, entry.id]));
  const id = (name) => { const value=ids.get(name); assert.ok(value, `Missing SDE type ${name}`); return value; };

  const huginnBase = await dogma.analyzeFittingDogma({
    hullTypeId:id('Huginn'),
    items:[{typeId:id('Stasis Webifier II'),rack:'mid',quantity:1,state:'active'}],
    snapshot:snapshot({[id('Minmatar Cruiser')]:5,[id('Recon Ships')]:0}),
  });
  const huginnRecon5 = await dogma.analyzeFittingDogma({
    hullTypeId:id('Huginn'),
    items:[{typeId:id('Stasis Webifier II'),rack:'mid',quantity:1,state:'active'}],
    snapshot:snapshot({[id('Minmatar Cruiser')]:5,[id('Recon Ships')]:5}),
  });
  const web0 = huginnBase.supportSystems.find((system) => system.kind === 'web');
  const web5 = huginnRecon5.supportSystems.find((system) => system.kind === 'web');
  assert.ok(web0 && web5, 'fit-linked web support profile missing');
  assert.equal(web0.strength, 0.6, 'T2 web strength should be exported');
  assert.ok(web5.optimalM > web0.optimalM * 3.9, 'Recon Ships skill/hull bonus must reach wargame web range');

  const painter0 = await dogma.analyzeFittingDogma({
    hullTypeId:id('Huginn'),
    items:[{typeId:id('Target Painter II'),rack:'mid',quantity:1,state:'active'}],
    snapshot:snapshot({[id('Minmatar Cruiser')]:5,[id('Recon Ships')]:5,[id('Long Distance Jamming')]:0}),
  });
  const painter5 = await dogma.analyzeFittingDogma({
    hullTypeId:id('Huginn'),
    items:[{typeId:id('Target Painter II'),rack:'mid',quantity:1,state:'active'}],
    snapshot:snapshot({[id('Minmatar Cruiser')]:5,[id('Recon Ships')]:5,[id('Long Distance Jamming')]:5}),
  });
  const tp0 = painter0.supportSystems.find((system) => system.kind === 'targetPainter');
  const tp5 = painter5.supportSystems.find((system) => system.kind === 'targetPainter');
  assert.ok(tp0 && tp5, 'target painter support profile missing');
  assert.ok(tp5.optimalM > tp0.optimalM, 'Long Distance Jamming skill must increase fit-linked painter range');
  assert.ok(tp5.signatureBonus > 0, 'target painter strength must be exported');

  const scimitar = await dogma.analyzeFittingDogma({
    hullTypeId:id('Scimitar'),
    items:[{typeId:id('Large Remote Shield Booster II'),rack:'high',quantity:2,state:'active'}],
    snapshot:snapshot({[id('Minmatar Cruiser')]:5}),
  });
  const reps = scimitar.supportSystems.find((system) => system.kind === 'remoteShieldRep');
  assert.ok(reps, 'remote shield rep support profile missing');
  assert.ok(reps.perSecond > 0 && reps.amountPerCycle > 0 && reps.optimalM > 0, 'remote rep amount/cycle/range must reach wargame support data');
  assert.equal(reps.quantity, 2, 'support profile must preserve module quantity');

  console.log('wargame support systems regression: PASS');
})().catch((error) => { console.error(error); process.exitCode=1; });
