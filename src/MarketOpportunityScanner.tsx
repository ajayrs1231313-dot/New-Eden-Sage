import { useEffect, useMemo, useState } from "react";
import type { OpportunityAnalysis, OpportunityRisk } from "./types";
import {
  defaultMarketOpportunityFilters,
  filterMarketOpportunities,
  type MarketOpportunityFilters,
} from "./market-opportunity-filter";

const money = (value: number) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);

function numberOrNull(value: string) {
  const parsed = Number(value.replace(/,/g, ""));
  return value.trim() && Number.isFinite(parsed) ? parsed : null;
}

export function MarketOpportunityScanner({
  analysis,
  onExport,
}: {
  analysis: OpportunityAnalysis;
  onExport(): void;
}) {
  const [filters, setFilters] = useState<MarketOpportunityFilters>({
    ...defaultMarketOpportunityFilters,
    maxInvestment: analysis.constraints.maxCapital,
    maxJumps: analysis.constraints.maxJumps,
    maxMinutes: analysis.constraints.maxMinutes,
  });
  const [page, setPage] = useState(0);
  const pageSize = 50;

  useEffect(() => {
    setFilters((current) => ({
      ...current,
      maxInvestment: analysis.constraints.maxCapital,
      maxJumps: analysis.constraints.maxJumps,
      maxMinutes: analysis.constraints.maxMinutes,
    }));
    setPage(0);
  }, [
    analysis.generatedAt,
    analysis.constraints.maxCapital,
    analysis.constraints.maxJumps,
    analysis.constraints.maxMinutes,
  ]);

  const filtered = useMemo(
    () => filterMarketOpportunities(analysis.market.opportunities, filters),
    [analysis.market.opportunities, filters],
  );
  const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);

  function patch(next: Partial<MarketOpportunityFilters>) {
    setFilters((current) => ({ ...current, ...next }));
    setPage(0);
  }

  function toggleRisk(risk: OpportunityRisk) {
    const active = filters.risks.includes(risk);
    const risks = active
      ? filters.risks.filter((item) => item !== risk)
      : [...filters.risks, risk];
    patch({ risks });
  }

  function preset(id: string) {
    if (id === "confidence")
      patch({ risks: ["Low"], minFillScore: 78, sort: "fill" });
    if (id === "fast")
      patch({ maxJumps: 10, maxMinutes: 35, sort: "jumps" });
    if (id === "margin")
      patch({ minMarginPercent: 20, sort: "margin" });
    if (id === "capital")
      patch({ sort: "capital", minProfit: 1_000_000 });
    if (id === "cargo")
      patch({ sort: "iskm3", minIskPerM3: 1_000 });
    if (id === "profit")
      patch({ minProfit: 10_000_000, sort: "profit" });
  }

  return (
    <section className="market-opportunity-scanner">
      <div className="market-scanner-heading">
        <div>
          <p className="eyebrow">MARKET SCANNER</p>
          <h3>Search and filter candidate station-to-station trades</h3>
          <p>
            Results already respect the capital, cargo, jump and time limits above. Use these filters to narrow the matching routes.
          </p>
        </div>
        <div className="market-scanner-count">
          <strong>{filtered.length.toLocaleString()}</strong>
          <span>matching trades</span>
        </div>
      </div>

      <div className="market-quick-filters">
        <button onClick={() => preset("confidence")}>Low risk / high confidence</button>
        <button onClick={() => preset("fast")}>Fast hauls</button>
        <button onClick={() => preset("margin")}>20%+ margin</button>
        <button onClick={() => preset("capital")}>Capital efficient</button>
        <button onClick={() => preset("cargo")}>Cargo efficient</button>
        <button onClick={() => preset("profit")}>10M+ profit</button>
        <button
          className="reset"
          onClick={() =>
            patch({
              ...defaultMarketOpportunityFilters,
              maxInvestment: analysis.constraints.maxCapital,
              maxJumps: analysis.constraints.maxJumps,
              maxMinutes: analysis.constraints.maxMinutes,
            })
          }
        >
          Reset filters
        </button>
      </div>

      <div className="market-filter-grid">
        <label className="wide">
          Search item, category, region, system or station
          <input
            value={filters.search}
            onChange={(event) => patch({ search: event.target.value })}
            placeholder="e.g. modules Jita Amarr, implants Dodixie..."
          />
        </label>
        <label>
          Category
          <select value={filters.category} onChange={(event) => patch({ category: event.target.value })}>
            <option value="all">All categories</option>
            {analysis.market.facets.categories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </label>
        <label>
          Buy stock in region
          <select value={filters.sellRegion} onChange={(event) => patch({ sellRegion: event.target.value })}>
            <option value="all">Any region</option>
            {analysis.market.facets.sellRegions.map((region) => (
              <option key={region} value={region}>{region}</option>
            ))}
          </select>
        </label>
        <label>
          Sell to buyer in region
          <select value={filters.buyRegion} onChange={(event) => patch({ buyRegion: event.target.value })}>
            <option value="all">Any region</option>
            {analysis.market.facets.buyRegions.map((region) => (
              <option key={region} value={region}>{region}</option>
            ))}
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
          Minimum fill confidence
          <input value={filters.minFillScore ?? ""} onChange={(event) => patch({ minFillScore: numberOrNull(event.target.value) })} placeholder="0-100" inputMode="numeric" />
        </label>
        <label>
          Minimum ISK / m3
          <input value={filters.minIskPerM3 ?? ""} onChange={(event) => patch({ minIskPerM3: numberOrNull(event.target.value) })} placeholder="ISK/m3" inputMode="numeric" />
        </label>
        <label>
          Maximum capital
          <input value={filters.maxInvestment ?? ""} onChange={(event) => patch({ maxInvestment: numberOrNull(event.target.value) })} placeholder="ISK" inputMode="numeric" />
        </label>
        <label>
          Maximum jumps
          <input value={filters.maxJumps ?? ""} onChange={(event) => patch({ maxJumps: numberOrNull(event.target.value) })} placeholder="Any" inputMode="numeric" />
        </label>
        <label>
          Maximum planning time
          <input value={filters.maxMinutes ?? ""} onChange={(event) => patch({ maxMinutes: numberOrNull(event.target.value) })} placeholder="Minutes" inputMode="numeric" />
        </label>
        <label>
          Minimum units
          <input value={filters.minUnits ?? ""} onChange={(event) => patch({ minUnits: numberOrNull(event.target.value) })} placeholder="Units" inputMode="numeric" />
        </label>
        <label className="wide">
          Exclude words
          <input value={filters.exclude} onChange={(event) => patch({ exclude: event.target.value })} placeholder="Comma or space separated" />
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

      <div className="market-risk-filter">
        <span>Risk</span>
        {(["Low", "Medium", "High"] as OpportunityRisk[]).map((risk) => (
          <button key={risk} className={filters.risks.includes(risk) ? "active" : ""} onClick={() => toggleRisk(risk)}>{risk}</button>
        ))}
        <button className="market-export" onClick={onExport}>Export Top 1,000 CSV</button>
      </div>

      <div className="market-trade-table">
        <div className="market-trade-row heading">
          <span>Item / score</span><span>Buy stock</span><span>Sell to buyer</span><span>Capital / cargo</span><span>Route / confidence</span><span>Profit</span>
        </div>
        {visible.map((trade) => (
          <details className="market-trade-row market-trade-result" key={trade.id}>
            <summary>
              <span><strong>{trade.item}</strong><small>{trade.category} · Score {trade.score}/100</small></span>
              <span><strong>{trade.sell.systemName}</strong><small>{trade.sell.regionName}<br />{money(trade.sell.price)} ISK</small></span>
              <span><strong>{trade.buy.systemName}</strong><small>{trade.buy.regionName}<br />{money(trade.buy.price)} ISK</small></span>
              <span><strong>{money(trade.investment)} ISK</strong><small>{trade.units.toLocaleString()} units · {money(trade.cargoM3)} m3</small></span>
              <span><strong>{trade.jumps} jumps · {trade.risk}</strong><small>{trade.routeSecurity} route · {trade.estimatedMinutes} min plan · fill {trade.fillScore}/100</small></span>
              <span className="profit"><strong>{money(trade.profit)} ISK</strong><small>{trade.marginPercent.toFixed(1)}% · {Number.isFinite(trade.iskPerM3) ? `${money(trade.iskPerM3)} ISK/m3` : "No cargo volume"}</small></span>
            </summary>
            <div className="market-trade-work">
              <div className="trade-action-plan">
                <b>Exact haul plan</b>
                <small><strong>1 · BUY</strong> {trade.units.toLocaleString()} × {trade.item} at {money(trade.sell.price)} ISK each</small>
                <small>{trade.sell.locationName}, {trade.sell.systemName} · {trade.sell.regionName}</small>
                <small>Spend up to {money(trade.investment)} ISK · load {money(trade.cargoM3)} m3</small>
                <small><strong>2 · TRAVEL</strong> {trade.jumps} jumps to {trade.buy.systemName} · {trade.routeSecurity} route · about {trade.estimatedMinutes} minutes</small>
                <small><strong>3 · SELL</strong> to the existing buy order at {money(trade.buy.price)} ISK each</small>
                <small>{trade.buy.locationName}, {trade.buy.systemName} · {trade.buy.regionName}</small>
                <small>Expected gross return {money(trade.investment + trade.profit)} ISK · gross profit {money(trade.profit)} ISK</small>
                <em>Re-check both orders in EVE before buying; prices and remaining quantities can change.</em>
              </div>
              <div><b>Why it ranks here</b>{trade.reasons.map((reason) => <small key={reason}>{reason}</small>)}</div>
              <div><b>Score breakdown</b><small>Profit {trade.scoreBreakdown.profit}/100</small><small>Fill {trade.scoreBreakdown.fill}/100</small><small>Route {trade.scoreBreakdown.route}/100</small><small>Capital efficiency {trade.scoreBreakdown.capitalEfficiency}/100</small><small>Cargo efficiency {trade.scoreBreakdown.cargoEfficiency}/100</small></div>
              <div><b>Stations</b><small>Buy: {trade.sell.locationName}</small><small>Sell: {trade.buy.locationName}</small><small>{money(trade.iskPerJump)} ISK/jump · {trade.capitalEfficiencyPercent.toFixed(1)}% capital return</small></div>
            </div>
          </details>
        ))}
        {!visible.length && <div className="market-no-results">No trades match the current filters.</div>}
      </div>

      {filtered.length > pageSize && (
        <div className="isk-pagination">
          <button disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</button>
          <span>{page * pageSize + 1}-{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length.toLocaleString()}</span>
          <button disabled={(page + 1) * pageSize >= filtered.length} onClick={() => setPage((current) => current + 1)}>Next</button>
        </div>
      )}
    </section>
  );
}
