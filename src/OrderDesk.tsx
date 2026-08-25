import { useEffect, useMemo, useState } from "react";
import type { CharacterSnapshot } from "./types";
import "./order-desk.css";

type OrderSide = "buy" | "sell";
type OrderSort = "issued" | "item" | "price" | "remaining" | "value" | "expiry";

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

const money = (value: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);
const compactMoney = (value: number) => new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(value);

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

function locationLabel(snapshot: CharacterSnapshot, order: CharacterMarketOrder) {
  const locationId = Number(order.location_id ?? 0);
  if (!locationId) return "Unknown location";
  if (locationId === snapshot.location.station_id || locationId === snapshot.location.structure_id) {
    return snapshot.location.place_name || snapshot.location.solar_system_name || `Location ${locationId}`;
  }
  const assets = Array.isArray((snapshot.extended as any)?.assets) ? (snapshot.extended as any).assets as any[] : [];
  const match = assets.find((asset) => Number(asset.root_location_id ?? asset.location_id) === locationId && (asset.station || asset.system));
  if (match?.station && match?.system) return `${match.station} - ${match.system}`;
  return match?.station || match?.system || `Location ${locationId}`;
}

export function OrderDesk({ snapshot }: { snapshot?: CharacterSnapshot }) {
  const [side, setSide] = useState<OrderSide>("buy");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<OrderSort>("issued");
  const [names, setNames] = useState<Record<number, string>>({});

  const orders = useMemo(() => Array.isArray(snapshot?.extended?.marketOrders)
    ? snapshot!.extended!.marketOrders as CharacterMarketOrder[]
    : [], [snapshot]);

  useEffect(() => {
    const ids = [...new Set(orders.map((order) => Number(order.type_id ?? 0)).filter((id) => id > 0 && !names[id]))];
    if (!ids.length) return;
    let cancelled = false;
    void window.sage.resolveTypeIds(ids).then((resolved) => {
      if (cancelled) return;
      setNames((current) => ({ ...current, ...Object.fromEntries(resolved.map((item) => [item.id, item.name])) }));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [orders, names]);

  if (!snapshot) {
    return <div className="market-no-results">Connect and sync a character to view personal market orders.</div>;
  }

  const buyOrders = orders.filter((order) => Boolean(order.is_buy_order));
  const sellOrders = orders.filter((order) => !order.is_buy_order);
  const selectedOrders = side === "buy" ? buyOrders : sellOrders;
  const totalRemainingValue = selectedOrders.reduce((sum, order) => sum + Number(order.price ?? 0) * Number(order.volume_remain ?? 0), 0);
  const totalOriginalValue = selectedOrders.reduce((sum, order) => sum + Number(order.price ?? 0) * Number(order.volume_total ?? order.volume_remain ?? 0), 0);
  const totalEscrow = buyOrders.reduce((sum, order) => sum + Number(order.escrow ?? 0), 0);
  const filledUnits = selectedOrders.reduce((sum, order) => sum + Math.max(0, Number(order.volume_total ?? 0) - Number(order.volume_remain ?? 0)), 0);
  const originalUnits = selectedOrders.reduce((sum, order) => sum + Number(order.volume_total ?? 0), 0);
  const completion = originalUnits > 0 ? (filledUnits / originalUnits) * 100 : 0;

  const visibleOrders = selectedOrders
    .filter((order) => {
      const typeId = Number(order.type_id ?? 0);
      const haystack = `${names[typeId] ?? ""} ${typeId} ${locationLabel(snapshot, order)}`.toLowerCase();
      return haystack.includes(filter.trim().toLowerCase());
    })
    .sort((a, b) => {
      if (sort === "item") return (names[Number(a.type_id ?? 0)] ?? "").localeCompare(names[Number(b.type_id ?? 0)] ?? "");
      if (sort === "price") return Number(b.price ?? 0) - Number(a.price ?? 0);
      if (sort === "remaining") return Number(b.volume_remain ?? 0) - Number(a.volume_remain ?? 0);
      if (sort === "value") return Number(b.price ?? 0) * Number(b.volume_remain ?? 0) - Number(a.price ?? 0) * Number(a.volume_remain ?? 0);
      if (sort === "expiry") return (orderExpiresAt(a)?.getTime() ?? Infinity) - (orderExpiresAt(b)?.getTime() ?? Infinity);
      return new Date(b.issued ?? 0).getTime() - new Date(a.issued ?? 0).getTime();
    });

  return (
    <section className="order-desk">
      <header className="order-desk-head">
        <div>
          <p className="eyebrow">PERSONAL MARKET ORDERS</p>
          <h3>Order Desk</h3>
          <p>Active orders from {snapshot.character.name}&apos;s synced ESI snapshot. Opening this page never triggers a market refresh.</p>
        </div>
        <div className="order-desk-total"><span>{side === "buy" ? "Capital committed" : "Remaining ask value"}</span><strong>{compactMoney(side === "buy" ? totalEscrow : totalRemainingValue)} ISK</strong><small>{selectedOrders.length} active {side} order{selectedOrders.length === 1 ? "" : "s"}</small></div>
      </header>

      <div className="order-desk-subtabs" role="tablist" aria-label="Order Desk order side">
        <button type="button" className={side === "buy" ? "active" : ""} onClick={() => setSide("buy")}>Buy Orders <span>{buyOrders.length}</span></button>
        <button type="button" className={side === "sell" ? "active" : ""} onClick={() => setSide("sell")}>Sell Orders <span>{sellOrders.length}</span></button>
      </div>

      <div className="order-desk-summary">
        <article><span>Active orders</span><strong>{selectedOrders.length}</strong><small>{side === "buy" ? `${money(totalEscrow)} ISK escrow` : `${money(totalRemainingValue)} ISK still listed`}</small></article>
        <article><span>Order progress</span><strong>{completion.toFixed(1)}%</strong><small>{money(filledUnits)} of {money(originalUnits)} units filled</small></article>
        <article><span>Remaining value</span><strong>{compactMoney(totalRemainingValue)} ISK</strong><small>Price × remaining volume</small></article>
        <article><span>Original value</span><strong>{compactMoney(totalOriginalValue)} ISK</strong><small>At current order prices</small></article>
      </div>

      <div className="order-desk-tools">
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter item or location..." aria-label="Filter market orders" />
        <select value={sort} onChange={(event) => setSort(event.target.value as OrderSort)} aria-label="Sort market orders">
          <option value="issued">Newest first</option>
          <option value="item">Item name</option>
          <option value="price">Highest price</option>
          <option value="remaining">Most units remaining</option>
          <option value="value">Highest remaining value</option>
          <option value="expiry">Expiring first</option>
        </select>
        <small>{visibleOrders.length} shown - snapshot {new Date(snapshot.updatedAt).toLocaleString()}</small>
      </div>

      {visibleOrders.length ? (
        <div className="order-desk-table">
          <div className="order-desk-row heading"><span>Item</span><span>Price</span><span>Filled / remaining</span><span>{side === "buy" ? "Escrow" : "Remaining value"}</span><span>Location</span><span>Expires</span></div>
          {visibleOrders.map((order, index) => {
            const typeId = Number(order.type_id ?? 0);
            const total = Number(order.volume_total ?? order.volume_remain ?? 0);
            const remaining = Number(order.volume_remain ?? 0);
            const filled = Math.max(0, total - remaining);
            const price = Number(order.price ?? 0);
            const percent = total > 0 ? (filled / total) * 100 : 0;
            return (
              <article className="order-desk-row" key={order.order_id ?? `${typeId}:${index}`}>
                <span><strong>{names[typeId] ?? (typeId ? `Type ${typeId}` : "Unknown item")}</strong><small>{side === "buy" ? String(order.range ?? "station") : "Sell order"} - ID {order.order_id ?? "—"}</small></span>
                <span><strong>{money(price)} ISK</strong><small>{order.min_volume && order.min_volume > 1 ? `Min ${money(order.min_volume)}` : "Per unit"}</small></span>
                <span><strong>{money(filled)} / {money(remaining)}</strong><small>{percent.toFixed(1)}% filled - {money(total)} total</small><i className="order-fill"><b style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></i></span>
                <span><strong>{money(side === "buy" ? Number(order.escrow ?? 0) : price * remaining)} ISK</strong><small>{side === "buy" ? "Current escrow" : "At listed price"}</small></span>
                <span><strong>{locationLabel(snapshot, order)}</strong><small>{order.is_corporation ? "Corporation order" : "Personal order"}</small></span>
                <span><strong>{timeRemaining(order)}</strong><small>{orderExpiresAt(order)?.toLocaleString() ?? "—"}</small></span>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="market-no-results">{selectedOrders.length ? "No orders match this filter." : `No active ${side} orders in the latest synced character snapshot.`}</div>
      )}
    </section>
  );
}
