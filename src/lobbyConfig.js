// Pure helpers for the start screen (lobby): room codes, when to show the lobby, and the link that a choice becomes.
// Player 1 is the host (runs the match); Player 2 is the guest. The rest of the game already works from these params.

// One shared room for now. (?room=NAME in the link still overrides it, e.g. for testing or private games.)
export const DEFAULT_ROOM = 'MAIN';
export const ROOM_MAX = 20;
export const sanitizeRoom = (raw) => String(raw ?? '').replace(/[^\w-]/g, '').slice(0, ROOM_MAX).toUpperCase();

// Show the lobby on a plain visit. Any of these skip it: an online role in the link, ?local=1 (this laptop only), ?lobby=0.
export function needsLobby(params) {
  if (params.get('role')) return false;
  if (params.get('local') === '1' || params.get('lobby') === '0') return false;
  return true;
}

const ROUTING_PARAMS = ['role', 'player', 'room', 'lobby', 'local', 'relayPort'];

// The link to open for a choice: keeps unrelated params (?facelab=1 and friends), replaces the routing ones.
export function joinSearch(currentSearch, { player, room, relayPort } = {}) {
  const params = new URLSearchParams(currentSearch);
  const chosenRoom = sanitizeRoom(room ?? params.get('room')) || DEFAULT_ROOM;   // no typing: the shared room, unless the link names one
  for (const k of ROUTING_PARAMS) params.delete(k);
  params.set('role', Number(player) === 1 ? 'host' : 'guest');
  params.set('player', String(Number(player) === 1 ? 1 : 2));
  params.set('room', chosenRoom);
  if (relayPort) params.set('relayPort', String(relayPort));
  return '?' + params.toString();
}

export function localSearch(currentSearch) {
  const params = new URLSearchParams(currentSearch);
  for (const k of ROUTING_PARAMS) if (k !== 'room') params.delete(k);
  params.set('local', '1');
  return '?' + params.toString();
}

export function lobbySearch(currentSearch) {   // back to the start screen
  const params = new URLSearchParams(currentSearch);
  for (const k of ROUTING_PARAMS) params.delete(k);
  return params.toString() ? '?' + params.toString() : '';
}

// What the two seat buttons should say and whether they can be clicked, given who is in the room.
// status: { host, guest } | null (unknown: no status service, e.g. the same-Wi-Fi relay).
export function seatInfo(status) {
  const taken = (t) => ({ taken: !!t, label: t ? 'taken' : status ? 'free' : '' });
  return { 1: taken(status?.host), 2: taken(status?.guest) };
}

// Text shown while connected but not yet playing.
export function waitingText({ role, room, peerPresent }) {
  if (peerPresent) return '';
  const where = room && String(room).toUpperCase() !== DEFAULT_ROOM ? ` in room ${room}` : '';
  return role === 'host'
    ? `You are Player 1. Waiting for Player 2 to join${where}...`
    : `You are Player 2. Waiting for Player 1 to start${where}...`;
}

// The options on the start screen, left to right. Taken seats are skipped when moving the highlight.
export const OPTIONS = ['p1', 'p2', 'local'];
export function optionEnabled(id, status) {
  if (id === 'p1') return !status?.host;
  if (id === 'p2') return !status?.guest;
  return true;
}
// Move the highlight one step (dir = -1 left, +1 right) to the next enabled option; stays put at the ends.
export function moveFocus(index, dir, status) {
  for (let i = index + dir; i >= 0 && i < OPTIONS.length; i += dir) if (optionEnabled(OPTIONS[i], status)) return i;
  return index;
}
// Where the highlight starts: the remembered player if that seat is free, else the first free one.
export function initialFocus(rememberedPlayer, status) {
  const want = rememberedPlayer === 2 ? 1 : 0;
  if (optionEnabled(OPTIONS[want], status)) return want;
  const first = OPTIONS.findIndex((o) => optionEnabled(o, status));
  return first < 0 ? 2 : first;
}
