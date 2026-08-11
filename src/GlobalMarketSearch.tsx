import { FormEvent, useState } from "react";
import type { RawMarketSearchResult } from "./types";
import { friendlyAnalysisError, isExpectedAnalysisCancellation } from "./analysis-errors";

const money = (value: number) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(value);

function nullableNumber(value: string) {
  const parsed = Number(value.replace(/,/g, ""));
  return value.trim() && Number.isFinite(parsed) ? parsed : null;
}

function orderExpiry(issued: string, durationDays: number) {
  const issuedAt = Date.parse(issued);
  if (!Number.isFinite(issuedAt)) return "Unknown expiry";
  return new Date(issuedAt + durationDays * 86_400_000).toLocaleString();
}

export function GlobalMarketSearch() {
  const [query, setQuery] = useState("");
  const [selectedTypeId, setSelectedTypeId] = useState<number | undefined>();
  const [side, setSide] = useState<"all" | "buy" | "sell">("all");
  const [security, setSecurity] = useState<"all" | "high" | "low" | "null">("all");
  const [regionId, setRegionId] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sort, setSort] = useState<RawMarketSearchResult["filters"]["sort"]>("sell-lowest");
  const [result, setResult] = useState<RawMarketSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function search(options?: { typeId?: number; offset?: number; resetType?: boolean }) {
    const term = query.trim();
    if (!term && !options?.typeId && !selectedTypeId) return;
    setBusy(true);
    setError("");
    try {
      const next = await window.sage.searchRawMarket({
        query: term,
        typeId: options?.resetType ? undefined : (options?.typeId ?? selectedTypeId),
        side,
        security,
        regionId: regionId ? Number(regionId) : null,
        minPrice: nullableNumber(minPrice),
        maxPrice: nullableNumber(maxPrice),
        sort,
        offset: options?.offset ?? 0,
        limit: 200,
      });
      setResult(next);
      setSelectedTypeId(next.selectedType?.typeId);
    } catch (caught) {
      if (isExpectedAnalysisCancellation(caught)) return;
      setError(friendlyAnalysisError(caught, "Global market search failed."));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setSelectedTypeId(undefined);
    void search({ resetType: true });
  }

  const hasPrevious = Boolean(result && result.offset > 0);
  const hasNext = Boolean(result && result.offset + result.limit < result.totalOrders);

  return (
    <section className="global-market-search">
      <div className="global-market-title">
        <div>
          <p className="eyebrow">ALL-REGION RAW ORDER BOOK</p>
          <h3>Global market search</h3>
          <p>Search one item across every retained public buy and sell order in every region.</p>
        </div>
        {result?.snapshot && (
          <small>
            Snapshot {new Date(result.snapshot.createdAt).toLocaleString()} · {money(result.snapshot.orderCount)} raw orders · {result.snapshot.regionCount} regions
          </small>
        )}
      </div>

      <form className="global-market-query" onSubmit={submit}>
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedTypeId(undefined);
          }}
          placeholder="Search the entire market — e.g. Thorax"
          aria-label="Search every region"
        />
        <button type="submit" disabled={busy || !query.trim()}>
          {busy ? "Searching…" : "Search every region"}
        </button>
      </form>

      {error && <div className="global-market-message error"><span>{error}</span><button onClick={() => void search()} disabled={busy}>Retry</button></div>}
      {result?.message && <div className="global-market-message">{result.message}</div>}

      {result && !result.selectedType && result.typeMatches.length > 0 && (
        <div className="global-type-matches">
          {result.typeMatches.map((item) => (
            <button key={item.typeId} onClick={() => void search({ typeId: item.typeId })} disabled={busy}>
              <strong>{item.name}</strong>
              <small>{item.categoryName}</small>
            </button>
          ))}
        </div>
      )}

      {result?.selectedType && (
        <>
          <div className="global-market-selected">
            <div>
              <span>{result.selectedType.categoryName}</span>
              <strong>{result.selectedType.name}</strong>
            </div>
            <div><span>All matching orders</span><strong>{money(result.totalOrders)}</strong></div>
            <div><span>Buy / sell</span><strong>{money(result.buyOrders)} / {money(result.sellOrders)}</strong></div>
            <div><span>Regions represented</span><strong>{result.regionsWithOrders}</strong></div>
            <div><span>Highest buyer</span><strong>{result.bestBuy == null ? "—" : `${money(result.bestBuy)} ISK`}</strong></div>
            <div><span>Lowest seller</span><strong>{result.bestSell == null ? "—" : `${money(result.bestSell)} ISK`}</strong></div>
          </div>

          <div className="global-market-filters">
            <label>
              Side
              <select value={side} onChange={(event) => setSide(event.target.value as typeof side)}>
                <option value="all">Buy and sell</option>
                <option value="sell">Sell orders</option>
                <option value="buy">Buy orders</option>
              </select>
            </label>
            <label>
              Security
              <select value={security} onChange={(event) => setSecurity(event.target.value as typeof security)}>
                <option value="all">All security</option>
                <option value="high">High-sec</option>
                <option value="low">Low-sec</option>
                <option value="null">Null-sec / 0.0</option>
              </select>
            </label>
            <label>
              Region
              <select value={regionId} onChange={(event) => setRegionId(event.target.value)}>
                <option value="">Every region</option>
                {result.regionOptions.map((region) => (
                  <option key={region.regionId} value={region.regionId}>{region.regionName}</option>
                ))}
              </select>
            </label>
            <label>
              Minimum price
              <input value={minPrice} onChange={(event) => setMinPrice(event.target.value)} placeholder="Any" inputMode="decimal" />
            </label>
            <label>
              Maximum price
              <input value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="Any" inputMode="decimal" />
            </label>
            <label>
              Sort
              <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                <option value="sell-lowest">Sellers first · lowest price</option>
                <option value="buy-highest">Buyers first · highest price</option>
                <option value="price-low">Price · low to high</option>
                <option value="price-high">Price · high to low</option>
                <option value="volume">Remaining volume</option>
                <option value="newest">Newest orders</option>
              </select>
            </label>
            <button onClick={() => void search()} disabled={busy}>Apply filters</button>
          </div>

          <div className="global-order-table">
            <div className="global-order-row heading">
              <span>Side</span>
              <span>Price</span>
              <span>Remaining</span>
              <span>Min / range</span>
              <span>Region</span>
              <span>System / location</span>
              <span>Security</span>
              <span>Order</span>
            </div>
            {result.orders.map((order) => (
              <div className="global-order-row" key={order.orderId}>
                <span className={order.side}><strong>{order.side === "buy" ? "BUY" : "SELL"}</strong></span>
                <span className={order.side}><strong>{money(order.price)} ISK</strong></span>
                <span><strong>{money(order.volumeRemain)}</strong><small>of {money(order.volumeTotal)}</small></span>
                <span><strong>{money(order.minVolume)}</strong><small>{order.range}</small></span>
                <span><strong>{order.regionName}</strong></span>
                <span><strong>{order.systemName}</strong><small>{order.locationName}</small></span>
                <span><strong>{order.securityStatus == null ? "—" : order.securityStatus.toFixed(2)}</strong><small>{order.securityBand}</small></span>
                <span><strong>#{order.orderId}</strong><small>Expires {orderExpiry(order.issued, order.durationDays)}</small></span>
              </div>
            ))}
          </div>

          {!result.orders.length && <div className="global-market-message">No orders match the current filters.</div>}

          {result.totalOrders > result.limit && (
            <div className="global-market-pagination">
              <button disabled={!hasPrevious || busy} onClick={() => void search({ offset: Math.max(0, result.offset - result.limit) })}>Previous</button>
              <span>
                {result.totalOrders ? `${money(result.offset + 1)}–${money(Math.min(result.totalOrders, result.offset + result.limit))}` : "0"} of {money(result.totalOrders)} orders
              </span>
              <button disabled={!hasNext || busy} onClick={() => void search({ offset: result.offset + result.limit })}>Next</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
