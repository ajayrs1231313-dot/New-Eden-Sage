import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DISPLAY_FIT_DEFAULT_ENABLED,
  DISPLAY_FIT_MIN_ZOOM,
  RESPONSIVE_DISPLAY_PROFILES,
  fitDisplayZoom,
  responsiveDisplayZoom,
} from "../../electron/display-scale.ts";

for (const profile of RESPONSIVE_DISPLAY_PROFILES) {
  assert.equal(
    responsiveDisplayZoom(profile.width, profile.height),
    profile.zoom,
    `${profile.label} (${profile.width}x${profile.height})`,
  );
}

assert.equal(responsiveDisplayZoom(1040, 700), 1, "minimum supported window");
assert.equal(responsiveDisplayZoom(5120, 900), 1, "very wide but short window must not inflate");
assert.equal(responsiveDisplayZoom(1500, 2160), 1, "very tall but narrow window must not inflate");

assert.equal(DISPLAY_FIT_DEFAULT_ENABLED, false, "fit-to-monitor must stay off on ordinary app launch");
assert.equal(DISPLAY_FIT_MIN_ZOOM, 1, "fit-to-monitor must never shrink below normal readable scale");
assert.equal(fitDisplayZoom(1, 1, 1680, 920, 1680, 1080), 1, "moderate vertical overflow scrolls instead of shrinking text");
assert.equal(fitDisplayZoom(1, 1, 1360, 860, 1360, 2000), 1, "very long workspaces scroll at normal readable scale");
assert.equal(fitDisplayZoom(1, 1, 1920, 1080, 1920, 1000), 1, "content that already fits keeps the responsive profile");
assert.equal(fitDisplayZoom(1, 0.75, 1800, 1200, 1500, 900), 1, "legacy sub-100% zoom recovers to the readable floor");
assert.equal(fitDisplayZoom(1, DISPLAY_FIT_MIN_ZOOM, 1914, 1028, 1800, 4000, false), 1, "vertically long workspaces keep full readable zoom when width fits");
assert.equal(fitDisplayZoom(1, DISPLAY_FIT_MIN_ZOOM, 1914, 1028, 1930, 4000, false), 1, "tiny width noise never makes normal-scale text smaller");
assert.equal(fitDisplayZoom(1.2, 1.2, 1914, 1028, 2100, 4000, false), 1.083, "high-DPI profiles may fit genuine horizontal overflow without dropping below 100%");

const main = fs.readFileSync(new URL("../../electron/main-task9.ts", import.meta.url), "utf8");
assert.match(main, /createdWindow\.on\("maximize", \(\) => scheduleResponsiveDisplayScale\(createdWindow\)\)/, "maximizing Sage must preserve the user's fit preference");
assert.match(main, /createdWindow\.on\("enter-full-screen", \(\) => scheduleResponsiveDisplayScale\(createdWindow\)\)/, "native fullscreen must preserve the user's fit preference");
assert.match(main, /fitHeight: false/, "all workspaces should scroll vertically instead of shrinking typography");

const iskCss = fs.readFileSync(new URL("../../src/isk-task7.css", import.meta.url), "utf8");
assert.match(iskCss, /html\[data-fit-to-monitor="on"\] \.isk-lab-v2 \.market-trade-table-polished \.market-trade-result strong\{font-size:12\.5px/, "fit mode should enforce a readable Market Scanner row-text floor");
assert.match(iskCss, /html\[data-fit-to-monitor="on"\] \.isk-lab-v2 \.market-trade-table-polished \.market-trade-row\.heading[^\n]*font-size:10\.5px/, "fit mode should enforce a readable Market Scanner table-heading floor");

console.log(`Responsive display matrix passed: ${RESPONSIVE_DISPLAY_PROFILES.length} representative monitor sizes.`);
