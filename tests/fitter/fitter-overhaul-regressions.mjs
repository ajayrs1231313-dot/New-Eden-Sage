import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { advanceFitterActiveQuantity } from "../../src/fitter-quantity.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

// Active-quantity regression: rapid/repeated increments must consume the stored value,
// not a stale render closure, and must stop at the legal shared maximum.
let active = 1;
for (const expected of [2,3,4,5]) {
  active = advanceFitterActiveQuantity(active, 1, 1, 15, 5);
  assert.equal(active, expected);
}
assert.equal(advanceFitterActiveQuantity(active, 5, 1, 15, 5), 5);
assert.equal(advanceFitterActiveQuantity(undefined, 0, 1, 10, 5), 1);
assert.equal(advanceFitterActiveQuantity(0, 0, -1, 10, 5), 0);
assert.equal(advanceFitterActiveQuantity(2, 2, 1, 10, 3), 3);

const fittings = read("src/Fittings.tsx");
assert.match(fittings, /advanceFitterActiveQuantity\(item\.activeQuantity, baseline, delta, item\.quantity, maxAllowed\)/);
assert.match(fittings, /const maxActiveFor=/);
assert.match(fittings, /bandwidthByType/);
assert.match(fittings, /lightSlots\?\?tubes/);
assert.match(fittings, /supportSlots\?\?tubes/);
assert.match(fittings, /heavySlots\?\?tubes/);
assert.match(fittings, /onBayActiveQuantityChange\(entry\.target,entry\.index,delta,baseline,maxAllowed\)/);
assert.match(fittings, /resolveShipFrame\(fit\.hull\.name, hullGroupName\)/);
assert.match(fittings, /resolveFitterFaction\(\{ factionId:hullTypeInfo\?\.identity\?\.factionId/);
assert.ok(!fittings.includes('<FitQuickBay title="DRONE BAY"'), "drone bay must not render in the fitting rack stack");
assert.ok(!fittings.includes('<FitQuickBay title="CARGO"'), "cargo must not render in the fitting rack stack");
assert.ok(!fittings.includes("function FitQuickBay("), "duplicate quick-bay component must stay removed");
assert.match(fittings, /Additional Loadouts/);
assert.match(fittings, /getFitterContentConfig/);
assert.match(fittings, /className="fit-v2-issues-dock"/);
assert.match(fittings, /createPortal\(\s*<FitIssuesPanel/);
assert.equal((fittings.match(/<FitIssuesPanel/g) ?? []).length, 1, "Fitting Issues must render only through the lower-left workspace dock");

const dogma = read("electron/fitting-dogma.ts");
assert.match(dogma, /if \(drone\.bandwidth <= bandwidthRemaining\)/);
assert.match(dogma, /identity:\{factionId:type\.factionId/);
assert.match(dogma, /lines\("factions\.jsonl"\)/);
assert.match(dogma, /droneLimits: \{ maxActiveDrones, bandwidthCapacity:shipAttr\(1271\), bandwidthByType:droneBandwidthByType \}/);

const mainEntry = read("src/main.tsx");
assert.ok(!fittings.includes('import "./fittings-layout-v2.css"'), "legacy fitter CSS must not be component-imported after concept layers");
assert.ok(mainEntry.indexOf('fittings-layout-v2.css') < mainEntry.indexOf('fittings-app-bounds.css'), "legacy fitter base must load before bounds");
assert.ok(mainEntry.indexOf('fittings-app-bounds.css') < mainEntry.indexOf('fittings-concept-shell.css'), "approved concept shell must load after legacy bounds");
const app = read("src/App.tsx");
assert.ok(!app.includes('aria-label="Fitting command navigation"'), "secondary fitting navigation must remain removed");

const presentation = read("src/fitter-presentation.ts");
for (const faction of ["gallente","caldari","amarr","minmatar","ore","guristas","serpentis","angel-cartel","blood-raiders","sansha","sisters-of-eve","mordus-legion","triglavian","edencom","interbus","concord","syndicate","society-of-conscious-thought","deathless-circle","jovian","pirate","new-eden"]) {
  assert.ok(presentation.includes(faction), `missing faction mapping: ${faction}`);
  const asset = path.join(root,"src","fitter-assets","factions",`${faction}.webp`);
  assert.ok(fs.existsSync(asset), `missing raster faction asset: ${faction}`);
  assert.ok(fs.statSync(asset).size > 10000, `faction raster asset is unexpectedly small: ${faction}`);
}
assert.match(presentation, /500009:"syndicate"/);
assert.match(presentation, /SDE_SHIP_FACTION_BY_ID/);
assert.match(presentation, /\$\{faction\.id\}\.webp/);
assert.match(presentation, /hullTypeIds/);
assert.match(presentation, /factionIds/);
assert.match(presentation, /groupNames/);
assert.match(presentation, /campaignStart/);
assert.match(presentation, /campaignEnd/);
assert.match(presentation, /priority/);
assert.match(presentation, /kind: "hero" \| "promotion"/);
assert.match(presentation, /alligator:\{scale:\.92/);
assert.match(presentation, /sage-asset:\/\/fitter-content\//);

const main = read("electron/main-task9.ts");
assert.match(main, /FITTER_CONTENT_CONFIG_PATH/);
assert.match(main, /fitting:content-config/);
assert.match(main, /external:open-url/);
const assets = read("electron/eve-assets.ts");
assert.match(assets, /FITTER_CONTENT_ASSET_ROOT/);
assert.match(assets, /url\.hostname === "fitter-content"/);

const shellCss = read("src/fittings-concept-shell.css");
const stageCss = read("src/fittings-concept-stage.css");
const statsCss = read("src/fittings-concept-stats.css");
assert.match(shellCss, /--fit-faction-art/);
assert.match(shellCss, /--fit-hero-art/);
assert.ok(shellCss.includes("grid-template-columns: minmax(0, 1fr) var(--fit-right-rail)"), "fitter centre must expand and shrink fluidly without a fixed width cap or overflow floor");
assert.ok(!shellCss.includes(".fitting-shell-topbar > nav"), "obsolete fitting topbar nav CSS must remain removed");
assert.match(stageCss, /--fit-ship-scale/);
assert.match(stageCss, /overflow:hidden!important/);
assert.match(stageCss, /minmax\(235px,1fr\)/);
assert.match(stageCss, /grid-template-columns:42px minmax\(112px,1fr\) 76px 18px/);
assert.match(stageCss, /\.fit-v2-issues-dock \{ display:contents; \}/);
assert.match(stageCss, /\.fit-workspace-v2 \.fit-v2-issues \{/);
assert.match(stageCss, /fitter-stage-overlay\.svg/);
assert.match(stageCss, /fitter-core-surround\.svg/);
assert.match(stageCss, /fitter-core-window\.svg/);
assert.match(stageCss, /fitter-rack-high\.svg/);
assert.match(stageCss, /fitter-rack-mid\.svg/);
assert.match(stageCss, /fitter-rack-low\.svg/);
assert.match(stageCss, /fitter-slot-bezel\.svg/);
assert.match(stageCss, /grid-template-rows:22px 23px/);
assert.match(stageCss, /fit-drone-card\{position:relative;flex:0 0 122px/);
assert.match(fittings, /className="fit-rail-section fit-rail-target-application"/, "target application controls must remain in the live fitter rail");
assert.ok(!/section:nth-of-type\(n\+5\)[^}]*display\s*:\s*none/i.test(statsCss), "analytics sections must never be hidden to force compact geometry");
assert.match(fittings, /className="fit-rail-section pyfa-section-capacitor"/);
assert.match(fittings, /className="fit-rail-section pyfa-section-targeting"/);
assert.match(shellCss, /fitter-button-teal\.svg/);
assert.match(shellCss, /fitter-button-gold\.svg/);
assert.match(shellCss, /fitter-nameplate\.svg/);
assert.match(shellCss, /fitter-tab-active\.svg/);

assert.ok(shellCss.includes("minmax(clamp(225px, 34vh, 330px), 1fr)"), "fitting stage must consume available vertical space");
assert.match(shellCss, /clamp\(100px, 15vh, 145px\)/);
assert.match(stageCss, /grid-template-columns:minmax\(190px,32%\) minmax\(220px,35%\) minmax\(170px,29%\)/);
assert.match(statsCss, /\.pyfa-stat>span\{min-width:0;display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
assert.match(statsCss, /\.pyfa-stat\.tone-danger strong/);
assert.match(statsCss, /\.damage-em/);
assert.ok(!statsCss.includes(".pyfa-stat:nth-child(2){display:none!important;}"), "tank stats must not be suppressed");
assert.match(statsCss, /\.fit-eve-export-status\{position:absolute/);
assert.match(fittings, /setTimeout\(\(\) => \{ setEveExportStatus\(""\); \}, 2800\)/);
console.log("Fitter overhaul regressions passed: active drones, DOGMA caps, faction assets, hero backend, adaptive framing, nav removal, and loadout layout.");


