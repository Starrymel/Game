// Owner: D
// POST /api/log/batch. Answers 202 immediately; the DB write happens in the background.
const express = require('express');
const ingest = require('../lib/ingest');
const router = express.Router();

router.post('/batch', (req, res) => {
  const b = req.body || {};
  if (!b.match_id || typeof b.match_id !== 'string') return res.status(400).json({ ok: false, error: 'match_id required' });
  res.status(202).json({ ok: ingest.enqueue(b) });
});

module.exports = router;
