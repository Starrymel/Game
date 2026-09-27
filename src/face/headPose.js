// Head position/tilt from MediaPipe face landmarks (normalized image coords, y grows downward).
// Landmarks: 1 = nose tip, 33 = subject's right eye outer corner (image left), 263 = subject's left eye
// outer corner (image right). The camera image is NOT mirrored here, so the user's left is image right.
export const DEFAULTS = {
  mode: 'tilt',     // 'tilt' (roll the head, ear to shoulder) or 'lean' (move the head sideways)
  tiltDeg: 10,      // roll beyond this = move
  leanFrac: 0.35,   // sideways head shift, in eye-distances, beyond this = move
  vertFrac: 0.30,   // vertical head shift, in eye-distances: up = jump, down = hide
  hysteresis: 0.7,  // once triggered, stay on until the value falls below threshold * this
  smooth: 1,        // 1 = raw; lower (e.g. 0.4) smooths camera jitter but adds a little lag
  drift: 0,         // 0 = fixed neutral; e.g. 0.01 lets the neutral follow slow shifts (only while nothing is triggered)
  minSpeed: 0.25,   // walking speed (0..1) right when the tilt crosses the threshold; grows to 1 at 2x the threshold
};

export function headSample(lm) {
  const nose = lm?.[1], a = lm?.[33], b = lm?.[263];
  if (!nose || !a || !b) return null;
  const dx = b.x - a.x, dy = b.y - a.y;
  const eye = Math.hypot(dx, dy);
  if (!(eye > 1e-6)) return null;
  return {
    eye,                                            // distance between the eyes (fraction of image width): how close you sit
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
  let sm = null; // smoothed sample
  const on = { left: false, right: false, up: false, down: false };
  const CALIB = 30;

  function decide(prev, value, threshold) { // hysteresis on |value|
    return prev ? value > threshold * o.hysteresis : value > threshold;
  }

  return {
    options: o,
    recenter() { neutral = null; acc = []; sm = null; },
    isCalibrated: () => !!neutral,
    update(raw) {
      let s = raw;
      if (!s) { for (const k of Object.keys(on)) on[k] = false; sm = null; return { ...on, values: null, speed: 0 }; }
      const a = o.smooth;
      sm = sm && a < 1 ? { rollDeg: sm.rollDeg + a * (s.rollDeg - sm.rollDeg), x: sm.x + a * (s.x - sm.x), y: sm.y + a * (s.y - sm.y) } : { ...s };
      s = sm;
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
      // A deliberate up/down tilt often carries a little incidental roll too (few people move on a
      // perfectly pure axis) -- vertical wins so a jump attempt can't also nudge you sideways.
      if ((on.up || on.down) && (on.left || on.right)) { on.left = on.right = false; }
      // Slow drift: while no direction is active the neutral creeps toward where you are resting, so leaning
      // back in your chair never walks the fighter; only quick, deliberate moves cross the thresholds.
      if (o.drift > 0 && !on.left && !on.right && !on.up && !on.down) {
        neutral.rollDeg += o.drift * roll; neutral.x += o.drift * dxv; neutral.y += o.drift * dyv;
      }
      // Analog-ish speed for sideways movement: crosses threshold slowly, reaches full speed at 2x threshold.
      const speed = (on.left || on.right) ? Math.min(1, o.minSpeed + (1 - o.minSpeed) * (Math.abs(side) - sideThr) / sideThr) : 0;
      return { ...on, speed: Math.max(0, speed), values: { roll, lean: dxv, vert: dyv } };
    },
  };
}
