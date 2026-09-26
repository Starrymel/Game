const keys = new Set();

const BINDINGS = {
  1: { left: 'a', right: 'd', up: 'w', down: 's', light: 'f', special: 'g' },
  2: { left: 'arrowleft', right: 'arrowright', up: 'arrowup', down: 'arrowdown', light: 'k', special: 'l' },
};

// Two-laptop play (see src/net.js): the host substitutes the guest's actual
// keypresses here instead of reading local keys for that player. If the
// guest's connection drops, a stale override degrades to neutral (no input)
// rather than leaving a key stuck "held" forever.
const REMOTE_STALE_MS = 400;
const remote = { 1: null, 2: null }; // { input, receivedAt } | null

export function setRemoteInput(playerId, input) {
  remote[playerId] = { input, receivedAt: Date.now() };
}

export function clearRemoteInput(playerId) {
  remote[playerId] = null;
}

export function initInput() {
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, button, textarea, select')) return;
    if (e.key.startsWith('Arrow')) e.preventDefault();
    keys.add(e.key.toLowerCase());
  });
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('focusin', () => keys.clear());
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
}

const NEUTRAL_INPUT = { left: false, right: false, up: false, down: false, light: false, special: false };

export function readInput(playerId) {
  const r = remote[playerId];
  if (r) {
    return Date.now() - r.receivedAt <= REMOTE_STALE_MS ? r.input : NEUTRAL_INPUT;
  }

  const b = BINDINGS[playerId];
  return {
    left: keys.has(b.left),
    right: keys.has(b.right),
    up: keys.has(b.up),
    down: keys.has(b.down),
    light: keys.has(b.light),
    special: keys.has(b.special),
  };
}

export function isKeyDown(key) {
  return keys.has(key.toLowerCase());
}
