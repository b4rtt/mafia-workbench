import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { missionFinishScript, inspectMissionFinish, editableMissionFinish } from '../src/shared/mission-finish.js';
import { missionLogic } from '../src/shared/mission-logic.js';
import { newMissionLogicName, createdMissionLogicSelection } from '../src/shared/mission-logic-authoring.js';
import { missionTaskScript } from '../src/shared/mission-task.js';
import { ModProject } from '../src/core/project.js';
import { hash, writeSafe } from '../src/core/files.js';
import { changeSceneObject, inspectScene, editScene } from '../src/core/scene.js';
import { addTextDbEntry } from '../src/core/textdb.js';
import { collisionFixture } from './fixtures/collision.js';

const name = 'missions/Own/scene2.bin', geometryPath = 'missions/Own/scene.4ds', textPath = 'TABLES/textdb_cz.def';
const chunk = (type, data) => { const h = Buffer.alloc(6); h.writeUInt16LE(type); h.writeUInt32LE(data.length + 6, 2); return Buffer.concat([h, data]); };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mafia-finish-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeSafe(root, 'workbench.json', JSON.stringify({ format: 'mafia-workbench', version: 2, name: 'Finish', assets: [], history: [] }));
  const p = await ModProject.open(root);
  let scene = chunk(0x4c53, Buffer.concat([chunk(0x4000, Buffer.alloc(0)), chunk(0xbabe, Buffer.from('unknown data'))]));
  scene = changeSceneObject(scene, { kind: 'add-human', name: 'Tommy', model: 'human.i3d', position: [0, 0, 0], rotation: [1, 0, 0, 0], scale: [1, 1, 1], parameters: {}, code: 'label 99\nwait 1000\ngoto 99' });
  const player = inspectScene(scene).entries.find(entry => entry.label === 'Typ aktéra'); scene = editScene(scene, player.id, 2);
  const geometry = Buffer.alloc(19); geometry.write('4DS\0'); geometry.writeUInt16LE(29, 4); geometry[18] = 1;
  let texts = Buffer.alloc(17); texts.writeUInt32LE(1); texts.writeUInt32LE(99999999, 8); texts.writeUInt32LE(16, 12);
  for (const [id, text] of [[10, 'Použít'], [20, 'Hotovo'], [30, 'Neúspěch'], [40, '   ']]) texts = addTextDbEntry(texts, textPath, { id, text });
  await p.createFiles([{ path: name, data: scene }, { path: geometryPath, data: geometry }, { path: 'missions/Own/tree.klz', data: collisionFixture() }, { path: textPath, data: texts }, ...['scene2.bin', 'scene.4ds', 'tree.klz'].map((filename, i) => ({ path: `MISSIONS/Next/${filename}`, data: [scene, geometry, collisionFixture()][i] }))]);
  const request = finish => ({ kind: 'add-detector', name: 'WB_FINISH', position: [1, 2, 3], finish: { outcome: 'success', completeId: 20, textDb: textPath, textHash: hash(texts), ...finish } });
  return { p, root, scene, geometry, texts, request, history: p.manifest.history.length };
}

test('terminal recipes wait for signal and activation before ending, without a fake objective or target', () => {
  for (const outcome of ['success', 'failure', 'mission']) for (const trigger of ['load', 'use', 'area']) for (const waitForSignal of [true, false]) {
    const finish = { outcome, trigger, ...(trigger === 'area' ? { triggerRadius: 2.5 } : {}), interactionId: trigger === 'use' ? 10 : null, completeId: outcome === 'mission' ? null : 20, nextMission: outcome === 'mission' ? 'NEXT' : null, waitForSignal };
    const code = missionFinishScript(finish), terminal = code.indexOf(outcome === 'mission' ? 'change_mission' : 'endofmission');
    assert.deepEqual(inspectMissionFinish(code), finish); assert.deepEqual(inspectMissionFinish(code.replaceAll('\n', '\r\n')), finish);
    assert.equal(code.includes('detector_issignal'), waitForSignal); assert.equal(code.includes('dim_flt 1'), trigger === 'area');
    if (waitForSignal) assert(code.indexOf('detector_issignal') < terminal);
    if (trigger === 'area') assert(code.indexOf('detector_inrange') > code.indexOf('label 2') && code.indexOf('label 4') < terminal);
    if (trigger === 'use') assert(code.indexOf('detector_waitforuse 10') < terminal);
    assert(!/mission_objectives|findframe|findactor|detector_setsignal|autosave/.test(code));
    assert(code.endsWith(outcome === 'mission' ? 'change_mission "NEXT", "", -1\nend' : `endofmission ${outcome === 'success' ? 1 : 0}, 20\nend`));
  }
  const valid = { completeId: 20 };
  for (const invalid of [{ outcome: 'other' }, { completeId: -1 }, { completeId: 2147483648 }, { completeId: '20' }, { waitForSignal: 'false' }, { trigger: 'area', triggerRadius: 0 }, { trigger: 'load', interactionId: 10 }, { trigger: 'use', interactionId: null }, { outcome: 'mission', completeId: null, nextMission: '../escape' }, { outcome: 'mission', nextMission: 'NEXT' }, { nextMission: 'NEXT' }]) assert.throws(() => missionFinishScript({ ...valid, ...invalid }));
});

test('only the whole unmodified terminal program and unique mask-one actor are editable', async t => {
  const { p, scene, request } = await fixture(t); await p.changeSceneObject(name, request(), hash(scene));
  const bytes = await p.read(name), parsed = { ...inspectScene(bytes), geometry: { meshes: [] } }, entry = editableMissionFinish(parsed, 'wb_finish').entry;
  for (const source of [entry.value.code + '\nwait 1', entry.value.code.replace('wait 2000', 'wait 3000'), entry.value.code.replace('endofmission 1', 'endofmission 0') + '\n', entry.value.code.replace('label 2', 'label 9')]) assert.equal(inspectMissionFinish(source), null);
  assert.equal(editableMissionFinish({ ...parsed, actors: [...parsed.actors, { ...parsed.actors.at(-1) }] }, 'WB_FINISH'), null);
  const mask = parsed.entries.find(entry => entry.detectorParameter && entry.id.startsWith(parsed.actors.at(-1).id + '/'));
  const changed = inspectScene(editScene(bytes, mask.id, 0)); assert.equal(editableMissionFinish(changed, 'WB_FINISH'), null);
  const custom = editScene(bytes, entry.id, { ...entry.value, code: entry.value.code + '\nwait 1' }); await p.change(name, custom, 'Custom source');
  await assert.rejects(p.changeSceneObject(name, { kind: 'configure-finish', target: 'WB_FINISH', finish: request().finish }, hash(custom)), /nezměněnou/);
  assert.deepEqual(await p.read(name), custom);
});

test('create, configure, reopen, export and one-step undo preserve all unrelated data', async t => {
  const { p, root, scene, geometry, texts, request, history } = await fixture(t);
  await p.changeSceneObject(name, request(), hash(scene)); const created = await p.read(name); assert.equal(p.manifest.history.length, history + 1);
  const beforeEntry = editableMissionFinish(inspectScene(created), 'WB_FINISH').entry;
  await p.changeSceneObject(name, { kind: 'configure-finish', target: 'wb_finish', finish: request({ outcome: 'failure', completeId: 30, trigger: 'area', triggerRadius: 4 }).finish }, hash(created));
  const edited = await p.read(name), recovered = editableMissionFinish(inspectScene(edited), 'WB_FINISH'); assert.equal(recovered.finish.outcome, 'failure'); assert.equal(recovered.finish.triggerRadius, 4); assert.equal(recovered.entry.id, beforeEntry.id);
  const expected = editScene(created, beforeEntry.id, { ...beforeEntry.value, code: missionFinishScript(request({ outcome: 'failure', completeId: 30, trigger: 'area', triggerRadius: 4 }).finish) }); assert.deepEqual(edited, expected);
  const reopened = await ModProject.open(root); await reopened.export(path.join(root, 'export')); assert.deepEqual(await fs.readFile(path.join(root, 'export', name)), edited);
  assert.deepEqual(await reopened.read(textPath), texts); assert.deepEqual(await reopened.read(geometryPath), geometry);
  await reopened.undo(); assert.deepEqual(await reopened.read(name), created); await reopened.undo(); assert.deepEqual(await reopened.read(name), scene); assert.equal(reopened.manifest.history.length, history);
});

test('stale, missing, blank and boundary text, conflicting templates and stale scene never create a partial node', async t => {
  const { p, scene, request, history } = await fixture(t);
  for (const change of [{ textHash: 'old' }, { completeId: 1234 }, { completeId: 40 }, { completeId: 99999999 }]) await assert.rejects(p.changeSceneObject(name, request(change), hash(scene)));
  await assert.rejects(p.changeSceneObject(name, { ...request(), task: {} }, hash(scene)), /jednu šablonu/);
  await assert.rejects(p.changeSceneObject(name, request(), 'old'), /změnil/);
  assert.deepEqual(await p.read(name), scene); assert.equal(p.manifest.history.length, history);
});

test('transition validates its destination, canonicalizes case, guards every file and needs no text for automatic start', async t => {
  const { p, scene, request, history } = await fixture(t), destination = await p.missionDestination('next');
  const transition = request({ outcome: 'mission', completeId: null, nextMission: 'next', nextMissionHashes: destination.hashes, textDb: undefined, textHash: undefined });
  await assert.rejects(p.changeSceneObject(name, { ...transition, finish: { ...transition.finish, nextMissionHashes: {} } }, hash(scene)), /změnila/);
  await assert.rejects(p.changeSceneObject(name, { ...transition, finish: { ...transition.finish, nextMission: 'Own' } }, hash(scene)), /jinou misi/);
  await p.changeSceneObject(name, transition, hash(scene)); const saved = await p.read(name); assert.equal(editableMissionFinish(inspectScene(saved), 'WB_FINISH').finish.nextMission, 'Next');
  await p.undo(); assert.deepEqual(await p.read(name), scene); assert.equal(p.manifest.history.length, history);
  const batch = p.changeBatch; p.changeBatch = async function(files, ...args) { await this.change('MISSIONS/Next/scene2.bin', Buffer.concat([scene, Buffer.from('changed')]), 'Concurrent destination'); return batch.call(this, files, ...args); };
  await assert.rejects(p.changeSceneObject(name, transition, hash(scene)), /změnil/); assert.deepEqual(await p.read(name), scene); p.changeBatch = batch; await p.undo();
  p.changeBatch = async function(files, ...args) { await this.change(textPath, Buffer.concat([await this.read(textPath), Buffer.from('changed')]), 'Concurrent text'); return batch.call(this, files, ...args); };
  await assert.rejects(p.changeSceneObject(name, request(), hash(scene)), /změnil/); assert.deepEqual(await p.read(name), scene); p.changeBatch = batch; await p.undo();
});

test('logic connects incoming signals to the terminal, shows failure and transition, and checks their dependencies', async t => {
  const { p, scene, request } = await fixture(t); await p.changeSceneObject(name, request({ outcome: 'failure', completeId: 30 }), hash(scene));
  let bytes = await p.read(name);
  bytes = changeSceneObject(bytes, { kind: 'add-detector', name: 'Quest', mask: 1, position: [0, 0, 0], code: missionTaskScript({ objectiveId: 10, interactionId: 10, nextObjectiveId: 20, completeId: 30, targetName: 'WB_FINISH', flow: { onComplete: 'WB_FINISH' } }) });
  await p.change(name, bytes, 'Incoming signal');
  const sceneFile = await p.inspectMap(name), graph = missionLogic(sceneFile), node = graph.nodes.find(node => node.kind === 'finish');
  assert.equal(newMissionLogicName(sceneFile, 'finish'), 'WB_FINISH_2'); assert.equal(createdMissionLogicSelection(sceneFile, 'WB_FINISH', {}).selectedId, node.id);
  assert.equal(node.waiting, true); assert.deepEqual(node.warnings, []); assert(graph.edges.some(edge => edge.to === node.id && edge.kind === 'success')); assert(graph.edges.some(edge => edge.from === node.id && edge.kind === 'failure' && graph.nodes.find(node => node.id === edge.to).kind === 'ending'));
  let report = await p.checkMission(name); assert.equal(report.recipes, 2); assert.deepEqual(report.issues.filter(issue => issue.severity === 'error'), []);
  const entry = editableMissionFinish(inspectScene(bytes), 'WB_FINISH').entry;
  await p.change(name, editScene(bytes, entry.id, { ...entry.value, code: missionFinishScript({ completeId: 123456 }) }), 'Missing text');
  report = await p.checkMission(name); assert(report.issues.some(issue => issue.code === 'text-id' && issue.textId === 123456));
  const transition = editScene(bytes, entry.id, { ...entry.value, code: missionFinishScript({ outcome: 'mission', nextMission: 'MISSING' }) }); await p.change(name, transition, 'Missing destination');
  report = await p.checkMission(name); assert.equal(report.issues.filter(issue => issue.code === 'destination').length, 3); assert(missionLogic(await p.inspectMap(name)).nodes.some(node => node.kind === 'mission' && node.name === 'MISSING'));
});

test('failed publication leaves both a new node and an existing configuration fully unchanged', async t => {
  const { p, root, scene, request, history } = await fixture(t), save = p.saveManifest;
  p.saveManifest = async () => { throw Error('finish publication failed'); };
  await assert.rejects(p.changeSceneObject(name, request(), hash(scene)), /publication failed/); assert.deepEqual(await p.read(name), scene); assert.equal(p.manifest.history.length, history);
  p.saveManifest = save; await p.changeSceneObject(name, request(), hash(scene)); const before = await p.read(name), manifest = await fs.readFile(root + '/workbench.json');
  p.saveManifest = async () => { throw Error('finish publication failed'); };
  await assert.rejects(p.changeSceneObject(name, { kind: 'configure-finish', target: 'WB_FINISH', finish: request({ outcome: 'failure', completeId: 30 }).finish }, hash(before)), /publication failed/);
  assert.deepEqual(await p.read(name), before); assert.deepEqual(await fs.readFile(root + '/workbench.json'), manifest); assert.equal(p.manifest.history.length, history + 1); assert.equal(p.busy, false);
  const reopened = await ModProject.open(root); assert.deepEqual(await reopened.read(name), before); await reopened.undo(); assert.deepEqual(await reopened.read(name), scene);
});
