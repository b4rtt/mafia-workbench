import { app, BrowserWindow, dialog, ipcMain, protocol, net, session, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { ModProject } from '../core/project.js';
import { parseTextDb } from '../core/textdb.js';
const directory = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(directory, '../ui');
const profileRoot = path.resolve(directory, '../../local/electron-profile');
await fs.mkdir(profileRoot, { recursive: true });
app.setPath('userData', profileRoot);
app.setPath('sessionData', profileRoot);
protocol.registerSchemesAsPrivileged([{ scheme: 'workbench', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let window, project, busy = false;
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
  protocol.handle('workbench', request => {
    const url = new URL(request.url);
    const allowed = new Set(['index.html', 'styles.css', 'app.js']);
    const name = url.pathname.slice(1);
    if (url.host !== 'app' || !allowed.has(name)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(uiRoot, name)).href);
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
  handle('asset:texts', (name, changes, expectedHash) => operation(async () => { await current().saveTexts(name, changes, expectedHash); return current().inspect(name); }));
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
