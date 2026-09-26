// Owner: D
// GET /api/matches, GET /api/matches/:id, PUT /api/matches/:id/summary  (Person C's Gemini text lands here)
const express = require('express');
const { getMatchStore } = require('../lib/matchStore');
const router = express.Router();
// DB first; falls back to the server's in-memory copy of recent matches when the DB is
// unreachable. X-Match-Source says which one answered ('db' | 'memory').
const store = () => getMatchStore();

router.get('/', async (_req, res) => {
  try {
    const { source, rows } = await store().list();
    res.set('X-Match-Source', source).json(rows);
  } catch (e) { res.status(503).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const { source, detail } = await store().detail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'not found' });
    res.set('X-Match-Source', source).json(detail);
  } catch (err) { res.status(503).json({ error: err.message }); }
});

router.put('/:id/summary', async (req, res) => {
  try {
    const saved = await store().saveSummary(req.params.id, String((req.body || {}).summary || ''));
    if (!saved) return res.status(503).json({ error: 'match not found in DB or memory' });
    res.json({ ok: true });
  } catch (e) { res.status(503).json({ error: e.message }); }
});

module.exports = router;
