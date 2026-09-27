// Owner: C
// Gemini API calls (commentary + summary)
//
// REST: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
// Auth: x-goog-api-key header. Text: candidates[0].content.parts[0].text
// Live lines use gemini-3.5-flash-lite with thinkingLevel "minimal" (lowest latency;
// "minimal" is only valid on Flash-Lite). Override with GEMINI_LINE_MODEL.

const {
  COMMENTARY_SYSTEM, commentaryContents, SUMMARY_SYSTEM, SUMMARY_SCHEMA, summaryContents,
} = require('./prompts');
const { compactMatch, templateSummary } = require('./summarize');

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_LINE_MODEL = 'gemini-3.5-flash-lite';
// Summary isn't latency-critical: use the stronger Flash with a little thinking.
const DEFAULT_SUMMARY_MODEL = 'gemini-3.8-flash';
const MAX_LINE_WORDS = 15;

class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function generateText({
  model,
  system,
  contents,
  temperature = 0.9,
  maxOutputTokens = 256,
  thinkingLevel,
  responseSchema,
  timeoutMs = 8000,
  apiKey = process.env.GEMINI_API_KEY,
  fetchImpl = fetch,
}) {
  if (!apiKey) throw new GeminiError('GEMINI_API_KEY not set', 503);
  const generationConfig = { temperature, maxOutputTokens };
  if (thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel };
  if (responseSchema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = responseSchema;
  }
  const body = { contents, generationConfig };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${API_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new GeminiError(err.name === 'AbortError' ? `Gemini timed out after ${timeoutMs}ms` : err.message, 504);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new GeminiError(`Gemini ${res.status}: ${detail.slice(0, 300)}`, 502);
  }
  const json = await res.json();
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
  if (!text.trim()) throw new GeminiError(`Gemini returned no text (finishReason ${json.candidates?.[0]?.finishReason})`, 502);
  return text;
}

// Opens the TLS connection and wakes the model route without spending tokens
// (models.get is free). Called at page load / round start so the first real line isn't cold.
async function warm({ apiKey = process.env.GEMINI_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) return false;
  const model = process.env.GEMINI_LINE_MODEL || DEFAULT_LINE_MODEL;
  const res = await fetchImpl(`${API_BASE}/${model}`, { headers: { 'x-goog-api-key': apiKey } });
  return res.ok;
}

// Makes model output safe to speak: one line, no wrapping quotes/markdown, word cap.
function cleanLine(text) {
  let s = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  s = s.replace(/[*_#`]/g, '').replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '').replace(/\s+/g, ' ');
  const words = s.split(' ');
  if (words.length > MAX_LINE_WORDS) s = words.slice(0, MAX_LINE_WORDS).join(' ').replace(/[,;:]$/, '') + '!';
  return s;
}

async function generateLine(moment, { recent = [], ...opts } = {}) {
  const text = await generateText({
    model: process.env.GEMINI_LINE_MODEL || DEFAULT_LINE_MODEL,
    system: COMMENTARY_SYSTEM,
    contents: commentaryContents(moment, recent),
    temperature: 1.0,
    maxOutputTokens: 60,
    thinkingLevel: 'minimal',
    timeoutMs: 2500,
    ...opts,
  });
  const line = cleanLine(text);
  if (!line) throw new GeminiError('empty line after cleanup', 502);
  return line;
}

// detail: match-detail shape (see summarize.js). Always resolves: falls back to a
// stats-based template if Gemini is unavailable or returns junk.
// Makes the summary short even if the model ignores the length asks: first N sentences, then a word cap.
function tighten(text, { sentences, words }) {
  const parts = String(text).split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, sentences);
  let out = parts.join(' ');
  const w = out.split(' ');
  if (w.length > words) out = w.slice(0, words).join(' ').replace(/[,;:\s]+$/, '');
  if (out && !/[.!?]$/.test(out)) out += '.';
  return out;
}
const SUMMARY_LIMITS = {
  headline: { sentences: 1, words: 10 },
  analysis: { sentences: 2, words: 40 },
  turningPoint: { sentences: 1, words: 16 },
};

// Single-string form stored in matches.summary and shown on the dashboard.
const summaryText = (s) => `${s.headline} ${s.analysis} Turning point: ${s.turningPoint}`;

// If the main model is overloaded (503s happen under demand spikes), try Flash-Lite once.
async function generateSummary(detail, opts = {}) {
  const compact = compactMatch(detail);
  const models = [
    process.env.GEMINI_SUMMARY_MODEL || DEFAULT_SUMMARY_MODEL,
    process.env.GEMINI_LINE_MODEL || DEFAULT_LINE_MODEL,
  ];
  const errors = [];
  for (const model of [...new Set(models)]) {
    try {
      const text = await generateText({
        model,
        system: SUMMARY_SYSTEM,
        contents: summaryContents(compact),
        temperature: 0.7,
        maxOutputTokens: 1024,
        thinkingLevel: 'low',
        responseSchema: SUMMARY_SCHEMA,
        timeoutMs: 12000,
        ...opts,
      });
      const parsed = JSON.parse(text);
      const clean = (x) => (typeof x === 'string' ? x.trim().replace(/\s+/g, ' ') : '');
      const out = {
        headline: cleanLine(clean(parsed.headline)),
        analysis: tighten(clean(parsed.analysis), SUMMARY_LIMITS.analysis),
        turningPoint: tighten(clean(parsed.turningPoint), SUMMARY_LIMITS.turningPoint),
      };
      out.headline = out.headline.split(' ').length > SUMMARY_LIMITS.headline.words ? tighten(out.headline, SUMMARY_LIMITS.headline).replace(/\.$/, '!') : out.headline;
      if (!out.headline || !out.analysis) throw new GeminiError('summary missing fields', 502);
      return { ...out, source: 'gemini', model };
    } catch (err) {
      errors.push(`${model}: ${err.message.slice(0, 120)}`);
      if (err.status === 503 && /not set/.test(err.message)) break; // no key: retrying won't help
    }
  }
  console.warn('[ai] summary fell back to template:', errors.join(' | '));
  return { ...templateSummary(compact), source: 'template', error: errors.join(' | ') };
}

module.exports = {
  generateText, generateLine, generateSummary, summaryText, cleanLine, tighten, SUMMARY_LIMITS, warm, GeminiError,
  DEFAULT_LINE_MODEL, DEFAULT_SUMMARY_MODEL,
};
