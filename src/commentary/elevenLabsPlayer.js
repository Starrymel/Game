// Owner: C
// Announcer voice: pre-generated clip if we have one, else ElevenLabs via the
// /api/ai/tts proxy (streams, so playback starts before the clip finishes
// generating), else the browser's speech synthesis voice.
//
// Implements the announcer player interface: { play(text) -> Promise, stop() }

import { createSpeechSynthesisPlayer } from './announcer.js';

export function createElevenLabsPlayer({
  ttsEndpoint = '/api/ai/tts',
  prelinesBase = '/assets/audio/prelines/',
  manifest = null,                 // { lines: { text: file } }; loaded from prelinesBase if null
  fallback = createSpeechSynthesisPlayer(),
  backoffMs = 30000,
  maxClipMs = 10000,
  createAudio = () => new Audio(),
  fetchImpl = (...a) => fetch(...a),
  now = () => Date.now(),
} = {}) {
  let lines = manifest?.lines ?? {};
  let ttsDisabledUntil = 0;
  let finishCurrent = null;
  const stats = { preline: 0, tts: 0, fallback: 0, ttsErrors: 0 };

  const ready = manifest
    ? Promise.resolve()
    : fetchImpl(`${prelinesBase}manifest.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => { if (m?.lines) lines = m.lines; })
      .catch(() => {});

  function sourceFor(text) {
    if (lines[text]) return { kind: 'preline', url: prelinesBase + lines[text] };
    if (now() >= ttsDisabledUntil) return { kind: 'tts', url: `${ttsEndpoint}?text=${encodeURIComponent(text)}` };
    return null;
  }

  function playUrl(url) {
    return new Promise((resolve) => {
      const audio = createAudio();
      let settled = false;
      const safety = setTimeout(() => done('timeout'), maxClipMs);
      function done(result) {
        if (settled) return;
        settled = true;
        clearTimeout(safety);
        audio.onended = audio.onerror = null;
        finishCurrent = null;
        resolve(result);
      }
      finishCurrent = () => { audio.pause(); done('stopped'); };
      audio.onended = () => done('ended');
      audio.onerror = () => done('error');
      audio.src = url;
      // Rejects before the first user gesture (autoplay policy): skip the line quietly.
      Promise.resolve(audio.play()).catch(() => done('blocked'));
    });
  }

  return {
    stats,
    ready,
    async play(text) {
      const src = sourceFor(text);
      if (src) {
        stats[src.kind] += 1;
        const result = await playUrl(src.url);
        if (result !== 'error') return;
        if (src.kind === 'tts') {
          stats.ttsErrors += 1;
          ttsDisabledUntil = now() + backoffMs;
        }
      }
      stats.fallback += 1;
      await fallback.play(text);
    },
    stop() {
      finishCurrent?.();
      fallback.stop();
    },
  };
}
