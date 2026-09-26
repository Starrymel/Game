# Presage bridge

Browser has no SmartSpectra SDK, so this tiny Node service is the real vitals
extractor: it takes webcam frames over WebSocket and runs them through
`@smartspectra/node-sdk` (on-device inference), then broadcasts decoded
`{player, hr, breath, stress, calm}` back over the same connection.

## Setup

```bash
cd bridge
npm install
cp .env.example .env   # fill in PRESAGE_API_KEY from https://physiology.presagetech.com/auth/login
npm start
```

Listens on `ws://localhost:8787/biometrics` by default (matches
`src/biometrics-presage.js` on the browser side — no code change needed
there).

## Using it from the game

Open the browser console on the running game page:

```js
const devices = await window.__listCameraDevices(); // enumerate cameras
console.table(devices.map(d => ({ label: d.label, deviceId: d.deviceId })));

window.__setBiometricsSource('presage');
await window.__startPresageCapture(1, { deviceId: '<player 1 camera>' });
await window.__startPresageCapture(2, { deviceId: '<player 2 camera>' });
```

Two players need two distinct video sources — either two physical cameras,
or (fallback) one wide-angle camera cropped into two `startPresageCapture`
calls with different canvas crop regions (not implemented here; extend
`presage-capture.js`'s `drawImage` call with source-rect args if that's the
setup on demo day).

## Known limitations (read before demo)

- **Not tested against a real API key or camera in this environment** — the
  SDK package, its exports, and the frame/event API were verified directly
  against the installed package and official docs, but the full pipeline
  (real webcam → real SmartSpectra inference → real metrics) has not been
  run end to end. Budget time to test this for real before relying on it.
- HR updates roughly every few seconds (a few seconds of trailing video are
  needed per reading); breathing confidence needs ~30s, HRV ~60s. The
  in-game smoothing layer (`src/biometrics.js`) turns these sparse updates
  into continuous per-frame values, but the underlying signal itself is
  still slow — don't expect per-hit reactivity from real biometrics.
- `stress`/`calm` aren't native SmartSpectra outputs. This bridge derives
  them from the Baevsky Stress Index (when available) or a resting-HR
  deviation heuristic otherwise (see `baevskyToStress()` / `restingHr` in
  `server.js`). Both are rough and meant to be retuned once you see real
  numbers — flag this to B.
