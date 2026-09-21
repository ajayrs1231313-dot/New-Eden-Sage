import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JITA_44_LOCATION_ID, quoteMarketDepth, quoteMarketDepthFromOrders } from "../../dist-electron/market-depth.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FORGE = 10000002;

function order({ orderId, typeId = 21, price, volume, minVolume = 1, buy = true, locationId = JITA_44_LOCATION_ID }) {
  return {
    duration: 90,
    is_buy_order: buy,
    issued: "2026-09-13T12:00:00Z",
    location_id: locationId,
    min_volume: minVolume,
    order_id: orderId,
    price,
    range: "station",
    system_id: 30000142,
    type_id: typeId,
    volume_remain: volume,
    volume_total: volume,
  };
}

function quote(orders, quantity, side = "buy", typeId = 21) {
  return quoteMarketDepthFromOrders({ orders, typeId, itemName: `Type ${typeId}`, quantity, locationId: JITA_44_LOCATION_ID, side });
}

// One order fully covers the quantity.
{
  const value = quote([order({ orderId: 1, price: 100, volume: 1000 })], 250);
  assert.equal(value.filledQuantity, 250);
  assert.equal(value.unfilledQuantity, 0);
  assert.equal(value.ordersCrossed, 1);
  assert.equal(value.totalRealisedIsk, 25_000);
  assert.equal(value.fullMarketDepthSufficient, true);
}

// Quantity crosses multiple orders and weighted average is realised from actual fills.
{
  const value = quote([
    order({ orderId: 1, price: 100, volume: 100 }),
    order({ orderId: 2, price: 90, volume: 200 }),
    order({ orderId: 3, price: 80, volume: 500 }),
  ], 250);
  assert.equal(value.ordersCrossed, 2);
  assert.equal(value.highestBidUsed, 100);
  assert.equal(value.lowestBidCrossed, 90);
  assert.equal(value.totalRealisedIsk, 23_500);
  assert.equal(value.weightedAverageRealisedUnitPrice, 94);
  assert.deepEqual(value.fills.map((fill) => fill.quantity), [100, 150]);
}

// Exact exhaustion of an order does not cross the next level.
{
  const value = quote([
    order({ orderId: 1, price: 100, volume: 100 }),
    order({ orderId: 2, price: 90, volume: 100 }),
  ], 100);
  assert.equal(value.ordersCrossed, 1);
  assert.equal(value.lowestBidCrossed, 100);
}

// min_volume prevents a too-small fill and the walker continues to lower orders.
{
  const value = quote([
    order({ orderId: 1, price: 105, volume: 1000, minVolume: 100 }),
    order({ orderId: 2, price: 100, volume: 100, minVolume: 1 }),
  ], 50);
  assert.equal(value.ordersSkippedForMinVolume, 1);
  assert.equal(value.ordersCrossed, 1);
  assert.equal(value.highestBidUsed, 100);
  assert.equal(value.totalRealisedIsk, 5_000);
}

// Insufficient total depth is explicit and only filled units contribute realised ISK.
{
  const value = quote([
    order({ orderId: 1, price: 100, volume: 100 }),
    order({ orderId: 2, price: 90, volume: 50 }),
  ], 200);
  assert.equal(value.filledQuantity, 150);
  assert.equal(value.unfilledQuantity, 50);
  assert.equal(value.totalRealisedIsk, 14_500);
  assert.equal(value.fullMarketDepthSufficient, false);
}

// Jita station filtering excludes otherwise better orders at other locations.
{
  const value = quote([
    order({ orderId: 1, price: 500, volume: 1000, locationId: 60000001 }),
    order({ orderId: 2, price: 100, volume: 1000 }),
  ], 10);
  assert.equal(value.highestBidUsed, 100);
  assert.equal(value.totalRealisedIsk, 1_000);
}

// Buy direction takes highest bids; sell direction takes lowest asks.
{
  const orders = [
    order({ orderId: 1, price: 100, volume: 10, buy: true }),
    order({ orderId: 2, price: 110, volume: 10, buy: true }),
    order({ orderId: 3, price: 130, volume: 10, buy: false }),
    order({ orderId: 4, price: 120, volume: 10, buy: false }),
  ];
  const buy = quote(orders, 5, "buy");
  const sell = quote(orders, 5, "sell");
  assert.equal(buy.highestBidUsed, 110);
  assert.equal(sell.lowestAskUsed, 120);
  assert.equal(sell.highestAskCrossed, 120);
}

// Zero/invalid quantity is rejected before any fill.
{
  const value = quote([order({ orderId: 1, price: 100, volume: 10 })], 0);
  assert.match(value.error, /positive whole number/i);
  assert.equal(value.filledQuantity, 0);
}

// Multiple types in one batch use the compact first-class quote workflow.
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    const typeId = Number(parsed.searchParams.get("type_id"));
    const rows = typeId === 21
      ? [order({ orderId: 101, typeId: 21, price: 25, volume: 50 })]
      : [order({ orderId: 102, typeId: 17440, price: 40, volume: 100 })];
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json", "x-pages": "1" } });
  };
  try {
    const value = await quoteMarketDepth({
      items: [
        { typeId: 21, quantity: 20 },
        { typeId: 17440, quantity: 30 },
      ],
      regionId: FORGE,
      locationId: JITA_44_LOCATION_ID,
      side: "buy",
      fresh: true,
    });
    assert.equal(value.items.length, 2);
    assert.equal(value.items[0].totalRealisedIsk, 500);
    assert.equal(value.items[1].totalRealisedIsk, 1_200);
    assert.equal(value.grandTotalRealisedIsk, 1_700);
    assert.equal(value.fullMarketDepthSufficient, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// Unknown names fail cleanly without market access.
{
  const value = await quoteMarketDepth({ items: [{ name: "Definitely Not A Real EVE Market Type", quantity: 1 }], fresh: true });
  assert.equal(value.items.length, 1);
  assert.match(value.items[0].error, /unknown eve market type/i);
  assert.equal(value.grandTotalRealisedIsk, 0);
}

// Architecture regression: MCP, shared hub-depth artifact and Corp UI all point at the shared backend capability.
{
  const [mcp, worker, corp, policy] = await Promise.all([
    readFile(path.join(root, "electron/mcp-server.ts"), "utf8"),
    readFile(path.join(root, "tools/modal/public_data_worker.mjs"), "utf8"),
    readFile(path.join(root, "src/CorporationOreBuyback.tsx"), "utf8"),
    readFile(path.join(root, "electron/mcp-ai-policy.ts"), "utf8"),
  ]);
  assert.match(mcp, /registerTool\("quote_market_depth"/);
  assert.match(mcp, /registerTool\("calculate_corp_ore_buyback"/);
  assert.match(mcp, /type_id:/);
  assert.match(mcp, /location_id:/);
  assert.match(mcp, /payout_percent:/);
  assert.match(worker, /dataset: 'market-hub-depth'/);
  assert.match(worker, /location_id\) === 60003760/);
  assert.match(corp, /quoteMarketDepth\s*\(/);
  assert.match(corp, /fresh:\s*true/, "Corp resource buyback must always bypass shared/raw market snapshots and contact ESI.");
  assert.match(corp, /T2 Salvage/);
  assert.match(corp, /searchOreMarketTypes\(query, 12, resourceKind\)/);
  assert.match(policy, /quote_market_depth or calculate_corp_ore_buyback/);
}

console.log("market depth and corp ore buyback regression: ok");
