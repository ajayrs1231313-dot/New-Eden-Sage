import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  AnalysisProgress,
  RegionalMarketFilterResult,
  RegionalMarketFilterSecurity,
  RegionalMarketPresence,
  RegionalMarketSignal,
  RegionalMarketSort,
} from "./types";

const number = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

function nullableNumber(value: string) {
  const parsed = Number(value.replace(/,/g, ""));
  return value.trim() && Number.isFinite(parsed) ? parsed : null;
}

function ratioLabel(value: number) {
  if (!Number.isFinite(value)) return "∞";
  return value >= 100 ? whole.format(value) : value.toFixed(value >= 10 ? 1 : 2);
}

export function RegionalMarketFilterPanel() {
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [marketGroupText, setMarketGroupText] = useState("");
  const [regionId, setRegionId] = useState("");
  const [security, setSecurity] = useState<RegionalMarketFilterSecurity>("all");
  const [presence, setPresence] = useState<RegionalMarketPresence>("any");
  const [signal, setSignal] = useState<RegionalMarketSignal>("all");
  const [sort, setSort] = useState<RegionalMarketSort>("signal");
  const [minBestBuy, setMinBestBuy] = useState("");
  const [maxBestBuy, setMaxBestBuy] = useState("");
  const [minBestSell, setMinBestSell] = useState("");
  const [maxBestSell, setMaxBestSell] = useState("");
  const [minBuyOrders, setMinBuyOrders] = useState("");
  const [maxBuyOrders, setMaxBuyOrders] = useState("");
  const [minSellOrders, setMinSellOrders] = useState("");
  const [maxSellOrders, setMaxSellOrders] = useState("");
  const [minBuyVolume, setMinBuyVolume] = useState("");
  const [minSellVolume, setMinSellVolume] = useState("");
  const [maxSellVolume, setMaxSellVolume] = useState("");
  const [minSpread, setMinSpread] = useState("");
  const [maxSpread, setMaxSpread] = useState("");
  const [minPremium, setMinPremium] = useState("");
  const [minDemandRatio, setMinDemandRatio] = useState("");
  const [maxItemVolume, setMaxItemVolume] = useState("");
  const [result, setResult] = useState<RegionalMarketFilterResult | null>(null);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);

  useEffect(
    () =>
      window.sage.onAnalysisProgress((next) => {
        if (next.kind === "regional-filter") setProgress(next);
      }),
    [],
  );

  const groups = useMemo(() => {
    const all = result?.taxonomy.groups ?? [];
    return categoryId ? all.filter((group) => group.categoryId === Number(categoryId)) : all;
  }, [result?.taxonomy.groups, categoryId]);

  const marketGroupId = useMemo(() => {
    if (!marketGroupText.trim()) return undefined;
    return result?.taxonomy.marketGroups.find(
      (group) => group.pathLabel.toLowerCase() === marketGroupText.trim().toLowerCase(),
    )?.id;
  }, [result?.taxonomy.marketGroups, marketGroupText]);

  function currentInput(offset = 0, overrides: Record<string, unknown> = {}) {
    return {
      query,
      categoryIds: categoryId ? [Number(categoryId)] : [],
      groupIds: groupId ? [Number(groupId)] : [],
      marketGroupIds: marketGroupId ? [marketGroupId] : [],
      regionIds: regionId ? [Number(regionId)] : [],
      security,
      presence,
      signal,
      minBestBuy: nullableNumber(minBestBuy),
      maxBestBuy: nullableNumber(maxBestBuy),
      minBestSell: nullableNumber(minBestSell),
      maxBestSell: nullableNumber(maxBestSell),
      minBuyOrders: nullableNumber(minBuyOrders),
      maxBuyOrders: nullableNumber(maxBuyOrders),
      minSellOrders: nullableNumber(minSellOrders),
      maxSellOrders: nullableNumber(maxSellOrders),
      minBuyVolume: nullableNumber(minBuyVolume),
      minSellVolume: nullableNumber(minSellVolume),
      maxSellVolume: nullableNumber(maxSellVolume),
      minSpreadPercent: nullableNumber(minSpread),
      maxSpreadPercent: nullableNumber(maxSpread),
      minRegionalPremiumPercent: nullableNumber(minPremium),
      minDemandSupplyRatio: nullableNumber(minDemandRatio),
      maxItemVolumeM3: nullableNumber(maxItemVolume),
      sort,
      offset,
      limit: 250,
      ...overrides,
    };
  }

  async function runFilter(offset = 0, overrides: Record<string, unknown> = {}) {
    const requestId = ++requestSequence.current;
    setBusy(true);
    setError("");
    setProgress(null);
    try {
      const next = await window.sage.filterRegionalMarket(currentInput(offset, overrides));
      if (requestId === requestSequence.current) setResult(next);
    } catch (caught) {
      if (requestId === requestSequence.current) {
        setError(caught instanceof Error ? caught.message : "Regional market filtering failed.");
      }
    } finally {
      if (requestId === requestSequence.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  }

  useEffect(() => {
    void runFilter(0);
    // Initial taxonomy + aggregate load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    void runFilter(0);
  }

  function reset() {
    setQuery("");
    setCategoryId("");
    setGroupId("");
    setMarketGroupText("");
    setRegionId("");
    setSecurity("all");
    setPresence("any");
    setSignal("all");
    setSort("signal");
    setMinBestBuy("");
    setMaxBestBuy("");
    setMinBestSell("");
    setMaxBestSell("");
    setMinBuyOrders("");
    setMaxBuyOrders("");
    setMinSellOrders("");
    setMaxSellOrders("");
    setMinBuyVolume("");
    setMinSellVolume("");
    setMaxSellVolume("");
    setMinSpread("");
    setMaxSpread("");
    setMinPremium("");
    setMinDemandRatio("");
    setMaxItemVolume("");
    void runFilter(0, {
      query: "",
      categoryIds: [],
      groupIds: [],
      marketGroupIds: [],
      regionIds: [],
      security: "all",
      presence: "any",
      signal: "all",
      sort: "signal",
      minBestBuy: null,
      maxBestBuy: null,
      minBestSell: null,
      maxBestSell: null,
      minBuyOrders: null,
      maxBuyOrders: null,
      minSellOrders: null,
      maxSellOrders: null,
      minBuyVolume: null,
      minSellVolume: null,
      maxSellVolume: null,
      minSpreadPercent: null,
      maxSpreadPercent: null,
      minRegionalPremiumPercent: null,
      minDemandSupplyRatio: null,
      maxItemVolumeM3: null,
    });
  }

  function preset(nextSignal: RegionalMarketSignal, overrides: Record<string, unknown> = {}) {
    const nextMaxSellOrders = typeof overrides.maxSellOrders === "number" ? String(overrides.maxSellOrders) : "";
    const nextPremium = typeof overrides.minRegionalPremiumPercent === "number" ? String(overrides.minRegionalPremiumPercent) : "";
    const nextDemandRatio = typeof overrides.minDemandSupplyRatio === "number" ? String(overrides.minDemandSupplyRatio) : "";
    setSignal(nextSignal);
    setMaxSellOrders(nextMaxSellOrders);
    setMinPremium(nextPremium);
    setMinDemandRatio(nextDemandRatio);
    if (typeof overrides.security === "string") setSecurity(overrides.security as RegionalMarketFilterSecurity);
    const nextSort = nextSignal === "premium" ? "premium" : nextSignal === "buy-pressure" ? "demand-pressure" : "signal";
    setSort(nextSort);
    void runFilter(0, {
      signal: nextSignal,
      sort: nextSort,
      maxSellOrders: overrides.maxSellOrders ?? null,
      minRegionalPremiumPercent: overrides.minRegionalPremiumPercent ?? null,
      minDemandSupplyRatio: overrides.minDemandSupplyRatio ?? null,
      ...overrides,
    });
  }

  const hasPrevious = Boolean(result && result.offset > 0);
  const hasNext = Boolean(result && result.offset + result.limit < result.totalRows);

  return (
    <section className="regional-filter-panel">
      <div className="regional-filter-heading">
        <div>
          <p className="eyebrow">REGIONAL MARKET EXPLORER</p>
          <h3>Filter the whole market, not one item at a time</h3>
          <p>Search item families and regional depth across the complete retained order book, then narrow by supply, demand, spread and regional pricing.</p>
        </div>
        {result?.snapshot && (
          <small>{whole.format(result.snapshot.orderCount)} raw orders · {result.snapshot.regionCount} regions · snapshot {new Date(result.snapshot.createdAt).toLocaleString()}</small>
        )}
      </div>

      <div className="regional-filter-presets">
        <button onClick={() => preset("supply-gap")}>Supply gaps</button>
        <button onClick={() => preset("thin-supply", { maxSellOrders: 5 })}>Thin sell depth</button>
        <button onClick={() => preset("premium", { minRegionalPremiumPercent: 20 })}>20%+ regional premium</button>
        <button onClick={() => preset("buy-pressure", { minDemandSupplyRatio: 2 })}>Strong buy pressure</button>
        <button onClick={() => preset("all", { security: "high" })}>High-sec only</button>
        <button className="secondary" onClick={reset}>Reset</button>
      </div>

      <form className="regional-filter-form" onSubmit={submit}>
        <div className="regional-filter-primary">
          <label className="regional-filter-search">
            Item / group
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. Heavy Missile, Battleship, Shield Booster…" />
          </label>
          <label>
            Category
            <select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setGroupId(""); }}>
              <option value="">All categories</option>
              {result?.taxonomy.categories.map((category) => <option key={category.id} value={category.id}>{category.name} ({whole.format(category.typeCount)})</option>)}
            </select>
          </label>
          <label>
            Group
            <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
              <option value="">All groups</option>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.name} ({whole.format(group.typeCount)})</option>)}
            </select>
          </label>
          <label>
            Market group
            <input list="market-group-taxonomy" value={marketGroupText} onChange={(event) => setMarketGroupText(event.target.value)} placeholder="All market groups" />
            <datalist id="market-group-taxonomy">
              {result?.taxonomy.marketGroups.map((group) => <option key={group.id} value={group.pathLabel} />)}
            </datalist>
          </label>
          <label>
            Region
            <select value={regionId} onChange={(event) => setRegionId(event.target.value)}>
              <option value="">Every region</option>
              {result?.regionOptions.map((region) => <option key={region.regionId} value={region.regionId}>{region.regionName}</option>)}
            </select>
          </label>
          <label>
            Security
            <select value={security} onChange={(event) => setSecurity(event.target.value as RegionalMarketFilterSecurity)}>
              <option value="all">All security</option>
              <option value="high">High-sec only</option>
              <option value="low">Low-sec only</option>
              <option value="null">Null-sec / 0.0 only</option>
            </select>
          </label>
          <label>
            Orders required
            <select value={presence} onChange={(event) => setPresence(event.target.value as RegionalMarketPresence)}>
              <option value="any">Buy or sell</option>
              <option value="both">Both sides</option>
              <option value="buy">Buy demand</option>
              <option value="sell">Sell supply</option>
            </select>
          </label>
          <label>
            Market signal
            <select value={signal} onChange={(event) => setSignal(event.target.value as RegionalMarketSignal)}>
              <option value="all">Any signal</option>
              <option value="supply-gap">Supply gap</option>
              <option value="thin-supply">Thin supply</option>
              <option value="premium">Regional premium</option>
              <option value="buy-pressure">Buy pressure</option>
            </select>
          </label>
          <label>
            Sort
            <select value={sort} onChange={(event) => setSort(event.target.value as RegionalMarketSort)}>
              <option value="signal">Strongest signal</option>
              <option value="premium">Regional premium</option>
              <option value="demand-pressure">Demand / supply pressure</option>
              <option value="spread">Spread</option>
              <option value="best-sell">Lowest sell</option>
              <option value="best-buy">Highest buy</option>
              <option value="buy-orders">Most buy orders</option>
              <option value="sell-orders">Most sell orders</option>
              <option value="buy-volume">Largest buy volume</option>
              <option value="sell-volume">Largest sell volume</option>
              <option value="cargo-size">Smallest item volume</option>
              <option value="name">Item name</option>
            </select>
          </label>
          <button type="submit" disabled={busy}>{busy ? "Filtering…" : "Apply filters"}</button>
        </div>

        <details className="regional-filter-advanced">
          <summary>Advanced numeric filters</summary>
          <div>
            <label>Min best buy<input value={minBestBuy} onChange={(e) => setMinBestBuy(e.target.value)} placeholder="Any" inputMode="decimal" /></label>
            <label>Max best buy<input value={maxBestBuy} onChange={(e) => setMaxBestBuy(e.target.value)} placeholder="Any" inputMode="decimal" /></label>
            <label>Min best sell<input value={minBestSell} onChange={(e) => setMinBestSell(e.target.value)} placeholder="Any" inputMode="decimal" /></label>
            <label>Max best sell<input value={maxBestSell} onChange={(e) => setMaxBestSell(e.target.value)} placeholder="Any" inputMode="decimal" /></label>
            <label>Min buy orders<input value={minBuyOrders} onChange={(e) => setMinBuyOrders(e.target.value)} placeholder="Any" inputMode="numeric" /></label>
            <label>Max buy orders<input value={maxBuyOrders} onChange={(e) => setMaxBuyOrders(e.target.value)} placeholder="Any" inputMode="numeric" /></label>
            <label>Min sell orders<input value={minSellOrders} onChange={(e) => setMinSellOrders(e.target.value)} placeholder="Any" inputMode="numeric" /></label>
            <label>Max sell orders<input value={maxSellOrders} onChange={(e) => setMaxSellOrders(e.target.value)} placeholder="Any" inputMode="numeric" /></label>
            <label>Min buy volume<input value={minBuyVolume} onChange={(e) => setMinBuyVolume(e.target.value)} placeholder="Any" inputMode="numeric" /></label>
            <label>Min sell volume<input value={minSellVolume} onChange={(e) => setMinSellVolume(e.target.value)} placeholder="Any" inputMode="numeric" /></label>
            <label>Max sell volume<input value={maxSellVolume} onChange={(e) => setMaxSellVolume(e.target.value)} placeholder="Any" inputMode="numeric" /></label>
            <label>Min spread %<input value={minSpread} onChange={(e) => setMinSpread(e.target.value)} placeholder="Any" inputMode="decimal" /></label>
            <label>Max spread %<input value={maxSpread} onChange={(e) => setMaxSpread(e.target.value)} placeholder="Any" inputMode="decimal" /></label>
            <label>Min regional premium %<input value={minPremium} onChange={(e) => setMinPremium(e.target.value)} placeholder="Any" inputMode="decimal" /></label>
            <label>Min demand / supply<input value={minDemandRatio} onChange={(e) => setMinDemandRatio(e.target.value)} placeholder="Any" inputMode="decimal" /></label>
            <label>Max item volume m³<input value={maxItemVolume} onChange={(e) => setMaxItemVolume(e.target.value)} placeholder="Any" inputMode="decimal" /></label>
          </div>
        </details>
      </form>

      {busy && progress && (
        <div className="regional-filter-progress" aria-live="polite">
          <div><strong>{progress.message}</strong><span>{progress.cached ? "Saved index" : progress.percent != null ? `${Math.round(progress.percent)}%` : "Working"}</span></div>
          <div className="analysis-progress-track"><i style={{ width: `${Math.max(2, Math.min(100, progress.percent ?? 8))}%` }} /></div>
        </div>
      )}
      {error && <div className="global-market-message error">{error}</div>}
      {result?.message && <div className="global-market-message">{result.message}</div>}

      {result && (
        <>
          <div className="regional-filter-summary">
            <article><span>Matching rows</span><strong>{whole.format(result.totalRows)}</strong><small>{whole.format(result.totalItems)} unique items</small></article>
            <article><span>Supply gaps</span><strong>{whole.format(result.summary.supplyGaps)}</strong><small>Buy demand · no sell supply</small></article>
            <article><span>Thin supply</span><strong>{whole.format(result.summary.thinSupply)}</strong><small>Low sell depth vs demand</small></article>
            <article><span>Regional premiums</span><strong>{whole.format(result.summary.premiumRows)}</strong><small>Highest {result.summary.highestPremiumPercent.toFixed(1)}%</small></article>
            <article><span>Buy pressure</span><strong>{whole.format(result.summary.buyPressureRows)}</strong><small>{result.summary.regionsRepresented} regions represented</small></article>
          </div>

          <div className="regional-filter-table">
            <div className="regional-filter-row heading">
              <span>Item</span><span>Region</span><span>Buy depth</span><span>Sell depth</span><span>Best buy</span><span>Best sell</span><span>Spread</span><span>Premium</span><span>Demand / supply</span><span>Signal</span>
            </div>
            {result.rows.map((row) => (
              <div className="regional-filter-row" key={`${row.typeId}:${row.regionId}:${row.security}`}>
                <span><strong>{row.item}</strong><small>{row.marketGroupPath || `${row.category} › ${row.group}`}</small><em>{number.format(row.itemVolumeM3)} m³</em></span>
                <span><strong>{row.region}</strong><small>{row.security === "all" ? "All security" : `${row.security}-sec`}</small></span>
                <span className="buy"><strong>{whole.format(row.buyOrders)} orders</strong><small>{whole.format(row.buyVolume)} units</small>{row.bestBuySystemName && <em>{row.bestBuySystemName}</em>}</span>
                <span className="sell"><strong>{whole.format(row.sellOrders)} orders</strong><small>{whole.format(row.sellVolume)} units</small>{row.bestSellSystemName && <em>{row.bestSellSystemName}</em>}</span>
                <span className="buy"><strong>{row.bestBuy == null ? "—" : `${number.format(row.bestBuy)} ISK`}</strong><small>{row.bestBuyVolume ? `${whole.format(row.bestBuyVolume)} at best` : ""}</small></span>
                <span className="sell"><strong>{row.bestSell == null ? "—" : `${number.format(row.bestSell)} ISK`}</strong><small>{row.globalCheapestSellRegion && row.globalCheapestSellRegion !== row.region ? `Cheapest: ${row.globalCheapestSellRegion}` : ""}</small></span>
                <span><strong>{row.spreadPercent == null ? "—" : `${row.spreadPercent.toFixed(1)}%`}</strong></span>
                <span><strong>{row.supplyGap ? "SUPPLY GAP" : row.regionalPremiumPercent == null ? "—" : `${row.regionalPremiumPercent.toFixed(1)}%`}</strong></span>
                <span><strong>{ratioLabel(row.demandSupplyRatio)}×</strong><small>{row.buyPressure ? "Buy pressure" : ""}</small></span>
                <span className="signal-score"><strong>{row.signalScore}</strong><small>{row.supplyGap ? "Supply gap" : row.thinSupply ? "Thin supply" : row.buyPressure ? "Buy pressure" : "Market depth"}</small></span>
              </div>
            ))}
          </div>

          {!result.rows.length && <div className="market-no-results">No regional market rows match these filters.</div>}
          {result.totalRows > result.limit && (
            <div className="global-market-pagination">
              <button disabled={!hasPrevious || busy} onClick={() => void runFilter(Math.max(0, result.offset - result.limit))}>Previous</button>
              <span>{result.totalRows ? `${whole.format(result.offset + 1)}–${whole.format(Math.min(result.totalRows, result.offset + result.limit))}` : "0"} of {whole.format(result.totalRows)} rows</span>
              <button disabled={!hasNext || busy} onClick={() => void runFilter(result.offset + result.limit)}>Next</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
