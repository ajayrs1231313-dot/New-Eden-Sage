import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { effectiveMarketOriginId, sortMarketBuyRows } from "../../src/market-search-ordering.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const assets = read("src/AssetsCommand.tsx");
const market = read("src/GlobalMarketSearch.tsx");
const workspace = read("src/MarketWorkspaceV2.tsx");
const rawSearch = read("electron/raw-market-search.ts");
const mcpSearch = read("electron/mcp-market-search.ts");
const mainTask = read("electron/main-task9.ts");
const types = read("src/types.ts");

assert.match(market, /SELL FROM SOLAR SYSTEM/);
assert.match(market, /searchNavigationSystems\(needle,8\)/);
assert.match(market, /searchNavigationSystems\(needle,12\)/);
assert.match(market, /Origin: \{effectiveOriginName\|\|"Not available"\}/);

assert.equal(effectiveMarketOriginId(30000142, 30002510), 30000142, "manual origin must override character location");
assert.equal(effectiveMarketOriginId(null, 30002510), 30002510, "character location must be the fallback origin");
assert.equal(effectiveMarketOriginId(null, null), null, "distance search may remain origin-less when neither source exists");
assert.match(market, /requestedManual\?\.systemId\?\?characterOriginId/);

const nearby = sortMarketBuyRows([
  { id:"far-high", jumpsFromOrigin:8, price:125, volumeRemain:1000 },
  { id:"near-low", jumpsFromOrigin:2, price:105, volumeRemain:50 },
  { id:"near-high-shallow", jumpsFromOrigin:2, price:115, volumeRemain:25 },
  { id:"near-high-deep", jumpsFromOrigin:2, price:115, volumeRemain:500 },
], "nearest");
assert.deepEqual(nearby.map(row=>row.id), ["near-high-deep","near-high-shallow","near-low","far-high"], "nearest ranking must use jumps, then price descending, then useful remaining depth");
const highest = sortMarketBuyRows(nearby, "highest");
assert.equal(highest[0].id, "far-high", "highest-price ranking must remain available separately");

assert.match(market, /originSystemId,/);
assert.match(market, /maxJumps:originSystemId\?nullable\(maxJumps\):null/);
assert.match(rawSearch, /universeRoute\(originSystemId, systemId\)/);
assert.match(rawSearch, /maxJumps == null \|\| Number\(order\.jumpsFromOrigin \?\? 999\) <= maxJumps/);
assert.match(rawSearch, /sort === "distance"/);
assert.match(rawSearch, /Number\(a\.jumpsFromOrigin \?\? 999\) - Number\(b\.jumpsFromOrigin \?\? 999\)/);
assert.match(mcpSearch, /addJumpDistances\(candidateOrders, filters\.originSystemId, filters\.maxJumps/);
assert.match(mcpSearch, /sort === "distance"/);

assert.match(mainTask, /exact\?\.available \? exact : searchMcpMarketOrders\(searchInput\)/);
assert.match(mcpSearch, /loadSharedFullMarketAnalysisIndex\(\)/);
assert.match(mcpSearch, /source: "shared-prepared"/);
assert.match(mcpSearch, /candidateDepthPerSide/);
assert.match(types, /completeOrderCoverage: boolean/);
assert.match(types, /regionalBest\?: Array/);
assert.match(market, /BEST BUYERS BY REGION/);
assert.match(market, /Best prices near your sell-from system/);
assert.match(market, /displayMarketLocation/);
assert.match(market, /const routeEnabled=canExportRoute;/);
assert.match(market, /const eveEnabled=canExportEve;/);
assert.match(market, /Export to Route Planner/);
assert.match(market, /Add Destination in EVE/);
assert.match(market, /getNavigationSystem\(signal\.systemId\)/);
assert.match(mcpSearch, /bestBuyLocationId/);
assert.match(mcpSearch, /bestBuyLocationName/);
assert.match(types, /locationResolved: boolean/);
assert.doesNotMatch(market, /LIMITED DETAILED COVERAGE|Complete-source price|SOURCE DEPTH|DETAILED EXECUTABLE BUY ORDERS/);
assert.doesNotMatch(mcpSearch, /row\.locationName = "Unresolved market location"/);

assert.doesNotMatch(assets, /Sell from solar system/i);
assert.doesNotMatch(assets, /Find buyers/i);
assert.doesNotMatch(assets, /searchNavigationSystems|searchRawMarket|regionalBuySignals|assets-buyer|assets-origin/i);
assert.match(assets, /blueprintKind/);
assert.match(assets, /valuationSource/);

assert.match(market, /Nearest<\/button>/);
assert.match(market, /Highest price<\/button>/);
assert.match(market, /Add to Shopping List/);
assert.match(market, /openEveMarketType/);
assert.match(workspace, /Copy for EVE MultiBuy/);
assert.match(workspace, /Open in EVE/);
assert.match(types, /"newest" \| "distance"/);

console.log("Market Search manual-origin / nearest-buyers regression checks passed");
