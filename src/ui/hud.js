import { mechanicsConfig } from '../mechanics.config.js';

function rounded(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function drawHealth(ctx, fighter, x) {
  const ratio = Math.max(0, Math.min(1, fighter.hp / fighter.maxHp));
  const left = x + 32, top = 54, width = 256, height = 20;
  const color = ratio > 0.75 ? '#00b833' : ratio > 0.5 ? '#82bd00'
    : ratio > 0.3 ? '#ded500' : ratio > 0.15 ? '#ff7800' : '#e82116';
  ctx.save();
  rounded(ctx, left, top, width, height, 9);
  ctx.fillStyle = '#f5f6ed'; ctx.fill();
  ctx.clip();
  ctx.fillStyle = color; ctx.fillRect(left, top, width * ratio, height);
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(left, top + 3, width * ratio, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(left, top + 15, width * ratio, 5);
  ctx.restore();
  rounded(ctx, left, top, width, height, 9);
  ctx.strokeStyle = '#060908'; ctx.lineWidth = 2; ctx.stroke();

  // Pixel heart drawn in canvas so it stays crisp without an extra image asset.
  const heart = [
    '.BBB...BBB.',
    'BRRRB.BRRRB',
    'BRWWRBRRRRB',
    'BRWRRRRRRRB',
    'BRRRRRRRRRB',
    '.BRRRRRRRB.',
    '..BRRRRRB..',
    '...BRRRB...',
    '....BRB....',
    '.....B.....',
  ];
  const colors = { B: '#100b0d', R: '#ee171f', W: '#ffb5b8' };
  heart.forEach((row, y) => [...row].forEach((pixel, col) => {
    if (!colors[pixel]) return;
    ctx.fillStyle = colors[pixel];
    ctx.fillRect(x + 8 + col * 3, 50 + y * 3, 3, 3);
  }));
  ctx.save();
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.lineWidth = 3; ctx.strokeStyle = '#fff';
  const label = 'HP ' + fighter.hp.toFixed(1) + '/' + fighter.maxHp;
  ctx.strokeText(label, left + width / 2, 68);
  ctx.fillStyle = '#101810'; ctx.fillText(label, left + width / 2, 68);
  ctx.restore();
}
function drawPlayerLabel(ctx, id, x, y, color) {
  const glyphs = {
    P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    ':': ['0', '1', '1', '0', '1', '1', '0'],
  };
  const pixels = [];
  let offset = 0;
  for (const letter of 'P' + id + ':') {
    const rows = glyphs[letter];
    rows.forEach((row, r) => [...row].forEach((bit, c) => {
      if (bit === '1') pixels.push([x + offset + c * 2, y + r * 2]);
    }));
    offset += (rows[0].length + 2) * 2;
  }
  ctx.save();
  ctx.fillStyle = '#08090d';
  for (const [px, py] of pixels) ctx.fillRect(px - 1, py - 1, 5, 5);
  ctx.fillStyle = color;
  for (const [px, py] of pixels) ctx.fillRect(px, py, 3, 3);
  ctx.restore();
}
export function drawHUD(ctx, match) {
  for (const id of [1, 2]) {
    const f = match.fighters[id], b = f.biofeedback;
    if (!b) continue;
    const x = id === 1 ? 16 : 486;
    // Scale toward the outer top corner, preserving equal screen margins.
    const anchorX = id === 1 ? 16 : 784;
    ctx.save();
    ctx.translate(anchorX, 10);
    ctx.scale(0.9, 0.9);
    ctx.translate(-anchorX, -10);

    const playerColor = id === 1 ? '#76baff' : '#ff2438';
    drawPlayerLabel(ctx, id, x + 10, 16, playerColor);
    ctx.font = 'bold 15px monospace'; ctx.fillStyle = playerColor;
    const heartRateLabel = b.valid ? Math.round(b.hr) + ' BPM' : 'SENSOR LOST';
    ctx.save(); ctx.strokeStyle = '#08090d'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    ctx.strokeText(heartRateLabel, x + 54, 30);
    ctx.fillText(heartRateLabel, x + 54, 30); ctx.restore();
    ctx.font = 'bold 11px monospace'; ctx.fillStyle = '#c7d6ea';
    ctx.fillText(b.source.toUpperCase() + ' / breath ' + b.breath.toFixed(1) + '/min', x + 10, 47);
    drawHealth(ctx, f, x);
    // (The special/meter bar was removed: the eyebrow laser is the regular attack now, so there is no meter to show.)
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = b.healRate ? '#6affb4' : '#c7d6ea';
    ctx.fillText(!b.valid ? 'NO SIGNAL / neutral damage & flinch' : b.healRate ? 'CALM +' + Math.round((b.healRate / mechanicsConfig.heal.base - 1) * 100) + '% HEAL / ' + (b.healingReady ? b.healRate.toFixed(1) + ' HP/s' : 'recovering from hit') : 'HEAL PAUSED / calm below threshold', x + 10, 96, 278);
    ctx.fillStyle = b.flinch > 1 ? '#ffad86' : '#88c8ff';
    ctx.fillText((b.spike > b.stress ? 'HR SPIKE' : b.flinch > 1 ? 'STRESS' : 'COMPOSED') + ' / FLINCH ' + b.flinch.toFixed(2) + 'x / DMG ' + b.damage.toFixed(2) + 'x', x + 10, 118, 278);
    ctx.restore();
  }
}
