import { drawHUD } from './ui/hud.js';
import { beginEffects, drawEffects } from './ui/effects.js';
import { STAGE, COMBAT, hurtbox, hitbox } from './fighter.js';

const COLORS = { 1: '#4da3ff', 2: '#ff5c5c' };

export function render(ctx, match) {
  ctx.clearRect(0, 0, STAGE.width, STAGE.height);

  beginEffects(ctx);

  // ground
  ctx.fillStyle = '#1b1f2a';
  ctx.fillRect(0, 0, STAGE.width, STAGE.height);
  ctx.strokeStyle = '#444';
  ctx.beginPath();
  ctx.moveTo(0, STAGE.groundY);
  ctx.lineTo(STAGE.width, STAGE.groundY);
  ctx.stroke();

  for (const id of [1, 2]) {
    const f = match.fighters[id];
    const box = hurtbox(f);

    ctx.fillStyle = f.state === 'flinch' ? '#ffffff'
      : f.state === 'block' ? '#8899aa'
      : f.state === 'ko' ? '#333'
      : COLORS[id];
    ctx.fillRect(box.x, box.y, box.w, box.h);

    const hb = hitbox(f);
    if (hb) {
      ctx.fillStyle = 'rgba(255,255,0,0.6)';
      ctx.fillRect(hb.x, hb.y, hb.w, hb.h);
    }

  }
  drawEffects(ctx, match);
  drawHUD(ctx, match);

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(String(Math.ceil(match.timeRemaining)), STAGE.width / 2, 32);
  ctx.textAlign = 'left';

  if (match.over) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, STAGE.width, STAGE.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Round over - press R to restart', STAGE.width / 2, STAGE.height / 2);
    ctx.textAlign = 'left';
  }
}
