// Demo-log ingestion (design_doc §2): fetch a bundled sample session over HTTP
// so anyone can try the viewer without their own SD card. Logs live next to the
// app under public/demo/ and deploy with it (e.g. GitHub Pages), so all fetches
// are same-origin and relative — no CORS, works offline once cached.
//
// Layout:
//   demo/flights.json                 ← manifest listing available flights
//   demo/<id>/{sensors,gps,score}.csv
//   demo/<id>/{system,config}.txt
import type { RawFiles } from '../model/types';

/** Base path for demo assets, relative to the app's index.html. */
const DEMO_BASE = 'demo';

/** One entry in demo/flights.json. */
export interface DemoFlight {
  id: string; // folder name, e.g. "flight_10"
  label: string; // human label for the picker, e.g. "Flight 10"
  note?: string; // optional one-line description
}

interface Manifest {
  flights: DemoFlight[];
}

// Filenames fetched per flight. sensors/gps are the core signals; the rest are
// optional and a 404 just means that file wasn't logged (handled gracefully).
const PARTS: { file: string; key: keyof RawFiles; required: boolean }[] = [
  { file: 'sensors.csv', key: 'sensors', required: false },
  { file: 'gps.csv', key: 'gps', required: false },
  { file: 'score.csv', key: 'score', required: false },
  { file: 'system.txt', key: 'system', required: false },
  { file: 'config.txt', key: 'config', required: false },
];

/**
 * The single-file (SINGLE_FILE=1) build runs from a file:// page with no server,
 * so HTTP fetches of demo assets can't work there. Callers use this to hide the
 * demo UI in that context.
 */
export function isDemoAvailable(): boolean {
  return typeof location !== 'undefined' && location.protocol !== 'file:';
}

/** Fetch the list of available demo flights. Throws on network/parse failure. */
export async function fetchDemoManifest(): Promise<DemoFlight[]> {
  const res = await fetch(`${DEMO_BASE}/flights.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`manifest ${res.status} ${res.statusText}`);
  const data = (await res.json()) as Manifest;
  if (!Array.isArray(data.flights)) throw new Error('flights.json: "flights" array missing');
  return data.flights;
}

/**
 * Fetch one demo flight's files into a RawFiles bundle. Missing optional files
 * are skipped; a missing core file (sensors AND gps both absent) throws so the
 * caller can surface a useful error rather than ingesting an empty session.
 */
export async function loadDemoFlight(flight: DemoFlight): Promise<RawFiles> {
  const raw: RawFiles = { sessionName: flight.label || flight.id };

  const results = await Promise.all(
    PARTS.map(async (p) => {
      const url = `${DEMO_BASE}/${flight.id}/${p.file}`;
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) return { key: p.key, text: null };
        return { key: p.key, text: await res.text() };
      } catch {
        return { key: p.key, text: null };
      }
    }),
  );

  for (const r of results) {
    if (r.text != null) (raw as any)[r.key] = r.text;
  }

  if (raw.sensors == null && raw.gps == null) {
    throw new Error(`No data files found for "${flight.id}". Check demo/${flight.id}/.`);
  }
  return raw;
}
