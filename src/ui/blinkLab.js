// Blink lab (opt-in: ?blinklab=1). Shows what Presage reports for blinks so we can judge
// accuracy and delay before building anything on it. Needs the bridge started with PRESAGE_FACE=1.
import { bus } from '../eventBus.js';
import { pulseInput } from '../input.js';

export function summarizeBlinks(blinks) {
  if (!blinks.length) return { count: 0, last: null, avg: null };
  const delays = blinks.map((b) => b.delayMs);
  return {
    count: blinks.length,
    last: delays.at(-1),
    avg: Math.round(delays.reduce((a, b) => a + b, 0) / delays.length),
  };
}

export function initBlinkLab({ player }) {
  const panel = document.createElement('details');
  panel.id = 'blink-lab';
  panel.open = true;
  panel.innerHTML = `
    <summary>Blink lab (player ${player})</summary>
    <p id="bl-hint">Start the bridge with <code>PRESAGE_FACE=1 npm start</code>, start the camera above, then blink on purpose.</p>
    <p id="bl-blinks">Blinks: 0</p>
    <p id="bl-delay">Delay: -</p>
    <p id="bl-face">Talking: - | Expression: -</p>
    <p id="bl-age"></p>
    <label><input type="checkbox" id="bl-fire"> Blink = light attack</label><br>
    <button type="button" id="bl-sim">Simulate blink</button>
    <button type="button" id="bl-reset">Reset counts</button>
  `;
  document.body.append(panel);
  const $ = (id) => panel.querySelector(id);
  let blinks = [];
  let lastMsgAt = 0;
  let firstBlinkAt = 0;

  function fire() { if ($('#bl-fire').checked) pulseInput(player, 'light', 150); }

  bus.on('face_sample', (m) => {
    if (m.player !== player) return;
    lastMsgAt = Date.now();
    $('#bl-face').textContent = `Talking: ${m.talking == null ? '-' : m.talking ? 'yes' : 'no'} | Expression: ${
      m.expression ? `${m.expression.name} ${m.expression.score}%${m.expression.stable ? '' : ' (unstable)'}` : '-'}`;
    if (m.blink) {
      if (!firstBlinkAt) firstBlinkAt = Date.now();
      blinks.push({ delayMs: m.blink.delayMs, stable: m.blink.stable });
      const s = summarizeBlinks(blinks);
      $('#bl-blinks').textContent = `Blinks: ${s.count}`;
      $('#bl-delay').textContent = `Delay: last ${s.last} ms, average ${s.avg} ms (SDK processing lag before the bridge saw it; browser/network adds a little more)`;
      fire();
    }
  });

  $('#bl-sim').onclick = () => { bus.emit('face_sample', { player, type: 'face', blink: { count: blinks.length + 1, delayMs: 0, stable: true }, talking: null, expression: null }); };
  $('#bl-reset').onclick = () => { blinks = []; firstBlinkAt = 0; $('#bl-blinks').textContent = 'Blinks: 0'; $('#bl-delay').textContent = 'Delay: -'; };
  setInterval(() => {
    $('#bl-age').textContent = lastMsgAt ? `Last face message ${Math.round((Date.now() - lastMsgAt) / 1000)}s ago` : 'No face messages yet (is the bridge running with PRESAGE_FACE=1 and the camera started?)';
  }, 1000);
}
