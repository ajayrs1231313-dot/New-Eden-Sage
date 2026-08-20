const suites = [
  ['route-engine', require('./route-engine.test.cjs')],
  ['intelligence', require('./intelligence.test.cjs')],
  ['eve-export', require('./eve-export.test.cjs')],
  ['capital', require('./capital.test.cjs')],
  ['end-to-end', require('./end-to-end.test.cjs')],
];

(async () => {
  const results = {};
  for (const [name, run] of suites) {
    const started = Date.now();
    results[name] = await run();
    results[name].durationMs = Date.now() - started;
    console.log(`PASS ${name} (${results[name].durationMs} ms)`);
  }
  console.log(JSON.stringify(results, null, 2));
  console.log('NAVIGATION TASKS 42-46 TEST SUITE: PASS');
})().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
