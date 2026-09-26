import './mechanics.config.js'; // load B's overrides (no-op stub for now)
import { initInput } from './input.js';
import { initBiometrics } from './biometrics.js';
import { runLoop } from './game.js';
import { render } from './render.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

initInput();
initBiometrics();

runLoop({
  onRender: (match) => render(ctx, match),
});

// Debug hotkeys for forcing mock biometric states (see CONTRACT.md #6).
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === '1') window.__forceBiometricState(1, 'stressed');
  if (k === '2') window.__forceBiometricState(2, 'stressed');
  if (k === 'q') window.__forceBiometricState(1, 'calm');
  if (k === 'p') window.__forceBiometricState(2, 'calm');
  if (k === '0') { window.__forceBiometricState(1, null); window.__forceBiometricState(2, null); }
});
