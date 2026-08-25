# New Eden Sage — Development Rules

This file is mandatory reading before every development pass in this repository.

## UI / Aesthetics
- Keep the aesthetics of every new or modified feature in line with the rest of New Eden Sage.
- Reuse the app's established layout language, spacing, typography, borders, controls, density, colours, hover/focus behaviour, and responsive patterns instead of introducing a visually separate style.
- Before finishing UI work, compare the changed feature against its surrounding command/page and correct anything that looks bolted on, oversized, inconsistent, or out of place.

## Dev-session cleanup
- When development work is finished, close **all Electron processes**.
- Do not leave a Sage dev window, production Electron window, Electron child process, or stale Electron dev instance running after the task is complete.
- Verify Electron is no longer running before reporting the dev task finished.
