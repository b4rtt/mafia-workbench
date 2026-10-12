import { categories, groupAssets } from '../shared/categories.js';
import { Viewport } from './viewport.js';
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
  const badges = { textdb: 'TEXTDB · EDITACE', scene: 'SCÉNA · EDITACE', map: 'MAPA · 3D EDITACE', model: '4DS · 3D EDITACE', animation: '5DS · ANIMACE', image: 'OBRÁZEK · NÁHLED', audio: 'ZVUK · PŘEHRÁVAČ' };
  const head = element('div', undefined, 'file-header'); head.append(element('h2', file.path), element('span', badges[file.type] ?? 'BINÁRNÍ SOUBOR', 'badge')); main.append(head);
  const source = state.project.assets.find(a => a.path === file.path);
  main.append(element('div', `${file.size.toLocaleString('cs')} bajtů · ${source?.archive} · ${source?.variants ?? 1} variant archivů`, 'file-meta'));
  const toolbar = element('div', undefined, 'tools');
  const restore = element('button', 'Obnovit originál');
  restore.onclick = () => run(async () => { if (!await discard()) return; state.file = await api.restore(file.path); state.texts.clear(); await refresh(); renderDetail(); status('Originál obnoven; obnovení lze také vrátit.'); });
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
  else if (file.type === 'scene') renderProperties(main, file, api.saveScene);
  else if (file.type === 'model') renderModel(main, file);
  else if (file.type === 'map') renderMap(main, file);
  else if (file.type === 'animation') renderProperties(main, file, api.saveAnimation);
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
  center.append(element('p', `${file.meshes.length} objektů · ${file.materials.length} materiálů · LOD 0. Skinning a morfování zatím nejsou v náhledu animované.`, 'notice'));
  properties = renderProperties(inspector, file, api.saveModel, (entry, value) => { const match = /^meshes\/(\d+)\/(position|rotation|scale)$/.exec(entry.id); if (match) view.update(String(Number(match[1]) + 1), { [match[2]]: value }); });
}
function renderMap(main, file) {
  const layout = element('div', undefined, 'model-workspace'), center = element('section', undefined, 'model-center'), inspector = element('section', undefined, 'model-inspector'); layout.append(center, inspector); main.append(layout);
  const tools = element('div', undefined, 'tools'), viewport = element('div', undefined, 'viewport'), selected = element('p', 'Vyberte objekt mapy.'), objects = element('select'); objects.setAttribute('aria-label', 'Objekt mapy'); objects.append(element('option', 'Vyberte objekt…')); center.append(tools, objects, selected, viewport);
  let properties;
  const view = new Viewport(viewport, frame => {
    const object = frame.sceneObject; selected.textContent = object ? object.name : `${frame.name} · geometrie ve scene.4ds`;
    if (object) { objects.value = String(frame.id); properties?.select(object.fields.position ?? object.fields.name); }
  }, (frame, values, mode) => {
    const field = { translate: 'position', rotate: 'rotation', scale: 'scale' }[mode], id = frame.sceneObject?.fields[field];
    if (!id) { status('Tato transformace nemá existující vlastnost ve scene2.bin. Zatím ji upravte ve scene.4ds.', true); return; }
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
    view.loadTextures(resolveTexture); status(warnings.length ? `3D mapa načtená; ${warnings.length} vazeb má chybějícího nebo nejednoznačného rodiče.` : '3D mapa: geometrie a dostupné objekty načtené.');
  }
  addObjects().catch(error => status(error.message, true));
  for (const [mode, label] of [['translate', 'Posun'], ['rotate', 'Rotace'], ['scale', 'Měřítko']]) { const button = element('button', label); button.onclick = () => view.gizmo.setMode(mode); tools.append(button); }
  const fit = element('button', 'Zarámovat mapu'); fit.onclick = () => view.fit();
  const sky = element('button', 'Obloha'); let showSky = false; sky.setAttribute('aria-pressed', 'false'); sky.onclick = () => { showSky = !showSky; view.showBackdrop(showSky); sky.setAttribute('aria-pressed', String(showSky)); };
  tools.append(fit, sky); objects.onchange = () => view.select(objects.value);
  view.loadTextures(resolveTexture);
  properties = renderProperties(inspector, file, async (...args) => { await api.saveScene(...args); return api.map(file.path); }, (entry, value) => { const field = byField.get(entry.id); if (field && ['position','rotation','scale'].includes(field.kind)) view.update(field.id, { [field.kind]: value }); });
  center.append(element('p', 'Geometrie scene.4ds a objekty scene2.bin. Modré body označují světla, zvuky a další objekty bez modelu; oranžové body chybějící model. Cache.bin, kolize a navigace se ještě doplňují.', 'notice'));
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
$('undo').onclick = () => run(async () => { if (!await discard()) return; const project = await api.undo(); state.texts.clear(); await refresh(project); if (state.file) await openFile(state.file.path); status('Poslední uložená změna vrácena.'); });
$('export').onclick = () => run(async () => {
  if (state.texts.size) throw new Error('Před exportem uložte rozepsané změny.');
  const result = await api.export(); if (result) status(`Export: ${result.files} souborů → ${result.destination}`);
});
api.onProgress(p => status(p.phase === 'playtest' ? `Synchronizuji test: ${p.current}/${p.total} · ${p.files} změněných souborů` : `Rozbaluji ${p.archive}: ${p.current}/${p.total} · ${p.files} souborů v projektu`));
api.onPlaytest(test => { $('stop-level').hidden = !test.running; if (test.error || test.code) status(`Test skončil chybou. ${test.error ?? `Kód ${test.code}; viz playtest/game.log.`}`, true); else if (!test.running) status('Test levelu ukončen.'); });
$('stop-level').onclick = () => run(async () => { await api.stopLevel(); $('stop-level').hidden = true; status('Test levelu ukončen; původní hra zůstala zachovaná.'); });
window.addEventListener('beforeunload', event => { if (state.texts.size || state.busy) { event.preventDefault(); event.returnValue = ''; } });
run(async () => { await refresh(); const test = await api.playtestState(); $('stop-level').hidden = !test.running; status(state.project ? 'Projekt otevřený.' : 'Připraveno'); });
