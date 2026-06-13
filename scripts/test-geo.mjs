// Tests the ENU projection + altitude blend + path builder (design_doc §4.4).
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSession } from '../src/model/build.ts';
import { buildFlightPath, blendAlt, pointIndexAtTime } from '../src/geo/project.ts';

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

console.log('=== altitude blend ===');
check('blend weights baro 0.7 / gps 0.3', Math.abs(blendAlt(100, 0, 'blend') - 70) < 1e-9, `${blendAlt(100, 0, 'blend')}`);
check('baro source ignores gps', blendAlt(100, 50, 'baro') === 100);
check('gps source ignores baro', blendAlt(100, 50, 'gps') === 50);
check('blend falls back to gps when baro NaN', blendAlt(NaN, 42, 'blend') === 42);

console.log('\n=== flight path (sample/0007) ===');
{
  const m = buildSession(load(resolve('sample/0007')));
  const path = buildFlightPath(m, 'blend');
  check('path built', !!path);
  check('origin at first valid fix', Math.abs(path.origin.lat - 13.736717) < 1e-5, `${path.origin.lat}`);
  check('first point ~origin (E,N ≈ 0)', Math.hypot(path.points[0].e, path.points[0].n) < 1, `${path.points[0].e.toFixed(2)},${path.points[0].n.toFixed(2)}`);
  check('excludes Fix==0 rows', path.points.every((p) => Number.isFinite(p.e) && Number.isFinite(p.n)));
  check('point count < gps row count (dropout excluded)', path.points.length < m.gps.n, `${path.points.length} < ${m.gps.n}`);
  check('has a DISTANCE segment', !!path.distanceSeg, JSON.stringify(path.distanceSeg));
  check('distance seg points are DISTANCE phase', (() => {
    for (let i = path.distanceSeg.start; i <= path.distanceSeg.end; i++) if (path.points[i].phase !== 2) return false;
    return true;
  })());
  check('bounds span > 100m', (path.bounds.maxE - path.bounds.minE) + (path.bounds.maxN - path.bounds.minN) > 100,
    `E:${(path.bounds.maxE - path.bounds.minE).toFixed(0)} N:${(path.bounds.maxN - path.bounds.minN).toFixed(0)}`);

  // cursor sync: time → nearest index monotonic
  const midT = path.points[Math.floor(path.points.length / 2)].tMs;
  check('pointIndexAtTime finds the right index', path.points[pointIndexAtTime(path, midT)].tMs === midT);
  check('time before start → index 0', pointIndexAtTime(path, -1e9) === 0);
  check('time after end → last index', pointIndexAtTime(path, 1e15) === path.points.length - 1);
}

console.log('\n=== no GPS → null path ===');
{
  const files = load(resolve('sample/0007')); files.gps = undefined;
  const m = buildSession(files);
  check('no-gps path is null', buildFlightPath(m, 'blend') === null);
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURES'}`);
process.exit(failures === 0 ? 0 : 1);
