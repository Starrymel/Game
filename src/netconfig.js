// Owner: D. Where the browser connects for two-player play and for the Presage bridge.
// Pure functions (no DOM access) so they can be unit tested.
//
// Two setups are supported:
//  * Same Wi-Fi (page is http://): relay on the host laptop (port 8788, or ?relayPort=), and the host laptop's
//    bridge on port 8787 -- the guest streams its camera to it (?host=<host address>).
//  * Hosted site (page is https://, e.g. Render): the relay is the site itself at /netplay, and EVERY laptop
//    runs its own bridge, reached at localhost. The camera video never leaves the laptop -- only the small
//    heart-rate readings travel, through the relay. NOTE: every browser blocks plain ws:// from an https://
//    page as mixed content, even to localhost (confirmed: Chromium #40386732, Firefox bug 1376309, reproduces
//    in Safari) -- so the bridge also runs a wss:// listener with a self-signed cert on a separate port
//    (see bridge/server.js). Visit https://localhost:<port> once per laptop and accept the certificate
//    warning before this will connect.

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
    // Plain ws:// from an https page is blocked as mixed content in every
    // browser, even to localhost -- see bridge/server.js's wss:// listener.
    const wssPort = params.get('bridgeWssPort') || 8790;
    return `wss://localhost:${wssPort}/biometrics`;
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
