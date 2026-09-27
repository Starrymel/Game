export function initMusic() {
  const audio = new Audio(new URL('../assets/audio/music/face-off.ogg', import.meta.url).href);
  audio.loop = true;
  audio.preload = 'metadata';
  audio.volume = 0.2;
  let enabled = true;
  let unlocked = false;
  let pending = false;

  const panel = document.createElement('div');
  panel.className = 'game-controls';
  panel.setAttribute('aria-label', 'Background music controls');
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Music: ready';
  button.setAttribute('aria-pressed', 'true');
  const label = document.createElement('label');
  label.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin-left:16px';
  label.append('Music volume ');
  const volume = document.createElement('input');
  volume.type = 'range'; volume.min = '0'; volume.max = '100'; volume.value = '20';
  label.append(volume);
  panel.append(button, label);
  document.querySelector('.game-controls')?.after(panel);

  async function play() {
    if (!enabled || !unlocked || document.hidden || pending || !audio.paused) return;
    pending = true;
    try {
      await audio.play();
      if (!enabled || document.hidden) audio.pause();
      else button.textContent = 'Music: on';
    } catch {
      button.textContent = 'Music: click to play';
    } finally { pending = false; }
  }
  function unlock(event) {
    if (panel.contains(event.target) || event.repeat) return;
    unlocked = true;
    void play();
  }
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  button.addEventListener('click', () => {
    unlocked = true;
    if (enabled && !audio.paused) {
      enabled = false; audio.pause(); button.textContent = 'Music: off';
    } else { enabled = true; void play(); }
    button.setAttribute('aria-pressed', String(enabled));
  });
  volume.addEventListener('input', () => { audio.volume = Number(volume.value) / 100; });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audio.pause();
    else void play();
  });
  audio.addEventListener('error', () => {
    button.textContent = 'Music unavailable';
    button.disabled = true;
  });
  return audio;
}
