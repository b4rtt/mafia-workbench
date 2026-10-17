import { Group } from 'three';
import { Viewport } from './viewport.js';

const key = name => name.replaceAll('\\', '/').normalize('NFC').toLowerCase();
const emptyModel = { meshes: [], materials: [] };

// Stage a separate, static scene with the same rendering/hierarchy rules as the
// map editor. Never mix its frames or parent lookup with the editable network.
class MissionGeometry {
  constructor(owner, active) {
    this.owner = owner; this.active = active; this.root = new Group(); this.frames = new Map();
    this.materials = new Set(); this.textures = new Set(); this.skinWarnings = [];
  }
  get disposed() { return this.released || this.owner.disposed || !this.active(); }
  addModel(...args) { return Viewport.prototype.addModel.call(this, ...args); }
  addSceneObject(...args) { return Viewport.prototype.addSceneObject.call(this, ...args); }
  linkScene() { return Viewport.prototype.linkScene.call(this); }
  loadTextures(...args) { return Viewport.prototype.loadTextures.call(this, ...args); }
  applyTexture(...args) { return Viewport.prototype.applyTexture.call(this, ...args); }
  // Editor light/sound/task helpers are deliberately absent from this context.
  syncSoundExtent() {}
  syncLightPreview() {}
  syncMissionAreas() {}
  dispose() {
    if (this.released) return; this.released = true; this.root.removeFromParent();
    const geometries = new Set(), skeletons = new Set();
    this.root.traverse(object => { if (object.geometry) geometries.add(object.geometry); if (object.skeleton) skeletons.add(object.skeleton); });
    for (const geometry of geometries) geometry.dispose(); for (const skeleton of skeletons) skeleton.dispose();
    for (const material of this.materials) { material.dispose(); this.owner.materials.delete(material); }
    for (const texture of this.textures) { texture.dispose(); this.owner.textures.delete(texture); }
    this.frames.clear();
  }
}

export async function loadMissionGeometry(view, navigationPath, { assets, api, active = () => true }) {
  const context = new MissionGeometry(view, active), index = new Map(assets.map(asset => [key(asset.path), asset])), warnings = [], models = new Map();
  let modelCount = 0;
  try {
    const folder = navigationPath.slice(0, navigationPath.lastIndexOf('/') + 1), scene = index.get(key(folder + 'scene2.bin'));
    let map;
    if (scene) {
      map = await api.map(scene.path);
      if (context.disposed) { context.dispose(); return null; }
      if (map.type !== 'map' || map.geometry?.type !== 'model' || !Array.isArray(map.objects)) throw new Error('Scénu mise nelze použít jako geometrický kontext.');
    } else {
      const asset = index.get(key(folder + 'scene.4ds'));
      if (!asset) throw new Error('Mise nemá dostupnou geometrii scene.4ds.');
      const geometry = await api.inspect(asset.path);
      if (context.disposed) { context.dispose(); return null; }
      if (geometry.type !== 'model') throw new Error(geometry.warning ?? 'Geometrii mise nelze načíst.');
      map = { geometry, objects: [] }; warnings.push('Chybí scene2.bin; zobrazuje se pouze scene.4ds.');
    }
    const overrides = new Map(map.objects.map(object => [key(object.name), object]));
    context.addModel(map.geometry, context.root, 'mission-context/', overrides);
    const existing = new Set([...context.frames.values()].map(object => object.userData.frame.sceneObject?.id).filter(id => id !== undefined));
    for (const object of map.objects.filter(object => !existing.has(object.id) && object.position)) {
      let model;
      if (object.model) {
        let name = key(object.model).replace(/\.(?:i3d|4ds)$/i, '.4ds'); if (!name.startsWith('models/')) name = 'models/' + name;
        const asset = index.get(name);
        if (!asset) warnings.push(`${object.name}: chybí model ${object.model}.`);
        else {
          if (!models.has(asset.path)) models.set(asset.path, api.inspect(asset.path));
          try { const result = await models.get(asset.path); if (result.type !== 'model') throw new Error(result.warning ?? 'Nepodporovaný model.'); model = result; }
          catch (error) { warnings.push(`${object.name}: ${error.message}`); }
        }
      }
      if (context.disposed) { context.dispose(); return null; }
      // Empty visual preserves parent transforms without technical markers or
      // a fabricated sphere for missing models, scripts, lights and sounds.
      context.addSceneObject(object, model ?? emptyModel); if (model) modelCount++;
    }
    warnings.push(...context.linkScene());
    context.root.traverse(object => { object.raycast = () => {}; if (object.userData.frame) object.userData.frame.editable = false; });
    await context.loadTextures(async texture => { const name = key(texture), asset = index.get('maps/' + name) ?? index.get(name); return asset ? api.media(asset.path) : null; });
    if (context.disposed) { context.dispose(); return null; }
    warnings.push(...(context.textureWarnings ?? []));
    if (context.skinWarnings.length) warnings.push(`${context.skinWarnings.length} modelů má nepodporované navázání kostry; zůstávají v základní póze.`);
    view.root.add(context.root); for (const material of context.materials) view.materials.add(material); for (const texture of context.textures) view.textures.add(texture);
    return { group: context.root, frames: context.frames, modelCount, warnings: [...new Set(warnings)], dispose: () => context.dispose() };
  } catch (error) {
    const cancelled = context.disposed; context.dispose();
    if (cancelled) return null;
    throw error;
  }
}
