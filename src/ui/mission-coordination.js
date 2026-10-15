import { missionFlowTargets } from '../shared/mission-flow.js';
import { missionCoordinationScript, editableMissionCoordination, resolveMissionCoordination } from '../shared/mission-coordination.js';

export function missionCoordinationDialog({ api, file, position = [0, 0, 0], target = null, initialName = 'WB_CONTROL', element, run, onCreated }) {
  const editing = target !== null, existing = editing ? editableMissionCoordination(file, target) : null, initial = existing?.coordination;
  if (editing && !existing) throw new Error('Řídicí bod: vlastní nebo změněný program upravte v editoru zdroje.');
  const dialog = element('dialog', undefined, 'mission-dialogue-dialog'), form = element('form', undefined, 'mission-form'), fields = element('div', undefined, 'mission-fields'), preview = element('textarea'), message = element('p', '', 'notice');
  const field = (parent, label, input) => { const row = element('label', label); input.setAttribute('aria-label', label); row.append(input); parent.append(row); return input; };
  const name = field(fields, 'Název řídicího bodu', element('input')); name.value = existing?.entry.value.name ?? initialName; name.required = true; name.maxLength = 63; name.disabled = editing;
  const xyz = editing ? [] : ['X', 'Y', 'Z'].map((label, i) => { const input = field(fields, label, element('input')); input.type = 'number'; input.step = 'any'; input.required = true; input.value = String(position[i] ?? 0); return input; });
  const waiting = field(fields, 'Spustit až po přijetí vlastního signálu', element('input')); waiting.type = 'checkbox'; waiting.checked = initial?.waitForSignal ?? true;
  const match = field(fields, 'Čekání na vstupní signály', element('select'));
  for (const [value, title] of [['all', 'Počkat na všechny zapnuté vstupy'], ['any', 'Počkat na alespoň jeden zapnutý vstup']]) { const option = element('option', title); option.value = value; match.append(option); } match.value = initial?.match ?? 'all';
  const delay = field(fields, 'Prodleva po splnění vstupů (s)', element('input')); delay.type = 'number'; delay.min = '0'; delay.max = '86400'; delay.step = '0.001'; delay.required = true; delay.value = String(initial?.delaySeconds ?? 0);
  const inputs = element('fieldset'), outputs = element('fieldset'), inputRows = element('div'), outputRows = element('div'), addInput = element('button', 'Přidat vstup'), addOutput = element('button', 'Přidat výstup'); addInput.type = addOutput.type = 'button';
  inputs.append(element('legend', 'Vstupní signály · 0–8'), inputRows, addInput); outputs.append(element('legend', 'Spustit tyto body · 1–8'), outputRows, addOutput);
  const cancel = element('button', 'Zrušit'), save = element('button', editing ? 'Uložit řídicí bod' : 'Vytvořit řídicí bod', 'primary'), actions = element('div', undefined, 'tools'); cancel.type = 'button'; save.type = 'submit'; save.disabled = true; actions.append(cancel, save);
  preview.readOnly = true; preview.rows = 10; preview.setAttribute('aria-label', 'Výsledný program řídicího bodu');
  const signals = [], targets = [], available = missionFlowTargets(file).filter(actor => actor.name.normalize('NFC').toLowerCase() !== name.value.normalize('NFC').toLowerCase());
  let saving = false, closed = false;
  const options = () => ({ waitForSignal: waiting.checked, match: match.value, signals: signals.map(row => row.select.value), delaySeconds: delay.value.trim() ? Number(delay.value) : NaN, targets: targets.map(row => row.select.value) });
  function addRow(list, parent, value = '') {
    const row = element('div', undefined, 'tools'), select = element('select'), remove = element('button', 'Odebrat'); remove.type = 'button'; select.required = true;
    for (const [name, title] of [['', 'Vyberte skriptový bod…'], ...available.map(actor => [actor.name, actor.name])]) { const option = element('option', title); option.value = name; select.append(option); }
    if (value && !available.some(actor => actor.name === value)) { const option = element('option', `${value} · nedostupné`); option.value = value; select.append(option); }
    select.value = value; row.append(select, remove); parent.append(row); const entry = { row, select, remove }; list.push(entry);
    select.onchange = update; remove.onclick = () => { list.splice(list.indexOf(entry), 1); row.remove(); update(); }; update();
  }
  function update() {
    if (closed) return; save.disabled = true; preview.value = ''; addInput.disabled = saving || signals.length >= 8; addOutput.disabled = saving || targets.length >= 8; match.disabled = !signals.length;
    for (const [list, title] of [[signals, 'Vstup'], [targets, 'Výstup']]) list.forEach((row, i) => { row.select.setAttribute('aria-label', `${title} ${i + 1}`); row.remove.setAttribute('aria-label', `Odebrat ${title.toLowerCase()} ${i + 1}`); row.remove.disabled = saving || list === targets && targets.length <= 1; });
    try {
      const recipe = resolveMissionCoordination(file, options(), name.value); preview.value = missionCoordinationScript(recipe);
      if ([...form.querySelectorAll('input, select')].some(input => !input.disabled && (!input.validity.valid || input.required && !input.value.trim()))) throw new Error('Vyplňte platný název, pozici a všechny vybrané body.');
      if (!editing && [...file.actors, ...file.objects, ...(file.geometry?.meshes ?? [])].some(object => object.name.normalize('NFC').toLowerCase() === name.value.normalize('NFC').toLowerCase())) throw new Error('Název už v misi existuje.');
      save.disabled = saving || editing && preview.value === existing.entry.value.code.replaceAll('\r\n', '\n');
      message.textContent = `${waiting.checked ? 'Po vlastním signálu' : 'Dvě sekundy po načtení mise'} ${signals.length ? 'čeká na zapnuté vstupy' : 'pokračuje bez dalších vstupů'}. Potom odměří prodlevu a jednou zapne všechny výstupy. Během prodlevy už vstupy nekontroluje.`;
    } catch (error) { message.textContent = error.message; }
  }
  for (const input of [name, ...xyz, delay]) input.oninput = update; waiting.onchange = match.onchange = update;
  addInput.onclick = () => { if (signals.length < 8) addRow(signals, inputRows); }; addOutput.onclick = () => { if (targets.length < 8) addRow(targets, outputRows); }; cancel.onclick = () => dialog.close();
  form.onsubmit = event => {
    event.preventDefault(); if (save.disabled || saving || !form.reportValidity()) return;
    run(async () => {
      saving = true; save.disabled = cancel.disabled = true; form.inert = true; let failure = null;
      try {
        const request = editing ? { kind: 'configure-coordination', target: name.value } : { kind: 'add-detector', name: name.value, position: xyz.map(input => Number(input.value)) };
        const result = await api.changeSceneObject(file.path, { ...request, coordination: options() }, file.sha256);
        dialog.close(); await onCreated(result, name.value);
      } catch (error) { failure = error.message; }
      finally { saving = false; form.inert = false; cancel.disabled = false; if (!closed) { update(); if (failure) message.textContent = failure; } }
    });
  };
  dialog.append(element('h2', editing ? `Nastavit řídicí bod · ${name.value}` : 'Přidat řídicí bod mise'), element('p', 'Spojí souběžné větve úkolu nebo spustí několik bodů. Signál je příznak bodu, nikoli automatické potvrzení dokončení jeho programu. Pro dokončení úkolu pošlete signál samostatnému vstupnímu bodu.'), form);
  form.append(fields, inputs, outputs, element('p', 'Výsledný program'), preview, message, element('p', 'Všechny vstupy musí být zapnuté současně při kontrole. Krátké pulzy se nepamatují a čtené signály se nemažou. Bez vstupů funguje jako rozbočení s prodlevou. Jednorázový běh; uložení má jedno undo. Po změně spusťte misi znovu.'), actions);
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); }); dialog.addEventListener('close', () => { closed = true; dialog.remove(); }, { once: true });
  document.body.append(dialog); for (const value of initial?.signals ?? []) addRow(signals, inputRows, value); for (const value of initial?.targets ?? ['']) addRow(targets, outputRows, value);
  update(); dialog.showModal(); if (editing) delay.focus(); else name.select();
}
