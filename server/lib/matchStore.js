// Shared match reads (same queries GET /api/matches/:id has always used), so the
// route and the post-match auto-summary load a match identically.

async function loadMatchDetail(pool, id) {
  const [m, s, e, n] = await Promise.all([
    pool.query('SELECT * FROM matches WHERE id=$1', [id]),
    pool.query('SELECT t_ms AS t, player, hr, breath, stress, calm, source FROM biometric_samples WHERE match_id=$1 ORDER BY t_ms', [id]),
    pool.query('SELECT t_ms AS t, type, player, payload FROM game_events WHERE match_id=$1 ORDER BY t_ms', [id]),
    pool.query('SELECT t_ms AS t, p1_hp, p2_hp, p1_meter, p2_meter FROM match_snapshots WHERE match_id=$1 ORDER BY t_ms', [id]),
  ]);
  if (!m.rows.length) return null;
  return { match: m.rows[0], samples: s.rows, events: e.rows, snapshots: n.rows };
}

module.exports = { loadMatchDetail };
