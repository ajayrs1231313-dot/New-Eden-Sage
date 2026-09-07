const path = require('node:path');

function parseConsoleSessionId(output) {
  for (const rawLine of String(output || '').split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*>?\s*/, '').trim();
    if (!/^console\s+/i.test(line)) continue;
    const parts = line.split(/\s+/);
    const id = Number(parts.find((part, index) => index > 0 && /^\d+$/.test(part)));
    if (Number.isInteger(id) && id >= 0) return id;
  }
  return null;
}

function resolveDevUserData({ platform, sessionId, appDataRoot, fallbackRoot }) {
  const base = appDataRoot || fallbackRoot;
  const established = path.join(base, 'new-eden-sage-dev');
  if (platform !== 'win32' || !Number.isInteger(sessionId)) return established;

  // Chromium ProcessSingleton is not safe to share across Windows sessions.
  // The dev stack can be started both from the interactive desktop and from
  // service/automation sessions, so every Windows session gets its own profile.
  // Sage settings/data still live in NEW_EDEN_SAGE_USER_DATA and the launcher
  // synchronizes the safeStorage key, so this isolation does not fork user data.
  return path.join(base, `new-eden-sage-dev-session-${sessionId}`);
}

module.exports = { parseConsoleSessionId, resolveDevUserData };
