import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allFallbackTexts, clipName, pregenerate } from '../../tools/pregen-lines.js';

const require = createRequire(import.meta.url);
const express = require('express');
const el = require('../../server/ai/elevenlabs.js');
const { createAiRouter, createRateLimiter } = require('../../server/routes/ai.js');

const tmp = () => mkdtempSync(join(tmpdir(), 'composure-tts-'));
const audioRes = (chunks) => ({
  ok: true, status: 200,
  body: (async function* () { for (const c of chunks) yield new Uint8Array(Buffer.from(c)); })(),
  arrayBuffer: async () => new Uint8Array(Buffer.from(chunks.join(''))).buffer,
});

test('ttsStream sends the documented request', async () => {
  let call;
  await el.ttsStream('Fight!', { apiKey: 'xk', fetchImpl: async (url, init) => { call = { url, init }; return audioRes(['a']); } });
  assert.equal(call.url, `https://api.elevenlabs.io/v1/text-to-speech/${el.DEFAULT_VOICE}/stream?output_format=mp3_44100_128`);
  assert.equal(call.init.headers['xi-api-key'], 'xk');
  const body = JSON.parse(call.init.body);
  assert.equal(body.text, 'Fight!');
  assert.equal(body.model_id, 'eleven_flash_v2_5');
  assert.ok(body.voice_settings.stability > 0);
});

test('ttsStream errors: no key 503, HTTP error 502, timeout 504', async () => {
  await assert.rejects(el.ttsStream('x', { apiKey: '' }), { status: 503 });
  await assert.rejects(el.ttsStream('x', { apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'bad key' }) }), { status: 502 });
  await assert.rejects(el.ttsStream('x', {
    apiKey: 'k', timeoutMs: 20,
    fetchImpl: (u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => { const e = new Error('a'); e.name = 'AbortError'; rej(e); })),
  }), { status: 504 });
});

test('cache key depends on voice, model and text', () => {
  assert.notEqual(el.cacheKey('a', 'v1', 'm'), el.cacheKey('a', 'v2', 'm'));
  assert.notEqual(el.cacheKey('a', 'v', 'm1'), el.cacheKey('a', 'v', 'm2'));
  assert.equal(el.cacheKey('a', 'v', 'm'), el.cacheKey('a', 'v', 'm'));
});

async function withServer(router, fn) {
  const app = express();
  app.use('/api/ai', router);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/ai`;
  try { await fn((q) => fetch(`${base}/tts?${q}`)); } finally { server.close(); }
}

test('GET /tts streams on miss, caches, serves hit without calling upstream', async () => {
  const dir = tmp();
  let calls = 0;
  const router = createAiRouter({
    ttsCache: el.createTtsCache(dir),
    ttsStream: async () => { calls++; return audioRes(['ID3', 'chunk1', 'chunk2']); },
  });
  await withServer(router, async (get) => {
    const r1 = await get('text=' + encodeURIComponent('K.O.!'));
    assert.equal(r1.status, 200);
    assert.equal(r1.headers.get('content-type'), 'audio/mpeg');
    assert.equal(r1.headers.get('x-tts-cache'), 'miss');
    assert.equal(await r1.text(), 'ID3chunk1chunk2');
    const r2 = await get('text=' + encodeURIComponent('K.O.!'));
    assert.equal(r2.headers.get('x-tts-cache'), 'hit');
    assert.equal(await r2.text(), 'ID3chunk1chunk2');
    assert.equal(calls, 1);
  });
  rmSync(dir, { recursive: true });
});

test('GET /tts validation, upstream error passthrough, rate limit', async () => {
  const dir = tmp();
  const failing = createAiRouter({
    ttsCache: el.createTtsCache(dir),
    ttsStream: async () => { throw new el.TtsError('ELEVENLABS_API_KEY not set', 503); },
  });
  await withServer(failing, async (get) => {
    assert.equal((await get('')).status, 400);
    assert.equal((await get('text=' + 'x'.repeat(201))).status, 400);
    assert.equal((await get('text=hi')).status, 503);
  });
  const limited = createAiRouter({
    ttsCache: el.createTtsCache(dir),
    ttsStream: async () => audioRes(['a']),
    ttsLimit: createRateLimiter({ max: 2, windowMs: 60000 }),
  });
  await withServer(limited, async (get) => {
    assert.equal((await get('text=one')).status, 200);
    assert.equal((await get('text=two')).status, 200);
    assert.equal((await get('text=three')).status, 429);
    assert.equal((await get('text=one')).status, 200, 'cache hits are not rate limited');
  });
  rmSync(dir, { recursive: true });
});

test('rate limiter window resets', () => {
  const clock = { t: 0 };
  const allow = createRateLimiter({ max: 1, windowMs: 1000, now: () => clock.t });
  assert.equal(allow('ip'), true);
  assert.equal(allow('ip'), false);
  assert.equal(allow('other'), true);
  clock.t = 1000;
  assert.equal(allow('ip'), true);
});

test('pregen covers every fallback text for both players and writes a manifest', async () => {
  const texts = allFallbackTexts();
  assert.ok(texts.includes('K.O.! Player One takes it!'));
  assert.ok(texts.includes('K.O.! Player Two takes it!'));
  assert.ok(texts.includes('Round 3! Breathe in, and fight!'));
  assert.ok(texts.every((t) => !/[{}]/.test(t)));

  const dir = tmp();
  let calls = 0;
  const r = await pregenerate({ outDir: dir, log: () => {}, ttsBuffer: async (t) => { calls++; return Buffer.from(`mp3:${t}`); } });
  assert.deepEqual(r, { total: texts.length, made: texts.length, failed: 0 });
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.model, 'eleven_flash_v2_5');
  const ko = 'K.O.! Player One takes it!';
  assert.equal(manifest.lines[ko], clipName(ko));
  assert.equal(readFileSync(join(dir, clipName(ko)), 'utf8'), `mp3:${ko}`);

  const again = await pregenerate({ outDir: dir, log: () => {}, ttsBuffer: async () => { calls++; return Buffer.from('x'); } });
  assert.equal(again.made, 0, 'existing clips skipped');
  assert.equal(calls, texts.length);
  rmSync(dir, { recursive: true });
});

test('pregen stops early without a key and keeps what exists', async () => {
  const dir = tmp();
  const r = await pregenerate({ outDir: dir, log: () => {}, ttsBuffer: async () => { throw new el.TtsError('no key', 503); } });
  assert.equal(r.failed, 1);
  assert.equal(r.total, 0);
  assert.ok(existsSync(join(dir, 'manifest.json')));
  rmSync(dir, { recursive: true });
});
