// Ingest pipeline: HTTP handler enqueues and returns immediately (never blocks gameplay).
// A background worker writes to Postgres; on failure batches are spooled to disk and retried.
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

const SPOOL_DIR = process.env.SPOOL_DIR || path.join(__dirname, '..', 'spool');
fs.mkdirSync(SPOOL_DIR, { recursive: true });

const queue = [];
const endListeners = [];                 // fn(match_id) after a match's final batch commits
const startCache = new Map();            // match_id -> started_at (Date)
const state = { ok: !!pool, lastError: pool ? null : 'DATABASE_URL not set', written: 0, spooled: 0, dropped: 0 };
let working = false;

const num = v => (v === null || v === undefined || v === '' || Number.isNaN(+v)) ? null : +v;
const int = v => num(v) === null ? null : Math.round(+v);

async function matchStart(client, b) {
  const id = b.match_id;
  if (startCache.has(id)) return startCache.get(id);
  const maxT = Math.max(0, ...[...(b.samples || []), ...(b.events || []), ...(b.snapshots || [])].map(x => +x.t || 0));
  const m = b.meta || {};
  const startedAt = b.started_at && !Number.isNaN(Date.parse(b.started_at)) ? new Date(b.started_at) : new Date(Date.now() - maxT);
  const { rows } = await client.query(
    `INSERT INTO matches (id, started_at, p1_name, p2_name, meta)
     VALUES ($1, $2::timestamptz, COALESCE($3::text,'Player 1'), COALESCE($4::text,'Player 2'), $5)
     ON CONFLICT (id) DO UPDATE SET meta = matches.meta || EXCLUDED.meta,
       p1_name = COALESCE($3::text, matches.p1_name), p2_name = COALESCE($4::text, matches.p2_name)
     RETURNING started_at`,
    [id, startedAt, m.p1_name || null, m.p2_name || null, JSON.stringify(m)]);
  startCache.set(id, rows[0].started_at);
  return rows[0].started_at;
}

async function writeBatch(b) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const start = await matchStart(client, b);
    const ts = t => new Date(start.getTime() + (+t || 0));
    const id = b.match_id;

    const S = (b.samples || []).filter(s => s && (s.player === 1 || s.player === 2));
    if (S.length) await client.query(
      `INSERT INTO biometric_samples (ts, match_id, t_ms, player, hr, breath, stress, calm, source)
       SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::int[], $4::smallint[], $5::real[], $6::real[], $7::real[], $8::real[], $9::text[])`,
      [S.map(s => ts(s.t)), S.map(() => id), S.map(s => int(s.t)), S.map(s => s.player),
       S.map(s => num(s.hr)), S.map(s => num(s.breath)), S.map(s => num(s.stress)), S.map(s => num(s.calm)),
       S.map(s => s.source || 'presage')]);

    const E = (b.events || []).filter(e => e && e.type);
    if (E.length) await client.query(
      `INSERT INTO game_events (ts, match_id, t_ms, type, player, payload)
       SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::int[], $4::text[], $5::smallint[], $6::jsonb[])`,
      [E.map(e => ts(e.t)), E.map(() => id), E.map(e => int(e.t)), E.map(e => e.type),
       E.map(e => e.player === 1 || e.player === 2 ? e.player : null), E.map(e => JSON.stringify(e.payload || {}))]);

    const N = b.snapshots || [];
    if (N.length) await client.query(
      `INSERT INTO match_snapshots (ts, match_id, t_ms, p1_hp, p2_hp, p1_meter, p2_meter)
       SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::int[], $4::real[], $5::real[], $6::real[], $7::real[])`,
      [N.map(s => ts(s.t)), N.map(() => id), N.map(s => int(s.t)), N.map(s => num(s.p1_hp)), N.map(s => num(s.p2_hp)),
       N.map(s => num(s.p1_meter)), N.map(s => num(s.p2_meter))]);

    if (b.end) await client.query(
      `UPDATE matches SET ended_at = now(), winner = COALESCE($2, winner), duration_ms = COALESCE($3, duration_ms),
         summary = COALESCE($4, summary) WHERE id = $1`,
      [id, num(b.end.winner), int(b.end.duration_ms), b.end.summary || null]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
  if (b.end) for (const fn of endListeners) setImmediate(() => { try { fn(b.match_id); } catch (_) {} });
}

// Listeners must never throw into the ingest path; they run after the write, off the request.
function onMatchEnd(fn) { endListeners.push(fn); }

function spool(b) {
  try {
    fs.appendFileSync(path.join(SPOOL_DIR, 'pending.jsonl'), JSON.stringify(b) + '\n');
    state.spooled++;
  } catch (e) { state.dropped++; console.error('[ingest] spool failed', e.message); }
}

async function drain() {
  if (working) return; working = true;
  try {
    while (queue.length) {
      const b = queue[0];
      if (!pool) { spool(queue.shift()); continue; }
      try { await writeBatch(b); queue.shift(); state.written++; state.ok = true; state.lastError = null; }
      catch (e) { state.ok = false; state.lastError = e.message; spool(queue.shift()); }
    }
  } finally { working = false; }
}

// Replay spooled batches once the DB is reachable again.
async function replay() {
  const f = path.join(SPOOL_DIR, 'pending.jsonl');
  if (!pool || !fs.existsSync(f) || working) return;
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
  if (!lines.length) return;
  fs.renameSync(f, f + '.replaying');
  const failed = [];
  for (const l of lines) {
    try { await writeBatch(JSON.parse(l)); state.written++; state.ok = true; state.lastError = null; }
    catch (e) { failed.push(l); state.ok = false; state.lastError = e.message; }
  }
  fs.unlinkSync(f + '.replaying');
  if (failed.length) fs.appendFileSync(f, failed.join('\n') + '\n');
  else console.log(`[ingest] replayed ${lines.length} spooled batches`);
}
setInterval(() => replay().catch(() => {}), 5000).unref();

function enqueue(b) {
  if (queue.length > 500) { state.dropped++; return false; }   // hard cap: protect memory
  queue.push(b); setImmediate(drain); return true;
}
module.exports = { enqueue, state, queue, writeBatch, onMatchEnd };
