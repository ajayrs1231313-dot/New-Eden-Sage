import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const read=(relative)=>fs.readFileSync(path.join(root,relative),"utf8");
const fittings=read("src/Fittings.tsx");
const css=read("src/fittings-concept-stage.css");

assert.ok(!fittings.includes("drop compatible ammo / script here"),"legacy browser tooltip text must stay removed");
assert.ok(!fittings.includes("FIT MODULE /"),"tooltip header must not repeat the obvious fit-module label; the module name is the header");
assert.match(fittings,/function ModuleHoverCard\(/,"custom module hover card is missing");
assert.match(fittings,/createPortal\([\s\S]*fit-module-hover-card[\s\S]*document\.body/,"module tooltip must render through a body portal so fitter overflow cannot clip it");
assert.ok(fittings.includes("analysis={analysis}"),"slot racks must pass current Sage fitting analysis to module tooltips");

assert.match(fittings,/type ModuleHoverContent = \{ primary:ModuleHoverStat\[\]; fitting:ModuleHoverStat\[\] \}/,"primary purpose stats and fitting-cost stats must remain separate");
assert.match(fittings,/content\.primary\.length>0[\s\S]*fit-module-hover-stats primary/,"primary effect stats must render before fitting cost");
assert.match(fittings,/fit-module-hover-fitting/,"CPU\/PG fitting cost must have its own secondary block");
assert.match(fittings,/Loaded charge \/ script \/ crystal/,"tooltip must show the currently loaded ammo, script or mining crystal");
assert.ok(fittings.indexOf("Loaded charge / script / crystal")<fittings.indexOf("fit-module-hover-stats primary"),"loaded charge subheader must render above the primary stat grid");
assert.match(fittings,/Right-click for full Show Info/,"tooltip must preserve the route to full module information");
assert.match(fittings,/consumedAttributeIds=new Set<number>\(\)/,"tooltip resolver must track DOGMA attributes already represented by purpose-specific stats");
assert.match(fittings,/!consumedAttributeIds\.has\(Number\(attribute\.attributeId\)\)/,"generic DOGMA fallback must not re-add a consumed attribute under a second label");
assert.match(fittings,/currentState==="overheated"\?"OVERHEAT"/,"fitted tooltip must expose full OVERHEAT state text");
assert.match(fittings,/currentState==="online"\?"ONLINE"/,"online-only modules must expose ONLINE rather than pretending to be active");

assert.match(fittings,/analysis\?\.damage\?\.weaponProfiles/,"weapon tooltip stats must use current fitting analysis");
assert.match(fittings,/profile\.paperDps/,"weapon tooltip must expose calculated DPS");
assert.match(fittings,/profile\.volley/,"weapon tooltip must expose calculated volley");
assert.match(fittings,/profile\.optimalM/,"turret tooltip must expose calculated optimal range");
assert.match(fittings,/profile\.falloffM/,"turret tooltip must expose calculated falloff");
assert.match(fittings,/profile\.tracking/,"turret tooltip must expose calculated tracking");
assert.match(fittings,/profile\.maximumRangeM/,"missile tooltip must expose calculated maximum range");
assert.match(fittings,/profile\.explosionRadiusM/,"missile tooltip must expose explosion radius");
assert.match(fittings,/profile\.explosionVelocity/,"missile tooltip must expose explosion velocity");

assert.match(fittings,/attr\(1255\).*Drone damage/s,"Drone Damage Amplifier class modules must expose their drone damage bonus");
assert.match(fittings,/drone navigation computer[\s\S]*Drone velocity/,"Drone Navigation Computer must expose drone velocity");
assert.match(fittings,/omnidirectional tracking \(link\|enhancer\)[\s\S]*Drone optimal[\s\S]*Drone falloff[\s\S]*Drone tracking/,"omnidirectional drone modules must expose range and tracking effects");
assert.match(fittings,/drone link augmentor[\s\S]*Drone control range/,"Drone Link Augmentor must expose control-range effect");

assert.match(fittings,/Yield \/ cycle/,"mining and harvesting modules must expose yield per cycle");
assert.match(fittings,/strip miner\|ice harvester\|gas cloud harvester\|gas harvester/,"mining resolver must cover strip, ice and gas harvesters");
assert.match(fittings,/Resulting max velocity/,"propulsion modules must use live resulting ship velocity when available");
assert.match(fittings,/Signature radius/,"MWD\/signature-affecting modules must expose signature impact");

assert.match(fittings,/Shield HP/,"shield extenders must expose shield HP");
assert.match(fittings,/Shield boost \/ cycle/,"shield boosters must expose boost amount");
assert.match(fittings,/EM resist/,"shield\/armor resist modules must expose damage-type resistance bonuses");
assert.match(fittings,/Shield resists/,"Damage Control style modules must expose shield resistance");
assert.match(fittings,/Armor resists/,"Damage Control\/armor modules must expose armor resistance");
assert.match(fittings,/Hull resists/,"Damage Control must expose hull resistance");
assert.match(fittings,/Adaptive behaviour/,"reactive armor hardeners must explain their adaptive resistance behaviour");
assert.match(fittings,/Armor HP/,"armor plates must expose armor HP");
assert.match(fittings,/Armor repair \/ cycle/,"armor repairers must expose repair amount");
assert.match(fittings,/Repair \/ second/,"repair modules must derive repair throughput where cycle data is available");
assert.match(fittings,/Hull HP/,"bulkhead\/structure HP modules must have a hull-HP path");

assert.match(fittings,/Cap recharge time/,"cap rechargers must expose recharge improvement");
assert.match(fittings,/Capacitor amount/,"capacitor batteries must have a capacity effect path");
assert.match(fittings,/capacitorInjectors/,"fitted cap boosters must use live injector analysis when available");
assert.match(fittings,/Cap injected \/ charge/,"cap boosters must expose injection per charge");

assert.match(fittings,/Warp strength/,"warp disruptors\/scramblers must expose scramble strength");
assert.match(fittings,/MWD shutdown/,"warp scramblers must state their MWD shutdown effect");
assert.match(fittings,/Speed reduction/,"stasis webifiers must expose speed reduction");
assert.match(fittings,/target painter[\s\S]*Signature radius/,"target painters must expose signature increase");
assert.match(fittings,/tracking disruptor\|weapon disruptor[\s\S]*Turret optimal[\s\S]*Turret tracking/,"tracking disruptors must expose turret penalties");
assert.match(fittings,/sensor dampener[\s\S]*Targeting range[\s\S]*Scan resolution/,"sensor dampeners must expose both targeting penalties");
assert.match(fittings,/ecm\|jammer[\s\S]*Falloff/,"ECM modules must have jam-strength\/range handling");
assert.match(fittings,/sensor booster\|signal amplifier\|eccm[\s\S]*Scan resolution/,"sensor\/targeting modules must expose useful targeting stats");

assert.match(fittings,/inertial stabilizer\|nanofiber\|overdrive\|warp core stabilizer\|hyperspatial/,"navigation\/travel module families must be classified");
assert.match(fittings,/Inertia \/ agility/,"inertial\/agility modules must expose align-related effects");
assert.match(fittings,/Warp core strength/,"warp core stabilizers must expose strength");
assert.match(fittings,/Warp speed/,"hyperspatial modules must expose warp speed");

assert.match(fittings,/Remote armor \/ cycle/,"remote armor repairers must expose transfer amount");
assert.match(fittings,/Cap transferred/,"remote capacitor transmitters must expose transfer amount");
assert.match(fittings,/Energy neutralized/,"energy neutralizers must expose neutralization amount");
assert.match(fittings,/Energy drained/,"Nosferatu modules must expose drained energy");
assert.match(fittings,/smartbomb[\s\S]*Damage \/ cycle/,"smartbombs must expose damage");
assert.match(fittings,/tractor beam[\s\S]*Tractor velocity/,"tractor beams must expose tractor velocity");
assert.match(fittings,/salvager[\s\S]*Access \/ salvage bonus/,"salvagers must expose salvage difficulty\/chance stats");
assert.match(fittings,/cloak\|cloaking device[\s\S]*Cloak type/,"cloaks must expose cloak-specific behaviour");

assert.match(fittings,/MODULE_HOVER_FALLBACK_PRIORITY/,"unknown module types must retain DOGMA-driven fallback stat selection");
assert.match(fittings,/if\(!primary\.length&&typeInfo\?\.description\)/,"modules with no useful published compact DOGMA stats must still get a purpose fallback rather than CPU\/PG only");
assert.match(fittings,/getFittingTypeInfoCached\(item\.typeId\)/,"fitted module hover must load local CCP type data through the shared cache");
assert.match(fittings,/getFittingTypeInfoCached\(catalogueHover\.item\.id\)/,"catalogue hover must use the same local CCP type-data cache");
assert.match(fittings,/catalogueHover&&<ModuleHoverCard/,"catalogue entries and fitted slots must reuse the same tooltip component");
assert.match(fittings,/hoverAnchor&&<ModuleHoverCard/,"fitted slots must use the shared tooltip component");

assert.match(css,/\.fit-module-hover-card\{/,"module hover card styling is missing");
assert.match(css,/grid-template-columns:50px minmax\(0,1fr\) auto/,"tooltip header must reserve a compact module icon area");
assert.match(css,/\.fit-module-hover-stats\{[^}]*grid-template-columns:1fr 1fr/is,"tooltip stats must remain compact and scannable");
assert.match(css,/\.fit-module-hover-fitting\{/,"secondary fitting-cost block styling is missing");
assert.match(css,/pointer-events:none/,"tooltip must not interrupt module hover or drag\/drop behaviour");

console.log("Fitter + catalogue module hover tooltip regression: PASS");
