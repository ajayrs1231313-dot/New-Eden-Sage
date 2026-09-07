const assert = require("node:assert/strict");
const {
  analyzeFittingDogma,
  getFittingCatalogueLocal,
  getFittingRemediesLocal,
} = require("../../dist-electron/fitting-dogma.js");

const levels = {
  3426:5, 3318:5, 11207:5, 3424:5, 3413:5, 3450:5, 3451:4,
  3418:5, 3417:5, 3419:5, 3416:4, 21059:4, 3425:4, 3420:4,
  3300:5, 3302:3, 3310:4, 3311:4, 3312:4, 3315:2, 3316:5,
  3317:4, 3392:5, 3394:5, 3332:5, 16591:4, 3441:5, 3436:5,
  3442:5, 12487:4, 12305:5, 23606:5, 3411:4,
};
const skills = Object.entries(levels).map(([skill_id, trained_skill_level]) => ({
  skill_id: Number(skill_id),
  trained_skill_level,
  active_skill_level: trained_skill_level,
}));
const snapshot = {
  character: { name:"AJDEATHGIVER" },
  skills: { skills, total_sp:29734543 },
  extended: { implants:[] },
};
const items = [
  { typeId:33846, rack:"low", quantity:2, state:"online" },
  { typeId:4405, rack:"low", quantity:2, state:"online" },
  { typeId:1248, rack:"low", quantity:1, state:"online" },
  { typeId:47257, rack:"low", quantity:1, state:"active" },
  { typeId:19206, rack:"mid", quantity:1, state:"active" },
  { typeId:41218, rack:"mid", quantity:1, state:"online" },
  { typeId:2281, rack:"mid", quantity:1, state:"active" },
  { typeId:35656, rack:"mid", quantity:1, state:"active" },
  { typeId:13773, rack:"high", quantity:4, state:"active" },
  { typeId:31724, rack:"rig", quantity:1, state:"online" },
  { typeId:31378, rack:"rig", quantity:1, state:"online" },
];

(async () => {
  const baseline = await analyzeFittingDogma({ hullTypeId:12005, items, snapshot });
  assert.equal(baseline.resources.used.cpu, 464.5);
  assert.equal(baseline.resources.capacity.cpu, 425);
  assert.ok(baseline.issues.some((issue) => issue.code === "cpu-exceeded"));
  assert.equal(baseline.fitting.slots.rig, 2);

  const fullGenolution = await analyzeFittingDogma({ hullTypeId:12005, items, snapshot, implantTypeIds:[2082,33394,33393,2589] });
  assert.ok(Math.abs(fullGenolution.resources.capacity.cpu - 445.8845) < 1e-6, "full Genolution CA set must amplify CA-2 to the CCP DOGMA 4.914% CPU effect");

  const exactCurrentSkillImplants = await analyzeFittingDogma({ hullTypeId:12005, items, snapshot, implantTypeIds:[2082,33393,2589,27142] });
  assert.ok(!exactCurrentSkillImplants.issues.some((issue) => issue.code === "cpu-exceeded"), "CA-1 + CA-2 + CA-3 + EE-605 must clear this exact 464.5/425 CPU fit");
  assert.ok(Math.abs(exactCurrentSkillImplants.resources.capacity.cpu - 464.5239375) < 1e-6);

  const cyberneticsFiveImplant = await analyzeFittingDogma({ hullTypeId:12005, items, snapshot, implantTypeIds:[3267] });
  assert.ok(cyberneticsFiveImplant.missingRequirements.some((item) => item.skillId === 3411 && item.requiredLevel === 5), "planned 6% CPU hardwiring must expose its Cybernetics V requirement");

  const remedies = await getFittingRemediesLocal({
    hullTypeId:12005,
    issueCodes:["cpu-exceeded"],
    itemTypeIds:items.map((item) => item.typeId),
    items,
    snapshot,
    trainedSkills:skills.map((skill) => ({ skillId:skill.skill_id, level:skill.trained_skill_level })),
    implantTypeIds:[],
    boosterTypeIds:[],
  });

  assert.ok(remedies.length > 0, "expected at least one exact remedy");
  assert.equal(remedies.some((item) => item.kind === "rig"), false, "full 2/2 rig rack must suppress rig suggestions");
  assert.equal(remedies.some((item) => item.kind === "skill"), false, "maxed relevant fitting skills must not be suggested");
  assert.ok(remedies.every((item) => item.verifiedFix === true), "every displayed exact remedy must be fully simulated");
  assert.ok(remedies.every((item) => item.result && item.result.headroom >= 0), "every remedy must clear the resource shortage");
  const implantFix = remedies.find((item) => item.kind === "implant-set");
  assert.ok(implantFix, "expected an exact current-skill implant combination");
  assert.deepEqual(implantFix.components.map((item) => item.typeId).sort((a,b) => a-b), [2082,2589,27142,33393].sort((a,b) => a-b));
  assert.ok(implantFix.result.headroom > 0 && implantFix.result.headroom < 0.1, "the current-skill augment route should reproduce the razor-thin CPU fit");
  assert.ok(!implantFix.components.some((item) => item.typeId === 3267), "Cybernetics V hardwirings must not be offered to a Cybernetics IV pilot");

  const catalogue = await getFittingCatalogueLocal();
  const byId = new Map(catalogue.items.map((item) => [item.id, item]));
  for (const remedy of remedies.filter((item) => item.kind === "module")) {
    const from = byId.get(remedy.replacement.fromTypeId);
    const to = byId.get(remedy.replacement.toTypeId);
    assert.ok(from && to);
    assert.equal(to.groupId, from.groupId, "module swap must remain in the same CCP module group");
    assert.equal(to.marketGroupId, from.marketGroupId, "module swap must remain in the same market subgroup/size class");
  }

  console.log("PASS exact fitting remedy regression:", remedies.map((item) => item.kind + ":" + item.name).join(" | "));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
