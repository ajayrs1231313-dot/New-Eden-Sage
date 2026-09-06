import type { MarketContractOpportunity } from "./types";

export type ContractFeeProfile = {
  characterId: string;
  characterName: string;
  accountingLevel: number;
  brokerRelationsLevel: number;
  salesTaxRate: number;
  brokerFeeRate: number;
};

type ExitProjection = {
  salesTaxAmount: number | null;
  salesTaxRate: number | null;
  brokerFeeAmount: number | null;
  brokerFeeRate: number | null;
  netRevenue: number | null;
  netProfit: number | null;
  netRoiPercent: number | null;
};

function projectExit(grossRevenue: number, grossProfit: number | null, investment: number, salesTaxRate: number, brokerFeeRate: number): ExitProjection {
  if (grossProfit == null) return { salesTaxAmount: null, salesTaxRate: null, brokerFeeAmount: null, brokerFeeRate: null, netRevenue: null, netProfit: null, netRoiPercent: null };
  const salesTaxAmount = Math.max(0, grossRevenue) * Math.max(0, salesTaxRate) / 100;
  const brokerFeeAmount = Math.max(0, grossRevenue) * Math.max(0, brokerFeeRate) / 100;
  const netRevenue = grossRevenue - salesTaxAmount - brokerFeeAmount;
  const netProfit = netRevenue - investment;
  const netRoiPercent = investment > 0 ? netProfit / investment * 100 : null;
  return { salesTaxAmount, salesTaxRate, brokerFeeAmount, brokerFeeRate, netRevenue, netProfit, netRoiPercent };
}

export function projectedStrongestProfit(row: MarketContractOpportunity) {
  return Math.max(row.immediateNetProfit ?? Number.NEGATIVE_INFINITY, row.bestBuyNetProfit ?? Number.NEGATIVE_INFINITY);
}

export function applyContractCharacterProjection(row: MarketContractOpportunity, profile: ContractFeeProfile): MarketContractOpportunity {
  const investment = row.price + (row.requestedItemsFullyPriced ? row.requestedItemCost : 0);
  const immediate = projectExit(row.immediateGross, row.immediateProfit, investment, profile.salesTaxRate, 0);
  const bestBuy = projectExit(row.bestBuyGross, row.bestBuyProfit, investment, profile.salesTaxRate, 0);
  const sellOrder = projectExit(row.sellOrderGross, row.sellOrderProfit, investment, profile.salesTaxRate, profile.brokerFeeRate);
  const strongest = Math.max(immediate.netProfit ?? Number.NEGATIVE_INFINITY, bestBuy.netProfit ?? Number.NEGATIVE_INFINITY);
  const strongestRoi = Math.max(immediate.netRoiPercent ?? Number.NEGATIVE_INFINITY, bestBuy.netRoiPercent ?? Number.NEGATIVE_INFINITY);
  const opportunity = strongest > Number.NEGATIVE_INFINITY && strongest >= 5_000_000 && strongestRoi > Number.NEGATIVE_INFINITY && strongestRoi >= 5;
  const score = opportunity
    ? Math.max(0, strongest / 1_000_000) + Math.max(0, strongestRoi) * 0.5 + (immediate.netProfit != null ? 25 : 0)
    : Math.max(0, strongest / 1_000_000);
  const originalNote = String(row.note ?? "")
    .replace("Profit is before character sales tax and logistics costs. ", "")
    .replace("Public gross profit excludes character market fees; Profit Opportunities applies those in its character projection. Logistics costs remain excluded. ", "")
    .trim();
  const feeNote = `Sales tax and applicable market fees are adjusted for ${profile.characterName} (Accounting ${profile.accountingLevel}, Broker Relations ${profile.brokerRelationsLevel}); hauling, fuel and other logistics costs remain excluded.`;

  return {
    ...row,
    grossScore: row.grossScore ?? row.score,
    grossOpportunity: row.grossOpportunity ?? row.opportunity,
    characterProjection: profile,
    immediateSalesTaxAmount: immediate.salesTaxAmount, immediateSalesTaxRate: immediate.salesTaxRate, immediateBrokerFeeAmount: immediate.brokerFeeAmount, immediateBrokerFeeRate: immediate.brokerFeeRate, immediateNetRevenue: immediate.netRevenue, immediateNetProfit: immediate.netProfit, immediateNetRoiPercent: immediate.netRoiPercent,
    bestBuySalesTaxAmount: bestBuy.salesTaxAmount, bestBuySalesTaxRate: bestBuy.salesTaxRate, bestBuyBrokerFeeAmount: bestBuy.brokerFeeAmount, bestBuyBrokerFeeRate: bestBuy.brokerFeeRate, bestBuyNetRevenue: bestBuy.netRevenue, bestBuyNetProfit: bestBuy.netProfit, bestBuyNetRoiPercent: bestBuy.netRoiPercent,
    sellOrderSalesTaxAmount: sellOrder.salesTaxAmount, sellOrderSalesTaxRate: sellOrder.salesTaxRate, sellOrderBrokerFeeAmount: sellOrder.brokerFeeAmount, sellOrderBrokerFeeRate: sellOrder.brokerFeeRate, sellOrderNetRevenue: sellOrder.netRevenue, sellOrderNetProfit: sellOrder.netProfit, sellOrderNetRoiPercent: sellOrder.netRoiPercent,
    score, opportunity, note: [feeNote, originalNote].filter(Boolean).join(" "),
  };
}

export function projectContractOpportunities(rows: MarketContractOpportunity[], profile: ContractFeeProfile) {
  return rows
    .map((row) => applyContractCharacterProjection(row, profile))
    .filter((row) => row.opportunity)
    .sort((a, b) => b.score - a.score || projectedStrongestProfit(b) - projectedStrongestProfit(a));
}
