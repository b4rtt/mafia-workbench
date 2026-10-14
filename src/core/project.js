import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DtaArchive, relativeAssetPath } from './dta.js';
import { hash, safePath, readSafe, writeSafe } from './files.js';
import { parseTextDb, editTextDb, addTextDbEntry } from './textdb.js';
import { inspectScene, editScene, changeSceneObject } from './scene.js';
import { parseFourDs, editFourDs } from './fourds.js';
import { parseFiveDs, editFiveDs } from './fiveds.js';
import { editAnimationTimeline } from './animation-timeline.js';
import { inspectCache, editCache } from './cache.js';
import { parseItems, editItems } from './items.js';
import { pickupParameters } from '../shared/pickups.js';
import { resolveMissionFlow } from '../shared/mission-flow.js';
import { missionTaskScript } from '../shared/mission-task.js';
import { inspectMissionDestination } from './mission-destination.js';
import { createTerrain } from './terrain.js';
import { missionDialogueScript, dialogueSpeakers } from '../shared/mission-dialogue.js';
import { dialogueSoundPath, prepareDialogueWav } from './dialogue-audio.js';
import { parseNavigation, prepareNavigationEdits, changeNavigationConnection, changeNavigationPoint } from './navigation.js';
import { remapSegments } from './segments.js';
import { parseRoads, prepareRoadEdits, changeRoadPoint } from './roads.js';
import { changeRoadTopology } from './road-topology.js';
import { parseTrack, editTrack } from './track.js';
import { inspectDifference, editDifference } from './difference.js';
import { inspectReplay, editReplay } from './replay.js';
import { assetCategory } from '../shared/categories.js';
import { readEmptyMissionZip, configureEmptyMission, missionName } from './mission.js';
import { parseCollision } from './collision.js';
import { collisionOwnership, ownedCollisionRecords, prepareSceneCollision, collisionSurfacePreview } from './scene-collision.js';
import { parseVehicleTable, vehicleModelDefinition, validateVehicleModel } from './vehicles.js';
import { inspectVehicleTable, editVehicleTable } from './vehicle-table.js';
import { parseEffects, editEffects, changeEffects, parseEffectTypes } from './effects.js';
import { parseEffectDefinitions, editEffectDefinitions } from './effect-types.js';
import { parseBmp, editBmp } from './bmp.js';
import { inspectModelGeometry, editModelGeometry } from './model-geometry.js';
import { inspectProjectCollision, saveProjectCollision } from './collision-project.js';
import { modelImportPlan, importModel } from './model-import.js';

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
    if(/scene2\.bin$/i.test(name)&&collisionOwnership(this.manifest,name).length){
      const before=await this.read(name),after=Buffer.from(typeof data==='function'?await data(before):data),collision=await prepareSceneCollision(this,name,before,after);
      return this.changeBatch([{path:name,data:after,expectedHash:hash(before)},...collision.files],label,collision.ownership);
    }
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
  async changeBatch(files, label, collisionSnapshot) {
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
      if(collisionSnapshot)entry.collisionOwnership=collisionSnapshot;
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
  async createFiles(files, label = 'Přidání souborů', dependencies = [], archive = 'Nová mise') {
    if (this.busy) throw new Error('Probíhá jiné ukládání.');
    if (!Array.isArray(files) || !files.length || files.length > 64) throw new Error('Neplatné nové soubory.');
    if (!Array.isArray(dependencies) || dependencies.length > 64) throw new Error('Neplatné závislosti nových souborů.');
    this.busy = true;
    const previous = this.manifest.assets;
    try {
      const checkDependencies=async()=>{for(const dependency of dependencies)if(typeof dependency.expectedHash!=='string'||hash(await this.read(dependency.path))!==dependency.expectedHash)throw new Error('Závislý soubor se během přidávání změnil. Otevřete dialog znovu.');};
      await checkDependencies();
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
        const variant = { original, sha256, size: file.bytes.length, archive };
        assets.push({ path: file.path, ...variant, created: true, creation: id, variants: [variant] });
      }
      const entry = { id, kind: 'create', files: assets.map(a => ({ path: a.path, sha256: a.sha256 })), label, date: new Date().toISOString() };
      await writeSafe(this.root, `history/${id}.json`, JSON.stringify(entry), true);
      await checkDependencies();
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
  async previewModelImport(files, name) { return modelImportPlan(this, files, name); }
  async createTerrain(options,textureHash){return createTerrain(this,options,textureHash);}
  async importModel(files, name, expected) { return importModel(this, files, name, expected); }
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
  async addText(name, entry, expectedHash) {
    if (!/textdb_[a-z]{2}\.def$/i.test(name)) throw new Error('Soubor není TextDB.');
    await this.change(name, before => {
      if (expectedHash !== hash(before)) throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      return addTextDbEntry(before,name,entry);
    }, 'Nový text pro misi nebo dialog');
  }
  async importDialogue(name, id, source, expectedTextHash, expectedSoundHash = null) {
    const textPath=relativeAssetPath(name),soundPath=dialogueSoundPath(id),{bytes,info}=prepareDialogueWav(source);
    if(!/^tables\/textdb_[a-z]{2}\.def$/i.test(textPath))throw new Error('Dabing: vyberte jazykovou tabulku TextDB.');
    const text=await this.read(textPath);
    if(hash(text)!==expectedTextHash)throw new Error('Dabing: texty se od otevření změnily. Otevřete je znovu.');
    const entries=parseTextDb(text,textPath).entries;
    if(!entries.slice(0,-1).some(entry=>entry.id===id))throw new Error('Dabing: ID textu neexistuje nebo jde o hraniční záznam.');
    const existing=this.index.get(key(soundPath));
    if(existing){
      if(typeof expectedSoundHash!=='string')throw new Error('Dabing již existuje. Nejprve načtěte jeho aktuální verzi.');
      await this.changeBatch([{path:existing.path,data:bytes,expectedHash:expectedSoundHash},{path:textPath,data:text,expectedHash:expectedTextHash}],`Nahrazení dabingu ${id}`);
    }else{
      if(expectedSoundHash!==null)throw new Error('Dabing se od otevření změnil. Otevřete dialog znovu.');
      await this.createFiles([{path:soundPath,data:bytes}],`Import dabingu ${id}`,[{path:textPath,expectedHash:expectedTextHash}],'Vlastní dabing');
    }
    return {path:existing?.path??soundPath,...info};
  }
  async saveScene(name, changes, expectedHash) {
    if (!/scene2\.bin$/i.test(name) || !Array.isArray(changes) || changes.length > 1024) throw new Error('Neplatná úprava scény.');
    // Removing a loop chunk shifts the IDs of later sound properties. Apply
    // structural loop toggles after all fields referenced by the original IDs.
    const ordered=changes.filter(change=>!change.id?.endsWith(':sound.loop')).concat(changes.filter(change=>change.id?.endsWith(':sound.loop')));
    const before=await this.read(name);if(hash(before)!==expectedHash)throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
    const pickups=inspectScene(before).objects.filter(object=>object.pickup && ordered.some(change=>change.id===object.fields.name && change.value!==object.name));
    if(collisionOwnership(this.manifest,name).length || pickups.length){
      let after=before;for(const {id,value} of ordered)after=editScene(after,id,value);
      const oldScene=inspectScene(before),newScene=inspectScene(after),renames=new Map();
      for(const object of oldScene.objects){const current=newScene.objects.find(o=>o.id===object.id);if(current&&current.name!==object.name)renames.set(object.name,current.name);}
      const dependencies=[];
      if(pickups.length){
        const geometryPath=name.slice(0,name.lastIndexOf('/'))+'/scene.4ds',bytes=await this.read(geometryPath),geometry=parseFourDs(bytes);
        for(const object of pickups)if(geometry.meshes.some(mesh=>key(mesh.name)===key(renames.get(object.name))))throw new Error('Předmět: název již existuje v geometrii mise.');
        dependencies.push({path:geometryPath,data:bytes,expectedHash:hash(bytes)});
      }
      const collision=collisionOwnership(this.manifest,name).length?await prepareSceneCollision(this,name,before,after,{renames}):null;
      const files=new Map([{path:name,data:after,expectedHash},...dependencies,...(collision?.files??[])].map(file=>[key(file.path),file]));
      return this.changeBatch([...files.values()],'Úprava scény a jejích vazeb',collision?.ownership);
    }
    await this.change(name, before => {
      if (expectedHash !== hash(before)) throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      let result = before;
      for (const { id, value } of ordered) result = editScene(result, id, value);
      return result;
    }, 'Úprava scény a skriptů');
  }
  async changeSceneObject(name, operation, expectedHash) {
    if (!/^missions\/[^/]+\/scene2\.bin$/i.test(name)) throw new Error('Vyberte scene2.bin mise.');
    const before=await this.read(name);
    if (expectedHash !== hash(before)) throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
    const folder = this.asset(name).path.slice(0, this.asset(name).path.lastIndexOf('/'));
    const geometryPath=`${folder}/scene.4ds`,geometryBytes=await this.read(geometryPath),geometry = parseFourDs(geometryBytes);
    let request = operation;const dependencies=[];
    if(['add-pickup','configure-pickup'].includes(operation?.kind)){
      pickupParameters(operation.itemId,operation.clip,operation.reserve);
      const tablePath=this.asset('tables/predmety.def').path,tableBytes=await this.read(tablePath);
      if(operation.itemTableHash!==hash(tableBytes))throw new Error('Tabulka předmětů se od otevření změnila. Otevřete dialog znovu.');
      const item=parseItems(tableBytes).records[operation.itemId];
      if(!item?.model||!/^([^/\\]+)\.i3d$/i.test(item.model))throw new Error('Předmět nemá dostupný model v hlavní složce models.');
      const modelPath=this.asset(`models/${item.model.replace(/\.i3d$/i,'.4ds')}`).path,modelBytes=await this.read(modelPath),model=parseFourDs(modelBytes,true);
      if(operation.itemModelHash!==hash(modelBytes))throw new Error('Model předmětu se od otevření změnil. Otevřete dialog znovu.');
      if(model.meshes.some(mesh=>mesh.joint||mesh.skin?.length||[2,3,5].includes(mesh.visual))||!model.meshes.some(mesh=>mesh.type===1&&[0,1].includes(mesh.visual)&&mesh.lods?.[0]?.faces.some(face=>face.indices.length)))throw new Error('Předmět: model nemá podporovanou statickou geometrii.');
      request={...operation,model:modelPath.slice(7).replace(/\.4ds$/i,'.i3d')};
      dependencies.push({path:geometryPath,data:geometryBytes,expectedHash:hash(geometryBytes)},{path:tablePath,data:tableBytes,expectedHash:hash(tableBytes)},{path:modelPath,data:modelBytes,expectedHash:hash(modelBytes)});
    }
    if(['add-light','add-sound','add-detector'].includes(operation?.kind))dependencies.push({path:geometryPath,data:geometryBytes,expectedHash:hash(geometryBytes)});
    if(operation?.kind==='add-detector' && operation.dialogue){
      if(operation.task)throw new Error('Rozhovor: nelze současně vytvořit úkolovou šablonu.');
      const dialogue={trigger:'use',camera:false,...operation.dialogue},textPath=relativeAssetPath(dialogue.textDb);
      missionDialogueScript(dialogue);
      if(!/^tables\/textdb_[a-z]{2}\.def$/i.test(textPath))throw new Error('Rozhovor: vyberte jazykový TextDB.');
      const textAsset=this.asset(textPath),text=await this.read(textAsset.path);
      if(hash(text)!==dialogue.textHash)throw new Error('Rozhovor: texty se od otevření změnily. Otevřete dialog znovu.');
      const ids=new Set(parseTextDb(text,textAsset.path).entries.slice(0,-1).map(entry=>entry.id));
      if([...dialogue.lines.map(line=>line.textId),...(dialogue.trigger==='use'?[dialogue.interactionId]:[])].some(id=>!ids.has(id)))throw new Error('Rozhovor: ID textu neexistuje nebo jde o hraniční záznam.');
      const speakers=new Map(dialogueSpeakers({...inspectScene(before),geometry}).map(actor=>[key(actor.name),actor.name]));
      const lines=dialogue.lines.map(line=>{const speaker=speakers.get(key(line.speaker)),listener=dialogue.camera?speakers.get(key(line.listener)):undefined;if(!speaker||(dialogue.camera&&!listener))throw new Error('Rozhovor: mluvčí a posluchač musí být jednoznačné lidské postavy této mise.');return {...line,speaker,...(dialogue.camera?{listener}:{})};});
      dependencies.push({path:textAsset.path,data:text,expectedHash:dialogue.textHash});
      for(const id of new Set(lines.map(line=>line.textId))){
        const asset=this.index.get(key(dialogueSoundPath(id)));if(!asset)throw new Error(`Rozhovor: dabing ${id} chybí. Importujte jej v kategorii Texty.`);const bytes=await this.read(asset.path);
        if(dialogue.soundHashes?.[id]!==hash(bytes))throw new Error('Rozhovor: dabing chybí nebo se od otevření změnil. Načtěte dialog znovu.');
        if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw new Error('Rozhovor: dabing nemá WAV hlavičku.');
        dependencies.push({path:asset.path,data:bytes,expectedHash:dialogue.soundHashes[id]});
      }
      request={...operation,mask:1,code:missionDialogueScript({...dialogue,lines,flow:resolveMissionFlow({...inspectScene(before),geometry},dialogue.flow,operation.name)})};
    }
    if(operation?.kind==='add-detector' && operation.task){
      const task=operation.task,textPath=relativeAssetPath(task.textDb);
      missionTaskScript(task);
      if(!/^tables\/textdb_[a-z]{2}\.def$/i.test(textPath))throw new Error('Úkol: vyberte jazykový TextDB.');
      const asset=this.asset(textPath),bytes=await this.read(asset.path);
      if(hash(bytes)!==task.textHash)throw new Error('Úkol: texty se od otevření změnily. Otevřete dialog znovu.');
      const texts=parseTextDb(bytes,asset.path).entries,ids=new Set(texts.map(entry=>entry.id));
      if([task.objectiveId,task.interactionId,task.nextObjectiveId,task.completeId].some(id=>!ids.has(id)))throw new Error('Úkol: některé ID v jazykové tabulce neexistuje. Nejprve vytvořte vlastní texty.');
      if(task.checkpointId!=null && !texts.slice(0,-1).some(entry=>entry.id===task.checkpointId && entry.text.trim()))throw new Error('Úkol: checkpoint potřebuje existující neprázdný název v jazykové tabulce. Vytvořte text s ID 5000–5599.');
      const targets=[...inspectScene(before).objects,...geometry.meshes].filter(object=>key(object.name)===key(task.targetName));
      if(targets.length!==1 || key(task.targetName)===key('Tommy'))throw new Error('Úkol: vyberte jednoznačný cílový objekt odlišný od hráče.');
      let failure=task.failure??null;
      if(failure){
        if(!texts.slice(0,-1).some(entry=>entry.id===failure.textId&&entry.text.trim()))throw new Error('Úkol: neúspěch potřebuje existující neprázdný text.');
        if(failure.humanName!=null){const human=dialogueSpeakers({...inspectScene(before),geometry}).find(actor=>key(actor.name)===key(failure.humanName));if(!human)throw new Error('Úkol: hlídaná postava musí být jednoznačný lidský aktér této mise.');failure={...failure,humanName:human.name};}
      }
      dependencies.push({path:asset.path,data:bytes,expectedHash:task.textHash});
      let nextMission=task.nextMission??null;
      if(nextMission!==null){
        if(key(`missions/${nextMission}`)===key(folder))throw new Error('Další mise: vyberte jinou misi.');
        const destination=await inspectMissionDestination(this,nextMission);
        for(const file of destination.files)if(task.nextMissionHashes?.[file.path]!==file.expectedHash)throw new Error('Další mise: data se od výběru změnila. Vyberte misi znovu.');
        dependencies.push(...destination.files);nextMission=destination.name;
      }
      request={...operation,mask:1,code:missionTaskScript({...task,nextMission,failure,flow:resolveMissionFlow({...inspectScene(before),geometry},task.flow,operation.name)})};
    }
    if(operation?.kind==='add-sound'){
      const soundPath=relativeAssetPath(operation.sound);
      if(!/^sounds\/.+\.wav$/i.test(soundPath))throw new Error('Vyberte WAV ze složky sounds.');
      const asset=this.asset(soundPath),bytes=await this.read(asset.path);
      if(bytes.length<12||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw new Error('Zvuk nemá WAV hlavičku.');
      dependencies.push({path:asset.path,data:bytes,expectedHash:hash(bytes)});
      request={...operation,parameters:{...operation.parameters,file:asset.path.slice(7).replaceAll('/','\\')}};
    }
    if(operation?.kind==='attach-door'){
      dependencies.push({path:geometryPath,data:geometryBytes,expectedHash:hash(geometryBytes)});
      const object=inspectScene(before).objects.find(object=>key(object.name)===key(operation.target));
      if(object?.model&&!geometry.meshes.some(mesh=>key(mesh.name)===key(operation.target))){
        const modelPath=this.asset(`models/${object.model.replace(/\.(?:i3d|4ds)$/i,'.4ds')}`).path,bytes=await this.read(modelPath),model=parseFourDs(bytes,true);
        if(model.meshes.some(mesh=>mesh.joint||mesh.skin||[2,3,5].includes(mesh.visual))||!model.meshes.some(mesh=>mesh.type===1&&[0,1].includes(mesh.visual)&&mesh.lods?.[0]?.faces.some(face=>face.indices.length)))throw new Error('Dveře: vyberte statický model s geometrií.');
        dependencies.push({path:modelPath,data:bytes,expectedHash:hash(bytes)});
      }
    }
    if(operation?.kind==='attach-physical'){
      const object=inspectScene(before).objects.find(object=>key(object.name)===key(operation.target));
      if(!object?.model||object.frameType!==9||geometry.meshes.some(mesh=>key(mesh.name)===key(operation.target)))throw new Error('Fyzikální předmět: vyberte samostatný model ve scéně.');
      const modelPath=this.asset(`models/${object.model.replace(/\.(?:i3d|4ds)$/i,'.4ds')}`).path,bytes=await this.read(modelPath),model=parseFourDs(bytes,true);
      if(model.meshes.some(mesh=>mesh.joint||mesh.skin?.length||[2,3,5].includes(mesh.visual))||!model.meshes.some(mesh=>mesh.type===1&&[0,1].includes(mesh.visual)&&mesh.lods?.[0]?.faces.some(face=>face.indices.length)))throw new Error('Fyzikální předmět: vyberte statický model s geometrií.');
      dependencies.push({path:geometryPath,data:geometryBytes,expectedHash:hash(geometryBytes)},{path:modelPath,data:bytes,expectedHash:hash(bytes)});
    }
    if (['add-model','add-human','add-car'].includes(operation?.kind)) {
      if (typeof operation.model !== 'string' || !/^models\/[^/\\]+\.4ds$/i.test(operation.model)) throw new Error('Vyberte model z hlavní složky models.');
      const modelBytes=await this.read(operation.model),model=parseFourDs(modelBytes, true);
      if(operation.kind==='add-human'&&!model.meshes.some(mesh=>mesh.joint))throw new Error('Vyberte model postavy s kostrou.');
      if(operation.kind==='add-car'){
        const tablePath=this.asset('tables/vehicles.bin').path,tableBytes=await this.read(tablePath);
        if(operation.vehicleTableHash!==undefined&&operation.vehicleTableHash!==hash(tableBytes))throw new Error('Tabulka aut se od otevření změnila. Otevřete dialog znovu.');
        if(!vehicleModelDefinition(parseVehicleTable(tableBytes),operation.model))throw new Error('Vyberte automobilový model s odpovídající fyzikální tabulkou.');
        validateVehicleModel(model);dependencies.push({path:tablePath,data:tableBytes,expectedHash:hash(tableBytes)},{path:this.asset(operation.model).path,data:modelBytes,expectedHash:hash(modelBytes)});
      }
      request = { ...operation, model: this.asset(operation.model).path.slice(7).replace(/\.4ds$/i, '.i3d') };
    }
    const after=operation?.kind==='collision'?before:changeSceneObject(before, request, geometry.meshes.map(mesh => mesh.name),geometry.meshes);
    const requests=[];
    if(['attach-door','attach-physical'].includes(operation?.kind)&&collisionOwnership(this.manifest,name).some(object=>key(object.name)===key(operation.target)))requests.push({name:operation.target,kind:'none'});
    if(operation?.collision){
      if(!['add-model','collision'].includes(operation.kind))throw new Error('Kolize lze generovat pouze pro statický model.');
      const object=operation.kind==='collision'?inspectScene(before).objects.find(o=>o.id===operation.id):null;
      if(operation.kind==='collision'&&(!object||object.frameType!==9||object.actorBound||geometry.meshes.some(m=>key(m.name)===key(object.name))))throw new Error('Vyberte samostatný statický model bez aktéra.');
      requests.push({...operation.collision,name:object?.name??operation.name});
    }else if(operation?.kind==='collision')throw new Error('Zvolte způsob kolize.');
    if(operation?.kind==='duplicate'){
      const original=inspectScene(before).objects.find(o=>o.id===operation.id),owned=collisionOwnership(this.manifest,name).find(o=>key(o.name)===key(original?.name??''));
      if(owned){const klz=parseCollision(await this.read(`${folder}/tree.klz`)),record=ownedCollisionRecords(klz,[owned])[0];requests.push({name:operation.name,kind:owned.kind,material:record.material,doubleSided:owned.doubleSided});}
    }
    const collision=await prepareSceneCollision(this,name,before,after,{requests,expectedHash:operation?.collisionHash});
    const label={ 'add-model': 'Vložení modelu do mise', 'add-human':'Vložení postavy a jejího skriptu','add-car':'Vložení automobilu a jeho aktéra','add-light':'Vložení světla do mise','add-sound':'Vložení prostorového zvuku do mise','add-detector':'Vložení skriptového bodu','add-pickup':'Vložení předmětu k sebrání','configure-pickup':'Nastavení předmětu k sebrání','attach-door':'Vytvoření dveřního aktéra','attach-physical':'Vytvoření fyzikálního předmětu', duplicate: 'Duplikace objektu mise', delete: 'Odstranění objektu mise',collision:'Generování kolize modelu' }[operation?.kind]??'Úprava objektů mise';
    const files=new Map([{path:name,data:after,expectedHash},...dependencies,...(collision?.files??[])].map(file=>[key(file.path),file]));
    await this.changeBatch([...files.values()],label,collision?.ownership);
  }
  async carModels(){
    const bytes=await this.read('tables/vehicles.bin'),table=parseVehicleTable(bytes),models=[];let rejected=0;
    for(const asset of this.manifest.assets){const definition=vehicleModelDefinition(table,asset.path);if(!definition)continue;
      try{validateVehicleModel(parseFourDs(await this.read(asset.path)));models.push(definition);}catch{rejected++;}}
    return {models,sha256:hash(bytes),rejected};
  }
  async missionDestination(name){
    const {files,...result}=await inspectMissionDestination(this,name);return result;
  }
  async pickupItems(){
    const bytes=await this.read('tables/predmety.def'),items=[];let rejected=0;
    for(const item of parseItems(bytes).records){
      if(!item.index||!item.model)continue;
      try{
        if(!/^[^/\\]+\.i3d$/i.test(item.model))throw new Error('Model');
        const modelPath=this.asset(`models/${item.model.replace(/\.i3d$/i,'.4ds')}`).path,modelBytes=await this.read(modelPath),model=parseFourDs(modelBytes,true);
        if(model.meshes.some(mesh=>mesh.joint||mesh.skin?.length||[2,3,5].includes(mesh.visual))||!model.meshes.some(mesh=>mesh.type===1&&[0,1].includes(mesh.visual)&&mesh.lods?.[0]?.faces.some(face=>face.indices.length)))throw new Error('Geometrie');
        items.push({itemId:item.index,name:item.name,model:modelPath,itemType:item.itemType,clip:Math.max(0,item.magazine),reserve:Math.max(0,item.reserve),modelHash:hash(modelBytes)});
      }catch{rejected++;}
    }
    return {items,sha256:hash(bytes),rejected};
  }
  async inspect(name) {
    const asset = this.asset(name), bytes = await this.read(name);
    const common = { path: asset.path, size: bytes.length, sha256: hash(bytes) };
    if (/textdb_[a-z]{2}\.def$/i.test(name)) return { type: 'textdb', ...parseTextDb(bytes, name), path: asset.path, size: bytes.length, sha256: hash(bytes) };
    if (/scene2\.bin$/i.test(name)) return { type: 'scene', ...inspectScene(bytes), path: asset.path, size: bytes.length, sha256: hash(bytes) };
    let warning;
    if (/^tables\/effects\.tbl$/i.test(name)) {
      try { return { type:'effect-types', ...common, ...parseEffectDefinitions(bytes) }; }
      catch (error) { warning = error.message; }
    }
    if (/^missions\/[^/]+\/tree\.klz$/i.test(name)) {
      try { return await inspectProjectCollision(this,name); }
      catch (error) { warning = error.message; }
    }
    if (/^missions\/[^/]+\/effects\.bin$/i.test(name)) {
      try { return { type:'effects', ...common, ...parseEffects(bytes), context:await this.effectContext(name) }; }
      catch (error) { warning = error.message; }
    }
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
    if (/^tables\/vehicles\.bin$/i.test(name)) {
      try { return { type: 'vehicles', ...common, ...inspectVehicleTable(bytes) }; }
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
    if (/\.bmp$/i.test(name)) {
      try { return { type:'image', ...common, bitmap:parseBmp(bytes) }; }
      catch (error) { return { type:'image', ...common, warning:error.message }; }
    }
    if (/\.(png|jpe?g)$/i.test(name)) return { type: 'image', ...common };
    if (/\.(wav|ogg|mp3)$/i.test(name)) return { type: 'audio', ...common };
    return { type: 'binary', ...common, warning, hex: bytes.subarray(0, 4096).toString('hex'), signature: bytes.subarray(0, 16).toString('ascii').replace(/[^\x20-\x7e]/g, '.') };
  }
  async modelGeometry(name, mesh) {
    if(!/\.4ds$/i.test(name))throw new Error('Soubor není 4DS model.');
    const bytes=await this.read(name);return {sha256:hash(bytes),...inspectModelGeometry(bytes,mesh)};
  }
  async saveCollision(name,operations,expectedHash,dependencies,options) { return saveProjectCollision(this,name,operations,expectedHash,dependencies,options); }
  async saveGeometry(name, request, expectedHash) {
    if(!/\.4ds$/i.test(name))throw new Error('Soubor není 4DS model.');
    await this.change(name,before=>{if(expectedHash!==hash(before))throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');return editModelGeometry(before,request);},'Úprava geometrie 4DS');
  }
  async saveBitmap(name, changes, expectedHash) {
    if(!/\.bmp$/i.test(name))throw new Error('Soubor není BMP textura.');
    await this.change(name,before=>{
      if(expectedHash!==hash(before))throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      return editBmp(before,changes);
    },'Úprava BMP textury');
  }
  async saveModel(name, changes, expectedHash) {
    if (!/\.4ds$/i.test(name)) throw new Error('Soubor není 4DS model.');
    await this.change(name, before => {
      if (expectedHash !== hash(before)) throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      return editFourDs(before, changes);
    }, 'Úprava modelu 4DS');
  }
  async effectContext(name) {
    const context={items:[],tableHash:null,modelHashes:{},frames:[],frameHashes:{},warnings:[]};
    try{
      const table=await this.read('tables/effects.tbl');context.tableHash=hash(table);const cache=new Map();
      for(const item of parseEffectTypes(table).items){
        const result={...item,available:false};context.items.push(result);
        if(!item.emitters||!item.model||!/^([^/\\]+)\.i3d$/i.test(item.model))continue;
        try{const asset=this.asset(`models/${item.model.replace(/\.i3d$/i,'.4ds')}`);
          if(!cache.has(asset.path)){const bytes=await this.read(asset.path);parseFourDs(bytes);cache.set(asset.path,hash(bytes));}
          result.modelPath=asset.path;result.available=true;context.modelHashes[asset.path]=cache.get(asset.path);
        }catch{/* A missing/unsupported model is visible in the catalog but cannot be added. */}
      }
    }catch(error){context.warnings.push('Katalog efektů: '+error.message);}
    const folder=name.slice(0,name.lastIndexOf('/')),names=new Map();
    const add=(name,source)=>{if(!name)return;const id=name.normalize('NFC').toLowerCase(),entry=names.get(id)??{name,counts:{}};entry.counts[source]=(entry.counts[source]??0)+1;names.set(id,entry);};
    try{
      for(const [filename,source] of [['scene.4ds','geometry'],['scene2.bin','scene']]){
        const asset=this.asset(`${folder}/${filename}`),bytes=await this.read(asset.path);context.frameHashes[asset.path]=hash(bytes);
        const frames=source==='geometry'?parseFourDs(bytes).meshes:inspectScene(bytes).objects;
        for(const frame of frames)add(frame.name,source);
      }
      context.frames=[...names.values()].filter(entry=>Math.max(...Object.values(entry.counts))===1).map(entry=>entry.name).sort((a,b)=>a.localeCompare(b));
    }catch(error){context.frames=[];context.frameHashes={};context.warnings.push('Vazby na scénu: '+error.message);}
    return context;
  }
  async writeEffects(name,prepare,expectedHash,dependencies={},validateChanges=true) {
    if(!/^missions\/[^/]+\/effects\.bin$/i.test(name))throw new Error('Vyberte effects.bin mise.');
    const before=await this.read(name);if(hash(before)!==expectedHash)throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
    const old=parseEffects(before),after=prepare(before),revised=parseEffects(after),files=new Map([[key(name),{path:name,data:after,expectedHash}]]);
    const changed=validateChanges?revised.effects.filter(effect=>{const original=old.effects.find(row=>row.id===effect.id);return !original||original.effectId!==effect.effectId||original.frame!==effect.frame;}):[];
    if(changed.length){
      const context=await this.effectContext(name);
      const protect=async(path,expected)=>{const asset=this.asset(path),bytes=await this.read(path);if(expected!==hash(bytes))throw new Error('Data efektu nebo vazby se od otevření změnila. Otevřete editor znovu.');files.set(key(asset.path),{path:asset.path,data:bytes,expectedHash:expected});};
      for(const effect of changed){
        const original=old.effects.find(row=>row.id===effect.id);
        if(!original||original.effectId!==effect.effectId){const item=context.items.find(item=>item.effectId===effect.effectId&&item.available);if(!item)throw new Error('Typ efektu nemá dostupnou definici a model.');await protect('tables/effects.tbl',dependencies.tableHash);await protect(item.modelPath,dependencies.modelHashes?.[item.modelPath]);}
        if(effect.frame&&(!original||original.frame!==effect.frame)){
          if(!context.frames.some(frame=>frame.normalize('NFC').toLowerCase()===effect.frame.normalize('NFC').toLowerCase()))throw new Error('Vazba efektu musí odkazovat na jednoznačný objekt mise.');
          for(const path of Object.keys(context.frameHashes))await protect(path,dependencies.frameHashes?.[path]);
        }
      }
    }
    await this.changeBatch([...files.values()],'Úprava částicových efektů mise');
  }
  async saveEffects(name,changes,expectedHash,dependencies) { await this.writeEffects(name,before=>editEffects(before,changes),expectedHash,dependencies); }
  async saveEffectDefinitions(name,changes,expectedHash) {
    if(!/^tables\/effects\.tbl$/i.test(name))throw new Error('Soubor není tabulka efektů.');
    await this.change(name,before=>{
      if(hash(before)!==expectedHash)throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      return editEffectDefinitions(before,changes);
    },'Úprava definic částicových efektů');
  }
  async changeEffects(name,request,expectedHash,dependencies) { await this.writeEffects(name,before=>changeEffects(before,request),expectedHash,dependencies,request?.action!=='delete'); }
  async saveItems(name, changes, expectedHash) {
    if (!/^tables\/predmety\.def$/i.test(name)) throw new Error('Soubor není tabulka předmětů.');
    await this.change(name, before => {
      if (expectedHash !== hash(before)) throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      return editItems(before, changes);
    }, 'Úprava zbraní a předmětů');
  }
  async saveVehicles(name, changes, expectedHash) {
    if (!/^tables\/vehicles\.bin$/i.test(name)) throw new Error('Soubor není tabulka vozidel.');
    await this.change(name, before => {
      if (expectedHash !== hash(before)) throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      return editVehicleTable(before, changes);
    }, 'Úprava fyziky vozidel');
  }
  async saveNavigation(name, changes, expectedHash) {
    if (!/^missions\/[^/]+\/check\.bin$/i.test(name)) throw new Error('Soubor není check.bin mise.');
    const source=await this.read(name);if(expectedHash!==hash(source))throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
    const prepared=prepareNavigationEdits(source,changes),label='Úprava navigačních bodů a vazeb';
    if(prepared.mapping.some((index,old)=>index!==old)){
      const files=[{path:name,data:prepared.data,expectedHash}],segment=this.index.get(key(name.replace(/check\.bin$/i,'clusters.seg')));
      if(segment){const before=await this.read(segment.path);files.push({path:segment.path,data:remapSegments(before,prepared.mapping,prepared.mapping.length),expectedHash:hash(before)});}
      await this.changeBatch(files,label);
    }else await this.change(name,before=>{if(expectedHash!==hash(before))throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');return prepared.data;},label);
    return prepared.mapping;
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
    let mapping;
    await this.change(name, before => {
      if (expectedHash !== hash(before)) throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      const prepared=prepareRoadEdits(before,changes);mapping=prepared.mapping;return prepared.data;
    }, 'Úprava silničních bodů a parametrů');
    return mapping;
  }
  async changeRoadPoint(name, request, expectedHash) {
    if (!/^missions\/[^/]+\/road\.bin$/i.test(name)) throw new Error('Soubor není road.bin mise.');
    let result;
    await this.change(name,before=>{
      if(expectedHash!==hash(before))throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      result=changeRoadPoint(before,request);return result.data;
    },request?.action==='insert'?'Vložení bodu do silničního úseku':'Odstranění mezilehlého silničního bodu');
    return {index:result.index,mapping:result.mapping};
  }
  async changeRoadTopology(name,request,expectedHash) {
    if(!/^missions\/[^/]+\/road\.bin$/i.test(name))throw new Error('Soubor není road.bin mise.');
    let result;
    await this.change(name,before=>{
      if(expectedHash!==hash(before))throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');
      result=changeRoadTopology(before,request);return result.data;
    },'Změna křižovatek a propojení silniční sítě');
    return {index:result.index,mapping:result.mapping};
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
  async saveAnimationTimeline(name, request, expectedHash) {
    if(!/\.5ds$/i.test(name))throw new Error('Soubor není 5DS animace.');
    await this.change(name,before=>{if(expectedHash!==hash(before))throw new Error('Soubor se od otevření změnil. Otevřete jej znovu.');return editAnimationTimeline(before,request);},'Úprava časové osy 5DS');
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
    let collision;
    if(this.index.has(key(`${folder}/tree.klz`))){
      const bytes=await this.read(`${folder}/tree.klz`);collision={sha256:hash(bytes),boxes:[],surfaces:[]};
      try{const ownership=collisionOwnership(this.manifest,scene.path),parsed=parseCollision(bytes),records=ownedCollisionRecords(parsed,ownership);records.forEach((record,i)=>{if(ownership[i].kind==='mesh')collision.surfaces.push(collisionSurfacePreview(parsed,record));else collision.boxes.push({name:ownership[i].name,min:record.min,max:record.max,material:record.material});});}
      catch(error){collision.warning=error.message;}
    }
    return { ...scene, type: 'map', geometry, collision };
  }
  async restore(name) {
    const asset=this.asset(name),original=await this.original(asset);
    if(/scene2\.bin$/i.test(name)&&collisionOwnership(this.manifest,name).length){const before=await this.read(name),collision=await prepareSceneCollision(this,name,before,original);return this.changeBatch([{path:name,data:original,expectedHash:hash(before)},...collision.files],'Obnovení scény a jejích kolizí',collision.ownership);}
    await this.change(name,original,'Obnovení originálu');
  }
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
