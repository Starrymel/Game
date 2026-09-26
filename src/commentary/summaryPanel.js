// Owner: C
// Shows the post-match Gemini analysis on screen

export function createSummaryPanel({ doc = globalThis.document } = {}) {
  if (!doc) return { loading() {}, show() {}, error() {}, hide() {} };

  const el = doc.createElement('section');
  el.id = 'summary-panel';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  Object.assign(el.style, {
    // Bottom-centre, just above the logger's "View round recap" button, clear of the HP HUD.
    position: 'fixed', bottom: '84px', left: '50%', transform: 'translateX(-50%)',
    width: 'min(560px, calc(100vw - 32px))', boxSizing: 'border-box', zIndex: '40',
    padding: '16px 20px', borderRadius: '10px', background: 'rgba(12, 14, 20, 0.92)',
    boxShadow: '0 0 0 1px #2c3140, 0 8px 28px rgba(0,0,0,0.5)', color: '#e8eaf0',
    font: '15px/1.45 system-ui, sans-serif', display: 'none',
  });

  const label = doc.createElement('div');
  label.textContent = 'Post-match analysis';
  Object.assign(label.style, { font: '600 12px system-ui, sans-serif', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8a93a8' });
  const headline = doc.createElement('h2');
  Object.assign(headline.style, { margin: '6px 0 8px', font: 'bold 20px system-ui, sans-serif', color: '#ffd84a' });
  const analysis = doc.createElement('p');
  analysis.style.margin = '0 0 8px';
  const turning = doc.createElement('p');
  Object.assign(turning.style, { margin: '0', color: '#b9c0d0' });
  const close = doc.createElement('button');
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Close analysis');
  Object.assign(close.style, {
    position: 'absolute', top: '10px', right: '12px', border: '0', background: 'transparent',
    color: '#8a93a8', font: '16px system-ui', cursor: 'pointer',
  });
  close.onclick = () => hide();
  el.append(close, label, headline, analysis, turning);
  doc.body.appendChild(el);

  function hide() { el.style.display = 'none'; }
  function render(h, a, t) {
    headline.textContent = h;
    analysis.textContent = a;
    turning.textContent = t;
    turning.style.display = t ? '' : 'none';
    el.style.display = '';
  }

  return {
    el,
    hide,
    loading() { render('Analyzing the match…', '', ''); },
    show(s) { render(s.headline, s.analysis, s.turningPoint ? `Turning point: ${s.turningPoint}` : ''); },
    error() { render('Analysis unavailable', 'Could not reach the analysis service.', ''); },
  };
}
