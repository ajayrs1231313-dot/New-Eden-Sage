import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const staticRoot=process.env.SAGE_STATIC_DATA_ROOT || 'F:\\New Eden Sage Data\\Static Data';
const archive=path.join(staticRoot,'eve-static-data-jsonl.zip');
assert.ok(fs.existsSync(path.join(root,'dist-electron','fitting-dogma.js')),'Run the Electron build before this integration smoke.');
assert.ok(fs.existsSync(archive),`Missing SDE archive: ${archive}`);

const zip=new AdmZip(archive);
const rows=name=>(zip.getEntry(name)?.getData().toString('utf8').split(/\r?\n/).filter(Boolean)??[]).map(JSON.parse);
const groups=new Map(rows('groups.jsonl').map(row=>[Number(row._key),row]));
const factions=new Map(rows('factions.jsonl').map(row=>[Number(row._key),row]));
const ships=rows('types.jsonl').filter(row=>row.published && row.name?.en && Number(groups.get(Number(row.groupID))?.categoryID)===6 && Number.isFinite(Number(row.factionID)));

const presentation=fs.readFileSync(path.join(root,'src','fitter-presentation.ts'),'utf8');
const mapSource=presentation.slice(presentation.indexOf('export const SDE_SHIP_FACTION_BY_ID'),presentation.indexOf('export type FitterFactionContext'));
const factionMap=new Map([...mapSource.matchAll(/\b(\d{6}):"([^"]+)"/g)].map(match=>[Number(match[1]),match[2]]));
const byFaction=new Map();
for(const ship of ships){const fid=Number(ship.factionID);if(!byFaction.has(fid))byFaction.set(fid,ship);}

const dogma=await import(pathToFileURL(path.join(root,'dist-electron','fitting-dogma.js')).href);
const checked=[];
for(const fid of [...byFaction.keys()].sort((a,b)=>a-b)){
  const ship=byFaction.get(fid);
  const info=await dogma.getFittingTypeInfoLocal(Number(ship._key));
  const faction=factions.get(fid)?.name;
  const expectedFactionName=typeof faction==='object'?(faction.en??String(fid)):(faction??String(fid));
  assert.equal(info.typeId,Number(ship._key));
  assert.equal(info.name,ship.name.en);
  assert.equal(info.category?.id,6,`${ship.name.en} must remain in the SDE Ship category`);
  assert.equal(info.identity?.factionId,fid,`${ship.name.en} lost SDE faction identity`);
  assert.equal(info.identity?.factionName,expectedFactionName,`${ship.name.en} faction name mismatch`);
  const slug=factionMap.get(fid);
  assert.ok(slug,`${ship.name.en} faction ${fid} has no fitter resolver mapping`);
  assert.ok(fs.existsSync(path.join(root,'src','fitter-assets','factions',`${slug}.webp`)),`${ship.name.en} faction ${fid} has no dedicated WebP`);
  checked.push(`${fid} ${expectedFactionName} -> ${ship.name.en} -> ${slug}.webp`);
}
assert.equal(checked.length,factionMap.size,'Compiled type-info smoke must cover every mapped ship faction exactly once.');
console.log(checked.join('\n'));
console.log(`Compiled faction identity integration passed for ${checked.length} representative ships.`);
