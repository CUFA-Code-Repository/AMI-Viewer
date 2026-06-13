# AMIv2 Flight Data Viewer — Design Document

> A lightweight, zero-install web app for viewing and analyzing flight logs
> recorded by the AMIv2 firmware onto the SD card.

---

## 1. Goals & Non-Goals

### Goals
- **Open a session folder** copied off the SD card and instantly understand what happened during the flight.
- **No installation, no server, no command line.** A non-technical user double-clicks one file (or opens one URL), drags the folder in, and sees results.
- **2D analysis graphs** for every logged signal, with flight-phase context.
- **Score analysis**: show the firmware's logged score *and* independently recompute/verify it, with what-if controls.
- **3D flight replay**: an animated aircraft following its real GPS + barometric path, scrubbable on a timeline, synced to the 2D graphs.
- Work fully **offline** once loaded.

### Non-Goals
- Editing or writing back to the SD card.
- Live/telemetry streaming from the aircraft (this is post-flight analysis).
- Multi-user accounts, cloud storage, or a backend database.

---

## 2. Deployment & Distribution (lightweight, non-tech-savvy friendly)

The app is a **single static web bundle** — HTML + JS + CSS, all dependencies bundled, no network calls at runtime. Three equally valid ways to ship it, in order of "easiest for the user":

1. **Hosted static URL** (recommended default): host the build on GitHub Pages / Netlify / any static host. The user just opens a bookmark. Updates are automatic. All file parsing happens **in the browser** — data never leaves their machine.
2. **Single offline file**: a self-contained `FlightViewer.html` (everything inlined). The user saves it once and double-clicks it forever; works with no internet.
3. **Tiny desktop wrapper** (optional, later): wrap the same bundle in Tauri for a real `.exe`/`.app` icon if a true "application" feel is wanted. No code changes to the core app.

**Folder loading:** use the browser's `showDirectoryPicker()` (File System Access API) where available, with a **drag-and-drop folder** fallback and a multi-file `<input webkitdirectory>` fallback for older browsers. The user picks the session folder; the app finds the CSVs inside automatically.

### Recommended implementation stack
Chosen for small bundle size, maturity, and the 2D+3D requirement:

| Concern | Choice | Why |
|---|---|---|
| UI framework | **Svelte** (or vanilla + a tiny router) | Smallest runtime; fast; simple for one-page apps |
| CSV parsing | **PapaParse** | Robust, streaming, handles big files in a worker |
| 2D charts | **uPlot** (primary) + optional ECharts | uPlot renders 100k+ points smoothly; tiny |
| 3D replay | **Three.js** | De-facto standard; glTF aircraft model, orbit controls |
| Map (optional) | **MapLibre GL** + offline raster fallback | Ground-track overlay on a real map |
| Heavy work | **Web Worker** | Parse + downsample off the UI thread |
| Packaging | **Vite** | One command → static bundle or single inlined HTML |

> All of the above are MIT/permissive and bundle to well under a few MB gzipped.

---

## 3. Input Data Model

The app consumes a **session folder** produced by `Task/SDCardTask.hpp`. The
firmware creates a numbered session directory per boot and writes these files.
Schemas below are **authoritative** — copied from the firmware's header rows.

### 3.1 `sensors.csv` — IMU + power + barometer
Rate: **1 Hz on ground, 100 Hz in flight** (rate is implicit; infer from row spacing and `FlightPhase`).

Header (13 columns):
```
Time (ms),ax_m_s2,ay_m_s2,az_m_s2,gx_rad_s,gy_rad_s,gz_rad_s,Voltage (V),Current (A),Pressure (Pa),Temperature (C),Altitude (m),FlightPhase
```

| Column | Unit | Type | Notes |
|---|---|---|---|
| `Time (ms)` | ms | uint32 | `HAL_GetTick()` since boot; **monotonic, wraps at ~49.7 days** (not a wall clock) |
| `ax/ay/az_m_s2` | m/s² | float (2 dp) | Accel, gravity-normalized at startup so |a|≈9.81 at rest |
| `gx/gy/gz_rad_s` | rad/s | float (3 dp) | Angular rate |
| `Voltage (V)` | V | float (3 dp) | INA226 bus voltage |
| `Current (A)` | A | float (2 dp) | INA226 load current |
| `Pressure (Pa)` | Pa | float (1 dp) | BMP280 |
| `Temperature (C)` | °C | float (2 dp) | BMP280 |
| `Altitude (m)` | m | float (1 dp) | Barometric (relative to startup reference pressure) |
| `FlightPhase` | enum | string | `IDLE` / `CLIMBING` / `DISTANCE` / `LANDING` |

### 3.2 `gps.csv` — GNSS fix
Rate: **1 Hz on ground, 10 Hz in flight** (rows only written when a new fix arrives).

Header (14 columns):
```
Time (ms),Time (HH:MM:SS.mmm),Latitude (deg),lat_side,Longitude (deg),lon_side,Altitude (m),Speed (km/h),HDOP,Course (deg),Satellites,Fix
```
> Note: the header lists 12 named fields but each prints lat/lon as `value,side` pairs → 14 actual columns. Parse positionally.

| Column | Unit | Type | Notes |
|---|---|---|---|
| `Time (ms)` | ms | uint32 | Same boot-relative clock as sensors.csv — **use this to align streams** |
| `Time (HH:MM:SS.mmm)` | UTC | string | GPS wall-clock time of fix |
| `Latitude (deg)` | deg | float (6 dp) | ~0.11 m resolution |
| `lat_side` | — | char | `N`/`S`/`-` |
| `Longitude (deg)` | deg | float (6 dp) | Apply sign from side |
| `lon_side` | — | char | `E`/`W`/`-` |
| `Altitude (m)` | m | float (1 dp) | GPS altitude (independent of baro) |
| `Speed (km/h)` | km/h | float (1 dp) | Ground speed |
| `HDOP` | — | float (1 dp) | Lower = better geometry |
| `Course (deg)` | deg | float (1 dp) | Heading over ground |
| `Satellites` | count | int | |
| `Fix` | 0/1 | int | **1 = valid fix; rows with 0 must be excluded from path/distance** |

**Coordinate sign convention:** the firmware logs magnitude + side letter. The
viewer must apply `lat = (lat_side=='S') ? -|lat| : |lat|` and
`lon = (lon_side=='W') ? -|lon| : |lon|` before any math or plotting.

### 3.3 `score.csv` — competition score
Rate: **1 Hz, plus an immediate extra row at the instant the flight is zeroed.**

Header (6 columns):
```
Timestamp (ms),Phase,Distance (m),P_current,RawScore,ZeroFlag
```

| Column | Unit | Type | Notes |
|---|---|---|---|
| `Timestamp (ms)` | ms | uint32 | Boot-relative clock |
| `Phase` | enum | string | Flight phase at the time |
| `Distance (m)` | m | float (2 dp) | Ground-projected GPS distance accumulated during DISTANCE phase |
| `P_current` | — | float (4 dp) | Current penalty factor ∈ [0,1] |
| `RawScore` | — | float (3 dp) | `S_raw`; 0 when zeroed |
| `ZeroFlag` | 0/1 | int | 1 once a rule violation zeroed the flight |

### 3.4 `system.txt` — event log
Free-form, event-driven. Lines seen:
```
boot,tick=<ms>,sd_init=ok
phase_transition,tick=<ms>
```
Parse as: `event_name` followed by `key=value` pairs. The viewer should render
these as **timeline markers/annotations** and tolerate unknown event types.

### 3.5 `config.txt` (input config, may be present in root or session dir)
```
payload_kg=1.05
takeoff_announced_m=40
```
Used by the score-recompute feature. If absent, fall back to firmware defaults
(`payload_kg=1.05`, `takeoff_announced_m=40`) and clearly label the assumption.

### 3.6 Parsing robustness requirements
- **Header-driven where possible**, positional fallback (firmware format is fixed but defensive parsing avoids silent breakage).
- Skip blank/partial trailing lines (the last row may be truncated if power was cut mid-write).
- Treat the `Time (ms)` clock as the **master timeline**; detect and stitch the 32-bit wrap if a session ever crosses it.
- Tolerate missing files: the app should still open with whatever subset exists (e.g., gps.csv missing → disable map/3D, keep sensor graphs).

---

## 4. Core Features

### 4.1 Session loader & overview dashboard
On folder load, show a **summary card** before any deep dive:
- Session name, boot time (from GPS wall clock of first valid fix), duration.
- Phase timeline strip: IDLE → CLIMBING → DISTANCE → LANDING with timestamps and durations.
- Headline numbers: **final RawScore**, **scored distance**, **peak current**, **peak voltage**, **max baro altitude**, **max speed**, **satellites/HDOP range**, **ZeroFlag (and why, if set)**.
- Data-health badges: rows parsed per file, gaps detected, % of GPS rows with valid fix, any clock wrap, any truncated tail.

### 4.2 2D analysis graphs
A stacked, **time-synchronized** multi-plot view (shared X = boot-relative time, with a secondary GPS-UTC axis label). All charts share one cursor and one zoom/pan range.

Default panels (toggleable, reorderable):
1. **Power**: Voltage + Current (dual Y). Threshold lines at 30 A (penalty onset), 70 A (zero), 12.75 V (zero).
2. **Acceleration**: ax/ay/az + |a| magnitude.
3. **Angular rate**: gx/gy/gz.
4. **Altitude**: baro altitude vs GPS altitude overlaid (great for spotting baro drift).
5. **Speed & Course**: GPS speed + course.
6. **GPS quality**: satellites + HDOP + fix (step plot).
7. **Score**: RawScore, Distance, P_current over time.

Phase regions are drawn as **colored background bands** across every panel.
Event markers (boot, phase transitions, zero event) appear as vertical lines.

Interactions: hover crosshair with synced readouts across all panels; box-zoom; per-panel Y autoscale/lock; series show/hide; CSV/PNG export of any panel; "jump cursor to event."

### 4.3 Score analysis (display + recompute/verify)
Two side-by-side tracks so you can trust *and* explore the score:

**A. Logged score** — parsed straight from `score.csv`: final score, distance, penalty curve, zero status + the timestamp/row that triggered it.

**B. Independent recompute** — the viewer re-derives the score from raw `sensors.csv` + `gps.csv`, mirroring the firmware formula exactly:
```
S_raw     = B_takeoff · m_payload · l_distance² · (1 − P_current)
P_current = min(1.0, 0.002 · ∫(I − 30A) dt)        for I > 30 A
B_takeoff = 1.15 if announced_roll = 40 m, else 1.0
zero if Voltage > 12.75 V OR Current > 70 A
distance  = Σ ground-projected GPS steps during DISTANCE phase (equirectangular)
```
- Show **logged vs recomputed** side by side with the delta, so firmware bugs or float drift are visible.
- **What-if controls**: sliders/inputs for `payload_kg`, `takeoff_announced_m`, penalty threshold/coefficient, and zero thresholds → live-update the recomputed score. Lets you answer "what score would a 1.2 kg payload have given?" without reflashing.
- **Penalty breakdown**: shaded area of `I−30A` over time = the integral that drives `P_current`; highlight which seconds cost the most.
- **Zero forensics**: if zeroed, pinpoint the exact sample (over-voltage vs over-current), the value, and the time, with a zoom-to-event button.
- Replicate the firmware's quirks faithfully (penalty integral runs from the moment phase leaves IDLE; distance only accumulates during DISTANCE phase; valid-fix-only) and **flag any divergence**.

### 4.4 3D flight replay
A Three.js scene reconstructing the flight in space:
- **Path**: GPS lat/lon (local ENU tangent-plane projection centered on takeoff) for X/Y, altitude for Z. Toggle baro-altitude vs GPS-altitude as the Z source.
- **Aircraft model**: a simple glTF plane (or arrow) moved along the path; **orientation** from IMU — heading from GPS course, pitch/roll integrated/estimated from accel+gyro (clearly labeled as estimated).
- **Timeline scrubber + play/pause + speed (0.25×–10×)**, fully **synced** with the 2D cursor: dragging either moves both.
- Visual cues: phase-colored trail, current/voltage encoded as trail color or a HUD readout, markers at phase transitions and the zero event.
- Camera modes: orbit (free), chase (behind aircraft), top-down (≈ground track).
- Ground reference grid + optional **2D map ground-track** (MapLibre) as a linked companion view.

---

## 5. Additional Proposed Features (recommended before build)

These add a lot of analytical value for modest effort; prioritize per appetite.

1. **Session comparison (A/B overlay).** Load two folders and overlay their graphs and ground tracks aligned at takeoff. Essential for "did the tuning help?" across competition rounds.
2. **Derived signals.** Compute and plot: power (V×I), energy used (∫P dt, Wh) — directly relevant to an energy-limited UAV; climb rate (d(alt)/dt); acceleration magnitude; turn rate from course; baro-vs-GPS altitude residual.
3. **Auto-detected flight events.** Beyond firmware phase transitions: takeoff roll start, liftoff (altitude breaks ground), apogee, hardest turn, peak-current moment, landing touchdown. Listed in a clickable event panel that jumps all views.
4. **Data-quality report.** GPS dropouts, fix-loss intervals, HDOP spikes, sensor saturation/flatlines, sample-rate consistency (did 100 Hz actually hold?), clock-wrap detection, truncated-file detection. Helps debug the firmware too.
5. **Distance accounting view.** Map ground track colored by phase, with the *scored* DISTANCE-phase segment highlighted and its cumulative length annotated — visually explains the distance number in the score.
6. **Export / report generation.** One-click PDF/PNG "flight report" (summary + key graphs + score + map) for sharing with the team or judges. Plus export of any cleaned/merged dataset as a single combined CSV or Parquet for further analysis.
7. **Unit toggles & localization.** m/s ↔ km/h, m ↔ ft, Pa ↔ hPa, °C ↔ °F. Small touch, big usability win for mixed audiences.
8. **Annotations & bookmarks.** Let the user drop notes at timestamps ("motor glitch here") that persist with the session (saved to a sidecar JSON the user can keep next to the folder).
9. **Shareable view state.** Encode current panel layout + zoom + cursor into the URL hash so a teammate opening the same folder sees the same view.
10. **Calibration sanity check.** Verify startup accel normalization actually put |a|≈9.81 at rest; flag if the gain looks off (indicates a bad pre-flight calibration window).
11. **Time-base reconciliation.** Cross-check the boot-relative `Time (ms)` against GPS UTC to give every sample a real wall-clock timestamp and a single trustworthy timeline.

---

## 6. UX / Layout

```
┌──────────────────────────────────────────────────────────────┐
│  [Open folder]  Session: 0007   12:43:11Z   dur 3m12s   ▣ A/B │  ← top bar
├───────────────┬──────────────────────────────────────────────┤
│  Overview     │   Tabs:  [ Graphs | Score | 3D Replay | Map ] │
│  - score      │                                                │
│  - phases     │     (active tab content — synced cursor)       │
│  - peaks      │                                                │
│  - health     │                                                │
│  Event list ▸ │                                                │
├───────────────┴──────────────────────────────────────────────┤
│  ◀◀  ▶ play  ▶▶   [=========●===========]  1.0×   t=01:48.3    │  ← shared timeline
└──────────────────────────────────────────────────────────────┘
```
- **One shared timeline + cursor** drives Graphs, Score markers, 3D, and Map together.
- Left rail is always-on context (overview + events). Main area switches tabs.
- Mobile/tablet: tabs stack; timeline stays pinned to the bottom.

---

## 7. Architecture

```
File System Access / drag-drop
        │  (folder handle)
        ▼
  Loader  ──►  Web Worker (PapaParse)  ──►  Parsed columnar arrays
                                               │ (typed arrays)
                                               ▼
                              Session Model (single source of truth)
                              - master timeline (ms) + UTC mapping
                              - sensors / gps / score / events
                              - derived signals (lazy, memoized)
                              - score recompute engine
                                               │
        ┌───────────────┬──────────────┬───────┴────────┐
        ▼               ▼              ▼                ▼
   Graphs (uPlot)  Score view   3D replay (Three)   Map (MapLibre)
        └───────── shared cursor / range store ───────────┘
```
- **Columnar typed arrays** (Float32Array / Uint32Array), not arrays of objects — keeps 100 Hz × minutes of data fast and memory-light.
- **Downsampling for display** (min/max-per-pixel / LTTB) so 2D charts stay smooth; full resolution kept for math/export.
- All parsing + heavy derivation in a **Web Worker**; UI thread only renders.
- A small **central store** holds `{cursorTimeMs, visibleRange, units, selection}`; every view subscribes — this is what makes 2D/3D/Map move as one.

---

## 8. Edge Cases & Validation (must-handle)

- Lat/lon **sign from side letter** (`S`/`W` negative); drop rows where side is `-`.
- **Exclude `Fix==0`** rows from path, distance, and 3D.
- **Truncated final row** (power cut mid-write) → ignore, don't crash.
- **32-bit `Time (ms)` wrap** → detect decreasing timestamp, add 2³² offset.
- **Missing files** → degrade gracefully (disable dependent views, show why).
- **Mixed sample rates** within one file (1 Hz↔100 Hz on phase change) → don't assume uniform spacing; always plot against actual `Time (ms)`.
- **Baro altitude is relative** to startup pressure, not MSL — label clearly; don't conflate with GPS altitude.
- **No valid GPS at all** → still show sensor + score graphs; show "no GPS path" placeholder in 3D/Map.
- Large files (tens of MB) → stream-parse, show progress, never block the UI.

---

## 9. Acceptance Criteria (MVP)

1. User opens the app (URL or single HTML), drags in a session folder, and within a few seconds sees the **overview** with score, phases, and peaks.
2. **Graphs tab** shows power/accel/gyro/altitude/speed/score, time-synced, with phase bands and event markers; hover shows synced values; zoom/pan works.
3. **Score tab** shows logged score, an independent recompute that matches within float tolerance, a penalty-integral breakdown, zero forensics, and live what-if for payload + announced roll.
4. **3D tab** plays back the GPS+altitude path with a moving aircraft, a working scrubber/play controls, and camera modes; cursor stays in sync with the Graphs tab.
5. Works **offline** after first load; **no data leaves the browser**.
6. Handles a real, imperfect log (missing fixes, truncated tail) without crashing.

---

## 10. Suggested Build Phases

- **Phase 1 — Data spine:** folder loader, worker parser for all four files, session model, master timeline, overview dashboard. *(De-risks everything else.)*
- **Phase 2 — 2D graphs:** synced multi-panel uPlot with phase bands + events + export.
- **Phase 3 — Score:** logged display, recompute engine, what-if, penalty/zero forensics.
- **Phase 4 — 3D + Map:** Three.js replay and MapLibre ground track, both wired to the shared cursor.
- **Phase 5 — Extras:** A/B compare, derived signals, auto-events, data-quality report, PDF export, unit toggles.

---

## Appendix A — Firmware reference (source of truth)

- Logging task & exact CSV formats: `Task/SDCardTask.hpp`
- Score formula, thresholds, distance method: `Task/ScoreTask.hpp`
- Flight phase definitions & transitions: `Task/FlightManagerTask.hpp`, `Task/FlightPhase.hpp`
- GPS struct/units (speed in km/h, lat/lon double): `Lib/GNSS/GNSS.hpp`
- Config keys/defaults: `Task/CompetitionConfig.hpp`

> Keep this document in sync with `SDCardTask.hpp`: if a CSV header or unit
> changes in firmware, update §3 here and the viewer's parser together.
