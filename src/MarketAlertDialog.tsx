import { useMemo, useState } from "react";
import type { RawMarketSearchOrder } from "./types";
import { ensureNotificationRule, marketConditionNotification, type MarketComparisonOperator } from "./notifications";
import "./custom-notifications.css";

const formatNumber = (value: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(value);
const OP_LABELS: Record<MarketComparisonOperator, string> = {
  any: "Any",
  lt: "Below (<)",
  lte: "At or below (≤)",
  gt: "Above (>)",
  gte: "At or above (≥)",
  eq: "Exactly (=)",
};

function locationLabel(order: RawMarketSearchOrder) {
  const value = String(order.locationName ?? "").trim();
  return value && !/^Unresolved market location$/i.test(value) ? value : order.systemName;
}

function conditionPhrase(operator: MarketComparisonOperator, value: number, unit: string) {
  if (operator === "any") return `any ${unit}`;
  const symbol = operator === "lt" ? "<" : operator === "lte" ? "≤" : operator === "gt" ? ">" : operator === "gte" ? "≥" : "=";
  return `${symbol} ${formatNumber(value)} ${unit}`;
}

export function MarketAlertDialog({
  order,
  onClose,
  onCreated,
}: {
  order: RawMarketSearchOrder;
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const [side, setSide] = useState<"buy" | "sell">(order.side);
  const [priceOperator, setPriceOperator] = useState<MarketComparisonOperator>(order.side === "sell" ? "lt" : "gt");
  const [price, setPrice] = useState(String(order.price));
  const [volumeOperator, setVolumeOperator] = useState<MarketComparisonOperator>("gte");
  const [volume, setVolume] = useState("1");
  const [scope, setScope] = useState<"location" | "region">("location");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const priceValue = Number(price.replace(/,/g, ""));
  const volumeValue = Math.floor(Number(volume.replace(/,/g, "")));
  const priceValid = priceOperator === "any" || (Number.isFinite(priceValue) && priceValue >= 0);
  const volumeValid = volumeOperator === "any" || (Number.isFinite(volumeValue) && volumeValue >= 0);
  const valid = priceValid && volumeValid && !(priceOperator === "any" && volumeOperator === "any");
  const scopeName = scope === "location" ? locationLabel(order) : order.regionName;

  const summary = useMemo(() => {
    if (!valid) {
      if (priceOperator === "any" && volumeOperator === "any") return "Choose at least one price or volume condition.";
      return "Enter valid values for the active conditions.";
    }
    const sideText = side === "sell" ? "sell orders" : "buy orders";
    const priceText = conditionPhrase(priceOperator, priceValue, "ISK");
    const volumeText = volumeOperator === "any"
      ? "any qualifying volume"
      : conditionPhrase(volumeOperator, volumeValue, "units");
    return `Notify when ${sideText} match ${priceText} and the qualifying volume is ${volumeText} in ${scopeName}.`;
  }, [priceOperator, priceValue, scopeName, side, valid, volumeOperator, volumeValue]);

  async function save() {
    if (!valid) return;
    setBusy(true);
    setError("");
    try {
      const scopedLocationId = scope === "location" ? order.locationId : null;
      const result = await ensureNotificationRule(marketConditionNotification({
        typeId: order.typeId,
        typeName: order.typeName,
        regionId: order.regionId,
        locationId: scopedLocationId,
        side,
        priceOperator,
        priceValue: priceOperator === "any" ? null : priceValue,
        volumeOperator,
        volumeValue: volumeOperator === "any" ? null : volumeValue,
        source: "market-search",
        dedupeKey: [
          "market-custom",
          side,
          order.typeId,
          order.regionId,
          scopedLocationId ?? "region",
          priceOperator,
          priceOperator === "any" ? "any" : priceValue,
          volumeOperator,
          volumeOperator === "any" ? "any" : volumeValue,
        ].join(":"),
      }));
      onCreated(result.created ? `Custom alert armed for ${order.typeName}.` : "That exact market alert is already active.");
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message.replace(/^Error invoking remote method .*?: Error: /, "") : "Could not create market alert.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="market-alert-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`market-alert-dialog ${side}`} role="dialog" aria-modal="true" aria-labelledby="market-alert-title">
      <header>
        <div>
          <p className="eyebrow">CUSTOM MARKET NOTIFICATION</p>
          <h3 id="market-alert-title">Build market alert</h3>
          <span>{order.typeName}</span>
        </div>
        <button type="button" className="market-alert-close" onClick={onClose} aria-label="Close">×</button>
      </header>

      <div className="market-alert-current">
        <span><small>CLICKED ORDER</small><strong>{order.side.toUpperCase()}</strong></span>
        <span><small>CURRENT PRICE</small><strong>{formatNumber(order.price)} ISK</strong></span>
        <span><small>ORDER VOLUME</small><strong>{order.volumeRemain.toLocaleString("en-GB")} units</strong></span>
        <span><small>LOCATION</small><strong>{locationLabel(order)}</strong></span>
      </div>

      <div className="market-alert-fields custom-builder">
        <label>
          <span>ORDER SIDE</span>
          <select value={side} onChange={(event) => setSide(event.target.value as "buy" | "sell")}>
            <option value="sell">Sell orders</option>
            <option value="buy">Buy orders</option>
          </select>
        </label>

        <label>
          <span>PRICE CONDITION</span>
          <select value={priceOperator} onChange={(event) => setPriceOperator(event.target.value as MarketComparisonOperator)}>
            {(Object.keys(OP_LABELS) as MarketComparisonOperator[]).map((operator) => <option value={operator} key={operator}>{OP_LABELS[operator]}</option>)}
          </select>
        </label>

        <label>
          <span>PRICE VALUE</span>
          <div className="market-alert-number">
            <input type="number" min="0" step="any" value={price} disabled={priceOperator === "any"} onChange={(event) => setPrice(event.target.value)} />
            <em>ISK</em>
          </div>
        </label>

        <label>
          <span>VOLUME CONDITION</span>
          <select value={volumeOperator} onChange={(event) => setVolumeOperator(event.target.value as MarketComparisonOperator)}>
            {(Object.keys(OP_LABELS) as MarketComparisonOperator[]).map((operator) => <option value={operator} key={operator}>{OP_LABELS[operator]}</option>)}
          </select>
        </label>

        <label>
          <span>VOLUME VALUE</span>
          <div className="market-alert-number">
            <input type="number" min="0" step="1" value={volume} disabled={volumeOperator === "any"} onChange={(event) => setVolume(event.target.value)} />
            <em>UNITS</em>
          </div>
        </label>

        <label>
          <span>SCOPE</span>
          <select value={scope} onChange={(event) => setScope(event.target.value as "location" | "region")}>
            <option value="location">This station / structure</option>
            <option value="region">Anywhere in {order.regionName}</option>
          </select>
        </label>
      </div>

      <div className="market-alert-summary">
        <strong>ALERT CONDITION</strong>
        <p>{summary}</p>
      </div>

      {error && <div className="market-alert-error">{error}</div>}

      <footer>
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="primary" disabled={!valid || busy} onClick={() => void save()}>{busy ? "Saving..." : "Create alert"}</button>
      </footer>
    </section>
  </div>;
}
