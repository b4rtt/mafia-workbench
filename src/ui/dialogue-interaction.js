import { dialogueInteractionHumans, dialogueSpeakers } from '../shared/mission-dialogue.js';

export function dialogueInteractionFields({ api, file, initial, editing, element, field, changed }) {
  const choose = (label, values, selected) => {
    const input = field(label, element('select'));
    for (const [value, title] of values) { const option = element('option', title); option.value = value; input.append(option); }
    if (selected && !values.some(([value]) => value === selected)) { const option = element('option', `${selected} · nedostupná postava`); option.value = selected; input.append(option); }
    input.value = selected ?? ''; return input;
  };
  const humans = dialogueInteractionHumans(file), human = choose('Akci nabídnout u postavy', [['', 'Na pozici skriptového bodu'], ...humans.map(actor => [actor.name, actor.name])], initial?.interactionHuman);
  const lock = field('Během replik uzamknout ovládání hráče', element('input')); lock.type = 'checkbox'; lock.checked = initial?.lockPlayer ?? !editing;
  const queue = field('Řadit rozhovory za sebe', element('input')); queue.type = 'checkbox'; queue.checked = initial?.serialize ?? !editing;
  queue.parentElement.append(element('span', 'Po aktivaci počká na dokončení jiného rozhovoru se stejnou volbou. Kamera, ovládání i předmět se převezmou až potom. Starší a vlastní skripty se fronty neúčastní. Pomocný bod WB_DIALOGUE_QUEUE se vytvoří při uložení.'));
  const death = field('Přerušit rozhovor po smrti účastníka', element('input')); death.type = 'checkbox'; death.checked = initial?.interruptOnDeath ?? !editing;
  death.parentElement.append(element('span', 'Život všech mluvčích, posluchačů kamery, hráče a postavy akce se ověří před první a po každé replice. Při přerušení se uvolní kamera i zámek a neodešle se dokončení. Právě přehrávaná věta může doběhnout; čekání na akční tlačítko se tím neruší.'));
  const required = field('Rozhovor / předání vyžaduje předmět v inventáři', element('input')); required.type = 'checkbox'; required.checked = Boolean(initial?.inventory);
  const item = choose('Požadovaný předmět', [['', 'Vyberte předmět…']], null);
  const consume = field('Při použití akce odebrat předmět z inventáře', element('input')); consume.type = 'checkbox'; consume.checked = initial?.inventory?.consume ?? true;
  const notice = element('span', 'Akce se nabídne až s předmětem. Inventář se znovu ověří při stisku akce; předání proběhne jednou před první replikou.'); required.parentElement.append(notice);
  let table = null, loading = false, closed = false, failure = '';
  async function load() {
    if (loading || table || closed) return; loading = true; failure = ''; changed();
    try {
      const result = await api.inspect('tables/predmety.def'); if (closed) return;
      if (result.type !== 'items') throw new Error('Tabulka předmětů nemá podporovaný PC formát.');
      table = result;
      for (const record of table.records.filter(record => record.index >= 2 && record.name.trim())) { const option = element('option', `${record.index} · ${record.name}`); option.value = String(record.index); item.append(option); }
      item.value = String(initial?.inventory?.itemId ?? '');
    } catch (error) { if (!closed) failure = error.message; }
    finally { loading = false; if (!closed) changed(); }
  }
  human.onchange = lock.onchange = queue.onchange = death.onchange = item.onchange = consume.onchange = changed;
  required.onchange = () => { changed(); if (required.checked) load(); };
  return {
    options: trigger => ({ ...(queue.checked ? { serialize: true } : {}), ...(death.checked ? { interruptOnDeath: true } : {}), ...(lock.checked ? { lockPlayer: true } : {}), ...(trigger === 'use' && human.value ? { interactionHuman: human.value } : {}), ...(trigger === 'use' && required.checked ? { inventory: { itemId: item.value ? Number(item.value) : NaN, consume: consume.checked, tableHash: table?.sha256 } } : {}) }),
    interruptOnDeath: () => death.checked,
    update(trigger) {
      human.disabled = required.disabled = trigger !== 'use'; human.parentElement.style.display = required.parentElement.style.display = trigger !== 'use' ? 'none' : '';
      item.disabled = consume.disabled = trigger !== 'use' || !required.checked; item.parentElement.style.display = consume.parentElement.style.display = item.disabled ? 'none' : '';
      human.setCustomValidity(human.value && !humans.some(actor => actor.name === human.value) ? 'Vyberte dostupnou NPC postavu.' : '');
      item.setCustomValidity(!item.disabled && (!table || !item.value) ? failure || (loading ? 'Načítám předměty…' : 'Vyberte dostupný předmět.') : '');
      const player = dialogueSpeakers(file).some(actor => actor.kind === 2 && actor.name.toLowerCase() === 'tommy');
      lock.setCustomValidity((lock.checked || !item.disabled) && !player ? 'Zámek a předání potřebují hráče Tommy typu Player.' : '');
      death.setCustomValidity(death.checked && !player ? 'Kontrola života potřebuje hráče Tommy typu Player.' : '');
    },
    load: () => { if (required.checked) return load(); },
    dispose: () => { closed = true; }
  };
}
