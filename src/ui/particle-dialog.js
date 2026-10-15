import { ParticleViewport } from './particle-preview.js';

export function particleDialog({ element, api, assets, type, emitterId = null, direction }) {
  const dialog = element('dialog', undefined, 'light-dialog particle-dialog'), tools = element('div', undefined, 'tools'), area = element('div', undefined, 'viewport'), message = element('p', 'Načítám model a textury…', 'notice');
  const play = element('button', 'Přehrát efekt'), restart = element('button', 'Od začátku'), fit = element('button', 'Zarámovat efekt'), close = element('button', 'Zavřít'), speed = element('select'), emitter = element('select'), timeline = element('input'), clock = element('output');
  play.disabled = restart.disabled = fit.disabled = true; timeline.type = 'range'; timeline.min = '0'; timeline.max = '10000'; timeline.step = '10'; timeline.value = '0'; timeline.disabled = true; timeline.setAttribute('aria-label', 'Čas efektu (ms)');
  const field = (title, input) => { const label = element('label', title + ' '); input.setAttribute('aria-label', title); label.append(input); return label; };
  for (const value of [.25, .5, 1, 2]) { const option = element('option', `${value}×`); option.value = String(value); speed.append(option); } speed.value = '1';
  const all = element('option', 'Všechny emitory'); all.value = ''; emitter.append(all);
  for (const [i, child] of type.children.entries()) { const option = element('option', `${i + 1} · ${child.name || 'Emitor'}`); option.value = child.id; emitter.append(option); } emitter.value = emitterId ?? '';
  const duration = element('select'); for (const value of [5, 10, 30, 60]) { const option = element('option', `${value} s`); option.value = String(value * 1000); duration.append(option); } duration.value = '10000';
  tools.append(play, restart, fit, field('Rychlost', speed), field('Zobrazit', emitter), field('Délka náhledu', duration));
  const timeRow = element('div', undefined, 'particle-timeline'); timeRow.append(timeline, clock);
  dialog.append(element('h2', `Přehrávání efektu · ${type.name || type.index}`), tools, area, timeRow, message, element('p', 'Náhled uložené definice: dávka a průběžná emise, pohyb, fáze, velikost, průhlednost, rotace a gravitace. Jde o přiblížení původního enginu bez kolizí, prostředí a pohybujícího se rodiče. Animované textury zatím používají první snímek. Limit je 256 současných částic; čas lze vracet i posouvat. Přehrávání nemění herní soubory.', 'notice'), close);
  let view = null, closed = false, playing = false, time = 0, previous = null, lastStatus = -1;
  const update = () => {
    play.textContent = playing ? 'Pozastavit efekt' : 'Přehrát efekt'; timeline.value = String(time); clock.textContent = `${(time / 1000).toFixed(2)} / ${Number(duration.value) / 1000} s`;
    if (view?.simulation) message.textContent = `${view.simulation.particles.length} živých částic${view.simulation.dropped ? ` · dosažen limit náhledu, vynecháno ${view.simulation.dropped}` : ''}${view.textureWarnings?.length ? ' · ' + view.textureWarnings.join(' · ') : ''}`;
  };
  const seek = value => { time = value; previous = null; view.seek(time); update(); };
  play.onclick = () => { if (!view?.simulation) return; if (time >= Number(duration.value)) { view.restart(); time = 0; } playing = !playing; previous = null; update(); };
  restart.onclick = () => { view.restart(); time = 0; previous = null; update(); };
  fit.onclick = () => view.fitParticles();
  emitter.onchange = () => { if (view?.simulation) { view.emitterId = emitter.value; view.sync(); } };
  timeline.oninput = () => { playing = false; seek(Number(timeline.value)); };
  duration.onchange = () => { timeline.max = duration.value; if (view?.simulation) seek(Math.min(time, Number(duration.value))); };
  close.onclick = () => dialog.close();
  dialog.addEventListener('close', () => { closed = true; playing = false; view?.dispose(); view = null; dialog.remove(); }, { once: true });
  document.body.append(dialog); dialog.showModal(); update();
  const resolveTexture = async name => { const key = name.replaceAll('\\', '/').toLowerCase(), asset = assets.find(asset => asset.path.toLowerCase() === `maps/${key}` || asset.path.toLowerCase() === key); return asset ? api.media(asset.path) : null; };
  void (async () => {
    try {
      const name = type.entries.find(entry => entry.key === 'model')?.value, asset = assets.find(asset => asset.path.toLowerCase() === `models/${name?.replace(/\.i3d$/i, '.4ds')}`.toLowerCase());
      if (!asset) throw Error('Model efektu není v projektu.');
      const model = await api.inspect(asset.path); if (closed) return; if (model.type !== 'model') throw Error('Model nemá podporovaný formát.');
      view = new ParticleViewport(area); view.load(model); await view.loadTextures(resolveTexture); if (closed) return;
      view.prepare(type, { direction }); view.emitterId = emitter.value; view.sync();
      view.onFrame = now => {
        if (playing && !document.hidden) {
          if (previous !== null) { time = Math.min(Number(duration.value), time + Math.min(100, Math.max(0, now - previous)) * Number(speed.value)); view.simulation.seek(time); if (time >= Number(duration.value)) playing = false; }
          previous = now;
        } else previous = null;
        view.sync(); if (Math.floor(time / 100) !== lastStatus) { lastStatus = Math.floor(time / 100); update(); }
      };
      play.disabled = restart.disabled = fit.disabled = timeline.disabled = false; update(); play.focus();
    } catch (error) { if (!closed) { view?.dispose(); view = null; message.textContent = 'Náhled nelze spustit: ' + error.message; } }
  })();
}
