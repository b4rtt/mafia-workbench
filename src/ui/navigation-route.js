import { findNavigationRoute } from '../shared/navigation-route.js';

export function navigationRouteControls(center, tools, view, file, previous) {
  const element = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
  const toggle = element('button', 'Trasa…'), panel = element('section'), fields = element('div'), actions = element('div'), output = element('output'), mask = element('select');
  panel.className = 'navigation-route'; panel.hidden = true; fields.className = actions.className = 'tools';
  output.setAttribute('role', 'status'); mask.setAttribute('aria-label', 'Typ vazeb trasy');
  for (const [value, label] of [[1, 'Chodci'], [2, 'AI'], [4, 'Vozidla a zastávky'], [16, 'Typ 16 (raw)'], [0x17, 'Všechny typy']]) {
    const option = element('option', label); option.value = String(value); mask.append(option);
  }
  const inputs = ['Začátek trasy', 'Cíl trasy'].map(label => {
    const wrapper = element('label', label), input = element('input'), selected = element('button', 'Vybraný bod');
    input.type = 'number'; input.min = '0'; input.max = String(file.points.length - 1); input.step = '1'; input.setAttribute('aria-label', label);
    selected.type = 'button'; selected.setAttribute('aria-label', `${label}: použít vybraný bod`);
    selected.disabled = !file.points.length;
    selected.onclick = () => { if (view.selectedPoint !== null) { input.value = String(view.selectedPoint); update(); } };
    input.oninput = () => update(); wrapper.append(input, selected); fields.append(wrapper); return input;
  });
  const focus = element('button', 'Zarámovat trasu'), clear = element('button', 'Vymazat trasu');
  actions.append(mask, focus, clear); panel.append(fields, actions, output, element('p', 'Zelená: začátek → růžová: cíl. Nejkratší spojení podle délek XYZ, typů vazeb a blokovaného směru. Bez kontroly kolizí a rozhodování herní AI. Zohledňuje platné rozepsané pozice a vazby.'));
  panel.lastChild.className = 'notice'; tools.append(toggle); center.insertBefore(panel, center.querySelector('.viewport'));
  let result = null;
  function update() {
    if (view.disposed) return;
    view.navigationRoute = { sha256: file.sha256, from: inputs[0].value, to: inputs[1].value, mask: mask.value, open: !panel.hidden };
    result = null;
    try {
      if (inputs.some(input => input.value === '')) output.textContent = 'Vyberte začátek a cíl číslem nebo tlačítkem Vybraný bod po výběru ve 3D.';
      else {
        result = findNavigationRoute({ positions: view.positions, edges: view.edges, types: view.linkTypes }, ...inputs.map(input => Number(input.value)), Number(mask.value));
        output.textContent = result.indices.length ? `${inputs[0].value} → ${inputs[1].value} · ${result.indices.length.toLocaleString('cs')} bodů · ${result.distance.toLocaleString('cs', { maximumFractionDigits: 2 })} m` : 'V tomto směru a typu vazeb neexistuje spojení. Zkontrolujte přerušené nebo blokované vazby.';
      }
    } catch (error) { output.textContent = error.message; }
    focus.disabled = !result?.indices.length; view.showRoute(result?.indices ?? []);
  }
  toggle.setAttribute('aria-expanded', 'false');
  toggle.onclick = () => { panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); update(); };
  mask.onchange = update;
  focus.onclick = () => { if (result?.indices.length) view.fit(view.routeOverlay); };
  clear.onclick = () => { inputs.forEach(input => { input.value = ''; }); update(); };
  let pending = false;
  view.onNavigationChange = () => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; update(); }); } };
  if (previous?.sha256 === file.sha256) {
    inputs[0].value = previous.from; inputs[1].value = previous.to; mask.value = previous.mask; panel.hidden = !previous.open;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
  }
  update();
  if (previous && previous.sha256 !== file.sha256) { panel.hidden = false; toggle.setAttribute('aria-expanded', 'true'); update(); output.textContent = 'Síť se změnila; začátek a cíl vyberte znovu, protože se pořadí bodů mohlo změnit.'; }
}
