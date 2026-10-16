import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import { newAnimationPlan } from '../src/shared/new-animation.js';
import { animationFromModel } from '../src/core/new-animation.js';
import { parseFiveDs } from '../src/core/fiveds.js';
import { editFourDs } from '../src/core/fourds.js';
import { writeSurfaceModel } from '../src/core/surface-model.js';
import { editAnimationTimeline } from '../src/core/animation-timeline.js';
import { AnimationPreview } from '../src/ui/animation.js';
import { fromLs3dRotation } from '../src/ui/transforms.js';
import { ModProject } from '../src/core/project.js';
import { hash, writeSafe } from '../src/core/files.js';

const options = { name: 'WB_wave.5DS', model: 'models/Own.4ds', frames: 50 };
const model = () => ({ meshes: [
  { name: 'Root', rotation: [Math.SQRT1_2, 0, Math.SQRT1_2, 0], position: [10, 2, -3], scale: [2, 1, 1] },
  { name: 'ruka', rotation: [1, -0, 0, 0], position: [3, 4, 5], scale: [1, .5, 1] },
] });
function modelBytes() {
  const mesh = { type: 1, visual: 0, renderFlags: 0, logicFlags: 0, culling: 0, lods: [{ distance: 0, vertices: 3, positions: [0,0,0,1,0,0,0,1,0], normals: [0,0,1,0,0,1,0,0,1], uv: [0,0,1,0,0,1], faces: [{ material: 0, indices: [0,1,2] }] }] };
  return writeSurfaceModel({ materials: [], meshes: model().meshes.map((node, i) => ({ ...mesh, ...node, parent: i })) });
}
test('new 5DS uses relative table offsets and one absolute local TRS key per uniquely named frame', () => {
  const source = model(), before = structuredClone(source), { bytes, path: target } = animationFromModel(source, options), parsed = parseFiveDs(bytes, true);
  assert.equal(target, 'anims/WB_wave.5ds'); assert.equal(bytes.readUInt32LE(14), bytes.length - 18); assert.equal(bytes.readUInt16LE(4), 20); assert.equal(parsed.frames, 50); assert.equal(parsed.nodes.length, 2);
  for (const [i, node] of parsed.nodes.entries()) {
    assert.equal(node.name, source.meshes[i].name); assert.equal(node.flags, 14); assert.equal(node.unknownFlags, 0); assert.equal(node.layout.start, 22 + 16 + i * 56); assert.equal((node.layout.start - 18) % 4, 0);
    for (const channel of ['rotation', 'position', 'scale']) { assert.deepEqual(node.tracks[channel].times, [0]); assert.deepEqual(node.tracks[channel].values[0], source.meshes[i][channel].map(Math.fround)); }
  }
  assert.deepEqual(source, before); assert.deepEqual(animationFromModel(source, options).bytes, bytes);
  const unicode = model(); unicode.meshes[1].name = 'Paže'; assert.equal(parseFiveDs(animationFromModel(unicode, { ...options, frames: 65535 }).bytes).nodes[1].name, 'Paže');
  assert.equal(parseFiveDs(animationFromModel(source, { ...options, frames: 0 }).bytes).frames, 0);
});
test('ambiguous names, unsafe paths, unsupported characters and invalid poses fail before creating a clip', () => {
  for (const change of [{ name: '../escape' }, { name: 'a/b' }, { name: 'a\\b' }, { name: 'CON.5ds' }, { name: 'x'.repeat(57) }, { name: 'český' }, { name: 'a.' }, { frames: -1 }, { frames: 65536 }, { frames: 1.5 }, { model: 'elsewhere/a.4ds' }, { unknown: true }]) assert.throws(() => animationFromModel(model(), { ...options, ...change }));
  const duplicate = model(); duplicate.meshes[1].name = 'ROOT'; assert.throws(() => animationFromModel(duplicate, options), /nejednoznačný/);
  const invalid = model(); invalid.meshes[0].rotation = [0,0,0,0]; assert.throws(() => animationFromModel(invalid, options), /quaternion/); invalid.meshes[0].rotation = [1,0,0,0]; invalid.meshes[1].position[2] = Infinity; assert.throws(() => animationFromModel(invalid, options), /transformaci/);
  invalid.meshes[1].position[2] = 0; invalid.meshes[1].name = '🚗'; assert.throws(() => animationFromModel(invalid, options), /Windows-1250/);
  const unnamed = model(); unnamed.meshes.push({ name: '' }); assert.equal(newAnimationPlan(options, unnamed).unnamed, 1); assert.throws(() => animationFromModel({ meshes: [] }, options), /pojmenovaných/);
});
test('new bind pose preserves a transformed parent hierarchy and later timeline keys animate its child locally', () => {
  const source = model(), parsed = parseFiveDs(animationFromModel(source, options).bytes), frames = new Map();
  source.meshes.forEach((mesh, i) => { const frame = new THREE.Group(); frame.name = mesh.name; frame.position.fromArray(mesh.position); frame.scale.fromArray(mesh.scale); frame.quaternion.copy(fromLs3dRotation(mesh.rotation)); frames.set(i + 1, frame); });
  const root = frames.get(1), child = frames.get(2); root.add(child); const before = child.getWorldPosition(new THREE.Vector3()).toArray(), preview = new AnimationPreview(frames, parsed);
  assert.equal(preview.matches.length, 2); preview.apply(25, new Map()); child.getWorldPosition(new THREE.Vector3()).toArray().forEach((v, i) => assert(Math.abs(v - before[i]) < 1e-5));
  const changed = parseFiveDs(editAnimationTimeline(animationFromModel(source, options).bytes, { frames: 50, changes: [], tracks: [{ node: 1, channel: 'position', keys: [{ source: 0, frame: 0 }, { frame: 50, value: [5,4,5] }] }] }));
  preview.nodes = changed.nodes; preview.apply(25, new Map()); assert.deepEqual(child.position.toArray(), [4,4,5]); assert.deepEqual(root.position.toArray(), [10,2,-3]);
});
test('project creation, timeline save, reopen, export, stale guards and two exact undos leave source model intact', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mafia-new-animation-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bytes = modelBytes(), asset = { path: options.model, original: 'originals/model.4ds', size: bytes.length, sha256: hash(bytes), archive: 'Own model', variants: [{}] };
  await writeSafe(root, asset.original, bytes); await writeSafe(root, 'workbench.json', JSON.stringify({ format: 'mafia-workbench', version: 1, name: 'Animation', assets: [asset], history: [] })); let p = await ModProject.open(root);
  await assert.rejects(p.createAnimation(options, 'stale'), /změnil/); assert.equal(p.manifest.history.length, 0);
  const target = await p.createAnimation(options, hash(bytes)), initial = await p.read(target); assert.equal(p.manifest.history.length, 1);
  await assert.rejects(p.createAnimation({ ...options, name: 'wb_WAVE' }, hash(bytes)), /existuje/); assert.equal(p.manifest.history.length, 1);
  await p.saveAnimationTimeline(target, { frames: 50, changes: [], tracks: [{ node: 1, channel: 'scale', keys: [{ source: 0, frame: 0 }, { frame: 50, value: [2,2,2] }] }] }, hash(initial)); const saved = await p.read(target);
  p = await ModProject.open(root); assert.equal(parseFiveDs(await p.read(target)).nodes[1].tracks.scale.times.length, 2); await p.export(path.join(root, 'export')); assert.deepEqual(await fs.readFile(path.join(root, 'export', target)), saved);
  await p.undo(); assert.deepEqual(await p.read(target), initial); await p.undo(); assert.equal(p.manifest.history.length, 0); assert(!p.manifest.assets.some(a => a.path === target)); assert.deepEqual(await p.read(options.model), bytes); assert.deepEqual(await fs.readFile(path.join(root, asset.original)), bytes);
  const edited = editFourDs(bytes, [{ id: 'meshes/1/position', value: [8,9,10] }]); await p.saveModel(options.model, [{ id: 'meshes/1/position', value: [8,9,10] }], hash(bytes)); await assert.rejects(p.createAnimation(options, hash(bytes)), /změnil/); assert.equal(p.manifest.assets.length, 1); assert.deepEqual(await p.read(options.model), edited);
});
