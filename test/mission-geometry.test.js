import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadMissionGeometry } from '../src/ui/mission-geometry.js';
import { sceneWorld } from '../src/shared/scene-world.js';

const frame = (id, name, position = [0, 0, 0]) => ({ id, name, parent: 0, position, rotation: [1, 0, 0, 0], scale: [1, 1, 1], culling: 1 });
const visual = (id, name) => ({ ...frame(id, name), lods: [{ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], uv: [0, 0, 1, 0, 0, 1], faces: [{ material: 1, indices: [0, 1, 2] }] }] });
const source = (id, name, parent, position, model) => ({ id, name, parent, position, rotation: [1, 0, 0, 0], scale: [1, 1, 1], fields: { position: id + '/position' }, frameType: model ? 9 : 6, ...(model ? { model } : {}) });
const material = { diffuse: [1, 1, 1], opacity: 1, flags: 0 };
function fixture() {
  const map = { type: 'map', geometry: { type: 'model', meshes: [frame(1, 'Room'), { ...visual(2, 'Wall'), parent: 1 }], materials: [material] }, objects: [
    { ...source('room', 'Room', 'Primary sector', [20, 3, -10]), rotation: [Math.cos(.3), 0, Math.sin(.3), 0], scale: [-2, 3, 4] },
    source('anchor', 'Anchor', 'rOoM', [2, 4, 6]), source('a', 'HouseA', 'Anchor', [3, 2, 1], 'House.I3D'),
    source('b', 'HouseB', 'PRIMARY SECTOR', [5, 0, 9], 'models/HOUSE.4ds'),
    source('missing', 'Missing', 'Anchor', [1, 2, 3], 'absent.i3d'),
    { ...source('sound', 'Ambient', 'Anchor', [1, 1, 1]), frameType: 4 },
    source('backdrop', 'Sky', 'Backdrop sector', [2, 0, 0], 'house.4ds')
  ] };
  const model = { type: 'model', meshes: [visual(1, 'HouseMesh')], materials: [material] };
  const assets = ['MISSIONS/TEST/scene2.bin', 'missions/Test/SCENE.4DS', 'Models/House.4DS'].map(path => ({ path }));
  return { map, model, assets };
}
function owner() {
  return { root: new THREE.Group(), frames: new Map([['editable', new THREE.Group()]]), materials: new Set(), textures: new Set(), disposed: false };
}
const near = (a, b) => a.forEach((v, i) => assert(Math.abs(v - b[i]) < 1e-6, `${a} != ${b}`));

test('mission context composes overlays, reflected/nested parent transforms and deduplicated model reads without touching editable frames', async () => {
  const { map, model, assets } = fixture(), before = structuredClone({ map, model }), view = owner(), calls = [];
  const context = await loadMissionGeometry(view, 'missions/test/check.bin', { assets, api: { map: async path => { calls.push(path); return map; }, inspect: async path => { calls.push(path); return model; }, media: async () => null } });
  assert.deepEqual(calls, ['MISSIONS/TEST/scene2.bin', 'Models/House.4DS']); assert.equal(context.modelCount, 3);
  assert.equal(view.frames.size, 1); assert.equal(view.root.children.length, 1); assert.equal(context.group.parent, view.root);
  const world = sceneWorld(map, map.geometry); view.root.updateMatrixWorld(true);
  for (const name of ['Room', 'Anchor', 'HouseA', 'HouseB', 'Missing', 'Ambient']) {
    const object = [...context.frames.values()].find(object => object.name === name);
    near(object.getWorldPosition(new THREE.Vector3()).toArray(), new THREE.Vector3().setFromMatrixPosition(world(name)).toArray());
    assert.equal(object.userData.frame.editable, false);
  }
  assert.equal(context.warnings.filter(w => /chybí model/.test(w)).length, 1);
  for (const name of ['Anchor', 'Missing', 'Ambient']) {
    const object = [...context.frames.values()].find(object => object.name === name);
    assert(!object.children.some(child => child.isSprite || child.isMesh), 'technical markers must not appear');
  }
  const sky = context.frames.get('scene:backdrop'); assert.equal(sky.parent.visible, false);
  const ray = new THREE.Raycaster(new THREE.Vector3(5.2, .2, 15), new THREE.Vector3(0, 0, -1)); assert.equal(ray.intersectObject(context.group, true).length, 0);
  assert.deepEqual({ map, model }, before); assert(view.materials.size > 0);
  context.dispose(); assert.equal(view.root.children.length, 0); assert.equal(view.materials.size, 0); assert.equal(view.textures.size, 0); assert.equal(view.frames.size, 1); context.dispose();
});
test('existing geometry overrides are rendered once with hidden frames/visuals retained and missing texture warnings', async () => {
  const { map, model, assets } = fixture(), view = owner();
  map.geometry.meshes.push({ ...visual(3, 'HiddenFrame'), culling: 0 }, { ...visual(4, 'HiddenVisual'), renderFlags: 0x40 });
  map.geometry.materials = [{ ...material, texture: 'missing.bmp' }];
  const context = await loadMissionGeometry(view, 'MISSIONS/TEST/CHECK.BIN', { assets, api: { map: async () => map, inspect: async () => model, media: async () => { throw new Error('not called without asset'); } } });
  assert.equal([...context.frames.values()].filter(o => o.name === 'Room').length, 1);
  assert.equal(context.frames.get('mission-context/3').visible, false); assert.equal(context.frames.get('mission-context/4').children[0].visible, false);
  assert(context.warnings.some(w => w.includes('Chybí textura: missing.bmp'))); context.dispose();
});
test('geometry-only legacy missions have an explicit warning; broken scene2 never silently falls back', async () => {
  const { map, assets } = fixture(), view = owner(); let attempts = 0;
  const api = { inspect: async () => map.geometry, map: async () => { if (!attempts++) throw new Error('Broken scene2'); return map; }, media: async () => null };
  const old = await loadMissionGeometry(view, 'missions/test/check.bin', { assets: assets.filter(a => !/scene2/i.test(a.path)), api });
  assert(old.warnings.some(w => /pouze scene.4ds/.test(w))); assert.equal(old.modelCount, 0); old.dispose();
  await assert.rejects(loadMissionGeometry(view, 'missions/test/check.bin', { assets, api }), /Broken scene2/); assert.equal(view.root.children.length, 0); assert.equal(view.materials.size, 0);
  const retry = await loadMissionGeometry(view, 'missions/test/check.bin', { assets, api }); assert(retry); retry.dispose();
  await assert.rejects(loadMissionGeometry(view, 'missions/test/check.bin', { assets: [], api }), /nemá dostupnou/);
});
test('failed hierarchy staging releases generated resources and leaves an existing network intact', async t => {
  const { map, model, assets } = fixture(), view = owner(), network = new THREE.Group(); view.root.add(network);
  map.objects[1].parent = 'HouseA';
  const geometries = t.mock.method(THREE.BufferGeometry.prototype, 'dispose'), materials = t.mock.method(THREE.Material.prototype, 'dispose');
  await assert.rejects(loadMissionGeometry(view, 'missions/test/check.bin', { assets, api: { map: async () => map, inspect: async () => model } }), /cyklická/);
  assert.deepEqual(view.root.children, [network]); assert.equal(view.frames.size, 1); assert.equal(view.materials.size, 0); assert.equal(view.textures.size, 0);
  assert(geometries.mock.callCount() > 0); assert(materials.mock.callCount() > 0);
});
test('leaving the editor during async model loading cancels adoption and frees staged geometry', async t => {
  const { map, model, assets } = fixture(), view = owner(); let finish, requested;
  const pending = new Promise(resolve => { requested = resolve; }), modelRead = new Promise(resolve => { finish = resolve; });
  const geometry = t.mock.method(THREE.BufferGeometry.prototype, 'dispose'); let active = true;
  const task = loadMissionGeometry(view, 'missions/test/check.bin', { assets, active: () => active, api: { map: async () => map, inspect: () => { requested(); return modelRead; } } });
  await pending; active = false; finish(model); assert.equal(await task, null);
  assert.equal(view.root.children.length, 0); assert.equal(view.frames.size, 1); assert.equal(view.materials.size, 0); assert(geometry.mock.callCount() > 0);
});
test('disposing the owner during texture loading releases both the late texture and staged materials', async t => {
  const { map, assets } = fixture(), view = owner(); let finish, requested;
  map.geometry.materials = [{ ...material, texture: 'wall.bmp' }];
  const pending = new Promise(resolve => { requested = resolve; }), textureRead = new Promise(resolve => { finish = resolve; });
  const texture = new THREE.Texture(), disposed = t.mock.method(texture, 'dispose'), materials = t.mock.method(THREE.Material.prototype, 'dispose');
  t.mock.method(THREE.TextureLoader.prototype, 'loadAsync', () => { requested(); return textureRead; });
  const task = loadMissionGeometry(view, 'missions/test/check.bin', { assets: [...assets, { path: 'Maps/WALL.BMP' }], api: { map: async () => map, inspect: async () => ({ type: 'model', meshes: [], materials: [] }), media: async name => { assert.equal(name, 'Maps/WALL.BMP'); return 'wall.bmp'; } } });
  await pending; view.disposed = true; finish(texture); assert.equal(await task, null);
  assert.equal(disposed.mock.callCount(), 1); assert(materials.mock.callCount() > 0);
  assert.equal(view.root.children.length, 0); assert.equal(view.materials.size, 0); assert.equal(view.textures.size, 0);
});
test('a failed scene read after leaving does not report a stale error in the new editor', async () => {
  const { assets } = fixture(), view = owner(); let reject;
  const read = new Promise((_resolve, fail) => { reject = fail; }); let active = true;
  const task = loadMissionGeometry(view, 'missions/test/check.bin', { assets, active: () => active, api: { map: () => read } });
  active = false; reject(new Error('Late read failure')); assert.equal(await task, null);
  assert.equal(view.root.children.length, 0); assert.equal(view.materials.size, 0); assert.equal(view.textures.size, 0);
});
