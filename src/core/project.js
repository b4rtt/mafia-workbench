import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DtaArchive, relativeAssetPath } from './dta.js';
import { hash, safePath, readSafe, writeSafe } from './files.js';
import { parseTextDb, editTextDb } from './textdb.js';
import { inspectScene, editScene, changeSceneObject } from './scene.js';
import { parseFourDs, editFourDs } from './fourds.js';
import { parseFiveDs, editFiveDs } from './fiveds.js';
import { inspectCache, editCache } from './cache.js';
import { parseItems, editItems } from './items.js';
import { parseNavigation, editNavigation, changeNavigationConnection, changeNavigationPoint } from './navigation.js';
import { remapSegments } from './segments.js';
import { parseRoads, editRoads } from './roads.js';
import { parseTrack, editTrack } from './track.js';
import { inspectDifference, editDifference } from './difference.js';
import { inspectReplay, editReplay } from './replay.js';
import { assetCategory } from '../shared/categories.js';
import { readEmptyMissionZip, configureEmptyMission, missionName } from './mission.js';

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
    if (manifest.format !== 'mafia-workbench' || ![1,2].includes(manifest.version) || !Array.isArray(manifest.assets) || !Array.isArray(manifest.history) || manifest.assets.length > 100000) throw new Error('Neplatný projekt Mafia Workbench.');
    if(manifest.version===1&&(manifest.assets.some(asset=>asset.overlay!==undefined)||manifest.history.some(entry=>entry.kind==='batch')))throw new Error('Skupinové vrstvy modu vyžadují formát projektu 2.');
    const seen = new Set();
    for (const asset of manifest.assets) {
      const canonical = key(asset.path);
      if (seen.has(canonical) || !/^originals\//.test(relativeAssetPath(asset.original)) || !/^[0-9a-f]{64}$/.test(asset.sha256)) throw new Error('Neplatný index projektu.');
      if(asset.overlay!==undefined){const match=/^mods\/batches\/[a-f0-9-]+\/(.+)$/.exec(relativeAssetPath(asset.overlay));if(!match||match[1]!==asset.path)throw new Error('Neplatná vrstva modu.');await safePath(root,asset.overlay);}
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
    if(asset.overlay)return readSafe(this.root,asset.overlay);
    try { return await readSafe(this.root, `mods/${asset.path}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return this.original(asset); }
  }
  async list() {
    const result = [];
    for (const asset of this.manifest.assets) {
      const { path: name, size, archive, variants } = asset;
      let modified = false;
      try { modified = hash(await readSafe(this.root, asset.overlay ?? `mods/${name}`)) !== asset.sha256; }
      catch (error) { if (error.code !== 'ENOENT' || asset.overlay) throw error; }
      result.push({ path: name, size, archive, created: asset.created === true, modified: modified || asset.created === true, category: assetCategory(name), variants: variants.length });
    }
    return { name: this.manifest.name, root: this.root, assets: result, history: this.manifest.history.length };
  }
  async change(name, data, label = 'Úprava souboru') {
    if(this.asset(name).overlay)return this.changeBatch([{path:name,data}],label);
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
  async changeBatch(files, label) {
    if(this.busy)throw new Error('Probíhá jiné ukládání.');
    if(!Array.isArray(files)||!files.length||files.length>64)throw new Error('Neplatná skupina úprav.');
    this.busy=true;
    try{
      const rows=[],seen=new Set();let size=0;
      for(const file of files){
        const asset=this.asset(file.path),canonical=key(asset.path);if(seen.has(canonical))throw new Error('Soubor je ve skupině vícekrát.');seen.add(canonical);
        const before=await this.read(asset.path),sha256=hash(before);
        if(file.expectedHash!==undefined&&file.expectedHash!==sha256)throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
        const data=Buffer.from(typeof file.data==='function'?await file.data(before):file.data);size+=data.length;
        if(size>256*1024*1024)throw new Error('Úprava je příliš velká.');await this.original(asset);
        rows.push({asset,before,data,sha256,after:hash(data),previousOverlay:asset.overlay});
      }
      const changed=rows.filter(row=>row.sha256!==row.after);if(!changed.length)return;
      const id=randomUUID(),entry={id,kind:'batch',label,date:new Date().toISOString(),files:[]};
      for(const [index,row] of changed.entries()){
        row.overlay=`mods/batches/${id}/${row.asset.path}`;const backup=`history/${id}-${index}.snapshot`;
        await writeSafe(this.root,backup,row.before,true);await writeSafe(this.root,row.overlay,row.data,true);
        entry.files.push({path:row.asset.path,backup,sha256:row.sha256,after:row.after});
      }
      await writeSafe(this.root,`history/${id}.json`,JSON.stringify(entry),true);
      // Nothing staged is visible until the single atomic manifest replacement.
      for(const row of rows)if(hash(await this.read(row.asset.path))!==row.sha256)throw new Error('Soubor se během ukládání změnil mimo editor.');
      const previousVersion=this.manifest.version;this.manifest.version=2;
      for(const row of changed)row.asset.overlay=row.overlay;this.manifest.history.push(entry);
      try{await this.saveManifest();}
      catch(error){this.manifest.history.pop();this.manifest.version=previousVersion;for(const row of changed){if(row.previousOverlay===undefined)delete row.asset.overlay;else row.asset.overlay=row.previousOverlay;}throw error;}
    }finally{this.busy=false;}
  }
  async createFiles(files, label = 'Přidání souborů') {
    if (this.busy) throw new Error('Probíhá jiné ukládání.');
    if (!Array.isArray(files) || !files.length || files.length > 64) throw new Error('Neplatné nové soubory.');
    this.busy = true;
    const previous = this.manifest.assets;
    try {
      const seen = new Set(), data = files.map(file => {
        const name = relativeAssetPath(file.path), canonical = key(name);
        if (this.index.has(canonical) || seen.has(canonical)) throw new Error(`Soubor již existuje: ${name}`);
        seen.add(canonical); return { path: name, bytes: Buffer.from(file.data) };
      });
      if (data.reduce((sum, f) => sum + f.bytes.length, 0) > 64 * 1024 * 1024) throw new Error('Nové soubory jsou příliš velké.');
      // Refuse unindexed overlays as well.
      for (const file of data) {
        try { await readSafe(this.root, `mods/${file.path}`); throw new Error(`Cílový mod soubor již existuje: ${file.path}`); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const id = randomUUID(), assets = [];
      for (const file of data) {
        const original = `originals/created/${id}/${file.path}`, sha256 = hash(file.bytes);
        await writeSafe(this.root, original, file.bytes, true);
        const variant = { original, sha256, size: file.bytes.length, archive: 'Nová mise' };
        assets.push({ path: file.path, ...variant, created: true, creation: id, variants: [variant] });
      }
      const entry = { id, kind: 'create', files: assets.map(a => ({ path: a.path, sha256: a.sha256 })), label, date: new Date().toISOString() };
      await writeSafe(this.root, `history/${id}.json`, JSON.stringify(entry), true);
      this.manifest.assets = [...previous, ...assets].sort((a,b) => a.path.localeCompare(b.path));
      this.manifest.history.push(entry);
      try { await this.saveManifest(); }
      catch (error) { this.manifest.assets = previous; this.manifest.history.pop(); throw error; }
      this.index = new Map(this.manifest.assets.map(a => [key(a.path), a]));
    } finally { this.busy = false; }
  }
  async createMission(zip, options) {
    const name = missionName(options?.name), folder = `missions/${name}/`;
    if (this.manifest.assets.some(a => key(a.path).startsWith(folder.toLowerCase()))) throw new Error('Mise tohoto názvu již existuje.');
    const template = readEmptyMissionZip(zip), files = configureEmptyMission(template, options);
    this.asset(options.model); // The player model must be supplied by this project.
    if (!parseFourDs(await this.read(options.model)).meshes.some(m => m.type === 10)) throw new Error('Model hráče musí mít kostru (klouby typu 10).');
    await this.createFiles([...files].map(([file, data]) => ({ path: folder + file, data })), `Nová mise ${name}`);
    return folder + 'scene2.bin';
  }
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
        if (existing?.created) throw new Error(`Volný soubor koliduje s novou misí v modu: ${name}`);
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
  async changeSceneObject(name, operation, expectedHash) {
    if (!/^missions\/[^/]+\/scene2\.bin$/i.test(name)) throw new Error('Vyberte scene2.bin mise.');
    await this.change(name, async before => {
      if (expectedHash !== hash(before)) throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      const folder = this.asset(name).path.slice(0, this.asset(name).path.lastIndexOf('/'));
      const geometry = parseFourDs(await this.read(`${folder}/scene.4ds`));
      let request = operation;
      if (operation?.kind === 'add-model') {
        if (typeof operation.model !== 'string' || !/^models\/[^/\\]+\.4ds$/i.test(operation.model)) throw new Error('Vyberte model z hlavní složky models.');
        parseFourDs(await this.read(operation.model), true);
        request = { ...operation, model: this.asset(operation.model).path.slice(7).replace(/\.4ds$/i, '.i3d') };
      }
      return changeSceneObject(before, request, geometry.meshes.map(mesh => mesh.name));
    }, { 'add-model': 'Vložení modelu do mise', duplicate: 'Duplikace objektu mise', delete: 'Odstranění objektu mise' }[operation?.kind] ?? 'Úprava objektů mise');
  }
  async inspect(name) {
    const asset = this.asset(name), bytes = await this.read(name);
    const common = { path: asset.path, size: bytes.length, sha256: hash(bytes) };
    if (/textdb_[a-z]{2}\.def$/i.test(name)) return { type: 'textdb', ...parseTextDb(bytes, name), path: asset.path, size: bytes.length, sha256: hash(bytes) };
    if (/scene2\.bin$/i.test(name)) return { type: 'scene', ...inspectScene(bytes), path: asset.path, size: bytes.length, sha256: hash(bytes) };
    let warning;
    if (/\.tck$/i.test(name)) {
      try { return { type: 'track', ...common, ...parseTrack(bytes) }; }
      catch (error) { warning = error.message; }
    }
    if (/\.chg$/i.test(name)) {
      try { return { type: 'difference', ...common, ...inspectDifference(bytes) }; }
      catch (error) { warning = error.message; }
    }
    if (/\.rep$/i.test(name)) {
      try { return { type: 'replay', ...common, ...inspectReplay(bytes) }; }
      catch (error) { warning = error.message; }
    }
    if (/^missions\/[^/]+\/check\.bin$/i.test(name)) {
      try { return { type: 'navigation', ...common, ...parseNavigation(bytes) }; }
      catch (error) { warning = error.message; }
    }
    if (/^missions\/[^/]+\/road\.bin$/i.test(name)) {
      try { return { type: 'roads', ...common, ...parseRoads(bytes) }; }
      catch (error) { warning = error.message; }
    }
    if (/^tables\/predmety\.def$/i.test(name)) {
      try { return { type: 'items', ...common, ...parseItems(bytes) }; }
      catch (error) { warning = error.message; }
    }
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
  async saveItems(name, changes, expectedHash) {
    if (!/^tables\/predmety\.def$/i.test(name)) throw new Error('Soubor není tabulka předmětů.');
    await this.change(name, before => {
      if (expectedHash !== hash(before)) throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      return editItems(before, changes);
    }, 'Úprava zbraní a předmětů');
  }
  async saveNavigation(name, changes, expectedHash) {
    if (!/^missions\/[^/]+\/check\.bin$/i.test(name)) throw new Error('Soubor není check.bin mise.');
    await this.change(name, before => {
      if (expectedHash !== hash(before)) throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      return editNavigation(before, changes);
    }, 'Úprava navigačních bodů a vazeb');
  }
  async changeNavigationConnection(name, request, expectedHash) {
    if (!/^missions\/[^/]+\/check\.bin$/i.test(name)) throw new Error('Soubor není check.bin mise.');
    await this.change(name, before => {
      if (expectedHash !== hash(before)) throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      return changeNavigationConnection(before, request);
    }, request?.action === 'disconnect' ? 'Odpojení navigačních bodů' : 'Propojení navigačních bodů');
  }
  async changeNavigationPoint(name, request, expectedHash) {
    if(!/^missions\/[^/]+\/check\.bin$/i.test(name))throw new Error('Soubor není check.bin mise.');
    const before=await this.read(name);if(hash(before)!==expectedHash)throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
    const changed=changeNavigationPoint(before,request),files=[{path:name,data:changed.data,expectedHash}],segment=this.index.get(key(name.replace(/check\.bin$/i,'clusters.seg')));
    if(segment){const source=await this.read(segment.path);files.push({path:segment.path,data:remapSegments(source,changed.mapping,changed.pointCount),expectedHash:hash(source)});}
    await this.changeBatch(files,request?.action==='add'?'Přidání navigačního bodu':'Odstranění navigačního bodu');
    return changed.index;
  }
  async saveTrack(name, changes, expectedHash) {
    if (!/\.tck$/i.test(name)) throw new Error('Soubor není TCK stopa.');
    await this.change(name, before => {
      if (expectedHash !== hash(before)) throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      return editTrack(before, changes);
    }, 'Úprava pohybové stopy TCK');
  }
  async saveRoads(name, changes, expectedHash) {
    if (!/^missions\/[^/]+\/road\.bin$/i.test(name)) throw new Error('Soubor není road.bin mise.');
    await this.change(name, before => {
      if (expectedHash !== hash(before)) throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      return editRoads(before, changes);
    }, 'Úprava parametrů silniční sítě');
  }
  async saveDifference(name, changes, expectedHash) {
    if (!/\.chg$/i.test(name)) throw new Error('Soubor není CHG rozdíl scény.');
    await this.change(name, before => {
      if (expectedHash !== hash(before)) throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      return editDifference(before, changes);
    }, 'Úprava objektů a skriptů CHG');
  }
  async saveReplay(name, changes, expectedHash) {
    if (!/\.rep$/i.test(name)) throw new Error('Soubor není REP záznam.');
    await this.change(name, before => {
      if (expectedHash !== hash(before)) throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      return editReplay(before, changes);
    }, 'Úprava časové osy REP');
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
    if (entry.kind === 'create') return this.undoCreation(entry);
    if(entry.kind==='batch'||this.asset(entry.path).overlay)return this.undoBatch(entry);
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
  async undoBatch(entry) {
    if(this.busy)throw new Error('Probíhá jiné ukládání.');
    const files=entry.kind==='batch'?entry.files:[entry];
    if(!Array.isArray(files)||!files.length||files.length>64)throw new Error('Neplatná skupinová historie.');
    this.busy=true;
    try{
      const rows=[],seen=new Set(),id=randomUUID();
      for(const file of files){
        const asset=this.asset(file.path),canonical=key(asset.path);if(seen.has(canonical)||!/^history\/[a-f0-9-]+\.snapshot$/.test(file.backup))throw new Error('Neplatná záloha historie.');seen.add(canonical);
        const before=await readSafe(this.root,file.backup),after=await this.read(asset.path);
        if(hash(before)!==file.sha256||hash(after)!==file.after)throw new Error('Historie neodpovídá aktuálním datům; soubor mohl být změněn mimo editor.');
        await this.original(asset);rows.push({asset,before,after:hash(after),previousOverlay:asset.overlay,overlay:`mods/batches/${id}/${asset.path}`});
      }
      for(const row of rows)await writeSafe(this.root,row.overlay,row.before,true);
      for(const row of rows)if(hash(await this.read(row.asset.path))!==row.after)throw new Error('Soubor se během vracení změnil mimo editor.');
      for(const row of rows)row.asset.overlay=row.overlay;this.manifest.history.pop();
      try{await this.saveManifest();}
      catch(error){this.manifest.history.push(entry);for(const row of rows){if(row.previousOverlay===undefined)delete row.asset.overlay;else row.asset.overlay=row.previousOverlay;}throw error;}
    }finally{this.busy=false;}
  }
  async undoCreation(entry) {
    if (this.busy) throw new Error('Probíhá jiné ukládání.');
    if (!Array.isArray(entry.files) || !entry.files.length || entry.files.length > 64) throw new Error('Neplatná historie nových souborů.');
    this.busy = true;
    const previous = this.manifest.assets, overlays = [];
    try {
      const removed = new Set();
      for (const file of entry.files) {
        const asset = this.asset(file.path);
        if (!asset.created || asset.creation !== entry.id || removed.has(key(file.path)) || hash(await this.read(file.path)) !== file.sha256) throw new Error('Historie neodpovídá aktuálním datům nové mise.');
        await this.original(asset); removed.add(key(file.path));
        try { const bytes=await readSafe(this.root, `mods/${asset.path}`);if(asset.overlay&&hash(bytes)!==file.sha256)throw new Error('Historie neodpovídá skryté vrstvě souboru nové mise.');overlays.push({ path: `mods/${asset.path}`, bytes }); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      // Remove only verified overlays, with rollback if publication fails.
      try {
        for (const overlay of overlays) await fs.unlink(await safePath(this.root, overlay.path));
        this.manifest.assets = previous.filter(a => !removed.has(key(a.path))); this.manifest.history.pop();
        await this.saveManifest();
      } catch (error) {
        this.manifest.assets = previous;
        if (this.manifest.history.at(-1) !== entry) this.manifest.history.push(entry);
        for (const overlay of overlays) await writeSafe(this.root, overlay.path, overlay.bytes);
        throw error;
      }
      this.index = new Map(this.manifest.assets.map(a => [key(a.path), a]));
    } finally { this.busy = false; }
  }
  async export(destination) {
    await fs.mkdir(destination);
    const exported = [];
    for (const asset of this.manifest.assets) {
      const data = await this.read(asset.path);
      if (!asset.created && hash(data) === asset.sha256) continue;
      await writeSafe(destination, asset.path, data, true);
      exported.push({ path: asset.path, sha256: hash(data), sourceSha256: asset.created ? null : asset.sha256, ...(asset.created ? { created: true } : {}) });
    }
    await writeSafe(destination, 'mafia-mod.json', JSON.stringify({ format: 'mafia-workbench-mod', version: 1, files: exported }, null, 2), true);
    return exported.length;
  }
}
