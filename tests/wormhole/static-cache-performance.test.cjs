const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { gunzipSync } = require('node:zlib');

module.exports = async function wormholeStaticCachePerformance() {
  const wormhole = require('../../dist-electron/wormhole-reference.js');
  const archive = path.join('F:\\New Eden Sage Data', 'Static Data', 'eve-static-data-jsonl.zip');
  const archiveStat = fs.statSync(archive);

  await wormhole.invalidateWormholeStaticCache();
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 10);
  const coldStarted = performance.now();
  const reference = await wormhole.getWormholeReference();
  const coldMs = performance.now() - coldStarted;
  clearInterval(timer);
  delay.disable();
  const worstDelayMs = delay.max / 1e6;

  assert(reference.length >= 90, 'prepared reference should contain the CCP wormhole catalogue');
  assert(reference.some((row) => row.code === 'K162'), 'prepared reference should include K162');
  assert(ticks >= 20, 'event loop must keep ticking while the cold SDE cache is prepared');
  assert(worstDelayMs < 250, `cold cache preparation blocked the main event loop for ${worstDelayMs.toFixed(1)} ms`);
  assert(fs.existsSync(wormhole.WORMHOLE_STATIC_CACHE), 'prepared wormhole cache must be persisted');

  const cache = JSON.parse(gunzipSync(fs.readFileSync(wormhole.WORMHOLE_STATIC_CACHE)).toString('utf8'));
  assert.equal(cache.schemaVersion, 1);
  assert.equal(cache.sourceArchiveSize, archiveStat.size);
  assert.equal(cache.sourceArchiveMtimeMs, archiveStat.mtimeMs);
  assert(Array.isArray(cache.systems) && cache.systems.length >= 8000);
  assert(Array.isArray(cache.rollingTypes) && cache.rollingTypes.length > 0);

  const refStarted = performance.now();
  await wormhole.getWormholeReference();
  const referenceWarmMs = performance.now() - refStarted;

  const systemStarted = performance.now();
  const systems = await wormhole.getWormholeSystemReferences([30000142]);
  const systemWarmMs = performance.now() - systemStarted;
  assert.equal(systems[0]?.name, 'Jita');

  const propulsionType = cache.rollingTypes.find((row) => row.propulsion);
  assert(propulsionType, 'prepared rolling data should include at least one propulsion mass modifier');
  const massStarted = performance.now();
  const mass = await wormhole.getWormholeRollingShipMass({
    shipTypeId: 20183,
    shipName: 'Providence',
    fittedItems: [{ type_id: propulsionType.typeId, item: propulsionType.name, location_flag: 'MedSlot0' }],
  });
  const massWarmMs = performance.now() - massStarted;
  assert.equal(mass.shipName, 'Providence');
  assert.equal(mass.baseMassKg, 900000000);
  assert(mass.propulsion.some((row) => row.typeId === propulsionType.typeId));

  assert(referenceWarmMs < 20, `warm wormhole reference read took ${referenceWarmMs.toFixed(2)} ms`);
  assert(systemWarmMs < 20, `warm system reference read took ${systemWarmMs.toFixed(2)} ms`);
  assert(massWarmMs < 20, `warm rolling mass read took ${massWarmMs.toFixed(2)} ms`);

  return {
    coldMs: Number(coldMs.toFixed(1)),
    eventLoopTicks: ticks,
    worstEventLoopDelayMs: Number(worstDelayMs.toFixed(1)),
    cacheBytes: fs.statSync(wormhole.WORMHOLE_STATIC_CACHE).size,
    referenceWarmMs: Number(referenceWarmMs.toFixed(3)),
    systemWarmMs: Number(systemWarmMs.toFixed(3)),
    massWarmMs: Number(massWarmMs.toFixed(3)),
  };
};
