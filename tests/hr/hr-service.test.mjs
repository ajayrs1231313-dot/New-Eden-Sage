import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { LocalHrApplicationService, buildHrApplicantSnapshot, HR_DATA_CATEGORIES } = require("../../dist-electron/hr-service.js");

function fixtureSnapshot() {
  return {
    characterId: "90000001",
    snapshotState: "synced",
    updatedAt: "2026-09-09T20:00:00.000Z",
    character: {
      name: "Applicant One",
      corporation_id: 1234,
      corporation_name: "Applicant Corp",
      alliance_id: 5678,
      security_status: 1.2,
      corporation_history: [{ corporation_id: 111, start_date: "2026-01-01T00:00:00Z" }],
      access_token: "must-not-leak",
    },
    wallet: 50000000,
    skills: { total_sp: 25000000, skills: [{ skill_id: 1, name: "Test Skill", trained_skill_level: 5 }] },
    ship: { ship_type_id: 587, ship_type_name: "Rifter" },
    extended: {
      contacts: [{ contact_id: 42, standing: 5 }],
      standings: [{ from_id: 99, standing: 2 }],
      killmailDetails: [{ killmail_id: 100, detail: { attackers: [] } }],
      walletJournal: [{ id: 1, amount: 1000, refresh_token: "nope" }],
      walletTransactions: [{ transaction_id: 2 }],
      contracts: [{ contract_id: 3 }],
      contractItems: [{ contractId: 3, items: [] }],
      assets: [{ item_id: 4, item: "Rifter", station: "Jita IV - Moon 4" }],
      assetSummary: { totalValue: 1 },
      notifications: [{ notification_id: 5 }],
      marketOrders: [{ order_id: 6 }],
      industryJobs: [{ job_id: 7 }],
      fittings: [{ fitting_id: 8, name: "Fit" }],
      currentShipFit: [],
      mail: { headers: [{ mail_id: 90, from: 77, subject: "Recruitment chat", timestamp: "2026-09-09T19:00:00Z", is_read: true, recipients: [{ recipient_id: 90000001, recipient_type: "character" }] }], details: [{ mailId: 90, detail: { from: 77, subject: "Recruitment chat", body: "Hello capsuleer", timestamp: "2026-09-09T19:00:00Z", recipients: [{ recipient_id: 90000001, recipient_type: "character" }] } }], labels: { labels: [] }, mailingLists: [], coverage: { headersCaptured: 1, bodiesCaptured: 1, headerLimit: 250, bodyLimit: 100 } },
    },
  };
}

function request(overrides = {}) {
  return {
    applicationId: "application-1",
    codeHash: "hash",
    codeHint: "ABC123",
    corporationId: 999,
    corporationName: "Recruiting Corp",
    recruiterCharacterId: "88",
    recruiterName: "Recruiter",
    requestedCategories: ["identity", "skills", "wallet", "mail"],
    createdAt: "2026-09-10T00:00:00.000Z",
    expiresAt: "2026-09-17T00:00:00.000Z",
    status: "awaiting-applicant",
    ...overrides,
  };
}

async function serviceHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sage-hr-test-"));
  const service = new LocalHrApplicationService(path.join(dir, "hr.json"));
  return { service, dir };
}

test("Mail is an explicit supported read-only HR category", () => {
  const mail = HR_DATA_CATEGORIES.find((row) => row.id === "mail");
  assert.ok(mail);
  assert.equal(mail.supported, true);
  assert.equal(mail.source, "esi-private");
  const eve = fs.readFileSync(new URL("../../electron/eve.ts", import.meta.url), "utf8");
  assert.match(eve, /esi-mail\.read_mail\.v1/);
  assert.doesNotMatch(eve, /esi-mail\.(?:send_mail|organize_mail)\.v1/);
  assert.match(eve, /captureMailHeaders\(250\)/);
  assert.match(eve, /slice\(0, 100\)/);
});

test("application codes are unique, expiring, revocable and single-use", async () => {
  const { service } = await serviceHarness();
  const base = { corporationId: 999, corporationName: "Recruiting Corp", recruiterCharacterId: "88", recruiterName: "Recruiter", requestedCategories: ["identity", "skills"] };
  const a = await service.createRequest(base, new Date("2026-09-10T00:00:00Z"));
  const b = await service.createRequest(base, new Date("2026-09-10T00:00:00Z"));
  assert.notEqual(a.applicationCode, b.applicationCode);
  assert.notEqual(a.request.applicationId, b.request.applicationId);

  const expiring = await service.createRequest({ ...base, expiresInHours: 1 }, new Date("2026-09-10T00:00:00Z"));
  await assert.rejects(() => service.resolveCode(expiring.applicationCode, new Date("2026-09-10T02:00:00Z")), /expired/i);

  const revoked = await service.createRequest(base, new Date("2026-09-10T00:00:00Z"));
  await service.revokeRequest(revoked.request.applicationId, 999, new Date("2026-09-10T00:30:00Z"));
  await assert.rejects(() => service.resolveCode(revoked.applicationCode, new Date("2026-09-10T00:31:00Z")), /revoked/i);

  await service.submitSnapshot({ code: a.applicationCode, characterSnapshot: fixtureSnapshot(), selectedCategories: ["identity", "skills"], submissionMethod: "sage-desktop", now: new Date("2026-09-10T00:10:00Z") });
  await assert.rejects(() => service.submitSnapshot({ code: a.applicationCode, characterSnapshot: fixtureSnapshot(), selectedCategories: ["identity"], submissionMethod: "sage-desktop", now: new Date("2026-09-10T00:11:00Z") }), /already been used/i);
});

test("requested, provided, withheld and unavailable are distinct states", () => {
  const report = buildHrApplicantSnapshot({ request: request(), characterSnapshot: fixtureSnapshot(), selectedCategories: ["identity", "wallet", "mail"], submissionMethod: "sage-desktop", now: new Date("2026-09-10T00:05:00Z") });
  assert.deepEqual(report.withheldCategories, ["skills"]);
  assert.ok(report.providedCategories.includes("identity"));
  assert.ok(report.providedCategories.includes("wallet"));
  assert.ok(report.providedCategories.includes("mail"));
  assert.equal(report.sections.find((row) => row.categoryId === "skills")?.state, "withheld");
  assert.equal(report.sections.find((row) => row.categoryId === "mail")?.state, "provided");
  assert.match(report.reviewFlags.find((row) => row.id.includes("skills-withheld"))?.detail ?? "", /consent choice/i);

  const withoutMail = fixtureSnapshot(); delete withoutMail.extended.mail;
  const unavailable = buildHrApplicantSnapshot({ request: request(), characterSnapshot: withoutMail, selectedCategories: ["mail"], submissionMethod: "sage-desktop", now: new Date("2026-09-10T00:05:00Z") });
  assert.equal(unavailable.sections.find((row) => row.categoryId === "mail")?.state, "unavailable");
  assert.ok(unavailable.unavailableCategories.includes("mail"));
});

test("desktop HR snapshots use the completed schema v2 deterministically", () => {
  const common = { request: request(), characterSnapshot: fixtureSnapshot(), selectedCategories: ["identity", "skills", "mail"], submissionMethod: "sage-desktop", now: new Date("2026-09-10T00:05:00Z") };
  const a = buildHrApplicantSnapshot(common);
  const b = buildHrApplicantSnapshot(common);
  assert.equal(a.schemaVersion, 2);
  assert.equal(a.submissionMethod, "sage-desktop");
  assert.deepEqual(a, b);
});

test("evidence-backed review signals stay tied to captured data", () => {
  const snapshot = fixtureSnapshot();
  snapshot.updatedAt = "2026-09-08T00:00:00.000Z";
  snapshot.character.security_status = -6.2;
  snapshot.character.corporation_history = [
    { corporation_id: 1, start_date: "2026-09-09T00:00:00Z" }, { corporation_id: 2, start_date: "2026-08-20T00:00:00Z" },
    { corporation_id: 3, start_date: "2026-07-20T00:00:00Z" }, { corporation_id: 4, start_date: "2026-06-20T00:00:00Z" },
  ];
  snapshot.extended.killmailDetails = Array.from({ length: 8 }, (_, i) => ({ killmail_id: 100 + i, detail: { victim: { character_id: 90000001 }, attackers: [] } }));
  snapshot.extended.walletJournal = [
    { id: 1, ref_type: "player_donation", amount: -600000000, second_party_id: 555 },
    { id: 2, ref_type: "player_donation", amount: -500000000, second_party_id: 555 },
  ];
  const report = buildHrApplicantSnapshot({ request: request({ requestedCategories: ["identity", "corporation-history", "kill-loss", "wallet"] }), characterSnapshot: snapshot, selectedCategories: ["identity", "corporation-history", "kill-loss", "wallet"], submissionMethod: "sage-desktop", now: new Date("2026-09-10T00:05:00Z") });
  const labels = report.reviewFlags.map((flag) => flag.label);
  assert.ok(labels.includes("Very low security status"));
  assert.ok(labels.includes("Frequent recent corporation changes"));
  assert.ok(labels.includes("High recent loss volume"));
  assert.ok(labels.includes("Repeated large player transfers"));
  assert.ok(labels.includes("Source snapshot is over 24 hours old"));
  for (const flag of report.reviewFlags.filter((row) => row.severity === "review")) {
    assert.ok(flag.evidenceIds.length > 0);
    for (const evidenceId of flag.evidenceIds) assert.ok(report.evidence.some((item) => item.id === evidenceId));
  }
});

test("submitted factual snapshot stays immutable while recruiter notes and decisions change separately", async () => {
  const { service } = await serviceHarness();
  const created = await service.createRequest({ corporationId: 999, corporationName: "Recruiting Corp", recruiterCharacterId: "88", recruiterName: "Recruiter", requestedCategories: ["identity", "skills"] }, new Date("2026-09-10T00:00:00Z"));
  const submitted = await service.submitSnapshot({ code: created.applicationCode, characterSnapshot: fixtureSnapshot(), selectedCategories: ["identity", "skills"], submissionMethod: "sage-desktop", now: new Date("2026-09-10T00:05:00Z") });
  const original = JSON.stringify(submitted.snapshot);
  await service.addRecruiterNote(created.request.applicationId, 999, { recruiterCharacterId: "88", recruiterName: "Recruiter", text: "Review employment timeline." }, new Date("2026-09-10T00:06:00Z"));
  const decided = await service.setDecision(created.request.applicationId, 999, { status: "under-review", recruiterCharacterId: "88", recruiterName: "Recruiter" }, new Date("2026-09-10T00:07:00Z"));
  assert.equal(JSON.stringify(decided.snapshot), original);
  assert.equal(decided.notes.length, 1);
  assert.equal(decided.request.status, "under-review");
});

test("HR reports scrub token-like fields and the HR service has no refresh dependency", () => {
  const report = buildHrApplicantSnapshot({ request: request(), characterSnapshot: fixtureSnapshot(), selectedCategories: ["identity", "wallet"], submissionMethod: "sage-desktop", now: new Date("2026-09-10T00:05:00Z") });
  const encoded = JSON.stringify(report);
  assert.doesNotMatch(encoded, /must-not-leak|nope/);
  const source = fs.readFileSync(new URL("../../electron/hr-service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /refreshEveToken|fetchCharacterSnapshot|setInterval|setTimeout/);
  assert.doesNotMatch(source, /from ["']\.\/eve["']/);
});

test("desktop-to-desktop HR transport is server-backed and does not refresh applicant ESI", () => {
  const online = fs.readFileSync(new URL("../../electron/hr-online.ts", import.meta.url), "utf8");
  const main = fs.readFileSync(new URL("../../electron/main-task9.ts", import.meta.url), "utf8");
  const backendHr = fs.readFileSync(new URL("../../backend/src/hr.ts", import.meta.url), "utf8");
  const migration = fs.readFileSync(new URL("../../backend/migrations/0010_corporation_hr.sql", import.meta.url), "utf8");
  assert.match(online, /\/v1\/hr\/applications\/resolve/);
  assert.match(online, /\/v1\/hr\/applications\/submit/);
  assert.match(online, /hr\/applications\/\$\{encodeURIComponent\(applicationId\)\}\/notes/);
  assert.doesNotMatch(online, /refreshEveToken|X-EVE-Access-Token/);
  const submitHandler = main.slice(main.indexOf('ipcMain.handle("corp:hr-submit-snapshot"'), main.indexOf('ipcMain.handle("corp:hr-withdraw"')); 
  assert.match(submitHandler, /getSnapshot/);
  assert.match(submitHandler, /buildHrApplicantSnapshot/);
  assert.doesNotMatch(submitHandler, /refreshEveToken|fetchCharacterSnapshot/);
  assert.match(backendHr, /snapshot_json IS NULL/);
  assert.match(backendHr, /snapshot_sha256/);
  assert.match(backendHr, /eve_identities WHERE account_id=\?1 AND character_id=\?2/);
  assert.match(backendHr, /code_hash/);
  assert.match(migration, /corporation_hr_applications/);
  assert.match(migration, /hr\.manage/);
  assert.match(migration, /hr\.review/);
});

test("HR management permissions are registered in the existing corporation permission architecture", () => {
  const backend = fs.readFileSync(new URL("../../backend/src/index.ts", import.meta.url), "utf8");
  assert.match(backend, /key: "hr\.manage"/);
  assert.match(backend, /key: "hr\.review"/);
  assert.match(backend, /hasPermission\(env, workspaceId, principal\.accountId, "hr\.manage"/);
  assert.match(backend, /hasPermission\(env, workspaceId, principal\.accountId, "hr\.review"/);
});
