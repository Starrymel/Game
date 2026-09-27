import { startMockBiometrics, stopMockBiometrics, forceMockState } from './biometrics-mock.js';
import { startPresageBiometrics } from './biometrics-presage.js';
import { bus } from './eventBus.js';

// Real sensor readings (mock or Presage) arrive as sparse "biometric_sample"
// events — Presage in particular may only update every few seconds, since HR
// needs a few seconds of trailing video and breathing/HRV need 30-60s
// confidence windows. Gameplay code still wants a value every physics tick
// (60/sec), so each incoming sample is treated as a moving target and
// exponentially smoothed toward on every tick via advanceBiometricsSmoothing().
// getBiometrics() always returns the current smoothed value, never the raw one.
const SMOOTH_TAU_SECONDS = 0.35; // lower = snappier/more per-hit-like, higher = smoother/slower

const target = { 1: null, 2: null };
const smoothed = {
  1: { hr: 75, breath: 14, stress: 0, calm: 1, source: 'mock' },
  2: { hr: 75, breath: 14, stress: 0, calm: 1, source: 'mock' },
};

// Per player, so one camera on P1 doesn't freeze P2 (who has no camera and would
// otherwise get no samples at all).
const sourceFor = { 1: 'mock', 2: 'mock' };

bus.on('biometric_sample', (sample) => {
  // Mock keeps running in the background for whoever still uses it, so without
  // this gate its 10Hz updates would keep drowning out Presage's much sparser
  // real samples -- whichever arrived most recently would win, and mock always
  // arrives most recently.
  if (sample.source !== sourceFor[sample.player]) return;
  target[sample.player] = sample;
});

export function getBiometricsSource(player) {
  return sourceFor[player];
}

// Accept one player's readings from `next` without opening any connection. Used by the
// netplay host: the guest's camera readings arrive over the relay (not from this
// laptop's bridge), and must not be filtered out as "not the selected source".
export function acceptSourceFor(player, next) {
  if (sourceFor[player] === next) return;
  sourceFor[player] = next;
  target[player] = null;
}

function lerp(cur, dest, dtSeconds) {
  const k = 1 - Math.exp(-dtSeconds / SMOOTH_TAU_SECONDS);
  return cur + (dest - cur) * k;
}

// Call once per physics tick (see game.js stepMatch) so smoothed values move
// every frame even when real samples arrive rarely.
export function advanceBiometricsSmoothing(dtSeconds) {
  for (const id of [1, 2]) {
    const dest = target[id];
    if (!dest) continue;
    const s = smoothed[id];
    s.hr = lerp(s.hr, dest.hr, dtSeconds);
    s.breath = lerp(s.breath, dest.breath, dtSeconds);
    s.stress = lerp(s.stress, dest.stress, dtSeconds);
    s.calm = lerp(s.calm, dest.calm, dtSeconds);
    s.source = dest.source;
  }
}

export function getBiometrics(player) {
  return { player, t: Date.now(), ...smoothed[player] };
}

export function initBiometrics() {
  startMockBiometrics();
  // startPresageBiometrics() is opt-in via __setBiometricsSource once the bridge exists.
}

// Switch one player's source ('mock' | 'presage'), or both when player is omitted.
// wsUrl: where Presage readings come from -- must be the same bridge the camera
// frames go to (wss:// on the hosted https site, the host's address on LAN play).
export function setBiometricsSource(next, { player, wsUrl } = {}) {
  const players = player ? [player] : [1, 2];
  for (const id of players) {
    sourceFor[id] = next;
    target[id] = null; // don't keep steering toward the old source's last value
  }
  if (next === 'presage') startPresageBiometrics(wsUrl);
  if (sourceFor[1] === 'presage' && sourceFor[2] === 'presage') stopMockBiometrics();
  else startMockBiometrics(); // no-op if already running
}

// Exposed on window so anyone (debug panel, console) can flip the source live:
//   __setBiometricsSource('presage')        both players
//   __setBiometricsSource('presage', 1)     just player 1
window.__setBiometricsSource = (next, player, wsUrl) => setBiometricsSource(next, { player, wsUrl });
window.__forceBiometricState = forceMockState; // (player, 'stressed'|'calm'|null)
