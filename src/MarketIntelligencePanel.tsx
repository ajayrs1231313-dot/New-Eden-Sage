import { FormEvent, useEffect, useMemo, useState } from "react";
import type { RegionalMarketFilterResult, RegionalMarketFilterRow } from "./types";

const whole = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const MEMORY_KEY = "new-eden-sage.market-intelligence.task10.v2";

type MarketItemHistoryPoint = {
  createdAt: string;
  regionId: number;
  region: string;
  bestBuy: number | null;
  bestSell: number | null;
  spreadPercent: number | null;
  buyOrders: number;
  sellOrders: number;
  buyVolume: number;
  sellVolume: number;
};

type MarketItemHistory = {
  typeId: number;
  item: string;
  category: string;
  group: string;
  marketGroup: string;
  snapshotCount: number;
  snapshots: Array<{ createdAt: string; rows: MarketItemHistoryPoint[] }>;
};

type MarketMemory = {
  favourites: number[];
  watchlist: number[];
  recent: number[];
  names: Record<string, string>;
};

type Task10Sage = typeof window.sage & {
  getMarketItemHistory(typeId: number): Promise<MarketItemHistory>;
  exportRegionalMarket(format: "csv" | "json" | "xlsx", rows: unknown[], itemName?: string): Promise<string | null>;
};

function task10Sage() {
  return window.sage as Task10Sage;
}

function emptyMemory(): MarketMemory {
  return { favourites: [], watchlist: [], recent: [], names: {} };
}

function loadMemory(): MarketMemory {
  try {
    const parsed = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? "{}") as Partial<MarketMemory>;
    return {
      favourites: Array.isArray(parsed.favourites) ? parsed.favourites : [],
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
      recent: Array.isArray(parsed.recent) ? parsed.recent : [],
      names: parsed.names && typeof parsed.names === "object" ? parsed.names : {},
    };
  } catch {
    return emptyMemory();
  }
}

function percentChange(current: number | null, previous: number | null) {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function trend(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function average(values: Array<number | null>) {
  const usable = values.filter((value): value is number => value != null && Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function exportColumns(rows: RegionalMarketFilterRow[]) {
  return rows.map((row) => ({
    type_id: row.typeId,
    item: row.item,
    category: row.category,
    group: row.group,
    market_group: row.marketGroupPath,
    region_id: row.regionId,
    region: row.region,
    security: row.security,
    best_buy_isk: row.bestBuy,
    best_sell_isk: row.bestSell,
    buy_orders: row.buyOrders,
    sell_orders: row.sellOrders,
    buy_volume: row.buyVolume,
    sell_volume: row.sellVolume,
    spread_percent: row.spreadPercent,
    regional_premium_percent: row.regionalPremiumPercent,
    demand_supply_ratio: Number.isFinite(row.demandSupplyRatio) ? row.demandSupplyRatio : null,
    signal_score: row.signalScore,
    supply_gap: row.supplyGap,
    thin_supply: row.thinSupply,
    buy_pressure: row.buyPressure,
  }));
}

export function MarketIntelligencePanel() {
  const [query, setQuery] = useState("");
  const [searchResult, setSearchResult] = useState<RegionalMarketFilterResult | null>(null);
  const [intel, setIntel] = useState<RegionalMarketFilterResult | null>(null);
  const [history, setHistory] = useState<MarketItemHistory | null>(null);
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [memory, setMemory] = useState<MarketMemory>(loadMemory);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [compareA, setCompareA] = useState<number | null>(null);
  const [compareB, setCompareB] = useState<number | null>(null);
  const [related, setRelated] = useState<Array<{ typeId: number; item: string; group: string; marketGroup: string }>>([]);

  useEffect(() => {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  }, [memory]);

  async function search(event?: FormEvent) {
    event?.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setError("");
    setStatus("");
    setIntel(null);
    setHistory(null);
    setSelectedTypeId(null);
    try {
      const result = await window.sage.filterRegionalMarket({ query: query.trim(), sort: "name", offset: 0, limit: 250 });
      setSearchResult(result);
      const exact = result.rows.find((row) => row.item.toLowerCase() === query.trim().toLowerCase());
      if (exact) await openItem(exact.typeId, exact.item, false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Market intelligence search failed.");
    } finally {
      setBusy(false);
    }
  }

  async function openItem(typeId: number, itemName?: string, manageBusy = true) {
    if (manageBusy) setBusy(true);
    setError("");
    setStatus("");
    try {
      const queryText = itemName ?? memory.names[String(typeId)] ?? "";
      const [exact, historical] = await Promise.all([
        window.sage.filterRegionalMarket({ query: queryText, sort: "name", offset: 0, limit: 1000 }),
        task10Sage().getMarketItemHistory(typeId),
      ]);
      const rows = exact.rows.filter((row) => row.typeId === typeId);
      if (!rows.length) throw new Error("No regional rows are available for this item in the current full-market snapshot.");
      const result: RegionalMarketFilterResult = { ...exact, rows, totalRows: rows.length, totalItems: 1 };
      setIntel(result);
      setHistory(historical);
      setSearchResult(null);
      setSelectedTypeId(typeId);
      setQuery(rows[0].item);
      setCompareA(rows[0]?.regionId ?? null);
      setCompareB(rows[1]?.regionId ?? rows[0]?.regionId ?? null);
      const relatedResult = await window.sage.filterRegionalMarket({ groupIds: [rows[0].groupId], sort: "name", offset: 0, limit: 1000 });
      const unique = new Map<number, { typeId: number; item: string; group: string; marketGroup: string }>();
      for (const row of relatedResult.rows) {
        if (row.typeId !== typeId && !unique.has(row.typeId)) unique.set(row.typeId, { typeId: row.typeId, item: row.item, group: row.group, marketGroup: row.marketGroupPath });
        if (unique.size >= 16) break;
      }
      setRelated([...unique.values()]);
      setMemory((current) => ({
        ...current,
        recent: [typeId, ...current.recent.filter((id) => id !== typeId)].slice(0, 24),
        names: { ...current.names, [String(typeId)]: rows[0].item },
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open item intelligence.");
    } finally {
      if (manageBusy) setBusy(false);
    }
  }

  const selectedRows = intel?.rows ?? [];
  const selectedItem = selectedRows[0]?.item ?? history?.item ?? "Regional market";
  const latestByRegion = useMemo(() => new Map(selectedRows.map((row) => [row.regionId, row])), [selectedRows]);
  const compareRowA = compareA == null ? null : latestByRegion.get(compareA) ?? null;
  const compareRowB = compareB == null ? null : latestByRegion.get(compareB) ?? null;
  const isFavourite = selectedTypeId != null && memory.favourites.includes(selectedTypeId);
  const isWatched = selectedTypeId != null && memory.watchlist.includes(selectedTypeId);

  const historyRows = useMemo(() => {
    const previousByRegion = new Map((history?.snapshots[1]?.rows ?? []).map((row) => [row.regionId, row]));
    return selectedRows.map((current) => {
      const previous = previousByRegion.get(current.regionId) ?? null;
      return {
        row: current,
        sellTrend: percentChange(current.bestSell, previous?.bestSell ?? null),
        buyTrend: percentChange(current.bestBuy, previous?.bestBuy ?? null),
        spreadDelta: current.spreadPercent != null && previous?.spreadPercent != null ? current.spreadPercent - previous.spreadPercent : null,
      };
    });
  }, [selectedRows, history]);

  const insights = useMemo(() => {
    if (!selectedRows.length) return [];
    const notes: string[] = [];
    const sellers = selectedRows.filter((row) => row.bestSell != null).sort((a, b) => (a.bestSell ?? Infinity) - (b.bestSell ?? Infinity));
    const buyers = selectedRows.filter((row) => row.bestBuy != null).sort((a, b) => (b.bestBuy ?? 0) - (a.bestBuy ?? 0));
    if (sellers.length) notes.push(`Cheapest regional sell: ${sellers[0].region} at ${money.format(sellers[0].bestSell!)} ISK.`);
    if (buyers.length) notes.push(`Highest regional buy: ${buyers[0].region} at ${money.format(buyers[0].bestBuy!)} ISK.`);
    if (sellers.length > 1 && sellers[0].bestSell && sellers[sellers.length - 1].bestSell) {
      const premium = ((sellers[sellers.length - 1].bestSell! - sellers[0].bestSell) / sellers[0].bestSell) * 100;
      notes.push(`Current regional sell-price range spans ${premium.toFixed(1)}% from cheapest to dearest.`);
    }
    const gaps = selectedRows.filter((row) => row.supplyGap).length;
    if (gaps) notes.push(`${gaps} regions show buy demand with no retained sell supply.`);
    const thin = selectedRows.filter((row) => row.thinSupply).length;
    if (thin) notes.push(`${thin} regions currently qualify as thin-supply markets.`);
    const avgSpread = average(selectedRows.map((row) => row.spreadPercent));
    if (avgSpread != null) notes.push(`Average visible regional spread is ${avgSpread.toFixed(1)}%.`);
    if ((history?.snapshotCount ?? 0) > 1) {
      const rising = historyRows.filter((item) => (item.sellTrend ?? 0) >= 5).length;
      const falling = historyRows.filter((item) => (item.sellTrend ?? 0) <= -5).length;
      notes.push(`Versus the previous retained full-market snapshot, sell prices are up at least 5% in ${rising} regions and down at least 5% in ${falling}.`);
    } else notes.push("Only one retained full-market snapshot currently contains this item, so a directional trend is not yet available.");
    return notes;
  }, [selectedRows, history, historyRows]);

  function toggleList(kind: "favourites" | "watchlist") {
    if (selectedTypeId == null) return;
    setMemory((current) => {
      const exists = current[kind].includes(selectedTypeId);
      return { ...current, [kind]: exists ? current[kind].filter((id) => id !== selectedTypeId) : [selectedTypeId, ...current[kind]] };
    });
  }

  async function exportCurrent(format: "csv" | "json" | "xlsx") {
    if (!selectedRows.length) return;
    try {
      const file = await task10Sage().exportRegionalMarket(format, exportColumns(selectedRows), selectedItem);
      if (file) setStatus(`Export saved to ${file}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Regional market export failed.");
    }
  }

  return (
    <section className="market-intelligence-task10">
      <div className="task10-toolbar">
        <div>
          <p className="eyebrow">TASK 10 · REGIONAL MARKET INTELLIGENCE</p>
          <h3>Item intelligence, comparisons, retained history and exports</h3>
          <p>Uses the complete regional market index above and reads up to 24 retained full-market datasets for price, order and spread history.</p>
        </div>
        {intel && <small>{selectedRows.length} current regions · {history?.snapshotCount ?? 0} retained snapshots for {selectedItem}</small>}
      </div>

      <form className="task10-search" onSubmit={search}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search an item, e.g. Thorax, Tritanium, Heavy Missile Launcher II…" />
        <button type="submit" disabled={busy || !query.trim()}>{busy ? "Working…" : "Open intelligence"}</button>
      </form>
      {error && <div className="global-market-message error">{error}</div>}
      {status && <div className="global-market-message">{status}</div>}

      {searchResult && !intel && (
        <div className="task10-picker">
          {[...new Map(searchResult.rows.map((row) => [row.typeId, row])).values()].slice(0, 40).map((row) => (
            <button key={row.typeId} onClick={() => void openItem(row.typeId, row.item)}>
              <strong>{row.item}</strong><small>{row.marketGroupPath || `${row.category} › ${row.group}`}</small>
            </button>
          ))}
          {!searchResult.rows.length && <div className="market-no-results">No market items match that search.</div>}
        </div>
      )}

      {intel && selectedTypeId != null && (
        <>
          <div className="task10-item-head">
            <div><h3>{selectedItem}</h3><p>{history?.marketGroup || selectedRows[0].marketGroupPath || `${selectedRows[0].category} › ${selectedRows[0].group}`}</p></div>
            <div className="task10-actions">
              <button onClick={() => toggleList("favourites")}>{isFavourite ? "★ Favourite" : "☆ Favourite"}</button>
              <button onClick={() => toggleList("watchlist")}>{isWatched ? "● Watching" : "○ Watchlist"}</button>
              <button onClick={() => void exportCurrent("csv")}>CSV</button>
              <button onClick={() => void exportCurrent("json")}>JSON</button>
              <button onClick={() => void exportCurrent("xlsx")}>Excel</button>
            </div>
          </div>

          <div className="task10-grid">
            <article><span>Regions</span><strong>{selectedRows.length}</strong><small>with current buy or sell presence</small></article>
            <article><span>Retained snapshots</span><strong>{history?.snapshotCount ?? 0}</strong><small>full-market datasets inspected</small></article>
            <article><span>Favourites</span><strong>{memory.favourites.length}</strong><small>persistent local shortlist</small></article>
            <article><span>Watchlist</span><strong>{memory.watchlist.length}</strong><small>persistent market watch items</small></article>
          </div>

          <div className="task10-columns">
            <section className="task10-card">
              <h4>Region versus region</h4>
              <div className="task10-compare-selects">
                <select value={compareA ?? ""} onChange={(event) => setCompareA(Number(event.target.value))}>{selectedRows.map((row) => <option key={row.regionId} value={row.regionId}>{row.region}</option>)}</select>
                <span>vs</span>
                <select value={compareB ?? ""} onChange={(event) => setCompareB(Number(event.target.value))}>{selectedRows.map((row) => <option key={row.regionId} value={row.regionId}>{row.region}</option>)}</select>
              </div>
              {compareRowA && compareRowB && <div className="task10-compare">{[compareRowA, compareRowB].map((row) => <div key={row.regionId}><b>{row.region}</b><span>Best buy: {row.bestBuy == null ? "—" : `${money.format(row.bestBuy)} ISK`}</span><span>Best sell: {row.bestSell == null ? "—" : `${money.format(row.bestSell)} ISK`}</span><span>Spread: {row.spreadPercent == null ? "—" : `${row.spreadPercent.toFixed(1)}%`}</span><span>Buy / sell orders: {whole.format(row.buyOrders)} / {whole.format(row.sellOrders)}</span><span>Demand / supply: {Number.isFinite(row.demandSupplyRatio) ? `${row.demandSupplyRatio.toFixed(2)}×` : "∞"}</span></div>)}</div>}
            </section>
            <section className="task10-card"><h4>Item insights</h4><ul>{insights.map((insight, index) => <li key={index}>{insight}</li>)}</ul></section>
          </div>

          <section className="task10-card">
            <h4>Current regional intelligence and trend</h4>
            <div className="task10-table">
              <div className="task10-row head"><span>Region</span><span>Best buy</span><span>Best sell</span><span>Spread</span><span>Buy orders</span><span>Sell orders</span><span>Sell trend</span></div>
              {historyRows.map(({ row, sellTrend }) => <div className="task10-row" key={row.regionId}><span><b>{row.region}</b></span><span>{row.bestBuy == null ? "—" : money.format(row.bestBuy)}</span><span>{row.bestSell == null ? "—" : money.format(row.bestSell)}</span><span>{row.spreadPercent == null ? "—" : `${row.spreadPercent.toFixed(1)}%`}</span><span>{whole.format(row.buyOrders)}</span><span>{whole.format(row.sellOrders)}</span><span>{trend(sellTrend)}</span></div>)}
            </div>
          </section>

          <div className="task10-columns">
            <section className="task10-card">
              <h4>Price, order and spread history</h4>
              <div className="task10-history">
                {history?.snapshots.length ? history.snapshots.map((snapshot) => {
                  const sells = snapshot.rows.map((row) => row.bestSell).filter((value): value is number => value != null);
                  const buys = snapshot.rows.map((row) => row.bestBuy).filter((value): value is number => value != null);
                  const avgSpread = average(snapshot.rows.map((row) => row.spreadPercent));
                  const orders = snapshot.rows.reduce((sum, row) => sum + row.buyOrders + row.sellOrders, 0);
                  return <div key={snapshot.createdAt}><b>{new Date(snapshot.createdAt).toLocaleString()}</b><span>{snapshot.rows.length} regions · {whole.format(orders)} orders represented</span><span>Sell {sells.length ? money.format(Math.min(...sells)) : "—"} · buy {buys.length ? money.format(Math.max(...buys)) : "—"} · avg spread {avgSpread == null ? "—" : `${avgSpread.toFixed(1)}%`}</span></div>;
                }) : <p>No retained full-market history contains this item yet.</p>}
              </div>
            </section>
            <section className="task10-card">
              <h4>Related items</h4>
              <div className="task10-related">{related.map((item) => <button key={item.typeId} onClick={() => void openItem(item.typeId, item.item)}><b>{item.item}</b><small>{item.marketGroup || item.group}</small></button>)}</div>
            </section>
          </div>

          <section className="task10-card task10-memory">
            <h4>Favourites, watchlist and recent items</h4>
            <div className="task10-memory-groups">
              <MemoryGroup title="Favourites" ids={memory.favourites} memory={memory} onOpen={openItem} />
              <MemoryGroup title="Watchlist" ids={memory.watchlist} memory={memory} onOpen={openItem} />
              <MemoryGroup title="Recent" ids={memory.recent} memory={memory} onOpen={openItem} />
            </div>
          </section>
        </>
      )}
    </section>
  );
}

function MemoryGroup({ title, ids, memory, onOpen }: { title: string; ids: number[]; memory: MarketMemory; onOpen(typeId: number, item?: string): Promise<void> }) {
  return <div><b>{title}</b>{ids.length ? ids.slice(0, 12).map((id) => <button key={id} onClick={() => void onOpen(id, memory.names[String(id)])}>{memory.names[String(id)] ?? `Type ${id}`}</button>) : <small>None yet</small>}</div>;
}
