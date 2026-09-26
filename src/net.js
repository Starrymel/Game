// Two-laptop play. One laptop is the authoritative "host" (runs the real
// stepMatch()), the other is a "guest": it never simulates, only sends its
// own local player's input and renders whatever state the host sends back.
// This sidesteps deterministic-lockstep desync entirely (see CONTRACT.md) --
// there's exactly one place gameplay math ever runs.
import { setRemoteInput, readInput } from './input.js';
import { bus } from './eventBus.js';
import { isForwardableSample, acceptGuestSample } from './netconfig.js';

const INPUT_SEND_HZ = 60;

let role = 'local'; // 'local' | 'host' | 'guest'
let socket = null;
let localPlayer = 1;
let remotePlayer = 2;
let onRemoteState = null;
let onRestartRequested = null;
let sendTimer = null;

export const isNetHost = () => role === 'host';
export const isNetGuest = () => role === 'guest';
export const getLocalPlayer = () => localPlayer;

// Set by game.js's runLoop once it exists (guest: how to render a received
// state; host: how to apply a guest's restart request) -- connectNet() is
// called before the match/render loop exists, so these can't be passed in upfront.
export const setStateHandler = (fn) => { onRemoteState = fn; };
export const setRestartHandler = (fn) => { onRestartRequested = fn; };

export function connectNet({ relayUrl, asRole, myPlayer }) {
  role = asRole;
  localPlayer = myPlayer;
  remotePlayer = myPlayer === 1 ? 2 : 1;

  const url = new URL(relayUrl);              // may already carry ?room=
  url.searchParams.set('role', asRole);
  socket = new WebSocket(url.toString());

  socket.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.type === 'input' && role === 'host') {
      setRemoteInput(remotePlayer, msg.input);
    } else if (msg.type === 'state' && role === 'guest') {
      onRemoteState?.(msg.state);
    } else if (msg.type === 'restart' && role === 'host') {
      onRestartRequested?.();
    } else if (msg.type === 'bio' && role === 'host') {
      // The guest's own camera readings (computed by the guest's local Presage bridge).
      const sample = acceptGuestSample(msg.sample, remotePlayer);
      if (sample) bus.emit('biometric_sample', sample);
    }
  };
  socket.onerror = (e) => console.warn(`[net] ${role} socket error`, e);
  socket.onclose = () => console.warn(`[net] ${role} socket closed`);

  if (role === 'guest') {
    socket.onopen = () => {
      sendTimer = setInterval(() => {
        send({ type: 'input', input: readInput(localPlayer) });
      }, 1000 / INPUT_SEND_HZ);
    };
    // This laptop's local bridge produces readings for our player; the host runs the game, so send them there.
    bus.on('biometric_sample', (sample) => {
      if (isForwardableSample(sample, localPlayer)) send({ type: 'bio', sample });
    });
  }

  return socket;
}

function send(msg) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

// Host calls this every tick/frame with the authoritative state for the guest to render.
export function broadcastState(state) {
  if (role === 'host') send({ type: 'state', state });
}

// Guest calls this when the local player presses restart -- only the host's
// stepMatch is real, so the guest can't reset the match itself.
export function requestRestart() {
  if (role === 'guest') send({ type: 'restart' });
}

export function disconnectNet() {
  clearInterval(sendTimer);
  socket?.close();
  socket = null;
  role = 'local';
}
