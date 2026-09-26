require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL;
const pool = url ? new Pool({
  connectionString: url,
  // Tiger Data requires TLS; local dev can set PGSSL=disable
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  max: 5, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000,
}) : null;
if (pool) pool.on('error', e => console.error('[db] pool error', e.message));
module.exports = { pool };
