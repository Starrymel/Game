import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { percentile, fixtureMoments, report } from '../../tools/latency-test.js';
import { createGeminiLineSource } from '../../src/commentary/aiClient.js';
import { createElevenLabsPlayer } from '../../src/commentary/elevenLabsPlayer.js';

const require = createRequire(import.meta.url);
const express = require('express');
const gemini = require('../../server/ai/gemini.js');
const elevenlabs = require('../../server/ai/elevenlabs.js');
const { createAiRouter } = require('../../server/routes/ai.js');

test('percentile', () => {
  const xs = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
  assert.equal(percentile(xs, 50), 500);
  assert.equal(percentile(xs, 95), 1000);
  assert.equal(percentile([7], 95), 7);
  assert.equal(percentile([], 50), null);
});

test('latency report flags lines over budget and failures', () => {
  const r = report([
    { lineOk: true, ttsOk: true, lineMs: 600, ttsFirstMs: 150, cacheHitMs: 5, eventToAudioMs: 750 },
    { lineOk: true, ttsOk: true, lineMs: 1400, ttsFirstMs: 400, cacheHitMs: 5, eventToAudioMs: 1800 },
    { lineOk: false, lineMs: 2500 },
  ], () => {});
  assert.deepEqual(r, { p50: 750, p95: 1800, over: 1, failed: 1 });
});

test('fixture moments exclude hit chatter', () => {
  const ms = fixtureMoments();
  assert.ok(ms.length >= 15);
  assert.ok(!ms.some((m) => m.type === 'hit'));
});

test('warm helpers hit free endpoints only, and no-op without keys', async () => {
  const urls = [];
  const fetchImpl = async (u, init) => { urls.push([u, init?.method ?? 'GET', init?.body]); return { ok: true }; };
  assert.equal(await gemini.warm({ apiKey: 'k', fetchImpl }), true);
  assert.equal(await elevenlabs.warm({ apiKey: 'k', fetchImpl }), true);
  assert.deepEqual(urls.map(([u, m, b]) => [m, b]), [['GET', undefined], ['GET', undefined]], 'GETs, no generation');
  assert.match(urls[0][0], /models\/gemini-3\.5-flash-lite$/);
  assert.equal(urls[1][0], 'https://api.elevenlabs.io/v1/models');
  assert.equal(await gemini.warm({ apiKey: '', fetchImpl }), false);
  assert.equal(await elevenlabs.warm({ apiKey: '', fetchImpl }), false);
});

test('POST /api/ai/warm runs both warmers, tolerates failure, throttles', async () => {
  let calls = 0;
  const router = createAiRouter({ warmers: {
    gemini: async () => { calls++; return true; },
    tts: async () => { calls++; throw new Error('down'); },
  } });
  const app = express();
  app.use('/api/ai', router);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const post = () => fetch(`http://127.0.0.1:${server.address().port}/api/ai/warm`, { method: 'POST' }).then((r) => r.json());
  try {
    const first = await post();
    assert.equal(first.gemini, true);
    assert.equal(first.tts, false);
    assert.deepEqual(await post(), { skipped: true });
    assert.equal(calls, 2);
  } finally {
    server.close();
  }
});

test('line source: round_start uses the pre-generated line; warm() posts to /warm', async () => {
  const urls = [];
  const src = createGeminiLineSource({ fetchImpl: async (u) => { urls.push(u); return { ok: true, status: 200, json: async () => ({ text: 'x' }) }; } });
  assert.equal(await src.getLine({ type: 'round_start', t: 0 }), null);
  src.warm();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(urls, ['/api/ai/warm']);
});

test('player records event -> audio-playing latency per source', async () => {
  const clock = { t: 1000 };
  const audios = [];
  const p = createElevenLabsPlayer({
    manifest: { lines: { 'K.O.!': 'ko.mp3' } },
    fallback: { play: async () => {}, stop() {} },
    now: () => clock.t,
    createAudio: () => { const a = { play: async () => {}, pause() {} }; audios.push(a); return a; },
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));

  const d1 = p.play('K.O.!', { type: 'ko', t: 950 });
  await tick();
  audios[0].onplaying();
  audios[0].onended();
  await d1;
  clock.t = 5000;
  const d2 = p.play('Fresh line', { type: 'special', t: 4200 });
  await tick();
  audios[1].onplaying();
  audios[1].onended();
  await d2;

  const r = p.latencyReport();
  assert.deepEqual(r.preline, { n: 1, p50: 50, p95: 50, max: 50 });
  assert.deepEqual(r.tts, { n: 1, p50: 800, p95: 800, max: 800 });
  assert.equal(r.recent.length, 2);
});
