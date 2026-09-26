// Always-visible camera setup UI (unlike ui/debugPanel.js, which only
// renders when there's a real local match object -- the guest has none).
// Replaces typing __listCameraDevices()/__startPresageCapture() by hand.
import { listCameraDevices, startPresageCapture } from '../presage-capture.js';

export function initPresagePanel({ wsUrl }) {
  const panel = document.createElement('details');
  panel.id = 'presage-panel';
  panel.innerHTML = `
    <summary>Presage camera setup</summary>
    <p id="presage-status">Only one camera on this machine? Just click Start below -- no need to list devices first.</p>
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

  async function start(player) {
    status.textContent = `Requesting camera for player ${player}…`;
    try {
      window.__setBiometricsSource?.('presage');
      await startPresageCapture(player, { deviceId: select.value || undefined, wsUrl });
      status.textContent = `Streaming this camera for player ${player} to ${wsUrl}.`;
    } catch (e) {
      status.textContent = `Failed to start camera for player ${player}: ${e.message}`;
    }
  }

  panel.querySelector('#presage-start-1').onclick = () => start(1);
  panel.querySelector('#presage-start-2').onclick = () => start(2);
}
