// Owner: C
// Post-match summary client. Usable from the game and from D's dashboard:
//
//   const { requestMatchSummary } = await import('/src/commentary/summary.js');
//   const s = await requestMatchSummary(state.data, { save: true }); // data from GET /api/matches/:id
//   // s = { headline, analysis, turningPoint, text, source: 'gemini' | 'template' }
//
// With save: true (and detail.match.id set) the text is stored via
// PUT /api/matches/:id/summary so the dashboard shows it next time.

export async function requestMatchSummary(detail, {
  save = false,
  endpoint = '/api/ai/summary',
  timeoutMs = 20000,
  fetchImpl = (...a) => fetch(...a),
} = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let summary;
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(detail),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`summary HTTP ${res.status}`);
    summary = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const id = detail?.match?.id;
  if (save && id && summary?.text) {
    try {
      await fetchImpl(`/api/matches/${encodeURIComponent(id)}/summary`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: summary.text }),
      });
    } catch {
      // Saving is best effort; the caller still gets the summary.
    }
  }
  return summary;
}
