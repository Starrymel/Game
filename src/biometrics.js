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

let source = 'mock';

bus.on('biometric_sample', (sample) => {
  // Mock keeps running in the background (see __setBiometricsSource below),
  // so without this gate its 10Hz updates would keep drowning out Presage's
  // much sparser real samples -- whichever arrived most recently would win,
  // and mock always arrives most recently.
  if (sample.source !== source) return;
  target[sample.player] = sample;
});

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

// Exposed on window so anyone (debug panel, console) can flip the source live.
window.__setBiometricsSource = (next) => {
  if (next === source) return;
  source = next;
  if (next === 'presage') {
    stopMockBiometrics();
    startPresageBiometrics();
  } else {
    startMockBiometrics();
  }
};
window.__forceBiometricState = forceMockState; // (player, 'stressed'|'calm'|null)
