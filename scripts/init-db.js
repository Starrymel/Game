// Usage: DATABASE_URL=... node scripts/init-db.js   (or: npm run init-db in server/)
const fs = require('fs'), path = require('path');
process.env.PG_CONNECT_TIMEOUT_MS ||= '20000'; // one-off setup: allow a slow first connection
const { pool } = require('../server/lib/db');
(async () => {
  if (!pool) { console.error('Set DATABASE_URL'); process.exit(1); }
  await pool.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init.sql'), 'utf8'));
  const { rows } = await pool.query("select hypertable_name from timescaledb_information.hypertables").catch(() => ({ rows: null }));
  console.log('schema ok; hypertables:', rows ? rows.map(r => r.hypertable_name).join(', ') || '(none)' : 'n/a (plain Postgres)');
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
