const assert = require('node:assert/strict');

module.exports = async function ansiblexTests() {
  const graph = require('../../dist-electron/universe-route-graph.js');
  const planner = require('../../dist-electron/navigation-route-planner.js');
  const ansiblex = require('../../dist-electron/navigation-ansiblex.js');

  assert.equal(ansiblex.ANSIBLEX_CAPACITY_TJ, 1250);
  assert.equal(ansiblex.ansiblexDistanceMultiplier(0), 0);
  assert.equal(ansiblex.ansiblexDistanceMultiplier(5), 0);
  assert.equal(ansiblex.ansiblexDistanceMultiplier(5.1), 2);
  assert.equal(ansiblex.ansiblexDistanceMultiplier(10), 2);
  assert.equal(ansiblex.ansiblexDistanceMultiplier(10.1), 6);
  assert.equal(ansiblex.ansiblexDistanceMultiplier(15.1), 9);
  assert.equal(ansiblex.ansiblexDistanceMultiplier(20.1), 15);

  const golem = await ansiblex.getNavigationAnsiblexShipContext(28710);
  assert(golem, 'Golem must exist in current SDE');
  assert.equal(golem.shipGroupName, 'Marauder');
  assert.equal(golem.baseActivationCostTj, 19);
  assert.equal(golem.capitalRestricted, false);

  const rorqual = await ansiblex.getNavigationAnsiblexShipContext(28352);
  assert(rorqual, 'Rorqual must exist in current SDE');
  assert.equal(rorqual.baseActivationCostTj, 19);
  assert.equal(rorqual.capitalRestricted, false);
  assert.equal(rorqual.capitalException, true);

  const revelation = await ansiblex.getNavigationAnsiblexShipContext(19720);
  assert(revelation, 'Revelation must exist in current SDE');
  assert.equal(revelation.shipGroupName, 'Dreadnought');
  assert.equal(revelation.capitalRestricted, true);

  const obelisk = await ansiblex.getNavigationAnsiblexShipContext(20187);
  assert(obelisk, 'Obelisk must exist in current SDE');
  assert.equal(obelisk.shipGroupName, 'Freighter');
  assert.equal(obelisk.baseActivationCostTj, 1);
  assert.equal(obelisk.capitalRestricted, false);
  assert.equal(obelisk.capitalException, true);

  const good = ansiblex.assessNavigationAnsiblex({
    baseCostTj: 19,
    endpointDistanceFromCapitalLy: 10,
    availableCapacitorTj: 100,
    travellerAllianceId: 9901,
    owningAllianceId: 9901,
    startingSystemSovereigntyAllianceId: 9901,
    capitalRestricted: false,
    shipName: 'Golem',
  });
  assert.equal(good.usable, true);
  assert.equal(good.multiplier, 2);
  assert.equal(good.activationCostTj, 38);

  const noCap = ansiblex.assessNavigationAnsiblex({
    baseCostTj: 19,
    endpointDistanceFromCapitalLy: 20.1,
    availableCapacitorTj: 100,
    travellerAllianceId: 9901,
    owningAllianceId: 9901,
    startingSystemSovereigntyAllianceId: 9901,
  });
  assert.equal(noCap.usable, false);
  assert.equal(noCap.activationCostTj, 285);
  assert.match(noCap.blockers.join(' '), /only 100\.00 TJ/i);

  const wrongAlliance = ansiblex.assessNavigationAnsiblex({
    baseCostTj: 1,
    endpointDistanceFromCapitalLy: 5,
    availableCapacitorTj: 0,
    travellerAllianceId: 9902,
    owningAllianceId: 9901,
    startingSystemSovereigntyAllianceId: 9901,
  });
  assert.equal(wrongAlliance.usable, false);
  assert.match(wrongAlliance.blockers.join(' '), /does not match/i);

  const exact = async (name) => {
    const rows = await graph.searchNavigationSystems(name, 8);
    const row = rows.find((item) => item.name === name);
    assert(row, `Missing SDE system ${name}`);
    return row;
  };
  const Jita = await exact('Jita');
  const Amarr = await exact('Amarr');
  const connection = {
    connectionId: 'patch-ansiblex',
    fromSystemId: Jita.systemId,
    toSystemId: Amarr.systemId,
    type: 'ansiblex',
    enabled: true,
    bidirectional: true,
    metadata: {
      owningAllianceId: 9901,
      fromSystemSovereigntyAllianceId: 9901,
      toSystemSovereigntyAllianceId: 9901,
      forwardEndpointDistanceFromCapitalLy: 10,
      reverseEndpointDistanceFromCapitalLy: 20.1,
      fromAvailableCapacitorTj: 100,
      toAvailableCapacitorTj: 50,
    },
  };
  const golemProfile = { specialConnections: { enabledTypes:['ansiblex'], disabledNetworkIds:[], ansiblexPolicy:{ shipTypeId:28710, travellerAllianceId:9901 } } };
  const forward = await planner.calculateNavigationPlan({ waypointSystemIds:[Jita.systemId,Amarr.systemId], customConnections:[connection], profile:golemProfile });
  assert.equal(forward.found, true);
  assert.equal(forward.legs[0].type, 'ansiblex');
  assert.equal(forward.legs[0].metadata.ansiblexActivationCostTj, 38);
  assert.equal(forward.legs[0].metadata.ansiblexUsable, true);

  const reverse = await planner.calculateNavigationPlan({ waypointSystemIds:[Amarr.systemId,Jita.systemId], customConnections:[connection], profile:golemProfile });
  assert.equal(reverse.found, true);
  assert(reverse.legs.every((leg)=>leg.type==='gate'), 'reverse Ansiblex must be excluded when recorded cap cannot pay 285 TJ');

  const dreadProfile = { specialConnections: { enabledTypes:['ansiblex'], disabledNetworkIds:[], ansiblexPolicy:{ shipTypeId:19720, travellerAllianceId:9901 } } };
  const dread = await planner.calculateNavigationPlan({ waypointSystemIds:[Jita.systemId,Amarr.systemId], customConnections:[connection], profile:dreadProfile });
  assert.equal(dread.found, true);
  assert(dread.legs.every((leg)=>leg.type==='gate'), 'dreadnought must not route through Ansiblex');

  const rorqualProfile = { specialConnections: { enabledTypes:['ansiblex'], disabledNetworkIds:[], ansiblexPolicy:{ shipTypeId:28352, travellerAllianceId:9901 } } };
  const rorqualRoute = await planner.calculateNavigationPlan({ waypointSystemIds:[Jita.systemId,Amarr.systemId], customConnections:[connection], profile:rorqualProfile });
  assert.equal(rorqualRoute.legs[0].type, 'ansiblex', 'Rorqual is an explicit capital exception');

  return {
    capacityTj: ansiblex.ANSIBLEX_CAPACITY_TJ,
    golemBaseCostTj: golem.baseActivationCostTj,
    forwardCostTj: forward.legs[0].metadata.ansiblexActivationCostTj,
    reverseBlocked: reverse.legs.every((leg)=>leg.type==='gate'),
    capitalBlocked: dread.legs.every((leg)=>leg.type==='gate'),
    rorqualAllowed: rorqualRoute.legs[0].type==='ansiblex',
  };
};
