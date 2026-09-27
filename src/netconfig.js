// Owner: D. Where the browser connects for two-player play and for Presage vitals.
// Pure functions (no DOM access) so they can be unit tested.
//
// Three setups are supported:
//  * Same Wi-Fi (page is http://): relay on the host laptop (port 8788, or ?relayPort=), and the host laptop's
//    local bridge on port 8787 -- the guest streams its camera to it (?host=<host address>).
//  * Hosted site (page is https://, e.g. Render): the relay is the site itself at /netplay, and Presage runs
//    server-side too, same origin, at /presage (see server/lib/presage.js) -- no per-player local process needed.
//  * Hosted site, but the page's own hostname IS localhost (local dev serving the game over https, or testing):
//    keeps using a local bridge/server.js instead, over wss:// on its separate self-signed-cert port, since a
//    plain ws:// connection from an https:// page is blocked as mixed content in every browser, even to
//    localhost (confirmed: Chromium #40386732, Firefox bug 1376309, reproduces in Safari).

const isLocalHost = (hostname) => hostname === 'localhost' || hostname === '127.0.0.1';

export function relayUrlFor(loc, params) {
  const room = params.get('room');
  const host = params.get('host');
  const base = loc.protocol === 'https:'
    ? `wss://${host || loc.host}/netplay`
    : `ws://${host || loc.hostname}:${params.get('relayPort') || 8788}/netplay`;
  return room ? `${base}?room=${encodeURIComponent(room)}` : base;
}

export function bridgeUrlFor(loc, params) {
  const override = params.get('bridge');           // full address, e.g. ?bridge=ws://192.168.1.5:8787/biometrics
  if (override) return override;
  if (loc.protocol === 'https:') {
    if (isLocalHost(loc.hostname)) {
      // Local dev bridge (bridge/server.js) with its own self-signed-cert wss:// listener.
      const wssPort = params.get('bridgeWssPort') || 8790;
      return `wss://localhost:${wssPort}/biometrics`;
    }
    // Hosted site: Presage runs inside the same server, same origin -- no local bridge needed.
    return `wss://${loc.host}/presage`;
  }
  const port = params.get('bridgePort') || 8787;
  return `ws://${params.get('host') || loc.hostname}:${port}/biometrics`;
}

// The guest's own real (Presage) readings get forwarded to the host; the host only accepts them
// for the guest's player number, so the guest can't overwrite the host's own player.
export function isForwardableSample(sample, myPlayer) {
  return !!sample && sample.source === 'presage' && sample.player === myPlayer;
}
export function acceptGuestSample(sample, guestPlayer) {
  if (!sample || sample.player !== guestPlayer) return null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const hr = num(sample.hr);
  if (hr === null) return null;
  return {
    player: guestPlayer, t: Date.now(), hr,
    breath: num(sample.breath) ?? 14, stress: num(sample.stress) ?? 0, calm: num(sample.calm) ?? 1,
    source: 'presage',
  };
}
