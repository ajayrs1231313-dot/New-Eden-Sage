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
assert.equal(fitDisplayZoom(1, 1, 1680, 920, 1680, 1080), 0.843, "moderate vertical overflow is fitted");
assert.equal(fitDisplayZoom(1, 1, 1360, 860, 1360, 2000), DISPLAY_FIT_MIN_ZOOM, "very long workspaces keep a readable floor and may scroll");
assert.equal(fitDisplayZoom(1, 1, 1920, 1080, 1920, 1000), 1, "content that already fits keeps the responsive profile");
assert.ok(fitDisplayZoom(1, 0.75, 1800, 1200, 1500, 900) > 0.75, "fit mode can grow again after switching to a shorter view");

const main = fs.readFileSync(new URL("../../electron/main-task9.ts", import.meta.url), "utf8");
assert.match(main, /createdWindow\.on\("maximize", \(\) => enableDisplayFitForFullscreen\(createdWindow\)\)/, "maximizing Sage should enable fit-to-monitor");
assert.match(main, /createdWindow\.on\("enter-full-screen", \(\) => enableDisplayFitForFullscreen\(createdWindow\)\)/, "native fullscreen should enable fit-to-monitor");

console.log(`Responsive display matrix passed: ${RESPONSIVE_DISPLAY_PROFILES.length} representative monitor sizes.`);
