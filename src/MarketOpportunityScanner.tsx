import { useEffect, useMemo, useRef, useState } from "react";
import type { OpportunityAnalysis, OpportunityRisk } from "./types";
import {
  defaultMarketOpportunityFilters,
  filterMarketOpportunities,
  type MarketOpportunityFilters,
} from "./market-opportunity-filter";
import { IskGlyph } from "./IskIcons";
import eveSkinIcon from "./eve-skin-icon.png";

const money = (value: number) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);

function numberOrNull(value: string) {
  const parsed = Number(value.replace(/,/g, ""));
  return value.trim() && Number.isFinite(parsed) ? parsed : null;
}

function securityLabel(value: "high" | "low" | "null") {
  if (value === "high") return "High-sec";
  if (value === "low") return "Low-sec";
  return "Null-sec";
}

function confidenceLabel(score: number) {
  if (score >= 80) return "High confidence";
  if (score >= 60) return "Good confidence";
  return "Watch fill";
}

function isSkinMarketItem(item: string, category: string) {
  return /skin/i.test(category) || /\bskin\b/i.test(item);
}

function marketItemIcon(typeId: number, item: string, category: string) {
  return isSkinMarketItem(item, category) ? eveSkinIcon : `sage-asset://type/${typeId}/icon?size=64`;
}

export function MarketOpportunityScanner({
  analysis,
  onExport,
  onMaxCapitalChange,
  focusMaxCapitalRequest = 0,
}: {
  analysis: OpportunityAnalysis;
  onExport(): void;
  onMaxCapitalChange?: (value: number | null) => void;
  focusMaxCapitalRequest?: number;
}) {
  const [filters, setFilters] = useState<MarketOpportunityFilters>({
    ...defaultMarketOpportunityFilters,
    maxInvestment: analysis.constraints.maxCapital,
    maxJumps: analysis.constraints.maxJumps,
  });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const advancedFiltersRef = useRef<HTMLDetailsElement>(null);
  const maxCapitalInputRef = useRef<HTMLInputElement>(null);
  const [expandedTradeId, setExpandedTradeId] = useState<string | null>(null);
  const [columnSort, setColumnSort] = useState<{
    key: "item" | "sell" | "buy" | "route" | "confidence" | "profit";
    direction: "asc" | "desc";
  }>({ key: "profit", direction: "desc" });

  useEffect(() => {
    setFilters((current) => ({
      ...current,
      maxInvestment: analysis.constraints.maxCapital,
      maxJumps: analysis.constraints.maxJumps,
    }));
    setPage(0);
  }, [analysis.generatedAt, analysis.constraints.maxCapital, analysis.constraints.maxJumps]);
  useEffect(() => {
    onMaxCapitalChange?.(filters.maxInvestment);
  }, [filters.maxInvestment, onMaxCapitalChange]);

  useEffect(() => {
    if (!focusMaxCapitalRequest) return;
    if (advancedFiltersRef.current) advancedFiltersRef.current.open = true;
    const frame = requestAnimationFrame(() => {
      maxCapitalInputRef.current?.focus();
      maxCapitalInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusMaxCapitalRequest]);

  const filtered = useMemo(
    () => filterMarketOpportunities(analysis.market.opportunities, filters),
    [analysis.market.opportunities, filters],
  );

  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        const value = (trade: typeof a) => {
          switch (columnSort.key) {
            case "item":
              return trade.item.toLocaleLowerCase();
            case "sell":
              return `${trade.sell.regionName} ${trade.sell.systemName}`.toLocaleLowerCase();
            case "buy":
              return `${trade.buy.regionName} ${trade.buy.systemName}`.toLocaleLowerCase();
            case "route":
              return trade.jumps;
            case "confidence":
              return trade.fillScore;
            case "profit":
              return trade.profit;
          }
        };
        const aa = value(a);
        const bb = value(b);
        const order =
          typeof aa === "string" && typeof bb === "string"
            ? aa.localeCompare(bb)
            : Number(aa) - Number(bb);
        return columnSort.direction === "asc" ? order : -order;
      }),
    [filtered, columnSort],
  );

  useEffect(() => {
    setExpandedTradeId((current) => current && sorted.some((trade) => trade.id === current) ? current : sorted[0]?.id ?? null);
  }, [sorted]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  const visible = sorted.slice(page * pageSize, (page + 1) * pageSize);

  function sortColumn(key: typeof columnSort.key) {
    setColumnSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : {
            key,
            direction: key === "item" || key === "sell" || key === "buy" ? "asc" : "desc",
          },
    );
    setPage(0);
  }

  function sortLabel(label: string, key: typeof columnSort.key) {
    return `${label}${columnSort.key === key ? (columnSort.direction === "asc" ? " ↑" : " ↓") : ""}`;
  }

  function patch(next: Partial<MarketOpportunityFilters>) {
    setFilters((current) => ({ ...current, ...next }));
    setPage(0);
  }

  function toggleRisk(risk: OpportunityRisk) {
    const active = filters.risks.includes(risk);
    const risks = active ? filters.risks.filter((item) => item !== risk) : [...filters.risks, risk];
    patch({ risks });
  }

  function setRouteSecurity(security: MarketOpportunityFilters["routeSecurity"]) {
    patch({ routeSecurity: security });
  }

  function preset(id: string) {
    if (id === "confidence") patch({ risks: ["Low"], sort: "fill" });
    if (id === "fast") patch({ maxJumps: 10, sort: "jumps" });
    if (id === "margin") patch({ minMarginPercent: 20, sort: "margin" });
    if (id === "capital") patch({ sort: "capital", minProfit: 1_000_000 });
    if (id === "cargo") patch({ sort: "iskm3", minIskPerM3: 1_000 });
    if (id === "profit") patch({ minProfit: 10_000_000, sort: "profit" });
  }

  const pageButtons = useMemo(() => {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => String(index + 1));
    const current = page + 1;
    const values = new Set<number>([1, pageCount, current - 1, current, current + 1]);
    const sortedValues = [...values].filter((value) => value >= 1 && value <= pageCount).sort((a, b) => a - b);
    const output: string[] = [];
    sortedValues.forEach((value, index) => {
      const previous = sortedValues[index - 1];
      if (previous && value - previous > 1) output.push(`ellipsis-${previous}-${value}`);
      output.push(String(value));
    });
    return output;
  }, [page, pageCount]);

  const preparedTime = useMemo(() => {
    const date = new Date(analysis.generatedAt);
    return Number.isNaN(date.getTime()) ? "prepared data" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }, [analysis.generatedAt]);

  return (
    <section className="market-opportunity-scanner market-scanner-polished">
      <div className="market-scanner-heading">
        <div>
          <p className="eyebrow">MARKET SCANNER</p>
          <h3>Search and filter candidate station-to-station trades</h3>
          <p>Filter the matching trade set below. Column sorting applies across every page.</p>
        </div>
        <div className="market-scanner-actions">
          <div className="market-scanner-count">
            <strong>{filtered.length.toLocaleString()}</strong>
            <span>matching trades</span>
          </div>
          <button className="market-export" onClick={onExport} type="button">
            <IskGlyph name="download" />
            Export CSV
          </button>
        </div>
      </div>

      <div className="market-quick-filters" aria-label="Market scanner presets">
        <button onClick={() => preset("confidence")} type="button"><IskGlyph name="shield" />Low risk / high confidence</button>
        <button onClick={() => preset("fast")} type="button"><IskGlyph name="bolt" />Fast hauls</button>
        <button onClick={() => preset("margin")} type="button"><IskGlyph name="percent" />20%+ margin</button>
        <button onClick={() => preset("capital")} type="button"><IskGlyph name="coin" />Capital efficient</button>
        <button onClick={() => preset("cargo")} type="button"><IskGlyph name="box" />Cargo efficient</button>
        <button onClick={() => preset("profit")} type="button"><IskGlyph name="coin" />10M+ profit</button>
        <button
          className="reset"
          type="button"
          onClick={() =>
            patch({
              ...defaultMarketOpportunityFilters,
              maxInvestment: analysis.constraints.maxCapital,
              maxJumps: analysis.constraints.maxJumps,
            })
          }
        >
          <IskGlyph name="reset" />Reset filters
        </button>
      </div>

      <div className="market-scanner-controlbar">
        <div className="market-control-group security-group">
          <span>Route security</span>
          {(["all", "high", "low", "null"] as const).map((security) => (
            <button
              key={security}
              type="button"
              className={`market-segment ${filters.routeSecurity === security ? "active" : ""} ${security}`}
              onClick={() => setRouteSecurity(security)}
              title={
                security === "all"
                  ? "Show routes of any security"
                  : security === "high"
                    ? "Only routes that stay in high-sec"
                    : security === "low"
                      ? "Routes that enter low-sec but not null-sec"
                      : "Routes that enter null-sec"
              }
            >
              <IskGlyph name={security === "high" ? "shield" : security === "low" ? "pulse" : security === "null" ? "target" : "route"} />
              <span className={filters.routeSecurity === security ? "active" : ""}>{security === "all" ? "Any" : securityLabel(security)}</span>
            </button>
          ))}
        </div>

        <div className="market-control-divider" />

        <div className="market-control-group risk-group">
          <span>Trade risk</span>
          {(["Low", "Medium", "High"] as OpportunityRisk[]).map((risk) => (
            <button
              key={risk}
              type="button"
              className={`market-segment risk-${risk.toLowerCase()} ${filters.risks.includes(risk) ? "active" : ""}`}
              onClick={() => toggleRisk(risk)}
              title="Calculated trade risk. Route security is filtered separately."
            >
              <span className="risk-diamond" />
              {risk}
            </button>
          ))}
        </div>

        <label className="market-inline-search">
          <IskGlyph name="search" />
          <input
            value={filters.search}
            onChange={(event) => patch({ search: event.target.value })}
            placeholder="Search route, capital and profitability limits..."
            aria-label="Search market routes"
          />
        </label>
      </div>

      <details className="market-filter-panel" ref={advancedFiltersRef}>
        <summary><span>Advanced scanner filters</span><small>Category, regions, capital, margin, cargo and route limits</small></summary>
        <div className="market-filter-grid">
          <label>
            Category
            <select value={filters.category} onChange={(event) => patch({ category: event.target.value })}>
              <option value="all">All categories</option>
              {analysis.market.facets.categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <label>
            Buy stock in region
            <select value={filters.sellRegion} onChange={(event) => patch({ sellRegion: event.target.value })}>
              <option value="all">Any region</option>
              {analysis.market.facets.sellRegions.map((region) => <option key={region} value={region}>{region}</option>)}
            </select>
          </label>
          <label>
            Sell to buyer in region
            <select value={filters.buyRegion} onChange={(event) => patch({ buyRegion: event.target.value })}>
              <option value="all">Any region</option>
              {analysis.market.facets.buyRegions.map((region) => <option key={region} value={region}>{region}</option>)}
            </select>
          </label>
          <label>
            Route security
            <select value={filters.routeSecurity} onChange={(event) => patch({ routeSecurity: event.target.value as MarketOpportunityFilters["routeSecurity"] })}>
              <option value="all">Any security</option>
              <option value="high">High-sec route</option>
              <option value="low">Touches low-sec</option>
              <option value="null">Touches null-sec</option>
            </select>
          </label>
          <label>
            Minimum gross profit
            <input value={filters.minProfit ?? ""} onChange={(event) => patch({ minProfit: numberOrNull(event.target.value) })} placeholder="ISK" inputMode="numeric" />
          </label>
          <label>
            Minimum margin
            <input value={filters.minMarginPercent ?? ""} onChange={(event) => patch({ minMarginPercent: numberOrNull(event.target.value) })} placeholder="%" inputMode="decimal" />
          </label>
          <label>
            Minimum ISK / m3
            <input value={filters.minIskPerM3 ?? ""} onChange={(event) => patch({ minIskPerM3: numberOrNull(event.target.value) })} placeholder="ISK/m3" inputMode="numeric" />
          </label>
          <label>
            Maximum capital
            <input ref={maxCapitalInputRef} value={filters.maxInvestment ?? ""} onChange={(event) => patch({ maxInvestment: numberOrNull(event.target.value) })} placeholder="ISK" inputMode="numeric" />
          </label>
          <label>
            Maximum jumps
            <input value={filters.maxJumps ?? ""} onChange={(event) => patch({ maxJumps: numberOrNull(event.target.value) })} placeholder="Any" inputMode="numeric" />
          </label>
          <label>
            Sort by
            <select value={filters.sort} onChange={(event) => patch({ sort: event.target.value as MarketOpportunityFilters["sort"] })}>
              <option value="score">Best overall match</option>
              <option value="profit">Gross profit</option>
              <option value="margin">Margin %</option>
              <option value="fill">Fill confidence</option>
              <option value="iskm3">ISK / m3</option>
              <option value="iskjump">ISK / jump</option>
              <option value="capital">Capital efficiency</option>
              <option value="jumps">Fewest jumps</option>
            </select>
          </label>
          <label className="market-check">
            <input type="checkbox" checked={filters.crossRegionOnly} onChange={(event) => patch({ crossRegionOnly: event.target.checked })} />
            Cross-region only
          </label>
        </div>
      </details>

      <div className="market-trade-table market-trade-table-polished">
        <div className="market-trade-row heading">
          <button onClick={() => sortColumn("item")} type="button">{sortLabel("Item / from", "item")}</button>
          <button onClick={() => sortColumn("sell")} type="button">{sortLabel("Buy (origin)", "sell")}</button>
          <button onClick={() => sortColumn("buy")} type="button">{sortLabel("Sell (destination)", "buy")}</button>
          <span>Capital / cargo</span>
          <button onClick={() => sortColumn("route")} type="button">{sortLabel("Route", "route")}</button>
          <button onClick={() => sortColumn("profit")} type="button">{sortLabel("Profit", "profit")}</button>
          <span className="market-actions-heading">Actions</span>
        </div>

        {visible.map((trade, index) => (
          <details className="market-trade-row market-trade-result" key={trade.id} open={expandedTradeId === trade.id} onToggle={(event) => { if (event.currentTarget.open) setExpandedTradeId(trade.id); else setExpandedTradeId((current) => current === trade.id ? null : current); }}>
            <summary>
              <span className="market-item-cell">
                <span className="market-row-rank">{page * pageSize + index + 1}</span>
                <span className="market-item-icon"><img src={marketItemIcon(trade.typeId, trade.item, trade.category)} alt="" /></span>
                <span className="market-item-copy">
                  <strong>{trade.item}</strong>
                  <small>{trade.category}</small>
                  <em className={`confidence-badge ${trade.fillScore >= 80 ? "high" : trade.fillScore >= 60 ? "medium" : "watch"}`}>{confidenceLabel(trade.fillScore)}</em>
                </span>
              </span>
              <span>
                <strong>{trade.sell.locationName}</strong>
                <small>{trade.sell.systemName}<br />{trade.sell.regionName}<br />{money(trade.sell.price)} ISK</small>
              </span>
              <span>
                <strong>{trade.buy.locationName}</strong>
                <small>{trade.buy.systemName}<br />{trade.buy.regionName}<br />{money(trade.buy.price)} ISK</small>
              </span>
              <span>
                <strong>{money(trade.investment)} ISK</strong>
                <small>{money(trade.cargoM3)} m3 / {money(analysis.constraints.cargoCapacityM3)} m3<br />{trade.units.toLocaleString()} units</small>
              </span>
              <span className="market-route-cell">
                <span className="route-badge jumps">{trade.jumps} jumps</span>
                <span className={`route-badge security ${trade.routeSecurity}`}>{trade.routeSecurity === "high" ? "High-sec" : trade.routeSecurity === "low" ? "Low-sec" : "Null-sec"}</span>
                <span className={`route-badge risk ${trade.risk.toLowerCase()}`}>{trade.risk} risk</span>
                <small>~{trade.estimatedMinutes} min plan · Fill {trade.fillScore}/100</small>
              </span>
              <span className="profit">
                <strong>{money(trade.profit)} ISK</strong>
                <small>{trade.marginPercent.toFixed(1)}% · {Number.isFinite(trade.iskPerM3) ? `${money(trade.iskPerM3)} ISK/m3` : "No cargo volume"}</small>
              </span>
              <span className="market-row-action"><IskGlyph name="chevron" /></span>
            </summary>

            <div className="market-trade-work">
              <div className="trade-action-plan">
                <b>Exact haul plan</b>
                <small><strong className="plan-step buy">1</strong><span><b>BUY</b> {trade.units.toLocaleString()}× {trade.item}<br />@ {money(trade.sell.price)} ISK each · {trade.sell.locationName}<br />Spend {money(trade.investment)} ISK · load {money(trade.cargoM3)} m3</span></small>
                <small><strong className="plan-step travel">2</strong><span><b>TRAVEL</b><br />{trade.jumps} jumps · {securityLabel(trade.routeSecurity)} · about {trade.estimatedMinutes} minutes</span></small>
                <small><strong className="plan-step sell">3</strong><span><b>SELL</b><br />Existing buyer @ {money(trade.buy.price)} ISK each · {trade.buy.locationName}<br />Expected gross return {money(trade.investment + trade.profit)} ISK</span></small>
                <em>Re-check before run · EVE data latency may affect prices and warnings.</em>
              </div>

              <div className="market-rank-reasons">
                <b>Why Sage ranks here</b>
                {trade.reasons.map((reason) => <small key={reason}><i>✓</i>{reason}</small>)}
              </div>

              <div className="market-score-breakdown">
                <b>Score breakdown</b>
                {([
                  ["Profit", trade.scoreBreakdown.profit],
                  ["Fill", trade.scoreBreakdown.fill],
                  ["Route", trade.scoreBreakdown.route],
                  ["Capital efficiency", trade.scoreBreakdown.capitalEfficiency],
                  ["Cargo efficiency", trade.scoreBreakdown.cargoEfficiency],
                ] as Array<[string, number]>).map(([label, value]) => (
                  <small key={label}><span>{label} <strong>{value}/100</strong></span><i><b style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i></small>
                ))}
              </div>
            </div>
          </details>
        ))}

        {!visible.length && <div className="market-no-results">No trades match the current filters.</div>}
      </div>

      <div className="market-table-footer">
        <label className="market-page-size">Rows per page
          <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }}>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
        <span className="market-result-range">
          {filtered.length ? `Showing ${page * pageSize + 1} to ${Math.min((page + 1) * pageSize, filtered.length)} of ${filtered.length.toLocaleString()} results` : "No matching results"}
        </span>

        <div className="isk-pagination compact" aria-label="Market results pages">
          <button type="button" className="page-arrow" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>‹</button>
          {pageButtons.map((token) => token.startsWith("ellipsis-")
            ? <span className="page-ellipsis" key={token}>…</span>
            : <button type="button" key={token} className={Number(token) === page + 1 ? "active" : ""} onClick={() => setPage(Number(token) - 1)}>{token}</button>)}
          <button type="button" className="page-arrow" disabled={page + 1 >= pageCount} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>›</button>
        </div>

        <div className="market-prepared-status"><span>Prepared {preparedTime}</span><i />Warm cached data</div>
      </div>
    </section>
  );
}
