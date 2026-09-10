const fs=require('fs');
const path=require('path');
const AdmZip=require('adm-zip');
const sharp=require('sharp');

const repo=path.resolve(__dirname,'..');
const staticRoot=process.env.SAGE_STATIC_DATA_ROOT || 'F:\\New Eden Sage Data\\Static Data';
const archive=path.join(staticRoot,'eve-static-data-jsonl.zip');
const localRenderRoot=path.join(staticRoot,'Type Images','render','512');
const outDir=path.join(repo,'src','fitter-assets','factions');
fs.mkdirSync(outDir,{recursive:true});
if(!fs.existsSync(archive)) throw new Error(`Missing SDE archive: ${archive}`);

const specs={
  500001:{slug:'caldari',rep:'Raven',accent:'#78c8ff',accent2:'#1b5f9d',mark:'STATE'},
  500002:{slug:'minmatar',rep:'Tempest',accent:'#ff9b52',accent2:'#7d2e1e',mark:'TRIBES'},
  500003:{slug:'amarr',rep:'Apocalypse',accent:'#ffd46b',accent2:'#8b5b15',mark:'EMPIRE'},
  500004:{slug:'gallente',rep:'Megathron',accent:'#67e7bc',accent2:'#1e6e57',mark:'FEDERATION'},
  500005:{slug:'jovian',rep:'Capsule',accent:'#e9efff',accent2:'#7b84a9',mark:'JOVE'},
  500006:{slug:'concord',rep:'Marshal',accent:'#e8f1ff',accent2:'#526d9b',mark:'CONCORD'},
  500009:{slug:'syndicate',rep:'Victorieux Luxury Yacht',accent:'#d9b6ff',accent2:'#674583',mark:'SYNDICATE'},
  500010:{slug:'guristas',rep:'Gila',accent:'#93ff76',accent2:'#3a7d2d',mark:'GURISTAS'},
  500011:{slug:'angel-cartel',rep:'Machariel',accent:'#ffbd7b',accent2:'#874b25',mark:'ANGEL'},
  500012:{slug:'blood-raiders',rep:'Bhaalgorn',accent:'#ff5c62',accent2:'#7f1e2d',mark:'BLOOD'},
  500014:{slug:'ore',rep:'Orca',accent:'#ffd34e',accent2:'#8c6a12',mark:'ORE'},
  500016:{slug:'sisters-of-eve',rep:'Stratios',accent:'#f1f5ff',accent2:'#7587a9',mark:'SOE'},
  500017:{slug:'society-of-conscious-thought',rep:'Gnosis',accent:'#c5b4ff',accent2:'#6652a2',mark:'SOCT'},
  500018:{slug:'mordus-legion',rep:'Orthrus',accent:'#82d9ff',accent2:'#335f8d',mark:'MORDU'},
  500019:{slug:'sansha',rep:'Nightmare',accent:'#f5c45e',accent2:'#795423',mark:'SANSHAS'},
  500020:{slug:'serpentis',rep:'Vindicator',accent:'#7ee8aa',accent2:'#226b51',mark:'SERPENTIS'},
  500026:{slug:'triglavian',rep:'Leshak',accent:'#ff4b4b',accent2:'#7b1825',mark:'TRIGLAV'},
  500027:{slug:'edencom',rep:'Thunderchild',accent:'#7edcff',accent2:'#275f78',mark:'EDENCOM'},
  500029:{slug:'deathless-circle',rep:'Cenotaph',accent:'#c982ff',accent2:'#512267',mark:'DEATHLESS'},
};

const fallbackSpecs=[
  {slug:'interbus',accent:'#ffcf50',accent2:'#70581a',mark:'INTERBUS'},
  {slug:'pirate',accent:'#ff865f',accent2:'#702c24',mark:'INDEPENDENT'},
  {slug:'new-eden',accent:'#7ed3ff',accent2:'#2a4d67',mark:'NEW EDEN'},
];

const zip=new AdmZip(archive);
const rows=name=>(zip.getEntry(name)?.getData().toString('utf8').split(/\r?\n/).filter(Boolean)??[]).map(JSON.parse);
const groups=new Map(rows('groups.jsonl').map(r=>[Number(r._key),r]));
const factions=new Map(rows('factions.jsonl').map(r=>[Number(r._key),r]));
const types=rows('types.jsonl');
const publishedShips=types.filter(r=>r.published && r.name?.en && Number(groups.get(Number(r.groupID))?.categoryID)===6);
const shipFactionIds=[...new Set(publishedShips.map(r=>Number(r.factionID)).filter(Number.isFinite))].sort((a,b)=>a-b);
const uncovered=shipFactionIds.filter(id=>!specs[id]);
if(uncovered.length) throw new Error('Missing artwork spec for live SDE ship faction IDs: '+uncovered.join(', '));
const configured=Object.keys(specs).map(Number).sort((a,b)=>a-b);
console.log(`SDE audit: ${publishedShips.length} published ships across ${shipFactionIds.length} faction IDs.`);
console.log(`Artwork coverage: ${shipFactionIds.length}/${shipFactionIds.length} live ship factions mapped.`);

function xml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
function factionName(id){const n=factions.get(id)?.name;return typeof n==='object'?(n.en??String(id)):(n??String(id));}
function findRepresentative(fid,name){
  const row=publishedShips.find(r=>Number(r.factionID)===fid && r.name?.en===name);
  if(!row) throw new Error(`Representative ${name} is not a current published ship for faction ${fid}`);
  return {typeId:Number(row._key),name:row.name.en};
}
async function renderBuffer(typeId){
  for(const ext of ['png','jpg','jpeg','webp']){
    const p=path.join(localRenderRoot,`${typeId}.${ext}`);
    if(fs.existsSync(p)) return fs.readFileSync(p);
  }
  const url=`https://images.evetech.net/types/${typeId}/render?size=512`;
  const res=await fetch(url);
  if(!res.ok) throw new Error(`EVE image ${typeId}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
function backdrop({accent,accent2,mark,name,fid,rep}){
  const stripes=Array.from({length:10},(_,i)=>`<path d="M${-220+i*92} 1000 L${250+i*92} 0" stroke="${accent}" stroke-opacity="${i%2?0.05:0.09}" stroke-width="28"/>`).join('');
  const grid=Array.from({length:9},(_,i)=>`<line x1="${i*80}" y1="0" x2="${i*80}" y2="1000"/>`).join('')+Array.from({length:13},(_,i)=>`<line x1="0" y1="${i*80}" x2="640" y2="${i*80}"/>`).join('');
  return Buffer.from(`<svg width="640" height="1000" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#050b12"/><stop offset="0.54" stop-color="${accent2}" stop-opacity="0.48"/><stop offset="1" stop-color="#02070c"/></linearGradient>
      <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0"><stop stop-color="${accent}" stop-opacity=".9"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></linearGradient>
      <radialGradient id="glow"><stop stop-color="${accent}" stop-opacity=".28"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="640" height="1000" fill="url(#bg)"/>
    <g stroke="${accent}" stroke-opacity=".055" stroke-width="1">${grid}</g>
    <circle cx="340" cy="405" r="340" fill="url(#glow)"/>
    <g>${stripes}</g>
    <path d="M0 0 H640 V18 H0Z" fill="url(#edge)"/>
    <path d="M0 982 H640 V1000 H0Z" fill="url(#edge)" opacity=".6"/>
    <path d="M26 82 H300" stroke="${accent}" stroke-width="4" opacity=".75"/>
    <path d="M26 89 H215" stroke="${accent}" stroke-width="1" opacity=".35"/>
    <text x="28" y="58" fill="${accent}" font-family="Arial,sans-serif" font-size="23" font-weight="700" letter-spacing="6">${xml(mark)}</text>
    <text x="28" y="920" fill="#e9f4ff" fill-opacity=".82" font-family="Arial,sans-serif" font-size="20" font-weight="700" letter-spacing="2">${xml(name)}</text>
    <text x="28" y="950" fill="${accent}" fill-opacity=".65" font-family="Arial,sans-serif" font-size="14" letter-spacing="2">${fid?`FACTION ${fid}`:'CAPSULEER DATABASE'}${rep?`  /  ${xml(rep)}`:''}</text>
    <path d="M28 968 H610" stroke="${accent}" stroke-opacity=".35"/>
    <circle cx="586" cy="74" r="25" fill="none" stroke="${accent}" stroke-opacity=".55"/><circle cx="586" cy="74" r="11" fill="${accent}" fill-opacity=".2"/>
  </svg>`);
}
async function generateFaction(fid,spec){
  const faction=factionName(fid);
  const rep=findRepresentative(fid,spec.rep);
  const ship=await renderBuffer(rep.typeId);
  const shipLayer=await sharp(ship).resize(600,600,{fit:'contain',withoutEnlargement:false}).modulate({brightness:0.95,saturation:0.9}).png().toBuffer();
  const shade=Buffer.from(`<svg width="640" height="1000" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#02070c" stop-opacity=".2"/><stop offset=".7" stop-color="#02070c" stop-opacity=".15"/><stop offset="1" stop-color="#02070c" stop-opacity=".92"/></linearGradient></defs><rect width="640" height="1000" fill="url(#fade)"/><path d="M16 16 H624 V984 H16Z" fill="none" stroke="${spec.accent}" stroke-opacity=".32" stroke-width="2"/></svg>`);
  const output=path.join(outDir,`${spec.slug}.webp`);
  await sharp(backdrop({...spec,name:faction,fid,rep:rep.name}))
    .composite([{input:shipLayer,left:20,top:170,blend:'screen'},{input:shade,left:0,top:0}])
    .webp({quality:90,effort:5})
    .toFile(output);
  const stat=fs.statSync(output);
  if(stat.size<10000) throw new Error(`Generated asset suspiciously small: ${output} (${stat.size} bytes)`);
  console.log(`${fid} ${faction.padEnd(32)} -> ${spec.slug}.webp ${(stat.size/1024).toFixed(1)} KiB (${rep.name})`);
}
async function generateFallback(spec){
  const output=path.join(outDir,`${spec.slug}.webp`);
  await sharp(backdrop({...spec,name:spec.mark,fid:null,rep:null})).webp({quality:90,effort:5}).toFile(output);
  console.log(`fallback ${spec.slug}.webp ${(fs.statSync(output).size/1024).toFixed(1)} KiB`);
}
(async()=>{
  for(const fid of configured) await generateFaction(fid,specs[fid]);
  for(const spec of fallbackSpecs) await generateFallback(spec);
  console.log(`Generated ${configured.length} dedicated live-faction raster panels + ${fallbackSpecs.length} fallback/legacy panels.`);
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
