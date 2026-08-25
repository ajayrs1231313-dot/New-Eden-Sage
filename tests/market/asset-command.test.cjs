const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=(rel)=>fs.readFileSync(path.join(root,rel),'utf8');
const app=read('src/App.tsx');
const assets=read('src/AssetsCommand.tsx');
const types=read('src/types.ts');
const polish=read('src/asset-command-polish.css');

test('Asset Command exposes Loot Sources and a retained Assets workspace',()=>{
  assert.match(app,/type AssetCommandTab = "loot" \| "assets" \| "market" \| "wallet"/);
  assert.match(app,/>Loot Sources<\/button>/);
  assert.match(app,/>Assets<\/button>/);
  assert.match(app,/RetainedAssetsCommand snapshots=\{snapshots\}/);
});

test('Assets view uses existing snapshot asset data without another refresh path',()=>{
  assert.match(types,/assets\?: any\[\]/);
  assert.match(assets,/snapshot\.extended\?\.assets/);
  assert.doesNotMatch(assets,/window\.sage\.|fetch\(/);
  assert.match(assets,/without triggering another sync/);
});

test('Assets view can show one or all characters, merge matching stacks and search useful fields',()=>{
  assert.match(assets,/All characters/);
  assert.match(assets,/Merge matching stacks/);
  assert.match(assets,/setMerge/);
  assert.match(assets,/same item at the same location across selected characters/);
  assert.match(assets,/row\.item,\.\.\.row\.owners,row\.station,row\.system,row\.locationFlag/);
  assert.match(assets,/filtered\.slice\(0,1000\)/);
});

test('Asset Command market gets a scoped compact visual override rather than global market mutation',()=>{
  assert.match(polish,/\.asset-command \.market-workspace-v2/);
  assert.match(polish,/\.asset-command \.market-v2-tabs/);
  assert.match(polish,/\.asset-command \.market-v2-depth/);
  assert.doesNotMatch(polish,/^\.market-v2-/m);
});
