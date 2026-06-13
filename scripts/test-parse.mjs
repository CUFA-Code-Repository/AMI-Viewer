// Smoke test for the parser + model against generated sample sessions.
// Compiles the TS model on the fly via tsx-less approach: we import the
// transpiled logic by running through esbuild-register is overkill, so we
// just exercise the pure JS-compatible parsers by reading files and asserting.
//
// Run: node scripts/test-parse.mjs
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSession } from '../src/model/build.ts';

function load(dir) {
  const read = (f) => (existsSync(resolve(dir, f)) ? readFileSync(resolve(dir, f), 'utf8') : undefined);
  return {
    sessionName: dir.split(/[\\/]/).pop(),
    sensors: read('sensors.csv'),
    gps: read('gps.csv'),
    score: read('score.csv'),
    system: read('system.txt'),
    config: read('config.txt'),
  };
}

let failures = 0;
function check(label, cond, detail = '') {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
}

function test(dir, opts = {}) {
  console.log(`\n=== ${dir} ===`);
  const m = buildSession(load(resolve(dir)));
  check('sensors parsed', m.sensors && m.sensors.n > 6000, `n=${m.sensors?.n}`);
  check('gps parsed', m.gps && m.gps.n > 600, `n=${m.gps?.n}`);
  check('score parsed', m.score && m.score.n >= 70, `n=${m.score?.n}`);
  check('events parsed', m.events.length === 4, `n=${m.events.length}`);
  check('phases derived (4 spans)', m.phases.length === 4, m.phases.map((p) => p.phase).join('>'));
  check('monotonic sensors clock', isMonotonic(m.sensors.t, m.sensors.n));
  check('monotonic gps clock', isMonotonic(m.gps.t, m.gps.n));
  check('lat sign applied / NaN on no-fix',
    m.gps && hasFinite(m.gps.lat, m.gps.n) && hasNaN(m.gps.lat, m.gps.n));
  check('gps valid% < 100 (dropout present)', m.summary.gpsValidPct < 100,
    `${m.summary.gpsValidPct?.toFixed(2)}%`);
  check('peak current > 50A', m.summary.peakCurrentA > 50, `${m.summary.peakCurrentA?.toFixed(1)}A`);
  check('scored distance > 500m', m.summary.scoredDistanceM > 500,
    `${m.summary.scoredDistanceM?.toFixed(1)}m`);
  check('boot UTC present', m.summary.bootUtcMs != null);
  check('config not from defaults', m.config.fromDefaults === false);
  check('event ticks stitched onto timeline',
    m.events.every((e) => e.tMs != null));

  if (opts.truncated) {
    check('truncated tail flagged',
      m.health.sensors.truncatedTail || m.health.sensors.rowsSkipped > 0,
      `skipped=${m.health.sensors.rowsSkipped} trunc=${m.health.sensors.truncatedTail}`);
  }
  if (opts.wrap) {
    check('clock wrap detected', m.health.clockWrap.detected,
      `count=${m.health.clockWrap.count}`);
    check('sensors clock exceeds 2^32', m.sensors.t[m.sensors.n - 1] > 4294967296);
  }
  return m;
}

function isMonotonic(t, n) { for (let i = 1; i < n; i++) if (t[i] < t[i - 1]) return false; return true; }
function hasFinite(a, n) { for (let i = 0; i < n; i++) if (Number.isFinite(a[i])) return true; return false; }
function hasNaN(a, n) { for (let i = 0; i < n; i++) if (!Number.isFinite(a[i])) return true; return false; }

test('sample/0007');
test('sample/0008', { truncated: true });
test('sample/0009', { wrap: true });

// missing-file degradation
console.log('\n=== missing gps (degrade gracefully) ===');
const noGps = load(resolve('sample/0007'));
noGps.gps = undefined;
const mNo = buildSession(noGps);
check('opens without gps', mNo.sensors && mNo.gps === null);
check('gps health marked absent', mNo.health.gps.present === false);

// missing config → defaults
console.log('\n=== missing config (defaults) ===');
const noCfg = load(resolve('sample/0007'));
noCfg.config = undefined;
const mCfg = buildSession(noCfg);
check('config falls back to defaults', mCfg.config.fromDefaults === true
  && mCfg.config.payloadKg === 1.05 && mCfg.config.takeoffAnnouncedM === 40);

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURES'}`);
process.exit(failures === 0 ? 0 : 1);
