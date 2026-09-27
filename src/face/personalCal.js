// Turns "how your face looks at rest" and "how far you can push it" into a trigger threshold that fits YOU.
// Fixed thresholds fail across people (a small smile, a lazy eyebrow, glasses...), so we measure instead.

// Score of a gesture from a MediaPipe blendshape score map.
export const KINDS = {
  brows: (s) => Math.max(s.browOuterUpLeft ?? 0, s.browOuterUpRight ?? 0, s.browInnerUp ?? 0),
  smile: (s) => ((s.mouthSmileLeft ?? 0) + (s.mouthSmileRight ?? 0)) / 2,
};

// Threshold sits part of the way from rest to your peak, so it is clearly above rest noise yet reachable.
// Returns null when the movement was too small to separate from rest (ask the person to try bigger).
export function thresholdFrom(baseline, peak, { fraction = 0.5, minRange = 0.12, floor = 0.1, ceil = 0.85 } = {}) {
  if (!Number.isFinite(baseline) || !Number.isFinite(peak)) return null;
  const range = peak - baseline;
  if (!(range >= minRange)) return null;
  return Math.max(floor, Math.min(ceil, baseline + fraction * range));
}

// The peak of a series, ignoring one-frame spikes (moving average over `win` frames).
export function robustPeak(values, win = 4) {
  if (values.length < win) return values.length ? Math.max(...values) : null;
  let best = -Infinity;
  for (let i = 0; i + win <= values.length; i++) {
    let sum = 0;
    for (let j = 0; j < win; j++) sum += values[i + j];
    best = Math.max(best, sum / win);
  }
  return best;
}

export const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
