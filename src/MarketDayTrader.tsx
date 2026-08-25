import { useEffect, useMemo, useState } from "react";
import type { CharacterSnapshot, MarketOpportunity, OpportunityAnalysis } from "./types";
import { accountingTaxPercentFromLevel, brokerEstimatePercentFromLevel, calculateDayTradeEconomics } from "./market-day-trader";

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
      if (settings.maxJumps != null && trade.jumps > settings.maxJumps) return false;
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

  return <section className="day-trader-workspace">
    <div className="day-trader-head">
      <div><p className="eyebrow">MARKET OPPORTUNITIES</p><h3>Cross-region trade intelligence</h3><p>Cross-region executable flips from Sage&apos;s retained all-region order book, recalculated after your tax, fee and hauling assumptions.</p></div>
      <div className="day-trader-live"><strong>{rows.length.toLocaleString()}</strong><span>actionable routes</span><small>{analysis.signals.marketOrdersInspected.toLocaleString()} orders Â· {analysis.signals.marketRegionsInspected} regions</small></div>
    </div>

    <div className="day-trader-kpis">
      <article><span>Best net flip</span><strong>{best ? `${compact(best.netProfit)} ISK` : "â€”"}</strong><small>{best ? `${best.trade.sell.regionName} â†’ ${best.trade.buy.regionName}` : "No matching route"}</small></article>
      <article><span>Best net ROI</span><strong>{bestRoi ? `${bestRoi.netMarginPercent.toFixed(1)}%` : "â€”"}</strong><small>{bestRoi?.trade.item ?? "No matching route"}</small></article>
      <article><span>Fast high-sec lead</span><strong>{fastSafe ? `${compact(fastSafe.netProfit)} ISK` : "â€”"}</strong><small>{fastSafe ? `${fastSafe.trade.jumps} jumps Â· fill ${fastSafe.trade.fillScore}/100` : "No â‰¤10j high-confidence lead"}</small></article>
      <article><span>Sales tax assumption</span><strong>{settings.salesTaxPercent.toFixed(3)}%</strong><small>Accounting {skillLevel(snapshot, "Accounting")}/5 Â· current skill-derived default</small></article>
    </div>

    <div className="day-trader-presets">
      <button onClick={() => preset("fast")}>Fast flips</button><button onClick={() => preset("confidence")}>High confidence</button><button onClick={() => preset("volatile")}>Widening spreads</button><button onClick={() => preset("net")}>Best net ISK</button><button onClick={() => preset("roi")}>Best net ROI</button><button onClick={() => preset("cargo")}>Cargo efficiency</button><button className="reset" onClick={() => replaceSettings(defaults(snapshot))}>Reset</button>
    </div>

    <div className="day-trader-controls">
      <label className="wide day-trader-search"><span>Search item, system, station or region</span><input value={settings.search} onChange={(event) => patch({ search: event.target.value })} placeholder="e.g. implants Jita Amarr..." /></label>
      <label className="day-trader-source"><span>Buy stock in</span><select value={settings.sourceRegion} onChange={(event) => patch({ sourceRegion: event.target.value })}><option value="all">Any region</option>{sourceRegions.map((region) => <option key={region}>{region}</option>)}</select></label>
      <label className="day-trader-target"><span>Sell into</span><select value={settings.targetRegion} onChange={(event) => patch({ targetRegion: event.target.value })}><option value="all">Any region</option>{targetRegions.map((region) => <option key={region}>{region}</option>)}</select></label>
      <label className="day-trader-tax"><span>Sales tax %</span><input value={settings.salesTaxPercent} onChange={(event) => patch({ salesTaxPercent: Math.max(0, numberOr(event.target.value, 0)) })} inputMode="decimal" /><small>7.5% base; Accounting reduces it.</small></label>
      <label className="day-trader-broker"><span>Broker fee %</span><input value={settings.brokerFeePercent} onChange={(event) => patch({ brokerFeePercent: Math.max(0, numberOr(event.target.value, 0)) })} inputMode="decimal" /><small>Use 0 for immediate sell-to-buy-order. NPC estimate with your Broker Relations: {brokerEstimate.toFixed(2)}% before standings.</small></label>
      <label className="day-trader-cargo-control day-trader-cargo"><span>Cargo ship / cap m3</span><select value={cargoProfileId} disabled={marketBusy || !onCargoCapacityChange} onChange={(event) => { const id = event.target.value; setCargoProfileId(id); if (id === "custom") return; const profile = analysis.constraints.cargoProfiles.find((candidate) => candidate.id === id); if (profile) { setCargoInput(String(Math.round(profile.capacityM3))); void onCargoCapacityChange?.(profile.capacityM3, profile.id); } }}><option value="custom">Custom capacity...</option>{analysis.constraints.cargoProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.isCurrentShip ? "CURRENT - " : ""}{profile.characterName} - {profile.shipName}{profile.quantity > 1 ? ` x${profile.quantity}` : ""} - {Math.round(profile.capacityM3).toLocaleString()} m3{profile.systemName ? ` - ${profile.systemName}` : ""}</option>)}</select>{cargoProfileId === "custom" && <div><input value={cargoInput} onChange={(event) => setCargoInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyCargo(); }} inputMode="numeric" /><button type="button" disabled={marketBusy || !onCargoCapacityChange} onClick={applyCargo}>{marketBusy ? "Applying..." : "Apply"}</button></div>}<small>{analysis.constraints.cargoBasis}</small></label>
      <label className="day-trader-hauling"><span>Hauling cost / run</span><input value={settings.haulingCostIsk} onChange={(event) => patch({ haulingCostIsk: Math.max(0, numberOr(event.target.value, 0)) })} inputMode="numeric" /></label>
      <label className="day-trader-min-profit"><span>Minimum net profit</span><input value={settings.minNetProfit} onChange={(event) => patch({ minNetProfit: numberOr(event.target.value, 0) })} inputMode="numeric" /></label>
      <label className="day-trader-min-roi"><span>Minimum net ROI %</span><input value={settings.minNetMarginPercent} onChange={(event) => patch({ minNetMarginPercent: numberOr(event.target.value, 0) })} inputMode="decimal" /></label>
      <label className="day-trader-min-fill"><span>Minimum fill confidence</span><input value={settings.minFillScore} min={0} max={100} onChange={(event) => patch({ minFillScore: Math.max(0, Math.min(100, numberOr(event.target.value, 0))) })} inputMode="numeric" /></label>
      <label className="day-trader-max-capital"><span>Maximum capital</span><input value={settings.maxCapital ?? ""} onChange={(event) => patch({ maxCapital: nullableNumber(event.target.value) })} placeholder="Any" inputMode="numeric" /></label>
      <label className="day-trader-max-jumps"><span>Maximum jumps</span><input value={settings.maxJumps ?? ""} onChange={(event) => patch({ maxJumps: nullableNumber(event.target.value) })} placeholder="Any" inputMode="numeric" /></label>
      <label className="day-trader-rank"><span>Rank by</span><select value={settings.sort} onChange={(event) => patch({ sort: event.target.value as DayTraderSort })}><option value="net">Net profit</option><option value="roi">Net ROI</option><option value="fill">Fill confidence</option><option value="widening">Spread widening</option><option value="iskm3">Net ISK / m3</option><option value="iskjump">Net ISK / jump</option><option value="jumps">Fewest jumps</option></select></label>
      <div className="day-trader-checks">
        <label className="check"><input type="checkbox" checked={settings.crossRegionOnly} onChange={(event) => patch({ crossRegionOnly: event.target.checked })} /> Cross-region only</label>
        <label className="check"><input type="checkbox" checked={settings.highSecOnly} onChange={(event) => patch({ highSecOnly: event.target.checked })} /> High-sec route only</label>
        <label className="check"><input type="checkbox" checked={settings.wideningOnly} onChange={(event) => patch({ wideningOnly: event.target.checked })} /> Widening spreads only</label>
      </div>
    </div>

    {lanes.length > 0 && <div className="day-trader-lanes"><div className="day-trader-section-title"><span>HOT REGIONAL LANES</span><small>Best currently matching source â†’ destination pairs</small></div>{lanes.map((lane) => <button key={`${lane.source}:${lane.target}`} onClick={() => patch({ sourceRegion: lane.source, targetRegion: lane.target })}><strong>{lane.source} â†’ {lane.target}</strong><span>{lane.count} leads</span><small>best {compact(lane.bestNet)} ISK net Â· {lane.bestRoi.toFixed(1)}% ROI</small></button>)}</div>}

    <div className="day-trader-table">
      <div className="day-trader-row heading"><span>Item / turnover</span><span>Buy stock</span><span>Sell into</span><span>Route / depth</span><span>Gross</span><span>Net after costs</span></div>
      {rows.slice(0, 200).map((row) => {
        const trade = row.trade;
        const open = expanded === trade.id;
        return <article className={`day-trader-result risk-${trade.risk.toLowerCase()}`} key={trade.id}>
          <button className="day-trader-row" onClick={() => setExpanded(open ? null : trade.id)}>
            <span><strong>{trade.item}</strong><small>{trade.category} Â· {turnoverLabel(trade.fillScore)} {trade.fillScore}/100{trade.marginWidenedBy != null ? ` Â· spread ${trade.marginWidenedBy >= 0 ? "+" : ""}${money(trade.marginWidenedBy)} ISK/unit` : ""}</small></span>
            <span><strong>{trade.sell.systemName}</strong><small>{trade.sell.regionName} Â· {money(trade.sell.price)} ISK<br />{trade.sell.volumeRemain.toLocaleString()} visible units</small></span>
            <span><strong>{trade.buy.systemName}</strong><small>{trade.buy.regionName} Â· {money(trade.buy.price)} ISK<br />{trade.buy.volumeRemain.toLocaleString()} buyer units</small></span>
            <span><strong>{trade.jumps} jumps Â· {trade.routeSecurity}</strong><small>{trade.units.toLocaleString()} units Â· {trade.cargoM3.toLocaleString(undefined, { maximumFractionDigits: 1 })} m3<br />{compact(row.netIskPerJump)} ISK/jump</small></span>
            <span><strong>{compact(trade.profit)} ISK</strong><small>{trade.marginPercent.toFixed(1)}% gross</small></span>
            <span className={row.netProfit >= 0 ? "positive" : "negative"}><strong>{compact(row.netProfit)} ISK</strong><small>{row.netMarginPercent.toFixed(1)}% net Â· {Number.isFinite(row.netIskPerM3) ? `${compact(row.netIskPerM3)} ISK/m3` : "no cargo volume"}</small></span>
          </button>
          {open && <div className="day-trader-detail">
            <div><b>Execution plan</b><small><strong>BUY</strong> {trade.units.toLocaleString()} Ã— {trade.item} @ {money(trade.sell.price)} ISK</small><small>{trade.sell.locationName}, {trade.sell.systemName}</small><small><strong>HAUL</strong> {trade.jumps} jumps Â· {trade.routeSecurity} route Â· ~{trade.estimatedMinutes} min planning time</small><small><strong>SELL</strong> to retained buyer @ {money(trade.buy.price)} ISK</small><small>{trade.buy.locationName}, {trade.buy.systemName}</small><button onClick={(event) => { event.stopPropagation(); void copyPlan(row); }}>Copy trade plan</button><button className="profit-complete-button" onClick={(event)=>{event.stopPropagation();void completeTrade(row);}}>I completed this deal</button>{completionStatus[trade.id]&&<small className="profit-completion-status">{completionStatus[trade.id]}</small>}</div>
            <div><b>Net-profit ledger</b><small>Gross sale: {money(row.saleGross)} ISK</small><small>Acquisition: -{money(trade.investment)} ISK</small><small>Sales tax ({settings.salesTaxPercent.toFixed(3)}%): -{money(row.salesTax)} ISK</small><small>Broker ({settings.brokerFeePercent.toFixed(3)}%): -{money(row.brokerFee)} ISK</small><small>Hauling: -{money(row.haulingCost)} ISK</small><strong className={row.netProfit >= 0 ? "positive" : "negative"}>NET {money(row.netProfit)} ISK</strong><small>Break-even destination price: {row.breakEvenSellPrice == null ? "â€”" : `${money(row.breakEvenSellPrice)} ISK/unit`}</small></div>
            <div><b>Liquidity / volatility</b><small>Executable now: {trade.units.toLocaleString()} / {trade.availableUnits.toLocaleString()} visible paired units</small><small>Fill confidence: {trade.fillScore}/100 Â· {turnoverLabel(trade.fillScore)}</small><small>Net capital return: {row.netMarginPercent.toFixed(2)}%</small><small>Net cargo return: {Number.isFinite(row.netIskPerM3) ? `${money(row.netIskPerM3)} ISK/m3` : "â€”"}</small><small>Spread change vs previous full snapshot: {trade.marginWidenedBy == null ? "Needs a previous snapshot" : `${trade.marginWidenedBy >= 0 ? "+" : ""}${money(trade.marginWidenedBy)} ISK/unit${row.wideningPercent == null ? "" : ` (${row.wideningPercent >= 0 ? "+" : ""}${row.wideningPercent.toFixed(1)}%)`}`}</small><em>Re-check both live orders before buying. Market depth can disappear faster than the retained snapshot refreshes.</em></div>
          </div>}
        </article>;
      })}
      {!rows.length && <div className="market-no-results">No day-trader routes match the current net-profit and execution filters.</div>}
      {rows.length > 200 && <div className="day-trader-more">Showing the top 200 of {rows.length.toLocaleString()} matching routes. Tighten filters to focus the execution list.</div>}
    </div>
  </section>;
}
