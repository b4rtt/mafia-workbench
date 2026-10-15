import { missionActivationFields } from './mission-activation.js';
import { missionFinishScript, editableMissionFinish } from '../shared/mission-finish.js';
import { missionDestinations } from '../shared/mission-destinations.js';

export function missionFinishDialog({ api, assets, file, position = [0, 0, 0], target = null, initialName = 'WB_FINISH', element, run, onCreated }) {
  const editing = target !== null, existing = editing ? editableMissionFinish(file, target) : null, initial = existing?.finish;
  if (editing && !existing) throw new Error('Zakončení: vlastní nebo změněný program upravte v editoru zdroje.');
  const dialog = element('dialog', undefined, 'mission-dialogue-dialog'), form = element('form', undefined, 'mission-form'), fields = element('div', undefined, 'mission-fields'), message = element('p', '', 'notice'), preview = element('textarea');
  const field = (label, input) => { const row = element('label', label); input.setAttribute('aria-label', label); row.append(input); fields.append(row); return input; };
  const select = (label, values) => { const input = field(label, element('select')); for (const [value, title] of values) { const option = element('option', title); option.value = value; input.append(option); } return input; };
  const number = (label, value) => { const input = field(label, element('input')); input.type = 'number'; input.step = '1'; input.required = true; input.value = String(value); return input; };
  const id = input => input.value.trim() ? Number(input.value) : NaN;
  const name = field('Název zakončení', element('input')); name.value = existing?.entry.value.name ?? initialName; name.required = true; name.maxLength = 63; name.disabled = editing;
  const xyz = ['X', 'Y', 'Z'].map((label, i) => { const input = number(label, position[i] ?? 0); input.step = 'any'; if (editing) { input.disabled = true; input.parentElement.style.display = 'none'; } return input; });
  const outcome = select('Výsledek mise', [['success', 'Úspěšně ukončit misi'], ['failure', 'Neúspěšně ukončit misi'], ['mission', 'Načíst další misi']]); outcome.value = initial?.outcome ?? 'success';
  const activation = missionActivationFields(element, field, initial ?? { trigger: 'load' });
  const signal = field('Čekat na signál z jiného bodu', element('input')); signal.type = 'checkbox'; signal.checked = initial?.waitForSignal ?? true;
  const language = select('Jazyk textů', assets.filter(asset => /^tables\/textdb_[a-z]{2}\.def$/i.test(asset.path)).map(asset => [asset.path, asset.path]));
  const cz = [...language.options].find(option => /textdb_cz\.def$/i.test(option.value)); if (cz) language.value = cz.value;
  const interaction = number('Volba akce · ID textu', initial?.interactionId ?? 90000), complete = number('Výsledek · ID textu', initial?.completeId ?? 90001);
  const captions = new Map([interaction, complete].map(input => { input.min = '0'; input.max = '2147483647'; const caption = element('span'); input.parentElement.append(caption); return [input, caption]; }));
  const destination = select('Další mise', [['', 'Vyberte misi…'], ...missionDestinations(assets, file.path).map(name => [name, name])]);
  if (initial?.nextMission) { if (![...destination.options].some(option => option.value === initial.nextMission)) { const option = element('option', `${initial.nextMission} · nedostupná mise`); option.value = initial.nextMission; destination.append(option); } destination.value = initial.nextMission; }
  const cancel = element('button', 'Zrušit'), save = element('button', editing ? 'Uložit zakončení' : 'Vytvořit zakončení', 'primary'), actions = element('div', undefined, 'tools'); cancel.type = 'button'; save.type = 'submit'; save.disabled = true; actions.append(cancel, save);
  preview.readOnly = true; preview.rows = 10; preview.setAttribute('aria-label', 'Výsledný program zakončení');
  let textFile = null, next = null, textError = '', destinationError = '', textRevision = 0, destinationRevision = 0, closed = false, saving = false;
  const options = () => ({ outcome: outcome.value, ...activation.options(), waitForSignal: signal.checked, interactionId: activation.trigger.value === 'use' ? id(interaction) : null, completeId: outcome.value === 'mission' ? null : id(complete), nextMission: outcome.value === 'mission' ? destination.value : null });
  const toggle = (input, enabled) => { input.disabled = !enabled; input.parentElement.style.display = enabled ? '' : 'none'; };
  function update() {
    const transition = outcome.value === 'mission', use = activation.trigger.value === 'use', needsText = !transition || use;
    activation.update(); toggle(language, needsText); toggle(interaction, use); toggle(complete, !transition); toggle(destination, transition);
    save.disabled = true; preview.value = '';
    for (const [input, caption] of captions) caption.textContent = textFile?.entries.slice(0, -1).find(entry => entry.id === id(input))?.text ?? 'Text nenalezený · vytvořte jej v kategorii Texty.';
    try {
      preview.value = missionFinishScript(options());
      if ([...fields.querySelectorAll('input, select')].some(input => !input.disabled && (!input.validity.valid || input.required && !input.value.trim()))) throw new Error('Vyplňte platný název, pozici a nastavení zakončení.');
      if (!editing && [...file.actors, ...file.objects, ...(file.geometry?.meshes ?? [])].some(object => object.name.normalize('NFC').toLowerCase() === name.value.normalize('NFC').toLowerCase())) throw new Error('Název už v misi existuje.');
      if (needsText && textFile?.path !== language.value) throw new Error(textError || 'Počkejte na načtení jazykových textů.');
      if (needsText && [use ? id(interaction) : null, transition ? null : id(complete)].filter(value => value !== null).some(value => { const matches = textFile.entries.slice(0, -1).filter(entry => entry.id === value); return matches.length !== 1 || !matches[0].text.trim(); })) throw new Error('Každé ID potřebuje jednoznačný existující neprázdný text.');
      if (transition && (!next || next.name.toLowerCase() !== destination.value.toLowerCase())) throw new Error(destinationError || 'Počkejte na kontrolu hráče, scény a kolizí další mise.');
      save.disabled = saving || editing && preview.value === existing.entry.value.code.replaceAll('\r\n', '\n');
      message.textContent = `${signal.checked ? 'Nejprve přijde signál; potom se vyhodnotí zvolené spuštění. ' : activation.trigger.value === 'load' ? 'Pozor: tato mise skončí automaticky dvě sekundy po načtení. ' : ''}${transition ? 'Načte se vlastní hráč a startovní skripty další mise. Inventář, zdraví ani auto se nepřenášejí.' : 'Hra ukončí misi se zvoleným výsledkem a textem. Tento bod nevytváří prostorový cíl ani nemaže ostatní zadání.'}`;
    } catch (error) { message.textContent = error.message; }
  }
  async function loadTexts() { const revision = ++textRevision; textFile = null; textError = ''; update(); try { const value = language.value ? await api.inspect(language.value) : null; if (closed || revision !== textRevision) return; textFile = value; update(); } catch (error) { if (!closed && revision === textRevision) { textError = error.message; update(); } } }
  async function loadDestination() { const revision = ++destinationRevision; next = null; destinationError = ''; update(); if (!destination.value) return; try { const value = await api.missionDestination(destination.value); if (closed || revision !== destinationRevision) return; next = value; update(); } catch (error) { if (!closed && revision === destinationRevision) { destinationError = error.message; update(); } } }
  for (const input of fields.querySelectorAll('input, select')) { if (input.tagName === 'INPUT' && input.type !== 'checkbox') input.oninput = update; else input.onchange = update; }
  language.onchange = loadTexts; destination.onchange = loadDestination; cancel.onclick = () => dialog.close();
  form.onsubmit = event => { event.preventDefault(); if (save.disabled || saving || !form.reportValidity()) return; run(async () => { saving = true; save.disabled = cancel.disabled = true; fields.inert = true; let failure = null; try { const request = editing ? { kind: 'configure-finish', target: name.value } : { kind: 'add-detector', name: name.value, position: xyz.map(id) }; const result = await api.changeSceneObject(file.path, { ...request, finish: { ...options(), textDb: language.value, textHash: textFile?.sha256, nextMissionHashes: next?.hashes } }, file.sha256); dialog.close(); await onCreated(result, name.value); } catch (error) { failure = error.message; } finally { saving = false; fields.inert = false; cancel.disabled = false; if (!closed) { update(); if (failure) message.textContent = failure; } } }); };
  dialog.append(element('h2', editing ? `Nastavit zakončení · ${name.value}` : 'Přidat zakončení mise'), element('p', 'Samostatný koncový bod bez úkolu a cílového objektu. Pro návaznost z úkolu, rozhovoru či volby mu pošlete signál a ponechte spuštění Automaticky po načtení / signálu. Jazyk není uložený ve skriptu; slouží ke kontrole ID.'), form);
  form.append(fields, element('p', 'Výsledný program'), preview, message, element('p', 'Změny se ukládají do modu se zálohou a jedním undo. Projeví se při novém spuštění mise. Polohu existujícího bodu upravte ve 3D vlastnostech.'), actions);
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); }); dialog.addEventListener('close', () => { closed = true; textRevision++; destinationRevision++; dialog.remove(); }, { once: true }); document.body.append(dialog); update(); dialog.showModal(); if (editing) outcome.focus(); else name.select(); loadTexts(); if (initial?.nextMission) loadDestination();
}
