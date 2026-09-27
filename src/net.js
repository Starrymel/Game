// Two-laptop play. One laptop is the authoritative "host" (runs the real
// stepMatch()), the other is a "guest": it never simulates, only sends its
// own local player's input and renders whatever state the host sends back.
// This sidesteps deterministic-lockstep desync entirely (see CONTRACT.md) --
// there's exactly one place gameplay math ever runs.
import { isLocalHold, setPeerHold, onLocalHoldChange } from './hold.js';
import { setRemoteInput, readInput } from './input.js';
import { bus } from './eventBus.js';
import { isForwardableSample, acceptGuestSample } from './netconfig.js';
import { acceptSourceFor } from './biometrics.js';

const INPUT_SEND_HZ = 60;

let role = 'local'; // 'local' | 'host' | 'guest'
let socket = null;
let localPlayer = 1;
let remotePlayer = 2;
let onRemoteState = null;
let onRestartRequested = null;
let sendTimer = null;
let baseUrl = null;
let roomName = '';
let state = 'idle';          // idle | connecting | open | closed | rejected
let rejectedCode = null;
let peerKnown = false;       // the relay has told us who is in the other seat (the same-Wi-Fi relay never does)
let peerPresent = false;
let retryTimer = null;
let retryDelay = 1000;
let takenTries = 0;
let wanted = false;

export const isNetHost = () => role === 'host';
export const isNetGuest = () => role === 'guest';
export const getLocalPlayer = () => localPlayer;
// The host holds the match still until the other player is in the room (only when the relay reports presence).
export const isNetWaiting = () => role === 'host' && peerKnown && !peerPresent;
export const getNetInfo = () => ({ role, room: roomName, state, rejectedCode, peerKnown, peerPresent, localPlayer });

// Set by game.js's runLoop once it exists (guest: how to render a received
// state; host: how to apply a guest's restart request) -- connectNet() is
// called before the match/render loop exists, so these can't be passed in upfront.
export const setStateHandler = (fn) => { onRemoteState = fn; };
export const setRestartHandler = (fn) => { onRestartRequested = fn; };

function setState(next, extra = {}) {
  state = next;
  bus.emit('net_status', { ...getNetInfo(), ...extra });
}

function handleMessage(evt) {
  let msg;
  try { msg = JSON.parse(evt.data); } catch (_) { return; }
  if (msg.type === 'peer') {
    takenTries = 0;                            // the relay gave us the seat (a refused connection never gets this far)
    peerKnown = true; peerPresent = !!msg.present;
    if (!peerPresent) setPeerHold(false);
    if (peerPresent && isLocalHold()) send({ type: 'hold', on: true });   // the other one just arrived: tell them we are still calibrating
    bus.emit('net_peer', { present: peerPresent });
    bus.emit('net_status', getNetInfo());
  } else if (msg.type === 'input' && role === 'host') {
    setRemoteInput(remotePlayer, msg.input);
  } else if (msg.type === 'state' && role === 'guest') {
    onRemoteState?.(msg.state);
  } else if (msg.type === 'hold') {
    setPeerHold(!!msg.on);
  } else if (msg.type === 'restart' && role === 'host') {
    onRestartRequested?.();
  } else if (msg.type === 'bio' && role === 'host') {
    // The guest's own camera readings (computed by the guest's local Presage bridge).
    const sample = acceptGuestSample(msg.sample, remotePlayer);
    if (sample) {
      // Real readings for the guest's player: use them instead of this laptop's mock data
      // (sources are per player, so the host starting its own camera doesn't cover the guest).
      acceptSourceFor(sample.player, 'presage');
      bus.emit('biometric_sample', sample);
    }
  }
}

function openSocket() {
  if (!wanted || !baseUrl) return;
  const url = new URL(baseUrl);              // may already carry ?room=
  url.searchParams.set('role', role);
  setState('connecting');
  const ws = new WebSocket(url.toString());
  socket = ws;
  ws.onopen = () => { if (socket !== ws) return; retryDelay = 1000; setState('open'); };
  ws.onmessage = (evt) => { if (socket === ws) handleMessage(evt); };
  ws.onerror = (e) => console.warn(`[net] ${role} socket error`, e);
  ws.onclose = (evt) => {
    if (socket !== ws) return;
    socket = null;
    peerPresent = false;
    if (!wanted) return;
    if (evt.code === 4001) {
      // "Seat taken". A page reload can race its own old connection, so try a few times before giving up.
      if (++takenTries <= 3) { retryTimer = setTimeout(openSocket, 700); return; }
      rejectedCode = 4001; setState('rejected'); return;
    }
    if (evt.code === 1008 || evt.code === 1013) { rejectedCode = evt.code; setState('rejected'); return; }
    setState('closed');
    retryTimer = setTimeout(openSocket, retryDelay);           // Render restarted, Wi-Fi blip, ...: keep trying
    retryDelay = Math.min(retryDelay * 1.6, 6000);
  };
}

export function connectNet({ relayUrl, asRole, myPlayer }) {
  role = asRole;
  localPlayer = myPlayer;
  remotePlayer = myPlayer === 1 ? 2 : 1;
  baseUrl = relayUrl;
  try { roomName = new URL(relayUrl).searchParams.get('room') || 'default'; } catch (_) { roomName = 'default'; }
  wanted = true; peerKnown = false; peerPresent = false; takenTries = 0; retryDelay = 1000; rejectedCode = null;
  openSocket();
  onLocalHoldChange((on) => send({ type: 'hold', on }));

  if (role === 'guest') {
    // Input goes out at a steady rate whenever the connection is up (send() skips while it is down).
    sendTimer = setInterval(() => {
      send({ type: 'input', input: readInput(localPlayer) });
    }, 1000 / INPUT_SEND_HZ);
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
  wanted = false;
  clearInterval(sendTimer);
  clearTimeout(retryTimer);
  const ws = socket; socket = null;
  ws?.close();
  role = 'local'; peerKnown = false; peerPresent = false; state = 'idle';
}
