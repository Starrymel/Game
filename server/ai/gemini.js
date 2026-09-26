// Owner: C
// Gemini API calls (commentary + summary)
//
// REST: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
// Auth: x-goog-api-key header. Text: candidates[0].content.parts[0].text
// Live lines use gemini-3.5-flash-lite with thinkingLevel "minimal" (lowest latency;
// "minimal" is only valid on Flash-Lite). Override with GEMINI_LINE_MODEL.

const { COMMENTARY_SYSTEM, commentaryContents } = require('./prompts');

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_LINE_MODEL = 'gemini-3.5-flash-lite';
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
  timeoutMs = 8000,
  apiKey = process.env.GEMINI_API_KEY,
  fetchImpl = fetch,
}) {
  if (!apiKey) throw new GeminiError('GEMINI_API_KEY not set', 503);
  const generationConfig = { temperature, maxOutputTokens };
  if (thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel };
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

module.exports = { generateText, generateLine, cleanLine, GeminiError, DEFAULT_LINE_MODEL };
