// Turns raw camera facts into short, actionable messages ("too dark", "can't see your face", ...).
export const LIMITS = {
  faceLostMs: 1200,        // no face this long = warn
  dark: 55,                // mean brightness (0..255) below this = too dark
  bright: 215,             // above this = washed out / strong backlight
  tooFar: 0.05,            // distance between the eyes, as a fraction of image width
  tooClose: 0.34,
  lowFps: 12,
};

// Mean brightness of an RGBA pixel buffer (samples about 1 in 4 pixels; plenty for a 32x24 thumbnail).
export function lumaMean(rgba) {
  let sum = 0, n = 0;
  for (let i = 0; i + 2 < rgba.length; i += 16) {
    sum += 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
    n++;
  }
  return n ? sum / n : null;
}

// Returns the warnings that apply right now, most important first.
export function evaluateWarnings({ now, lastFaceAt, luma, eye, fps }, limits = LIMITS) {
  const out = [];
  const faceLost = !lastFaceAt || now - lastFaceAt > limits.faceLostMs;
  if (faceLost) out.push({ id: 'face', text: "I can't see your face - sit in front of the camera." });
  if (luma != null && luma < limits.dark) out.push({ id: 'dark', text: 'Too dark - turn on a light or face a window.' });
  else if (luma != null && luma > limits.bright) out.push({ id: 'bright', text: 'Image is washed out - avoid a bright light or window behind you.' });
  if (!faceLost && eye != null) {
    if (eye < limits.tooFar) out.push({ id: 'far', text: 'Move a bit closer to the camera.' });
    else if (eye > limits.tooClose) out.push({ id: 'close', text: 'Move back a little from the camera.' });
  }
  if (fps != null && fps < limits.lowFps) out.push({ id: 'fps', text: 'The camera is running slowly - close other tabs or apps.' });
  return out;
}
