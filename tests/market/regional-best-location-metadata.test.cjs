const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');

const root = path.resolve(__dirname, '../..');
const analysis = require(path.join(root, 'dist-electron/raw-market-analysis.js'));

function metrics() {
  return {
    buyOrders: 0, buyVolume: 0, sellOrders: 0, sellVolume: 0,
    bestBuy: null, bestBuyOrderId: null, bestBuySystemId: null, bestBuySystemName: null, bestBuyLocationId: null, bestBuyLocationName: null, bestBuyVolume: 0,
    bestSell: null, bestSellOrderId: null, bestSellSystemId: null, bestSellSystemName: null, bestSellLocationId: null, bestSellLocationName: null, bestSellVolume: 0,
  };
}

const band = metrics();
analysis.recordRegionalOrder(band, { is_buy_order: true, price: 120_000_000, volume_remain: 5, order_id: 20 }, {
  orderId: 20, systemId: 30000142, systemName: 'Jita', locationId: 60003760, locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
});
assert.equal(band.bestBuyLocationId, 60003760);
assert.equal(band.bestBuyLocationName, 'Jita IV - Moon 4 - Caldari Navy Assembly Plant');
assert.equal(band.bestBuySystemName, 'Jita');
assert.equal(band.bestBuyOrderId, 20);

analysis.recordRegionalOrder(band, { is_buy_order: true, price: 119_000_000, volume_remain: 500, order_id: 10 }, {
  orderId: 10, systemId: 30002187, systemName: 'Amarr', locationId: 60008494, locationName: 'Amarr VIII (Oris) - Emperor Family Academy',
});
assert.equal(band.bestBuyLocationId, 60003760, 'lower buy price must not replace the regional winner');

analysis.recordRegionalOrder(band, { is_buy_order: true, price: 120_000_000, volume_remain: 25, order_id: 30 }, {
  orderId: 30, systemId: 30002187, systemName: 'Amarr', locationId: 60008494, locationName: 'Amarr VIII (Oris) - Emperor Family Academy',
});
assert.equal(band.bestBuyLocationId, 60008494, 'equal-price deeper order must deterministically become the winner');
assert.equal(band.bestBuyVolume, 25);

analysis.recordRegionalOrder(band, { is_buy_order: true, price: 120_000_000, volume_remain: 25, order_id: 15 }, {
  orderId: 15, systemId: 30002659, systemName: 'Dodixie', locationId: 60011866, locationName: 'Dodixie IX - Moon 20 - Federation Navy Assembly Plant',
});
assert.equal(band.bestBuyOrderId, 15, 'equal-price equal-depth winner must use stable lower order id');
assert.equal(band.bestBuyLocationName, 'Dodixie IX - Moon 20 - Federation Navy Assembly Plant');

const sellBand = metrics();
analysis.recordRegionalOrder(sellBand, { is_buy_order: false, price: 130_000_000, volume_remain: 8, order_id: 40 }, {
  orderId: 40, systemId: 30000142, systemName: 'Jita', locationId: 60003760, locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
});
analysis.recordRegionalOrder(sellBand, { is_buy_order: false, price: 125_000_000, volume_remain: 2, order_id: 41 }, {
  orderId: 41, systemId: 30002187, systemName: 'Amarr', locationId: 60008494, locationName: 'Amarr VIII (Oris) - Emperor Family Academy',
});
assert.equal(sellBand.bestSellLocationId, 60008494, 'lower sell price must carry its exact winning location');

const sdePath = 'F:/New Eden Sage Data/Static Data/eve-static-data-jsonl.zip';
const zip = new AdmZip(sdePath);
const entry = zip.getEntry('npcStations.jsonl');
assert(entry, 'authoritative SDE must include npcStations.jsonl');
let jita = null;
for (const line of entry.getData().toString('utf8').split(/\r?\n/)) {
  if (!line) continue;
  const row = JSON.parse(line);
  if (Number(row._key) === 60003760) { jita = row; break; }
}
assert(jita, 'Jita IV - Moon 4 station must exist in authoritative SDE');
assert.equal(Number(jita.solarSystemID), 30000142, 'authoritative SDE must identify the NPC station and its solar system');

const worker = fs.readFileSync(path.join(root, 'tools/modal/public_data_worker.mjs'), 'utf8');
assert.match(worker, /bestBuyLocationId/);
assert.match(worker, /resolveMarketNpcStationNames\(index\)/);
assert.match(worker, /resolveContractPublicNames\(\[\.\.\.needed\]\)/);
assert.match(worker, /stationNames\.get\(Number\(band\.bestBuyLocationId\)\)/);
assert.match(worker, /schemaVersion: 2, dataset: 'market-global'/);
assert.match(worker, /marketSchemaUpgradeRequired/);

console.log('Regional-best exact location metadata + authoritative station resolution checks passed');
