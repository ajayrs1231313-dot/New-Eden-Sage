const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const industrial = read('src/IndustrialCommand.tsx');
assert(!industrial.includes('UNDER CONSTRUCTION'), 'Industrial Command construction banner must be removed');
assert(industrial.includes('{ id: "moon-goo", label: "Moon Goo" }'), 'Moon Goo must have a distinct top-level tab');
assert(industrial.includes('type MoonGooTab = "materials" | "reactions"'), 'Moon Materials must retain the Reactions subtab model');
assert(industrial.includes('setMoonGooTab("reactions")') && industrial.includes('>Reactions</button>'), 'Reactions must remain directly reachable under Moon Materials');
assert(industrial.includes('moonProjectDemand') && industrial.includes('reactionUses'), 'Moon Goo must link project demand and reaction destinations');

const app = read('src/App.tsx');
assert(app.includes('{ id: "corporation", label: "Corporation Command" }'));
assert(app.includes('{ id: "fleet", label: "Fleet Command" }'));
assert(app.includes('view === "fleet"') && app.includes('<RetainedFleetCommand active={view === "fleet"}'), 'Fleet Command must remain mounted and activated by the fleet view');
assert(app.includes('const navigateToCorpDoctrines = () => setView("fleet")'));

const corporation = read('src/CorporationManagement.tsx');
assert(!corporation.includes('section === "doctrines"'), 'Doctrine editor must no longer live under Corporation Command');

const doctrines = read('src/CorporationDoctrines.tsx');
assert(!doctrines.includes('slice(0, 10)'), 'fit persistence must not slice to ten');
assert(!doctrines.includes('fits.length >= 10'), 'fit import must not enforce ten-fit cap');
assert(!doctrines.includes('Array.from({ length: 10'), 'UI must not render ten fixed placeholders');
assert(doctrines.includes('selected &&'), 'only the selected doctrine editor should render');
assert(doctrines.includes('+ New Doctrine'), 'unbounded doctrine creation control must exist');


assert(app.includes('reviewMatches') && app.includes('Review sale candidates') && app.includes('Review alternate sale evidence'), 'ambiguous ledger rows must expose manual sale-evidence review rather than silently forcing a match');
assert(app.includes('getProfitReconciliationReview') && app.includes('setProfitTransactionOverride'), 'Wallet Command must wire ambiguous transaction review/override');
const preload = read('electron/preload.ts');
assert(preload.includes('profit-ledger:review') && preload.includes('profit-ledger:transaction-override'), 'manual review must be exposed through preload IPC');
console.log(JSON.stringify({ industrial: true, moonGoo: true, fleetNav: true, doctrineUi: true, manualReview: true }));
