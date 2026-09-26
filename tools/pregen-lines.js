// Owner: C
// Pre-generates ElevenLabs audio for every fallback line into assets/audio/prelines/
// plus manifest.json ({ lines: { text: file } }). The browser plays these instantly,
// with no API call, whenever the spoken text matches.
//
//   node --env-file=.env tools/pregen-lines.js          # skips clips that already exist
//   node --env-file=.env tools/pregen-lines.js --force  # re-render everything

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FALLBACK_LINES, fillTemplate } from '../src/commentary/fallbackLines.js';

const require = createRequire(import.meta.url);
const elevenlabs = require('../server/ai/elevenlabs.js');

export const OUT_DIR = fileURLToPath(new URL('../assets/audio/prelines/', import.meta.url));

// Every distinct text the fallback picker can produce.
export function allFallbackTexts() {
  const texts = new Set();
  for (const [type, templates] of Object.entries(FALLBACK_LINES)) {
    for (const tpl of templates) {
      for (const player of [1, 2]) {
        for (const round of tpl.includes('{round}') ? [1, 2, 3] : [1]) {
          texts.add(fillTemplate(tpl, { type, player, data: { round } }));
        }
      }
    }
  }
  return [...texts];
}

export const clipName = (text) => `${createHash('sha1').update(text).digest('hex').slice(0, 12)}.mp3`;

export async function pregenerate({ outDir = OUT_DIR, force = false, ttsBuffer = elevenlabs.ttsBuffer, log = console.log } = {}) {
  mkdirSync(outDir, { recursive: true });
  const manifestPath = join(outDir, 'manifest.json');
  const voice = elevenlabs.voiceId();
  const model = process.env.ELEVENLABS_MODEL_ID || elevenlabs.DEFAULT_MODEL;
  const old = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  const sameVoice = old && old.voice === voice && old.model === model;

  const lines = {};
  let made = 0;
  let failed = 0;
  for (const text of allFallbackTexts()) {
    const file = clipName(text);
    if (!force && sameVoice && existsSync(join(outDir, file))) {
      lines[text] = file;
      continue;
    }
    try {
      writeFileSync(join(outDir, file), await ttsBuffer(text));
      lines[text] = file;
      made += 1;
      log(`  + ${text}`);
    } catch (err) {
      failed += 1;
      log(`  ! ${text}: ${err.message}`);
      if (err.status === 503) break; // no key: no point continuing
    }
  }
  // voiceId() may have fallen back to the default voice mid-run (paid-only voice).
  writeFileSync(manifestPath, JSON.stringify({ voice: elevenlabs.voiceId(), model, lines }, null, 1) + '\n');
  return { total: Object.keys(lines).length, made, failed };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = await pregenerate({ force: process.argv.includes('--force') });
  console.log(`prelines: ${r.total} clips in manifest (${r.made} new, ${r.failed} failed)`);
  if (r.failed) process.exitCode = 1;
}
