// STUB — fill in once the Node/WebSocket bridge exists.
// See CONTRACT.md #7: no browser SDK, so this connects to a local Node
// process (running the SmartSpectra Node SDK) over WebSocket instead of
// calling Presage directly from the browser.
import { bus } from './eventBus.js';

const state = {
  1: { hr: null, breath: null, stress: 0, calm: 1, t: 0 },
  2: { hr: null, breath: null, stress: 0, calm: 1, t: 0 },
};

let socket = null;
let wanted = false;            // true while we should be connected to the bridge
let retryTimer = null;
let currentUrl = 'ws://localhost:8787/biometrics';
let retryMs = 1500;

export function getPresageBiometrics(id) {
  const s = state[id];
  return { player: id, t: s.t || Date.now(), hr: s.hr ?? 75, breath: s.breath ?? 14,
    stress: s.stress, calm: s.calm, source: 'presage' };
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  if (wanted) retryTimer = setTimeout(connect, retryMs);
}

function connect() {
  if (!wanted) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  try {
    socket = new WebSocket(currentUrl);
  } catch (e) {
    console.warn('[presage] failed to connect, retrying', e);
    scheduleRetry();
    return;
  }
  const mine = socket;
  mine.onopen = () => console.info('[presage] connected to the bridge');
  mine.onmessage = (evt) => {
    const msg = JSON.parse(evt.data); // expect { player, hr, breath, stress, calm }
    const s = state[msg.player];
    if (!s) return;
    Object.assign(s, msg, { t: Date.now() });
    bus.emit('biometric_sample', { ...s, player: msg.player, source: 'presage' });
  };
  // The bridge may not be running yet, or may be restarted mid-session: keep trying instead of giving up
  // (before, one failed attempt left the game on mock data even though the camera was streaming fine).
  // Browsers fire error AND close after a failed connection, but some runtimes (Node) fire only error,
  // so retry from both; scheduleRetry() is safe to call twice.
  mine.onerror = () => {
    console.warn('[presage] bridge not reachable, will keep retrying');
    if (socket === mine) socket = null;            // forget it: don't rely on the socket's readyState after an error
    try { mine.close(); } catch (_) { /* already closed */ }
    scheduleRetry();
  };
  mine.onclose = () => { if (socket === mine) socket = null; scheduleRetry(); };
}

export function startPresageBiometrics(wsUrl = 'ws://localhost:8787/biometrics', { retryAfterMs = 1500 } = {}) {
  currentUrl = wsUrl;
  retryMs = retryAfterMs;
  wanted = true;
  connect();               // no-op if already connected or connecting
}

export function stopPresageBiometrics() {
  wanted = false;
  clearTimeout(retryTimer);
  socket?.close();
  socket = null;
}
