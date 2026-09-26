import { getMockBiometrics, startMockBiometrics, forceMockState } from './biometrics-mock.js';
import { getPresageBiometrics, startPresageBiometrics } from './biometrics-presage.js';

let source = 'mock';

export function getBiometrics(player) {
  return source === 'presage' ? getPresageBiometrics(player) : getMockBiometrics(player);
}

export function initBiometrics() {
  startMockBiometrics();
  // startPresageBiometrics() is opt-in via __setBiometricsSource once the bridge exists.
}

// Exposed on window so anyone (debug panel, console) can flip the source live.
window.__setBiometricsSource = (next) => {
  if (next === 'presage') startPresageBiometrics();
  source = next;
};
window.__forceBiometricState = forceMockState; // (player, 'stressed'|'calm'|null)
