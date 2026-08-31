const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const market = read('electron/market.ts');
const intelligence = read('electron/market-intelligence.ts');
const main = read('electron/main-task9.ts');
const manager = read('electron/contract-intelligence-manager.ts');
const processSource = read('electron/contract-intelligence-process.ts');
const worker = read('tools/modal/public_data_worker.mjs');
const iskLab = read('src/IskLab.tsx');
const contracts = read('src/MarketContracts.tsx');

assert.doesNotMatch(market, /contracts\/public\//, 'desktop market code must not crawl public contract ESI');
assert.match(worker, /refreshPublicContracts\(regions\)/, 'Modal worker must prepare public contracts');
assert.match(worker, /public-contracts-v1\.json\.gz/, 'Modal worker must publish a contract artifact');
assert.match(intelligence, /loadSharedPublicContractsDataset\(\)/, 'contract intelligence must consume the downloaded shared artifact');
assert.doesNotMatch(intelligence, /loadLatestMarketDatasetByMode\("contracts"\)/, 'contract intelligence must not fall back to legacy machine datasets');
assert.match(manager, /fork\(path\.join\(__dirname, "contract-intelligence-process\.js"\)/, 'contracts must run in a dedicated child process');
assert.match(processSource, /getContractMarketIntelligence\(\)/, 'heavy contract analysis must execute in the dedicated contract process');
assert.match(main, /market:contract-workspace[^\n]+getContractMarketWorkspace\(/, 'renderer IPC must use the off-main contract workspace path');
assert.match(main, /market:contract-search[^\n]+searchContractMarketWorkspace\(/, 'contract filtering/search must remain off the renderer/main hot path');
assert.match(contracts, /window\.sage\.checkPublicData\(\)/, 'manual contract refresh must use the shared server data pull');
assert.match(iskLab, /contractsVisited/, 'Contracts must remain mounted after first visit');
assert.match(iskLab, /hidden=\{tab !== "contracts"\}/, 'leaving Contracts must hide rather than unmount its workspace');

console.log('contracts-server-background: ok');
