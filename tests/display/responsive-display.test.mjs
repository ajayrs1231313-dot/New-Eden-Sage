import assert from "node:assert/strict";
import {
  RESPONSIVE_DISPLAY_PROFILES,
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

console.log(`Responsive display matrix passed: ${RESPONSIVE_DISPLAY_PROFILES.length} representative monitor sizes.`);
