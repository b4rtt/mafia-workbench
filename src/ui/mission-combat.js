import { missionActivationFields } from './mission-activation.js';
import { combatTargets, resolveMissionCombat, missionCombatScript, editableMissionCombat } from '../shared/mission-combat.js';

export function missionCombatDialog({ api, assets, file, position = [0, 0, 0], target = null, initialName = 'WB_COMBAT', element, run, flowFields, onCreated }) {
  const editing = target !== null, existing = editing ? editableMissionCombat(file, target) : null, initial = existing?.combat;
  if (editing && !existing) throw new Error('Bojový úkol: vlastní nebo změněný program upravte v editoru zdroje.');
  const candidates = combatTargets(file);
  if (!candidates.length) throw new Error('Bojový úkol: nejprve přidejte NPC postavy do mise.');
  const dialog = element('dialog', undefined, 'mission-dialogue-dialog'), form = element('form', undefined, 'mission-form'), fields = element('div', undefined, 'mission-fields'), rows = element('div', undefined, 'dialogue-lines'), message = element('p', '', 'notice'), preview = element('textarea');
  const field = (parent, label, input) => { const row = element('label', label); input.setAttribute('aria-label', label); row.append(input); parent.append(row); return input; };
  const numeric = (label, value, min, max) => { const input = field(fields, label, element('input')); input.type = 'number'; input.step = '1'; input.required = true; input.value = String(value); if (min !== undefined) input.min = String(min); if (max !== undefined) input.max = String(max); return input; };
  const check = label => { const input = field(fields, label, element('input')); input.type = 'checkbox'; return input; };
  const npc = (parent, label) => { const input = field(parent, label, element('select')); for (const actor of candidates) { const option = element('option', actor.name); option.value = actor.name; input.append(option); } return input; };
  const name = field(fields, 'Název bojového úkolu', element('input')); name.value = existing?.entry.value.name ?? initialName; name.required = true; name.maxLength = 63; name.disabled = editing;
  const xyz = ['X', 'Y', 'Z'].map((label, i) => { const input = numeric(label, position[i] ?? 0); input.step = 'any'; return input; });
  const activation = missionActivationFields(element, (label, input) => field(fields, label, input), initial), trigger = activation.trigger;
  const language = field(fields, 'Jazyk textů', element('select'));
  for (const asset of assets.filter(asset => /^tables\/textdb_[a-z]{2}\.def$/i.test(asset.path))) { const option = element('option', asset.path); option.value = asset.path; language.append(option); }
  const cz = [...language.options].find(option => /textdb_cz\.def$/i.test(option.value)); if (cz) language.value = cz.value;
  const interaction = numeric('Volba akce · ID textu', 90000, 0, 2147483647), objective = numeric('Zadání · ID textu', 90001, 0, 2147483647), complete = numeric('Dokončení · ID textu', 90002, 0, 2147483647);
  const timed = check('Časový limit'), seconds = numeric('Limit v sekundách', 60, .1, 86400); seconds.step = 'any';
  const guarded = check('Chránit jinou NPC postavu'), guard = npc(fields, 'Hlídaná postava');
  const failed = numeric('Neúspěch · ID textu', 90003, 0, 2147483647), end = check('Při neúspěchu ukončit misi');
  const checkpoint = check('Uložit checkpoint po aktivaci'), checkpointId = numeric('Checkpoint · ID názvu', 5050, 5000, 5599), exit = check('Po dokončení přejít do menu');
  if (editing) {
    for (const input of xyz) { input.disabled = true; input.parentElement.style.display = 'none'; }
    trigger.value = initial.trigger; interaction.value = String(initial.interactionId ?? 90000); objective.value = String(initial.objectiveId); complete.value = String(initial.completeId);
    timed.checked = initial.failure?.timeoutSeconds != null; seconds.value = String(initial.failure?.timeoutSeconds ?? 60);
    guarded.checked = initial.failure?.humanName != null;
    if (guarded.checked) { if (![...guard.options].some(option => option.value === initial.failure.humanName)) { const option = element('option', `${initial.failure.humanName} · nedostupná postava`); option.value = initial.failure.humanName; guard.append(option); } guard.value = initial.failure.humanName; }
    failed.value = String(initial.failure?.textId ?? 90003); end.checked = initial.failure?.endMission ?? false;
    checkpoint.checked = initial.checkpointId !== null; checkpointId.value = String(initial.checkpointId ?? 5050); exit.checked = initial.exitToMenu;
  }
  const captions = new Map([interaction, objective, complete, failed, checkpointId].map(input => { const caption = element('span'); input.parentElement.append(caption); return [input, caption]; }));
  const add = element('button', 'Přidat cíl'), cancel = element('button', 'Zrušit'), save = element('button', editing ? 'Uložit bojový úkol' : 'Vytvořit bojový úkol', 'primary'), actions = element('div', undefined, 'tools'); add.type = cancel.type = 'button'; save.type = 'submit'; save.disabled = true; actions.append(cancel, save);
  preview.readOnly = true; preview.rows = 10; preview.setAttribute('aria-label', 'Výsledný program bojového úkolu');
  let targets = [], textFile = null, closed = false, revision = 0, saving = false;
  const flow = flowFields(file, fields, name, () => update(), { failure: true, initial: initial?.flow });
  const id = input => input.value.trim() ? Number(input.value) : NaN;
  const options = () => ({ targets: targets.map(target => target.select.value), ...activation.options(), interactionId: id(interaction), objectiveId: id(objective), completeId: id(complete), checkpointId: checkpoint.checked ? id(checkpointId) : null, exitToMenu: exit.checked, failure: timed.checked || guarded.checked ? { timeoutSeconds: timed.checked ? id(seconds) : null, humanName: guarded.checked ? guard.value : null, textId: id(failed), endMission: end.checked } : null, flow: flow.options() });
  const toggle = (input, enabled) => { input.disabled = !enabled; input.parentElement.style.display = enabled ? '' : 'none'; };
  function update() {
    save.disabled = true; preview.value = ''; add.disabled = targets.length >= Math.min(16, candidates.length);
    const hasFailure = timed.checked || guarded.checked; activation.update();
    toggle(interaction, trigger.value === 'use'); toggle(seconds, timed.checked); toggle(guard, guarded.checked); toggle(failed, hasFailure); toggle(end, hasFailure); toggle(checkpointId, checkpoint.checked);
    flow.update({ hasFailure, exit: exit.checked, end: hasFailure && end.checked });
    for (const [i, target] of targets.entries()) { target.title.textContent = `Cíl ${i + 1}`; target.remove.disabled = targets.length <= 1; }
    for (const [input, caption] of captions) caption.textContent = textFile?.entries.slice(0, -1).find(entry => entry.id === id(input))?.text ?? 'Text nenalezený · vytvořte jej v kategorii Texty.';
    try {
      const combat = resolveMissionCombat(file, options(), name.value);
      preview.value = missionCombatScript(combat);
      if ([...fields.querySelectorAll('input, select')].some(input => !input.disabled && input.type !== 'checkbox' && ((input.required && !input.value.trim()) || !input.validity.valid))) throw new Error('Vyplňte platný název, pozici a nastavení úkolu.');
      if (!editing && (file.actors.some(actor => actor.name.normalize('NFC').toLowerCase() === name.value.normalize('NFC').toLowerCase()) || file.objects.some(object => object.name.normalize('NFC').toLowerCase() === name.value.normalize('NFC').toLowerCase()) || file.geometry?.meshes.some(mesh => mesh.name.normalize('NFC').toLowerCase() === name.value.normalize('NFC').toLowerCase()))) throw new Error('Název už v misi existuje. Vyberte nový název úkolu.');
      const ids = [combat.objectiveId, combat.completeId, ...(combat.trigger === 'use' ? [combat.interactionId] : []), ...(combat.failure ? [combat.failure.textId] : []), ...(combat.checkpointId !== null ? [combat.checkpointId] : [])];
      if (textFile?.path !== language.value || ids.some(value => { const matches = textFile.entries.slice(0, -1).filter(entry => entry.id === value); return matches.length !== 1 || !matches[0].text.trim(); })) throw new Error('Každé ID potřebuje existující neprázdný text.');
      save.disabled = saving || editing && preview.value === existing.entry.value.code.replaceAll('\r\n', '\n');
      message.textContent = `Úkol skončí po poražení všech ${combat.targets.length} cílů. Už mrtvé cíle se započítají. Podmínky neúspěchu se kontrolují před dokončením; čas běží od aktivace.`;
    } catch (error) { message.textContent = error.message; }
  }
  async function load() { const current = ++revision; textFile = null; update(); try { const table = language.value ? await api.inspect(language.value) : null; if (closed || current !== revision) return; textFile = table; update(); } catch (error) { if (!closed && current === revision) message.textContent = error.message; } }
  function addTarget(selected = null) {
    if (targets.length >= 16 || selected === null && targets.length >= candidates.length) return;
    const root = element('section', undefined, 'dialogue-line'), title = element('h3'), select = npc(root, 'Cílová NPC postava'), remove = element('button', 'Odebrat cíl'); remove.type = 'button';
    if (selected && !candidates.some(actor => actor.name === selected)) { const option = element('option', `${selected} · nedostupná postava`); option.value = selected; select.append(option); }
    select.value = selected ?? candidates.find(actor => !targets.some(target => target.select.value === actor.name))?.name ?? candidates[0].name;
    const target = { root, title, select, remove }; targets.push(target); root.prepend(title); root.append(remove); rows.append(root);
    select.onchange = update; remove.onclick = () => { targets = targets.filter(other => other !== target); root.remove(); update(); }; update();
  }
  for (const input of fields.querySelectorAll('input, select')) if (!input.onchange) { if (input.tagName === 'INPUT' && input.type !== 'checkbox') input.oninput = update; else input.onchange = update; }
  language.onchange = load; add.onclick = () => addTarget(); cancel.onclick = () => dialog.close();
  form.onsubmit = event => { event.preventDefault(); if (save.disabled || saving || !form.reportValidity()) return; run(async () => { saving = true; save.disabled = cancel.disabled = add.disabled = true; fields.inert = rows.inert = true; let failure = null; try { const request = editing ? { kind: 'configure-combat', target: name.value } : { kind: 'add-detector', name: name.value, position: xyz.map(id) }; const result = await api.changeSceneObject(file.path, { ...request, combat: { ...options(), textDb: language.value, textHash: textFile.sha256 } }, file.sha256); dialog.close(); await onCreated(result, name.value); } catch (error) { failure = error.message; } finally { saving = false; fields.inert = rows.inert = false; cancel.disabled = false; if (!closed) { update(); if (failure) message.textContent = failure; } } }); };
  dialog.append(element('h2', editing ? `Nastavit bojový úkol · ${name.value}` : 'Přidat bojový úkol'), element('p', editing ? 'Změní se pouze program vybraného úkolu, s jedním undo. Polohu a název upravujte ve vlastnostech objektu. Jazyk není uložený v programu: vyberte tabulku pro kontrolu a náhled ID textů. Změna se projeví při novém spuštění mise.' : 'Vyberte existující NPC postavy, které musí hráč porazit. Chování, výzbroj a nepřátelství nastavte v jejich vlastnostech nebo programech; tato šablona je nemění. Pro stojící živou NPC ponechte výchozí čekací smyčku: samotné end vypne aktéra i jeho kolize.'), form);
  form.append(fields, element('h3', 'Cíle úkolu'), rows, add, element('p', 'Výsledný program'), preview, message, element('p', 'Úkol proběhne jednou. Cílové a hlídané postavy během úkolu nemažte jiným skriptem. Uložení má zálohu a jedno undo. Zapnutý checkpoint ve hře přepíše slot ID − 5000 v profilu 0; undo editoru tento herní save nevrací.'), actions);
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); }); dialog.addEventListener('close', () => { closed = true; revision++; dialog.remove(); }, { once: true }); document.body.append(dialog); if (editing) for (const actor of initial.targets) addTarget(actor); else addTarget(); dialog.showModal(); if (editing) trigger.focus(); else name.select(); load();
}
