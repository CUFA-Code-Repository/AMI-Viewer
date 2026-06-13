// Tests the independent recompute engine against the logged score.csv and
// exercises what-if parameter variations (design_doc §4.3).
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSession } from '../src/model/build.ts';
import { recompute, loggedFinal, DEFAULT_PARAMS, bTakeoff } from '../src/score/recompute.ts';

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

console.log('=== recompute vs logged (sample/0007, not zeroed) ===');
{
  const m = buildSession(load(resolve('sample/0007')));
  const logged = loggedFinal(m);
  const r = recompute(m, DEFAULT_PARAMS);

  console.log(`  logged: dist=${logged.distanceM?.toFixed(2)}m score=${logged.rawScore?.toFixed(1)} P=${logged.pCurrent?.toFixed(4)}`);
  console.log(`  recomp: dist=${r.distanceM.toFixed(2)}m score=${r.rawScore.toFixed(1)} P=${r.pCurrentFinal.toFixed(4)}`);

  // distance: equirectangular recompute should match the generator's accumulation
  // closely (both equirectangular). Allow 2% for float/rounding of logged CSV.
  const distRelErr = Math.abs(r.distanceM - logged.distanceM) / logged.distanceM;
  check('distance within 2% of logged', distRelErr < 0.02, `relErr=${(distRelErr * 100).toFixed(2)}%`);

  // P_current within a small absolute tolerance
  check('P_current within 0.03 of logged', Math.abs(r.pCurrentFinal - logged.pCurrent) < 0.03,
    `Δ=${Math.abs(r.pCurrentFinal - logged.pCurrent).toFixed(4)}`);

  // raw score: dominated by distance², allow 5%
  const scoreRelErr = Math.abs(r.rawScore - logged.rawScore) / logged.rawScore;
  check('raw score within 5% of logged', scoreRelErr < 0.05, `relErr=${(scoreRelErr * 100).toFixed(2)}%`);

  check('B_takeoff = 1.15 at 40 m roll', r.bTakeoff === 1.15);
  check('not zeroed', !r.zeroed);
  check('penalty trace non-empty', r.penaltyTrace.length > 0, `${r.penaltyTrace.length} pts`);
  check('penalty integral monotonic non-decreasing',
    r.penaltyTrace.every((p, i, a) => i === 0 || p.cumIntegral >= a[i - 1].cumIntegral));
  check('distance trace ends at final distance',
    Math.abs(r.distanceTrace.at(-1).distanceM - r.distanceM) < 1e-6);
}

console.log('\n=== what-if variations ===');
{
  const m = buildSession(load(resolve('sample/0007')));
  const base = recompute(m, DEFAULT_PARAMS);

  // heavier payload → higher score (linear in payload)
  const heavy = recompute(m, { ...DEFAULT_PARAMS, payloadKg: 1.2 });
  check('payload 1.2 scales score by ~1.2/1.05', approx(heavy.rawScore / base.rawScore, 1.2 / 1.05, 0.001),
    `ratio=${(heavy.rawScore / base.rawScore).toFixed(4)}`);

  // announced roll ≠ 40 → B_takeoff drops to 1.0 → score × (1/1.15)
  const noBonus = recompute(m, { ...DEFAULT_PARAMS, takeoffAnnouncedM: 60 });
  check('roll≠40 removes 1.15 bonus', approx(noBonus.rawScore / base.rawScore, 1 / 1.15, 0.001),
    `ratio=${(noBonus.rawScore / base.rawScore).toFixed(4)}`);
  check('bTakeoff(60)=1.0', bTakeoff(60) === 1.0);

  // lower penalty threshold (20A) → more excess → bigger penalty → lower score
  const harsh = recompute(m, { ...DEFAULT_PARAMS, penaltyThresholdA: 20 });
  check('lower penalty threshold reduces score', harsh.rawScore < base.rawScore,
    `${harsh.rawScore.toFixed(0)} < ${base.rawScore.toFixed(0)}`);
  check('lower threshold raises P_current', harsh.pCurrentFinal > base.pCurrentFinal);

  // tighter zero current threshold (50A) → our spike hits 55A → zeroed → score 0
  const z = recompute(m, { ...DEFAULT_PARAMS, zeroCurrentA: 50 });
  check('zeroCurrent=50 trips zero (spike=55A)', z.zeroed && z.rawScore === 0);
  check('zero event is overcurrent', z.zero?.kind === 'overcurrent', `${z.zero?.kind} @ ${z.zero?.value?.toFixed(1)}A`);
}

console.log('\n=== degraded (no gps → distance 0, score 0) ===');
{
  const files = load(resolve('sample/0007')); files.gps = undefined;
  const m = buildSession(files);
  const r = recompute(m, DEFAULT_PARAMS);
  check('no GPS → distance 0', r.distanceM === 0);
  check('no GPS → score 0 (distance²=0)', r.rawScore === 0);
  check('penalty still computed from sensors', r.penaltyTrace.length > 0);
}

function approx(a, b, tol) { return Math.abs(a - b) <= tol; }
console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURES'}`);
process.exit(failures === 0 ? 0 : 1);
