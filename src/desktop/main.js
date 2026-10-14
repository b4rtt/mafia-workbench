import { app, BrowserWindow, dialog, ipcMain, protocol, net, session, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { ModProject } from '../core/project.js';
import { parseTextDb } from '../core/textdb.js';
import { prepareDialogueWav } from '../core/dialogue-audio.js';
import { prepareModelImport } from '../core/model-import.js';
import { randomUUID } from 'node:crypto';
import { Playtest } from '../core/playtest.js';
import { readEmptyMissionZip } from '../core/mission.js';
import { replayMissions, loadCutsceneContext } from '../core/cutscene.js';
const directory = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(directory, '../ui');
const profileRoot = path.resolve(directory, '../../local/electron-profile');
await fs.mkdir(profileRoot, { recursive: true });
app.setPath('userData', profileRoot);
app.setPath('sessionData', profileRoot);
protocol.registerSchemesAsPrivileged([{ scheme: 'workbench', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let window, project, missionTemplate, voiceImport, modelImport, busy = false;
// The user's verified runtime stays local, outside the public repository.
const runtimeRoot = path.resolve(directory, '../../../.runtime');
const playtest = new Playtest({ wine: path.join(runtimeRoot, 'wine-cx/wswine.bundle/bin/wine'), server: path.join(runtimeRoot, 'wine-cx/wswine.bundle/bin/wineserver'), dependencies: path.join(runtimeRoot, 'wine-cx/dependencies'), prefixTemplate: path.join(runtimeRoot, 'prefix-cx') });
const mediaToken = randomUUID();
const mediaTypes = new Map([['.bmp', 'image/bmp'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.wav', 'audio/wav'], ['.ogg', 'audio/ogg'], ['.mp3', 'audio/mpeg']]);
async function operation(task) {
  if (busy) throw new Error('Probíhá jiná operace.');
  busy = true;
  try { return await task(); } finally { busy = false; }
}
function current() { if (!project) throw new Error('Nejdřív otevřete projekt.'); return project; }
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== 'workbench://app/index.html') throw new Error('Nepovolený volající.');
    try { return { ok: true, value: await fn(...args) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
}
async function chooseFolder(title) {
  const result = await dialog.showOpenDialog(window, { title, properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
}
function importProject(game, destination) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./extract-worker.js', import.meta.url), { workerData: { game, destination } });
    let finished = false;
    worker.on('message', message => {
      if (message.progress) window.webContents.send('extraction:progress', message.progress);
      else if (message.error) { finished = true; reject(new Error(message.error)); }
      else if (message.done) { finished = true; resolve(message.done); }
    });
    worker.on('error', reject);
    worker.on('exit', code => { if (!finished) reject(new Error(`Extrakce skončila předčasně (${code}).`)); });
  });
}
app.whenReady().then(async () => {
  protocol.handle('workbench', async request => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Not found', { status: 404 });
    const pendingVoice=voiceImport && voiceImport.project===project && url.pathname===`/voice/${voiceImport.token}`?voiceImport:null;
    if (url.pathname === `/media/${mediaToken}` || pendingVoice) {
      try {
        const name = pendingVoice?'voice.wav':url.searchParams.get('name'), type = mediaTypes.get(path.extname(name ?? '').toLowerCase());
        if (!type) return new Response('Unsupported media', { status: 415 });
        const active = current(), bytes = pendingVoice?pendingVoice.bytes:await active.read(name);
        if (bytes.length > 64 * 1024 * 1024) return new Response('Preview too large', { status: 413 });
        const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
        const range = request.headers.get('range');
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${bytes.length}` } });
          const start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
          const end = match[1] && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start < 0 || start >= bytes.length) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${bytes.length}` } });
          return new Response(bytes.subarray(start, end + 1), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Length': String(end - start + 1) } });
        }
        return new Response(bytes, { headers: { ...headers, 'Content-Length': String(bytes.length) } });
      } catch { return new Response('Asset unavailable', { status: 404 }); }
    }
    const allowed = new Set(['index.html', 'styles.css', 'app.js']);
    const name = url.pathname.slice(1);
    if (!allowed.has(name)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(name === 'app.js' ? path.resolve(directory, '../../out/app.js') : path.join(uiRoot, name)).href);
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  window = new BrowserWindow({ width: 1320, height: 850, minWidth: 1000, minHeight: 650, backgroundColor: '#121716', title: 'Mafia Workbench', webPreferences: { preload: path.join(directory, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(window, { type: 'question', buttons: ['Zůstat', 'Zahodit a zavřít'], defaultId: 0, cancelId: 0, message: 'Máte neuložené změny nebo probíhá operace.', detail: 'Zavřením můžete přijít o rozepsané změny.' });
    if (choice === 1 && !busy) event.preventDefault();
  });
  window.webContents.on('did-fail-load', (_event, code, description) => console.error('Renderer load failed:', code, description));
  window.webContents.on('render-process-gone', (_event, details) => console.error('Renderer exited:', details.reason));
  window.webContents.on('console-message', (_event, details) => { if (details.level === 'error') console.error('Renderer:', details.message); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]));
  handle('project:get', async () => project ? project.list() : null);
  handle('project:open', () => operation(async () => {
    const root = await chooseFolder('Otevřít projekt Mafia Workbench');
    if (!root) return null;
    const candidate = await ModProject.open(root); project = candidate; return project.list();
  }));
  handle('project:create', () => operation(async () => {
    const game = await chooseFolder('Vyberte složku původní hry s DTA archivy'); if (!game) return null;
    const parent = await chooseFolder('Kam uložit rozbalený projekt'); if (!parent) return null;
    const destination = path.join(parent, `Mafia-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    await importProject(game, destination); project = await ModProject.open(destination); return project.list();
  }));
  handle('asset:inspect', name => current().inspect(name));
  handle('asset:map', name => current().inspectMap(name));
  handle('mission:destination', name => current().missionDestination(name));
  handle('model:terrain', (options,textureHash) => operation(async()=>{const active=current(),path=await active.createTerrain(options,textureHash);return {path,project:await active.list()};}));
  handle('asset:car-models', () => current().carModels());
  handle('asset:pickup-items', () => current().pickupItems());
  handle('replay:missions', name => replayMissions(current(), name));
  handle('replay:context', (name, scene, difference) => loadCutsceneContext(current(), name, scene, difference));
  handle('playtest:get', () => playtest.attach(project));
  handle('playtest:checkpoints', name => operation(() => playtest.checkpoints(current(), name)));
  handle('playtest:start', (name, checkpoint = null) => operation(() => playtest.start(current(), name, p => window.webContents.send('extraction:progress', p), state => { if (!window.isDestroyed()) window.webContents.send('playtest:state', state); }, checkpoint)));
  handle('playtest:stop', () => operation(() => playtest.stop()));
  handle('asset:media', name => {
    current().asset(name);
    if (!mediaTypes.has(path.extname(name).toLowerCase())) throw new Error('Náhled tohoto média není podporovaný.');
    return `workbench://app/media/${mediaToken}?name=${encodeURIComponent(name)}`;
  });
  handle('asset:texts', (name, changes, expectedHash) => operation(async () => { await current().saveTexts(name, changes, expectedHash); return current().inspect(name); }));
  handle('asset:text-add', (name, entry, expectedHash) => operation(async () => { await current().addText(name, entry, expectedHash); return current().inspect(name); }));
  handle('voice:choose', () => operation(async () => {
    const active=current();voiceImport=null;
    const result=await dialog.showOpenDialog(window,{title:'Vyberte hlasovou nahrávku WAV',properties:['openFile'],filters:[{name:'Hlasová nahrávka',extensions:['wav']}]});
    if(result.canceled)return null;
    const stat=await fs.stat(result.filePaths[0]);if(!stat.isFile()||stat.size>64*1024*1024)throw new Error('Nahrávka je příliš velká (maximum 64 MiB).');
    const {bytes,info}=prepareDialogueWav(await fs.readFile(result.filePaths[0])),token=randomUUID();
    voiceImport={project:active,bytes,token};return {token,name:path.basename(result.filePaths[0]),url:`workbench://app/voice/${token}`,...info};
  }));
  handle('voice:cancel', token => {if(voiceImport?.token===token)voiceImport=null;});
  handle('voice:import', (token,name,id,textHash,soundHash) => operation(async () => {
    if(!voiceImport||voiceImport.project!==current()||voiceImport.token!==token)throw new Error('Nejdřív vyberte hlasovou nahrávku pro tento projekt.');
    const result=await current().importDialogue(name,id,voiceImport.bytes,textHash,soundHash);voiceImport=null;return result;
  }));
  async function importFile(filename) {
    const stat=await fs.stat(filename);
    if(!stat.isFile()||stat.size>64*1024*1024)throw new Error('Import: soubor je příliš velký (maximum 64 MiB).');
    return {name:path.basename(filename),data:await fs.readFile(filename)};
  }
  function pendingModel(token) {
    if(!modelImport||modelImport.project!==current()||modelImport.token!==token)throw new Error('Nejdřív vyberte model pro tento projekt.');
    return modelImport;
  }
  handle('model-import:choose',()=>operation(async()=>{
    const active=current();modelImport=null;
    const result=await dialog.showOpenDialog(window,{title:'Vyberte vlastní model 4DS',properties:['openFile'],filters:[{name:'Model Mafia 1',extensions:['4ds']}]});
    if(result.canceled)return null;
    const file=await importFile(result.filePaths[0]);prepareModelImport([file]);
    const token=randomUUID();modelImport={project:active,files:[file],token};return {token,name:file.name};
  }));
  handle('model-import:textures',token=>operation(async()=>{
    const pending=pendingModel(token);
    const result=await dialog.showOpenDialog(window,{title:'Vyberte BMP textury modelu (všechny potřebné soubory)',properties:['openFile','multiSelections'],filters:[{name:'Textury Mafia 1',extensions:['bmp']}]});
    if(result.canceled)return false;
    if(result.filePaths.length>63)throw new Error('Import: nejvýše 63 textur.');
    const files=[pending.files[0]];let total=files[0].data.length;
    for(const filename of result.filePaths){const file=await importFile(filename);total+=file.data.length;if(total>64*1024*1024)throw new Error('Import: soubory přesahují 64 MiB.');files.push(file);}
    prepareModelImport(files);pending.files=files;return true;
  }));
  handle('model-import:plan',(token,name)=>{const pending=pendingModel(token);return current().previewModelImport(pending.files,name);});
  handle('model-import:cancel',token=>{if(modelImport?.token===token)modelImport=null;});
  handle('model-import:save',(token,name,expected)=>operation(async()=>{
    const pending=pendingModel(token),active=current();const imported=await active.importModel(pending.files,name,expected);modelImport=null;return {path:imported,project:await active.list()};
  }));
  handle('asset:scene', (name, changes, expectedHash) => operation(async () => { await current().saveScene(name, changes, expectedHash); return current().inspect(name); }));
  handle('asset:scene-object', (name, request, expectedHash) => operation(async () => { await current().changeSceneObject(name, request, expectedHash); return current().inspectMap(name); }));
  handle('asset:scene-collision-rebuild', (name, expectedHash, collisionHash) => operation(async () => { const result=await current().rebuildSceneCollision(name,expectedHash,collisionHash);return {...result,map:await current().inspectMap(name)}; }));
  handle('asset:model', (name, changes, expectedHash) => operation(async () => { await current().saveModel(name, changes, expectedHash); return current().inspect(name); }));
  handle('asset:model-geometry', (name, mesh) => current().modelGeometry(name,mesh));
  handle('asset:geometry', (name, request, expectedHash) => operation(async () => { await current().saveGeometry(name, request, expectedHash); return current().inspect(name); }));
  handle('asset:bitmap', (name, changes, expectedHash) => operation(async () => { await current().saveBitmap(name, changes, expectedHash); return current().inspect(name); }));
  handle('asset:collision',(name,operations,expectedHash,dependencies,options)=>operation(async()=>{const result=await current().saveCollision(name,operations,expectedHash,dependencies,options);return {file:await current().inspect(name),...result};}));
  handle('asset:effects', (name, changes, expectedHash, dependencies) => operation(async () => { await current().saveEffects(name, changes, expectedHash, dependencies); return current().inspect(name); }));
  handle('asset:effect-definitions', (name, changes, expectedHash) => operation(async () => { await current().saveEffectDefinitions(name, changes, expectedHash); return current().inspect(name); }));
  handle('asset:effects-change', (name, request, expectedHash, dependencies) => operation(async () => { await current().changeEffects(name, request, expectedHash, dependencies); return current().inspect(name); }));
  handle('asset:animation', (name, changes, expectedHash) => operation(async () => { await current().saveAnimation(name, changes, expectedHash); return current().inspect(name); }));
  handle('asset:animation-timeline',(name,request,expectedHash)=>operation(async()=>{await current().saveAnimationTimeline(name,request,expectedHash);return current().inspect(name);}));
  handle('asset:cache', (name, changes, expectedHash) => operation(async () => { await current().saveCache(name, changes, expectedHash); return current().inspect(name); }));
  handle('asset:items', (name, changes, expectedHash) => operation(async () => { await current().saveItems(name, changes, expectedHash); return current().inspect(name); }));
  handle('asset:vehicles', (name, changes, expectedHash) => operation(async () => { await current().saveVehicles(name, changes, expectedHash); return current().inspect(name); }));
  handle('asset:navigation', (name, changes, expectedHash) => operation(async () => { const navigationMapping=await current().saveNavigation(name, changes, expectedHash); return {...await current().inspect(name),navigationMapping}; }));
  handle('asset:navigation-connection', (name, request, expectedHash) => operation(async () => { await current().changeNavigationConnection(name, request, expectedHash); return current().inspect(name); }));
  handle('asset:navigation-point', (name, request, expectedHash) => operation(async () => { const index=await current().changeNavigationPoint(name, request, expectedHash); return {file:await current().inspect(name),index}; }));
  handle('asset:roads', (name, changes, expectedHash) => operation(async () => { const roadMapping=await current().saveRoads(name, changes, expectedHash); return {...await current().inspect(name),roadMapping}; }));
  handle('asset:road-point', (name, request, expectedHash) => operation(async () => { const selection=await current().changeRoadPoint(name,request,expectedHash);return {file:await current().inspect(name),...selection}; }));
  handle('asset:road-topology',(name,request,expectedHash)=>operation(async()=>{const selection=await current().changeRoadTopology(name,request,expectedHash);return {file:await current().inspect(name),...selection};}));
  handle('asset:track', (name, changes, expectedHash) => operation(async () => { await current().saveTrack(name, changes, expectedHash); return current().inspect(name); }));
  handle('asset:difference', (name, changes, expectedHash) => operation(async () => { await current().saveDifference(name, changes, expectedHash); return current().inspect(name); }));
  handle('asset:replay', (name, changes, expectedHash) => operation(async () => { await current().saveReplay(name, changes, expectedHash); return current().inspect(name); }));
  handle('project:loose', () => operation(async () => { await current().importLoose(p => window.webContents.send('extraction:progress', p)); return current().list(); }));
  handle('mission:template', () => operation(async () => {
    const active = current();
    const result = await dialog.showOpenDialog(window, { title: 'Vyberte Empty_Mission.zip', properties: ['openFile'], filters: [{ name: 'Prázdná mise', extensions: ['zip'] }] });
    if (result.canceled) return null;
    const stat = await fs.stat(result.filePaths[0]); if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('Šablona je příliš velká.');
    const bytes = await fs.readFile(result.filePaths[0]); readEmptyMissionZip(bytes);
    missionTemplate = { project: active, bytes }; return { name: path.basename(result.filePaths[0]), files: 8 };
  }));
  handle('mission:create', options => operation(async () => {
    const active = current();
    if (!missionTemplate || missionTemplate.project !== active) throw new Error('Nejdřív vyberte šablonu mise pro tento projekt.');
    const name = await active.createMission(missionTemplate.bytes, options); missionTemplate = null;
    return { project: await active.list(), path: name };
  }));
  handle('asset:restore', name => operation(async () => { await current().restore(name); return current().inspect(name); }));
  handle('project:undo', () => operation(async () => { await current().undo(); return current().list(); }));
  handle('asset:replace', name => operation(async () => {
    current().asset(name);
    const result = await dialog.showOpenDialog(window, { title: `Nahradit ${name}`, properties: ['openFile'] });
    if (result.canceled) return null;
    const stat = await fs.stat(result.filePaths[0]);
    if (stat.size > 256 * 1024 * 1024) throw new Error('Soubor je příliš velký.');
    const data = await fs.readFile(result.filePaths[0]);
    if (/textdb_[a-z]{2}\.def$/i.test(name)) parseTextDb(data, name);
    await current().change(name, data, 'Nahrazení souboru'); return current().inspect(name);
  }));
  handle('project:export', () => operation(async () => {
    const active = current(), parent = await chooseFolder('Kam exportovat mod'); if (!parent) return null;
    const destination = path.join(parent, `Mafia-mod-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    return { destination, files: await active.export(destination) };
  }));
  const argument = process.argv.find(arg => arg.startsWith('--project='));
  if (argument) { try { project = await ModProject.open(argument.slice('--project='.length)); } catch (error) { await dialog.showMessageBox({ type: 'error', message: error.message }); } }
  await window.loadURL('workbench://app/index.html');
}).catch(error => { console.error(error); app.quit(); });
app.on('window-all-closed', () => app.quit());
