// Pure helpers: turn SDK face metrics into small events for the game (blink lab).
// Kept free of SDK imports so it can be unit-tested without the native module.
const EXPRESSIONS = { 1: 'angry', 2: 'disgust', 3: 'fear', 4: 'happy', 5: 'neutral', 6: 'sad', 7: 'surprise', 8: 'surprise' };
export const EXPRESSION_NAMES = ['angry', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise'];

// Timestamps may arrive as numbers, numeric strings or protobuf Long ({low, high}).
export function toNum(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v);
  if (typeof v === 'object' && 'low' in v) return (v.high >>> 0) * 4294967296 + (v.low >>> 0);
  if (typeof v.toNumber === 'function') return v.toNumber();
  return NaN;
}

export function newFaceState() {
  return { lastBlinkTs: -Infinity, wasBlinking: false, blinkCount: 0 };
}

// A blink is a rising edge (not-detected -> detected) over samples newer than the last one seen.
// delayMs = how old the sample already was when the bridge saw it (SDK processing lag).
export function extractFaceEvents(metrics, state, nowMs = Date.now()) {
  const face = metrics?.face;
  if (!face) return null;
  let blink = null;

  const samples = (face.blinking || [])
    .map((b) => ({ detected: !!b.detected, stable: !!b.stable, ts: toNum(b.timestamp) }))
    .filter((b) => Number.isFinite(b.ts) && b.ts > state.lastBlinkTs)
    .sort((a, b) => a.ts - b.ts);
  for (const s of samples) {
    if (s.detected && !state.wasBlinking) {
      state.blinkCount += 1;
      blink = { count: state.blinkCount, delayMs: Math.max(0, Math.round(nowMs - s.ts / 1000)), stable: s.stable };
    }
    state.wasBlinking = s.detected;
    state.lastBlinkTs = s.ts;
  }

  const talkingLast = (face.talking || []).at(-1);
  let expression = null;
  const ex = (face.expression || []).at(-1);
  if (ex?.scores?.length) {
    const top = ex.scores.reduce((a, b) => (b.score > a.score ? b : a));
    expression = { name: EXPRESSIONS[top.type] || String(top.type), score: Math.round(top.score), stable: !!ex.stable };
  }
  return { blink, talking: talkingLast ? !!talkingLast.detected : null, expression };
}
