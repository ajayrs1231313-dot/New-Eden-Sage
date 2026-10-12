# Sage MCP coverage — 5 October 2026

Implemented and built in New Eden Sage. Audited all 12 customer command pages and 63 available sections in the production frontend using a read-only backup of saved character data. The accompanying JSON records the displayed values and discovered controls at each inspected page/section. Counts include the shared application shell and repeated labels, not unique business fields.

## MCP access added

- list_sage_pages: discover command page IDs, current page and mounted state.
- navigate_sage_page: open a page and wait for the renderer to commit navigation.
- get_sage_page_values: paginated live displayed text, numeric values, time/sync labels, form values, tooltip/accessibility labels and select options. Offscreen rendered content is included. Hidden cached content is optional and may be stale. Follow nextOffset until null.
- capture_sage_page: inspect charts, maps and other graphical content as an MCP image.
- list_sage_controls: paginated standard controls and custom React event controls, complete select options and event names.
- invoke_sage_control: editing, selection, checkboxes, focus, keyboard modifiers, form submission, hover, context menus, double-click, HTML5 drag/drop, native map panning/zoom and local file imports.
- list_sage_actions / invoke_sage_action: 262 callable renderer actions with positional argument information. Event subscriptions are listed separately.
- save_sage_fit with openInFitter=true: persist the fit, open Fitting Command and select it.

## Page audit

| Page | Initial displayed entries | Initial controls | Inspected sections |
|---|---:|---:|---:|
| Character Command | 271 | 67 | 5 |
| Activity Command | 222 | 53 | 3 |
| ISK Command | 92 | 39 | 8 |
| Navigation Command | 237 | 77 | 5 |
| Wormhole Command | 311 | 61 | 6 |
| Fitting Command | 235 | 113 | 4 |
| Asset Command | 94 | 36 | 6 |
| Industrial Command | 198 | 52 | 9 |
| Corporation Command | 112 | 48 | 11 |
| Strategic Command | 102 | 40 | 0 |
| Fleet Command | 113 | 43 | 6 |
| Settings | 109 | 31 | 0 |

## Validation and limits

Build and TypeScript checks passed. Live Electron regression checks passed for value pagination, hidden/offscreen content, custom controls, text entry, disabled controls, context menus, drag/drop, native pointer/wheel input, file imports, form submission, navigation, fitting persistence and screenshot capture. Existing MCP control, data-coverage, AI-guidance, raw-market and blueprint-output checks passed.

The audit profile had saved character data but no live account credentials. Online-only corporation, mail and other connected-service operations were discoverable but were not exercised successfully in this profile. Conditional dialogs, newly created entities and every possible account state have not each been individually verified. Graphics are available as images; the value tool does not decode pixels into structured chart data. Existing page-data/backend tools provide underlying data where available. Password input values are excluded.

Reopen Sage and reconnect the MCP client to load the rebuilt bridge and refresh the tool catalog.
