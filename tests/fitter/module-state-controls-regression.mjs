import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const read=(relative)=>fs.readFileSync(path.join(root,relative),"utf8");
const fittings=read("src/Fittings.tsx");
const css=read("src/fittings-concept-stage.css");

assert.ok(!fittings.includes("stateMenuOpen"),"module state popup state must stay removed");
assert.ok(!fittings.includes("fit-module-state-menu"),"module state popup menu must stay removed");
assert.ok(!fittings.includes("stateButtons"),"text-button implementation must stay removed");
assert.ok(!fittings.includes("fit-module-state-control"),"old text control wrapper must stay removed");
assert.match(fittings,/const defaultState: ModuleState = capabilities \? \(capabilities\.canActivate \? "active" : "online"\)/,"activatable modules must default to active and passive modules to online");
assert.ok(fittings.includes('const controlOnState:ModuleState=capabilities?.canActivate?"active":"online";'),"green ON must map active modules to active and passive modules to online");
assert.ok(fittings.includes('capabilities&&states.includes("offline")?['),"every module that supports offline must get ON/OFF state lights");
assert.ok(fittings.includes('{state:controlOnState,className:"fit-module-state-light-on",title:"ON"}'),"green ON light must use the real module ON state");
assert.ok(fittings.includes('...(capabilities.canOverheat?[{state:"overheated" as ModuleState,className:"fit-module-state-light-overheat",title:"OVERHEAT"}]:[])'),"orange light must exist only for genuinely overheatable modules");
assert.ok(fittings.includes('{state:"offline",className:"fit-module-state-light-off",title:"OFF"}'),"grey OFF light must map to offline");
assert.ok(!fittings.includes("OVERHEAT unavailable"),"non-overheatable modules must not get a dummy orange light");
assert.ok(!fittings.includes("disabled={light.disabled}"),"state lights must not include obsolete disabled dummy controls");
assert.match(fittings,/onStateChange\(light\.state\)/,"lights must call the existing module-state updater");
assert.match(fittings,/light\.state===controlState\?" active":""/,"only the selected state light may be solid");
assert.ok(!/>OFF<|>ON<|>OH<|>OVERHEAT</.test(fittings),"state controls must not render visible text labels");
assert.ok(fittings.includes('side==="rig"||side==="subsystem"?["online"]:["offline","online","active","overheated"]'),"rigs and subsystems must remain online-only and receive no state lights");

assert.match(css,/fit-module-state-lights/,"light strip styling missing");
assert.match(css,/width:7px!important/,"lights must remain compact");
assert.match(css,/border-radius:50%!important/,"state controls must be circular lights");
assert.match(css,/fit-module-state-light-on\.active[^}]*background:#40dfaf/is,"selected ON light must be solid green");
assert.match(css,/fit-module-state-light-overheat\.active[^}]*background:#ff8a3d/is,"selected OVERHEAT light must be solid orange");
assert.match(css,/fit-module-state-light-off\.active[^}]*background:#aeb9bb/is,"selected OFF light must be solid grey");
assert.match(css,/misty-teal-orbital-shipyard-hangar\.webp/,"production fitter background not referenced");

console.log("Fitter module-state light regression: PASS");
