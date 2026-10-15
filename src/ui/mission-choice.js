import { choiceControllers, resolveMissionChoice, editableMissionChoice, resolveMissionChoiceEdit } from '../shared/mission-choice.js';
import { missionFlowTargets } from '../shared/mission-flow.js';

export function missionChoiceDialog({ api, assets, file, position = [0, 0, 0], target = null, initialName = 'WB_CHOICE', element, run, onCreated }) {
  const editing = target !== null, existing = editing ? editableMissionChoice(file, target) : null, initial = existing?.choice;
  if (editing && !existing) throw new Error('Volba: vlastní nebo neúplnou skupinu upravte v inspektoru.');
  const controllers = choiceControllers(file, { includeFull: editing }), targets = missionFlowTargets(file).filter(actor => !editing || ![initial.name, `${initial.name}_CLAIM`, ...Array.from({ length: 4 }, (_, index) => `${initial.name}_ANSWER${index + 1}`)].some(name => name.toLowerCase() === actor.name.toLowerCase()));
  if (!controllers.length) throw new Error('Volba: přidejte NPC postavu s prázdným programem (nebo programem „end“). Program pak bude zajišťovat úklid odpovědí.');
  if (!targets.length) throw new Error('Volba: nejprve vytvořte cílové úkoly nebo rozhovory s čekáním na signál.');
  const dialog = element('dialog', undefined, 'mission-dialogue-dialog'), form = element('form', undefined, 'mission-form'), fields = element('div', undefined, 'mission-fields'), rows = element('div', undefined, 'dialogue-lines'), preview = element('textarea'), message = element('p', '', 'notice');
  const field = (parent, label, input) => { const row = element('label', label); input.setAttribute('aria-label', label); row.append(input); parent.append(row); return input; };
  const number = (parent, label, value, min, max) => { const input = field(parent, label, element('input')); input.type = 'number'; input.step = '1'; input.required = true; input.value = String(value); if (min !== undefined) input.min = String(min); if (max !== undefined) input.max = String(max); return input; };
  const name = field(fields, 'Název volby', element('input')); name.required = true; name.maxLength = 55; name.value = initial?.name ?? initialName; name.disabled = editing;
  const xyz = ['X', 'Y', 'Z'].map((label, index) => { const input = number(fields, label, position[index] ?? 0); input.step = 'any'; return input; });
  const controller = field(fields, 'Postava řídící úklid voleb', element('select'));
  for (const actor of controllers) { const option = element('option', `${actor.name} · ${actor.groups.length ? `počet sad voleb: ${actor.groups.length}` : 'prázdný program'}`); option.value = actor.name; controller.append(option); }
  if (editing) { controller.value = initial.controller; for (const input of xyz) { input.disabled = true; input.parentElement.style.display = 'none'; } }
  const wait = field(fields, 'Spustit až po signálu z úkolu nebo rozhovoru', element('input')); wait.type = 'checkbox'; wait.checked = initial?.waitForSignal ?? false;
  const atController = field(fields, 'Nabízet odpovědi u řídicí postavy (i při jejím pohybu)', element('input')); atController.type = 'checkbox'; atController.checked = initial?.atController ?? !editing;
  const lockPlayer = field(fields, 'Zastavit pohyb hráče při výběru odpovědi', element('input')); lockPlayer.type = 'checkbox'; lockPlayer.checked = initial?.lockPlayer ?? !editing;
  const language = field(fields, 'Jazyk odpovědí', element('select'));
  for (const asset of assets.filter(asset => /^tables\/textdb_[a-z]{2}\.def$/i.test(asset.path))) { const option = element('option', asset.path); option.value = asset.path; language.append(option); }
  const cz = [...language.options].find(option => /textdb_cz\.def$/i.test(option.value)); if (cz) language.value = cz.value;
  const showPrompt = field(fields, 'Zobrazit pokyn k výběru odpovědi', element('input')); showPrompt.type = 'checkbox'; showPrompt.checked = editing ? initial.promptId !== undefined : true;
  const promptId = number(fields, 'Pokyn · ID textu', initial?.promptId ?? 90002, 0, 2147483647);
  const promptText = field(fields, 'Pokyn pro hráče', element('input')); promptText.maxLength = 1024; promptText.required = true; promptText.value = 'Vyber odpověď akčním tlačítkem.';
  const add = element('button', 'Přidat odpověď'), cancel = element('button', 'Zrušit'), save = element('button', editing ? 'Uložit volbu' : 'Vytvořit volbu', 'primary'), actions = element('div', undefined, 'tools'); add.type = cancel.type = 'button'; save.type = 'submit'; save.disabled = true; actions.append(cancel, save);
  preview.readOnly = true; preview.rows = 12; preview.setAttribute('aria-label', 'Výsledné programy volby');
  let answers = [], textFile = null, revision = 0, closed = false, saving = false, promptInitialized = initial?.promptId !== undefined;
  const promptMatches = () => textFile?.entries.slice(0, -1).filter(entry => entry.id === Number(promptId.value)) ?? [];
  const options = () => ({ name: name.value, controller: controller.value, waitForSignal: wait.checked, ...(atController.checked ? { atController: true } : {}), ...(lockPlayer.checked ? { lockPlayer: true } : {}), ...(showPrompt.checked ? { promptId: promptId.value.trim() ? Number(promptId.value) : NaN, ...(!promptMatches().length ? { promptText: promptText.value } : {}) } : {}), answers: answers.map(answer => ({ textId: answer.id.value.trim() ? Number(answer.id.value) : NaN, target: answer.target.value })) });
  function update() {
    save.disabled = true; preview.value = ''; add.disabled = answers.length >= 4;
    promptId.disabled = promptText.disabled = !showPrompt.checked;
    const matches = promptMatches(); promptText.readOnly = matches.length > 0;
    if (showPrompt.checked && matches.length) promptText.value = matches[0].text;
    for (const [index, answer] of answers.entries()) { answer.title.textContent = `Odpověď ${index + 1}`; answer.remove.disabled = answers.length <= 2; answer.up.disabled = index === 0; answer.down.disabled = index === answers.length - 1; answer.caption.textContent = textFile?.entries.slice(0, -1).find(entry => entry.id === Number(answer.id.value))?.text ?? 'Text nenalezený · vytvořte jej v kategorii Texty.'; }
    try {
      const choice = options(), plan = editing ? resolveMissionChoiceEdit(file, initial.name, choice) : resolveMissionChoice(file, choice);
      preview.value = [...plan.nodes.map(node => `${node.name}\n${node.code}`), ...(editing ? plan.controllers : [plan.controller]).map(controller => `${controller.name} · řídicí program\n${controller.code}`)].join('\n\n');
      if ([...fields.querySelectorAll('input')].some(input => !input.disabled && input.type !== 'checkbox' && (!input.value.trim() || !input.validity.valid))) throw new Error('Vyplňte platný název a pozici.');
      if (textFile?.path !== language.value || choice.answers.some(answer => { const matches = textFile.entries.slice(0, -1).filter(entry => entry.id === answer.textId); return matches.length !== 1 || !matches[0].text.trim(); })) throw new Error('Každá odpověď potřebuje existující neprázdný text. Dabing nabídky není vyžadován.');
      if (showPrompt.checked && (matches.length > 1 || !promptText.value.trim() || (!matches.length && textFile.entries.some(entry => entry.id === choice.promptId)))) throw new Error('Pokyn potřebuje neprázdný text a jednoznačné ID, které není hraničním záznamem. Existující text upravte v kategorii Texty.');
      const changed = !editing || plan.additions.length || plan.removed.length || plan.controllers.some(controller => file.entries.find(entry => entry.id === controller.scriptId).value.code.replaceAll('\r\n', '\n') !== controller.code) || plan.nodes.some(node => { const entry = file.entries.find(entry => entry.actorScript && entry.value.name.toLowerCase() === node.name.toLowerCase()); return !entry || entry.value.code.replaceAll('\r\n', '\n') !== node.code; });
      save.disabled = saving || !changed;
      message.textContent = editing ? `Upraví se celá volba, její pomocné body a potřebné řídicí události NPC. Přidané odpovědi: ${plan.additions.length}, odebrané: ${plan.removed.length}. Původní polohy a ostatní vlastnosti zůstanou zachované; vše má jedno společné undo.` : `Vznikne ${plan.nodes.length} bodů a upraví se řídicí program ${plan.controller.name}. Vybraná odpověď odešle signál do svého cíle; ostatní se zruší. Vše má jedno společné undo.`;
    } catch (error) { message.textContent = error.message; }
  }
  async function load() { const current = ++revision; textFile = null; update(); try { const table = language.value ? await api.inspect(language.value) : null; if (closed || current !== revision) return; textFile = table; if (!promptInitialized && table) { const ids = new Set([...table.entries.map(entry => entry.id), ...answers.map(answer => Number(answer.id.value))]); let id = 90000; while (ids.has(id)) id++; promptId.value = String(id); promptInitialized = true; } update(); } catch (error) { if (!closed && current === revision) message.textContent = error.message; } }
  function addAnswer(initialAnswer = null) {
    if (answers.length >= 4) return;
    const root = element('section', undefined, 'dialogue-line'), title = element('h3'), inputs = element('div', undefined, 'mission-fields'), caption = element('p'), remove = element('button', 'Odebrat'); remove.type = 'button';
    const id = number(inputs, 'Odpověď · ID textu', initialAnswer?.textId ?? 90000 + answers.length, 0, 2147483647), target = field(inputs, 'Pokračovat bodem', element('select'));
    target.required = true;
    const placeholder = element('option', 'Vyberte návazný úkol nebo rozhovor…'); placeholder.value = ''; target.append(placeholder);
    for (const actor of targets) { const option = element('option', actor.name); option.value = actor.name; target.append(option); }
    if (initialAnswer) { if (![...target.options].some(option => option.value === initialAnswer.target)) { const option = element('option', `${initialAnswer.target} · původní vazba`); option.value = initialAnswer.target; target.append(option); } target.value = initialAnswer.target; }
    const up = element('button', 'Nahoru'), down = element('button', 'Dolů'), tools = element('div', undefined, 'tools'); up.type = down.type = 'button'; tools.append(up, down, remove);
    const answer = { root, title, id, target, caption, remove, up, down }; answers.push(answer); root.append(title, inputs, caption, tools); rows.append(root);
    const move = delta => { const index = answers.indexOf(answer), next = index + delta; if (next < 0 || next >= answers.length) return; [answers[index], answers[next]] = [answers[next], answers[index]]; rows.replaceChildren(...answers.map(answer => answer.root)); update(); }; up.onclick = () => move(-1); down.onclick = () => move(1);
    remove.onclick = () => { answers = answers.filter(other => other !== answer); root.remove(); update(); }; id.oninput = target.onchange = update; update();
  }
  name.oninput = controller.onchange = wait.onchange = lockPlayer.onchange = update;
  showPrompt.onchange = promptText.oninput = update;
  promptId.oninput = () => { promptInitialized = true; update(); };
  atController.onchange = () => { if (!atController.checked) lockPlayer.checked = false; lockPlayer.disabled = !atController.checked; update(); };
  lockPlayer.disabled = !atController.checked;
  for (const input of xyz) input.oninput = update; language.onchange = load; add.onclick = () => addAnswer(); cancel.onclick = () => dialog.close();
  form.onsubmit = event => { event.preventDefault(); if (save.disabled || saving || !form.reportValidity()) return; run(async () => { saving = true; save.disabled = cancel.disabled = add.disabled = true; fields.inert = rows.inert = true; let failure = null; try { const { name: owner, ...choice } = options(); const result = await api.changeSceneObject(file.path, { ...(editing ? { kind: 'configure-choice', target: initial.name } : { kind: 'add-choice', name: owner, position: xyz.map(input => Number(input.value)) }), choice: { ...choice, textDb: language.value, textHash: textFile.sha256 } }, file.sha256); dialog.close(); await onCreated(result, owner); } catch (error) { failure = error.message; } finally { saving = false; fields.inert = rows.inert = false; cancel.disabled = false; if (!closed) { update(); if (failure) message.textContent = failure; } } }); };
  dialog.append(element('h2', editing ? `Nastavit volbu · ${initial.name}` : 'Přidat volbu odpovědi'), ...(editing ? [element('p', 'Obnovena celá skupina odpovědí. Název a původní polohy zůstávají zachované; jazyk není uložený v programu, vyberte TextDB pro kontrolu ID. Změna se projeví při novém spuštění mise. Odebírání bodů s dalšími odkazy nebo neznámými daty se odmítne.')] : []), element('p', 'Hráč použije bod tlačítkem akce a vybere text v původní nabídce hry. Odpovědi vedou do existujících úkolů nebo rozhovorů s čekáním na signál. Bez zaškrtnutí čekání se nabídka připraví po načtení mise.'), form);
  form.append(fields, rows, add, element('p', 'Pokyn se zobrazí jednou při připravení odpovědí jako titulek uprostřed obrazovky. Nabídku otevře akční tlačítko. Nový text pokynu se uloží společně s volbou; existující text se nepřepisuje.'), element('p', 'Výsledné programy'), preview, message, element('p', 'Zámek pohybu se zapne až po příchodu k postavě. Akční tlačítko zůstane funkční; po odpovědi nebo smrti účastníka se obnoví původní rychlost. Postava řídící úklid musí při volbě existovat a být živá. Její program bude vyhrazen volbám; lze jí připojit více sad odpovědí. Volba proběhne jednou. Mluvenou odpověď nebo další rozhovor připravte jako cílový bod.'), actions);
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); }); dialog.addEventListener('close', () => { closed = true; revision++; dialog.remove(); }, { once: true }); document.body.append(dialog); if (editing) for (const answer of initial.answers) addAnswer(answer); else { addAnswer(); addAnswer(); } dialog.showModal(); if (editing) controller.focus(); else name.select(); load();
}
