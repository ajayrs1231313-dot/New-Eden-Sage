const assert = require('node:assert/strict');
const dogma = require('../../dist-electron/fitting-dogma.js');

const blankSnapshot={character:{name:'t3-capability-output-regression'},skills:{total_sp:0,skills:[]},extended:{implants:[]}};
const snapshot=(skillId,level)=>({character:{name:'t3-capability-output-regression'},skills:{total_sp:0,skills:[{skill_id:skillId,trained_skill_level:level,active_skill_level:level,skillpoints_in_skill:0}]},extended:{implants:[]}});
const item=(typeId,rack,state='online',extra={})=>({typeId,rack,quantity:1,state,...extra});
const approx=(actual,expected,epsilon=1e-9,message='')=>assert.ok(Math.abs(actual-expected)<=epsilon,`${message} expected ${expected}, got ${actual}`);

const names=[
  'Legion','Tengu','Proteus','Loki',
  'Legion Defensive - Covert Reconfiguration','Tengu Defensive - Covert Reconfiguration','Proteus Defensive - Covert Reconfiguration','Loki Defensive - Covert Reconfiguration',
  'Legion Propulsion - Interdiction Nullifier','Tengu Propulsion - Interdiction Nullifier','Proteus Propulsion - Interdiction Nullifier','Loki Propulsion - Interdiction Nullifier',
  'Amarr Defensive Systems','Caldari Defensive Systems','Gallente Defensive Systems','Minmatar Defensive Systems',
  'Interdiction Nullifier I',
];

(async()=>{
  const resolved=await dogma.resolveFittingTypeNamesLocal(names);
  const m=new Map(resolved.map(row=>[row.name,row.id]));
  for(const name of names) assert.ok(m.get(name),`Missing SDE type ${name}`);

  const races=[
    ['Legion','Amarr'],
    ['Tengu','Caldari'],
    ['Proteus','Gallente'],
    ['Loki','Minmatar'],
  ];

  for(const [hull,race] of races){
    const hullTypeId=m.get(hull);
    const defensiveSkill=m.get(`${race} Defensive Systems`);
    const covertTypeId=m.get(`${hull} Defensive - Covert Reconfiguration`);
    const nullifierSubsystemTypeId=m.get(`${hull} Propulsion - Interdiction Nullifier`);
    const nullifierModuleTypeId=m.get('Interdiction Nullifier I');

    const base=await dogma.analyzeFittingDogma({hullTypeId,items:[],snapshot:snapshot(defensiveSkill,5)});
    assert.equal(base.capabilities.scanning.probeStrengthBonusPercent,0,`${hull} base probe-strength bonus`);
    assert.equal(base.capabilities.scanning.probeStrengthMultiplier,1,`${hull} base probe-strength multiplier`);
    approx(base.capabilities.scanning.coreScannerProbeStrength,40,1e-9,`${hull} base Core Scanner Probe strength`);
    assert.equal(base.capabilities.blackOps.jumpPortalPassenger,false,`${hull} base Black Ops portal passenger flag`);
    assert.equal(base.capabilities.blackOps.jumpConduitPassenger,false,`${hull} base Black Ops conduit passenger flag`);
    assert.equal(base.capabilities.interdictionNullifier.moduleRoleBonus,false,`${hull} base nullifier role bonus`);
    assert.equal(base.capabilities.interdictionNullifier.providesPassiveNullification,false,`${hull} must not claim passive nullification`);

    const covert0=await dogma.analyzeFittingDogma({
      hullTypeId,
      items:[item(covertTypeId,'subsystem')],
      snapshot:snapshot(defensiveSkill,0),
    });
    assert.equal(covert0.capabilities.scanning.probeStrengthBonusPercent,0,`${hull} Covert skill-0 probe bonus`);
    approx(covert0.capabilities.scanning.coreScannerProbeStrength,40,1e-9,`${hull} Covert skill-0 Core Probe strength`);
    assert.equal(covert0.capabilities.blackOps.jumpPortalPassenger,true,`${hull} Covert must be Black Ops portal passenger`);
    assert.equal(covert0.capabilities.blackOps.jumpConduitPassenger,true,`${hull} Covert must be Black Ops conduit passenger`);

    const covert5=await dogma.analyzeFittingDogma({
      hullTypeId,
      items:[item(covertTypeId,'subsystem')],
      snapshot:snapshot(defensiveSkill,5),
    });
    approx(covert5.capabilities.scanning.probeStrengthBonusPercent,50,1e-9,`${hull} Covert V probe bonus`);
    approx(covert5.capabilities.scanning.probeStrengthMultiplier,1.5,1e-9,`${hull} Covert V probe multiplier`);
    approx(covert5.capabilities.scanning.coreScannerProbeStrength,60,1e-9,`${hull} Covert V Core Probe strength`);
    assert.equal(covert5.capabilities.scanning.referenceProbeTypeId,30013,`${hull} probe reference type`);
    assert.equal(covert5.capabilities.scanning.referenceProbe,'Core Scanner Probe I',`${hull} probe reference name`);
    assert.equal(covert5.capabilities.blackOps.jumpPortalPassenger,true,`${hull} Covert V Black Ops portal passenger flag`);
    assert.equal(covert5.capabilities.blackOps.jumpConduitPassenger,true,`${hull} Covert V Black Ops conduit passenger flag`);

    const nullifierBase=await dogma.analyzeFittingDogma({
      hullTypeId,
      items:[item(nullifierModuleTypeId,'high','active')],
      snapshot:blankSnapshot,
    });
    const baseModule=nullifierBase.capabilities.interdictionNullifier.fittedModules[0];
    assert.ok(baseModule,`${hull} baseline Interdiction Nullifier output missing`);
    approx(baseModule.targetingRangeBonusPercent,-50,1e-9,`${hull} baseline nullifier targeting range penalty`);
    approx(baseModule.scanResolutionMultiplier,0.5,1e-9,`${hull} baseline nullifier scan-resolution multiplier`);
    approx(baseModule.reactivationDelaySeconds,100,1e-9,`${hull} baseline nullifier reactivation delay`);
    approx(baseModule.activationDurationSeconds,10,1e-9,`${hull} baseline nullifier duration`);

    const nullified=await dogma.analyzeFittingDogma({
      hullTypeId,
      items:[item(nullifierSubsystemTypeId,'subsystem'),item(nullifierModuleTypeId,'high','active')],
      snapshot:blankSnapshot,
    });
    const capability=nullified.capabilities.interdictionNullifier;
    assert.equal(capability.moduleRoleBonus,true,`${hull} Interdiction Nullifier subsystem role bonus`);
    assert.equal(capability.providesPassiveNullification,false,`${hull} subsystem must not be represented as passive bubble immunity`);
    assert.equal(capability.moduleGroupId,4117,`${hull} nullifier module group`);
    approx(capability.targetingRangePenaltyReductionPercent,80,1e-9,`${hull} nullifier targeting-range penalty reduction`);
    approx(capability.reactivationDelayReductionPercent,80,1e-9,`${hull} nullifier reactivation-delay reduction`);
    approx(capability.activationDurationBonusPercent,100,1e-9,`${hull} nullifier activation-duration bonus`);
    approx(capability.scanResolutionPenaltyReductionPercent,0,1e-9,`${hull} nullifier scan-resolution penalty reduction`);
    const fitted=capability.fittedModules[0];
    assert.ok(fitted,`${hull} subsystem-adjusted Interdiction Nullifier output missing`);
    approx(fitted.targetingRangeBonusPercent,-10,1e-9,`${hull} adjusted nullifier targeting range penalty`);
    approx(fitted.scanResolutionMultiplier,0.5,1e-9,`${hull} adjusted nullifier scan-resolution multiplier`);
    approx(fitted.reactivationDelaySeconds,20,1e-9,`${hull} adjusted nullifier reactivation delay`);
    approx(fitted.activationDurationSeconds,20,1e-9,`${hull} adjusted nullifier duration`);
  }

  console.log('T3 capability output regressions: PASS (probe strength, Black Ops passengers, Interdiction Nullifier role bonuses across all four T3 hulls)');
})().catch(error=>{console.error(error);process.exit(1)});
