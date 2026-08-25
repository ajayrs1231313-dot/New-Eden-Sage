const assert = require('node:assert/strict');
const finder = require('../dist-electron/corporation-home-finder.js');

const now = Date.parse('2026-08-23T12:00:00Z');
const miningType = 17478;
const killmails = Array.from({ length: 5 }, (_, index) => ({
  killmailId: index + 1,
  killmailTime: new Date(now - index * 60_000).toISOString(),
  victim: { ship_type_id: miningType },
  attackers: [
    { corporation_id: 98739667, character_id: 1000 + index },
    { corporation_id: 98739667, character_id: 2000 + index },
  ],
}));

const risk = finder.summarizeHomeRisk({ backfillCompletedAt: '2026-08-23T11:00:00Z', backfillSchemaVersion: 2, killmails }, new Set([miningType]), now);
assert.equal(risk.coverage, 'complete');
assert.equal(risk.miningLosses30d, 5);
assert.equal(risk.topMiningGankCorporationId, 98739667);
assert.equal(risk.topMiningGankKillmails, 5, 'corporation should count once per killmail, not once per attacker');
assert.equal(risk.repeatedMiningGankPattern, true);

const emptyRisk = finder.summarizeHomeRisk({ backfillCompletedAt: '2026-08-23T11:00:00Z', backfillSchemaVersion: 2, killmails: [] }, new Set([miningType]), now);
const current = { shipKills: 0, podKills: 0, npcKills: 0, jumps: 20 };
const safeScore = finder.scoreHomeCandidate({ securityStatus: 0.542, stationCount: 2, moonCount: 45, pairMoonCount: 90, iceJumps: 1, relocationJumps: 18, homeRisk: emptyRisk, iceRisk: emptyRisk, currentHome: current, currentIce: current });
const hostileScore = finder.scoreHomeCandidate({ securityStatus: 0.542, stationCount: 2, moonCount: 45, pairMoonCount: 90, iceJumps: 1, relocationJumps: 18, homeRisk: risk, iceRisk: risk, currentHome: { ...current, shipKills: 5 }, currentIce: { ...current, shipKills: 5 } });
assert(safeScore > hostileScore, `expected safe score ${safeScore} to exceed hostile score ${hostileScore}`);

console.log(JSON.stringify({ repeatedGankPattern: risk.repeatedMiningGankPattern, safeScore, hostileScore }));
