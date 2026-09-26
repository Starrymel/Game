// Owner: D
// GET /api/matches, GET /api/matches/:id, PUT /api/matches/:id/summary  (Person C's Gemini text lands here)
const express = require('express');
const { pool } = require('../lib/db');
const { loadMatchDetail } = require('../lib/matchStore');
const router = express.Router();

router.get('/', async (_req, res) => {
  if (!pool) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT id, started_at, ended_at, p1_name, p2_name, winner, duration_ms, (summary IS NOT NULL) AS has_summary,
              left(summary, 180) AS summary_preview
       FROM matches ORDER BY started_at DESC LIMIT 50`);
    res.json(rows);
  } catch (e) { res.status(503).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'db not configured' });
  try {
    const detail = await loadMatchDetail(pool, req.params.id);
    if (!detail) return res.status(404).json({ error: 'not found' });
    res.json(detail);
  } catch (err) { res.status(503).json({ error: err.message }); }
});

router.put('/:id/summary', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'db not configured' });
  try {
    await pool.query('UPDATE matches SET summary=$2 WHERE id=$1', [req.params.id, String((req.body || {}).summary || '')]);
    res.json({ ok: true });
  } catch (e) { res.status(503).json({ error: e.message }); }
});

module.exports = router;
