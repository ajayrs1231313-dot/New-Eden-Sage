const assert = require("node:assert/strict");
const fs = require("node:fs");

const ui = fs.readFileSync("src/IndustrialCommand.tsx", "utf8");
const assets = fs.readFileSync("electron/eve-assets.ts", "utf8");
const prep = fs.readFileSync("electron/industrial-preparation.ts", "utf8");
const engine = fs.readFileSync("electron/industrial-engine.ts", "utf8");
const main = fs.readFileSync("electron/main-task9.ts", "utf8");
const preload = fs.readFileSync("electron/preload.ts", "utf8");
const css = fs.readFileSync("src/industrial-command.css", "utf8");

assert.match(ui, /industrial-material-categories/, "materials page must expose category controls");
assert.match(ui, /item\.categoryName/, "materials page must render actual EVE category metadata");
assert.match(ui, /item\.groupName/, "materials page must render actual EVE group metadata");
assert.match(ui, /sage-asset:\/\/type\/\$\{item\.typeId\}\/icon\?size=64&cache=only/, "material thumbnails must be served cache-only");
assert.match(ui, /window\.sage\.cacheTypeIcons/, "materials page must explicitly warm thumbnails before cache-only display");
assert.match(engine, /getIndustrialBlueprintMaterialTypeIds/, "industrial engine must expose the authoritative blueprint-material type set");
assert.match(engine, /\["manufacturing", "reaction"\]/, "material eligibility must be limited to real production activities");
assert.match(engine, /typeMeta\.get\(blueprintTypeId\)\?\.published/, "unpublished blueprint records must not admit materials");
assert.match(engine, /publishedProductIds\.has\(typeId\)/, "self-referential legacy recipes must not admit their own output as a material");
assert.match(prep, /blueprintMaterialTypeIds: number\[\]/, "prepared Industrial state must carry the authoritative blueprint-material type set");
assert.match(prep, /blueprintMaterialTypeIdSet\.has\(typeId\)/, "icon preparation must ignore owned assets that are not blueprint inputs");
assert.match(ui, /filter\(\(entry\) => blueprintMaterialTypeIdSet\.has\(Number\(entry\.asset\.type_id \?\? 0\)\)\)/, "material inventory must discard assets that are not used by any blueprint");
assert.match(ui, /Blueprint-usable material pool/, "top-level Materials & Stock must communicate its filtered scope");

assert.match(assets, /export async function cacheTypeIconsLocal/, "type image layer must expose an explicit cache warmer");
assert.match(assets, /const cacheOnly = url\.searchParams\.get\("cache"\) === "only"/, "type image protocol must support cache-only reads");
assert.match(assets, /cacheOnly[\s\S]*?await exists\(cached\)[\s\S]*?: await ensureTypeImageLocal/, "cache-only reads must bypass the downloader when a cached file is absent");

assert.match(prep, /getMarketTypeIndex\(\)/, "industrial preparation must source category metadata from local EVE static data");
assert.match(prep, /cacheTypeIconsLocal\(materialTypeIds, 64\)/, "industrial preparation must pre-cache material icons");
assert.match(prep, /typeMetadata/, "prepared industrial page state must carry type metadata");
assert.match(main, /assets:cache-type-icons/, "main process must expose the explicit icon cache operation");
assert.match(preload, /cacheTypeIcons:/, "renderer bridge must expose the icon cache operation");

assert.match(css, /\.industrial-material-identity>img/, "materials page must style EVE thumbnails");
assert.match(css, /\.industrial-material-category/, "materials page must style category badges");

console.log("Material inventory category and cached-thumbnail regression checks passed.");
