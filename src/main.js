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
import { connectNet } from './net.js';

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
  const netHost = params.get('host') || location.hostname;
  // On an HTTPS page browsers only allow wss://, so use the page's own address (the server proxies /netplay).
  // ?host=<address> still overrides where to connect.
  const relayUrl = location.protocol === 'https:'
    ? `wss://${params.get('host') || location.host}/netplay`
    : `ws://${netHost}:${params.get('relayPort') || 8788}/netplay`;
  connectNet({ relayUrl, asRole: role, myPlayer: player });
}

initInput();
initBiometrics();
// Commentary must subscribe before runLoop() so it hears the first round_start.
window.__commentary = initCommentary({ bus });

// Same host-detection ?host=<address> pattern as the netplay relay above, so
// the guest's camera panel talks to the host's bridge with no manual URL
// typing. Bridge isn't behind the HTTPS proxy (that's netplay-only so far),
// so this stays ws:// even on an https page -- override wsUrl by hand if
// that changes.
const bridgeHost = params.get('host') || location.hostname;
const bridgeWsUrl = `ws://${bridgeHost}:${params.get('bridgePort') || 8787}/biometrics`;
initPresagePanel({ wsUrl: bridgeWsUrl });

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

// Presage setup: use the always-visible "Presage camera setup" panel above
// (needs a running bridge + camera permission + API key), or drive it by
// hand from the console -- both call the same functions:
//   await window.__listCameraDevices()
//   window.__setBiometricsSource('presage')
//   await window.__startPresageCapture(1, { deviceId })
window.__listCameraDevices = listCameraDevices;
window.__startPresageCapture = startPresageCapture;
