import type { MarketOpportunity, OpportunityRisk } from "./types";

export type MarketOpportunitySort =
  | "score"
  | "profit"
  | "margin"
  | "fill"
  | "iskm3"
  | "iskjump"
  | "capital"
  | "jumps";

export type MarketOpportunityFilters = {
  search: string;
  exclude: string;
  category: string;
  sellRegion: string;
  buyRegion: string;
  risks: OpportunityRisk[];
  routeSecurity: "all" | "high" | "low" | "null";
  minProfit: number | null;
  minMarginPercent: number | null;
  minFillScore: number | null;
  minIskPerM3: number | null;
  maxInvestment: number | null;
  maxJumps: number | null;
  maxMinutes: number | null;
  minUnits: number | null;
  crossRegionOnly: boolean;
  sort: MarketOpportunitySort;
};

export const defaultMarketOpportunityFilters: MarketOpportunityFilters = {
  search: "",
  exclude: "",
  category: "all",
  sellRegion: "all",
  buyRegion: "all",
  risks: ["Low", "Medium", "High"],
  routeSecurity: "all",
  minProfit: null,
  minMarginPercent: null,
  minFillScore: null,
  minIskPerM3: null,
  maxInvestment: null,
  maxJumps: null,
  maxMinutes: null,
  minUnits: null,
  crossRegionOnly: false,
  sort: "score",
};

function tokens(value: string) {
  return value
    .toLowerCase()
    .split(/[\s,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function haystack(item: MarketOpportunity) {
  return [
    item.item,
    item.category,
    item.sell.regionName,
    item.sell.systemName,
    item.sell.locationName,
    item.buy.regionName,
    item.buy.systemName,
    item.buy.locationName,
  ]
    .join(" ")
    .toLowerCase();
}

export function filterMarketOpportunities(
  items: MarketOpportunity[],
  filters: MarketOpportunityFilters,
) {
  const includeTokens = tokens(filters.search);
  const excludeTokens = tokens(filters.exclude);
  return items
    .filter((item) => {
      const text = haystack(item);
      if (includeTokens.some((token) => !text.includes(token))) return false;
      if (excludeTokens.some((token) => text.includes(token))) return false;
      if (filters.category !== "all" && item.category !== filters.category) return false;
      if (filters.sellRegion !== "all" && item.sell.regionName !== filters.sellRegion) return false;
      if (filters.buyRegion !== "all" && item.buy.regionName !== filters.buyRegion) return false;
      if (!filters.risks.includes(item.risk)) return false;
      if (filters.routeSecurity !== "all" && item.routeSecurity !== filters.routeSecurity) return false;
      if (filters.minProfit != null && item.profit < filters.minProfit) return false;
      if (filters.minMarginPercent != null && item.marginPercent < filters.minMarginPercent) return false;
      if (filters.minFillScore != null && item.fillScore < filters.minFillScore) return false;
      if (filters.minIskPerM3 != null && (!Number.isFinite(item.iskPerM3) || item.iskPerM3 < filters.minIskPerM3)) return false;
      if (filters.maxInvestment != null && item.investment > filters.maxInvestment) return false;
      if (filters.maxJumps != null && item.jumps > filters.maxJumps) return false;
      if (filters.maxMinutes != null && item.estimatedMinutes > filters.maxMinutes) return false;
      if (filters.minUnits != null && item.units < filters.minUnits) return false;
      if (filters.crossRegionOnly && item.sell.regionName === item.buy.regionName) return false;
      return true;
    })
    .sort((a, b) => {
      switch (filters.sort) {
        case "profit":
          return b.profit - a.profit || b.score - a.score;
        case "margin":
          return b.marginPercent - a.marginPercent || b.profit - a.profit;
        case "fill":
          return b.fillScore - a.fillScore || b.profit - a.profit;
        case "iskm3":
          return (Number.isFinite(b.iskPerM3) ? b.iskPerM3 : Number.MAX_SAFE_INTEGER) -
            (Number.isFinite(a.iskPerM3) ? a.iskPerM3 : Number.MAX_SAFE_INTEGER);
        case "iskjump":
          return b.iskPerJump - a.iskPerJump;
        case "capital":
          return b.capitalEfficiencyPercent - a.capitalEfficiencyPercent || b.profit - a.profit;
        case "jumps":
          return a.jumps - b.jumps || b.profit - a.profit;
        default:
          return b.score - a.score || b.profit - a.profit;
      }
    });
}
