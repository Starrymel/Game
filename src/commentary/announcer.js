// Owner: C
// Queue, priority, cooldowns, stale-drop, audio playback
//
// createAnnouncer takes moments (from moments.js) and turns them into spoken lines,
// one at a time:
//   - priority queue (KO > special > comeback > flinch > ... > hit chatter)
//   - at most one queued moment per type (newer replaces older)
//   - per-type cooldowns so flinches/hits don't spam
//   - stale drop: a moment too old by the time it would play is skipped
//   - high-priority moments (KO/special) interrupt lower-priority speech
//   - getLine(moment) (e.g. Gemini) raced against a timeout, falling back to
//     pre-written lines so the game never goes silent
//
// Player interface: { play(text, moment) -> Promise (resolves when audio ends), stop() }

import { createFallbackPicker } from './fallbackLines.js';

export const ANNOUNCER_DEFAULTS = {
  gapMs: 350,               // silence between lines
  maxQueue: 4,
  lineTimeoutMs: 1200,      // give getLine this long, then use a fallback line
  interruptPriority: 90,    // moments at/above this cut off lower-priority speech
  maxAgeMs: { ko: 8000, round_start: 4000, round_end: 6000, special: 3000, comeback: 3500, big_flinch: 1500, hit: 1200, default: 2500 },
  cooldownMs: { hit: 5000, big_flinch: 4000, combo: 3000, panic_spike: 8000, heal_streak: 8000, meter_full: 6000, default: 0 },
};

const pick = (table, type) => table[type] ?? table.default;

export function createAnnouncer({
  player,
  getLine = null,
  onLine = null,          // ({ text, moment, source }) when a line starts playing
  onDrop = null,          // ({ moment, reason }) when a moment is discarded
  now = () => Date.now(),
  rng = Math.random,
  options = {},
} = {}) {
  const cfg = {
    ...ANNOUNCER_DEFAULTS,
    ...options,
    maxAgeMs: { ...ANNOUNCER_DEFAULTS.maxAgeMs, ...options.maxAgeMs },
    cooldownMs: { ...ANNOUNCER_DEFAULTS.cooldownMs, ...options.cooldownMs },
  };
  const pickFallback = createFallbackPicker(rng);
  const lastSpokenAt = {};
  const stats = { spoken: 0, fromGetLine: 0, fromFallback: 0, dropped: {} };
  let queue = [];
  let current = null;       // { moment, cancelled }
  let busy = false;
  let stopped = false;

  function drop(moment, reason) {
    stats.dropped[reason] = (stats.dropped[reason] ?? 0) + 1;
    onDrop?.({ moment, reason });
  }
  const isStale = (m) => now() - m.t > pick(cfg.maxAgeMs, m.type);
  const onCooldown = (m) => now() - (lastSpokenAt[m.type] ?? -Infinity) < pick(cfg.cooldownMs, m.type);

  function enqueue(moment) {
    if (stopped) return;
    if (onCooldown(moment)) return drop(moment, 'cooldown');

    const dupe = queue.findIndex((q) => q.type === moment.type);
    if (dupe !== -1) drop(queue.splice(dupe, 1)[0], 'replaced');

    queue.push(moment);
    queue.sort((a, b) => b.priority - a.priority || a.t - b.t);
    while (queue.length > cfg.maxQueue) drop(queue.pop(), 'overflow');

    if (current && moment.priority >= cfg.interruptPriority && moment.priority > current.moment.priority) {
      current.cancelled = true;
      current.interrupted = true;
      drop(current.moment, 'interrupted');
      player.stop();
    }
    pump();
  }

  async function resolveLine(moment) {
    if (getLine) {
      let timer;
      try {
        const text = await Promise.race([
          getLine(moment),
          new Promise((resolve) => { timer = setTimeout(resolve, cfg.lineTimeoutMs, null); }),
        ]);
        if (typeof text === 'string' && text.trim()) return { text: text.trim(), source: 'getLine' };
      } catch {
        // fall through to fallback
      } finally {
        clearTimeout(timer);
      }
    }
    return { text: pickFallback(moment), source: 'fallback' };
  }

  async function pump() {
    if (busy || stopped) return;
    busy = true;
    try {
      while (queue.length && !stopped) {
        const moment = queue.shift();
        if (isStale(moment)) { drop(moment, 'stale'); continue; }
        if (onCooldown(moment)) { drop(moment, 'cooldown'); continue; }

        current = { moment, cancelled: false };
        const { text, source } = await resolveLine(moment);
        if (current.cancelled || stopped) continue;
        if (isStale(moment)) { drop(moment, 'stale'); continue; }

        lastSpokenAt[moment.type] = now();
        stats.spoken += 1;
        stats[source === 'getLine' ? 'fromGetLine' : 'fromFallback'] += 1;
        onLine?.({ text, moment, source });
        try {
          await player.play(text, moment);
        } catch {
          // a failed clip shouldn't kill the queue
        }
        if (cfg.gapMs && queue.length && !current.interrupted) await new Promise((r) => setTimeout(r, cfg.gapMs));
      }
    } finally {
      current = null;
      busy = false;
    }
  }

  return {
    enqueue,
    stats,
    get queue() { return queue.slice(); },
    get speaking() { return current?.moment ?? null; },
    stop() {
      stopped = true;
      queue = [];
      if (current) current.cancelled = true;
      player.stop();
    },
  };
}

// Browser fallback voice (Web Speech API). Used until ElevenLabs is wired, and as a
// backup if TTS requests fail. Resolves when speech ends, with a safety timeout since
// some browsers occasionally never fire onend.
export function createSpeechSynthesisPlayer({ rate = 1.15, pitch = 1 } = {}) {
  const synth = globalThis.speechSynthesis;
  let finish = null;
  return {
    play(text) {
      if (!synth) return Promise.resolve();
      return new Promise((resolve) => {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = rate;
        u.pitch = pitch;
        const safety = setTimeout(() => done(), 1500 + text.split(/\s+/).length * 450);
        function done() {
          clearTimeout(safety);
          finish = null;
          resolve();
        }
        finish = done;
        u.onend = done;
        u.onerror = done;
        synth.speak(u);
      });
    },
    stop() {
      synth?.cancel();
      finish?.();
    },
  };
}

// Text-only player: shows lines but plays no audio (tests, muted demos).
export function createSilentPlayer({ durationMs = (text) => 0 } = {}) {
  let finish = null;
  return {
    play(text) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => { finish = null; resolve(); }, durationMs(text));
        finish = () => { clearTimeout(timer); finish = null; resolve(); };
      });
    },
    stop() { finish?.(); },
  };
}
