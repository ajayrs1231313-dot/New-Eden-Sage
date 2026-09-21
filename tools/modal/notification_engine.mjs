import { randomUUID } from "node:crypto";

export const NOTIFICATION_ENGINE_SCHEMA_VERSION = 1;

const evaluators = new Map();

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function bool(value) {
  return value === true;
}

function orderFields(order) {
  return {
    orderId: positiveInteger(order?.order_id ?? order?.orderId),
    typeId: positiveInteger(order?.type_id ?? order?.typeId),
    price: numeric(order?.price),
    volumeRemain: Math.max(0, Number(order?.volume_remain ?? order?.volumeRemain ?? 0) || 0),
    isBuy: Boolean(order?.is_buy_order ?? order?.isBuyOrder),
    locationId: positiveInteger(order?.location_id ?? order?.locationId),
    systemId: positiveInteger(order?.system_id ?? order?.systemId),
  };
}

function eventText(rule, title, message, data = {}) {
  return {
    eventId: `notification_${randomUUID()}`,
    requestId: String(rule.requestId),
    ruleVersion: Math.max(1, Number(rule.version || 1)),
    sageId: String(rule.sageId),
    kind: String(rule.kind),
    title,
    message,
    data: { ...data, notificationTarget: { ...(rule?.target || {}) } },
    triggeredAt: new Date().toISOString(),
  };
}

function sideFor(rule) {
  return String(rule?.condition?.side || rule?.target?.side || "sell").toLowerCase() === "buy" ? "buy" : "sell";
}

function thresholdFor(rule) {
  return numeric(rule?.condition?.threshold ?? rule?.condition?.price ?? rule?.target?.price);
}

function compareNumeric(value, operator, target) {
  if (operator === "any") return true;
  if (value == null || target == null) return false;
  if (operator === "lt") return value < target;
  if (operator === "lte") return value <= target;
  if (operator === "gt") return value > target;
  if (operator === "gte") return value >= target;
  if (operator === "eq") return value === target;
  return false;
}

async function exactMarketQuote(rule, context) {
  const typeId = positiveInteger(rule?.target?.typeId);
  const regionId = positiveInteger(rule?.target?.regionId);
  const locationId = positiveInteger(rule?.target?.locationId);
  if (!typeId || !regionId) return { available: false, price: null, volume: 0, qualifyingVolume: 0, orderId: null, error: "market_target_incomplete" };
  const kind = String(rule?.kind || "");
  let priceOperator = "any";
  let priceValue = null;
  if (kind === "market.price_below") {
    priceOperator = "lt";
    priceValue = thresholdFor(rule);
  } else if (kind === "market.price_above") {
    priceOperator = "gt";
    priceValue = thresholdFor(rule);
  } else if (kind === "market.custom_condition") {
    priceOperator = String(rule?.condition?.priceOperator || "any");
    priceValue = numeric(rule?.condition?.priceValue);
  }
  return context.marketQuote({
    regionId,
    typeId,
    locationId,
    side: sideFor(rule),
    ownOrderId: positiveInteger(rule?.target?.ownOrderId ?? rule?.target?.orderId),
    priceOperator,
    priceValue,
  });
}

export function registerNotificationEvaluator(kind, evaluator) {
  const key = String(kind || "").trim();
  if (!key) throw new Error("Notification evaluator kind is required.");
  if (typeof evaluator !== "function") throw new Error(`Notification evaluator for ${key} must be a function.`);
  evaluators.set(key, evaluator);
}

export function notificationEvaluatorKinds() {
  return [...evaluators.keys()].sort();
}

registerNotificationEvaluator("market.price_below", async (rule, state, context) => {
  const threshold = thresholdFor(rule);
  const minVolume = Math.max(1, positiveInteger(rule?.condition?.minVolume) ?? 1);
  const quote = await exactMarketQuote(rule, context);
  const matched = threshold != null && quote.price != null && quote.price < threshold && quote.qualifyingVolume >= minVolume;
  return {
    matched,
    fingerprint: quote.price == null ? "unavailable" : `${quote.price}:${quote.qualifyingVolume}`,
    value: quote.price,
    initialTrigger: true,
    event: matched ? eventText(
      rule,
      "Market price target hit",
      `${rule.label || `Type ${rule.target.typeId}`} is below ${threshold.toLocaleString("en-GB")} ISK with ${quote.qualifyingVolume.toLocaleString("en-GB")} qualifying units available.`,
      { threshold, minVolume, currentPrice: quote.price, side: sideFor(rule), ...quote },
    ) : null,
  };
});

registerNotificationEvaluator("market.price_above", async (rule, state, context) => {
  const threshold = thresholdFor(rule);
  const minVolume = Math.max(1, positiveInteger(rule?.condition?.minVolume) ?? 1);
  const quote = await exactMarketQuote(rule, context);
  const matched = threshold != null && quote.price != null && quote.price > threshold && quote.qualifyingVolume >= minVolume;
  return {
    matched,
    fingerprint: quote.price == null ? "unavailable" : `${quote.price}:${quote.qualifyingVolume}`,
    value: quote.price,
    initialTrigger: true,
    event: matched ? eventText(
      rule,
      "Market price target hit",
      `${rule.label || `Type ${rule.target.typeId}`} is above ${threshold.toLocaleString("en-GB")} ISK with ${quote.qualifyingVolume.toLocaleString("en-GB")} qualifying units available.`,
      { threshold, minVolume, currentPrice: quote.price, side: sideFor(rule), ...quote },
    ) : null,
  };
});

registerNotificationEvaluator("market.custom_condition", async (rule, state, context) => {
  const priceOperator = String(rule?.condition?.priceOperator || "any");
  const priceValue = numeric(rule?.condition?.priceValue);
  const volumeOperator = String(rule?.condition?.volumeOperator || "any");
  const volumeValue = numeric(rule?.condition?.volumeValue);
  const quote = await exactMarketQuote(rule, context);
  const priceMatched = priceOperator === "any"
    ? true
    : quote.qualifyingPrice != null && compareNumeric(quote.qualifyingPrice, priceOperator, priceValue);
  const volumeMatched = compareNumeric(quote.qualifyingVolume, volumeOperator, volumeValue);
  const matched = priceMatched && volumeMatched && (priceOperator === "any" ? volumeOperator !== "any" || quote.available : quote.qualifyingVolume > 0);
  const operatorText = { any: "any", lt: "<", lte: "≤", gt: ">", gte: "≥", eq: "=" };
  const side = sideFor(rule);
  const priceText = priceOperator === "any" ? "any price" : `price ${operatorText[priceOperator] ?? priceOperator} ${Number(priceValue ?? 0).toLocaleString("en-GB")} ISK`;
  const volumeText = volumeOperator === "any" ? "any volume" : `volume ${operatorText[volumeOperator] ?? volumeOperator} ${Number(volumeValue ?? 0).toLocaleString("en-GB")} units`;
  return {
    matched,
    fingerprint: `${quote.qualifyingPrice ?? "none"}:${quote.qualifyingVolume}`,
    value: quote.qualifyingPrice,
    initialTrigger: true,
    event: matched ? eventText(
      rule,
      "Custom market condition matched",
      `${rule.label || `Type ${rule.target.typeId}`} matched: ${side} orders, ${priceText}, ${volumeText}.`,
      { side, priceOperator, priceValue, volumeOperator, volumeValue, ...quote },
    ) : null,
  };
});

registerNotificationEvaluator("market.available", async (rule, state, context) => {
  const quote = await exactMarketQuote(rule, context);
  const maxPrice = numeric(rule?.condition?.maxPrice);
  const matched = quote.available && (maxPrice == null || (quote.price != null && quote.price <= maxPrice));
  return {
    matched,
    fingerprint: quote.available ? `${quote.price ?? "available"}:${quote.orderId ?? ""}` : "unavailable",
    value: quote.price,
    initialTrigger: true,
    event: matched ? eventText(
      rule,
      "Market item available",
      maxPrice == null
        ? `${rule.label || `Type ${rule.target.typeId}`} is available to ${sideFor(rule) === "buy" ? "sell into" : "buy"} now.`
        : `${rule.label || `Type ${rule.target.typeId}`} is available at or below ${maxPrice.toLocaleString("en-GB")} ISK.`,
      { maxPrice, currentPrice: quote.price, side: sideFor(rule), ...quote },
    ) : null,
  };
});

registerNotificationEvaluator("market.order_undercut", async (rule, state, context) => {
  const ownPrice = numeric(rule?.condition?.orderPrice ?? rule?.target?.orderPrice);
  const quote = await exactMarketQuote(rule, context);
  const side = sideFor(rule);
  const matched = ownPrice != null && quote.price != null && (side === "buy" ? quote.price > ownPrice : quote.price < ownPrice);
  return {
    matched,
    fingerprint: quote.price == null ? "clear" : `${quote.price}:${quote.orderId ?? ""}`,
    value: quote.price,
    initialTrigger: true,
    event: matched ? eventText(
      rule,
      side === "buy" ? "Buy order outbid" : "Sell order undercut",
      side === "buy"
        ? `${rule.label || `Type ${rule.target.typeId}`} has a competing buy at ${quote.price.toLocaleString("en-GB")} ISK above your ${ownPrice.toLocaleString("en-GB")} ISK order.`
        : `${rule.label || `Type ${rule.target.typeId}`} has a competing sell at ${quote.price.toLocaleString("en-GB")} ISK below your ${ownPrice.toLocaleString("en-GB")} ISK order.`,
      { ownPrice, competingPrice: quote.price, side, ...quote },
    ) : null,
  };
});

registerNotificationEvaluator("contract.auction_bid", async (rule, state, context) => {
  const contractId = positiveInteger(rule?.target?.contractId);
  if (!contractId) return { matched: false, fingerprint: "invalid", initialTrigger: false, event: null };
  const bids = await context.loadContractBids(contractId);
  const normalized = (Array.isArray(bids) ? bids : []).map((bid) => ({
    bidId: positiveInteger(bid?.bid_id ?? bid?.bidId),
    amount: numeric(bid?.amount) ?? 0,
    dateBid: String(bid?.date_bid ?? bid?.dateBid ?? ""),
  })).filter((bid) => bid.bidId);
  normalized.sort((left, right) => left.bidId - right.bidId);
  const highest = normalized.reduce((best, bid) => !best || bid.amount > best.amount ? bid : best, null);
  const fingerprint = normalized.length
    ? `${normalized.length}:${highest?.amount ?? 0}:${normalized.at(-1)?.bidId ?? 0}`
    : "0:0:0";
  const previousFingerprint = String(state?.lastFingerprint ?? "");
  const [previousCountRaw = "0", previousHighestRaw = "0"] = previousFingerprint.split(":");
  const previousCount = Math.max(0, Number(previousCountRaw) || 0);
  const previousHighest = Math.max(0, Number(previousHighestRaw) || 0);
  const currentHighest = highest?.amount ?? 0;
  const matched = Boolean(previousFingerprint && (normalized.length > previousCount || currentHighest > previousHighest));
  return {
    matched,
    fingerprint,
    value: highest?.amount ?? null,
    initialTrigger: false,
    event: matched ? eventText(
      rule,
      "Auction contract received a bid",
      highest
        ? `Contract ${contractId} now has ${normalized.length.toLocaleString("en-GB")} bid${normalized.length === 1 ? "" : "s"}; highest bid ${highest.amount.toLocaleString("en-GB")} ISK.`
        : `Contract ${contractId} bid state changed.`,
      { contractId, bidCount: normalized.length, highestBid: highest?.amount ?? null, latestBidId: normalized.at(-1)?.bidId ?? null },
    ) : null,
  };
});

function shouldTrigger(rule, state, evaluation) {
  if (!evaluation?.matched || state?.completed) return false;
  const repeatMode = String(rule.repeatMode || "").toLowerCase()
    || (rule.kind === "contract.auction_bid" ? "change" : "edge");
  const previousMatched = bool(state?.lastMatched);
  const previousFingerprint = state?.lastFingerprint == null ? null : String(state.lastFingerprint);
  const currentFingerprint = evaluation.fingerprint == null ? null : String(evaluation.fingerprint);

  if (repeatMode === "always") return true;
  if (repeatMode === "once") return !state?.triggerCount;
  if (repeatMode === "change") {
    if (previousFingerprint == null) return Boolean(evaluation.initialTrigger);
    return previousFingerprint !== currentFingerprint;
  }
  if (state?.lastMatched == null) return Boolean(evaluation.initialTrigger);
  return !previousMatched;
}

function nextState(rule, state, evaluation, triggered, evaluatedAt) {
  const repeatMode = String(rule.repeatMode || "").toLowerCase()
    || (rule.kind === "contract.auction_bid" ? "change" : "edge");
  return {
    requestId: String(rule.requestId),
    ruleVersion: Math.max(1, Number(rule.version || 1)),
    kind: String(rule.kind),
    lastMatched: Boolean(evaluation?.matched),
    lastFingerprint: evaluation?.fingerprint == null ? null : String(evaluation.fingerprint),
    lastValue: evaluation?.value ?? null,
    lastEvaluatedAt: evaluatedAt,
    lastTriggeredAt: triggered ? evaluatedAt : (state?.lastTriggeredAt ?? null),
    triggerCount: Math.max(0, Number(state?.triggerCount || 0)) + (triggered ? 1 : 0),
    completed: Boolean(state?.completed) || (triggered && repeatMode === "once"),
    lastError: evaluation?.error ? String(evaluation.error) : null,
  };
}

export async function evaluateNotificationRules({ rules, states = {}, loadRawRegion, loadContractBids, evaluatedAt = new Date().toISOString() }) {
  const sourceRules = Array.isArray(rules) ? rules : [];
  const events = [];
  const stateUpdates = [];
  const errors = [];
  let evaluated = 0;
  let unsupported = 0;

  const watchedTypesByRegion = new Map();
  for (const rule of sourceRules) {
    if (!rule || rule.enabled === false || !String(rule.kind || "").startsWith("market.")) continue;
    const regionId = positiveInteger(rule?.target?.regionId);
    const typeId = positiveInteger(rule?.target?.typeId);
    if (!regionId || !typeId) continue;
    let watched = watchedTypesByRegion.get(regionId);
    if (!watched) {
      watched = new Set();
      watchedTypesByRegion.set(regionId, watched);
    }
    watched.add(typeId);
  }

  const rawRegionCache = new Map();
  const regionTypeIndexCache = new Map();
  const marketBookCache = new Map();
  const marketQuoteCache = new Map();
  const contractBidCache = new Map();

  const loadIndexedRegion = async (regionId) => {
    const key = Number(regionId);
    if (!regionTypeIndexCache.has(key)) {
      regionTypeIndexCache.set(key, Promise.resolve().then(async () => {
        if (!rawRegionCache.has(key)) rawRegionCache.set(key, Promise.resolve().then(() => loadRawRegion(key)));
        const payload = await rawRegionCache.get(key);
        const orders = Array.isArray(payload?.orders) ? payload.orders : [];
        const watched = watchedTypesByRegion.get(key) ?? new Set();
        const index = new Map();
        for (const source of orders) {
          const order = orderFields(source);
          if (!order.typeId || !watched.has(order.typeId) || order.price == null || order.volumeRemain <= 0) continue;
          let typed = index.get(order.typeId);
          if (!typed) {
            typed = [];
            index.set(order.typeId, typed);
          }
          typed.push(order);
        }
        return index;
      }));
    }
    return regionTypeIndexCache.get(key);
  };

  const context = {
    marketQuote: async ({ regionId, typeId, locationId, side, ownOrderId, priceOperator = "any", priceValue = null }) => {
      const bookKey = [regionId, typeId, locationId ?? 0, side, ownOrderId ?? 0].join(":");
      if (!marketBookCache.has(bookKey)) {
        marketBookCache.set(bookKey, Promise.resolve().then(async () => {
          const index = await loadIndexedRegion(regionId);
          const buy = side === "buy";
          const orders = (index.get(typeId) ?? []).filter((order) => {
            if (order.isBuy !== buy) return false;
            if (locationId && order.locationId !== locationId) return false;
            if (ownOrderId && order.orderId === ownOrderId) return false;
            return true;
          }).sort((left, right) => left.price - right.price || right.volumeRemain - left.volumeRemain);
          let totalVolume = 0;
          const prefixVolume = [];
          for (const order of orders) {
            totalVolume += order.volumeRemain;
            prefixVolume.push(totalVolume);
          }
          return { orders, prefixVolume, totalVolume, best: buy ? (orders.at(-1) ?? null) : (orders[0] ?? null), buy };
        }));
      }

      const quoteKey = [bookKey, priceOperator ?? "any", priceValue ?? ""].join(":");
      if (!marketQuoteCache.has(quoteKey)) {
        marketQuoteCache.set(quoteKey, Promise.resolve().then(async () => {
          const book = await marketBookCache.get(bookKey);
          const orders = book.orders;
          const total = orders.length;
          const lowerBound = (target) => {
            let low = 0, high = total;
            while (low < high) {
              const middle = (low + high) >> 1;
              if (orders[middle].price < target) low = middle + 1;
              else high = middle;
            }
            return low;
          };
          const upperBound = (target) => {
            let low = 0, high = total;
            while (low < high) {
              const middle = (low + high) >> 1;
              if (orders[middle].price <= target) low = middle + 1;
              else high = middle;
            }
            return low;
          };
          const prefixAt = (index) => index > 0 ? book.prefixVolume[index - 1] : 0;
          let from = 0;
          let to = total;
          if (priceOperator !== "any" && priceValue != null) {
            const lo = lowerBound(priceValue);
            const hi = upperBound(priceValue);
            if (priceOperator === "lt") { from = 0; to = lo; }
            else if (priceOperator === "lte") { from = 0; to = hi; }
            else if (priceOperator === "gt") { from = hi; to = total; }
            else if (priceOperator === "gte") { from = lo; to = total; }
            else if (priceOperator === "eq") { from = lo; to = hi; }
          }
          const qualifyingVolume = Math.max(0, prefixAt(to) - prefixAt(from));
          const qualifyingOrder = from < to ? (book.buy ? orders[to - 1] : orders[from]) : null;
          const best = book.best;
          return {
            available: Boolean(best),
            price: best?.price ?? null,
            volume: book.totalVolume,
            qualifyingVolume,
            qualifyingPrice: qualifyingOrder?.price ?? null,
            qualifyingOrderId: qualifyingOrder?.orderId ?? null,
            orderId: best?.orderId ?? null,
            locationId: qualifyingOrder?.locationId ?? best?.locationId ?? locationId ?? null,
            systemId: qualifyingOrder?.systemId ?? best?.systemId ?? null,
          };
        }));
      }
      return marketQuoteCache.get(quoteKey);
    },
    loadContractBids: async (contractId) => {
      const key = Number(contractId);
      if (!contractBidCache.has(key)) contractBidCache.set(key, Promise.resolve().then(() => loadContractBids(key)));
      return contractBidCache.get(key);
    },
  };

  for (const rule of sourceRules) {
    if (!rule || rule.enabled === false || !rule.requestId || !rule.sageId || !rule.kind) continue;
    const evaluator = evaluators.get(String(rule.kind));
    if (!evaluator) {
      unsupported++;
      continue;
    }
    const state = states?.[String(rule.requestId)] ?? null;
    try {
      const evaluation = await evaluator(rule, state, context);
      const triggered = shouldTrigger(rule, state, evaluation);
      if (triggered && evaluation?.event) events.push(evaluation.event);
      stateUpdates.push(nextState(rule, state, evaluation, triggered, evaluatedAt));
      evaluated++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ requestId: String(rule.requestId), kind: String(rule.kind), error: message });
      stateUpdates.push({
        requestId: String(rule.requestId),
        ruleVersion: Math.max(1, Number(rule.version || 1)),
        kind: String(rule.kind),
        lastMatched: Boolean(state?.lastMatched),
        lastFingerprint: state?.lastFingerprint ?? null,
        lastValue: state?.lastValue ?? null,
        lastEvaluatedAt: evaluatedAt,
        lastTriggeredAt: state?.lastTriggeredAt ?? null,
        triggerCount: Math.max(0, Number(state?.triggerCount || 0)),
        completed: Boolean(state?.completed),
        lastError: message,
      });
    }
  }

  return {
    schemaVersion: NOTIFICATION_ENGINE_SCHEMA_VERSION,
    evaluatedAt,
    ruleCount: sourceRules.length,
    evaluated,
    unsupported,
    triggered: events.length,
    rawRegionsRead: rawRegionCache.size,
    marketBooksBuilt: marketBookCache.size,
    marketQuoteKeysEvaluated: marketQuoteCache.size,
    contractBidSourcesRead: contractBidCache.size,
    events,
    stateUpdates,
    errors,
  };
}
