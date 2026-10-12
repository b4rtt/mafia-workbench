import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DtaArchive, relativeAssetPath } from './dta.js';
import { hash, safePath, readSafe, writeSafe } from './files.js';
import { parseTextDb, editTextDb } from './textdb.js';
import { inspectScene, editScene } from './scene.js';
import { parseFourDs, editFourDs } from './fourds.js';
import { parseFiveDs, editFiveDs } from './fiveds.js';
import { inspectCache, editCache } from './cache.js';
import { assetCategory } from '../shared/categories.js';

const MANIFEST = 'workbench.json';
const key = p => relativeAssetPath(p).normalize('NFC').toLowerCase();
export async function createProject(gameRoot, destination, progress = () => {}) {
  gameRoot = await fs.realpath(gameRoot);
  const parent = await fs.realpath(path.dirname(destination));
  destination = path.join(parent, path.basename(destination));
  if (destination === gameRoot || destination.startsWith(gameRoot + path.sep)) throw new Error('Projekt musí být mimo původní složku hry.');
  const files = (await fs.readdir(gameRoot)).filter(n => /\.dta$/i.test(n)).sort((a, b) => a.localeCompare(b, 'en'));
  // Keep all archive variants; A8 is the patch layer for this supported installation.
  files.sort((a, b) => Number(/^a8\.dta$/i.test(a)) - Number(/^a8\.dta$/i.test(b)));
  if (!files.length) throw new Error('Vybraná složka neobsahuje DTA archivy.');
  await fs.mkdir(destination); // Exclusive: never overwrite an existing project.
  const manifest = { format: 'mafia-workbench', version: 1, name: path.basename(destination), created: new Date().toISOString(), gameRoot, archives: [], assets: [], history: [] };
  const assets = new Map();
  try {
    for (const filename of files) {
      const archivePath = await safePath(gameRoot, filename);
      const bytes = await fs.readFile(archivePath);
      const archive = new DtaArchive(bytes, filename);
      const archiveId = filename.toLowerCase().replace('.dta', '');
      manifest.archives.push({ name: filename, sha256: hash(bytes), files: archive.entries.length });
      for (let i = 0; i < archive.entries.length; i++) {
        const entry = archive.entries[i], canonical = key(entry.path), data = archive.read(entry);
        const original = `originals/${archiveId}/${entry.path}`;
        await writeSafe(destination, original, data, true);
        const previous = assets.get(canonical);
        const variant = { archive: filename, original, sha256: hash(data), size: data.length };
        const asset = { path: entry.path, ...variant, variants: [...(previous?.variants ?? []), variant] };
        assets.set(canonical, asset);
        if (i % 25 === 0 || i === archive.entries.length - 1) progress({ archive: filename, current: i + 1, total: archive.entries.length, files: assets.size });
      }
    }
    manifest.assets = [...assets.values()].sort((a, b) => a.path.localeCompare(b.path));
    const project = new ModProject(destination, manifest);
    await project.importLoose(progress);
    return project;
  } catch (error) {
    // Retain partial files for diagnosis, but without a manifest they cannot be opened/applied.
    await writeSafe(destination, 'extraction-failed.txt', String(error)).catch(() => {});
    throw new Error(`Extrakce selhala. Původní hra zůstala beze změny. Rozpracovaný projekt: ${destination}\n${error.message}`);
  }
}
export class ModProject {
  constructor(root, manifest) { this.root = root; this.manifest = manifest; this.busy = false; this.index = new Map(manifest.assets.map(a => [key(a.path), a])); }
  static async open(root) {
    root = path.resolve(root);
    const manifest = JSON.parse(await readSafe(root, MANIFEST));
    if (manifest.format !== 'mafia-workbench' || manifest.version !== 1 || !Array.isArray(manifest.assets) || !Array.isArray(manifest.history) || manifest.assets.length > 100000) throw new Error('Neplatný projekt Mafia Workbench.');
    const seen = new Set();
    for (const asset of manifest.assets) {
      const canonical = key(asset.path);
      if (seen.has(canonical) || !/^originals\//.test(relativeAssetPath(asset.original)) || !/^[0-9a-f]{64}$/.test(asset.sha256)) throw new Error('Neplatný index projektu.');
      seen.add(canonical);
      await safePath(root, asset.original);
    }
    return new ModProject(root, manifest);
  }
  asset(name) {
    const asset = this.index.get(key(name));
    if (!asset) throw new Error('Soubor není v projektu.');
    return asset;
  }
  async original(asset) {
    const bytes = await readSafe(this.root, asset.original);
    if (hash(bytes) !== asset.sha256) throw new Error(`Původní kopie ${asset.path} byla změněna mimo editor.`);
    return bytes;
  }
  async read(name) {
    const asset = this.asset(name);
    try { return await readSafe(this.root, `mods/${asset.path}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return this.original(asset); }
  }
  async list() {
    const result = [];
    for (const asset of this.manifest.assets) {
      const { path: name, size, archive, variants } = asset;
      let modified = false;
      try { modified = hash(await readSafe(this.root, `mods/${name}`)) !== asset.sha256; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      result.push({ path: name, size, archive, modified, category: assetCategory(name), variants: variants.length });
    }
    return { name: this.manifest.name, root: this.root, assets: result, history: this.manifest.history.length };
  }
  async change(name, data, label = 'Úprava souboru') {
    if (this.busy) throw new Error('Probíhá jiné ukládání.');
    this.busy = true;
    try {
      const asset = this.asset(name), before = await this.read(name);
      data = Buffer.from(typeof data === 'function' ? await data(before) : data);
      if (data.length > 256 * 1024 * 1024) throw new Error('Úprava je příliš velká.');
      if (hash(before) === hash(data)) return;
      await this.original(asset);
      const id = randomUUID(), backup = `history/${id}.snapshot`;
      await writeSafe(this.root, backup, before, true);
      const entry = { id, path: asset.path, backup, sha256: hash(before), after: hash(data), label, date: new Date().toISOString() };
      // Durable journal precedes the overlay; a crash never loses the previous data.
      await writeSafe(this.root, `history/${id}.json`, JSON.stringify(entry), true);
      await writeSafe(this.root, `mods/${asset.path}`, data);
      this.manifest.history.push(entry);
      try { await this.saveManifest(); }
      catch (error) { this.manifest.history.pop(); await writeSafe(this.root, `mods/${asset.path}`, before); throw error; }
    } finally { this.busy = false; }
  }
  async saveManifest() { await writeSafe(this.root, MANIFEST, JSON.stringify(this.manifest, null, 2)); }
  async importLoose(progress = () => {}) {
    if (this.busy) throw new Error('Probíhá jiné ukládání.');
    if (!this.manifest.gameRoot) throw new Error('Projekt nemá zadaný zdroj hry.');
    this.busy = true;
    const previous = this.manifest.assets;
    try {
      const source = await fs.realpath(this.manifest.gameRoot), paths = [];
      const folders = new Set(['sounds', 'music', 'maps', 'models', 'anims', 'missions', 'tables', 'system']);
      async function walk(relative = '') {
        const directory = path.join(source, relative);
        const stat = await fs.lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Volná herní data obsahují neplatnou složku.');
        for (const item of await fs.readdir(directory, { withFileTypes: true })) {
          const name = relative ? `${relative}/${item.name}` : item.name;
          if (item.isSymbolicLink()) throw new Error('Volná herní data obsahují symbolický odkaz.');
          if (item.isDirectory() && (relative || folders.has(item.name.toLowerCase()))) await walk(name);
          else if (item.isFile() && (relative || /\.bik$/i.test(item.name))) paths.push(name);
        }
      }
      await walk();
      const assets = new Map(this.index); let imported = 0;
      for (let i = 0; i < paths.length; i++) {
        const name = paths[i], canonical = key(name), existing = assets.get(canonical);
        if (existing?.variants.some(v => v.archive === 'Volné soubory')) continue;
        const bytes = await readSafe(source, name);
        if (bytes.length > 1024 * 1024 * 1024) throw new Error(`Volný soubor je příliš velký: ${name}`);
        const original = `originals/loose/${name}`, variant = { archive: 'Volné soubory', original, sha256: hash(bytes), size: bytes.length };
        try { await writeSafe(this.root, original, bytes, true); }
        catch (error) { if (error.code !== 'EEXIST' || hash(await readSafe(this.root, original)) !== variant.sha256) throw error; }
        assets.set(canonical, { path: existing?.path ?? name, ...variant, variants: [...(existing?.variants ?? []), variant] }); imported++;
        if (i % 25 === 0 || i === paths.length - 1) progress({ archive: 'Volné soubory', current: i + 1, total: paths.length, files: assets.size });
      }
      this.manifest.assets = [...assets.values()].sort((a, b) => a.path.localeCompare(b.path));
      await this.saveManifest(); this.index = assets;
      return imported;
    } catch (error) { this.manifest.assets = previous; throw error; }
    finally { this.busy = false; }
  }
  async saveTexts(name, changes, expectedHash) {
    if (!/textdb_[a-z]{2}\.def$/i.test(name)) throw new Error('Soubor není TextDB.');
    await this.change(name, before => {
      if (expectedHash !== hash(before)) throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      return editTextDb(before, name, changes);
    }, 'Úprava textů');
  }
  async saveScene(name, changes, expectedHash) {
    if (!/scene2\.bin$/i.test(name) || !Array.isArray(changes) || changes.length > 1024) throw new Error('Neplatná úprava scény.');
    await this.change(name, before => {
      if (expectedHash !== hash(before)) throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      let result = before;
      for (const { id, value } of changes) result = editScene(result, id, value);
      return result;
    }, 'Úprava scény a skriptů');
  }
  async inspect(name) {
    const asset = this.asset(name), bytes = await this.read(name);
    const common = { path: asset.path, size: bytes.length, sha256: hash(bytes) };
    if (/textdb_[a-z]{2}\.def$/i.test(name)) return { type: 'textdb', ...parseTextDb(bytes, name), path: asset.path, size: bytes.length, sha256: hash(bytes) };
    if (/scene2\.bin$/i.test(name)) return { type: 'scene', ...inspectScene(bytes), path: asset.path, size: bytes.length, sha256: hash(bytes) };
    let warning;
    if (/\bcache\.bin$/i.test(name)) {
      try { return { type: 'cache', ...common, ...inspectCache(bytes) }; }
      catch (error) { warning = error.message; }
    }
    if (/\.5ds$/i.test(name)) {
      try { return { type: 'animation', ...common, ...parseFiveDs(bytes) }; }
      catch (error) { warning = error.message; }
    }
    if (/\.4ds$/i.test(name)) {
      try { return { type: 'model', ...common, ...parseFourDs(bytes, true) }; }
      catch (error) { warning = error.message; }
    }
    if (/\.(bmp|png|jpe?g)$/i.test(name)) return { type: 'image', ...common };
    if (/\.(wav|ogg|mp3)$/i.test(name)) return { type: 'audio', ...common };
    return { type: 'binary', ...common, warning, hex: bytes.subarray(0, 4096).toString('hex'), signature: bytes.subarray(0, 16).toString('ascii').replace(/[^\x20-\x7e]/g, '.') };
  }
  async saveModel(name, changes, expectedHash) {
    if (!/\.4ds$/i.test(name)) throw new Error('Soubor není 4DS model.');
    await this.change(name, before => {
      if (expectedHash !== hash(before)) throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      return editFourDs(before, changes);
    }, 'Úprava modelu 4DS');
  }
  async saveAnimation(name, changes, expectedHash) {
    if (!/\.5ds$/i.test(name)) throw new Error('Soubor není 5DS animace.');
    await this.change(name, before => {
      if (expectedHash !== hash(before)) throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      return editFiveDs(before, changes);
    }, 'Úprava klíčů animace 5DS');
  }
  async saveCache(name, changes, expectedHash) {
    if (!/\bcache\.bin$/i.test(name)) throw new Error('Soubor není cache.bin.');
    await this.change(name, before => {
      if (expectedHash !== hash(before)) throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      return editCache(before, changes);
    }, 'Úprava statických modelů cache.bin');
  }
  async inspectMap(name) {
    if (!/scene2\.bin$/i.test(name)) throw new Error('Vyberte scene2.bin mapy.');
    const scene = await this.inspect(name), folder = scene.path.slice(0, scene.path.lastIndexOf('/'));
    const geometry = await this.inspect(`${folder}/scene.4ds`);
    if (geometry.type !== 'model') throw new Error(geometry.warning ?? 'Geometrii této mapy zatím nelze přečíst.');
    return { ...scene, type: 'map', geometry };
  }
  async restore(name) { const asset = this.asset(name); await this.change(name, await this.original(asset), 'Obnovení originálu'); }
  async undo() {
    const entry = this.manifest.history.at(-1);
    if (!entry) return;
    if (!/^history\/[a-f0-9-]+\.snapshot$/.test(entry.backup)) throw new Error('Neplatná záloha historie.');
    const before = await readSafe(this.root, entry.backup);
    const after = await this.read(entry.path);
    if (hash(before) !== entry.sha256 || hash(after) !== entry.after) throw new Error('Historie neodpovídá aktuálním datům; soubor mohl být změněn mimo editor.');
    if (this.busy) throw new Error('Probíhá jiné ukládání.');
    this.busy = true;
    try {
      await writeSafe(this.root, `mods/${this.asset(entry.path).path}`, before);
      this.manifest.history.pop();
      try { await this.saveManifest(); }
      catch (error) { this.manifest.history.push(entry); await writeSafe(this.root, `mods/${this.asset(entry.path).path}`, after); throw error; }
    } finally { this.busy = false; }
  }
  async export(destination) {
    await fs.mkdir(destination);
    const exported = [];
    for (const asset of this.manifest.assets) {
      const data = await this.read(asset.path);
      if (hash(data) === asset.sha256) continue;
      await writeSafe(destination, asset.path, data, true);
      exported.push({ path: asset.path, sha256: hash(data), sourceSha256: asset.sha256 });
    }
    await writeSafe(destination, 'mafia-mod.json', JSON.stringify({ format: 'mafia-workbench-mod', version: 1, files: exported }, null, 2), true);
    return exported.length;
  }
}
