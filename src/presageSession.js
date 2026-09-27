// A random id for this page load's lifetime. The server-side Presage endpoint (server/lib/presage.js)
// uses it to correlate this page's separate send-frames connection (presage-capture.js) and
// receive-vitals connection (biometrics-presage.js) for the same player, WITHOUT ever broadcasting
// one player's heart rate to some other, unrelated match on the same shared public server.
export const PRESAGE_SESSION_ID = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2))
  + '-' + Date.now().toString(36);

// Appends ?session=<id> (or &session= if the URL already has a query) to a Presage bridge URL.
// Harmless against the old standalone local bridge (bridge/server.js), which ignores unknown params.
export function withSession(wsUrl) {
  return wsUrl + (wsUrl.includes('?') ? '&' : '?') + 'session=' + encodeURIComponent(PRESAGE_SESSION_ID);
}
