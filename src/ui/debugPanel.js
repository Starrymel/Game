import { mechanicsConfig as config, biometricOverrides as overrides } from '../mechanics.config.js';
export function initDebugPanel(match) {
  const panel = document.createElement('details');
  panel.id = 'bio-debug'; panel.open = true;
  panel.innerHTML = '<summary>Biofeedback lab · live tuning</summary><p>Demo: equal HP, P1 calm / P2 stressed. Sliders override the selected sensor.</p><button type="button" id="bio-demo">10-second comparison demo</button> <button type="button" id="bio-release">Release overrides</button><div id="bio-sliders"></div><details><summary>Formula constants</summary><div id="bio-constants"></div></details>';
  document.body.append(panel);
  const inputs = {};
  const slider = (parent, label, min, max, step, value, change) => {
    const row = document.createElement('label'), text = document.createElement('span'), input = document.createElement('input'), output = document.createElement('output');
    text.textContent = label; input.type = 'range'; Object.assign(input, { min, max, step, value }); output.textContent = value;
    input.addEventListener('input', () => { output.textContent = input.value; change(Number(input.value)); });
    row.append(text, input, output); parent.append(row);
    return { input, output };
  };
  for (const id of [1, 2]) {
    const group = document.createElement('fieldset'); group.innerHTML = '<legend>P' + id + ' biometric override</legend>';
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.setAttribute('aria-label', 'Enable P' + id + ' override'); group.append(toggle);
    const values = { hr: 80, breath: 10, stress: 0.2, calm: 0.8 };
    inputs[id] = { toggle, values, fields: {} };
    toggle.onchange = () => { overrides[id] = toggle.checked ? { ...values } : null; };
    for (const [key, min, max, step] of [['hr',40,200,1], ['breath',4,40,1], ['stress',0,1,0.01], ['calm',0,1,0.01]]) {
      inputs[id].fields[key] = slider(group, key, min, max, step, values[key], value => {
        values[key] = value; toggle.checked = true; overrides[id] = { ...values };
      });
    }
    panel.querySelector('#bio-sliders').append(group);
  }
  const ranges = {
    samples:[1,30,1], staleMs:[500,10000,100], hrMin:[40,100,1], hrMax:[110,200,1], breathMin:[4,8,1], breathMax:[30,50,1],
    ideal:[6,16,1], tolerance:[2,20,1], variation:[1,10,0.5], base:[0.1,1,0.1], bonus:[0,0.8,0.05],
    calmThreshold:[0.3,0.95,0.05], max:[1,2,0.05], delayMs:[500,3000,100],
    min:[0.75,1,0.01], spikeBpm:[10,50,1], hysteresis:[0,8,1], passivePerSecond:[0,5,0.25],
    breathBonus:[0,1,0.05], shakePx:[0,12,1], flashMs:[50,300,10], healMs:[100,700,25]
  };
  for (const [section, values] of Object.entries(config)) {
    for (const [key, value] of Object.entries(values)) {
      const range = key === 'max' && section === 'damage' ? [1,1.15,0.01] : key === 'max' && section === 'flinch' ? [1,1.4,0.01] : ranges[key];
      slider(panel.querySelector('#bio-constants'), section + '.' + key, ...range, value, next => { values[key] = next; });
    }
  }
  panel.querySelector('#bio-demo').onclick = () => {
    if (match.over) { panel.querySelector('p').textContent = 'Press R to restart, then click the demo.'; return; }
    for (const id of [1,2]) {
      const values = id === 1 ? { hr:80, breath:10, stress:0, calm:1 } : { hr:145, breath:27, stress:1, calm:0 };
      Object.assign(inputs[id].values, values); inputs[id].toggle.checked = true; overrides[id] = { ...values };
      for (const [key,value] of Object.entries(values)) { inputs[id].fields[key].input.value = value; inputs[id].fields[key].output.textContent = value; }
      match.fighters[id].hp = 60; match.fighters[id].meter = 0;
    }
    panel.querySelector('p').textContent = 'DEMO OVERRIDES ACTIVE: watch P1 heal and charge; P2 is gated. Move together and attack to compare flinch.';
  };
  panel.querySelector('#bio-release').onclick = () => {
    for (const id of [1,2]) { overrides[id] = null; inputs[id].toggle.checked = false; }
    panel.querySelector('p').textContent = 'Overrides released. Using the selected biometric source.';
  };
}
