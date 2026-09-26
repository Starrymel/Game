# Presage bridge

Browser has no SmartSpectra SDK, so this tiny Node service is the real vitals
extractor: it takes webcam frames over WebSocket and runs them through
`@smartspectra/node-sdk` (on-device inference), then broadcasts decoded
`{player, hr, breath, stress, calm}` back over the same connection.

## Setup

```bash
cd bridge
npm install
npm start
```

The key is read from the project's main `.env` (`PRESAGE_API_KEY=...`, get one at
https://physiology.presagetech.com/auth/login). A `bridge/.env` or a real environment
variable overrides it. On startup the bridge prints where it found the key, e.g.
`PRESAGE_API_KEY loaded from ../.env (abcd…)`; if it says "not set", the camera will
stream but no heart rate will ever come back.

In the game, open **Presage camera setup** and click **Start camera -> Player N**.
Only that player switches to the camera (the other keeps mock data). The panel shows
live status per player: bridge unreachable / waiting for first reading (with the SDK's
hint, e.g. "No face found") / current bpm. The first reading needs your face in view
and fairly still for several seconds.

Listens on `ws://localhost:8787/biometrics` by default (matches
`src/biometrics-presage.js` on the browser side — no code change needed
there). It also starts a `wss://localhost:8790/biometrics` listener with a
self-signed cert generated automatically on first run.

### Using the deployed (HTTPS) game site

Every browser blocks a plain `ws://` connection from an `https://` page as
mixed content — even to `localhost` (confirmed: open Chromium issue
[#40386732](https://issues.chromium.org/issues/40386732), Firefox
[bug 1376309](https://bugzilla.mozilla.org/show_bug.cgi?id=1376309),
reproduces in Safari too). So if you're playing on a deployed HTTPS site
(e.g. Render) rather than a local `http://` page, the game will try to
reach the bridge's **wss://** port instead — which needs one manual step
per laptop, the first time only:

1. Run the bridge as usual (`npm start` in this folder).
2. Visit `https://localhost:8790` directly in the same browser you'll play
   in, and click through the certificate warning (Safari: "visit this
   website"; Chrome: "Advanced" → "Proceed to localhost"). This is expected
   and normal for any local HTTPS dev server with a self-signed cert.
3. Reload the game page — its camera panel will now be able to connect.

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

## Confirmed working (tested end to end, not just against docs)

Real webcam -> real SmartSpectra inference -> real HR has been verified live:
decoded HR values changing over time, `validationStatus` reporting `kOk`
almost the entire session. Getting here required fixing several real bugs
that only showed up under real use, all fixed in `server.js` /
`src/presage-capture.js`:

- **Camera must actually deliver >=25fps.** SmartSpectra's own
  `validationStatus` event reports `kFrameRateTooLow` otherwise (its hint
  literally says so) — 8fps (the original default) was nowhere near enough
  for rPPG pulse extraction. Now requests 30fps from `getUserMedia` and
  captures via `requestVideoFrameCallback` (tied to actual decoded frames,
  won't drift or resend a stale frame under main-thread load) instead of a
  `setInterval` poll.
- **Frame timestamps must be microseconds, not milliseconds** — `sendFrame`'s
  last argument is named `timestampUs` for a reason. Getting this wrong
  doesn't error, it just silently starves the SDK's internal windowing.
- **`sendFrame()` can throw synchronously**, not just emit a recoverable
  `'error'` event like the docs implied — an internal processing error can
  leave a session in a state where the next frame crashes the whole process.
  Now wrapped in try/catch, with `sdk.reset()` attempted on `'error'` and a
  process-level `uncaughtException` handler as a last line of defense.
- Listen to `sdk.on('validationStatus', ...)` if something's not working —
  its codes (`kNoFaceFound`, `kFrameRateTooLow`, `kTooDark`, etc.) are far
  more diagnostic than the generic `kProcessingFailed` error alone.

## Known limitations

- HR updates roughly every ~10-15s in practice; breathing confidence needs a
  ~30s continuous good window, HRV ~60s (untested how long breathing/HRV
  actually take to appear — HR was confirmed, those two were not). The
  in-game smoothing layer (`src/biometrics.js`) turns these sparse updates
  into continuous per-frame values, but the underlying signal itself is
  still slow — don't expect per-hit reactivity from real biometrics.
- `stress`/`calm` aren't native SmartSpectra outputs. This bridge derives
  them from the Baevsky Stress Index (when available) or a resting-HR
  deviation heuristic otherwise (see `baevskyToStress()` / `restingHr` in
  `server.js`). Both are rough and meant to be retuned once you see real
  numbers — flag this to B.
- Two-camera setup (one per player) is still untested in practice.
