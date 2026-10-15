import { humanFollowingDestinations, resolveHumanFollowing } from '../shared/human-following.js';
import { missionFlowTargets } from '../shared/mission-flow.js';

export function humanFollowingFields({ element, file, owner, initial, onChange }) {
  const root = element('section'), fields = element('div', undefined, 'mission-fields');
  const field = (label, input) => { const row = element('label', label); input.setAttribute('aria-label', label); row.append(input); fields.append(row); return input; };
  const choose = (label, empty, entries, value) => {
    const select = field(label, element('select')), none = element('option', empty); none.value = ''; select.append(none);
    for (const entry of entries) { const option = element('option', entry.name); option.value = entry.name; select.append(option); }
    if (value && !entries.some(entry => entry.name === value)) { const option = element('option', `${value} · nedostupné`); option.value = value; select.append(option); }
    select.value = value ?? ''; return select;
  };
  const points = missionFlowTargets(file), start = choose('Spustit doprovod po signálu bodu', 'Po načtení mise', points, initial?.startSignal), destination = choose('Zastavit doprovod u objektu', 'Následovat bez cílového zastavení', humanFollowingDestinations(file, owner()), initial?.destinationName);
  const radius = field('Poloměr zastavení NPC', element('input')); radius.type = 'number'; radius.step = 'any'; radius.min = '0.000001'; radius.required = true; radius.value = String(initial?.destinationRadius ?? 3);
  const complete = choose('Po příchodu NPC poslat signál bodu', 'Bez návaznosti', points, initial?.onComplete), delay = field('Prodleva před doprovodem (sekundy)', element('input'));
  delay.type = 'number'; delay.min = '0'; delay.max = '86400'; delay.step = 'any'; delay.required = true; delay.value = String(initial?.delaySeconds ?? 0);
  root.append(element('h3', 'Doprovod hráče'), fields, element('p', 'NPC následuje hráče Tommy pomocí původní AI. Doprovod je pěší; NPC dojde na dvě jednotky od hráče. Po příchodu k hráči kontroluje polohu NPC v kouli kolem cíle, včetně výšky. Hráč musí u cíle počkat a poloměr zvolte větší než dvě jednotky. Po zastavení zůstane NPC aktivní. Potřebuje průchozí prostor a vhodnou navigaci; program negeneruje cestu ani neupravuje výzbroj. Smrt NPC nepředává signál dokončení.'));
  let active = false;
  const update = () => { for (const input of [start, destination, delay]) input.disabled = !active; for (const input of [radius, complete]) { input.disabled = !active || !destination.value; input.parentElement.style.display = input.disabled ? 'none' : ''; } };
  for (const input of [start, destination, radius, complete, delay]) { input.oninput = input.onchange = () => { update(); onChange(); }; }
  return { root, setActive(value) { active = value; root.hidden = !active; update(); }, options() {
    if ([start, destination, radius, complete, delay].some(input => !input.disabled && !input.checkValidity())) throw new Error('Doprovod: vyplňte platný poloměr a prodlevu.');
    return resolveHumanFollowing(file, owner(), { mode: 'follow', startSignal: start.value || null, destinationName: destination.value || null, destinationRadius: destination.value ? radius.value.trim() ? Number(radius.value) : NaN : null, onComplete: destination.value ? complete.value || null : null, delaySeconds: delay.value.trim() ? Number(delay.value) : NaN });
  } };
}
