import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRoom, needsLobby, joinSearch, localSearch, lobbySearch, seatInfo, waitingText, DEFAULT_ROOM, OPTIONS, optionEnabled, moveFocus, initialFocus } from '../../src/lobbyConfig.js';

const P = (s) => new URLSearchParams(s);

test('room names are still cleaned, shortened and upper-cased (for ?room= in a link)', () => {
  assert.equal(sanitizeRoom('team 1!'), 'TEAM1');
  assert.equal(sanitizeRoom('  my-room_2 '), 'MY-ROOM_2');
  assert.equal(sanitizeRoom('x'.repeat(50)).length, 20);
  assert.equal(sanitizeRoom(null), '');
});

test('the lobby shows on a plain visit, but not when the link already says how to play', () => {
  assert.equal(needsLobby(P('')), true);
  assert.equal(needsLobby(P('facelab=1')), true);
  assert.equal(needsLobby(P('role=host&player=1&room=A')), false);
  assert.equal(needsLobby(P('role=guest')), false);
  assert.equal(needsLobby(P('local=1')), false);
  assert.equal(needsLobby(P('lobby=0')), false);
});

test('choosing a player builds the right link: one shared room unless the link names one', () => {
  assert.equal(DEFAULT_ROOM, 'MAIN');
  assert.equal(joinSearch('', { player: 1 }), '?role=host&player=1&room=MAIN');
  assert.equal(joinSearch('?facelab=1&prize=0', { player: 2 }), '?facelab=1&prize=0&role=guest&player=2&room=MAIN');
  assert.equal(P(joinSearch('?room=friends', { player: 2 })).get('room'), 'FRIENDS');   // ?room= in the link still wins
  const s = joinSearch('?role=host&player=1&room=OLD&local=1', { player: 2 });
  assert.equal(P(s).getAll('room').length, 1);
  assert.equal(P(s).get('role'), 'guest');
  assert.equal(P(s).get('local'), null);
  assert.equal(P(joinSearch('', { player: 1, relayPort: 3000 })).get('relayPort'), '3000');
});

test('local play and back-to-lobby links', () => {
  assert.equal(localSearch('?role=host&facelab=1'), '?facelab=1&local=1');
  assert.equal(lobbySearch('?role=host&player=1&room=A&facelab=1'), '?facelab=1');
  assert.equal(lobbySearch('?role=host&player=1&room=A'), '');
});

test('seat buttons reflect who is in the room', () => {
  assert.deepEqual(seatInfo({ host: true, guest: false }), { 1: { taken: true, label: 'taken' }, 2: { taken: false, label: 'free' } });
  assert.deepEqual(seatInfo(null), { 1: { taken: false, label: '' }, 2: { taken: false, label: '' } });
});

test('waiting messages say who you are and who you wait for', () => {
  assert.match(waitingText({ role: 'host', room: 'A1', peerPresent: false }), /Player 1.*Waiting for Player 2.*room A1/);
  assert.match(waitingText({ role: 'guest', room: 'A1', peerPresent: false }), /Player 2.*Waiting for Player 1.*room A1/);
  assert.equal(waitingText({ role: 'host', room: 'MAIN', peerPresent: false }), 'You are Player 1. Waiting for Player 2 to join...');   // the shared room is not mentioned
  assert.equal(waitingText({ role: 'host', room: 'A1', peerPresent: true }), '');
});

test('moving the highlight skips taken seats and stops at the ends', () => {
  assert.deepEqual(OPTIONS, ['p1', 'p2', 'local']);
  const none = { host: false, guest: false };
  assert.equal(moveFocus(0, 1, none), 1);
  assert.equal(moveFocus(1, 1, none), 2);
  assert.equal(moveFocus(2, 1, none), 2);                                   // end of the row
  assert.equal(moveFocus(0, -1, none), 0);
  assert.equal(moveFocus(0, 1, { host: false, guest: true }), 2);           // Player 2 taken: jump over it
  assert.equal(moveFocus(2, -1, { host: false, guest: true }), 0);
  assert.equal(optionEnabled('local', { host: true, guest: true }), true);  // this laptop is always possible
});

test('the highlight starts on the remembered seat, or the first free one', () => {
  const none = { host: false, guest: false };
  assert.equal(initialFocus(undefined, none), 0);
  assert.equal(initialFocus(2, none), 1);
  assert.equal(initialFocus(1, { host: true, guest: false }), 1);           // Player 1 is taken: start on Player 2
  assert.equal(initialFocus(2, { host: false, guest: true }), 0);
  assert.equal(initialFocus(1, { host: true, guest: true }), 2);            // both taken: this laptop
  assert.equal(initialFocus(1, null), 0);                                    // unknown status: everything selectable
});
