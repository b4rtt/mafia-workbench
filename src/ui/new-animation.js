import { newAnimationPlan } from '../shared/new-animation.js';

export function newAnimationDialog({ api, assets, initialModel, element, run, onCreated }) {
  const dialog = element('dialog'), form = element('form', undefined, 'mission-form'), fields = element('div', undefined, 'mission-fields'), message = element('p', undefined, 'notice'), summary = element('p', undefined, 'notice'), save = element('button', 'Vytvořit animaci', 'primary'), cancel = element('button', 'Zrušit');
  dialog.className = 'new-animation-dialog';
  dialog.append(element('h2', 'Nová animace z modelu'), element('p', 'Každý pojmenovaný uzel převezme lokální pózu modelu jako klíč ve snímku 0. Pohyb pak vytvoříte dalšími klíči na časové ose. Přehrávání ve hře používá 25 snímků/s.'), form);
  const field = (label, input) => { const row = element('label', label); input.setAttribute('aria-label', label); row.append(input); fields.append(row); return input; };
  const search = field('Hledat zdrojový model', element('input')), models = field('Zdrojový model animace', element('select')), name = field('Název nové animace', element('input')), frames = field('Poslední snímek nové animace', element('input'));
  search.type = 'search'; name.value = 'WB_animation'; name.required = true; frames.type = 'number'; frames.min = '0'; frames.max = '65535'; frames.step = '1'; frames.value = '50'; frames.required = true;
  const actions = element('div', undefined, 'tools'); cancel.type = 'button'; actions.append(cancel, save); form.append(fields, summary, message, actions);
  let model = null, generation = 0, saving = false;
  function validate() {
    save.disabled = true;
    if (saving || !model) return false;
    try {
      const plan = newAnimationPlan({ name: name.value, model: model.path, frames: frames.value === '' ? NaN : Number(frames.value) }, model);
      if (assets.some(asset => asset.path.toLowerCase() === plan.path.toLowerCase())) throw new Error('Animace tohoto názvu již existuje. Zvolte nový název.');
      summary.textContent = `${plan.nodes.length} uzlů · snímky 0–${plan.frames} · ${plan.path}` + (plan.unnamed ? ` · ${plan.unnamed} nepojmenovaných uzlů nelze navázat a vynechají se.` : '');
      message.textContent = ''; save.disabled = false; return true;
    } catch (error) { message.textContent = error.message; return false; }
  }
  async function load() {
    const token = ++generation; model = null; save.disabled = true; summary.textContent = models.value ? 'Načítám uzly modelu…' : 'Žádný odpovídající model.'; message.textContent = '';
    if (!models.value) return;
    try { const result = await api.inspect(models.value); if (token !== generation || !dialog.isConnected) return; if (result.type !== 'model') throw new Error(result.warning ?? 'Model není podporovaný.'); model = result; validate(); }
    catch (error) { if (token === generation) message.textContent = error.message; }
  }
  function fill(selected) {
    const matches = assets.filter(asset => /^models\/.+\.4ds$/i.test(asset.path) && asset.path.toLowerCase().includes(search.value.toLowerCase()));
    models.replaceChildren(...matches.map(asset => { const option = element('option', asset.path); option.value = asset.path; return option; }));
    if (matches.some(asset => asset.path === selected)) models.value = selected;
    load();
  }
  search.oninput = () => fill(models.value); models.onchange = load; name.oninput = frames.oninput = validate; cancel.onclick = () => dialog.close();
  form.onsubmit = event => { event.preventDefault(); if (!validate()) return; const selected = model; run(async () => { saving = true; fields.inert = true; save.disabled = cancel.disabled = true; try { const result = await api.createAnimation({ name: name.value, model: selected.path, frames: Number(frames.value) }, selected.sha256); dialog.close(); await onCreated({ ...result, model: selected }); } catch (error) { message.textContent = error.message; throw error; } finally { saving = false; fields.inert = false; save.disabled = cancel.disabled = false; } }); };
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); }); dialog.addEventListener('close', () => { generation++; dialog.remove(); }, { once: true }); document.body.append(dialog); dialog.showModal();
  fill(initialModel ?? assets.find(asset => /^models\/Tommy\.4ds$/i.test(asset.path))?.path);
}
