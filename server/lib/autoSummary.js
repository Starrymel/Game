// Owner: C
// Writes the Gemini post-match summary as soon as a match ends, so every match in the
// dashboard has one without anyone opening it.
//   - one summary at a time (no bursts when spooled matches replay)
//   - at most once per match per server run (match end is signalled from memory and
//     again after the DB write)
//   - never overwrites a summary that's already there (e.g. saved by the recap)
//   - only stores real Gemini output; if Gemini is down, nothing is stored and the
//     dashboard/recap can still generate one on demand later
// Saves to the DB when reachable and to the in-memory copy either way.
// Disable with AUTO_SUMMARY=0.

const gemini = require('../ai/gemini');

function createAutoSummary({ store, generateSummary = gemini.generateSummary, log = console } = {}) {
  let chain = Promise.resolve();
  const seen = new Set();

  async function run(id) {
    // The memory copy is complete the moment the final batch arrives; the DB may lag.
    const detail = store.memory?.has(id) ? store.memory.detail(id) : (await store.detail(id)).detail;
    if (!detail) return 'missing';
    if (detail.match.summary) return 'exists';
    if (!detail.snapshots.length && !detail.events.length) return 'empty';
    const s = await generateSummary(detail);
    if (s.source !== 'gemini') return 'no-gemini';
    return (await store.saveSummary(id, gemini.summaryText(s), { onlyIfEmpty: true })) ? 'saved' : 'exists';
  }

  function summarize(id) {
    if (seen.has(id)) return chain;
    seen.add(id);
    chain = chain
      .then(() => run(id))
      .then(
        (result) => {
          if (result === 'saved') log.log(`[ai] auto-summary saved for ${id}`);
          if (result === 'no-gemini' || result === 'missing') seen.delete(id); // allow a later retry
          return result;
        },
        (err) => { seen.delete(id); log.warn(`[ai] auto-summary failed for ${id}: ${err.message}`); return 'error'; },
      );
    return chain;
  }

  return { summarize };
}

function attach(ingest, { store = require('./matchStore').getMatchStore(), env = process.env } = {}) {
  if (env.AUTO_SUMMARY === '0') return null;
  const worker = createAutoSummary({ store });
  ingest.onMatchEnd((id) => worker.summarize(id));
  return worker;
}

module.exports = { createAutoSummary, attach };
