const keys = new Set();

const BINDINGS = {
  1: { left: 'a', right: 'd', up: 'w', down: 's', light: 'f', special: 'g' },
  2: { left: 'arrowleft', right: 'arrowright', up: 'arrowup', down: 'arrowdown', light: 'k', special: 'l' },
};

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

export function readInput(playerId) {
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
