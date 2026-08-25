const assert = require('node:assert/strict');
const fs = require('node:fs');

module.exports = async function intelligenceTests() {
  const policy = require('../../dist-electron/system-intelligence-policy.js');
  const routeIntel = require('../../dist-electron/navigation-route-intelligence.js');
  const systemIntel = require('../../dist-electron/system-intelligence.js');
  const now = Date.parse('2026-08-19T20:00:00.000Z');

  assert.equal(policy.SYSTEM_NEWS_ZKILL_REQUEST_SPACING_MS, 15 * 1000);
  assert.equal(policy.SYSTEM_NEWS_ZKILL_COOLDOWN_MS, 15 * 1000);
  assert.equal(policy.SYSTEM_NEWS_ZKILL_CACHE_TTL_MS, 5 * 60 * 1000);
  assert.equal(policy.killmailCallerPriority('watch'), 3);
  assert.equal(policy.killmailCallerPriority('single'), 3);
  assert.equal(policy.killmailCallerPriority('route'), 1);
  assert.equal(policy.killmailCallerPriority(undefined), 2);
  assert.equal(policy.SYSTEM_NEWS_ZKILL_LOOKBACK_SECONDS, 24 * 60 * 60);
  assert.equal(policy.SYSTEM_NEWS_ZKILL_BACKFILL_DAYS, 30);
  assert.equal(policy.SYSTEM_NEWS_ZKILL_PAGE_SIZE, 200);
  assert.equal(policy.killmailCacheNeedsQueue(new Date(now - 60_000).toISOString(), false, now), false, 'fresh watched cache must be reused by route callers');
  assert.equal(policy.killmailCacheNeedsQueue(undefined, false, now), true, 'unwatched route system must be eligible to queue intelligence');
  assert.equal(policy.killmailCacheNeedsQueue(new Date(now - 10 * 60_000).toISOString(), true, now), false, 'already queued system must not duplicate queue work');
  assert.equal(policy.deepKillmailBackfillForCaller('route'), false);
  assert.equal(policy.deepKillmailBackfillForCaller('watch'), true);
  assert.equal(policy.deepKillmailBackfillForCaller('single'), true);
  assert.equal(policy.deepKillmailBackfillForCaller('route', true), true);
  assert.equal(policy.killmailRefreshCycleAllowed(new Date(now - 5_000).toISOString(), now), false);
  assert.equal(policy.killmailRefreshCycleAllowed(new Date(now - 20_000).toISOString(), now), true);
  assert.equal(policy.nextKillmailRequestTime(new Date(now - 5_000).toISOString()), now - 5_000 + 15_000);
  assert.equal(policy.killmailCacheNeedsQueue(new Date(now - 4 * 60_000).toISOString(), false, now), false, 'four-minute cache remains fresh even though request spacing is shorter');
  assert.equal(policy.killmailCacheNeedsQueue(new Date(now - 6 * 60_000).toISOString(), false, now), true, 'cache freshness remains five minutes');

  const gates = [
    { gateId: 10, destinationSystemId: 2, destinationSystemName: 'B', position: { x: 0, y: 0, z: 0 } },
    { gateId: 20, destinationSystemId: 3, destinationSystemName: 'C', position: { x: 1_000_000, y: 0, z: 0 } },
  ];
  const kill = (id, distance, minutesAgo, attacker = 9001, shipType = 123) => ({
    killmailId: id,
    killmailTime: new Date(now - minutesAgo * 60_000).toISOString(),
    solarSystemId: 1,
    victim: { ship_type_id: shipType, position: { x: distance, y: 0, z: 0 } },
    attackers: [{ character_id: attacker }],
    source: 'zKillboard',
    totalValue: 10_000_000,
  });

  assert.equal(routeIntel.classifyKillmailNearGate(kill(1, 40_000, 5), gates).confidence, 'high');
  assert.equal(routeIntel.classifyKillmailNearGate(kill(2, 80_000, 5), gates).confidence, 'medium');
  assert.equal(routeIntel.classifyKillmailNearGate(kill(3, 180_000, 5), gates).confidence, 'low');
  assert.equal(routeIntel.classifyKillmailNearGate(kill(4, 400_000, 5), gates), null);

  const campKills = [kill(11, 10_000, 10), kill(12, 15_000, 20), kill(13, 20_000, 30)];
  const classifications = campKills.map((item) => routeIntel.classifyKillmailNearGate(item, gates)).filter(Boolean);
  const danger = routeIntel.deriveGateDanger(campKills, classifications, 10, { jumps: 20 }, now);
  assert.equal(danger.state, 'active-camp');
  assert(danger.score > 0);
  assert.equal(danger.metrics.gateKills1h, 3);
  assert.equal(danger.metrics.recurringAttackers, 1);

  const routeWindows = routeIntel.buildKillWindows([
    kill(21, 5_000, 30),
    kill(22, 5_000, 120),
    kill(23, 5_000, 12 * 60),
    kill(24, 5_000, 4 * 24 * 60),
    kill(25, 5_000, 20 * 24 * 60),
  ], [], now);
  assert.equal(routeWindows['1h'].kills, 1);
  assert.equal(routeWindows['2h'].kills, 2);
  assert.equal(routeWindows['24h'].kills, 3);
  assert.equal(routeWindows['7d'].kills, 4);
  assert.equal(routeWindows['30d'].kills, 5);

  const samples = [
    { capturedAt: new Date(now - 20 * 24 * 60 * 60_000).toISOString(), shipKills: 1, podKills: 0, npcKills: 10, jumps: 100 },
    { capturedAt: new Date(now - 3 * 24 * 60 * 60_000).toISOString(), shipKills: 2, podKills: 0, npcKills: 20, jumps: 200 },
    { capturedAt: new Date(now - 5 * 60 * 60_000).toISOString(), shipKills: 3, podKills: 1, npcKills: 30, jumps: 300 },
    { capturedAt: new Date(now - 30 * 60_000).toISOString(), shipKills: 4, podKills: 1, npcKills: 40, jumps: 400 },
  ];
  const windows = systemIntel.buildSystemActivityWindows(samples, now);
  assert.equal(windows['1h'].samples, 1);
  assert.equal(windows['24h'].samples, 2);
  assert.equal(windows['7d'].samples, 3);
  assert.equal(windows['30d'].samples, 4);

  const routeSource = fs.readFileSync('electron/navigation-route-intelligence.ts', 'utf8');
  assert.match(routeSource, /refreshSystemIntelligence\(systemIds, snapshots/);
  assert.match(routeSource, /caller:\s*"route"/);
  assert.doesNotMatch(routeSource, /watchedSystemIds|watchlist/i, 'route intelligence must not depend on System Watch membership');

  return { danger: danger.label, score: danger.score, windows: Object.fromEntries(Object.entries(windows).map(([k,v]) => [k, v.samples])) };
};
