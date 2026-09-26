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
  const timings = []; // { type, kind, eventToAudioMs } for the last 50 clips

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

  function playUrl(url, onPlaying) {
    return new Promise((resolve) => {
      const audio = createAudio();
      audio.onplaying = () => { audio.onplaying = null; onPlaying?.(); };
      let settled = false;
      const safety = setTimeout(() => done('timeout'), maxClipMs);
      function done(result) {
        if (settled) return;
        settled = true;
        clearTimeout(safety);
        audio.onended = audio.onerror = audio.onplaying = null;
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
    async play(text, moment) {
      const src = sourceFor(text);
      if (src) {
        stats[src.kind] += 1;
        const result = await playUrl(src.url, () => {
          if (typeof moment?.t !== 'number') return;
          timings.push({ type: moment.type, kind: src.kind, eventToAudioMs: now() - moment.t });
          if (timings.length > 50) timings.shift();
        });
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
    latencyReport() {
      const report = {};
      for (const kind of ['preline', 'tts']) {
        const xs = timings.filter((x) => x.kind === kind).map((x) => x.eventToAudioMs).sort((a, b) => a - b);
        if (!xs.length) continue;
        const pct = (p) => xs[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)];
        report[kind] = { n: xs.length, p50: pct(50), p95: pct(95), max: xs.at(-1) };
      }
      return { ...report, recent: timings.slice(-10) };
    },
  };
}
