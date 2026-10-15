import { dialogueSpeakers } from '../shared/mission-dialogue.js';
import { missionFlowTargets } from '../shared/mission-flow.js';
import { missionBranchScript, editableMissionBranch, resolveMissionBranch } from '../shared/mission-branch.js';

export function missionBranchDialog({ api, file, position = [0, 0, 0], target = null, initialName = 'WB_BRANCH', element, run, onCreated }) {
  const editing = target !== null, existing = editing ? editableMissionBranch(file, target) : null, initial = existing?.branch;
  if (editing && !existing) throw new Error('Podmínka: vlastní nebo změněný program upravte v editoru zdroje.');
  const dialog = element('dialog', undefined, 'mission-dialogue-dialog'), form = element('form', undefined, 'mission-form'), fields = element('div', undefined, 'mission-fields'), rows = element('div'), preview = element('textarea'), message = element('p', '', 'notice');
  const field = (parent, label, input) => { const row = element('label', label); input.setAttribute('aria-label', label); row.append(input); parent.append(row); return input; };
  const choose = (parent, label, values, selected) => {
    const input = field(parent, label, element('select')); input.required = true;
    for (const [value, title] of values) { const option = element('option', title); option.value = String(value); input.append(option); }
    if (selected != null && !values.some(([value]) => String(value) === String(selected))) { const option = element('option', `${selected} · nedostupné`); option.value = String(selected); input.append(option); }
    input.value = selected == null ? String(values[0]?.[0] ?? '') : String(selected); return input;
  };
  const name = field(fields, 'Název podmínkového bodu', element('input')); name.value = existing?.entry.value.name ?? initialName; name.required = true; name.maxLength = 63; name.disabled = editing;
  const xyz = ['X', 'Y', 'Z'].map((label, i) => { const input = field(fields, label, element('input')); input.type = 'number'; input.step = 'any'; input.required = true; input.value = String(position[i] ?? 0); if (editing) { input.disabled = true; input.parentElement.style.display = 'none'; } return input; });
  const waiting = field(fields, 'Vyhodnotit až po signálu z jiného bodu', element('input')); waiting.type = 'checkbox'; waiting.checked = initial?.waitForSignal ?? true;
  const match = choose(fields, 'Spojení podmínek', [['all', 'Platí všechny (A zároveň B)'], ['any', 'Platí alespoň jedna (A nebo B)']], initial?.match);
  const targets = missionFlowTargets(file).filter(actor => actor.name.normalize('NFC').toLowerCase() !== name.value.normalize('NFC').toLowerCase()), humans = dialogueSpeakers(file);
  const targetOptions = [['', 'Vyberte skriptový bod…'], ...targets.map(actor => [actor.name, actor.name])];
  const onTrue = choose(fields, 'Ano → poslat signál bodu', targetOptions, initial?.onTrue), onFalse = choose(fields, 'Ne → poslat signál bodu', targetOptions, initial?.onFalse);
  const add = element('button', 'Přidat podmínku'), cancel = element('button', 'Zrušit'), save = element('button', editing ? 'Uložit podmínku' : 'Vytvořit podmínku', 'primary'), actions = element('div', undefined, 'tools'); add.type = cancel.type = 'button'; save.type = 'submit'; save.disabled = true; actions.append(cancel, save);
  preview.readOnly = true; preview.rows = 10; preview.setAttribute('aria-label', 'Výsledný program podmínky');
  const entries = []; let itemTable = null, loading = false, itemError = '', saving = false, closed = false;
  const options = () => ({ waitForSignal: waiting.checked, match: match.value, onTrue: onTrue.value, onFalse: onFalse.value, conditions: entries.map(row => ({ kind: row.kind.value, ...(row.kind.value === 'item' ? { itemId: row.value.value ? Number(row.value.value) : NaN } : { name: row.value.value }), expected: row.expected.value === 'true' })) });
  function conditionValues(kind) {
    if (kind === 'item') return [['', loading && !itemTable ? 'Načítám předměty…' : 'Vyberte předmět…'], ...(itemTable?.records ?? []).filter(item => item.index >= 2 && item.name.trim()).map(item => [item.index, `${item.index} · ${item.name}`])];
    return [['', kind === 'human' ? 'Vyberte postavu…' : 'Vyberte skriptový bod…'], ...(kind === 'human' ? humans : targets).map(actor => [actor.name, actor.name])];
  }
  function fill(row, selected = null) {
    row.value.replaceChildren();
    const values = conditionValues(row.kind.value);
    for (const [value, title] of values) { const option = element('option', title); option.value = String(value); row.value.append(option); }
    if (selected != null && !values.some(([value]) => String(value) === String(selected))) { const option = element('option', `${selected} · nedostupné`); option.value = String(selected); row.value.append(option); }
    row.value.value = selected == null ? '' : String(selected);
    const titles = row.kind.value === 'item' ? ['Hráč má předmět', 'Hráč nemá předmět'] : row.kind.value === 'human' ? ['Postava žije', 'Postava nežije'] : ['Signál je zapnutý', 'Signál je vypnutý'];
    [...row.expected.options].forEach((option, i) => { option.textContent = titles[i]; });
  }
  async function loadItems() {
    if (loading || itemTable || closed) return; loading = true; itemError = ''; update();
    try {
      const table = await api.inspect('tables/predmety.def'); if (closed) return;
      if (table.type !== 'items') throw new Error('Tabulka předmětů nemá podporovaný PC formát.');
      itemTable = table;
      for (const row of entries.filter(row => row.kind.value === 'item')) fill(row, row.value.value || null);
    } catch (error) { if (!closed) itemError = error.message; }
    finally { loading = false; if (!closed) update(); }
  }
  function addRow(condition = { kind: 'human', expected: true }) {
    const box = element('fieldset'), title = element('legend'), grid = element('div', undefined, 'mission-fields'); box.append(title, grid);
    const kind = choose(grid, 'Druh podmínky', [['human', 'Život postavy'], ['item', 'Předmět v inventáři hráče'], ['signal', 'Stav signálu skriptového bodu']], condition.kind);
    const value = choose(grid, 'Postava / předmět / bod', [['', 'Vyberte…']], null), expected = choose(grid, 'Očekávaný stav', [['true', 'Ano'], ['false', 'Ne']], String(condition.expected));
    const remove = element('button', 'Odebrat podmínku'); remove.type = 'button'; box.append(remove); rows.append(box);
    const row = { box, title, kind, value, expected, remove }; entries.push(row); fill(row, condition.itemId ?? condition.name);
    kind.onchange = () => { fill(row); update(); if (kind.value === 'item') loadItems(); }; value.onchange = expected.onchange = update;
    remove.onclick = () => { entries.splice(entries.indexOf(row), 1); box.remove(); update(); }; update();
  }
  function update() {
    if (closed) return; save.disabled = true; preview.value = ''; add.disabled = saving || entries.length >= 8;
    entries.forEach((row, i) => { row.title.textContent = `Podmínka ${i + 1}`; row.remove.disabled = entries.length <= 1 || saving; });
    try {
      const branch = resolveMissionBranch(file, options(), name.value); preview.value = missionBranchScript(branch);
      if ([...form.querySelectorAll('input, select')].some(input => !input.disabled && (!input.validity.valid || input.required && !input.value.trim()))) throw new Error('Vyplňte platný název, pozici a všechny podmínky.');
      if (!editing && [...file.actors, ...file.objects, ...(file.geometry?.meshes ?? [])].some(object => object.name.normalize('NFC').toLowerCase() === name.value.normalize('NFC').toLowerCase())) throw new Error('Název už v misi existuje.');
      if (branch.conditions.some(condition => condition.kind === 'item')) {
        if (!itemTable) throw new Error(itemError || 'Počkejte na načtení předmětů.');
        if (branch.conditions.some(condition => condition.kind === 'item' && !itemTable.records[condition.itemId]?.name.trim())) throw new Error('Vyberte existující pojmenované předměty.');
      }
      save.disabled = saving || editing && preview.value === existing.entry.value.code.replaceAll('\r\n', '\n');
      message.textContent = `${waiting.checked ? 'Po přijetí signálu' : 'Dvě sekundy po načtení mise'} se stav vyhodnotí jednou a zapne právě jeden výstup. Předměty se neodebírají a čtené signály se nenulují. Pozdější změna stavu uzel znovu nespustí.`;
    } catch (error) { message.textContent = error.message; }
  }
  for (const input of [name, ...xyz]) input.oninput = update; waiting.onchange = match.onchange = onTrue.onchange = onFalse.onchange = update;
  add.onclick = () => { if (entries.length < 8) addRow(); }; cancel.onclick = () => dialog.close();
  form.onsubmit = event => {
    event.preventDefault(); if (save.disabled || saving || !form.reportValidity()) return;
    run(async () => {
      saving = true; save.disabled = cancel.disabled = true; form.inert = true; let failure = null;
      try {
        const request = editing ? { kind: 'configure-branch', target: name.value } : { kind: 'add-detector', name: name.value, position: xyz.map(input => Number(input.value)) };
        const result = await api.changeSceneObject(file.path, { ...request, branch: { ...options(), itemTableHash: itemTable?.sha256 } }, file.sha256);
        dialog.close(); await onCreated(result, name.value);
      } catch (error) { failure = error.message; }
      finally { saving = false; form.inert = false; cancel.disabled = false; if (!closed) { update(); if (failure) message.textContent = failure; } }
    });
  };
  dialog.append(element('h2', editing ? `Nastavit podmínku · ${name.value}` : 'Přidat podmínku mise'), element('p', 'Rozvětví děj podle uložených pravidel. Signál bodu je jeho příznak, nikoli potvrzení, že doběhl jeho program. Pro rozhodnutí po úkolu mu z úkolu pošlete signál.'), form);
  form.append(fields, rows, add, element('p', 'Výsledný program'), preview, message, element('p', 'Inventář kontroluje konkrétní ID u Tommyho; nejde o počet kusů či munice a odložená zbraň při jízdě se nemusí započítat. Život postavy odpovídá Energy > 0 v enginu. Po změně spusťte misi znovu. Uložení má jeden krok undo.'), actions);
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); }); dialog.addEventListener('close', () => { closed = true; dialog.remove(); }, { once: true });
  document.body.append(dialog); for (const condition of initial?.conditions ?? [{ kind: 'human', name: humans.find(actor => actor.kind === 27)?.name ?? humans[0]?.name, expected: true }]) addRow(condition);
  update(); dialog.showModal(); if (editing) match.focus(); else name.select(); if (entries.some(row => row.kind.value === 'item')) loadItems();
}
