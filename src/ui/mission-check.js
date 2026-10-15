export function missionCheckDialog(initial, { element, run, check, open, assets }) {
  const dialog = element('dialog', undefined, 'mission-check-dialog'), heading = element('h2', `Kontrola mise · ${initial.name}`);
  const language = element('select'), label = element('label', 'Jazyk textů'), summary = element('p'), results = element('div'), error = element('p', '', 'notice');
  const close = element('button', 'Zavřít'), repeat = element('button', 'Zkontrolovat znovu'), actions = element('div', undefined, 'tools');
  const key = name => name.replaceAll('\\', '/').normalize('NFC').toLowerCase(), paths = new Set(assets.map(asset => key(asset.path)));
  for (const path of initial.languages) { const option = element('option', path); option.value = path; language.append(option); }
  language.value = initial.textDb ?? ''; language.disabled = !initial.languages.length; label.append(language);
  let pending = false;
  const explanation = element('p', 'Kontrola uložených dat. Prověřuje tři základní soubory, hráče, přímo uvedené modely a přítomnost jejich textur, vazby a texty přesně rozpoznaných šablon, hlavičky jejich dabingu, známé návaznosti a uložené navigační body tras NPC i cíle doprovodu a vazby jízdy NPC na auto, cíle a silniční síť; u útoků NPC cílovou postavu, aktivaci, definici a model zbraně. Vlastní skripty, snímky animovaných textur, obsah obrázků ani geometrickou průchodnost a chování ve hře neověřuje. Bez nálezů neznamená otestovanou hratelnou misi.', 'notice');
  function draw(report) {
    const counts = level => report.issues.filter(issue => issue.severity === level).length;
    summary.textContent = `Chyby: ${counts('error')} · Upozornění: ${counts('warning')} · Šablony: ${report.recipes} · ID textů: ${report.textReferences} · Dabingy: ${report.voices} · Modely: ${report.models} · Textury: ${report.textures} · Přečtené soubory: ${report.files.length}`;
    results.replaceChildren();
    if (!report.issues.some(issue => issue.severity === 'error' || issue.severity === 'warning')) results.append(element('p', 'V prověřovaných uložených datech nebyly nalezeny chyby ani upozornění.'));
    const levels = { error: 'Chyba', warning: 'Upozornění', info: 'Rozsah kontroly' };
    for (const severity of ['error', 'warning', 'info']) for (const issue of report.issues.filter(issue => issue.severity === severity)) {
      const row = element('article', undefined, `mission-check-issue ${severity}`);
      row.append(element('strong', levels[severity]), element('p', issue.message));
      if (issue.path) {
        row.append(element('small', `${issue.path}${issue.object ? ` · ${issue.object}` : ''}`));
        if (paths.has(key(issue.path))) {
          const button = element('button', issue.entryId ? 'Otevřít skript' : issue.textId !== undefined ? 'Otevřít tabulku textů' : 'Otevřít soubor');
          button.onclick = () => run(async () => {
            error.textContent = ''; button.disabled = true;
            try { if (await open(issue)) dialog.close(); }
            catch (reason) { error.textContent = reason.message; }
            finally { button.disabled = false; }
          }); row.append(button);
        }
      }
      results.append(row);
    }
    const files = element('details'), title = element('summary', 'Přečtené soubory a jejich verze'); files.append(title);
    for (const file of report.files) files.append(element('p', `${file.path} · SHA-256 ${file.sha256}`));
    results.append(files);
  }
  const update = () => run(async () => {
    pending = true; repeat.disabled = close.disabled = language.disabled = true; error.textContent = '';
    try { draw(await check(language.value || null)); }
    catch (reason) { results.replaceChildren(); summary.textContent = 'Kontrola není aktuální.'; error.textContent = reason.message; }
    finally { pending = false; repeat.disabled = close.disabled = false; language.disabled = !initial.languages.length; }
  });
  language.onchange = update; repeat.onclick = update; close.onclick = () => dialog.close();
  actions.append(repeat, close); dialog.append(heading, explanation, label, summary, error, results, actions);
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  draw(initial); document.body.append(dialog); dialog.showModal(); close.focus();
}
