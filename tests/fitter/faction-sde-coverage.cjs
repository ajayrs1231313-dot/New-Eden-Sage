const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const AdmZip=require('adm-zip');
const sharp=require('sharp');

const root=path.resolve(__dirname,'../..');
const staticRoot=process.env.SAGE_STATIC_DATA_ROOT || 'F:\\New Eden Sage Data\\Static Data';
const archive=path.join(staticRoot,'eve-static-data-jsonl.zip');
assert.ok(fs.existsSync(archive),`Missing local SDE archive: ${archive}`);
const zip=new AdmZip(archive);
const rows=name=>(zip.getEntry(name)?.getData().toString('utf8').split(/\r?\n/).filter(Boolean)??[]).map(JSON.parse);
const groups=new Map(rows('groups.jsonl').map(row=>[Number(row._key),row]));
const types=rows('types.jsonl');
const ships=types.filter(row=>row.published && row.name?.en && Number(groups.get(Number(row.groupID))?.categoryID)===6);
const sdeFactionIds=[...new Set(ships.map(row=>Number(row.factionID)).filter(Number.isFinite))].sort((a,b)=>a-b);

const presentation=fs.readFileSync(path.join(root,'src','fitter-presentation.ts'),'utf8');
const mapStart=presentation.indexOf('export const SDE_SHIP_FACTION_BY_ID');
const mapEnd=presentation.indexOf('export type FitterFactionContext',mapStart);
assert.ok(mapStart>=0 && mapEnd>mapStart,'SDE ship-faction map must exist in fitter-presentation.ts');
const mapSource=presentation.slice(mapStart,mapEnd);
const mapped=[...mapSource.matchAll(/\b(\d{6}):"([^"]+)"/g)].map(match=>({factionId:Number(match[1]),slug:match[2]}));
const mappedIds=mapped.map(item=>item.factionId).sort((a,b)=>a-b);
assert.deepEqual(mappedIds,sdeFactionIds,'Every published SDE ship faction must have an explicit resolver mapping and no non-ship faction IDs may be substituted.');
assert.equal(new Set(mapped.map(item=>item.slug)).size,mapped.length,'Every live ship faction must resolve to its own dedicated artwork slug.');

(async()=>{
  for(const {factionId,slug} of mapped){
    const asset=path.join(root,'src','fitter-assets','factions',`${slug}.webp`);
    assert.ok(fs.existsSync(asset),`Missing raster faction asset for ${factionId}: ${slug}.webp`);
    assert.ok(fs.statSync(asset).size>10_000,`Faction asset is too small to be the full raster panel: ${slug}.webp`);
    const meta=await sharp(asset).metadata();
    assert.equal(meta.format,'webp',`${slug} must be WebP raster artwork`);
    assert.equal(meta.width,640,`${slug} artwork width regression`);
    assert.equal(meta.height,1000,`${slug} artwork height regression`);
  }
  assert.ok(ships.length>0,'SDE ship audit unexpectedly returned no published ships.');
  console.log(`Faction SDE coverage passed: ${ships.length} published ships, ${sdeFactionIds.length} ship factions, ${mapped.length} dedicated WebP assets.`);
})().catch(error=>{console.error(error);process.exit(1);});
