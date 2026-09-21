const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const ui = read("src/CapabilityCommandCenter.tsx");
const engine = read("electron/capability-engine.ts");
const eve = read("electron/eve.ts");
const main = read("electron/main-task9.ts");
const fleet = read("src/FleetCommand.tsx");
const navigation = read("src/NavigationCommand.tsx");
const hud = read("src/CharacterOverviewHud.tsx");
const intelligence = read("src/CommandIntelligence.tsx");
const skills = read("src/SkillsWorkspace.tsx");
const routeTypes = read("src/character-navigation.ts");
const app = read("src/App.tsx");
const commandHeader = read("src/CharacterCommandHeader.tsx");
const css = read("src/character-command.css");

for (const label of ["PvE Combat", "PvP Combat", "Mining", "Exploration", "Logistics", "Hauling", "Salvage", "Support", "Other / General"])
  assert.ok(ui.includes(label), `ship-use selector must include ${label}`);
assert.ok(ui.includes('return "general";'), "new current-hull profiles must default to general, not an inferred specialist activity");
assert.ok(ui.includes("getCurrentShipCapability"), "compact readiness must use the focused current-hull capability IPC");
assert.ok(ui.includes("refreshCurrentShip(snapshot.characterId)"), "compact refresh must call the targeted current-ship ESI refresh");
assert.ok(ui.includes("setShipCapability(null)"), "profile or hull changes must clear stale readiness before recalculation");

// Readiness ring: draw the percentage itself, not a visually full dash translated around the circle.
assert.ok(ui.includes("pathLength={100}"), "ship readiness dial must normalize its progress path to 100");
assert.ok(ui.includes('strokeDasharray={`${safePercent} ${100 - safePercent}`}'), "ship readiness dial must draw the actual percent/gap lengths");
assert.ok(ui.includes("strokeDashoffset={0}"), "ship readiness dial must not simulate progress by translating a full dash");
assert.ok(ui.includes('transform="rotate(-90 62 62)"'), "ship readiness dial must deliberately start at 12 o'clock");
assert.ok(ui.includes("safePercent === 0 ? 0 : 1"), "0 percent readiness must visibly render no cyan progress");
assert.ok(!ui.includes('strokeDasharray="100 100"') && !ui.includes("dashOffset"), "old full-circle dash/offset implementation must stay removed");
const readinessDash = (percent) => `${percent} ${100 - percent}`;
for (const [percent, expected] of [[0, "0 100"], [25, "25 75"], [50, "50 50"], [75, "75 25"], [87, "87 13"], [100, "100 0"]])
  assert.equal(readinessDash(percent), expected, `${percent}% must map to the expected cyan/gap circumference split`);
assert.match(css, /\.character-command \.capability-hud-track\s*\{[^}]*stroke-width:2\.6/s, "readiness track must have a uniform explicit width");
assert.match(css, /\.character-command \.capability-hud-progress\s*\{[^}]*stroke-width:2\.6[^}]*stroke-linecap:butt/s, "progress stroke must match track width and preserve an exact visible gap");
assert.match(css, /\.character-command \.capability-hud-dial > svg\s*\{\s*transform:none;/s, "the entire dial must not be rotated on top of the progress-path rotation");

// Compact Character Command readiness must never be blocked by the heavyweight whole-character capability analysis.
assert.match(ui, /useEffect\(\(\) => \{\s*if \(!compact\) void refresh\(\);\s*\}, \[compact, refresh\]\);/, "compact mode must not start full capability analysis on mount");
assert.ok(ui.includes("if (!compact && (!analysis || !selected)) return null;"), "full-analysis null gate must only apply outside compact mode");
assert.ok(ui.includes("if (compact) void refreshShipCapability(shipUseProfile);"), "compact mode must immediately start only focused ship readiness");
assert.ok(ui.includes("CustomNotificationsPanel") && ui.includes("<CustomNotificationsPanel characterId={snapshot.characterId} />"), "compact Character Command must render the live notifications panel without requiring full capability analysis");
assert.ok(!/if \(compact\)[^\n]*getCapabilities/.test(ui), "compact mode must not directly request full capability analysis");

const dataSectorAt = commandHeader.indexOf('<div className="cc-data-sector">');
const updateActionAt = commandHeader.indexOf("<AppUpdateAction />");
assert.ok(dataSectorAt >= 0 && updateActionAt > dataSectorAt, "freshness/data controls must precede the application update action in the shared command header");
assert.match(commandHeader, /<FreshnessNode tone="public" label="PUBLIC DATA"/, "shared header must expose public-data freshness");
assert.match(commandHeader, /<FreshnessNode tone="private" label="PRIVATE DATA"/, "shared header must expose private-data freshness");
assert.equal((commandHeader.match(/<FreshnessNode /g) || []).length, 2, "shared header must render exactly the public/private freshness pair");

const characterFontSizes = [...css.matchAll(/font-size:\s*([0-9.]+)px/g)].map((match) => Number(match[1]));
assert.ok(characterFontSizes.length > 0 && Math.min(...characterFontSizes) >= 8, "Character Command body text must not fall below the readability floor");

assert.ok(engine.includes("forcedShipTypeId") && engine.includes("item.typeId === forcedShipTypeId"), "focused readiness must resolve the exact active hull");
assert.ok(engine.includes("analyzeCurrentShipUse"), "current-ship use analysis entry point must exist");
assert.ok(engine.includes('id: "pvp-combat"') && engine.includes('role: "Damage / combat"'), "PvP use must reuse Sage combat context rather than mining inference");

const shipStart = eve.indexOf("export async function fetchCharacterCurrentShipSnapshot");
const shipEnd = eve.indexOf("export async function", shipStart + 1);
const targetedShipFunction = shipStart >= 0 ? eve.slice(shipStart, shipEnd > shipStart ? shipEnd : eve.length) : "";
assert.ok(targetedShipFunction.includes("characters/${characterId}/ship/"), "targeted refresh must call the ESI current ship endpoint");
assert.ok(!targetedShipFunction.includes("fetchCharacterSnapshot") && !targetedShipFunction.includes("fetchCharacterCoreSnapshot"), "targeted ship refresh must not invoke a full character sync");
assert.ok(main.includes("eve:refresh-current-ship"), "targeted current-ship refresh IPC must be registered");
assert.ok(!ui.includes("syncAll"), "Character Command current-ship refresh must not invoke Sync All");

// Character Command Quick Links: all six have local reusable SVG assets and intentional destinations.
for (const expected of [
  '{ icon: "activity", label: "Activity", sub: "Readiness", target: "activity" }',
  '{ icon: "fittings", label: "Fittings", sub: "Ships", target: "fittings" }',
  '{ icon: "isk", label: "ISK Command", sub: "Wealth", target: "isk" }',
  '{ icon: "industrial", label: "Industrial Feed", sub: "Production", target: "industrial" }',
  '{ icon: "regional", label: "Regional", sub: "Routes", target: "navigation" }',
  '{ icon: "profits", label: "Profits", sub: "Ledger", target: "asset-wallet-ledger" }',
]) assert.ok(hud.includes(expected), `Quick Link route missing: ${expected}`);
assert.ok(hud.includes("function QuickLinkGlyph") && hud.includes('className="quick-link-glyph"'), "all six Quick Links must use the coherent local SVG icon set");
assert.match(css, /\.character-command \.character-quick-grid \.quick-link-glyph\s*\{[^}]*width:29px[^}]*height:29px/s, "Quick Link assets must be sized consistently at button scale");
assert.ok(routeTypes.includes('"asset-wallet-ledger"') && routeTypes.includes('"activity-skills"'), "deep Character Command routes must be modeled explicitly");
assert.match(app, /case "asset-wallet-ledger":\s*setWalletCommandView\("ledger"\);\s*setAssetCommandTab\("wallet"\);\s*setView\("loot"\);/s, "Profits must land directly on Asset Command / Wallet / Ledger");
assert.match(app, /case "navigation":\s*setView\("navigation"\);/s, "Regional must route to Navigation Command");
assert.match(app, /case "industrial":\s*setView\("industrial"\);/s, "Industrial Feed must route to Industrial Command");

// Removed skill-queue CTA must stay gone while My Skills deep routing remains available.
assert.doesNotMatch(intelligence, /id: "skill-queue"/, "Command Priority must not duplicate the removed skill-queue card");
assert.doesNotMatch(intelligence, /action: "Add another skill"/, "removed Add another skill CTA must stay out of Command Priority");
assert.match(app, /case "activity-skills":\s*setActivityCommandTab\("my-skills"\);\s*setView\("skills"\);/s, "Add another skill must land on Activity Command / My Skills");
assert.ok(skills.includes("activeTab?: SkillsTab") && skills.includes("onTabChange?(tab: SkillsTab)"), "Activity Command tab selection must be externally routable without remounting/recalculation");
assert.match(css, /\.command-priority-panel\.danger\s*\{[^}]*border-color:#71313b[^}]*box-shadow:/s, "urgent priority panel must have a pronounced but dark red warning treatment");
assert.match(css, /\.priority-red \.priority-dot\s*\{[^}]*color:#ef5867/s, "urgent status point must use the reusable red alert treatment");

// Corporation name must be measured against real available width and fall back to ticker only when necessary.
assert.ok(hud.includes("corporationTicker") && hud.includes("ResizeObserver"), "corporation identity must track ticker and responsive width changes");
assert.ok(hud.includes("measure.scrollWidth > copy.clientWidth"), "corporation fallback must use rendered width rather than an arbitrary character count");
assert.ok(hud.includes("showTicker && corporationTicker ? corporationTicker : corporationName"), "normal names must remain visible while overflowing names use ticker when available");
assert.ok(hud.includes("character-corporation-name-measure"), "corporation name measurement must use a hidden non-layout-breaking probe");

// Onboarding: derive eligible commands from the live nav, exclude Settings, persist visits, and complete only when all have been seen.
assert.ok(hud.includes('["Welcome", "Add Character", "Sync Data", "Visit All Command Tabs"]'), "Character onboarding must contain exactly the new four-node sequence");
assert.ok(hud.includes('if (completeCount === labels.length) return null;'), 'completed onboarding journey should disappear at 4/4');
assert.ok(app.includes('const commandNav = nav.filter((item) => item.id !== "settings");'), "onboarding command targets must derive from live nav and explicitly exclude Settings");
assert.ok(app.includes('const COMMAND_VISIT_STORAGE_KEY = "new-eden-sage:onboarding:command-tabs:v1";'), "command visit onboarding must use a versioned persistent key");
assert.ok(app.includes("localStorage.getItem(COMMAND_VISIT_STORAGE_KEY)") && app.includes("localStorage.setItem(COMMAND_VISIT_STORAGE_KEY"), "command visits must survive app restart");
assert.ok(app.includes("commandNav.every((item) => visitedCommandViews.has(item.id))"), "onboarding must complete only after every eligible top-level command has been visited");
assert.match(css, /\.character-command \.character-journey-rail\s*\{\s*grid-template-columns:repeat\(4,1fr\);\s*\}/s, "onboarding rail must lay out four nodes cleanly");

assert.ok(fleet.includes('type FleetCommandTab = "doctrines" | "jump-map" | "wargame"'), "Fleet Command must own the jump-map tab");
assert.ok(fleet.includes("<OnTheFlyJumpMap"), "Fleet Command must render the on-the-fly jump map");
assert.ok(fleet.includes("15_000"), "Fleet live-follow must retain the existing 15 second targeted cadence");
assert.ok(!navigation.includes('id: "jump-map"'), "Navigation Command must no longer expose the moved jump-map tab");
assert.ok(!navigation.includes("<OnTheFlyJumpMap"), "Navigation Command must not duplicate the moved map");

for (const source of [ui, hud, intelligence, routeTypes])
  assert.ok(!Array.from(source).some((char) => char.charCodeAt(0) > 127), "Character Command source must remain ASCII-safe and free of mojibake bytes");

console.log("PASS Character Command percentage ring and compact startup regression");
console.log("PASS targeted ESI current-ship refresh regression");
console.log("PASS Quick Link / deep-route / command-priority regression");
console.log("PASS responsive corporation identity fallback regression");
console.log("PASS four-node persisted onboarding regression");
console.log("PASS On The Fly Jump Map Fleet Command move regression");
console.log("PASS Character Command encoding/readability/header regression");
