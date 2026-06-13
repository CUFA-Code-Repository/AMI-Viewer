// Assembles the SessionModel single source of truth from parsed tables
// (design_doc §4.1, §7). Derives phase spans, headline numbers, UTC mapping,
// data-health, and places system-event ticks onto the master timeline.
import {
  PHASE_ORDER,
  type SessionModel,
  type RawFiles,
  type PhaseSpan,
  type SessionSummary,
  type SensorsTable,
  type GpsTable,
  type ScoreTable,
  type SystemEvent,
  type FlightPhase,
} from './types';
import {
  parseSensors, parseGps, parseScore, parseSystem, parseConfig,
} from './parse';
import { stitchSingle } from './clock';

function minMax(arr: ArrayLike<number>, n: number, skipNaN = false): { min: number; max: number } | null {
  let min = Infinity, max = -Infinity, seen = false;
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    if (skipNaN && !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    seen = true;
  }
  return seen ? { min, max } : null;
}

/** Contiguous phase runs from the sensors phase column (master timeline). */
function derivePhases(sensors: SensorsTable | null): PhaseSpan[] {
  if (!sensors || sensors.n === 0) return [];
  const spans: PhaseSpan[] = [];
  let curr = sensors.phase[0];
  let start = sensors.t[0];
  for (let i = 1; i < sensors.n; i++) {
    if (sensors.phase[i] !== curr) {
      spans.push({ phase: PHASE_ORDER[curr], startMs: start, endMs: sensors.t[i] });
      curr = sensors.phase[i];
      start = sensors.t[i];
    }
  }
  spans.push({ phase: PHASE_ORDER[curr], startMs: start, endMs: sensors.t[sensors.n - 1] });
  return spans;
}

/** UTC offset (stitched ms → UTC ms-of-day) from the first valid GPS fix. */
function deriveUtcOffset(gps: GpsTable | null): { offset: number | null; bootUtcMs: number | null } {
  if (!gps) return { offset: null, bootUtcMs: null };
  for (let i = 0; i < gps.n; i++) {
    if (gps.fix[i] === 1 && Number.isFinite(gps.utc[i])) {
      return { offset: gps.utc[i] - gps.t[i], bootUtcMs: gps.utc[i] };
    }
  }
  return { offset: null, bootUtcMs: null };
}

function deriveZero(sensors: SensorsTable | null, score: ScoreTable | null): {
  zeroFlag: boolean; reason: string | null;
} {
  // prefer the logged zero flag; explain it from sensor thresholds (§4.3)
  let flagged = false;
  if (score) for (let i = 0; i < score.n; i++) if (score.zeroFlag[i]) { flagged = true; break; }

  if (!sensors) return { zeroFlag: flagged, reason: flagged ? 'ZeroFlag set in score.csv' : null };

  // find first threshold breach: V>12.75 or I>70
  for (let i = 0; i < sensors.n; i++) {
    if (sensors.voltage[i] > 12.75) {
      return { zeroFlag: true, reason: `Over-voltage ${sensors.voltage[i].toFixed(2)} V @ t=${(sensors.t[i] / 1000).toFixed(1)}s` };
    }
    if (sensors.current[i] > 70) {
      return { zeroFlag: true, reason: `Over-current ${sensors.current[i].toFixed(1)} A @ t=${(sensors.t[i] / 1000).toFixed(1)}s` };
    }
  }
  return { zeroFlag: flagged, reason: flagged ? 'ZeroFlag set in score.csv (cause not found in sensors)' : null };
}

function buildSummary(
  name: string,
  sensors: SensorsTable | null,
  gps: GpsTable | null,
  score: ScoreTable | null,
  bootUtcMs: number | null,
): SessionSummary {
  // master time bounds = union of available streams
  const starts: number[] = [];
  const ends: number[] = [];
  for (const tbl of [sensors, gps, score]) {
    if (tbl && tbl.n > 0) { starts.push(tbl.t[0]); ends.push(tbl.t[tbl.n - 1]); }
  }
  const startMs = starts.length ? Math.min(...starts) : 0;
  const endMs = ends.length ? Math.max(...ends) : 0;

  const cur = sensors ? minMax(sensors.current, sensors.n) : null;
  const volt = sensors ? minMax(sensors.voltage, sensors.n) : null;
  const baro = sensors ? minMax(sensors.altitude, sensors.n) : null;
  const spd = gps ? minMax(gps.speed, gps.n) : null;
  const sats = gps ? minMax(gps.satellites, gps.n) : null;
  const hdop = gps ? minMax(gps.hdop, gps.n) : null;

  let gpsValidPct: number | null = null;
  if (gps && gps.n > 0) {
    let valid = 0;
    for (let i = 0; i < gps.n; i++) if (gps.fix[i] === 1) valid++;
    gpsValidPct = (valid / gps.n) * 100;
  }

  const { zeroFlag, reason } = deriveZero(sensors, score);

  // final logged score / scored distance from last score row
  let finalRawScore: number | null = null;
  let scoredDistanceM: number | null = null;
  if (score && score.n > 0) {
    // last non-zero-row's distance is the accumulated scored distance;
    // RawScore from the final 1 Hz row (the immediate zero row, if any, reads 0)
    finalRawScore = score.rawScore[score.n - 1];
    let maxDist = 0;
    for (let i = 0; i < score.n; i++) if (score.distance[i] > maxDist) maxDist = score.distance[i];
    scoredDistanceM = maxDist;
  }

  return {
    sessionName: name,
    durationMs: endMs - startMs,
    startMs, endMs,
    bootUtcMs,
    finalRawScore,
    scoredDistanceM,
    peakCurrentA: cur?.max ?? null,
    peakVoltageV: volt?.max ?? null,
    maxBaroAltM: baro?.max ?? null,
    maxSpeedKmh: spd?.max ?? null,
    satMin: sats?.min ?? null,
    satMax: sats?.max ?? null,
    hdopMin: hdop?.min ?? null,
    hdopMax: hdop?.max ?? null,
    gpsValidPct,
    zeroFlag,
    zeroReason: reason,
  };
}

/** Place event ticks on the stitched master timeline using a reference sample. */
function stitchEvents(events: SystemEvent[], sensors: SensorsTable | null): SystemEvent[] {
  if (!sensors || sensors.n === 0) return events.map((e) => ({ ...e, tMs: e.rawTick }));
  const refRaw = sensors.t[0] % 4294967296; // approx original raw of first sample
  const refStitched = sensors.t[0];
  return events.map((e) => ({
    ...e,
    tMs: e.rawTick == null ? null : stitchSingle(e.rawTick, refRaw, refStitched),
  }));
}

export function buildSession(files: RawFiles): SessionModel {
  const s = parseSensors(files.sensors);
  const g = parseGps(files.gps);
  const sc = parseScore(files.score);
  const sys = parseSystem(files.system);
  const cfg = parseConfig(files.config);

  const phases = derivePhases(s.table);
  const { offset, bootUtcMs } = deriveUtcOffset(g.table);
  const events = stitchEvents(sys.events, s.table);
  const summary = buildSummary(files.sessionName, s.table, g.table, sc.table, bootUtcMs);

  // All streams share one clock, so the session-wide wrap count is the max
  // observed across streams (not the sum, which would multiply-count).
  const wraps = Math.max(countWraps(s.table), countWraps(g.table), countWraps(sc.table));

  return {
    sessionName: files.sessionName,
    sensors: s.table,
    gps: g.table,
    score: sc.table,
    events,
    config: cfg.config,
    phases,
    summary,
    health: {
      sensors: s.health,
      gps: g.health,
      score: sc.health,
      system: sys.health,
      config: cfg.health,
      clockWrap: { detected: wraps > 0, count: wraps },
    },
    utcOffsetMs: offset,
  };
}

/** How many 2^32 wrap boundaries the stitched timeline crosses. */
function countWraps(tbl: { t: Float64Array; n: number } | null): number {
  if (!tbl || tbl.n < 2) return 0;
  // The stitched clock is monotonic; each wrap pushed t past another 2^32
  // multiple. Count distinct boundaries crossed between first and last sample.
  const TWO32 = 4294967296;
  const firstEpoch = Math.floor(tbl.t[0] / TWO32);
  const lastEpoch = Math.floor(tbl.t[tbl.n - 1] / TWO32);
  return Math.max(0, lastEpoch - firstEpoch);
}
