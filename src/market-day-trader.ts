export type DayTradeEconomicsInput = {
  buyUnitPrice: number;
  sellUnitPrice: number;
  units: number;
  cargoM3: number;
  jumps: number;
  salesTaxPercent: number;
  brokerFeePercent: number;
  haulingCostIsk: number;
  marginWidenedBy?: number | null;
};

export type DayTradeEconomics = {
  investment: number;
  grossProfit: number;
  saleGross: number;
  salesTax: number;
  brokerFee: number;
  haulingCost: number;
  netProfit: number;
  netMarginPercent: number;
  netIskPerM3: number;
  netIskPerJump: number;
  breakEvenSellPrice: number | null;
  wideningPercent: number | null;
};

export function accountingTaxPercentFromLevel(level: number) {
  const trained = Math.max(0, Math.min(5, Number.isFinite(level) ? level : 0));
  return 7.5 * (1 - 0.11 * trained);
}

export function brokerEstimatePercentFromLevel(level: number) {
  const trained = Math.max(0, Math.min(5, Number.isFinite(level) ? level : 0));
  return Math.max(1, 3 - 0.3 * trained);
}

export function calculateDayTradeEconomics(input: DayTradeEconomicsInput): DayTradeEconomics {
  const units = Math.max(0, Number(input.units) || 0);
  const buyUnitPrice = Math.max(0, Number(input.buyUnitPrice) || 0);
  const sellUnitPrice = Math.max(0, Number(input.sellUnitPrice) || 0);
  const investment = buyUnitPrice * units;
  const saleGross = sellUnitPrice * units;
  const grossProfit = saleGross - investment;
  const salesTaxPercent = Math.max(0, Number(input.salesTaxPercent) || 0);
  const brokerFeePercent = Math.max(0, Number(input.brokerFeePercent) || 0);
  const salesTax = saleGross * salesTaxPercent / 100;
  const brokerFee = saleGross * brokerFeePercent / 100;
  const haulingCost = Math.max(0, Number(input.haulingCostIsk) || 0);
  const netProfit = grossProfit - salesTax - brokerFee - haulingCost;
  const netMarginPercent = investment > 0 ? netProfit / investment * 100 : 0;
  const cargoM3 = Math.max(0, Number(input.cargoM3) || 0);
  const netIskPerM3 = cargoM3 > 0 ? netProfit / cargoM3 : netProfit > 0 ? Infinity : 0;
  const netIskPerJump = netProfit / Math.max(1, Math.max(0, Number(input.jumps) || 0));
  const retainedSaleFraction = 1 - (salesTaxPercent + brokerFeePercent) / 100;
  const breakEvenSellPrice = retainedSaleFraction > 0 && units > 0
    ? (investment + haulingCost) / units / retainedSaleFraction
    : null;
  const currentUnitMargin = sellUnitPrice - buyUnitPrice;
  const marginWidenedBy = input.marginWidenedBy == null ? null : Number(input.marginWidenedBy);
  const previousMargin = marginWidenedBy == null ? null : currentUnitMargin - marginWidenedBy;
  const wideningPercent = marginWidenedBy == null || previousMargin == null || previousMargin === 0
    ? null
    : marginWidenedBy / Math.abs(previousMargin) * 100;

  return { investment, grossProfit, saleGross, salesTax, brokerFee, haulingCost, netProfit, netMarginPercent, netIskPerM3, netIskPerJump, breakEvenSellPrice, wideningPercent };
}
