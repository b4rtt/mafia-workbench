import { humanAttackTargets, humanBehaviorScript, humanWeapons, inspectHumanBehavior, humanRoutePoints, validateHumanRoute, resolveHumanPatrol, resolveHumanAttack } from '../shared/human-behavior.js';
import { HUMAN_IDLE_SCRIPT, isBareHumanEnd } from '../shared/human-program.js';
import { humanDrivingFields } from './human-driving.js';
import { humanFollowingFields } from './human-following.js';
import { missionFlowTargets } from '../shared/mission-flow.js';

export function humanBehaviorFields({ element, file, catalog, navigation, roads, owner, code = HUMAN_IDLE_SCRIPT, onChange = () => {} }) {
  const root = element('section'), fields = element('div', undefined, 'mission-fields'), message = element('p', '', 'notice'), preview = element('textarea');
  const field = (label, input) => { const row = element('label', label); input.setAttribute('aria-label', label); row.append(input); fields.append(row); return input; };
  const number = (label, value, min, max, step = '1') => { const input = field(label, element('input')); input.type = 'number'; input.required = true; input.value = String(value); input.min = String(min); input.max = String(max); input.step = step; return input; };
  const mode = field('Chování postavy', element('select'));
  for (const [value, label] of [['idle', 'Aktivní čekání'], ['follow', 'Doprovod hráče'], ['patrol', 'Pohyb po trase'], ['drive', 'Jízda vozidlem'], ['attack', 'Ozbrojený útok na postavu'], ['custom', 'Vlastní program']]) { const option = element('option', label); option.value = value; mode.append(option); }
  const attack = [], weapons = humanWeapons(catalog), target = field('Cíl útoku', element('select')), weapon = field('Zbraň NPC', element('select'));
  target.required = weapon.required = true;
  for (const item of weapons) { const option = element('option', `${item.name} · ID ${item.itemId}`); option.value = String(item.itemId); weapon.append(option); }
  const clip = number('Náboje v zásobníku', weapons[0]?.clip ?? 1, 1, 100000), reserve = number('Náhradní náboje', weapons[0]?.reserve ?? 0, 0, 100000), range = number('Vzdálenost útoku (m; −1 podle zbraně)', -1, -1, 10000, 'any'), delay = number('Prodleva po vybavení (sekundy)', 5, 0, 86400, 'any');
  attack.push(target, weapon, clip, reserve, range, delay);
  const initial = inspectHumanBehavior(owner(), code); mode.value = initial.mode;
  const attackStart = field('Spustit útok po signálu bodu', element('select')), immediate = element('option', 'Po načtení mise'); immediate.value = ''; attackStart.append(immediate); attack.push(attackStart);
  const gates = missionFlowTargets(file);
  for (const gate of gates) { const option = element('option', gate.name); option.value = gate.name; attackStart.append(option); }
  if (initial.mode === 'attack' && initial.startSignal && !gates.some(gate => gate.name === initial.startSignal)) { const option = element('option', `${initial.startSignal} · nedostupné`); option.value = initial.startSignal; attackStart.append(option); }
  attackStart.value = initial.mode === 'attack' ? initial.startSignal ?? '' : '';
  const driving=humanDrivingFields({element,file,roads,owner,initial:initial.mode==='drive'?initial:null,onChange:update});
  const following=humanFollowingFields({element,file,owner,initial:initial.mode==='follow'?initial:null,onChange:update});
  if (initial.mode === 'attack') { weapon.value = String(initial.itemId); clip.value = String(initial.clip); reserve.value = String(initial.reserve); range.value = String(initial.range); delay.value = String(initial.delaySeconds); }
  let custom = code, targetOwner = null;
  const route = element('section'), routeSettings = element('div', undefined, 'mission-fields'), routeRows = element('div'), addStop = element('button', 'Přidat zastávku'), points = humanRoutePoints(navigation), stops = initial.mode === 'patrol' ? initial.waypoints.map(stop => ({ ...stop })) : [];
  const routeField = (label, input) => { const row = element('label', label); input.setAttribute('aria-label', label); row.append(input); routeSettings.append(row); return input; };
  const pace = routeField('Pohyb', element('select')), loop = routeField('Opakovat trasu', element('input')), startDelay = routeField('Prodleva před trasou (sekundy)', element('input'));
  const signalField = (label, empty, value) => {
    const select = routeField(label, element('select')), none = element('option', empty); none.value = ''; select.append(none);
    const targets = missionFlowTargets(file);
    for (const target of targets) { const option = element('option', target.name); option.value = target.name; select.append(option); }
    if (value && !targets.some(target => target.name === value)) { const option = element('option', `${value} · nedostupné`); option.value = value; select.append(option); }
    select.value = value ?? ''; return select;
  };
  const routeStart = signalField('Spustit trasu po signálu bodu', 'Po načtení mise', initial.mode === 'patrol' ? initial.startSignal : null), routeComplete = signalField('Po dokončení trasy poslat signál bodu', 'Bez návaznosti', initial.mode === 'patrol' ? initial.onComplete : null);
  for (const [value, label] of [['walk', 'Chůze'], ['run', 'Běh']]) { const option = element('option', label); option.value = value; pace.append(option); }
  loop.type = 'checkbox'; startDelay.type = 'number'; startDelay.min = '0'; startDelay.max = '86400'; startDelay.step = 'any'; startDelay.required = true;
  pace.value = initial.mode === 'patrol' ? initial.pace : 'walk'; loop.checked = initial.mode === 'patrol' && initial.loop; startDelay.value = String(initial.mode === 'patrol' ? initial.delaySeconds : 0);
  route.append(element('h3', 'Zastávky v pořadí průchodu'), routeSettings, element('p', 'Body používají uložené ID z check.bin, nikoli pořadí. Chybějící nebo duplicitní ID upravte v navigaci mise. Trasa musí mít spojení pro chodce; umístěte postavu blízko této sítě. Signál dokončení je pouze pro jednorázovou trasu, po posledním čekání. Přehled návazností otevřete v Logice mise.'), routeRows, addStop);
  if (!points.length) route.append(element('p', navigation?.warning ? `Navigace není dostupná: ${navigation.warning}` : 'Navigace nemá body pro chodce s jednoznačným ID. Nejprve je připravte v check.bin.', 'notice'));
  function renderStops() {
    routeRows.replaceChildren();
    stops.forEach((stop, index) => {
      const row = element('div', undefined, 'mission-fields'), point = element('select'), pause = element('input');
      point.required = true; point.setAttribute('aria-label', `Zastávka ${index + 1} · bod`);
      for (const entry of points) { const option = element('option', `ID ${entry.id} · bod ${entry.index} · ${entry.position.map(value => Number(value.toFixed(2))).join(', ')}`); option.value = String(entry.id); point.append(option); }
      if (!points.some(entry => entry.id === stop.id)) { const option = element('option', `ID ${stop.id} · nedostupný bod`); option.value = String(stop.id); point.append(option); }
      point.value = String(stop.id); point.onchange = () => { stop.id = Number(point.value); update(); };
      pause.type = 'number'; pause.min = '0'; pause.max = '86400'; pause.step = 'any'; pause.required = true; pause.value = String(stop.pauseSeconds); pause.setAttribute('aria-label', `Zastávka ${index + 1} · čekání (sekundy)`);
      pause.oninput = () => { stop.pauseSeconds = pause.value === '' ? NaN : Number(pause.value); update(); };
      const pointLabel = element('label', `${index + 1}. Bod`), pauseLabel = element('label', 'Čekání (sekundy)'), actions = element('div', undefined, 'tools'); pointLabel.append(point); pauseLabel.append(pause);
      for (const [label, offset] of [['Nahoru', -1], ['Dolů', 1], ['Odebrat', 0]]) {
        const button = element('button', label); button.type = 'button'; button.setAttribute('aria-label', `${label} zastávku ${index + 1}`); button.disabled = offset && (index + offset < 0 || index + offset >= stops.length);
        button.onclick = () => { if (offset) [stops[index], stops[index + offset]] = [stops[index + offset], stops[index]]; else stops.splice(index, 1); renderStops(); update(); }; actions.append(button);
      }
      row.append(pointLabel, pauseLabel, actions); routeRows.append(row);
    });
    addStop.disabled = !points.length || stops.length >= 32;
  }
  addStop.type = 'button'; addStop.onclick = () => { stops.push({ id: points[stops.length % points.length].id, pauseSeconds: 1 }); renderStops(); update(); };
  for (const input of [pace, loop, startDelay, routeStart, routeComplete]) { input.oninput = update; input.onchange = update; }
  function options() {
    if (mode.value === 'custom') return { mode: 'custom', code: custom };
    if (mode.value === 'idle') return { mode: 'idle' };
    if (mode.value === 'drive') return driving.options();
    if (mode.value === 'follow') return following.options();
    if (mode.value === 'patrol') return resolveHumanPatrol(file, owner(), { mode: 'patrol', waypoints: stops.map(stop => ({ ...stop })), pace: pace.value, loop: loop.checked, delaySeconds: startDelay.value === '' ? NaN : Number(startDelay.value), navigationHash: navigation?.sha256, startSignal: routeStart.value || null, onComplete: routeComplete.value || null });
    const item = weapons.find(item => item.itemId === Number(weapon.value));
    if (!item || Number(clip.value) > item.clip) throw new Error('Vyberte dostupnou zbraň a nepřekračujte kapacitu zásobníku.');
    return resolveHumanAttack(file, owner(), { mode: 'attack', targetName: target.value, itemId: item.itemId, clip: Number(clip.value), reserve: Number(reserve.value), range: Number(range.value), delaySeconds: Number(delay.value), tableHash: catalog.sha256, modelHash: item.modelHash, startSignal: attackStart.value || null });
  }
  function update() {
    if (targetOwner !== owner()) {
      const previous = target.value; targetOwner = owner();
      target.replaceChildren(...humanAttackTargets(file, targetOwner).map(actor => { const option = element('option', actor.name); option.value = actor.name; return option; }));
      if ([...target.options].some(option => option.value === previous)) target.value = previous;
    }
    for (const input of attack) { input.disabled = mode.value !== 'attack'; input.parentElement.style.display = input.disabled ? 'none' : ''; }
    driving.setActive(mode.value==='drive');
    following.setActive(mode.value==='follow');
    route.style.display = mode.value === 'patrol' ? '' : 'none';
    for (const input of route.querySelectorAll('input, select')) input.disabled = mode.value !== 'patrol';
    clip.max = String(weapons.find(item => item.itemId === Number(weapon.value))?.clip ?? 100000);
    preview.readOnly = mode.value !== 'custom';
    let valid = true, result = '';
    try {
      if (attack.some(input => !input.disabled && !input.checkValidity())) throw new Error('Vyplňte platný cíl, výzbroj a prodlevu.');
      const value = options(); if (mode.value === 'patrol') validateHumanRoute(value, navigation);
      result = humanBehaviorScript(owner(), value);
      message.textContent = mode.value === 'follow' ? 'Doprovod začne po inicializaci, případném signálu a prodlevě. Po dojití k hráči se ověří poloha NPC u cíle; teprve potom se odešle dokončení a NPC čeká aktivní. Výzbroj, navigace a programy ostatních postav se nemění.' : mode.value === 'drive' ? 'Nástup začne po inicializaci, případném signálu a prodlevě. AI použije road.bin; čekání u cíle začne po zastavení. Po jednorázové jízdě a posledním čekání řidič podle nastavení zůstane v autě nebo vystoupí. Dokončení se odešle až poté; postava zůstává aktivní. Další signál jízdu znovu nespouští. Kontrola sítě nezaručuje dostupnost cíle ani volné sedadlo; jiný program může jízdu přerušit.' : mode.value === 'patrol' ? 'Trasa začne po dvousekundové inicializaci, případném signálu a zvolené prodlevě. Čekání u bodu začne až po příchodu. Po jednorázovém průchodu a posledním čekání odešle zvolený signál a NPC zůstane aktivní. Trasa se nespouští znovu dalším signálem; pohyb závisí i na kolizích a dosažitelnosti počátku sítě.' : mode.value === 'attack' ? 'Útok začne po dvousekundové inicializaci, případném signálu a prodlevě po vybavení. Časný signál se zachová; další signál útok znovu nespouští. AI potřebuje průchozí prostor, navigaci a živý aktivní cíl. Smrt cílů a návaznosti vyhodnoťte samostatným bojovým úkolem v Logice mise.' : isBareHumanEnd(result) ? 'Samotné end vypne aktéra, kolize i animace. Pro stojící živou postavu použijte aktivní čekání.' : 'Aktivní čekání zachovává aktéra a dynamické kolize. Vlastní program můžete upravit; šablona ho nahradí až po uložení.';
    } catch (error) { valid = false; message.textContent = error.message; }
    if (mode.value !== 'custom') preview.value = result;
    onChange({ valid, code: result });
  }
  preview.rows = 10; preview.setAttribute('aria-label', 'Program chování postavy'); preview.value = code;
  mode.onchange = () => { if (mode.value === 'custom') preview.value = custom; update(); };
  weapon.onchange = () => { const item = weapons.find(item => item.itemId === Number(weapon.value)); clip.value = String(item?.clip ?? 1); reserve.value = String(item?.reserve ?? 0); update(); };
  for (const input of attack) if (!input.onchange) { input.oninput = update; input.onchange = update; }
  preview.oninput = () => { custom = preview.value; update(); };
  renderStops(); root.append(element('h3', 'Chování a výzbroj'), fields, route, driving.root, following.root, element('p', 'Výsledný program'), preview, message);
  update(); if (initial.mode === 'attack') { target.value = initial.targetName; update(); }
  return { root, options, update };
}

export function humanBehaviorDialog({ element, file, catalog, navigation, roads, target, run, save }) {
  const entry = file.entries.find(entry => entry.actorScript && entry.actorKind === 27 && entry.value.name === target);
  if (!entry) throw new Error('Vyberte NPC s podporovaným programem.');
  const dialog = element('dialog', undefined, 'mission-dialogue-dialog'), form = element('form', undefined, 'mission-form'), actions = element('div', undefined, 'tools'), cancel = element('button', 'Zrušit'), submit = element('button', 'Uložit chování postavy', 'primary'), message = element('p', '', 'notice');
  let saving = false; cancel.type = 'button'; submit.type = 'submit'; cancel.onclick = () => dialog.close();
  const behavior = humanBehaviorFields({ element, file, catalog, navigation, roads, owner: () => target, code: entry.value.code, onChange: result => { submit.disabled = saving || !result.valid || result.code.replaceAll('\r\n', '\n') === entry.value.code.replaceAll('\r\n', '\n'); } });
  actions.append(cancel, submit); form.append(behavior.root, message, actions);
  dialog.append(element('h2', `Chování postavy · ${target}`), element('p', 'Uložení nahradí pouze program této postavy v modu. Parametry, model a ostatní programy zůstanou zachované; změnu lze vrátit jedním undo. Projeví se po novém spuštění mise.'), form);
  form.onsubmit = event => { event.preventDefault(); if (submit.disabled || saving || !form.reportValidity()) return; run(async () => { saving = true; cancel.disabled = true; behavior.root.inert = true; behavior.update(); try { await save({ kind: 'configure-human', target, behavior: behavior.options() }); dialog.close(); } catch (error) { message.textContent = error.message; } finally { saving = false; behavior.root.inert = false; cancel.disabled = false; behavior.update(); } }); };
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); }); dialog.addEventListener('close', () => dialog.remove(), { once: true }); document.body.append(dialog); dialog.showModal();
}
