import test from 'node:test';
import assert from 'node:assert/strict';
import { newMissionLogicName, createdMissionLogicSelection } from '../src/shared/mission-logic-authoring.js';
import { missionTaskScript } from '../src/shared/mission-task.js';
import { missionChoicePrograms } from '../src/shared/mission-choice.js';
import { changeSceneObject, inspectScene } from '../src/core/scene.js';
import { MissionViews } from '../src/ui/mission-views.js';

const chunk = (type, data) => { const h = Buffer.alloc(6); h.writeUInt16LE(type); h.writeUInt32LE(data.length + 6, 2); return Buffer.concat([h, data]); };
function fixture() {
  let bytes = chunk(0x4c53, chunk(0x4000, Buffer.alloc(0)));
  const choice = missionChoicePrograms({ name: 'WB_CHOICE', controller: 'NPC', answers: [{ textId: 10, target: 'WB_TASK' }, { textId: 20, target: 'WB_SCRIPT' }] });
  bytes = changeSceneObject(bytes, { kind: 'add-human', name: 'NPC', model: 'human.i3d', position: [0, 0, 0], rotation: [1, 0, 0, 0], scale: [1, 1, 1], parameters: {}, code: choice.controller.code });
  const programs = [['Destination', 'end'], ['WB_TASK', missionTaskScript({ objectiveId: 10, interactionId: 20, nextObjectiveId: 30, completeId: 40, targetName: 'Destination', targetRadius: 3 })], ['WB_SCRIPT', 'end'], ...choice.nodes.map(node => [node.name, node.code])];
  for (const [name, code] of programs) bytes = changeSceneObject(bytes, { kind: 'add-detector', name, position: [0, 0, 0], mask: name.startsWith('WB_CHOICE') ? 0 : 1, code });
  return { ...inspectScene(bytes), geometry: { meshes: [] }, path: 'missions/OWN/scene2.bin', type: 'logic' };
}
test('new logic names avoid case-insensitive collisions in actors, frames, geometry and standalone programs', () => {
  const scene = fixture();
  scene.objects.push({ name: 'wb_task_2' }); scene.actors.push({ name: 'WB_TASK_3' });
  scene.geometry.meshes.push({ name: 'Wb_Task_4' }); scene.entries.push({ kind: 'script', value: { name: 'wb_task_5', code: 'end' } });
  const before = JSON.stringify(scene);
  assert.equal(newMissionLogicName(scene, 'task'), 'WB_TASK_6');
  assert.equal(newMissionLogicName(scene, 'dialogue'), 'WB_DIALOGUE');
  assert.equal(newMissionLogicName(scene, 'combat'), 'WB_COMBAT');
  assert.equal(newMissionLogicName(scene, 'custom'), 'WB_SCRIPT_2');
  assert.throws(() => newMissionLogicName(scene, 'toString'), /druh/);
  assert.equal(JSON.stringify(scene), before);
});
test('a new choice reserves all helper names including unused third and fourth answers', () => {
  const scene = fixture();
  scene.geometry.meshes.push({ name: 'wb_choice_2_answer4' });
  scene.objects.push({ name: 'WB_CHOICE_3_CLAIM' });
  assert.equal(newMissionLogicName(scene, 'choice'), 'WB_CHOICE_4');
});
test('saved task and collapsed choice select their actual source IDs and retain view preferences', () => {
  const scene = fixture(), before = JSON.stringify(scene);
  const previous = { selectedId: 'old', search: 'does not match', all: false, left: 900, top: 120, outlineHidden: true, inspectorHidden: true };
  for (const name of ['WB_TASK', 'WB_CHOICE']) {
    const entry = scene.entries.find(entry => entry.kind === 'script' && entry.value.name === name);
    const next = createdMissionLogicSelection(scene, name.toLowerCase(), previous);
    assert.deepEqual(next, { ...previous, selectedId: `script:${entry.id}`, search: '', focusSelection: true });
  }
  assert.equal(JSON.stringify(scene), before); assert.equal(previous.selectedId, 'old');
});
test('new custom scripts become visible without selecting a standalone same-name program', () => {
  const scene = fixture(), previous = { search: 'script', all: false, selectedId: 'old' };
  scene.entries.push({ id: 'standalone', kind: 'script', value: { name: 'WB_SCRIPT', code: 'end' } });
  const next = createdMissionLogicSelection(scene, 'WB_SCRIPT', previous);
  assert.equal(next.all, true); assert.equal(next.search, 'script'); assert.notEqual(next.selectedId, 'script:standalone');
  assert.equal(next.focusSelection, true);
  assert.deepEqual(createdMissionLogicSelection(scene, 'missing', previous), { ...previous, focusSelection: false });
  const entry = scene.entries.find(entry => entry.actorScript && entry.value.name === 'WB_SCRIPT');
  scene.entries.push({ ...entry, id: 'duplicate' });
  assert.deepEqual(createdMissionLogicSelection(scene, 'WB_SCRIPT', previous), { ...previous, focusSelection: false });
});
test('creation selection survives a logic rebuild and stays scoped to its project and view', () => {
  const scene = fixture(), views = new MissionViews();
  const selected = createdMissionLogicSelection(scene, 'WB_CHOICE', { all: false, search: '', left: 20, top: 30 });
  const view = { projectRoot: '/own', logicPath: scene.path, captureLogic: () => selected };
  views.remember(view);
  assert.deepEqual(views.get('/own', scene), selected);
  assert.equal(views.get('/other', scene), null);
  assert.equal(views.get('/own', { ...scene, type: 'map' }), null);
  view.disposed = true; view.captureLogic = () => ({ selectedId: 'wrong' }); views.remember(view);
  assert.deepEqual(views.get('/own', scene), selected);
});
