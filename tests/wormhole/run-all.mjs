import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { parseProbeScanner } from "../../src/wormhole-scanner.ts";
import { calculateRollingState, directionalRollingRisk, rollingPassWindow, rollingRiskForMass } from "../../src/wormhole-rolling-math.ts";
import { reconcileWormholeScan } from "../../electron/wormhole-scan-reconcile.ts";
import { reconstructWormholeHistory } from "../../src/wormhole-history.ts";

function scannerTests() {
  const text = [
    "ABC-123\tCosmic Signature\tWormhole\tUnstable Wormhole\t100.0%\t4.2 AU",
    "DEF-456  Cosmic Signature  Gas Site  Barren Perimeter Reservoir  72.5%  8.1 AU",
    "junk row without a signature",
    "ABC-123\tCosmic Signature\tWormhole\tK162\t100.0%\t3.9 AU",
  ].join("\n");
  const parsed = parseProbeScanner(text);
  assert.equal(parsed.length, 2, "deduplicates signature IDs and ignores malformed rows");
  assert.deepEqual(parsed.map((row) => row.id), ["ABC-123", "DEF-456"]);
  assert.equal(parsed[0].kind, "wormhole");
  assert.equal(parsed[0].name, "K162");
  assert.equal(parsed[1].kind, "gas");

  const previous = [
    { id:"AAA-111", group:"Cosmic Signature", type:"Wormhole", name:"K162", strength:"100%", distance:"1 AU", kind:"wormhole", raw:"old" },
    { id:"BBB-222", group:"Cosmic Signature", type:"Gas Site", name:"Ordinary Perimeter Reservoir", strength:"50%", distance:"2 AU", kind:"gas", raw:"old" },
    { id:"CCC-333", group:"Cosmic Signature", type:"Relic Site", name:"Unsecured", strength:"25%", distance:"3 AU", kind:"relic", raw:"old" },
  ];
  const current = [
    { ...previous[0], raw:"same row formatting can differ" },
    { ...previous[1], strength:"75%", raw:"changed" },
    { id:"DDD-444", group:"Cosmic Signature", type:"Data Site", name:"New", strength:"10%", distance:"4 AU", kind:"data", raw:"new" },
  ];
  const reconciliation = reconcileWormholeScan(previous, current);
  assert.deepEqual(Object.fromEntries(reconciliation.map((row) => [row.id, row.state])), {
    "AAA-111":"existing", "BBB-222":"changed", "CCC-333":"missing", "DDD-444":"new",
  });
  return { parsed: parsed.length, states: reconciliation.map((row) => row.state).join(",") };
}

function rollingTests() {
  const approx = (actual, expected, label) => assert(Math.abs(actual - expected) < 1, `${label}: ${actual} ~= ${expected}`);
  const state = calculateRollingState(3_000_000_000, 10, [
    { direction:"OUT", massKg:300_000_000 },
    { direction:"IN", massKg:300_000_000 },
  ]);
  approx(state.lowerStart, 2_700_000_000, "lower start");
  approx(state.upperStart, 3_300_000_000, "upper start");
  assert.equal(state.consumed, 600_000_000);
  approx(state.remainingLow, 2_100_000_000, "remaining low");
  approx(state.remainingHigh, 2_700_000_000, "remaining high");
  assert.equal(state.currentSide, "HOME SIDE");
  assert.equal(state.nextExpectedDirection, "OUT");
  assert.deepEqual(state.sequenceContradictions, []);
  assert.equal(rollingRiskForMass(state.remainingLow, state.remainingHigh, 300_000_000), "SAFE AGAINST CURRENT RANGE");
  assert.equal(rollingRiskForMass(state.remainingLow, state.remainingHigh, 2_200_000_000), "MAY COLLAPSE");
  assert.equal(rollingRiskForMass(state.remainingLow, state.remainingHigh, 2_800_000_000), "EXCEEDS ENTIRE REMAINING RANGE");
  assert.deepEqual(rollingPassWindow(state.remainingLow, state.remainingHigh, 300_000_000), { guaranteedSafePasses:7, firstUncertainPass:8, maximumPasses:9 });
  assert.match(directionalRollingRisk("IN", "OUT", "SAFE AGAINST CURRENT RANGE"), /SEQUENCE CONTRADICTION/);
  assert.match(directionalRollingRisk("OUT", "OUT", "MAY COLLAPSE"), /STRAND RISK/);
  const contradiction = calculateRollingState(1_000, 10, [{ direction:"OUT", massKg:10 }, { direction:"OUT", massKg:10 }]);
  assert.deepEqual(contradiction.sequenceContradictions, [1]);
  return { remainingLow: state.remainingLow, remainingHigh: state.remainingHigh };
}

function historyTests() {
  const store = {
    schemaVersion:1, createdAt:'2026-08-20T10:00:00.000Z', updatedAt:'2026-08-20T13:00:00.000Z',
    systems:{
      '1':{systemId:1,systemName:'J000001',status:'unknown',discoveredAt:'2026-08-20T10:00:00.000Z',updatedAt:'2026-08-20T13:00:00.000Z'},
      '2':{systemId:2,systemName:'J000002',status:'unknown',discoveredAt:'2026-08-20T10:05:00.000Z',updatedAt:'2026-08-20T13:00:00.000Z'},
    },
    signatures:{},
    connections:{ c1:{connectionId:'c1',fromSystemId:1,toSystemId:2,fromSignatureId:'AAA-111',status:'expired',discoveredAt:'2026-08-20T10:10:00.000Z',updatedAt:'2026-08-20T12:00:00.000Z',removedAt:'2026-08-20T12:00:00.000Z'} },
    scanHistory:[
      {scanId:'s1',systemId:1,systemName:'J000001',characterId:'1',characterName:'Pilot',scannedAt:'2026-08-20T10:15:00.000Z',signatures:[]},
      {scanId:'s2',systemId:1,systemName:'J000001',characterId:'1',characterName:'Pilot',scannedAt:'2026-08-20T11:15:00.000Z',signatures:[]},
    ],
    mapLayout:{positions:{},zoom:1,panX:0,panY:0,snapToGrid:true},watches:[],alerts:[],
  };
  const before = reconstructWormholeHistory(store, '2026-08-20T11:30:00.000Z');
  assert.equal(before.connections.length, 1, 'removed link must still exist in pre-removal reconstruction');
  assert.equal(before.scans.length, 1);
  assert.equal(before.scans[0].scanId, 's2', 'history should use latest scan at or before target');
  const after = reconstructWormholeHistory(store, '2026-08-20T12:30:00.000Z');
  assert.equal(after.connections.length, 0, 'removed link must disappear after removedAt');
  return { beforeLinks:before.connections.length, afterLinks:after.connections.length };
}

const require = createRequire(import.meta.url);
const staticCachePerformance = require("./static-cache-performance.test.cjs");

const started = Date.now();
const results = { scanner: scannerTests(), rolling: rollingTests(), history: historyTests(), staticCache: await staticCachePerformance() };
console.log("PASS wormhole scanner/reconciliation");
console.log("PASS wormhole rolling math");
console.log("PASS wormhole historical reconstruction");
console.log("PASS wormhole static cache off-main-thread performance");
console.log(JSON.stringify({ ...results, durationMs: Date.now() - started }, null, 2));
console.log("WORMHOLE CORE UNIT TESTS: PASS");
