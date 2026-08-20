import assert from "node:assert/strict";
import { buildSystemNewsKillmailWindows, mergeSystemNewsKillmails } from "../../src/system-news-killmail-windows.ts";

const now = Date.parse("2026-08-20T01:30:00Z");
const make = (id, minutesAgo, extra = {}) => ({
  killmailId: id,
  killmailTime: new Date(now - minutesAgo * 60_000).toISOString(),
  solarSystemId: 30002548,
  victim: { character_id: 1000000 + id, ship_type_id: 670, items: [] },
  attackers: [{ character_id: 2000000 + id }],
  source: "composed",
  ...extra,
});

const withinHour = [make(1, 10), make(2, 20), make(3, 50)];
const earlierToday = Array.from({ length: 12 }, (_, index) => make(4 + index, 90 + index * 60));
const composed = [...withinHour, ...earlierToday];

let windows = buildSystemNewsKillmailWindows(composed, now);
assert.equal(windows["1h"].length, 3, "1h card/list must contain exactly 3");
assert.equal(windows["24h"].length, 15, "24h card/list must contain exactly 15");
assert.deepEqual(windows["1h"].map((item) => item.killmailId), [1, 2, 3]);
assert.equal(windows["24h"], windows["24h"], "card count and list use the same canonical array");

// Reproduce the bug: an async zKill cache event arrives with only the newest 3.
const narrowAsyncCache = withinHour.map((item) => ({ ...item, source: "zKillboard" }));
const merged = mergeSystemNewsKillmails(composed, narrowAsyncCache);
windows = buildSystemNewsKillmailWindows(merged, now);
assert.equal(merged.length, 15, "narrow async update must never erase composed killmails");
assert.equal(windows["1h"].length, 3, "1h remains 3 after async update");
assert.equal(windows["24h"].length, 15, "24h remains 15 after async update");

// A genuinely new killmail must extend, not replace, the archive.
const newKill = make(16, 5, { source: "zKillboard", totalValue: 123456 });
const extended = mergeSystemNewsKillmails(merged, [newKill]);
windows = buildSystemNewsKillmailWindows(extended, now);
assert.equal(extended.length, 16);
assert.equal(windows["1h"].length, 4);
assert.equal(windows["24h"].length, 16);

// A stale refresh response arriving after the new async kill must not roll state back.
const afterStaleRefresh = mergeSystemNewsKillmails(extended, composed);
windows = buildSystemNewsKillmailWindows(afterStaleRefresh, now);
assert.equal(afterStaleRefresh.length, 16, "stale refresh response must not erase newer async kills");
assert.equal(windows["1h"].length, 4);
assert.equal(windows["24h"].length, 16);

console.log(JSON.stringify({
  initial: { h1: 3, h24: 15 },
  afterNarrowAsyncUpdate: { h1: buildSystemNewsKillmailWindows(merged, now)["1h"].length, h24: buildSystemNewsKillmailWindows(merged, now)["24h"].length },
  afterNewKill: { h1: windows["1h"].length, h24: windows["24h"].length },
}, null, 2));
console.log("SYSTEM NEWS KILLMAIL WINDOWS: PASS");
