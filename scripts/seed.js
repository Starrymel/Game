// Usage: node scripts/seed.js [count]  -> inserts N fake matches (needs DATABASE_URL)
const { pool } = require('../server/lib/db');
const { writeBatch } = require('../server/lib/ingest');
const { fakeMatch } = require('../server/lib/fake');
(async () => {
  const n = +process.argv[2] || 3;
  for (let i = 0; i < n; i++) { const f = fakeMatch(Date.now() + i * 7919); await writeBatch(f); console.log('seeded', f.match_id); }
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
