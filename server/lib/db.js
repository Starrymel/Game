require('dotenv').config();
const { Pool } = require('pg');
let url = process.env.DATABASE_URL;
// pg treats sslmode=require in the URL as strict certificate verification, which overrides the ssl option below,
// and Tiger's certificate chain isn't in Node's trust store. Drop it from the URL and set ssl explicitly.
if (url && process.env.PGSSL !== 'disable') {
  try { const u = new URL(url); u.searchParams.delete('sslmode'); url = u.toString(); } catch (_) {}
}
const pool = url ? new Pool({
  connectionString: url,
  // Tiger Data requires TLS; local dev can set PGSSL=disable
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  max: 5, connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS) || 5000, idleTimeoutMillis: 30000,
}) : null;
if (pool) pool.on('error', e => console.error('[db] pool error', e.message));
module.exports = { pool };
