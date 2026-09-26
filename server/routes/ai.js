// Owner: C
// Express router mounted at /api/ai
//
//   POST /api/ai/line   { moment, recent? } -> { text, ms }
//   GET  /api/ai/tts?text=...  -> audio/mpeg (streamed on first request, disk-cached after)
//   POST /api/ai/summary  { match, samples, events, snapshots } (GET /api/matches/:id shape)
//                         -> { headline, analysis, turningPoint, text, source, ms }
//
// Keeps API keys server-side. The browser falls back to pre-written lines on any error.

const express = require('express');
const gemini = require('../ai/gemini');
const elevenlabs = require('../ai/elevenlabs');
const { MOMENT_HINTS } = require('../ai/prompts');

const MAX_RECENT = 5;
const MAX_TTS_CHARS = 200;
const MAX_LOG_ROWS = 5000;

// Tiny fixed-window limiter so a public /tts can't be used to burn ElevenLabs credits.
function createRateLimiter({ max, windowMs, now = () => Date.now() }) {
  const hits = new Map();
  return (key) => {
    const t = now();
    const h = hits.get(key);
    if (!h || t - h.start >= windowMs) {
      hits.set(key, { start: t, count: 1 });
      return true;
    }
    h.count += 1;
    return h.count <= max;
  };
}

// Trim the client payload down to what the prompt uses, so the browser can't send
// arbitrary text into the prompt or blow up the request.
function sanitizeMoment(m) {
  if (!m || typeof m !== 'object' || !(m.type in MOMENT_HINTS)) return null;
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 100) / 100 : undefined);
  const player = m.player === 1 || m.player === 2 ? m.player : undefined;
  const data = {};
  for (const [k, v] of Object.entries(m.data ?? {}).slice(0, 8)) {
    if (/^\w{1,24}$/.test(k) && num(v) !== undefined) data[k] = num(v);
  }
  const players = (m.context?.players ?? []).slice(0, 2).map((p) => ({
    id: p?.id === 2 ? 2 : 1,
    hp: num(p?.hp), maxHp: num(p?.maxHp) ?? 100, meter: num(p?.meter),
    hr: num(p?.hr), breath: num(p?.breath), stress: num(p?.stress), calm: num(p?.calm),
  }));
  return {
    type: m.type,
    player,
    data,
    context: { players, timeRemaining: num(m.context?.timeRemaining) },
  };
}

function createAiRouter({
  generateLine = gemini.generateLine,
  generateSummary = gemini.generateSummary,
  ttsStream = elevenlabs.ttsStream,
  ttsCache = elevenlabs.createTtsCache(),
  ttsLimit = createRateLimiter({ max: 60, windowMs: 60000 }),
} = {}) {
  const router = express.Router();

  router.post('/line', async (req, res) => {
    const moment = sanitizeMoment(req.body?.moment);
    if (!moment) return res.status(400).json({ error: 'invalid moment' });
    const recent = (Array.isArray(req.body.recent) ? req.body.recent : [])
      .filter((s) => typeof s === 'string')
      .slice(-MAX_RECENT)
      .map((s) => s.slice(0, 120));

    const start = Date.now();
    try {
      const text = await generateLine(moment, { recent });
      res.json({ text, ms: Date.now() - start });
    } catch (err) {
      console.warn('[ai] line failed:', err.message);
      res.status(err.status || 502).json({ error: err.message, ms: Date.now() - start });
    }
  });

  router.post('/summary', async (req, res) => {
    const b = req.body ?? {};
    const rows = (x) => (Array.isArray(x) ? x.slice(0, MAX_LOG_ROWS) : []);
    const detail = {
      match: b.match && typeof b.match === 'object' ? b.match : {},
      samples: rows(b.samples),
      events: rows(b.events),
      snapshots: rows(b.snapshots),
    };
    if (!detail.snapshots.length && !detail.events.length) return res.status(400).json({ error: 'empty match log' });
    const start = Date.now();
    const s = await generateSummary(detail);
    res.json({
      headline: s.headline,
      analysis: s.analysis,
      turningPoint: s.turningPoint,
      text: `${s.headline} ${s.analysis} Turning point: ${s.turningPoint}`,
      source: s.source,
      ms: Date.now() - start,
    });
  });

  router.get('/tts', async (req, res) => {
    const text = typeof req.query.text === 'string' ? req.query.text.trim() : '';
    if (!text || text.length > MAX_TTS_CHARS) return res.status(400).json({ error: `text must be 1-${MAX_TTS_CHARS} chars` });

    const key = elevenlabs.cacheKey(text);
    if (ttsCache.has(key)) {
      res.set('X-TTS-Cache', 'hit');
      return res.type('audio/mpeg').sendFile(ttsCache.path(key), { maxAge: '1d' });
    }
    if (!ttsLimit(req.ip)) return res.status(429).json({ error: 'tts rate limit' });

    const start = Date.now();
    let upstream;
    try {
      upstream = await ttsStream(text);
    } catch (err) {
      console.warn('[ai] tts failed:', err.message);
      return res.status(err.status || 502).json({ error: err.message });
    }

    res.set({ 'Content-Type': 'audio/mpeg', 'X-TTS-Cache': 'miss', 'X-TTS-Upstream-Ms': String(Date.now() - start) });
    res.flushHeaders();
    const chunks = [];
    let aborted = false;
    try {
      for await (const chunk of upstream.body) {
        const buf = Buffer.from(chunk);
        chunks.push(buf);
        if (!res.writableEnded) res.write(buf);
      }
    } catch (err) {
      aborted = true;
      console.warn('[ai] tts stream broke:', err.message);
    }
    res.end();
    if (!aborted && chunks.length) {
      try { ttsCache.write(key, Buffer.concat(chunks)); } catch (err) { console.warn('[ai] tts cache write failed:', err.message); }
    }
  });

  return router;
}

module.exports = createAiRouter();
module.exports.createAiRouter = createAiRouter;
module.exports.sanitizeMoment = sanitizeMoment;
module.exports.createRateLimiter = createRateLimiter;
