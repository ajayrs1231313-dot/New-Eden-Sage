const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const header = read("src/CharacterCommandHeader.tsx");
const mailUi = read("src/SageMail.tsx");
const preload = read("electron/preload.ts");
const main = read("electron/main-task9.ts");
const doctrines = read("src/CorporationDoctrines.tsx");
const backend = read("backend/src/mail.ts");
const migration = read("backend/migrations/0011_sage_mail.sql");

assert.ok(header.includes("<SageMailButton"), "Reserved header slot must host Sage Mail");
assert.ok(!header.includes(">Reserved<"), "Reserved placeholder must no longer render");
assert.ok(header.includes("characterId={snapshot?.characterId}"), "Mail button must follow the selected character");

assert.ok(mailUi.includes("getSageMailbox"), "Mail UI must load mailbox data");
assert.ok(mailUi.includes("getSageMailDirectory"), "Composer must load automatic contacts");
assert.ok(mailUi.includes("CORP"), "Corporation relationship badge missing");
assert.ok(mailUi.includes("EVE FRIEND"), "EVE contact relationship badge missing");
assert.ok(mailUi.includes("ALT"), "Linked-character relationship badge missing");
assert.ok(mailUi.includes("quotaText"), "Mailbox quota must be visible");

for (const method of ["getSageMailbox", "getSageMailDirectory", "sendSageMail", "markSageMailRead", "deleteSageMail", "sendSageDoctrineMail"]) {
  assert.ok(preload.includes(method), "Preload bridge missing " + method);
}

assert.ok(main.includes("sendSageProductionMail"), "Production completion mail is not wired");
assert.ok(main.includes("productionSinceByCharacter"), "Production mail needs the no-backfill guard");
assert.ok(main.includes("production:"), "Production notifications need stable deduplication");

assert.ok(doctrines.includes("sendSageDoctrineMail"), "Doctrine publish must send through Sage Mail");
assert.ok(doctrines.includes("doctrine:"), "Doctrine notifications need stable deduplication");

assert.ok(backend.includes('contact_type !== "character"'), "Directory must restrict EVE contacts to character contacts");
assert.ok(backend.includes("refreshPublicAffiliation"), "Corporation authorization must refresh public affiliation");
assert.ok(backend.includes("recipient_mailbox_full"), "Recipient mailbox quota must be enforced");

assert.ok(migration.includes("quota_limit INTEGER NOT NULL DEFAULT 50"), "Free character mailbox limit must default to 50");
assert.ok(migration.includes("quota_limit = -1"), "Unlimited premium sentinel must remain supported");
assert.ok(migration.includes("SAGE_MAILBOX_QUOTA_EXCEEDED"), "Database-level quota trigger missing");
assert.ok(migration.includes("owner_character_id"), "Mailbox entries must be character-specific");

console.log("sage mail integration smoke: PASS");
