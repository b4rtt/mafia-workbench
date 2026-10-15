import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { missionAreaSettings, createMissionArea } from '../src/ui/mission-areas.js';
import { Viewport } from '../src/ui/viewport.js';
import { missionTaskScript } from '../src/shared/mission-task.js';
import { missionDialogueScript } from '../src/shared/mission-dialogue.js';
import { missionCombatScript } from '../src/shared/mission-combat.js';
import { missionFinishScript } from '../src/shared/mission-finish.js';
import { changeSceneObject, inspectScene } from '../src/core/scene.js';

const task = { trigger: 'area', triggerRadius: 2, objectiveId: null, interactionId: null, nextObjectiveId: 10, completeId: 20, targetName: 'Destination', targetRadius: 3 };
function fixture(code) {
  const chunk = (type, bytes) => { const h = Buffer.alloc(6); h.writeUInt16LE(type); h.writeUInt32LE(bytes.length + 6, 2); return Buffer.concat([h, bytes]); };
  const bytes = changeSceneObject(chunk(0x4c53, chunk(0x4000, Buffer.alloc(0))), { kind: 'add-detector', name: 'Quest', position: [1, 2, 3], mask: 1, code });
  return { ...inspectScene(bytes), geometry: { meshes: [{ id: 0, name: 'Destination' }] } };
}

test('whole task, dialogue, combat and finish recipes expose only their actual world-distance spheres', () => {
  const code = missionTaskScript(task), file = fixture(code), before = structuredClone(file);
  assert.deepEqual(missionAreaSettings(file, 'quest').areas, [{ name: 'quest', radius: 2, role: 'activation' }, { name: 'Destination', radius: 3, role: 'target' }]);
  assert.deepEqual(missionAreaSettings(fixture(code.replaceAll('\n', '\r\n')), 'Quest').areas, missionAreaSettings(file, 'Quest').areas);
  for (const program of [missionDialogueScript({ trigger: 'area', triggerRadius: 4, camera: false, lines: [{ speaker: 'First', textId: 10 }] }), missionCombatScript({ trigger: 'area', triggerRadius: 4, targets: ['First'], objectiveId: 10, completeId: 20 }), missionFinishScript({ trigger: 'area', triggerRadius: 4, completeId: 20 })]) {
    assert.deepEqual(missionAreaSettings(fixture(program), 'Quest').areas, [{ name: 'Quest', radius: 4, role: 'activation' }]);
  }
  assert.equal(missionAreaSettings(fixture(missionFinishScript({ completeId: 20 })), 'Quest'), null);
  assert.equal(missionAreaSettings(fixture(missionTaskScript({ ...task, trigger: 'load', triggerRadius: null, targetName: null, targetRadius: null, inventory: { itemId: 23, atTarget: false, consume: true } })), 'Quest'), null);
  for (const extra of [{ vehicle: { name: 'Car', driverOnly: true } }, { escort: { humanName: 'First' } }, { inventory: { itemId: 23, atTarget: true, consume: true } }]) assert.equal(missionAreaSettings(fixture(missionTaskScript({ ...task, ...extra })), 'Quest').areas[1].name, 'Destination');
  assert.deepEqual(file, before);
});

test('custom, ambiguous and masked programs are never guessed; valid drafts replace the preview without changing source', () => {
  const file = fixture(missionTaskScript(task)), entry = file.entries.find(e => e.actorScript), mask = file.entries.find(e => e.detectorParameter), before = structuredClone(file);
  const draft = missionTaskScript({ ...task, triggerRadius: 7, targetRadius: 8 });
  assert.deepEqual(missionAreaSettings(file, 'Quest', new Map([[entry.id, { ...entry.value, code: draft }]])).areas.map(a => a.radius), [7, 8]);
  for (const value of [{ ...entry.value, code: entry.value.code + '\nwait 1' }, { invalid: true }, null]) assert.equal(missionAreaSettings(file, 'Quest', new Map([[entry.id, value]])), null);
  for (const value of [0, 5, { invalid: true }]) assert.equal(missionAreaSettings(file, 'Quest', new Map([[mask.id, value]])), null);
  assert.equal(missionAreaSettings({ ...file, actors: [...file.actors, file.actors[0]] }, 'Quest'), null);
  assert.equal(missionAreaSettings({ ...file, cacheSource: true }, 'Quest'), null);
  assert.equal(missionAreaSettings(file, null), null);
  assert.deepEqual(file, before);
});

test('missing, duplicate and draft-renamed target anchors are explicit, without hiding a valid activation sphere', () => {
  const file = fixture(missionTaskScript(task));
  for (const geometry of [{ meshes: [] }, { meshes: [file.geometry.meshes[0], { ...file.geometry.meshes[0], id: 1, name: 'DESTINATION' }] }]) {
    const settings = missionAreaSettings({ ...file, geometry }, 'Quest'); assert.equal(settings.areas.length, 1); assert.match(settings.reason, /chybí nebo je nejednoznačný/);
  }
  const target = { id: 'target', name: 'Destination', fields: { name: 'target/name' } };
  const renamed = missionAreaSettings({ ...file, objects: [...file.objects, target] }, 'Quest', new Map([[target.fields.name, 'Renamed']]));
  assert.equal(renamed.areas.length, 1); assert.match(renamed.reason, /uložte přejmenování/);
  // An object overriding one geometry frame is one world anchor, not a duplicate.
  assert.equal(missionAreaSettings({ ...file, objects: [...file.objects, target] }, 'Quest').areas.length, 2);
});

test('area geometry is a full height-inclusive sphere with distinct activation and target colors', () => {
  for (const role of ['activation', 'target']) {
    const area = createMissionArea({ name: 'Anchor', radius: 3, role }), vertices = area.geometry.getAttribute('position');
    assert.equal(vertices.count, 384);
    for (let i = 0; i < vertices.count; i++) assert.ok(Math.abs(new THREE.Vector3().fromBufferAttribute(vertices, i).length() - 3) < 1e-6);
    assert.deepEqual(new THREE.Box3().setFromObject(area).min.toArray(), [-3, -3, -3]);
    assert.equal(area.material.color.getHex(), role === 'activation' ? 0x60a5fa : 0x34d399);
    area.geometry.dispose(); area.material.dispose();
  }
});

test('overlays follow reflected world centers and draft transforms while staying spherical, outside picking and framing', () => {
  const view = Object.create(Viewport.prototype);
  Object.assign(view, { scene: new THREE.Scene(), root: new THREE.Group(), frames: new Map(), materials: new Set(), textures: new Set(), camera: new THREE.PerspectiveCamera(50, 1, .02, 20000), controls: { target: new THREE.Vector3(), update() {} } });
  view.root.scale.z = -1; view.scene.add(view.root);
  const add = (id, name, parent, position) => view.addSceneObject({ id, name, parent, position, fields: { position: id + '/position' } });
  const parent = add('parent', 'Parent', 'Primary sector', [10, 2, 30]), owner = add('quest', 'Quest', 'Parent', [1, 0, 2]), target = add('target', 'Destination', 'Primary sector', [0, 1, 15]);
  view.update(parent, { rotation: [Math.SQRT1_2, 0, Math.SQRT1_2, 0], scale: [2, 3, 4] }); view.linkScene(); view.fit(); const camera = view.captureCamera();
  const settings = { areas: [{ name: 'quest', radius: 2, role: 'activation' }, { name: 'Destination', radius: 3, role: 'target' }] };
  view.showMissionAreas(settings); view.scene.updateMatrixWorld(true);
  const group = view.missionAreaOverlay, area = group.children[0], center = view.frames.get(owner).getWorldPosition(new THREE.Vector3());
  assert.ok(area.getWorldPosition(new THREE.Vector3()).distanceTo(center) < 1e-8); assert.deepEqual(area.scale.toArray(), [1, 1, 1]);
  assert.deepEqual(new THREE.Box3().setFromObject(area).getSize(new THREE.Vector3()).toArray(), [4, 4, 4]);
  assert.equal(view.root.children.includes(group), false); view.fit(); assert.deepEqual(view.captureCamera(), camera);
  const ray = new THREE.Raycaster(center.clone().add(new THREE.Vector3(0, 0, 10)), new THREE.Vector3(0, 0, -1)); assert.ok(ray.intersectObject(view.root, true).every(hit => hit.object !== area));
  view.update(parent, { position: [20, 5, 40] }); assert.ok(area.position.distanceTo(view.frames.get(owner).getWorldPosition(new THREE.Vector3())) < 1e-8);
  view.update(target, { position: [4, 7, 8] }); assert.deepEqual(group.children[1].position.toArray(), [4, 7, -8]);
  view.frames.get(parent).visible = false; view.syncMissionAreas(); assert.equal(area.visible, false); assert.equal(group.children[1].visible, true);
  view.frames.get(parent).visible = true; view.syncMissionAreas(); assert.equal(area.visible, true);
  view.showMissionAreas(settings, false); assert.equal(view.missionAreaOverlay.visible, false); assert.deepEqual(view.captureCamera(), camera);
  // Replacement and deselection must dispose helpers rather than accumulating.
  const old = view.missionAreaOverlay; let geometries = 0, materials = 0;
  old.traverse(n => { n.geometry?.addEventListener('dispose', () => geometries++); n.material?.addEventListener('dispose', () => materials++); });
  view.showMissionAreas(settings, true); assert.equal(old.parent, null); assert.equal(geometries, 2); assert.equal(materials, 2);
  view.showMissionAreas(null); assert.equal(view.missionAreaOverlay, null); assert.equal(view.materials.size, 3); // original fallback markers only
});
