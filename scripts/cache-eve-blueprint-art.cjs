const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const AdmZip = require('adm-zip');
const sharp = require('sharp');

const STATIC_ROOT = process.env.NEW_EDEN_SAGE_STATIC_ROOT || 'F:\\New Eden Sage Data\\Static Data';
const OUTPUT_ROOT = path.join(STATIC_ROOT, 'Blueprint Images');
const GRAPHICS_ROOT = path.join(OUTPUT_ROOT, 'graphics');
const OVERLAYS_ROOT = path.join(OUTPUT_ROOT, 'overlays');
const RENDERED_ROOT = path.join(OUTPUT_ROOT, 'rendered');
const TYPE_ICON_ROOT = path.join(STATIC_ROOT, 'Type Images', 'icon', '64');
const ARCHIVE = path.join(STATIC_ROOT, 'eve-static-data-jsonl.zip');
const USER_AGENT = 'NewEdenSage/1.1.26 blueprint-art-cache';
const CONCURRENCY = 12;

function findEveRoot() {
  const candidates = [
    process.env.EVE_SHARED_CACHE,
    'F:\\EVE',
    'C:\\CCP\\EVE',
    'C:\\ProgramData\\CCP\\EVE',
    path.join(process.env.LOCALAPPDATA || '', 'CCP', 'EVE'),
  ].filter(Boolean);
  for (const root of candidates) {
    if (fs.existsSync(path.join(root, 'tq', 'resfileindex.txt')) && fs.existsSync(path.join(root, 'ResFiles'))) return root;
  }
  throw new Error('Could not locate an EVE shared cache containing tq\\resfileindex.txt and ResFiles. Set EVE_SHARED_CACHE.');
}

function parseIndex(indexText) {
  return indexText.split(/\r?\n/).flatMap((line) => {
    if (!line) return [];
    const parts = line.split(',');
    if (parts.length < 2) return [];
    return [{ logical: parts[0], cachePath: parts[1], md5: parts[2] || '', compressedSize: Number(parts[3] || 0), rawSize: Number(parts[4] || 0) }];
  });
}

async function fetchResource(entry, eveRoot) {
  const local = path.join(eveRoot, 'ResFiles', ...entry.cachePath.split('/'));
  if (fs.existsSync(local)) return fsp.readFile(local);
  const response = await fetch(`https://resources.eveonline.com/${entry.cachePath}`, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${entry.logical} failed with HTTP ${response.status}`);
  let data = Buffer.from(await response.arrayBuffer());
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) data = zlib.gunzipSync(data);
  return data;
}

async function mapLimited(items, limit, mapper) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await mapper(items[index], index);
    }
  }));
}

function readJsonl(zip, name) {
  const entry = zip.getEntry(name);
  if (!entry) throw new Error(`Missing ${name} in CCP SDE archive.`);
  return entry.getData().toString('utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function main() {
  const eveRoot = findEveRoot();
  const entries = parseIndex(await fsp.readFile(path.join(eveRoot, 'tq', 'resfileindex.txt'), 'utf8'));
  await fsp.mkdir(GRAPHICS_ROOT, { recursive: true });
  await fsp.mkdir(OVERLAYS_ROOT, { recursive: true });

  const graphicEntries = entries.filter((entry) => /\/([0-9]+)_64_bpc(?:_faction)?\.png$/i.test(entry.logical));
  const preferredByGraphic = new Map();
  for (const entry of graphicEntries) {
    const match = /\/([0-9]+)_64_bpc(_faction)?\.png$/i.exec(entry.logical);
    if (!match) continue;
    const graphicId = Number(match[1]);
    const faction = Boolean(match[2]);
    const current = preferredByGraphic.get(graphicId);
    if (!current || (current.faction && !faction)) preferredByGraphic.set(graphicId, { ...entry, graphicId, faction });
  }

  let cached = 0;
  let localHits = 0;
  let downloaded = 0;
  const failures = [];
  const resources = [...preferredByGraphic.values()];
  await mapLimited(resources, CONCURRENCY, async (entry) => {
    const target = path.join(GRAPHICS_ROOT, `${entry.graphicId}.png`);
    if (fs.existsSync(target)) { cached++; return; }
    const local = path.join(eveRoot, 'ResFiles', ...entry.cachePath.split('/'));
    try {
      const data = await fetchResource(entry, eveRoot);
      if (local && fs.existsSync(local)) localHits++; else downloaded++;
      await fsp.writeFile(target, data);
      cached++;
      if (cached % 100 === 0) console.log(`Cached ${cached}/${resources.length} blueprint graphics...`);
    } catch (error) {
      failures.push({ graphicId: entry.graphicId, logical: entry.logical, error: error instanceof Error ? error.message : String(error) });
    }
  });

  const specialNames = ['bpo.png', 'bpc.png', 'bpo_overlay.png', 'bpc_overlay.png'];
  const special = {};
  for (const name of specialNames) {
    const entry = entries.find((candidate) => candidate.logical.toLowerCase() === `res:/ui/texture/icons/${name}`);
    if (!entry) throw new Error(`Missing ${name} from EVE resource index.`);
    const data = await fetchResource(entry, eveRoot);
    await fsp.writeFile(path.join(OVERLAYS_ROOT, name), data);
    special[name] = { logical: entry.logical, cachePath: entry.cachePath };
  }

  if (!fs.existsSync(ARCHIVE)) throw new Error(`Missing CCP SDE archive: ${ARCHIVE}`);
  const zip = new AdmZip(ARCHIVE);
  const types = readJsonl(zip, 'types.jsonl');
  const blueprints = readJsonl(zip, 'blueprints.jsonl');
  const typeById = new Map(types.map((row) => [Number(row._key), row]));
  const blueprintMap = {};
  for (const blueprint of blueprints) {
    const blueprintTypeId = Number(blueprint.blueprintTypeID ?? blueprint._key ?? 0);
    if (!(blueprintTypeId > 0)) continue;
    const manufacturingProduct = blueprint.activities?.manufacturing?.products?.[0];
    const productTypeId = Number(manufacturingProduct?.typeID ?? 0) || null;
    const blueprintType = typeById.get(blueprintTypeId);
    const productType = productTypeId ? typeById.get(productTypeId) : null;
    const graphicId = Number(blueprintType?.graphicID ?? productType?.graphicID ?? 0) || null;
    blueprintMap[blueprintTypeId] = {
      blueprintTypeId,
      productTypeId,
      graphicId,
      hasClientBlueprintGraphic: Boolean(graphicId && preferredByGraphic.has(graphicId)),
      blueprintName: blueprintType?.name?.en ?? null,
      productName: productType?.name?.en ?? null,
    };
  }

  const manifest = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    eveRoot,
    resourceIndex: path.join(eveRoot, 'tq', 'resfileindex.txt'),
    clientBlueprintGraphicsIndexed: resources.length,
    clientBlueprintGraphicsCached: cached,
    localSharedCacheHits: localHits,
    downloadedFromCcp: downloaded,
    failures,
    special,
    graphics: Object.fromEntries(resources.map((entry) => [entry.graphicId, { logical: entry.logical, cachePath: entry.cachePath, file: `graphics/${entry.graphicId}.png` }])),
  };
  await fsp.writeFile(path.join(OUTPUT_ROOT, 'client-blueprint-index.json'), JSON.stringify(manifest, null, 2));
  await fsp.writeFile(path.join(OUTPUT_ROOT, 'blueprint-type-map.json'), JSON.stringify({ schema: 1, generatedAt: new Date().toISOString(), blueprints: blueprintMap }, null, 2));

  // CCP only ships dedicated *_64_bpc.png renders for model-backed graphics. For every
  // remaining blueprint, reproduce the client treatment from the product icon and
  // CCP's own BPO/BPC overlay, then persist it so the desktop app never has to
  // synthesize artwork on the hot path.
  await fsp.mkdir(TYPE_ICON_ROOT, { recursive: true });
  await fsp.mkdir(path.join(RENDERED_ROOT, 'bpo'), { recursive: true });
  await fsp.mkdir(path.join(RENDERED_ROOT, 'bpc'), { recursive: true });
  const baseIconInflight = new Map();
  async function ensureBaseTypeIcon(typeId) {
    const target = path.join(TYPE_ICON_ROOT, `${typeId}.png`);
    if (fs.existsSync(target)) return target;
    if (baseIconInflight.has(typeId)) return baseIconInflight.get(typeId);
    const task = (async () => {
      const response = await fetch(`https://images.evetech.net/types/${typeId}/icon?size=64`, { headers: { 'X-User-Agent': USER_AGENT, 'User-Agent': USER_AGENT } });
      if (!response.ok) throw new Error(`Type icon ${typeId} failed with HTTP ${response.status}`);
      const data = Buffer.from(await response.arrayBuffer());
      await fsp.writeFile(target, data);
      return target;
    })().finally(() => baseIconInflight.delete(typeId));
    baseIconInflight.set(typeId, task);
    return task;
  }

  const fallbackRows = Object.values(blueprintMap).filter((row) => !row.hasClientBlueprintGraphic);
  let rendered = 0;
  let genericFallbacks = 0;
  await mapLimited(fallbackRows, 8, async (row) => {
    let base = null;
    try {
      base = await ensureBaseTypeIcon(Number(row.productTypeId || row.blueprintTypeId));
    } catch {
      genericFallbacks += 1;
    }
    for (const kind of ['bpo', 'bpc']) {
      const target = path.join(RENDERED_ROOT, kind, `${row.blueprintTypeId}.png`);
      if (fs.existsSync(target)) continue;
      const overlay = path.join(OVERLAYS_ROOT, `${kind}_overlay.png`);
      const generic = path.join(OVERLAYS_ROOT, `${kind}.png`);
      if (base && fs.existsSync(overlay)) {
        await sharp(base).resize(64, 64, { fit:'fill' }).ensureAlpha().composite([{ input:overlay, blend:'over' }]).png().toFile(target);
      } else {
        await fsp.copyFile(generic, target);
      }
      rendered += 1;
      if (rendered % 1000 === 0) console.log(`Rendered ${rendered}/${fallbackRows.length * 2} fallback blueprint variants...`);
    }
  });

  const mapped = Object.values(blueprintMap);
  const mappedWithGraphic = mapped.filter((row) => row.graphicId).length;
  const mappedWithClientGraphic = mapped.filter((row) => row.hasClientBlueprintGraphic).length;
  console.log(JSON.stringify({
    eveRoot,
    indexedClientGraphics: resources.length,
    cachedClientGraphics: cached,
    localSharedCacheHits: localHits,
    downloadedFromCcp: downloaded,
    failures: failures.length,
    blueprintTypes: mapped.length,
    blueprintTypesWithGraphicId: mappedWithGraphic,
    blueprintTypesWithClientBlueprintGraphic: mappedWithClientGraphic,
    fallbackBlueprintTypes: fallbackRows.length,
    renderedFallbackVariantsThisRun: rendered,
    genericFallbacks,
    outputRoot: OUTPUT_ROOT,
  }, null, 2));
  if (failures.length) process.exitCode = 2;
}

main().catch((error) => { console.error(error); process.exit(1); });
