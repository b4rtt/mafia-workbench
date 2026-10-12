import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Viewport } from '../src/ui/viewport.js';
function viewport() {
  const view = Object.create(Viewport.prototype);
  Object.assign(view, { root: new THREE.Group(), frames: new Map(), materials: new Set(), textures: new Set(), camera: new THREE.PerspectiveCamera(), controls: { target: new THREE.Vector3(), update() {} } });
  view.root.scale.z = -1;
  return view;
}
function source(id, name, parent, position) { return { id, name, parent, position, fields: { position: id + '/position' } }; }
test('map links local transforms and keeps backdrop outside camera fitting and original objects', () => {
  const view = viewport(), child = source('child', 'Child', 'PARENT', [1,2,3]), before = structuredClone(child);
  const childId = view.addSceneObject(child), parentId = view.addSceneObject(source('parent', 'Parent', 'Primary sector', [10,20,30]));
  const skyId = view.addSceneObject(source('sky', 'Sky', 'Backdrop sector', [1e6,1e6,1e6]));
  assert.deepEqual(view.linkScene(), []);
  assert.deepEqual(view.frames.get(childId).getWorldPosition(new THREE.Vector3()).toArray(), [11,22,-33]);
  assert.equal(view.frames.get(childId).parent, view.frames.get(parentId));
  assert.equal(view.frames.get(skyId).parent, view.backdrop); assert.equal(view.backdrop.visible, false);
  view.fit(); const target = view.controls.target.clone();
  view.showBackdrop(true); view.fit(); assert.deepEqual(view.controls.target, target);
  assert.ok(target.length() < 100); assert.deepEqual(child, before);
});
test('LS3D texture colour flags prevent blue authoring colours from tinting skin', () => {
  const view = viewport();
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(.19,.39,.68) });
  material.userData.textureColored = false;
  view.applyTexture(material, new THREE.Texture());
  assert.deepEqual(material.color.toArray(), [1,1,1]); assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
  const colored = new THREE.MeshStandardMaterial({ color: new THREE.Color(.2,.4,.6) });
  colored.userData.textureColored = true; view.applyTexture(colored, new THREE.Texture());
  assert.deepEqual(colored.color.toArray(), [.2,.4,.6]);
});
test('map refuses cycles before linking and reports unresolved parents', () => {
  const view = viewport(), a = view.addSceneObject(source('a', 'A', 'B', [0,0,0])), b = view.addSceneObject(source('b', 'B', 'A', [0,0,0]));
  assert.throws(() => view.linkScene(), /cyklická/);
  assert.equal(view.frames.get(a).parent, view.root); assert.equal(view.frames.get(b).parent, view.root);
  const missing = viewport(); missing.addSceneObject(source('a', 'A', 'Missing', [0,0,0])); assert.equal(missing.linkScene().length, 1);
});
