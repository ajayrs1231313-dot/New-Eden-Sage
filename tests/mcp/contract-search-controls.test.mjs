import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const server = await readFile(new URL('../../electron/mcp-server.ts', import.meta.url), 'utf8');
const search = await readFile(new URL('../../electron/mcp-contract-search.ts', import.meta.url), 'utf8');
const policy = await readFile(new URL('../../electron/mcp-ai-policy.ts', import.meta.url), 'utf8');

assert.match(server, /import \{ searchMcpContracts \} from "\.\/mcp-contract-search";/, 'MCP must use dedicated contract search adapter');
assert.match(server, /server\.registerTool\("search_public_contracts"/, 'MCP must register direct public-contract search');
for (const field of ['query','typeId','blueprintKind','fullyResearched','materialEfficiency','timeEfficiency','minPrice','maxPrice','regionId','systemQuery','locationQuery','contractType','standaloneOnly','originSystem','originSystemId','maxJumps','sort','offset','limit']) {
  assert.ok(server.includes(field + ':'), 'contract search schema must expose ' + field);
}
assert.match(search, /item\.isBlueprintCopy === true \? "bpc" : "bpo"/, 'missing is_blueprint_copy on researched originals must classify as BPO');
assert.match(search, /input\.fullyResearched \? 10/, 'fully researched search must force ME10');
assert.match(search, /input\.fullyResearched \? 20/, 'fully researched search must force TE20');
assert.match(search, /input\.standaloneOnly === true/, 'contract search must support standalone-only filtering');
assert.match(search, /searchNavigationSystems\(requested, 20\)/, 'contract search must resolve origin system names');
assert.match(search, /universeRoute\(origin\.systemId, systemId\)/, 'contract search must calculate jump distance');
assert.match(search, /loadSharedPublicContractsDataset\(\)/, 'contract search must use installed shared contract snapshot');
assert.match(policy, /search_public_contracts for item\/blueprint contract searches/i, 'AI policy must direct item/blueprint contract searches through dedicated search tool');

console.log('MCP contract search control checks passed');
