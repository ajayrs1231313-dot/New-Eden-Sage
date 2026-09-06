import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const server = await readFile(new URL('../../electron/mcp-server.ts', import.meta.url), 'utf8');
const bridge = await readFile(new URL('../../electron/mcp-write-bridge.ts', import.meta.url), 'utf8');
const policy = await readFile(new URL('../../electron/mcp-ai-policy.ts', import.meta.url), 'utf8');

for (const name of ['list_sage_controls', 'invoke_sage_control', 'list_sage_actions', 'invoke_sage_action']) {
  assert.ok(server.includes(`server.registerTool("${name}"`), `MCP must register ${name}`);
  assert.ok(bridge.includes(`"${name}"`), `write bridge must support ${name}`);
}

assert.match(bridge, /data-sage-mcp-control-id/, 'live controls must receive MCP control IDs');
assert.match(bridge, /includeHidden/, 'control discovery must support hidden cached Sage views');
assert.match(bridge, /button[\s\S]*input[\s\S]*select[\s\S]*textarea/, 'control discovery must cover standard actionable elements');
assert.match(bridge, /Object\.keys\(sage\).*typeof sage\[name\] === "function"/s, 'renderer actions must be discovered dynamically from the complete Sage bridge');
assert.match(bridge, /sage\[input\.actionName\]\(\.\.\.input\.args\)/, 'generic action invocation must call the exact discovered Sage action');
assert.match(bridge, /HTMLInputElement\.prototype[\s\S]*"value"[\s\S]*dispatchValueEvents/s, 'React-compatible native input updates must dispatch value events');
assert.match(policy, /complete generic Sage control surface/i, 'AI policy must advertise complete generic Sage control access');
assert.match(policy, /Do not claim a Sage control or action is unavailable until these generic discovery paths have been checked/i);

console.log('MCP control surface regression checks passed');
