const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

const dayTrader = read("src/MarketDayTrader.tsx");
assert.match(dayTrader, /function isWithinJumpLimit\(jumps: unknown, maxJumps: number \| null\)/);
assert.match(dayTrader, /const jumpCount = Number\(jumps\)/);
assert.match(dayTrader, /const limit = Number\(maxJumps\)/);
assert.match(dayTrader, /jumpCount <= Math\.max\(0, limit\)/);
assert.match(dayTrader, /if \(!isWithinJumpLimit\(trade\.jumps, settings\.maxJumps\)\) return false;/);
assert.match(dayTrader, /<details className="day-trader-filter-panel">/);
assert.doesNotMatch(dayTrader, /<details className="day-trader-filter-panel"\s+open/);

const scanner = read("src/MarketOpportunityScanner.tsx");
assert.ok(scanner.includes('<details className="market-filter-panel" ref={advancedFiltersRef}>'));
assert.doesNotMatch(scanner, /<details className="market-filter-panel"\s+open/);
assert.match(scanner, /<span>Route security<\/span>/);
assert.match(scanner, /className=\{filters\.routeSecurity === security \? "active" : ""\}/);
assert.match(scanner, /\["all", "high", "low", "null"\] as const/);
assert.match(scanner, /onClick=\{\(\) => setRouteSecurity\(security\)\}/);
assert.match(scanner, /<span>Trade risk<\/span>/);
assert.match(scanner, /Calculated trade risk\. Route security is filtered separately\./);
assert.match(scanner, /trade\.routeSecurity === "high" \? "High-sec"/);
assert.ok(scanner.includes('import eveSkinIcon from "./eve-skin-icon.png";'));
assert.ok(scanner.includes('return /skin/i.test(category) || /\\bskin\\b/i.test(item);'));
assert.ok(scanner.includes('src={marketItemIcon(trade.typeId, trade.item, trade.category)}'));
assert.ok(scanner.includes('ref={maxCapitalInputRef} value={filters.maxInvestment ?? ""}'));
assert.ok(scanner.includes('onMaxCapitalChange?.(filters.maxInvestment);'));
assert.ok(scanner.includes('advancedFiltersRef.current.open = true;'));

const iskLab = read("src/IskLab.tsx");
assert.ok(iskLab.includes('className="isk-summary-card isk-summary-card-link" onClick={focusMarketCapital}'));
assert.ok(iskLab.includes('marketMaxCapital == null ? "Unlimited" : `${money(marketMaxCapital)} ISK`'));
assert.ok(iskLab.includes('onMaxCapitalChange={setMarketMaxCapital}'));
assert.ok(iskLab.includes('focusMaxCapitalRequest={marketCapitalFocusRequest}'));
assert.ok(iskLab.includes('className="market-opportunities-signal-bar"'));
assert.ok(iskLab.includes('PROFIT OPPORTUNITIES INTELLIGENCE'));
assert.ok(iskLab.includes('OPPORTUNITIES &amp; SIGNALS'));
assert.ok(iskLab.includes('className="market-opportunities-update-kpi"'));
assert.ok(iskLab.includes('scanMarketWithCargo(analysis.constraints.cargoCapacityM3, analysis.constraints.cargoProfileId ?? null)'));
assert.doesNotMatch(iskLab, /isk-summary-strip-opportunities/);

const eveAssets = read("electron/eve-assets.ts");
assert.ok(eveAssets.includes('const MAX_CONCURRENT_IMAGE_DOWNLOADS = 8;'));
assert.ok(eveAssets.includes('const IMAGE_DOWNLOAD_ATTEMPTS = 3;'));
assert.ok(eveAssets.includes('const data = await downloadTypeImage(typeId, variation, size);'));
assert.ok(eveAssets.includes('function placeholderSvg()'));
assert.doesNotMatch(eveAssets, /<text[^>]*>\$\{typeId\}<\/text>/);

const css = read("src/isk-task7.css");
assert.match(css, /\.day-trader-filter-panel>summary/);
assert.match(css, /\.market-filter-panel>summary/);
assert.match(css, /\.isk-summary-strip-polished \.isk-summary-card-link/);
assert.match(css, /\.market-opportunities-signal-bar/);
assert.match(css, /\.market-opportunities-signal-kpis/);
assert.match(css, /\.market-opportunities-update-kpi/);

function isWithinJumpLimit(jumps, maxJumps) {
  if (maxJumps == null) return true;
  const jumpCount = Number(jumps);
  const limit = Number(maxJumps);
  return Number.isFinite(jumpCount) && Number.isFinite(limit) && jumpCount <= Math.max(0, limit);
}

assert.equal(isWithinJumpLimit(17, 10), false, "17 jumps must be rejected by a 10-jump cap");
assert.equal(isWithinJumpLimit(10, 10), true, "the cap itself must remain valid");
assert.equal(isWithinJumpLimit("9", 10), true, "numeric jump values from serialized data must be accepted");
assert.equal(isWithinJumpLimit("bad", 10), false, "invalid jump data must not leak through a bounded filter");
assert.equal(isWithinJumpLimit(35, null), true, "no jump cap should leave routes unrestricted");

console.log("Market opportunity controls regression tests passed.");
