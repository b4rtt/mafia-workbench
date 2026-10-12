import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sampleTrack, AnimationPreview, bindSkin } from '../src/ui/animation.js';

test('5DS preview interpolates vectors, quaternion shortest arcs, duplicate keys and endpoints', () => {
  const track = { times: [0, 10, 10, 20], values: [[0,0,0],[1,0,0],[3,0,0],[5,0,0]] };
  assert.deepEqual(sampleTrack(track, -1), [0,0,0]); assert.deepEqual(sampleTrack(track, 10), [3,0,0]);
  assert.deepEqual(sampleTrack(track, 15), [4,0,0]); assert.deepEqual(sampleTrack(track, 100), [5,0,0]);
  const rotation = sampleTrack({ times: [0,10], values: [[1,0,0,0],[0,0,0,1]] }, 5, true);
  assert.ok(Math.abs(rotation[0] - Math.SQRT1_2) < 1e-8); assert.ok(Math.abs(rotation[3] - Math.SQRT1_2) < 1e-8);
  assert.deepEqual(sampleTrack({ times: [0,1], values: [[1,0,0,0],[-1,0,0,0]] }, .5, true), [1,0,0,0]);
});
test('animation preserves missing channels, previews drafts without mutating source, and reports missing nodes', () => {
  const object = new THREE.Group(); object.name = 'ARM'; object.position.set(7,8,9);
  const animation = { nodes: [{ id: 0, name: 'arm', tracks: { scale: { times: [0,10], values: [[1,1,1],[3,3,3]] } } }, { id: 1, name: 'Missing', tracks: {} }] }, before = structuredClone(animation);
  const preview = new AnimationPreview(new Map([[1,object]]), animation);
  preview.apply(5, new Map([['nodes/0/scale/1', [5,5,5]]]));
  assert.deepEqual(object.scale.toArray(), [3,3,3]); assert.deepEqual(object.position.toArray(), [7,8,9]);
  assert.deepEqual(preview.unmatched, ['Missing']); assert.deepEqual(animation, before);
  preview.apply(0); assert.deepEqual(object.scale.toArray(), [1,1,1]);
  preview.apply(10, new Map([['nodes/0/name', 'Absent']])); assert.equal(preview.matches.length,0);
  assert.deepEqual(object.scale.toArray(), [1,1,1]); assert.deepEqual(animation,before);
});
test('skin deforms rigid and blended vertices in local space with scaled, reflected bind hierarchy', () => {
  const root = new THREE.Group(); root.scale.z = -1; root.position.x = 7;
  const owner = new THREE.Group(); owner.position.x = 3; owner.scale.setScalar(2); root.add(owner);
  const bone = new THREE.Bone(); bone.position.y = 1; bone.userData.frame = { joint: 1 }; owner.add(bone);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute([1,1,0, 1,1,0, 1,1,0], 3));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial()); owner.add(mesh);
  const skin = { valid: true, rootVertices: 1, bones: [{ id: 1, rigid: 1, parent: 0, weights: [.25] }] }, before = structuredClone(skin);
  assert.equal(bindSkin(mesh, owner, new Map([[1,bone]]), skin), true);
  root.updateMatrixWorld(true);
  assert.ok(mesh.applyBoneTransform(0, new THREE.Vector3(1,1,0)).distanceTo(new THREE.Vector3(1,1,0)) < 1e-6);
  bone.quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1), Math.PI); root.updateMatrixWorld(true);
  const rigid = mesh.applyBoneTransform(0, new THREE.Vector3(1,1,0)); assert.ok(rigid.distanceTo(new THREE.Vector3(-1,1,0)) < 1e-6);
  const blend = mesh.applyBoneTransform(1, new THREE.Vector3(1,1,0)); assert.ok(blend.distanceTo(new THREE.Vector3(.5,1,0)) < 1e-6);
  assert.ok(mesh.applyBoneTransform(2, new THREE.Vector3(1,1,0)).distanceTo(new THREE.Vector3(1,1,0)) < 1e-6); assert.deepEqual(skin, before);
  assert.equal(bindSkin(mesh, owner, new Map(), skin), false);
  mesh.skeleton.dispose(); geometry.dispose(); mesh.material.dispose();
});
