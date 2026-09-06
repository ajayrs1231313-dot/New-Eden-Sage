import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const server = await readFile(new URL('../../electron/mcp-server.ts', import.meta.url), 'utf8');
const policy = await readFile(new URL('../../electron/mcp-ai-policy.ts', import.meta.url), 'utf8');

assert.match(server, /loadMcpMarketRegionSummaries/,
  'MCP market region listing must use the bounded shared regional artifact reader');
assert.doesNotMatch(server, /loadSharedMarketBrowserSummaries/,
  'MCP must not inflate the desktop full-market browser graph just to list regions');
const mcpReader = await readFile(new URL('../../electron/mcp-market-reader.ts', import.meta.url), 'utf8');
assert.match(mcpReader, /createInterface/, 'MCP regional reads must stream the shared regional artifact');
assert.doesNotMatch(mcpReader, /loadSharedFullMarketAnalysisIndex/, 'MCP regional reads must not load the full global market graph');
const statusStart = server.indexOf('async function marketDatasetStatus()');
const statusEnd = server.indexOf('export async function startMcpServer()', statusStart);
const statusBody = server.slice(statusStart, statusEnd);
assert.doesNotMatch(statusBody, /loadSharedPreparedTradeDataset|loadSharedPreparedShortageDataset|loadSharedPublicContractsDataset/,
  'dataset status must report prepared coverage from manifest metadata instead of inflating large prepared datasets');
assert.match(server, /loadCurrentSharedMarketManifest/,
  'MCP dataset status must report the active shared market generation');
assert.match(server, /rawOrdersAvailable:\s*false/,
  'shared market fallback must distinguish prepared regional depth from a complete raw order file');

for (const tool of [
  'list_market_regions',
  'get_market_region',
  'get_raw_market_region',
  'get_market_dataset_status',
  'get_market_trade_opportunities',
  'get_market_shortages',
  'get_public_contracts',
  'list_public_data_sources',
  'get_public_data_source',
  'list_prepared_page_states',
  'get_prepared_page_state',
  'list_sage_data_domains',
  'get_sage_data_domain',
  'search_navigation_systems',
  'get_navigation_system',
  'get_navigation_neighbours',
  'calculate_navigation_route',
  'get_wormhole_reference',
  'get_wormhole_command_state',
]) {
  assert.ok(server.includes(`server.registerTool("${tool}"`), `expected MCP tool ${tool}`);
}

assert.match(server, /readPlanetaryPlans/, 'MCP complete Sage export must include persisted Planetary Industry state');
assert.match(server, /readProfitLedger/, 'MCP complete Sage export must include Profit & Loss ledger state');
assert.match(server, /readFoundryProjects/, 'MCP complete Sage export must include Project Foundry state');
assert.match(server, /calculateNavigationRoute/, 'MCP must expose the same Navigation route engine used by the app');
assert.match(server, /getWormholeReference/, 'MCP must expose Sage wormhole reference data');
assert.match(server, /PAGE_STATE_CACHE_KIND/,
  'MCP must discover prepared page intelligence through the shared persistence layer');
assert.match(policy, /must use the same installed server-managed generation as the desktop app/,
  'AI policy must direct market questions to the shared generation');
assert.match(policy, /list_prepared_page_states/,
  'AI policy must advertise generic prepared-page discovery for app-wide derived intelligence');

console.log('MCP data coverage regression checks passed');
