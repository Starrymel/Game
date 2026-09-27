// End of a round, hands-free: SMILE = play again, RAISE EYEBROWS = back to the start screen (hold it until the bar fills).
// Buttons and keys work too (R = play again). Works for both laptops online: "play again" is the same
// request the R key makes (the guest asks the host), and leaving just reloads the start page.
import { bus } from '../eventBus.js';
import { KINDS } from '../face/personalCal.js';
import { ICONS } from './lobby.js';

export const ROUND_END_PACE = { armMs: 3000, holdMs: 1000 };   // wait this long after the round ends, then hold this long to choose

const CSS = `
#roundend{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:70;display:flex;gap:14px;font:700 16px/1.3 ui-monospace,Menlo,Consolas,monospace;color:#42271f}
#roundend[hidden]{display:none}
#roundend button{position:relative;overflow:hidden;font:inherit;color:inherit;width:min(300px,44vw);padding:10px 12px;display:flex;align-items:center;gap:12px;text-align:left;background:#fff0df;border:3px solid #b87d50;border-radius:16px;cursor:pointer;text-align:center}
#roundend button:hover,#roundend button:focus-visible{border-color:#925125;outline:none}
#roundend button > *:not(.prog){position:relative}
#roundend .prog{position:absolute;left:0;top:0;bottom:0;width:0;background:rgba(201,106,27,.38);box-shadow:inset -4px 0 0 #c96a1b}
#roundend svg{flex:none}
#roundend .txt{display:block}
#roundend b{display:block;font-size:20px}
#roundend small{display:block;font-size:14px;font-weight:600}
#roundend.locked button{filter:saturate(.4) brightness(.92)}
`;

export function initRoundEnd({ faceControl = null, player = 1, restart = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true })), exit = () => location.assign(location.pathname), now = () => Date.now(), pace = {} } = {}) {
  const PACE = { ...ROUND_END_PACE, ...pace };
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  const el = document.createElement('div'); el.id = 'roundend'; el.hidden = true; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Round over');
  const smallIco = (svg) => svg.replace('width="84" height="84"', 'width="48" height="48"');
  el.innerHTML = `
    <button type="button" data-a="again"><span class="prog"></span>${smallIco(ICONS.p1)}<span class="txt"><b>Play again</b><small>Smile (or press R)</small></span></button>
    <button type="button" data-a="exit"><span class="prog"></span>${smallIco(ICONS.p2)}<span class="txt"><b>Exit</b><small>Raise eyebrows</small></span></button>`;
  document.body.append(el);

  let over = false, overSince = 0, holdKind = null, holdSince = 0, done = false;
  const bar = (a) => el.querySelector(`[data-a="${a}"] .prog`);
  const setBars = (kind, k) => { for (const a of ['again', 'exit']) bar(a).style.width = a === kind ? `${Math.round(k * 100)}%` : '0'; };
  const armed = () => over && now() - overSince >= PACE.armMs;
  const act = (a) => { if (done) return; done = true; el.hidden = true; (a === 'again' ? restart : exit)(); };

  // Call every frame with `match.over` (works the same for the host, the guest and local play).
  function update(isOver) {
    if (isOver && !over) { over = true; overSince = now(); done = false; holdKind = null; setBars(null, 0); el.hidden = false; }
    else if (!isOver && over) { over = false; el.hidden = true; holdKind = null; setBars(null, 0); }
    el.classList.toggle('locked', over && !armed());
  }

  el.addEventListener('click', (e) => { const b = e.target.closest?.('button'); if (b) act(b.dataset.a); });
  // 'R' is handled by the game itself; after it the round restarts and update(false) hides this panel.

  const offFace = bus.on('face_values', (m) => {
    if (!faceControl || m.player !== player || !over || done) return;
    const sc = m.scores, s = faceControl.settings;
    if (!sc || !armed() || faceControl.status !== 'ready') { holdKind = null; setBars(null, 0); return; }
    const smileX = KINDS.smile(sc) - s.smileUp, browsX = KINDS.brows(sc) - s.browsUp;
    const kind = smileX > 0 && smileX >= browsX ? 'again' : browsX > 0 ? 'exit' : null;
    if (!kind) { holdKind = null; setBars(null, 0); return; }
    const t = now();
    if (kind !== holdKind) { holdKind = kind; holdSince = t; }
    const k = Math.min(1, (t - holdSince) / PACE.holdMs);
    setBars(kind, k);
    if (k >= 1) act(kind);
  });

  return { update, stop() { offFace(); el.remove(); style.remove(); } };
}
