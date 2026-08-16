import { parentPort, workerData } from "node:worker_threads";

type Order = { orderId: number; price: number; volumeRemain: number; minVolume: number };
type Entry = [number, any];
const input = workerData as { entries: Entry[]; previousMargins: Record<string, number | null>; cargoCapacity: number; capitalLimit: number };

function pairs(sells: Order[], buys: Order[]) {
  const found = new Map<string, { sell: Order; buy: Order }>();
  for (const sell of sells) { const buy = buys.find((item) => item.price > sell.price); if (buy) found.set(`${sell.orderId}:${buy.orderId}`, { sell, buy }); }
  for (const buy of buys) { const sell = sells.find((item) => buy.price > item.price); if (sell) found.set(`${sell.orderId}:${buy.orderId}`, { sell, buy }); }
  for (const sell of sells.slice(0, 12)) for (const buy of buys.slice(0, 12)) if (buy.price > sell.price) found.set(`${sell.orderId}:${buy.orderId}`, { sell, buy });
  return [...found.values()];
}

try {
  const prelim: any[] = [];
  let pairCount = 0;
  for (const [typeId, item] of input.entries) {
    if (!item.buys.length || !item.sells.length) continue;
    const itemPairs = pairs(item.sells, item.buys);
    pairCount += itemPairs.length;
    for (const { sell, buy } of itemPairs) {
      const availableUnits = Math.min(sell.volumeRemain, buy.volumeRemain);
      const cargoUnits = item.itemVolumeM3 > 0 ? Math.floor(input.cargoCapacity / item.itemVolumeM3) : availableUnits;
      const capitalUnits = Math.floor(input.capitalLimit / sell.price);
      const units = Math.min(availableUnits, cargoUnits, capitalUnits);
      if (units <= 0 || buy.minVolume > units) continue;
      const profit = (buy.price - sell.price) * units;
      if (profit <= 0) continue;
      prelim.push({ typeId, item: item.typeName, categoryId: item.categoryId, categoryName: item.categoryName, itemVolumeM3: item.itemVolumeM3, sell, buy, units, profit, previousMargin: input.previousMargins[String(typeId)] ?? null });
    }
  }
  parentPort?.postMessage({ type: "complete", prelim, pairCount });
} catch (error) {
  parentPort?.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) });
}
