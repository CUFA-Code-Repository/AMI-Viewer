// Central store: the loaded SessionModel plus the shared view state
// {cursorTimeMs, visibleRange, units, selection} that makes Graphs / Score /
// 3D / Map move as one (design_doc §7). Svelte 5 runes.
import type { SessionModel, RawFiles } from '../model/types';
// Inlined as a blob URL so the single-file FlightViewer.html (design_doc §2
// option 2) is truly self-contained and runs offline from file://.
import ParseWorker from '../worker/parse.worker.ts?worker&inline';

export type Units = {
  speed: 'kmh' | 'ms';
  altitude: 'm' | 'ft';
  pressure: 'pa' | 'hpa';
  temp: 'c' | 'f';
};

type LoadState =
  | { status: 'idle' }
  | { status: 'loading'; phase: string; pct: number }
  | { status: 'ready' }
  | { status: 'error'; message: string };

class SessionStore {
  model = $state<SessionModel | null>(null);
  load = $state<LoadState>({ status: 'idle' });
  activeTab = $state<'graphs' | 'score' | '3d' | 'map'>('graphs');

  // shared cursor / range across all views
  cursorTimeMs = $state<number>(0);
  visibleRange = $state<{ minMs: number; maxMs: number } | null>(null);

  units = $state<Units>({ speed: 'kmh', altitude: 'm', pressure: 'pa', temp: 'c' });

  private worker: Worker | null = null;

  /** Parse a RawFiles bundle in the worker and install the model. */
  async ingest(files: RawFiles): Promise<void> {
    this.load = { status: 'loading', phase: 'Reading files…', pct: 5 };
    this.model = null;

    this.worker?.terminate();
    const worker = new ParseWorker();
    this.worker = worker;

    await new Promise<void>((resolve) => {
      worker.onmessage = (ev) => {
        const m = ev.data as import('../model/types').WorkerResponse;
        if (m.type === 'progress') {
          this.load = { status: 'loading', phase: m.phase, pct: m.pct };
        } else if (m.type === 'done') {
          this.model = m.model;
          const s = m.model.summary;
          this.visibleRange = { minMs: s.startMs, maxMs: s.endMs };
          this.cursorTimeMs = s.startMs;
          this.load = { status: 'ready' };
          resolve();
        } else if (m.type === 'error') {
          this.load = { status: 'error', message: m.message };
          resolve();
        }
      };
      worker.onerror = (e) => {
        this.load = { status: 'error', message: e.message || 'Worker failed' };
        resolve();
      };
      worker.postMessage({ type: 'parse', files });
    });
  }

  reset(): void {
    this.worker?.terminate();
    this.worker = null;
    this.model = null;
    this.load = { status: 'idle' };
    this.visibleRange = null;
    this.cursorTimeMs = 0;
  }

  /** Convert a stitched ms time to a UTC label, if a GPS UTC mapping exists. */
  utcLabel(tMs: number): string | null {
    const off = this.model?.utcOffsetMs;
    if (off == null) return null;
    const ms = tMs + off; // ms-of-day UTC
    const dayMs = ((ms % 86400000) + 86400000) % 86400000;
    const h = Math.floor(dayMs / 3600000);
    const m = Math.floor((dayMs % 3600000) / 60000);
    const s = Math.floor((dayMs % 60000) / 1000);
    const mmm = Math.floor(dayMs % 1000);
    return `${pad(h)}:${pad(m)}:${pad(s)}.${String(mmm).padStart(3, '0')}Z`;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

export const session = new SessionStore();
