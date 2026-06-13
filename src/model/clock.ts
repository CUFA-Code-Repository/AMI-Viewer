// 32-bit HAL_GetTick() wrap handling (design_doc §3.6, §8).
// HAL_GetTick() is a uint32 ms counter that wraps at 2^32 (~49.7 days).
// We stitch a monotonic Float64 timeline by adding 2^32 each time the raw
// value decreases by more than a small tolerance.

export const TWO_POW_32 = 4294967296;

/**
 * Stitch a sequence of raw uint32 tick values into a monotonic ms timeline.
 * Returns the stitched values plus how many wraps were applied.
 *
 * A small backward jitter (e.g. out-of-order writes) is NOT treated as a wrap;
 * only a large decrease (more than half the range) counts.
 */
export function stitchClock(raw: ArrayLike<number>): { t: Float64Array; wraps: number } {
  const n = raw.length;
  const t = new Float64Array(n);
  let offset = 0;
  let wraps = 0;
  let prev = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = raw[i] >>> 0; // ensure uint32 interpretation
    if (i > 0 && v + offset < prev) {
      // decrease — wrap if the drop is large (close to full range)
      const drop = prev - (v + offset);
      if (drop > TWO_POW_32 / 2) {
        offset += TWO_POW_32;
        wraps++;
      }
    }
    const stitched = v + offset;
    t[i] = stitched;
    prev = stitched;
  }
  return { t, wraps };
}

/** Apply a known cumulative offset to a single raw tick (best-effort, for events). */
export function stitchSingle(rawTick: number, refRaw: number, refStitched: number): number {
  // place rawTick on the same wrap-epoch as a nearby reference sample
  let v = (rawTick >>> 0) + (refStitched - (refRaw >>> 0));
  // nudge by whole wraps to land closest to the reference
  while (v - refStitched > TWO_POW_32 / 2) v -= TWO_POW_32;
  while (refStitched - v > TWO_POW_32 / 2) v += TWO_POW_32;
  return v;
}
