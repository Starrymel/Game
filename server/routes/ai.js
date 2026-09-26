// Owner: C
// Express router mounted at /api/ai
//
//   POST /api/ai/line   { moment, recent? } -> { text, ms }
//
// Keeps API keys server-side. The browser falls back to pre-written lines on any error.

const express = require('express');
const gemini = require('../ai/gemini');
const { MOMENT_HINTS } = require('../ai/prompts');

const MAX_RECENT = 5;

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

function createAiRouter({ generateLine = gemini.generateLine } = {}) {
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

  return router;
}

module.exports = createAiRouter();
module.exports.createAiRouter = createAiRouter;
module.exports.sanitizeMoment = sanitizeMoment;
