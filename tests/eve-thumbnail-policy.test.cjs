const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

function walk(directory, out = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const tsxFiles = walk(path.join(root, 'src'));
for (const file of tsxFiles) {
  const text = fs.readFileSync(file, 'utf8');
  const relative = path.relative(root, file);
  assert(!text.includes('https://images.evetech.net/types/'), `${relative} must use the Sage EVE type-image cache instead of direct type thumbnails`);
  assert(!text.includes('eve-skin-icon.png'), `${relative} must not substitute a generic SKIN graphic for the real EVE type thumbnail`);
}

const assets = fs.readFileSync(path.join(root, 'src/AssetsCommand.tsx'), 'utf8');
assert(assets.includes('sage-asset://blueprint/${typeId}/${kind.toLowerCase()}'), 'Assets must show real BPO/BPC artwork for blueprint assets');

const invention = fs.readFileSync(path.join(root, 'src/InventionIntelligence.tsx'), 'utf8');
assert(invention.includes('sage-asset://blueprint/${item.inventedBlueprintTypeId}/bpc'), 'Invention rows must show the actual invented BPC thumbnail');

const industrial = fs.readFileSync(path.join(root, 'src/IndustrialCommand.tsx'), 'utf8');
assert(industrial.includes('industrial-structure-thumb') && industrial.includes('sage-asset://type/${row.typeId}/render?size=128'), 'Structure cards must use the actual EVE structure render when a type ID is known');

console.log(JSON.stringify({ officialTypeImages: true, blueprintArt: true, structureRenders: true }));
