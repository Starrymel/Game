// Face-control settings, remembered per browser. Everything is validated on load, so a corrupted or
// hand-edited entry can never break the game; storage failures (private window, blocked) are ignored.
import { DEFAULT_MAP, ACTIONS } from './actions.js';

export const SETTINGS_KEY = 'composure.face.v3';
export const DEFAULT_SETTINGS = {
  enabled: true,        // false = the player chose the keyboard; face controls stay off until re-enabled
  headOn: true,         // head tilt / raise / lower moves the fighter
  mode: 'tilt',         // 'tilt' or 'lean'
  headSens: 1,          // multiplies the head thresholds (higher = needs a bigger move)
  maxSpeed: 1,          // 1 = walk at full speed while tilted (like a held key); lower = stop-and-go slower walking
  browsUp: 0.3,         // eyebrow-raise sensitivity (lower = easier)
  smirkUp: 0.22,        // one-sided smirk sensitivity (lower = easier)
  smileUp: 0.4,         // smile sensitivity (lower = easier)
  personalDone: false,  // the start screen has measured this person's eyebrows and smile
  blinkHoldMs: 250,     // long-blink duration
  map: DEFAULT_MAP,
};
export const RANGES = {
  headSens: [0.6, 2], maxSpeed: [0.2, 1], browsUp: [0.1, 0.85], smirkUp: [0.08, 0.6], smileUp: [0.1, 0.85], blinkHoldMs: [150, 600],
};

const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));

export function sanitizeSettings(raw) {
  const out = { ...DEFAULT_SETTINGS, map: { ...DEFAULT_MAP } };
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
  if (typeof raw.headOn === 'boolean') out.headOn = raw.headOn;
  if (typeof raw.personalDone === 'boolean') out.personalDone = raw.personalDone;
  if (raw.mode === 'tilt' || raw.mode === 'lean') out.mode = raw.mode;
  for (const [k, range] of Object.entries(RANGES)) {
    const v = Number(raw[k]);
    if (raw[k] != null && Number.isFinite(v)) out[k] = clamp(v, range);
  }
  if (raw.map && typeof raw.map === 'object') {
    for (const g of Object.keys(DEFAULT_MAP)) {
      if (typeof raw.map[g] === 'string' && Object.hasOwn(ACTIONS, raw.map[g])) out.map[g] = raw.map[g];
    }
  }
  return out;
}

export function getStorage() {
  try { return globalThis.localStorage ?? null; } catch (_) { return null; }
}

export function loadSettings(storage = getStorage()) {
  try {
    const text = storage?.getItem(SETTINGS_KEY);
    return sanitizeSettings(text ? JSON.parse(text) : null);
  } catch (_) { return sanitizeSettings(null); }
}

export function saveSettings(settings, storage = getStorage()) {
  try { storage?.setItem(SETTINGS_KEY, JSON.stringify(settings)); return true; } catch (_) { return false; }
}
