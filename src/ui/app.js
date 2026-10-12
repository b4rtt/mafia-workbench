import { categories, groupAssets } from '../shared/categories.js';
import { groupSceneProperties } from '../shared/scene-properties.js';
import { humanFields } from '../shared/human-parameters.js';
import { doorFields } from '../shared/door-parameters.js';
import { lightTypes, lightDefaults, sceneSectors } from '../shared/lights.js';
import { roadGraph, roadEntries, roadReference } from '../shared/roads.js';
import { Viewport } from './viewport.js';
import { AnimationPreview } from './animation.js';
import { NavigationViewport } from './navigation.js';
import { TrackViewport } from './track.js';
import { CutsceneViewport, CutsceneAudio, activeCutsceneAudio } from './cutscene.js';
import { Group } from 'three';
const api = window.workbench;
const $ = id => document.getElementById(id);
const state = { project: null, file: null, category: 'levels', texts: new Map(), textIndex: 0, busy: false, viewport: null };
function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
async function discard() {
  if (!state.texts.size) return true;
  const dialog = $('discard'); dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'discard'), { once: true }));
}
function buttons() {
  for (const id of ['create', 'open']) $(id).disabled = state.busy;
  $('undo').disabled = state.busy || !state.project?.history;
  $('export').disabled = state.busy || !state.project;
  $('new-mission').disabled = state.busy || !state.project;
  $('stop-level').disabled = state.busy;
}
async function run(action) {
  if (state.busy) return;
  state.busy = true; buttons();
  try { await action(); }
  catch (error) { status(error.message, true); }
  finally { state.busy = false; buttons(); }
}
async function refresh(project) {
  state.project = project ?? await api.project();
  if (!state.project) return;
  $('project-name').textContent = state.project.name;
  const modified = state.project.assets.filter(a => a.modified).length;
  $('project-stats').textContent = `${state.project.assets.length.toLocaleString('cs')} souborů · ${modified} upravených`;
  renderCategories(); renderFiles(); buttons();
}
function renderCategories() {
  const scroll = $('categories').scrollLeft;
  const counts = new Map(categories.map(([id]) => [id, 0]));
  for (const file of state.project.assets) { counts.set(file.category, (counts.get(file.category) ?? 0) + 1); if (file.modified) counts.set('changed', counts.get('changed') + 1); }
  counts.set('all', state.project.assets.length);
  $('categories').replaceChildren(...categories.map(([id, label]) => {
    const button = element('button'); button.append(element('span', label), element('small', counts.get(id).toLocaleString('cs')));
    button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(id === state.category));
    button.classList.toggle('selected', id === state.category);
    button.onclick = () => { state.category = id; $('filter').value = ''; renderCategories(); renderFiles(); };
    return button;
  }));
  $('categories').scrollLeft = scroll;
}
function renderFiles() {
  if (!state.project) return;
  const filter = $('filter').value.toLowerCase();
  const files = state.project.assets.filter(a => a.path.toLowerCase().includes(filter) && (state.category === 'all' || (state.category === 'changed' ? a.modified : a.category === state.category)));
  const fragment = document.createDocumentFragment();
  const groups = groupAssets(files);
  for (const { folder, files: group } of groups) {
    const details = element('details', undefined, 'folder'), summary = element('summary', `${folder} (${group.length})`), list = element('div'); let count = 0;
    function fill() {
      const end = Math.min(count + 100, group.length);
      for (; count < end; count++) {
        const file = group[count], button = element('button', file.path.split('/').at(-1)); button.title = `${file.path} · ${file.archive} · ${file.size} bajtů`;
        button.classList.toggle('active', file.path === state.file?.path); button.classList.toggle('modified', file.modified);
        button.onclick = () => run(async () => { if (!await discard()) return; state.texts.clear(); state.textIndex = 0; await openFile(file.path); }); list.append(button);
      }
      if (count < group.length) { const more = element('button', `Dalších ${Math.min(100, group.length - count)} souborů…`, 'load-more'); more.onclick = () => { more.remove(); fill(); }; list.append(more); }
    }
    details.append(summary, list); details.ontoggle = () => { if (details.open && !count) fill(); };
    details.open = groups.length === 1 || Boolean(filter) || group.some(f => f.path === state.file?.path); if (details.open) fill(); fragment.append(details);
  }
  $('file-list').replaceChildren(fragment);
  $('count').textContent = `${files.length.toLocaleString('cs')} SOUBORŮ · ${groups.length} SLOŽEK`;
}
async function openFile(name) { state.file = await api.inspect(name); renderDetail(); renderFiles(); status(`Otevřeno: ${name}`); }
function renderDetail() {
  const file = state.file; if (!file) return;
  const previous = state.viewport;
  const mapView = file.type === 'map' && previous?.mapPath === file.path && previous.projectRoot === state.project.root
    ? { camera: previous.captureCamera(), selectedName: previous.selectedName, mode: previous.gizmo.mode, backdrop: previous.backdrop?.visible, collisions: previous.collisionOverlay?.visible } : null;
  state.viewport?.dispose(); state.viewport = null;
  for (const audio of $('detail').querySelectorAll('audio')) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  const main = $('detail'); main.replaceChildren();
  const badges = { roads: 'ROAD · SILNIČNÍ SÍŤ', difference: 'CHG · OBJEKTY A SKRIPTY', track: 'TCK · POHYBOVÁ STOPA', navigation: 'CHECK · NAVIGACE', items: 'PŘEDMĚTY · ZBRANĚ', textdb: 'TEXTDB · EDITACE', scene: 'SCÉNA · EDITACE', cache: 'CACHE · STATICKÉ MODELY', map: 'MAPA · 3D EDITACE', model: '4DS · 3D EDITACE', animation: '5DS · ANIMACE', image: 'OBRÁZEK · NÁHLED', audio: 'ZVUK · PŘEHRÁVAČ' };
  badges.replay = 'REP · ČASOVÁ OSA';
  const head = element('div', undefined, 'file-header'); head.append(element('h2', file.path), element('span', badges[file.type] ?? 'BINÁRNÍ SOUBOR', 'badge')); main.append(head);
  const source = state.project.assets.find(a => a.path === file.path);
  main.append(element('div', `${file.size.toLocaleString('cs')} bajtů · ${source?.archive} · ${source?.variants ?? 1} variant archivů`, 'file-meta'));
  const toolbar = element('div', undefined, 'tools');
  const restore = element('button', source?.created ? 'Obnovit výchozí verzi' : 'Obnovit originál');
  restore.onclick = () => run(async () => { if (!await discard()) return; state.file = await api.restore(file.path); state.texts.clear(); await refresh(); renderDetail(); status(source?.created ? 'Výchozí verze obnovena; obnovení lze také vrátit.' : 'Originál obnoven; obnovení lze také vrátit.'); });
  const replace = element('button', 'Nahradit souborem…');
  replace.onclick = () => run(async () => { if (!await discard()) return; const replacement = await api.replace(file.path); if (!replacement) return; state.file = replacement; state.texts.clear(); await refresh(); renderDetail(); status('Soubor nahrazen se zálohou.'); });
  toolbar.append(restore, replace); main.append(toolbar);
  if (/^missions\/[^/]+\//i.test(file.path)) {
    const launch = element('button', 'Spustit level', 'primary');
    launch.onclick = () => run(async () => {
      if (state.texts.size) throw new Error('Před spuštěním levelu uložte rozepsané změny.');
      status('Připravuji oddělenou testovací kopii…');
      const test = await api.startLevel(file.path); $('stop-level').hidden = !test.running;
      status(`Spouštím: ${test.level} · bez videí a menu · oddělené ukládání.`);
    }); toolbar.append(launch);
  }
  if (file.type === 'scene') {
    const map = element('button', 'Otevřít 3D mapu'); map.onclick = () => run(async () => { if (!await discard()) return; state.texts.clear(); status('Načítám geometrii mapy…'); state.file = await api.map(file.path); renderDetail(); status('3D mapa načtená.'); }); toolbar.append(map);
  }
  if (file.type === 'textdb') renderTexts(main, file);
  else if (file.type === 'items') renderItems(main, file);
  else if (file.type === 'navigation') renderNavigation(main, file);
  else if (file.type === 'roads') renderRoads(main, file);
  else if (file.type === 'track') renderTrack(main, file);
  else if (file.type === 'difference') renderDifference(main, file);
  else if (file.type === 'replay') renderReplay(main, file);
  else if (file.type === 'scene') renderProperties(main, file, api.saveScene);
  else if (file.type === 'cache') renderCache(main, file);
  else if (file.type === 'model') renderModel(main, file);
  else if (file.type === 'map') renderMap(main, file, mapView);
  else if (file.type === 'animation') renderAnimation(main, file);
  else if (file.type === 'image' || file.type === 'audio') renderMedia(main, file);
  else {
    if (file.warning) main.append(element('p', file.warning, 'notice'));
    main.append(element('p', 'Tento formát zatím nemá specializovaný editor. Můžete importovat upravený soubor z externího nástroje. Uloží se do modu se zálohou; původní kopie zůstane zachovaná.', 'notice'));
    const bytes = file.hex.match(/../g) ?? []; let rows = '';
    for (let offset = 0; offset < bytes.length; offset += 16) {
      const row = bytes.slice(offset, offset + 16);
      rows += offset.toString(16).padStart(8, '0') + '  ' + row.join(' ').padEnd(47) + '  ' + row.map(b => { const c = parseInt(b, 16); return c >= 32 && c <= 126 ? String.fromCharCode(c) : '.'; }).join('') + '\n';
    }
    main.append(element('pre', rows, 'binary'));
  }
}
function renderReplay(main, file) {
  main.append(element('p', `${file.tracks.length} objektových stop · ${file.cameras.length} klíčů kamery · ${file.focus.length} klíčů cíle · ${file.duration} ms. Modrá: kamera, zelená: její cíl. Po načtení mise a CHG lze přehrávat dostupné modely, 5DS animace, zvukové události a dialogy. Přímočaré skriptové události z CHG přepínají viditelnost objektů. Kamera a pohyb mezi klíči jsou lineární; ostatní skripty, herní světla, morfování a pohybové TCK náhled nesimuluje.`, 'notice'));
  for (const warning of file.warnings.slice(0,10)) main.append(element('p',warning,'notice'));
  main.append(element('p', `${file.clockCount} záznamů mapování času · ${file.fadeCount} efektů obrazu · ${file.opaqueKeyBytes.toLocaleString('cs')} nerozpoznaných bajtů objektových klíčů. Počty, pořadí, typy klíčů, časování pohybu a neznámá data se zachovají. Časy skriptových, zvukových a dialogových událostí lze změnit při zachování jejich pořadí.`, 'muted'));
  const layout = element('div',undefined,'model-workspace'), center = element('section',undefined,'model-center'), inspector = element('section',undefined,'model-inspector'); layout.append(center,inspector);main.append(layout);
  const contextTools=element('div',undefined,'tools'),mission=element('select'),difference=element('select'),load=element('button','Načíst scénu'),closeContext=element('button','Pouze dráhy'),contextInfo=element('p','Vyberte misi a rozdíly scény CHG. Odkazy ve skriptech slouží jako návrh výběru.','muted');
  mission.setAttribute('aria-label','Mise pro náhled cutscény');difference.setAttribute('aria-label','CHG pro náhled cutscény');
  mission.append(element('option','Vyberte misi…'));mission.firstChild.value='';difference.append(element('option','Bez CHG'));difference.firstChild.value='';
  for(const asset of state.project.assets.filter(a=>/^missions\/[^/]+\/scene2\.bin$/i.test(a.path))){const option=element('option',asset.path.split('/')[1]);option.value=asset.path;mission.append(option);}
  for(const asset of state.project.assets.filter(a=>/\.chg$/i.test(a.path))){const option=element('option',asset.path);option.value=asset.path;difference.append(option);}
  state.replayContexts??=new Map();const savedContext=state.replayContexts.get(file.path);if(savedContext){mission.value=savedContext.scene;difference.value=savedContext.difference;}
  let chosen=Boolean(savedContext);mission.onchange=difference.onchange=()=>{chosen=true;};closeContext.hidden=true;
  contextTools.append(mission,difference,load,closeContext);center.append(contextTools,contextInfo);
  const tools = element('div',undefined,'tools'), play = element('button','Přehrát dráhy'), fit = element('button','Zarámovat dráhy'), fitShot = element('button','Zarámovat záběr'), film=element('input'),sound=element('input'),filmLabel=element('label','Kamera cutscény '),soundLabel=element('label','Zvuk '),subtitle=element('p',undefined,'notice'), seek = element('input'), clock = element('output'), timeline = element('canvas'), viewport = element('div',undefined,'viewport');
  film.type=sound.type='checkbox';film.disabled=sound.disabled=true;sound.checked=true;film.setAttribute('aria-label','Kamera cutscény');sound.setAttribute('aria-label','Zvuk cutscény');filmLabel.append(film);soundLabel.append(sound);subtitle.setAttribute('aria-label','Dialog cutscény');
  seek.type='range';seek.min='0';seek.max=String(file.duration);seek.step='1';seek.value='0';seek.setAttribute('aria-label','Čas náhledu REP v ms');play.disabled=!file.duration;timeline.width=800;timeline.height=64;timeline.style.width='100%';timeline.setAttribute('aria-label','Časová osa vybraného kanálu REP; kliknutí vybere nejbližší klíč');
  tools.append(play,fit,fitShot,filmLabel,soundLabel);center.append(tools,seek,clock,timeline,viewport,subtitle);const view=new CutsceneViewport(viewport);state.viewport=view;view.loadReplay(file);
  const channels=structuredClone(file.channels), channel=element('select'), number=element('input'), choose=element('button','Vybrat záznam'), recordInfo=element('p',undefined,'muted'), fields=element('div'), keyTools=element('div',undefined,'tools');
  channel.setAttribute('aria-label','Kanál časové osy REP');for(const c of channels){const option=element('option',`${c.label} (${c.records.length})`);option.value=c.id;channel.append(option);}channel.value=channels.some(c=>c.id===state.replayChannel)?state.replayChannel:'camera';
  number.type='number';number.step='1';number.min='0';number.setAttribute('aria-label','Číslo záznamu REP');number.value=String(state.replayIndex??0);keyTools.append(number,choose);inspector.append(channel,keyTools,recordInfo,fields);
  let playing=false,previous,duration=file.duration;
  const selectedChannel=()=>channels.find(c=>c.id===channel.value);
  function draw() {const ctx=timeline.getContext('2d');ctx.clearRect(0,0,800,64);ctx.fillStyle='#88929c';ctx.fillRect(0,30,800,1);const length=Math.max(duration,1);for(const r of selectedChannel().records){ctx.fillStyle=r.index===Number(number.value)?'#007aff':'#8396a8';ctx.fillRect(r.time/length*796,20,3,22);}ctx.fillStyle='#dc8025';ctx.fillRect(view.time/length*796,5,2,50);}
  function pause(){playing=false;previous=undefined;play.textContent=view.contextReady?'Přehrát cutscénu':'Přehrát dráhy';view.audio?.sync(view.time,false);}
  function show(time){view.seek(time);view.audio?.sync(time,playing);seek.value=String(time);clock.textContent=`${Math.round(time)} / ${duration} ms`;if(view.audio)subtitle.textContent=activeCutsceneAudio(view.audio.events,view.audio.durations,time).filter(e=>e.text).map(e=>e.text).join(' · ');draw();}
  function selectKey(index) {
    pause();const c=selectedChannel();number.max=String(Math.max(0,c.records.length-1));index=Math.min(Math.max(0,index),Math.max(0,c.records.length-1));number.value=String(index);state.replayChannel=c.id;state.replayIndex=index;fields.replaceChildren();const r=c.records[index];choose.disabled=!r;number.disabled=!r;
    if(!r){recordInfo.textContent='Kanál je prázdný.';show(0);return;}
    const info=file.events[c.id]?.[index]??(c.id.startsWith('objects/')?file.tracks[Number(c.id.split('/')[1])].keys[index]:null);recordInfo.textContent=`${r.label} · ${r.time} ms${info ? ` · ${JSON.stringify(info)}` : ''}`;show(r.time);
    renderProperties(fields,{...file,entries:file.entries.filter(e=>e.id.startsWith(r.prefix))},api.saveReplay,(entry,value)=>{pause();view.updateEntry(entry.id,value);if(entry.id.endsWith('/time')&&Number.isInteger(value)&&value>=0&&value<=0xffffffff){r.time=value;duration=Math.max(file.duration,...channels.map(c=>c.records.reduce((max,key)=>Math.max(max,key.time),0)));seek.max=String(duration);play.disabled=!duration;draw();}});
  }
  channel.onchange=()=>selectKey(0);choose.onclick=()=>{const index=Number(number.value);if(number.value!==''&&Number.isInteger(index)&&index>=0&&index<selectedChannel().records.length)selectKey(index);else status('Číslo záznamu je mimo rozsah.',true);};
  timeline.onclick=event=>{const c=selectedChannel();if(!c.records.length)return;const box=timeline.getBoundingClientRect(),time=(event.clientX-box.left)/box.width*duration;let nearest=c.records[0];for(const r of c.records)if(Math.abs(r.time-time)<Math.abs(nearest.time-time))nearest=r;selectKey(nearest.index);};
  const orbit=()=>{film.checked=false;view.cameraMode(false);};
  seek.oninput=()=>{pause();show(Number(seek.value));};fit.onclick=()=>{orbit();view.fit(view.paths);};fitShot.onclick=()=>{orbit();view.fitShot();};film.onchange=()=>view.cameraMode(film.checked);sound.onchange=()=>view.audio?.mute(!sound.checked);
  play.onclick=async()=>{if(playing)pause();else{try{await view.audio?.unlock();}catch(error){status('Zvuk nelze spustit: '+error.message,true);}if(view.disposed)return;if(view.time>=duration)show(0);playing=true;previous=undefined;play.textContent=view.contextReady?'Pozastavit cutscénu':'Pozastavit dráhy';show(view.time);}};
  closeContext.onclick=()=>run(async()=>{if(state.texts.size)throw new Error('Nejdřív uložte rozepsané změny.');pause();renderDetail();});
  load.onclick=()=>run(async()=>{
    if(state.texts.size)throw new Error('Před načtením scény uložte rozepsané změny.');if(!mission.value)throw new Error('Vyberte misi pro cutscénu.');
    pause();load.disabled=true;mission.disabled=difference.disabled=true;closeContext.hidden=false;contextInfo.textContent='Načítám scénu, modely, animace a zvuky…';
    try{
      const context=await api.replayContext(file.path,mission.value,difference.value||null);if(view.disposed)return;
      state.replayContexts.set(file.path,{scene:mission.value,difference:difference.value});
      const result=await view.loadContext(context,name=>api.inspect(name),async texture=>{const name=texture.replaceAll('\\','/').toLowerCase(),asset=state.project.assets.find(a=>a.path.toLowerCase()===`maps/${name}`||a.path.toLowerCase()===name);return asset?api.media(asset.path):null;});if(view.disposed)return;
      view.audio=new CutsceneAudio();await view.audio.load(context.audio,name=>api.media(name));if(view.disposed)return;
      film.disabled=sound.disabled=false;film.checked=true;view.cameraMode(true);play.textContent='Přehrát cutscénu';show(view.time);
      contextInfo.textContent=`${result.actors}/${result.tracks} navázaných stop · ${result.animations} animací · ${view.audio.buffers.size} zvuků. ${result.warnings.length} upozornění na data a vazby · ${view.audio.errors.length} nedekódovaných zvuků. Zvuk je bez prostorového útlumu a opakování; hudba spouštěná skriptem se nepřehrává.`;
      const details=element('details'),summary=element('summary','Podrobnosti náhledu');details.append(summary,element('pre',[...result.warnings,...view.audio.errors.map(p=>'Nelze dekódovat zvuk: '+p)].join('\n')||'Všechny načítané zdroje jsou dostupné.'));center.append(details);status('Náhled cutscény připraven.');
    }catch(error){contextInfo.textContent=error.message+' Pro nový výběr zavřete náhled tlačítkem „Pouze dráhy“.';throw error;}
  });
  api.replayMissions(file.path).then(matches=>{if(view.disposed||chosen)return;if(matches.length===1){mission.value=matches[0].path;if(matches[0].differences.length===1)difference.value=matches[0].differences[0];contextInfo.textContent='Mise nalezená podle doslovného odkazu na REP ve skriptu. CHG lze změnit před načtením.';}else if(matches.length>1)contextInfo.textContent=`REP se objevuje v ${matches.length} misích; vyberte odpovídající scénu.`;}).catch(error=>{if(!view.disposed)contextInfo.textContent=error.message;});
  view.onFrame=time=>{if(!playing)return;const next=Math.min(duration,view.time+(previous===undefined?0:time-previous));previous=time;show(next);if(next>=duration)pause();};selectKey(Number(number.value));
}
function renderDifference(main, file) {
  main.append(element('p', `${file.blocks} bloků · ${file.objects.length} objektů · ${file.actors.length} popisů aktérů · ${file.bindings.length} vazeb. Lze upravit transformace a existující skripty. Přidávání objektů a data aktérů zatím nejsou podporované. Tento CHG lze připojit k náhledu REP pro přehrávání cutscény.`, 'notice'));
  const summary = element('details'), title = element('summary','Objekty a vazby (jen ke čtení)'); summary.append(title);
  for (const object of file.objects) summary.append(element('p',`${object.index}: ${object.name} · typ ${object.frameType} · rodič ${object.parent || '—'}${object.resource ? ` · zdroj ${object.resource}` : ''}`));
  for (const binding of file.bindings) summary.append(element('p',`${binding.index}: vazba na ${binding.name} · typ aktéra ${binding.kind}`));
  main.append(summary,element('p',`${file.opaqueBytes.toLocaleString('cs')} nerozpoznaných bajtů se při uložení zachová přesně. Jména a vazby se zobrazují pro orientaci; rotace se upravuje v původním pořadí W, X, Y, Z.`, 'muted'));
  renderProperties(main,file,api.saveDifference);
}
function renderTrack(main, file) {
  main.append(element('p', `TCK verze 4 · ${file.positions.length.toLocaleString('cs')} polohových klíčů · ${file.secondary.length.toLocaleString('cs')} doplňkových vektorů · ${file.duration} ms · krok ${file.step} ms. Náhled lineárně interpoluje dráhu; kostru postavy ani celou cutscénu nepřehrává.`, 'notice'));
  if (file.tailBytes) main.append(element('p', `${file.tailBytes.toLocaleString('cs')} koncových bajtů není rozpoznaných. Při editaci se zachovají přesně.`, 'notice'));
  main.append(element('p', `Hlavička, vektor A (raw): ${JSON.stringify(file.headerVectors[0])} · vektor B (raw): ${JSON.stringify(file.headerVectors[1])}. Časování, počty a hlavička zůstávají zachované.`, 'muted'));
  const layout = element('div', undefined, 'model-workspace'), center = element('section', undefined, 'model-center'), inspector = element('section', undefined, 'model-inspector'); layout.append(center,inspector); main.append(layout);
  const tools = element('div', undefined, 'tools'), play = element('button','Přehrát dráhu'), fit = element('button','Zarámovat dráhu'), seek = element('input'), clock = element('output'), viewport = element('div',undefined,'viewport');
  seek.type = 'range'; seek.min = '0'; seek.max = String(file.duration); seek.step = '1'; seek.value = '0'; seek.setAttribute('aria-label','Čas náhledu dráhy v ms'); play.disabled = !file.duration;
  tools.append(play,fit); center.append(tools,seek,clock,viewport);
  const view = new TrackViewport(viewport); state.viewport = view; view.loadTrack(file);
  let playing = false, previous;
  function pause() { playing = false; previous = undefined; play.textContent = 'Přehrát dráhu'; }
  function show(time) { view.seek(time); seek.value = String(time); clock.textContent = `${Math.round(time)} / ${file.duration} ms`; }
  play.onclick = () => { if (playing) pause(); else { if (Number(seek.value)>=file.duration) show(0); playing = true; previous = undefined; play.textContent = 'Pozastavit dráhu'; } };
  seek.oninput = () => { pause(); show(Number(seek.value)); }; fit.onclick = () => view.fit(view.path);
  view.onFrame = time => {
    if (!playing) return;
    const next = Math.min(file.duration,view.time+(previous === undefined ? 0 : time-previous)); previous = time; show(next); if (next>=file.duration) pause();
  };
  const keyTools = element('div',undefined,'tools'), number = element('input'), select = element('button','Vybrat klíč'), fields = element('div');
  number.type = 'number'; number.min = '0'; number.max = String(file.positions.length-1); number.step = '1'; number.value = String(Math.min(state.trackIndex??0,file.positions.length-1)); number.setAttribute('aria-label','Číslo klíče TCK'); keyTools.append(number,select); inspector.append(keyTools,fields);
  function editKey(index) {
    pause(); state.trackIndex = index; number.value = String(index); show(index*file.step); fields.replaceChildren();
    const entries = [{id:`positions/${index}`,context:`Klíč ${index} · ${index*file.step} ms`,label:'Poloha XYZ',kind:'vec3',value:file.positions[index]}];
    if (file.secondary.length) entries.push({id:`secondary/${index}`,context:`Klíč ${index} · ${index*file.step} ms`,label:'Doplňkový vektor (raw)',kind:'vec3',value:file.secondary[index]});
    renderProperties(fields,{...file,entries},api.saveTrack,(entry,value)=>{pause(); if (entry.id.startsWith('positions/')) view.updateKey(index,value);});
  }
  select.onclick = () => { const index = Number(number.value); if (number.value!==''&&Number.isInteger(index)&&index>=0&&index<file.positions.length) editKey(index); else status('Číslo klíče je mimo rozsah.',true); };
  editKey(Number(number.value));
}
function renderRoads(main, file) {
  const graph=roadGraph(file);
  main.append(element('p',`${file.crossings.length.toLocaleString('cs')} křižovatek · ${file.nodes.length.toLocaleString('cs')} silničních bodů. Modré body: křižovatky, žluté: silniční body. Čáry zobrazují uložené sousední vazby. Rychlosti jsou v původních herních jednotkách.`, 'notice'));
  main.append(element('p','Lze upravit rychlosti, příznak semaforu, raw priority směrů a typy pruhů. Pozice a vazby jsou zatím pouze ke čtení; změna geometrie vyžaduje i přepočet vzdáleností a seřazení bodů enginem.', 'notice'));
  for(const warning of file.warnings)main.append(element('p',warning,'notice'));
  const layout=element('div',undefined,'model-workspace'),center=element('section',undefined,'model-center'),inspector=element('section',undefined,'model-inspector');layout.append(center,inspector);main.append(layout);
  const tools=element('div',undefined,'tools'),section=element('select'),number=element('input'),jump=element('button','Vybrat bod'),fit=element('button','Zarámovat síť'),focus=element('button','Přiblížit bod'),background=element('button','Zobrazit geometrii mise'),viewport=element('div',undefined,'viewport');
  section.setAttribute('aria-label','Tabulka silniční sítě');
  for(const [value,label] of [['crossings','Křižovatky'],['nodes','Silniční body']]){const option=element('option',label);option.value=value;section.append(option);}
  number.type='number';number.min='0';number.step='1';number.value='0';number.setAttribute('aria-label','Pořadí silničního bodu');
  const range=()=>{number.max=String(Math.max(0,file[section.value].length-1));};section.onchange=range;range();
  tools.append(section,number,jump,fit,focus,background);center.append(tools,viewport);
  const view=new NavigationViewport(viewport,frame=>{
    const point=graph.points[frame.navigationIndex],record=file[point.section][point.recordIndex];section.value=point.section;number.value=String(point.recordIndex);range();state.roadIndex=point.index;
    inspector.replaceChildren(element('h3',`${point.section==='crossings'?'Křižovatka':'Bod'} ${point.recordIndex}`),element('p',`Pozice XYZ: ${record.position.join(', ')}`,'notice'));
    const bindings=point.section==='crossings'?record.links.map((value,i)=>`Výjezd ${i}: ${roadReference(value)}`):[['Předchozí',record.previous],['Následující',record.next],['Předchozí křižovatka',record.previousCrossing],['Následující křižovatka',record.nextCrossing]].map(([label,value])=>`${label}: ${roadReference(value)}`);
    inspector.append(element('p',bindings.join(' · '),'notice'));
    renderProperties(inspector,{...file,entries:roadEntries(file,point.section,point.recordIndex)},api.saveRoads);
  },()=>{});
  state.viewport=view;view.loadNavigation(graph);focus.disabled=!graph.points.length;
  jump.onclick=()=>{const index=Number(number.value);if(number.value===''||!Number.isInteger(index)||index<0||index>=file[section.value].length)return status('Číslo bodu je mimo rozsah.',true);view.select(String(index+(section.value==='nodes'?file.crossings.length:0)));};
  fit.onclick=()=>view.fit(view.markers);focus.onclick=()=>{if(view.selectedPoint!==null)view.fit(view.proxy);};
  let geometry;
  background.onclick=()=>run(async()=>{
    if(geometry){geometry.visible=!geometry.visible;background.textContent=geometry.visible?'Skrýt geometrii mise':'Zobrazit geometrii mise';return;}
    const model=await api.inspect(file.path.replace(/road\.bin$/i,'scene.4ds'));if(state.file!==file)return;
    if(model.type!=='model')throw new Error(model.warning??'Geometrii mise zatím nelze načíst.');
    geometry=new Group();view.root.add(geometry);
    for(const object of view.addModel(model,geometry,'road-context/').values())object.userData.frame.editable=false;
    geometry.traverse(object=>{object.raycast=()=>{};});
    await view.loadTextures(async texture=>{const path=texture.replaceAll('\\','/').toLowerCase(),asset=state.project.assets.find(a=>a.path.toLowerCase()===`maps/${path}`||a.path.toLowerCase()===path);return asset?api.media(asset.path):null;});
    background.textContent='Skrýt geometrii mise';
  });
  if(graph.points.length)view.select(String(Math.min(state.roadIndex??0,graph.points.length-1)));else inspector.append(element('p','Tato mise nemá silniční síť.','notice'));
}
function renderNavigation(main, file) {
  main.append(element('p', `${file.points.length.toLocaleString('cs')} bodů · ${file.linkCount.toLocaleString('cs')} směrovaných vazeb. Číslo bodu je jeho pořadí od nuly, uložené ID se může opakovat. Modrá: chodci, žlutá: AI, oranžová: vozidla, fialová: zastávky.`, 'notice'));
  main.append(element('p','Uložení posunu přepočítá délky navazujících cest. Při změně pořadí bodů se jejich čísla a odkazy aktualizují společně; vybraný bod zůstane vybraný.','notice'));
  for (const warning of file.warnings.slice(0,10)) main.append(element('p',warning,'notice'));
  const layout = element('div', undefined, 'model-workspace'), center = element('section', undefined, 'model-center'), inspector = element('section', undefined, 'model-inspector'); layout.append(center, inspector); main.append(layout);
  const tools = element('div', undefined, 'tools'), number = element('input'), jump = element('button', 'Vybrat bod'), fit = element('button', 'Zarámovat síť'), focus = element('button', 'Přiblížit bod'), background = element('button', 'Zobrazit geometrii mise'), viewport = element('div', undefined, 'viewport');
  number.type = 'number'; number.min = '0'; number.max = String(Math.max(0,file.points.length-1)); number.step = '1'; number.value = '0'; number.setAttribute('aria-label','Číslo navigačního bodu'); focus.disabled = !file.points.length;
  tools.append(number,jump,fit,focus,background); center.append(tools,viewport);
  const addPoint=element('button','Přidat bod…'),deletePoint=element('button','Odstranit bod');deletePoint.disabled=!file.points.length;tools.append(addPoint,deletePoint);
  async function changePoint(request){
    if(state.texts.size)throw new Error('Před změnou bodů uložte nebo zahoďte rozepsané vlastnosti.');
    const result=await api.changeNavigationPoint(file.path,request,file.sha256);state.file=result.file;state.navigationIndex=Math.max(0,result.index);await refresh();renderDetail();status('Navigační body a odkazy segmentů uložené společně se zálohou a undo.');
  }
  addPoint.onclick=()=>run(async()=>{
    if(state.texts.size)throw new Error('Před přidáním bodu uložte nebo zahoďte rozepsané vlastnosti.');
    const dialog=element('dialog'),fields=element('div',undefined,'mission-fields'),type=element('select'),create=element('button','Přidat bod','primary'),cancel=element('button','Zrušit'),actions=element('div',undefined,'tools');
    const coordinates=['X','Y','Z'].map((axis,i)=>{const label=element('label',`Pozice ${axis}`),input=element('input');input.type='number';input.step='any';input.value=String(file.points[state.navigationIndex]?.position[i]??0);input.setAttribute('aria-label',`Pozice nového bodu ${axis}`);label.append(input);fields.append(label);return input;});
    type.setAttribute('aria-label','Kategorie nového navigačního bodu');for(const [value,label] of [[1,'Chodci'],[2,'AI'],[4,'Vozidla'],[8,'Zastávky']]){const option=element('option',label);option.value=String(value);type.append(option);}
    actions.append(cancel,create);dialog.append(element('h3','Nový navigační bod'),fields,element('p','Kategorie'),type,element('p','Nový bod nemá spoje. Po přidání ho můžete připojit k síti tlačítkem Propojit body.','notice'),actions);main.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});cancel.onclick=()=>dialog.close();
    create.onclick=()=>run(async()=>{if(coordinates.some(input=>input.value===''))throw new Error('Vyplňte všechny tři souřadnice.');await changePoint({action:'add',position:coordinates.map(input=>Number(input.value)),type:Number(type.value)});});dialog.showModal();coordinates[0].focus();
  });
  deletePoint.onclick=()=>run(()=>changePoint({action:'delete',index:state.navigationIndex}));
  let properties;
  let pickingTarget = false;
  const target = element('input'), direction = element('select'), pickTarget = element('button','Vybrat cíl ve 3D');
  target.type='number';target.min='0';target.max=number.max;target.step='1';target.setAttribute('aria-label','Cílový bod spojení');
  direction.setAttribute('aria-label','Směr nového spojení');
  for(const [value,label] of [['both','Obousměrně'],['forward','Vybraný bod → cíl'],['backward','Cíl → vybraný bod']]){const option=element('option',label);option.value=value;direction.append(option);}
  pickTarget.onclick=()=>{pickingTarget=!pickingTarget;pickTarget.textContent=pickingTarget?'Zrušit výběr cíle':'Vybrat cíl ve 3D';status(pickingTarget?'Klikněte na druhý navigační bod.':'Výběr cíle zrušen.');};
  function entries(point) {
    const context = `Bod ${point.index} · uložené ID ${point.id}`;
    const result = [['position','Pozice XYZ','vec3'],['type','Typ / příznaky','uint16'],['id','Uložené ID','uint16'],['areaSize','Velikost oblasti (raw)','uint16']].map(([key,label,kind])=>({id:`points/${point.index}/${key}`,context,label,kind,value:point[key]}));
    for (const link of point.links) for (const [key,label] of [['target','Cílový bod (pořadí)'],['type','Typ vazby / příznaky']]) result.push({id:`links/${link.index}/${key}`,context:`Bod ${point.index} → ${link.target} · vazba ${link.index}`,label,kind:'uint16',value:link[key]});
    return result;
  }
  const view = new NavigationViewport(viewport, frame => {
    if(pickingTarget){if(frame.navigationIndex===state.navigationIndex){status('Vyberte jiný bod než začátek spojení.',true);return;}target.value=String(frame.navigationIndex);pickingTarget=false;pickTarget.textContent='Vybrat cíl ve 3D';view.select(String(state.navigationIndex));status(`Cílový bod: ${target.value}`);return;}
    const point = file.points[frame.navigationIndex]; number.value = String(point.index); state.navigationIndex = point.index; inspector.replaceChildren();
    if(target.value===''||Number(target.value)===point.index)target.value=String(point.links[0]?.target??(point.index+1)%file.points.length);
    const connections=element('div',undefined,'tools'),connect=element('button','Propojit body'),disconnect=element('button','Odpojit body');
    connections.append(target,pickTarget,direction,connect,disconnect);
    inspector.append(element('h3',`Spojení bodu ${point.index}`),connections,element('p','Nové spojení respektuje kategorie bodů a vzdálenost. Jednosměrná cesta uloží i protější blokovanou vazbu; odpojení odstraní oba směry.','notice'));
    for(const [button,action] of [[connect,'connect'],[disconnect,'disconnect']])button.onclick=()=>run(async()=>{
      if(state.texts.size)throw new Error('Před změnou spojení uložte nebo zahoďte rozepsané vlastnosti.');
      if(target.value==='')throw new Error('Vyberte cílový bod spojení.');
      state.file=await api.changeNavigationConnection(file.path,{action,from:point.index,to:Number(target.value),direction:direction.value},file.sha256);
      await refresh();renderDetail();status(action==='connect'?'Body propojené v modu se zálohou.':'Body odpojené v modu se zálohou.');
    });
    properties = renderProperties(inspector,{...file,entries:entries(point)},api.saveNavigation,(entry,value)=>{
      const [section,index,key] = entry.id.split('/');
      if (section === 'points' && key === 'position' && Array.isArray(value) && value.length === 3 && value.every(n=>typeof n==='number'&&Number.isFinite(n))) view.updatePoint(Number(index),value);
      if (section === 'points' && key === 'type' && Number.isInteger(value) && value>=0 && value<=65535) view.setType(Number(index),value);
      if (section === 'links' && key === 'target' && Number.isInteger(value) && value>=0 && value<file.points.length) view.updateTarget(Number(index),value);
    });
  }, (frame,values) => {
    const id = `points/${frame.navigationIndex}/position`, original = file.points[frame.navigationIndex].position;
    if (JSON.stringify(values.position) === JSON.stringify(original)) state.texts.delete(id); else state.texts.set(id,values.position);
    view.updatePoint(frame.navigationIndex,values.position); properties?.select(id); status('Posun navigačního bodu je rozepsaný; uložte změny.');
  });
  state.viewport = view; view.loadNavigation(file);
  jump.onclick = () => { const index = Number(number.value); if (number.value !== '' && Number.isInteger(index) && index>=0 && index<file.points.length) view.select(String(index)); else status('Číslo bodu je mimo rozsah.',true); };
  fit.onclick = () => view.fit(view.markers); focus.onclick = () => { if (view.selectedPoint !== null) view.fit(view.proxy); };
  let geometry;
  background.onclick = () => run(async()=>{
    if (geometry) { geometry.visible = !geometry.visible; background.textContent = geometry.visible ? 'Skrýt geometrii mise' : 'Zobrazit geometrii mise'; return; }
    const model = await api.inspect(file.path.replace(/check\.bin$/i,'scene.4ds')); if (state.file !== file) return;
    if (model.type !== 'model') throw new Error(model.warning ?? 'Geometrii mise zatím nelze načíst.');
    geometry = new Group(); view.root.add(geometry);
    for (const object of view.addModel(model,geometry,'nav-context/').values()) object.userData.frame.editable = false;
    geometry.traverse(object=>{object.raycast=()=>{};});
    await view.loadTextures(async texture=>{const path=texture.replaceAll('\\','/').toLowerCase(),asset=state.project.assets.find(a=>a.path.toLowerCase()===`maps/${path}`||a.path.toLowerCase()===path);return asset?api.media(asset.path):null;});
    background.textContent = 'Skrýt geometrii mise';
  });
  if (file.points.length) view.select(String(Math.min(state.navigationIndex ?? 0,file.points.length-1)));
  else inspector.append(element('p','Tato mise nemá navigační body.','notice'));
}
function renderItems(main, file) {
  main.append(element('p', `${file.records.length} předmětů · ID odpovídá pořadí záznamu ve hře. Změny se ukládají do modu; neznámé parametry a pořadí zůstávají zachované.`, 'notice'));
  const layout = element('div', undefined, 'items-workspace'), browser = element('section'), form = element('section', undefined, 'item-form');
  const search = element('input'); search.type = 'search'; search.placeholder = 'ID, název nebo model…'; search.setAttribute('aria-label', 'Hledat předměty');
  const scroll = element('div', undefined, 'item-table-scroll'), table = element('table', undefined, 'item-table'), head = element('thead'), header = element('tr'), body = element('tbody');
  for (const text of ['ID', 'Předmět', 'Zásobník', 'Zásoba', 'Poškození']) header.append(element('th', text));
  head.append(header); table.append(head, body); scroll.append(table); browser.append(search, scroll); layout.append(browser, form); main.append(layout);
  const currentValue = entry => state.texts.has(entry.id) ? state.texts.get(entry.id) : entry.value;
  function fill() {
    body.replaceChildren(); const query = search.value.toLowerCase();
    for (const record of file.records) {
      const name = currentValue(record.entries.find(e => e.key === 'name')), model = currentValue(record.entries.find(e => e.key === 'model'));
      if (!`${record.index} ${name} ${model}`.toLowerCase().includes(query)) continue;
      const row = element('tr'); row.classList.toggle('selected', record.index === state.itemIndex);
      row.append(element('td', record.index)); const cell = element('td'), button = element('button', name || '(bez názvu)');
      button.setAttribute('aria-label', `Předmět ${record.index}: ${name}`); button.onclick = () => { if (!state.busy) edit(record); }; cell.append(button); row.append(cell);
      for (const key of ['magazine', 'reserve', 'damage']) { const value = currentValue(record.entries.find(e => e.key === key)); row.append(element('td', value?.invalid ? '…' : value)); }
      body.append(row);
    }
  }
  function edit(record) {
    state.itemIndex = record.index; state.viewport?.dispose(); state.viewport = null; form.replaceChildren();
    form.append(element('h3', `ID ${record.index} · ${record.name}`));
    const fields = element('div', undefined, 'item-fields'), save = element('button', `Uložit změny (${state.texts.size})`, 'primary'); save.disabled = !state.texts.size;
    for (const entry of record.entries) {
      const label = element('label', entry.label), input = element('input'), value = currentValue(entry);
      input.setAttribute('aria-label', `Předmět ${record.index} · ${entry.label}`); input.type = entry.kind === 'string' ? 'text' : 'number';
      if (input.type === 'number') input.step = entry.kind === 'float' ? 'any' : '1';
      input.value = value?.invalid ? value.raw : String(value);
      input.oninput = () => {
        const next = entry.kind === 'string' ? input.value : input.value.trim() === '' ? NaN : Number(input.value);
        if (typeof next === 'number' && !Number.isFinite(next)) { state.texts.set(entry.id, { invalid: true, raw: input.value }); input.setAttribute('aria-invalid', 'true'); }
        else { input.removeAttribute('aria-invalid'); if (next === entry.value) state.texts.delete(entry.id); else state.texts.set(entry.id, next); }
        save.textContent = `Uložit změny (${state.texts.size})`; save.disabled = !state.texts.size; fill();
      };
      label.append(input); fields.append(label);
    }
    save.onclick = () => run(async () => {
      if ([...state.texts.values()].some(v => v?.invalid)) throw new Error('Vyplňte neplatné číselné hodnoty.');
      state.file = await api.saveItems(file.path, [...state.texts].map(([id, value]) => ({ id, value })), file.sha256);
      state.texts.clear(); await refresh(); renderDetail(); status('Zbraně a předměty uložené do modu se zálohou.');
    });
    const preview = element('button', 'Náhled modelu předmětu'), caption = element('p'), container = element('div', undefined, 'viewport item-preview'); container.hidden = true;
    preview.onclick = () => run(async () => {
      const value = currentValue(record.entries.find(e => e.key === 'model'));
      if (typeof value !== 'string' || !value) throw new Error('Tento předmět nemá model.');
      const name = `models/${value.replaceAll('\\', '/').replace(/\.i3d$/i, '.4ds')}`.toLowerCase(), asset = state.project.assets.find(a => a.path.toLowerCase() === name);
      if (!asset) throw new Error(`Model ${value} není v projektu.`);
      const model = await api.inspect(asset.path); if (state.file !== file || state.itemIndex !== record.index) return;
      if (model.type !== 'model') throw new Error(model.warning ?? 'Model zatím nelze zobrazit.');
      state.viewport?.dispose(); container.hidden = false;
      const view = new Viewport(container); state.viewport = view;
      for (const object of view.addModel(model).values()) object.userData.frame.editable = false;
      view.fit(); caption.textContent = asset.path;
      await view.loadTextures(async texture => { const name = texture.replaceAll('\\', '/').toLowerCase(), match = state.project.assets.find(a => a.path.toLowerCase() === `maps/${name}` || a.path.toLowerCase() === name); return match ? api.media(match.path) : null; });
    });
    form.append(fields, element('p', 'Přesnost je uložený koeficient, nikoli procento. Příznaky jsou číselná bitová maska; ID zvuků a animací se nepřekládají odhadem.', 'notice'), save, preview, caption, container); fill();
  }
  search.oninput = fill; edit(file.records[state.itemIndex] ?? file.records[0]);
}
function renderTexts(main, file) {
  const workspace = element('div', undefined, 'text-workspace'), indexPanel = element('div', undefined, 'text-index');
  const search = element('input'); search.type = 'search'; search.placeholder = 'ID nebo část textu…'; search.setAttribute('aria-label', 'Hledat v textech');
  const list = element('div', undefined, 'text-list'), form = element('div', undefined, 'text-form');
  function edit(entry) {
    state.textIndex = entry.index; form.replaceChildren();
    const label = element('label', `Text ID ${entry.id} · záznam ${entry.index + 1}`); label.htmlFor = 'text-value';
    const textarea = element('textarea'); textarea.id = 'text-value'; textarea.value = state.texts.get(entry.index) ?? entry.text;
    textarea.oninput = () => { if (textarea.value === entry.text) state.texts.delete(entry.index); else state.texts.set(entry.index, textarea.value); save.textContent = state.texts.size ? `Uložit ${state.texts.size} změn` : 'Uložit změny'; save.disabled = !state.texts.size; };
    const save = element('button', state.texts.size ? `Uložit ${state.texts.size} změn` : 'Uložit změny', 'primary'); save.disabled = !state.texts.size;
    save.onclick = () => run(async () => {
      state.file = await api.saveTexts(file.path, [...state.texts].map(([index, text]) => ({ index, text })), file.sha256);
      state.texts.clear(); await refresh(); renderDetail(); status('Texty uložené do modu. Změnu lze vrátit.');
    });
    form.append(label, textarea, element('p', `Kódování: ${file.encoding}. ID a nerozpoznané části souboru zůstávají zachované.`), save);
    for (const button of list.children) button.classList.toggle('active', Number(button.dataset.index) === entry.index);
  }
  function fill() {
    const query = search.value.toLowerCase(), fragment = document.createDocumentFragment();
    const matches = file.entries.filter(entry => `${entry.id} ${state.texts.get(entry.index) ?? entry.text}`.toLowerCase().includes(query));
    for (const entry of matches.slice(0, 600)) {
      const button = element('button', `${entry.id} · ${entry.text.replace(/\s/g, ' ').slice(0, 70)}`); button.dataset.index = entry.index;
      button.onclick = () => edit(entry); fragment.append(button);
    }
    list.replaceChildren(fragment);
  }
  search.oninput = fill; fill(); indexPanel.append(search, list); workspace.append(indexPanel, form); main.append(workspace);
  if (file.entries.length) edit(file.entries[state.textIndex] ?? file.entries[0]);
}
function renderProperties(main, file, saveAPI, onEdit = () => {}) {
  const workspace = element('div', undefined, 'text-workspace'), indexPanel = element('div', undefined, 'text-index'), form = element('div', undefined, 'text-form');
  const search = element('input'); search.type = 'search'; search.placeholder = 'Objekt, vlastnost nebo skript…'; search.setAttribute('aria-label', 'Hledat ve scéně');
  const list = element('div', undefined, 'text-list');
  const groups = ['scene','map'].includes(file.type) && !file.cacheSource ? groupSceneProperties(file) : null;
  const expanded = new Set(), rows = new Map(), groupRows = new Map();
  let selected = null, limit = 100;
  function markSelection() {
    for(const [id,button] of rows){const active=id===selected;button.classList.toggle('active',active);button.setAttribute('aria-current',String(active));}
    for(const [id,details] of groupRows)details.classList.toggle('selected',groups.find(group=>group.id===id).entries.some(item=>item.entry.id===selected));
  }
  function edit(entry) {
    selected = entry.id; markSelection();
    form.replaceChildren();
    const label = element('label', `${entry.context} / ${entry.label}`); label.htmlFor = 'scene-value';
    const input = element(entry.doorParameter ? 'input' : 'textarea'); input.id = 'scene-value';
    const draft = state.texts.get(entry.id) ?? entry.value;
    const isString = ['string', 'string8'].includes(entry.kind);
    if(entry.doorParameter){input.type=entry.kind==='boolean'?'checkbox':isString?'text':'number';if(input.type==='number'){input.step='any';input.min='0';if(entry.max!==undefined)input.max=String(entry.max);}if(isString)input.maxLength=15;if(entry.kind==='boolean')input.checked=draft;}
    input.value = draft?.invalid ? draft.raw : entry.kind === 'script' ? draft.code : isString ? draft : JSON.stringify(draft);
    const name = element('input'); name.setAttribute('aria-label', 'Název skriptu'); name.value = entry.kind === 'script' ? draft.name : '';
    name.disabled = Boolean(entry.actorScript);
    function value() { return entry.doorParameter&&entry.kind==='boolean' ? input.checked : entry.kind === 'script' ? { name: name.value, code: input.value } : isString ? input.value : JSON.parse(input.value); }
    function track() {
      try { const next = value(); if (JSON.stringify(next) === JSON.stringify(entry.value)) state.texts.delete(entry.id); else state.texts.set(entry.id, next); save.disabled = !state.texts.size; save.textContent = `Uložit změny (${state.texts.size})`; onEdit(entry, next); status('Rozepsaná úprava.'); }
      catch { state.texts.set(entry.id, { invalid: true, raw: input.value }); save.disabled = false; status('Číselné hodnoty zapisujte jako číslo nebo pole, např. [1, 2, 3].', true); }
    }
    input.oninput = track; name.oninput = track;
    const save = element('button', `Uložit změny (${state.texts.size})`, 'primary'); save.disabled = !state.texts.size;
    save.onclick = () => run(async () => {
      if ([...state.texts.values()].some(v => v?.invalid)) throw new Error('Opravte neplatnou číselnou hodnotu před uložením.');
      state.file = await saveAPI(file.path, [...state.texts].map(([id, value]) => ({ id, value })), file.sha256);
      if(state.file.type==='navigation'&&state.file.navigationMapping)state.navigationIndex=state.file.navigationMapping[state.navigationIndex??0]??0;
      state.texts.clear(); await refresh(); renderDetail(); status('Změny uložené do modu se zálohou.');
    });
    form.append(label); if (entry.kind === 'script') form.append(name); form.append(input, element('p', entry.doorParameter ? 'Nastavení dveří se projeví při novém načtení mise. Úhel je ve stupních, rychlosti ve stupních za sekundu. Otevírání na obě strany volí směr podle postavy, která dveře použije. Název zvuku může být prázdný nebo mít nejvýše 15 bajtů. Závěs, ostatní příznaky a další data zůstanou zachované.' : entry.humanParameter ? `${entry.kind==='byte'?'Celé číslo 0–255.':entry.humanMaximum?'Základní/maximální hodnota vlastnosti. Skripty human_getproperty a human_setproperty pracují s procenty tohoto maxima; např. plné zdraví se ve hře ukáže jako 100 i při jiném maximu.':'Uložený doplňkový parametr chování.'} Ostatní parametry, horní bajty příznaků a skript zůstanou zachované. Změna se projeví při novém načtení mise.` : entry.kind === 'script' ? entry.actorScript ? 'Zdroj skriptového aktéra. Hlavička a další nerozpoznaná data zůstanou zachovaná. Název je svázaný s aktérem; zde se upravuje pouze kód. Změny se projeví při novém načtení mise.' : 'Zdroj skriptu mise. První bajt a další nerozpoznaná data zůstanou zachovaná.' : `Typ: ${entry.kind}. Souřadnice: X, Y, Z; rotace: W, X, Y, Z. Ostatní vlastnosti zůstanou zachované.`), save);
  }
  function fill() {
    const query = search.value.toLowerCase(), fragment = document.createDocumentFragment();
    rows.clear(); groupRows.clear();
    if(groups){
      const matches=groups.map(group=>({...group,entries:group.entries.filter(({entry,label})=>`${group.name} ${entry.context} ${label} ${entry.kind==='script'?entry.value.name:''}`.toLowerCase().includes(query))})).filter(group=>group.entries.length);
      for(const group of matches.slice(0,limit)){
        const details=element('details',undefined,'property-group'),summary=element('summary');
        summary.append(element('span',group.name),element('span',String(group.entries.length),'property-count'));summary.title=group.context;
        details.open=Boolean(query)||expanded.has(group.id);details.append(summary);groupRows.set(group.id,details);
        let populated=false;
        function populate(){if(populated)return;populated=true;const children=element('div');for(const {entry,label} of group.entries){const button=element('button',label);button.title=`${entry.context} / ${entry.label}`;button.onclick=()=>edit(entry);rows.set(entry.id,button);children.append(button);}details.append(children);markSelection();}
        details.ontoggle=()=>{if(details.open){expanded.add(group.id);populate();}else expanded.delete(group.id);};
        if(details.open)populate();fragment.append(details);
      }
      if(matches.length>limit){const more=element('button',`Dalších ${Math.min(100,matches.length-limit)} objektů…`,'load-more');more.onclick=()=>{limit+=100;fill();};fragment.append(more);}
      list.replaceChildren(fragment);markSelection();return;
    }
    for (const entry of file.entries.filter(e => `${e.context} ${e.label} ${e.kind === 'script' ? e.value.name : ''}`.toLowerCase().includes(query)).slice(0, 800)) {
      const button = element('button', `${entry.kind === 'script' ? entry.value.name : entry.context.split(' / ').at(-1)} · ${entry.label}`);
      button.title = `${entry.context} / ${entry.label}`; button.onclick = () => edit(entry); fragment.append(button);
    }
    list.replaceChildren(fragment);
  }
  function select(id){
    const entry=file.entries.find(e=>e.id===id);if(!entry)return;
    if(groups){const index=groups.findIndex(group=>group.entries.some(item=>item.entry.id===id));expanded.add(groups[index].id);limit=Math.max(limit,index+1);if(search.value)search.value='';fill();}
    edit(entry);rows.get(id)?.scrollIntoView({block:'nearest'});
  }
  search.oninput = () => {limit=100;fill();}; fill(); indexPanel.append(search, list); workspace.append(indexPanel, form); main.append(element('p', `${groups?`${groups.length.toLocaleString('cs')} objektů · `:''}${file.entries.length.toLocaleString('cs')} rozpoznaných vlastností. Nerozpoznaná data se zachovají beze změny.`, 'notice'), workspace);
  if (file.entries.length) select((file.entries.find(e => e.kind === 'script') ?? file.entries[0]).id);
  return { select, changed: () => { const entry = file.entries.find(e => e.id === state.selectedProperty); if (entry) edit(entry); } };
}
function renderMedia(main, file) {
  const container = element('div', undefined, 'media-preview'), caption = element('p', 'Načítám náhled…'); main.append(container, caption);
  const media = element(file.type === 'image' ? 'img' : 'audio');
  if (file.type === 'image') { media.alt = file.path; media.onload = () => { caption.textContent = `${media.naturalWidth} × ${media.naturalHeight} px`; }; }
  else { media.controls = true; media.preload = 'metadata'; media.onloadedmetadata = () => { caption.textContent = `Délka: ${Math.floor(media.duration / 60)}:${String(Math.floor(media.duration % 60)).padStart(2, '0')} · Přehrávání se spouští tlačítkem.`; }; }
  media.onerror = () => { caption.textContent = 'Soubor se nepodařilo dekódovat. Originál zůstává zachovaný.'; };
  container.append(media); api.media(file.path).then(url => { if (state.file === file) media.src = url; }).catch(error => { caption.textContent = error.message; });
}
function renderModel(main, file) {
  if (file.meshes.some(mesh => mesh.lods?.some(lod => lod.invalidNormals || lod.invalidUV))) main.append(element('p', 'Model obsahuje neplatné normály nebo souřadnice textur. Náhled používá náhradní hodnoty; původní model zůstává zachovaný.', 'notice'));
  const layout = element('div', undefined, 'model-workspace'), center = element('section', undefined, 'model-center'), inspector = element('section', undefined, 'model-inspector');
  layout.append(center, inspector); main.append(layout);
  const tools = element('div', undefined, 'tools'), viewport = element('div', undefined, 'viewport'), selected = element('p', 'Vyberte objekt ve 3D pohledu nebo podle názvu.'), objects = element('select');
  objects.setAttribute('aria-label', 'Objekt modelu'); objects.append(element('option', 'Vyberte objekt…'));
  for (const mesh of file.meshes) { const option = element('option', `${mesh.id} · ${mesh.name}`); option.value = String(mesh.id); objects.append(option); }
  center.append(tools, objects, selected, viewport);
  let properties;
  const view = new Viewport(viewport, frame => { selected.textContent = `Objekt ${frame.sourceId}: ${frame.name}`; objects.value = String(frame.sourceId); properties?.select(`meshes/${frame.sourceId - 1}/position`); }, (frame, values, mode) => {
    const field = { translate: 'position', rotate: 'rotation', scale: 'scale' }[mode], id = `meshes/${frame.sourceId - 1}/${field}`;
    state.texts.set(id, values[field]); state.selectedProperty = id; properties?.select(id); status('3D úprava je rozepsaná; uložte změny pod pohledem.');
  });
  state.viewport = view;
  for (const [mode, label] of [['translate', 'Posun'], ['rotate', 'Rotace'], ['scale', 'Měřítko']]) { const button = element('button', label); button.onclick = () => view.gizmo.setMode(mode); tools.append(button); }
  const fit = element('button', 'Zarámovat vše'); fit.onclick = () => view.fit();
  const wire = element('button', 'Drátěný pohled'); let wireframe = false; wire.onclick = () => { wireframe = !wireframe; view.wireframe(wireframe); }; tools.append(fit, wire);
  objects.onchange = () => view.select(String(objects.value));
  try { view.addModel(file); view.fit(); }
  catch (error) { status(error.message, true); }
  view.loadTextures(async texture => {
    const path = texture.replaceAll('\\', '/').toLowerCase(), match = state.project.assets.find(a => a.path.toLowerCase() === `maps/${path}` || a.path.toLowerCase() === path);
    return match ? api.media(match.path) : null;
  });
  center.append(element('p', `${file.meshes.length} objektů · ${file.materials.length} materiálů · LOD 0. Animaci přehrajete v kategorii Animace 5DS po výběru tohoto modelu. Morfování zatím není podporované.`, 'notice'));
  properties = renderProperties(inspector, file, api.saveModel, (entry, value) => { const match = /^meshes\/(\d+)\/(position|rotation|scale|culling)$/.exec(entry.id); if (match) view.update(String(Number(match[1]) + 1), { [match[2]]: value }); });
}
function renderAnimation(main, file) {
  const layout = element('div', undefined, 'model-workspace'), center = element('section', undefined, 'model-center'), inspector = element('section', undefined, 'model-inspector');
  layout.append(center, inspector); main.append(layout);
  const tools = element('div', undefined, 'tools'), search = element('input'), models = element('select'), load = element('button', 'Načíst model pro animaci');
  search.type = 'search'; search.value = 'Tommy'; search.placeholder = 'Hledat model…'; search.setAttribute('aria-label', 'Hledat model pro animaci'); models.setAttribute('aria-label', 'Model pro animaci');
  const caption = element('p', `${file.nodes.length} animovaných uzlů · snímky 0–${file.frames}. Vyberte model se shodnými názvy uzlů.`, 'notice');
  const viewport = element('div', undefined, 'viewport'), timeline = element('div', undefined, 'tools');
  const play = element('button', 'Přehrát'), previous = element('button', 'Předchozí snímek'), next = element('button', 'Další snímek'), slider = element('input'), fps = element('input'), frameLabel = element('output');
  slider.type = 'range'; slider.min = '0'; slider.max = String(file.frames); slider.step = '1'; slider.value = '0'; slider.setAttribute('aria-label', 'Snímek animace');
  fps.type = 'number'; fps.min = '1'; fps.max = '120'; fps.value = '25'; fps.setAttribute('aria-label', 'Rychlost náhledu ve snímcích za sekundu');
  const fpsLabel = element('label', 'snímků/s'); fpsLabel.prepend(fps);
  timeline.append(play, previous, next, slider, frameLabel, fpsLabel); tools.append(search, models, load); center.append(tools, caption, viewport, timeline);
  let view, preview, frame = 0, playing = false, lastTime = null;
  function showFrame(value) { frame = Math.max(0, Math.min(file.frames, value)); slider.value = String(Math.round(frame)); frameLabel.textContent = `${Math.round(frame)} / ${file.frames}`; preview?.apply(frame, state.texts); }
  function pause() { playing = false; lastTime = null; play.textContent = 'Přehrát'; }
  function fillModels() {
    const matches = state.project.assets.filter(a => /\.4ds$/i.test(a.path) && a.path.toLowerCase().includes(search.value.toLowerCase()));
    models.replaceChildren(...matches.slice(0, 200).map(asset => { const option = element('option', asset.path); option.value = asset.path; return option; }));
    load.disabled = !matches.length;
    if (matches.length > 200) caption.textContent = 'Zobrazeno prvních 200 modelů. Zpřesněte hledání.';
    else if (!preview) caption.textContent = `${file.nodes.length} animovaných uzlů · snímky 0–${file.frames}. Vyberte model se shodnými názvy uzlů.`;
  }
  search.oninput = fillModels; fillModels(); showFrame(0); for (const button of [play, previous, next, slider]) button.disabled = true;
  load.onclick = () => run(async () => {
    const model = await api.inspect(models.value); if (state.file !== file) return;
    if (model.type !== 'model') throw new Error(model.warning ?? 'Model není podporovaný.');
    pause(); view?.dispose(); view = new Viewport(viewport); state.viewport = view;
    const frames = view.addModel(model); preview = new AnimationPreview(frames, file); view.fit(); showFrame(0);
    // The preview has no transform gizmo: scrubbing never writes a game file.
    view.onSelect = selected => { caption.textContent = `Uzel modelu: ${selected.name}`; };
    view.select = id => { const object = view.frames.get(id); if (object) view.onSelect(object.userData.frame); };
    view.onFrame = time => {
      if (!playing) return;
      if (lastTime !== null) showFrame((frame + (time - lastTime) / 1000 * Math.max(1, Math.min(120, Number(fps.value) || 25))) % (file.frames + 1));
      lastTime = time;
    };
    for (const button of [play, previous, next, slider]) button.disabled = !preview.matches.length; play.disabled ||= file.frames === 0;
    caption.textContent = `${preview.matches.length}/${file.nodes.length} uzlů propojeno s ${model.path}.` + (preview.unmatched.length ? ` Chybí nebo jsou nejednoznačné: ${preview.unmatched.slice(0, 8).join(', ')}${preview.unmatched.length > 8 ? '…' : ''}.` : '') + (view.skinWarnings.length ? ` Nepodporované váhy: ${view.skinWarnings.join(', ')}; tyto části zůstávají statické.` : '') + (model.meshes.some(m => [3,5].includes(m.visual)) ? ' Morfování není podporované.' : '');
    await view.loadTextures(async texture => {
      const name = texture.replaceAll('\\', '/').toLowerCase(), match = state.project.assets.find(a => a.path.toLowerCase() === `maps/${name}` || a.path.toLowerCase() === name);
      return match ? api.media(match.path) : null;
    });
  });
  play.onclick = () => { if (playing) pause(); else { playing = true; lastTime = null; play.textContent = 'Pozastavit'; } };
  slider.oninput = () => { pause(); showFrame(Number(slider.value)); };
  previous.onclick = () => { pause(); showFrame(Math.round(frame) - 1); }; next.onclick = () => { pause(); showFrame(Math.round(frame) + 1); };
  renderProperties(inspector, file, api.saveAnimation, () => showFrame(frame));
}
function renderCache(main, file) {
  main.append(element('p', `${file.parts.length} částí města · ${file.parts.reduce((sum, part) => sum + part.objects.length, 0)} statických modelů. Vyberte část pro 3D editaci rozmístění modelů.`));
  const tools = element('div', undefined, 'tools'), parts = element('select'), preview = element('button', 'Otevřít část ve 3D');
  parts.setAttribute('aria-label', 'Část města v cache.bin');
  for (const part of file.parts) { const option = element('option', `${part.name} · ${part.objects.length} modelů`); option.value = part.id; parts.append(option); }
  preview.disabled = !file.parts.length;
  preview.onclick = () => run(async () => {
    if (!await discard()) return;
    const part = file.parts.find(p => p.id === parts.value);
    if (part.objects.length > 500) throw new Error('Tato část má přes 500 modelů; její 3D náhled zatím není podporovaný. Vlastnosti lze upravit v seznamu.');
    state.texts.clear(); state.file = { ...file, type: 'map', cacheSource: true, geometry: { meshes: [], materials: [] }, objects: part.objects, entries: file.entries.filter(e => e.id.startsWith(part.id + '/')) }; renderDetail();
  });
  tools.append(parts, preview); main.append(tools); renderProperties(main, file, api.saveCache);
}
function renderMap(main, file, previous = null) {
  const layout = element('div', undefined, 'model-workspace'), center = element('section', undefined, 'model-center'), inspector = element('section', undefined, 'model-inspector'); layout.append(center, inspector); main.append(layout);
  const tools = element('div', undefined, 'tools'), viewport = element('div', undefined, 'viewport'), selected = element('p', 'Vyberte objekt mapy.'), objects = element('select'); objects.setAttribute('aria-label', 'Objekt mapy'); objects.append(element('option', 'Vyberte objekt…')); center.append(tools, objects, selected, viewport);
  let properties, selectedObject, selectedId, selectedFrame;
  const add = element('button', 'Vložit model…'), addHuman=element('button','Přidat postavu…'), addCar=element('button','Přidat auto…'), duplicate = element('button', 'Duplikovat…'), remove = element('button', 'Odstranit…'), focus = element('button', 'Zarámovat objekt'), collision=element('button','Kolize modelu…');
  duplicate.disabled = remove.disabled = focus.disabled = collision.disabled = true;
  const addDoor=element('button','Vytvořit dveře…'),addLight=element('button','Přidat světlo…');addDoor.disabled=true;
  const view = new Viewport(viewport, frame => {
    const object = frame.sceneObject; selected.textContent = object ? object.name : `${frame.name} · geometrie ve scene.4ds`;
    selectedObject = object;
    selectedFrame=frame;
    selectedId = frame.id;
    cameraMoved = true;
    view.selectedName = object?.name ?? frame.name;
    const independent = object && [2,6,9].includes(object.frameType) && !object.actorBound && !file.geometry.meshes.some(mesh => mesh.name.toLowerCase() === object.name.toLowerCase());
    duplicate.disabled = remove.disabled = !independent; focus.disabled = false;
    collision.disabled=!independent||object.frameType!==9||!file.collision||Boolean(file.collision.warning);
    const actorBound=file.entries.some(entry=>entry.label==='Název aktéra'&&entry.value.toLowerCase()===(object?.name??frame.name).toLowerCase());
    addDoor.disabled=Boolean(frame.ownerId)||actorBound||!(object?.frameType===9||frame.type===1&&[0,1].includes(frame.visual));
    if (object) { objects.value = String(frame.id); properties?.select(object.fields.position ?? object.fields.name); }
  }, (frame, values, mode) => {
    const field = { translate: 'position', rotate: 'rotation', scale: 'scale' }[mode], id = frame.sceneObject?.fields[field];
    if (!id) { status('Tato transformace nemá existující vlastnost ve zdrojovém souboru. Zatím ji upravte ve scene.4ds.', true); return; }
    state.texts.set(id, values[field]); properties?.select(id); status('Úprava mapy je rozepsaná. Uložte ji v inspektoru.');
  }); state.viewport = view;
  view.mapPath = file.path; view.projectRoot = state.project.root; view.focusOnSelect = true;
  let cameraMoved = false;
  view.controls.addEventListener('start', () => { cameraMoved = true; });
  if (previous) { view.restoreCamera(previous.camera); view.gizmo.setMode(previous.mode); }
  const overrides = new Map(file.objects.map(object => [object.name.toLowerCase(), object]));
  const byField = new Map();
  function addFields(id, object) { for (const [kind, field] of Object.entries(object.fields)) byField.set(field, { id, kind }); }
  function addOption(id, object) { const option = element('option', object.name); option.value = id; objects.append(option); addFields(id, object); }
  try {
    view.addModel(file.geometry, view.root, '', overrides);
    for (const object of view.frames.values()) {
      const frame = object.userData.frame, sceneObject = frame.sceneObject; frame.editable = Boolean(sceneObject?.fields.position);
      if (sceneObject) addOption(frame.id, sceneObject);
    }
    if (!previous) view.fit();
  } catch (error) { status(error.message, true); }
  const existing = new Set([...view.frames.values()].map(object => object.userData.frame.sceneObject?.id).filter(Boolean)), pending = file.objects.filter(object => !existing.has(object.id) && object.position);
  const modelCache = new Map();
  const resolveTexture = async texture => { const p = texture.replaceAll('\\', '/').toLowerCase(), asset = state.project.assets.find(a => a.path.toLowerCase() === `maps/${p}` || a.path.toLowerCase() === p); return asset ? api.media(asset.path) : null; };
  async function addObjects() {
    for (const object of pending) {
      if (view.disposed) return;
      let model;
      if (object.model) {
        const requested = `models/${object.model.replace(/\.(?:i3d|4ds)$/i, '.4ds')}`.toLowerCase(), asset = state.project.assets.find(a => a.path.toLowerCase() === requested);
        if (asset) {
          if (!modelCache.has(asset.path)) modelCache.set(asset.path, api.inspect(asset.path));
          try { const candidate = await modelCache.get(asset.path); if (candidate.type === 'model') model = candidate; } catch { /* A missing model remains visible as a marker. */ }
        }
      }
      if (view.disposed) return;
      const id = view.addSceneObject(object, model); addOption(id, object);
    }
    const warnings = view.linkScene();
    if (previous?.backdrop) view.showBackdrop(true);
    if (!previous && !cameraMoved) view.fit();
    const selectedName = state.selectSceneName ?? previous?.selectedName;
    if (selectedName) {
      const object = [...view.frames.values()].find(o => (o.userData.frame.sceneObject?.name ?? o.name) === selectedName && !o.userData.frame.ownerId);
      if (object) view.select(object.userData.frame.id, true, false);
      state.selectSceneName = null;
    }
    view.loadTextures(resolveTexture); status(warnings.length ? `3D mapa načtená; ${warnings.length} vazeb má chybějícího nebo nejednoznačného rodiče.` : '3D mapa: geometrie a dostupné objekty načtené.');
  }
  addObjects().catch(error => status(error.message, true));
  for (const [mode, label] of [['translate', 'Posun'], ['rotate', 'Rotace'], ['scale', 'Měřítko']]) { const button = element('button', label); button.onclick = () => view.gizmo.setMode(mode); tools.append(button); }
  const fit = element('button', 'Zarámovat mapu'); fit.onclick = () => { cameraMoved = true; view.fit(); };
  const sky = element('button', 'Obloha'); let showSky = Boolean(previous?.backdrop); sky.setAttribute('aria-pressed', String(showSky)); sky.onclick = () => { showSky = !showSky; view.showBackdrop(showSky); sky.setAttribute('aria-pressed', String(showSky)); };
  tools.append(fit, sky); objects.onchange = () => view.select(objects.value);
  if(file.collision){
    const show=element('button',`Kolizní boxy (${file.collision.boxes.length})`);let visible=Boolean(previous?.collisions);show.setAttribute('aria-pressed',String(visible));
    view.showCollisionBoxes(file.collision.boxes,visible);show.onclick=()=>{visible=!visible;view.showCollisionBoxes(file.collision.boxes,visible);show.setAttribute('aria-pressed',String(visible));};tools.append(show);
    if(file.collision.warning)center.append(element('p',file.collision.warning,'notice'));
  }
  focus.onclick = () => { const object = view.frames.get(selectedId); if (object) { cameraMoved = true; view.fit(object); } };
  tools.append(focus);
  if (!file.cacheSource) {
    for (const [button, kind] of [[add, 'add-model'], [addHuman,'add-human'], [addCar,'add-car'], [duplicate, 'duplicate'], [remove, 'delete'],[collision,'collision']]) button.onclick = () => run(async () => {
      if (state.texts.size) throw new Error('Před změnou seznamu objektů uložte rozepsané vlastnosti.');
      const cars=kind==='add-car'?await api.carModels():null;
      if(cars&&!cars.models.length)throw new Error('Projekt nemá dostupný automobilový model s fyzikální tabulkou a potřebnými částmi.');
      sceneObjectDialog(file, kind, selectedObject,cars);
    });
    addDoor.onclick=()=>run(async()=>{if(state.texts.size)throw new Error('Před vytvořením dveří uložte rozepsané vlastnosti.');if(!selectedFrame)throw new Error('Nejdřív vyberte křídlo dveří.');doorActorDialog(file,selectedFrame);});
    addLight.onclick=()=>run(async()=>{if(state.texts.size)throw new Error('Před vložením světla uložte rozepsané vlastnosti.');lightDialog(file,selectedObject?.position);});
    tools.append(add, addHuman, addCar, addDoor, addLight, duplicate, remove,collision);
  }
  view.loadTextures(resolveTexture);
  properties = renderProperties(inspector, file, file.cacheSource ? api.saveCache : async (...args) => { await api.saveScene(...args); return api.map(file.path); }, (entry, value) => { const field = byField.get(entry.id); if (field && ['position','rotation','scale'].includes(field.kind)) view.update(field.id, { [field.kind]: value }); });
  center.append(element('p', file.cacheSource ? 'Statické modely vybrané části cache.bin. Transformace se ukládají do samostatného modu; oranžové body označují chybějící modely.' : 'Geometrie scene.4ds a objekty scene2.bin. Modré body označují objekty bez modelu; oranžové body chybějící model. Generované kolizní boxy se přepočítají při uložení transformace a vracejí se společně s objektem.', 'notice'));
}
function lightDialog(file,position=[0,0,0]){
  const dialog=element('dialog',undefined,'light-dialog'),form=element('form',undefined,'mission-form'),fields=element('div',undefined,'mission-fields');
  dialog.append(element('h2','Přidat světlo'),element('p','Světlo se uloží do samostatného modu. Vložení lze vrátit jedním krokem.'),form);
  function field(label,input){const row=element('label',label);input.setAttribute('aria-label',label);row.append(input);fields.append(row);return input;}
  function number(label,value,min,max){const input=element('input');input.type='number';input.step='any';input.required=true;input.value=String(value);if(min!==undefined)input.min=String(min);if(max!==undefined)input.max=String(max);return field(label,input);}
  const name=field('Jedinečný název světla',element('input'));name.required=true;name.maxLength=63;name.value='WB_LIGHT';
  const type=field('Typ světla',element('select'));for(const item of lightTypes){const option=element('option',item.label);option.value=String(item.value);type.append(option);}
  const coordinates=['X','Y','Z'].map((axis,i)=>number(`Pozice světla ${axis}`,position[i]));
  const heading=number('Natočení světla kolem Y (stupně)',0),pitch=number('Náklon světla kolem X (stupně)',0);
  const color=field('Barva světla',element('input'));color.type='color';color.value='#ffffff';
  const power=number('Intenzita světla',lightDefaults.power,0),near=number('Vnitřní dosah (herní jednotky)',lightDefaults.range[0],.00000002),far=number('Vnější dosah (herní jednotky)',lightDefaults.range[1],.00000002);
  const inner=number('Vnitřní kužel (stupně)',lightDefaults.cone[0],0,180),outer=number('Vnější kužel (stupně)',lightDefaults.cone[1],0,180),mode=number('Režim světla (číselná maska)',lightDefaults.mode,0,4294967295);mode.step='1';
  const sectors=element('fieldset',undefined,'light-sectors'),legend=element('legend','Osvětlené sektory'),sectorInputs=[];sectors.append(legend);
  for(const sector of sceneSectors(file.objects,file.geometry.meshes)){const input=element('input'),row=element('label',sector);input.type='checkbox';input.checked=sector==='Primary sector';input.setAttribute('aria-label',`Sektor světla ${sector}`);row.append(input);sectors.append(row);sectorInputs.push({name:sector,input});}
  const hint=element('p','','notice');const explain=()=>{hint.textContent=`${Number(type.value)===2?'Reflektor míří podél lokální osy +Z. ':''}Vnější dosah musí být větší než vnitřní. Dosah mlhy a bodového okolního světla používá vlastní jednotky LS3D. Režim je původní číselná maska, její bity zde nepřekládáme. Účinek světla určí hra po načtení mise; 3D pohled zatím používá studiové nasvícení.`;};type.onchange=explain;explain();
  const message=element('p','','notice'),actions=element('div',undefined,'tools'),cancel=element('button','Zrušit'),submit=element('button','Vložit světlo','primary');cancel.type='button';cancel.onclick=()=>dialog.close();submit.type='submit';actions.append(cancel,submit);form.append(fields,sectors,hint,message,actions);
  form.onsubmit=event=>{event.preventDefault();if(!form.reportValidity()||state.busy)return;run(async()=>{submit.disabled=cancel.disabled=true;try{
    const yaw=Number(heading.value)%360*Math.PI/360,x=Number(pitch.value)%360*Math.PI/360,c=Number.parseInt(color.value.slice(1),16);
    const request={kind:'add-light',name:name.value,position:coordinates.map(input=>Number(input.value)),rotation:[Math.cos(yaw)*Math.cos(x),Math.cos(yaw)*Math.sin(x),Math.sin(yaw)*Math.cos(x),-Math.sin(yaw)*Math.sin(x)],parameters:{type:Number(type.value),color:[(c>>16)&255,(c>>8)&255,c&255].map(n=>n/255),power:Number(power.value),range:[Number(near.value),Number(far.value)],cone:[Number(inner.value),Number(outer.value)],mode:Number(mode.value),sectors:sectorInputs.filter(s=>s.input.checked).map(s=>s.name)}};
    state.file=await api.changeSceneObject(file.path,request,file.sha256);state.selectSceneName=name.value;dialog.close();await refresh();renderDetail();status('Světlo vložené do modu se zálohou.');
  }catch(error){message.textContent=error.message;throw error;}finally{submit.disabled=cancel.disabled=false;}});};
  dialog.addEventListener('cancel',event=>{if(state.busy)event.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();name.select();
}
function doorActorDialog(file,frame){
  const target=frame.sceneObject?.name??frame.name,dialog=element('dialog'),form=element('form',undefined,'mission-form'),fields=element('div',undefined,'mission-fields'),inputs=new Map();
  dialog.append(element('h2','Vytvořit dveře'),element('p',`Pohyblivý díl: ${target}. Vyberte samotné křídlo, aby se spolu s dveřmi neotáčel rám nebo okolní budova.`),form);
  for(const field of doorFields){const input=element('input');input.type=field.kind==='boolean'?'checkbox':field.kind==='string'?'text':'number';input.setAttribute('aria-label',field.label);
    if(field.kind==='boolean')input.checked=field.default;else{input.value=String(field.default);if(field.kind==='float'){input.step='any';input.min='0';input.required=true;if(field.max!==undefined)input.max=String(field.max);}else input.maxLength=15;}
    const row=element('label',field.label);row.append(input);fields.append(row);inputs.set(field.key,input);
  }
  const box=file.collision?.boxes.some(box=>box.name.toLowerCase()===target.toLowerCase()),message=element('p','','notice'),actions=element('div',undefined,'tools'),cancel=element('button','Zrušit'),submit=element('button','Vytvořit dveře','primary');
  form.append(fields,element('p',`Hra vytvoří pohyblivou kolizi a určí závěs podle vybraného dílu. ${box?'Generovaný statický box tohoto modelu se odstraní ve stejném kroku. ':''}Původní statické kolize mapy tato akce neupravuje. Aktér i nastavení se uloží do modu s jedním undo.`),message,actions);
  cancel.type='button';cancel.onclick=()=>dialog.close();submit.type='submit';actions.append(cancel,submit);
  form.onsubmit=event=>{event.preventDefault();if(!form.reportValidity()||state.busy)return;run(async()=>{submit.disabled=cancel.disabled=true;try{
    const parameters=Object.fromEntries(doorFields.map(field=>[field.key,field.kind==='boolean'?inputs.get(field.key).checked:field.kind==='string'?inputs.get(field.key).value:Number(inputs.get(field.key).value)]));
    state.file=await api.changeSceneObject(file.path,{kind:'attach-door',target,parameters,collisionHash:file.collision?.sha256},file.sha256);state.selectSceneName=target;dialog.close();await refresh();renderDetail();status('Dveře vytvořeny v modu se zálohou.');
  }catch(error){message.textContent=error.message;throw error;}finally{submit.disabled=cancel.disabled=false;}});};
  dialog.addEventListener('cancel',event=>{if(state.busy)event.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();inputs.get('angle').focus();
}
function sceneObjectDialog(file, kind, object, cars = null) {
  const adding=['add-model','add-human','add-car'].includes(kind);
  if (!adding && !object) throw new Error('Nejdřív vyberte samostatný objekt mapy.');
  const dialog = element('dialog'), form = element('form', undefined, 'mission-form'), fields = element('div', undefined, 'mission-fields');
  const labels = { 'add-model': 'Vložit model do mise', 'add-human':'Přidat postavu do mise','add-car':'Přidat auto do mise', duplicate: 'Duplikovat objekt', delete: 'Odstranit objekt',collision:'Kolize modelu' };
  dialog.append(element('h2', labels[kind]), element('p', kind === 'delete' ? `Odstranit ${object.name}? Změnu lze vrátit tlačítkem Vrátit změnu.` : 'Objekt se uloží do samostatného modu. Uložení lze vrátit jedním krokem.'), form);
  function field(label, input) { const row = element('label', label); row.append(input); fields.append(row); return input; }
  function number(label, value) { const input = element('input'); input.type = 'number'; input.step = 'any'; input.required = true; input.value = String(value); return field(label, input); }
  const name = element('input'); name.required = true; name.maxLength = 63;
  name.value = kind === 'duplicate' ? `${object.name.slice(0,55)}_copy` : kind==='add-human'?'WB_CHARACTER':kind==='add-car'?'WB_CAR':'WB_MODEL';
  if (!['delete','collision'].includes(kind)) field('Jedinečný název objektu', name);
  let model, position, heading, scale, code, collisionMode, collisionMaterial;const parameters=new Map();
  function collisionFields(){
    const existing=file.collision?.boxes.find(box=>box.name===object?.name);collisionMode=element('select');collisionMode.setAttribute('aria-label','Způsob kolize');
    for(const [value,label] of [['none',kind==='collision'?'Odstranit generovanou kolizi':'Bez generované kolize'],['aabb','Automatický box kolem modelu']]){const option=element('option',label);option.value=value;collisionMode.append(option);}collisionMode.value=existing?'aabb':'none';field('Kolize',collisionMode);
    collisionMaterial=number('Materiál kolize (0–255)',existing?.material??0);collisionMaterial.min='0';collisionMaterial.max='255';collisionMaterial.step='1';
    collisionMode.onchange=()=>collisionMaterial.disabled=collisionMode.value==='none';collisionMode.onchange();
  }
  if (adding) {
    const search = element('input'); search.type = 'search'; search.placeholder = 'Hledat model…'; search.setAttribute('aria-label', 'Hledat vkládaný model'); field('Hledat model', search);
    model = element('select'); model.required = true; model.setAttribute('aria-label', 'Vkládaný model'); field('Model 4DS', model);
    const assets = cars?.models??state.project.assets.filter(a => /^models\/[^/]+\.4ds$/i.test(a.path));
    function fillModels() { const previous = model.value; model.replaceChildren(...assets.filter(a => a.path.toLowerCase().includes(search.value.toLowerCase())).slice(0,cars?assets.length:300).map(asset => { const option = element('option', asset.path.slice(7)+(cars?` · ${asset.table}`:'')); option.value = asset.path; return option; })); if ([...model.options].some(o => o.value === previous)) model.value = previous; }
    search.oninput = fillModels; fillModels();
    position = ['X','Y','Z'].map((axis,i) => number(`Pozice ${axis}`, object?.position?.[i] ?? 0));
    heading = number('Natočení kolem Y (stupně)', 0); if(kind!=='add-car')scale = ['X','Y','Z'].map(axis => number(`Měřítko ${axis}`, 1));
    if(kind==='add-model'&&file.collision&&!file.collision.warning)collisionFields();
    form.append(fields, element('p', kind==='add-car'?'Auto se vloží s herním aktérem. Fyziku, sedadla a dynamické kolize načte hra z modelu a tables/vehicles.bin. Měřítko zůstává 1. Umístěte auto na volný povrch; výška Y je v metrech.':kind==='add-human'?'Postava se vloží do hlavního sektoru s vlastním aktérem a skriptem. Vyberte model s kostrou. Navigační body lze upravit v check.bin.':'Model se vloží do hlavního sektoru. Automatický box vyplní celý obal modelu včetně otvorů; pro jednoduché překážky. Kolize se uloží do tree.klz společně s modelem.'));
    if(kind==='add-human'){
      const settings=element('details'),settingsFields=element('div',undefined,'mission-fields');settings.append(element('summary','Parametry postavy'),settingsFields);
      for(const field of humanFields){const input=element('input');input.type='number';input.step=field.kind==='byte'?'1':'any';if(field.kind==='byte'){input.min='0';input.max='255';}input.value=String(field.default);input.required=true;input.setAttribute('aria-label',field.label);const row=element('label',field.label);row.append(input);settingsFields.append(row);parameters.set(field.key,input);}
      code=element('textarea');code.rows=8;code.value='label 1\r\nwait 1000\r\ngoto 1\r\n';code.setAttribute('aria-label','Skript nové postavy');
      form.append(settings,element('label','Skript postavy'),code,element('p','Parametry jsou uložená maxima; human_getproperty a human_setproperty používají procenta. Výchozí skript čeká. Vlastní kód se vykoná při startu mise.','notice'));
    }
  } else { if(kind==='collision')collisionFields();form.append(fields, element('p', kind==='collision'?`${object.name}: box vyplní celý obal modelu včetně otvorů. Odstranění se týká jen kolize vytvořené editorem; původní kolize mapy zachová.`:kind === 'duplicate' ? 'Kopie zachová model, rodiče a transformace a získá vlastní generovanou kolizi, pokud ji má původní objekt.' : 'Skripty, aktéři a původní geometrie se automaticky nepřepisují. Objekty s rozpoznanými vazbami nelze odstranit.')); }
  const message = element('p', '', 'notice'), actions = element('div', undefined, 'tools'), cancel = element('button', 'Zrušit'), submit = element('button', kind==='collision'?'Uložit kolizi':kind === 'delete' ? 'Odstranit z mise' : kind === 'duplicate' ? 'Duplikovat do modu' : 'Vložit do modu', 'primary');
  cancel.type = 'button'; cancel.onclick = () => dialog.close(); submit.type = 'submit'; actions.append(cancel, submit); form.append(message, actions);
  form.onsubmit = event => {
    event.preventDefault(); if (!form.reportValidity() || state.busy) return;
    run(async () => {
      submit.disabled = cancel.disabled = true;
      try {
        let request = { kind, id: object?.id, name: name.value };
        if (adding) {
          const radians = Number(heading.value) % 360 * Math.PI / 180;
          request = { kind, name: name.value, model: model.value, position: position.map(input => Number(input.value)), rotation: [Math.cos(radians/2),0,Math.sin(radians/2),0], scale: scale?.map(input => Number(input.value))??[1,1,1] };
          if(cars)request.vehicleTableHash=cars.sha256;
          if(kind==='add-human'){request.parameters=Object.fromEntries([...parameters].map(([key,input])=>[key,Number(input.value)]));request.code=code.value;}
        }
        if(collisionMode)request.collision={kind:collisionMode.value,material:Number(collisionMaterial.value)};
        request.collisionHash=file.collision?.sha256;
        state.file = await api.changeSceneObject(file.path, request, file.sha256); state.selectSceneName = kind === 'delete' ? null : kind==='collision'?object.name:name.value;
        dialog.close(); await refresh(); renderDetail(); status(`${labels[kind]}: uloženo do modu se zálohou.`);
      } catch (error) { message.textContent = error.message; throw error; }
      finally { submit.disabled = cancel.disabled = false; }
    });
  };
  dialog.addEventListener('cancel', event => { if (state.busy) event.preventDefault(); }); dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog); dialog.showModal(); if (!['delete','collision'].includes(kind)) { name.focus(); name.select(); }
}
$('filter').oninput = renderFiles;
$('tabs-left').onclick = () => $('categories').scrollBy({ left: -400, behavior: 'smooth' });
$('tabs-right').onclick = () => $('categories').scrollBy({ left: 400, behavior: 'smooth' });
$('categories').addEventListener('wheel', event => { event.preventDefault(); $('categories').scrollLeft += event.deltaX || event.deltaY; }, { passive: false });
for (const [id, action] of [['open', api.open], ['create', api.create]]) $(id).onclick = () => run(async () => {
  if (!await discard()) return;
  status(id === 'create' ? 'Vyberte hru a umístění nového projektu…' : 'Vyberte projekt…');
  const project = await action(); if (!project) { status('Zrušeno'); return; }
  state.viewport?.dispose(); state.viewport = null;
  state.texts.clear(); state.file = null; $('detail').replaceChildren(element('h2', 'Projekt je připravený'), element('p', 'Vyberte soubor vlevo. České texty najdete filtrem Texty.'));
  await refresh(project); status('Projekt otevřený; původní hra zůstala zachovaná.');
});
$('undo').onclick = () => run(async () => {
  if (!await discard()) return;
  const project = await api.undo(); state.texts.clear(); await refresh(project);
  if (state.file && project.assets.some(a => a.path === state.file.path)) await openFile(state.file.path);
  else if (state.file) { state.viewport?.dispose(); state.viewport = null; state.file = null; $('detail').replaceChildren(element('h2', 'Vytvoření mise vráceno'), element('p', 'Vyberte soubor vlevo.')); }
  status('Poslední uložená změna vrácena.');
});
$('new-mission').onclick = () => run(async () => {
  if (state.texts.size) throw new Error('Před vytvořením nové mise uložte rozepsané změny.');
  const template = await api.missionTemplate(); if (!template) return;
  const dialog = element('dialog'), form = element('form', undefined, 'mission-form'), fields = element('div', undefined, 'mission-fields');
  dialog.append(element('h2', 'Nová prázdná mise'), element('p', `${template.name} · ${template.files} souborů. Mise vznikne samostatně v modu; celé vytvoření lze vrátit jedním krokem.`), form);
  function field(label, input) { const row = element('label', label); row.append(input); fields.append(row); return input; }
  function number(label, value, limits = {}) {
    const input = element('input'); input.type = 'number'; input.step = 'any'; input.value = String(value); input.required = true;
    Object.assign(input, limits); return field(label, input);
  }
  const name = element('input'); name.value = 'MOJE_MISE'; name.required = true; name.maxLength = 48; name.pattern = '[a-zA-Z0-9](?:[a-zA-Z0-9_]|-){0,47}'; field('Název složky mise', name);
  const model = element('select'); model.required = true;
  for (const asset of state.project.assets.filter(a => /^models\/[^/]+\.4ds$/i.test(a.path))) { const option = element('option', asset.path.slice(7)); option.value = asset.path; model.append(option); }
  const tommy = [...model.options].find(option => option.value.toLowerCase() === 'models/tommy.4ds'); if (tommy) model.value = tommy.value;
  field('Model hráče (s kostrou)', model);
  const x = number('Start X', 11), y = number('Start Y (výška)', 10), z = number('Start Z', 6), heading = number('Natočení ve stupních kolem Y', 0);
  const sun = number('Síla slunečního světla', 2, { min: '0', max: '10' }), ambient = number('Síla okolního světla', .4, { min: '0', max: '10' });
  const police = element('input'); police.type = 'checkbox'; police.checked = true; field('Inicializovat policii jako v šabloně', police);
  const message = element('p', '', 'notice'), actions = element('div', undefined, 'tools'), cancel = element('button', 'Zrušit'), create = element('button', 'Vytvořit misi', 'primary');
  cancel.type = 'button'; cancel.onclick = () => dialog.close(); create.type = 'submit'; actions.append(cancel, create);
  form.append(fields, element('p', 'Šablona obsahuje rovnou plochu 500 × 500 m. Doprava, chodci a vybavení hráče se nyní převezmou ze šablony. Vypnutí volby policie vynechá její inicializační skript.'), message, actions);
  form.onsubmit = event => {
    event.preventDefault(); if (!form.reportValidity() || state.busy) return;
    run(async () => {
      create.disabled = true; cancel.disabled = true; message.textContent = 'Vytvářím soubory nové mise…';
      try {
        const result = await api.createMission({ name: name.value, model: model.value, position: [x,y,z].map(input => Number(input.value)), heading: Number(heading.value), sun: Number(sun.value), ambient: Number(ambient.value), initializePolice: police.checked });
        dialog.close(); state.category = 'levels'; $('filter').value = `missions/${name.value}/`; await refresh(result.project); await openFile(result.path);
        status(`Nová mise ${name.value} vytvořena. Otevřete 3D mapu nebo spusťte level; vytvoření lze vrátit.`);
      } catch (error) { message.textContent = error.message; throw error; }
      finally { create.disabled = false; cancel.disabled = false; }
    });
  };
  dialog.addEventListener('cancel', event => { if (state.busy) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove(), { once: true }); document.body.append(dialog); dialog.showModal(); name.focus(); name.select();
});
$('export').onclick = () => run(async () => {
  if (state.texts.size) throw new Error('Před exportem uložte rozepsané změny.');
  const result = await api.export(); if (result) status(`Export: ${result.files} souborů → ${result.destination}`);
});
api.onProgress(p => status(p.phase === 'playtest' ? `Synchronizuji test: ${p.current}/${p.total} · ${p.files} změněných souborů` : `Rozbaluji ${p.archive}: ${p.current}/${p.total} · ${p.files} souborů v projektu`));
api.onPlaytest(test => { $('stop-level').hidden = !test.running; if (test.error || test.code) status(`Test skončil chybou. ${test.error ?? `Kód ${test.code}; viz playtest/game.log.`}`, true); else if (!test.running) status('Test levelu ukončen.'); });
$('stop-level').onclick = () => run(async () => { await api.stopLevel(); $('stop-level').hidden = true; status('Test levelu ukončen; původní hra zůstala zachovaná.'); });
window.addEventListener('beforeunload', event => { if (state.texts.size || state.busy) { event.preventDefault(); event.returnValue = ''; } });
run(async () => { await refresh(); const test = await api.playtestState(); $('stop-level').hidden = !test.running; status(state.project ? 'Projekt otevřený.' : 'Připraveno'); });
