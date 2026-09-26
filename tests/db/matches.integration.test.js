// Runs D's real ingest + match routes against a real Postgres. Skipped unless
// TEST_DATABASE_URL is set, e.g. with a throwaway container:
//   docker run -d --rm --name composure-testdb -e POSTGRES_PASSWORD=test -e POSTGRES_DB=composure -p 55432:5432 postgres:16-alpine
//   TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/composure npm test
// Never point it at the shared Tiger Data database: it creates and deletes test rows.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'set TEST_DATABASE_URL to run DB integration tests' };
const require = createRequire(import.meta.url);
let pool, ingest, server, base, autoSummary;
const ID = `itest-${Date.now().toString(36)}`;

before(async () => {
  if (!url) return;
  process.env.DATABASE_URL = url;
  process.env.PGSSL = 'disable';
  process.env.SPOOL_DIR = mkdtempSync(join(tmpdir(), 'composure-spool-'));
  ({ pool } = require('../../server/lib/db.js'));
  await pool.query(readFileSync(new URL('../../db/init.sql', import.meta.url), 'utf8'));
  ingest = require('../../server/lib/ingest.js');
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/matches', require('../../server/routes/matches.js'));
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/matches`;
  const { createAutoSummary } = require('../../server/lib/autoSummary.js');
  autoSummary = createAutoSummary({
    pool, log: { log() {}, warn() {} },
    generateSummary: async (d) => ({ headline: `Auto for ${d.match.id}!`, analysis: 'A.', turningPoint: 'T.', source: 'gemini' }),
  });
});

after(async () => {
  if (!url) return;
  server?.close();
  for (const t of ['biometric_samples', 'game_events', 'match_snapshots']) await pool.query(`DELETE FROM ${t} WHERE match_id LIKE 'itest-%'`);
  await pool.query("DELETE FROM matches WHERE id LIKE 'itest-%'");
  await pool.end();
});

const batch = (id, end) => ({
  match_id: id, started_at: new Date().toISOString(), meta: { p1_name: 'Ana', p2_name: 'Ben' },
  samples: [{ t: 0, player: 1, hr: 80, breath: 12, stress: 0.3, calm: 0.7, source: 'mock' }],
  events: [{ t: 500, type: 'hit', player: 2, payload: { attacker: 1, damage: 10 } }],
  snapshots: [{ t: 0, p1_hp: 100, p2_hp: 100, p1_meter: 0, p2_meter: 0 }, { t: 500, p1_hp: 100, p2_hp: 90, p1_meter: 5, p2_meter: 2 }],
  end,
});

test('final batch fires onMatchEnd once, after commit', opts, async () => {
  const ended = [];
  ingest.onMatchEnd((id) => ended.push(id));
  await ingest.writeBatch(batch(ID, null));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(ended.filter((x) => x === ID), [], 'mid-match batch: no signal');
  await ingest.writeBatch(batch(ID, { winner: 1, duration_ms: 500 }));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(ended.filter((x) => x === ID), [ID]);
});

test('auto-summary stores text; list shows preview; detail shape unchanged', opts, async () => {
  assert.equal(await autoSummary.summarize(ID), 'saved');
  const list = await (await fetch(base)).json();
  const row = list.find((m) => m.id === ID);
  assert.equal(row.has_summary, true);
  assert.equal(row.summary_preview, `Auto for ${ID}! A. Turning point: T.`);
  for (const k of ['id', 'started_at', 'ended_at', 'p1_name', 'p2_name', 'winner', 'duration_ms']) assert.ok(k in row, k);

  const d = await (await fetch(`${base}/${ID}`)).json();
  assert.deepEqual(Object.keys(d), ['match', 'samples', 'events', 'snapshots']);
  assert.equal(d.match.p1_name, 'Ana');
  assert.equal(d.samples.length, 2);
  assert.equal(d.snapshots.length, 4);
  assert.equal((await fetch(`${base}/itest-nope`)).status, 404);
});

test('summary saved via PUT (recap/dashboard) is never overwritten by auto-summary', opts, async () => {
  const id2 = `${ID}-b`;
  await ingest.writeBatch(batch(id2, { winner: 2, duration_ms: 500 }));
  const put = await fetch(`${base}/${id2}/summary`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary: 'Saved by recap.' }),
  });
  assert.equal(put.status, 200);
  assert.equal(await autoSummary.summarize(id2), 'exists');
  const d = await (await fetch(`${base}/${id2}`)).json();
  assert.equal(d.match.summary, 'Saved by recap.');
});
