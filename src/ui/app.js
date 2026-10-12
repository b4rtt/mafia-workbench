const api = window.workbench;
const $ = id => document.getElementById(id);
const state = { project: null, file: null, category: 'all', texts: new Map(), textIndex: 0, busy: false };
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
  renderFiles(); buttons();
}
function renderFiles() {
  if (!state.project) return;
  const filter = $('filter').value.toLowerCase();
  const files = state.project.assets.filter(a => a.path.toLowerCase().includes(filter) && (state.category !== 'changed' || a.modified) && (state.category !== 'texts' || /textdb_[a-z]{2}\.def$/i.test(a.path)));
  const fragment = document.createDocumentFragment();
  for (const file of files.slice(0, 1200)) {
    const button = element('button', file.path); button.title = `${file.archive} · ${file.size} bajtů`;
    button.classList.toggle('active', file.path === state.file?.path); button.classList.toggle('modified', file.modified);
    button.addEventListener('click', () => run(async () => { if (!await discard()) return; state.texts.clear(); state.textIndex = 0; await openFile(file.path); })); fragment.append(button);
  }
  $('file-list').replaceChildren(fragment);
  $('count').textContent = files.length > 1200 ? `1200 Z ${files.length} · ZPŘESNĚTE HLEDÁNÍ` : `${files.length} SOUBORŮ`;
}
async function openFile(name) { state.file = await api.inspect(name); renderDetail(); renderFiles(); status(`Otevřeno: ${name}`); }
function renderDetail() {
  const file = state.file; if (!file) return;
  const main = $('detail'); main.replaceChildren();
  const head = element('div', undefined, 'file-header'); head.append(element('h2', file.path), element('span', file.type === 'textdb' ? 'TEXTDB · EDITACE' : 'BINÁRNÍ SOUBOR', 'badge')); main.append(head);
  const source = state.project.assets.find(a => a.path === file.path);
  main.append(element('div', `${file.size.toLocaleString('cs')} bajtů · ${source?.archive} · ${source?.variants ?? 1} variant archivů`, 'file-meta'));
  const toolbar = element('div', undefined, 'tools');
  const restore = element('button', 'Obnovit originál');
  restore.onclick = () => run(async () => { if (!await discard()) return; state.file = await api.restore(file.path); state.texts.clear(); await refresh(); renderDetail(); status('Originál obnoven; obnovení lze také vrátit.'); });
  const replace = element('button', 'Nahradit souborem…');
  replace.onclick = () => run(async () => { if (!await discard()) return; const replacement = await api.replace(file.path); if (!replacement) return; state.file = replacement; state.texts.clear(); await refresh(); renderDetail(); status('Soubor nahrazen se zálohou.'); });
  toolbar.append(restore, replace); main.append(toolbar);
  if (file.type === 'textdb') renderTexts(main, file);
  else {
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
$('filter').oninput = renderFiles;
for (const id of ['all', 'changed', 'texts']) $(id).onclick = () => { state.category = id; for (const category of ['all', 'changed', 'texts']) $(category).classList.toggle('selected', id === category); renderFiles(); };
for (const [id, action] of [['open', api.open], ['create', api.create]]) $(id).onclick = () => run(async () => {
  if (!await discard()) return;
  status(id === 'create' ? 'Vyberte hru a umístění nového projektu…' : 'Vyberte projekt…');
  const project = await action(); if (!project) { status('Zrušeno'); return; }
  state.texts.clear(); state.file = null; $('detail').replaceChildren(element('h2', 'Projekt je připravený'), element('p', 'Vyberte soubor vlevo. České texty najdete filtrem Texty.'));
  await refresh(project); status('Projekt otevřený; původní hra zůstala zachovaná.');
});
$('undo').onclick = () => run(async () => { if (!await discard()) return; const project = await api.undo(); state.texts.clear(); await refresh(project); if (state.file) await openFile(state.file.path); status('Poslední uložená změna vrácena.'); });
$('export').onclick = () => run(async () => {
  if (state.texts.size) throw new Error('Před exportem uložte rozepsané změny.');
  const result = await api.export(); if (result) status(`Export: ${result.files} souborů → ${result.destination}`);
});
api.onProgress(p => status(`Rozbaluji ${p.archive}: ${p.current}/${p.total} · ${p.files} souborů v projektu`));
window.addEventListener('beforeunload', event => { if (state.texts.size || state.busy) { event.preventDefault(); event.returnValue = ''; } });
run(async () => { await refresh(); status(state.project ? 'Projekt otevřený.' : 'Připraveno'); });
