# EVE Patch Impact Manifest — 2026-09-22 Cradle of War Major Update

Status: **COMPLETE — VERIFIED 2026-09-26**
Patch family: EVE Online 24.01
CCP releases covered: **2026-09-22.1**, **2026-09-22.2 hotfix**, and **2026-09-24.1 hotfix**
Doctrine: `_INTERNAL_EVE_PATCH_DOCTRINE.md`

## Sources locked for this pass

- CCP patch notes: https://www.eveonline.com/news/view/patch-notes-version-24-01
- CCP major update overview: https://www.eveonline.com/news/view/cradle-of-war-major-update-is-live
- CCP force-projection dev blog: https://www.eveonline.com/news/view/major-update-force-projection-revamped
- Current official SDE URL: https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip
- SDE fetched for this pass: Last-Modified **2026-09-24 11:26:58 GMT**, 99,188,362 bytes
- Local SDE diff report: `F:\New Eden Sage Data\Static Data\sde-patch-diff-latest.json`

Do not close this manifest until every Class A-F row below is either implemented and tested or explicitly marked not applicable with a reason.

## SDE diff gate

Compared the pre-update known-good archive against the post-hotfix SDE before the old generation was lost by the legacy promotion path. The retained diff report recorded:

| Dataset | Added | Removed | Changed |
| --- | ---: | ---: | ---: |
| types.jsonl | 196 | 0 | 50 |
| groups.jsonl | 1 | 0 | 0 |
| categories.jsonl | 0 | 0 | 0 |
| typeDogma.jsonl | 29 | 0 | 765 |
| dogmaAttributes.jsonl | 4 | 0 | 6 |
| dogmaEffects.jsonl | 5 | 0 | 9 |
| blueprints.jsonl | 0 | 0 | 1 |
| typeMaterials.jsonl | 4 | 0 | 1 |
| marketGroups.jsonl | 8 | 0 | 5 |

Map data is part of the validation gate because this patch changes navigation mechanics. NPC/PvE reference data remains a separate behavioral audit because CCP's C1-C3/Pochven mechanics are not fully represented as static ship/module DOGMA.

### 2026-09-24.1 hotfix SDE delta

The doctrine intake was rerun against CCP's latest archive after the 24 September hotfix. Relative to the retained 23 September generation:

| Dataset | Added | Removed | Changed |
| --- | ---: | ---: | ---: |
| types.jsonl | 1 | 0 | 0 |
| typeDogma.jsonl | 1 | 0 | 0 |
| groups/categories | 0 | 0 | 0 |
| dogmaAttributes/dogmaEffects | 0 | 0 | 0 |
| blueprints/typeMaterials/marketGroups | 0 | 0 | 0 |

The added type is **97658 Moderate Corporate Outpost Beacon**. The Drekavac Moderate ADV-3 correction is server/runtime behaviour; CCP did not change ship DOGMA in this SDE generation.

### Patch-specific SDE evidence

- New attribute 6364: `baseJumpBridgeCapacitorCost` / **Ansiblex Activation Cost**.
- New attributes 6463-6465 implement remote-capacitor impedance and modifiers used by siege/triage-style effects.
- Changed ship DOGMA includes Harpy, Hawk, Ishkur, Vengeance, Cerberus, Sacrilege, Eagle, Deimos, Vigilant, Phobos, all four lancers, marauders, black-ops hulls, Babaroga and Ansiblex.
- Changed blueprint: type 88003 **Babaroga Blueprint**.
- Changed reprocessing/material row: type 88001 **Babaroga**.
- The 2026-09-22.2 hotfix is represented by the current SDE and must remain the source of truth for Paladin/Golem inertia.

## Class A — Combat / fitting / DOGMA

### Assault frigates
- [x] Harpy: current SDE ingested; small hybrid optimal bonus / tracking changes flow through DOGMA.
- [x] Hawk: current SDE ingested; kinetic-only missile bonus change flows through DOGMA.
- [x] Ishkur: current SDE ingested; new drone tracking bonus flows through generic modifier engine.
- [x] Vengeance: current SDE ingested; light-missile damage bonus flows through DOGMA.
- [x] Dedicated Cradle regression covers Harpy/Hawk/Ishkur/Vengeance modifier application, including the authoritative Hawk skill-source overlay.

### Heavy assault cruisers / range hulls
- [x] Cerberus, Sacrilege, Eagle, Deimos: current DOGMA ingested.
- [x] Vigilant and Phobos range bonuses: current DOGMA ingested.
- [x] Dedicated Cradle regression covers Cerberus/Sacrilege/Eagle/Deimos plus Vigilant/Phobos weapon DPS/range changes.

### Lancer dreadnoughts
- [x] Bane, Karura, Hubris and Valravn resistance rows updated by SDE.
- [x] Lancer base resist profiles are asserted directly; fitted-EHP paths remain covered by DOGMA correctness/full-catalogue fitting regressions.

### Marauders / black ops / Babaroga mass
- [x] Kronos, Vargur, Paladin, Golem, Babaroga, Marshal, Panther, Python, Redeemer, Sin and Widow current mass/inertia values ingested.
- [x] Post-hotfix Paladin/Golem inertia included by using current SDE.
- [x] All 11 changed marauder/black-ops/Babaroga hull masses are asserted through both Fitter and wormhole rolling mass paths.
- [x] Post-hotfix Paladin/Golem agility and align-time goldens are asserted.

### Siege / triage remote capacitor interaction
- [x] New remote-capacitor impedance attributes/effect modifiers ingested.
- [x] Fitter exposes CCP remote-capacitor receive impedance: cold capital = 1.0; active Siege/Triage ~= 0.000001.
- [x] Wargames remote-cap transfer applies target receive impedance; normal 100 GJ transfer vs sieged ~0.0001 GJ regression passes.

### Fitter / Combat Simulator / Wargames cascade

### Skills / character creation
- [x] Level-0 injected skills remain visible at level 0 in readiness/planner state.
- [x] Level-0 injected skills do not satisfy a level-1 requirement and generate the expected missing training step.
- [x] Forced release fitting bundle rebuild now bypasses stale bundled fitting caches.
- [x] Current fitting catalogue and market-static release snapshots rebuilt.
- [x] Fitter matrix covered by Cradle ship-balance, DOGMA correctness, drone application, special mechanics, Abyss/weather and full-catalogue stress regressions.
- [x] Wargames engine/support/special-mechanics/multichannel/environment regressions pass, including new remote-cap impedance.

## Class B — Industry / refining

### Babaroga
- [x] Babaroga blueprint row detected as changed in current SDE.
- [x] Babaroga material/reprocessing row detected as changed.
- [x] Industrial and refinery caches are invalidated on SDE promotion.
- [x] Industrial Engine asserts Babaroga = 4,800 Zero-Point Field Manipulators; Project Foundry consumes the shared manufacturing-plan material requirements and its project/acquisition suites pass.
- [x] Refinery accepts ship-category reprocessing and asserts one Babaroga -> 2,400 Zero-Point Field Manipulators at NPC 50% yield.
- [x] Foundry acquisition costing, store progress, full-library shopping export, Refinery and market-opportunity controls pass against the refreshed data path.

## Class C — Trade / economy / LP

### War declaration cost
- [x] Reviewed: Sage has no war-declaration cost calculator or war-bill profitability rule, so no executable Sage constant required. 500m/new-bill and grandfathered 100m facts retained in this manifest.

### Insurgency / FW reward changes
- [x] Audited maintained FW/Insurgency surface; Activity Planner reference data updated to Cradle values.
- [x] Activity Planner now represents Moderate ADV-3 (52,500 LP, 1.5% corruption/suppression, +20% BC skill effect/level) and explicitly notes the 2026-09-24.1 Drekavac fix.
- [x] Activity Planner updated for Ice Heist 150,000 LP / 4 h, Mining Ambush ADV-5 and Small AF-1; generic ADV site guidance reviewed.
- [x] Activity Planner Insurgency reference includes 1.5m max contribution at 45%, 1.0x/0.4x win-loss, ambition 5, 7-day duration and 48 h forecast.

### Pochven reward changes

- [x] Fitter Pochven scenario explicitly warns that final Vigilance payout requires being within 50 km of the Spire.
- [x] Reviewed: Sage has no high-sec Pochven phase payout calculator/table, so there is no stale secondary-payout value to remove.
- [x] Reviewed: Sage has no Acceleration Flashpoint spawn-location table; no stale location list exists.
- [x] Fitter Pochven scenario updated to optimum fleet size 12, per-pilot payout unchanged.
- [x] Fitter Pochven scenario updated to optimum fleet size 12, per-pilot payout unchanged.
- [x] Reviewed: no Pochven income/hour or fleet-payout estimator exists in Sage; no numeric engine required updating.
- [x] Reviewed: Sage has no dedicated Pochven LP-offer catalogue; new published mutaplasmids and Hybrid Drone Specialization are present in the refreshed SDE/market groups and type resolution.

### Rampant Drone Fabricator rewards
- [x] Kept as CCP patch-note behavioral reference only; Activity Planner states the 50% reduction and no fabricated SDE loot table was added.
- [x] Sage has no Fabricator income estimator; Activity Planner reference records +33% C1-C3 / +25% C4 / +20% C5-C6 without inventing a loot engine.

## Class D — Navigation / travel

### Ansiblex
- [x] New per-hull base activation-cost DOGMA attribute present in current SDE.
- [x] Model bridge capacity 1,250 TJ.
- [x] Exact Ansiblex recharge curve intentionally not invented: route logic uses recorded available capacitor/capacity and warns when capacitor metadata is unknown.
- [x] Distance multiplier by owning-alliance capital distance: 0-5 ly 0x; 5.1-10 2x; 10.1-15 6x; 15.1-20 9x; 20.1+ 15x.
- [x] Alliance-only access and starting-system sovereignty ownership requirement.
- [x] Capital restriction: capitals blocked except Rorqual, Freighters and Jump Freighters.
- [x] Route planner does not treat an Ansiblex as usable when known eligibility/capacitor metadata fails.
- [x] Route legs carry projected activation cost / usability metadata; missing policy inputs remain warnings rather than guessed values.
- [x] 2026-09-22.2 hotfix: do not model remote capacitor transfer into Ansiblex.

### Sovereignty infrastructure
- [x] Reviewed: Sage currently has no Tenebrex/system structure-limit rules engine, so no stale 3-per-system constant exists.

### Wormhole route implications
- [x] Current ship mass comes from refreshed SDE/fitting DOGMA.
- [x] Changed marauder/black-ops masses are asserted through the wormhole rolling mass path.

## Class E — Wormholes / PvE / Pochven / Abyss

### 2026-09-24.1 follow-up
- [x] Moderate ADV-3 reference explicitly includes the Drekavac after CCP corrected its +20% Battlecruiser skill-effect bonus.
- [x] Moderate Corporate Outpost Beacon type 97658 present in refreshed SDE; Sage does not maintain a separate beacon-type simulator.
- [x] C1-C3 mechanics overlay now records that NPCs no longer attack Capsules or Zephyrs.


### C1-C3 wormhole combat sites

- [x] Reviewed: Sage does not simulate CCP encounter NPC orbit AI for Pochven/Homefront/FW; no fabricated orbit rewrite added to sheet statistics.
- [x] C1-C3 CCP mechanics overlay records split targeting between capsuleers.
- [x] C1-C3 CCP mechanics overlay records no drone targeting; 2026-09-24.1 follow-up also records no Capsule/Zephyr targeting.
- [x] C1-C3 overlay records the behavioral change separately from raw sheet statistics.
- [x] UFR overlay explicitly records the Sleepless Defender destruction trigger requirement.
- [x] Reviewed as UI/objective-only; no simulation statistic fabricated.

### Pochven
- [x] Fitter Vigilance Point scenario explicitly records doubled Stirring anti-drone damage; no unsupported raw NPC-sheet mutation added.
- [x] Fitter Pochven scenario records increased roaming population/improved AI as behavioral guidance.
- [x] Fitter Pochven guidance records 30-minute phases, 75 km new-phase warp-in, scouts and linger behavior; not misrepresented as static wormhole mass data.
- [x] Current SDE and Sage wormhole reference assert I078/L687/O546 at 750,000,000 kg and 720 minutes.
- [x] Checked under Class C; Sage has no separate fleet-payout estimator to cascade.

### Rampant Drone Fabricator
- [x] Activity Planner Fabricator guidance records updated engagement/warp distances as behavioral rules.
- [x] Activity Planner Fabricator guidance records NPC warp-disruption immunity.
- [x] Activity Planner Fabricator guidance records Interdictors taking 20% NPC damage.
- [x] Activity Planner Fabricator guidance records 18/15/12/6 s staggering and 6 s before wave 5; timing is reference-only because Sage has no Fabricator wave-timer simulator.
- [x] Hybrid Drone Specialization (97263), Radical Drone Link Augmentor Mutaplasmid (97247) and Radical Drone Navigation Computer Mutaplasmid (97249) resolve from current SDE; mutation stress covers the new Radical families.

### Abyss
- [x] No Cradle-of-War 2026-09-22.1/22.2 Abyss-specific balance line identified.
- [x] Abyss room/weather, NPC damage and PvE clear-time regressions pass on refreshed DOGMA.

## Class F — SDE / ESI / API / platform

- [x] Official latest SDE fetched and validated.
- [x] Patch intake validates types, groups, categories, typeDogma, dogmaAttributes, dogmaEffects, blueprints, typeMaterials, marketGroups and mapSolarSystems.
- [x] One previous SDE generation is now retained after future promotions for mandatory before/after comparison and rollback evidence.
- [x] Release fitting bundle build no longer force-promotes an identical SDE.
- [x] Release fitting rebuild can force local current-SDE preparation instead of reusing stale bundled data.
- [x] Patch intake is idempotent when the currently active generation matches CCP and the legacy previous archive is unavailable.
- [x] Final 24.01 patch notes through 2026-09-24.1 reviewed: no Cradle-specific ESI endpoint/scope contract change identified; existing scope schema left unchanged.
- [x] Patch intake promoted the 2026-09-24 SDE, fitting bundles were force-rebuilt from it, refinery cache schema was bumped, and industrial/wormhole preparations/tests consumed the same active archive.

## Mandatory Sage surface sweep

Patch-note completeness additions:
- [x] Reviewed: Sage has no Expert Systems catalogue/feature, so this is N/A until such a surface exists.
- [x] Current SDE market grouping reviewed; new Radical drone mutaplasmids are published in Drone Mutaplasmids groups and Hybrid Drone Specialization is in Skills > Drones. Existing type-ID thumbnail policy applies.

Every relevant surface named by the doctrine must be checked even when the result is “data-driven; no code change”:

- [x] Home / Character / Assets / Wallet / Orders / Contracts — reviewed; no Cradle-specific formulas. Full regression covers page state, assets, private refresh and contract paths.
- [x] Market / Order Desk / Trade / ISK Command / Ledger — reviewed; no tax/order-rule change in Cradle. New item visibility flows through refreshed SDE/market static data; market opportunity/profit tests pass.
- [x] Fitter / Fix My Fit / Doctrine / Skill Planner — changed-hull, mutation, level-0 skill, DOGMA and catalogue regressions pass.
- [x] Project Foundry / Industry / Refinery / Ore Buyback / PI — Babaroga manufacturing/reprocessing fixed and asserted; Foundry/acquisition/buyback/industrial tests pass; no Cradle PI change.
- [x] Navigation Command / capital travel / route export / wormholes — Ansiblex policy/cost, capital routing, route export, mass rolling and new Pochven wormholes pass.
- [x] PvE command / wormhole sites / Pochven / Abyss — C1-C3 overlays, Pochven guidance/Fleet sizes, Fabricator references and Abyss regressions reviewed/pass.
- [x] Wargames / Combat Simulator — combat/support/environment suites pass; remote-cap impedance now propagates into simulation.
- [x] Corp structures / structure limits / activity command — Activity Planner updated; Tenebrex limit reviewed N/A because Sage has no structure-limit rules engine; Corporation Command Electron smoke passes.
- [x] Server/shared caches / online data products / MCP tools — refreshed SDE/bundles verified; no Cradle ESI/MCP schema change. Existing unrelated server-worker test mismatch is recorded separately.
- [x] Export/import schemas and saved-fit / saved-route compatibility — no patch-driven serialized shape change; fitting persistence/import and navigation export/end-to-end regressions pass.

## Full-suite dirty-tree exceptions

The 2026-09-24 patch pass ran the complete 137-file Sage regression suite after the latest SDE refresh.

- **135 / 137 pass.**
- The two remaining failures are outside this patch scope and pre-existed in the active dirty-tree feature work:
  - tests/hr/hr-service.test.mjs expects the scope manifest to contain no mail action scopes, while the in-progress Sage Mail feature intentionally includes existing esi-mail.send_mail.v1 / esi-mail.organize_mail.v1 action scopes.
  - tests/market/server-first-sync.test.cjs has a stale source-shape assertion against the in-progress public-data/server worker changes.
- No Cradle/24.01, fitting, navigation, wormhole, industry, progression, Wargames, or patch-specific regression remains failing.

## Verification gate

Do not mark the patch closed until:
1. TypeScript typecheck passes.
2. Navigation tests pass including Ansiblex eligibility/cost cases. **PASS 2026-09-24**
3. Fitting/DOGMA regression passes for representative changed hulls.
4. Wargames regression passes.
5. Wormhole tests pass with C1-C3 mechanic overlay.
6. Industrial/refinery assertions pass for Babaroga.
7. Market/catalogue tests confirm new published items can be discovered.
8. Full test suite / build passes, or every unrelated pre-existing failure is recorded separately.
9. Dirty-tree review confirms no pre-existing user work was reset or overwritten.

## Patch readiness result — 2026-09-24

**Patch compatibility status: VERIFIED for Cradle of War 24.01 through 2026-09-24.1.**

- Latest official SDE: 2026-09-24 11:26:58 GMT generation promoted and diffed.
- Typecheck: PASS.
- Navigation/Ansiblex: PASS.
- Combat/DOGMA/changed hulls: PASS.
- Mutaplasmid catalogue: PASS — 980 mutable base types / 5,262 mappings, including all four new Radical drone-module families.
- Industry/Refinery/Babaroga: PASS — 4,800 manufacture / 2,400 NPC reprocess.
- Wormholes/PvE/Pochven/Abyss: PASS for modelled/static/reference surfaces.
- Wargames: PASS, including Siege/Triage remote-cap impedance.
- Production build: PASS.
- Electron Corporation Command desktop smoke: PASS, zero renderer/console errors.
- Full regression: 135/137 PASS; the two failures are unrelated active dirty-tree HR/Sage-Mail and server-worker test expectation mismatches documented above.
- Master-update smoke: environment-limited by safeStorage decrypting the existing private-token ciphertext under the smoke Electron context; no patch-sensitive failure reached.

**General repository release-candidate status remains conditional** until the two unrelated dirty-tree test expectations and the private-token smoke context are reconciled. This does not invalidate the patch-domain compatibility results above.


## Closure confirmation — 2026-09-26

The stale IN PROGRESS header was reconciled after re-running the current dirty-tree patch gates. Cradle core balance, maintained surface values, changed-hull fitting, Siege/Triage remote-cap impedance, Navigation/Ansiblex, Wormhole/C1-C3, both TypeScript projects, and the production build all pass. The Cradle of War 24.01 balance update is therefore closed through CCP hotfix 2026-09-24.1.
