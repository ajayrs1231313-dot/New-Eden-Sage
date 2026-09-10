import assert from "node:assert/strict";
import fs from "node:fs";
import {
  SIDEBAR_HIDE_DELAY_MS,
  createSidebarAutoHideState,
  createSidebarHideScheduler,
  transitionSidebarAutoHide,
} from "../../src/sidebar-auto-hide-state.ts";

const fresh = createSidebarAutoHideState(false, false);
assert.deepEqual(fresh, { onboardingSeen: false, pinned: false, open: true }, "fresh installs introduce the open overlay");

const confirmed = transitionSidebarAutoHide(fresh, { type: "confirm-onboarding" });
assert.deepEqual(confirmed, { onboardingSeen: true, pinned: false, open: false }, "confirming onboarding enables auto-hide and closes the rail");

const opened = transitionSidebarAutoHide(confirmed, { type: "edge-open" });
assert.equal(opened.open, true, "left-edge activation opens navigation");
assert.equal(transitionSidebarAutoHide(opened, { type: "hide" }).open, false, "an unpinned rail can auto-hide");
assert.equal(transitionSidebarAutoHide(opened, { type: "navigation-selected" }).open, false, "navigation closes the unpinned overlay");
assert.equal(transitionSidebarAutoHide(opened, { type: "escape" }).open, false, "Escape closes the unpinned overlay");

const pinned = transitionSidebarAutoHide(opened, { type: "pin" });
assert.equal(pinned.pinned, true);
assert.equal(pinned.open, true);
assert.strictEqual(transitionSidebarAutoHide(pinned, { type: "hide" }), pinned, "pinned navigation ignores auto-hide");
assert.strictEqual(transitionSidebarAutoHide(pinned, { type: "escape" }), pinned, "pinned navigation ignores Escape close");
assert.deepEqual(transitionSidebarAutoHide(pinned, { type: "unpin" }), { onboardingSeen: true, pinned: false, open: false }, "unpinning resumes auto-hide mode");

assert.ok(SIDEBAR_HIDE_DELAY_MS >= 300 && SIDEBAR_HIDE_DELAY_MS <= 500, "dismissal delay stays in the intended usability range");
let hides = 0;
const scheduler = createSidebarHideScheduler(() => { hides += 1; }, 25);
scheduler.schedule();
await new Promise((resolve) => setTimeout(resolve, 10));
scheduler.cancel();
await new Promise((resolve) => setTimeout(resolve, 30));
assert.equal(hides, 0, "re-entering/cancelling during the delay prevents accidental closure");
scheduler.schedule();
await new Promise((resolve) => setTimeout(resolve, 35));
assert.equal(hides, 1, "leaving long enough closes once");
scheduler.dispose();

const app = fs.readFileSync(new URL("../../src/App.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../../src/sidebar-auto-hide.css", import.meta.url), "utf8");
assert.match(app, /SIDEBAR_AUTO_HIDE_ONBOARDING_STORAGE_KEY/, "onboarding state is persisted");
assert.match(app, /SIDEBAR_PINNED_STORAGE_KEY/, "pin state is persisted");
assert.match(app, /onPointerEnter=\{openSidebar\}/, "edge pointer entry opens the drawer");
assert.match(app, /onPointerLeave=\{scheduleSidebarHide\}/, "pointer leave schedules auto-hide");
assert.match(app, /setAttribute\("inert", ""\)/, "closed navigation cannot strand keyboard focus inside invisible controls");
assert.match(app, /dialogOwnsEscape/, "modal/dialog Escape receives priority");
assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\)\s*!important/, "hidden navigation no longer reserves a grid column");
assert.match(css, /fittings-shell-active\s*>\s*aside\.command-sidebar[\s\S]*display:\s*flex\s*!important/, "Fitter can use the same overlay drawer instead of suppressing navigation");
console.log("Sidebar auto-hide navigation regression tests passed.");
