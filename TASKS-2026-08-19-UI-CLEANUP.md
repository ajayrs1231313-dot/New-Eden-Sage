# New Eden Sage — UI / Navigation Cleanup Task List

Created: 2026-08-19
Status: COMPLETE — implemented and validated 2026-08-19

## Guardrails

- Active repo only: `C:\Users\Administrator\Documents\GameDev\New Eden Sage`
- Do not reset, clean, discard, or overwrite unrelated dirty working-tree changes.
- Do not use GitHub as source of truth.
- Preserve current app version `1.1.7` unless explicitly told to change it.
- Make each task independently verifiable where practical.
- After implementation: TypeScript checks + production build, then report exactly what changed.

---

## ✅ TASK 1 — Move Alliance Management into Corporation Management

**Goal:** Remove Alliance Management as a dedicated top-level navigation destination and place its existing content/functionality inside Corporation Management.

**Requirements:**
- Add Alliance Management as a Corporation Management sub-tab/section.
- Preserve existing Alliance Management functionality.
- Remove/free the current top-level Alliance Management navigation slot.
- Do not repurpose the freed top-level slot yet; user will decide its future use later.

**Acceptance:**
- Alliance Management is accessible from Corporation Management.
- No standalone top-level Alliance Management entry remains.
- Existing alliance functionality still works.

---

## ✅ TASK 2 — Remove Industrial Command roadmap/status strip

**Goal:** Remove the four-card informational strip shown near the top of Industrial Command.

**Remove these cards completely:**
- Manufacturing — `FOUNDATION LIVE`
- Invention & research — `NEXT PASS`
- Build vs buy — `QUEUED`
- Multi-character planning — `FOUNDATION LIVE`

**Acceptance:**
- Entire four-card strip is gone.
- No empty wrapper/gap remains.

---

## ✅ TASK 3 — Restyle “What should I build, and where should I sell it?”

**Goal:** Bring the opportunity-search section into the established Sage visual language.

**Current area includes:**
- `OWNED BLUEPRINT × MARKET DEMAND`
- “What should I build, and where should I sell it?”
- Optional system/proximity search
- Security controls
- Jump radius controls
- Refresh opportunities button
- Ranked opportunity summary

**Requirements:**
- Normalize card/panel treatment with the rest of Sage.
- Improve visual hierarchy and spacing.
- Make controls visually consistent with current Sage controls.
- Replace the oversized/stretched generic form look.
- Normalize button styling, especially `Refresh opportunities`.
- Preserve all behavior and filters.

**Acceptance:**
- Functionality unchanged.
- Section visually matches modern Sage pages.

---

## ✅ TASK 4 — Remove CCP Activity Map / “Research and invention ready” panel

**Goal:** Remove the large informational panel that adds no required interaction.

**Remove:**
- `CCP ACTIVITY MAP`
- `Research and invention ready`
- Supporting explanatory sentence/panel container

**Acceptance:**
- Entire panel is gone.
- Layout closes up cleanly with no dead space.

---

## ✅ TASK 5 — Restyle Research & Invention / Blueprint activity intelligence

**Goal:** Bring the Research & Invention activity panel into the established Sage visual language.

**Current area includes:**
- `RESEARCH & INVENTION`
- `Blueprint activity intelligence`
- `OFFLINE SDE` badge
- Research blueprint scope selector
- Owned blueprint selector
- `Analyse activities` button
- Result/empty-state panel

**Requirements:**
- Normalize selects, button, badge, panel spacing, typography, and hierarchy.
- Remove generic grey/native-control appearance where Sage already has a styled equivalent.
- Preserve existing activity-analysis behavior.

**Acceptance:**
- Same behavior/data.
- Visual treatment matches the rest of Sage.

---

## ✅ TASK 6 — Remove Material Requirements Engine intro panel

**Goal:** Remove the explanatory `MATERIAL REQUIREMENTS ENGINE / Ready for a target` panel.

**Remove:**
- Heading and explanatory paragraph
- Six-step strip:
  1. Choose owned blueprint
  2. Set output quantity
  3. Expand CCP materials
  4. Apply ME/TE
  5. Subtract stock
  6. Identify shortages

**Acceptance:**
- Entire panel and six-step strip removed.
- No dead vertical space remains.

---

## ✅ TASK 7 — Restyle Production Chain Planner / Manufacturing target

**Goal:** Bring the manufacturing target panel into the established Sage visual language.

**Current area includes:**
- `PRODUCTION CHAIN PLANNER`
- `Manufacturing target`
- `CCP SDE` badge
- Blueprint scope selector
- Blueprint selector
- Target output control
- Shared asset pool checkbox/control
- Current-system manufacturing cost-index block
- `Load current system index` button
- `Build production plan` button
- Empty/result state

**Requirements:**
- Normalize select/input/button/checkbox styling.
- Fix awkward spacing and alignment.
- Improve current-system card presentation.
- Preserve all manufacturing-plan behavior.

**Acceptance:**
- Same functionality.
- Controls and layout visually match current Sage conventions.

---

## ✅ TASK 8 — Add Export to Doctrine options in Fitter

**Goal:** Let a fit be sent directly from Fittings into the doctrine workflow.

**Requirements:**
- Add clear `Export to Doctrine` action/options in the fitter.
- Integrate with the existing Corporation Management doctrine workflow rather than inventing a parallel doctrine store.
- Preserve existing fit export behavior.
- Allow the user to choose the intended doctrine destination/slot where appropriate.
- Respect existing doctrine rules: doctrine is FC/corp-management controlled and a doctrine slot may contain multiple fits.

**Acceptance:**
- A current fit can be exported into the doctrine workflow directly from Fittings.
- Exported fit arrives intact.
- Existing fitter exports remain functional.

---

## ✅ TASK 9 — Tidy and reorganize Settings

**Goal:** Make Settings coherent instead of visually scattered.

**Requirements:**
- Audit the current Settings tab layout.
- Group related controls into logical sections/cards.
- Normalize spacing, widths, headings, labels, status text, and buttons.
- Remove awkward dead space and inconsistent alignment.
- Preserve all existing settings functionality unless separately removed by another task.
- Keep important/destructive actions visually distinct from normal configuration.

**Acceptance:**
- Settings reads as a deliberate grouped configuration page.
- No setting functionality is accidentally lost.

---

## ✅ TASK 10 — Remove Data Vault

**Goal:** Remove the Data Vault feature from the user-facing app.

**Requirements:**
- Remove Data Vault navigation/UI entry points.
- Remove Data Vault page/panel rendering.
- Remove dead imports/routes/state/hooks that become unused.
- Do not delete shared persistence/infrastructure that other features still depend on.

**Acceptance:**
- Data Vault is no longer visible or navigable.
- App compiles without dead references introduced by the removal.

---

# Suggested execution order after GO

1. Task 1 — Alliance Management navigation move
2. Task 10 — Data Vault removal
3. Tasks 2, 4, 6 — remove unnecessary Industrial Command panels
4. Tasks 3, 5, 7 — Industrial Command visual cleanup
5. Task 8 — Fitter Export to Doctrine
6. Task 9 — Settings cleanup
7. Full typecheck/build and targeted smoke test of navigation, Industrial Command, Fittings → Doctrine, and Settings

# Current state

All ten tasks are **complete**. Renderer TypeScript, Electron TypeScript, production build, and targeted static smoke checks all passed. The app/dev server was not launched as part of final validation.
