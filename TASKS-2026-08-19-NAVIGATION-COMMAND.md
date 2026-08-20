# New Eden Sage — Navigation Command Implementation Task List

Created: 2026-08-19
Status: IN PROGRESS — Tasks 1–25 COMPLETE; Tasks 26–46 QUEUED

## Guardrails

- Active repo only: `C:\Users\Administrator\Documents\GameDev\New Eden Sage`
- Authoritative local SDE: `F:\New Eden Sage Data\Static Data\eve-static-data-jsonl.zip`
- Do not reset/clean/discard unrelated dirty working-tree changes.
- Do not use GitHub as source of truth.
- Preserve current app version unless explicitly told to change it.
- Reuse existing System Intelligence / zKill / ESI infrastructure wherever possible instead of creating parallel services.
- Route calculation must be local-first from the SDE graph and must not depend on live web calls.
- Live intelligence should decorate an already-calculated route, not be required to calculate it.
- Keep graph connections generic so future edge types can plug into one solver.
- Every implementation step must remain visually coherent and usable as it lands: Sage-consistent spacing, controls, cards, hierarchy, empty/loading/error states, and no knowingly ugly temporary layouts.
- The deferred aesthetic pass means final refinement only: visual tuning, density, animation, map styling, responsive polish, and cross-page consistency after functionality is complete.

---

## Baseline UI quality rule — applies to every task

Every task that adds visible UI must ship with a competent first-pass presentation, not raw/native controls dumped onto the page. As features are added:
- use existing Sage visual language and reusable controls where available
- keep spacing, alignment, typography and panel hierarchy deliberate
- provide sensible loading, empty, disabled and error states immediately
- keep route/map controls organised and readable while functionality grows
- avoid placeholder layouts that we already know will need complete replacement
- do not over-polish or spend time on decorative refinement before the feature works

The final aesthetic pass is for refinement, **not rescue work**.

---

## PHASE 1 — Navigation Command foundation

### TASK 1 — Add top-level Navigation Command tab ✅ COMPLETE

**Goal:** Create the new top-level navigation workspace.

**Requirements:**
- Add `Navigation Command` as a top-level Sage tab.
- Create a dedicated component/module for the workspace.
- Initial internal sections:
  - Route Planner
  - Map
  - Saved Routes
  - Route Intelligence
  - Capital / Jump Planner
- Keep first-pass styling clean, coherent and recognisably Sage; final polish can wait.

**Acceptance:**
- Tab is navigable.
- Workspace mounts without affecting other retained/cached pages.

---

### TASK 2 — Build local universe graph from CCP SDE ✅ COMPLETE

**Goal:** Create the authoritative local route graph.

**Requirements:**
- Parse systems, constellations, regions and stargate connections from the local CCP SDE.
- Store graph nodes keyed by solar-system ID.
- Store useful node metadata:
  - name
  - security status
  - constellation
  - region
  - coordinates
- Store edges generically with metadata such as:
  - `gate`
  - `ansiblex`
  - `wormhole`
  - `thera`
  - `turnur`
  - `zarzakh`
  - `jump-drive`
  - `manual`
- Build/cache graph data locally so route calculation does not repeatedly parse the SDE.

**Acceptance:**
- Any normal stargate-connected system can be resolved by ID/name.
- Neighbor systems can be enumerated quickly.
- Graph survives restart via prepared/cache data.

---

### TASK 3 — Core route solver ✅ COMPLETE

**Goal:** Implement Sage-owned pathfinding rather than relying on ESI for every route.

**Requirements:**
- Implement shortest-path routing over the local graph.
- Support weighted edge/node costs.
- Return full route object with ordered systems and legs.
- Return useful totals:
  - jumps
  - distance if useful
  - security transitions
  - route mode
- Design solver so additional edge types and penalties can be enabled/disabled by profile.

**Acceptance:**
- Route between two gate-connected systems resolves correctly.
- Solver is fast enough for interactive use.

---

## PHASE 2 — Standard route-planning features

### TASK 4 — Route modes ✅ COMPLETE

**Goal:** Implement the normal routing choices users expect.

**Modes:**
- Shortest / fastest
- Safer / prefer higher security
- Less secure / prefer lower security where requested
- High-sec only

**Requirements:**
- Security weighting must be configurable rather than hard-coded into separate solvers.
- High-sec-only must be a strict constraint, not merely a preference.

**Acceptance:**
- The same origin/destination can produce different valid paths based on mode.

---

### TASK 5 — Security-floor controls ✅ COMPLETE

**Goal:** Allow exact security-space constraints.

**Requirements:**
- Presets such as:
  - 1.0–0.5 only
  - 0.4+
  - Any
- Underlying route profile should allow an arbitrary minimum security threshold.

**Acceptance:**
- Solver never enters systems below the selected floor.

---

### TASK 6 — Avoid lists ✅ COMPLETE

**Goal:** Give the user full control over places the route may not use.

**Requirements:**
- Avoid individual systems.
- Avoid constellations.
- Avoid regions.
- Allow temporary avoids and saved/global avoids.
- Avoid-list entries should be removable individually.

**Acceptance:**
- Solver respects all configured avoid scopes.
- Impossible route returns a clear reason instead of silently ignoring constraints.

---

### TASK 7 — Dynamic hazard avoidance toggles ✅ COMPLETE

**Goal:** Let current known hazards influence route eligibility.

**Initial toggles:**
- Incursion systems
- Triglavian / EDENCOM special-state systems where data is available
- Future dynamic hazard sources via a generic route-exclusion provider

**Acceptance:**
- Route profile can exclude dynamic hazard systems without changing core graph code.

---

### TASK 8 — Multi-waypoint routes ✅ COMPLETE

**Goal:** Support real route planning rather than only A → B.

**Requirements:**
- Unlimited practical waypoint count.
- Ordered waypoint list.
- Add/remove waypoints.
- Drag/reorder waypoints.
- Recalculate all unlocked segments when waypoint order changes.
- Reverse entire route.
- Clear route.

**Acceptance:**
- Full route is composed from sequential waypoint segments.

---

### TASK 9 — Route summary and leg model ✅ COMPLETE

**Goal:** Define a proper route object for every downstream feature.

**Route object should include:**
- route ID
- name
- origin
- destination
- waypoints
- ordered systems
- ordered legs
- edge type per leg
- locked/manual flags
- routing profile / constraints
- totals
- timestamps/version

**Acceptance:**
- Saved routes, sharing, map rendering and EVE export consume the same route object.

---

## PHASE 3 — Homemade/manual route planning

### TASK 10 — Manual map route construction ✅ COMPLETE

**Goal:** Let the user literally build a route by clicking systems.

**Requirements:**
- Click/right-click system actions:
  - Add next
  - Insert before
  - Insert after
  - Remove
  - Avoid
- User-selected systems become explicit waypoints.
- Sage calculates connecting segments where needed.

**Acceptance:**
- A route can be constructed entirely from map interactions.

---

### TASK 11 — Locked route segments ✅ COMPLETE

**Goal:** Allow exact user-authored portions of a route to survive recalculation.

**Requirements:**
- Mark one or more consecutive route legs as locked.
- Recalculation may change unlocked segments only.
- Locked segment ordering must remain exact.
- Clearly detect when changed constraints make a locked segment invalid.

**Acceptance:**
- User can enforce an exact six-system path inside a larger automatically calculated route.

---

### TASK 12 — Manual/custom connections ✅ COMPLETE

**Goal:** Support connections that are not part of the static stargate graph.

**Requirements:**
- Add temporary custom edge between two systems.
- Edge carries a type and metadata.
- Allow enable/disable/delete.
- Used by wormholes, private bridges and future custom navigation.

**Acceptance:**
- Core solver can route across a user-created edge without special-case pathfinding code.

---

## PHASE 4 — Saved routes and route library

### TASK 13 — Saved Routes library ✅ COMPLETE

**Goal:** Treat routes as persistent first-class objects.

**Requirements:**
- Save current route with name.
- Rename.
- Duplicate.
- Delete.
- Load/apply.
- Preserve waypoints, locked segments, avoids and route profile.
- Optional notes/FC/logistics instructions.

**Acceptance:**
- Saved route reproduces the same plan after restart.

---

### TASK 14 — Favourite systems and route presets ✅ COMPLETE

**Goal:** Speed up common navigation work.

**Requirements:**
- Favourite systems.
- Quick-set origin/destination from favourites.
- Optional route-profile presets such as:
  - High-sec haul
  - Fastest
  - Low-sec roam
  - Capital-safe

**Acceptance:**
- Common destinations and profiles are one-click reusable.

---

## PHASE 5 — EVE client integration

### TASK 15 — Export route to EVE ✅ COMPLETE

**Goal:** Send the completed Sage route into the live EVE client.

**Requirements:**
- Use the appropriate ESI waypoint endpoint(s).
- Export ordered destination/waypoints.
- Option to clear/replace current EVE route first where supported.
- Respect selected character.
- Report permission/scope failures clearly.

**Acceptance:**
- Sage route appears in the chosen character's EVE autopilot route in the same intended order.

---

### TASK 16 — Current-character location integration — COMPLETE

**Goal:** Make routing character-aware.

**Requirements:**
- Use synced/live character location when available.
- One-click `Use current system` origin.
- Detect when character moves off the planned route.
- Offer/recalculate route from current system while preserving locked segments/waypoints.

**Acceptance:**
- Route planner can follow a connected character without manual origin entry each time.

---

## PHASE 6 — Generalise System Intelligence for route use

### TASK 17 — Generalise System Intelligence input — COMPLETE

**Goal:** Remove the assumption that intelligence only exists for explicitly watched systems.

**Requirements:**
- Existing intelligence service accepts arbitrary solar-system IDs.
- Watchlist becomes one caller, not a hard requirement.
- Navigation Command can request intelligence for every system in a calculated route.
- Reuse existing cache/storage and request courtesy limits.

**Acceptance:**
- Unwatched route systems can receive the same intelligence data as watched systems.

---

### TASK 18 — Shared route/system intelligence cache — COMPLETE

**Goal:** Prevent duplicate work between System Watch and Navigation Command.

**Requirements:**
- One shared cache keyed by system/source/time-window.
- Watched system data is reused by routes immediately.
- Route-fetched data becomes available to System Watch if relevant.
- Preserve current zKill courtesy/rate protections.

**Acceptance:**
- Same system/time window is not fetched twice simply because two Sage pages asked for it.

---

### TASK 19 — Route zKill pull — COMPLETE

**Goal:** Pull kill intelligence for route systems regardless of watchlist membership.

**Requirements:**
- Request recent zKill data for route systems.
- Support route-relevant windows such as:
  - 1h
  - 2h
  - 6h
  - 24h
- Reuse retained 7d/30d data where useful rather than forcing extra calls.
- Aggregate per-system route danger stats.

**Acceptance:**
- Every route system can show recent kill activity without first being manually added to System Watch.

---

### TASK 20 — Gate-specific kill classification — COMPLETE

**Goal:** Distinguish a dangerous gate from generic system activity.

**Requirements:**
- Use killmail position when available.
- Use SDE stargate coordinates.
- Calculate distance from kill position to gates in that system.
- Attribute a kill to a gate when within a defensible threshold.
- Store confidence / distance rather than pretending uncertain classifications are exact.
- Count gate kills separately from system-wide kills.

**Acceptance:**
- Route can report `kills near this gate` independently from `kills somewhere in this system`.

---

### TASK 21 — Gatecamp danger model — COMPLETE

**Goal:** Convert raw route intelligence into an actionable safety signal.

**Requirements:**
- Derive a gate danger state such as:
  - Clear
  - Activity
  - Dangerous
  - Camp likely
  - Active camp
- Inputs may include:
  - very recent gate kills
  - repeated kills at same gate
  - pods/ships killed
  - attacker recurrence/grouping
  - recent jump/activity volume when available
- Keep underlying raw numbers visible.

**Acceptance:**
- Danger label is explainable from retained evidence.

---

### TASK 22 — Route Intelligence aggregator — COMPLETE

**Goal:** Produce one decorated route object for the UI.

**Per-system/leg data may include:**
- security status
- kills by selected window
- gate-specific kills
- danger/camp classification
- jumps/activity
- NPC activity
- sovereignty/alliance/faction ownership
- incursions / dynamic hazards
- stations
- structures where available
- market stop indicators later

**Acceptance:**
- Navigation UI consumes one route-intelligence model rather than querying every source independently.

---

## PHASE 7 — Map and interactive navigation view

### TASK 23 — Universe / regional map rendering — COMPLETE

**Goal:** Provide an interactive map suitable for route construction and intelligence display.

**Requirements:**
- Universe view.
- Regional/local view.
- Render systems and connections.
- Highlight current route.
- Highlight waypoints and locked segments.
- Current character system marker.
- Pan/zoom/select.

**Acceptance:**
- Route is visually understandable and selectable from the map.

---

### TASK 24 — Map intelligence overlays — COMPLETE

**Goal:** Make the map useful rather than decorative.

**Overlay toggles:**
- security
- recent kills
- gate danger
- jumps/activity
- sovereignty
- faction ownership
- incursions
- storms/timers where data becomes available
- structures/stations
- wormholes/custom links

**Acceptance:**
- Overlay data comes from the same shared intelligence model used by the route list.

---

### TASK 25 — Route list interaction — COMPLETE

**Goal:** Give a dense, practical textual representation alongside the map.

**Requirements:**
- One row per system/leg.
- Show at minimum:
  - jump number
  - system
  - security
  - edge type
  - recent kills
  - gate danger
  - optional activity/jumps
- Clicking system opens/embeds relevant System Intelligence detail.
- Clicking leg highlights it on map.

**Acceptance:**
- User can navigate and inspect the route without relying on the map alone.

---

## PHASE 8 — Special connection routing

### TASK 26 ✅ COMPLETE — Ansiblex / jump-bridge network support

**Goal:** Route over player jump bridges when the user has a known network.

**Requirements:**
- Store known bridge pairs as graph edges.
- Enable/disable bridge networks per route profile.
- Support manually imported/maintained networks initially.
- Preserve owner/access metadata where known.

**Acceptance:**
- Fastest route can legitimately choose an enabled Ansiblex edge.

---

### TASK 27 ✅ COMPLETE — Thera shortcut support

**Goal:** Allow routes to use known Thera connections.

**Requirements:**
- Ingest current known Thera connections from an appropriate source/manual data layer.
- Represent as temporary graph edges with expiry.
- Enable/disable in routing profile.

**Acceptance:**
- Route can use Thera only when current connection data exists.

---

### TASK 28 ✅ COMPLETE — Turnur and Zarzakh support

**Goal:** Support special network shortcuts cleanly.

**Requirements:**
- Model Turnur and Zarzakh connections as explicit edge types.
- Respect any ship/access/routing restrictions known to Sage.
- Enable/disable per route profile.

**Acceptance:**
- They plug into the same solver rather than a separate route implementation.

---

### TASK 29 ✅ COMPLETE — Wormhole routing

**Goal:** Support user/corp-known wormhole chains.

**Requirements:**
- Add scanned/manual wormhole links as expiring graph edges.
- Metadata:
  - connection type/class if known
  - discovered time
  - expiry estimate/status
  - mass information if known
- Route profile can include/exclude wormholes.

**Acceptance:**
- Homemade wormhole chain can be used by standard route solver.

---

## PHASE 9 — Capital / jump-drive planner

### TASK 30 ✅ COMPLETE — Capital jump graph / range calculation

**Goal:** Plan jump-capable ship movement separately from stargate routing while sharing the same Navigation Command data model.

**Requirements:**
- Character/ship-specific jump range.
- Jump Drive Calibration influence.
- Determine reachable systems from current midpoint.
- Generate candidate midpoint chains.

**Acceptance:**
- Given ship + character + destination, Sage can find viable jump chains where one exists.

---

### TASK 31 ✅ COMPLETE — Jump fuel calculation

**Goal:** Calculate expected fuel usage for candidate capital routes.

**Requirements:**
- Ship-specific fuel type/consumption.
- Relevant skills such as Jump Fuel Conservation.
- Distance per leg.
- Total fuel.

**Acceptance:**
- Every capital route candidate has a deterministic fuel estimate based on known character/ship data.

---

### TASK 32 ✅ COMPLETE — Jump fatigue / cooldown intelligence

**Goal:** Show travel-time consequences of a capital route.

**Requirements:**
- Calculate/display fatigue and activation cooldown effects where applicable.
- Show per-leg and accumulated values.

**Acceptance:**
- User can compare a short-midpoint route against a lower-fatigue alternative.

---

### TASK 33 ✅ COMPLETE — Cyno midpoint quality and alternatives

**Goal:** Make capital routing operationally useful.

**Requirements:**
- Prefer/score midpoint systems by criteria such as:
  - station present
  - dockable structure present when known
  - security / hostile activity
  - route safety
- Offer alternate midpoint chains rather than only one answer.

**Acceptance:**
- Multiple valid chains can be compared by fuel, number of jumps and safety.

---

### TASK 34 ✅ COMPLETE — Jump Freighter high-sec entry/exit planning

**Goal:** Handle JF logistics properly.

**Requirements:**
- Find valid low-sec/high-sec transition systems.
- Consider final high-sec stargate leg.
- Offer alternative exit/entry systems.
- Integrate route danger on transition gates.

**Acceptance:**
- JF route can produce both jump chain and final gate-routing segment.

---

## PHASE 10 — Sharing, fleet and corporation use

### TASK 35 ✅ COMPLETE — Route import/export format

**Goal:** Make routes portable before backend sharing is complete.

**Requirements:**
- Human-readable JSON schema for Sage route object.
- Copy/export route.
- Import route.
- Version schema.

**Acceptance:**
- A route can be exported and recreated exactly on another Sage installation.

---

### TASK 36 ✅ COMPLETE — Corp/fleet route sharing via Sage Online

**Goal:** Publish routes to authorised members later through the existing backend architecture.

**Requirements:**
- Server-authoritative route object/version.
- Corp/fleet ACL.
- Read-only published route for members unless authorised to edit.
- Preserve custom edges/locked segments safely.

**Acceptance:**
- FC/logistics lead can publish a route and authorised members receive the same route object.

---

### TASK 37 ✅ COMPLETE — Fleet/member route context

**Goal:** Add fleet-specific usefulness without implying live tactical coordinates when data is unavailable.

**Requirements:**
- Show connected fleet/member system locations only when legitimately available through Sage data/consent.
- Compare member location to route/form-up destination.
- Optional `route from each member to form-up` analysis later.

**Acceptance:**
- No invented live-position capability.

---

## PHASE 11 — Search, route helpers and quality-of-life

### TASK 38 ✅ COMPLETE — System search and smart destination picker

**Goal:** Make destination entry fast.

**Requirements:**
- Search system by name.
- Show region/security in result.
- Recent destinations.
- Favourites.
- Current location quick action.

**Acceptance:**
- Ambiguous or similarly named results are distinguishable.

---

### TASK 39 ✅ COMPLETE — Route operations

**Goal:** Add practical one-click route actions.

**Actions:**
- Reverse
- Recalculate
- Duplicate
- Append destination
- Insert stop
- Remove stop
- Set system as new origin
- Set system as new destination
- Lock/unlock segment

**Acceptance:**
- No need to rebuild a route manually for common edits.

---

### TASK 40 ✅ COMPLETE — Route notes / labels

**Goal:** Allow logistics/FC context to live with the route.

**Requirements:**
- Route-level notes.
- Optional waypoint notes/labels.
- Preserve in save/export/share formats.

**Acceptance:**
- Saved route can carry instructions such as pickup/drop-off/form-up notes.

---

### TASK 41 ✅ COMPLETE — Route/map export utilities

**Goal:** Allow route information to leave Sage in useful forms.

**Requirements:**
- Copy ordered system list.
- Copy compact route summary.
- Export route JSON.
- Later map-image/export support can be aesthetic/polish work.

**Acceptance:**
- Route can be shared manually even without Sage Online.

---

## PHASE 12 — Validation and performance


> Tasks 36–41 validation: renderer + Electron TypeScript clean; backend TypeScript clean; production Vite build clean; compiled route schema-v4/portable JSON smoke passed; Sage Online D1 ACL migration 0003 applied locally and remotely; Worker deployed and health checked; unauthenticated corporation-workspace enrolment correctly returns 401; app version remains 1.1.7.

### TASK 42 ✅ COMPLETE — Route-engine correctness tests

**Coverage:**
- direct route
- multi-waypoint route
- high-sec-only
- security floor
- avoids
- impossible route
- locked segment
- manual edge
- special edge enable/disable
- reverse route

**Acceptance:**
- Deterministic automated tests for solver behavior.

---

### TASK 43 ✅ COMPLETE — Intelligence regression tests

**Coverage:**
- watched-system cache reused by route
- unwatched route system can fetch intelligence
- gate kill classification
- danger score/model
- zKill cooldown protections remain intact
- no corruption of existing System News 1h/24h/7d/30d behavior

**Acceptance:**
- Navigation changes do not regress Corporation/System Watch intelligence.

---

### TASK 44 ✅ COMPLETE — EVE export smoke test

**Coverage:**
- selected character
- ordered waypoints
- permission failure
- long route
- route containing Sage-only special edges (export only the EVE-compatible waypoint chain)

**Acceptance:**
- Export is predictable and does not silently reorder the intended route.

---

### TASK 45 ✅ COMPLETE — Capital planner test suite

**Coverage:**
- jump range
- skill effects
- fuel
- midpoint selection
- alternate chains
- JF transition

**Acceptance:**
- Capital calculations have reproducible test fixtures.

---

### TASK 46 ✅ COMPLETE — Production build and end-to-end smoke

**Required final functional smoke before visual pass:**
1. Open Navigation Command.
2. Build normal A → B route.
3. Change security mode.
4. Add/reorder waypoint.
5. Add avoid.
6. Build manual route from map.
7. Lock segment and recalculate.
8. Save/reload route.
9. Pull route intelligence including unwatched systems.
10. Verify gate-specific danger data where evidence exists.
11. Export route to EVE.
12. Test special/custom edge.
13. Test capital route.
14. Verify existing System Watch still works.
15. TypeScript + Electron TypeScript + production build.

---

# ✅ Final Aesthetic / UX pass — COMPLETE

Basic UI quality was maintained throughout implementation. The completed final refinement pass covered:
- final Navigation Command information architecture
- map styling
- route-line/edge-type visual language
- security and danger colours
- route cards/list density
- overlay controls
- capital planner layout
- saved-route library appearance
- responsive behavior
- loading/empty/error states
- animation/transitions where useful
- consistency with the rest of Sage

# Suggested implementation order

1. Tasks 1–3 — workspace + local graph + solver
2. Tasks 4–9 — full normal route planner
3. Tasks 10–12 — homemade/manual routing
4. Tasks 13–16 — persistence + EVE integration
5. Tasks 17–22 — generalised System Intelligence + zKill/gate danger
6. Tasks 23–25 — map + route intelligence UI
7. Tasks 26–29 — special connection types
8. Tasks 30–34 — capital/JF planner
9. Tasks 35–41 — sharing/import/export/QoL
10. Tasks 42–46 — tests and end-to-end validation
11. Final visual/aesthetic pass

# Current state

Tasks **1–46 and the final aesthetic / UX refinement pass are complete and validated**. Navigation Command now has the full local/Sage Online feature set, deterministic regression coverage under `tests/navigation/`, and a coherent final visual language for route types, locks, security, gate danger, overlays, saved routes, capital planning, sharing, loading/error states and responsive layouts.

Final validation after the visual pass:
- Renderer TypeScript: PASS
- Electron TypeScript: PASS
- `npm run test:navigation`: PASS
- Production Vite build: PASS
- Sage Online backend TypeScript: PASS

Permanent regression command: `npm run test:navigation`.

No Navigation Command implementation tasks remain in this checklist. A literal launched-app visual review is intentionally still left to the user-run Sage session; the automated end-to-end coverage is headless and does not launch Electron.
