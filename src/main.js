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
import { connectNet } from './net.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

// Two-laptop play: load this same page as
//   http://<host-ip>:<port>/?role=host&player=1   (on the host laptop)
//   http://<host-ip>:<port>/?role=guest&player=2  (on the second laptop)
// Needs netplay/server.js running on the host (see netplay/README.md).
// Omit ?role entirely for normal single-laptop, one-keyboard, two-player play.
const params = new URLSearchParams(location.search);
const role = params.get('role'); // 'host' | 'guest' | null
const player = Number(params.get('player')) || (role === 'guest' ? 2 : 1);

if (role === 'host' || role === 'guest') {
  const relayUrl = `ws://${location.hostname}:${params.get('relayPort') || 8788}/netplay`;
  connectNet({ relayUrl, asRole: role, myPlayer: player });
}

initInput();
initBiometrics();
// Commentary must subscribe before runLoop() so it hears the first round_start.
window.__commentary = initCommentary({ bus });

const match = runLoop({
  onRender: (match) => render(ctx, match),
});
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

// Opt-in Presage path (needs a running bridge + camera permission + API key):
//   await window.__listCameraDevices()               // pick deviceIds
//   window.__setBiometricsSource('presage')          // start listening for real metrics
//   await window.__startPresageCapture(1, { deviceId })  // start streaming P1's webcam
//   await window.__startPresageCapture(2, { deviceId })  // and P2's (second camera)
window.__listCameraDevices = listCameraDevices;
window.__startPresageCapture = startPresageCapture;
