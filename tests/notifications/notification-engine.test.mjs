import test from "node:test";
import assert from "node:assert/strict";
import { evaluateNotificationRules, notificationEvaluatorKinds } from "../../tools/modal/notification_engine.mjs";

function marketRule(overrides = {}) {
  return {
    schemaVersion: 1,
    requestId: "notify_test",
    sageId: "sage_A",
    kind: "market.price_below",
    label: "Tritanium",
    enabled: true,
    repeatMode: "edge",
    target: { typeId: 34, regionId: 10000002 },
    condition: { side: "sell", threshold: 200 },
    ...overrides,
  };
}

function order({ orderId, typeId = 34, price, volume = 10, buy = false, locationId = 60003760, systemId = 30000142 }) {
  return {
    order_id: orderId,
    type_id: typeId,
    price,
    volume_remain: volume,
    volume_total: volume,
    is_buy_order: buy,
    location_id: locationId,
    system_id: systemId,
  };
}

async function run({ rules, states = {}, orders = [], bids = [], onRegion, onBids }) {
  return evaluateNotificationRules({
    rules,
    states,
    evaluatedAt: "2026-09-21T00:00:00.000Z",
    loadRawRegion: async (regionId) => {
      onRegion?.(regionId);
      return { orders };
    },
    loadContractBids: async (contractId) => {
      onBids?.(contractId);
      return bids;
    },
  });
}

test("built-in notification kinds are registered", () => {
  assert.deepEqual(notificationEvaluatorKinds(), [
    "contract.auction_bid",
    "market.available",
    "market.custom_condition",
    "market.order_undercut",
    "market.price_above",
    "market.price_below",
  ]);
});

test("price-below alert is edge-triggered and rearms after clearing", async () => {
  const rule = marketRule();
  const first = await run({ rules: [rule], orders: [order({ orderId: 1, price: 150 })] });
  assert.equal(first.triggered, 1);
  assert.equal(first.events[0].sageId, "sage_A");
  assert.equal(first.events[0].requestId, "notify_test");

  const firstState = first.stateUpdates[0];
  const steady = await run({ rules: [rule], states: { notify_test: firstState }, orders: [order({ orderId: 2, price: 140 })] });
  assert.equal(steady.triggered, 0);

  const cleared = await run({ rules: [rule], states: { notify_test: steady.stateUpdates[0] }, orders: [order({ orderId: 3, price: 250 })] });
  assert.equal(cleared.triggered, 0);
  assert.equal(cleared.stateUpdates[0].lastMatched, false);

  const rearmed = await run({ rules: [rule], states: { notify_test: cleared.stateUpdates[0] }, orders: [order({ orderId: 4, price: 190 })] });
  assert.equal(rearmed.triggered, 1);
  assert.equal(rearmed.stateUpdates[0].triggerCount, 2);
});

test("sell price alert requires qualifying volume below the threshold", async () => {
  const rule = marketRule({ condition: { side: "sell", threshold: 200, minVolume: 100 } });
  const tooThin = await run({
    rules: [rule],
    orders: [
      order({ orderId: 1, price: 150, volume: 40 }),
      order({ orderId: 2, price: 175, volume: 50 }),
      order({ orderId: 3, price: 250, volume: 5_000 }),
    ],
  });
  assert.equal(tooThin.triggered, 0);
  assert.equal(tooThin.stateUpdates[0].lastMatched, false);

  const enough = await run({
    rules: [rule],
    states: { notify_test: tooThin.stateUpdates[0] },
    orders: [
      order({ orderId: 1, price: 150, volume: 40 }),
      order({ orderId: 2, price: 175, volume: 65 }),
      order({ orderId: 3, price: 250, volume: 5_000 }),
    ],
  });
  assert.equal(enough.triggered, 1);
  assert.equal(enough.events[0].data.qualifyingVolume, 105);
});

test("buy price alert requires qualifying demand above the threshold", async () => {
  const rule = marketRule({
    requestId: "notify_buy_volume",
    kind: "market.price_above",
    condition: { side: "buy", threshold: 200, minVolume: 75 },
  });
  const result = await run({
    rules: [rule],
    orders: [
      order({ orderId: 1, price: 230, volume: 30, buy: true }),
      order({ orderId: 2, price: 220, volume: 50, buy: true }),
      order({ orderId: 3, price: 190, volume: 9_000, buy: true }),
    ],
  });
  assert.equal(result.triggered, 1);
  assert.equal(result.events[0].data.qualifyingVolume, 80);
});

test("custom condition supports arbitrary price and volume operators", async () => {
  const rule = marketRule({
    requestId: "notify_custom",
    kind: "market.custom_condition",
    condition: {
      side: "sell",
      priceOperator: "gte",
      priceValue: 200,
      volumeOperator: "lte",
      volumeValue: 90,
    },
  });
  const result = await run({
    rules: [rule],
    orders: [
      order({ orderId: 1, price: 150, volume: 500 }),
      order({ orderId: 2, price: 200, volume: 40 }),
      order({ orderId: 3, price: 250, volume: 45 }),
    ],
  });
  assert.equal(result.triggered, 1);
  assert.equal(result.events[0].data.qualifyingVolume, 85);
  assert.equal(result.events[0].data.qualifyingPrice, 200);
});

test("custom condition can watch volume without a price restriction", async () => {
  const rule = marketRule({
    requestId: "notify_volume_only",
    kind: "market.custom_condition",
    condition: {
      side: "buy",
      priceOperator: "any",
      volumeOperator: "gte",
      volumeValue: 100,
    },
  });
  const result = await run({
    rules: [rule],
    orders: [
      order({ orderId: 1, price: 50, volume: 60, buy: true }),
      order({ orderId: 2, price: 500, volume: 45, buy: true }),
    ],
  });
  assert.equal(result.triggered, 1);
  assert.equal(result.events[0].data.qualifyingVolume, 105);
});

test("sell-order undercut excludes the watched order itself", async () => {
  const rule = marketRule({
    requestId: "notify_undercut",
    kind: "market.order_undercut",
    label: "PLEX",
    target: { typeId: 44992, regionId: 10000002, locationId: 60003760, ownOrderId: 77 },
    condition: { side: "sell", orderPrice: 5_000_000 },
  });
  const result = await run({
    rules: [rule],
    orders: [
      order({ orderId: 77, typeId: 44992, price: 4_000_000 }),
      order({ orderId: 78, typeId: 44992, price: 4_999_999 }),
      order({ orderId: 79, typeId: 44992, price: 5_100_000 }),
    ],
  });
  assert.equal(result.triggered, 1);
  assert.equal(result.events[0].data.competingPrice, 4_999_999);
  assert.equal(result.events[0].data.orderId, 78);
});

test("contract auction bid establishes a baseline then only fires for a new/higher bid", async () => {
  const rule = {
    schemaVersion: 1,
    requestId: "notify_contract",
    sageId: "sage_A",
    kind: "contract.auction_bid",
    label: "Auction 123",
    enabled: true,
    repeatMode: "change",
    target: { contractId: 123 },
    condition: {},
  };
  const baseline = await run({ rules: [rule], bids: [{ bid_id: 1, amount: 100, date_bid: "2026-09-20T23:00:00Z" }] });
  assert.equal(baseline.triggered, 0);

  const newBid = await run({
    rules: [rule],
    states: { notify_contract: baseline.stateUpdates[0] },
    bids: [
      { bid_id: 1, amount: 100, date_bid: "2026-09-20T23:00:00Z" },
      { bid_id: 2, amount: 125, date_bid: "2026-09-21T00:00:00Z" },
    ],
  });
  assert.equal(newBid.triggered, 1);
  assert.equal(newBid.events[0].data.highestBid, 125);

  const disappeared = await run({
    rules: [rule],
    states: { notify_contract: newBid.stateUpdates[0] },
    bids: [],
  });
  assert.equal(disappeared.triggered, 0, "expiry/acceptance ambiguity must not be reported as a new bid");
});

test("multiple market alerts in one region read and index that raw region only once", async () => {
  let regionReads = 0;
  const rules = [
    marketRule({ requestId: "notify_a", target: { typeId: 34, regionId: 10000002 } }),
    marketRule({ requestId: "notify_b", label: "Pyerite", target: { typeId: 35, regionId: 10000002 }, condition: { side: "sell", threshold: 400 } }),
    marketRule({ requestId: "notify_c", label: "Tritanium second watcher", target: { typeId: 34, regionId: 10000002 }, condition: { side: "sell", threshold: 180 } }),
  ];
  const result = await run({
    rules,
    orders: [
      order({ orderId: 1, typeId: 34, price: 150 }),
      order({ orderId: 2, typeId: 35, price: 350 }),
      order({ orderId: 3, typeId: 36, price: 1 }),
    ],
    onRegion: () => regionReads++,
  });
  assert.equal(regionReads, 1);
  assert.equal(result.rawRegionsRead, 1);
  assert.equal(result.marketBooksBuilt, 2);
  assert.equal(result.marketQuoteKeysEvaluated, 3);
  assert.equal(result.triggered, 3);
});

test("duplicate watchers of one public contract share one contract-bid fetch", async () => {
  let bidReads = 0;
  const rule = {
    requestId: "notify_contract_a",
    sageId: "sage_A",
    kind: "contract.auction_bid",
    enabled: true,
    repeatMode: "change",
    target: { contractId: 987 },
    condition: {},
  };
  const rules = [rule, { ...rule, requestId: "notify_contract_b", sageId: "sage_B" }];
  const result = await run({
    rules,
    bids: [{ bid_id: 1, amount: 100 }],
    onBids: () => bidReads++,
  });
  assert.equal(bidReads, 1);
  assert.equal(result.contractBidSourcesRead, 1);
  assert.equal(result.triggered, 0);
});
