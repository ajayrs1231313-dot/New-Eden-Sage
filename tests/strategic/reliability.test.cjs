const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const compiled = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-strategic-test-'));
process.on('exit', () => {
  if (path.dirname(path.resolve(compiled)) !== path.resolve(os.tmpdir())) throw Error('Invalid test output directory');
  fs.rmSync(compiled, { recursive: true, force: true });
});
const compiler = path.join(root, 'node_modules/typescript/bin/tsc');
execFileSync(process.execPath, [compiler, '-p', 'tsconfig.electron.json', '--outDir', path.join(compiled, 'electron')], { cwd: root, stdio: 'inherit' });
const backendSource = path.join(compiled, 'backend-input');
fs.mkdirSync(backendSource);
for (const file of ['strategic-ai.ts', 'strategic-policy.ts', 'types.ts']) fs.copyFileSync(path.join(root, 'backend/src', file), path.join(backendSource, file));
fs.copyFileSync(path.join(root, 'backend/worker-configuration.d.ts'), path.join(backendSource, 'worker-configuration.d.ts'));
fs.writeFileSync(path.join(backendSource, 'package.json'), '{"type":"commonjs"}');
fs.writeFileSync(path.join(backendSource, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
  target: 'ES2022', module: 'Node16', moduleResolution: 'Node16', skipLibCheck: true,
  strict: true, rootDir: '.', outDir: '../backend/src', lib: ['ES2022', 'WebWorker'],
}, include: ['*.ts'] }));
execFileSync(process.execPath, [compiler, '-p', path.join(backendSource, 'tsconfig.json')], { cwd: root, stdio: 'inherit' });

// Load current TS sources with explicit dependency fakes, never real accounts or services.
function load(file, mocks = {}) {
  const filename = path.join(root, file);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = mod.require.bind(mod);
  mod.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  mod._compile(fs.readFileSync(path.join(compiled, file.replace(/\.ts$/, '.js')), 'utf8'), filename);
  return mod.exports;
}

const router = load('electron/strategic-router.ts');
const facts = load('electron/strategic-facts.ts', { './strategic-router': router });
const timing = load('electron/strategic-timing.ts');
const factualHulls = [{ name: 'Ishtar', group: { name: 'Heavy Assault Cruiser' }, characterRequirementCheck: { missing: [{ skillId: 123, name: 'Gallente Cruiser', level: 5 }] } }];
assert.match(facts.answerShipFacts('Can AJDEATHGIVER fly Ishtar?', 'AJDEATHGIVER', factualHulls), /Missing: Gallente Cruiser 5/);
assert.equal(facts.answerShipFacts('Can AJDEATHGIVER fly Ishtar in the new event?', 'AJDEATHGIVER', factualHulls), undefined);
assert.equal(facts.answerShipFacts('Can AJDEATHGIVER fly Ishtar and what fit should I use?', 'AJDEATHGIVER', factualHulls), undefined);
const context = { characterNames: ['AJDEATHGIVER', 'Nedoode'] };
for (const prompt of [
  'Find AJDEATHGIVER the best ship and fit for very fast tackle that can hold a hostile target until the corporation arrives in 3-5 minutes.',
  'Run a broad search over realistic tackle ships and fits for AJDEATHGIVER. Priorities: lock quickly, establish tackle fast, survive focused fire.',
  'I want the strongest practical brick-tackle fit AJDEATHGIVER can use or train into within seven days.',
]) {
  const plan = router.planStrategicRequest(prompt, context);
  assert.equal(plan.route, 'fit_build');
  assert.ok(plan.allowedTools.includes('simulate_sage_fit'));
  assert.ok(!plan.allowedTools.includes('optimise_sage_fit'));
  assert.equal(plan.allowWeb, false);
  assert.equal(plan.requestBudgetMs, 900000);
}
assert.deepEqual(router.planStrategicRequest('What ship is AJDEATHGIVER currently in?', context).requiredCharacterSections, ['ship', 'location']);
assert.equal(router.planStrategicRequest('which of those will AJDEATHGIVER be able to do in an Ishtar or Gila', {
  ...context, history: [{ role: 'user', content: 'Show me ships that can do the new event thing' }],
}).route, 'live_research');
assert.equal(router.mentionsName('autocannon', 'Ann'), false);
assert.equal(router.mentionsName('Use [A.B] please', '[A.B]'), true);
assert.equal(router.planStrategicRequest('Hi', context).route, 'knowledge');
for (const message of ['Compare all our market opportunities', 'Give me a comprehensive industry plan', 'Research everything about the new event', 'Give me a strategic overview of the corporation']) {
  const plan = router.planStrategicRequest(message, context);
  assert.equal(plan.requestBudgetMs, 900000);
  assert.equal(plan.modelTier, 'reasoning');
  assert.ok(plan.allowedTools.length > 0);
}
const fitEstimate = timing.estimateStrategicDuration(router.planStrategicRequest('Compare thousands of fits'), 'Compare thousands of fits');
const marketEstimate = timing.estimateStrategicDuration(router.planStrategicRequest('Compare market prices'), 'Compare market prices');
assert.notEqual(fitEstimate.upperMs, marketEstimate.upperMs);
assert.ok(fitEstimate.upperMs < 900000);
const learned = timing.estimateStrategicDuration(router.planStrategicRequest('Compare market prices'), 'Compare market prices',
  Array.from({ length: 3 }, () => ({ route: 'market', broad: true, elapsedMs: 40000, complexity: 1 })));
assert.equal(learned.learned, true);
assert.ok(learned.upperMs < marketEstimate.upperMs);
assert.match(timing.remainingWorkEstimate(100, 1000, 10000), /left for this batch/);

const optimizer = load('electron/fitting-optimizer.ts', {
  './fitting-dogma': { getFittingCatalogueLocal: async () => ({ items: [] }) }, './mcp-fitting': {},
  './strategic-timing': timing,
});
const rack = [];
optimizer.fillRack(rack, 4, [undefined, undefined]);
assert.deepEqual(rack, []);
optimizer.fillRack(rack, 4, [undefined, 'Damage Control I']);
assert.equal(rack.length, 4);

const policy = load('backend/src/strategic-policy.ts');
const backend = load('backend/src/strategic-ai.ts', { './strategic-policy': policy });
const env = { SAGE_AI_API_KEY: 'test-only', SAGE_AI_ENDPOINT: 'https://invalid.test', SAGE_AI_MODEL: 'fake',
  DB: { prepare: () => ({ bind() { return this; }, first: async () => null, run: async () => ({}) }) },
};

async function run() {
  await assert.rejects(() => optimizer.optimiseSageFit({ characterId: '1', hulls: ['Praxis'] }, { getSnapshot: () => null }), /Synced character skills/);
  for (const status of [400, 401, 403]) {
    let calls = 0;
    global.fetch = async () => { calls++; return Response.json({ message: 'Permanent failure' }, { status }); };
    await assert.rejects(() => backend.callSageAi(env, {}), /Permanent failure/);
    assert.equal(calls, 1, 'Permanent failures must not be retried');
  }
  let calls = 0;
  global.fetch = async () => { calls++; return Response.json({ message: 'Busy' }, { status: 429, headers: { 'retry-after': '60' } }); };
  const before = Date.now();
  await assert.rejects(() => backend.callSageAi(env, {}), /Busy/);
  assert.equal(calls, 1);
  assert.ok(Date.now() - before < 1000);
  calls = 0;
  global.fetch = async () => ++calls === 1 ? Response.json({}, { status: 503 }) : Response.json({ choices: [] });
  await backend.callSageAi(env, {});
  assert.equal(calls, 2);
  global.fetch = async () => Response.json({}, { status: 503 });
  await assert.rejects(() => backend.callSageAi(env, {}, AbortSignal.timeout(20)), /timeout/i);
  global.fetch = async () => Response.json({ message: 'Bearer fake-secret-value' }, { status: 400 });
  const reply = await backend.handleStrategicAi(new Request('https://invalid.test', {
    method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'Build a fit' }] }),
  }), env, { accountId: '569399317', sessionId: 'test' });
  const failed = await reply.json();
  assert.equal(reply.status, 502);
  assert.match(failed.request_id, /^sai_/);
  assert.ok(!failed.message.includes('fake-secret-value'));
  let backupInput;
  global.fetch = async () => Response.json({ message: 'Busy' }, { status: 429, headers: { 'retry-after': '60' } });
  const backedUp = await backend.handleStrategicAi(new Request('https://invalid.test', {
    method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'Build a fit' }], tools: [{ type: 'function', function: { name: 'simulate_sage_fit' } }] }),
  }), { ...env, AI: { run: async (_model, input, options) => {
    backupInput = input;
    assert.ok(options.signal instanceof AbortSignal);
    return { choices: [{ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'simulate_sage_fit', arguments: '{}' } }] } }] };
  } } }, { accountId: '569399317', sessionId: 'test' });
  assert.equal(backedUp.status, 200);
  assert.equal(backupInput.tools[0].function.name, 'simulate_sage_fit');
  assert.equal((await backedUp.json()).result.choices[0].message.tool_calls.length, 1);

  let token = 'session-one', instance, connects = 0, rosterReads = 0;
  const invoked = [], requests = [];
  let responseMode = 'normal';
  class Client {
    constructor() { instance = this; }
    async connect() { connects++; }
    async listTools() { return { tools: ['simulate_sage_fit', 'dangerous_tool'].map(name => ({ name, inputSchema: {}, annotations: { readOnlyHint: true } })) }; }
    async callTool({ name, arguments: args }) {
      invoked.push(name);
      if (name === 'list_characters') { rosterReads++; return { structuredContent: { data: [{ characterId: '1', name: 'AJDEATHGIVER' }] } }; }
      if (name === 'get_character_data') return { structuredContent: { data: { characterId: '1', section: args.section, data: args.section === 'skills' ? { skills: [{ skill_id: 123, name: 'Gallente Cruiser', active_skill_level: 4 }] } : { ship_type_name: 'Gila' } } } };
      return { structuredContent: { data: { measured: true } } };
    }
  }
  const desktop = load('electron/strategic-command.ts', {
    '@modelcontextprotocol/sdk/client/index.js': { Client },
    '@modelcontextprotocol/sdk/client/stdio.js': { StdioClientTransport: class {} },
    './config': { readConfig: async () => ({ encryptedSageSessionToken: token }), decrypt: value => value },
    './sage-online': { SAGE_ONLINE_URL: 'https://invalid.test' },
    './mcp-launch': { sageMcpLaunch: () => ({ command: 'fake', args: [], env: {} }) },
    './mcp-ai-policy': { SAGE_MCP_AI_INSTRUCTIONS: '' },
    './strategic-router': router,
    './strategic-facts': facts,
    './strategic-timing': timing,
    './data-paths': { USER_DATA_ROOT: path.join(compiled, 'telemetry') },
    './fitting-dogma': {
      getFittingCatalogueLocal: async () => ({ items: [{ id: 42, rootName: 'Ships', name: 'Ishtar' }] }),
      getFittingTypeInfoLocal: async () => ({ typeId: 42, name: 'Ishtar', group: { name: 'Heavy Assault Cruiser' }, requirements: [{ skillId: 123, level: 5 }] }),
    },
  });
  global.fetch = async (url, options) => {
    if (url.endsWith('failure-report')) return Response.json({ ok: true });
    const body = JSON.parse(options.body); requests.push(body);
    if (responseMode === 'error') return Response.json({ request_id: 'sai_failed', message: 'Busy' }, { status: 502 });
    const message = responseMode === 'loop' ? { tool_calls: [{ id: 'call', function: { name: 'simulate_sage_fit', arguments: '{}' } }] }
      : responseMode === 'unsolicited' && body.tools ? { tool_calls: [{ id: 'call', function: { name: 'dangerous_tool', arguments: '{}' } }] }
      : { content: 'Verified answer' };
    return Response.json({ request_id: 'sai_test', developer_mode: true, result: { choices: [{ message }] } });
  };
  const direct = await desktop.askStrategicCommand({ message: 'Can AJDEATHGIVER fly Ishtar?' });
  assert.equal(requests.length, 0);
  assert.match(direct.answer, /does not meet the hull requirements/);
  await desktop.askStrategicCommand({ message: 'Explain whether AJDEATHGIVER can fly Ishtar and what to train next.' });
  const evidence = requests.at(-1).messages.find(item => item.content.startsWith('PRELOADED')).content;
  assert.match(evidence, /"missing":\[\{"skillId":123,"level":5\}\]/);
  assert.ok(requests.at(-1).timeout_ms > 120_000);
  await desktop.askStrategicCommand({ message: 'Hi' });
  assert.equal(rosterReads, 1);
  instance.onclose();
  await desktop.askStrategicCommand({ message: 'Hi' });
  assert.equal(connects, 2);
  assert.equal(rosterReads, 2);
  token = 'session-two';
  await desktop.askStrategicCommand({ message: 'Hi' });
  assert.equal(rosterReads, 3);
  responseMode = 'loop';
  const priorCount = requests.length;
  await assert.rejects(() => desktop.askStrategicCommand({ message: 'Build AJDEATHGIVER a tackle fit' }), /tool limit/);
  assert.equal(requests.length - priorCount, 7, 'Owner requests must also stop at a hard round limit');
  responseMode = 'unsolicited';
  await desktop.askStrategicCommand({ message: 'Build AJDEATHGIVER a tackle fit' });
  assert.ok(!invoked.includes('dangerous_tool'));
  responseMode = 'error';
  await assert.rejects(() => desktop.askStrategicCommand({ message: 'Hi' }), error => error.sageDiagnostics.requestId === 'sai_failed');
  console.log('PASS: failed log prompts, fitting termination, bounded retries, request correlation, evidence, reconnect, cache isolation and tool limits');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
