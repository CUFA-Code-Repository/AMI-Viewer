// Shared data types for the AMIv2 viewer (design_doc.md §3, §7).
// Storage is columnar typed arrays — not arrays of objects — to keep
// 100 Hz × minutes of data fast and memory-light.

export type FlightPhase = 'IDLE' | 'CLIMBING' | 'DISTANCE' | 'LANDING';
export const PHASE_ORDER: FlightPhase[] = ['IDLE', 'CLIMBING', 'DISTANCE', 'LANDING'];

/** sensors.csv — IMU + power + barometer (§3.1). Time is the stitched master clock (ms). */
export interface SensorsTable {
  n: number;
  t: Float64Array; // stitched ms (wrap-corrected, monotonic, may exceed 2^32)
  ax: Float32Array;
  ay: Float32Array;
  az: Float32Array;
  gx: Float32Array;
  gy: Float32Array;
  gz: Float32Array;
  voltage: Float32Array;
  current: Float32Array;
  pressure: Float32Array;
  temperature: Float32Array;
  altitude: Float32Array; // baro, relative to startup pressure
  phase: Uint8Array; // index into PHASE_ORDER
}

/** gps.csv — GNSS fix (§3.2). Sign already applied from side letters. */
export interface GpsTable {
  n: number;
  t: Float64Array; // stitched ms
  utc: Float64Array; // ms since boot-day midnight UTC, NaN if unparsable
  lat: Float64Array; // signed degrees (NaN if no fix / side '-')
  lon: Float64Array; // signed degrees
  altitude: Float32Array; // GPS altitude
  speed: Float32Array; // km/h
  hdop: Float32Array;
  course: Float32Array; // deg
  satellites: Uint8Array;
  fix: Uint8Array; // 0/1
}

/** score.csv — competition score (§3.3). */
export interface ScoreTable {
  n: number;
  t: Float64Array; // stitched ms
  phase: Uint8Array; // index into PHASE_ORDER
  distance: Float32Array; // m
  pCurrent: Float32Array;
  rawScore: Float64Array;
  zeroFlag: Uint8Array; // 0/1
}

/** system.txt event (§3.4). */
export interface SystemEvent {
  name: string; // event_name, e.g. 'boot', 'phase_transition'
  tMs: number | null; // stitched ms (from tick=) if present
  rawTick: number | null; // original (pre-stitch) tick value
  fields: Record<string, string>;
}

/** config.txt (§3.5). */
export interface SessionConfig {
  payloadKg: number;
  takeoffAnnouncedM: number;
  fromDefaults: boolean; // true when config.txt absent → firmware defaults assumed
}

export const DEFAULT_CONFIG: SessionConfig = {
  payloadKg: 1.05,
  takeoffAnnouncedM: 40,
  fromDefaults: true,
};

/** Per-file parse diagnostics for the data-health report (§4.1). */
export interface FileHealth {
  present: boolean;
  rowsParsed: number;
  rowsSkipped: number; // blank/partial/invalid lines dropped
  truncatedTail: boolean; // last line looked cut mid-write
  errors: string[];
}

export interface ClockWrap {
  detected: boolean;
  count: number; // how many 2^32 offsets stitched in
}

/** A contiguous run of one flight phase along the master timeline. */
export interface PhaseSpan {
  phase: FlightPhase;
  startMs: number;
  endMs: number;
}

/** Headline numbers + health for the overview dashboard (§4.1). */
export interface SessionSummary {
  sessionName: string;
  durationMs: number;
  startMs: number;
  endMs: number;
  bootUtcMs: number | null; // wall clock of first valid GPS fix
  finalRawScore: number | null;
  scoredDistanceM: number | null;
  peakCurrentA: number | null;
  peakVoltageV: number | null;
  maxBaroAltM: number | null;
  maxSpeedKmh: number | null;
  satMin: number | null;
  satMax: number | null;
  hdopMin: number | null;
  hdopMax: number | null;
  gpsValidPct: number | null; // % of gps rows with fix==1
  zeroFlag: boolean;
  zeroReason: string | null; // e.g. "Over-current 71.3 A @ t=…"
}

/** The single source of truth assembled by the worker (§7). */
export interface SessionModel {
  sessionName: string;
  sensors: SensorsTable | null;
  gps: GpsTable | null;
  score: ScoreTable | null;
  events: SystemEvent[];
  config: SessionConfig;
  phases: PhaseSpan[];
  summary: SessionSummary;
  health: {
    sensors: FileHealth;
    gps: FileHealth;
    score: FileHealth;
    system: FileHealth;
    config: FileHealth;
    clockWrap: ClockWrap;
  };
  /** maps stitched ms → UTC ms (offset). null if no GPS UTC available. */
  utcOffsetMs: number | null;
}

/** Raw file contents handed to the worker. */
export interface RawFiles {
  sessionName: string;
  sensors?: string;
  gps?: string;
  score?: string;
  system?: string;
  config?: string;
}

// ---- worker message protocol ------------------------------------------
export type WorkerRequest = { type: 'parse'; files: RawFiles };
export type WorkerResponse =
  | { type: 'progress'; phase: string; pct: number }
  | { type: 'done'; model: SessionModel }
  | { type: 'error'; message: string };
