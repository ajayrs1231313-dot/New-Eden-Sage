import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { evaluateBestSingleSystemBuyExit, standardCapitalDestinationEligible }=require('../../dist-electron/market-intelligence.js');

const systems = new Map([
  [30000142,{systemId:30000142,name:'Jita',regionId:10000002,securityStatus:0.945,securityBand:'high'}],
  [30000001,{systemId:30000001,name:'Lowsec Test',regionId:10000001,securityStatus:0.3,securityBand:'low'}],
  [30003504,{systemId:30003504,name:'Niarja',regionId:10000070,securityStatus:-1,securityBand:'null'}],
  [30100000,{systemId:30100000,name:'Zarzakh',regionId:10001000,securityStatus:-1,securityBand:'null'}],
  [30045339,{systemId:30045339,name:'M-OEE8',regionId:10000015,securityStatus:-0.1,securityBand:'null'}],
  [30045340,{systemId:30045340,name:'C-J6MT',regionId:10000015,securityStatus:-0.2,securityBand:'null'}],
]);
const order=(orderId,price,volumeRemain,systemId,systemName,regionId,range='station',locationId=60000000)=>({orderId,price,volumeRemain,locationId,locationName:'Test',systemId,systemName,issued:'2026-08-22T00:00:00Z',minVolume:1,range,durationDays:90,regionId,regionName:'Test'});

{
  const items=[
    {typeId:1,quantity:10,orders:[order(1,100,10,30000001,'Lowsec Test',10000001),order(2,80,10,30000142,'Jita',10000002,'region')]},
    {typeId:2,quantity:10,orders:[order(3,200,10,30000142,'Jita',10000002),order(4,150,10,30000001,'Lowsec Test',10000001)]},
  ];
  const exit=evaluateBestSingleSystemBuyExit(items,systems);
  assert.ok(exit);
  assert.equal(exit.systemId,30000142);
  assert.equal(exit.gross,2800);
  assert.equal(exit.coveredUnits,20);
}

{
  const items=[{typeId:1,quantity:10,orders:[order(5,100,5,30000001,'Lowsec Test',10000001)]}];
  assert.equal(evaluateBestSingleSystemBuyExit(items,systems),null);
}

{
  const items=[{typeId:28352,quantity:1,orders:[order(6,9_000_000_000,1,30000142,'Jita',10000002),order(7,8_000_000_000,1,30000001,'Lowsec Test',10000001)]}];
  const exit=evaluateBestSingleSystemBuyExit(items,systems,{capitalRequired:true});
  assert.ok(exit);
  assert.equal(exit.systemId,30000001);
  assert.equal(exit.securityBand,'low');
  assert.equal(exit.gross,8_000_000_000);
}

assert.equal(standardCapitalDestinationEligible(systems.get(30000142)),false);
assert.equal(standardCapitalDestinationEligible(systems.get(30000001)),true);
assert.equal(standardCapitalDestinationEligible(systems.get(30045339)),true);
assert.equal(standardCapitalDestinationEligible(systems.get(30003504)),false);
assert.equal(standardCapitalDestinationEligible(systems.get(30100000)),false);
console.log('PASS contract executable-exit and capital-destination rules');
