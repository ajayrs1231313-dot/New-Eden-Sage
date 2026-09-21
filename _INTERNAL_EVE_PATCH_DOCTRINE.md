# NEW EDEN SAGE — INTERNAL EVE ONLINE PATCH DOCTRINE

**Status:** Mandatory developer policy
**Audience:** Sage developers / maintainers only
**User-facing:** No. This file is intentionally outside the packaged Electron `build.files` whitelist.
**Last codebase audit:** 2026-09-21
**Primary rule:** An EVE balance/data patch is a Sage-wide compatibility event, not a collection of isolated page fixes.

---

## 1. PURPOSE

This doctrine defines the single procedure Sage must follow whenever CCP changes EVE Online mechanics, static data, economy rules, navigation, PvE, wormholes, structures, markets, industry, skills, ships, modules, NPCs, sites, LP, taxes, or APIs.

The objective is simple:

> **One CCP patch -> one Sage impact manifest -> one coordinated Sage patch -> one verification gate.**

Do not patch Fitter, Industry, Market, Navigation, Wormholes, PvE, or UI independently when the upstream EVE change can cross domain boundaries.

The doctrine exists because Sage deliberately reuses the same EVE facts in multiple systems. A ship mass change can affect fitting, align/travel calculations, wormhole rolling, navigation eligibility, readiness and Wargames. A blueprint change can affect manufacturing, Foundry, asset valuation, profit calculation, shopping lists and market opportunities. A tax/fee change can affect trade, contracts, industry profitability and corp tooling.

---

## 2. PATCH CLASSES COVERED

Every EVE patch must be classified against **all** classes below. Multiple classes may apply.

### A — Combat / ship / DOGMA balance
Includes:
- Ship hull attributes, mass, agility, velocity, capacitor, signature, slots, fitting resources.
- Shield/armor/hull HP and resistances.
- Weapon, drone, fighter, missile, turret, smartbomb and damage changes.
- Tracking/application, explosion radius/velocity, falloff/optimal, drone travel/application.
- Module effects, stacking penalties, projected effects, EWAR, tackle, command bursts.
- Skills and skill bonuses.
- Implants, boosters, rigs, charges and ammunition.
- Overheating, capacitor use/recharge, repair, remote assistance.
- Mutaplasmids and abyssal module rules.
- Special ship mechanics and role bonuses.

### B — Industry / refining / resource / production
Includes:
- Blueprint inputs, outputs, quantities, times, probabilities and required skills.
- Manufacturing, reactions, invention, copying and research.
- Reprocessing outputs, portion sizes, ore/gas/ice changes.
- Reprocessing skills, facility/rig/security/implant bonuses.
- Mining yield, cycle time, residue/waste, compression or resource distribution.
- PI / planetary changes.
- Structure industry bonuses, service modules and fuel where Sage models them.
- New/removed materials, components, products or industrial chains.

### C — Trade / economy / market / contracts / LP
Includes:
- Market taxes, broker fees, relist fees or sales-tax changes.
- Contract fees/rules, auction/item-exchange behaviour.
- Market order rules, ranges, durations or limits.
- NPC/reference prices and valuation mechanics.
- LP store offers, currencies, costs or payouts.
- Loot/value changes that affect opportunity ranking.
- Buyback logic, hub comparisons, regional spreads and profitability.
- Any new item/group/category that must appear in search, valuation or trading tools.

### D — Navigation / travel / force projection / sovereignty
Includes:
- Stargates, map topology, system/constellation/region/security changes.
- Route cost/risk rules.
- Ansiblex/jump bridge access, cost, capacitor, range or ownership rules.
- Jump drives, jump fatigue, range, fuel and capital travel.
- Cynosural rules where Sage models route feasibility.
- Pochven entry/exit/travel rules.
- Thera/wormhole shortcuts when exposed to route planning.
- Structures/sovereignty mechanics that affect travel or system access.

### E — Wormholes / PvE / Pochven / Abyss / sites
Includes:
- Wormhole class/type/mass/lifetime/destination changes.
- Rolling mass, ship mass interactions and frigate-only rules.
- Wormhole site composition, wave triggers, EWAR, neuts, reps, DPS, alpha, EHP and loot.
- Cosmic signatures/anomalies/resource sites.
- NPC attributes, AI or susceptibility mechanics.
- Abyss rooms, weather effects, tiers, NPC types or spawn envelopes.
- Missions, incursions, insurgencies, escalations and Pochven sites.
- Site fleet caps, payout rules, timers and objectives.

### F — SDE / ESI / API / data-contract changes
Includes:
- SDE schema, entry names or field changes.
- New DOGMA attributes/effects/operations.
- ESI endpoint, scope, caching, pagination or response changes.
- Removed/renamed type/group/category IDs.
- New data required for an existing Sage calculation.
- CCP policy/API changes that make an existing Sage behaviour invalid.

**F is always checked even if the patch appears to be only balance.**

---

## 3. SOURCE-OF-TRUTH ORDER

Patch work must use this source priority:

1. **Final CCP patch notes for the deployed build.**
2. **Current official CCP SDE** compared against the previous known-good SDE.
3. **Official CCP developer/API documentation and ESI behaviour.**
4. **Official dev blogs**, only where final patch notes/SDE do not fully describe gameplay rules.
5. **Maintained external references only for facts CCP does not expose adequately**, and those references must be identified explicitly in code/tests.

Never update Sage solely from preview notes when the final patch is available.

Never assume a new SDE means every Sage model is automatically current. Sage contains intentionally maintained non-SDE models.

Known non-SDE or partly non-SDE examples found in the 2026-09-21 audit:
- `electron/abyss-encounters.ts` — maintained encounter/room catalogue using stable CCP type IDs plus external room provenance.
- `electron/wormhole-site-reference.ts` — versioned external wormhole PvE site reference.
- `electron/refinery-engine.ts` — reprocessing/facility/security/implant multipliers include explicit rules in code.
- Navigation/wormhole policy code contains explicit eligibility/risk rules in addition to static universe data.

---

## 4. PATCH INTAKE — CREATE ONE IMPACT MANIFEST

Before changing behaviour, create a patch impact manifest in the working notes using this shape:

```
Patch ID:
EVE build/date:
Final CCP notes:
SDE signature/archive:
Previous SDE signature/archive:

Classes affected:
[ ] A Combat/DOGMA
[ ] B Industry/Refining
[ ] C Trade/Economy/LP
[ ] D Navigation/Travel
[ ] E Wormholes/PvE/Pochven/Abyss
[ ] F SDE/ESI/API

Changed type IDs:
Changed groups/categories:
Changed DOGMA attributes/effects:
Changed skills:
Changed blueprints/materials:
Changed reprocessing/resource data:
Changed map/navigation data:
Changed NPC/site mechanics:
Changed market/tax/contract/LP rules:
Changed ESI/SDE contracts:
New mechanics Sage does not yet model:

Sage modules affected:
Caches/bundles affected:
Tests affected:
Manual references requiring review:
Release blockers:
```

A patch is **not** considered analysed until every class has been marked affected/not affected.

---

## 5. SDE DIFF IS MANDATORY

For any balance/data patch, compare the old known-good SDE with the newly deployed SDE.

At minimum diff:
- `types.jsonl`
- `groups.jsonl`
- `categories.jsonl`
- `typeDogma.jsonl`
- `dogmaAttributes.jsonl`
- `dogmaEffects.jsonl`
- `blueprints.jsonl`
- `typeMaterials.jsonl`
- `marketGroups.jsonl`
- Map universe data when navigation/system changes are possible.
- NPC/corporation/station/faction data when PvE/location changes are possible.

The existing downloader is:
- `electron/static-data-update-worker.ts`

The SDE is currently consumed directly or indirectly by:
- `electron/type-volumes.ts`
- `electron/fitting-dogma.ts`
- `electron/industrial-engine.ts`
- `electron/refinery-engine.ts`
- `electron/pve-static-index.ts`
- `electron/wormhole-reference.ts`
- market/static preparation code
- navigation/static metadata and graph code

If CCP adds a new SDE file required for correctness, update the static-data validation/preparation path rather than silently falling back.

**Unknown DOGMA effects/attributes or new mechanic shapes must fail loudly or be explicitly reviewed. Do not silently approximate a newly introduced mechanic.**

---

## 6. IMPLEMENTATION ORDER — ALWAYS PATCH IN THIS ORDER

### Stage 1 — Authoritative data
1. Confirm deployed CCP notes.
2. Acquire/stage the new SDE.
3. Diff old/new static data.
4. Record changed IDs and schema.
5. Identify non-SDE rules/reference data touched by the patch.

### Stage 2 — Core engines
Patch data/model logic before UI:
1. DOGMA / fitting.
2. Industry / refining / invention / resource calculations.
3. Market/economy/valuation.
4. Navigation/route/force projection.
5. Wormhole/PvE/Abyss/Pochven.
6. Shared capability/readiness/derived logic.

### Stage 3 — Derived data and caches
Rebuild/invalidate every derived artifact affected by Stage 1/2.

Do not allow an old prepared cache to make a new engine appear correct.

Relevant prepared/static systems include:
- Fitting prepared index/catalogue in `electron/fitting-dogma.ts`.
- Bundled fitting data in `vendor/fitting-data`.
- Industrial prepared index in `electron/industrial-engine.ts`.
- Refinery persisted static cache in `electron/refinery-engine.ts`.
- PvE static revision in `electron/pve-static-index.ts`.
- Wormhole prepared/static data.
- Market static/prepared data and shared market artifacts.

**Schema version bump:** required when serialized shape/meaning changes.
**Data-only patch:** archive/signature/revision invalidation is sufficient only when the cache key demonstrably follows the new data. Verify this; do not assume it.

### Stage 4 — IPC / shared types / preload
If result shapes or new concepts changed:
- Update Electron IPC handlers.
- Update preload exposure.
- Update shared TypeScript types.
- Update MCP/tool outputs where relevant.

Typical cross-cutting files:
- `electron/main-task9.ts`
- `electron/preload.ts`
- `src/types.ts`
- `electron/mcp-server.ts`

### Stage 5 — User-facing consumers
Only after the engine is correct:
- Fitter / Show Info / Fix My Fit.
- Skills/readiness/activity recommendations.
- Industrial Command / Foundry / Invention / Refinery.
- ISK Command / Market / Order Desk / Contracts / buyback.
- Navigation Command / maps / route lists.
- Wormhole Command / PvE intelligence.
- Corporation/structure views where affected.
- Wargames/simulator.

### Stage 6 — Verification gate
Run domain tests, full regression, typecheck/build, then desktop smoke.

No patch is complete because “the page looks right.”

---

## 7. CODEBASE IMPACT MAP — 2026-09-21 AUDIT

This map is intentionally conservative. It lists files that must be considered when their domain is touched; it is not permission to ignore other files found by search.

### A. Combat / DOGMA primary engine
Core:
- `electron/fitting-dogma.ts`
- `src/fitting-engine.ts`
- `src/fitter-presentation.ts`
- `electron/skill-static.ts`
- `electron/skill-training.ts`
- `electron/readiness.ts`
- `electron/activity-readiness.ts`
- `electron/capability-engine.ts`

Combat/PvE/simulation consumers:
- `electron/abyss-encounters.ts`
- `electron/pve-clear-time.ts`
- `electron/pve-location-intelligence.ts`
- `src/wargame-engine.ts`
- `src/wargame-command-model.ts`
- `src/wargame-fit-bridge.ts`
- `src/wargame-types.ts`
- `src/Fittings.tsx`
- `src/FittingShowInfo.tsx`
- `src/CorporationDoctrines.tsx`
- `src/OperationFitPreview.tsx`

Patch-day search terms:
`attributeID`, `effectID`, `groupID`, `typeId`, `damage`, `resist`, `capacitor`, `mass`, `agility`, `drone`, `fighter`, `missile`, `turret`, `ewar`, `overheat`, `implant`, `rig`, `mutaplasmid`.

### B. Industry / refining / production
Core:
- `electron/industrial-engine.ts`
- `electron/industrial-preparation.ts`
- `electron/refinery-engine.ts`
- `electron/project-foundry.ts`
- `electron/planetary-advanced.ts`
- `electron/planetary-revenue.ts`
- `electron/profit-ledger.ts`
- `electron/asset-valuation.ts`

UI/consumers:
- `src/IndustrialCommand.tsx`
- `src/IndustrialProjectFoundry.tsx`
- `src/InventionIntelligence.tsx`
- `src/PlanetaryAdvanced.tsx`
- `src/PlanetaryRevenue.tsx`
- `src/AssetsCommand.tsx`

Patch-day search terms:
`blueprint`, `manufacturing`, `invention`, `reaction`, `materials`, `typeMaterials`, `portionSize`, `reprocess`, `refinery`, `yield`, `waste`, `compression`, `planetary`, `facility`, `rig`.

Special warning:
`electron/refinery-engine.ts` currently contains explicit skill/facility/security/implant rule constants and multipliers. A refinery/reprocessing balance patch requires a manual rule audit even if SDE material outputs changed correctly.

### C. Trade / market / contracts / LP
Core:
- `electron/market-intelligence.ts`
- `electron/full-market-trade.ts`
- `electron/trade.ts`
- `electron/market.ts`
- `electron/market-depth.ts`
- `electron/market-storage.ts`
- `electron/public-market-intelligence.ts`
- `electron/shared-market-data.ts`
- `electron/raw-market-analysis.ts`
- `electron/raw-market-search.ts`
- `electron/regional-market-filter.ts`
- `electron/regional-market-index.ts`
- `electron/regional-shortage.ts`
- `electron/opportunity-engine.ts`
- `electron/asset-valuation.ts`
- `electron/lp-store.ts`
- `electron/blueprint-contract-history.ts`
- `electron/contract-intelligence-process.ts`
- `electron/profit-ledger.ts`

UI/consumers:
- `src/GlobalMarketSearch.tsx`
- `src/OrderDesk.tsx`
- `src/MarketContracts.tsx`
- `src/MarketDayTrader.tsx`
- `src/MarketOpportunityScanner.tsx`
- `src/OpportunityExplorer.tsx`
- `src/LpStore.tsx`
- `src/CorporationOreBuyback.tsx`
- `src/contract-profit-projection.ts`

Patch-day search terms:
`broker`, `tax`, `fee`, `order`, `contract`, `auction`, `price`, `reference price`, `LP`, `loyalty`, `buyback`, `spread`, `profit`, `region`, `hub`.

### D. Navigation / travel / force projection / structures
Core:
- `electron/navigation-route-planner.ts`
- `electron/navigation-route-intelligence.ts`
- `electron/navigation-route-serialization.ts`
- `electron/navigation-capital.ts`
- `electron/navigation-hazards.ts`
- `electron/navigation-static-metadata.ts`
- `electron/navigation-character-location.ts`
- `electron/navigation-command-ipc.ts`
- `electron/route-graph.ts`
- `electron/universe-route-graph.ts`
- `electron/system-intelligence.ts`
- `electron/system-intelligence-policy.ts`

UI/consumers:
- `src/NavigationCommand.tsx`
- `src/NavigationRouteList.tsx`
- `src/NavigationUniverseMap.tsx`
- `src/OnTheFlyJumpMap.tsx`
- `src/CorporationFindHome.tsx`

Cross-domain consumers:
- `electron/opportunity-engine.ts`
- market opportunity/routing code
- corp logistics/trade route features
- wormhole special connections

Patch-day search terms:
`route`, `jump`, `mass`, `fuel`, `range`, `fatigue`, `ansiblex`, `bridge`, `cyno`, `gate`, `securityStatus`, `sovereignty`, `structure`, `upwell`, `customConnection`.

A navigation patch must also test market opportunity routing because route risk/cost affects trade recommendations.

### E. Wormholes / PvE / Pochven / Abyss
Core wormhole:
- `electron/wormhole-reference.ts`
- `electron/wormhole-site-reference.ts`
- `electron/wormhole-static-worker.ts`
- `electron/wormhole-command-store.ts`
- `electron/wormhole-scan-reconcile.ts`
- `src/wormhole-scanner.ts`
- `src/wormhole-history.ts`
- `src/wormhole-rolling-math.ts`
- `src/WormholeCommand.tsx`

PvE/Abyss/location:
- `electron/abyss-encounters.ts`
- `electron/pve-static-index.ts`
- `electron/pve-clear-time.ts`
- `electron/pve-location-intelligence.ts`
- `src/PveLocationIntel.tsx`
- activity planner/readiness rules
- Wargames environment/combat model

Navigation coupling:
- `electron/navigation-route-planner.ts`
- `electron/navigation-route-intelligence.ts`
- wormhole/thera custom connection handling

Patch-day search terms:
`wormhole`, `maxJumpMass`, `remainingMass`, `lifetime`, `EOL`, `critical`, `frigateOnly`, `site`, `wave`, `trigger`, `scram`, `web`, `neut`, `remoteRep`, `NPC`, `abyss`, `weather`, `pochven`, `incursion`, `insurgency`, `escalation`.

Special warnings:
- Wormhole site data is not purely SDE-driven.
- Abyss room composition is not purely SDE-driven.
- Ship mass changes can alter wormhole rolling even when no wormhole type changed.
- NPC behavioural changes may require simulator/readiness logic changes even when NPC raw attributes are unchanged.

---

## 8. CROSS-DOMAIN CHANGE RULES

These are mandatory cascade checks.

### Ship hull or module balance
Check:
DOGMA -> Fitter -> Fix My Fit -> readiness/skills -> Wargames -> PvE clear-time -> doctrines -> wormhole mass/rolling if mass changed -> navigation if travel properties changed -> valuation/market display if new/removed type.

### Skill change or new skill
Check:
DOGMA modifiers -> skill static/training -> Fitter -> readiness/activity planner -> Wargames/PvE -> industrial requirements if applicable -> UI/tooltips.

### Blueprint/material change
Check:
Industrial engine -> preparation/cache -> Foundry -> invention -> shopping lists -> assets/material inventory -> valuation -> profit ledger -> market opportunity -> corp production views.

### Ore/gas/reprocessing change
Check:
Refinery SDE outputs -> explicit yield rules -> mining/resource presentation -> industrial inputs -> valuation -> buyback -> wormhole gas/ore site values if affected.

### Tax/broker/contract rule change
Check:
Trade calculations -> contract projection -> profit ledger -> industry profitability -> buyback economics -> market opportunity ranking -> UI copy.

### Mass/agility/travel change
Check:
Fitter/DOGMA -> Navigation -> capital travel -> wormhole rolling -> Wargames movement/application where modelled -> logistics/trade route scoring.

### Stargate/Ansiblex/jump rule change
Check:
route graph -> route planner -> route intelligence -> capital routing -> custom/special connection access -> market opportunity route risk -> Navigation UI/export.

### Wormhole type/mass/lifetime change
Check:
wormhole reference -> prepared cache -> rolling math -> route special connections -> scanner/status presentation -> PvE/site recommendations where class/destination changes.

### NPC/site/PvE rule change
Check:
site reference/encounter catalogue -> NPC DOGMA profile -> clear-time -> readiness -> Fitter scenario -> Wargames -> loot/value -> location intelligence.

### LP/payout/loot change
Check:
LP store -> opportunity/value -> PvE ranking -> loot engine -> market/valuation -> profitability.

---

## 9. CACHE AND BUNDLE POLICY

After an upstream patch, identify every cache that can retain old EVE truth.

Rules:
1. Never reuse a prepared cache merely because it deserializes successfully.
2. The cache must be tied to the current upstream data revision/signature or be deliberately regenerated.
3. If the serialized **meaning or shape** changes, bump its schema version.
4. If only source data changes, verify that archive fingerprint/signature invalidation actually forces reconstruction.
5. Release builds must refresh bundled prepared data when the corresponding engine consumes bundled artifacts.

For fitting data:
- Refresh with `npm run fitting:refresh-bundle` when DOGMA/catalogue data changed.
- Verify `vendor/fitting-data` represents the patched SDE before shipping.

Also inspect market prepared data whenever groups/types/volumes/market groups change.

---

## 10. REQUIRED TEST GATES BY DOMAIN

### Combat / DOGMA
At minimum include:
- `tests/fitting/dogma-correctness-regression.test.cjs`
- `tests/fitting/dogma-domain-audit.test.cjs`
- `tests/fitting/full-catalogue-dogma-stress.test.cjs`
- `tests/fitting/skill-bonus-regression.test.cjs`
- `tests/fitting/drone-application-regression.test.cjs`
- `tests/fitting/fighter-combat-regression.test.cjs`
- `tests/fitting/special-mechanics-regressions.test.cjs`
- `tests/fitting/mutaplasmid-catalogue-stress.test.cjs`
- relevant Wargames tests
- relevant Abyss/PvE tests

### Industry / refining
At minimum include:
- `tests/industry-fleet-regression.test.cjs`
- `tests/industrial-invention-parity.test.cjs`
- `tests/refinery-engine.test.cjs`
- `tests/project-foundry.test.cjs`
- `tests/foundry-persistence.test.cjs`
- `tests/material-inventory-presentation.test.cjs`
- blueprint valuation/output tests

### Trade / market / contracts / LP
At minimum include affected:
- market depth
- spread history
- server-first sync
- asset/nearest-buyer tests
- contract tests
- Order Desk tests
- market opportunity controls
- buyback desktop smoke
- LP store isolation/logic tests
- profit reconciliation

### Navigation
Run:
- `npm run test:navigation`

This currently covers:
- route engine
- route intelligence
- EVE export
- capital routing
- end-to-end navigation

Also run:
- `tests/market/opportunity-route-security.test.cjs`
whenever route scoring/security/access changes.

### Wormholes
Run:
- `npm run test:wormhole`

Also run relevant:
- `tests/pve-live-location-polish.test.cjs`
- `tests/fitting/abyss-room-weather.test.cjs`
- `tests/fitting/npc-damage-profiles.test.cjs`
- `tests/fitting/pve-clear-time-regression.test.cjs`
- Wargames environment/special-mechanics tests.

---

## 11. UNIVERSAL RELEASE GATE

Every EVE balance/data patch must finish with:

1. `npm run typecheck`
2. All affected domain suites.
3. `npm run test:all`
4. `npm run build`
5. Desktop smoke of every affected major page.
6. Verify no unknown new DOGMA/mechanic warnings.
7. Verify old caches were not used incorrectly.
8. Verify all changed CCP type IDs appear where expected.
9. Verify unaffected major workflows still open and perform a basic action.
10. Produce a Patch Readiness Report.

For Windows release candidates, the normal release/installer verification remains mandatory; patch doctrine does not replace release doctrine.

---

## 12. PATCH READINESS REPORT TEMPLATE

```
SAGE EVE PATCH READINESS
Patch:
CCP deployed:
SDE revision:
Sage build:

Impact:
- Combat/DOGMA:
- Industry/Refining:
- Trade/Economy/LP:
- Navigation/Travel:
- Wormholes/PvE/Pochven/Abyss:
- SDE/ESI/API:

Upstream changes reviewed:
Sage modules changed:
Prepared caches rebuilt:
Bundled data rebuilt:
Manual reference datasets reviewed:

Tests:
- Typecheck:
- Combat:
- Industry:
- Trade:
- Navigation:
- Wormholes/PvE:
- Full regression:
- Build:
- Desktop smoke:

Unknown mechanics: 0 REQUIRED
Stale caches: 0 REQUIRED
Unexplained golden-result changes: 0 REQUIRED
Blocking failures: 0 REQUIRED

Compatibility:
[ ] VERIFIED
[ ] NOT VERIFIED — DO NOT RELEASE
```

Sage must not claim compatibility with a new EVE patch until the report can be marked **VERIFIED**.

---

## 13. GOLDEN BASELINES

Maintain representative calculations for patch-sensitive domains.

Recommended baseline set:
- Combat fits covering armor/shield/hull, active/passive, cap-stable/unstable, turrets, missiles, drones, fighters, EWAR, remote reps, command bursts, overheating, implants, boosters and mutaplasmids.
- Ships covering frigate through capital plus mass-sensitive wormhole ships.
- Industrial jobs covering T1, T2/invention, components and multi-level manufacturing.
- Refinery cases across NPC/Athanor/Tatara, security bands, rig tiers and processing skills.
- Trade cases covering sell/buy spread, fees, contracts, buyback and route-aware opportunity.
- Navigation cases covering high/low/null, capital, custom connections, wormholes and special networks.
- PvE cases covering Abyss tiers/weather, wormhole classes and representative NPC EWAR/neut/repair behaviour.

When CCP intentionally changes a golden result:
1. Confirm the result against authoritative new rules.
2. Record why it changed.
3. Update the baseline.
4. Never “fix” a regression by simply accepting all new outputs.

---

## 14. EMERGENCY/HOTFIX PATCHES

For a CCP hotfix with incomplete public notes:

1. Do not guess silently.
2. Capture observed/new SDE differences.
3. Mark uncertain mechanics in the impact manifest.
4. Apply only changes supported by evidence.
5. Run the same affected-domain tests.
6. Keep Sage compatibility as **NOT VERIFIED** for any domain with unresolved upstream behaviour.
7. Re-run the doctrine when CCP publishes final clarification.

A small CCP patch may have a small impact manifest, but it does not skip classification.

---

## 15. DO-NOT-DO RULES

- Do not patch only the page where the change was first noticed.
- Do not hard-code a new CCP number in multiple consumers.
- Do not trust preview/dev-blog numbers over final deployed notes/SDE.
- Do not assume SDE updates cover encounter composition, NPC AI, tax rules, access rules or every gameplay formula.
- Do not ship with unexplained differences in golden calculations.
- Do not suppress unknown DOGMA/mechanic handling merely to make tests pass.
- Do not rebuild one cache and leave sibling derived caches stale.
- Do not modify unrelated dirty-tree work during patching.
- Do not send Discord/corp announcements as part of automated patch verification.
- Do not mark a patch “done” until the universal release gate is complete.

---

## 16. HOW TO START EVERY FUTURE EVE PATCH

When told **“patch Sage for today’s EVE update”**, the default procedure is:

1. Open this file.
2. Read final CCP notes.
3. Capture old/new SDE identity.
4. Create the impact manifest.
5. Classify A-F.
6. Search the whole repository for changed mechanic names, type IDs, attributes/effects and related domain terms.
7. Follow the codebase impact map and cascade rules.
8. Patch core data/engines first.
9. Rebuild/invalidate derived caches.
10. Patch IPC/types/UI consumers.
11. Run affected domain suites.
12. Run the universal release gate.
13. Produce the Patch Readiness Report.

**The patch is a single Sage operation. Treat every affected subsystem as part of the same compatibility change-set.**

---

## 17. MANDATORY PAGE-BY-PAGE PATCH SWEEP

**This section is mandatory on every EVE gameplay/data patch.**

The domain scan in Sections 2-8 is not enough by itself. Sage has cross-domain consumers hidden behind command tabs, secondary tabs, retained/cached pages and internal route states.

For every CCP patch, every row below must be marked:

- **PASS** — reviewed/tested and still correct.
- **AFFECTED** — upstream change touches this page; implementation/test work is required or completed.
- **N/A — reason** — reviewed and demonstrably unrelated to this patch.

**Blank is not allowed. “The patch was only combat/industry/navigation/etc.” is not a reason to skip a page.**

The reviewer must also search the codebase for newly added pages/tabs since the last doctrine audit. If a user-reachable page exists and is not listed here, **update this doctrine before declaring compatibility**.

### 17.1 Global shell / shared command infrastructure

- [ ] **Application shell / command navigation** — verify all command routes still mount; retained/cached views do not retain stale pre-patch data; page telemetry names still identify the correct page; cross-command navigation events still land on valid targets.
- [ ] **Character selector / private refresh** — verify ESI snapshot refresh, active-character switching and clone state still propagate to every command consuming character data.
- [ ] **Shared command header / data-age state** — verify market/static/private data revision indicators do not claim current data while a pre-patch cache is active.
- [ ] **Command Priority / Command Watch signals** — re-check any rule driven by industry jobs, market orders, contracts, skill queue, assets, corporation operations or other patch-sensitive data.
- [ ] **Global type/name/icon resolution** — new/renamed/removed type IDs, groups, categories and market groups resolve everywhere.
- [ ] **Cross-command exports** — Fitter -> Skill Planner, Fitter -> Shopping List, Fitter -> Doctrine, Market -> Navigation, Wormhole -> Navigation, Foundry -> Shopping/valuation and any equivalent hand-off still preserve the new mechanics/data.
- [ ] **Prepared data / last-known-good fallbacks** — no page silently shows a coherent but obsolete pre-patch result after the new SDE/revision is installed.

### 17.2 Character Command

Source hierarchy currently lives primarily in \`src/App.tsx\`, \`src/CharacterOverviewHud.tsx\`, \`src/CapabilityCommandCenter.tsx\`, \`src/CharacterQueue.tsx\`, \`src/AugmentsGuide.tsx\`, \`src/KillmailsCommand.tsx\` and \`src/LpStore.tsx\`.

- [ ] **Character** — current ship/type identity, ship capability/readiness, owned-asset summaries, current location, wallet, standings, command priorities, recommended actions and all links into other commands.
- [ ] **Queue** — skill IDs, ranks, prerequisites, current level, queued level, training-time calculations, Alpha/Omega timing assumptions and queue completion display.
- [ ] **Augments** — implants, hardwirings, boosters, slots, attribute modifiers, stacking/eligibility and any implant/booster balance changes that feed Fitter/readiness.
- [ ] **Killmails** — ship/module/type resolution, valuations, NPC/player classification and any renamed/removed item/type relationships.
- [ ] **LP Store** — LP offers, item inputs/outputs, ISK/LP costs, offer availability, valuations, profitability and any new currencies/items or payout changes.
- [ ] **Ship & Capability Readiness card** — PvE Combat, PvP Combat, Mining and Exploration profiles still use correct hull/module/skill data and do not retain old capability thresholds after balance changes.

### 17.3 Activity Command

Primary surfaces: \`src/SkillsWorkspace.tsx\`, \`src/ActivityPlanner.tsx\`, progression/readiness engines.

- [ ] **Activity Planner** — activity definitions, recommended hulls, skill requirements, owned-ship matching, practical readiness, resource/asset scoring and recommendations. Check PvE/PvP/mining/exploration/logistics assumptions affected by the patch.
- [ ] **Ship Planner** — selected hull, required skills, fit-derived skill gaps, remedy candidates, training queue, estimated training time, capability score and any Fitter-originated combat/PvE review intent.
- [ ] **My Skills** — new/removed/renamed skills, ranks, prerequisites, levels, descriptions used by Sage, training-time model and queue state.
- [ ] **Progression Priorities** — recommended upgrades do not keep obsolete hull/module/skill assumptions.
- [ ] **Fitter -> Activity Command bridge** — changed fit legality or new skills propagate correctly when a fit is sent to Ship Planner.

### 17.4 ISK Command

Primary page: \`src/IskLab.tsx\`.

- [ ] **Market Scanner** — retained order inputs, item/type eligibility, cargo capacity, buy/sell prices, fees, route lengths, security/risk, capital constraints, profit, margin and CSV export.
- [ ] **Market Opportunities** — route-aware trading, cargo profile, fill/confidence logic, ISK/m3, route security and any navigation/Ansiblex/topology change that alters the trip.
- [ ] **Order Desk** — personal order state, buy/sell distinction, expiry, undercut/price alert logic, relist implications, taxes/fees and item/type resolution.
- [ ] **Contracts** — public contract search, item/auction/exchange handling, valuation, fees, haul requirement, route/risk and profit calculations.
- [ ] **All Opportunities** — merged ranking remains comparable when one constituent domain changes; changed PvE, trade, industry or route scores cannot be mixed against stale cached scores.
- [ ] **Invention** — invention probability, skills, decryptors, runs, ME/TE effects, source blueprint relationships, datacore/material costs, output valuation and retained-market pricing.
- [ ] **Planetary Revenue** — PI commodities, chains, extraction/production assumptions, volumes, taxes/costs where modelled, market valuation and revenue ranking.
- [ ] **PvE & Locations — MANDATORY PVE PATCH CHECK** — see full dedicated checklist in Section 17.5 below.

### 17.5 PvE & Locations — dedicated mandatory review

Primary files include \`src/PveLocationIntel.tsx\`, \`electron/pve-location-intelligence.ts\`, \`electron/pve-static-index.ts\`, capability/readiness engines and universe routing.

**This page must be explicitly reviewed on every combat, PvE, navigation, NPC, site, standings, incursion or reward patch.**

- [ ] **Incursions** — live ESI incursion state, constellation/system mapping, boss/state/influence interpretation, fleet/site assumptions and payout/risk copy.
- [ ] **Mission staging** — NPC corporation/faction/station mapping, mission-agent staging assumptions, standings requirements where used and high-sec filtering.
- [ ] **DED / Combat search** — candidate systems, security band, NPC activity and any DED/escalation availability or site rule changes.
- [ ] **Low-sec ratting** — NPC kills, ship/pod kills, jumps, security/risk classification, earnings assumptions and route distance.
- [ ] **Null-sec ratting** — same checks plus null topology/access changes and changed ratting/anomaly economics.
- [ ] **Location scoring** — score weights, confidence, safety/risk labels, public activity thresholds and ranking remain meaningful after upstream changes.
- [ ] **Travel calculation** — jumps and estimated minutes use the current universe graph/security/topology; navigation patches must not leave PvE route scoring stale.
- [ ] **Current-ship PvE readiness** — uses current Fitter/DOGMA/capability values after ship/module/skill changes.
- [ ] **Earnings estimates** — bounty/reward/loot assumptions are reviewed when CCP changes payouts, ESS/bounty systems, site rewards, LP, loot or completion mechanics.
- [ ] **Standings** — faction/corporation standing gates and labels remain correct when agent/mission access rules change.
- [ ] **Live-data freshness** — incursion/kills/jumps data age and cached fallbacks are surfaced accurately.
- [ ] **Archetype/display mapping** — high/low/null/wormhole/abyss labels and any content classification exposed by this page remain truthful.
- [ ] **Action/navigation hand-off** — opening a route or acting on a location lead still targets a valid route under the patched map/access rules.

### 17.6 Navigation Command

Primary page: \`src/NavigationCommand.tsx\` plus the \`electron/navigation-*.ts\`, route graph and universe graph modules.

- [ ] **Route Planner** — stargate topology, shortest/safer/less-secure/high-sec modes, security floors, avoids, hazards and route legality.
- [ ] **Special connections** — Ansiblex, wormhole, Thera, Turnur, Zarzakh and manual edges: access, directionality, expiry, restrictions, network ownership and eligibility.
- [ ] **Ansiblex / force projection** — capacitor/cost/range/access/ownership/ship restrictions and any alliance/sovereignty dependencies.
- [ ] **Advanced Map** — nodes/edges/security/system metadata represent the patched universe and route result correctly.
- [ ] **Saved Routes** — old saved routes are revalidated against removed/changed gates, systems, access rules and special connections rather than assumed valid.
- [ ] **Route Intelligence** — hazard/activity/security annotations and route scoring use current rules and data.
- [ ] **Capital / Jump Planner** — jump range, fatigue, fuel, cyno eligibility, ship restrictions and any capital travel mechanics.
- [ ] **Wormhole mass-aware transit** — current ship mass from DOGMA, prop-on mass, maximum jump mass, EOL/critical/frigate-only avoidance and connection expiry.
- [ ] **EVE route export** — exported waypoints still correspond to the route Sage displayed.
- [ ] **Trade/PvE coupling** — Market Opportunities, Contracts, PvE & Locations and logistics calculations consuming route distance/risk are re-tested whenever Navigation changes.

### 17.7 Wormhole Command

Primary page: \`src/WormholeCommand.tsx\`.

- [ ] **Map** — system class/effect metadata, chain connections, source/destination, labels, expiry/status, home/rally markers, route bridge and graph behaviour.
- [ ] **Scanner** — probe scanner parsing, signature kinds/names, reconciliation, new/changed site categories and duplicate/change detection.
- [ ] **Intel** — system effects, known structures, corporation-presence evidence, killmail/activity feed, threat scoring and distance-from-home logic.
- [ ] **Sites — MANDATORY WORMHOLE PVE CHECK** — site names/classes/categories, waves, triggers, NPC quantities, DPS, alpha, EHP, scrams, webs, neuts, remote reps, effect ranges, resources, blue loot, gas/ore values and site state.
- [ ] **Sites / Can I run this?** — current ship + pilot skills are recalculated through current DOGMA; system effects, effective tank, capacitor pressure and application remain aligned with the patched combat model.
- [ ] **Site reference provenance** — \`electron/wormhole-site-reference.ts\` external maintained source is checked whenever CCP changes wormhole PvE because SDE refresh alone cannot prove this data is current.
- [ ] **Rolling** — total mass, variance, max jump mass, remaining mass, cold/prop mass, mass-addition effects, ship eligibility, pass windows, direction sequencing and collapse-risk labels.
- [ ] **Corporation** — published/shared chain data, permissions, versioning, event sync and newly required connection metadata still round-trip.
- [ ] **Navigation bridge** — active wormhole links exported to mixed gate/WH routing obey the same patched restrictions as Wormhole Command.
- [ ] **Wormhole ship mass coupling** — any ship/module mass or propulsion mass-addition patch triggers Rolling and Navigation re-tests even if CCP made no wormhole-specific change.

### 17.8 Fitting Command

Primary files include \`src/Fittings.tsx\`, \`electron/fitting-dogma.ts\`, fitting workers/persistence/import and Fitter tests.

**Fitting Command is not one checkbox. Every surface below is separately reviewed.**

- [ ] **Ship Catalogue** — new/removed/renamed hulls, groups, categories, hull eligibility and ship base attributes.
- [ ] **Module Catalogue** — high/mid/low/rig/subsystem placement, drones, fighters, charges, implants, boosters, deployables, structure equipment and market-group organisation.
- [ ] **Import current EVE fit / text import** — slot proof, charges, quantities, active/offline/overheated state, drones/fighters/cargo and unknown item handling.
- [ ] **Saved Fits / persistence / duplicate / rename** — old fits containing changed or removed items load safely and recalculate from new DOGMA rather than keeping old calculated stats.
- [ ] **CPU / powergrid / calibration / slots / hardpoints / bandwidth / bay** — legality and resource totals.
- [ ] **DPS / volley** — turrets, missiles, drones, fighters, smart/AoE sources, reloads, magazines, spool/ramp mechanics and selected drone flight.
- [ ] **Application** — tracking, optimal/falloff, signature resolution, missile explosion radius/velocity/DRF, target signature/speed/transversal, drone travel/control/orbit and fighter travel/abilities.
- [ ] **Tank / EHP** — shield/armor/hull HP, resists, active reps, passive shield, ADC/special defenses, incoming damage profile and stacking.
- [ ] **Capacitor** — capacity, recharge, stability, module cap use, neuts/NOS, boosters and projected capacitor effects.
- [ ] **Mobility** — mass, agility, velocity, afterburner/MWD, prop mass addition and any movement values used by Navigation/Wormholes/Wargames.
- [ ] **EWAR / tackle / support** — scram, point, web, paint, ECM, damps, tracking/guidance disruption, remote reps, remote capacitor, sensor/tracking support and command bursts.
- [ ] **Overheating / module state** — heat bonuses, cycle/state behaviour and active/online/offline calculations.
- [ ] **Skills / implants / boosters / rigs / subsystem bonuses** — all modifier domains and stacking/required-skill relationships.
- [ ] **Mutaplasmids / abyssal modules** — mutation ranges, eligible base items, mutated attribute overrides and catalogue handling.
- [ ] **Show Info / tooltips** — primary attributes shown to the user match the same current DOGMA the engine calculates.
- [ ] **Fix My Fit / remedies** — recommended skills/modules/implants/rigs still resolve the actual post-patch deficit and never suggest a now-invalid item/requirement.
- [ ] **Fit cost / shopping list / market bridge** — changed types, volumes and prices propagate; quantities/charges/drones are complete.
- [ ] **Doctrine export** — exact post-patch fit, quantities and legality survive Fitter -> Fleet Doctrine hand-off.
- [ ] **Fitter Combat Scenario / PvE review — MANDATORY** — see Section 17.9.

### 17.9 Fitter Combat Scenario / PvE model — dedicated mandatory review

This is a **separate PvE model from PvE & Locations and separate from the Fleet Wargame simulator**.

Primary definitions currently live in \`src/Fittings.tsx\`, with exact NPC/DOGMA work in \`electron/fitting-dogma.ts\`, Abyss data in \`electron/abyss-encounters.ts\`, and clear-time work in \`electron/pve-clear-time.ts\`.

Review every activity family currently present:

- [ ] **Manual / exact NPC**
- [ ] **Abyssal Deadspace**
- [ ] **Combat anomalies**
- [ ] **DED complexes & escalations**
- [ ] **Security missions / Epic arcs**
- [ ] **Anomic / Burner missions**
- [ ] **Sansha Incursions**
- [ ] **Homefront Operations**
- [ ] **Wormhole Sleeper PvE**
- [ ] **Pochven combat**
- [ ] **Combat exploration & hazardous sites**
- [ ] **Pirate FOB / Stronghold**
- [ ] **Event / seasonal combat**, where present in the activity catalogue.

For those activity families verify:

- [ ] NPC damage presets and recommended outgoing damage assumptions.
- [ ] Target range, signature, velocity and transversal profiles.
- [ ] Site/hull restrictions.
- [ ] NPC exact-type search and combat profiles.
- [ ] NPC resists, EHP, DPS, volley, range, application, EWAR, tackle, neuts and remote reps.
- [ ] Clear-time estimation and travel/application time.
- [ ] Tank-versus-pressure and capacitor-pressure thresholds.
- [ ] Strategy/caveat text does not describe removed/changed mechanics.
- [ ] **Abyss:** tier, weather penalties/bonuses, room populations, NPC type IDs, weather HP/resist effects, 20-minute completion margin and drone/application assumptions.
- [ ] **Wormholes:** C1-C6 assumptions and exact-wave/site data are consistent with Wormhole Command.
- [ ] **Incursions/Pochven/Homefront/FOB:** fleet/objective/site rules are reviewed even if raw NPC DOGMA did not change.
- [ ] Any hard-coded generic target profile or faction damage profile touched by patch notes is reviewed manually.

### 17.10 Asset Command

Primary wrapper lives in \`src/App.tsx\`; main surfaces include \`src/Loot.tsx\`, \`src/AssetsCommand.tsx\`, \`src/MarketWorkspaceV2.tsx\` and wallet/profit ledger code.

- [ ] **Loot Sources** — loot tables/value assumptions, item resolution, quantities, market valuation and any NPC/site loot changes.
- [ ] **Assets** — personal/corporation assets, type/category resolution, quantities, packaged volume, location resolution, ships, BPO/BPC classification and valuation.
- [ ] **Blueprint asset valuation** — originals/copies, ME/TE, runs and blueprint-market/contract valuation stay correct after industry changes.
- [ ] **Market -> Market Search** — retained buy/sell orders, item/type IDs, station/location, quantity, price and add-to-shopping-list.
- [ ] **Market -> Shopping List** — item names/type IDs, quantities, MultiBuy export and “open in EVE” actions.
- [ ] **Wallet** — balance/journal/transaction data remains correctly interpreted after ESI schema/transaction changes.
- [ ] **Wallet / Sage Ledger** — realised profit, taxes/fees, sale matching, purchased/mined/donated/owned material provenance and reconciliation remain correct after economy/industry changes.

### 17.11 Industrial Command

Primary page: \`src/IndustrialCommand.tsx\` plus industrial/refinery/foundry engines.

Review **all logical IndustrialTab states**, not only buttons visible in the current top bar.

- [ ] **Command Center / Industrial Overview** — job counts, blueprint/material summaries, project/action signals, asset locations, system cost index and priority cards.
- [ ] **Project Foundry -> Projects** — production lots, target quantities, dependencies, work packages, stores, assignments and project totals.
- [ ] **Project Foundry -> Blueprint Library** — BPO/BPC classification, ME/TE/runs, activities, products, required skills and ownership scope.
- [ ] **Project Foundry -> Materials** — required quantities, pooled/owned/shortfall materials, component expansion, source stores and shopping-list output.
- [ ] **Project Foundry -> Research & Invention** — ME/TE research, copying, invention, reactions where linked, time/probability/skills/decryptors and output runs.
- [ ] **Industrial Opportunities** — build-vs-buy, market price inputs, costs, margins, volumes and candidate ranking.
- [ ] **Industrial Jobs** — manufacturing/research/copy/invention/reaction activity IDs, statuses, times, facilities, products and delivered/history state.
- [ ] **Refinery** — material outputs, portion sizes, processing skill mapping, NPC/Athanor/Tatara base rules, rigs, security multipliers, implants, tax where modelled and market value.
- [ ] **Moon Materials -> Materials** — moon goo types/groups, quantities, prices and resource classification.
- [ ] **Moon Materials -> Reactions** — reaction blueprints, inputs, outputs, skills, times, structures/bonuses and profitability.
- [ ] **Production** — any internal/deep-link production-plan state, multi-level manufacturing tree, quantities, time, facility/system cost and material expansion.
- [ ] **Materials & Stock** — asset quantities, locations, reserved/project stock, packaged volume, valuation and source character/corporation scope.
- [ ] **Blueprints** — internal/deep-link blueprint page state as well as Foundry library; activities and type metadata.
- [ ] **Structures** — structure types, service modules, fuel/online state, manufacturing/refining/reaction bonuses, rig bonuses, vulnerability/access data exposed by Sage.
- [ ] **System cost indices / facility economics** — re-check when CCP changes industry index math, SCC/tax/facility fees or structure bonuses.
- [ ] **Industrial -> Market/Wallet coupling** — job/project profitability and realised ledger use current fees and prices.
- [ ] **Industrial -> Foundry -> Shopping List coupling** — quantities and type IDs round-trip after blueprint/material changes.

### 17.12 Corporation Command

Primary page: \`src/CorporationManagement.tsx\`.

- [ ] **System News** — watched-system identity, killmail/type resolution, NPC-vs-player classification, structures, activity windows and system-security/topology context.
- [ ] **Find a Home** — system/region/security/resource/activity/industry/market/access criteria remain valid after universe/resource/structure changes.
- [ ] **Overview** — corporation identity/member/asset/structure aggregates and any patch-sensitive summary counts.
- [ ] **Members** — member/role data schema and capability labels where patch-sensitive.
- [ ] **Op Planner** — operation types (PvP Roam, Structure Defense, Structure Attack, Mining Operation, PvE Fleet, Hauling/Logistics, Wormhole Operation, Training), requested hulls/roles, fit checks, approvals and scheduling.
- [ ] **Op Planner fit checks** — doctrine/ship requirements recalculate from current Fitter/DOGMA; a combat balance patch must not approve an obsolete fit snapshot.
- [ ] **Corp Roles** — ESI role names/scopes/permissions and any endpoint/schema changes.
- [ ] **HR -> Command** — corporation permissions, applicant request creation and ESI scope requirements.
- [ ] **HR -> Applications** — applicant snapshot fields, skill/asset/standing/corp/alliance data and schema compatibility.
- [ ] **Corp Ore Buyback** — ore/gas/ice/reprocessed material classification, prices, payout percentage, quantities/volume and refinery/material changes.
- [ ] **Structures** — structure detection, type IDs, services, rigs, fuel, bonuses, timers/access where surfaced; structure balance patches require explicit review.
- [ ] **Alliance Management** — reserved/current functionality is still intentionally limited and no new patch dependency silently appears.
- [ ] **Discord Setup** — not normally gameplay-balance-sensitive, but verify no patch workflow or op schema change breaks announcement payloads. **Automated patch tests must not send live Discord announcements.**

### 17.13 Fleet Command

Primary page: \`src/FleetCommand.tsx\`.

- [ ] **Doctrine Library** — doctrine hulls/fits, current fit legality, skill/readiness checks, quantities, export/import and any changed hull/module requirements.
- [ ] **On The Fly Jump Map** — current location, system metadata, selected destination and travel/jump information after topology/navigation changes.
- [ ] **Wargame Map / Combat Simulator — MANDATORY COMBAT PATCH CHECK** — full dedicated checklist in Section 17.14.

### 17.14 Wargame Map / Combat Simulator — dedicated mandatory review

Primary files include \`src/FleetCommand.tsx\`, \`src/wargame-engine.ts\`, \`src/wargame-command-model.ts\`, \`src/wargame-fit-bridge.ts\`, \`src/wargame-types.ts\`, observation/session/red-team modules and Wargame tests.

**Any combat, ship, module, skill, implant, booster, drone, fighter, EWAR, movement, wormhole-effect, incursion-effect or navigation patch requires this entire block to be reviewed.**

- [ ] **Fit import parity** — imported saved fits/doctrine fits produce the same base combat model as Fitting Command.
- [ ] **Hull stats** — EHP layers, resists, signature, mass, inertia/agility, velocity, capacitor, sensor/targeting and warp properties.
- [ ] **Turrets** — DPS/volley, cycle, optimal/falloff, tracking, signature resolution, reload and range/application.
- [ ] **Missiles** — DPS/volley, cycle/reload, range, explosion radius/velocity, damage reduction factor and target velocity/signature application.
- [ ] **Drones** — DPS, damage type, control range, MWD/travel time, orbit/application, sentries and target switching.
- [ ] **Fighters** — squad count, DPS/volley, travel, orbit, abilities, attrition and target switching.
- [ ] **AoE / special damage** — smartbomb/AoE/special sources, radius and friendly-fire eligibility where modelled.
- [ ] **Triglavian/spool/ramp mechanics** — ramp per cycle, cap, target reset and spool behaviour.
- [ ] **Tank** — shield/armor/hull damage application, resists, local reps, passive shield and per-ship fleet attrition.
- [ ] **Remote repair / logistics** — remote shield/armor reps, ranges/cycles, target legality and multi-ship/fleet scaling.
- [ ] **Capacitor** — capacity/recharge/use, cap warfare, neuts/NOS, remote capacitor and cap-triggered order conditions.
- [ ] **EWAR** — ECM/jam, sensor strength, damps, tracking/guidance effects, paints and all support-system ranges/strengths represented by the simulator.
- [ ] **Tackle / warp core** — scram, disrupt, web, warp disruption strength vs core strength, warp eligibility and tackle range.
- [ ] **Command bursts** — burst IDs/effects, strongest-effect selection, range and modifiers for shield/armor/sensors/EWAR/signature/tackle/propulsion/targeting.
- [ ] **Movement** — approach, orbit, keep range, anchor, align, warp, disengage and hold; patched speed/mass/agility/propulsion must change movement outcomes.
- [ ] **Range geometry** — simulated distance scale, target range gates and application as units move.
- [ ] **System/environment effects** — wormhole effects (Pulsar/Magnetar/Black Hole/Cataclysmic/Red Giant/Wolf-Rayet), incursion effects and any other environment exposed to Wargames.
- [ ] **Terrain** — terrain modifiers/obstacles/effects remain compatible with movement and combat changes.
- [ ] **Fleet scaling** — ship counts, primary ship health, losses, remaining firepower/support and fleet destruction.
- [ ] **Order chain** — start/completion conditions, target destroyed/health/count/range/cap/tackle/jam/warp conditions, branching and next-step logic.
- [ ] **Target assignment** — weapon/support/tackle/rep targets, friendly/hostile legality and retarget behaviour.
- [ ] **Pause/resume/time progression** — cycles, reloads, reps, movement, effects and order timers remain deterministic.
- [ ] **Observation/replay/session serialization** — saved/replayed scenarios produce the same patched mechanics and old sessions fail/migrate safely if the model schema changed.
- [ ] **AI/red-team helpers** — any tactical recommendation or automated behaviour uses the current combat model, not stale thresholds.
- [ ] **Ships / Terrain / Fleets asset tabs** — catalogues and imported objects expose current type data.
- [ ] **Fitter parity regression** — representative fit stats in Wargames must equal Fitter outputs before scenario-only effects are applied.
- [ ] **Golden combat scenarios** — rerun representative brawl, kite, missile, drone, fighter, neut, EWAR, logistics, command-burst, wormhole-effect and incursion-effect scenarios.

Required Wargame regression family includes, as applicable:
- \`tests/wargame-engine-regression.test.cjs\`
- \`tests/wargame-command-sequencing.test.cjs\`
- \`tests/wargame-independent-support.test.cjs\`
- \`tests/wargame-observation-boundary.test.cjs\`
- \`tests/wargame-session-replay.test.cjs\`
- \`tests/wargame-special-mechanics.test.cjs\`
- \`tests/wargame-warp-tackle.test.cjs\`
- \`tests/fitting/wargame-command-bursts.test.cjs\`
- \`tests/fitting/wargame-environment-effects.test.cjs\`
- \`tests/fitting/wargame-multichannel-damage.test.cjs\`
- \`tests/fitting/wargame-support-systems.test.cjs\`

### 17.15 Settings / integration page

Settings is not a gameplay command, but it is part of the patch sweep because ESI/API changes can break all commands.

- [ ] **EVE character authorization** — required ESI scopes, scope schema version, reauthorization detection, saved-character state and full private refresh.
- [ ] **Static/public data update path** — the new SDE revision is actually staged/promoted and the UI cannot report healthy/current while parsing an old archive.
- [ ] **AI/MCP exposure** — changed/new Sage data fields exposed to MCP remain safe and structurally compatible; credentials remain excluded.
- [ ] **Updater/release state** — the Sage build shipping the compatibility patch reports the intended app version/data compatibility.

### 17.16 Legacy / internal / newly-added page detection

Current code contains logical states that are not all represented by a visible top-level button at all times. These are still part of patch doctrine.

- [ ] Search \`src/App.tsx\` for all \`View\` values and mounted views.
- [ ] Search each Command component for \`*Tab\`, \`*Section\`, \`*View\` unions and every \`setTab\` / \`setSection\` / \`setView\` target.
- [ ] Review internal/deep-link Industrial states including \`opportunities\`, \`production\`, \`materials\` and \`blueprints\`.
- [ ] Review retained/mounted tabs that can preserve state while hidden.
- [ ] Search for any new React page/component reachable through custom events, command signals, pending-session keys or cross-command navigation.
- [ ] Search preload/IPC for new page-specific APIs that may consume patched EVE data.
- [ ] If a new page exists, add it to Section 17 **before** patch readiness can be VERIFIED.

### 17.17 Page sweep sign-off block

Copy this into the patch readiness notes and complete it:

\`\`\`
PAGE SWEEP
Global/shared:
Character Command:
  Character:
  Queue:
  Augments:
  Killmails:
  LP Store:
Activity Command:
  Activity Planner:
  Ship Planner:
  My Skills:
ISK Command:
  Market Scanner:
  Market Opportunities:
  Order Desk:
  Contracts:
  All Opportunities:
  Invention:
  Planetary Revenue:
  PvE & Locations:
Navigation Command:
  Route Planner:
  Advanced Map:
  Saved Routes:
  Route Intelligence:
  Capital / Jump Planner:
Wormhole Command:
  Map:
  Scanner:
  Intel:
  Sites:
  Rolling:
  Corporation:
Fitting Command:
  Catalogue/Ships:
  Fit Import/Saved Fits:
  Fit Math:
  Fix My Fit:
  Combat Scenario/PvE:
  Market/Shopping/Doctrine bridges:
Asset Command:
  Loot Sources:
  Assets:
  Market Search:
  Shopping List:
  Wallet:
  Sage Ledger:
Industrial Command:
  Command Center:
  Project Foundry:
  Blueprint Library:
  Materials:
  Research & Invention:
  Industrial Opportunities:
  Industry Jobs:
  Refinery:
  Moon Materials:
  Reactions:
  Production:
  Materials & Stock:
  Blueprints:
  Structures:
Corporation Command:
  System News:
  Find a Home:
  Overview:
  Members:
  Op Planner:
  Corp Roles:
  HR Command:
  HR Applications:
  Corp Ore Buyback:
  Structures:
  Alliance Management:
  Discord Setup:
Fleet Command:
  Doctrine Library:
  On The Fly Jump Map:
  Wargame Map / Combat Simulator:
Settings:
  EVE authorization:
  Static/public data:
  AI/MCP:
Legacy/internal route states:
New pages discovered:
\`\`\`

**A patch cannot be marked VERIFIED until every line in this Page Sweep has a status.**
