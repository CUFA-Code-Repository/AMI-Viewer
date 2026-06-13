// Web Worker: parse + build the SessionModel off the UI thread (design_doc §7).
// All heavy CSV work happens here so the UI thread only renders.
import { buildSession } from '../model/build';
import type { WorkerRequest, WorkerResponse } from '../model/types';

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type !== 'parse') return;
  const post = (m: WorkerResponse) => (self as unknown as Worker).postMessage(m);
  try {
    post({ type: 'progress', phase: 'Parsing CSV files…', pct: 10 });
    const model = buildSession(msg.files);
    post({ type: 'progress', phase: 'Assembling session…', pct: 90 });
    post({ type: 'done', model });
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
