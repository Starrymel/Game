import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElevenLabsPlayer } from '../../src/commentary/elevenLabsPlayer.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

// Fake <audio>: records src; test drives ended/error.
function fakeAudioFactory({ blockAutoplay = false } = {}) {
  const made = [];
  const create = () => {
    const a = { src: '', paused: false, onended: null, onerror: null,
      play() { return blockAutoplay ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve(); },
      pause() { this.paused = true; } };
    made.push(a);
    return a;
  };
  return { made, create };
}
const fakeFallback = () => {
  const spoken = [];
  return { spoken, play: async (t) => { spoken.push(t); }, stop() {} };
};

test('plays a pre-generated clip when the text is in the manifest', async () => {
  const audio = fakeAudioFactory();
  const p = createElevenLabsPlayer({ manifest: { lines: { 'K.O.!': 'abc.mp3' } }, createAudio: audio.create, fallback: fakeFallback() });
  const done = p.play('K.O.!');
  await tick();
  assert.equal(audio.made[0].src, '/assets/audio/prelines/abc.mp3');
  audio.made[0].onended();
  await done;
  assert.equal(p.stats.preline, 1);
});

test('uses the TTS proxy for new text', async () => {
  const audio = fakeAudioFactory();
  const p = createElevenLabsPlayer({ manifest: { lines: {} }, createAudio: audio.create, fallback: fakeFallback() });
  const done = p.play('Ice cold & calm!');
  await tick();
  assert.equal(audio.made[0].src, '/api/ai/tts?text=Ice%20cold%20%26%20calm!');
  audio.made[0].onended();
  await done;
  assert.equal(p.stats.tts, 1);
});

test('TTS error falls back to speech synthesis and backs off', async () => {
  const audio = fakeAudioFactory();
  const fb = fakeFallback();
  const clock = { t: 0 };
  const p = createElevenLabsPlayer({ manifest: { lines: {} }, createAudio: audio.create, fallback: fb, now: () => clock.t, backoffMs: 1000 });
  const d1 = p.play('one');
  await tick();
  audio.made[0].onerror();
  await d1;
  assert.deepEqual(fb.spoken, ['one']);
  await p.play('two');
  assert.equal(audio.made.length, 1, 'no TTS attempt during backoff');
  assert.deepEqual(fb.spoken, ['one', 'two']);
  clock.t = 2000;
  p.play('three');
  await tick();
  assert.equal(audio.made.length, 2, 'retries after backoff');
});

test('stop() cuts the current clip', async () => {
  const audio = fakeAudioFactory();
  const p = createElevenLabsPlayer({ manifest: { lines: {} }, createAudio: audio.create, fallback: fakeFallback() });
  const done = p.play('long line');
  await tick();
  p.stop();
  await done;
  assert.equal(audio.made[0].paused, true);
});

test('autoplay-blocked clip resolves without falling back to another voice', async () => {
  const audio = fakeAudioFactory({ blockAutoplay: true });
  const fb = fakeFallback();
  const p = createElevenLabsPlayer({ manifest: { lines: {} }, createAudio: audio.create, fallback: fb });
  await p.play('Fight!');
  assert.deepEqual(fb.spoken, []);
});

test('loads manifest.json when none is passed', async () => {
  const audio = fakeAudioFactory();
  const p = createElevenLabsPlayer({
    createAudio: audio.create, fallback: fakeFallback(),
    fetchImpl: async (url) => ({ ok: url.endsWith('/assets/audio/prelines/manifest.json'), json: async () => ({ lines: { Hi: 'h.mp3' } }) }),
  });
  await p.ready;
  p.play('Hi');
  await tick();
  assert.equal(audio.made[0].src, '/assets/audio/prelines/h.mp3');
});
