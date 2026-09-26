// Owner: C
// Entry point: wires listener -> announcer -> voice + on-screen caption.

import { startCommentaryListener } from './listener.js';
import { createAnnouncer } from './announcer.js';
import { createElevenLabsPlayer } from './elevenLabsPlayer.js';
import { createGeminiLineSource } from './aiClient.js';

export function initCommentary({
  bus,
  player = createElevenLabsPlayer(),
  lineSource = createGeminiLineSource(),
} = {}) {
  const caption = createCaption();
  const announcer = createAnnouncer({
    player,
    getLine: lineSource?.getLine,
    onLine: ({ text }) => {
      caption.show(text);
      lineSource?.remember(text);
    },
  });
  const listener = startCommentaryListener({ bus, onMoment: announcer.enqueue });
  return {
    announcer,
    lineSource,
    player,
    stop() {
      listener.stop();
      announcer.stop();
    },
  };
}

function createCaption() {
  if (typeof document === 'undefined') return { show() {} };
  const el = document.createElement('div');
  el.id = 'commentary-caption';
  Object.assign(el.style, {
    position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)',
    padding: '8px 16px', borderRadius: '6px', background: 'rgba(0,0,0,0.7)',
    color: '#ffd84a', font: 'bold 20px system-ui, sans-serif', letterSpacing: '0.02em',
    pointerEvents: 'none', opacity: '0', transition: 'opacity 150ms',
  });
  document.body.appendChild(el);
  let timer;
  return {
    show(text) {
      el.textContent = text;
      el.style.opacity = '1';
      clearTimeout(timer);
      timer = setTimeout(() => { el.style.opacity = '0'; }, 2500);
    },
  };
}
