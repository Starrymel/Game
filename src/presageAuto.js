// Presage starts by itself: no panel, no button. When the game opens it looks for the Presage bridge on this laptop; if it
// is running, the camera feed starts for this laptop's player and the heart rate becomes real (the HUD switches from MOCK to
// PRESAGE). If the bridge is not running the game just keeps the simulated heart rate and says so, with a Retry.
// Logic lives in createPresageAuto() (no DOM, unit tested); initPresageChip() is the small status line.
import { setBiometricsSource } from './biometrics.js';
import { startPresageCapture } from './presage-capture.js';
import { getPresageStatus } from './biometrics-presage.js';
import { bus } from './eventBus.js';

// Is something answering at this WebSocket address? Resolves true on open, false on error or timeout.
export function probeBridge(url, { timeoutMs = 2500, WS = globalThis.WebSocket } = {}) {
  return new Promise((resolve) => {
    let done = false, ws = null;
    const finish = (ok) => { if (done) return; done = true; clearTimeout(timer); try { ws?.close(); } catch (_) { /* ignore */ } resolve(ok); };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try { ws = new WS(url); } catch (_) { return finish(false); }
    ws.onopen = () => finish(true);
    ws.onerror = () => finish(false);
    ws.onclose = () => finish(false);
  });
}

const STALE_MS = 6000;

// True for the per-laptop local bridge/server.js (path /biometrics -- whether reached via localhost or,
// for a same-Wifi guest, the host laptop's LAN IP); false for a deployed site's own same-origin /presage
// endpoint (server/lib/presage.js). The path alone tells us which, regardless of hostname -- the two
// "not reachable" situations need very different advice (start a process on THIS laptop vs. nothing the
// player can do but wait/retry).
const isLocalBridge = (url) => /\/biometrics(\?|$)/.test(url || '');

// The one line of text for the current situation. Pure.
export function presageChipText({ phase, error, hr, lastSampleAt, hint, now = Date.now(), wsUrl = '' }) {
  switch (phase) {
    case 'waiting': return 'Heart rate: getting ready...';
    case 'probing': return 'Heart rate: looking for the Presage bridge...';
    case 'no-bridge':
      if (!isLocalBridge(wsUrl)) return 'Heart rate: simulated. Could not reach Presage on the server right now (it will keep retrying).';
      return wsUrl.startsWith('wss:')
        ? 'Heart rate: simulated. Open https://localhost:8790 once and accept the certificate, then press Retry.'
        : 'Heart rate: simulated. The Presage bridge is not running on this laptop (start it, then press Retry).';
    case 'camera-error': return `Heart rate: simulated (camera problem: ${error || 'unknown'}).`;
    case 'live': {
      if (!lastSampleAt) return `Heart rate: measuring... hold still for about 10 seconds${hint ? ` (${hint})` : ''}.`;
      if (now - lastSampleAt > STALE_MS) return `Heart rate: lost the signal, keep your face in view${hint ? ` (${hint})` : ''}.`;
      return `Heart rate: ${Math.round(hr)} bpm (live)`;
    }
    default: return '';
  }
}

export function createPresageAuto({
  player, wsUrl, capture = {},
  probe = probeBridge, start = startPresageCapture, setSource = setBiometricsSource,
  status = getPresageStatus, onChange = () => {}, now = () => Date.now(),
} = {}) {
  let phase = 'waiting';
  let error = null;
  let stop = null;
  let hr = null;
  let busy = false;

  const change = (next, err = null) => { phase = next; error = err; onChange(api.snapshot()); };

  async function run() {
    if (busy || phase === 'live') return;
    busy = true;
    change('probing');
    const found = await probe(wsUrl);
    if (!found) { busy = false; change('no-bridge'); return; }
    try {
      setSource('presage', { player, wsUrl });                 // readings for this player now come from the bridge
      stop = await start(player, { wsUrl, ...capture });       // and this laptop's camera goes to it
      busy = false; change('live');
    } catch (e) {
      setSource('mock', { player });                           // no camera: never leave the player frozen
      busy = false; change('camera-error', e?.message || e?.name);
    }
  }

  const api = {
    get phase() { return phase; },
    start: run,
    retry: run,
    stop() { try { stop?.(); } catch (_) { /* already stopped */ } stop = null; if (phase === 'live') { setSource('mock', { player }); change('no-bridge'); } },
    noteReading(v) { hr = v; },
    snapshot() {
      const st = status();
      return { phase, error, hr, lastSampleAt: st.lastSampleAt?.[player] || 0, hint: st.lastHint?.[player] || null };
    },
    text() { return presageChipText({ ...api.snapshot(), wsUrl, now: now() }); },
  };
  return api;
}

// The small status line (bottom-left, above the face controls chip) with a Retry button when it can help.
export function initPresageChip({ player, wsUrl, capture, after = Promise.resolve(), retryEveryMs = 20000 } = {}) {
  const style = document.createElement('style');
  style.textContent = `#presage-chip{position:fixed;left:12px;bottom:58px;z-index:40;display:flex;gap:8px;align-items:center;max-width:min(560px,92vw);background:#f5d0aa;border:1px solid #b87d50;border-radius:14px;padding:6px 12px;font:600 13px ui-monospace,Menlo,Consolas,monospace;color:#51392a}
#presage-chip button{font:inherit;color:#38251d;background:#e9b787;border:1px solid #a77550;border-radius:999px;padding:2px 10px;cursor:pointer}
#presage-chip[hidden]{display:none}`;
  document.head.append(style);
  const chip = document.createElement('div'); chip.id = 'presage-chip'; chip.setAttribute('role', 'status');
  document.body.append(chip);

  const auto = createPresageAuto({ player, wsUrl, capture, onChange: paint });
  bus.on('biometric_sample', (s) => { if (s.player === player && s.source === 'presage') auto.noteReading(s.hr); });

  function paint() {
    const snap = auto.snapshot();
    chip.hidden = false;
    chip.innerHTML = '';
    const text = document.createElement('span'); text.textContent = auto.text(); chip.append(text);
    if (auto.phase === 'no-bridge' || auto.phase === 'camera-error') {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Retry'; b.onclick = () => auto.retry(); chip.append(b);
    }
    void snap;
  }
  paint();
  setInterval(() => { if (auto.phase === 'live') paint(); }, 1000);                    // keeps the age / signal-lost text current
  setInterval(() => { if (auto.phase === 'no-bridge') auto.retry(); }, retryEveryMs);   // the bridge may be started after the page
  after.then(() => auto.start());
  return auto;
}
