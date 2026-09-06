import assert from 'node:assert/strict';
import fs from 'node:fs';
import { filterMcpRawMarketOrders, mcpMarketSecurityBand } from '../../dist-electron/mcp-raw-market-filter.js';

const order = (order_id, type_id, system_id) => ({
  duration: 90,
  is_buy_order: false,
  issued: '2026-09-04T00:00:00Z',
  location_id: 60000001,
  min_volume: 1,
  order_id,
  price: 1,
  range: 'region',
  system_id,
  type_id,
  volume_remain: 1,
  volume_total: 1,
});

const orders = [
  order(1, 34, 1001),
  order(2, 34, 1002),
  order(3, 35, 1001),
  order(4, 34, 1003),
];
const security = new Map([[1001, 0.94], [1002, 0.42], [1003, -0.1]]);
const lookup = async (systemId) => security.get(systemId) ?? null;

assert.equal(mcpMarketSecurityBand(0.94), 'high');
assert.equal(mcpMarketSecurityBand(0.42), 'low');
assert.equal(mcpMarketSecurityBand(-0.1), 'null');

const typeOnly = await filterMcpRawMarketOrders(orders, { typeId: 34 }, lookup);
assert.deepEqual(typeOnly.orders.map((value) => value.order_id), [1, 2, 4]);
assert.equal(typeOnly.totalOrders, 4);
assert.equal(typeOnly.filteredOrders, 3);

const systemOnly = await filterMcpRawMarketOrders(orders, { systemId: 1001 }, lookup);
assert.deepEqual(systemOnly.orders.map((value) => value.order_id), [1, 3]);

const high = await filterMcpRawMarketOrders(orders, { security: 'high' }, lookup);
assert.deepEqual(high.orders.map((value) => value.order_id), [1, 3]);

const ranged = await filterMcpRawMarketOrders(orders, { typeId: 34, minSecurity: 0.4, maxSecurity: 0.5 }, lookup);
assert.deepEqual(ranged.orders.map((value) => value.order_id), [2]);

await assert.rejects(() => filterMcpRawMarketOrders(orders, { minSecurity: 0.8, maxSecurity: 0.2 }, lookup), /minSecurity/);

const serverSource = fs.readFileSync(new URL('../../electron/mcp-server.ts', import.meta.url), 'utf8');
const registrationStart = serverSource.indexOf('server.registerTool("get_raw_market_region"');
assert.notEqual(registrationStart, -1, 'get_raw_market_region must stay registered');
const registrationEnd = serverSource.indexOf('server.registerTool(', registrationStart + 32);
const registration = serverSource.slice(registrationStart, registrationEnd < 0 ? undefined : registrationEnd);
for (const field of ['typeId', 'systemId', 'security', 'minSecurity', 'maxSecurity', 'offset', 'limit']) {
  assert.match(registration, new RegExp(`\\b${field}\\b`), `get_raw_market_region must expose ${field}`);
}
assert.match(registration, /filtering before pagination/i, 'tool description must promise pre-pagination filtering');

console.log('MCP raw market filter checks passed');
