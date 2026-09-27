// Head position/tilt from MediaPipe face landmarks (normalized image coords, y grows downward).
// Landmarks: 1 = nose tip, 33 = subject's right eye outer corner (image left), 263 = subject's left eye
// outer corner (image right). The camera image is NOT mirrored here, so the user's left is image right.
export const DEFAULTS = {
  mode: 'tilt',     // 'tilt' (roll the head, ear to shoulder) or 'lean' (move the head sideways)
  tiltDeg: 10,      // roll beyond this = move
  leanFrac: 0.35,   // sideways head shift, in eye-distances, beyond this = move
  vertFrac: 0.30,   // vertical head shift, in eye-distances: up = jump, down = hide
  hysteresis: 0.7,  // once triggered, stay on until the value falls below threshold * this
};

export function headSample(lm) {
  const nose = lm?.[1], a = lm?.[33], b = lm?.[263];
  if (!nose || !a || !b) return null;
  const dx = b.x - a.x, dy = b.y - a.y;
  const eye = Math.hypot(dx, dy);
  if (!(eye > 1e-6)) return null;
  return {
    rollDeg: (Math.atan2(dy, dx) * 180) / Math.PI, // + = head tilted to the user's left
    x: nose.x / eye,                                // + = head moved to the user's left (image right)
    y: nose.y / eye,                                // + = head lower in the image
  };
}

// Auto-calibrates from the first `calibFrames` samples (or on recenter()), then returns held directions.
export function createHeadController(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  let neutral = null;
  let acc = [];
  const on = { left: false, right: false, up: false, down: false };
  const CALIB = 30;

  function decide(prev, value, threshold) { // hysteresis on |value|
    return prev ? value > threshold * o.hysteresis : value > threshold;
  }

  return {
    options: o,
    recenter() { neutral = null; acc = []; },
    isCalibrated: () => !!neutral,
    update(s) {
      if (!s) { for (const k of Object.keys(on)) on[k] = false; return { ...on, values: null }; }
      if (!neutral) {
        acc.push(s);
        if (acc.length >= CALIB) {
          const m = (k) => acc.reduce((t, v) => t + v[k], 0) / acc.length;
          neutral = { rollDeg: m('rollDeg'), x: m('x'), y: m('y') };
        }
        return { left: false, right: false, up: false, down: false, values: null, calibrating: true };
      }
      const roll = s.rollDeg - neutral.rollDeg;
      const dxv = s.x - neutral.x;
      const dyv = s.y - neutral.y;
      const side = o.mode === 'lean' ? dxv : roll;
      const sideThr = o.mode === 'lean' ? o.leanFrac : o.tiltDeg;
      on.left = decide(on.left, side, sideThr);
      on.right = decide(on.right, -side, sideThr);
      on.up = decide(on.up, -dyv, o.vertFrac);
      on.down = decide(on.down, dyv, o.vertFrac);
      if (on.left && on.right) { on.left = on.right = false; }
      return { ...on, values: { roll, lean: dxv, vert: dyv } };
    },
  };
}
