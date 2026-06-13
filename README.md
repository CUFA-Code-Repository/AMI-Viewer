# AMIv2 Flight Data Viewer

A lightweight, zero-install web app for viewing and analyzing flight logs recorded
by the AMIv2 firmware onto the SD card. All parsing happens **in the browser** —
data never leaves your machine. See [design_doc.md](design_doc.md) for the full spec.

## Status

**Phase 1 (data spine) complete** — folder loader, Web Worker CSV parser, session
model with master timeline + 32-bit clock-wrap stitching, and the overview
dashboard. Graphs (Phase 2), score recompute (Phase 3), and 3D/Map (Phase 4) are
scaffolded as tabs and arrive next.

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
