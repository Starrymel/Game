import { bus } from './eventBus.js';

// Sine + noise generator per player, with keyboard-forced override states so
// the mechanic can be demoed on demand without waiting on real sensors.
const SAMPLE_HZ = 10;
const HR_BASE = 75, HR_AMPLITUDE = 8;
const BREATH_BASE = 14, BREATH_AMPLITUDE = 3;

function makePlayerState(seedOffset) {
  return {
    seedOffset,
    forced: null, // null | 'stressed' | 'calm'
    lastSample: null,
  };
}

const players = {
  1: makePlayerState(0),
  2: makePlayerState(1.7),
};

function noise(amount) {
  return (Math.random() - 0.5) * 2 * amount;
}

function sample(id, t) {
  const st = players[id];
  const phase = t / 1000 + st.seedOffset;

  let hr = HR_BASE + Math.sin(phase * 0.3) * HR_AMPLITUDE + noise(4);
  let breath = BREATH_BASE + Math.sin(phase * 0.15) * BREATH_AMPLITUDE + noise(1.5);
  let stress = 0.3 + Math.sin(phase * 0.2) * 0.15 + noise(0.05);

  // occasional random spike, independent of forced state
  if (Math.random() < 0.01) {
    hr += 25;
    stress += 0.3;
  }

  if (st.forced === 'stressed') {
    hr += 30;
    breath += 8;
    stress = Math.min(1, stress + 0.45);
  } else if (st.forced === 'calm') {
    hr -= 15;
    breath -= 5;
    stress = Math.max(0, stress - 0.35);
  }

  hr = clamp(hr, 45, 190);
  breath = clamp(breath, 6, 34);
  stress = clamp(stress, 0, 1);
  const calm = clamp(1 - stress + noise(0.05), 0, 1);

  const s = { player: id, t, hr, breath, stress, calm, source: 'mock' };
  st.lastSample = s;
  return s;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function getMockBiometrics(id) {
  return players[id].lastSample ?? sample(id, Date.now());
}

export function forceMockState(id, state) {
  players[id].forced = state; // 'stressed' | 'calm' | null
}

let timer = null;
export function startMockBiometrics() {
  if (timer) return;
  const tick = () => {
    const t = Date.now();
    for (const id of [1, 2]) {
      const s = sample(id, t);
      bus.emit('biometric_sample', s);
    }
  };
  tick();
  timer = setInterval(tick, 1000 / SAMPLE_HZ);
}

export function stopMockBiometrics() {
  clearInterval(timer);
  timer = null;
}
