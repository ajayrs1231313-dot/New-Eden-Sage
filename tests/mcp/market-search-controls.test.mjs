import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const server = await readFile(new URL('../../electron/mcp-server.ts', import.meta.url), 'utf8');
const search = await readFile(new URL('../../electron/mcp-market-search.ts', import.meta.url), 'utf8');
const policy = await readFile(new URL('../../electron/mcp-ai-policy.ts', import.meta.url), 'utf8');

assert.match(server, /import \{ searchMcpMarketOrders \} from "\.\/mcp-market-search";/, 'MCP must use dedicated market search adapter');
assert.match(server, /server\.registerTool\("search_market_orders"/, 'MCP must register direct market search');
for (const field of ['query','typeId','side','security','regionId','minPrice','maxPrice','minVolume','systemNames','systemQuery','locationQuery','originSystemId','maxJumps','sort','offset','limit']) {
  assert.ok(server.includes(field + ':'), 'market search schema must expose ' + field);
}
for (const sort of ['sell-lowest','buy-highest','price-low','price-high','volume','newest']) {
  assert.ok(server.includes('"' + sort + '"'), 'market search schema must expose sort ' + sort);
}
assert.match(server, /searchMcpMarketOrders\(input\)/, 'MCP market search must call dedicated adapter');
assert.match(search, /searchRawMarketOrders\(input\)/, 'adapter must preserve exact raw-order path');
assert.match(search, /loadSharedFullMarketAnalysisIndex\(\)/, 'adapter must fall back to installed shared generation');
assert.match(search, /regionalBest/, 'shared fallback must expose exact regional best-price signals');
assert.match(search, /completeOrderCoverage/, 'market search must report order-level coverage');
assert.match(policy, /use search_market_orders/i, 'AI policy must direct market order searches through the dedicated search tool');
assert.match(policy, /origin-system jump distance/i, 'AI policy must advertise distance-aware market searching');
assert.match(policy, /coverage field/i, 'AI policy must require coverage inspection');

console.log('MCP market search control checks passed');
