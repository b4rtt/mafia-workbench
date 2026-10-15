import { missionLogic, layoutMissionLogic, logicKinds } from '../shared/mission-logic.js';
import { createdMissionLogicSelection } from '../shared/mission-logic-authoring.js';
import { actionMenu } from './workspace.js';

export function renderMissionLogic(main, file, remembered, { element, projectRoot, create, edit, source, scene }) {
  const graph = missionLogic(file), byId = new Map(graph.nodes.map(node => [node.id, node]));
  const layout = element('div', undefined, 'logic-workspace'), outline = element('section', undefined, 'logic-outline'), center = element('section', undefined, 'logic-center'), inspector = element('section', undefined, 'logic-inspector');
  const controls = element('div', undefined, 'logic-controls tools'), find = element('input'), all = element('input'), allLabel = element('label', 'Včetně samostatných vlastních skriptů'), list = element('div', undefined, 'logic-list'), scroll = element('div', undefined, 'logic-scroll'), canvas = element('div', undefined, 'logic-canvas');
  find.type = 'search'; find.placeholder = 'Najít bod…'; find.setAttribute('aria-label', 'Najít bod logiky mise'); find.value = remembered?.search ?? '';
  all.type = 'checkbox'; all.checked = remembered?.all ?? false; allLabel.prepend(all);
  scroll.tabIndex = 0; scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', 'Diagram logiky mise'); scroll.append(canvas);
  const count = element('span', '', 'muted'), focus = element('button', 'Najít vybraný'), toggleOutline = element('button', 'Body'), toggleInspector = element('button', 'Podrobnosti');
  const additions = Object.entries({ task: 'Přidat úkol…', dialogue: 'Přidat rozhovor…', choice: 'Přidat volbu odpovědi…', combat: 'Přidat bojový úkol…', custom: 'Přidat vlastní skript…' }).map(([kind, label]) => {
    const button = element('button', label); button.dataset.logicAction = ''; button.dataset.logicCreate = ''; button.onclick = () => create(kind); return button;
  });
  controls.append(actionMenu('Přidat', additions), focus, toggleOutline, toggleInspector, count); center.append(controls, scroll);
  outline.append(element('h3', 'Body mise'), find, allLabel, list); layout.append(outline, center, inspector); main.append(layout);
  const note = element('p', 'Zelená: dokončení · červená: neúspěch · modrá: odpověď. Zobrazeny jsou přesně rozpoznané šablony editoru a jejich cíle. Vlastní skripty mohou přidávat další návaznosti; diagram nesimuluje hru.', 'logic-note'); center.append(note);
  let selected = byId.has(remembered?.selectedId) ? remembered.selectedId : graph.nodes.find(node => node.recipe && !graph.edges.some(edge => edge.to === node.id))?.id ?? graph.nodes.find(node => node.recipe)?.id ?? graph.nodes[0]?.id ?? null;
  let cards = new Map(), rows = new Map(), lines = [], focusSelection = false;
  function panel(button, className, visible) {
    layout.classList.toggle(className, !visible); button.setAttribute('aria-pressed', String(visible));
  }
  panel(toggleOutline, 'logic-outline-hidden', !(remembered?.outlineHidden ?? false)); panel(toggleInspector, 'logic-inspector-hidden', !(remembered?.inspectorHidden ?? false));
  toggleOutline.onclick = () => panel(toggleOutline, 'logic-outline-hidden', layout.classList.contains('logic-outline-hidden'));
  toggleInspector.onclick = () => panel(toggleInspector, 'logic-inspector-hidden', layout.classList.contains('logic-inspector-hidden'));
  const caption = node => node.kind === 'choice' ? `${node.waiting ? 'Po signálu · ' : ''}${node.recipe.answers.length} odpovědi · ${node.recipe.controller}` : node.recipe ? `${node.waiting ? 'Po signálu · ' : ''}${node.trigger === 'use' ? 'Akce hráče' : node.trigger === 'area' ? `Oblast · ${node.recipe.triggerRadius}` : 'Po načtení'}` : logicKinds[node.kind];
  function select(id) {
    selected = id;
    for (const [nodeId, card] of cards) { card.classList.toggle('selected', nodeId === id); card.setAttribute('aria-pressed', String(nodeId === id)); }
    for (const [nodeId, row] of rows) { row.classList.toggle('selected', nodeId === id); row.setAttribute('aria-pressed', String(nodeId === id)); }
    for (const { edge, group } of lines) group.classList.toggle('related', edge.from === id || edge.to === id);
    inspector.replaceChildren(); const node = byId.get(id); focus.disabled = !cards.has(id);
    if (!node) { inspector.append(element('p', graph.nodes.length ? 'Vlastní skripty zobrazíte přepínačem vlevo.' : 'V této misi nejsou skriptové body.', 'notice')); return; }
    inspector.append(element('h3', node.name), element('p', logicKinds[node.kind], 'muted'));
    if (node.recipe) {
      inspector.append(element('p', caption(node)));
      const details = [];
      if (node.recipe.targetName) details.push(['Cíl', node.recipe.targetName]);
      if (node.recipe.escort) details.push(['Příchod NPC', node.recipe.escort.humanName]);
      if (node.recipe.vehicle) details.push(['Auto', node.recipe.vehicle.name]);
      if (node.recipe.inventory) details.push(['Předmět', `ID ${node.recipe.inventory.itemId}${node.recipe.inventory.consume ? ' · odevzdat' : ''}`]);
      if (node.recipe.targets) details.push(['Protivníci', node.recipe.targets.join(', ')]);
      if (node.recipe.lines) details.push(['Repliky', node.recipe.lines.map(line => `${line.speaker}: ${line.textId}`).join(' · ')]);
      for (const [name, value] of details) inspector.append(element('p', `${name}: ${value}`));
      if (node.recipe.checkpointId !== null && node.recipe.checkpointId !== undefined) inspector.append(element('p', `Checkpoint: ${node.recipe.checkpointId}`));
      const configure = element('button', 'Nastavit…', 'primary'); configure.dataset.logicAction = ''; configure.onclick = () => edit(node); inspector.append(configure);
    } else if (node.kind === 'custom') inspector.append(element('p', 'Program není rozpoznanou šablonou editoru. Jeho podmínky ani odesílané signály diagram nevyhodnocuje.', 'notice'));
    for (const warning of node.warnings) inspector.append(element('p', warning, 'notice'));
    function links(title, incoming) {
      const relevant = graph.edges.filter(edge => (incoming ? edge.to : edge.from) === id);
      inspector.append(element('h4', title));
      if (!relevant.length) inspector.append(element('p', 'Žádné rozpoznané návaznosti.', 'muted'));
      for (const edge of relevant) {
        const other = byId.get(incoming ? edge.from : edge.to), label = incoming ? `${other.name} → ${edge.label}` : `${edge.label} → ${other.name}`, button = element('button', `${label}${edge.helper ? ` · bod ${edge.targetName}` : ''}`, `logic-link ${edge.kind}`);
        button.onclick = () => { draw(); select(other.id); reveal(); }; inspector.append(button);
      }
    }
    links('Přichází z', true); links('Pokračuje do', false);
    if (node.entryId) {
      const program = element('button', 'Otevřít zdrojový skript'); program.dataset.logicAction = ''; program.onclick = () => source(node); inspector.append(program);
    }
    if (node.actor || node.kind === 'choice') {
      const object = element('button', 'Ukázat ve 3D'); object.dataset.logicAction = ''; object.onclick = () => scene(node); inspector.append(object);
    }
    if (node.kind === 'choice') { const members = element('details'), title = element('summary', 'Pomocné body této volby'); members.append(title, ...node.members.map(name => element('p', name))); inspector.append(members); }
  }
  function reveal() {
    const card = cards.get(selected); if (!card) return;
    scroll.scrollTo({ left: Math.max(0, card.offsetLeft - (scroll.clientWidth - card.offsetWidth) / 2), top: Math.max(0, card.offsetTop - (scroll.clientHeight - card.offsetHeight) / 2) });
  }
  function draw() {
    const connected = new Set(graph.edges.flatMap(edge => [edge.from, edge.to])), nodes = graph.nodes.filter(node => all.checked || node.kind !== 'custom' || connected.has(node.id)), ids = new Set(nodes.map(node => node.id)), edges = graph.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to));
    const positions = layoutMissionLogic({ nodes, edges }); cards = new Map(); rows = new Map(); lines = []; canvas.replaceChildren(); list.replaceChildren();
    canvas.style.width = `${positions.width}px`; canvas.style.height = `${positions.height}px`;
    const namespace = 'http://www.w3.org/2000/svg', svg = document.createElementNS(namespace, 'svg'); svg.setAttribute('width', positions.width); svg.setAttribute('height', positions.height); svg.classList.add('logic-edges'); svg.setAttribute('aria-hidden', 'true'); canvas.append(svg);
    for (const [index,edge] of edges.entries()) {
      const outgoing=edges.filter(other=>other.from===edge.from),incoming=edges.filter(other=>other.to===edge.to);
      const a = positions.positions.get(edge.from), b = positions.positions.get(edge.to), x = a.x + 250, y = a.y + 32 + Math.min(3,outgoing.indexOf(edge))*24, end = b.x, endY = b.y + 32 + Math.min(3,incoming.indexOf(edge))*24, group = document.createElementNS(namespace, 'g'), path = document.createElementNS(namespace, 'path'), arrow = document.createElementNS(namespace, 'path'), label = document.createElementNS(namespace,'text');
      // Long and backward edges travel above the cards, not through intervening
      // quest nodes. Separate ports keep equal-target branches distinguishable.
      const lane=16+(index%7)*9;
      group.classList.add(edge.kind); path.setAttribute('d', b.x-a.x===340 ? `M ${x} ${y} C ${x + 36} ${y}, ${end - 36} ${endY}, ${end} ${endY}` : `M ${x} ${y} L ${x+20} ${y} L ${x+20} ${lane} L ${end-20} ${lane} L ${end-20} ${endY} L ${end} ${endY}`); arrow.setAttribute('d', `M ${end - 8} ${endY - 5} L ${end} ${endY} L ${end - 8} ${endY + 5}`);
      label.setAttribute('x',String(x+5));label.setAttribute('y',String(y-7));label.textContent=edge.kind==='failure'?'Neúsp.':edge.kind==='answer'?String(outgoing.indexOf(edge)+1):'Dok.';group.append(path, arrow,label); svg.append(group); lines.push({ edge, group });
    }
    const query = find.value.normalize('NFC').toLowerCase();
    for (const node of nodes) {
      const card = element('button', undefined, `logic-node ${node.kind}`), position = positions.positions.get(node.id);
      card.style.left = `${position.x}px`; card.style.top = `${position.y}px`; card.title = `${node.name} · ${logicKinds[node.kind]}`; card.dataset.logicNode = node.id;
      card.append(element('small', logicKinds[node.kind]), element('strong', node.name), element('span', caption(node)));
      if (node.warnings.length) card.append(element('small', `${node.warnings.length} upozornění`, 'logic-warning'));
      card.onclick = () => select(node.id); card.ondblclick = () => { if (node.recipe) edit(node); }; cards.set(node.id, card); canvas.append(card);
      if (node.name.normalize('NFC').toLowerCase().includes(query)) { const row = element('button', `${node.name} · ${logicKinds[node.kind]}`); row.onclick = () => { select(node.id); reveal(); }; rows.set(node.id, row); list.append(row); }
    }
    count.textContent = `${nodes.filter(node => node.recipe).length} šablon · ${edges.length} návazností · ${graph.nodes.filter(node => node.kind === 'custom').length} vlastních skriptů`;
    if (!nodes.length) canvas.append(element('p', 'Mise zatím nemá rozpoznané úkoly. Nabídkou Přidat vytvořte úkol, rozhovor, boj nebo volbu odpovědi.', 'notice'));
    if (selected && !ids.has(selected)) selected = nodes[0]?.id ?? null;
    select(selected);
  }
  find.oninput = draw; all.onchange = draw; focus.onclick = reveal;
  draw(); scroll.scrollLeft = remembered?.left ?? 0; scroll.scrollTop = remembered?.top ?? 0;
  let disposed = false;
  if (remembered?.focusSelection) requestAnimationFrame(() => { if (!disposed) reveal(); });
  const capture = () => ({ selectedId: selected, search: find.value, all: all.checked, left: scroll.scrollLeft, top: scroll.scrollTop, outlineHidden: layout.classList.contains('logic-outline-hidden'), inspectorHidden: layout.classList.contains('logic-inspector-hidden'), ...(focusSelection ? { focusSelection: true } : {}) });
  return { logicPath: file.path, projectRoot, disposed: false,
    captureLogic: capture,
    selectCreated(updated, name) {
      const next = createdMissionLogicSelection(updated, name, capture());
      selected = next.selectedId; find.value = next.search; all.checked = next.all; focusSelection = next.focusSelection;
    },
    dispose() { this.disposed = disposed = true; }
  };
}
