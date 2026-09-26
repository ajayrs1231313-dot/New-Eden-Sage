const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const scopes = read("electron/esi-scope-manifest.ts");
const eveMail = read("electron/eve-mail.ts");
const main = read("electron/main-task9.ts");
const preload = read("electron/preload.ts");
const types = read("src/types.ts");
const sageMail = read("src/SageMail.tsx");
const evePanel = read("src/EveMailPanel.tsx");
const header = read("src/CharacterCommandHeader.tsx");

for (const scope of ["esi-mail.read_mail.v1", "esi-mail.send_mail.v1", "esi-mail.organize_mail.v1"]) {
  assert.ok(scopes.includes(scope), "ESI mail scope missing: " + scope);
}

assert.ok(header.includes("onReconnect={onAddCharacter}"), "EVE Mail reconnect must reuse the character authorization flow");
assert.ok(sageMail.includes("EveMailPanel"), "Sage Mail window must embed the EVE Mail panel");
assert.ok(sageMail.includes('setChannel("eve")'), "EVE Mail top-level tab is missing");
assert.ok(evePanel.includes("getEveMailbox"), "EVE Mail inbox must load from ESI");
assert.ok(evePanel.includes("getEveMailMessage"), "EVE Mail body reading is missing");
assert.ok(evePanel.includes("sendEveMail"), "EVE Mail sending is missing");
assert.ok(evePanel.includes("markEveMailRead"), "EVE Mail read state is missing");
assert.ok(evePanel.includes("deleteEveMail"), "EVE Mail deletion is missing");
assert.ok(evePanel.includes("Reconnect character"), "Missing-scope reconnect CTA is missing");

for (const channel of ["eve-mail:mailbox", "eve-mail:message", "eve-mail:send", "eve-mail:read", "eve-mail:delete"]) {
  assert.ok(main.includes(channel), "Electron main handler missing: " + channel);
  assert.ok(preload.includes(channel), "Preload bridge missing: " + channel);
}

assert.ok(types.includes("export interface EveMailMailbox"), "Renderer EVE mailbox types missing");
assert.ok(types.includes("getEveMailbox(input:"), "Window API EVE Mail types missing");

assert.ok(eveMail.includes("/mail/labels/"), "EVE Mail label sync missing");
assert.ok(eveMail.includes("/mail/lists/"), "EVE mailing-list sync missing");
assert.ok(eveMail.includes('method: "POST"'), "EVE Mail send request missing");
assert.ok(eveMail.includes('method: "PUT"'), "EVE Mail organize/read request missing");
assert.ok(eveMail.includes('method: "DELETE"'), "EVE Mail delete request missing");
assert.ok(eveMail.includes("/universe/ids/"), "EVE Mail recipient name resolution missing");
assert.ok(eveMail.includes("escapeEveText"), "Outgoing EVE Mail text must be escaped before EVE HTML formatting");

console.log("eve mail integration smoke: PASS");
