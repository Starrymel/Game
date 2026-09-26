import { bus } from '../eventBus.js';
import { mechanicsConfig } from '../mechanics.config.js';
import { hurtbox } from '../fighter.js';
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
export function drawEffects(ctx, match) {
  const now = performance.now(), c = mechanicsConfig.effects;
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
