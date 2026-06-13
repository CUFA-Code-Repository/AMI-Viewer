// Display formatting helpers.

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalS = Math.round(ms / 1000);
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`;
}

export function fmtClock(ms: number): string {
  // m:ss.d relative timeline label (design_doc §6 "t=01:48.3")
  if (!Number.isFinite(ms)) return '—';
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function num(v: number | null | undefined, dp = 1, unit = ''): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(dp)}${unit ? ' ' + unit : ''}`;
}

export function int(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return String(Math.round(v));
}
