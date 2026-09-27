import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSettings, loadSettings, saveSettings, DEFAULT_SETTINGS, SETTINGS_KEY } from '../../src/face/settings.js';
import { lumaMean, evaluateWarnings } from '../../src/face/warnings.js';

test('sanitizeSettings: defaults for junk, clamps numbers, keeps only known actions', () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings('nope'), DEFAULT_SETTINGS);
  const s = sanitizeSettings({ enabled: false, mode: 'weird', headSens: 50, maxSpeed: -3, map: { smile: 'punch', jawOpen: 'launch-missile', bogus: 'punch' } });
  assert.equal(s.enabled, false);
  assert.equal(s.mode, 'tilt');
  assert.equal(s.headSens, 2);
  assert.equal(s.maxSpeed, 0.2);
  assert.equal(s.map.smile, 'punch');
  assert.equal(sanitizeSettings({ map: { smile: 'punchNear' } }).map.smile, 'punchNear');
  assert.equal(DEFAULT_SETTINGS.map.browsUp, 'special');
  assert.equal(DEFAULT_SETTINGS.map.smile, 'punchNear');
  assert.equal(s.map.jawOpen, 'none');      // unknown action -> default
  assert.equal(s.map.bogus, undefined);
});

test('load/save survive broken storage', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadSettings(broken), DEFAULT_SETTINGS);
  assert.equal(saveSettings(DEFAULT_SETTINGS, broken), false);
  const bad = { getItem: () => '{not json', setItem() {} };
  assert.deepEqual(loadSettings(bad), DEFAULT_SETTINGS);
  assert.deepEqual(loadSettings(null), DEFAULT_SETTINGS);
  void SETTINGS_KEY;
});

test('lumaMean and warnings', () => {
  const px = (v) => new Uint8ClampedArray(32 * 24 * 4).fill(v);
  assert.ok(lumaMean(px(20)) < 25);
  assert.ok(Math.abs(lumaMean(px(200)) - 200) < 1);
  const base = { now: 10_000, lastFaceAt: 9_900, luma: 120, eye: 0.15, fps: 30 };
  assert.deepEqual(evaluateWarnings(base), []);
  assert.equal(evaluateWarnings({ ...base, lastFaceAt: 5_000 })[0].id, 'face');
  assert.equal(evaluateWarnings({ ...base, luma: 30 })[0].id, 'dark');
  assert.equal(evaluateWarnings({ ...base, luma: 240 })[0].id, 'bright');
  assert.equal(evaluateWarnings({ ...base, eye: 0.03 })[0].id, 'far');
  assert.equal(evaluateWarnings({ ...base, eye: 0.4 })[0].id, 'close');
  assert.equal(evaluateWarnings({ ...base, fps: 8 })[0].id, 'fps');
  // no face: only the face message plus lighting, never "move closer"
  assert.ok(!evaluateWarnings({ ...base, lastFaceAt: 0, eye: 0.03 }).some((w) => w.id === 'far'));
});
