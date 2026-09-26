// Owner: C
// Browser side of the /api/ai proxy. Keys never reach the browser.

// Moment types not worth an API round trip: they go stale before Gemini answers,
// so the announcer uses a pre-written line instead.
export const FALLBACK_ONLY = new Set(['hit']);

// Returns a getLine(moment) for the announcer, plus remember(text) so recent lines
// (from any source) are sent along to avoid repeats. On a 5xx (no key, Gemini down)
// it backs off for backoffMs instead of hammering the server every moment.
export function createGeminiLineSource({
  endpoint = '/api/ai/line',
  timeoutMs = 1500,
  backoffMs = 30000,
  fetchImpl = (...args) => fetch(...args),
  now = () => Date.now(),
} = {}) {
  const recent = [];
  let disabledUntil = 0;
  const stats = { requests: 0, ok: 0, failed: 0, skipped: 0, lastMs: null };

  async function getLine(moment) {
    if (FALLBACK_ONLY.has(moment.type) || now() < disabledUntil) {
      stats.skipped += 1;
      return null;
    }
    stats.requests += 1;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const start = now();
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moment, recent: recent.slice(-5) }),
        signal: ctrl.signal,
      });
      stats.lastMs = now() - start;
      if (!res.ok) {
        if (res.status >= 500 || res.status === 404) disabledUntil = now() + backoffMs;
        throw new Error(`HTTP ${res.status}`);
      }
      const { text } = await res.json();
      stats.ok += 1;
      return typeof text === 'string' ? text : null;
    } catch {
      stats.failed += 1;
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    getLine,
    stats,
    remember(text) {
      recent.push(text);
      if (recent.length > 5) recent.shift();
    },
  };
}
