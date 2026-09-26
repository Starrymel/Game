// Owner: C
// ElevenLabs text-to-speech + line cache
//
// REST: POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream
// Auth: xi-api-key header. Body: { text, model_id, voice_settings }.
// Model eleven_flash_v2_5 (ElevenLabs' lowest-latency TTS, ~75ms model time).
// Audio is cached on disk by (voice, model, text) so repeated lines are free/instant.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_MODEL = 'eleven_flash_v2_5';
const DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb'; // premade voice used in ElevenLabs' docs
const OUTPUT_FORMAT = 'mp3_44100_128';
const VOICE_SETTINGS = { stability: 0.4, similarity_boost: 0.8, style: 0.5, speed: 1.1, use_speaker_boost: true };
const CACHE_DIR = path.join(__dirname, 'cache');

class TtsError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const voiceId = () => process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
const modelId = () => process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL;

function cacheKey(text, voice = voiceId(), model = modelId()) {
  return crypto.createHash('sha1').update(`${voice}|${model}|${OUTPUT_FORMAT}|${text}`).digest('hex');
}

// Starts a streaming TTS request. Resolves once ElevenLabs answers with headers;
// returns the fetch Response whose body is the mp3 stream.
async function ttsStream(text, {
  apiKey = process.env.ELEVENLABS_API_KEY,
  voice = voiceId(),
  model = modelId(),
  timeoutMs = 5000,
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) throw new TtsError('ELEVENLABS_API_KEY not set', 503);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${API_BASE}/${voice}/stream?output_format=${OUTPUT_FORMAT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey, Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: model, voice_settings: VOICE_SETTINGS }),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new TtsError(err.name === 'AbortError' ? `ElevenLabs timed out after ${timeoutMs}ms` : err.message, 504);
  }
  clearTimeout(timer); // headers arrived; don't cut off the audio body mid-stream
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new TtsError(`ElevenLabs ${res.status}: ${detail.slice(0, 300)}`, 502);
  }
  return res;
}

// Whole clip as a Buffer (used by the pre-generation tool).
async function ttsBuffer(text, opts) {
  const res = await ttsStream(text, opts);
  return Buffer.from(await res.arrayBuffer());
}

function createTtsCache(dir = CACHE_DIR) {
  const file = (key) => path.join(dir, `${key}.mp3`);
  return {
    has: (key) => fs.existsSync(file(key)),
    path: file,
    write(key, buf) {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file(key)}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, file(key)); // atomic: readers never see half a file
    },
  };
}

module.exports = {
  ttsStream, ttsBuffer, createTtsCache, cacheKey, TtsError,
  DEFAULT_MODEL, DEFAULT_VOICE, OUTPUT_FORMAT,
};
