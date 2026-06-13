// CSV / text parsers for the four AMIv2 files (design_doc §3).
// Header-driven where possible with positional fallback (§3.6). Produces
// columnar typed arrays. Pure functions — unit-testable in plain Node.
import Papa from 'papaparse';
import {
  PHASE_ORDER,
  type FlightPhase,
  type SensorsTable,
  type GpsTable,
  type ScoreTable,
  type SystemEvent,
  type SessionConfig,
  type FileHealth,
  DEFAULT_CONFIG,
} from './types';
import { stitchClock } from './clock';

function emptyHealth(present: boolean): FileHealth {
  return { present, rowsParsed: 0, rowsSkipped: 0, truncatedTail: false, errors: [] };
}

function phaseIndex(s: string): number {
  const idx = PHASE_ORDER.indexOf(s.trim() as FlightPhase);
  return idx < 0 ? 0 : idx;
}

/** Tokenize with PapaParse; returns rows (arrays of strings) and the header row. */
function tokenize(text: string): { header: string[]; rows: string[][]; skipped: number } {
  const res = Papa.parse<string[]>(text, {
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  });
  const data = res.data as unknown as string[][];
  if (data.length === 0) return { header: [], rows: [], skipped: 0 };
  const header = (data[0] ?? []).map((h) => String(h).trim());
  const rows = data.slice(1);
  return { header, rows, skipped: 0 };
}

/** Map header names → column index, case/space tolerant. */
function colMap(header: string[]): Map<string, number> {
  const m = new Map<string, number>();
  header.forEach((h, i) => m.set(h.toLowerCase().replace(/\s+/g, ''), i));
  return m;
}
const key = (s: string) => s.toLowerCase().replace(/\s+/g, '');

// ---- sensors.csv -------------------------------------------------------
export function parseSensors(text: string | undefined): {
  table: SensorsTable | null;
  health: FileHealth;
} {
  const health = emptyHealth(!!text);
  if (!text) return { table: null, health };

  const { header, rows } = tokenize(text);
  const m = colMap(header);
  // positional fallback indices (§3.1 order)
  const idx = {
    t: m.get(key('Time (ms)')) ?? 0,
    ax: m.get('ax_m_s2') ?? 1,
    ay: m.get('ay_m_s2') ?? 2,
    az: m.get('az_m_s2') ?? 3,
    gx: m.get('gx_rad_s') ?? 4,
    gy: m.get('gy_rad_s') ?? 5,
    gz: m.get('gz_rad_s') ?? 6,
    voltage: m.get(key('Voltage (V)')) ?? 7,
    current: m.get(key('Current (A)')) ?? 8,
    pressure: m.get(key('Pressure (Pa)')) ?? 9,
    temperature: m.get(key('Temperature (C)')) ?? 10,
    altitude: m.get(key('Altitude (m)')) ?? 11,
    phase: m.get('flightphase') ?? 12,
  };

  const N = rows.length;
  const raw = new Float64Array(N);
  const out = {
    ax: new Float32Array(N), ay: new Float32Array(N), az: new Float32Array(N),
    gx: new Float32Array(N), gy: new Float32Array(N), gz: new Float32Array(N),
    voltage: new Float32Array(N), current: new Float32Array(N),
    pressure: new Float32Array(N), temperature: new Float32Array(N),
    altitude: new Float32Array(N), phase: new Uint8Array(N),
  };

  let k = 0;
  for (let i = 0; i < N; i++) {
    const r = rows[i];
    // truncated final row: too few columns on the last line → drop it
    if (r.length < 13) {
      if (i === N - 1) health.truncatedTail = true;
      health.rowsSkipped++;
      continue;
    }
    const t = Number(r[idx.t]);
    if (!Number.isFinite(t)) {
      health.rowsSkipped++;
      continue;
    }
    raw[k] = t;
    out.ax[k] = +r[idx.ax]; out.ay[k] = +r[idx.ay]; out.az[k] = +r[idx.az];
    out.gx[k] = +r[idx.gx]; out.gy[k] = +r[idx.gy]; out.gz[k] = +r[idx.gz];
    out.voltage[k] = +r[idx.voltage]; out.current[k] = +r[idx.current];
    out.pressure[k] = +r[idx.pressure]; out.temperature[k] = +r[idx.temperature];
    out.altitude[k] = +r[idx.altitude]; out.phase[k] = phaseIndex(r[idx.phase]);
    k++;
  }

  const { t } = stitchClock(raw.subarray(0, k));
  health.rowsParsed = k;
  const table: SensorsTable = {
    n: k, t,
    ax: out.ax.subarray(0, k), ay: out.ay.subarray(0, k), az: out.az.subarray(0, k),
    gx: out.gx.subarray(0, k), gy: out.gy.subarray(0, k), gz: out.gz.subarray(0, k),
    voltage: out.voltage.subarray(0, k), current: out.current.subarray(0, k),
    pressure: out.pressure.subarray(0, k), temperature: out.temperature.subarray(0, k),
    altitude: out.altitude.subarray(0, k), phase: out.phase.subarray(0, k),
  };
  return { table, health };
}

// ---- gps.csv -----------------------------------------------------------
// 14 actual columns (lat/lon each split into value,side). Parse positionally
// because the header names 12 fields but there are 14 columns (§3.2).
function utcToMs(s: string): number {
  // "HH:MM:SS.mmm" → ms since midnight UTC; NaN if unparsable
  const m = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(s.trim());
  if (!m) return NaN;
  const h = +m[1], min = +m[2], sec = +m[3], ms = m[4] ? +m[4].padEnd(3, '0') : 0;
  return ((h * 60 + min) * 60 + sec) * 1000 + ms;
}

export function parseGps(text: string | undefined): { table: GpsTable | null; health: FileHealth } {
  const health = emptyHealth(!!text);
  if (!text) return { table: null, health };

  const { rows } = tokenize(text);
  const N = rows.length;
  const raw = new Float64Array(N);
  const out = {
    utc: new Float64Array(N), lat: new Float64Array(N), lon: new Float64Array(N),
    altitude: new Float32Array(N), speed: new Float32Array(N), hdop: new Float32Array(N),
    course: new Float32Array(N), satellites: new Uint8Array(N), fix: new Uint8Array(N),
  };

  let k = 0;
  for (let i = 0; i < N; i++) {
    const r = rows[i];
    // positional layout: 0 t,1 utc,2 lat,3 latSide,4 lon,5 lonSide,6 alt,
    // 7 speed,8 hdop,9 course,10 sats,11 fix
    if (r.length < 12) {
      if (i === N - 1) health.truncatedTail = true;
      health.rowsSkipped++;
      continue;
    }
    const t = Number(r[0]);
    if (!Number.isFinite(t)) { health.rowsSkipped++; continue; }

    const latSide = (r[3] ?? '').trim().toUpperCase();
    const lonSide = (r[5] ?? '').trim().toUpperCase();
    const fix = Number(r[11]) ? 1 : 0;
    let lat = Math.abs(+r[2]);
    let lon = Math.abs(+r[4]);
    // apply sign from side letter (§3.2 convention); '-' side → no fix value
    if (latSide === 'S') lat = -lat;
    if (lonSide === 'W') lon = -lon;
    const validSide = latSide !== '-' && lonSide !== '-';

    raw[k] = t;
    out.utc[k] = utcToMs(r[1]);
    out.lat[k] = fix && validSide ? lat : NaN;
    out.lon[k] = fix && validSide ? lon : NaN;
    out.altitude[k] = +r[6];
    out.speed[k] = +r[7];
    out.hdop[k] = +r[8];
    out.course[k] = +r[9];
    out.satellites[k] = Math.max(0, Math.min(255, Number(r[10]) | 0));
    out.fix[k] = fix;
    k++;
  }

  const { t } = stitchClock(raw.subarray(0, k));
  health.rowsParsed = k;
  const table: GpsTable = {
    n: k, t,
    utc: out.utc.subarray(0, k), lat: out.lat.subarray(0, k), lon: out.lon.subarray(0, k),
    altitude: out.altitude.subarray(0, k), speed: out.speed.subarray(0, k),
    hdop: out.hdop.subarray(0, k), course: out.course.subarray(0, k),
    satellites: out.satellites.subarray(0, k), fix: out.fix.subarray(0, k),
  };
  return { table, health };
}

// ---- score.csv ---------------------------------------------------------
export function parseScore(text: string | undefined): { table: ScoreTable | null; health: FileHealth } {
  const health = emptyHealth(!!text);
  if (!text) return { table: null, health };

  const { header, rows } = tokenize(text);
  const m = colMap(header);
  const idx = {
    t: m.get(key('Timestamp (ms)')) ?? 0,
    phase: m.get('phase') ?? 1,
    distance: m.get(key('Distance (m)')) ?? 2,
    pCurrent: m.get('p_current') ?? 3,
    rawScore: m.get('rawscore') ?? 4,
    zeroFlag: m.get('zeroflag') ?? 5,
  };

  const N = rows.length;
  const raw = new Float64Array(N);
  const out = {
    phase: new Uint8Array(N), distance: new Float32Array(N),
    pCurrent: new Float32Array(N), rawScore: new Float64Array(N), zeroFlag: new Uint8Array(N),
  };

  let k = 0;
  for (let i = 0; i < N; i++) {
    const r = rows[i];
    if (r.length < 6) {
      if (i === N - 1) health.truncatedTail = true;
      health.rowsSkipped++;
      continue;
    }
    const t = Number(r[idx.t]);
    if (!Number.isFinite(t)) { health.rowsSkipped++; continue; }
    raw[k] = t;
    out.phase[k] = phaseIndex(r[idx.phase]);
    out.distance[k] = +r[idx.distance];
    out.pCurrent[k] = +r[idx.pCurrent];
    out.rawScore[k] = +r[idx.rawScore];
    out.zeroFlag[k] = Number(r[idx.zeroFlag]) ? 1 : 0;
    k++;
  }

  // score.csv may contain an out-of-order immediate "zero" row (§3.3);
  // stitch clock then sort by stitched time to keep a clean timeline.
  const { t } = stitchClock(raw.subarray(0, k));
  const order = Array.from({ length: k }, (_, i) => i).sort((a, b) => t[a] - t[b]);
  const st = new Float64Array(k);
  const phase = new Uint8Array(k), distance = new Float32Array(k);
  const pCurrent = new Float32Array(k), rawScore = new Float64Array(k), zeroFlag = new Uint8Array(k);
  for (let j = 0; j < k; j++) {
    const s = order[j];
    st[j] = t[s]; phase[j] = out.phase[s]; distance[j] = out.distance[s];
    pCurrent[j] = out.pCurrent[s]; rawScore[j] = out.rawScore[s]; zeroFlag[j] = out.zeroFlag[s];
  }

  health.rowsParsed = k;
  const table: ScoreTable = { n: k, t: st, phase, distance, pCurrent, rawScore, zeroFlag };
  return { table, health };
}

// ---- system.txt --------------------------------------------------------
export function parseSystem(text: string | undefined): { events: SystemEvent[]; health: FileHealth } {
  const health = emptyHealth(!!text);
  if (!text) return { events: [], health };
  const events: SystemEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    // event_name followed by key=value pairs, comma-separated (§3.4)
    const parts = s.split(',');
    const name = parts[0].trim();
    if (!name) { health.rowsSkipped++; continue; }
    const fields: Record<string, string> = {};
    let rawTick: number | null = null;
    for (let i = 1; i < parts.length; i++) {
      const eq = parts[i].indexOf('=');
      if (eq < 0) continue;
      const k2 = parts[i].slice(0, eq).trim();
      const v = parts[i].slice(eq + 1).trim();
      fields[k2] = v;
      if (k2 === 'tick') { const n = Number(v); if (Number.isFinite(n)) rawTick = n; }
    }
    events.push({ name, tMs: null, rawTick, fields });
    health.rowsParsed++;
  }
  return { events, health };
}

// ---- config.txt --------------------------------------------------------
export function parseConfig(text: string | undefined): { config: SessionConfig; health: FileHealth } {
  const health = emptyHealth(!!text);
  if (!text) return { config: { ...DEFAULT_CONFIG }, health };
  const cfg: SessionConfig = { ...DEFAULT_CONFIG, fromDefaults: false };
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 0) { health.rowsSkipped++; continue; }
    const k2 = s.slice(0, eq).trim();
    const v = Number(s.slice(eq + 1).trim());
    if (!Number.isFinite(v)) { health.rowsSkipped++; continue; }
    if (k2 === 'payload_kg') cfg.payloadKg = v;
    else if (k2 === 'takeoff_announced_m') cfg.takeoffAnnouncedM = v;
    health.rowsParsed++;
  }
  return { config: cfg, health };
}
