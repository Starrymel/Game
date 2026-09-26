import { mechanicsConfig } from '../mechanics.config.js';
export function drawHUD(ctx, match) {
  for (const id of [1, 2]) {
    const f = match.fighters[id], b = f.biofeedback;
    if (!b) continue;
    const x = id === 1 ? 16 : 486, width = 298;
    ctx.fillStyle = '#111c2e'; ctx.fillRect(x, 10, width, 147);
    ctx.font = 'bold 15px monospace'; ctx.fillStyle = id === 1 ? '#76baff' : '#ff9292';
    ctx.fillText('P' + id + '  ' + (b.valid ? Math.round(b.hr) + ' BPM' : 'SENSOR LOST'), x + 10, 30);
    ctx.font = '11px monospace'; ctx.fillStyle = '#c7d6ea';
    ctx.fillText(b.source.toUpperCase() + ' / breath ' + b.breath.toFixed(1) + '/min', x + 10, 47);
    ctx.fillStyle = '#26344b'; ctx.fillRect(x + 10, 55, 278, 17);
    ctx.fillStyle = f.hp > 30 ? '#4ee6a1' : '#ff6262'; ctx.fillRect(x + 10, 55, 278 * f.hp / f.maxHp, 17);
    ctx.fillStyle = '#fff'; ctx.fillText('HP ' + f.hp.toFixed(1) + '/' + f.maxHp, x + 16, 68);
    ctx.fillStyle = '#26344b'; ctx.fillRect(x + 10, 78, 278, 16);
    ctx.fillStyle = !b.gate ? '#6c7281' : f.meter >= f.maxMeter ? '#ffe278' : '#ba93ff';
    ctx.fillRect(x + 10, 78, 278 * f.meter / f.maxMeter, 16);
    ctx.fillStyle = '#fff';
    ctx.fillText(f.meter >= f.maxMeter ? 'SPECIAL READY' : b.gate ? 'METER ' + Math.floor(f.meter) + '% / BREATH +' + Math.round((b.meterMultiplier - 1) * 100) + '%' : 'GATED / HR outside ' + mechanicsConfig.meter.hrMin + '-' + mechanicsConfig.meter.hrMax, x + 16, 90, 266);
    ctx.fillStyle = b.healRate ? '#6affb4' : '#c7d6ea';
    ctx.fillText(!b.valid ? 'NO SIGNAL / neutral damage & flinch' : b.healRate ? 'CALM +' + Math.round((b.healRate / mechanicsConfig.heal.base - 1) * 100) + '% HEAL / ' + (b.healingReady ? b.healRate.toFixed(1) + ' HP/s' : 'recovering from hit') : 'HEAL PAUSED / calm below threshold', x + 10, 113, 278);
    ctx.fillStyle = b.flinch > 1 ? '#ffad86' : '#88c8ff';
    ctx.fillText((b.spike > b.stress ? 'HR SPIKE' : b.flinch > 1 ? 'STRESS' : 'COMPOSED') + ' / FLINCH ' + b.flinch.toFixed(2) + 'x / DMG ' + b.damage.toFixed(2) + 'x', x + 10, 135, 278);
  }
}
