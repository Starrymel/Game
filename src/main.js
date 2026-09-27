import { initMusic } from './music.js';
import './logging/logger.js'; // D: subscribe before round_start
import './mechanics.config.js'; // B: biometric mechanics
import { initInput } from './input.js';
import { initBiometrics } from './biometrics.js';
import { startPresageCapture, listCameraDevices } from './presage-capture.js';
import { runLoop } from './game.js';
import { render } from './render.js';
import { bus } from './eventBus.js';
import { initCommentary } from './commentary/index.js';
import { initDebugPanel } from './ui/debugPanel.js';
import { initPresagePanel } from './ui/presagePanel.js';
import { initBlinkLab } from './ui/blinkLab.js';
import { initFaceLab } from './ui/faceLab.js';
import { initFaceOverlay } from './ui/faceOverlay.js';
import { createFaceControl } from './face/faceControl.js';
import { connectNet } from './net.js';
import { setPrizeEnabled } from './prize.js';
import { relayUrlFor, bridgeUrlFor } from './netconfig.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

// Two-laptop play: load this same page as
//   http://<host-ip>:<port>/?role=host&player=1   (on the host laptop)
//   http://<host-ip>:<port>/?role=guest&player=2  (on the second laptop)
// Needs netplay/server.js running on the host (see netplay/README.md).
// Omit ?role entirely for normal single-laptop, one-keyboard, two-player play.
//
// If the guest also wants its own camera for real Presage data, getUserMedia
// requires a secure context (HTTPS or localhost) -- a plain http://<host-ip>
// page loaded on a *different* machine doesn't qualify. In that case the
// guest instead runs its own local copy of this same repo served on its own
// localhost, and must pass &host=<host-ip> explicitly since location.hostname
// would otherwise (wrongly) resolve to its own machine, not the host's.
const params = new URLSearchParams(location.search);
const role = params.get('role'); // 'host' | 'guest' | null
const player = Number(params.get('player')) || (role === 'guest' ? 2 : 1);

if (role === 'host' || role === 'guest') {
  // URL choice (same Wi-Fi vs hosted https site, ?host=, ?room=) lives in netconfig.js.
  connectNet({ relayUrl: relayUrlFor(location, params), asRole: role, myPlayer: player });
}

// Falling prize on by default; ?prize=0 turns it off. Only the host simulates it (the guest just draws it).
setPrizeEnabled(params.get('prize') !== '0');

initMusic();
initInput();
initBiometrics();
// Commentary must subscribe before runLoop() so it hears the first round_start.
window.__commentary = initCommentary({ bus });

// Where the Presage bridge is: on the host laptop when on the same Wi-Fi (?host=<address>), or on THIS laptop
// (localhost) when the page is the hosted https site. See netconfig.js.
const bridgeWsUrl = bridgeUrlFor(location, params);
// ?presageRes=640 sends 640x480 frames (default 320x240) -- face details like blinks may need more pixels.
const res = Number(params.get('presageRes'));
initPresagePanel({ wsUrl: bridgeWsUrl, capture: res >= 160 ? { width: res, height: Math.round(res * 3 / 4) } : {} });
// Face controls (MediaPipe, in this browser: no bridge, works on the hosted site and for the guest too).
// They start automatically with a short calibration; ?face=0 turns them off, or use the chip at the bottom left.
if (params.get('face') !== '0') {
  const faceControl = createFaceControl({ player });
  window.__faceControl = faceControl;
  initFaceOverlay({ control: faceControl, player });
  if (params.get('facelab')) initFaceLab({ player, control: faceControl });
  if (faceControl.settings.enabled) faceControl.start();
}
if (params.get('blinklab')) initBlinkLab({ player, fire: params.get('blinkfire') !== '0' });

const match = runLoop({
  onRender: (match) => render(ctx, match),
});
window.__match = match; // debug/tests
if (match) initDebugPanel(match); // Only the host owns mutable game state.

// Debug hotkeys for forcing mock biometric states (see CONTRACT.md #6).
window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, button, textarea, select')) return;
  const k = e.key.toLowerCase();
  if (k === '1') window.__forceBiometricState(1, 'stressed');
  if (k === '2') window.__forceBiometricState(2, 'stressed');
  if (k === 'q') window.__forceBiometricState(1, 'calm');
  if (k === 'p') window.__forceBiometricState(2, 'calm');
  if (k === '0') { window.__forceBiometricState(1, null); window.__forceBiometricState(2, null); }
});

// Presage setup: use the always-visible "Presage camera setup" panel above
// (needs a running bridge + camera permission + API key), or drive it by
// hand from the console -- both call the same functions:
//   await window.__listCameraDevices()
//   window.__setBiometricsSource('presage')
//   await window.__startPresageCapture(1, { deviceId })
window.__listCameraDevices = listCameraDevices;
window.__startPresageCapture = startPresageCapture;
