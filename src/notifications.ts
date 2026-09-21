import type { SageNotificationRule, SageNotificationRuleInput } from "./types";

function metadataKey(rule: Pick<SageNotificationRuleInput, "metadata">) {
  const value = rule.metadata?.dedupeKey;
  return typeof value === "string" ? value : "";
}

export type MarketComparisonOperator = "any" | "lt" | "lte" | "gt" | "gte" | "eq";

export async function ensureNotificationRule(input: SageNotificationRuleInput): Promise<{ rule: SageNotificationRule; created: boolean }> {
  const dedupeKey = metadataKey(input);
  if (dedupeKey) {
    const existing = await window.sage.getNotificationRules();
    const match = existing.rules.find((rule) => metadataKey(rule) === dedupeKey && rule.enabled !== false);
    if (match) return { rule: match, created: false };
  }
  const created = await window.sage.createNotificationRule(input);
  return { rule: created.rule, created: true };
}


export function marketConditionNotification(input: {
  typeId: number;
  typeName: string;
  regionId: number;
  locationId?: number | null;
  side: "buy" | "sell";
  priceOperator: MarketComparisonOperator;
  priceValue?: number | null;
  volumeOperator: MarketComparisonOperator;
  volumeValue?: number | null;
  source: string;
  dedupeKey: string;
}): SageNotificationRuleInput {
  const symbols: Record<MarketComparisonOperator, string> = { any: "ANY", lt: "<", lte: "≤", gt: ">", gte: "≥", eq: "=" };
  const priceText = input.priceOperator === "any"
    ? "any price"
    : `price ${symbols[input.priceOperator]} ${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(Number(input.priceValue ?? 0))}`;
  const volumeText = input.volumeOperator === "any"
    ? "any volume"
    : `volume ${symbols[input.volumeOperator]} ${Math.max(0, Math.floor(Number(input.volumeValue ?? 0))).toLocaleString("en-GB")}`;
  return {
    kind: "market.custom_condition",
    label: `${input.typeName} · ${input.side.toUpperCase()} · ${priceText} · ${volumeText}`,
    enabled: true,
    repeatMode: "edge",
    target: {
      typeId: input.typeId,
      regionId: input.regionId,
      ...(input.locationId ? { locationId: input.locationId } : {}),
    },
    condition: {
      side: input.side,
      priceOperator: input.priceOperator,
      ...(input.priceOperator !== "any" ? { priceValue: Number(input.priceValue ?? 0) } : {}),
      volumeOperator: input.volumeOperator,
      ...(input.volumeOperator !== "any" ? { volumeValue: Math.max(0, Math.floor(Number(input.volumeValue ?? 0))) } : {}),
    },
    metadata: {
      source: input.source,
      dedupeKey: input.dedupeKey,
    },
  };
}

export function marketPriceNotification(input: {
  typeId: number;
  typeName: string;
  regionId: number;
  locationId?: number | null;
  side: "buy" | "sell";
  threshold: number;
  minVolume?: number;
  direction: "above" | "below";
  source: string;
  dedupeKey: string;
}): SageNotificationRuleInput {
  return {
    kind: input.direction === "above" ? "market.price_above" : "market.price_below",
    label: `${input.typeName} · ${input.side === "sell" ? "SELL" : "BUY"} ${input.direction === "below" ? "<" : ">"} ${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(input.threshold)} · ≥${Math.max(1, Math.floor(input.minVolume ?? 1)).toLocaleString("en-GB")} units`,
    enabled: true,
    repeatMode: "edge",
    target: {
      typeId: input.typeId,
      regionId: input.regionId,
      ...(input.locationId ? { locationId: input.locationId } : {}),
    },
    condition: {
      side: input.side,
      threshold: input.threshold,
      minVolume: Math.max(1, Math.floor(input.minVolume ?? 1)),
    },
    metadata: {
      source: input.source,
      dedupeKey: input.dedupeKey,
    },
  };
}

export function orderCompetitionNotification(input: {
  orderId: number;
  typeId: number;
  typeName: string;
  regionId: number;
  locationId: number;
  side: "buy" | "sell";
  orderPrice: number;
}): SageNotificationRuleInput {
  return {
    kind: "market.order_undercut",
    label: `${input.typeName} · ${input.side === "buy" ? "buy order" : "sell order"}`,
    enabled: true,
    repeatMode: "edge",
    target: {
      typeId: input.typeId,
      regionId: input.regionId,
      locationId: input.locationId,
      ownOrderId: input.orderId,
    },
    condition: {
      side: input.side,
      orderPrice: input.orderPrice,
    },
    metadata: {
      source: "order-desk",
      orderId: input.orderId,
      dedupeKey: `order-competition:${input.orderId}`,
    },
  };
}

export function contractBidNotification(input: {
  contractId: number;
  title: string;
}): SageNotificationRuleInput {
  return {
    kind: "contract.auction_bid",
    label: input.title || `Contract ${input.contractId}`,
    enabled: true,
    repeatMode: "change",
    target: { contractId: input.contractId },
    condition: {},
    metadata: {
      source: "contracts",
      contractId: input.contractId,
      dedupeKey: `contract-bids:${input.contractId}`,
    },
  };
}

export function notificationKindLabel(kind: string) {
  if (kind === "market.price_below") return "Price below";
  if (kind === "market.price_above") return "Price above";
  if (kind === "market.available") return "Market available";
  if (kind === "market.custom_condition") return "Custom market condition";
  if (kind === "market.order_undercut") return "Order competition";
  if (kind === "contract.auction_bid") return "Auction bid";
  return kind.replaceAll(".", " ");
}
