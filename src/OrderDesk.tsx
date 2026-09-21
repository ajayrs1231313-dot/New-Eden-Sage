import { useEffect, useMemo, useState } from "react";
import type { SVGProps } from "react";
import type { CharacterSnapshot } from "./types";
import { IskGlyph } from "./IskIcons";
import { ensureNotificationRule, orderCompetitionNotification } from "./notifications";
import "./custom-notifications.css";
import "./order-desk.css";

type OrderView = "buy" | "sell" | "history";
type OrderSort = "issued" | "item" | "price" | "remaining" | "value" | "expiry";
type OrderDeskDestination = "market" | "market-opportunities" | "contracts" | "opportunities" | "invention";

type CharacterMarketOrder = {
  duration?: number;
  escrow?: number;
  is_buy_order?: boolean;
  is_corporation?: boolean;
  issued?: string;
  location_id?: number;
  min_volume?: number;
  order_id?: number;
  price?: number;
  range?: string;
  region_id?: number;
  type_id?: number;
  volume_remain?: number;
  volume_total?: number;
};

type WalletTransaction = {
  transaction_id: number;
  journal_ref_id: number;
  date: string;
  is_buy: boolean;
  is_personal?: boolean;
  location_id: number;
  quantity: number;
  type_id: number;
  unit_price: number;
};

type DeskGlyphKind = "clock" | "settings" | "history" | "plus" | "pin" | "help" | "strategy" | "tax" | "wallet" | "arrow";

const money = (value: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);
const compactMoney = (value: number) => new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(value);

function DeskGlyph({ kind, ...props }: { kind: DeskGlyphKind } & SVGProps<SVGSVGElement>) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, focusable: false, ...props };
  switch (kind) {
    case "clock": return <svg {...common}><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>;
    case "settings": return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2.1-.7a7 7 0 0 0-.7-1.7l1-2-2.1-2.1-2 1a7 7 0 0 0-1.7-.7L10.5 2h-3l-.7 2.1a7 7 0 0 0-1.7.7l-2-1L1 5.9l1 2a7 7 0 0 0-.7 1.7L0 10.5v3l2.1.7a7 7 0 0 0 .7 1.7l-1 2L3.9 20l2-1a7 7 0 0 0 1.7.7l.9 2.3h3l.7-2.1a7 7 0 0 0 1.7-.7l2 1 2.1-2.1-1-2a7 7 0 0 0 .7-1.7L19 13.5Z" transform="translate(2 -0.2) scale(.83)"/></svg>;
    case "history": return <svg {...common}><path d="M4 6v5h5"/><path d="M5.7 7.2A8 8 0 1 1 4.5 16"/><path d="M12 8v5l3 2"/></svg>;
    case "plus": return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>;
    case "pin": return <svg {...common}><path d="M12 21s6-5.3 6-11a6 6 0 1 0-12 0c0 5.7 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/></svg>;
    case "help": return <svg {...common}><circle cx="12" cy="12" r="8"/><path d="M9.8 9a2.4 2.4 0 1 1 3.7 2c-1 .7-1.5 1.2-1.5 2.5M12 17h.01"/></svg>;
    case "strategy": return <svg {...common}><path d="M5 18h14M7 15V9M12 15V5M17 15v-3"/></svg>;
    case "tax": return <svg {...common}><circle cx="7" cy="7" r="2"/><circle cx="17" cy="17" r="2"/><path d="M18 5 6 19"/></svg>;
    case "wallet": return <svg {...common}><path d="M4 7h14a2 2 0 0 1 2 2v9H6a2 2 0 0 1-2-2V7Z"/><path d="M4 7V5h12M15 12h5"/><circle cx="16" cy="12" r=".7" fill="currentColor" stroke="none"/></svg>;
    case "arrow": return <svg {...common}><path d="m9 6 6 6-6 6"/></svg>;
  }
}

function orderExpiresAt(order: CharacterMarketOrder) {
  if (!order.issued || !order.duration) return null;
  const issued = new Date(order.issued).getTime();
  if (!Number.isFinite(issued)) return null;
  return new Date(issued + order.duration * 86_400_000);
}

function timeRemaining(order: CharacterMarketOrder) {
  const expiry = orderExpiresAt(order);
  if (!expiry) return "Expiry unavailable";
  const ms = expiry.getTime() - Date.now();
  if (ms <= 0) return "Expired / awaiting sync";
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days) return `${days}d ${hours % 24}h remaining`;
  return `${Math.max(1, hours)}h remaining`;
}

function locationLabel(snapshot: CharacterSnapshot, locationIdValue: number | undefined) {
  const locationId = Number(locationIdValue ?? 0);
  if (!locationId) return "Unknown location";
  if (locationId === snapshot.location.station_id || locationId === snapshot.location.structure_id) {
    return snapshot.location.place_name || snapshot.location.solar_system_name || `Location ${locationId}`;
  }
  const assets = Array.isArray((snapshot.extended as any)?.assets) ? (snapshot.extended as any).assets as any[] : [];
  const match = assets.find((asset) => Number(asset.root_location_id ?? asset.location_id) === locationId && (asset.station || asset.system));
  if (match?.station && match?.system) return `${match.station} - ${match.system}`;
  return match?.station || match?.system || `Location ${locationId}`;
}

function transactionValue(transaction: WalletTransaction) {
  return Math.max(0, Number(transaction.unit_price ?? 0)) * Math.max(0, Number(transaction.quantity ?? 0));
}

function recentTradeFlow(transactions: WalletTransaction[]) {
  const cutoff = Date.now() - 86_400_000;
  const recent = transactions.filter((transaction) => new Date(transaction.date).getTime() >= cutoff);
  const sells = recent.filter((transaction) => !transaction.is_buy).reduce((sum, transaction) => sum + transactionValue(transaction), 0);
  const buys = recent.filter((transaction) => transaction.is_buy).reduce((sum, transaction) => sum + transactionValue(transaction), 0);
  return { sells, buys };
}

export function OrderDesk({ snapshot, onNavigate }: { snapshot?: CharacterSnapshot; onNavigate?: (destination: OrderDeskDestination) => void }) {
  const [view, setView] = useState<OrderView>("buy");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<OrderSort>("issued");
  const [regionFilter, setRegionFilter] = useState("all");
  const [securityFilter, setSecurityFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [showCorporationOrders, setShowCorporationOrders] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deskModal, setDeskModal] = useState<{ title: string; points: string[]; kind: "guide" | "soon" } | null>(null);
  const [names, setNames] = useState<Record<number, string>>({});
  const [watchedOrderIds, setWatchedOrderIds] = useState<Set<number>>(() => new Set());
  const [alertStatus, setAlertStatus] = useState("");

  const orders = useMemo(() => Array.isArray(snapshot?.extended?.marketOrders)
    ? snapshot!.extended!.marketOrders as CharacterMarketOrder[]
    : [], [snapshot]);
  const transactions = useMemo(() => Array.isArray(snapshot?.extended?.walletTransactions)
    ? snapshot!.extended!.walletTransactions as WalletTransaction[]
    : [], [snapshot]);

  useEffect(() => {
    const ids = [...new Set([
      ...orders.map((order) => Number(order.type_id ?? 0)),
      ...transactions.map((transaction) => Number(transaction.type_id ?? 0)),
    ].filter((id) => id > 0 && !names[id]))];
    if (!ids.length) return;
    let cancelled = false;
    void window.sage.resolveTypeIds(ids).then((resolved) => {
      if (cancelled) return;
      setNames((current) => ({ ...current, ...Object.fromEntries(resolved.map((item) => [item.id, item.name])) }));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [orders, transactions, names]);
  useEffect(() => {
    let cancelled = false;
    void window.sage.getNotificationRules().then(({ rules }) => {
      if (cancelled) return;
      setWatchedOrderIds(new Set(rules.filter((rule) => rule.enabled !== false && rule.metadata?.source === "order-desk").map((rule) => Number(rule.metadata?.orderId ?? 0)).filter((id) => id > 0)));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [snapshot?.characterId]);

  async function watchOrder(order: CharacterMarketOrder) {
    const orderId = Number(order.order_id ?? 0);
    const typeId = Number(order.type_id ?? 0);
    const regionId = Number(order.region_id ?? 0);
    const locationId = Number(order.location_id ?? 0);
    const orderPrice = Number(order.price ?? 0);
    if (!orderId || !typeId || !regionId || !locationId || !orderPrice) {
      setAlertStatus("This order does not contain enough market data to create an alert.");
      return;
    }
    setAlertStatus("Creating server-side competition alert...");
    try {
      const created = await ensureNotificationRule(orderCompetitionNotification({
        orderId,
        typeId,
        typeName: names[typeId] ?? `Type ${typeId}`,
        regionId,
        locationId,
        side: order.is_buy_order ? "buy" : "sell",
        orderPrice,
      }));
      setWatchedOrderIds((current) => new Set([...current, orderId]));
      setAlertStatus(created.created
        ? `${names[typeId] ?? `Type ${typeId}`} is now watched for ${order.is_buy_order ? "outbids" : "undercuts"}.`
        : `That order alert is already active.`);
    } catch (caught) {
      setAlertStatus(caught instanceof Error ? caught.message.replace(/^Error invoking remote method .*?: Error: /, "") : "Could not create order alert.");
    }
  }

  if (!snapshot) {
    return <div className="market-no-results">Connect and sync a character to view personal market orders.</div>;
  }

  const buyOrders = orders.filter((order) => Boolean(order.is_buy_order));
  const sellOrders = orders.filter((order) => !order.is_buy_order);
  const activeOrders = view === "buy" ? buyOrders : sellOrders;
  const filteredForCorporation = activeOrders.filter((order) => showCorporationOrders || !order.is_corporation);
  const regionIds = [...new Set(orders.map((order) => Number(order.region_id ?? 0)).filter((value) => value > 0))].sort((a, b) => a - b);
  const locationOptions = [...new Map(orders.map((order) => [Number(order.location_id ?? 0), locationLabel(snapshot, order.location_id)])).entries()]
    .filter(([id]) => id > 0)
    .sort((a, b) => a[1].localeCompare(b[1]));

  const visibleOrders = filteredForCorporation
    .filter((order) => {
      const typeId = Number(order.type_id ?? 0);
      const location = locationLabel(snapshot, order.location_id);
      const haystack = `${names[typeId] ?? ""} ${typeId} ${location}`.toLowerCase();
      if (!haystack.includes(filter.trim().toLowerCase())) return false;
      if (regionFilter !== "all" && Number(order.region_id ?? 0) !== Number(regionFilter)) return false;
      if (locationFilter !== "all" && Number(order.location_id ?? 0) !== Number(locationFilter)) return false;
      if (securityFilter !== "all" && securityFilter !== "unknown") return false;
      return true;
    })
    .sort((a, b) => {
      if (sort === "item") return (names[Number(a.type_id ?? 0)] ?? "").localeCompare(names[Number(b.type_id ?? 0)] ?? "");
      if (sort === "price") return Number(b.price ?? 0) - Number(a.price ?? 0);
      if (sort === "remaining") return Number(b.volume_remain ?? 0) - Number(a.volume_remain ?? 0);
      if (sort === "value") return Number(b.price ?? 0) * Number(b.volume_remain ?? 0) - Number(a.price ?? 0) * Number(a.volume_remain ?? 0);
      if (sort === "expiry") return (orderExpiresAt(a)?.getTime() ?? Infinity) - (orderExpiresAt(b)?.getTime() ?? Infinity);
      return new Date(b.issued ?? 0).getTime() - new Date(a.issued ?? 0).getTime();
    });

  const visibleHistory = transactions
    .filter((transaction) => {
      const typeId = Number(transaction.type_id ?? 0);
      const location = locationLabel(snapshot, transaction.location_id);
      return `${names[typeId] ?? ""} ${typeId} ${location}`.toLowerCase().includes(filter.trim().toLowerCase())
        && (locationFilter === "all" || Number(transaction.location_id) === Number(locationFilter));
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const activeOrderValue = orders.reduce((sum, order) => sum + Number(order.price ?? 0) * Number(order.volume_remain ?? 0), 0);
  const totalEscrow = buyOrders.reduce((sum, order) => sum + Number(order.escrow ?? 0), 0);
  const tradeFlow = recentTradeFlow(transactions);
  const estimatedDailyProfit: number | null = orders.length === 0 ? 0 : null;
  const recentTransactions = [...transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 4);

  const selectedOrders = view === "history" ? [] : activeOrders;
  const selectedRemainingValue = selectedOrders.reduce((sum, order) => sum + Number(order.price ?? 0) * Number(order.volume_remain ?? 0), 0);

  const quickNavigate = (destination: OrderDeskDestination) => onNavigate?.(destination);

  const guidance = [
    {
      icon: "help" as const,
      title: "How buy orders work",
      sub: "Learn the basics",
      points: [
        "A buy order offers ISK for an item at the price you choose; sellers can fulfil it when their sale matches your order.",
        "As sellers fill the order, its remaining quantity decreases until the order is completed, expires or is cancelled in EVE.",
        "Order range controls where the order can be fulfilled, while escrow reserves funds against the order.",
        "Sage tracks your synced active orders, but creating or editing market orders is performed inside the EVE client.",
      ],
    },
    {
      icon: "strategy" as const,
      title: "Trading strategies",
      sub: "Tips for market trading",
      points: [
        "Station trading focuses on the spread between buy and sell orders in the same market hub.",
        "Regional spread trading and hauling can capture price differences between markets, but route time and risk matter.",
        "Balance margin against turnover: a smaller fast-moving margin can outperform a large spread on an item that rarely trades.",
        "Avoid low-volume traps, and use Sage Market Scanner and Opportunities to identify candidates worth investigating.",
      ],
    },
    {
      icon: "tax" as const,
      title: "Fees and taxes",
      sub: "Understand the costs",
      points: [
        "Broker fees apply when placing or modifying market orders, and sales tax is charged when a sale completes.",
        "Relevant skills and standings can reduce some trading costs where EVE applies those reductions.",
        "Thin-margin trades can become unprofitable after fees, so compare net profit rather than the headline spread.",
        "Sage profitability tools account for trading costs where the required character and market data is available.",
      ],
    },
    {
      icon: "wallet" as const,
      title: "Maximize your ISK",
      sub: "Advanced trading techniques",
      points: [
        "Favour liquidity as well as margin and avoid tying all of your capital into one slow order.",
        "Compare multiple regions, watch order competition and review stale orders that are no longer competitive.",
        "Spread capital across sensible opportunities so one bad or slow trade does not freeze your whole trading budget.",
        "Use Market Scanner, Contracts and Opportunities together to compare market, contract and route-based profit ideas.",
      ],
    },
  ];

  return (
    <section className="order-desk order-desk-reference">
      <header className="od-command-strip">
        <div className="od-command-identity">
          <div className="od-command-mark" aria-hidden="true"><IskGlyph name="coin" /></div>
          <div className="od-command-copy">
            <p className="eyebrow">ISK COMMAND</p>
            <h3>Order Desk <i aria-hidden="true" /></h3>
            <p>Manage your buy and sell orders with integrated market data.</p>
          </div>
        </div>
        <div className="od-kpis">
          <article><span className="od-kpi-icon"><IskGlyph name="orders" /></span><div><small>ACTIVE ORDERS</small><strong>{orders.length}</strong><em>{buyOrders.length} Buy · {sellOrders.length} Sell</em></div></article>
          <article><span className="od-kpi-icon"><IskGlyph name="pulse" /></span><div><small>TOTAL VOLUME</small><strong>{compactMoney(activeOrderValue)} ISK</strong><em>Across all orders</em></div></article>
          <article><span className="od-kpi-icon"><IskGlyph name="bars" /></span><div><small>EST. DAILY PROFIT</small><strong>{estimatedDailyProfit == null ? "—" : compactMoney(estimatedDailyProfit)}{estimatedDailyProfit == null ? "" : " ISK"}</strong><em>{estimatedDailyProfit == null ? "Needs closed trade basis" : "From active orders"}</em></div></article>
          <article><span className="od-kpi-icon"><IskGlyph name="coin" /></span><div><small>WALLET BALANCE</small><strong>{money(snapshot.wallet)} ISK</strong><em>Available to trade</em></div></article>
        </div>
      </header>

      <div className="od-order-nav">
        <div className="od-side-tabs" role="tablist" aria-label="Order Desk views">
          <button type="button" className={view === "buy" ? "active" : ""} onClick={() => setView("buy")}><IskGlyph name="cart" />Buy Orders</button>
          <button type="button" className={view === "sell" ? "active" : ""} onClick={() => setView("sell")}><IskGlyph name="cart" />Sell Orders</button>
          <button type="button" className={view === "history" ? "active" : ""} onClick={() => setView("history")}><DeskGlyph kind="history" />Order History</button>
        </div>
        <button type="button" className={`od-settings-button${settingsOpen ? " active" : ""}`} onClick={() => setSettingsOpen((value) => !value)}><DeskGlyph kind="settings" />Order Settings</button>
      </div>

      <div className="od-filterbar">
        <label className="od-search"><IskGlyph name="search" /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter item, type ID or location..." aria-label="Filter orders" /></label>
        <label className="od-select"><IskGlyph name="route" /><select value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)} aria-label="Filter region"><option value="all">All Regions</option>{regionIds.map((id) => <option key={id} value={id}>Region {id}</option>)}</select></label>
        <label className="od-select"><IskGlyph name="shield" /><select value={securityFilter} onChange={(event) => setSecurityFilter(event.target.value)} aria-label="Filter security"><option value="all">All Security</option><option value="unknown">Unknown Security</option><option value="high">High Security</option><option value="low">Low Security</option><option value="null">Null Security</option></select></label>
        <label className="od-select"><DeskGlyph kind="pin" /><select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} aria-label="Filter location"><option value="all">All Locations</option>{locationOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label className="od-select od-sort"><IskGlyph name="bars" /><select value={sort} onChange={(event) => setSort(event.target.value as OrderSort)} aria-label="Sort orders"><option value="issued">Newest first</option><option value="item">Item name</option><option value="price">Highest price</option><option value="remaining">Most units remaining</option><option value="value">Highest value</option><option value="expiry">Expiring first</option></select></label>
      </div>

      {settingsOpen && <div className="od-settings-panel"><label><input type="checkbox" checked={showCorporationOrders} onChange={(event) => setShowCorporationOrders(event.target.checked)} />Include corporation orders</label><span>Personal order data is read from the latest synced ESI snapshot; opening Order Desk does not trigger a refresh.</span></div>}

      {view !== "history" && visibleOrders.length === 0 ? (
        <div className="od-empty-state">
          <span className="od-empty-icon"><IskGlyph name="cart" /></span>
          <strong>{selectedOrders.length ? "No orders match these filters" : `No active ${view} orders`}</strong>
          <small>{selectedOrders.length ? "Adjust the search or filters to reveal synced orders." : `Create ${view} orders in EVE and they will appear here after the next character sync.`}</small>
        </div>
      ) : view === "history" ? (
        visibleHistory.length ? <div className="od-history-list">{visibleHistory.slice(0, 80).map((transaction) => <article key={transaction.transaction_id}><span className={transaction.is_buy ? "buy" : "sell"}>{transaction.is_buy ? "BUY" : "SELL"}</span><div><strong>{names[transaction.type_id] ?? `Type ${transaction.type_id}`}</strong><small>{locationLabel(snapshot, transaction.location_id)} · {new Date(transaction.date).toLocaleString()}</small></div><div><strong>{money(transaction.quantity)} × {money(transaction.unit_price)} ISK</strong><small>{money(transactionValue(transaction))} ISK total</small></div></article>)}</div> : <div className="od-empty-state"><span className="od-empty-icon"><DeskGlyph kind="history" /></span><strong>No recent order activity</strong><small>Your synced wallet transactions will appear here.</small></div>
      ) : (
        <div className="od-order-table">
          <div className="od-order-row heading"><span>Item</span><span>Price</span><span>Filled / remaining</span><span>{view === "buy" ? "Escrow" : "Remaining value"}</span><span>Location</span><span>Expires</span><span>Alert</span></div>
          {visibleOrders.map((order, index) => {
            const typeId = Number(order.type_id ?? 0);
            const total = Number(order.volume_total ?? order.volume_remain ?? 0);
            const remaining = Number(order.volume_remain ?? 0);
            const filled = Math.max(0, total - remaining);
            const price = Number(order.price ?? 0);
            const percent = total > 0 ? (filled / total) * 100 : 0;
            return <article className="od-order-row" key={order.order_id ?? `${typeId}:${index}`}><span><strong>{names[typeId] ?? (typeId ? `Type ${typeId}` : "Unknown item")}</strong><small>{view === "buy" ? String(order.range ?? "station") : "Sell order"} · ID {order.order_id ?? "—"}</small></span><span><strong>{money(price)} ISK</strong><small>{order.min_volume && order.min_volume > 1 ? `Min ${money(order.min_volume)}` : "Per unit"}</small></span><span><strong>{money(filled)} / {money(remaining)}</strong><small>{percent.toFixed(1)}% filled · {money(total)} total</small><i className="od-fill"><b style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></i></span><span><strong>{money(view === "buy" ? Number(order.escrow ?? 0) : price * remaining)} ISK</strong><small>{view === "buy" ? "Current escrow" : "At listed price"}</small></span><span><strong>{locationLabel(snapshot, order.location_id)}</strong><small>{order.is_corporation ? "Corporation order" : "Personal order"}</small></span><span><strong>{timeRemaining(order)}</strong><small>{orderExpiresAt(order)?.toLocaleString() ?? "—"}</small></span><span className="od-alert-cell"><button type="button" className={`sage-notify-button${watchedOrderIds.has(Number(order.order_id ?? 0)) ? " active" : ""}`} onClick={() => void watchOrder(order)}>🔔 {watchedOrderIds.has(Number(order.order_id ?? 0)) ? "Watching" : "Notify me"}</button><small>{order.is_buy_order ? "Outbid alert" : "Undercut alert"}</small></span></article>;
          })}
        </div>
      )}

      {alertStatus && <div className="od-alert-status" role="status">{alertStatus}</div>}

      <div className="od-lower-grid">
        <section className="od-panel quick">
          <header><span><IskGlyph name="route" />QUICK LINKS</span></header>
          <div className="od-quick-grid">
            <button type="button" onClick={() => quickNavigate("market")}><span><IskGlyph name="target" /></span><div><strong>Market Scanner</strong><small>Find items</small></div></button>
            <button type="button" onClick={() => quickNavigate("invention")}><span><IskGlyph name="invention" /></span><div><strong>Industry</strong><small>Production</small></div></button>
            <button type="button" onClick={() => quickNavigate("contracts")}><span><IskGlyph name="contract" /></span><div><strong>Contracts</strong><small>Trade contracts</small></div></button>
            <button type="button" onClick={() => quickNavigate("opportunities")}><span><IskGlyph name="route" /></span><div><strong>Opportunities</strong><small>Find profit</small></div></button>
          </div>
        </section>

        <section className="od-panel guidance">
          <header><span><DeskGlyph kind="help" />TRADING GUIDANCE</span><button type="button" onClick={() => setDeskModal({ title: guidance[0].title, points: guidance[0].points, kind: "guide" })}>View All</button></header>
          <div className="od-link-list">{guidance.map((item) => <button type="button" key={item.title} onClick={() => setDeskModal({ title: item.title, points: item.points, kind: "guide" })}><DeskGlyph kind={item.icon} /><span><strong>{item.title}</strong><small>{item.sub}</small></span><DeskGlyph kind="arrow" /></button>)}</div>
        </section>

        <section className="od-panel activity">
          <header><span><DeskGlyph kind="clock" />RECENT ACTIVITY</span><button type="button" onClick={() => setView("history")}>View All</button></header>
          {recentTransactions.length ? <div className="od-activity-list">{recentTransactions.map((transaction) => <button type="button" key={transaction.transaction_id} onClick={() => setView("history")}><span className={transaction.is_buy ? "buy" : "sell"}>{transaction.is_buy ? "B" : "S"}</span><div><strong>{names[transaction.type_id] ?? `Type ${transaction.type_id}`}</strong><small>{transaction.is_buy ? "Bought" : "Sold"} {money(transaction.quantity)} · {new Date(transaction.date).toLocaleDateString()}</small></div><em>{compactMoney(transactionValue(transaction))} ISK</em></button>)}</div> : <div className="od-activity-empty"><span><DeskGlyph kind="clock" /></span><strong>No recent activity</strong><small>Your market activity will appear here</small></div>}
        </section>

        <section className="od-panel amber">
          <header><span><IskGlyph name="pulse" />MARKET INSIGHTS</span><button type="button" onClick={() => quickNavigate("market-opportunities")}>View All</button></header>
          <div className="od-link-list">
            <button type="button" onClick={() => quickNavigate("market-opportunities")}><IskGlyph name="target" /><span><strong>Find Opportunities</strong><small>Discover profitable items</small></span><DeskGlyph kind="arrow" /></button>
            <button type="button" onClick={() => quickNavigate("market")}><IskGlyph name="bars" /><span><strong>Price History</strong><small>View historical data</small></span><DeskGlyph kind="arrow" /></button>
            <button type="button" onClick={() => quickNavigate("market")}><IskGlyph name="route" /><span><strong>Region Comparison</strong><small>Compare prices across regions</small></span><DeskGlyph kind="arrow" /></button>
            <button type="button" onClick={() => setDeskModal({ title: "Server Alerts", points: ["Alerts are live and evaluated on every server crunch.", "Use Notify me on any active order for undercut or outbid monitoring.", "Market Search also supports cheaper-price and better-buyer alerts, while auction contracts can be watched for new bids."], kind: "guide" })}><DeskGlyph kind="clock" /><span><strong>Server Alerts</strong><small>Undercuts, outbids and prices</small></span><DeskGlyph kind="arrow" /></button>
          </div>
        </section>
      </div>

      {deskModal && (
        <div className="od-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeskModal(null); }}>
          <section className={`od-modal ${deskModal.kind}`} role="dialog" aria-modal="true" aria-labelledby="od-modal-title">
            <header className="od-modal-head">
              <div><p className="eyebrow">{deskModal.kind === "soon" ? "ORDER DESK UPDATE" : "TRADING GUIDANCE"}</p><h3 id="od-modal-title">{deskModal.title}</h3></div>
              <button type="button" className="od-modal-x" onClick={() => setDeskModal(null)} aria-label="Close">×</button>
            </header>
            <div className="od-modal-body">
              {deskModal.kind === "soon" ? (
                <><strong className="od-coming-soon">{deskModal.points[0]}</strong><p>{deskModal.points[1]}</p></>
              ) : (
                <ul>{deskModal.points.map((point) => <li key={point}>{point}</li>)}</ul>
              )}
            </div>
            <footer className="od-modal-foot">
              {deskModal.kind === "guide" && <small><DeskGlyph kind="help" />More in-depth guides are coming soon.</small>}
              <button type="button" onClick={() => setDeskModal(null)}>Close</button>
            </footer>
          </section>
        </div>
      )}

      <footer className="od-status-line"><span><i />Local systems ready</span><em>{tradeFlow.sells || tradeFlow.buys ? `24h trade flow: ${compactMoney(tradeFlow.sells)} sold · ${compactMoney(tradeFlow.buys)} bought` : `Snapshot ${new Date(snapshot.updatedAt).toLocaleString()}`}</em><strong>{view === "history" ? `${visibleHistory.length} history rows` : `${visibleOrders.length} shown · ${compactMoney(selectedRemainingValue)} ISK remaining`}</strong></footer>
    </section>
  );
}
