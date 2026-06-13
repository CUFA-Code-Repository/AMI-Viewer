# AMIv2 Flight Data Viewer

A lightweight, zero-install web app for viewing and analyzing flight logs recorded
by the AMIv2 firmware onto the SD card. All parsing happens **in the browser** —
data never leaves your machine. See [design_doc.md](design_doc.md) for the full spec.

## Status

**Phases 1–4 complete.**
- **Phase 1 (data spine)** — folder loader, Web Worker CSV parser, session model
  with master timeline + 32-bit clock-wrap stitching, overview dashboard.
- **Phase 2 (2D graphs)** — stacked, time-synchronized uPlot panels (Power,
  Acceleration, Angular rate, Altitude baro-vs-GPS, Speed/Course, GPS quality,
  Score) sharing one cursor and zoom range, with phase background bands, event
  markers, threshold lines, synced hover, box-zoom, and per-panel CSV/PNG export.
- **Phase 3 (score)** — logged score vs an independent recompute (mirrors the
  firmware formula and quirks) shown side-by-side with the delta; live what-if
  controls (payload, announced roll, penalty threshold/coef, zero thresholds);
  penalty-integral breakdown chart; and zero forensics with zoom-to-event.

- **Phase 4 (3D + Map)** — Three.js flight replay: the aircraft follows the
  ENU-projected GPS path (altitude = weighted baro/GPS blend, toggleable),
  phase-colored trail, ground grid, orbit/chase/top-down cameras, and a HUD —
  all synced to the shared cursor. Plus an offline canvas ground-track Map
  (no tiles, no network) with the scored DISTANCE segment highlighted and
  click-to-seek. Three.js is lazy-loaded only when the 3D tab is opened.

Phase 5 (extras: A/B compare, derived signals, auto-events, data-quality report,
PDF export, unit toggles) is next.

## Develop

```bash
npm install
npm run gen:sample   # writes synthetic sessions to sample/0007, 0008 (truncated), 0009 (clock-wrap)
npm run dev          # http://localhost:5173 — drag a sample/* folder in
```

## Verify

```bash
npm run check        # svelte-check (type safety, 0 errors)
npm test             # parser + session-model smoke tests against sample/*
```

## Build

```bash
npm run build              # static bundle → dist/ (host anywhere; relative paths)
SINGLE_FILE=1 npm run build # self-contained dist/index.html (double-click, fully offline)
```

The worker is inlined as a blob URL, so the single-file build is one HTML file
with no sibling assets.

## Deploy (GitHub Pages)

`.github/workflows/deploy-pages.yml` builds and publishes `dist/` on every push to
`main`. **One-time setup:** in the repo, go to **Settings → Pages → Build and
deployment → Source = "GitHub Actions"**. The workflow gates the deploy on
`npm run check` and `npm test`.

## Input data

A session folder copied off the SD card containing any subset of:
`sensors.csv`, `gps.csv`, `score.csv`, `system.txt`, `config.txt`. Missing files
degrade gracefully (e.g. no `gps.csv` → map/3D disabled, sensor graphs still work).
Schemas are documented in [design_doc.md §3](design_doc.md).
