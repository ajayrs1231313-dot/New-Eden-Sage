const assert = require('node:assert/strict');
const { generateFitSearchCandidates, searchSageFits, rankSearchCandidate, registerSageFitSearch } = require('../../dist-electron/fitting-search.js');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const dogma = require('../../dist-electron/fitting-dogma.js');
const seed = { name: 'Search benchmark', hull: { name: 'Praxis' }, low: Array.from({ length: 5 }, () => ({ name: 'Damage Control I', quantity: 1 })) };
const input = { characterId: '1', seeds: [seed], variations: Array.from({ length: 5 }, (_, slot) => ({ seedIndex: 0, rack: 'low', slot,
  options: Array.from({ length: 8 }, (_, choice) => ({ name: `Option-${slot}-${choice}`, quantity: 1 })) })), candidateLimit: 5000 };

(async () => {
  const generated = generateFitSearchCandidates(input);
  assert.equal(generated.candidates.length, 5000);
  assert.equal(generated.combinations, '32768');
  assert.deepEqual(generateFitSearchCandidates(input).candidates.map(fit => fit.low), generated.candidates.map(fit => fit.low));
  assert.throws(() => generateFitSearchCandidates({ ...input, variations: [input.variations[0], input.variations[0]] }), /one variation axis/);
  let batches = 0;
  const progress = [];
  const run = await searchSageFits(input, { getSnapshot: () => ({}), getSavedFits: async () => [] }, {
    progress: async (completed, total) => progress.push({ completed, total }),
    simulate: async ({ fits }) => {
      batches++;
      assert.ok(fits.length <= 100);
      return { results: fits.map((_, index) => ({ index, success: true, data: { analysis: {
        damage: { totalDps: batches * 100 + index }, issues: [], missingRequirements: [],
      } } })) };
    },
  });
  assert.equal(batches, 50);
  assert.equal(run.simulated, 5000);
  assert.equal(run.top.length, 10);
  assert.equal(run.partial, false);
  assert.deepEqual(progress.at(-1), { completed: 5000, total: 5000 });
  assert.equal(rankSearchCandidate({ issues: [], missingRequirements: [], supportSystems: [] }, 'tackle').legal, false);
  const cancel = new AbortController();
  const partial = await searchSageFits(input, {}, { signal: cancel.signal,
    progress: async (completed) => { if (completed >= 100) cancel.abort(); },
    simulate: async ({ fits }) => ({ results: fits.map((_, index) => ({ index, success: false, error: 'fixture' })) }),
  });
  assert.equal(partial.simulated, 100);
  assert.equal(partial.partial, true);

  // Real DOGMA engine benchmark (set SAGE_FIT_BENCHMARK_COUNT=1000 for the stress run),
  // with a synthetic pilot and no network requests or account mutations.
  const groups = [
    ['Damage Control I', 'Damage Control II', 'Drone Damage Amplifier I', 'Ballistic Control System I'],
    ['Capacitor Flux Coil I', 'Capacitor Flux Coil II', 'Capacitor Power Relay I', 'Capacitor Power Relay II'],
    ['Power Diagnostic System I', 'Power Diagnostic System II', 'Reactor Control Unit I', 'Reactor Control Unit II'],
    ['Co-Processor I', 'Co-Processor II', 'Signal Amplifier I', 'Signal Amplifier II'],
    ['Nanofiber Internal Structure I', 'Nanofiber Internal Structure II', 'Overdrive Injector System I', 'Overdrive Injector System II'],
  ];
  const types = await dogma.resolveFittingTypeNamesLocal([...groups.flat(), 'CPU Management', 'Power Grid Management', 'Praxis']);
  assert.equal(types.length, 23);
  const levels = new Map();
  for (const type of types) {
    const info = await dogma.getFittingTypeInfoLocal(type.id);
    for (const requirement of info.requirements) levels.set(requirement.skillId, 5);
    if (['CPU Management', 'Power Grid Management'].includes(type.name)) levels.set(type.id, 5);
  }
  const snapshot = { character: { name: 'Search test pilot' }, skills: { skills: [...levels].map(([skill_id, level]) => ({ skill_id, active_skill_level: level, trained_skill_level: level })) }, extended: { implants: [] } };
  const benchmarkCount = Number(process.env.SAGE_FIT_BENCHMARK_COUNT) || 100;
  const actual = await searchSageFits({ ...input, candidateLimit: benchmarkCount, objective: 'tank',
    variations: groups.map((names, slot) => ({ seedIndex: 0, rack: 'low', slot, options: names.map(name => ({ name, quantity: 1, state: 'online' })) })),
  }, { getSnapshot: () => snapshot, getSavedFits: async () => [] });
  assert.equal(actual.simulated, benchmarkCount);
  assert.equal(actual.partial, false);
  assert.equal(actual.failed, 0);
  assert.ok(actual.legal > 0, JSON.stringify(actual.rejectionSamples[0]));
  assert.ok(actual.top[0].metrics.ehp > 0);
  const server = new McpServer({ name: 'search-test', version: '1' });
  registerSageFitSearch(server, { getSnapshot: () => snapshot, getSavedFits: async () => [] }, data => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: { data } }));
  const client = new Client({ name: 'search-client-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  let notifications = 0;
  try {
    const result = await client.callTool({ name: 'search_sage_fits', arguments: { characterId: '1', seeds: [seed], variations: [], candidateLimit: 2 } }, undefined,
      { timeout: 900000, onprogress: () => notifications++ });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.data.simulated, 1);
    assert.ok(notifications >= 2, 'Progress must reach MCP clients over the real SDK transport');
  } finally { await client.close(); await server.close(); }
  console.log(JSON.stringify({ simulated: actual.simulated, legal: actual.legal, durationMs: actual.durationMs, candidatesPerSecond: Math.round(actual.simulated / (actual.durationMs / 1000)) }));
  console.log(`PASS: 5000-candidate batching, diversity, progress, partial cancellation, legality and ${benchmarkCount} real fitter simulations`);
})().catch(error => { console.error(error); process.exitCode = 1; });
