# Two-laptop play

One laptop ("host") runs the real simulation. The other ("guest") never
simulates — it only sends its own player's keypresses over the network and
renders whatever state the host sends back. This avoids deterministic-lockstep
desync entirely (see `CONTRACT.md` for why two independent simulations would
drift apart): there is exactly one place gameplay math ever runs.

## Setup

**On the host laptop** (this is the one whose camera/keyboard controls
player 1, and whose IP the guest will connect to):

```bash
cd netplay
npm install
npm start                      # relay on ws://0.0.0.0:8788/netplay
```

In another terminal, serve the game itself however you already do (e.g.
`python3 -m http.server 8532`, or `node server/index.js` once D's backend is
up). Find the host's LAN IP (`ipconfig getifaddr en0` on Mac, or check System
Settings > Wi-Fi).

Open on the **host laptop**:
```
http://localhost:8532/?role=host&player=1
```

Open on the **guest laptop**:
```
http://<host-LAN-IP>:8532/?role=guest&player=2
```

The guest loads the game's static files from the host's web server, then
connects its own WebSocket to the host's relay on port 8788 (derived
automatically from whatever hostname it loaded the page from — no manual IP
entry beyond the URL you already typed).

Omit `?role` entirely (just open the page normally) for the original
single-laptop, one-keyboard, two-player mode — nothing about that path
changed.

## What's synced vs. local

- **Inputs**: guest sends its own keypresses (P2's bindings, read locally on
  the guest's own keyboard) to the host ~60/sec. Host substitutes them for
  local input reads via `src/input.js`'s remote-override — see
  `readInput(2)` there.
- **Game state**: host broadcasts full render-relevant state every frame
  (`buildNetState()` in `src/game.js`) — HP, meter, position, attack flash,
  biometrics. Guest reconstructs a fake `match` object
  (`matchFromNetState()`) and renders it exactly like the real thing.
- **Biometrics**: each laptop's mock generator or Presage camera feeds
  whichever player ID the *host* asks for — for mock data this "just works"
  since it's synthetic per-ID regardless of which physical machine is
  attached. For **real Presage data with two laptops**, point the guest's
  camera capture at the host's bridge over LAN:
  `window.__startPresageCapture(2, { deviceId, wsUrl: 'ws://<host-LAN-IP>:8787/biometrics' })`
  — no code changes needed, `presage-capture.js` already takes a `wsUrl`.
- **Restart**: pressing `R` on the guest sends a restart request to the host
  (only the host's match is real); pressing `R` on the host resets directly,
  same as always.

## Known limitations (read before demo)

- **Not tested across two physical machines or real network conditions** —
  everything above was verified with a fake WebSocket client and headless
  game-logic tests in this environment (no second laptop available here).
  The relay's pass-through, duplicate-connection handling, and bad-role
  rejection were tested for real; the actual two-browser, real-LAN,
  real-input-latency experience has not been.
- No reconnect logic — if the guest's socket drops, its input goes stale
  after 400ms (falls back to neutral, not stuck-key) but there's no automatic
  re-pairing. Reload the guest page to reconnect.
- No client-side prediction — the guest renders exactly what the host last
  sent, once per host frame (~60/sec). On a normal LAN this should be small
  and likely imperceptible, but if it feels laggy in practice, that's the
  first thing to add (predict the guest's own player's movement locally,
  reconcile against host state, while keeping hit resolution host-authoritative).
- Use a direct/low-traffic LAN connection if possible (phone hotspot,
  ad-hoc network, ethernet) rather than congested venue wifi — latency and
  jitter both come straight out of "smooth and reactive."
