import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const hud=fs.readFileSync(path.join(root,"src/CharacterOverviewHud.tsx"),"utf8");
const responsiveCss=fs.readFileSync(path.join(root,"src/responsive-display.css"),"utf8");
assert.ok(hud.includes('const completeCount = states.filter((state) => state === "complete").length;'),"onboarding must calculate completed nodes");
assert.ok(hud.includes('if (completeCount === labels.length) return null;'),"completed onboarding journey must disappear at 4/4");
assert.match(responsiveCss,/\.character-command \.character-journey \{[\s\S]*?height:\s*auto;[\s\S]*?min-height:\s*104px;/,"onboarding journey must size to its content so node labels stay inside the border");
assert.match(responsiveCss,/\.character-command \.character-journey-rail \{[\s\S]*?height:\s*auto;[\s\S]*?min-height:\s*64px;/,"onboarding journey rail must reserve enough vertical room for labels and status text");
console.log("Onboarding complete-dismissal regression: PASS");
