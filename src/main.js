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
import { initPresageChip } from './presageAuto.js';
import { initPresagePanel } from './ui/presagePanel.js';
import { initBlinkLab } from './ui/blinkLab.js';
import { initFaceLab } from './ui/faceLab.js';
import { initFaceOverlay } from './ui/faceOverlay.js';
import { createFaceControl } from './face/faceControl.js';
import { connectNet } from './net.js';
import { initNetStatus } from './ui/netStatus.js';
import { initLobby } from './ui/lobby.js';
import { initRoundEnd } from './ui/roundEnd.js';
import { needsLobby } from './lobbyConfig.js';
import { setPrizeEnabled } from './prize.js';
import { setHazardEnabled } from './hazard.js';
import { relayUrlFor, bridgeUrlFor } from './netconfig.js';
import { setBotEnabled } from './bot.js';

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

// A plain visit shows the start screen (pick Player 1 / Player 2 + room code); the game itself only starts once
// the link says how to play: ?role=host|guest (online), ?local=1 (this laptop only) or ?lobby=0.
function startGame() {
  if (role === 'host' || role === 'guest') {
    // URL choice (same Wi-Fi vs hosted https site, ?host=, ?room=) lives in netconfig.js.
    connectNet({ relayUrl: relayUrlFor(location, params), asRole: role, myPlayer: player });
    initNetStatus();   // "waiting for the other player", "connection lost", "seat taken", and a Leave button
  }

  // Falling prize on by default; ?prize=0 turns it off. Only the host simulates it (the guest just draws it).
  setPrizeEnabled(params.get('prize') !== '0');
  // Falling swords (avoid them or lose HP): on by default; ?swords=0 turns them off. Same host-only simulation.
  setHazardEnabled(params.get('swords') !== '0');
  // Solo play (?local=1&solo=1, chosen from the lobby's "Play solo" card): Player 2 is bot-controlled
  // (moves, attacks, sometimes blocks) instead of needing a second person on the keyboard. See bot.js.
  setBotEnabled(params.get('solo') === '1', 2);

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
  const presageCapture = res >= 160 ? { width: res, height: Math.round(res * 3 / 4) } : {};
  // ?debug=1 shows the developer panels (Presage camera setup, Biofeedback lab); players do not need them.
  const debug = !!params.get('debug');
  if (debug) initPresagePanel({ wsUrl: bridgeWsUrl, capture: presageCapture });
  let faceReady = Promise.resolve();   // Presage waits for the face controls to grab the camera first (one permission prompt, no clash)
  // Face controls (MediaPipe, in this browser: no bridge, works on the hosted site and for the guest too).
  // They start automatically with a short calibration; ?face=0 turns them off, or use the chip at the bottom left.
  if (params.get('face') !== '0') {
    const faceControl = createFaceControl({ player });
    window.__faceControl = faceControl;
    // ?calCountdown=<seconds> shortens the calibration countdowns (for testing); the default is 10 s per step.
    const cal = Number(params.get('calCountdown'));
    initFaceOverlay({ control: faceControl, player, ...(cal > 0 ? { countdownMs: cal * 1000, comfortMs: cal * 1000, comfortReturningMs: cal * 1000, holdMs: Math.min(3, cal) * 1000 } : {}) });
    if (params.get('facelab')) initFaceLab({ player, control: faceControl });
    if (faceControl.settings.enabled) {
      faceControl.start();
      faceReady = new Promise((resolve) => {
        const off = bus.on('face_status', (st) => { if (st.player === player && st.status !== 'loading') { off(); resolve(); } });
        setTimeout(() => { off(); resolve(); }, 8000);      // never wait forever
      });
    }
  }
  // Presage: starts by itself (real heart rate from this laptop's camera) when its bridge is running; ?presage=0 turns it off.
  if (params.get('presage') !== '0') {
    initPresageChip({ player, wsUrl: bridgeWsUrl, capture: presageCapture, needsCert: location.protocol === 'https:', after: faceReady });
  }
  if (params.get('blinklab')) initBlinkLab({ player, fire: params.get('blinkfire') !== '0' });

  // End of round: smile = play again, raise eyebrows = back to the start screen (also buttons; R and Esc).
  const roundEnd = initRoundEnd({ faceControl: window.__faceControl || null, player });
  const match = runLoop({
    onRender: (match) => { render(ctx, match); roundEnd.update(!!match.over); },
  });
  window.__match = match; // debug/tests
  if (match && debug) initDebugPanel(match); // Only the host owns mutable game state. Developer tool: ?debug=1

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
}

if (needsLobby(params)) {
  // The start screen can be run with the face too (tilt to move, eyebrows or a smile to pick).
  // ?lobbyFast=1 speeds up the face pace on this screen (for testing only).
  initLobby({ faceControl: params.get('face') !== '0' ? createFaceControl({ player: 1 }) : null, pace: params.get('lobbyFast') ? { warmupMs: 800, baselineMs: 400, moveHoldMs: 200, repeatMs: 350, gapToleranceMs: 100, settleMs: 500, selectHoldMs: 400 } : {} });
}
else startGame();
