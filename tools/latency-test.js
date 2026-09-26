// Owner: C
// Measures event -> audio latency
//
// Runs the fake match's moments through the real server stack (Gemini line, then
// ElevenLabs TTS) and reports, per stage, how long until audio could start playing.
//
//   node tools/latency-test.js                     # boots server/index.js with .env on a spare port
//   node tools/latency-test.js --url http://host:3000   # measure an already-running server (e.g. Vultr)
//   node tools/latency-test.js --gap 6000          # wait between moments (tests idle/cold connections)
//   node tools/latency-test.js --warm              # call /api/ai/warm first, like the game does
//
// "first audio byte" ~= when the browser can start playing a streamed mp3.

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMomentDetector } from '../src/commentary/moments.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const BUDGET_MS = 1500; // event -> audio start that still feels "reactive"

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};

export function percentile(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

export function fixtureMoments() {
  const fx = JSON.parse(readFileSync(new URL('../fixtures/fake-match.json', import.meta.url)));
  const d = createMomentDetector();
  const out = [];
  for (const e of fx.events) for (const m of d.handle(e.type, e.payload)) if (m.type !== 'hit') out.push(m);
  return out;
}

// Time until first body byte and until end of body.
async function timedFetch(url, init) {
  const t0 = performance.now();
  const res = await fetch(url, init);
  const reader = res.body.getReader();
  let first = null;
  let bytes = 0;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (first === null) first = performance.now() - t0;
    bytes += value.length;
    chunks.push(value);
  }
  return { res, firstMs: first ?? performance.now() - t0, totalMs: performance.now() - t0, bytes, body: Buffer.concat(chunks) };
}

async function startServer(port) {
  const envFile = existsSync(`${ROOT}.env`) ? ['--env-file=.env'] : [];
  const child = spawn(process.execPath, [...envFile, 'server/index.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return { base, child }; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('server did not start');
}

export async function measure({ base, moments, gapMs = 0, log = console.log }) {
  const rows = [];
  for (const [i, m] of moments.entries()) {
    if (i && gapMs) await new Promise((r) => setTimeout(r, gapMs));
    const row = { type: m.type };
    const t0 = performance.now();
    const lineRes = await fetch(`${base}/api/ai/line`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ moment: m }),
    });
    row.lineMs = Math.round(performance.now() - t0);
    const line = await lineRes.json();
    row.lineOk = lineRes.ok;
    row.text = line.text ?? `(error: ${line.error})`;
    if (lineRes.ok) {
      // Unique text so the first request is a guaranteed cache miss.
      const text = `${line.text}`;
      const miss = await timedFetch(`${base}/api/ai/tts?text=${encodeURIComponent(text)}`);
      row.ttsOk = miss.res.ok;
      row.ttsCache = miss.res.headers.get('x-tts-cache');
      row.ttsFirstMs = Math.round(miss.firstMs);
      row.ttsTotalMs = Math.round(miss.totalMs);
      row.kb = Math.round(miss.bytes / 1024);
      row.eventToAudioMs = row.lineMs + row.ttsFirstMs;
      const hit = await timedFetch(`${base}/api/ai/tts?text=${encodeURIComponent(text)}`);
      row.cacheHitMs = Math.round(hit.firstMs);
    }
    rows.push(row);
    log(`${row.type.padEnd(12)} line ${String(row.lineMs).padStart(5)}ms  tts-first ${String(row.ttsFirstMs ?? '-').padStart(5)}ms  ` +
      `=> audio ${String(row.eventToAudioMs ?? '-').padStart(5)}ms  (hit ${row.cacheHitMs ?? '-'}ms, ${row.ttsCache ?? '-'}, ${row.kb ?? '-'}KB)  ${row.text}`);
  }
  return rows;
}

export function report(rows, log = console.log) {
  const pick = (k) => rows.map((r) => r[k]).filter((x) => typeof x === 'number');
  const stat = (k) => {
    const xs = pick(k);
    return xs.length ? `p50 ${percentile(xs, 50)}ms  p95 ${percentile(xs, 95)}ms  max ${Math.max(...xs)}ms` : 'n/a';
  };
  log('');
  log(`Gemini line        ${stat('lineMs')}`);
  log(`TTS first byte     ${stat('ttsFirstMs')}`);
  log(`TTS cache hit      ${stat('cacheHitMs')}`);
  log(`EVENT -> AUDIO     ${stat('eventToAudioMs')}   (budget ${BUDGET_MS}ms)`);
  const e2e = pick('eventToAudioMs');
  const over = e2e.filter((x) => x > BUDGET_MS).length;
  const failed = rows.filter((r) => !r.lineOk || r.ttsOk === false).length;
  log(`over budget: ${over}/${e2e.length}   failed: ${failed}/${rows.length}`);
  return { p50: percentile(e2e, 50), p95: percentile(e2e, 95), over, failed };
}

async function main() {
  const url = arg('url', null);
  const gapMs = Number(arg('gap', 0));
  const n = Number(arg('n', 10));
  let server = null;
  const base = url ?? (server = await startServer(3900 + Math.floor(Math.random() * 90))).base;
  try {
    // Prelines: static files, no API.
    const manifestUrl = `${base}/assets/audio/prelines/manifest.json`;
    const man = await fetch(manifestUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const first = man && Object.values(man.lines)[0];
    if (first) {
      const p = await timedFetch(`${base}/assets/audio/prelines/${first}`);
      console.log(`preline clip: first byte ${Math.round(p.firstMs)}ms (${Object.keys(man.lines).length} clips pre-generated)\n`);
    } else {
      console.log('preline clips: none yet (run npm run pregen)\n');
    }
    if (process.argv.includes('--warm')) {
      const w = await fetch(`${base}/api/ai/warm`, { method: 'POST' }).then((r) => r.json());
      console.log(`warm-up: ${JSON.stringify(w)}\n`);
    }
    // round_start is served from a pre-generated clip in the game, so skip it here.
    const moments = fixtureMoments().filter((m) => m.type !== 'round_start').slice(0, n);
    const rows = await measure({ base, moments, gapMs });
    report(rows);
  } finally {
    server?.child.kill();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
