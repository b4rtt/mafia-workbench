import { humanAttackTargets, humanBehaviorScript, humanWeapons, inspectHumanBehavior } from '../shared/human-behavior.js';
import { HUMAN_IDLE_SCRIPT, isBareHumanEnd } from '../shared/human-program.js';

export function humanBehaviorFields({ element, file, catalog, owner, code = HUMAN_IDLE_SCRIPT, onChange = () => {} }) {
  const root = element('section'), fields = element('div', undefined, 'mission-fields'), message = element('p', '', 'notice'), preview = element('textarea');
  const field = (label, input) => { const row = element('label', label); input.setAttribute('aria-label', label); row.append(input); fields.append(row); return input; };
  const number = (label, value, min, max, step = '1') => { const input = field(label, element('input')); input.type = 'number'; input.required = true; input.value = String(value); input.min = String(min); input.max = String(max); input.step = step; return input; };
  const mode = field('Chování postavy', element('select'));
  for (const [value, label] of [['idle', 'Aktivní čekání'], ['attack', 'Ozbrojený útok na postavu'], ['custom', 'Vlastní program']]) { const option = element('option', label); option.value = value; mode.append(option); }
  const attack = [], weapons = humanWeapons(catalog), target = field('Cíl útoku', element('select')), weapon = field('Zbraň NPC', element('select'));
  target.required = weapon.required = true;
  for (const item of weapons) { const option = element('option', `${item.name} · ID ${item.itemId}`); option.value = String(item.itemId); weapon.append(option); }
  const clip = number('Náboje v zásobníku', weapons[0]?.clip ?? 1, 1, 100000), reserve = number('Náhradní náboje', weapons[0]?.reserve ?? 0, 0, 100000), range = number('Vzdálenost útoku (m; −1 podle zbraně)', -1, -1, 10000, 'any'), delay = number('Prodleva po vybavení (sekundy)', 5, 0, 86400, 'any');
  attack.push(target, weapon, clip, reserve, range, delay);
  const initial = inspectHumanBehavior(owner(), code); mode.value = initial.mode;
  if (initial.mode === 'attack') { weapon.value = String(initial.itemId); clip.value = String(initial.clip); reserve.value = String(initial.reserve); range.value = String(initial.range); delay.value = String(initial.delaySeconds); }
  let custom = code, targetOwner = null;
  function options() {
    if (mode.value === 'custom') return { mode: 'custom', code: custom };
    if (mode.value === 'idle') return { mode: 'idle' };
    const item = weapons.find(item => item.itemId === Number(weapon.value));
    if (!item || Number(clip.value) > item.clip) throw new Error('Vyberte dostupnou zbraň a nepřekračujte kapacitu zásobníku.');
    return { mode: 'attack', targetName: target.value, itemId: item.itemId, clip: Number(clip.value), reserve: Number(reserve.value), range: Number(range.value), delaySeconds: Number(delay.value), tableHash: catalog.sha256, modelHash: item.modelHash };
  }
  function update() {
    if (targetOwner !== owner()) {
      const previous = target.value; targetOwner = owner();
      target.replaceChildren(...humanAttackTargets(file, targetOwner).map(actor => { const option = element('option', actor.name); option.value = actor.name; return option; }));
      if ([...target.options].some(option => option.value === previous)) target.value = previous;
    }
    for (const input of attack) { input.disabled = mode.value !== 'attack'; input.parentElement.style.display = input.disabled ? 'none' : ''; }
    clip.max = String(weapons.find(item => item.itemId === Number(weapon.value))?.clip ?? 100000);
    preview.readOnly = mode.value !== 'custom';
    let valid = true, result = '';
    try {
      if (attack.some(input => !input.disabled && !input.checkValidity())) throw new Error('Vyplňte platný cíl, výzbroj a prodlevu.');
      result = humanBehaviorScript(owner(), options());
      message.textContent = mode.value === 'attack' ? 'Útok začne po dvousekundové inicializaci a zvolené prodlevě. AI se může přiblížit k cíli; potřebuje průchozí prostor a navigaci. Cíl musí být aktivní a živý.' : isBareHumanEnd(result) ? 'Samotné end vypne aktéra, kolize i animace. Pro stojící živou postavu použijte aktivní čekání.' : 'Aktivní čekání zachovává aktéra a dynamické kolize. Vlastní program můžete upravit; šablona ho nahradí až po uložení.';
    } catch (error) { valid = false; message.textContent = error.message; }
    if (mode.value !== 'custom') preview.value = result;
    onChange({ valid, code: result });
  }
  preview.rows = 10; preview.setAttribute('aria-label', 'Program chování postavy'); preview.value = code;
  mode.onchange = () => { if (mode.value === 'custom') preview.value = custom; update(); };
  weapon.onchange = () => { const item = weapons.find(item => item.itemId === Number(weapon.value)); clip.value = String(item?.clip ?? 1); reserve.value = String(item?.reserve ?? 0); update(); };
  for (const input of attack) if (!input.onchange) { input.oninput = update; input.onchange = update; }
  preview.oninput = () => { custom = preview.value; update(); };
  root.append(element('h3', 'Chování a výzbroj'), fields, element('p', 'Výsledný program'), preview, message);
  update(); if (initial.mode === 'attack') { target.value = initial.targetName; update(); }
  return { root, options, update };
}

export function humanBehaviorDialog({ element, file, catalog, target, run, save }) {
  const entry = file.entries.find(entry => entry.actorScript && entry.actorKind === 27 && entry.value.name === target);
  if (!entry) throw new Error('Vyberte NPC s podporovaným programem.');
  const dialog = element('dialog', undefined, 'mission-dialogue-dialog'), form = element('form', undefined, 'mission-form'), actions = element('div', undefined, 'tools'), cancel = element('button', 'Zrušit'), submit = element('button', 'Uložit chování postavy', 'primary'), message = element('p', '', 'notice');
  let saving = false; cancel.type = 'button'; submit.type = 'submit'; cancel.onclick = () => dialog.close();
  const behavior = humanBehaviorFields({ element, file, catalog, owner: () => target, code: entry.value.code, onChange: result => { submit.disabled = saving || !result.valid || result.code.replaceAll('\r\n', '\n') === entry.value.code.replaceAll('\r\n', '\n'); } });
  actions.append(cancel, submit); form.append(behavior.root, message, actions);
  dialog.append(element('h2', `Chování postavy · ${target}`), element('p', 'Uložení nahradí pouze program této postavy v modu. Parametry, model a ostatní programy zůstanou zachované; změnu lze vrátit jedním undo. Projeví se po novém spuštění mise.'), form);
  form.onsubmit = event => { event.preventDefault(); if (submit.disabled || saving || !form.reportValidity()) return; run(async () => { saving = true; cancel.disabled = true; behavior.root.inert = true; behavior.update(); try { await save({ kind: 'configure-human', target, behavior: behavior.options() }); dialog.close(); } catch (error) { message.textContent = error.message; } finally { saving = false; behavior.root.inert = false; cancel.disabled = false; behavior.update(); } }); };
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); }); dialog.addEventListener('close', () => dialog.remove(), { once: true }); document.body.append(dialog); dialog.showModal();
}
