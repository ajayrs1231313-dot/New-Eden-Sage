const fs = require("node:fs/promises");
const path = require("node:path");

(async () => {
  const root = path.resolve(__dirname, "..");
  const data = require(path.join(root, "dist-electron", "type-volumes.js"));

  console.log("Checking CCP static data...");
  console.log(await data.stageStaticDataRefreshLowImpact(true));
  console.log("Promoting validated staged data for this build...");
  console.log(await data.prepareStaticDataForProcess());

  // A release bundle must be derived from the active CCP archive, never from a
  // possibly older prepared cache left by a previous development run.
  await fs.rm(data.FITTING_PREPARED_CACHE, { force: true });
  await fs.rm(data.FITTING_CATALOGUE_CACHE, { force: true });
  await fs.rm(data.MARKET_STATIC_PREPARED_CACHE, { force: true });

  const fitting = require(path.join(root, "dist-electron", "fitting-dogma.js"));
  const destination = path.join(root, "vendor", "fitting-data", "fitting-dogma-prepared-v1.json.gz");
  console.log("Building release fitting snapshot...");
  await fitting.copyPreparedFittingDataBundle(destination);
  await fitting.copyPreparedFittingCatalogueBundle(path.join(root, "vendor", "fitting-data", "fitting-catalogue-prepared-v1.json.gz"));
  const market = require(path.join(root, "dist-electron", "market-static-index.js"));
  await market.copyPreparedMarketStaticBundle(path.join(root, "vendor", "market-data", "market-static-prepared-v1.json.gz"));
  const stat = await fs.stat(destination);
  console.log(`Prepared fitting bundle: ${destination} (${Math.round(stat.size / 1024 / 1024 * 10) / 10} MiB)`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
