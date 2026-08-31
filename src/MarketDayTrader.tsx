import { useEffect, useMemo, useState } from "react";
import type { CharacterSnapshot, MarketOpportunity, OpportunityAnalysis } from "./types";
import { accountingTaxPercentFromLevel, brokerEstimatePercentFromLevel, calculateDayTradeEconomics } from "./market-day-trader";
import { IskGlyph } from "./IskIcons";

type DayTraderSort = "net" | "roi" | "fill" | "widening" | "iskm3" | "iskjump" | "jumps";
type DayTraderSettings = {
  search: string;
  sourceRegion: string;
  targetRegion: string;
  salesTaxPercent: number;
  brokerFeePercent: number;
  haulingCostIsk: number;
  minNetProfit: number;
  minNetMarginPercent: number;
  minFillScore: number;
  maxCapital: number | null;
  maxJumps: number | null;
  highSecOnly: boolean;
  crossRegionOnly: boolean;
  wideningOnly: boolean;
  sort: DayTraderSort;
};

type DayTraderRow = {
  trade: MarketOpportunity;
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

const money = (value: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);
const compact = (value: number) => new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 2 }).format(value);

function skillLevel(snapshot: CharacterSnapshot | undefined, name: string) {
  return Number(snapshot?.skills?.skills?.find((skill: any) => skill.name === name)?.trained_skill_level ?? 0);
}

function accountingTaxPercent(snapshot?: CharacterSnapshot) { return accountingTaxPercentFromLevel(skillLevel(snapshot, "Accounting")); }
function brokerEstimatePercent(snapshot?: CharacterSnapshot) { return brokerEstimatePercentFromLevel(skillLevel(snapshot, "Broker Relations")); }

function defaults(snapshot?: CharacterSnapshot): DayTraderSettings {
  return {
    search: "",
    sourceRegion: "all",
    targetRegion: "all",
    salesTaxPercent: accountingTaxPercent(snapshot),
    brokerFeePercent: 0,
    haulingCostIsk: 0,
    minNetProfit: 0,
    minNetMarginPercent: 0,
    minFillScore: 0,
    maxCapital: null,
    maxJumps: null,
    highSecOnly: false,
    crossRegionOnly: true,
    wideningOnly: false,
    sort: "net",
  };
}

function numberOr(value: string, fallback: number) {
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: string) {
  const clean = value.trim();
  if (!clean) return null;
  const parsed = Number(clean.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function isWithinJumpLimit(jumps: unknown, maxJumps: number | null) {
  if (maxJumps == null) return true;
  const jumpCount = Number(jumps);
  const limit = Number(maxJumps);
  return Number.isFinite(jumpCount) && Number.isFinite(limit) && jumpCount <= Math.max(0, limit);
}

function turnoverLabel(fillScore: number) {
  if (fillScore >= 88) return "HOT";
  if (fillScore >= 75) return "ACTIVE";
  if (fillScore >= 58) return "WATCH";
  return "THIN";
}

function rowFor(trade: MarketOpportunity, settings: DayTraderSettings): DayTraderRow {
  const economics = calculateDayTradeEconomics({
    buyUnitPrice: trade.sell.price,
    sellUnitPrice: trade.buy.price,
    units: trade.units,
    cargoM3: trade.cargoM3,
    jumps: trade.jumps,
    salesTaxPercent: settings.salesTaxPercent,
    brokerFeePercent: settings.brokerFeePercent,
    haulingCostIsk: settings.haulingCostIsk,
    marginWidenedBy: trade.marginWidenedBy,
  });
  return { trade, saleGross: economics.saleGross, salesTax: economics.salesTax, brokerFee: economics.brokerFee, haulingCost: economics.haulingCost, netProfit: economics.netProfit, netMarginPercent: economics.netMarginPercent, netIskPerM3: economics.netIskPerM3, netIskPerJump: economics.netIskPerJump, breakEvenSellPrice: economics.breakEvenSellPrice, wideningPercent: economics.wideningPercent };
}

export function MarketDayTrader({ analysis, snapshot, onCargoCapacityChange, marketBusy = false }: { analysis: OpportunityAnalysis; snapshot?: CharacterSnapshot; onCargoCapacityChange?: (cargoCapacityM3: number | null, cargoProfileId?: string | null) => void | Promise<void>; marketBusy?: boolean }) {
  const storageKey = `new-eden-sage-market-day-trader-v1:${snapshot?.characterId ?? "market"}`;
  const [settings, setSettings] = useState<DayTraderSettings>(() => defaults(snapshot));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [completionStatus, setCompletionStatus] = useState<Record<string,string>>({});
  const [cargoInput, setCargoInput] = useState(String(Math.round(analysis.constraints.cargoCapacityM3)));
  const [cargoProfileId, setCargoProfileId] = useState(analysis.constraints.cargoProfileId ?? "custom");
  const brokerEstimate = brokerEstimatePercent(snapshot);
  const canUseCurrentFittedShip = Boolean(snapshot?.ship?.ship_type_id && Array.isArray(snapshot?.extended?.currentShipFit));
  useEffect(() => {
    setCargoInput(String(Math.round(analysis.constraints.cargoCapacityM3)));
    setCargoProfileId(analysis.constraints.cargoProfileId ?? "custom");
  }, [analysis.constraints.cargoCapacityM3, analysis.constraints.cargoProfileId]);
  const applyCargo = () => {
    const parsed = Number(cargoInput.replace(/,/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) { setCargoProfileId("custom"); void onCargoCapacityChange?.(Math.round(parsed), null); }
  };

  useEffect(() => {
    const base = defaults(snapshot);
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Partial<DayTraderSettings> | null;
      setSettings(stored ? { ...base, ...stored } : base);
    } catch {
      setSettings(base);
    }
    setExpanded(null);
  }, [storageKey, snapshot?.updatedAt]);


  const sourceRegions = analysis.market.facets.sellRegions;
  const targetRegions = analysis.market.facets.buyRegions;

  const rows = useMemo(() => {
    const query = settings.search.trim().toLowerCase();
    const calculated = analysis.market.opportunities.map((trade) => rowFor(trade, settings)).filter((row) => {
      const trade = row.trade;
      if (query && !`${trade.item} ${trade.category} ${trade.sell.regionName} ${trade.sell.systemName} ${trade.sell.locationName} ${trade.buy.regionName} ${trade.buy.systemName} ${trade.buy.locationName}`.toLowerCase().includes(query)) return false;
      if (settings.sourceRegion !== "all" && trade.sell.regionName !== settings.sourceRegion) return false;
      if (settings.targetRegion !== "all" && trade.buy.regionName !== settings.targetRegion) return false;
      if (settings.crossRegionOnly && trade.sell.regionName === trade.buy.regionName) return false;
      if (settings.highSecOnly && trade.routeSecurity !== "high") return false;
      if (settings.wideningOnly && !(trade.marginWidenedBy != null && trade.marginWidenedBy > 0)) return false;
      if (trade.fillScore < settings.minFillScore) return false;
      if (row.netProfit < settings.minNetProfit) return false;
      if (row.netMarginPercent < settings.minNetMarginPercent) return false;
      if (settings.maxCapital != null && trade.investment > settings.maxCapital) return false;
      if (!isWithinJumpLimit(trade.jumps, settings.maxJumps)) return false;
      return true;
    });
    const sortValue = (row: DayTraderRow) => {
      if (settings.sort === "roi") return row.netMarginPercent;
      if (settings.sort === "fill") return row.trade.fillScore;
      if (settings.sort === "widening") return row.trade.marginWidenedBy ?? -Infinity;
      if (settings.sort === "iskm3") return row.netIskPerM3;
      if (settings.sort === "iskjump") return row.netIskPerJump;
      if (settings.sort === "jumps") return -row.trade.jumps;
      return row.netProfit;
    };
    return calculated.sort((a, b) => sortValue(b) - sortValue(a));
  }, [analysis.market.opportunities, settings]);

  const lanes = useMemo(() => {
    const grouped = new Map<string, { source: string; target: string; count: number; bestNet: number; bestRoi: number }>();
    for (const row of rows) {
      const key = `${row.trade.sell.regionName}â†’${row.trade.buy.regionName}`;
      const lane = grouped.get(key) ?? { source: row.trade.sell.regionName, target: row.trade.buy.regionName, count: 0, bestNet: -Infinity, bestRoi: -Infinity };
      lane.count += 1;
      lane.bestNet = Math.max(lane.bestNet, row.netProfit);
      lane.bestRoi = Math.max(lane.bestRoi, row.netMarginPercent);
      grouped.set(key, lane);
    }
    return [...grouped.values()].sort((a, b) => b.bestNet - a.bestNet).slice(0, 6);
  }, [rows]);

  const best = rows[0];
  const bestRoi = [...rows].sort((a, b) => b.netMarginPercent - a.netMarginPercent)[0];
  const fastSafe = rows.find((row) => row.trade.routeSecurity === "high" && row.trade.fillScore >= 75 && row.trade.jumps <= 10);

  const dashboard = useMemo(() => {
    let topNet: DayTraderRow | undefined;
    let topGross: DayTraderRow | undefined;
    let totalMargin = 0;
    let demandCount = 0;
    let routeQualityCount = 0;
    const bestSpreads: DayTraderRow[] = [];
    for (const row of rows) {
      if (!topNet || row.netProfit > topNet.netProfit) topNet = row;
      if (!topGross || row.trade.profit > topGross.trade.profit) topGross = row;
      totalMargin += row.netMarginPercent;
      if (row.trade.fillScore >= 75) demandCount += 1;
      if (row.trade.routeSecurity === "high" && row.trade.risk === "Low") routeQualityCount += 1;
      bestSpreads.push(row);
      bestSpreads.sort((left, right) => right.netMarginPercent - left.netMarginPercent);
      if (bestSpreads.length > 5) bestSpreads.length = 5;
    }
    return {
      topNet,
      topGross,
      bestSpreads,
      averageMargin: rows.length ? totalMargin / rows.length : 0,
      demandPercent: rows.length ? Math.round((demandCount / rows.length) * 100) : 0,
      routeQualityPercent: rows.length ? Math.round((routeQualityCount / rows.length) * 100) : 0,
    };
  }, [rows]);
  const topOpportunity = dashboard.topNet ?? best;

  function replaceSettings(next: DayTraderSettings) {
    setSettings(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
  }
  function patch(next: Partial<DayTraderSettings>) {
    setSettings((current) => {
      const updated = { ...current, ...next };
      try { localStorage.setItem(storageKey, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }
  function preset(id: string) {
    if (id === "fast") patch({ maxJumps: 10, minFillScore: 70, highSecOnly: true, wideningOnly: false, sort: "net" });
    if (id === "confidence") patch({ minFillScore: 85, highSecOnly: false, wideningOnly: false, sort: "fill" });
    if (id === "volatile") patch({ wideningOnly: true, sort: "widening" });
    if (id === "net") patch({ wideningOnly: false, sort: "net" });
    if (id === "roi") patch({ wideningOnly: false, sort: "roi" });
    if (id === "cargo") patch({ wideningOnly: false, sort: "iskm3" });
  }

  async function completeTrade(row: DayTraderRow) {
    const trade=row.trade;
    if(!snapshot?.characterId){setCompletionStatus(current=>({...current,[trade.id]:"Select the character that completed this trade."}));return;}
    setCompletionStatus(current=>({...current,[trade.id]:"Recording..."}));
    try{
      const record=await window.sage.completeProfitDeal({characterId:snapshot.characterId,source:"market-opportunity",sourceKey:trade.id,title:`${trade.item}: ${trade.sell.systemName} → ${trade.buy.systemName}`,estimatedCost:trade.investment+row.haulingCost,estimatedRevenue:row.saleGross,estimatedProfit:row.netProfit,items:[{typeId:trade.typeId,name:trade.item,quantity:trade.units,expectedUnitSell:trade.buy.price}],metadata:{buySystem:trade.sell.systemName,sellSystem:trade.buy.systemName,buyOrderId:trade.sell.orderId,sellOrderId:trade.buy.orderId,salesTaxEstimate:row.salesTax,brokerEstimate:row.brokerFee,haulingCost:row.haulingCost}});
      setCompletionStatus(current=>({...current,[trade.id]:record.reconciliationStatus==="exact"?"Recorded — wallet sale matched.":"Recorded — awaiting/using synced wallet reconciliation."}));
      window.dispatchEvent(new Event("sage:profit-ledger-updated"));
    } catch(error){setCompletionStatus(current=>({...current,[trade.id]:error instanceof Error?error.message:"Could not record this trade."}));}
  }
  async function copyPlan(row: DayTraderRow) {
    const trade = row.trade;
    const text = [
      `New Eden Sage - Market Opportunity`,
      `${trade.item}`,
      `BUY ${trade.units.toLocaleString("en-GB")} @ ${money(trade.sell.price)} ISK - ${trade.sell.locationName}, ${trade.sell.systemName} (${trade.sell.regionName})`,
      `HAUL ${trade.cargoM3.toLocaleString("en-GB", { maximumFractionDigits: 1 })} m3 - ${trade.jumps} jumps - ${trade.routeSecurity} route`,
      `SELL @ ${money(trade.buy.price)} ISK - ${trade.buy.locationName}, ${trade.buy.systemName} (${trade.buy.regionName})`,
      `Gross profit: ${money(trade.profit)} ISK`,
      `Sales tax (${settings.salesTaxPercent.toFixed(3)}%): -${money(row.salesTax)} ISK`,
      `Broker fee (${settings.brokerFeePercent.toFixed(3)}%): -${money(row.brokerFee)} ISK`,
      `Hauling cost: -${money(row.haulingCost)} ISK`,
      `NET PROFIT: ${money(row.netProfit)} ISK (${row.netMarginPercent.toFixed(2)}%)`,
      `Fill confidence: ${trade.fillScore}/100 | ${trade.jumps} jumps | ${money(row.netIskPerJump)} net ISK/jump`,
      `Re-check both orders in EVE before committing ISK.`,
    ].join("\n");
    await window.sage.copyText(text);
  }

  return <section className="day-trader-workspace day-trader-polished">
    <section className="mo-intelligence-hero">
      <div className="mo-hero-copy">
        <p className="eyebrow">CROSS-REGION INTELLIGENCE</p>
        <h3>Cross-Region Trade Intelligence</h3>
        <p className="mo-hero-subtitle">Discover profitable arbitrage. Move value where it’s worth more.</p>
        <p className="mo-hero-description">Sage ranks executable cross-region trades from the retained public order book, then applies your tax, broker, hauling, cargo and route assumptions before a route reaches this desk.</p>
      </div>

      <div className="mo-network-stage" aria-hidden="true">
        <svg viewBox="0 0 520 220" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="moRouteFade" x1="0" x2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0" />
              <stop offset="0.5" stopColor="currentColor" stopOpacity="0.85" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
            <radialGradient id="moNodeGlow">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.9" />
              <stop offset="0.3" stopColor="currentColor" stopOpacity="0.3" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </radialGradient>
          </defs>
          <g className="mo-network-grid">
            <path d="M10 170C92 138 142 158 208 118S328 52 510 82" />
            <path d="M22 194C124 118 190 142 252 84S391 48 500 136" />
            <path d="M34 72C128 118 158 34 246 82S378 182 494 104" />
            <path d="M74 210C154 154 197 181 274 118S388 75 458 26" />
            <path d="M78 40C132 80 189 77 252 118S364 145 462 176" />
            <path d="M156 22C177 72 203 98 252 118S341 122 410 64" />
            <path d="M252 118C307 95 337 57 351 18" />
            <path d="M252 118C293 150 336 177 390 206" />
          </g>
          <g className="mo-network-routes">
            <path d="M26 168C114 133 169 153 252 118S383 44 501 83" />
            <path d="M50 194C150 116 211 152 252 118S362 90 475 138" />
            <path d="M95 51C166 96 192 69 252 118S360 163 448 178" />
          </g>
          <g className="mo-network-nodes">
            {[26, 92, 156, 208, 252, 314, 372, 430, 492].map((x, index) => <circle key={x} cx={x} cy={[168, 132, 76, 142, 118, 90, 152, 68, 104][index]} r={index === 4 ? 6 : 3.2} />)}
          </g>
          <circle className="mo-network-core-glow" cx="252" cy="118" r="54" fill="url(#moNodeGlow)" />
        </svg>
        <span className="mo-network-caption">LIVE ARBITRAGE GRAPH · {analysis.signals.marketRegionsInspected} REGIONS</span>
      </div>

      <div className="mo-hero-kpis">
        <article>
          <span className="mo-kpi-icon"><IskGlyph name="cart" /></span>
          <div><strong>{rows.length.toLocaleString()}</strong><span>OPPORTUNITIES</span><small>After current execution filters</small></div>
        </article>
        <article>
          <span className="mo-kpi-icon"><IskGlyph name="coin" /></span>
          <div><strong>{dashboard.topGross ? `${compact(dashboard.topGross.trade.profit)} ISK` : "—"}</strong><span>TOP GROSS PROFIT</span><small>Largest visible gross route</small></div>
        </article>
        <article>
          <span className="mo-kpi-icon"><IskGlyph name="percent" /></span>
          <div><strong>{rows.length ? `${dashboard.averageMargin.toFixed(2)}%` : "—"}</strong><span>AVG NET MARGIN</span><small>After tax, fees and hauling</small></div>
        </article>
        <article>
          <span className="mo-kpi-icon"><IskGlyph name="route" /></span>
          <div><strong>{analysis.signals.marketRegionsInspected.toLocaleString()}</strong><span>REGIONS MONITORED</span><small>Retained public order coverage</small></div>
        </article>
      </div>

      <aside className="mo-snapshot-panel">
        <header><span>INTELLIGENCE SNAPSHOT</span><small>Current matching set</small></header>
        <div className="mo-snapshot-list">
          <article>
            <span className="mo-snapshot-icon"><IskGlyph name="bars" /></span>
            <div><strong>Best Spreads</strong><small>{bestRoi ? `${bestRoi.netMarginPercent.toFixed(2)}% net margin leads the current set` : "No matching spread"}</small></div>
          </article>
          <article>
            <span className="mo-snapshot-icon"><IskGlyph name="shield" /></span>
            <div><strong>Route Quality</strong><small>{dashboard.routeQualityPercent}% are low-risk routes that stay in high-sec</small></div>
          </article>
          <article className="amber">
            <span className="mo-snapshot-icon"><IskGlyph name="pulse" /></span>
            <div><strong>High Demand</strong><small>{dashboard.demandPercent}% meet 75+ fill confidence</small></div>
          </article>
          <article>
            <span className="mo-snapshot-icon"><IskGlyph name="bolt" /></span>
            <div><strong>Execution Window</strong><small>{fastSafe ? `${fastSafe.trade.jumps} jumps on the strongest fast high-sec lead` : "Re-check live orders before committing capital"}</small></div>
          </article>
        </div>
      </aside>

      <aside className="mo-top-opportunity">
        <header><span>TOP OPPORTUNITY</span><small>Best net route</small></header>
        {topOpportunity ? <>
          <div className="mo-top-route-line">
            <strong>{topOpportunity.trade.sell.systemName} <i>→</i> {topOpportunity.trade.buy.systemName}</strong>
            <span className={`mo-quality-badge risk-${topOpportunity.trade.risk.toLowerCase()}`}><IskGlyph name="shield" />{topOpportunity.trade.routeSecurity === "high" && topOpportunity.trade.risk === "Low" ? "Excellent" : `${topOpportunity.trade.risk} risk`}</span>
          </div>
          <p>{topOpportunity.trade.item}</p>
          <small className="mo-top-meta">{topOpportunity.trade.jumps} jumps · {topOpportunity.trade.routeSecurity} route · fill {topOpportunity.trade.fillScore}/100</small>
          <div className="mo-top-metrics">
            <div><strong>{compact(topOpportunity.trade.profit)} ISK</strong><span>GROSS PROFIT</span></div>
            <div><strong>{topOpportunity.netMarginPercent.toFixed(2)}%</strong><span>NET MARGIN</span></div>
          </div>
          <svg className="mo-sparkline" viewBox="0 0 320 48" preserveAspectRatio="none" aria-hidden="true">
            <path className="fill" d="M0 41L24 38L47 37L72 34L97 31L120 29L145 23L168 26L190 20L215 23L239 15L263 21L287 11L320 9L320 48L0 48Z" />
            <path d="M0 41L24 38L47 37L72 34L97 31L120 29L145 23L168 26L190 20L215 23L239 15L263 21L287 11L320 9" />
          </svg>
          <button type="button" className="mo-view-opportunity" onClick={() => { patch({ sort: "net" }); setExpanded(topOpportunity.trade.id); requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(`mo-route-${topOpportunity.trade.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }))); }}>View Opportunity <IskGlyph name="chevron" /></button>
        </> : <div className="mo-empty-state">No actionable route matches the current filters.</div>}
      </aside>
    </section>

    <section className="mo-featured-filters">
      <header>
        <div><span>FEATURED TRADE FILTERS</span><small>Quick presets surface the opportunities that matter most.</small></div>
        <div className="mo-filter-actions">
          <button type="button" className="mo-reset-filter" onClick={() => replaceSettings(defaults(snapshot))}><IskGlyph name="reset" /> Reset</button>
          <button type="button" className="mo-advanced-filter" onClick={() => { const panel = document.querySelector<HTMLDetailsElement>(".day-trader-polished .day-trader-filter-panel"); if (!panel) return; panel.open = !panel.open; if (panel.open) requestAnimationFrame(() => panel.scrollIntoView({ behavior: "smooth", block: "nearest" })); }}><IskGlyph name="bars" /> Advanced Filters</button>
        </div>
      </header>
      <div className="mo-preset-grid">
        <button type="button" className={settings.wideningOnly ? "active amber" : "amber"} onClick={() => preset("volatile")}><span className="mo-preset-icon"><IskGlyph name="percent" /></span><span><strong>High Spread</strong><small>Widening price gaps first</small></span></button>
        <button type="button" className={settings.sort === "fill" && settings.minFillScore >= 85 ? "active" : ""} onClick={() => preset("confidence")}><span className="mo-preset-icon"><IskGlyph name="pulse" /></span><span><strong>High Demand</strong><small>85+ fill confidence</small></span></button>
        <button type="button" className={settings.highSecOnly && settings.maxJumps === 10 && settings.minFillScore >= 70 ? "active" : ""} onClick={() => preset("fast")}><span className="mo-preset-icon"><IskGlyph name="shield" /></span><span><strong>Low Risk / Short Haul</strong><small>High-sec · 10 jumps or less</small></span></button>
        <button type="button" className={settings.sort === "net" && !settings.wideningOnly ? "active" : ""} onClick={() => preset("net")}><span className="mo-preset-icon"><IskGlyph name="coin" /></span><span><strong>Best Net ISK</strong><small>Rank by profit after costs</small></span></button>
        <button type="button" className={settings.sort === "roi" ? "active" : ""} onClick={() => preset("roi")}><span className="mo-preset-icon"><IskGlyph name="target" /></span><span><strong>Best Net ROI</strong><small>Capital-efficient opportunities</small></span></button>
        <button type="button" className={settings.sort === "iskm3" ? "active" : ""} onClick={() => preset("cargo")}><span className="mo-preset-icon"><IskGlyph name="box" /></span><span><strong>Cargo Efficient</strong><small>Highest net ISK per m³</small></span></button>
      </div>
    </section>

    <details className="day-trader-filter-panel">
      <summary><span>TRADE FILTERS</span><small>Search, route, capital and execution limits</small></summary>
      <div className="day-trader-controls">
        <label className="wide day-trader-search"><span>Search item, system, station or region</span><input value={settings.search} onChange={(event) => patch({ search: event.target.value })} placeholder="e.g. implants Jita Amarr..." /></label>
        <label className="day-trader-source"><span>Buy stock in</span><select value={settings.sourceRegion} onChange={(event) => patch({ sourceRegion: event.target.value })}><option value="all">Any region</option>{sourceRegions.map((region) => <option key={region}>{region}</option>)}</select></label>
        <label className="day-trader-target"><span>Sell into</span><select value={settings.targetRegion} onChange={(event) => patch({ targetRegion: event.target.value })}><option value="all">Any region</option>{targetRegions.map((region) => <option key={region}>{region}</option>)}</select></label>
        <label className="day-trader-tax"><span>Sales tax %</span><input value={settings.salesTaxPercent} onChange={(event) => patch({ salesTaxPercent: Math.max(0, numberOr(event.target.value, 0)) })} inputMode="decimal" /><small>7.5% base; Accounting reduces it.</small></label>
        <label className="day-trader-broker"><span>Broker fee %</span><input value={settings.brokerFeePercent} onChange={(event) => patch({ brokerFeePercent: Math.max(0, numberOr(event.target.value, 0)) })} inputMode="decimal" /><small>Use 0 for immediate sell-to-buy-order. NPC estimate with your Broker Relations: {brokerEstimate.toFixed(2)}% before standings.</small></label>
        <label className="day-trader-cargo-control day-trader-cargo"><span>Cargo ship / cap m³</span><select value={cargoProfileId} disabled={marketBusy || !onCargoCapacityChange} onChange={(event) => { const id = event.target.value; setCargoProfileId(id); if (id === "custom") return; const profile = analysis.constraints.cargoProfiles.find((candidate) => candidate.id === id); if (profile) { setCargoInput(String(Math.round(profile.capacityM3))); void onCargoCapacityChange?.(profile.capacityM3, profile.id); } }}><option value="custom">Custom capacity...</option>{analysis.constraints.cargoProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.isCurrentShip ? "CURRENT - " : ""}{profile.characterName} - {profile.shipName}{profile.quantity > 1 ? ` x${profile.quantity}` : ""} - {Math.round(profile.capacityM3).toLocaleString()} m³{profile.systemName ? ` - ${profile.systemName}` : ""}</option>)}</select>{cargoProfileId === "custom" && <div><input value={cargoInput} onChange={(event) => setCargoInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyCargo(); }} inputMode="numeric" /><button type="button" disabled={marketBusy || !onCargoCapacityChange} onClick={applyCargo}>{marketBusy ? "Applying..." : "Apply"}</button></div>}<small>{analysis.constraints.cargoBasis}</small></label>
        <label className="day-trader-hauling"><span>Hauling cost / run</span><input value={settings.haulingCostIsk} onChange={(event) => patch({ haulingCostIsk: Math.max(0, numberOr(event.target.value, 0)) })} inputMode="numeric" /></label>
        <label className="day-trader-min-profit"><span>Minimum net profit</span><input value={settings.minNetProfit} onChange={(event) => patch({ minNetProfit: numberOr(event.target.value, 0) })} inputMode="numeric" /></label>
        <label className="day-trader-min-roi"><span>Minimum net ROI %</span><input value={settings.minNetMarginPercent} onChange={(event) => patch({ minNetMarginPercent: numberOr(event.target.value, 0) })} inputMode="decimal" /></label>
        <label className="day-trader-min-fill"><span>Minimum fill confidence</span><input value={settings.minFillScore} min={0} max={100} onChange={(event) => patch({ minFillScore: Math.max(0, Math.min(100, numberOr(event.target.value, 0))) })} inputMode="numeric" /></label>
        <label className="day-trader-max-capital"><span>Maximum capital</span><input value={settings.maxCapital ?? ""} onChange={(event) => patch({ maxCapital: nullableNumber(event.target.value) })} placeholder="Any" inputMode="numeric" /></label>
        <label className="day-trader-max-jumps"><span>Maximum jumps</span><input value={settings.maxJumps ?? ""} onChange={(event) => patch({ maxJumps: nullableNumber(event.target.value) })} placeholder="Any" inputMode="numeric" /></label>
        <label className="day-trader-rank"><span>Rank by</span><select value={settings.sort} onChange={(event) => patch({ sort: event.target.value as DayTraderSort })}><option value="net">Net profit</option><option value="roi">Net ROI</option><option value="fill">Fill confidence</option><option value="widening">Spread widening</option><option value="iskm3">Net ISK / m³</option><option value="iskjump">Net ISK / jump</option><option value="jumps">Fewest jumps</option></select></label>
        <div className="day-trader-checks">
          <label className="check"><input type="checkbox" checked={settings.crossRegionOnly} onChange={(event) => patch({ crossRegionOnly: event.target.checked })} /> Cross-region only</label>
          <label className="check"><input type="checkbox" checked={settings.highSecOnly} onChange={(event) => patch({ highSecOnly: event.target.checked })} /> High-sec route only</label>
          <label className="check"><input type="checkbox" checked={settings.wideningOnly} onChange={(event) => patch({ wideningOnly: event.target.checked })} /> Widening spreads only</label>
        </div>
      </div>
    </details>

    <div className="mo-trade-grid">
      <section className="mo-rail-panel mo-lanes-panel">
        <header><div><span>HOT REGIONAL LANES</span><small>Top lanes by current net opportunity</small></div><IskGlyph name="route" /></header>
        <div className="mo-lane-list">
          {lanes.slice(0, 5).map((lane, index) => <button type="button" className={settings.sourceRegion === lane.source && settings.targetRegion === lane.target ? "active" : ""} key={`${lane.source}:${lane.target}`} onClick={() => patch({ sourceRegion: lane.source, targetRegion: lane.target })}>
            <span className="mo-lane-rank">{index + 1}</span>
            <span className="mo-lane-copy"><strong>{lane.source} <i>→</i> {lane.target}</strong><small>{lane.count.toLocaleString()} actionable route{lane.count === 1 ? "" : "s"}</small></span>
            <span className="mo-lane-metric"><strong>{compact(lane.bestNet)} ISK</strong><small>best net <b>↑</b></small></span>
          </button>)}
          {!lanes.length && <div className="mo-panel-empty">No regional lane matches the current filters.</div>}
        </div>
        <footer><button type="button" onClick={() => patch({ sourceRegion: "all", targetRegion: "all" })}>View all regional lanes <IskGlyph name="chevron" /></button></footer>
      </section>

      <section className="mo-rail-panel mo-spreads-panel">
        <header><div><span>BEST SPREADS RIGHT NOW</span><small>Largest net margin opportunities in view</small></div><IskGlyph name="percent" /></header>
        <div className="mo-spread-list">
          {dashboard.bestSpreads.map((row, index) => <button type="button" key={row.trade.id} onClick={() => { patch({ sort: "roi" }); setExpanded(row.trade.id); requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(`mo-route-${row.trade.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }))); }}>
            <span className="mo-spread-rank">{index + 1}</span>
            <span className="mo-item-avatar"><img src={`sage-asset://type/${row.trade.typeId}/icon?size=64`} alt="" /></span>
            <span className="mo-spread-copy"><strong>{row.trade.item}</strong><small>{row.trade.category}</small></span>
            <span className="mo-spread-metric"><strong>{row.netMarginPercent.toFixed(2)}%</strong><small>{compact(row.trade.profit)} gross</small></span>
          </button>)}
          {!dashboard.bestSpreads.length && <div className="mo-panel-empty">No spread data matches the current filters.</div>}
        </div>
        <footer><button type="button" onClick={() => preset("roi")}>Rank all by net ROI <IskGlyph name="chevron" /></button></footer>
      </section>

      <section className="mo-routes-panel">
        <header className="mo-routes-panel-head">
          <div><span>ACTIONABLE TRADE ROUTES</span><small>Current routes ranked after tax, broker and hauling assumptions</small></div>
          <div className="mo-routes-panel-metric"><strong>{rows.length.toLocaleString()}</strong><span>READY</span></div>
        </header>
        <div className="mo-routes-table">
          <div className="mo-routes-row mo-routes-heading">
            <span>ITEM</span><span>BUY STOCK</span><span>SELL INTO</span><span>ROUTE / DEPTH</span><span>GROSS</span><span>NET AFTER COSTS</span><span>MARGIN</span><span aria-hidden="true" />
          </div>
          {rows.slice(0, 200).map((row) => {
            const trade = row.trade;
            const open = expanded === trade.id;
            return <article id={`mo-route-${trade.id}`} className={`mo-route-result risk-${trade.risk.toLowerCase()}${open ? " open" : ""}`} key={trade.id}>
              <button type="button" className="mo-routes-row mo-route-summary" onClick={() => setExpanded(open ? null : trade.id)} aria-expanded={open}>
                <span className="mo-route-item"><span className="mo-item-avatar"><img src={`sage-asset://type/${trade.typeId}/icon?size=64`} alt="" /></span><span><strong>{trade.item}</strong><small>{trade.category} · {turnoverLabel(trade.fillScore)} {trade.fillScore}/100</small></span></span>
                <span><strong>{trade.sell.systemName}</strong><small>{trade.sell.regionName}<br />{money(trade.sell.price)} ISK · {trade.sell.volumeRemain.toLocaleString()} units</small></span>
                <span><strong>{trade.buy.systemName}</strong><small>{trade.buy.regionName}<br />{money(trade.buy.price)} ISK · {trade.buy.volumeRemain.toLocaleString()} units</small></span>
                <span className="mo-route-depth"><strong>{trade.jumps} jumps</strong><small>{trade.units.toLocaleString()} units · {trade.cargoM3.toLocaleString(undefined, { maximumFractionDigits: 1 })} m³</small><em className={`mo-route-quality risk-${trade.risk.toLowerCase()}`}>{trade.routeSecurity === "high" && trade.risk === "Low" ? "Excellent" : `${trade.risk} risk`}</em></span>
                <span className="mo-money-cell"><strong>{compact(trade.profit)} ISK</strong><small>{trade.marginPercent.toFixed(2)}% gross</small></span>
                <span className={`mo-money-cell ${row.netProfit >= 0 ? "positive" : "negative"}`}><strong>{compact(row.netProfit)} ISK</strong><small>{Number.isFinite(row.netIskPerM3) ? `${compact(row.netIskPerM3)} ISK/m³` : "No cargo volume"}</small></span>
                <span className={row.netMarginPercent >= 0 ? "positive mo-margin-cell" : "negative mo-margin-cell"}><strong>{row.netMarginPercent.toFixed(2)}%</strong><small>{compact(row.netIskPerJump)} / jump</small></span>
                <span className="mo-route-chevron"><IskGlyph name="chevron" /></span>
              </button>

              {open && <div className="mo-route-detail">
                <section className="mo-detail-card mo-execution-card">
                  <header><span className="mo-detail-icon"><IskGlyph name="route" /></span><div><strong>EXECUTION PLAN</strong><small>Buy, haul and close the retained spread</small></div></header>
                  <div className="mo-execution-steps">
                    <div><i>1</i><span><strong>BUY</strong><small>{trade.units.toLocaleString()} × {trade.item} @ {money(trade.sell.price)} ISK</small><small>{trade.sell.locationName}, {trade.sell.systemName}</small></span></div>
                    <div><i>2</i><span><strong>HAUL</strong><small>{trade.jumps} jumps · {trade.routeSecurity} route · ~{trade.estimatedMinutes} min planning time</small><small>{trade.cargoM3.toLocaleString(undefined, { maximumFractionDigits: 1 })} m³ cargo footprint</small></span></div>
                    <div><i>3</i><span><strong>SELL</strong><small>Retained buyer @ {money(trade.buy.price)} ISK</small><small>{trade.buy.locationName}, {trade.buy.systemName}</small></span></div>
                  </div>
                  <div className="mo-detail-actions">
                    <button type="button" onClick={(event) => { event.stopPropagation(); void copyPlan(row); }}><IskGlyph name="orders" /> Copy Trade Plan</button>
                    <button type="button" className="profit-complete-button" onClick={(event) => { event.stopPropagation(); void completeTrade(row); }}><IskGlyph name="coin" /> I Completed This Deal</button>
                  </div>
                  {completionStatus[trade.id] && <small className="profit-completion-status">{completionStatus[trade.id]}</small>}
                </section>

                <section className="mo-detail-card mo-ledger-card">
                  <header><span className="mo-detail-icon"><IskGlyph name="bars" /></span><div><strong>NET-PROFIT LEDGER</strong><small>Every current execution assumption</small></div></header>
                  <dl>
                    <div><dt>Gross sale</dt><dd>{money(row.saleGross)} ISK</dd></div>
                    <div><dt>Acquisition</dt><dd>−{money(trade.investment)} ISK</dd></div>
                    <div><dt>Sales tax ({settings.salesTaxPercent.toFixed(3)}%)</dt><dd>−{money(row.salesTax)} ISK</dd></div>
                    <div><dt>Broker ({settings.brokerFeePercent.toFixed(3)}%)</dt><dd>−{money(row.brokerFee)} ISK</dd></div>
                    <div><dt>Hauling</dt><dd>−{money(row.haulingCost)} ISK</dd></div>
                  </dl>
                  <div className={`mo-net-total ${row.netProfit >= 0 ? "positive" : "negative"}`}><span>NET RESULT</span><strong>{money(row.netProfit)} ISK</strong></div>
                  <small>Break-even destination price: {row.breakEvenSellPrice == null ? "—" : `${money(row.breakEvenSellPrice)} ISK/unit`}</small>
                </section>

                <section className="mo-detail-card mo-liquidity-card">
                  <header><span className="mo-detail-icon"><IskGlyph name="pulse" /></span><div><strong>LIQUIDITY & VOLATILITY</strong><small>Execution confidence before departure</small></div></header>
                  <div className="mo-readiness-grid">
                    <div><span>Executable now</span><strong>{trade.units.toLocaleString()} / {trade.availableUnits.toLocaleString()}</strong><small>visible paired units</small></div>
                    <div><span>Fill confidence</span><strong>{trade.fillScore}/100</strong><small>{turnoverLabel(trade.fillScore)}</small></div>
                    <div><span>Net capital return</span><strong>{row.netMarginPercent.toFixed(2)}%</strong><small>after current costs</small></div>
                    <div><span>Net cargo return</span><strong>{Number.isFinite(row.netIskPerM3) ? `${compact(row.netIskPerM3)} ISK/m³` : "—"}</strong><small>cargo efficiency</small></div>
                  </div>
                  <div className="mo-volatility-line"><IskGlyph name="percent" /><span>Spread change: {trade.marginWidenedBy == null ? "Needs a previous full snapshot" : `${trade.marginWidenedBy >= 0 ? "+" : ""}${money(trade.marginWidenedBy)} ISK/unit${row.wideningPercent == null ? "" : ` (${row.wideningPercent >= 0 ? "+" : ""}${row.wideningPercent.toFixed(1)}%)`}`}</span></div>
                  <em>Re-check both live orders before buying. Market depth can move faster than the retained snapshot.</em>
                </section>
              </div>}
            </article>;
          })}
          {!rows.length && <div className="mo-panel-empty mo-routes-empty">No actionable trade routes match the current filters.</div>}
        </div>
        <footer className="mo-routes-footer"><span>Showing {Math.min(rows.length, 200).toLocaleString()} of {rows.length.toLocaleString()} actionable routes</span><button type="button" onClick={() => { const panel = document.querySelector<HTMLDetailsElement>(".day-trader-polished .day-trader-filter-panel"); if (panel) { panel.open = true; requestAnimationFrame(() => panel.scrollIntoView({ behavior: "smooth", block: "nearest" })); } }}>Refine trade filters <IskGlyph name="chevron" /></button></footer>
      </section>
    </div>
  </section>;
}
