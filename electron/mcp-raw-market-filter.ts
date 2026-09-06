import type { MarketOrder } from "./market";
import { displayedSecurityStatus, getNavigationSystem } from "./universe-route-graph";

export type McpMarketSecurityBand = "high" | "low" | "null";

export type McpRawMarketOrderFilterOptions = {
  typeId?: number;
  systemId?: number;
  security?: McpMarketSecurityBand;
  minSecurity?: number;
  maxSecurity?: number;
};

type SecurityLookup = (systemId: number) => Promise<number | null>;

const defaultSecurityLookup: SecurityLookup = async (systemId) => {
  const system = await getNavigationSystem(systemId);
  return system?.securityStatus ?? null;
};

export function mcpMarketSecurityBand(rawSecurity: number): McpMarketSecurityBand {
  const displayed = displayedSecurityStatus(rawSecurity);
  return displayed >= 0.5 ? "high" : displayed > 0 ? "low" : "null";
}

export async function filterMcpRawMarketOrders(
  orders: MarketOrder[],
  options: McpRawMarketOrderFilterOptions = {},
  securityLookup: SecurityLookup = defaultSecurityLookup,
) {
  const typeId = Number(options.typeId ?? 0);
  const systemId = Number(options.systemId ?? 0);
  const minSecurity = options.minSecurity == null ? null : displayedSecurityStatus(options.minSecurity);
  const maxSecurity = options.maxSecurity == null ? null : displayedSecurityStatus(options.maxSecurity);
  if (minSecurity != null && maxSecurity != null && minSecurity > maxSecurity)
    throw new Error("minSecurity cannot be greater than maxSecurity.");

  let filtered = orders.filter((order) => {
    if (typeId > 0 && order.type_id !== typeId) return false;
    if (systemId > 0 && order.system_id !== systemId) return false;
    return true;
  });

  const needsSecurity = options.security != null || minSecurity != null || maxSecurity != null;
  if (needsSecurity && filtered.length) {
    const systemIds = [...new Set(filtered.map((order) => order.system_id))];
    const entries = await Promise.all(systemIds.map(async (id) => [id, await securityLookup(id)] as const));
    const securityBySystem = new Map(entries);
    filtered = filtered.filter((order) => {
      const rawSecurity = securityBySystem.get(order.system_id);
      if (rawSecurity == null) return false;
      const displayed = displayedSecurityStatus(rawSecurity);
      if (options.security && mcpMarketSecurityBand(rawSecurity) !== options.security) return false;
      if (minSecurity != null && displayed < minSecurity - 1e-9) return false;
      if (maxSecurity != null && displayed > maxSecurity + 1e-9) return false;
      return true;
    });
  }

  return {
    orders: filtered,
    totalOrders: orders.length,
    filteredOrders: filtered.length,
    filters: {
      typeId: options.typeId ?? null,
      systemId: options.systemId ?? null,
      security: options.security ?? null,
      minSecurity,
      maxSecurity,
    },
  };
}
