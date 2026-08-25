# Modal public market-crunch trial

This directory contains an isolated, one-run benchmark for moving New Eden Sage's shared/public market workload to Modal.

It does **not** change the desktop application's production data path and it does **not** create a recurring schedule.

## Privacy boundary

The benchmark sends no character, account, OAuth, wallet, asset, skill, fitting, corporation-authenticated, or other private data to Modal. The cloud function starts from unauthenticated CCP ESI public endpoints.

## What the approved run does

1. Modal fetches the public EVE region list and all-region public market orders directly from CCP ESI.
2. It normalises those orders into Sage's existing immutable per-region raw snapshot format in ephemeral storage.
3. It runs Sage's current `buildFullMarketAnalysisIndex(...)` implementation with cache bypassed.
4. It derives the regional/security-band intelligence from that canonical full-market index.
5. It independently re-scans selected raw order samples and refuses publication if order counts or best buy/sell values disagree.
6. It writes versioned compressed `market-global` and `market-regional` prepared datasets to the `new-eden-sage-market-trial` Modal Volume.
7. Only after validation succeeds does it atomically promote `/published/manifest.json` to the new generation.
8. It reports download, crunch, publish, memory, source byte/request, output size/hash, and correctness metrics.

## Resource shape

- Modal CPU: 1.0
- Modal memory: 2048 MiB
- Node V8 old-space cap: 1536 MiB
- Function timeout: 300 seconds
- Region download concurrency: 6
- Per-region ESI page concurrency: 4

If this first shape genuinely OOMs, increase memory deliberately and record the failed attempt. Do not run speed permutations just to spend free credit.

## Run

Build Sage first so `dist-electron` reflects the current implementation, then run:

`modal run tools/modal/sage_market_benchmark.py`

No recurring/scheduled Modal job is created by this harness.
