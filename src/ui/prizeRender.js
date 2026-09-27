// Draws the falling prize. Artist drop-in: assets/prizes/prize1.png .. prize3.png (see the README there).
// With no art files the prize is a golden star, so the game always works.
import { STAGE, hurtbox } from '../fighter.js';
import { PRIZE } from '../prize.js';

const ART_FILES = ['prize1.png', 'prize2.png', 'prize3.png'];
const images = ART_FILES.map((file) => {
  if (typeof Image === 'undefined') return null; // node tests
  const img = new Image();
  img.src = new URL('../../assets/prizes/' + file, import.meta.url).href;
  return img;
});
const usable = (img) => img && img.complete && img.naturalWidth > 0;

// Which loaded image to use for a given art slot (slots without a file fall back to the next one that exists).
export function pickArt(art, loaded = images) {
  const ok = loaded.filter(usable);
  return ok.length ? ok[art % ok.length] : null;
}

function drawStar(ctx, cx, cy, r) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = '#ffd34d'; ctx.strokeStyle = '#a86a00'; ctx.lineWidth = 2;
  ctx.shadowColor = '#ffe27a'; ctx.shadowBlur = 14;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

let seenCatchSeq = -1, popup = null;

export function drawPrize(ctx, match, now = performance.now()) {
  const p = match.prize;
  if (!p) return;

  // "+15 HP" popup when a catch happens (works on the guest too: the catch rides along in the state).
  const c = p.lastCatch;
  if (c && c.seq !== seenCatchSeq) {
    seenCatchSeq = c.seq;
    popup = { player: c.player, hp: c.hp, at: now };
  }
  if (popup && now - popup.at < 1100) {
    const f = match.fighters[popup.player];
    if (f) {
      const box = hurtbox(f), k = (now - popup.at) / 1100;
      ctx.save();
      ctx.globalAlpha = 1 - k; ctx.fillStyle = '#65ffb5'; ctx.font = 'bold 20px monospace'; ctx.textAlign = 'center';
      ctx.fillText(`+${popup.hp} HP  +${PRIZE.meterGain}% meter`, box.x + box.w / 2, box.y - 10 - k * 34);
      ctx.restore();
    }
  }

  if (!p.active) return;
  // Blink during the last two seconds before it vanishes.
  if (p.landed && p.ttl < 2 && Math.floor(now / 120) % 2) return;
  const cx = p.x, cy = STAGE.groundY - p.yh, size = PRIZE.size;
  const bob = p.landed ? Math.sin(now / 220) * 2 : 0;
  const img = pickArt(p.art);
  if (img) ctx.drawImage(img, cx - size / 2, cy - size / 2 + bob, size, size * img.naturalHeight / img.naturalWidth);
  else drawStar(ctx, cx, cy + bob, size / 2);
}
