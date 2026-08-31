const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex').toUpperCase();

const eve = read('electron/eve.ts');
const main = read('electron/main-task9.ts');
const intelligence = read('electron/pve-location-intelligence.ts');
const component = read('src/PveLocationIntel.tsx');
const css = read('src/pve-task8.css');
const iskLab = read('src/IskLab.tsx');

assert.match(eve, /fetchCharacterCurrentLocationSnapshot/, 'a targeted live location helper must exist');
assert.match(main, /if \(input\.forceLive\)[\s\S]*fetchCharacterCurrentLocationSnapshot/, 'force-live PVE requests must refresh current location before analysis');
assert.match(intelligence, /analyzeCurrentShipUse\(snapshot, "pve-combat"/, 'PVE analysis must evaluate readiness for the active hull');
assert.match(component, /analysis\.character\.systemName/, 'live map must bind to the current system');
assert.match(component, /sage-asset:\/\/type\/\$\{typeId\}\/render\?size=512/, 'ship card must use the shared EVE render cache');
assert.match(component, /pve-star-map-redesign/, 'the PVE map must use the from-scratch map implementation');
assert.match(component, /pve-map-route-lines/, 'the rebuilt map must include its own route network');
assert.match(component, /pve-map-local-network/, 'the rebuilt map must include its own constellation network');
assert.match(component, /MapArchetypeNode archetype="highsec"/, 'map must render high-sec archetype');
assert.match(component, /MapArchetypeNode archetype="abyssal"/, 'map must render abyssal archetype');
assert.match(component, /MapArchetypeNode archetype="nullsec"/, 'map must render null-sec archetype');
assert.match(component, /MapArchetypeNode archetype="wormhole"/, 'map must render wormhole archetype');
assert.match(component, /ArchetypeIcon archetype="lowsec" className="pve-map-current-icon"/, 'live central node must use the supplied low-sec skull asset');
assert.match(component, /<ArchetypeIcon archetype=\{archetype\}/, 'table badges must use the same supplied archetype icons');
assert.doesNotMatch(component.slice(component.indexOf('function ArchetypeIcon'), component.indexOf('function PveIntelMap')), /IskGlyph/, 'archetype markers must not fall back to the old generic glyphs');

const expectedAssets = {
  'src/pve-location-assets/archetype-icons/abyssal-star.png': '44634DA316BFCCD6CB344E1E3317C375DA1F315E141F9769B4021F6547D14AAD',
  'src/pve-location-assets/archetype-icons/highsec-skull.png': '0348949B4A790E19FC4B230C1BDF64E207C2944DD920DD557A05196C13E82738',
  'src/pve-location-assets/archetype-icons/lowsec-skull.png': '86823693BCF79B7318147D992C2940DF9DE31934FF7AB5761B680F91F6A2B29D',
  'src/pve-location-assets/archetype-icons/nullsec-crossed-swords.png': '2C1767100E4931459BBE25907D5D3987AF595FB75996A636934612E6D0AA263D',
  'src/pve-location-assets/archetype-icons/wormhole-vortex.png': 'B0CC42FC029110AE4AFED0949F27E51CA444EAC10AF8AA1F1C68900DCCC8DA46',
};
for (const [asset, hash] of Object.entries(expectedAssets)) {
  assert.equal(sha256(asset), hash, `${asset} must remain byte-identical to the supplied Downloads archive`);
}

assert.match(component, /thumbs-sprite\.webp/, 'cinematic environment thumbnails must remain present');
assert.match(component, /backgroundPositionY: visual\.thumbPosition/, 'table thumbnails must select the correct archetype scene');
assert.match(css, /FROM-SCRATCH ARCHETYPE MAP PASS 8/, 'from-scratch map styling must be present');
assert.match(css, /\.pve-result-row \.pve-category-badge \.pve-archetype-icon/, 'table badge styling must target the supplied PNG assets');
assert.match(css, /\.pve-map-archetype-icon/, 'map icon styling must target the supplied PNG assets');
assert.match(iskLab, /void scanPve\(true\)/, 'opening/refreshing PVE must request live location intelligence');

console.log('pve-live-location-polish: ok');
