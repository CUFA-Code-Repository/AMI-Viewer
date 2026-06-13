// Independent score recompute engine (design_doc §4.3 part B).
// Re-derives the competition score from raw sensors.csv + gps.csv, mirroring
// the firmware formula EXACTLY so firmware bugs or float drift become visible:
//
//   S_raw     = B_takeoff · m_payload · l_distance² · (1 − P_current)
//   P_current = min(1.0, coef · ∫(I − thresh) dt)   for I > thresh   (coef=0.002, thresh=30A)
//   B_takeoff = 1.15 if announced_roll = 40 m, else 1.0
//   zero if Voltage > 12.75 V OR Current > 70 A
//   distance  = Σ ground-projected GPS steps during DISTANCE phase (equirectangular)
//
// Firmware quirks replicated faithfully (§4.3):
//   - the penalty integral runs from the moment phase leaves IDLE;
//   - distance only accumulates during the DISTANCE phase;
//   - only valid-fix GPS rows contribute to distance.
import { PHASE_ORDER, type SessionModel } from '../model/types';

const EARTH_R = 6371000; // m

export interface ScoreParams {
  payloadKg: number;
  takeoffAnnouncedM: number;
  penaltyThresholdA: number; // default 30
  penaltyCoef: number; // default 0.002
  zeroVoltageV: number; // default 12.75
  zeroCurrentA: number; // default 70
}

export const DEFAULT_PARAMS: ScoreParams = {
  payloadKg: 1.05,
  takeoffAnnouncedM: 40,
  penaltyThresholdA: 30,
  penaltyCoef: 0.002,
  zeroVoltageV: 12.75,
  zeroCurrentA: 70,
};

export interface PenaltyPoint {
  tMs: number;
  excessA: number; // I - threshold, clamped ≥ 0
  cumIntegral: number; // ∫(I-thresh)dt up to here (A·s)
  pCurrent: number; // min(1, coef·integral)
}

export interface ZeroEvent {
  tMs: number;
  kind: 'overvoltage' | 'overcurrent';
  value: number; // the V or A reading that tripped it
}

export interface RecomputeResult {
  rawScore: number;
  distanceM: number;
  pCurrentFinal: number;
  bTakeoff: number;
  zeroed: boolean;
  zero: ZeroEvent | null;
  /** penalty integral trace (sampled at sensor rate, non-IDLE only) */
  penaltyTrace: PenaltyPoint[];
  /** running score over time (at score-relevant samples) for plotting */
  distanceTrace: { tMs: number; distanceM: number }[];
}

const IDLE = PHASE_ORDER.indexOf('IDLE');
const DISTANCE = PHASE_ORDER.indexOf('DISTANCE');

/** Equirectangular ground step between two lat/lon points (deg) in metres. */
function groundStep(lat0: number, lon0: number, lat1: number, lon1: number): number {
  const latMid = ((lat0 + lat1) / 2) * (Math.PI / 180);
  const dLat = (lat1 - lat0) * (Math.PI / 180);
  const dLon = (lon1 - lon0) * (Math.PI / 180);
  const x = dLon * Math.cos(latMid);
  const y = dLat;
  return Math.hypot(x, y) * EARTH_R;
}

export function bTakeoff(announcedM: number): number {
  return announcedM === 40 ? 1.15 : 1.0;
}

/**
 * Recompute the score from raw data. Distance is integrated from GPS during the
 * DISTANCE phase; the GPS phase is looked up from the sensor phase column by
 * nearest-previous time (GPS has no phase field of its own).
 */
export function recompute(m: SessionModel, params: ScoreParams): RecomputeResult {
  const s = m.sensors;
  const g = m.gps;

  // ---- penalty integral + zero detection over sensor stream ----
  const penaltyTrace: PenaltyPoint[] = [];
  let cumIntegral = 0;
  let zero: ZeroEvent | null = null;

  if (s) {
    let prevT = -1;
    for (let i = 0; i < s.n; i++) {
      const phase = s.phase[i];
      const t = s.t[i];
      const I = s.current[i];
      const V = s.voltage[i];

      // zero check (first breach wins)
      if (!zero) {
        if (V > params.zeroVoltageV) zero = { tMs: t, kind: 'overvoltage', value: V };
        else if (I > params.zeroCurrentA) zero = { tMs: t, kind: 'overcurrent', value: I };
      }

      // penalty integral runs once phase has left IDLE
      if (phase !== IDLE) {
        if (prevT >= 0) {
          const dt = (t - prevT) / 1000; // s
          const excess = I > params.penaltyThresholdA ? I - params.penaltyThresholdA : 0;
          if (excess > 0 && dt > 0 && dt < 5) cumIntegral += excess * dt; // guard against gaps
        }
        const pc = Math.min(1, params.penaltyCoef * cumIntegral);
        penaltyTrace.push({
          tMs: t,
          excessA: I > params.penaltyThresholdA ? I - params.penaltyThresholdA : 0,
          cumIntegral,
          pCurrent: pc,
        });
        prevT = t;
      } else {
        prevT = t; // keep clock continuity but don't integrate during IDLE
      }
    }
  }
  const pCurrentFinal = Math.min(1, params.penaltyCoef * cumIntegral);

  // ---- distance over DISTANCE-phase, valid-fix GPS only ----
  let distanceM = 0;
  const distanceTrace: { tMs: number; distanceM: number }[] = [];
  if (g && s) {
    let prevLat = NaN, prevLon = NaN;
    for (let i = 0; i < g.n; i++) {
      const inDistance = phaseAt(s, g.t[i]) === DISTANCE;
      const valid = g.fix[i] === 1 && Number.isFinite(g.lat[i]) && Number.isFinite(g.lon[i]);
      if (inDistance && valid) {
        if (Number.isFinite(prevLat)) {
          distanceM += groundStep(prevLat, prevLon, g.lat[i], g.lon[i]);
        }
        prevLat = g.lat[i];
        prevLon = g.lon[i];
        distanceTrace.push({ tMs: g.t[i], distanceM });
      } else if (!inDistance) {
        // leaving DISTANCE resets the "previous point" so a gap isn't bridged
        prevLat = NaN; prevLon = NaN;
      }
      // invalid fix inside DISTANCE: skip (don't update prev) so we don't draw
      // a step across the dropout
    }
  }

  const b = bTakeoff(params.takeoffAnnouncedM);
  const zeroed = zero != null;
  const rawScore = zeroed
    ? 0
    : b * params.payloadKg * distanceM * distanceM * (1 - pCurrentFinal);

  return {
    rawScore,
    distanceM,
    pCurrentFinal,
    bTakeoff: b,
    zeroed,
    zero,
    penaltyTrace,
    distanceTrace,
  };
}

/** Sensor phase index active at GPS time t (nearest-previous sensor sample). */
function phaseAt(s: NonNullable<SessionModel['sensors']>, t: number): number {
  // binary search nearest-previous
  let lo = 0, hi = s.n;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (s.t[mid] <= t) lo = mid + 1; else hi = mid; }
  const idx = lo - 1;
  return idx < 0 ? s.phase[0] : s.phase[idx];
}

/** The final logged values pulled straight from score.csv (design_doc §4.3 part A). */
export function loggedFinal(m: SessionModel): {
  rawScore: number | null;
  distanceM: number | null;
  pCurrent: number | null;
  zeroed: boolean;
  zeroTMs: number | null;
} {
  const sc = m.score;
  if (!sc || sc.n === 0) return { rawScore: null, distanceM: null, pCurrent: null, zeroed: false, zeroTMs: null };
  // final 1 Hz row carries the end-state; max distance is the scored distance
  let maxDist = 0;
  let zeroed = false;
  let zeroTMs: number | null = null;
  for (let i = 0; i < sc.n; i++) {
    if (sc.distance[i] > maxDist) maxDist = sc.distance[i];
    if (sc.zeroFlag[i] && !zeroed) { zeroed = true; zeroTMs = sc.t[i]; }
  }
  // pick the representative final RawScore: last row's value
  const last = sc.n - 1;
  return {
    rawScore: sc.rawScore[last],
    distanceM: maxDist,
    pCurrent: sc.pCurrent[last],
    zeroed,
    zeroTMs,
  };
}
