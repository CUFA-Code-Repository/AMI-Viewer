// Declarative specs for the 7 default 2D panels (design_doc §4.2).
// Each series pulls a column from a source table; the SyncGraphs container
// maps these to uPlot series + scales and applies shared phase bands/events.
import type { SessionModel } from '../model/types';

export type SourceKey = 'sensors' | 'gps' | 'score';

export interface SeriesSpec {
  label: string;
  source: SourceKey;
  /** column accessor → typed array on that table */
  col: (m: SessionModel) => ArrayLike<number> | null;
  color: string;
  /** secondary Y scale id (e.g. dual-axis power); default 'y' */
  scale?: string;
  /** draw as step plot (e.g. fix, satellites) */
  step?: boolean;
  width?: number;
  dash?: number[];
}

export interface ThresholdLine {
  scale: string;
  value: number;
  color: string;
  label: string;
}

export interface PanelSpec {
  id: string;
  title: string;
  /** primary source supplies the X (time) axis */
  source: SourceKey;
  series: SeriesSpec[];
  thresholds?: ThresholdLine[];
  /** extra named scales beyond default 'y' (for dual axis) */
  scales?: { id: string; side: 'left' | 'right'; label: string }[];
  height?: number;
}

const C = {
  v: '#38bdf8', i: '#f59e0b',
  ax: '#ef4444', ay: '#22c55e', az: '#3b82f6', amag: '#e6edf3',
  gx: '#ef4444', gy: '#22c55e', gz: '#3b82f6',
  baro: '#38bdf8', gpsAlt: '#a78bfa',
  speed: '#22c55e', course: '#f59e0b',
  sats: '#38bdf8', hdop: '#f59e0b', fix: '#22c55e',
  raw: '#38bdf8', dist: '#22c55e', pen: '#ef4444',
  warn: 'rgba(245,158,11,0.5)', bad: 'rgba(239,68,68,0.6)',
};

export function buildPanels(m: SessionModel): PanelSpec[] {
  const panels: PanelSpec[] = [];
  const hasSensors = !!m.sensors && m.sensors.n > 0;
  const hasGps = !!m.gps && m.gps.n > 0;
  const hasScore = !!m.score && m.score.n > 0;

  if (hasSensors) {
    // 1. Power — Voltage + Current dual Y, with threshold lines (§4.2)
    panels.push({
      id: 'power',
      title: 'Power',
      source: 'sensors',
      scales: [
        { id: 'y', side: 'left', label: 'V' },
        { id: 'yI', side: 'right', label: 'A' },
      ],
      series: [
        { label: 'Voltage (V)', source: 'sensors', col: (m) => m.sensors!.voltage, color: C.v, scale: 'y' },
        { label: 'Current (A)', source: 'sensors', col: (m) => m.sensors!.current, color: C.i, scale: 'yI' },
      ],
      thresholds: [
        { scale: 'yI', value: 30, color: C.warn, label: '30 A penalty' },
        { scale: 'yI', value: 70, color: C.bad, label: '70 A zero' },
        { scale: 'y', value: 12.75, color: C.bad, label: '12.75 V zero' },
      ],
    });

    // 2. Acceleration — ax/ay/az + |a|
    panels.push({
      id: 'accel',
      title: 'Acceleration (m/s²)',
      source: 'sensors',
      series: [
        { label: 'ax', source: 'sensors', col: (m) => m.sensors!.ax, color: C.ax },
        { label: 'ay', source: 'sensors', col: (m) => m.sensors!.ay, color: C.ay },
        { label: 'az', source: 'sensors', col: (m) => m.sensors!.az, color: C.az },
        { label: '|a|', source: 'sensors', col: (m) => accelMag(m), color: C.amag, width: 2 },
      ],
    });

    // 3. Angular rate — gx/gy/gz
    panels.push({
      id: 'gyro',
      title: 'Angular rate (rad/s)',
      source: 'sensors',
      series: [
        { label: 'gx', source: 'sensors', col: (m) => m.sensors!.gx, color: C.gx },
        { label: 'gy', source: 'sensors', col: (m) => m.sensors!.gy, color: C.gy },
        { label: 'gz', source: 'sensors', col: (m) => m.sensors!.gz, color: C.gz },
      ],
    });
  }

  // 4. Altitude — baro vs GPS overlaid (§4.2). Needs both sources; uPlot panel
  // is keyed on sensors time, GPS altitude is resampled by the container.
  if (hasSensors || hasGps) {
    const series: SeriesSpec[] = [];
    if (hasSensors)
      series.push({ label: 'Baro alt (m)', source: 'sensors', col: (m) => m.sensors!.altitude, color: C.baro });
    if (hasGps)
      series.push({ label: 'GPS alt (m)', source: 'gps', col: (m) => m.gps!.altitude, color: C.gpsAlt, dash: [6, 4] });
    panels.push({
      id: 'altitude',
      title: 'Altitude — baro vs GPS (baro is relative to startup, not MSL)',
      source: hasSensors ? 'sensors' : 'gps',
      series,
    });
  }

  if (hasGps) {
    // 5. Speed & Course
    panels.push({
      id: 'speed',
      title: 'Speed & Course',
      source: 'gps',
      scales: [
        { id: 'y', side: 'left', label: 'km/h' },
        { id: 'yC', side: 'right', label: 'deg' },
      ],
      series: [
        { label: 'Speed (km/h)', source: 'gps', col: (m) => m.gps!.speed, color: C.speed, scale: 'y' },
        { label: 'Course (deg)', source: 'gps', col: (m) => m.gps!.course, color: C.course, scale: 'yC' },
      ],
    });

    // 6. GPS quality — satellites + HDOP + fix (step)
    panels.push({
      id: 'gpsq',
      title: 'GPS quality',
      source: 'gps',
      scales: [
        { id: 'y', side: 'left', label: 'sats / fix' },
        { id: 'yH', side: 'right', label: 'HDOP' },
      ],
      series: [
        { label: 'Satellites', source: 'gps', col: (m) => m.gps!.satellites, color: C.sats, scale: 'y', step: true },
        { label: 'Fix', source: 'gps', col: (m) => m.gps!.fix, color: C.fix, scale: 'y', step: true },
        { label: 'HDOP', source: 'gps', col: (m) => m.gps!.hdop, color: C.hdop, scale: 'yH' },
      ],
    });
  }

  if (hasScore) {
    // 7. Score — RawScore, Distance, P_current
    panels.push({
      id: 'score',
      title: 'Score',
      source: 'score',
      scales: [
        { id: 'y', side: 'left', label: 'score / m' },
        { id: 'yP', side: 'right', label: 'P' },
      ],
      series: [
        { label: 'RawScore', source: 'score', col: (m) => m.score!.rawScore, color: C.raw, scale: 'y' },
        { label: 'Distance (m)', source: 'score', col: (m) => m.score!.distance, color: C.dist, scale: 'y' },
        { label: 'P_current', source: 'score', col: (m) => m.score!.pCurrent, color: C.pen, scale: 'yP' },
      ],
    });
  }

  return panels;
}

// memoized |a| derived signal
const magCache = new WeakMap<object, Float32Array>();
function accelMag(m: SessionModel): Float32Array {
  const s = m.sensors!;
  const cached = magCache.get(s);
  if (cached) return cached;
  const out = new Float32Array(s.n);
  for (let i = 0; i < s.n; i++) out[i] = Math.hypot(s.ax[i], s.ay[i], s.az[i]);
  magCache.set(s, out);
  return out;
}

export function timeOf(m: SessionModel, src: SourceKey): Float64Array | null {
  if (src === 'sensors') return m.sensors?.t ?? null;
  if (src === 'gps') return m.gps?.t ?? null;
  return m.score?.t ?? null;
}
