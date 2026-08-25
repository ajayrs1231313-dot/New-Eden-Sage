const assert = require('node:assert/strict');
const fs = require('node:fs');
const refinery = require('../dist-electron/refinery-engine.js');

const npcMax = refinery.refineryYieldFraction({
  facility: 'npc', rig: 'none', security: 'high',
  reprocessingLevel: 5, efficiencyLevel: 5, processingLevel: 5, implant: 'none',
});
assert(Math.abs(npcMax - (0.5 * 1.15 * 1.10 * 1.10)) < 1e-12);

const tataraT2High = refinery.refineryYieldFraction({
  facility: 'tatara', rig: 't2', security: 'high',
  reprocessingLevel: 5, efficiencyLevel: 5, processingLevel: 5, implant: 'rx804',
});
assert(tataraT2High > npcMax, 'Tatara T2 high-sec max-skills yield should exceed NPC station max-skills yield');
assert(tataraT2High <= 1, 'yield must be clamped to 100%');

const tataraT2Null = refinery.refineryYieldFraction({
  facility: 'tatara', rig: 't2', security: 'null',
  reprocessingLevel: 5, efficiencyLevel: 5, processingLevel: 5, implant: 'rx804',
});
assert(tataraT2Null >= tataraT2High, 'null/wormhole rig security modifier should not reduce structure yield');
assert(tataraT2Null <= 1, 'yield must remain clamped');

const veldspar = refinery.refineryBatchOutput({ quantity: 250, portionSize: 100, baseOutputQuantity: 400, yieldFraction: 0.75 });
assert.deepEqual(veldspar, { fullBatches: 2, leftoverUnits: 50, refinedUnits: 600 });

const ice = refinery.refineryBatchOutput({ quantity: 3, portionSize: 1, baseOutputQuantity: 69, yieldFraction: 0.8 });
assert.deepEqual(ice, { fullBatches: 3, leftoverUnits: 0, refinedUnits: 165 });

console.log(JSON.stringify({ npcMax, tataraT2High, tataraT2Null, veldspar, ice }));

// Architecture regression guard: renderer-facing reads must load only the persisted result cache.
{
  const compiled = fs.readFileSync(require.resolve('../dist-electron/refinery-engine.js'), 'utf8');
  const indexStart = compiled.indexOf('async function refineryIndex');
  const requireStart = compiled.indexOf('async function requireRefineryIndex');
  assert(indexStart >= 0 && requireStart > indexStart, 'compiled refinery cache loader must be present');
  const indexBody = compiled.slice(indexStart, requireStart);
  assert.match(indexBody, /loadPersistedResult/, 'refinery reads must load the persisted result cache');
  assert.equal(indexBody.includes('buildRefineryIndex('), false, 'opening/read paths must never rebuild or parse the SDE');
  const preparationStart = compiled.indexOf('async function prepareRefineryStaticDataLocal');
  const preparationBody = compiled.slice(preparationStart, indexStart);
  assert.equal(preparationBody.includes('buildRefineryIndex('), true, 'SDE parsing belongs only to explicit feature preparation');
}
