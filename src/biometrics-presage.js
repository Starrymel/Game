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

export function getPresageBiometrics(id) {
  const s = state[id];
  return { player: id, t: s.t || Date.now(), hr: s.hr ?? 75, breath: s.breath ?? 14,
    stress: s.stress, calm: s.calm, source: 'presage' };
}

export function startPresageBiometrics(wsUrl = 'ws://localhost:8787/biometrics') {
  try {
    socket = new WebSocket(wsUrl);
    socket.onmessage = (evt) => {
      const msg = JSON.parse(evt.data); // expect { player, hr, breath, stress, calm }
      const s = state[msg.player];
      if (!s) return;
      Object.assign(s, msg, { t: Date.now() });
      bus.emit('biometric_sample', { ...s, player: msg.player, source: 'presage' });
    };
    socket.onerror = () => console.warn('[presage] websocket error, staying on mock data');
  } catch (e) {
    console.warn('[presage] failed to connect, staying on mock data', e);
  }
}

export function stopPresageBiometrics() {
  socket?.close();
  socket = null;
}
