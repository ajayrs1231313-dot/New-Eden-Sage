import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accountingTaxPercentFromLevel, brokerEstimatePercentFromLevel } from "../../src/market-day-trader.ts";
import { applyContractCharacterProjection, projectContractOpportunities } from "../../src/contract-profit-projection.ts";

const ROOT = new URL("../../", import.meta.url);
const closeTo = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

function profile(name, accountingLevel, brokerRelationsLevel = 0) {
  return {
    characterId: name.toLowerCase().replaceAll(" ", "-"),
    characterName: name,
    accountingLevel,
    brokerRelationsLevel,
    salesTaxRate: accountingTaxPercentFromLevel(accountingLevel),
    brokerFeeRate: brokerEstimatePercentFromLevel(brokerRelationsLevel),
  };
}

function row(overrides = {}) {
  const price = overrides.price ?? 15_000_000;
  const immediateGross = overrides.immediateGross ?? 32_903_600;
  const bestBuyGross = overrides.bestBuyGross ?? 0;
  const sellOrderGross = overrides.sellOrderGross ?? 35_000_000;
  return {
    contractId: overrides.contractId ?? 1,
    price,
    requestedItemsFullyPriced: true,
    requestedItemCost: 0,
    immediateGross,
    immediateProfit: overrides.immediateProfit ?? immediateGross - price,
    immediateRoiPercent: (instantSale => instantSale / price * 100)(immediateGross - price),
    bestBuyGross,
    bestBuyProfit: overrides.bestBuyProfit ?? (bestBuyGross > 0 ? bestBuyGross - price : null),
    bestBuyRoiPercent: bestBuyGross > 0 ? (bestBuyGross - price) / price * 100 : null,
    sellOrderGross,
    sellOrderProfit: overrides.sellOrderProfit ?? sellOrderGross - price,
    sellOrderRoiPercent: (sellOrderGross - price) / price * 100,
    score: overrides.score ?? 99,
    opportunity: true,
    note: "Profit is before character sales tax and logistics costs. Test note.",
    ...overrides,
  };
}

// Accounting materially changes the same public contract's net result.
{
  const publicRow = row();
  const l0 = applyContractCharacterProjection(publicRow, profile("Accounting 0", 0));
  const l5 = applyContractCharacterProjection(publicRow, profile("Accounting 5", 5));
  closeTo(l0.immediateSalesTaxRate, 7.5);
  closeTo(l5.immediateSalesTaxRate, 3.375);
  closeTo(l0.immediateSalesTaxAmount, 2_467_770);
  closeTo(l5.immediateSalesTaxAmount, 1_110_496.5);
  closeTo(l0.immediateNetProfit, 15_435_830);
  closeTo(l5.immediateNetProfit, 16_793_103.5);
  assert.ok(l5.immediateNetProfit > l0.immediateNetProfit);
  assert.equal(publicRow.immediateProfit, 17_903_600, "public gross row must remain unmutated");
}

// Immediate/best-buy exits pay transaction tax but no broker/listing fee.
{
  const projected = applyContractCharacterProjection(row({ bestBuyGross: 33_000_000 }), profile("Immediate", 4, 4));
  assert.ok(projected.immediateSalesTaxAmount > 0);
  assert.equal(projected.immediateBrokerFeeAmount, 0);
  assert.ok(projected.bestBuySalesTaxAmount > 0);
  assert.equal(projected.bestBuyBrokerFeeAmount, 0);
}

// Sell-order projection includes both tax and Broker Relations listing fee.
{
  const projected = applyContractCharacterProjection(row(), profile("Sell Order", 3, 4));
  assert.ok(projected.sellOrderSalesTaxAmount > 0);
  assert.ok(projected.sellOrderBrokerFeeAmount > 0);
  closeTo(projected.sellOrderBrokerFeeRate, 1.8);
  closeTo(projected.sellOrderNetRevenue, 35_000_000 * (1 - (accountingTaxPercentFromLevel(3) + 1.8) / 100));
}

// Character switching is a pure projection over the same public row and does not change gross data.
{
  const publicRow = row({});
  const aj = applyContractCharacterProjection(publicRow, profile("AJdeathgiver", 5, 4));
  const ned = applyContractCharacterProjection(publicRow, profile("Nedoode", 1, 0));
  assert.equal(aj.immediateGross, ned.immediateGross);
  assert.notEqual(aj.immediateSalesTaxAmount, ned.immediateSalesTaxAmount);
  assert.notEqual(aj.immediateNetProfit, ned.immediateNetProfit);
  assert.equal(publicRow.characterProjection, undefined);
}

// Net profit, not gross profit, determines qualification and ranking.
{
  const rowA = row({ contractId: 101, price: 80_000_000, immediateGross: 100_000_000, immediateProfit: 20_000_000, sellOrderGross: 0, sellOrderProfit: null });
  const rowB = row({ contractId: 102, price: 21_000_000, immediateGross: 40_000_000, immediateProfit: 19_000_000, sellOrderGross: 0, sellOrderProfit: null });
  assert.ok(rowA.immediateProfit > rowB.immediateProfit, "setup requires A to win on gross profit");
  const ranked = projectContractOpportunities([rowA, rowB], profile("Ranker", 0, 0));
  assert.equal(ranked[0].contractId, 102, "net profit must flip the gross rank");
  assert.ok(ranked[0].immediateNetProfit > ranked[1].immediateNetProfit);
  assert.ok(ranked[0].score > ranked[1].score, "score should follow net economics");
}

// A gross-5.1M lead that falls below 5M after tax is no longer a profit opportunity.
{
  const barelyGross = row({ contractId: 202, price: 10_000_000, immediateGross: 15_100_000, immediateProfit: 5_100_000, sellOrderGross: 0, sellOrderProfit: null });
  const projected = projectContractOpportunities([barelyGross], profile("Qualifier", 5, 5));
  assert.equal(projected.length, 0);
}

// Architecture guard: the public workspace load remains keyed only to public market revision.
{
  const source = readFileSync(new URL("src/MarketContracts.tsx", ROOT), "utf8");
  assert.ok(source.includes("useEffect(()=>{void load();},[marketDataRevision]);"), "public contract workspace load must remain keyed to market revision only");
  assert.ok(!source.includes("useEffect(()=>{void load();},[marketDataRevision,snapshot"), "character switch must not join the public load dependency list");
  assert.ok(source.includes("projectContractOpportunities("));
}

console.log(JSON.stringify({ accountingLevels: true, immediateNoBroker: true, sellOrderFees: true, characterSwitch: true, netRanking: true, netQualification: true, warmOnce: true }));
