import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { missionCoordinationScript, inspectMissionCoordination, editableMissionCoordination, resolveMissionCoordination } from '../src/shared/mission-coordination.js';
import { missionLogic, layoutMissionLogic } from '../src/shared/mission-logic.js';
import { newMissionLogicName, createdMissionLogicSelection } from '../src/shared/mission-logic-authoring.js';
import { changeSceneObject, editScene, inspectScene } from '../src/core/scene.js';
import { ModProject } from '../src/core/project.js';
import { hash, writeSafe } from '../src/core/files.js';
import { collisionFixture } from './fixtures/collision.js';

const name = 'missions/Own/scene2.bin', geometryPath = 'missions/Own/scene.4ds';
const recipe = changes => ({ waitForSignal: true, match: 'all', signals: ['A', 'B'], delaySeconds: 0.75, targets: ['Yes', 'No'], ...changes });
const chunk = (type, data) => { const h = Buffer.alloc(6); h.writeUInt16LE(type); h.writeUInt32LE(data.length + 6, 2); return Buffer.concat([h, data]); };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mafia-coordination-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeSafe(root, 'workbench.json', JSON.stringify({ format: 'mafia-workbench', version: 2, name: 'Coordination', assets: [], history: [] }));
  const p = await ModProject.open(root);
  let scene = chunk(0x4c53, Buffer.concat([chunk(0x4000, Buffer.alloc(0)), chunk(0xbabe, Buffer.from('unknown data'))]));
  scene = changeSceneObject(scene, { kind: 'add-human', name: 'Tommy', model: 'human.i3d', position: [0, 0, 0], rotation: [1, 0, 0, 0], scale: [1, 1, 1], parameters: {}, code: 'label 99\nwait 1000\ngoto 99' });
  scene = editScene(scene, inspectScene(scene).entries.find(entry => entry.label === 'Typ aktéra' && entry.context.endsWith('/ Tommy')).id, 2);
  for (const point of ['Yes', 'No', 'A', 'B']) scene = changeSceneObject(scene, { kind: 'add-detector', name: point, position: [0, 0, 0], mask: 0, code: 'detector_setsignal -1, 0\nlabel 99\nwait 1000\ngoto 99' });
  const geometry = Buffer.alloc(19); geometry.write('4DS\0'); geometry.writeUInt16LE(29, 4); geometry[18] = 1;
  await p.createFiles([{ path: name, data: scene }, { path: geometryPath, data: geometry }, { path: 'models/human.4ds', data: geometry }, { path: 'missions/Own/tree.klz', data: collisionFixture() }]);
  const request = changes => ({ kind: 'add-detector', name: 'WB_CONTROL', position: [1, 2, 3], coordination: recipe(changes) });
  return { p, root, scene, geometry, request, history: p.manifest.history.length };
}

// Independent timed instruction runner: external changes occur during waits.
// It does not evaluate the recipe's boolean expression or predict its outputs.
function execute(code, initial = {}, changes = [], limit = 10000) {
  const lines = code.split('\n'), labels = new Map(lines.flatMap((line, i) => /^label (\d+)$/.test(line) ? [[Number(line.slice(6)), i]] : [])), actors = new Map(), signals = { self: 0, ...initial }, outputs = [], events = [...changes].sort((a, b) => a.at - b.at);
  let pc = 0, steps = 0, time = 0, block = false;
  const go = label => { if (Number(label) !== -1) pc = labels.get(Number(label)); assert(Number.isInteger(pc)); };
  while (pc < lines.length && steps++ < 10000) {
    const line = lines[pc++]; let m;
    if (line === 'end') { assert.equal(block, false); return { outputs, signals, ended: true, time }; }
    if ((m = /^findactor (\d+), "([^"]+)"$/.exec(line))) actors.set(Number(m[1]), m[2]);
    else if ((m = /^detector_issignal (-?\d+), (-?\d+), (-?\d+)$/.exec(line))) go(signals[Number(m[1]) === -1 ? 'self' : actors.get(Number(m[1]))] ? m[2] : m[3]);
    else if ((m = /^detector_setsignal (-?\d+), ([01])$/.exec(line))) { const actor = Number(m[1]) === -1 ? 'self' : actors.get(Number(m[1])); signals[actor] = Number(m[2]); if (actor !== 'self') outputs.push({ actor, time, value: Number(m[2]) }); }
    else if ((m = /^goto (\d+)$/.exec(line))) go(m[1]);
    else if ((m = /^commandblock ([01])$/.exec(line))) block = m[1] === '1';
    else if ((m = /^wait (\d+)$/.exec(line))) {
      assert.equal(block, false, 'Never yield while in a command block'); time += Number(m[1]);
      while (events[0]?.at <= time) Object.assign(signals, events.shift().signals);
      if (time > limit) return { outputs, signals, ended: false, time };
    } else assert(/^\/\/|^dim_act |^label /.test(line), line);
  }
  assert.fail('Program must end or yield');
}

test('all waits for simultaneous flags, keeps observed state and fires every output once after the delay', () => {
  const result = execute(missionCoordinationScript(recipe()), { self: 1 }, [
    { at: 2100, signals: { A: 1 } }, { at: 2400, signals: { A: 0 } },
    { at: 2600, signals: { B: 1 } }, { at: 3300, signals: { A: 1 } },
    { at: 3400, signals: { A: 0, B: 0 } }
  ]);
  assert.deepEqual(result.outputs, [{ actor: 'Yes', time: 4050, value: 1 }, { actor: 'No', time: 4050, value: 1 }]);
  assert.equal(result.ended, true); assert.equal(result.signals.self, 1); assert.equal(result.signals.A, 0); assert.equal(result.signals.B, 0);
  const pending = execute(missionCoordinationScript(recipe()), { self: 1 }, [{ at: 2100, signals: { A: 1 } }, { at: 2200, signals: { A: 0 } }, { at: 2300, signals: { B: 1 } }]);
  assert.equal(pending.ended, false); assert.deepEqual(pending.outputs, []);
});

test('any, no-input fan-out, millisecond delays and early/late own gates follow their actual time', () => {
  const any = execute(missionCoordinationScript(recipe({ match: 'any' })), { self: 1 }, [{ at: 2300, signals: { B: 1 } }]); assert.deepEqual(any.outputs.map(o => o.time), [3050, 3050]); assert.equal(any.signals.B, 1);
  const late = execute(missionCoordinationScript(recipe({ signals: [], delaySeconds: 0.001 })), {}, [{ at: 3500, signals: { self: 1 } }]); assert.deepEqual(late.outputs.map(o => o.time), [3501, 3501]);
  const early = execute(missionCoordinationScript(recipe({ signals: [], delaySeconds: 0 })), { self: 1 }); assert.deepEqual(early.outputs.map(o => o.time), [2000, 2000]);
  const auto = execute(missionCoordinationScript(recipe({ waitForSignal: false, signals: [], delaySeconds: 1 }))); assert.deepEqual(auto.outputs.map(o => o.time), [3000, 3000]);
  const gated = execute(missionCoordinationScript(recipe()), { A: 1, B: 1 }); assert.equal(gated.ended, false); assert.deepEqual(gated.outputs, []);
  const max = execute(missionCoordinationScript(recipe({ waitForSignal: false, signals: [], delaySeconds: 86400 })), {}, [], 86402000); assert.equal(max.time, 86402000); assert.equal(max.outputs.length, 2);
});

test('invalid recipes and modified source are rejected; source recognition requires complete equality', () => {
  const code = missionCoordinationScript(recipe()); assert.deepEqual(inspectMissionCoordination(code), recipe()); assert.deepEqual(inspectMissionCoordination(code.replaceAll('\n', '\r\n')), recipe());
  for (const invalid of [{ waitForSignal: 1 }, { match: 'not' }, { signals: 'A' }, { signals: Array(9).fill('A') }, { signals: ['A', 'a'] }, { targets: [] }, { targets: ['Yes', 'yes'] }, { targets: ['"\nend'] }, { targets: [null] }, { delaySeconds: -1 }, { delaySeconds: 86401 }, { delaySeconds: NaN }, { delaySeconds: Infinity }, { delaySeconds: '1' }, { delaySeconds: 0.0001 }]) assert.throws(() => missionCoordinationScript(recipe(invalid)), /Řídicí bod/);
  for (const changed of [code + '\n', code.replace('wait 2000', 'wait 1'), code.replace('commandblock 0', 'commandblock 1'), code.replace('"match":"all"', '"match":"any"'), '// Mafia Workbench coordination v1 {}\nend', null]) assert.equal(inspectMissionCoordination(changed), null);
});

test('create/edit/no-op/export/reopen/undo preserve unrelated scripts, geometry and unknown scene chunks', async t => {
  const { p, root, scene, geometry, request, history } = await fixture(t);
  await p.changeSceneObject(name, { ...request(), code: 'end', mask: 0, coordination: recipe({ signals: ['a', 'b'], targets: ['yes', 'no'] }) }, hash(scene));
  const created = await p.read(name), recovered = editableMissionCoordination(await p.inspectMap(name), 'wb_control'); assert.deepEqual(recovered.coordination, recipe());
  assert.equal(p.manifest.history.length, history + 1); assert.deepEqual(p.manifest.history.at(-1).files.map(file => file.path), [name]);
  const next = recipe({ waitForSignal: false, signals: ['B'], match: 'any', targets: ['Yes'], delaySeconds: 2 }), edit = { kind: 'configure-coordination', target: 'WB_CONTROL', coordination: next };
  await p.changeSceneObject(name, edit, hash(created)); const edited = await p.read(name); assert.deepEqual(edited, editScene(created, recovered.entry.id, { ...recovered.entry.value, code: missionCoordinationScript(next) }));
  await p.changeSceneObject(name, edit, hash(edited)); assert.equal(p.manifest.history.length, history + 2); assert(edited.includes(Buffer.from('unknown data'))); assert.deepEqual(await p.read(geometryPath), geometry);
  const reopened = await ModProject.open(root); await reopened.export(root + '/export'); assert.deepEqual(await fs.readFile(root + '/export/' + name), edited); assert.deepEqual(editableMissionCoordination(await reopened.inspectMap(name), 'WB_CONTROL').coordination, next);
  await reopened.undo(); assert.deepEqual(await reopened.read(name), created); await reopened.undo(); assert.deepEqual(await reopened.read(name), scene); assert.equal(reopened.manifest.history.length, history);
});

test('self/wrong/ambiguous refs, mixed templates, custom source and stale revisions never write a partial node', async t => {
  const { p, scene, request, history } = await fixture(t);
  for (const invalid of [{ signals: ['WB_CONTROL'] }, { targets: ['WB_CONTROL'] }, { signals: ['Tommy'] }, { targets: ['Missing'] }]) await assert.rejects(p.changeSceneObject(name, request(invalid), hash(scene)), /jednoznačné/);
  for (const other of ['task', 'finish', 'dialogue', 'combat', 'behavior', 'branch']) await assert.rejects(p.changeSceneObject(name, { ...request(), [other]: {} }, hash(scene)), /šablonu|pouze NPC/);
  await assert.rejects(p.changeSceneObject(name, { ...request(), kind: 'configure-pickup' }, hash(scene)), /šablonu/);
  await assert.rejects(p.changeSceneObject(name, request(), 'old'), /změnil/); assert.deepEqual(await p.read(name), scene); assert.equal(p.manifest.history.length, history);
  const file = await p.inspectMap(name), ambiguous = { ...file, actors: [...file.actors, file.actors.find(a => a.name === 'A')] }; assert.throws(() => resolveMissionCoordination(ambiguous, recipe(), 'WB_CONTROL'), /jednoznačné/);
  await p.changeSceneObject(name, request(), hash(scene)); const created = await p.read(name), current = editableMissionCoordination(await p.inspectMap(name), 'WB_CONTROL');
  for (const changed of [editScene(created, current.entry.id, { ...current.entry.value, code: current.entry.value.code + '\n// user code' }), editScene(created, inspectScene(created).entries.find(e => e.detectorParameter && e.context.endsWith('/ WB_CONTROL')).id, 0)]) {
    await p.change(name, changed, 'User source'); assert.equal(editableMissionCoordination(await p.inspectMap(name), 'WB_CONTROL'), null); await assert.rejects(p.changeSceneObject(name, { kind: 'configure-coordination', target: 'WB_CONTROL', coordination: recipe() }, hash(changed)), /editoru zdroje/); await p.undo();
  }
});

test('concurrent scene/geometry changes and failed publication roll back creation and configuration', async t => {
  const { p, root, scene, request, history } = await fixture(t), batch = p.changeBatch;
  for (const dependency of [geometryPath, name]) {
    const bytes = await p.read(dependency); p.changeBatch = async function(files, ...args) { await this.change(dependency, Buffer.concat([bytes, Buffer.from([0])]), 'Concurrent change'); return batch.call(this, files, ...args); };
    await assert.rejects(p.changeSceneObject(name, request(), hash(scene)), /změnil/); p.changeBatch = batch; await p.undo(); assert.deepEqual(await p.read(dependency), bytes);
  }
  const save = p.saveManifest; p.saveManifest = async () => { throw Error('coordination publication failed'); };
  await assert.rejects(p.changeSceneObject(name, request(), hash(scene)), /publication failed/); p.saveManifest = save; assert.deepEqual(await p.read(name), scene); assert.equal(p.manifest.history.length, history);
  await p.changeSceneObject(name, request(), hash(scene)); const created = await p.read(name), manifest = await fs.readFile(root + '/workbench.json'); p.saveManifest = async () => { throw Error('coordination publication failed'); };
  await assert.rejects(p.changeSceneObject(name, { kind: 'configure-coordination', target: 'WB_CONTROL', coordination: recipe({ delaySeconds: 5 }) }, hash(created)), /publication failed/); p.saveManifest = save;
  assert.deepEqual(await p.read(name), created); assert.deepEqual(await fs.readFile(root + '/workbench.json'), manifest); assert.equal(p.busy, false);
});

test('diagram and mission checker distinguish watched inputs from activation and expose broken dependencies', async t => {
  const { p, scene, request } = await fixture(t); await p.changeSceneObject(name, request(), hash(scene));
  const file = await p.inspectMap(name), graph = missionLogic(file), node = graph.nodes.find(node => node.kind === 'coordination'); assert(node); assert.equal(node.waiting, true); assert.equal(node.trigger, 'load');
  assert.equal(newMissionLogicName(file, 'coordination'), 'WB_CONTROL_2'); assert.equal(createdMissionLogicSelection(file, 'WB_CONTROL', {}).selectedId, node.id);
  assert.deepEqual(graph.edges.filter(edge => edge.from === node.id).map(edge => [edge.kind, edge.targetName]), [['success', 'Yes'], ['success', 'No']]); assert.deepEqual(graph.edges.filter(edge => edge.kind === 'read').map(edge => edge.targetName), ['A', 'B']); assert(node.warnings.some(message => message.includes('odesílatele')));
  const report = await p.checkMission(name); assert.equal(report.recipes, 1); assert.equal(report.textReferences, 0); assert.deepEqual(report.issues.filter(issue => issue.severity === 'error'), []);
  const entry = editableMissionCoordination(file, 'WB_CONTROL').entry;
  await p.change(name, editScene(await p.read(name), entry.id, { ...entry.value, code: missionCoordinationScript(recipe({ signals: ['Gone'], targets: ['Tommy'] })) }), 'Bad refs');
  const invalid = await p.checkMission(name); for (const code of ['coordination', 'flow']) assert(invalid.issues.some(issue => issue.code === code && issue.severity === 'error'), code); await p.undo();
  await p.change(name, editScene(await p.read(name), entry.id, { ...entry.value, code: missionCoordinationScript(recipe({ signals: ['Yes'], waitForSignal: false })) }), 'Observe own output');
  const observing = missionLogic(await p.inspectMap(name)); assert.deepEqual(layoutMissionLogic(observing).cycles, []); assert(!observing.nodes.some(node => node.warnings.some(message => message.includes('Cyklus'))));
});
