// Min/max-per-pixel decimation for display (design_doc §7 "Downsampling for
// display … so 2D charts stay smooth; full resolution kept for math/export").
//
// For a target pixel width W we bucket samples into W columns over the visible
// X-range and emit, per bucket, the first/min/max/last so spikes are never
// hidden. uPlot itself is fast, but decimating 100 Hz × minutes before handing
// it over keeps pan/zoom buttery and bounds memory.

export interface XY {
  x: Float64Array; // strictly ascending
  y: Float32Array | Float64Array;
}

/**
 * Decimate (x,y) to at most ~4*targetCols points across [minX,maxX].
 * Preserves NaN gaps. Returns plain arrays ready for uPlot.
 */
export function minMaxDecimate(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  n: number,
  minX: number,
  maxX: number,
  targetCols: number,
): { x: number[]; y: (number | null)[] } {
  if (n === 0 || targetCols <= 0) return { x: [], y: [] };
  // find index window [lo, hi) covering [minX, maxX]
  const lo = lowerBound(x, n, minX);
  const hi = upperBound(x, n, maxX);
  const count = hi - lo;
  if (count <= 0) return { x: [], y: [] };

  // if few enough points, pass through untouched
  if (count <= targetCols * 4) {
    const ox: number[] = new Array(count);
    const oy: (number | null)[] = new Array(count);
    for (let i = 0; i < count; i++) {
      ox[i] = x[lo + i];
      const v = y[lo + i];
      oy[i] = Number.isFinite(v) ? v : null;
    }
    return { x: ox, y: oy };
  }

  const span = maxX - minX || 1;
  const bucketW = span / targetCols;
  const ox: number[] = [];
  const oy: (number | null)[] = [];

  let b = 0;
  let bMinIdx = -1, bMaxIdx = -1, bFirstIdx = -1, bLastIdx = -1;
  let bMin = Infinity, bMax = -Infinity;

  const flush = () => {
    if (bFirstIdx < 0) return;
    // emit first, then min & max in x-order, then last — keeps the silhouette
    const pts = [bFirstIdx];
    if (bMinIdx >= 0 && bMinIdx !== bFirstIdx) pts.push(bMinIdx);
    if (bMaxIdx >= 0 && bMaxIdx !== bMinIdx && bMaxIdx !== bFirstIdx) pts.push(bMaxIdx);
    if (bLastIdx >= 0 && !pts.includes(bLastIdx)) pts.push(bLastIdx);
    pts.sort((a, c) => x[a] - x[c]);
    for (const i of pts) {
      ox.push(x[i]);
      const v = y[i];
      oy.push(Number.isFinite(v) ? v : null);
    }
  };

  for (let i = lo; i < hi; i++) {
    const bi = Math.min(targetCols - 1, Math.floor((x[i] - minX) / bucketW));
    if (bi !== b) {
      flush();
      b = bi;
      bMinIdx = bMaxIdx = bFirstIdx = bLastIdx = -1;
      bMin = Infinity; bMax = -Infinity;
    }
    const v = y[i];
    if (bFirstIdx < 0) bFirstIdx = i;
    bLastIdx = i;
    if (Number.isFinite(v)) {
      if (v < bMin) { bMin = v; bMinIdx = i; }
      if (v > bMax) { bMax = v; bMaxIdx = i; }
    }
  }
  flush();
  return { x: ox, y: oy };
}

export function lowerBound(a: ArrayLike<number>, n: number, target: number): number {
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function upperBound(a: ArrayLike<number>, n: number, target: number): number {
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
