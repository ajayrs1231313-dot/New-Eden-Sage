# New Eden Sage — Remaining Work

Last consolidated: 2026-08-21

This is the single source for known unfinished feature work that was previously spread across FUTURE_CHANGES.md, Navigation Command, UI Cleanup, Wormhole Command and Wormhole Remaining task files.

Completed work has intentionally been removed rather than retained as historical checklist noise.

## 1. Fitting intelligence / Dream Fit

The current Fittings → Skills flow already has a Dream Fit entry point, exact fitting blockers, skill/implant/rig remedies, training-time data and a normal procurement surface. The remaining work is the higher-level optimization layer:

- Persist Dream Fits as first-class aspirational targets rather than only passing a transient fit-resolution intent into Skills.
- Track selected characters against saved Dream Fits and update readiness automatically when ESI skill data changes.
- Split Dream Fit progression into explicit **mandatory**, **recommended**, and **perfect-supporting-skill** paths.
- Show separate completion estimates for **fastest usable**, **full Dream Fit**, and **perfect support skills**.
- Expand the current remedy system into an automatic fit fixer that finds the smallest viable combination of:
  - skill training
  - implant changes
  - module state changes
  - module substitutions
  - fitting compromises
- Show train-vs-implant-vs-module-compromise alternatives instead of presenting those remedies independently.
- Add skill-value optimization: concrete DPS, tank, capacitor, fitting-resource, mobility or application gain per unit of training time.
- Add alternative-module intelligence across compact/meta/faction/deadspace variants with exact performance, fitting-resource and ISK trade-offs.
- Add an ISK-vs-performance optimizer, e.g. **reach at least 95% of this fit's DPS under 300m ISK**.
- Add a **Why?** explainer for every derived fitting stat, exposing the modules, skills, implants, boosts, states and assumptions that produced it.
- Integrate Dream Fit and alternative-module procurement directly with Sage full-market search and optimal purchase-route tooling, not only the current generic fit procurement screen.

## 2. PvE / activity intelligence

- Persist a selected imported/saved fitting as PvE loadout context and compare its hull/modules against the character's current EVE ship and activity requirements.
- Add optional fitted-ship performance inputs for DPS, tank, capacitor and drone capability where EVE public APIs do not expose enough live fitting context.
- Replace generic PvE earning ranges with activity-specific historical estimates where reliable evidence exists, while keeping uncertainty and loss/loot variance visible.

## 3. Market / diagnostics refinements

- Add user-configurable tax, broker-fee and hauling-cost assumptions to regional-profit estimates. Current regional opportunity output still describes those figures as gross and excludes these costs.
- Add a compact Settings memory diagnostic covering market-index size, worker memory and cache age.
- Roll the fitted-cargo capacity resolver out to **every Sage surface where cargo size affects feasibility, filtering, scoring, route choice or recommendations**. Use the current active ship's authoritative SDE physical capacity plus synced ESI fitted modules/rigs and character-skill modifiers; include applicable general-purpose auxiliary bays only when they can actually carry the cargo being planned. Never fall back to "largest owned hull" or skill-only guesses. Keep a manual override where the user may be planning around another ship or arbitrary capacity, and show the source/basis for the calculated number.

## 4. Planetary Industry — remaining integration work

The local PI alert-policy model, per-character/per-colony overrides, corporation survey sharing and corporation template sharing are already implemented. Remaining work is remote delivery and the final custom-layout handoff:

- Persist a manually dragged Colony Designer layout into a saved PI template as the actual reusable layout, not only the underlying production-plan input.
- Generate/copy an EVE colony-template payload directly from that custom designer layout and preserve it when publishing/cloning templates.
- Add an explicit Sage Online PI alert-policy shared-object/backend contract with opt-in publication from the existing local alert policy.
- Run PI alerts server-side so remote delivery does not depend on the desktop renderer being open.
- Add Discord delivery for extractor expiry, factory starvation, broken routes, storage thresholds, low stockpiles, production deficits and high-value FIX MY PI recommendations.
- Support corporation Discord destinations and private/user destinations with per-character/per-colony routing.
- Add remote-alert deduplication, cooldowns, quiet hours, severity escalation and acknowledgement.
- Keep the same backend event model usable by later mobile/push delivery.

## 5. Wormhole Command — collaboration / delivery v2

Core Wormhole Command is already implemented: durable scanning/history, chain mapping, rolling, threat/system intel, PvE/site data, Navigation integration, historical reconstruction, JSON import/export/merge, corporation chain publish/pull/update, version conflicts, restricted sharing, audit trail, local desktop/audio watches and the shared Sage Online event stream.

Remaining collaboration/delivery work:

- Add Discord delivery for Wormhole watch and chain events.
  - secure credential/webhook transport configuration
  - per-workspace/per-corporation destinations
  - event selection
  - rate limiting and duplicate suppression
  - hostile-structure/new-K162/EOL/critical/near-Home templates
  - failure/retry visibility without blocking local Wormhole Command
- Add generic outbound webhooks for external integrations.
- Add temporary corporation/allied access with explicit expiry.
- Add alliance-level ACL/shared-chain access.
- Add more granular collaboration roles beyond the current viewer / `wormholes.manage` manager model.
- Define explicit privacy/consent rules before any live member-position sharing is added. Current corporation chain sharing intentionally does not upload member location telemetry.
- Replace raw EVE character-ID entry for restricted recipients with a proper Sage-linked member/contact picker.

## 6. Wormhole Command — optional intelligence / UX v2

- Add richer hostile-kill tactical classification where evidence supports it, especially explicit bubble/interdictor/T3 activity flags.
- Add historical chain visual playback/animation on top of the existing evidence-time reconstruction view.
- Add further export formats only if they provide practical value; versioned Sage wormhole JSON remains canonical.

## 7. Final verification still worth doing after the next Wormhole/PI code pass

Automated Wormhole and Navigation suites currently pass. After the next code-changing pass:

- Run `npm run test:wormhole`.
- Run `npm run test:navigation`.
- Run the PI regression suite when PI changes are involved.
- Run renderer/Electron TypeScript checks and the production build.
- Run backend TypeScript checks when Sage Online changes are involved.
- Relaunch the current development build and smoke the changed real-app surfaces.
- Keep the dirty working tree intact and do not commit/push unless explicitly requested.

## Unified realised-profit ledger follow-up
- Extend the Wallet realised-profit ledger to Planetary/PI: capture actual sales, export/import costs, taxes and realised PI margin from synced wallet transactions.
- Extend the same ledger to Industry: connect manufacturing/invention job inputs and completed product sales so Sage records actual build cost, sale revenue, taxes/fees and realised industry profit.
- Keep Contract, Market Opportunity, PI and Industry profit in one character/all-character ledger instead of separate counters.
