// Generates a synthetic AMIv2 session folder matching design_doc.md §3 schemas.
// Usage: node scripts/gen-sample-session.mjs [outDir] [--truncate] [--wrap]
// Produces sensors.csv, gps.csv, score.csv, system.txt, config.txt.
//
// The flight: IDLE (1 Hz) → CLIMBING → DISTANCE → LANDING (100 Hz in flight).
// Includes a current spike during DISTANCE to exercise the penalty integral,
// realistic GPS path, baro vs GPS altitude divergence, and optional edge cases.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const outDir = resolve(args.find((a) => !a.startsWith('--')) ?? 'sample/0007');
const TRUNCATE = flags.has('--truncate');
const WRAP = flags.has('--wrap'); // start near 32-bit wrap to test stitching

mkdirSync(outDir, { recursive: true });

// ---- timeline plan (boot-relative ms) ----------------------------------
const T0 = WRAP ? 0xffffffff - 8000 : 5000; // ms at first sample
const phases = [
  { name: 'IDLE', dur: 8000, rate: 1 },
  { name: 'CLIMBING', dur: 12000, rate: 100 },
  { name: 'DISTANCE', dur: 40000, rate: 100 },
  { name: 'LANDING', dur: 10000, rate: 100 },
];

// 32-bit clock that wraps, like HAL_GetTick()
const clock = (absMs) => (absMs >>> 0); // emulate uint32 wrap

// ---- helpers -----------------------------------------------------------
const f = (n, dp) => Number(n).toFixed(dp);
const lerp = (a, b, t) => a + (b - a) * t;
const TAKEOFF_LAT = 13.736717; // Bangkok-ish
const TAKEOFF_LON = 100.523186;
const MPERDEG = 111320; // approx meters per degree latitude

// UTC wall-clock anchor for first GPS fix
const utcStart = new Date(Date.UTC(2026, 5, 13, 12, 43, 11, 0));

function fmtUtc(ms) {
  const d = new Date(utcStart.getTime() + ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  const mmm = String(d.getUTCMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${mmm}`;
}

// ---- generate samples --------------------------------------------------
const sensors = [];
const gps = [];
const score = [];
const system = [];

let absMs = T0; // running absolute ms (pre-wrap)
let relMs = 0; // ms since first sample (for physics / UTC)
let altBaro = 0; // m, relative to startup
let altGps = 0;
let distAccum = 0; // scored ground distance (DISTANCE phase only)
let penaltyIntegral = 0; // ∫(I-30) dt seconds·A
let lat = TAKEOFF_LAT;
let lon = TAKEOFF_LON;
let prevValidLat = null;
let prevValidLon = null;
let lastGpsMs = -1e9;
let lastScoreMs = -1e9;
let zeroed = false;
let zeroAtMs = null;

system.push(`boot,tick=${clock(absMs)},sd_init=ok`);

const PHASE_TRANS = [];

for (let p = 0; p < phases.length; p++) {
  const ph = phases[p];
  const stepMs = 1000 / ph.rate;
  const gpsRate = ph.name === 'IDLE' ? 1 : 10; // Hz
  const gpsStepMs = 1000 / gpsRate;
  PHASE_TRANS.push({ name: ph.name, absMs, relMs });
  if (p > 0) system.push(`phase_transition,tick=${clock(absMs)}`);

  const nSteps = Math.round(ph.dur / stepMs);
  for (let i = 0; i < nSteps; i++) {
    const tPhase = i / nSteps; // 0..1 within phase

    // --- physics models per phase ---
    let vAlt = 0; // climb rate m/s
    let speedKmh = 0;
    let current = 1.2; // idle current
    let headingDeg = 90;
    if (ph.name === 'CLIMBING') {
      vAlt = lerp(4, 8, tPhase);
      speedKmh = lerp(15, 55, tPhase);
      current = lerp(35, 48, tPhase); // above 30A → penalty accrues
    } else if (ph.name === 'DISTANCE') {
      vAlt = Math.sin(tPhase * Math.PI * 2) * 1.5;
      speedKmh = lerp(60, 72, Math.min(1, tPhase * 2));
      current = 28 + 8 * Math.max(0, Math.sin(tPhase * Math.PI * 3)); // oscillates around threshold
      if (tPhase > 0.45 && tPhase < 0.55) current = 55; // a sustained spike
      headingDeg = 90 + 20 * Math.sin(tPhase * Math.PI);
    } else if (ph.name === 'LANDING') {
      vAlt = lerp(-3, -6, tPhase);
      speedKmh = lerp(50, 0, tPhase);
      current = lerp(20, 2, tPhase);
    }

    const dtS = stepMs / 1000;
    altBaro += vAlt * dtS;
    altGps += vAlt * dtS + (Math.random() - 0.5) * 0.15; // GPS noisier → baro/GPS residual
    if (altBaro < 0) altBaro = 0;

    // accel/gyro: gravity-normalized, small dynamics
    const ax = (Math.random() - 0.5) * 0.6;
    const ay = (Math.random() - 0.5) * 0.6;
    const az = 9.81 + (vAlt !== 0 ? vAlt * 0.05 : 0) + (Math.random() - 0.5) * 0.3;
    const gx = (Math.random() - 0.5) * 0.05;
    const gy = (Math.random() - 0.5) * 0.05;
    const gz = ((headingDeg - 90) / 180) * 0.2 + (Math.random() - 0.5) * 0.02;

    const voltage = 12.6 - relMs / 1e6 - current * 0.004; // sag with load, slow drain
    const pressure = 101325 - altBaro * 12.0; // ~12 Pa/m near sea level
    const temperature = 28 - altBaro * 0.0065;

    // zero conditions (design_doc §4.3): V>12.75 or I>70
    if (!zeroed && (voltage > 12.75 || current > 70)) {
      zeroed = true;
      zeroAtMs = absMs;
    }

    sensors.push(
      [
        clock(absMs),
        f(ax, 2), f(ay, 2), f(az, 2),
        f(gx, 3), f(gy, 3), f(gz, 3),
        f(voltage, 3),
        f(current, 2),
        f(pressure, 1),
        f(temperature, 2),
        f(altBaro, 1),
        ph.name,
      ].join(','),
    );

    // penalty integral runs once phase leaves IDLE
    if (ph.name !== 'IDLE' && current > 30) {
      penaltyIntegral += (current - 30) * dtS;
    }

    // --- GPS rows when a "new fix" arrives ---
    if (absMs - lastGpsMs >= gpsStepMs - 1e-6) {
      lastGpsMs = absMs;
      const hasFix = !(ph.name === 'DISTANCE' && tPhase > 0.7 && tPhase < 0.73); // brief dropout
      // advance position along heading by ground distance
      const groundMps = speedKmh / 3.6;
      const stepDist = groundMps * gpsStepMs / 1000;
      const hdgRad = (headingDeg * Math.PI) / 180;
      const dLat = (stepDist * Math.cos(hdgRad)) / MPERDEG;
      const dLon = (stepDist * Math.sin(hdgRad)) / (MPERDEG * Math.cos((lat * Math.PI) / 180));
      lat += dLat;
      lon += dLon;

      if (hasFix) {
        // accumulate scored distance during DISTANCE phase (equirectangular)
        if (ph.name === 'DISTANCE' && prevValidLat != null) {
          const x = ((lon - prevValidLon) * Math.PI / 180) * Math.cos((lat * Math.PI) / 180) * 6371000;
          const y = ((lat - prevValidLat) * Math.PI / 180) * 6371000;
          distAccum += Math.hypot(x, y);
        }
        prevValidLat = lat;
        prevValidLon = lon;
      }

      const latSide = hasFix ? (lat >= 0 ? 'N' : 'S') : '-';
      const lonSide = hasFix ? (lon >= 0 ? 'E' : 'W') : '-';
      gps.push(
        [
          clock(absMs),
          fmtUtc(relMs),
          f(Math.abs(lat), 6), latSide,
          f(Math.abs(lon), 6), lonSide,
          f(altGps, 1),
          f(speedKmh, 1),
          f(hasFix ? 0.8 + Math.random() * 0.4 : 9.9, 1), // HDOP
          f(headingDeg, 1),
          hasFix ? 9 + Math.floor(Math.random() * 3) : 2,
          hasFix ? 1 : 0,
        ].join(','),
      );
    }

    // --- score rows at 1 Hz ---
    if (absMs - lastScoreMs >= 1000 - 1e-6) {
      lastScoreMs = absMs;
      const pCurrent = Math.min(1.0, 0.002 * penaltyIntegral);
      const bTakeoff = 1.15; // announced roll 40 m
      const mPayload = 1.05;
      const lDist = distAccum;
      let raw = bTakeoff * mPayload * lDist * lDist * (1 - pCurrent);
      if (zeroed) raw = 0;
      score.push(
        [
          clock(absMs),
          ph.name,
          f(distAccum, 2),
          f(pCurrent, 4),
          f(raw, 3),
          zeroed ? 1 : 0,
        ].join(','),
      );
    }

    absMs += stepMs;
    relMs += stepMs;
  }
}

// extra immediate score row at the instant of zero (design_doc §3.3)
if (zeroed && zeroAtMs != null) {
  score.push([clock(zeroAtMs), 'DISTANCE', f(distAccum, 2), f(0, 4), f(0, 3), 1].join(','));
}

// ---- write files -------------------------------------------------------
const SENSORS_HDR =
  'Time (ms),ax_m_s2,ay_m_s2,az_m_s2,gx_rad_s,gy_rad_s,gz_rad_s,Voltage (V),Current (A),Pressure (Pa),Temperature (C),Altitude (m),FlightPhase';
const GPS_HDR =
  'Time (ms),Time (HH:MM:SS.mmm),Latitude (deg),lat_side,Longitude (deg),lon_side,Altitude (m),Speed (km/h),HDOP,Course (deg),Satellites,Fix';
const SCORE_HDR = 'Timestamp (ms),Phase,Distance (m),P_current,RawScore,ZeroFlag';

let sensorsCsv = SENSORS_HDR + '\n' + sensors.join('\n') + '\n';
let gpsCsv = GPS_HDR + '\n' + gps.join('\n') + '\n';
let scoreCsv = SCORE_HDR + '\n' + score.join('\n') + '\n';

if (TRUNCATE) {
  // chop the final sensors row mid-write to test truncated-tail handling
  sensorsCsv = sensorsCsv.replace(/\n[^\n]*\n$/, '\n' + sensors.at(-1).slice(0, 20));
}

writeFileSync(resolve(outDir, 'sensors.csv'), sensorsCsv);
writeFileSync(resolve(outDir, 'gps.csv'), gpsCsv);
writeFileSync(resolve(outDir, 'score.csv'), scoreCsv);
writeFileSync(resolve(outDir, 'system.txt'), system.join('\n') + '\n');
writeFileSync(resolve(outDir, 'config.txt'), 'payload_kg=1.05\ntakeoff_announced_m=40\n');

console.log(`Wrote session to ${outDir}`);
console.log(`  sensors: ${sensors.length} rows  gps: ${gps.length}  score: ${score.length}`);
console.log(`  scored distance ≈ ${distAccum.toFixed(1)} m  zeroed=${zeroed}`);
