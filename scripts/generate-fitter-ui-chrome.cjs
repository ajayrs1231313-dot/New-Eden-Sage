const fs = require('node:fs');
const path = require('node:path');
const out = path.join(__dirname, '..', 'src', 'fitter-assets');
fs.mkdirSync(out, { recursive:true });
const write = (name, body) => fs.writeFileSync(path.join(out, name), body.trim() + '\n', 'utf8');

// Source-of-truth pass: thin integrated HUD linework, not boxed/floating panels.
write('fitter-stage-overlay.svg', `
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="760" viewBox="0 0 1600 760" fill="none">
<defs>
  <radialGradient id="wash"><stop stop-color="#0d3b45" stop-opacity=".20"/><stop offset=".58" stop-color="#05171e" stop-opacity=".04"/><stop offset="1" stop-color="#020b10" stop-opacity="0"/></radialGradient>
  <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#36d5cf" stop-opacity=".20"/><stop offset=".44" stop-color="#2b6771" stop-opacity=".05"/><stop offset=".78" stop-color="#bc8434" stop-opacity=".08"/><stop offset="1" stop-color="#36d5cf" stop-opacity=".14"/></linearGradient>
  <pattern id="grid" width="42" height="42" patternUnits="userSpaceOnUse"><path d="M42 0H0V42" stroke="#55bdbb" stroke-opacity=".025"/></pattern>
</defs>
<rect width="1600" height="760" fill="url(#grid)"/>
<ellipse cx="815" cy="390" rx="380" ry="330" fill="url(#wash)"/>
<path d="M26 70h210l24-24h210M26 690h210l24 24h210M1574 70h-210l-24-24h-210M1574 690h-210l-24 24h-210" stroke="url(#edge)"/>
<path d="M454 54v650M1174 54v650" stroke="#3aa5a5" stroke-opacity=".055" stroke-dasharray="2 13"/>
<path d="M496 390h112M1020 390h112M814 96v86M814 600v74" stroke="#4ea2a5" stroke-opacity=".09"/>
<circle cx="814" cy="390" r="246" stroke="#2d7e84" stroke-opacity=".055"/>
<circle cx="814" cy="390" r="278" stroke="#b98538" stroke-opacity=".045" stroke-dasharray="4 24"/>
</svg>`);

write('fitter-core-surround.svg', `
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640" fill="none">
<defs>
  <filter id="soft"><feGaussianBlur stdDeviation="3"/></filter>
  <linearGradient id="cyan" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#7af7ec"/><stop offset=".55" stop-color="#18b9b5"/><stop offset="1" stop-color="#0f6169"/></linearGradient>
  <linearGradient id="amber" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#efb64f"/><stop offset=".6" stop-color="#b87620"/><stop offset="1" stop-color="#5e3c16"/></linearGradient>
</defs>
<!-- faint halo only; centre remains transparent -->
<circle cx="320" cy="320" r="250" stroke="#3bc5c2" stroke-opacity=".09" stroke-width="16" filter="url(#soft)"/>
<circle cx="320" cy="320" r="256" stroke="#143c45" stroke-width="7"/>
<circle cx="320" cy="320" r="248" stroke="#347c83" stroke-opacity=".56" stroke-width="1.6"/>
<circle cx="320" cy="320" r="236" stroke="#52d6cf" stroke-opacity=".23" stroke-width="1" stroke-dasharray="3 8"/>
<circle cx="320" cy="320" r="263" pathLength="100" stroke="url(#cyan)" stroke-width="4" stroke-linecap="round" stroke-dasharray="18 9 12 61" transform="rotate(-31 320 320)"/>
<circle cx="320" cy="320" r="263" pathLength="100" stroke="url(#amber)" stroke-width="4" stroke-linecap="round" stroke-dasharray="8 34 9 49" transform="rotate(9 320 320)"/>
<circle cx="320" cy="320" r="272" pathLength="100" stroke="#3dbab7" stroke-opacity=".18" stroke-width="1" stroke-dasharray="5 15 2 78" transform="rotate(68 320 320)"/>
<g stroke="#69ded6" stroke-opacity=".44" stroke-width="1.5">
 <path d="M320 39v22M320 579v22M39 320h22M579 320h22"/>
 <path d="M121 121l15 15M504 504l15 15M519 121l-15 15M136 504l-15 15" stroke-opacity=".15"/>
</g>
<g fill="#8af3ea" fill-opacity=".52"><circle cx="320" cy="48" r="2.2"/><circle cx="592" cy="320" r="2.2"/><circle cx="320" cy="592" r="2.2"/></g>
</svg>`);

write('fitter-core-window.svg', `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" fill="none">
<defs><radialGradient id="v"><stop offset=".66" stop-color="#061820" stop-opacity="0"/><stop offset="1" stop-color="#02090d" stop-opacity=".56"/></radialGradient></defs>
<circle cx="256" cy="256" r="254" fill="url(#v)"/>
<circle cx="256" cy="256" r="251" stroke="#4fd2cc" stroke-opacity=".23"/>
</svg>`);

function rack(name, accent){
write(name, `
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="156" viewBox="0 0 720 156" fill="none" preserveAspectRatio="none">
<defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="0"><stop stop-color="${accent}" stop-opacity=".78"/><stop offset=".42" stop-color="${accent}" stop-opacity=".18"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></linearGradient></defs>
<!-- open bracket geometry; intentionally no panel fill -->
<path d="M9 35 28 16h154" stroke="url(#a)" stroke-width="1.6"/>
<path d="M9 35v92l18 18h142" stroke="#2d5d66" stroke-opacity=".45"/>
<path d="M711 35 692 16H548" stroke="#2b6971" stroke-opacity=".30"/>
<path d="M711 35v92l-18 18H552" stroke="#2d5d66" stroke-opacity=".28"/>
<path d="M28 46h664" stroke="#2a6a72" stroke-opacity=".22"/>
<path d="M17 58h8M695 58h8" stroke="${accent}" stroke-opacity=".72" stroke-width="2"/>
<path d="M34 137h83M603 137h83" stroke="${accent}" stroke-opacity=".12"/>
</svg>`);
}
rack('fitter-rack-high.svg','#d79a36');
rack('fitter-rack-mid.svg','#47d6cf');
rack('fitter-rack-low.svg','#8ba6ad');
rack('fitter-rack-rig.svg','#49d7cb');
rack('fitter-rack-subsystem.svg','#9a78d0');

write('fitter-slot-bezel.svg', `
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" fill="none">
<path d="M2 14 14 2h67l13 13v66L81 94H14L2 82V14Z" fill="#06161d" fill-opacity=".70" stroke="#27505a"/>
<path d="M10 18 18 10h56" stroke="#4a9295" stroke-opacity=".28"/>
<path d="M86 28v40M10 74h52" stroke="#3bb7b2" stroke-opacity=".13"/>
</svg>`);

function button(name, accent, edge, fill='#06171d'){
write(name, `
<svg xmlns="http://www.w3.org/2000/svg" width="420" height="72" viewBox="0 0 420 72" fill="none" preserveAspectRatio="none">
<path d="M1 8 8 1h404l6 7v56l-7 7H8l-7-7V8Z" fill="${fill}" fill-opacity=".88" stroke="${edge}" stroke-opacity=".72"/>
<path d="M9 5h90" stroke="${accent}" stroke-opacity=".58" stroke-width="1.4"/>
<path d="M1 25h5M414 47h5" stroke="${accent}" stroke-opacity=".52" stroke-width="2"/>
<path d="M13 66h72M337 66h69" stroke="${accent}" stroke-opacity=".12"/>
</svg>`);
}
button('fitter-button-teal.svg','#58e0d7','#285963');
button('fitter-button-gold.svg','#e3ad45','#72572c','#141309');
button('fitter-button-red.svg','#e87570','#6a3b40','#170d10');

write('fitter-nameplate.svg', `
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="86" viewBox="0 0 720 86" fill="none" preserveAspectRatio="none">
<path d="M1 12 12 1h694l13 12v60l-12 12H12L1 74V12Z" fill="#07171c" fill-opacity=".9" stroke="#3f4f44"/>
<path d="M13 5h210" stroke="#d39c3b" stroke-width="1.6"/>
<path d="M1 30h7M711 55h8" stroke="#d39c3b" stroke-opacity=".62" stroke-width="2"/>
<path d="M16 79h155M550 79h152" stroke="#29616a" stroke-opacity=".32"/>
</svg>`);

write('fitter-tab-active.svg', `
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="80" viewBox="0 0 400 80" fill="none" preserveAspectRatio="none">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#0d2f35" stop-opacity=".55"/><stop offset="1" stop-color="#06151b" stop-opacity="0"/></linearGradient></defs>
<path d="M5 1h390v77H5z" fill="url(#g)"/>
<path d="M8 78h384" stroke="#52e6dc" stroke-width="2.2"/>
<path d="M16 7h80M304 7h80" stroke="#43b6b3" stroke-opacity=".20"/>
</svg>`);

const icons = {
 'icon-save.svg':'<path d="M5 4h20l3 3v21H4V5l1-1Zm4 1v8h14V5M9 28v-9h14v9"/>',
 'icon-duplicate.svg':'<path d="M10 7h17v20H10zM5 3h17v4M5 3v20h5"/>',
 'icon-export.svg':'<path d="M16 4v17M10 10l6-6 6 6M6 18v10h20V18"/>',
 'icon-cart.svg':'<path d="M4 7h4l3 14h13l3-10H10M13 27a2 2 0 1 0 0 .1M23 27a2 2 0 1 0 0 .1"/>',
 'icon-edit.svg':'<path d="m7 24 2-7L22 4l6 6-13 13-8 1ZM18 8l6 6"/>',
 'icon-ship.svg':'<path d="M16 3l5 8 7 5-7 5-5 8-5-8-7-5 7-5 5-8Zm0 7v12M10 16h12"/>',
 'icon-more.svg':'<path d="M7 16h.1M16 16h.1M25 16h.1" stroke-width="4" stroke-linecap="round"/>'
};
for(const [name,body] of Object.entries(icons)) write(name, `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="#86d9d3" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`);

console.log('Generated source-of-truth fitter chrome assets:', fs.readdirSync(out).filter(x => x.startsWith('fitter-') || x.startsWith('icon-')).length);
