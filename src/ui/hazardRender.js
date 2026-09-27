// Draws the falling sword and its warning marker. Artist drop-in: assets/hazards/sword1.png .. sword3.png
// (drawn pointing DOWN; see the README there). With no art files the sword is drawn with simple shapes.
import { STAGE, hurtbox } from '../fighter.js';
import { HAZARD } from '../hazard.js';

const ART_FILES = ['sword1.png', 'sword2.png', 'sword3.png'];
const images = ART_FILES.map((file) => {
  if (typeof Image === 'undefined') return null; // node tests
  const img = new Image();
  img.src = new URL('../../assets/hazards/' + file, import.meta.url).href;
  return img;
});
const usable = (img) => img && img.complete && img.naturalWidth > 0;

export function pickSwordArt(art, loaded = images) {
  const ok = loaded.filter(usable);
  return ok.length ? ok[art % ok.length] : null;
}

// Warning: a faint red column from the sky to the spot, plus a pulsing red ellipse and a "!" on the floor
// (shape + text + motion, not only colour), so the landing spot can be read at a glance.
function drawWarning(ctx, x, progress, now) {
  const y = STAGE.groundY + 8;
  const pulse = 0.55 + 0.45 * Math.sin(now / 70);
  const grow = 0.7 + 0.3 * progress;
  ctx.save();
  ctx.globalAlpha = 0.10 + 0.14 * pulse * progress;
  ctx.fillStyle = '#ff3b3b';
  ctx.fillRect(x - HAZARD.width / 2, 0, HAZARD.width, y);            // the column the sword will fall down
  ctx.globalAlpha = 0.35 + 0.4 * pulse;
  ctx.beginPath(); ctx.ellipse(x, y, 58 * grow, 16 * grow, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(x, y, 58 * grow, 16 * grow, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.font = 'bold 40px monospace'; ctx.textAlign = 'center';
  ctx.lineWidth = 6; ctx.strokeStyle = '#7a0000'; ctx.fillStyle = '#fff';
  ctx.strokeText('!', x, y - 34); ctx.fillText('!', x, y - 34);
  ctx.restore();
}

// A plain sword, tip at (0,0) pointing down: blade, crossguard, grip, pommel.
function drawFallbackSword(ctx, x, tipY) {
  const w = HAZARD.width, len = HAZARD.length;
  ctx.save();
  ctx.translate(x, tipY);
  ctx.shadowColor = 'rgba(255,255,255,.6)'; ctx.shadowBlur = 8;
  ctx.fillStyle = '#dfe6f0'; ctx.strokeStyle = '#5b6678'; ctx.lineWidth = 2;
  ctx.beginPath();                                   // blade (narrowing to the tip)
  ctx.moveTo(0, 0); ctx.lineTo(-w * 0.22, -len * 0.18); ctx.lineTo(-w * 0.22, -len * 0.7);
  ctx.lineTo(w * 0.22, -len * 0.7); ctx.lineTo(w * 0.22, -len * 0.18); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#c9932d';                         // crossguard
  ctx.fillRect(-w / 2, -len * 0.76, w, len * 0.07); ctx.strokeRect(-w / 2, -len * 0.76, w, len * 0.07);
  ctx.fillStyle = '#6b3f1d';                         // grip
  ctx.fillRect(-w * 0.12, -len, w * 0.24, len * 0.24);
  ctx.fillStyle = '#c9932d';                         // pommel
  ctx.beginPath(); ctx.arc(0, -len, w * 0.17, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

let seenHitSeq = -1, popup = null;

export function drawHazard(ctx, match, now = performance.now()) {
  const h = match.hazard;
  if (!h) return;

  // "-12 HP" popup over whoever got hit (works on the guest too: it rides along in the state).
  const hit = h.lastHit;
  if (hit && hit.seq !== seenHitSeq) { seenHitSeq = hit.seq; popup = { player: hit.player, hp: hit.hp, at: now }; }
  if (popup && now - popup.at < 1100) {
    const f = match.fighters[popup.player];
    if (f) {
      const box = hurtbox(f), k = (now - popup.at) / 1100;
      ctx.save();
      ctx.globalAlpha = 1 - k; ctx.fillStyle = '#ff6b6b'; ctx.strokeStyle = '#3a0000'; ctx.lineWidth = 3;
      ctx.font = 'bold 22px monospace'; ctx.textAlign = 'center';
      ctx.strokeText(`-${popup.hp} HP`, box.x + box.w / 2, box.y - 10 - k * 34);
      ctx.fillText(`-${popup.hp} HP`, box.x + box.w / 2, box.y - 10 - k * 34);
      ctx.restore();
    }
  }

  if (h.phase === 'warn') { drawWarning(ctx, h.x, Math.min(1, h.t / HAZARD.warnS), now); return; }
  if (h.phase !== 'fall' && h.phase !== 'stuck') return;

  const tipY = STAGE.groundY - h.yh;
  const alpha = h.phase === 'stuck' ? Math.max(0, 1 - h.t / HAZARD.stuckS) : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  const img = pickSwordArt(h.art);
  if (img) {
    if (img === images[0]) {
      // Original art runs from top-left hilt to bottom-right tip.
      // Rotate clockwise around the tip so it points straight down.
      const side = HAZARD.length / Math.SQRT2;
      ctx.translate(h.x, tipY);
      ctx.rotate(Math.PI / 4);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, -side, -side, side, side);
    } else {
      const w = HAZARD.width * 1.5, hh = w * img.naturalHeight / img.naturalWidth;
      ctx.drawImage(img, h.x - w / 2, tipY - hh, w, hh);
    }
  } else drawFallbackSword(ctx, h.x, tipY);
  ctx.restore();
}
