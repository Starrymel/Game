import test from 'node:test';
import assert from 'node:assert/strict';
import { newFaceState, extractFaceEvents, toNum } from '../../bridge/faceEvents.js';

const b = (ts, detected) => ({ ts, detected, stable: true });
const m = (arr) => ({ face: { blinking: arr.map((x) => ({ detected: x.detected, stable: true, timestamp: x.ts })) } });

test('one blink = one rising edge, not counted twice across batches', () => {
  const st = newFaceState();
  let ev = extractFaceEvents(m([b(1e6, false), b(2e6, true), b(3e6, true)]), st, 2_500);
  assert.equal(ev.blink.count, 1);
  assert.equal(ev.blink.delayMs, 500);
  ev = extractFaceEvents(m([b(1e6, false), b(2e6, true), b(3e6, true), b(4e6, false)]), st, 5000);
  assert.equal(ev.blink, null);
  ev = extractFaceEvents(m([b(5e6, true)]), st, 5200);
  assert.equal(ev.blink.count, 2);
});

test('handles Long timestamps and expressions', () => {
  assert.equal(toNum({ low: 5, high: 0 }), 5);
  const ev = extractFaceEvents({ face: { blinking: [], talking: [{ detected: true }],
    expression: [{ stable: true, scores: [{ type: 4, score: 80 }, { type: 5, score: 10 }] }] } }, newFaceState());
  assert.equal(ev.talking, true);
  assert.equal(ev.expression.name, 'happy');
});

test('no face metrics -> null', () => assert.equal(extractFaceEvents({}, newFaceState()), null));
