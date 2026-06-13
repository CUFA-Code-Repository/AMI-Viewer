// Headless tests for the graph data-prep pipeline (decimation + panel build).
// uPlot is DOM-bound, so we mock it to capture the data/opts buildPanelRender
// produces, and assert alignment, NaN gaps, decimation bounds, and foreign-
// source resampling.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSession } from '../src/model/build.ts';
import { minMaxDecimate } from '../src/graphs/downsample.ts';

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
}

function load(dir) {
  const read = (f) => (existsSync(resolve(dir, f)) ? readFileSync(resolve(dir, f), 'utf8') : undefined);
  return {
    sessionName: dir.split(/[\\/]/).pop(),
    sensors: read('sensors.csv'), gps: read('gps.csv'), score: read('score.csv'),
    system: read('system.txt'), config: read('config.txt'),
  };
}

console.log('=== decimation ===');
{
  const n = 100000;
  const x = new Float64Array(n);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) { x[i] = i; y[i] = Math.sin(i / 1000); }
  y[54321] = 999; // a spike that must survive
  const cols = 800;
  const out = minMaxDecimate(x, y, n, 0, n - 1, cols);
  check('decimated count bounded', out.x.length <= cols * 4 + 4, `${out.x.length}`);
  check('decimation preserves spike', out.y.some((v) => v === 999));
  check('x strictly ascending', isAscending(out.x));
  // NaN gap preserved as null
  const y2 = new Float32Array(n); for (let i = 0; i < n; i++) y2[i] = NaN;
  const out2 = minMaxDecimate(x, y2, n, 0, 100, 50);
  check('all-NaN → nulls', out2.y.every((v) => v === null));
}

console.log('\n=== panel build (sample/0007) ===');
{
  const m = buildSession(load(resolve('sample/0007')));
  const { buildPanels, timeOf } = await import('../src/graphs/panels.ts');
  const { buildPanelRender, SYNC } = await import('../src/graphs/buildUplotData.ts');
  const { phaseBandsPlugin } = await import('../src/graphs/plugins.ts');

  const panels = buildPanels(m);
  check('7 panels for full session', panels.length === 7, panels.map((p) => p.id).join(','));

  const r = { minMs: m.summary.startMs, maxMs: m.summary.endMs };
  const bands = phaseBandsPlugin(m.phases);
  for (const p of panels) {
    const out = buildPanelRender(m, p, r, 900, bands, [], () => {});
    check(`${p.id}: built`, !!out);
    if (!out) continue;
    check(`${p.id}: x aligned with all series`, out.data.every((s) => s.length === out.data[0].length));
    check(`${p.id}: x ascending`, isAscending(out.data[0]));
    check(`${p.id}: has series`, out.data.length === p.series.length + 1);
    check(`${p.id}: sync key set`, out.opts.cursor.sync.key === SYNC);
  }

  // altitude panel overlays a foreign source (GPS) onto sensors time
  const alt = panels.find((p) => p.id === 'altitude');
  const altR = buildPanelRender(m, alt, r, 900, bands, [], () => {});
  const gpsSeries = altR.data[2]; // baro=1, gps=2
  check('altitude: GPS resampled onto sensor time (some values)',
    gpsSeries.some((v) => v != null));

  // GPS quality fix series should contain 0s (dropout) → not all 1
  const gpsq = panels.find((p) => p.id === 'gpsq');
  const gq = buildPanelRender(m, gpsq, r, 900, bands, [], () => {});
  const fixIdx = gpsq.series.findIndex((s) => s.label === 'Fix') + 1;
  check('gps quality: fix has both 0 and 1', gq.data[fixIdx].includes(0) && gq.data[fixIdx].includes(1));
}

console.log('\n=== degraded (no gps) ===');
{
  const files = load(resolve('sample/0007')); files.gps = undefined;
  const m = buildSession(files);
  const { buildPanels } = await import('../src/graphs/panels.ts');
  const panels = buildPanels(m);
  check('no-gps drops gps panels', !panels.some((p) => ['speed', 'gpsq'].includes(p.id)),
    panels.map((p) => p.id).join(','));
  check('altitude still present (baro only)', panels.some((p) => p.id === 'altitude'));
}

function isAscending(a) { for (let i = 1; i < a.length; i++) if (a[i] < a[i - 1]) return false; return true; }

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURES'}`);
process.exit(failures === 0 ? 0 : 1);
