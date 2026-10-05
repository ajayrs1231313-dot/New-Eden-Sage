const assert = require('node:assert/strict');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { simulateSageFit, registerSageFittingTool } = require('../../dist-electron/mcp-fitting.js');
const dogma = require('../../dist-electron/fitting-dogma.js');

(async () => {
  const levels = { 'Gallente Cruiser':5, 'Heavy Assault Cruisers':4, 'CPU Management':5,
    'Power Grid Management':5, 'Weapon Upgrades':5, 'Advanced Weapon Upgrades':5,
    'Gunnery':5, 'Medium Hybrid Turret':5, 'Medium Blaster Specialization':4,
    'Rapid Firing':4, 'Surgical Strike':2, 'Drones':5, 'Light Drone Operation':5,
    'Drone Interfacing':5, 'Minmatar Drone Specialization':3 };
  const names = [...Object.keys(levels), 'Deimos', 'Heavy Electron Blaster II',
    'Caldari Navy Antimatter Charge M', 'Warrior II', 'Assault Damage Control II'];
  const resolved = await dogma.resolveFittingTypeNamesLocal(names);
  const ids = new Map(resolved.map(t => [t.name, t.id]));
  const snapshot = { character:{name:'Test pilot'}, updatedAt:'2026-10-05T00:00:00Z',
    skills:{total_sp:12345, skills:Object.entries(levels).map(([name,level]) => ({skill_id:ids.get(name),trained_skill_level:level,active_skill_level:level}))},
    extended:{implants:[]} };
  const original = JSON.stringify(snapshot);
  const fit = { id:'test-fit', name:'Test Deimos', hull:{name:'Deimos'},
    high:[{name:'Heavy Electron Blaster II', quantity:5, charge:'Caldari Navy Antimatter Charge M'}],
    low:[{name:'Assault Damage Control II', state:'online'}],
    drones:[{name:'Warrior II', quantity:5, activeQuantity:5}] };
  const saved = JSON.stringify(fit);
  const deps = { getSnapshot:id => id === '1' ? snapshot : null, getSavedFits:async () => [fit],
    getMarketQuotes:async typeIds => ({createdAt:'2026-10-05T00:00:00Z',quotes:typeIds.map(typeId => ({typeId,bestSell:100}))}) };
  const proposed = await simulateSageFit({characterId:'1',fit},deps);
  const fromSaved = await simulateSageFit({characterId:'1',fitId:'test-fit'},deps);
  const direct = await dogma.analyzeFittingDogma({hullTypeId:ids.get('Deimos'),snapshot,items:[
    ...Array.from({length:5},()=>({typeId:ids.get('Heavy Electron Blaster II'),quantity:1,rack:'high',chargeTypeId:ids.get('Caldari Navy Antimatter Charge M'),state:'active'})),
    {typeId:ids.get('Assault Damage Control II'),quantity:1,rack:'low',state:'online'},
    {typeId:ids.get('Warrior II'),quantity:5,activeQuantity:5,rack:'drone',state:'active'},
  ]});
  for (const key of ['damage','defence','capacitor','navigation','resources','issues','missingRequirements']) {
    assert.deepEqual(proposed.analysis[key], direct[key], `Desktop engine parity: ${key}`);
    assert.deepEqual(fromSaved.analysis[key], direct[key], `Saved fit parity: ${key}`);
  }
  assert.equal(JSON.stringify(snapshot),original,'Character snapshot must not be mutated');
  assert.equal(JSON.stringify(fit),saved,'Saved fit must not be mutated');
  assert.equal(proposed.fit.high.length,5,'Grouped weapons expand to desktop slot instances');
  assert.equal(proposed.cost.complete,true);
  assert.equal(proposed.cost.total,1700,'Price includes hull, modules, drones and loaded ammunition');
  const partialPrice = await simulateSageFit({characterId:'1',fit},{...deps,getMarketQuotes:async () => ({createdAt:null,quotes:[]})});
  assert.equal(partialPrice.cost.complete,false);
  assert.equal(partialPrice.cost.available,false);
  const unavailablePrice = await simulateSageFit({characterId:'1',fit},{...deps,getMarketQuotes:async () => {throw new Error('No market data');}});
  assert.equal(unavailablePrice.cost.available,false);
  assert.equal(unavailablePrice.analysis.damage.totalDps,proposed.analysis.damage.totalDps,'Missing prices do not prevent simulation');
  const burst = await simulateSageFit({characterId:'1',fit:{...fit,low:[{name:'Assault Damage Control II',state:'active'}]}},deps);
  assert.ok(burst.analysis.defence.totalEhp > proposed.analysis.defence.totalEhp,'ADC burst differs from passive tank');
  const hot = await simulateSageFit({characterId:'1',fit:{...fit,high:[{...fit.high[0],state:'overheated'}]}},deps);
  assert.ok(hot.analysis.damage.totalDps > proposed.analysis.damage.totalDps,'Heat changes DPS');
  const noDrones = await simulateSageFit({characterId:'1',fit:{...fit,drones:[{...fit.drones[0],activeQuantity:0}]}},deps);
  assert.equal(noDrones.analysis.damage.droneDps,0);
  const eft = await simulateSageFit({characterId:'1',fit:'[Deimos, EFT]\n\nAssault Damage Control II\n\n\nHeavy Electron Blaster II, Caldari Navy Antimatter Charge M\nHeavy Electron Blaster II, Caldari Navy Antimatter Charge M\nHeavy Electron Blaster II, Caldari Navy Antimatter Charge M\nHeavy Electron Blaster II, Caldari Navy Antimatter Charge M\nHeavy Electron Blaster II, Caldari Navy Antimatter Charge M\n\n\nWarrior II x5'},deps);
  assert.equal(eft.analysis.damage.totalDps,proposed.analysis.damage.totalDps,'EFT charges and drone stack survive import');
  const dna = await simulateSageFit({characterId:'1',fit:`${ids.get('Deimos')}:${ids.get('Heavy Electron Blaster II')};5:${ids.get('Warrior II')};5::`},deps);
  assert.equal(dna.fit.high[0].typeId,ids.get('Heavy Electron Blaster II'),'DNA module stacks resolve to high rack');
  assert.equal(dna.fit.drones[0].quantity,5,'DNA drone stacks resolve to drone bay');
  const cargoOverflow = await simulateSageFit({characterId:'1',fit:{...fit,cargo:[{name:'Caldari Navy Antimatter Charge M',quantity:1000000}]}},deps);
  assert.ok(cargoOverflow.analysis.issues.some(issue => issue.code === 'cargo-capacity'),'Cargo overload is reported');
  const untrained = {...snapshot,skills:{skills:[{skill_id:ids.get('Gunnery'),trained_skill_level:1}]}};
  const blocked = await simulateSageFit({characterId:'1',fit},{...deps,getSnapshot:()=>untrained});
  assert.ok(blocked.analysis.missingRequirements.length,'Missing skills are reported');
  assert.ok(blocked.analysis.damage.totalDps < proposed.analysis.damage.totalDps,'Pilot skills affect output');
  await assert.rejects(simulateSageFit({characterId:'2',fit},deps),/synced skills/);
  await assert.rejects(simulateSageFit({characterId:'1',fit,fitId:'test-fit'},deps),/exactly one/);
  await assert.rejects(simulateSageFit({characterId:'1'},deps),/exactly one/);
  await assert.rejects(simulateSageFit({characterId:'1',fitId:'missing'},deps),/not found/);
  await assert.rejects(simulateSageFit({characterId:'1',fit:{...fit,high:['Invented gun']}},deps),/Unknown fitting/);
  await assert.rejects(simulateSageFit({characterId:'1',fit:{...fit,high:[{name:'Bad ID',typeId:999999999}]}},deps),/Unknown fitting type ID/);
  await assert.rejects(simulateSageFit({characterId:'1',fit:{...fit,high:[{...fit.high[0],quantity:1000000}]}},deps),/Excessive quantity/);
  const overload = await simulateSageFit({characterId:'1',fit:{...fit,high:[{...fit.high[0],quantity:8}]}},deps);
  assert.ok(overload.analysis.issues.length,'Illegal fit must produce issues');

  const server = new McpServer({name:'test-sage',version:'1'});
  registerSageFittingTool(server,deps,value => ({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:{data:value}}));
  const client = new Client({name:'test-client',version:'1'});
  const [clientTransport,serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listing = await client.listTools();
    assert.equal(listing.tools[0].name,'simulate_sage_fit');
    assert.equal(listing.tools[0].annotations.readOnlyHint,true);
    const response = await client.callTool({name:'simulate_sage_fit',arguments:{characterId:'1',fitId:'test-fit'}});
    assert.ok(!response.isError);
    assert.equal(response.structuredContent.data.analysis.damage.totalDps,direct.damage.totalDps);
    const batch = await client.callTool({name:'simulate_sage_fit',arguments:{characterId:'1',includePrices:false,fits:[{fit},{fitId:'test-fit'},{fitId:'missing'}]}});
    assert.ok(!batch.isError);
    assert.equal(batch.structuredContent.data.succeeded,2);
    assert.equal(batch.structuredContent.data.failed,1);
    assert.deepEqual(batch.structuredContent.data.results.map(r=>r.index),[0,1,2]);
    assert.equal(batch.structuredContent.data.results[0].data.analysis.damage.totalDps,proposed.analysis.damage.totalDps,'Batch retains single-fit desktop parity');
    for(const key of ['defence','capacitor','navigation','resources','issues','missingRequirements']) assert.deepEqual(batch.structuredContent.data.results[0].data.analysis[key],proposed.analysis[key]);
    const fullBatch = await client.callTool({name:'simulate_sage_fit',arguments:{characterId:'1',includePrices:false,batchDetail:'full',fits:[{fit}]}});
    assert.deepEqual(fullBatch.structuredContent.data.results[0].data.analysis,proposed.analysis);
    assert.match(batch.structuredContent.data.results[2].error,/not found/);
    const oversized = await client.callTool({name:'simulate_sage_fit',arguments:{characterId:'1',fits:Array.from({length:101},()=>({fit}))}});
    assert.equal(oversized.isError,true);
    const mixed = await client.callTool({name:'simulate_sage_fit',arguments:{characterId:'1',fit,fits:[{fit}]}});
    assert.equal(mixed.isError,true);
    const invalid = await client.callTool({name:'simulate_sage_fit',arguments:{characterId:'1',fit,damageProfile:{em:0,thermal:0,kinetic:0,explosive:0}}});
    assert.equal(invalid.isError,true,'MCP schema rejects a zero damage profile');
  } finally { await client.close(); await server.close(); }
  console.log('Sage fitter MCP: desktop parity, skills, saved/proposed/EFT fits, heat, ADC, drones, legality, validation and protocol PASS');
})().catch(error => {console.error(error); process.exitCode=1;});
