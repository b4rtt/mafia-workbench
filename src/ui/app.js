import { categories, groupAssets } from '../shared/categories.js';
import { Viewport } from './viewport.js';
import { AnimationPreview } from './animation.js';
import { NavigationViewport } from './navigation.js';
import { TrackViewport } from './track.js';
import { Group } from 'three';
const api = window.workbench;
const $ = id => document.getElementById(id);
const state = { project: null, file: null, category: 'levels', texts: new Map(), textIndex: 0, busy: false, viewport: null };
function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
async function discard() {
  if (!state.texts.size) return true;
  const dialog = $('discard'); dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'discard'), { once: true }));
}
function buttons() {
  for (const id of ['create', 'open']) $(id).disabled = state.busy;
  $('undo').disabled = state.busy || !state.project?.history;
  $('export').disabled = state.busy || !state.project;
  $('new-mission').disabled = state.busy || !state.project;
  $('stop-level').disabled = state.busy;
}
async function run(action) {
  if (state.busy) return;
  state.busy = true; buttons();
  try { await action(); }
  catch (error) { status(error.message, true); }
  finally { state.busy = false; buttons(); }
}
async function refresh(project) {
  state.project = project ?? await api.project();
  if (!state.project) return;
  $('project-name').textContent = state.project.name;
  const modified = state.project.assets.filter(a => a.modified).length;
  $('project-stats').textContent = `${state.project.assets.length.toLocaleString('cs')} souborů · ${modified} upravených`;
  renderCategories(); renderFiles(); buttons();
}
function renderCategories() {
  const scroll = $('categories').scrollLeft;
  const counts = new Map(categories.map(([id]) => [id, 0]));
  for (const file of state.project.assets) { counts.set(file.category, (counts.get(file.category) ?? 0) + 1); if (file.modified) counts.set('changed', counts.get('changed') + 1); }
  counts.set('all', state.project.assets.length);
  $('categories').replaceChildren(...categories.map(([id, label]) => {
    const button = element('button'); button.append(element('span', label), element('small', counts.get(id).toLocaleString('cs')));
    button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(id === state.category));
    button.classList.toggle('selected', id === state.category);
    button.onclick = () => { state.category = id; $('filter').value = ''; renderCategories(); renderFiles(); };
    return button;
  }));
  $('categories').scrollLeft = scroll;
}
function renderFiles() {
  if (!state.project) return;
  const filter = $('filter').value.toLowerCase();
  const files = state.project.assets.filter(a => a.path.toLowerCase().includes(filter) && (state.category === 'all' || (state.category === 'changed' ? a.modified : a.category === state.category)));
  const fragment = document.createDocumentFragment();
  const groups = groupAssets(files);
  for (const { folder, files: group } of groups) {
    const details = element('details', undefined, 'folder'), summary = element('summary', `${folder} (${group.length})`), list = element('div'); let count = 0;
    function fill() {
      const end = Math.min(count + 100, group.length);
      for (; count < end; count++) {
        const file = group[count], button = element('button', file.path.split('/').at(-1)); button.title = `${file.path} · ${file.archive} · ${file.size} bajtů`;
        button.classList.toggle('active', file.path === state.file?.path); button.classList.toggle('modified', file.modified);
        button.onclick = () => run(async () => { if (!await discard()) return; state.texts.clear(); state.textIndex = 0; await openFile(file.path); }); list.append(button);
      }
      if (count < group.length) { const more = element('button', `Dalších ${Math.min(100, group.length - count)} souborů…`, 'load-more'); more.onclick = () => { more.remove(); fill(); }; list.append(more); }
    }
    details.append(summary, list); details.ontoggle = () => { if (details.open && !count) fill(); };
    details.open = groups.length === 1 || Boolean(filter) || group.some(f => f.path === state.file?.path); if (details.open) fill(); fragment.append(details);
  }
  $('file-list').replaceChildren(fragment);
  $('count').textContent = `${files.length.toLocaleString('cs')} SOUBORŮ · ${groups.length} SLOŽEK`;
}
async function openFile(name) { state.file = await api.inspect(name); renderDetail(); renderFiles(); status(`Otevřeno: ${name}`); }
function renderDetail() {
  const file = state.file; if (!file) return;
  state.viewport?.dispose(); state.viewport = null;
  for (const audio of $('detail').querySelectorAll('audio')) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  const main = $('detail'); main.replaceChildren();
  const badges = { difference: 'CHG · OBJEKTY A SKRIPTY', track: 'TCK · POHYBOVÁ STOPA', navigation: 'CHECK · NAVIGACE', items: 'PŘEDMĚTY · ZBRANĚ', textdb: 'TEXTDB · EDITACE', scene: 'SCÉNA · EDITACE', cache: 'CACHE · STATICKÉ MODELY', map: 'MAPA · 3D EDITACE', model: '4DS · 3D EDITACE', animation: '5DS · ANIMACE', image: 'OBRÁZEK · NÁHLED', audio: 'ZVUK · PŘEHRÁVAČ' };
  const head = element('div', undefined, 'file-header'); head.append(element('h2', file.path), element('span', badges[file.type] ?? 'BINÁRNÍ SOUBOR', 'badge')); main.append(head);
  const source = state.project.assets.find(a => a.path === file.path);
  main.append(element('div', `${file.size.toLocaleString('cs')} bajtů · ${source?.archive} · ${source?.variants ?? 1} variant archivů`, 'file-meta'));
  const toolbar = element('div', undefined, 'tools');
  const restore = element('button', source?.created ? 'Obnovit výchozí verzi' : 'Obnovit originál');
  restore.onclick = () => run(async () => { if (!await discard()) return; state.file = await api.restore(file.path); state.texts.clear(); await refresh(); renderDetail(); status(source?.created ? 'Výchozí verze obnovena; obnovení lze také vrátit.' : 'Originál obnoven; obnovení lze také vrátit.'); });
  const replace = element('button', 'Nahradit souborem…');
  replace.onclick = () => run(async () => { if (!await discard()) return; const replacement = await api.replace(file.path); if (!replacement) return; state.file = replacement; state.texts.clear(); await refresh(); renderDetail(); status('Soubor nahrazen se zálohou.'); });
  toolbar.append(restore, replace); main.append(toolbar);
  if (/^missions\/[^/]+\//i.test(file.path)) {
    const launch = element('button', 'Spustit level', 'primary');
    launch.onclick = () => run(async () => {
      if (state.texts.size) throw new Error('Před spuštěním levelu uložte rozepsané změny.');
      status('Připravuji oddělenou testovací kopii…');
      const test = await api.startLevel(file.path); $('stop-level').hidden = !test.running;
      status(`Spouštím: ${test.level} · bez videí a menu · oddělené ukládání.`);
    }); toolbar.append(launch);
  }
  if (file.type === 'scene') {
    const map = element('button', 'Otevřít 3D mapu'); map.onclick = () => run(async () => { if (!await discard()) return; state.texts.clear(); status('Načítám geometrii mapy…'); state.file = await api.map(file.path); renderDetail(); status('3D mapa načtená.'); }); toolbar.append(map);
  }
  if (file.type === 'textdb') renderTexts(main, file);
  else if (file.type === 'items') renderItems(main, file);
  else if (file.type === 'navigation') renderNavigation(main, file);
  else if (file.type === 'track') renderTrack(main, file);
  else if (file.type === 'difference') renderDifference(main, file);
  else if (file.type === 'scene') renderProperties(main, file, api.saveScene);
  else if (file.type === 'cache') renderCache(main, file);
  else if (file.type === 'model') renderModel(main, file);
  else if (file.type === 'map') renderMap(main, file);
  else if (file.type === 'animation') renderAnimation(main, file);
  else if (file.type === 'image' || file.type === 'audio') renderMedia(main, file);
  else {
    if (file.warning) main.append(element('p', file.warning, 'notice'));
    main.append(element('p', 'Tento formát zatím nemá specializovaný editor. Můžete importovat upravený soubor z externího nástroje. Uloží se do modu se zálohou; původní kopie zůstane zachovaná.', 'notice'));
    const bytes = file.hex.match(/../g) ?? []; let rows = '';
    for (let offset = 0; offset < bytes.length; offset += 16) {
      const row = bytes.slice(offset, offset + 16);
      rows += offset.toString(16).padStart(8, '0') + '  ' + row.join(' ').padEnd(47) + '  ' + row.map(b => { const c = parseInt(b, 16); return c >= 32 && c <= 126 ? String.fromCharCode(c) : '.'; }).join('') + '\n';
    }
    main.append(element('pre', rows, 'binary'));
  }
}
function renderDifference(main, file) {
  main.append(element('p', `${file.blocks} bloků · ${file.objects.length} objektů · ${file.actors.length} popisů aktérů · ${file.bindings.length} vazeb. Lze upravit transformace a existující skripty. Přidávání objektů, data aktérů a přehrávání celé cutscény zatím nejsou podporované.`, 'notice'));
  const summary = element('details'), title = element('summary','Objekty a vazby (jen ke čtení)'); summary.append(title);
  for (const object of file.objects) summary.append(element('p',`${object.index}: ${object.name} · typ ${object.frameType} · rodič ${object.parent || '—'}${object.resource ? ` · zdroj ${object.resource}` : ''}`));
  for (const binding of file.bindings) summary.append(element('p',`${binding.index}: vazba na ${binding.name} · typ aktéra ${binding.kind}`));
  main.append(summary,element('p',`${file.opaqueBytes.toLocaleString('cs')} nerozpoznaných bajtů se při uložení zachová přesně. Jména a vazby se zobrazují pro orientaci; rotace se upravuje v původním pořadí W, X, Y, Z.`, 'muted'));
  renderProperties(main,file,api.saveDifference);
}
function renderTrack(main, file) {
  main.append(element('p', `TCK verze 4 · ${file.positions.length.toLocaleString('cs')} polohových klíčů · ${file.secondary.length.toLocaleString('cs')} doplňkových vektorů · ${file.duration} ms · krok ${file.step} ms. Náhled lineárně interpoluje dráhu; kostru postavy ani celou cutscénu nepřehrává.`, 'notice'));
  if (file.tailBytes) main.append(element('p', `${file.tailBytes.toLocaleString('cs')} koncových bajtů není rozpoznaných. Při editaci se zachovají přesně.`, 'notice'));
  main.append(element('p', `Hlavička, vektor A (raw): ${JSON.stringify(file.headerVectors[0])} · vektor B (raw): ${JSON.stringify(file.headerVectors[1])}. Časování, počty a hlavička zůstávají zachované.`, 'muted'));
  const layout = element('div', undefined, 'model-workspace'), center = element('section', undefined, 'model-center'), inspector = element('section', undefined, 'model-inspector'); layout.append(center,inspector); main.append(layout);
  const tools = element('div', undefined, 'tools'), play = element('button','Přehrát dráhu'), fit = element('button','Zarámovat dráhu'), seek = element('input'), clock = element('output'), viewport = element('div',undefined,'viewport');
  seek.type = 'range'; seek.min = '0'; seek.max = String(file.duration); seek.step = '1'; seek.value = '0'; seek.setAttribute('aria-label','Čas náhledu dráhy v ms'); play.disabled = !file.duration;
  tools.append(play,fit); center.append(tools,seek,clock,viewport);
  const view = new TrackViewport(viewport); state.viewport = view; view.loadTrack(file);
  let playing = false, previous;
  function pause() { playing = false; previous = undefined; play.textContent = 'Přehrát dráhu'; }
  function show(time) { view.seek(time); seek.value = String(time); clock.textContent = `${Math.round(time)} / ${file.duration} ms`; }
  play.onclick = () => { if (playing) pause(); else { if (Number(seek.value)>=file.duration) show(0); playing = true; previous = undefined; play.textContent = 'Pozastavit dráhu'; } };
  seek.oninput = () => { pause(); show(Number(seek.value)); }; fit.onclick = () => view.fit(view.path);
  view.onFrame = time => {
    if (!playing) return;
    const next = Math.min(file.duration,view.time+(previous === undefined ? 0 : time-previous)); previous = time; show(next); if (next>=file.duration) pause();
  };
  const keyTools = element('div',undefined,'tools'), number = element('input'), select = element('button','Vybrat klíč'), fields = element('div');
  number.type = 'number'; number.min = '0'; number.max = String(file.positions.length-1); number.step = '1'; number.value = String(Math.min(state.trackIndex??0,file.positions.length-1)); number.setAttribute('aria-label','Číslo klíče TCK'); keyTools.append(number,select); inspector.append(keyTools,fields);
  function editKey(index) {
    pause(); state.trackIndex = index; number.value = String(index); show(index*file.step); fields.replaceChildren();
    const entries = [{id:`positions/${index}`,context:`Klíč ${index} · ${index*file.step} ms`,label:'Poloha XYZ',kind:'vec3',value:file.positions[index]}];
    if (file.secondary.length) entries.push({id:`secondary/${index}`,context:`Klíč ${index} · ${index*file.step} ms`,label:'Doplňkový vektor (raw)',kind:'vec3',value:file.secondary[index]});
    renderProperties(fields,{...file,entries},api.saveTrack,(entry,value)=>{pause(); if (entry.id.startsWith('positions/')) view.updateKey(index,value);});
  }
  select.onclick = () => { const index = Number(number.value); if (number.value!==''&&Number.isInteger(index)&&index>=0&&index<file.positions.length) editKey(index); else status('Číslo klíče je mimo rozsah.',true); };
  editKey(Number(number.value));
}
function renderNavigation(main, file) {
  main.append(element('p', `${file.points.length.toLocaleString('cs')} bodů · ${file.linkCount.toLocaleString('cs')} směrovaných vazeb. Číslo bodu je jeho pořadí od nuly, uložené ID se může opakovat. Modrá: chodci, žlutá: AI, oranžová: vozidla, fialová: zastávky.`, 'notice'));
  for (const warning of file.warnings.slice(0,10)) main.append(element('p',warning,'notice'));
  const layout = element('div', undefined, 'model-workspace'), center = element('section', undefined, 'model-center'), inspector = element('section', undefined, 'model-inspector'); layout.append(center, inspector); main.append(layout);
  const tools = element('div', undefined, 'tools'), number = element('input'), jump = element('button', 'Vybrat bod'), fit = element('button', 'Zarámovat síť'), focus = element('button', 'Přiblížit bod'), background = element('button', 'Zobrazit geometrii mise'), viewport = element('div', undefined, 'viewport');
  number.type = 'number'; number.min = '0'; number.max = String(Math.max(0,file.points.length-1)); number.step = '1'; number.value = '0'; number.setAttribute('aria-label','Číslo navigačního bodu'); focus.disabled = !file.points.length;
  tools.append(number,jump,fit,focus,background); center.append(tools,viewport);
  let properties;
  function entries(point) {
    const context = `Bod ${point.index} · uložené ID ${point.id}`;
    const result = [['position','Pozice XYZ','vec3'],['type','Typ / příznaky','uint16'],['id','Uložené ID','uint16'],['areaSize','Velikost oblasti (raw)','uint16']].map(([key,label,kind])=>({id:`points/${point.index}/${key}`,context,label,kind,value:point[key]}));
    for (const link of point.links) for (const [key,label] of [['target','Cílový bod (pořadí)'],['type','Typ vazby / příznaky']]) result.push({id:`links/${link.index}/${key}`,context:`Bod ${point.index} → ${link.target} · vazba ${link.index}`,label,kind:'uint16',value:link[key]});
    return result;
  }
  const view = new NavigationViewport(viewport, frame => {
    const point = file.points[frame.navigationIndex]; number.value = String(point.index); state.navigationIndex = point.index; inspector.replaceChildren();
    properties = renderProperties(inspector,{...file,entries:entries(point)},api.saveNavigation,(entry,value)=>{
      const [section,index,key] = entry.id.split('/');
      if (section === 'points' && key === 'position' && Array.isArray(value) && value.length === 3 && value.every(n=>typeof n==='number'&&Number.isFinite(n))) view.updatePoint(Number(index),value);
      if (section === 'points' && key === 'type' && Number.isInteger(value) && value>=0 && value<=65535) view.setType(Number(index),value);
      if (section === 'links' && key === 'target' && Number.isInteger(value) && value>=0 && value<file.points.length) view.updateTarget(Number(index),value);
    });
  }, (frame,values) => {
    const id = `points/${frame.navigationIndex}/position`, original = file.points[frame.navigationIndex].position;
    if (JSON.stringify(values.position) === JSON.stringify(original)) state.texts.delete(id); else state.texts.set(id,values.position);
    view.updatePoint(frame.navigationIndex,values.position); properties?.select(id); status('Posun navigačního bodu je rozepsaný; uložte změny.');
  });
  state.viewport = view; view.loadNavigation(file);
  jump.onclick = () => { const index = Number(number.value); if (number.value !== '' && Number.isInteger(index) && index>=0 && index<file.points.length) view.select(String(index)); else status('Číslo bodu je mimo rozsah.',true); };
  fit.onclick = () => view.fit(view.markers); focus.onclick = () => { if (view.selectedPoint !== null) view.fit(view.proxy); };
  let geometry;
  background.onclick = () => run(async()=>{
    if (geometry) { geometry.visible = !geometry.visible; background.textContent = geometry.visible ? 'Skrýt geometrii mise' : 'Zobrazit geometrii mise'; return; }
    const model = await api.inspect(file.path.replace(/check\.bin$/i,'scene.4ds')); if (state.file !== file) return;
    if (model.type !== 'model') throw new Error(model.warning ?? 'Geometrii mise zatím nelze načíst.');
    geometry = new Group(); view.root.add(geometry);
    for (const object of view.addModel(model,geometry,'nav-context/').values()) object.userData.frame.editable = false;
    geometry.traverse(object=>{object.raycast=()=>{};});
    await view.loadTextures(async texture=>{const path=texture.replaceAll('\\','/').toLowerCase(),asset=state.project.assets.find(a=>a.path.toLowerCase()===`maps/${path}`||a.path.toLowerCase()===path);return asset?api.media(asset.path):null;});
    background.textContent = 'Skrýt geometrii mise';
  });
  if (file.points.length) view.select(String(Math.min(state.navigationIndex ?? 0,file.points.length-1)));
  else inspector.append(element('p','Tato mise nemá navigační body.','notice'));
}
function renderItems(main, file) {
  main.append(element('p', `${file.records.length} předmětů · ID odpovídá pořadí záznamu ve hře. Změny se ukládají do modu; neznámé parametry a pořadí zůstávají zachované.`, 'notice'));
  const layout = element('div', undefined, 'items-workspace'), browser = element('section'), form = element('section', undefined, 'item-form');
  const search = element('input'); search.type = 'search'; search.placeholder = 'ID, název nebo model…'; search.setAttribute('aria-label', 'Hledat předměty');
  const scroll = element('div', undefined, 'item-table-scroll'), table = element('table', undefined, 'item-table'), head = element('thead'), header = element('tr'), body = element('tbody');
  for (const text of ['ID', 'Předmět', 'Zásobník', 'Zásoba', 'Poškození']) header.append(element('th', text));
  head.append(header); table.append(head, body); scroll.append(table); browser.append(search, scroll); layout.append(browser, form); main.append(layout);
  const currentValue = entry => state.texts.has(entry.id) ? state.texts.get(entry.id) : entry.value;
  function fill() {
    body.replaceChildren(); const query = search.value.toLowerCase();
    for (const record of file.records) {
      const name = currentValue(record.entries.find(e => e.key === 'name')), model = currentValue(record.entries.find(e => e.key === 'model'));
      if (!`${record.index} ${name} ${model}`.toLowerCase().includes(query)) continue;
      const row = element('tr'); row.classList.toggle('selected', record.index === state.itemIndex);
      row.append(element('td', record.index)); const cell = element('td'), button = element('button', name || '(bez názvu)');
      button.setAttribute('aria-label', `Předmět ${record.index}: ${name}`); button.onclick = () => { if (!state.busy) edit(record); }; cell.append(button); row.append(cell);
      for (const key of ['magazine', 'reserve', 'damage']) { const value = currentValue(record.entries.find(e => e.key === key)); row.append(element('td', value?.invalid ? '…' : value)); }
      body.append(row);
    }
  }
  function edit(record) {
    state.itemIndex = record.index; state.viewport?.dispose(); state.viewport = null; form.replaceChildren();
    form.append(element('h3', `ID ${record.index} · ${record.name}`));
    const fields = element('div', undefined, 'item-fields'), save = element('button', `Uložit změny (${state.texts.size})`, 'primary'); save.disabled = !state.texts.size;
    for (const entry of record.entries) {
      const label = element('label', entry.label), input = element('input'), value = currentValue(entry);
      input.setAttribute('aria-label', `Předmět ${record.index} · ${entry.label}`); input.type = entry.kind === 'string' ? 'text' : 'number';
      if (input.type === 'number') input.step = entry.kind === 'float' ? 'any' : '1';
      input.value = value?.invalid ? value.raw : String(value);
      input.oninput = () => {
        const next = entry.kind === 'string' ? input.value : input.value.trim() === '' ? NaN : Number(input.value);
        if (typeof next === 'number' && !Number.isFinite(next)) { state.texts.set(entry.id, { invalid: true, raw: input.value }); input.setAttribute('aria-invalid', 'true'); }
        else { input.removeAttribute('aria-invalid'); if (next === entry.value) state.texts.delete(entry.id); else state.texts.set(entry.id, next); }
        save.textContent = `Uložit změny (${state.texts.size})`; save.disabled = !state.texts.size; fill();
      };
      label.append(input); fields.append(label);
    }
    save.onclick = () => run(async () => {
      if ([...state.texts.values()].some(v => v?.invalid)) throw new Error('Vyplňte neplatné číselné hodnoty.');
      state.file = await api.saveItems(file.path, [...state.texts].map(([id, value]) => ({ id, value })), file.sha256);
      state.texts.clear(); await refresh(); renderDetail(); status('Zbraně a předměty uložené do modu se zálohou.');
    });
    const preview = element('button', 'Náhled modelu předmětu'), caption = element('p'), container = element('div', undefined, 'viewport item-preview'); container.hidden = true;
    preview.onclick = () => run(async () => {
      const value = currentValue(record.entries.find(e => e.key === 'model'));
      if (typeof value !== 'string' || !value) throw new Error('Tento předmět nemá model.');
      const name = `models/${value.replaceAll('\\', '/').replace(/\.i3d$/i, '.4ds')}`.toLowerCase(), asset = state.project.assets.find(a => a.path.toLowerCase() === name);
      if (!asset) throw new Error(`Model ${value} není v projektu.`);
      const model = await api.inspect(asset.path); if (state.file !== file || state.itemIndex !== record.index) return;
      if (model.type !== 'model') throw new Error(model.warning ?? 'Model zatím nelze zobrazit.');
      state.viewport?.dispose(); container.hidden = false;
      const view = new Viewport(container); state.viewport = view;
      for (const object of view.addModel(model).values()) object.userData.frame.editable = false;
      view.fit(); caption.textContent = asset.path;
      await view.loadTextures(async texture => { const name = texture.replaceAll('\\', '/').toLowerCase(), match = state.project.assets.find(a => a.path.toLowerCase() === `maps/${name}` || a.path.toLowerCase() === name); return match ? api.media(match.path) : null; });
    });
    form.append(fields, element('p', 'Přesnost je uložený koeficient, nikoli procento. Příznaky jsou číselná bitová maska; ID zvuků a animací se nepřekládají odhadem.', 'notice'), save, preview, caption, container); fill();
  }
  search.oninput = fill; edit(file.records[state.itemIndex] ?? file.records[0]);
}
function renderTexts(main, file) {
  const workspace = element('div', undefined, 'text-workspace'), indexPanel = element('div', undefined, 'text-index');
  const search = element('input'); search.type = 'search'; search.placeholder = 'ID nebo část textu…'; search.setAttribute('aria-label', 'Hledat v textech');
  const list = element('div', undefined, 'text-list'), form = element('div', undefined, 'text-form');
  function edit(entry) {
    state.textIndex = entry.index; form.replaceChildren();
    const label = element('label', `Text ID ${entry.id} · záznam ${entry.index + 1}`); label.htmlFor = 'text-value';
    const textarea = element('textarea'); textarea.id = 'text-value'; textarea.value = state.texts.get(entry.index) ?? entry.text;
    textarea.oninput = () => { if (textarea.value === entry.text) state.texts.delete(entry.index); else state.texts.set(entry.index, textarea.value); save.textContent = state.texts.size ? `Uložit ${state.texts.size} změn` : 'Uložit změny'; save.disabled = !state.texts.size; };
    const save = element('button', state.texts.size ? `Uložit ${state.texts.size} změn` : 'Uložit změny', 'primary'); save.disabled = !state.texts.size;
    save.onclick = () => run(async () => {
      state.file = await api.saveTexts(file.path, [...state.texts].map(([index, text]) => ({ index, text })), file.sha256);
      state.texts.clear(); await refresh(); renderDetail(); status('Texty uložené do modu. Změnu lze vrátit.');
    });
    form.append(label, textarea, element('p', `Kódování: ${file.encoding}. ID a nerozpoznané části souboru zůstávají zachované.`), save);
    for (const button of list.children) button.classList.toggle('active', Number(button.dataset.index) === entry.index);
  }
  function fill() {
    const query = search.value.toLowerCase(), fragment = document.createDocumentFragment();
    const matches = file.entries.filter(entry => `${entry.id} ${state.texts.get(entry.index) ?? entry.text}`.toLowerCase().includes(query));
    for (const entry of matches.slice(0, 600)) {
      const button = element('button', `${entry.id} · ${entry.text.replace(/\s/g, ' ').slice(0, 70)}`); button.dataset.index = entry.index;
      button.onclick = () => edit(entry); fragment.append(button);
    }
    list.replaceChildren(fragment);
  }
  search.oninput = fill; fill(); indexPanel.append(search, list); workspace.append(indexPanel, form); main.append(workspace);
  if (file.entries.length) edit(file.entries[state.textIndex] ?? file.entries[0]);
}
function renderProperties(main, file, saveAPI, onEdit = () => {}) {
  const workspace = element('div', undefined, 'text-workspace'), indexPanel = element('div', undefined, 'text-index'), form = element('div', undefined, 'text-form');
  const search = element('input'); search.type = 'search'; search.placeholder = 'Objekt, vlastnost nebo skript…'; search.setAttribute('aria-label', 'Hledat ve scéně');
  const list = element('div', undefined, 'text-list');
  function edit(entry) {
    form.replaceChildren();
    const label = element('label', `${entry.context} / ${entry.label}`); label.htmlFor = 'scene-value';
    const input = element('textarea'); input.id = 'scene-value';
    const draft = state.texts.get(entry.id) ?? entry.value;
    const isString = ['string', 'string8'].includes(entry.kind);
    input.value = draft?.invalid ? draft.raw : entry.kind === 'script' ? draft.code : isString ? draft : JSON.stringify(draft);
    const name = element('input'); name.setAttribute('aria-label', 'Název skriptu'); name.value = entry.kind === 'script' ? draft.name : '';
    function value() { return entry.kind === 'script' ? { name: name.value, code: input.value } : isString ? input.value : JSON.parse(input.value); }
    function track() {
      try { const next = value(); if (JSON.stringify(next) === JSON.stringify(entry.value)) state.texts.delete(entry.id); else state.texts.set(entry.id, next); save.disabled = !state.texts.size; save.textContent = `Uložit změny (${state.texts.size})`; onEdit(entry, next); status('Rozepsaná úprava.'); }
      catch { state.texts.set(entry.id, { invalid: true, raw: input.value }); save.disabled = false; status('Číselné hodnoty zapisujte jako číslo nebo pole, např. [1, 2, 3].', true); }
    }
    input.oninput = track; name.oninput = track;
    const save = element('button', `Uložit změny (${state.texts.size})`, 'primary'); save.disabled = !state.texts.size;
    save.onclick = () => run(async () => {
      if ([...state.texts.values()].some(v => v?.invalid)) throw new Error('Opravte neplatnou číselnou hodnotu před uložením.');
      state.file = await saveAPI(file.path, [...state.texts].map(([id, value]) => ({ id, value })), file.sha256);
      state.texts.clear(); await refresh(); renderDetail(); status('Změny uložené do modu se zálohou.');
    });
    form.append(label); if (entry.kind === 'script') form.append(name); form.append(input, element('p', entry.kind === 'script' ? 'Zdroj skriptu mise. První bajt a další nerozpoznaná data zůstanou zachovaná.' : `Typ: ${entry.kind}. Souřadnice: X, Y, Z; rotace: W, X, Y, Z. Ostatní vlastnosti zůstanou zachované.`), save);
  }
  function fill() {
    const query = search.value.toLowerCase(), fragment = document.createDocumentFragment();
    for (const entry of file.entries.filter(e => `${e.context} ${e.label} ${e.kind === 'script' ? e.value.name : ''}`.toLowerCase().includes(query)).slice(0, 800)) {
      const button = element('button', `${entry.kind === 'script' ? entry.value.name : entry.context.split(' / ').at(-1)} · ${entry.label}`);
      button.title = `${entry.context} / ${entry.label}`; button.onclick = () => edit(entry); fragment.append(button);
    }
    list.replaceChildren(fragment);
  }
  search.oninput = fill; fill(); indexPanel.append(search, list); workspace.append(indexPanel, form); main.append(element('p', `${file.entries.length.toLocaleString('cs')} rozpoznaných vlastností. Nerozpoznaná data se zachovají beze změny.`, 'notice'), workspace);
  if (file.entries.length) edit(file.entries.find(e => e.kind === 'script') ?? file.entries[0]);
  return { select: id => { const entry = file.entries.find(e => e.id === id); if (entry) edit(entry); }, changed: () => { const entry = file.entries.find(e => e.id === state.selectedProperty); if (entry) edit(entry); } };
}
function renderMedia(main, file) {
  const container = element('div', undefined, 'media-preview'), caption = element('p', 'Načítám náhled…'); main.append(container, caption);
  const media = element(file.type === 'image' ? 'img' : 'audio');
  if (file.type === 'image') { media.alt = file.path; media.onload = () => { caption.textContent = `${media.naturalWidth} × ${media.naturalHeight} px`; }; }
  else { media.controls = true; media.preload = 'metadata'; media.onloadedmetadata = () => { caption.textContent = `Délka: ${Math.floor(media.duration / 60)}:${String(Math.floor(media.duration % 60)).padStart(2, '0')} · Přehrávání se spouští tlačítkem.`; }; }
  media.onerror = () => { caption.textContent = 'Soubor se nepodařilo dekódovat. Originál zůstává zachovaný.'; };
  container.append(media); api.media(file.path).then(url => { if (state.file === file) media.src = url; }).catch(error => { caption.textContent = error.message; });
}
function renderModel(main, file) {
  if (file.meshes.some(mesh => mesh.lods?.some(lod => lod.invalidNormals || lod.invalidUV))) main.append(element('p', 'Model obsahuje neplatné normály nebo souřadnice textur. Náhled používá náhradní hodnoty; původní model zůstává zachovaný.', 'notice'));
  const layout = element('div', undefined, 'model-workspace'), center = element('section', undefined, 'model-center'), inspector = element('section', undefined, 'model-inspector');
  layout.append(center, inspector); main.append(layout);
  const tools = element('div', undefined, 'tools'), viewport = element('div', undefined, 'viewport'), selected = element('p', 'Vyberte objekt ve 3D pohledu nebo podle názvu.'), objects = element('select');
  objects.setAttribute('aria-label', 'Objekt modelu'); objects.append(element('option', 'Vyberte objekt…'));
  for (const mesh of file.meshes) { const option = element('option', `${mesh.id} · ${mesh.name}`); option.value = String(mesh.id); objects.append(option); }
  center.append(tools, objects, selected, viewport);
  let properties;
  const view = new Viewport(viewport, frame => { selected.textContent = `Objekt ${frame.sourceId}: ${frame.name}`; objects.value = String(frame.sourceId); properties?.select(`meshes/${frame.sourceId - 1}/position`); }, (frame, values, mode) => {
    const field = { translate: 'position', rotate: 'rotation', scale: 'scale' }[mode], id = `meshes/${frame.sourceId - 1}/${field}`;
    state.texts.set(id, values[field]); state.selectedProperty = id; properties?.select(id); status('3D úprava je rozepsaná; uložte změny pod pohledem.');
  });
  state.viewport = view;
  for (const [mode, label] of [['translate', 'Posun'], ['rotate', 'Rotace'], ['scale', 'Měřítko']]) { const button = element('button', label); button.onclick = () => view.gizmo.setMode(mode); tools.append(button); }
  const fit = element('button', 'Zarámovat vše'); fit.onclick = () => view.fit();
  const wire = element('button', 'Drátěný pohled'); let wireframe = false; wire.onclick = () => { wireframe = !wireframe; view.wireframe(wireframe); }; tools.append(fit, wire);
  objects.onchange = () => view.select(String(objects.value));
  try { view.addModel(file); view.fit(); }
  catch (error) { status(error.message, true); }
  view.loadTextures(async texture => {
    const path = texture.replaceAll('\\', '/').toLowerCase(), match = state.project.assets.find(a => a.path.toLowerCase() === `maps/${path}` || a.path.toLowerCase() === path);
    return match ? api.media(match.path) : null;
  });
  center.append(element('p', `${file.meshes.length} objektů · ${file.materials.length} materiálů · LOD 0. Animaci přehrajete v kategorii Animace 5DS po výběru tohoto modelu. Morfování zatím není podporované.`, 'notice'));
  properties = renderProperties(inspector, file, api.saveModel, (entry, value) => { const match = /^meshes\/(\d+)\/(position|rotation|scale)$/.exec(entry.id); if (match) view.update(String(Number(match[1]) + 1), { [match[2]]: value }); });
}
function renderAnimation(main, file) {
  const layout = element('div', undefined, 'model-workspace'), center = element('section', undefined, 'model-center'), inspector = element('section', undefined, 'model-inspector');
  layout.append(center, inspector); main.append(layout);
  const tools = element('div', undefined, 'tools'), search = element('input'), models = element('select'), load = element('button', 'Načíst model pro animaci');
  search.type = 'search'; search.value = 'Tommy'; search.placeholder = 'Hledat model…'; search.setAttribute('aria-label', 'Hledat model pro animaci'); models.setAttribute('aria-label', 'Model pro animaci');
  const caption = element('p', `${file.nodes.length} animovaných uzlů · snímky 0–${file.frames}. Vyberte model se shodnými názvy uzlů.`, 'notice');
  const viewport = element('div', undefined, 'viewport'), timeline = element('div', undefined, 'tools');
  const play = element('button', 'Přehrát'), previous = element('button', 'Předchozí snímek'), next = element('button', 'Další snímek'), slider = element('input'), fps = element('input'), frameLabel = element('output');
  slider.type = 'range'; slider.min = '0'; slider.max = String(file.frames); slider.step = '1'; slider.value = '0'; slider.setAttribute('aria-label', 'Snímek animace');
  fps.type = 'number'; fps.min = '1'; fps.max = '120'; fps.value = '25'; fps.setAttribute('aria-label', 'Rychlost náhledu ve snímcích za sekundu');
  const fpsLabel = element('label', 'snímků/s'); fpsLabel.prepend(fps);
  timeline.append(play, previous, next, slider, frameLabel, fpsLabel); tools.append(search, models, load); center.append(tools, caption, viewport, timeline);
  let view, preview, frame = 0, playing = false, lastTime = null;
  function showFrame(value) { frame = Math.max(0, Math.min(file.frames, value)); slider.value = String(Math.round(frame)); frameLabel.textContent = `${Math.round(frame)} / ${file.frames}`; preview?.apply(frame, state.texts); }
  function pause() { playing = false; lastTime = null; play.textContent = 'Přehrát'; }
  function fillModels() {
    const matches = state.project.assets.filter(a => /\.4ds$/i.test(a.path) && a.path.toLowerCase().includes(search.value.toLowerCase()));
    models.replaceChildren(...matches.slice(0, 200).map(asset => { const option = element('option', asset.path); option.value = asset.path; return option; }));
    load.disabled = !matches.length;
    if (matches.length > 200) caption.textContent = 'Zobrazeno prvních 200 modelů. Zpřesněte hledání.';
    else if (!preview) caption.textContent = `${file.nodes.length} animovaných uzlů · snímky 0–${file.frames}. Vyberte model se shodnými názvy uzlů.`;
  }
  search.oninput = fillModels; fillModels(); showFrame(0); for (const button of [play, previous, next, slider]) button.disabled = true;
  load.onclick = () => run(async () => {
    const model = await api.inspect(models.value); if (state.file !== file) return;
    if (model.type !== 'model') throw new Error(model.warning ?? 'Model není podporovaný.');
    pause(); view?.dispose(); view = new Viewport(viewport); state.viewport = view;
    const frames = view.addModel(model); preview = new AnimationPreview(frames, file); view.fit(); showFrame(0);
    // The preview has no transform gizmo: scrubbing never writes a game file.
    view.onSelect = selected => { caption.textContent = `Uzel modelu: ${selected.name}`; };
    view.select = id => { const object = view.frames.get(id); if (object) view.onSelect(object.userData.frame); };
    view.onFrame = time => {
      if (!playing) return;
      if (lastTime !== null) showFrame((frame + (time - lastTime) / 1000 * Math.max(1, Math.min(120, Number(fps.value) || 25))) % (file.frames + 1));
      lastTime = time;
    };
    for (const button of [play, previous, next, slider]) button.disabled = !preview.matches.length; play.disabled ||= file.frames === 0;
    caption.textContent = `${preview.matches.length}/${file.nodes.length} uzlů propojeno s ${model.path}.` + (preview.unmatched.length ? ` Chybí nebo jsou nejednoznačné: ${preview.unmatched.slice(0, 8).join(', ')}${preview.unmatched.length > 8 ? '…' : ''}.` : '') + (view.skinWarnings.length ? ` Nepodporované váhy: ${view.skinWarnings.join(', ')}; tyto části zůstávají statické.` : '') + (model.meshes.some(m => [3,5].includes(m.visual)) ? ' Morfování není podporované.' : '');
    await view.loadTextures(async texture => {
      const name = texture.replaceAll('\\', '/').toLowerCase(), match = state.project.assets.find(a => a.path.toLowerCase() === `maps/${name}` || a.path.toLowerCase() === name);
      return match ? api.media(match.path) : null;
    });
  });
  play.onclick = () => { if (playing) pause(); else { playing = true; lastTime = null; play.textContent = 'Pozastavit'; } };
  slider.oninput = () => { pause(); showFrame(Number(slider.value)); };
  previous.onclick = () => { pause(); showFrame(Math.round(frame) - 1); }; next.onclick = () => { pause(); showFrame(Math.round(frame) + 1); };
  renderProperties(inspector, file, api.saveAnimation, () => showFrame(frame));
}
function renderCache(main, file) {
  main.append(element('p', `${file.parts.length} částí města · ${file.parts.reduce((sum, part) => sum + part.objects.length, 0)} statických modelů. Vyberte část pro 3D editaci rozmístění modelů.`));
  const tools = element('div', undefined, 'tools'), parts = element('select'), preview = element('button', 'Otevřít část ve 3D');
  parts.setAttribute('aria-label', 'Část města v cache.bin');
  for (const part of file.parts) { const option = element('option', `${part.name} · ${part.objects.length} modelů`); option.value = part.id; parts.append(option); }
  preview.disabled = !file.parts.length;
  preview.onclick = () => run(async () => {
    if (!await discard()) return;
    const part = file.parts.find(p => p.id === parts.value);
    if (part.objects.length > 500) throw new Error('Tato část má přes 500 modelů; její 3D náhled zatím není podporovaný. Vlastnosti lze upravit v seznamu.');
    state.texts.clear(); state.file = { ...file, type: 'map', cacheSource: true, geometry: { meshes: [], materials: [] }, objects: part.objects, entries: file.entries.filter(e => e.id.startsWith(part.id + '/')) }; renderDetail();
  });
  tools.append(parts, preview); main.append(tools); renderProperties(main, file, api.saveCache);
}
function renderMap(main, file) {
  const layout = element('div', undefined, 'model-workspace'), center = element('section', undefined, 'model-center'), inspector = element('section', undefined, 'model-inspector'); layout.append(center, inspector); main.append(layout);
  const tools = element('div', undefined, 'tools'), viewport = element('div', undefined, 'viewport'), selected = element('p', 'Vyberte objekt mapy.'), objects = element('select'); objects.setAttribute('aria-label', 'Objekt mapy'); objects.append(element('option', 'Vyberte objekt…')); center.append(tools, objects, selected, viewport);
  let properties, selectedObject, selectedId;
  const add = element('button', 'Vložit model…'), duplicate = element('button', 'Duplikovat…'), remove = element('button', 'Odstranit…'), focus = element('button', 'Zarámovat objekt');
  duplicate.disabled = remove.disabled = focus.disabled = true;
  const view = new Viewport(viewport, frame => {
    const object = frame.sceneObject; selected.textContent = object ? object.name : `${frame.name} · geometrie ve scene.4ds`;
    selectedObject = object;
    selectedId = frame.id;
    const independent = object && [6,9].includes(object.frameType) && !object.actorBound && !file.geometry.meshes.some(mesh => mesh.name.toLowerCase() === object.name.toLowerCase());
    duplicate.disabled = remove.disabled = !independent; focus.disabled = false;
    if (object) { objects.value = String(frame.id); properties?.select(object.fields.position ?? object.fields.name); }
  }, (frame, values, mode) => {
    const field = { translate: 'position', rotate: 'rotation', scale: 'scale' }[mode], id = frame.sceneObject?.fields[field];
    if (!id) { status('Tato transformace nemá existující vlastnost ve zdrojovém souboru. Zatím ji upravte ve scene.4ds.', true); return; }
    state.texts.set(id, values[field]); properties?.select(id); status('Úprava mapy je rozepsaná. Uložte ji v inspektoru.');
  }); state.viewport = view;
  const overrides = new Map(file.objects.map(object => [object.name.toLowerCase(), object]));
  const byField = new Map();
  function addFields(id, object) { for (const [kind, field] of Object.entries(object.fields)) byField.set(field, { id, kind }); }
  function addOption(id, object) { const option = element('option', object.name); option.value = id; objects.append(option); addFields(id, object); }
  try {
    view.addModel(file.geometry, view.root, '', overrides);
    for (const object of view.frames.values()) {
      const frame = object.userData.frame, sceneObject = frame.sceneObject; frame.editable = Boolean(sceneObject?.fields.position);
      if (sceneObject) addOption(frame.id, sceneObject);
    }
    view.fit();
  } catch (error) { status(error.message, true); }
  const existing = new Set([...view.frames.values()].map(object => object.userData.frame.sceneObject?.id).filter(Boolean)), pending = file.objects.filter(object => !existing.has(object.id) && object.position);
  const modelCache = new Map();
  const resolveTexture = async texture => { const p = texture.replaceAll('\\', '/').toLowerCase(), asset = state.project.assets.find(a => a.path.toLowerCase() === `maps/${p}` || a.path.toLowerCase() === p); return asset ? api.media(asset.path) : null; };
  async function addObjects() {
    for (const object of pending) {
      if (view.disposed) return;
      let model;
      if (object.model) {
        const requested = `models/${object.model.replace(/\.(?:i3d|4ds)$/i, '.4ds')}`.toLowerCase(), asset = state.project.assets.find(a => a.path.toLowerCase() === requested);
        if (asset) {
          if (!modelCache.has(asset.path)) modelCache.set(asset.path, api.inspect(asset.path));
          try { const candidate = await modelCache.get(asset.path); if (candidate.type === 'model') model = candidate; } catch { /* A missing model remains visible as a marker. */ }
        }
      }
      if (view.disposed) return;
      const id = view.addSceneObject(object, model); addOption(id, object);
    }
    const warnings = view.linkScene(); view.fit();
    if (state.selectSceneName) {
      const object = [...view.frames.values()].find(o => o.userData.frame.sceneObject?.name === state.selectSceneName && !o.userData.frame.ownerId);
      if (object) { view.select(object.userData.frame.id); view.fit(object); }
      state.selectSceneName = null;
    }
    view.loadTextures(resolveTexture); status(warnings.length ? `3D mapa načtená; ${warnings.length} vazeb má chybějícího nebo nejednoznačného rodiče.` : '3D mapa: geometrie a dostupné objekty načtené.');
  }
  addObjects().catch(error => status(error.message, true));
  for (const [mode, label] of [['translate', 'Posun'], ['rotate', 'Rotace'], ['scale', 'Měřítko']]) { const button = element('button', label); button.onclick = () => view.gizmo.setMode(mode); tools.append(button); }
  const fit = element('button', 'Zarámovat mapu'); fit.onclick = () => view.fit();
  const sky = element('button', 'Obloha'); let showSky = false; sky.setAttribute('aria-pressed', 'false'); sky.onclick = () => { showSky = !showSky; view.showBackdrop(showSky); sky.setAttribute('aria-pressed', String(showSky)); };
  tools.append(fit, sky); objects.onchange = () => view.select(objects.value);
  focus.onclick = () => { const object = view.frames.get(selectedId); if (object) view.fit(object); };
  tools.append(focus);
  if (!file.cacheSource) {
    for (const [button, kind] of [[add, 'add-model'], [duplicate, 'duplicate'], [remove, 'delete']]) button.onclick = () => run(async () => {
      if (state.texts.size) throw new Error('Před změnou seznamu objektů uložte rozepsané vlastnosti.');
      sceneObjectDialog(file, kind, selectedObject);
    });
    tools.append(add, duplicate, remove);
  }
  view.loadTextures(resolveTexture);
  properties = renderProperties(inspector, file, file.cacheSource ? api.saveCache : async (...args) => { await api.saveScene(...args); return api.map(file.path); }, (entry, value) => { const field = byField.get(entry.id); if (field && ['position','rotation','scale'].includes(field.kind)) view.update(field.id, { [field.kind]: value }); });
  center.append(element('p', file.cacheSource ? 'Statické modely vybrané části cache.bin. Transformace se ukládají do samostatného modu; oranžové body označují chybějící modely.' : 'Geometrie scene.4ds a objekty scene2.bin. Modré body označují světla, zvuky a další objekty bez modelu; oranžové body chybějící model. Statické modely lze upravit otevřením cache.bin; kolize a navigace se ještě doplňují.', 'notice'));
}
function sceneObjectDialog(file, kind, object) {
  if (kind !== 'add-model' && !object) throw new Error('Nejdřív vyberte samostatný objekt mapy.');
  const dialog = element('dialog'), form = element('form', undefined, 'mission-form'), fields = element('div', undefined, 'mission-fields');
  const labels = { 'add-model': 'Vložit model do mise', duplicate: 'Duplikovat objekt', delete: 'Odstranit objekt' };
  dialog.append(element('h2', labels[kind]), element('p', kind === 'delete' ? `Odstranit ${object.name}? Změnu lze vrátit tlačítkem Vrátit změnu.` : 'Objekt se uloží do samostatného modu. Uložení lze vrátit jedním krokem.'), form);
  function field(label, input) { const row = element('label', label); row.append(input); fields.append(row); return input; }
  function number(label, value) { const input = element('input'); input.type = 'number'; input.step = 'any'; input.required = true; input.value = String(value); return field(label, input); }
  const name = element('input'); name.required = true; name.maxLength = 63;
  name.value = kind === 'duplicate' ? `${object.name.slice(0,55)}_copy` : 'WB_MODEL';
  if (kind !== 'delete') field('Jedinečný název objektu', name);
  let model, position, heading, scale;
  if (kind === 'add-model') {
    const search = element('input'); search.type = 'search'; search.placeholder = 'Hledat model…'; search.setAttribute('aria-label', 'Hledat vkládaný model'); field('Hledat model', search);
    model = element('select'); model.required = true; model.setAttribute('aria-label', 'Vkládaný model'); field('Model 4DS', model);
    const assets = state.project.assets.filter(a => /^models\/[^/]+\.4ds$/i.test(a.path));
    function fillModels() { const previous = model.value; model.replaceChildren(...assets.filter(a => a.path.toLowerCase().includes(search.value.toLowerCase())).slice(0,300).map(asset => { const option = element('option', asset.path.slice(7)); option.value = asset.path; return option; })); if ([...model.options].some(o => o.value === previous)) model.value = previous; }
    search.oninput = fillModels; fillModels();
    position = ['X','Y','Z'].map((axis,i) => number(`Pozice ${axis}`, object?.position?.[i] ?? 0));
    heading = number('Natočení kolem Y (stupně)', 0); scale = ['X','Y','Z'].map(axis => number(`Měřítko ${axis}`, 1));
    form.append(fields, element('p', 'Model se vloží do hlavního sektoru. Kolize v tree.klz ani aktéři a skripty se tím nevytvářejí.'));
  } else { form.append(fields, element('p', kind === 'duplicate' ? 'Kopie zachová model, rodiče a transformace. Po vložení ji posuňte pomocí 3D nástroje.' : 'Skripty, aktéři a původní geometrie se automaticky nepřepisují. Objekty s rozpoznanými vazbami nelze odstranit.')); }
  const message = element('p', '', 'notice'), actions = element('div', undefined, 'tools'), cancel = element('button', 'Zrušit'), submit = element('button', kind === 'delete' ? 'Odstranit z mise' : kind === 'duplicate' ? 'Duplikovat do modu' : 'Vložit do modu', 'primary');
  cancel.type = 'button'; cancel.onclick = () => dialog.close(); submit.type = 'submit'; actions.append(cancel, submit); form.append(message, actions);
  form.onsubmit = event => {
    event.preventDefault(); if (!form.reportValidity() || state.busy) return;
    run(async () => {
      submit.disabled = cancel.disabled = true;
      try {
        let request = { kind, id: object?.id, name: name.value };
        if (kind === 'add-model') {
          const radians = Number(heading.value) % 360 * Math.PI / 180;
          request = { kind, name: name.value, model: model.value, position: position.map(input => Number(input.value)), rotation: [Math.cos(radians/2),0,Math.sin(radians/2),0], scale: scale.map(input => Number(input.value)) };
        }
        state.file = await api.changeSceneObject(file.path, request, file.sha256); state.selectSceneName = kind === 'delete' ? null : name.value;
        dialog.close(); await refresh(); renderDetail(); status(`${labels[kind]}: uloženo do modu se zálohou.`);
      } catch (error) { message.textContent = error.message; throw error; }
      finally { submit.disabled = cancel.disabled = false; }
    });
  };
  dialog.addEventListener('cancel', event => { if (state.busy) event.preventDefault(); }); dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog); dialog.showModal(); if (kind !== 'delete') { name.focus(); name.select(); }
}
$('filter').oninput = renderFiles;
$('tabs-left').onclick = () => $('categories').scrollBy({ left: -400, behavior: 'smooth' });
$('tabs-right').onclick = () => $('categories').scrollBy({ left: 400, behavior: 'smooth' });
$('categories').addEventListener('wheel', event => { event.preventDefault(); $('categories').scrollLeft += event.deltaX || event.deltaY; }, { passive: false });
for (const [id, action] of [['open', api.open], ['create', api.create]]) $(id).onclick = () => run(async () => {
  if (!await discard()) return;
  status(id === 'create' ? 'Vyberte hru a umístění nového projektu…' : 'Vyberte projekt…');
  const project = await action(); if (!project) { status('Zrušeno'); return; }
  state.viewport?.dispose(); state.viewport = null;
  state.texts.clear(); state.file = null; $('detail').replaceChildren(element('h2', 'Projekt je připravený'), element('p', 'Vyberte soubor vlevo. České texty najdete filtrem Texty.'));
  await refresh(project); status('Projekt otevřený; původní hra zůstala zachovaná.');
});
$('undo').onclick = () => run(async () => {
  if (!await discard()) return;
  const project = await api.undo(); state.texts.clear(); await refresh(project);
  if (state.file && project.assets.some(a => a.path === state.file.path)) await openFile(state.file.path);
  else if (state.file) { state.viewport?.dispose(); state.viewport = null; state.file = null; $('detail').replaceChildren(element('h2', 'Vytvoření mise vráceno'), element('p', 'Vyberte soubor vlevo.')); }
  status('Poslední uložená změna vrácena.');
});
$('new-mission').onclick = () => run(async () => {
  if (state.texts.size) throw new Error('Před vytvořením nové mise uložte rozepsané změny.');
  const template = await api.missionTemplate(); if (!template) return;
  const dialog = element('dialog'), form = element('form', undefined, 'mission-form'), fields = element('div', undefined, 'mission-fields');
  dialog.append(element('h2', 'Nová prázdná mise'), element('p', `${template.name} · ${template.files} souborů. Mise vznikne samostatně v modu; celé vytvoření lze vrátit jedním krokem.`), form);
  function field(label, input) { const row = element('label', label); row.append(input); fields.append(row); return input; }
  function number(label, value, limits = {}) {
    const input = element('input'); input.type = 'number'; input.step = 'any'; input.value = String(value); input.required = true;
    Object.assign(input, limits); return field(label, input);
  }
  const name = element('input'); name.value = 'MOJE_MISE'; name.required = true; name.maxLength = 48; name.pattern = '[a-zA-Z0-9](?:[a-zA-Z0-9_]|-){0,47}'; field('Název složky mise', name);
  const model = element('select'); model.required = true;
  for (const asset of state.project.assets.filter(a => /^models\/[^/]+\.4ds$/i.test(a.path))) { const option = element('option', asset.path.slice(7)); option.value = asset.path; model.append(option); }
  const tommy = [...model.options].find(option => option.value.toLowerCase() === 'models/tommy.4ds'); if (tommy) model.value = tommy.value;
  field('Model hráče (s kostrou)', model);
  const x = number('Start X', 11), y = number('Start Y (výška)', 10), z = number('Start Z', 6), heading = number('Natočení ve stupních kolem Y', 0);
  const sun = number('Síla slunečního světla', 2, { min: '0', max: '10' }), ambient = number('Síla okolního světla', .4, { min: '0', max: '10' });
  const police = element('input'); police.type = 'checkbox'; police.checked = true; field('Inicializovat policii jako v šabloně', police);
  const message = element('p', '', 'notice'), actions = element('div', undefined, 'tools'), cancel = element('button', 'Zrušit'), create = element('button', 'Vytvořit misi', 'primary');
  cancel.type = 'button'; cancel.onclick = () => dialog.close(); create.type = 'submit'; actions.append(cancel, create);
  form.append(fields, element('p', 'Šablona obsahuje rovnou plochu 500 × 500 m. Doprava, chodci a vybavení hráče se nyní převezmou ze šablony. Vypnutí volby policie vynechá její inicializační skript.'), message, actions);
  form.onsubmit = event => {
    event.preventDefault(); if (!form.reportValidity() || state.busy) return;
    run(async () => {
      create.disabled = true; cancel.disabled = true; message.textContent = 'Vytvářím soubory nové mise…';
      try {
        const result = await api.createMission({ name: name.value, model: model.value, position: [x,y,z].map(input => Number(input.value)), heading: Number(heading.value), sun: Number(sun.value), ambient: Number(ambient.value), initializePolice: police.checked });
        dialog.close(); state.category = 'levels'; $('filter').value = `missions/${name.value}/`; await refresh(result.project); await openFile(result.path);
        status(`Nová mise ${name.value} vytvořena. Otevřete 3D mapu nebo spusťte level; vytvoření lze vrátit.`);
      } catch (error) { message.textContent = error.message; throw error; }
      finally { create.disabled = false; cancel.disabled = false; }
    });
  };
  dialog.addEventListener('cancel', event => { if (state.busy) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove(), { once: true }); document.body.append(dialog); dialog.showModal(); name.focus(); name.select();
});
$('export').onclick = () => run(async () => {
  if (state.texts.size) throw new Error('Před exportem uložte rozepsané změny.');
  const result = await api.export(); if (result) status(`Export: ${result.files} souborů → ${result.destination}`);
});
api.onProgress(p => status(p.phase === 'playtest' ? `Synchronizuji test: ${p.current}/${p.total} · ${p.files} změněných souborů` : `Rozbaluji ${p.archive}: ${p.current}/${p.total} · ${p.files} souborů v projektu`));
api.onPlaytest(test => { $('stop-level').hidden = !test.running; if (test.error || test.code) status(`Test skončil chybou. ${test.error ?? `Kód ${test.code}; viz playtest/game.log.`}`, true); else if (!test.running) status('Test levelu ukončen.'); });
$('stop-level').onclick = () => run(async () => { await api.stopLevel(); $('stop-level').hidden = true; status('Test levelu ukončen; původní hra zůstala zachovaná.'); });
window.addEventListener('beforeunload', event => { if (state.texts.size || state.busy) { event.preventDefault(); event.returnValue = ''; } });
run(async () => { await refresh(); const test = await api.playtestState(); $('stop-level').hidden = !test.running; status(state.project ? 'Projekt otevřený.' : 'Připraveno'); });
