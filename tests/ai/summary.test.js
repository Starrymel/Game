import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { bus } from '../../src/eventBus.js';
import { createMatchRecorder } from '../../src/commentary/matchRecorder.js';
import { startCommentaryListener } from '../../src/commentary/listener.js';
import { replayMatchSync } from '../../tools/replay-match.js';

const require = createRequire(import.meta.url);
const express = require('express');
const { compactMatch, templateSummary } = require('../../server/ai/summarize.js');
const gemini = require('../../server/ai/gemini.js');
const { createAiRouter } = require('../../server/routes/ai.js');

// Record the scripted fake match exactly the way the game would.
function recordFixture() {
  const fixture = JSON.parse(readFileSync(new URL('../../fixtures/fake-match.json', import.meta.url)));
  const rec = createMatchRecorder();
  const offs = rec.events.map((type) => bus.on(type, (p) => rec.handle(type, p)));
  const l = startCommentaryListener({ bus, onMoment: rec.onMoment });
  replayMatchSync(bus, fixture);
  offs.forEach((off) => off());
  l.stop();
  return rec.detail();
}

test('recorder produces the match-detail shape with victim-labelled events', () => {
  const d = recordFixture();
  assert.equal(d.match.winner, 2);
  assert.equal(d.match.duration_ms, 37000);
  assert.ok(d.snapshots.length > 100);
  assert.ok(d.samples.length >= 140 && d.samples.length <= 160, 'samples throttled to ~2/s/player');
  assert.deepEqual(d.snapshots.at(-1), { ...d.snapshots.at(-1), p1_hp: 0 }, 'final KO point');
  const ko = d.events.find((e) => e.type === 'ko');
  assert.deepEqual([ko.player, ko.payload.winner], [1, 2]);
  const types = new Set(d.events.map((e) => e.type));
  for (const t of ['hit', 'big_hit', 'flinch', 'special', 'meter_full', 'comeback', 'panic_spike', 'calm_clutch', 'heal_streak']) {
    assert.ok(types.has(t), `missing ${t}`);
  }
});

test('compactMatch captures composure story and stays small', () => {
  const c = compactMatch(recordFixture());
  assert.equal(c.winner, 2);
  assert.deepEqual(c.finalHp, { 1: 0, 2: 41 }); // 25 HP + 13s of healing at 1.2/s
  assert.equal(c.comeback.player, 2);
  assert.equal(c.comeback.wasBehindBy, 75);
  assert.ok(c.players[1].hrPeak >= 120, 'P1 panicked late');
  assert.ok(c.players[2].calmAvg > c.players[1].calmAvg, 'P2 calmer overall');
  assert.equal(c.players[2].specials, 1);
  assert.equal(c.players[1].hitsLanded, 6);
  assert.equal(c.players[2].hitsLanded, 7);
  assert.ok(c.hpCurve.length <= 18);
  const ko = c.keyEvents.find((e) => e.type === 'ko');
  assert.deepEqual([ko.loser, ko.winner], [1, 2]);
  assert.ok(JSON.stringify(c).length < 4000, `compact log is ${JSON.stringify(c).length} chars`);
});

test('compactMatch copes with D-style rows and empty input', () => {
  const c = compactMatch({
    match: { winner: 1, duration_ms: 5000, p1_name: 'Mary', p2_name: 'Rival' },
    samples: [{ t: 0, player: 1, hr: 80, breath: 12, stress: 0.2, calm: 0.8 }],
    events: [{ t: 100, type: 'flinch', player: 2, payload: { stress: 0.4 } }],
    snapshots: [{ t: 0, p1_hp: 100, p2_hp: 100 }, { t: 5000, p1_hp: 90, p2_hp: 0 }],
  });
  assert.equal(c.names[1], 'Mary');
  assert.equal(c.players[2].hrAvg, undefined, 'no samples for P2 is fine');
  assert.ok(templateSummary(compactMatch({})).headline);
});

test('templateSummary names the comeback as turning point', () => {
  const s = templateSummary(compactMatch(recordFixture()));
  assert.equal(s.headline, 'Player Two wins with a comeback!');
  assert.match(s.turningPoint, /Player Two erased a 75 HP deficit at 30s/);
  assert.match(s.analysis, /Player Two stayed calm/);
  assert.ok(s.analysis.split(' ').length <= 25, 'the fallback is short too: ' + s.analysis);
});

test('generateSummary asks for JSON with schema on gemini-3.8-flash and parses it', async () => {
  let body, url;
  const s = await gemini.generateSummary(recordFixture(), {
    apiKey: 'k',
    fetchImpl: async (u, init) => {
      url = u; body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        headline: '"Player Two keeps her cool and takes it!"', analysis: 'P2 calm.  Really calm.', turningPoint: 'The 30s special.',
      }) }] } }] }) };
    },
  });
  assert.match(url, /gemini-3\.8-flash:generateContent$/);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(body.generationConfig.responseSchema.required, ['headline', 'analysis', 'turningPoint']);
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'low');
  assert.match(body.contents[0].parts[0].text, /"comeback":\{"player":2/);
  assert.deepEqual(s, { headline: 'Player Two keeps her cool and takes it!', analysis: 'P2 calm. Really calm.', turningPoint: 'The 30s special.', source: 'gemini', model: 'gemini-3.8-flash' });
});

test('generateSummary retries on Flash-Lite when the main model is overloaded', async () => {
  const urls = [];
  const s = await gemini.generateSummary(recordFixture(), {
    apiKey: 'k',
    fetchImpl: async (u) => {
      urls.push(u);
      if (u.includes('3.8-flash')) return { ok: false, status: 503, text: async () => 'high demand' };
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"headline":"H","analysis":"A","turningPoint":"T"}' }] } }] }) };
    },
  });
  assert.equal(urls.length, 2);
  assert.equal(s.source, 'gemini');
  assert.equal(s.model, 'gemini-3.5-flash-lite');
});

test('generateSummary falls back to template on error or bad JSON', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const detail = recordFixture();
  let calls = 0;
  const noKey = await gemini.generateSummary(detail, { apiKey: '', fetchImpl: async () => { calls++; } });
  assert.equal(calls, 0, 'no key: no requests, no retry');
  assert.equal(noKey.source, 'template');
  assert.equal(noKey.headline, 'Player Two wins with a comeback!');
  const junk = await gemini.generateSummary(detail, {
    apiKey: 'k', fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }) }),
  });
  assert.equal(junk.source, 'template');
});

test('POST /api/ai/summary returns summary + combined text; 400 on empty log', async () => {
  const router = createAiRouter({
    generateSummary: async () => ({ headline: 'H!', analysis: 'A.', turningPoint: 'T.', source: 'gemini' }),
  });
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/ai', router);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const post = (body) => fetch(`http://127.0.0.1:${server.address().port}/api/ai/summary`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    const res = await post(recordFixture());
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.text, 'H! A. Turning point: T.');
    assert.equal(j.source, 'gemini');
    assert.equal((await post({ match: {} })).status, 400);
  } finally {
    server.close();
  }
});

test('SUMMARY_SYSTEM asks for a short, fun wrap-up, not a stats report', () => {
  const { SUMMARY_SYSTEM } = require('../../server/ai/prompts.js');
  assert.match(SUMMARY_SYSTEM, /SHORT, FUN/);
  assert.match(SUMMARY_SYSTEM, /NOT a report/);
  assert.match(SUMMARY_SYSTEM, /AT MOST ONE number/);
  assert.match(SUMMARY_SYSTEM, /exactly 2 short sentences/);
  assert.doesNotMatch(SUMMARY_SYSTEM, /2-4 sentences|cite 1-3 concrete numbers/);   // the old, report-style asks are gone
});

test('tighten cuts a rambling model answer down to the limits', () => {
  const { tighten, SUMMARY_LIMITS } = gemini;
  const long = 'Player One controlled the early rounds with a calm avg of 0.83. Player Two spiked to 141 bpm at 12s and never recovered from it. A third sentence nobody asked for. A fourth.';
  const t = tighten(long, SUMMARY_LIMITS.analysis);
  assert.equal(t.split(/(?<=[.!?])\s+/).length, 2);
  assert.ok(t.split(' ').length <= 40);
  assert.equal(tighten('Short one', { sentences: 1, words: 16 }), 'Short one.');
  const longWords = 'word '.repeat(30).trim();
  assert.ok(tighten(longWords, { sentences: 1, words: 16 }).split(' ').length <= 16);
  assert.equal(tighten('Comeback at 8.5 seconds! Wow.', { sentences: 1, words: 16 }), 'Comeback at 8.5 seconds!');   // decimals do not split a sentence
});

test('generateSummary shortens a long Gemini answer before storing it', async () => {
  const s = await gemini.generateSummary(recordFixture(), {
    apiKey: 'k',
    fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      headline: 'Player Two absolutely dominates this entire match from the very first second to the last',
      analysis: 'One. Two. Three. Four.',
      turningPoint: 'At 30s Player Two turned the whole thing around with a huge special move that nobody saw coming at all.',
    }) }] } }] }) }),
  });
  assert.ok(s.headline.split(' ').length <= 10, s.headline);
  assert.equal(s.analysis, 'One. Two.');
  assert.ok(s.turningPoint.split(' ').length <= 16, s.turningPoint);
  assert.equal(s.source, 'gemini');
});
