import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ModProject } from '../src/core/project.js';
import { writeSafe, hash } from '../src/core/files.js';
import { inspectScene, editScene, changeSceneObject } from '../src/core/scene.js';
import { missionTaskScript } from '../src/shared/mission-task.js';
import { missionDialogueScript } from '../src/shared/mission-dialogue.js';
import { missionCombatScript } from '../src/shared/mission-combat.js';
import { missionChoicePrograms } from '../src/shared/mission-choice.js';
import { addTextDbEntry, editTextDb } from '../src/core/textdb.js';
import { collisionFixture } from './fixtures/collision.js';

const scenePath = 'missions/Test/scene2.bin', textPath = 'TABLES/textdb_CZ.def';
const task = { objectiveId: 10, interactionId: 20, nextObjectiveId: 30, completeId: 40, targetName: 'Finish', flow: { onComplete: 'Talk' } };
const chunk = (type, data) => { const header = Buffer.alloc(6); header.writeUInt16LE(type); header.writeUInt32LE(data.length + 6, 2); return Buffer.concat([header, data]); };
function textDb(ids) {
  let bytes = Buffer.alloc(17); bytes.writeUInt32LE(1); bytes.writeUInt32LE(99999999, 8); bytes.writeUInt32LE(16, 12);
  for (const id of ids) bytes = addTextDbEntry(bytes, textPath, { id, text: `Text ${id}` });
  return bytes;
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mafia-mission-check-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeSafe(root, 'workbench.json', JSON.stringify({ format: 'mafia-workbench', version: 2, name: 'Mission check', assets: [], history: [] }));
  const project = await ModProject.open(root);
  let scene = chunk(0x4c53, chunk(0x4000, Buffer.alloc(0)));
  for (const name of ['Tommy', 'Companion']) scene = changeSceneObject(scene, { kind: 'add-human', name, model: 'Human.i3d', position: [0, 0, 0], rotation: [1, 0, 0, 0], scale: [1, 1, 1], parameters: {}, code: 'label 99\nwait 1000\ngoto 99' });
  const player = inspectScene(scene).entries.find(entry => entry.label === 'Typ aktéra' && entry.context.endsWith('/ Tommy'));
  scene = editScene(scene, player.id, 2);
  for (const [name, code] of [['Finish', 'wait 777\nend'], ['Quest', missionTaskScript(task)], ['Talk', missionDialogueScript({ trigger: 'load', lines: [{ speaker: 'Companion', textId: 80 }] })]]) scene = changeSceneObject(scene, { kind: 'add-detector', name, position: [8, 0, 0], mask: 1, code });
  const geometry = Buffer.alloc(19); geometry.write('4DS\0'); geometry.writeUInt16LE(29, 4); geometry[18] = 1;
  const voice = Buffer.alloc(44); voice.write('RIFF'); voice.writeUInt32LE(36, 4); voice.write('WAVE', 8);
  await project.createFiles([{ path: scenePath, data: scene }, { path: 'MISSIONS/TEST/SCENE.4DS', data: geometry }, { path: 'missions/test/tree.klz', data: collisionFixture() }, { path: textPath, data: textDb([10, 20, 30, 40, 80]) }, { path: 'tables/textdb_en.def', data: textDb([10, 20, 30, 40]) }, { path: 'SOUNDS/00000080.WAV', data: voice }]);
  return { project, root, scene, geometry, voice };
}
async function script(project, name, code) {
  const before = await project.read(scenePath), entry = inspectScene(before).entries.find(entry => entry.actorScript && entry.value.name === name);
  await project.change(scenePath, editScene(before, entry.id, { ...entry.value, code }), 'Test source');
}
const errors = report => report.issues.filter(issue => issue.severity === 'error');

test('saved mission check follows real overlay data and case-insensitive paths without changing any file or history', async t => {
  const { project, root } = await fixture(t), manifest = await fs.readFile(path.join(root, 'workbench.json')), before = new Map();
  for (const asset of project.manifest.assets) before.set(asset.path, await project.read(asset.path));
  const report = await project.checkMission('MISSIONS/TEST/SCENE.4DS');
  assert.deepEqual(errors(report), []); assert.equal(report.recipes, 2); assert.equal(report.textReferences, 5); assert.equal(report.voices, 1); assert.equal(report.textDb, textPath);
  assert(report.custom > 0); assert(report.issues.some(issue => issue.code === 'custom')); assert.equal(report.files.length, 5);
  for (const file of report.files) assert.equal(file.sha256, hash(before.get(file.path)));
  assert.deepEqual(await fs.readFile(path.join(root, 'workbench.json')), manifest);
  for (const [name, bytes] of before) assert.deepEqual(await project.read(name), bytes);
  const en = await project.checkMission(scenePath, 'TABLES/TEXTDB_EN.DEF');
  assert.deepEqual(errors(en).map(issue => issue.code), ['text-id']); assert.equal(errors(en)[0].textId, 80); assert.equal(errors(en)[0].path, 'tables/textdb_en.def');
  await assert.rejects(project.checkMission(scenePath, 'other/textdb_cz.def'), /TextDB/);
  await assert.rejects(project.checkMission('../Test/scene2.bin'));
});

test('missing or boundary text and a damaged voice have actionable source locations; undo restores check results', async t => {
  const { project, root } = await fixture(t), history = project.manifest.history.length;
  await script(project, 'Quest', missionTaskScript({ ...task, completeId: 99999999 }));
  await project.change('sounds/00000080.wav', Buffer.from('bad'), 'Test voice');
  let report = await project.checkMission(scenePath);
  assert(errors(report).some(issue => issue.code === 'text-id' && issue.textId === 99999999));
  const voice = errors(report).find(issue => issue.code === 'voice'); assert.equal(voice.object, 'Talk'); assert.equal(voice.path, scenePath); assert(voice.entryId);
  const reopened = await ModProject.open(root); assert.deepEqual((await reopened.checkMission(scenePath)).issues, report.issues);
  await reopened.undo(); await reopened.undo(); report = await reopened.checkMission(scenePath); assert.deepEqual(errors(report), []); assert.equal(reopened.manifest.history.length, history);
  const bytes = await reopened.read(textPath), changed = editTextDb(bytes, textPath, [{ index: 0, text: '' }]); await reopened.change(textPath, changed, 'Empty text');
  assert((await reopened.checkMission(scenePath)).issues.some(issue => issue.code === 'text-empty' && issue.textId === 10));
});

test('missing frame, vehicle, NPC, item table and signal are errors; unsupported source is explicitly unknown', async t => {
  const { project } = await fixture(t);
  await script(project, 'Quest', missionTaskScript({ ...task, targetName: 'Missing', vehicle: { name: 'AbsentCar', driverOnly: true }, failure: { humanName: 'AbsentHuman', textId: 40 }, flow: { onComplete: 'MissingSignal' } }));
  await script(project, 'Talk', missionDialogueScript({ trigger: 'load', lines: [{ speaker: 'AbsentSpeaker', textId: 80 }], flow: { waitForSignal: true } }));
  let report = await project.checkMission(scenePath), codes = new Set(errors(report).map(issue => issue.code));
  for (const code of ['target', 'vehicle', 'human', 'flow', 'speaker']) assert(codes.has(code), code);
  const flow = errors(report).find(issue => issue.code === 'flow'); assert(flow.entryId); assert.equal(flow.path, scenePath);
  assert(report.issues.some(issue => issue.severity === 'warning' && issue.message.includes('odesílatele')));
  await script(project, 'Quest', missionTaskScript({ ...task, targetName: null, targetRadius: null, inventory: { itemId: 23, atTarget: false, consume: false } }));
  report = await project.checkMission(scenePath); assert(errors(report).some(issue => issue.code === 'inventory'));
  await script(project, 'Quest', 'mission_objectives 123456\nend'); report = await project.checkMission(scenePath);
  assert.equal(report.recipes, 1); assert(!report.issues.some(issue => issue.textId === 123456)); assert(report.issues.some(issue => issue.code === 'custom'));
});

test('missing required files, unsupported data, missing player and a missing next mission are reported without a false success', async t => {
  const { project } = await fixture(t);
  await script(project, 'Quest', missionTaskScript({ ...task, flow: null, nextMission: 'MissingMission' }));
  let report = await project.checkMission(scenePath); assert.equal(errors(report).filter(issue => issue.code === 'destination').length, 3);
  let scene = await project.read(scenePath), player = inspectScene(scene).entries.find(entry => entry.label === 'Typ aktéra' && entry.context.endsWith('/ Tommy'));
  await project.change(scenePath, editScene(scene, player.id, 27), 'No Player'); report = await project.checkMission(scenePath); assert(errors(report).some(issue => issue.code === 'player'));
  await project.change('missions/Test/scene.4ds', Buffer.from('bad'), 'Unsupported geometry');
  report = await project.checkMission(scenePath); assert(errors(report).some(issue => issue.code === 'file' && /SCENE.4DS$/.test(issue.path))); assert(report.issues.some(issue => issue.code === 'incomplete')); assert.equal(report.recipes, 0);
  const originalAssets = project.manifest.assets; project.manifest.assets = originalAssets.filter(asset => !asset.path.endsWith('tree.klz'));
  report = await project.checkMission(scenePath); assert(errors(report).some(issue => issue.message.includes('tree.klz'))); project.manifest.assets = originalAssets;
});

test('a changed overlay or concurrent project revision invalidates the entire check and never creates history', async t => {
  const { project } = await fixture(t), read = project.read.bind(project), history = project.manifest.history.length;
  let count = 0; project.read = async name => { const bytes = await read(name); if (name === scenePath && ++count === 2) return Buffer.concat([bytes, Buffer.from('external change')]); return bytes; };
  await assert.rejects(project.checkMission(scenePath), /během kontroly změnila/); assert.equal(project.manifest.history.length, history);
  project.read = async name => { const bytes = await read(name); project.manifest.name = 'Changed revision'; return bytes; };
  await assert.rejects(project.checkMission(scenePath), /během kontroly změnil/); assert.equal(project.manifest.history.length, history);
  project.read = read; project.busy = true; await assert.rejects(project.checkMission(scenePath), /ukládání/); project.busy = false;
});

test('choice answer text, combat actors and escort bindings are checked from exact recipes, with shared voice IDs deduplicated', async t => {
  const { project } = await fixture(t);
  const plan = missionChoicePrograms({ name: 'Choice', controller: 'Companion', answers: [{ textId: 500, target: 'Quest' }, { textId: 600, target: 'Talk' }] });
  await script(project, 'Companion', plan.controller.code);
  let bytes = await project.read(scenePath);
  for (const node of plan.nodes) bytes = changeSceneObject(bytes, { kind: 'add-detector', name: node.name, position: [0, 0, 0], mask: 0, code: node.code });
  bytes = changeSceneObject(bytes, { kind: 'add-detector', name: 'Combat', position: [0, 0, 0], mask: 1, code: missionCombatScript({ trigger: 'load', targets: ['MissingEnemy'], objectiveId: 10, completeId: 40 }) });
  await project.change(scenePath, bytes, 'Choice and combat');
  await script(project, 'Quest', missionTaskScript({ ...task, escort: { humanName: 'MissingEscort' } }));
  await script(project, 'Talk', missionDialogueScript({ trigger: 'load', lines: [{ speaker: 'Companion', textId: 80 }, { speaker: 'Companion', textId: 80 }] }));
  const report = await project.checkMission(scenePath), failures = errors(report);
  assert.equal(report.recipes, 4); assert.equal(report.voices, 1);
  assert.deepEqual(failures.filter(issue => issue.code === 'text-id').map(issue => issue.textId), [500, 600]);
  assert(failures.some(issue => issue.code === 'human' && issue.object === 'Combat'));
  assert(failures.some(issue => issue.code === 'escort' && issue.object === 'Quest'));
});
