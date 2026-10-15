export function missionActivationFields(element, field, initial) {
  const trigger = field('Spuštění', element('select'));
  for (const [value, title] of [['use', 'Použití bodu tlačítkem akce'], ['load', 'Automaticky po načtení / signálu'], ['area', 'Při přiblížení hráče k bodu']]) {
    const option = element('option', title); option.value = value; trigger.append(option);
  }
  const radius = field('Poloměr spouštěcí oblasti', element('input'));
  radius.type = 'number'; radius.step = 'any'; radius.min = '0.000001'; radius.required = true;
  radius.value = String(initial?.triggerRadius ?? 3); trigger.value = initial?.trigger ?? 'use';
  radius.parentElement.append(element('span', 'Koule kolem světové pozice tohoto bodu, včetně výšky. Kontrola každých 100 ms; jednou, po případném signálu. Hráč uvnitř při aktivaci se započítá.'));
  return { trigger, radius,
    options: () => ({ trigger: trigger.value, ...(trigger.value === 'area' ? { triggerRadius: radius.value.trim() ? Number(radius.value) : NaN } : {}) }),
    update(enabled = true) { trigger.disabled = !enabled; radius.disabled = !enabled || trigger.value !== 'area'; radius.parentElement.style.display = radius.disabled ? 'none' : ''; }
  };
}
