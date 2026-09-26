// Owner: D
// GET /api/matches, GET /api/matches/:id, PUT /api/matches/:id/summary  (Person C's Gemini text lands here)
const express = require('express');
const { pool } = require('../lib/db');
const router = express.Router();

router.get('/', async (_req, res) => {
  if (!pool) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT id, started_at, ended_at, p1_name, p2_name, winner, duration_ms, (summary IS NOT NULL) AS has_summary
       FROM matches ORDER BY started_at DESC LIMIT 50`);
    res.json(rows);
  } catch (e) { res.status(503).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'db not configured' });
  try {
    const id = req.params.id;
    const [m, s, e, n] = await Promise.all([
      pool.query('SELECT * FROM matches WHERE id=$1', [id]),
      pool.query('SELECT t_ms AS t, player, hr, breath, stress, calm, source FROM biometric_samples WHERE match_id=$1 ORDER BY t_ms', [id]),
      pool.query('SELECT t_ms AS t, type, player, payload FROM game_events WHERE match_id=$1 ORDER BY t_ms', [id]),
      pool.query('SELECT t_ms AS t, p1_hp, p2_hp, p1_meter, p2_meter FROM match_snapshots WHERE match_id=$1 ORDER BY t_ms', [id]),
    ]);
    if (!m.rows.length) return res.status(404).json({ error: 'not found' });
    res.json({ match: m.rows[0], samples: s.rows, events: e.rows, snapshots: n.rows });
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
