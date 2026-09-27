// Owner: D
// Express app: logging + match routes, Person C's /api/ai router, and static files.
// Static files are mounted by explicit folder so .env, server/ and db/ are never served.
const express = require('express');
const cors = require('cors');
const path = require('path');
const { pool } = require('./lib/db');
const ingest = require('./lib/ingest');
const { fakeMatch } = require('./lib/fake');

const ROOT = path.join(__dirname, '..');
const app = express();
app.use(cors({ origin: (process.env.CORS_ORIGINS || '*') === '*' ? true : process.env.CORS_ORIGINS.split(',') }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  let db = false;
  if (pool) { try { await pool.query('select 1'); db = true; } catch (_) {} }
  res.json({ ok: true, db, queue: ingest.queue.length, ...ingest.state });
});

app.use('/api/log', require('./routes/log'));
app.use('/api/matches', require('./routes/matches'));
require('./lib/autoSummary').attach(ingest); // C: store the Gemini summary when a match ends (AUTO_SUMMARY=0 to disable)

// Person C's router (Gemini / ElevenLabs proxy). Mounted only once ai.js exports an express Router.
const ai = require('./routes/ai');
if (typeof ai === 'function') { app.use('/api/ai', ai); console.log('[server] mounted /api/ai'); }

if (process.env.DEV_ROUTES !== '0') {
  app.post('/api/dev/fake-match', async (_req, res) => {
    const f = fakeMatch(Date.now());
    ingest.remember(f); // in-memory copy, so this works without a DB too
    try { if (pool) await ingest.writeBatch(f); res.json({ ok: true, match_id: f.match_id, db: !!pool }); }
    catch (e) { res.json({ ok: true, match_id: f.match_id, db: false, dbError: e.message }); }
  });
}

app.use('/src', express.static(path.join(ROOT, 'src')));
app.use('/assets', express.static(path.join(ROOT, 'assets')));
app.use('/dashboard', express.static(path.join(ROOT, 'dashboard')));
app.get('/', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`[server] http://localhost:${PORT}  db=${pool ? 'configured' : 'none (logging disabled)'}`));
// Two-laptop relay on the same port (wss://<site>/netplay), so a single-port host like Render can run everything.
const relay = require('./lib/relay').attachRelay(server, { log: (m) => console.log(m) });
// Lobby helper: who is sitting in a room right now? Exact room names only; nothing else is listed.
app.get('/api/room/:name', (req, res) => res.json({ relay: true, ...relay.status(req.params.name) }));
