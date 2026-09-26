// Owner: C
// Entry point: wires listener -> announcer -> voice + on-screen caption.

import { startCommentaryListener } from './listener.js';
import { createAnnouncer } from './announcer.js';
import { createElevenLabsPlayer } from './elevenLabsPlayer.js';
import { createGeminiLineSource } from './aiClient.js';
import { createMatchRecorder } from './matchRecorder.js';
import { requestMatchSummary } from './summary.js';
import { createSummaryPanel } from './summaryPanel.js';

const SUMMARY_DELAY_MS = 2500; // let the KO call land before the analysis

export function initCommentary({
  bus,
  player = createElevenLabsPlayer(),
  lineSource = createGeminiLineSource(),
  summarize = requestMatchSummary,
} = {}) {
  const caption = createCaption();
  createHistoryLink();
  const panel = createSummaryPanel();
  const recorder = createMatchRecorder();
  const announcer = createAnnouncer({
    player,
    getLine: lineSource?.getLine,
    onLine: ({ text }) => {
      caption.show(text);
      lineSource?.remember(text);
    },
  });
  const listener = startCommentaryListener({
    bus,
    onMoment: (m) => {
      recorder.onMoment(m);
      announcer.enqueue(m);
    },
  });
  const recOffs = recorder.events.map((type) => bus.on(type, (p) => recorder.handle(type, p)));

  let round = 0;
  let summaryTimer = null;
  lineSource?.warm?.();
  const offRoundStart = bus.on('round_start', () => {
    lineSource?.warm?.();
    round += 1;
    clearTimeout(summaryTimer);
    panel.hide();
  });
  const offRoundEnd = bus.on('round_end', () => {
    const detail = recorder.detail();
    const forRound = round;
    clearTimeout(summaryTimer);
    summaryTimer = setTimeout(async () => {
      panel.loading();
      try {
        const s = await summarize(detail);
        if (forRound !== round) return; // a new round started meanwhile
        panel.show(s);
        announcer.enqueue({ type: 'post_match', priority: 95, t: Date.now(), text: s.headline, data: {} });
      } catch {
        if (forRound === round) panel.error();
      }
    }, SUMMARY_DELAY_MS);
  });

  return {
    announcer,
    lineSource,
    player,
    recorder,
    panel,
    // Real event -> audio-playing latency from this browser session.
    latency: () => player.latencyReport?.() ?? null,
    stop() {
      listener.stop();
      recOffs.forEach((off) => off());
      offRoundStart();
      offRoundEnd();
      clearTimeout(summaryTimer);
      announcer.stop();
    },
  };
}

// Always-visible way to the dashboard (the "View round recap" button only appears
// after a round ends).
function createHistoryLink() {
  if (typeof document === 'undefined') return;
  const a = document.createElement('a');
  a.id = 'match-history-link';
  a.href = '/dashboard/';
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = 'Match history ↗';
  Object.assign(a.style, {
    position: 'fixed', top: '12px', right: '16px', zIndex: '42',
    padding: '7px 12px', borderRadius: '8px', background: 'rgba(12, 14, 20, 0.85)',
    boxShadow: '0 0 0 1px #2c3140', color: '#c9d1e4', font: '600 13px system-ui, sans-serif',
    textDecoration: 'none',
  });
  document.body.appendChild(a);
}

function createCaption() {
  if (typeof document === 'undefined') return { show() {} };
  const el = document.createElement('div');
  el.id = 'commentary-caption';
  Object.assign(el.style, {
    position: 'fixed', left: '50%', top: '16px', zIndex: '41', transform: 'translateX(-50%)',
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
