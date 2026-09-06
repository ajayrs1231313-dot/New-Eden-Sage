function normalizeWindowsPath(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase();
}

function isRepoElectronMain(entry, root) {
  const pid = Number(entry?.ProcessId);
  const name = String(entry?.Name || '').toLowerCase();
  const commandLine = normalizeWindowsPath(entry?.CommandLine);
  const normalizedRoot = normalizeWindowsPath(root).replace(/\/$/, '');
  if (name !== 'electron.exe' || !Number.isInteger(pid) || pid <= 0) return false;
  if (!normalizedRoot || !commandLine.includes(normalizedRoot)) return false;
  if (/(?:^|\s)--type=/.test(commandLine)) return false;
  return commandLine.includes(normalizedRoot + '/node_modules/electron/dist/electron.exe');
}

module.exports = { isRepoElectronMain };
