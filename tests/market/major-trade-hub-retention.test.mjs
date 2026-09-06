import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { retainMajorHubCandidate } from "../../dist-electron/raw-market-analysis.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function order(overrides = {}) {
  return {
    orderId: 1,
    typeId: 638,
    price: 100,
    volumeRemain: 1,
    volumeTotal: 1,
    minVolume: 1,
    range: "station",
    issued: "2026-09-06T00:00:00Z",
    durationDays: 90,
    regionId: 10000030,
    regionName: "Heimatar",
    systemId: 30002510,
    systemName: "Rens",
    securityStatus: 0.9,
    securityBand: "high",
    locationId: 60004588,
    locationName: "Rens hub",
    ...overrides,
  };
}

const buys = [];
retainMajorHubCandidate(buys, order({ orderId: 10, price: 120 }), true);
retainMajorHubCandidate(buys, order({ orderId: 11, price: 125 }), true);
retainMajorHubCandidate(buys, order({ orderId: 12, price: 125, volumeRemain: 3 }), true);
retainMajorHubCandidate(buys, order({ orderId: 13, systemId: 30002053, systemName: "Hek", price: 130 }), true);
retainMajorHubCandidate(buys, order({ orderId: 14, systemId: 30000001, systemName: "Tanoo", price: 999 }), true);

assert.equal(buys.length, 2, "retain exactly one best buy per configured major hub");
assert.equal(buys.find((candidate) => candidate.systemName === "Rens")?.orderId, 12, "Rens keeps the best price, then best depth");
assert.equal(buys.find((candidate) => candidate.systemName === "Hek")?.orderId, 13, "Hek is independently retained");
assert.equal(buys.some((candidate) => candidate.systemName === "Tanoo"), false, "non-hubs do not expand retained detail");

const sells = [];
retainMajorHubCandidate(sells, order({ orderId: 20, price: 150 }), false);
retainMajorHubCandidate(sells, order({ orderId: 21, price: 145 }), false);
assert.equal(sells.length, 1);
assert.equal(sells[0].orderId, 21, "sell retention keeps the cheapest exact hub order");

const workerSource = await readFile(path.join(root, "tools/modal/public_data_worker.mjs"), "utf8");
assert.match(workerSource, /mergeRetainedMarketOrders\(item\.buys, majorHubBuys, true\)/, "published shared market must include retained hub buys");
assert.match(workerSource, /mergeRetainedMarketOrders\(item\.sells, majorHubSells, false\)/, "published shared market must include retained hub sells");

console.log("major trade-hub retention regression: ok");
