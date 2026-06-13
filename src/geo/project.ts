// Local ENU tangent-plane projection + altitude blending for 3D/Map
// (design_doc §4.4). GPS lat/lon → local East/North metres centered on takeoff;
// altitude (Z/up) from baro, GPS, or a weighted blend.
import type { SessionModel } from '../model/types';

const EARTH_R = 6371000; // m

export type AltSource = 'blend' | 'baro' | 'gps';

export interface PathPoint {
  tMs: number;
  e: number; // East metres from origin
  n: number; // North metres from origin
  up: number; // altitude metres (per selected source)
  baro: number; // baro altitude at this point (NaN if no sensors)
  gpsAlt: number; // gps altitude
  speed: number; // km/h
  course: number; // deg
  current: number; // A (from sensors, for trail color / HUD)
  voltage: number; // V
  phase: number; // sensor phase index at this time
}

export interface FlightPath {
  origin: { lat: number; lon: number }; // takeoff reference
  points: PathPoint[];
  bounds: { minE: number; maxE: number; minN: number; maxN: number; minUp: number; maxUp: number };
  /** index range [start,end] of the scored DISTANCE-phase segment, or null */
  distanceSeg: { start: number; end: number } | null;
}

/**
 * Equirectangular ENU projection centered on the first valid fix. For the
 * scale of a UAV flight (sub-km) this is indistinguishable from a full
 * tangent-plane transform and matches the firmware's distance method.
 */
function projectEN(lat: number, lon: number, lat0: number, lon0: number): { e: number; n: number } {
  const latMid = ((lat + lat0) / 2) * (Math.PI / 180);
  const e = ((lon - lon0) * (Math.PI / 180)) * Math.cos(latMid) * EARTH_R;
  const n = ((lat - lat0) * (Math.PI / 180)) * EARTH_R;
  return { e, n };
}

const DISTANCE_PHASE = 2; // PHASE_ORDER.indexOf('DISTANCE')

/** Default blend: baro weighted higher (smoother, 100 Hz) than GPS (noisier). */
const BARO_W = 0.7;
const GPS_W = 0.3;

export function blendAlt(baro: number, gps: number, source: AltSource): number {
  const hasB = Number.isFinite(baro);
  const hasG = Number.isFinite(gps);
  if (source === 'baro') return hasB ? baro : (hasG ? gps : 0);
  if (source === 'gps') return hasG ? gps : (hasB ? baro : 0);
  // blend
  if (hasB && hasG) return BARO_W * baro + GPS_W * gps;
  if (hasB) return baro;
  if (hasG) return gps;
  return 0;
}

/** Nearest-previous sensor sample index at GPS time t. */
function sensorIdxAt(s: NonNullable<SessionModel['sensors']>, t: number): number {
  let lo = 0, hi = s.n;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (s.t[mid] <= t) lo = mid + 1; else hi = mid; }
  return Math.max(0, lo - 1);
}

/**
 * Build the flight path from valid-fix GPS rows (Fix==1, finite lat/lon — §8).
 * Each point pulls baro/current/voltage/phase from the nearest sensor sample.
 */
export function buildFlightPath(m: SessionModel, source: AltSource): FlightPath | null {
  const g = m.gps;
  if (!g || g.n === 0) return null;

  // origin = first valid fix
  let lat0 = NaN, lon0 = NaN;
  for (let i = 0; i < g.n; i++) {
    if (g.fix[i] === 1 && Number.isFinite(g.lat[i]) && Number.isFinite(g.lon[i])) {
      lat0 = g.lat[i]; lon0 = g.lon[i]; break;
    }
  }
  if (!Number.isFinite(lat0)) return null;

  const s = m.sensors;
  const points: PathPoint[] = [];
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity, minUp = Infinity, maxUp = -Infinity;
  let segStart = -1, segEnd = -1;

  for (let i = 0; i < g.n; i++) {
    if (g.fix[i] !== 1 || !Number.isFinite(g.lat[i]) || !Number.isFinite(g.lon[i])) continue;
    const { e, n } = projectEN(g.lat[i], g.lon[i], lat0, lon0);
    const si = s ? sensorIdxAt(s, g.t[i]) : -1;
    const baro = s ? s.altitude[si] : NaN;
    const phase = s ? s.phase[si] : -1;
    const up = blendAlt(baro, g.altitude[i], source);

    const pt: PathPoint = {
      tMs: g.t[i], e, n, up,
      baro, gpsAlt: g.altitude[i],
      speed: g.speed[i], course: g.course[i],
      current: s ? s.current[si] : NaN,
      voltage: s ? s.voltage[si] : NaN,
      phase,
    };
    const idx = points.length;
    points.push(pt);

    if (e < minE) minE = e; if (e > maxE) maxE = e;
    if (n < minN) minN = n; if (n > maxN) maxN = n;
    if (up < minUp) minUp = up; if (up > maxUp) maxUp = up;

    if (phase === DISTANCE_PHASE) {
      if (segStart < 0) segStart = idx;
      segEnd = idx;
    }
  }

  if (points.length === 0) return null;

  return {
    origin: { lat: lat0, lon: lon0 },
    points,
    bounds: { minE, maxE, minN, maxN, minUp, maxUp },
    distanceSeg: segStart >= 0 ? { start: segStart, end: segEnd } : null,
  };
}

/** Index of the path point nearest a given time (for cursor sync). */
export function pointIndexAtTime(path: FlightPath, tMs: number): number {
  const p = path.points;
  let lo = 0, hi = p.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (p[mid].tMs <= tMs) lo = mid + 1; else hi = mid; }
  const j = lo - 1;
  if (j < 0) return 0;
  if (j >= p.length - 1) return p.length - 1;
  // pick closer of j, j+1
  return (tMs - p[j].tMs) <= (p[j + 1].tMs - tMs) ? j : j + 1;
}
