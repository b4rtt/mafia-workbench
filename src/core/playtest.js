import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { hash, safePath, readSafe, writeSafe } from './files.js';
import { relativeAssetPath } from './dta.js';
import { availableCheckpoints, checkpointFile, checkpointInventory, collectCheckpoints, playtestRevision, projectCheckpointState } from './checkpoints.js';

export const SUPPORTED_GAME_HASH = '303eb95ee2de3433511ce0cb518921dcb96b62b0f64ebfcc436723ff5083f298';
// GOG 1.2 only. Addresses were verified in this exact executable, not borrowed
// from the Game 1.0 reference. Every edit is applied to a new Buffer/copy.
const patches = [
  [0x1bfddc, '68000016446800004844b9c07b6300', 'e937000000'], // Skip all three startup videos.
  [0x204f64, '8b0d8c786300', 'e94b000000'], // Retain HUD/profile initialisation; skip profile/menu scene.
  [0x204fb6, '8bf8', '33ff'], // Continue with the local default profile, not a modal result.
  [0x1bedae, 'e85d1afeff', '9090909090'], // No game_init for an absent menu scene.
  [0x1bee17, '6a30c684248800000001', 'b811000000e95e000000'], // Directly select the mission-loading branch.
  [0x1bf213, 'e9bd010000', 'e9da010000'], // Leaving the level exits instead of returning to the menu.
];
export function patchDirectLevelExe(source, checkpointSlot = null) {
  if (checkpointSlot !== null) checkpointFile(checkpointSlot);
  if (hash(source) !== SUPPORTED_GAME_HASH) throw new Error('Přímé spuštění zatím podporuje pouze ověřené GOG Game.exe 1.2. Původní EXE nebylo změněno.');
  const bytes = Buffer.from(source);
  for (const [offset, expected, replacement] of patches) {
    if (!bytes.subarray(offset, offset + expected.length / 2).equals(Buffer.from(expected, 'hex'))) throw new Error('Instrukce EXE neodpovídají ověřené verzi.');
    Buffer.from(replacement, 'hex').copy(bytes, offset);
  }
  for (const [offset, expected, value] of [[0x237b20, 'tutorial', 'wbtest'], [0x237b04, 'missions\\tutorial\\tree.klz', 'missions\\wbtest\\tree.klz']]) {
    const original = Buffer.from(expected + '\0');
    if (!bytes.subarray(offset, offset + original.length).equals(original)) throw new Error('Cesta mise v EXE neodpovídá ověřené verzi.');
    bytes.fill(0, offset, offset + original.length); bytes.write(value, offset, 'ascii');
  }
  if (checkpointSlot !== null) {
    // Open wbtest first: the native loader compares against the live mission
    // name and cannot run before a scene exists. Then load instead of NewGame,
    // bypassing the subsequent GameInit which would reset restored state.
    const expected = Buffer.from('e8ea700400a18c786300', 'hex');
    if (!bytes.subarray(0x1bef01, 0x1bef01 + expected.length).equals(expected)) throw new Error('Načítání checkpointu: instrukce neodpovídají ověřené verzi.');
    const selector = Buffer.from('c70550466d0000000000c705a4466d0000000000b811000000e94a000000', 'hex');
    selector.writeUInt32LE(checkpointSlot, 16);
    selector.writeInt32LE(0x5bee7f - (0x5bee17 + selector.length), selector.length - 4);
    selector.copy(bytes, 0x1bee17);
    Buffer.from('e84a720400e9f8020000', 'hex').copy(bytes, 0x1bef01);
  }
  return bytes;
}
export function missionFolder(name) {
  const parts = relativeAssetPath(name).split('/');
  if (parts[0].toLowerCase() !== 'missions' || parts.length < 3 || !parts[1] || parts[1].toLowerCase() === 'wbtest') throw new Error('Vyberte soubor konkrétní mise.');
  return `missions/${parts[1]}`;
}
export function wineStartupError(log) {
  if (/nodrv_CreateWindow|The explorer process failed to start\./.test(log)) return 'Wine nedokázalo vytvořit grafické okno hry; viz playtest/game.log.';
  if (/Library not loaded:/.test(log)) return 'Wine nedokázalo načíst potřebnou knihovnu; viz playtest/game.log.';
}
function command(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { ...options, stdio: 'ignore', shell: false });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Příkaz skončil s kódem ${code}.`)));
  });
}
async function ownDirectory(directory) {
  await fs.mkdir(directory, { recursive: true });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Testovací složka není vlastní adresář.');
}
async function cloneFile(sourceRoot, sourceName, destinationRoot, name) {
  const input = await safePath(sourceRoot, sourceName), output = await safePath(destinationRoot, name, true);
  // APFS clone is independent; never a hard link to an original or project asset.
  await fs.copyFile(input, output, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
}
const canonical = name => relativeAssetPath(name).normalize('NFC').toLowerCase();
async function inventory(root) {
  const files = new Map();
  let stat;
  try { stat = await fs.lstat(root); } catch (error) { if (error.code === 'ENOENT') return files; throw error; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Neplatný adresář synchronizace.');
  async function visit(folder = '') {
    for (const entry of await fs.readdir(path.join(root, folder), { withFileTypes: true })) {
      const name = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) files.set(canonical(name), name);
      else throw new Error(`Synchronizace odmítla odkaz nebo jiný typ souboru: ${name}`);
    }
  }
  await visit(); return files;
}
export async function synchronizeAssets(project, game, previous = {}, progress = () => {}) {
  const existing = await inventory(game), mods = await inventory(path.join(project.root, 'mods')), files = Object.create(null);
  const validHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
  const active = new Set(project.manifest.assets.map(asset => canonical(asset.path)));
  // Undoing a newly created mission removes only its tracked private test copies.
  for (const [name, old] of Object.entries(previous)) if (old.created === true && !active.has(name) && existing.has(name)) {
    if (canonical(name) !== name || !validHash(old.applied) || hash(await readSafe(game, existing.get(name))) !== old.applied) throw new Error('Odstraněný soubor nové mise se v testovací kopii změnil mimo editor.');
    await fs.unlink(await safePath(game, existing.get(name))); existing.delete(name);
  }
  const pending = [];
  for (const asset of project.manifest.assets) {
    const target = canonical(asset.path), old = previous[target];
    // The owned snapshot is the baseline. Inventory checks missing files and links
    // without reopening every unchanged original and test copy on every launch.
    if (existing.has(target) && !asset.overlay && !mods.has(target) && old?.source === asset.sha256 && old.applied === asset.sha256 && validHash(old.applied)) files[target] = old;
    else pending.push({ asset, target, old });
  }
  let copied = 0;
  for (let i = 0; i < pending.length; i++) {
    const { asset, target, old } = pending[i], bytes = await project.read(asset.path), applied = hash(bytes);
    let currentHash = old?.source === asset.sha256 && validHash(old.applied) && existing.has(target) ? old.applied : null;
    if (!currentHash && existing.has(target)) currentHash = hash(await readSafe(game, target));
    if (currentHash !== applied) {
      if (existing.has(target)) await writeSafe(game, target, bytes);
      else {
        const origin = asset.overlay ?? (mods.has(target) ? `mods/${mods.get(target)}` : asset.original);
        await cloneFile(project.root, origin, game, target);
        if (hash(await readSafe(game, target)) !== applied) throw new Error('Data projektu se změnila během přípravy testu. Spusťte přípravu znovu.');
      }
      copied++;
    }
    files[target] = { source: asset.sha256, applied, ...(asset.created ? { created: true } : {}) };
    if (i % 500 === 0 || i === pending.length - 1) progress({ phase: 'playtest', current: i + 1, total: pending.length, files: copied });
  }
  return { files, checked: pending.length, copied };
}
export class Playtest {
  constructor(runtime) { this.runtime = runtime; this.child = null; this.session = null; }
  state() { return { running: Boolean(this.child), level: this.session?.level, root: this.session?.root }; }
  async attach(project) {
    if (this.child?.attached) {
      try { process.kill(this.child.pid, 0); }
      catch (error) { if (error.code !== 'ESRCH') throw error; this.child = null; }
    }
    if (this.child || !project) return this.state();
    const root = path.join(project.root, 'playtest'); let snapshot, run;
    try { snapshot = JSON.parse(await readSafe(root, 'snapshot.json')); run = JSON.parse(await readSafe(root, 'run.json')); }
    catch (error) { if (error.code === 'ENOENT') return this.state(); throw error; }
    if (snapshot.format !== 'mafia-workbench-playtest' || snapshot.project !== project.root || run.exited || !Number.isInteger(run.pid) || run.pid < 1) return this.state();
    try { process.kill(run.pid, 0); } catch (error) { if (error.code === 'ESRCH') return this.state(); throw error; }
    this.session = { root, game: path.join(root, 'game'), prefix: path.join(root, 'prefix'), level: snapshot.level, checkpoints: run.checkpoints };
    this.child = { pid: run.pid, attached: true }; return this.state();
  }
  environment(prefix) {
    return { ...process.env, WINEPREFIX: prefix, DYLD_LIBRARY_PATH: this.runtime.dependencies, WINEDEBUG: '-all,err+all', WINEDLLOVERRIDES: 'winemenubuilder.exe=d;winegstreamer=d;winevulkan=d;vulkan-1=d' };
  }
  async checkpoints(project, name) {
    await this.attach(project);
    if (this.child) throw new Error('Pro výběr checkpointu nejprve ukončete běžící test.');
    const root = path.join(project.root, 'playtest');
    return availableCheckpoints(root, path.join(root, 'game'), project, missionFolder(name));
  }
  async prepare(project, name, progress = () => {}, checkpoint = null) {
    await this.attach(project);
    if (this.child) throw new Error('Nejdřív ukončete běžící test levelu.');
    if (process.platform !== 'darwin') throw new Error('Tento adaptér přímého spuštění je zatím určený pro místní Wine na macOS.');
    const level = missionFolder(name), source = await fs.realpath(project.manifest.gameRoot);
    let selected;
    if (checkpoint !== null) {
      if (!checkpoint || typeof checkpoint !== 'object' || !/^[a-f0-9]{64}$/.test(checkpoint.sha256)) throw new Error('Neplatný výběr checkpointu.');
      checkpointFile(checkpoint.slot);
      selected = (await this.checkpoints(project, name)).find(saved => saved.slot === checkpoint.slot && saved.sha256 === checkpoint.sha256);
      if (!selected?.compatible) throw new Error('Checkpoint nepatří k aktuální verzi projektu. Spusťte novou misi a vytvořte nový checkpoint.');
    }
    const executable = patchDirectLevelExe(await readSafe(source, 'Game.exe'), selected?.slot ?? null);
    project.asset(`${level}/scene2.bin`); project.asset(`${level}/scene.4ds`); project.asset(`${level}/tree.klz`);
    await fs.access(this.runtime.wine, constants.X_OK); await fs.access(this.runtime.server, constants.X_OK);
    const root = path.join(project.root, 'playtest'), game = path.join(root, 'game'), prefix = path.join(root, 'prefix');
    await ownDirectory(root); await ownDirectory(game);
    let record;
    try { record = JSON.parse(await readSafe(root, 'snapshot.json')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (record && (record.format !== 'mafia-workbench-playtest' || record.project !== project.root || record.source !== source)) throw new Error('Testovací prostředí patří jinému projektu.');
    if (!record) {
      if ((await fs.readdir(game)).length) throw new Error('Existující herní složka nemá index testovacího prostředí; nebude přepsána.');
      record = { format: 'mafia-workbench-playtest', project: project.root, source, alias: [], initialized: false };
      await writeSafe(root, 'snapshot.json', JSON.stringify(record), true);
    }
    const sync = await synchronizeAssets(project, game, record.files ?? {}, progress);
    const revision = playtestRevision(level, sync.files);
    if (selected && (selected.revision !== revision || hash(await readSafe(game, checkpointFile(selected.slot))) !== selected.sha256)) throw new Error('Herní data nebo checkpoint se od výběru změnily. Spusťte novou misi.');
    for (const filename of await fs.readdir(source)) {
      if (!/\.dll$/i.test(filename)) continue;
      const bytes = await readSafe(source, filename); await writeSafe(game, filename.toLowerCase(), bytes);
    }
    // A private copy of saves preserves the user's progress in the original game.
    if (!record.initialized) {
      try {
        const saves = path.join(source, 'savegame'), stat = await fs.lstat(saves);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Neplatná složka uložených her.');
        for (const filename of await fs.readdir(saves)) if (/^mafia\d+\.(?:sav|\d+)$/i.test(filename)) await writeSafe(game, `savegame/${filename}`, await readSafe(saves, filename));
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    // Remove only stale alias files known from our previous snapshot.
    for (const previous of record?.alias ?? []) {
      if (!previous.startsWith('missions/wbtest/')) throw new Error('Neplatný index testovací mise.');
      const target = await safePath(game, previous); await fs.unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    const alias = [];
    for (const asset of project.manifest.assets.filter(a => a.path.toLowerCase().startsWith(level.toLowerCase() + '/'))) {
      const target = `missions/wbtest/${asset.path.split('/').slice(2).join('/').toLowerCase()}`;
      await writeSafe(game, target, await project.read(asset.path)); alias.push(target);
    }
    await writeSafe(game, 'Game.exe', executable);
    try { await fs.access(prefix); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await command('/bin/cp', ['-cR', this.runtime.prefixTemplate, prefix]);
    }
    const prefixStat = await fs.lstat(prefix); if (!prefixStat.isDirectory() || prefixStat.isSymbolicLink()) throw new Error('Neplatný Wine prefix testu.');
    const devices = path.join(prefix, 'dosdevices');
    for (const device of await fs.readdir(devices)) {
      if (device === 'c:') continue;
      const link = path.join(devices, device), stat = await fs.lstat(link);
      if (!stat.isSymbolicLink()) throw new Error('Neplatný odkaz jednotky v testovacím prefixu.');
      await fs.unlink(link);
    }
    await fs.symlink(game, path.join(devices, 'z:'));
    await writeSafe(root, 'snapshot.json', JSON.stringify({ format: 'mafia-workbench-playtest', project: project.root, source, level, alias, initialized: true, files: sync.files, sourceExe: SUPPORTED_GAME_HASH, testExe: hash(executable), updated: new Date().toISOString() }));
    const saves = await checkpointInventory(game), baseline = Object.fromEntries(Object.entries(saves).map(([slot, save]) => [slot, save.sha256]));
    this.session = { root, game, prefix, level, checkpoints: { baseline, revision, level, projectState: projectCheckpointState(project) } }; return this.session;
  }
  async start(project, name, progress, onExit = () => {}, checkpoint = null) {
    const session = await this.prepare(project, name, progress, checkpoint), log = await fs.open(path.join(session.root, 'game.log'), 'w');
    // A direct Electron -> Wine launch fails to initialise its desktop on macOS.
    // A fresh shell fixes the verified launch path. SIP strips DYLD variables on
    // entering the system shell, so restore this local dependency path there.
    // Paths are positional arguments, never interpolated into shell source.
    const child = spawn('/bin/zsh', ['-f', '-c', 'export DYLD_LIBRARY_PATH="$2"; exec "$1" Game.exe', 'mafia-playtest', this.runtime.wine, this.runtime.dependencies], { cwd: session.game, env: this.environment(session.prefix), stdio: ['ignore', log.fd, log.fd], shell: false, detached: true });
    this.child = child;
    let resolveFinished;
    this.finished = new Promise(resolve => { resolveFinished = resolve; });
    let done = false;
    const finished = async (code, error) => {
      if (done) return; done = true;
      let checkpointError;
      try { await collectCheckpoints(session.root, session.game, session.checkpoints); }
      catch (error) { checkpointError = `Evidence checkpointů: ${error.message}`; }
      await writeSafe(session.root, 'run.json', JSON.stringify({ pid: child.pid, exited: true })).catch(() => {});
      if (this.child === child) this.child = null;
      await log.close().catch(() => {});
      let startupError;
      try { startupError = wineStartupError((await readSafe(session.root, 'game.log')).toString()); } catch { /* Keep the process error if its diagnostic log is unavailable. */ }
      resolveFinished();
      onExit({ ...this.state(), code, error: error?.message ?? startupError ?? checkpointError });
    };
    child.once('error', error => finished(null, error)); child.once('exit', code => finished(code));
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    await writeSafe(session.root, 'run.json', JSON.stringify({ pid: child.pid, exited: done, checkpoints: session.checkpoints }));
    return this.state();
  }
  async stop() {
    if (!this.child || !this.session) return this.state();
    const child = this.child, session = this.session;
    await command(this.runtime.server, ['-k'], { env: this.environment(this.session.prefix) });
    await command(this.runtime.server, ['-w'], { env: this.environment(this.session.prefix) });
    if (!child.attached) await this.finished;
    else {
      try { await collectCheckpoints(session.root, session.game, session.checkpoints); }
      finally { await writeSafe(session.root, 'run.json', JSON.stringify({ pid: child.pid, exited: true })); if (this.child === child) this.child = null; }
    }
    if (this.child === child) this.child = null;
    return this.state();
  }
}
