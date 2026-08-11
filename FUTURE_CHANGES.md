# Future changes

- Persist a selected imported fitting as PvE loadout context, then compare its hull/modules against the character's current EVE ship and activity requirements.
- Add optional fitted-ship performance inputs (DPS, tank, capacitor and drone capability) when EVE's public character APIs do not expose live module fitting data.
- Replace generic PvE earning ranges with activity-specific historical estimates where reliable public data is available; keep uncertainty and loss/loot variance visible.
- Add user-configurable tax, broker-fee and hauling-cost assumptions to regional-profit estimates.
- Add a compact memory diagnostic in Settings for market-index size, worker memory and cache age.

## Fitting intelligence after Pyfa-class parity

- Add a **Dream Fit** target workflow: save any aspirational fit even when the selected character cannot yet fly or fit it.
- Export Dream Fit targets into Progression Ship Planner with separate **mandatory**, **recommended**, and **perfect-supporting-skill** paths.
- Include implants in Dream Fit progression and show train-vs-implant-vs-module-compromise alternatives.
- Add an **automatic fit fixer** that finds the smallest skill, implant, module-state or module-substitution changes needed to make a fit usable for the selected character.
- Show **fastest usable**, **full dream fit**, and **perfect support skills** completion estimates.
- Add **skill-value optimization** showing the concrete DPS, tank, capacitor, fitting-resource, mobility or application gain per training-time investment.
- Add alternative module intelligence across compact/meta/faction/deadspace variants with exact performance, fitting-resource and ISK tradeoffs.
- Add an **ISK-vs-performance optimizer** such as “reach at least 95% of this fit's DPS under 300m ISK”.
- Add a **Why?** explainer for every derived fitting stat so users can inspect the modules, skills, implants, boosts, states and assumptions that produced the number.
- Track character progression against saved Dream Fits and automatically update readiness as ESI skill data changes.
- Integrate Dream Fit and alternative-module procurement directly with Sage's full-market search and optimal purchase-route tooling.
