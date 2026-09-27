import { bus } from '../eventBus.js';
import { mechanicsConfig } from '../mechanics.config.js';
import { hurtbox, overlaps, COMBAT, STAGE } from '../fighter.js';
const flashes = {}, heals = {};
bus.on('flinch', ({ player, magnitude }) => { flashes[player] = { at: performance.now(), magnitude }; });
bus.on('heal_tick', ({ player, amount }) => { if (amount > 0) heals[player] = performance.now(); });
bus.on('round_start', () => { for (const id of [1, 2]) { delete flashes[id]; delete heals[id]; } });
const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
export function beginEffects(ctx) {
  ctx.save();
  const c = mechanicsConfig.effects, now = performance.now();
  const strength = Math.max(0, ...Object.values(flashes).map(f => f.magnitude * Math.max(0, 1 - (now - f.at) / c.flashMs)));
  if (!reduced()) ctx.translate(Math.sin(now * 0.09) * strength * c.shakePx, Math.cos(now * 0.07) * strength * c.shakePx);
}
// ---- Special: eye beam -------------------------------------------------------
// Purely visual. Driven by the fighter's own attack state each frame (so it shows on
// a whiff too; the 'special' bus event only fires when it connects), and it never
// draws farther than the special can actually hit: it ends on the opponent only when
// the special's real hitbox reaches them, otherwise it stops at its true reach.
//
// Eye anchors are fractions of each sprite's right-facing art (assets/characters),
// placed with the same layout render.js uses in drawCharacter().
const SPRITE_HEIGHT = 166, SPRITE_FOOT_OFFSET = 32; // must match drawCharacter() in render.js
const EYES = {
  1: { aspect: 1542 / 1760, color: '#ff3b3b', eyes: [[0.324, 0.40], [0.567, 0.393]] }, // dog: red sparkles
  2: { aspect: 928 / 1410, color: '#ffa31a', eyes: [[0.21, 0.326], [0.447, 0.298]] },  // bunny: orange sparkles
};
const laserArt = typeof Image === 'undefined' ? null : new Image();
if (laserArt) laserArt.src = new URL('../../assets/effects/eye-laser.png', import.meta.url).href;
const BEAM_FADE_MS = 200; // after the active window, while the attacker recovers

export function eyePositions(f) {
  const art = EYES[f.id] ?? EYES[1];
  const w = SPRITE_HEIGHT * art.aspect;
  return art.eyes.map(([u, v]) => ({
    x: f.x + f.facing * (-w / 2 + u * w),
    y: STAGE.groundY - f.y + SPRITE_FOOT_OFFSET - SPRITE_HEIGHT + v * SPRITE_HEIGHT,
  }));
}

// Where the special's hitbox is for this attack (hitbox() in fighter.js only returns it
// during the active phase; the beam also needs it while fading out).
function specialBox(f) {
  const range = COMBAT.specialRange, h = 24;
  const cx = f.x + f.facing * (COMBAT.bodyWidth / 2 + range / 2);
  const cy = STAGE.groundY - f.y - COMBAT.bodyHeight * 0.55;
  return { x: cx - range / 2, y: cy - h / 2, w: range, h };
}

// null when no beam should be drawn; otherwise eyes -> end, whether it's on the
// opponent, and 0..1 opacity for this frame.
export function beamGeometry(attacker, defender) {
  const a = attacker.attack;
  if (!a || a.kind !== 'special') return null;
  const active = COMBAT.specialActiveMs;
  if (a.elapsedMs > active + BEAM_FADE_MS) return null;
  const box = specialBox(attacker);
  const target = hurtbox(defender);
  const onTarget = a.hasHit || (defender.state !== 'ko' && overlaps(box, target));
  const end = onTarget
    ? { x: target.x + target.w / 2 - attacker.facing * target.w * 0.25, y: target.y + target.h * 0.4 }
    : { x: attacker.facing > 0 ? box.x + box.w : box.x, y: box.y + box.h / 2 };
  const grow = Math.min(1, a.elapsedMs / 40);                                  // quick charge-in
  const fade = a.elapsedMs <= active ? 1 : 1 - (a.elapsedMs - active) / BEAM_FADE_MS;
  const eyes = eyePositions(attacker);
  const center = { x: (eyes[0].x + eyes[1].x) / 2, y: (eyes[0].y + eyes[1].y) / 2 };
  // Both rays use one aim slope, with separate endpoints rather than converging.
  const slope = (end.y - center.y) / (end.x - center.x || attacker.facing);
  const ends = eyes.map(eye => ({ x: end.x, y: eye.y + slope * (end.x - eye.x) }));
  return { eyes, ends, end, onTarget, alpha: Math.max(0, grow * fade), color: (EYES[attacker.id] ?? EYES[1]).color };
}

function drawBeam(ctx, beam, now) {
  const wobble = reduced() ? 1 : 1 + 0.18 * Math.sin(now * 0.06);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.globalCompositeOperation = 'lighter';
  for (const [i, eye] of beam.eyes.entries()) {
    const tip = beam.ends[i];
    if (laserArt?.complete && laserArt.naturalWidth > 0) {
      const dx = tip.x - eye.x, dy = tip.y - eye.y;
      const length = Math.hypot(dx, dy);
      // The extracted sprite's flare is at 15.7% x / 49.1% y.
      // Align that flare to the eye and the right edge to the real attack endpoint.
      const width = length / (1 - 0.157);
      const height = 30 * wobble;
      ctx.save();
      ctx.translate(eye.x, eye.y);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.globalAlpha = beam.alpha;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(laserArt, -0.157 * width, -0.491 * height, width, height);
      ctx.restore();
      continue;
    }
    ctx.globalAlpha = 0.45 * beam.alpha;
    ctx.strokeStyle = beam.color; ctx.shadowColor = beam.color; ctx.shadowBlur = 16;
    ctx.lineWidth = 5 * wobble;
    ctx.beginPath(); ctx.moveTo(eye.x, eye.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    ctx.globalAlpha = beam.alpha;
    ctx.strokeStyle = '#fff6e0'; ctx.shadowBlur = 4; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(eye.x, eye.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    ctx.fillStyle = '#fff6e0';
    ctx.beginPath(); ctx.arc(eye.x, eye.y, 4 * wobble, 0, Math.PI * 2); ctx.fill();   // eye flare
  }
  if (beam.onTarget) {                                                              // impact burst
    ctx.globalAlpha = 0.8 * beam.alpha;
    ctx.fillStyle = beam.color; ctx.shadowColor = beam.color; ctx.shadowBlur = 24;
    ctx.beginPath(); ctx.arc(beam.end.x, beam.end.y, 14 * wobble, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

export function drawEffects(ctx, match) {
  const now = performance.now(), c = mechanicsConfig.effects;
  for (const [id, other] of [[1, 2], [2, 1]]) {
    const beam = beamGeometry(match.fighters[id], match.fighters[other]);
    if (beam) drawBeam(ctx, beam, now);
  }
  for (const id of [1, 2]) {
    const box = hurtbox(match.fighters[id]), flash = flashes[id];
    if (flash && now - flash.at < c.flashMs) {
      ctx.fillStyle = 'rgba(255,115,85,' + (0.65 * flash.magnitude * (1 - (now - flash.at) / c.flashMs)) + ')';
      ctx.fillRect(box.x - 8, box.y - 8, box.w + 16, box.h + 16);
    }
    if (heals[id] !== undefined && now - heals[id] < c.healMs) {
      ctx.save(); ctx.strokeStyle = '#65ffb5'; ctx.shadowColor = '#65ffb5'; ctx.shadowBlur = 18;
      ctx.lineWidth = 3; ctx.strokeRect(box.x - 5, box.y - 5, box.w + 10, box.h + 10);
      ctx.fillStyle = '#65ffb5';
      for (let i = 0; i < 5; i++) {
        const rise = reduced() ? i * 12 : (now / 18 + i * 19) % 90;
        ctx.fillRect(box.x - 8 + i * 14, box.y + box.h - rise, 3, 3);
      }
      ctx.restore();
    }
  }
  ctx.restore();
}
