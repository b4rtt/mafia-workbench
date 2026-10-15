import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { missionBranchScript, inspectMissionBranch, editableMissionBranch, resolveMissionBranch, missionBranchFrames, missionBranchConditionLabel } from '../src/shared/mission-branch.js';
import { missionLogic } from '../src/shared/mission-logic.js';
import { newMissionLogicName, createdMissionLogicSelection } from '../src/shared/mission-logic-authoring.js';
import { changeSceneObject, editScene, inspectScene } from '../src/core/scene.js';
import { ModProject } from '../src/core/project.js';
import { hash, writeSafe } from '../src/core/files.js';
import { collisionFixture } from './fixtures/collision.js';

const name = 'missions/Own/scene2.bin', geometryPath = 'missions/Own/scene.4ds', itemPath = 'TABLES/predmety.def';
const conditions = [{ kind: 'item', itemId: 23, expected: true }, { kind: 'human', name: 'Sam', expected: true }, { kind: 'signal', name: 'Flag', expected: false }];
const recipe = changes => ({ waitForSignal: true, match: 'all', conditions, onTrue: 'Yes', onFalse: 'No', ...changes });
const chunk = (type, data) => { const h = Buffer.alloc(6); h.writeUInt16LE(type); h.writeUInt32LE(data.length + 6, 2); return Buffer.concat([h, data]); };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mafia-branch-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeSafe(root, 'workbench.json', JSON.stringify({ format: 'mafia-workbench', version: 2, name: 'Branch', assets: [], history: [] }));
  const p = await ModProject.open(root);
  let scene = chunk(0x4c53, Buffer.concat([chunk(0x4000, Buffer.alloc(0)), chunk(0xbabe, Buffer.from('unknown data'))]));
  for (const human of ['Tommy', 'Sam']) scene = changeSceneObject(scene, { kind: 'add-human', name: human, model: 'human.i3d', position: [0, 0, 0], rotation: [1, 0, 0, 0], scale: [1, 1, 1], parameters: {}, code: 'label 99\nwait 1000\ngoto 99' });
  scene = editScene(scene, inspectScene(scene).entries.find(entry => entry.label === 'Typ aktéra' && entry.context.endsWith('/ Tommy')).id, 2);
  scene = changeSceneObject(scene, { kind: 'add-car', name: 'Delivery', model: 'car.i3d', position: [8, 0, 0], rotation: [1, 0, 0, 0], scale: [1, 1, 1] });
  scene = changeSceneObject(scene, { kind: 'add-model', name: 'Static', model: 'car.i3d', position: [0, 0, 0], rotation: [1, 0, 0, 0], scale: [1, 1, 1] });
  for (const point of ['Yes', 'No', 'Flag']) scene = changeSceneObject(scene, { kind: 'add-detector', name: point, position: [0, 0, 0], mask: 0, code: 'detector_setsignal -1, 0\nlabel 99\nwait 1000\ngoto 99' });
  const geometry = Buffer.alloc(19); geometry.write('4DS\0'); geometry.writeUInt16LE(29, 4); geometry[18] = 1;
  const items = Buffer.alloc(24 * 188); items.write('Door keys', 23 * 188);
  await p.createFiles([{ path: name, data: scene }, { path: geometryPath, data: geometry }, { path: 'models/human.4ds', data: geometry }, { path: 'models/car.4ds', data: geometry }, { path: 'missions/Own/tree.klz', data: collisionFixture() }, { path: itemPath, data: items }]);
  const request = changes => ({ kind: 'add-detector', name: 'WB_BRANCH', position: [1, 2, 3], branch: { ...recipe(changes), itemTableHash: hash(items) } });
  return { p, root, scene, geometry, items, request, history: p.manifest.history.length };
}

// Execute the small emitted instruction subset, independently from the
// generator's boolean expression. Native engine checks remain separate.
function execute(code, state) {
  const lines = code.split('\n'), labels = new Map(lines.flatMap((line, i) => /^label (\d+)$/.test(line) ? [[Number(line.slice(6)), i]] : [])), actors = new Map(), signals = { ...state.signals, self: state.incoming ?? 0 }, outputs = [];
  const variables = Array(7).fill(0), frames = new Map(); let pc = 0, steps = 0;
  const go = label => { if (Number(label) !== -1) pc = labels.get(Number(label)); assert(Number.isInteger(pc)); };
  while (pc < lines.length && steps++ < 1000) {
    const line = lines[pc++]; let m;
    if (line === 'end') return { outputs, signals, ended: true };
    if ((m = /^findactor (\d+), "([^"]+)"$/.exec(line))) actors.set(Number(m[1]), state.missingActors?.includes(m[2]) ? null : m[2]);
    else if ((m = /^detector_issignal (-?\d+), (-?\d+), (-?\d+)$/.exec(line))) go(signals[Number(m[1]) === -1 ? 'self' : actors.get(Number(m[1]))] ? m[2] : m[3]);
    else if ((m = /^detector_setsignal (-?\d+), ([01])$/.exec(line))) { const actor = Number(m[1]) === -1 ? 'self' : actors.get(Number(m[1])); signals[actor] = Number(m[2]); if (actor !== 'self') outputs.push(actor); }
    else if ((m = /^human_isweapon (\d+), 0, (\d+)$/.exec(line))) variables[0] = (state.inventory ?? []).includes(Number(m[2])) ? 1 : 0;
    else if ((m = /^human_getproperty (\d+), 0, Energy$/.exec(line))) { const energy = state.energy?.[actors.get(Number(m[1]))]; if (energy !== undefined) variables[0] = energy; }
    else if ((m = /^let flt\[(\d+)\] = (-?[\d.]+)$/.exec(line))) variables[Number(m[1])] = Number(m[2]);
    else if ((m = /^setnullactor (\d+)$/.exec(line))) actors.set(Number(m[1]), null);
    else if ((m = /^human_getowner (\d+), (\d+)$/.exec(line))) { if (actors.get(Number(m[1]))) actors.set(Number(m[2]), state.owner ?? null); }
    else if ((m = /^human_getseatidx (\d+), (\d+)$/.exec(line))) { if (actors.get(Number(m[1]))) variables[Number(m[2])] = state.owner ? state.seat ?? -1 : -1; }
    else if ((m = /^compareactors (\d+), (\d+), (\d+)$/.exec(line))) variables[Number(m[3])] = Number((actors.get(Number(m[1])) ?? null) === (actors.get(Number(m[2])) ?? null));
    else if ((m = /^setnullframe (\d+)$/.exec(line))) frames.set(Number(m[1]), null);
    else if ((m = /^findframe (\d+), "([^"]+)"$/.exec(line))) { if (state.positions?.[m[2]]) frames.set(Number(m[1]), m[2]); }
    else if ((m = /^compareframes (\d+), (\d+), (\d+)$/.exec(line))) variables[Number(m[3])] = Number((frames.get(Number(m[1])) ?? null) === (frames.get(Number(m[2])) ?? null));
    else if ((m = /^frm_getworldpos (\d+), (\d+)$/.exec(line))) { const position = state.positions?.[frames.get(Number(m[1]))]; if (position) position.forEach((v, i) => { variables[Number(m[2]) + i] = v; }); }
    else if ((m = /^vect_sub_vect (\d+), (\d+)$/.exec(line))) { for (let i = 0; i < 3; i++) variables[Number(m[1]) + i] -= variables[Number(m[2]) + i]; }
    else if ((m = /^vect_magnitude (\d+), (\d+)$/.exec(line))) variables[Number(m[2])] = Math.hypot(...variables.slice(Number(m[1]), Number(m[1]) + 3));
    else if ((m = /^if flt\[(\d+)\] ([=<>]) ([\d.e+-]+), (-?\d+), (-?\d+)$/.exec(line))) { const v = variables[Number(m[1])], n = Number(m[3]); go((m[2] === '=' ? v === n : m[2] === '<' ? v < n : v > n) ? m[4] : m[5]); }
    else if ((m = /^goto (\d+)$/.exec(line))) go(m[1]);
    else if (line === 'wait 100') return { outputs, signals, ended: false };
    else assert(/^\/\/|^dim_|^label |^wait 2000$/.test(line), line);
  }
  assert.fail('Branch did not terminate or wait');
}

test('all/any short circuits and negations choose exactly one output for every state and retain observed signals/items', () => {
  for (const match of ['all', 'any']) for (let expectations = 0; expectations < 8; expectations++) for (let values = 0; values < 8; values++) {
    const rules = conditions.map((condition, i) => ({ ...condition, expected: Boolean(expectations & (1 << i)) }));
    const branch = recipe({ match, conditions: rules }), code = missionBranchScript(branch), inventory = values & 1 ? [23] : [];
    const truth = rules.map((rule, i) => rule.expected === Boolean(values & (1 << i))), expected = (match === 'all' ? truth.every(Boolean) : truth.some(Boolean)) ? 'Yes' : 'No';
    const actual = execute(code, { incoming: 1, inventory, energy: { Sam: values & 2 ? 100 : 0 }, signals: { Flag: values & 4 ? 1 : 0, Yes: 0, No: 0 } });
    assert.deepEqual(actual.outputs, [expected]); assert.equal(actual.signals.Flag, values & 4 ? 1 : 0); assert.equal(actual.signals.self, 1); assert.deepEqual(inventory, values & 1 ? [23] : []);
    assert.deepEqual(inspectMissionBranch(code), branch); assert.deepEqual(inspectMissionBranch(code.replaceAll('\n', '\r\n')), branch);
  }
  const pending = execute(missionBranchScript(recipe()), { incoming: 0 }); assert.equal(pending.ended, false); assert.deepEqual(pending.outputs, []);
  const automatic = execute(missionBranchScript(recipe({ waitForSignal: false })), { inventory: [23], energy: { Sam: 100 }, signals: { Flag: 0 } }); assert.deepEqual(automatic.outputs, ['Yes']);
  const missing = execute(missionBranchScript(recipe({ conditions: conditions.slice(0, 2) })), { incoming: 1, inventory: [23], energy: {} }); assert.deepEqual(missing.outputs, ['No']);
});

test('branch source is editable only after full canonical validation; malformed rules and edited metadata/source remain custom', () => {
  const code = missionBranchScript(recipe());
  // Captured before adding spatial/vehicle rules: older recipes remain exactly editable.
  assert.equal(hash(Buffer.from(code)), '01949273448b6eb773b5e70d656d500dd18f94dfccb3aca1ecd8ed1510f94f83');
  for (const invalid of [{ conditions: [] }, { conditions: Array(9).fill(conditions[0]) }, { conditions: [{ kind: 'item', itemId: 1, expected: true }] }, { conditions: [{ kind: 'item', itemId: 65536, expected: true }] }, { conditions: [{ kind: 'human', name: 'Sam"\nend', expected: true }] }, { conditions: [{ kind: 'signal', name: 'Flag', expected: 1 }] }, { conditions: [{ kind: 'unknown', expected: true }] }, { onTrue: null }, { onFalse: '' }, { waitForSignal: 'true' }, { match: 'not' }]) assert.throws(() => missionBranchScript(recipe(invalid)), /Podmínka/);
  for (const changed of [code + '\n', code.replace('wait 2000', 'wait 2001'), code.replace('label 900', 'label 990'), code.replace('human_isweapon', 'human_addweapon'), code.replace('"match":"all"', '"match":"any"'), '// Mafia Workbench branch v1 {}\nend', null]) assert.equal(inspectMissionBranch(changed), null);
});

const spatial = [{ kind: 'proximity', name: 'Sam', radius: 3, expected: true }, { kind: 'vehicle', name: 'Delivery', driverOnly: true, expected: true }];
test('spatial and vehicle predicates compose with all/any, negation and every seat without mutating state', () => {
  for (const match of ['all', 'any']) for (const driverOnly of [true, false]) for (let mask = 0; mask < 4; mask++) {
    const rules = spatial.map((rule, i) => ({ ...rule, ...(rule.kind === 'vehicle' ? { driverOnly } : {}), expected: Boolean(mask & (1 << i)) }));
    const branch = recipe({ match, conditions: rules }), code = missionBranchScript(branch);
    for (const delta of [[0, 0, 0], [2, 0, 0], [0, 3, 0], [0, 0, 4], [2, 2, 0]]) for (const owner of [null, 'Other', 'Delivery']) for (const seat of [-1, 0, 1, 2, 3]) {
      const positions = { Tommy: [100, -12, 300], Sam: delta.map((v, i) => v + [100, -12, 300][i]) };
      const state = { incoming: 1, owner, seat, positions, inventory: [23], signals: { Yes: 0, No: 0 } }, before = structuredClone(state);
      const truth = [Math.hypot(...delta) < 3, owner === 'Delivery' && (!driverOnly || seat === 0)].map((v, i) => v === rules[i].expected);
      assert.deepEqual(execute(code, state).outputs, [(match === 'all' ? truth.every(Boolean) : truth.some(Boolean)) ? 'Yes' : 'No']); assert.deepEqual(state, before);
    }
    assert.deepEqual(inspectMissionBranch(code), branch); assert.deepEqual(inspectMissionBranch(code.replaceAll('\n', '\r\n')), branch);
    assert.match(code, /dim_flt 7\ndim_frm 3/); assert.doesNotMatch(code, /human_force_settocar|human_setproperty|frm_setpos|human_addweapon/);
  }
});

test('missing spatial/car bindings cannot pass as near or occupied, including after an earlier successful rule', () => {
  const run = (conditions, state) => execute(missionBranchScript(recipe({ conditions })), { incoming: 1, ...state }).outputs;
  for (const positions of [{}, { Tommy: [0, 0, 0] }, { Sam: [0, 0, 0] }]) {
    assert.deepEqual(run([spatial[0]], { positions }), ['No']);
    assert.deepEqual(run([{ ...spatial[0], expected: false }], { positions }), ['Yes']);
  }
  const secondNear = [spatial[0], { ...spatial[0], name: 'Missing' }], state = { positions: { Tommy: [0, 0, 0], Sam: [1, 0, 0] } };
  assert.deepEqual(run(secondNear, state), ['No']); assert.deepEqual(run(secondNear.map((r, i) => i ? { ...r, expected: false } : r), state), ['Yes']);
  for (const missingActors of [['Delivery'], ['Tommy'], ['Tommy', 'Delivery']]) for (const driverOnly of [true, false]) {
    assert.deepEqual(run([{ ...spatial[1], driverOnly }], { missingActors }), ['No']);
    assert.deepEqual(run([{ ...spatial[1], driverOnly, expected: false }], { missingActors }), ['Yes']);
  }
  assert.deepEqual(run([spatial[1], { ...spatial[1], name: 'Missing' }], { owner: 'Delivery', seat: 0, missingActors: ['Missing'] }), ['No']);
  assert.deepEqual(execute(missionBranchScript(recipe({ conditions: spatial })), { incoming: 0 }).outputs, []);
  for (const radius of [NaN, Infinity, -1, 0, 1e-50, .0999, 10001, '3', null]) assert.throws(() => missionBranchScript(recipe({ conditions: [{ ...spatial[0], radius }] })), /poloměr/);
  for (const driverOnly of [undefined, 1, 'true', null]) assert.throws(() => missionBranchScript(recipe({ conditions: [{ ...spatial[1], driverOnly }] })), /automobil/);
  assert.match(missionBranchConditionLabel(spatial[0]), /blíž než 3 m od Sam/); assert.match(missionBranchConditionLabel({ ...spatial[1], expected: false }), /není.*místě řidiče/);
});

test('frame candidates merge a single base/override, exclude self/player and reject duplicates in either source', () => {
  const scene = { objects: [{ name: 'Sam' }, { name: 'Door' }, { name: 'Tommy' }, { name: 'WB_BRANCH' }], geometry: { meshes: [{ name: 'DOOR' }, { name: 'Road' }] } };
  assert.deepEqual(missionBranchFrames(scene, 'wb_branch').map(f => f.name), ['Door', 'Road', 'Sam']);
  assert.deepEqual(missionBranchFrames({ ...scene, objects: [...scene.objects, { name: 'dOOr' }] }, 'wb_branch').map(f => f.name), ['Road', 'Sam']);
  assert.deepEqual(missionBranchFrames({ ...scene, geometry: { meshes: [...scene.geometry.meshes, { name: 'door' }] } }, 'wb_branch').map(f => f.name), ['Road', 'Sam']);
});

test('spatial/vehicle project recipes validate dependencies, persist exact source, check/export and undo without changing cars or geometry', async t => {
  const { p, root, scene, geometry, request, history } = await fixture(t), file = await p.inspectMap(name), rules = spatial.map(c => ({ ...c, name: c.name.toLowerCase() }));
  const resolved = resolveMissionBranch(file, recipe({ conditions: rules }), 'WB_BRANCH'); assert.deepEqual(resolved.conditions, spatial);
  for (const bad of [{ ...spatial[1], name: 'Static' }, { ...spatial[1], name: 'Missing' }, { ...spatial[0], name: 'Tommy' }, { ...spatial[0], name: 'WB_BRANCH' }, { ...spatial[0], name: 'Gone' }]) await assert.rejects(p.changeSceneObject(name, request({ conditions: [bad] }), hash(scene)), /Podmínka/);
  for (const kind of ['vehicle', 'proximity']) assert.throws(() => resolveMissionBranch({ ...file, actors: file.actors.map(a => a.name === 'Tommy' ? { ...a, kind: 27 } : a) }, recipe({ conditions: spatial.filter(c => c.kind === kind) }), 'WB_BRANCH'), /Player/);
  assert.throws(() => resolveMissionBranch({ ...file, actors: [...file.actors, file.actors.find(a => a.name === 'Delivery')] }, recipe({ conditions: [spatial[1]] }), 'WB_BRANCH'), /Car/);
  assert.throws(() => resolveMissionBranch({ ...file, objects: [...file.objects, file.objects.find(f => f.name === 'Sam')] }, recipe({ conditions: [spatial[0]] }), 'WB_BRANCH'), /jednoznač/);
  assert.deepEqual(await p.read(name), scene); assert.equal(p.manifest.history.length, history);
  await p.changeSceneObject(name, request({ conditions: rules }), hash(scene)); const created = await p.read(name), selected = editableMissionBranch(await p.inspectMap(name), 'WB_BRANCH');
  assert.deepEqual(selected.branch.conditions, spatial); assert.equal(selected.entry.value.code, missionBranchScript(resolved));
  const graph = missionLogic(await p.inspectMap(name)); assert.deepEqual(graph.edges.filter(e => e.kind === 'read'), []); assert.equal((await p.checkMission(name)).issues.filter(i => i.severity === 'error').length, 0);
  const edit = { kind: 'configure-branch', target: 'WB_BRANCH', branch: recipe({ conditions: [{ ...spatial[0], radius: 5, expected: false }, { ...spatial[1], driverOnly: false }], match: 'any' }) };
  await p.changeSceneObject(name, edit, hash(created)); const changed = await p.read(name); assert.notDeepEqual(changed, created);
  await p.changeSceneObject(name, edit, hash(changed)); assert.equal(p.manifest.history.length, history + 2);
  const checkChanged = editScene(changed, selected.entry.id, { ...selected.entry.value, code: missionBranchScript(recipe({ conditions: [{ ...spatial[1], name: 'Gone' }] })) });
  await p.change(name, checkChanged, 'Removed binding'); assert((await p.checkMission(name)).issues.some(i => i.code === 'branch' && i.severity === 'error')); await p.undo();
  await p.export(root + '/export'); assert.deepEqual(await fs.readFile(root + '/export/' + name), changed); assert.deepEqual(await p.read(geometryPath), geometry);
  const reopen = await ModProject.open(root); await reopen.undo(); assert.deepEqual(await reopen.read(name), created); await reopen.undo(); assert.deepEqual(await reopen.read(name), scene);
  // These new predicates depend on the geometry too, even without an item table.
  const batch = reopen.changeBatch; reopen.changeBatch = async function(files, ...args) { await this.change(geometryPath, Buffer.concat([geometry, Buffer.from([0])]), 'Concurrent frame'); return batch.call(this, files, ...args); };
  await assert.rejects(reopen.changeSceneObject(name, request({ conditions: spatial }), hash(scene)), /změnil/); reopen.changeBatch = batch; assert.deepEqual(await reopen.read(name), scene); await reopen.undo(); assert.deepEqual(await reopen.read(geometryPath), geometry);
});

test('create/configure/no-op/export/reopen and undo preserve source siblings, geometry, items and unknown chunks', async t => {
  const { p, root, scene, geometry, items, request, history } = await fixture(t);
  await p.changeSceneObject(name, request({ conditions: conditions.map(c => c.name ? { ...c, name: c.name.toLowerCase() } : c), onTrue: 'yes', onFalse: 'no' }), hash(scene));
  const created = await p.read(name), original = editableMissionBranch(await p.inspectMap(name), 'wb_branch'); assert.deepEqual(original.branch, recipe());
  assert.equal(p.manifest.history.length, history + 1); assert.deepEqual(p.manifest.history.at(-1).files.map(f => f.path), [name]);
  const edit = { kind: 'configure-branch', target: 'wb_branch', branch: request({ match: 'any', conditions: [conditions[2]], waitForSignal: false }).branch };
  await p.changeSceneObject(name, edit, hash(created)); const edited = await p.read(name), expected = editScene(created, original.entry.id, { ...original.entry.value, code: missionBranchScript(recipe({ match: 'any', conditions: [conditions[2]], waitForSignal: false })) }); assert.deepEqual(edited, expected);
  await p.changeSceneObject(name, edit, hash(edited)); assert.equal(p.manifest.history.length, history + 2);
  assert(edited.includes(Buffer.from('unknown data'))); assert.deepEqual(await p.read(geometryPath), geometry); assert.deepEqual(await p.read(itemPath), items);
  const reopened = await ModProject.open(root); await reopened.export(root + '/export'); assert.deepEqual(await fs.readFile(root + '/export/' + name), edited); assert.equal(editableMissionBranch(await reopened.inspectMap(name), 'WB_BRANCH').branch.match, 'any');
  await reopened.undo(); assert.deepEqual(await reopened.read(name), created); await reopened.undo(); assert.deepEqual(await reopened.read(name), scene); assert.equal(reopened.manifest.history.length, history);
});

test('missing/wrong/ambiguous dependencies, stale revisions and mixed or custom recipes fail before writing', async t => {
  const { p, scene, request, history } = await fixture(t);
  for (const invalid of [{ itemTableHash: 'old' }, { conditions: [{ kind: 'item', itemId: 22, expected: true }] }, { onTrue: 'WB_BRANCH' }, { onFalse: 'Sam' }, { conditions: [{ kind: 'signal', name: 'Sam', expected: true }] }, { conditions: [{ kind: 'human', name: 'Flag', expected: true }] }]) await assert.rejects(p.changeSceneObject(name, { ...request(), branch: { ...request().branch, ...invalid } }, hash(scene)), /Podmínka/);
  for (const other of ['task', 'finish', 'dialogue', 'combat', 'behavior']) await assert.rejects(p.changeSceneObject(name, { ...request(), [other]: {} }, hash(scene)), /šablonu|pouze NPC/);
  await assert.rejects(p.changeSceneObject(name, request(), 'old'), /změnil/); assert.deepEqual(await p.read(name), scene); assert.equal(p.manifest.history.length, history);
  const file = await p.inspectMap(name), ambiguous = { ...file, actors: [...file.actors, file.actors.find(a => a.name === 'Sam')] }; assert.throws(() => resolveMissionBranch(ambiguous, recipe(), 'WB_BRANCH'), /jednoznač/);
  const player = file.entries.find(e => e.label === 'Typ aktéra' && e.context.endsWith('/ Tommy')), npcPlayer = editScene(scene, player.id, 27); await p.change(name, npcPlayer, 'No player'); await assert.rejects(p.changeSceneObject(name, request(), hash(npcPlayer)), /hráče Tommy/); await p.undo();
  await p.changeSceneObject(name, request(), hash(scene)); const created = await p.read(name), selected = editableMissionBranch(await p.inspectMap(name), 'WB_BRANCH');
  for (const changed of [editScene(created, selected.entry.id, { ...selected.entry.value, code: selected.entry.value.code + '\n// user code' }), editScene(created, inspectScene(created).entries.find(e => e.detectorParameter && e.context.endsWith('/ WB_BRANCH')).id, 0)]) {
    await p.change(name, changed, 'User changes'); assert.equal(editableMissionBranch(await p.inspectMap(name), 'WB_BRANCH'), null); await assert.rejects(p.changeSceneObject(name, { kind: 'configure-branch', target: 'WB_BRANCH', branch: request().branch }, hash(changed)), /editoru zdroje/); await p.undo();
  }
});

test('concurrent table/geometry/scene changes and failed publication cannot partially create or edit a branch', async t => {
  const { p, root, scene, request, history } = await fixture(t), batch = p.changeBatch;
  for (const dependency of [itemPath, geometryPath, name]) {
    const bytes = await p.read(dependency); p.changeBatch = async function(files, ...args) { await this.change(dependency, Buffer.concat([bytes, Buffer.from([0])]), 'Concurrent dependency'); return batch.call(this, files, ...args); };
    await assert.rejects(p.changeSceneObject(name, request(), hash(scene)), /změnil/); p.changeBatch = batch;
    if (dependency !== name) assert.deepEqual(await p.read(name), scene); await p.undo(); assert.deepEqual(await p.read(dependency), bytes);
  }
  const save = p.saveManifest; p.saveManifest = async () => { throw Error('branch publication failed'); };
  await assert.rejects(p.changeSceneObject(name, request(), hash(scene)), /publication failed/); p.saveManifest = save; assert.deepEqual(await p.read(name), scene); assert.equal(p.manifest.history.length, history);
  await p.changeSceneObject(name, request(), hash(scene)); const created = await p.read(name), manifest = await fs.readFile(root + '/workbench.json'); p.saveManifest = async () => { throw Error('branch publication failed'); };
  await assert.rejects(p.changeSceneObject(name, { kind: 'configure-branch', target: 'WB_BRANCH', branch: request({ match: 'any' }).branch }, hash(created)), /publication failed/); p.saveManifest = save;
  assert.deepEqual(await p.read(name), created); assert.deepEqual(await fs.readFile(root + '/workbench.json'), manifest); assert.equal(p.busy, false); await p.undo(); assert.deepEqual(await p.read(name), scene);
});

test('diagram distinguishes read edges and decision ports; mission check validates humans, detectors and item table', async t => {
  const { p, scene, request, items } = await fixture(t); await p.changeSceneObject(name, request(), hash(scene));
  const file = await p.inspectMap(name), graph = missionLogic(file), branch = graph.nodes.find(node => node.kind === 'branch');
  assert(branch); assert.equal(branch.waiting, true); assert.equal(branch.trigger, 'load'); assert.equal(newMissionLogicName(file, 'branch'), 'WB_BRANCH_2'); assert.equal(createdMissionLogicSelection(file, 'WB_BRANCH', {}).selectedId, branch.id);
  assert.deepEqual(graph.edges.filter(edge => edge.from === branch.id).map(edge => [edge.kind, edge.targetName]), [['success', 'Yes'], ['failure', 'No']]); assert.equal(graph.edges.find(edge => edge.kind === 'read').targetName, 'Flag'); assert(branch.warnings.some(message => message.includes('odesílatele')));
  const report = await p.checkMission(name); assert.equal(report.recipes, 1); assert.deepEqual(report.issues.filter(issue => issue.severity === 'error'), []); assert.equal(report.textReferences, 0);
  const entry = editableMissionBranch(file, 'WB_BRANCH').entry, bad = missionBranchScript(recipe({ conditions: [{ kind: 'human', name: 'Gone', expected: false }, { kind: 'signal', name: 'Missing', expected: false }, { kind: 'item', itemId: 22, expected: true }] }));
  await p.change(name, editScene(await p.read(name), entry.id, { ...entry.value, code: bad }), 'Changed dependencies'); const invalid = await p.checkMission(name); for (const code of ['branch', 'inventory', 'flow']) assert(invalid.issues.some(issue => issue.code === code && issue.severity === 'error'), code);
  await p.undo(); const bytes = Buffer.from(items); bytes.fill(0, 23 * 188, 23 * 188 + 32); await p.change(itemPath, bytes, 'Removed item'); assert((await p.checkMission(name)).issues.some(issue => issue.code === 'inventory')); await p.undo();
  // Reading the output's old flag does not invent a circular activation path.
  const observeOutput = missionBranchScript(recipe({ conditions: [{ kind: 'signal', name: 'Yes', expected: false }], waitForSignal: false })); await p.change(name, editScene(await p.read(name), entry.id, { ...entry.value, code: observeOutput }), 'Observe output');
  assert(!missionLogic(await p.inspectMap(name)).nodes.some(node => node.warnings.some(message => message.includes('Cyklus'))));
});
