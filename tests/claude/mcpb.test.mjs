import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { buildClaudeMcpbBuffer, buildClaudeMcpbManifest, claudeMcpbProxySource } from '../../electron/claude-mcpb.ts';

const launch = {
  command: 'C:\\Program Files\\New Eden Sage\\New Eden Sage.exe',
  args: ['C:\\Program Files\\New Eden Sage\\resources\\app.asar\\dist-electron\\mcp-cli.js'],
  env: { ELECTRON_RUN_AS_NODE: '1' },
};

const manifest = buildClaudeMcpbManifest({ version: '1.1.7', platform: 'win32', launch });
assert.equal(manifest.manifest_version, '0.4');
assert.equal(manifest.name, 'new-eden-sage');
assert.equal(manifest.display_name, 'New Eden Sage');
assert.equal(manifest.version, '1.1.7');
assert.equal(manifest.server.type, 'node');
assert.equal(manifest.server.entry_point, 'server/index.js');
assert.equal(manifest.server.mcp_config.command, 'node');
assert.deepEqual(manifest.server.mcp_config.args, ['${__dirname}/server/index.js']);
assert.equal(manifest.server.mcp_config.env.NEW_EDEN_SAGE_MCP_COMMAND, launch.command);
assert.equal(JSON.parse(manifest.server.mcp_config.env.NEW_EDEN_SAGE_MCP_ARGS_JSON)[0], launch.args[0]);
assert.equal(JSON.parse(manifest.server.mcp_config.env.NEW_EDEN_SAGE_MCP_ENV_JSON).ELECTRON_RUN_AS_NODE, '1');
assert.equal(manifest.tools_generated, true);
assert.deepEqual(manifest.compatibility.platforms, ['win32']);

const source = claudeMcpbProxySource();
assert.match(source, /spawn\(command, args/);
assert.match(source, /process\.stdin\.pipe\(child\.stdin\)/);
assert.match(source, /child\.stdout\.pipe\(process\.stdout\)/);
assert.match(source, /NEW_EDEN_SAGE_MCP_COMMAND/);

const packed = buildClaudeMcpbBuffer({ version: '1.1.7', platform: 'win32', launch });
assert.ok(packed.buffer.length > 0);
const zip = new AdmZip(packed.buffer);
assert.equal(zip.test(), true);
const names = zip.getEntries().map((entry) => entry.entryName).sort();
assert.deepEqual(names, ['manifest.json', 'server/index.js']);
const packedManifest = JSON.parse(zip.readAsText('manifest.json'));
assert.equal(packedManifest.manifest_version, '0.4');
assert.equal(packedManifest.name, 'new-eden-sage');
assert.equal(zip.readAsText('server/index.js'), source);

console.log(JSON.stringify({
  manifestVersion: manifest.manifest_version,
  bundleBytes: packed.buffer.length,
  entries: names,
  server: manifest.server.mcp_config.command,
}, null, 2));
console.log('CLAUDE MCPB: PASS');
