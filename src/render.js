import { drawHUD } from './ui/hud.js';
import { beginEffects, drawEffects, impactPoint } from './ui/effects.js';
import { STAGE, hurtbox, hitbox } from './fighter.js';
import { drawPrize } from './ui/prizeRender.js';
import { drawHazard } from './ui/hazardRender.js';

const COLORS = { 1: '#4da3ff', 2: '#ff5c5c' };

// Original right-facing drawings. Canvas transforms mirror them without editing the PNGs.
const CHARACTER_ART = { 1: 'dog.png', 2: 'bunny.png' };
const sprites = Object.fromEntries(Object.entries(CHARACTER_ART).map(([id, file]) => {
  const image = new Image();
  image.src = new URL('../assets/characters/' + file, import.meta.url).href;
  return [id, image];
}));

function drawCharacter(ctx, fighter) {
  const image = sprites[fighter.id];
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) return false;
  const height = 166;
  const width = height * image.naturalWidth / image.naturalHeight;
  ctx.save();
  ctx.translate(fighter.x, STAGE.groundY - fighter.y + 32); // Visual foot offset; physics stays unchanged.
  ctx.scale(fighter.facing < 0 ? -1 : 1, 1);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (fighter.state === 'flinch') ctx.filter = 'brightness(1.7)';
  else if (fighter.state === 'block') ctx.filter = 'brightness(0.8)';
  else if (fighter.state === 'ko') { ctx.filter = 'grayscale(1)'; ctx.globalAlpha = 0.55; }
  ctx.drawImage(image, -width / 2, -height, width, height);
  ctx.restore();
  return true;
}

function loadArt(path) {
  const image = new Image();
  image.src = new URL(path, import.meta.url).href;
  return image;
}
const arena = loadArt('../assets/backgrounds/stone-arena.jpeg');
const explosion = loadArt('../assets/effects/explosion.png');
const ready = image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;

function drawArena(ctx) {
  ctx.fillStyle = '#1b1f2a';
  ctx.fillRect(0, 0, STAGE.width, STAGE.height);
  if (!ready(arena)) return;
  // Cover the canvas without distortion; bottom alignment keeps the arena floor visible.
  const scale = Math.max(STAGE.width / arena.naturalWidth, STAGE.height / arena.naturalHeight);
  const width = arena.naturalWidth * scale, height = arena.naturalHeight * scale;
  ctx.drawImage(arena, (STAGE.width - width) / 2, STAGE.height - height, width, height);
}

function drawAttack(ctx, fighter, opponent) {
  const box = hitbox(fighter);
  if (!box || !ready(explosion)) return;
  const ranged = fighter.attack.kind === 'laser' || fighter.attack.kind === 'special';
  // Ranged attacks: the explosion goes on the target at the end of the beam (only when it lands), not at the middle
  // of their long hit area. Close-range punches keep drawing at the middle of their (short) hit area.
  const impact = ranged ? impactPoint(fighter, opponent) : null;
  if (ranged && !impact) return;
  const height = impact ? impact.height : 144;
  const width = height * explosion.naturalWidth / explosion.naturalHeight;
  ctx.save();
  ctx.translate(impact ? impact.x : box.x + box.w / 2, impact ? impact.y : box.y + box.h / 2);
  ctx.scale(fighter.facing < 0 ? -1 : 1, 1);
  ctx.drawImage(explosion, -width / 2, -height / 2, width, height);
  ctx.restore();
}
export function render(ctx, match) {
  ctx.clearRect(0, 0, STAGE.width, STAGE.height);

  beginEffects(ctx);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  drawArena(ctx);

  for (const id of [1, 2]) {
    const f = match.fighters[id];
    const box = hurtbox(f);

    if (!drawCharacter(ctx, f)) {
      ctx.fillStyle = f.state === 'flinch' ? '#ffffff'
        : f.state === 'block' ? '#8899aa'
        : f.state === 'ko' ? '#333'
        : COLORS[id];
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }

  }
  drawPrize(ctx, match); // falling prize (no-op when the match has none)
  drawHazard(ctx, match); // falling swords: floor warning + the sword (no-op when the match has none)
  // Draw attacks above both characters, so neither player's effect is hidden.
  for (const id of [1, 2]) drawAttack(ctx, match.fighters[id], match.fighters[id === 1 ? 2 : 1]);
  drawEffects(ctx, match);
  drawHUD(ctx, match);

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 26px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(String(Math.ceil(match.timeRemaining)), STAGE.width / 2, 36);
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
