// Pure gesture detection from MediaPipe face blendshape scores (0..1 per name).
// Natural blinks last ~100-150 ms, so a "blink" here means eyes closed for holdMs (deliberate).
export const DEFAULTS = {
  blinkHoldMs: 220,   // both eyes closed this long = deliberate blink
  winkHoldMs: 160,    // one eye closed, other open this long = wink
  eyeClosed: 0.55,    // blink score above this = closed
  eyeOpen: 0.30,      // other eye must be below this for a wink
  jawOpen: 0.5,
  smile: 0.6,
  browUp: 0.5,        // brow raise score above this = raised
  browDown: 0.25,     // the other brow must stay below this for a single-brow raise
  browHoldMs: 60,
  cooldownMs: 250,    // minimum gap between the same gesture firing
};

export const GESTURES = ['browLeft', 'browRight', 'blink', 'winkLeft', 'winkRight', 'jawOpen', 'smile'];

export function scoreMap(categories) {
  const m = {};
  for (const c of categories || []) m[c.categoryName] = c.score;
  return m;
}

// Returns update(scores, nowMs) -> array of gesture names that fired this frame (each fires once per hold).
export function createGestureDetector(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const since = {};   // gesture -> time it became true (null when false)
  const fired = {};   // gesture -> already fired in this hold
  const lastFire = {};

  return function update(scores, nowMs) {
    const l = scores.eyeBlinkLeft ?? 0;
    const r = scores.eyeBlinkRight ?? 0;
    const smile = ((scores.mouthSmileLeft ?? 0) + (scores.mouthSmileRight ?? 0)) / 2;
    const bl = scores.browOuterUpLeft ?? 0;
    const br = scores.browOuterUpRight ?? 0;
    const active = {
      browLeft: bl > o.browUp && br < o.browDown,
      browRight: br > o.browUp && bl < o.browDown,
      blink: l > o.eyeClosed && r > o.eyeClosed,
      winkLeft: l > o.eyeClosed && r < o.eyeOpen,
      winkRight: r > o.eyeClosed && l < o.eyeOpen,
      jawOpen: (scores.jawOpen ?? 0) > o.jawOpen,
      smile: smile > o.smile,
    };
    const hold = { browLeft: o.browHoldMs, browRight: o.browHoldMs, blink: o.blinkHoldMs, winkLeft: o.winkHoldMs, winkRight: o.winkHoldMs, jawOpen: 0, smile: 120 };
    const out = [];
    for (const g of GESTURES) {
      if (!active[g]) { since[g] = null; fired[g] = false; continue; }
      if (since[g] == null) since[g] = nowMs;
      if (!fired[g] && nowMs - since[g] >= hold[g]) {
        fired[g] = true; // at most once per hold, even if the cooldown swallows it
        if (nowMs - (lastFire[g] ?? -Infinity) >= o.cooldownMs) { lastFire[g] = nowMs; out.push(g); }
      }
    }
    return out;
  };
}
