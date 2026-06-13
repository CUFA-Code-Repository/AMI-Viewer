# AMIv2 Flight Data Viewer — working notes

Offline, in-browser viewer for AMIv2 SD-card flight logs. Spec: `design_doc.md`
(authoritative — keep CSV schemas in §3 in sync with firmware `Task/SDCardTask.hpp`).

## Stack
Svelte 5 (runes) + Vite + TypeScript. PapaParse for CSV. Parsing runs in a Web
Worker. Build is a single static bundle; `SINGLE_FILE=1` inlines everything
(worker included, via `?worker&inline`) into one offline `dist/index.html`.

## Architecture (mirrors design_doc §7)
- `src/model/` — pure, framework-free, Node-testable:
  - `types.ts` — columnar typed-array tables + `SessionModel` (single source of truth).
  - `clock.ts` — 32-bit `HAL_GetTick()` wrap stitching → monotonic Float64 ms.
  - `parse.ts` — header-driven, positional-fallback parsers; robustness rules
    (truncated tail, lat/lon side letters, `Fix==0` → NaN, missing files).
  - `build.ts` — assembles phases, summary, UTC mapping, data-health.
- `src/worker/parse.worker.ts` — runs `buildSession` off the UI thread.
- `src/store/session.svelte.ts` — central store: model + shared
  `{cursorTimeMs, visibleRange, units}`; every view subscribes (this is what
  makes 2D/3D/Map move as one).
- `src/loader/loadFolder.ts` — FS Access API + drag-drop + `webkitdirectory`.
- `src/components/` — Svelte UI (loader, overview, phase strip, health, top bar,
  shared timeline, tab placeholders).

## Conventions
- Data is **columnar typed arrays**, never arrays of objects (100 Hz × minutes).
- `Time (ms)` is the master timeline; always plot against actual time (mixed
  1 Hz / 100 Hz rates — never assume uniform spacing).
- Baro altitude is relative to startup pressure, not MSL — never conflate with GPS.

## Test / build
- `npm run gen:sample` → `sample/{0007,0008(truncated),0009(wrap)}` (gitignored).
- `npm test` → esbuild-bundles `scripts/test-parse.mjs` and runs model assertions.
  (Node can't resolve the extensionless TS imports directly; esbuild bundles first.)
- `npm run check` → svelte-check, must stay at 0 errors. Scripts/ are excluded
  from the tsconfig (loose Node `.mjs`).

## Build phases (design_doc §10)
1. ✅ Data spine + overview dashboard.
2. ✅ 2D synced uPlot graphs — `src/graphs/` (panels, decimation, plugins,
   uPlot data build, export) + `Panel.svelte` / `SyncGraphs.svelte`. Shared
   X-range via `session.visibleRange`, cursor via `session.cursorTimeMs`.
   Tests: `npm run test:graphs` (uPlot stubbed via esbuild --alias).
3. ✅ Score — `src/score/recompute.ts` (pure engine mirroring firmware formula
   + quirks) + `ScoreView.svelte` / `PenaltyChart.svelte` + `scoreParams` store
   (what-if). Recompute matches logged within float tolerance (test:score).
4. ⬜ 3D (Three.js) replay + MapLibre ground track, wired to the shared cursor.
5. ⬜ Extras: A/B compare, derived signals, auto-events, data-quality, PDF, units.
