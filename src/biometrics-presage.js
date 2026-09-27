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
let connected = false;
const lastSampleAt = { 1: 0, 2: 0 };
const lastHint = { 1: null, 2: null };

// For the camera panel: is the bridge reachable, when did each player's last real
// reading arrive, and what the SDK last said about the video ("No face found", ...).
export function getPresageStatus() {
  return { connected, url: currentUrl, lastSampleAt: { ...lastSampleAt }, lastHint: { ...lastHint } };
}

function setConnected(next) {
  if (next === connected) return;
  connected = next;
  bus.emit('presage_connection', { connected, url: currentUrl });
}

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
  mine.onopen = () => { console.info('[presage] connected to the bridge'); setConnected(true); };
  mine.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    const s = state[msg?.player];
    if (!s) return;
    // Blink lab: face events (only sent when the bridge runs with PRESAGE_FACE=1).
    if (msg.type === 'face') { bus.emit('face_sample', msg); return; }
    // Bridge status updates (SDK validation hints, session errors) aren't readings.
    if (msg.type === 'status') {
      lastHint[msg.player] = msg.hint ?? null;
      bus.emit('presage_status', { player: msg.player, code: msg.code, hint: msg.hint, error: msg.error });
      return;
    }
    if (!Number.isFinite(msg.hr) && !Number.isFinite(msg.breath)) return;
    const { player, hr, breath, stress, calm } = msg; // expect { player, hr, breath, stress, calm }
    Object.assign(s, { hr, breath, stress, calm }, { t: Date.now() });
    lastSampleAt[player] = s.t;
    bus.emit('biometric_sample', { ...s, player, source: 'presage' });
  };
  // The bridge may not be running yet, or may be restarted mid-session: keep trying instead of giving up
  // (before, one failed attempt left the game on mock data even though the camera was streaming fine).
  // Browsers fire error AND close after a failed connection, but some runtimes (Node) fire only error,
  // so retry from both; scheduleRetry() is safe to call twice.
  mine.onerror = () => {
    console.warn('[presage] bridge not reachable, will keep retrying');
    if (socket === mine) { socket = null; setConnected(false); } // forget it: don't rely on readyState after an error
    try { mine.close(); } catch (_) { /* already closed */ }
    scheduleRetry();
  };
  mine.onclose = () => { if (socket === mine) { socket = null; setConnected(false); } scheduleRetry(); };
}

export function startPresageBiometrics(wsUrl = currentUrl, { retryAfterMs = 1500 } = {}) {
  // Readings must come from the same bridge the camera frames go to; if a different
  // bridge is requested (e.g. wss:// on the https site), drop the old connection.
  if (wsUrl !== currentUrl && socket) {
    const old = socket;
    socket = null;
    setConnected(false);
    try { old.close(); } catch (_) { /* already closed */ }
  }
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
  setConnected(false);
}
