// Always-visible camera setup UI (unlike ui/debugPanel.js, which only
// renders when there's a real local match object -- the guest has none).
// Replaces typing __listCameraDevices()/__startPresageCapture() by hand.
import { listCameraDevices, startPresageCapture } from '../presage-capture.js';
import { setBiometricsSource, getBiometricsSource } from '../biometrics.js';
import { getPresageStatus } from '../biometrics-presage.js';
import { bus } from '../eventBus.js';

const STALE_MS = 6000; // no reading for this long while streaming -> say so

// getUserMedia errors often have an empty message; say what actually went wrong.
export function cameraErrorText(e) {
  switch (e?.name) {
    case 'OverconstrainedError': return 'this camera can\'t deliver 25+ fps, which Presage needs for heart rate. Try another camera or close apps using it.';
    case 'NotAllowedError': return 'camera permission was denied. Allow the camera for this site in the browser settings, then try again.';
    case 'NotFoundError': return 'no camera found.';
    case 'NotReadableError': return 'the camera is busy (another app or tab is using it).';
    default: return e?.message || e?.name || 'unknown error';
  }
}

// One line per player: what's actually happening, so "heart rate does nothing"
// has a visible reason (bridge not running, no face, waiting for first reading).
// Path alone tells local bridge/server.js (/biometrics) apart from a deployed site's own
// same-origin endpoint (/presage) -- hostname doesn't (a same-Wifi guest reaches the local
// bridge via the host's LAN IP, not literally "localhost").
const isLocalBridge = (url) => /\/biometrics(\?|$)/.test(url);

export function describePresage(player, { source, streaming, status, hr, now = Date.now() }) {
  if (source !== 'presage') return `Player ${player}: mock data (no camera)`;
  if (!status.connected) {
    return isLocalBridge(status.url)
      ? `Player ${player}: can't reach the Presage bridge at ${status.url} -- is it running? (cd bridge && npm start)`
      : `Player ${player}: can't reach Presage at ${status.url} -- retrying automatically`;
  }
  if (!streaming) return `Player ${player}: bridge connected, camera not started`;
  const last = status.lastSampleAt[player];
  const hint = status.lastHint[player];
  const err = status.lastError?.[player];
  // No real reading has ever arrived and the server told us why: say so plainly instead of an
  // endless "waiting for first reading" that will never resolve (game still runs on mock/neutral values).
  if (!last && err) return `Player ${player}: Presage unavailable (${err}) -- using neutral values`;
  if (!last) return `Player ${player}: waiting for first reading${hint ? ` -- ${hint}` : ' (keep your face in view and hold still ~10s)'}`;
  const age = Math.round((now - last) / 1000);
  if (now - last > STALE_MS) return `Player ${player}: no reading for ${age}s${hint ? ` -- ${hint}` : ''}`;
  return `Player ${player}: ${Math.round(hr)} bpm from camera (updated ${age}s ago)`;
}

export function initPresagePanel({ wsUrl, capture = {} }) {
  const panel = document.createElement('details');
  panel.id = 'presage-panel';
  panel.innerHTML = `
    <summary>Presage camera setup</summary>
    <p id="presage-status">Only one camera on this machine? Just click Start below -- no need to list devices first.</p>
    <p id="presage-live-1"></p>
    <p id="presage-live-2"></p>
    <button type="button" id="presage-list">List cameras (only needed if you have more than one)</button>
    <select id="presage-device"><option value="">Default camera</option></select>
    <br>
    <button type="button" id="presage-start-1">Start camera -&gt; Player 1</button>
    <button type="button" id="presage-start-2">Start camera -&gt; Player 2</button>
  `;
  document.body.append(panel);

  const select = panel.querySelector('#presage-device');
  const status = panel.querySelector('#presage-status');

  // Listing devices with real labels itself needs a getUserMedia grant (see
  // listCameraDevices()), which visibly turns the camera on and back off --
  // that's expected there, but only do it on explicit request, not on page
  // load, or it looks exactly like "the camera started then stopped" for no
  // reason before the user asked for anything.
  panel.querySelector('#presage-list').onclick = async () => {
    status.textContent = 'Requesting camera permission to list devices…';
    try {
      const devices = await listCameraDevices();
      select.innerHTML = devices.length ? '' : '<option value="">No cameras found</option>';
      for (const d of devices) {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `Camera ${d.deviceId.slice(0, 6)}`;
        select.append(opt);
      }
      status.textContent = 'Pick a camera above, then click Start.';
    } catch (e) {
      status.textContent = `Couldn't list cameras: ${e.message}`;
    }
  };

  const streaming = { 1: false, 2: false };
  const lastHr = { 1: null, 2: null };
  bus.on('biometric_sample', (s) => { if (s.source === 'presage') lastHr[s.player] = s.hr; });

  function renderLive() {
    const st = getPresageStatus();
    for (const p of [1, 2]) {
      panel.querySelector(`#presage-live-${p}`).textContent =
        describePresage(p, { source: getBiometricsSource(p), streaming: streaming[p], status: st, hr: lastHr[p] });
    }
  }
  renderLive();
  setInterval(renderLive, 1000);
  bus.on('presage_connection', renderLive);
  bus.on('presage_status', renderLive);

  async function start(player) {
    status.textContent = `Requesting camera for player ${player}…`;
    try {
      // Only this player switches to the camera; readings come from the same
      // bridge the frames go to.
      setBiometricsSource('presage', { player, wsUrl });
      await startPresageCapture(player, { deviceId: select.value || undefined, wsUrl, ...capture });
      streaming[player] = true;
      status.textContent = `Streaming this camera for player ${player} to ${wsUrl}.`;
    } catch (e) {
      setBiometricsSource('mock', { player }); // no camera: don't leave this player frozen
      status.textContent = `Failed to start camera for player ${player}: ${cameraErrorText(e)}`;
    }
    renderLive();
  }

  panel.querySelector('#presage-start-1').onclick = () => start(1);
  panel.querySelector('#presage-start-2').onclick = () => start(2);
}
