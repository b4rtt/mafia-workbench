import {osmCollisionBudget} from '../plugins/osm/collision-policy.js';
import {osmHybridPlan} from '../plugins/osm/building-hybrid.js';
import {loadOsmAmbientSounds} from '../plugins/osm/ambient-assets.js';
import {validateOsmAmbient} from '../plugins/osm/ambient.js';
import {loadOsmPedestrianModels} from '../plugins/osm/pedestrian-assets.js';
import {loadOsmTrafficModels} from '../plugins/osm/traffic-assets.js';
import {osmTrafficPlan} from '../plugins/osm/traffic.js';
import { app, BrowserWindow, dialog, ipcMain, protocol, net, session, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { ModProject } from '../core/project.js';
import { parseBmp } from '../core/bmp.js';
import { parseTextDb } from '../core/textdb.js';
import { prepareDialogueWav } from '../core/dialogue-audio.js';
import { prepareModelImport } from '../core/model-import.js';
import { randomUUID } from 'node:crypto';
import { validateFaceCapture } from '../shared/face-capture.js';
import { facePermissionGate } from './face-permissions.js';
import { writeSafe } from '../core/files.js';
import { Playtest } from '../core/playtest.js';
import { readEmptyMissionZip } from '../core/mission.js';
import { downloadOsm } from '../plugins/osm/download.js';
import { osmSource, osmRoadPlan } from '../plugins/osm/area.js';
import {readOsmMergeFiles,osmMergeInfo} from '../plugins/osm/merge.js';
import { createOsmMission } from '../plugins/osm/mission.js';
import {osmCitySurface} from '../plugins/osm/city-surface.js';
import { osmTerrainRoadPlan } from '../plugins/osm/navigation-elevation.js';
import { osmElevationSource } from '../plugins/osm/elevation-source.js';
import { downloadOsmElevation } from '../plugins/osm/elevation-download.js';
import {osmShellPlan} from '../plugins/osm/building-shells.js';
import {loadOsmShellStyles} from '../plugins/osm/building-shell-assets.js';
import {loadOsmBuildingModels} from '../plugins/osm/building-assets.js';
import {osmBuildingPlan} from '../plugins/osm/buildings.js';
import {loadOsmPropModels} from '../plugins/osm/prop-assets.js';
import {validateOsmPropOptions} from '../plugins/osm/props.js';
import {loadOsmWalkwayTexture} from '../plugins/osm/walkway-assets.js';
import {loadOsmGreenTextures} from '../plugins/osm/green-assets.js';
import { replayMissions, loadCutsceneContext } from '../core/cutscene.js';
const directory = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(directory, '../ui');
const profileRoot = path.resolve(directory, '../../local/electron-profile');
await fs.mkdir(profileRoot, { recursive: true });
app.setPath('userData', profileRoot);
app.setPath('sessionData', profileRoot);
protocol.registerSchemesAsPrivileged([{ scheme: 'workbench', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let window, project, missionTemplate, voiceImport, modelImport, osmImport, busy = false;
// The user's verified runtime stays local, outside the public repository.
const runtimeRoot = path.resolve(directory, '../../../.runtime');
const playtest = new Playtest({ wine: path.join(runtimeRoot, 'wine-cx/wswine.bundle/bin/wine'), server: path.join(runtimeRoot, 'wine-cx/wswine.bundle/bin/wineserver'), dependencies: path.join(runtimeRoot, 'wine-cx/dependencies'), prefixTemplate: path.join(runtimeRoot, 'prefix-cx') });
const mediaToken = randomUUID();
const faceGate=facePermissionGate();
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
    const faceAssets=new Set(['face-worker.js','face-runtime/face_landmarker.task','face-runtime/vision_wasm_internal.js','face-runtime/vision_wasm_internal.wasm','face-runtime/vision_wasm_nosimd_internal.js','face-runtime/vision_wasm_nosimd_internal.wasm']);
    const allowed = new Set(['index.html', 'styles.css', 'app.js',...faceAssets]);
    const name = url.pathname.slice(1);
    if (!allowed.has(name)) return new Response('Not found', { status: 404 });
    try{return await net.fetch(pathToFileURL(name === 'app.js'||faceAssets.has(name) ? path.resolve(directory, '../../out',name) : path.join(uiRoot, name)).href);}catch{return new Response('Asset unavailable',{status:404});}
  });
  session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details)=>callback(contents===window?.webContents&&faceGate.request(permission,details)));
  session.defaultSession.setPermissionCheckHandler((contents,permission,origin,details)=>contents===window?.webContents&&faceGate.check(permission,origin,details));
  window = new BrowserWindow({ width: 1320, height: 850, minWidth: 1000, minHeight: 650, backgroundColor: '#121716', title: 'Mafia Workbench', webPreferences: { preload: path.join(directory, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(window, { type: 'question', buttons: ['Zůstat', 'Zahodit a zavřít'], defaultId: 0, cancelId: 0, message: 'Máte neuložené změny nebo probíhá operace.', detail: 'Zavřením můžete přijít o rozepsané změny.' });
    if (choice === 1 && !busy) event.preventDefault();
  });
  window.webContents.on('did-fail-load', (_event, code, description) => console.error('Renderer load failed:', code, description));
  window.webContents.on('did-start-navigation',()=>faceGate.clear());
  window.on('closed',()=>faceGate.clear());
  window.webContents.on('render-process-gone', (_event, details) => console.error('Renderer exited:', details.reason));
  window.webContents.on('console-message', (_event, details) => { if (details.level === 'error') console.error('Renderer:', details.message); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]));
  handle('project:get', async () => project ? project.list() : null);
  handle('face:camera',enabled=>{if(enabled===true)faceGate.arm();else faceGate.clear();return true;});
  handle('face:save',capture=>operation(async()=>{
    const value=validateFaceCapture(capture),result=await dialog.showSaveDialog(window,{title:'Uložit záznam mimiky (bez videa a zvuku)',defaultPath:'Mimika.wbface.json',filters:[{name:'Záznam mimiky',extensions:['wbface.json']}]});
    if(result.canceled)return null;
    if(!result.filePath.toLowerCase().endsWith('.wbface.json'))throw Error('Záznam musí mít příponu .wbface.json.');
    const bytes=JSON.stringify(value);if(Buffer.byteLength(bytes)>64*1024*1024)throw Error('Záznam je příliš velký (maximum 64 MB).');
    await writeSafe(path.dirname(result.filePath),path.basename(result.filePath),bytes);return result.filePath;
  }));
  handle('face:open',()=>operation(async()=>{
    const result=await dialog.showOpenDialog(window,{title:'Otevřít záznam mimiky',properties:['openFile'],filters:[{name:'Záznam mimiky',extensions:['wbface.json']}]});if(result.canceled)return null;
    const filename=result.filePaths[0];if((await fs.stat(filename)).size>64*1024*1024)throw Error('Záznam je příliš velký (maximum 64 MB).');
    return validateFaceCapture(JSON.parse(await fs.readFile(filename,'utf8')));
  }));
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
  handle('asset:cache-map', (name,part) => current().inspectCacheMap(name,part));
  handle('mission:destination', name => current().missionDestination(name));
  handle('mission:check', (name, textDb) => operation(() => current().checkMission(name, textDb)));
  handle('model:terrain', (options,textureHash) => operation(async()=>{const active=current(),path=await active.createTerrain(options,textureHash);return {path,project:await active.list()};}));
  handle('model:road-surface', (name,options,expectedHash,textureHashes) => operation(async()=>{const active=current(),path=await active.createRoadSurface(name,options,expectedHash,textureHashes);return {path,project:await active.list()};}));
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
  handle('lip:dialogue', (name,id,expectedHash)=>current().dialogueLip(name,id,expectedHash));
  handle('lip:estimate', (name,expectedHash)=>current().estimateLip(name,expectedHash));
  handle('lip:save', (name,frames,expectedHash,dependencies)=>operation(async()=>{await current().saveLip(name,frames,expectedHash,dependencies);return current().inspect(name);}));
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
    const result=await dialog.showOpenDialog(window,{title:'Vyberte vlastní model 4DS nebo OBJ',properties:['openFile'],filters:[{name:'Model Mafia 1 / Wavefront',extensions:['4ds','obj']}]});
    if(result.canceled)return null;
    const file=await importFile(result.filePaths[0]);prepareModelImport([file]);
    const token=randomUUID();modelImport={project:active,files:[file],token};return {token,name:file.name.replace(/\.obj$/i,'.4ds'),source:file.name,converted:/\.obj$/i.test(file.name)};
  }));
  handle('model-import:textures',token=>operation(async()=>{
    const pending=pendingModel(token);
    const converted=/\.obj$/i.test(pending.files[0].name);
    const result=await dialog.showOpenDialog(window,{title:converted?'Vyberte všechny MTL knihovny a BMP textury':'Vyberte BMP textury modelu (všechny potřebné soubory)',properties:['openFile','multiSelections'],filters:[{name:converted?'Materiály a textury':'Textury Mafia 1',extensions:converted?['mtl','bmp']:['bmp']}]});
    if(result.canceled)return false;
    if(result.filePaths.length>63)throw new Error('Import: nejvýše 63 doprovodných souborů.');
    const files=[pending.files[0]];let total=files[0].data.length;
    for(const filename of result.filePaths){const file=await importFile(filename);total+=file.data.length;if(total>64*1024*1024)throw new Error('Import: soubory přesahují 64 MiB.');files.push(file);}
    prepareModelImport(files);pending.files=files;return true;
  }));
  handle('model-import:plan',(token,name,options)=>{const pending=pendingModel(token);return current().previewModelImport(pending.files,name,options);});
  handle('model-import:cancel',token=>{if(modelImport?.token===token)modelImport=null;});
  handle('model-import:save',(token,name,expected,options)=>operation(async()=>{
    const pending=pendingModel(token),active=current();const imported=await active.importModel(pending.files,name,expected,options);modelImport=null;return {path:imported,project:await active.list()};
  }));
  handle('asset:scene', (name, changes, expectedHash) => operation(async () => { await current().saveScene(name, changes, expectedHash); return current().inspect(name); }));
  handle('asset:scene-object', (name, request, expectedHash) => operation(async () => { await current().changeSceneObject(name, request, expectedHash); return current().inspectMap(name); }));
  handle('asset:scene-sector-context',(name,id)=>current().sceneSectorContext(name,id));
  handle('asset:scene-sectors',(name,request,expectedHash,geometryHash)=>operation(async()=>{await current().assignSceneSectors(name,request,expectedHash,geometryHash);return current().inspectMap(name);}));
  handle('asset:scene-translate',(name,request,expectedHash,geometryHash)=>operation(async()=>{await current().translateSceneObjects(name,request,expectedHash,geometryHash);return current().inspectMap(name);}));
  handle('asset:scene-collision-rebuild', (name, expectedHash, collisionHash) => operation(async () => { const result=await current().rebuildSceneCollision(name,expectedHash,collisionHash);return {...result,map:await current().inspectMap(name)}; }));
  handle('asset:model', (name, changes, expectedHash) => operation(async () => { await current().saveModel(name, changes, expectedHash); return current().inspect(name); }));
  handle('asset:model-geometry', (name, mesh) => current().modelGeometry(name,mesh));
  handle('asset:sector-context', name => current().sectorContext(name));
  handle('asset:sector-link-context', (name,mesh) => current().sectorLinkContext(name,mesh));
  handle('asset:sector-link', (name,request,expectedHash,sceneHash) => operation(async()=>{await current().connectSectorPortal(name,request,expectedHash,sceneHash);return current().inspect(name);}));
  handle('asset:sector-pair', (name,request,expectedHash,sceneHash) => operation(async()=>{await current().changeSectorPortalPair(name,request,expectedHash,sceneHash);return current().inspect(name);}));
  handle('asset:sector-create', (name, options, expectedHash, sceneHash) => operation(async()=>{await current().createSector(name,options,expectedHash,sceneHash);return current().inspect(name);}));
  handle('asset:geometry', (name, request, expectedHash) => operation(async () => { await current().saveGeometry(name, request, expectedHash); return current().inspect(name); }));
  handle('asset:bitmap', (name, changes, expectedHash) => operation(async () => { await current().saveBitmap(name, changes, expectedHash); return current().inspect(name); }));
  handle('asset:collision',(name,operations,expectedHash,dependencies,options)=>operation(async()=>{const result=await current().saveCollision(name,operations,expectedHash,dependencies,options);return {file:await current().inspect(name),...result};}));
  handle('asset:effects', (name, changes, expectedHash, dependencies) => operation(async () => { await current().saveEffects(name, changes, expectedHash, dependencies); return current().inspect(name); }));
  handle('asset:effect-definitions', (name, changes, expectedHash, dependencies) => operation(async () => { await current().saveEffectDefinitions(name, changes, expectedHash, dependencies); return current().inspect(name); }));
  handle('asset:effect-definition-structure',(name,request,expectedHash)=>operation(async()=>{const selection=await current().changeEffectDefinition(name,request,expectedHash);return {file:await current().inspect(name),selection};}));
  handle('asset:effects-change', (name, request, expectedHash, dependencies) => operation(async () => { await current().changeEffects(name, request, expectedHash, dependencies); return current().inspect(name); }));
  handle('asset:animation', (name, changes, expectedHash) => operation(async () => { await current().saveAnimation(name, changes, expectedHash); return current().inspect(name); }));
  handle('asset:animation-timeline',(name,request,expectedHash)=>operation(async()=>{await current().saveAnimationTimeline(name,request,expectedHash);return current().inspect(name);}));
  handle('animation:create',(options,modelHash)=>operation(async()=>{const project=current(),name=await project.createAnimation(options,modelHash);return {path:name,project:await project.list()};}));
  handle('asset:cache', (name, changes, expectedHash) => operation(async () => { await current().saveCache(name, changes, expectedHash); return current().inspect(name); }));
  handle('asset:items', (name, changes, expectedHash) => operation(async () => { await current().saveItems(name, changes, expectedHash); return current().inspect(name); }));
  handle('asset:vehicles', (name, changes, expectedHash) => operation(async () => { await current().saveVehicles(name, changes, expectedHash); return current().inspect(name); }));
  handle('asset:navigation', (name, changes, expectedHash) => operation(async () => { const navigationMapping=await current().saveNavigation(name, changes, expectedHash); return {...await current().inspect(name),navigationMapping}; }));
  handle('asset:navigation-connection', (name, request, expectedHash) => operation(async () => { await current().changeNavigationConnection(name, request, expectedHash); return current().inspect(name); }));
  handle('asset:navigation-point', (name, request, expectedHash) => operation(async () => { const index=await current().changeNavigationPoint(name, request, expectedHash); return {file:await current().inspect(name),index}; }));
  handle('asset:roads', (name, changes, expectedHash) => operation(async () => { const roadMapping=await current().saveRoads(name, changes, expectedHash); return {...await current().inspect(name),roadMapping}; }));
  handle('asset:road-point', (name, request, expectedHash) => operation(async () => { const selection=await current().changeRoadPoint(name,request,expectedHash);return {file:await current().inspect(name),...selection}; }));
  handle('asset:road-topology',(name,request,expectedHash)=>operation(async()=>{const selection=await current().changeRoadTopology(name,request,expectedHash);return {file:await current().inspect(name),...selection};}));
  handle('asset:segments',(name,request,expectedHash,navigationHash)=>operation(async()=>{const index=await current().changeSegments(name,request,expectedHash,navigationHash);return {file:await current().inspect(name),index};}));
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
  handle('osm:area', (area,provider) => operation(async () => {
    const active=current(),result=await downloadOsm(area,{provider,cacheRoot:path.resolve(directory,'../../local/osm-cache')});
    const source=osmSource(result.data,area),token=randomUUID();
    osmImport={project:active,token,data:result.data,area:source.area};
    return {token,source,cached:result.cached};
  }));
  handle('osm:elevation', (token,settings) => operation(async () => {
    if(!osmImport||osmImport.project!==current()||osmImport.token!==token)throw Error('Nejdřív načtěte oblast OpenStreetMap pro tento projekt.');
    const asset=current().asset(settings?.groundTexture);parseBmp(await current().read(asset.path));
    return downloadOsmElevation(osmImport.area,{groundTexture:asset.path,groundTileSize:settings?.groundTileSize},{cacheRoot:path.resolve(directory,'../../local/osm-elevation-cache')});
  }));
  handle('osm:open', (area,merge=false) => operation(async () => {
    if(typeof merge!=='boolean')throw Error('OpenStreetMap: neplatný způsob otevření podkladu.');
    const active=current(),result=await dialog.showOpenDialog(window,{title:merge?'Sloučit 2–16 podkladů OpenStreetMap':'Podklad OpenStreetMap (Overpass JSON nebo osm-source.json)',properties:merge?['openFile','multiSelections']:['openFile'],filters:[{name:'OpenStreetMap JSON',extensions:['json']}]});
    if(result.canceled)return null;
    if(merge){
      const combined=await readOsmMergeFiles(result.filePaths,area),token=randomUUID();
      osmImport={project:active,token,data:combined.data,area:combined.source.area};
      return {token,source:combined.source,merge:combined.merge,cached:true};
    }
    const stat=await fs.stat(result.filePaths[0]);if(!stat.isFile()||stat.size>8*1024*1024)throw Error('Podklad přesahuje 8 MB.');
    const input=JSON.parse(await fs.readFile(result.filePaths[0],'utf8'));
    const saved=input?.format==='mafia-workbench-osm-source'&&input.version===1,data=saved?input.data:input,source=osmSource(data,saved?input.area:area),token=randomUUID();
    const elevation=saved&&input.elevation!=null?osmElevationSource(input.elevation,source.area):null;
    if(elevation&&!input.surface)throw Error('OpenStreetMap · terén: výškový rastr vyžaduje povrchy ulic.');
    if(saved){
      osmCollisionBudget(input.collisions);
      if(input.props!==undefined&&input.props!==null){validateOsmPropOptions(input.props);await loadOsmPropModels(active,input.props.models);if(!input.surface||input.props.selected.some(id=>!source.props.some(p=>p.id===id)))throw Error('OpenStreetMap · osazení: chybí povrchy nebo mapované body.');}
      if(input.green!==undefined&&input.green!==null){await loadOsmGreenTextures(active,input.green);if(!input.surface)throw Error('OpenStreetMap · zeleň: chybí povrchy ulic.');}
      if(input.walkways!==undefined&&input.walkways!==null){await loadOsmWalkwayTexture(active,input.walkways);if(!input.surface)throw Error('OpenStreetMap · pěší cesty: chybí povrchy ulic.');}
      if(input.ambient!==undefined&&input.ambient!==null){validateOsmAmbient(input.ambient);if(!input.surface||input.ambient.green&&!input.green)throw Error('OpenStreetMap · zvuky: chybí povrchy nebo zeleň.');await loadOsmAmbientSounds(active,[input.ambient.streets,input.ambient.green].filter(Boolean).map(l=>l.sound));}
      const plan=osmRoadPlan(source,input.selected),surface=Object.hasOwn(input,'surface')&&input.surface!==null?osmCitySurface(plan,source.area,input.surface,elevation):null;
      if(input.pedestrians!==undefined&&input.pedestrians!==null){await loadOsmPedestrianModels(active,input.pedestrians);if(!surface)throw Error('OpenStreetMap · chodci: chybí povrchy ulic.');if(input.pedestrians.walkways&&!input.walkways)throw Error('OpenStreetMap · chodci: chybí samostatné pěší cesty.');if(input.pedestrians.parkPaths&&!input.green)throw Error('OpenStreetMap · chodci: chybí zeleň pro parkové cesty.');}
      if(input.traffic!==undefined&&input.traffic!==null){await loadOsmTrafficModels(active,input.traffic);osmTrafficPlan(elevation?osmTerrainRoadPlan(plan,surface):plan,surface,input.traffic);}
      if(Object.hasOwn(input,'buildings')&&input.buildings!==null){
        if(input.buildings.mode==='footprint'){
          if(!Array.isArray(input.buildings.styles))throw Error('OpenStreetMap · půdorysné domy: neplatné uložené styly.');
          const {styles}=await loadOsmShellStyles(active,input.buildings.styles);osmShellPlan(source,plan,surface,{...input.buildings,styles},undefined,input.collisions);
        }else{
          if(input.buildings.mode!==undefined&&!['original','hybrid'].includes(input.buildings.mode))throw Error('OpenStreetMap · budovy: neznámý způsob generování.');
          if(!Array.isArray(input.buildings?.models))throw Error('OpenStreetMap · budovy: neplatný uložený katalog.');
          const {models,warnings}=await loadOsmBuildingModels(active,input.buildings.models.map(m=>m?.path));
          if(warnings.length||models.some(m=>input.buildings.models.find(w=>w?.path?.toLowerCase()===m.path.toLowerCase())?.sha256!==m.sha256))throw Error('OpenStreetMap · budovy: uložené modely se změnily nebo nejsou dostupné v tomto projektu.');
          if(input.buildings.mode==='hybrid'){const {styles}=await loadOsmShellStyles(active,input.buildings.styles);osmHybridPlan(source,plan,surface,models,{...input.buildings,styles},input.collisions);}
          else osmBuildingPlan(source,plan,surface,models,input.buildings,input.collisions);
        }
      }
    }
    const mergeInfo=osmMergeInfo(data);
    osmImport={project:active,token,data,area:source.area};return {token,source,cached:true,...(mergeInfo?{merge:mergeInfo}:{}),...(elevation?{elevation}:{}),...(saved?{collisions:input.collisions??null,walkways:input.walkways??null,crossingMarkings:input.crossingMarkings??null,ambient:input.ambient??null,pedestrians:input.pedestrians??null,traffic:input.traffic??null,props:input.props??null,green:input.green??null,selected:input.selected,...(Object.hasOwn(input,'surface')?{surface:input.surface}:{}),...(Object.hasOwn(input,'buildings')?{buildings:input.buildings}:{})}:{})};
  }));
  handle('osm:ambient-sounds', sounds => operation(() => loadOsmAmbientSounds(current(),sounds)));
  handle('osm:pedestrian-models', () => operation(async () => {const {models,warnings}=await loadOsmPedestrianModels(current());return {models,warnings};}));
  handle('osm:traffic-models', () => operation(async () => {const {models,tableHash,warnings}=await loadOsmTrafficModels(current());return {models,tableHash,warnings};}));
  handle('osm:prop-models', () => operation(async () => {const {models,warnings}=await loadOsmPropModels(current());return {models,warnings};}));
  handle('osm:building-models', () => operation(async () => {const {models,warnings}=await loadOsmBuildingModels(current());return {models,warnings};}));
  handle('osm:building-styles', () => operation(() => loadOsmShellStyles(current())));
  handle('osm:cancel', token => {if(osmImport?.token===token)osmImport=null;});
  handle('osm:create', (token,selected,options) => operation(async () => {
    const active=current();if(!osmImport||osmImport.project!==active||osmImport.token!==token)throw Error('Nejdřív načtěte oblast pro tento projekt.');
    if(!missionTemplate||missionTemplate.project!==active)throw Error('Nejdřív vyberte šablonu Empty_Mission.zip.');
    const result=await createOsmMission(active,missionTemplate.bytes,osmImport.data,osmImport.area,selected,options);
    osmImport=null;missionTemplate=null;return {...result,project:await active.list()};
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
