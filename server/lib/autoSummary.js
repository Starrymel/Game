// Owner: C
// Writes the Gemini post-match summary into matches.summary as soon as a match's final
// batch is stored, so every match in the dashboard has one without anyone opening it.
//   - one summary at a time (no bursts when spooled matches replay)
//   - never overwrites a summary that's already there (e.g. saved by the recap)
//   - only stores real Gemini output; if Gemini is down, nothing is stored and the
//     dashboard/recap can still generate one on demand later
// Disable with AUTO_SUMMARY=0.

const { loadMatchDetail } = require('./matchStore');
const gemini = require('../ai/gemini');

function createAutoSummary({ pool, generateSummary = gemini.generateSummary, load = loadMatchDetail, log = console } = {}) {
  let chain = Promise.resolve();
  const pending = new Set();

  async function run(id) {
    const d = await load(pool, id);
    if (!d) return 'missing';
    if (d.match.summary) return 'exists';
    if (!d.snapshots.length && !d.events.length) return 'empty';
    const s = await generateSummary(d);
    if (s.source !== 'gemini') return 'no-gemini';
    const r = await pool.query('UPDATE matches SET summary=$2 WHERE id=$1 AND summary IS NULL', [id, gemini.summaryText(s)]);
    return r.rowCount ? 'saved' : 'exists';
  }

  function summarize(id) {
    if (pending.has(id)) return chain;
    pending.add(id);
    chain = chain
      .then(() => run(id))
      .then(
        (result) => { if (result === 'saved') log.log(`[ai] auto-summary saved for ${id}`); return result; },
        (err) => { log.warn(`[ai] auto-summary failed for ${id}: ${err.message}`); return 'error'; },
      )
      .finally(() => pending.delete(id));
    return chain;
  }

  return { summarize };
}

// Hooks the worker onto ingest's match-end signal. No-op without a DB.
function attach(ingest, { pool = require('./db').pool, env = process.env } = {}) {
  if (!pool || env.AUTO_SUMMARY === '0') return null;
  const worker = createAutoSummary({ pool });
  ingest.onMatchEnd((id) => worker.summarize(id));
  return worker;
}

module.exports = { createAutoSummary, attach };
