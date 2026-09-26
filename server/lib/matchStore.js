// Match reads for the dashboard, recap and auto-summary.
//
// The database (Tiger Data) is the source of truth. The server also keeps the most
// recent matches in memory, built from the same batches the game posts, so the
// dashboard and recap keep working when the DB is unreachable (no DATABASE_URL, the
// venue network blocks the port, Tiger is down). Shapes match the DB rows exactly.

const MAX_MATCHES = 30;
const MAX_ROWS = 20000;          // per table per match; a 99s round is ~2k
const DB_RETRY_MS = 30000;       // after a DB failure, serve memory without waiting on timeouts

// Same queries GET /api/matches/:id has always used.
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

async function listMatchesDb(pool) {
  const { rows } = await pool.query(
    `SELECT id, started_at, ended_at, p1_name, p2_name, winner, duration_ms, (summary IS NOT NULL) AS has_summary,
            left(summary, 180) AS summary_preview
     FROM matches ORDER BY started_at DESC LIMIT 50`);
  return rows;
}

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(+v) ? null : +v);
const int = (v) => (num(v) === null ? null : Math.round(+v));
const byT = (a, b) => a.t - b.t;

function createMemoryStore({ max = MAX_MATCHES, now = () => Date.now() } = {}) {
  const matches = new Map(); // id -> { match, samples, events, snapshots }; insertion order = age

  function ingest(b) {
    if (!b || typeof b.match_id !== 'string') return;
    const id = b.match_id;
    let rec = matches.get(id);
    if (!rec) {
      const m = b.meta || {};
      const startedAt = b.started_at && !Number.isNaN(Date.parse(b.started_at)) ? new Date(b.started_at) : new Date(now());
      rec = {
        match: {
          id, started_at: startedAt.toISOString(), ended_at: null,
          p1_name: m.p1_name || 'Player 1', p2_name: m.p2_name || 'Player 2',
          winner: null, duration_ms: null, summary: null, meta: m,
        },
        samples: [], events: [], snapshots: [],
      };
      matches.set(id, rec);
      while (matches.size > max) matches.delete(matches.keys().next().value);
    }
    const add = (arr, rows) => { for (const r of rows) if (arr.length < MAX_ROWS) arr.push(r); };
    add(rec.samples, (b.samples || []).filter((s) => s && (s.player === 1 || s.player === 2)).map((s) => ({
      t: int(s.t), player: s.player, hr: num(s.hr), breath: num(s.breath), stress: num(s.stress), calm: num(s.calm), source: s.source || 'presage',
    })));
    add(rec.events, (b.events || []).filter((e) => e && e.type).map((e) => ({
      t: int(e.t), type: e.type, player: e.player === 1 || e.player === 2 ? e.player : null, payload: e.payload || {},
    })));
    add(rec.snapshots, (b.snapshots || []).map((s) => ({
      t: int(s.t), p1_hp: num(s.p1_hp), p2_hp: num(s.p2_hp), p1_meter: num(s.p1_meter), p2_meter: num(s.p2_meter),
    })));
    if (b.end) {
      rec.match.ended_at = new Date(now()).toISOString();
      if (num(b.end.winner) !== null) rec.match.winner = num(b.end.winner);
      if (int(b.end.duration_ms) !== null) rec.match.duration_ms = int(b.end.duration_ms);
      if (b.end.summary) rec.match.summary = b.end.summary;
    }
  }

  return {
    ingest,
    has: (id) => matches.has(id),
    detail(id) {
      const r = matches.get(id);
      if (!r) return null;
      return { match: { ...r.match }, samples: [...r.samples].sort(byT), events: [...r.events].sort(byT), snapshots: [...r.snapshots].sort(byT) };
    },
    list() {
      return [...matches.values()].reverse().map(({ match: m }) => ({
        id: m.id, started_at: m.started_at, ended_at: m.ended_at, p1_name: m.p1_name, p2_name: m.p2_name,
        winner: m.winner, duration_ms: m.duration_ms, has_summary: m.summary != null,
        summary_preview: m.summary == null ? null : m.summary.slice(0, 180),
      }));
    },
    setSummary(id, text) {
      const r = matches.get(id);
      if (!r) return false;
      r.match.summary = text;
      return true;
    },
  };
}

// DB first, memory as fallback. `source` tells callers which one answered.
function createMatchStore({ pool, memory = createMemoryStore(), now = () => Date.now(), log = console } = {}) {
  let dbDownUntil = 0;
  const dbUsable = () => !!pool && now() >= dbDownUntil;
  function dbFailed(err) {
    if (now() >= dbDownUntil) log.warn(`[matches] DB unavailable (${err.message}); serving in-memory matches for ${DB_RETRY_MS / 1000}s`);
    dbDownUntil = now() + DB_RETRY_MS;
  }

  return {
    memory,
    async list() {
      if (dbUsable()) {
        try {
          const rows = await listMatchesDb(pool);
          // Matches the DB hasn't received yet (write queue / spool) still show up.
          const seen = new Set(rows.map((r) => r.id));
          const extra = memory.list().filter((m) => !seen.has(m.id));
          return { source: 'db', rows: [...extra, ...rows] };
        } catch (err) { dbFailed(err); }
      }
      return { source: 'memory', rows: memory.list() };
    },
    async detail(id) {
      if (dbUsable()) {
        try {
          const d = await loadMatchDetail(pool, id);
          if (d) return { source: 'db', detail: d };
        } catch (err) { dbFailed(err); }
      }
      const d = memory.detail(id);
      return { source: d ? 'memory' : 'none', detail: d };
    },
    // Returns true if stored anywhere. onlyIfEmpty: never overwrite an existing summary.
    async saveSummary(id, text, { onlyIfEmpty = false } = {}) {
      let saved = false;
      const cur = memory.detail(id);
      if (cur && !(onlyIfEmpty && cur.match.summary)) saved = memory.setSummary(id, text) || saved;
      if (dbUsable()) {
        try {
          const sql = onlyIfEmpty ? 'UPDATE matches SET summary=$2 WHERE id=$1 AND summary IS NULL' : 'UPDATE matches SET summary=$2 WHERE id=$1';
          const r = await pool.query(sql, [id, text]);
          saved = saved || r.rowCount > 0;
        } catch (err) { dbFailed(err); }
      }
      return saved;
    },
  };
}

// Process-wide store shared by ingest, the match routes and auto-summary.
let defaultStore = null;
function getMatchStore() {
  if (!defaultStore) defaultStore = createMatchStore({ pool: require('./db').pool });
  return defaultStore;
}

module.exports = { loadMatchDetail, createMemoryStore, createMatchStore, getMatchStore };
