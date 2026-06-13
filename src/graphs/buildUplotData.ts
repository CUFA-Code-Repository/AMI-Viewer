// Converts a PanelSpec + SessionModel + visible range into uPlot data and opts.
import uPlot from 'uplot';
import type { SessionModel } from '../model/types';
import type { PanelSpec } from './panels';
import { timeOf } from './panels';
import { cursorSyncPlugin, phaseBandsPlugin, eventMarkersPlugin, type EventMark } from './plugins';

const SYNC_KEY = 'ami-graphs';

export interface PanelRender {
  data: uPlot.AlignedData;
  opts: uPlot.Options;
}

/**
 * uPlot wants one shared X per chart. Series whose source differs from the
 * panel's primary source are resampled onto the primary timeline by
 * nearest-previous lookup so e.g. GPS altitude can overlay sensor time.
 */
export function buildPanelRender(
  m: SessionModel,
  panel: PanelSpec,
  range: { minMs: number; maxMs: number },
  pxWidth: number,
  bands: ReturnType<typeof phaseBandsPlugin>,
  events: EventMark[],
  onCursor: (t: number | null) => void,
): PanelRender | null {
  const baseT = timeOf(m, panel.source);
  if (!baseT) return null;
  const baseN = baseT.length;
  const cols = Math.max(200, Math.floor(pxWidth));

  // decimate the primary X by first taking one representative series to get the
  // x grid; we instead decimate each series independently against the same range
  // and let uPlot align — but uPlot needs ONE x array. So we decimate x once
  // using index positions, then sample each series at those indices.
  const xDec = decimateIndices(baseT, baseN, range.minMs, range.maxMs, cols);
  const xs: number[] = xDec.map((i) => baseT[i]);

  const data: uPlot.AlignedData = [xs as any];
  const series: uPlot.Series[] = [{}];

  for (const s of panel.series) {
    const col = s.col(m);
    if (!col) continue;
    const srcT = timeOf(m, s.source)!;
    let ys: (number | null)[];
    if (s.source === panel.source) {
      ys = xDec.map((i) => finiteOrNull(col[i]));
    } else {
      // resample foreign series onto base x by nearest-previous
      ys = xs.map((t) => {
        const j = nearestPrev(srcT, srcT.length, t);
        return j < 0 ? null : finiteOrNull(col[j]);
      });
    }
    data.push(ys as any);
    series.push({
      label: s.label,
      stroke: s.color,
      width: s.width ?? 1.25,
      scale: s.scale ?? 'y',
      ...(s.step ? { paths: uPlot.paths.stepped!({ align: 1 }) } : {}),
      ...(s.dash ? { dash: s.dash } : {}),
      points: { show: false },
      spanGaps: false,
    });
  }

  // scales
  const scales: uPlot.Scales = { x: { time: false } };
  const axes: uPlot.Axis[] = [
    {
      scale: 'x',
      stroke: '#94a3b8',
      grid: { stroke: 'rgba(148,163,184,0.12)' },
      ticks: { stroke: 'rgba(148,163,184,0.2)' },
      values: (_u, vals) => vals.map((v) => fmtTimeTick(v - range.minMs)),
    },
  ];
  const scaleDefs = panel.scales ?? [{ id: 'y', side: 'left' as const, label: '' }];
  for (const sd of scaleDefs) {
    scales[sd.id] = {};
    axes.push({
      scale: sd.id,
      side: sd.side === 'right' ? 1 : 3,
      stroke: '#94a3b8',
      grid: sd.id === 'y' ? { stroke: 'rgba(148,163,184,0.08)' } : { show: false },
      ticks: { stroke: 'rgba(148,163,184,0.2)' },
      label: sd.label || undefined,
      size: 50,
    });
  }

  // threshold lines via a tiny draw hook
  const thresholdPlugin: uPlot.Plugin | null = panel.thresholds?.length
    ? {
        hooks: {
          draw: (u: uPlot) => {
            const { ctx } = u;
            const { left, width } = u.bbox;
            ctx.save();
            ctx.setLineDash([3, 3]);
            for (const t of panel.thresholds!) {
              if (!u.scales[t.scale]) continue;
              const y = u.valToPos(t.value, t.scale, true);
              ctx.strokeStyle = t.color;
              ctx.beginPath();
              ctx.moveTo(left, y);
              ctx.lineTo(left + width, y);
              ctx.stroke();
            }
            ctx.restore();
          },
        },
      }
    : null;

  const opts: uPlot.Options = {
    width: pxWidth,
    height: panel.height ?? 150,
    scales,
    series,
    axes,
    cursor: {
      sync: { key: SYNC_KEY, setSeries: false },
      drag: { x: true, y: false },
      focus: { prox: 16 },
    },
    legend: { show: true, live: true },
    plugins: [
      bands,
      ...(thresholdPlugin ? [thresholdPlugin] : []),
      eventMarkersPlugin(events),
      cursorSyncPlugin(onCursor),
    ],
  };

  return { data, opts };
}

export const SYNC = SYNC_KEY;

function finiteOrNull(v: number): number | null {
  return Number.isFinite(v) ? v : null;
}

/** pick representative indices for x within [minX,maxX], ≤ ~4*cols of them. */
function decimateIndices(
  x: ArrayLike<number>, n: number, minX: number, maxX: number, cols: number,
): number[] {
  // bucket the visible window by x and keep the first index in each bucket
  // (plus the final sample), giving ~cols representative x positions.
  const out: number[] = [];
  let lo = 0, hi = n;
  { let a = 0, b = n; while (a < b) { const mid = (a + b) >>> 1; if (x[mid] < minX) a = mid + 1; else b = mid; } lo = a; }
  { let a = 0, b = n; while (a < b) { const mid = (a + b) >>> 1; if (x[mid] <= maxX) a = mid + 1; else b = mid; } hi = a; }
  const count = hi - lo;
  if (count <= 0) return [];
  if (count <= cols * 4) { for (let i = lo; i < hi; i++) out.push(i); return out; }
  const span = (maxX - minX) || 1;
  const bw = span / cols;
  let b = -1;
  for (let i = lo; i < hi; i++) {
    const bi = Math.min(cols - 1, Math.floor((x[i] - minX) / bw));
    if (bi !== b) { out.push(i); b = bi; }
  }
  if (out[out.length - 1] !== hi - 1) out.push(hi - 1);
  return out;
}

function nearestPrev(t: ArrayLike<number>, n: number, target: number): number {
  let lo = 0, hi = n;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (t[mid] <= target) lo = mid + 1; else hi = mid; }
  return lo - 1;
}

function fmtTimeTick(relMs: number): string {
  const s = relMs / 1000;
  if (Math.abs(s) >= 60) {
    const m = Math.floor(s / 60);
    const r = Math.round(s - m * 60);
    return `${m}:${String(r).padStart(2, '0')}`;
  }
  return `${s.toFixed(s < 10 ? 1 : 0)}s`;
}
