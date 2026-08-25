const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const repo = path.resolve(__dirname, '..');
const resultPath = path.join(repo, 'tools', '.master-update-smoke-result.json');
const progressPath = path.join(repo, 'tools', '.master-update-smoke-progress.log');
const userData = path.join(process.env.APPDATA || process.env.LOCALAPPDATA || repo, 'new-eden-sage');

app.setName('New Eden Sage');
app.setPath('userData', userData);
process.env.NEW_EDEN_SAGE_USER_DATA = userData;

for (const target of [resultPath, progressPath]) {
  try { fs.rmSync(target, { force: true }); } catch {}
}
fs.writeFileSync(progressPath, `${new Date().toISOString()} bootstrap userData=${userData}\n`, 'utf8');

function append(value) {
  fs.appendFileSync(progressPath, `${new Date().toISOString()} ${JSON.stringify(value)}\n`, 'utf8');
}

app.whenReady().then(async () => {
  try {
    const { runMasterUpdate } = require(path.join(repo, 'dist-electron', 'master-update.js'));
    const result = await runMasterUpdate((progress) => append(progress));
    const payload = { ok: true, finishedAt: new Date().toISOString(), result };
    fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    const payload = { ok: false, finishedAt: new Date().toISOString(), error: error instanceof Error ? error.stack || error.message : String(error) };
    fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8');
  } finally {
    app.quit();
  }
}).catch((error) => {
  fs.writeFileSync(resultPath, JSON.stringify({ ok: false, error: error instanceof Error ? error.stack || error.message : String(error) }, null, 2), 'utf8');
  app.quit();
});
