import assert from "node:assert/strict";
import fs from "node:fs";

const orderDesk = fs.readFileSync(new URL("../../src/OrderDesk.tsx", import.meta.url), "utf8");
const iskLab = fs.readFileSync(new URL("../../src/IskLab.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../../src/order-desk.css", import.meta.url), "utf8");

assert.match(iskLab, /name="orders" \/>Order Desk<\/button>/, "Order Desk tab should have the correct visible label");

const lower = orderDesk.slice(
  orderDesk.indexOf('<div className="od-lower-grid">'),
  orderDesk.indexOf('<footer className="od-status-line">'),
);
const headings = ["QUICK LINKS", "TRADING GUIDANCE", "RECENT ACTIVITY", "MARKET INSIGHTS"];
let cursor = -1;
for (const heading of headings) {
  const next = lower.indexOf(heading);
  assert.ok(next > cursor, `${heading} should appear in the requested four-panel order`);
  cursor = next;
}

for (const title of ["How buy orders work", "Trading strategies", "Fees and taxes", "Maximize your ISK"]) {
  assert.ok(orderDesk.includes(`title: "${title}"`), `missing guide: ${title}`);
}
assert.match(orderDesk, /More in-depth guides are coming soon\./, "guide modal footer addendum should be present");
assert.match(orderDesk, /orderCompetitionNotification/, "Order Desk alerts must use the competition notification rule builder");
assert.ok(orderDesk.includes("ensureNotificationRule(orderCompetitionNotification"), "Order Desk must create a real persisted notification rule");
assert.ok(orderDesk.includes("\"Notify me\""), "Order Desk must expose the live notification action");
assert.ok(orderDesk.includes("\"Outbid alert\""), "buy orders must identify outbid monitoring");
assert.ok(orderDesk.includes("\"Undercut alert\""), "sell orders must identify undercut monitoring");
assert.ok(!orderDesk.includes("This feature is coming soon."), "implemented Order Desk alerts must not fall back to the old placeholder");
assert.doesNotMatch(orderDesk, /Create Buy Order|Create Sell Order/, "Order Desk must not offer fake order-creation actions");
assert.match(orderDesk, /Create \$\{view\} orders in EVE and they will appear here after the next character sync\./, "empty state should direct order creation to EVE");
assert.match(orderDesk, /role="dialog" aria-modal="true"/, "guidance and alert content should use a modal dialog");
assert.match(css, /\.od-modal-backdrop\{position:fixed/, "Order Desk modal should use the Sage-styled overlay");
assert.match(css, /@media\(max-width:720px\).*?\.od-lower-grid\{grid-template-columns:1fr\}/s, "Order Desk lower panels should remain responsive");

console.log("Order Desk follow-up regression checks passed.");
