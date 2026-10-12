import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { hash, safePath, readSafe, writeSafe } from './files.js';
import { relativeAssetPath } from './dta.js';

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
export function patchDirectLevelExe(source) {
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
  return bytes;
}
export function missionFolder(name) {
  const parts = relativeAssetPath(name).split('/');
  if (parts[0].toLowerCase() !== 'missions' || parts.length < 3 || !parts[1] || parts[1].toLowerCase() === 'wbtest') throw new Error('Vyberte soubor konkrétní mise.');
  return `missions/${parts[1]}`;
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
    this.session = { root, game: path.join(root, 'game'), prefix: path.join(root, 'prefix'), level: snapshot.level };
    this.child = { pid: run.pid, attached: true }; return this.state();
  }
  environment(prefix) {
    return { ...process.env, WINEPREFIX: prefix, DYLD_LIBRARY_PATH: this.runtime.dependencies, WINEDEBUG: '-all,err+all', WINEDLLOVERRIDES: 'winemenubuilder.exe=d;winegstreamer=d;winevulkan=d;vulkan-1=d' };
  }
  async prepare(project, name, progress = () => {}) {
    await this.attach(project);
    if (this.child) throw new Error('Nejdřív ukončete běžící test levelu.');
    if (process.platform !== 'darwin') throw new Error('Tento adaptér přímého spuštění je zatím určený pro místní Wine na macOS.');
    const level = missionFolder(name), source = await fs.realpath(project.manifest.gameRoot);
    const executable = patchDirectLevelExe(await readSafe(source, 'Game.exe'));
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
    // Incomplete initial copies are recoverable: each file is compared before reuse.
    for (let i = 0; i < project.manifest.assets.length; i++) {
      const asset = project.manifest.assets[i], bytes = await project.read(asset.path), target = asset.path.toLowerCase();
      let current;
      try { current = await readSafe(game, target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!current || hash(current) !== hash(bytes)) {
        if (current) await writeSafe(game, target, bytes);
        else {
          // Original bytes have already passed their hash check in project.read().
          let origin = asset.original;
          try { await safePath(project.root, `mods/${asset.path}`); await fs.access(path.join(project.root, `mods/${asset.path}`)); origin = `mods/${asset.path}`; } catch (error) { if (error.code !== 'ENOENT') throw error; }
          await cloneFile(project.root, origin, game, target);
          if (hash(await readSafe(game, target)) !== hash(bytes)) throw new Error('Data projektu se změnila během přípravy testu. Spusťte přípravu znovu.');
        }
      }
      if (i % 500 === 0 || i === project.manifest.assets.length - 1) progress({ archive: 'Testovací kopie', current: i + 1, total: project.manifest.assets.length, files: i + 1 });
    }
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
    await writeSafe(root, 'snapshot.json', JSON.stringify({ format: 'mafia-workbench-playtest', project: project.root, source, level, alias, initialized: true, sourceExe: SUPPORTED_GAME_HASH, testExe: hash(executable), updated: new Date().toISOString() }, null, 2));
    this.session = { root, game, prefix, level }; return this.session;
  }
  async start(project, name, progress, onExit = () => {}) {
    const session = await this.prepare(project, name, progress), log = await fs.open(path.join(session.root, 'game.log'), 'w');
    const child = spawn(this.runtime.wine, ['Game.exe'], { cwd: session.game, env: this.environment(session.prefix), stdio: ['ignore', log.fd, log.fd], shell: false });
    this.child = child;
    let resolveFinished;
    this.finished = new Promise(resolve => { resolveFinished = resolve; });
    let done = false;
    const finished = async (code, error) => {
      if (done) return; done = true;
      await writeSafe(session.root, 'run.json', JSON.stringify({ pid: child.pid, exited: true })).catch(() => {});
      if (this.child === child) this.child = null;
      await log.close().catch(() => {});
      resolveFinished();
      onExit({ ...this.state(), code, error: error?.message });
    };
    child.once('error', error => finished(null, error)); child.once('exit', code => finished(code));
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    await writeSafe(session.root, 'run.json', JSON.stringify({ pid: child.pid, exited: done }));
    return this.state();
  }
  async stop() {
    if (!this.child || !this.session) return this.state();
    const child = this.child, session = this.session;
    await command(this.runtime.server, ['-k'], { env: this.environment(this.session.prefix) });
    if (!child.attached) await this.finished;
    else await writeSafe(session.root, 'run.json', JSON.stringify({ pid: child.pid, exited: true }));
    if (this.child === child) this.child = null;
    return this.state();
  }
}
