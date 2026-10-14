import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { humanAttackTargets, humanBehaviorScript, inspectHumanBehavior } from '../src/shared/human-behavior.js';
import { HUMAN_IDLE_SCRIPT } from '../src/shared/human-program.js';
import { ModProject } from '../src/core/project.js';
import { inspectScene, changeSceneObject } from '../src/core/scene.js';
import { hash, writeSafe } from '../src/core/files.js';

const attack = { mode: 'attack', targetName: 'Target', itemId: 1, clip: 7, reserve: 35, range: -1, delaySeconds: 5 };
test('NPC recipes preserve custom code and keep generated attackers active; edited recipes stay custom', () => {
  const code = humanBehaviorScript('Guard', attack);
  assert.match(code, /human_addweapon 0, 1, 7, 35\r\nhuman_activateweapon 0, 1/);
  assert.match(code, /wait 5000\r\nfindactor 1, "Target"\r\nenemy_action_fire 1, -1/);
  assert.ok(code.endsWith(HUMAN_IDLE_SCRIPT)); assert.doesNotMatch(code, /^end$/m);
  assert.deepEqual(inspectHumanBehavior('Guard', code), attack);
  assert.deepEqual(inspectHumanBehavior('Guard', code.replaceAll('\r\n', '\n')), attack);
  for (const custom of ['end', '', '// own program\nwait 300\nend', code + '// edited', code.replace('Guard', 'Other')]) {
    assert.deepEqual(inspectHumanBehavior('Guard', custom), { mode: 'custom', code: custom });
    assert.equal(humanBehaviorScript('Guard', { mode: 'custom', code: custom }), custom);
  }
  assert.deepEqual(inspectHumanBehavior('Guard', HUMAN_IDLE_SCRIPT), { mode: 'idle' });
  for (const invalid of [{ targetName: 'guard' }, { targetName: 'X"\nend' }, { itemId: '1' }, { clip: 0 }, { reserve: .5 }, { range: 0 }, { range: -2 }, { range: Infinity }, { delaySeconds: -1 }]) assert.throws(() => humanBehaviorScript('Guard', { ...attack, ...invalid }));
});

const chunk = (type, data) => { const header = Buffer.alloc(6); header.writeUInt16LE(type); header.writeUInt32LE(data.length + 6, 2); return Buffer.concat([header, data]); };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mafia-human-behavior-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeSafe(root, 'workbench.json', JSON.stringify({ format: 'mafia-workbench', version: 1, name: 'NPC', assets: [], history: [] }));
  const project = await ModProject.open(root), empty = Buffer.alloc(19); empty.write('4DS\0'); empty.writeUInt16LE(29, 4); empty[18] = 1;
  const u16 = value => { const bytes = Buffer.alloc(2); bytes.writeUInt16LE(value); return bytes; }, floats = values => { const bytes = Buffer.alloc(values.length * 4); values.forEach((value, i) => bytes.writeFloatLE(value, i * 4)); return bytes; };
  const transform = floats([0, 0, 0, 1, 1, 1, 1, 0, 0, 0]);
  const human = Buffer.concat([empty.subarray(0, 14), u16(0), u16(1), Buffer.from([10]), u16(0), transform, Buffer.from([0, 4]), Buffer.from('base'), Buffer.from([0]), floats([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), Buffer.alloc(4), Buffer.from([1])]);
  const gun = Buffer.concat([empty.subarray(0, 14), u16(0), u16(1), Buffer.from([1, 0, 0, 0]), u16(0), transform, Buffer.from([1, 3]), Buffer.from('gun'), Buffer.from([0]), u16(0), Buffer.from([1]), floats([0]), u16(3), floats([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), Buffer.from([1]), u16(1), u16(0), u16(1), u16(2), u16(0), Buffer.from([1])]);
  const table = Buffer.alloc(188 * 3); table.write('Gun', 188); table.write('GUN.I3D', 188 + 36); table.writeInt32LE(1, 188 + 92); table.writeInt32LE(7, 188 + 96); table.writeInt32LE(35, 188 + 100);
  table.write('Other item', 376); table.write('GUN.I3D', 376 + 36); table.writeInt32LE(7, 376 + 96);
  let scene = chunk(0x4c53, Buffer.concat([chunk(0x4000, Buffer.alloc(0)), chunk(0xbabe, Buffer.from('opaque sibling'))]));
  for (const name of ['Guard', 'Target']) scene = changeSceneObject(scene, { kind: 'add-human', name, model: 'Human.i3d', position: [0, 0, 0], rotation: [1, 0, 0, 0], scale: [1, 1, 1], parameters: {}, code: HUMAN_IDLE_SCRIPT });
  const name = 'missions/NPC/scene2.bin';
  await project.createFiles([{ path: name, data: scene }, { path: 'missions/NPC/scene.4ds', data: empty }, { path: 'models/Human.4ds', data: human }, { path: 'models/Gun.4ds', data: gun }, { path: 'tables/predmety.def', data: table }]);
  const catalog = await project.pickupItems(), behavior = { ...attack, tableHash: catalog.sha256, modelHash: catalog.items[0].modelHash };
  return { project, root, name, scene, table, behavior };
}

test('NPC configuration changes only one program, retains actor stats and opaque data, exports and undoes exactly', async t => {
  const { project, root, name, scene, behavior } = await fixture(t), history = project.manifest.history.length;
  assert.deepEqual(humanAttackTargets(await project.inspectMap(name), 'guard').map(actor => actor.name), ['Target']);
  const request = { kind: 'configure-human', target: 'gUARD', behavior: { ...behavior, targetName: 'tARGET' } };
  await project.changeSceneObject(name, request, hash(scene));
  const after = await project.read(name), parsed = inspectScene(after), original = inspectScene(scene);
  assert.equal(parsed.actorScripts[0].code, humanBehaviorScript('Guard', behavior));
  assert.deepEqual(parsed.actorScripts[1], original.actorScripts[1]);
  assert.deepEqual(parsed.entries.filter(entry => !entry.actorScript).map(entry => entry.value), original.entries.filter(entry => !entry.actorScript).map(entry => entry.value));
  assert.ok(after.includes(Buffer.from('opaque sibling')));
  assert.deepEqual(project.manifest.history.at(-1).files.map(file => file.path), [name]);
  const reopened = await ModProject.open(root); await reopened.export(path.join(root, 'export')); assert.deepEqual(await fs.readFile(path.join(root, 'export', name)), after);
  await reopened.changeSceneObject(name, { kind: 'configure-human', target: 'Guard', behavior: { mode: 'custom', code: parsed.actorScripts[0].code } }, hash(after));
  assert.equal(reopened.manifest.history.length, history + 1); // Unchanged custom code adds no history.
  await reopened.undo(); assert.deepEqual(await reopened.read(name), scene); assert.equal(reopened.manifest.history.length, history);
  assert.deepEqual(await reopened.original(reopened.asset(name)), scene);
});

test('new NPC behavior is generated in core, and invalid targets/catalogs cannot change the mission', async t => {
  const { project, name, scene, behavior } = await fixture(t), history = project.manifest.history.length;
  for (const invalid of [{ targetName: 'Guard' }, { targetName: 'Missing' }, { tableHash: 'stale' }, { modelHash: 'stale' }, { itemId: 2 }, { clip: 8 }]) await assert.rejects(project.changeSceneObject(name, { kind: 'configure-human', target: 'Guard', behavior: { ...behavior, ...invalid } }, hash(scene)));
  await assert.rejects(project.changeSceneObject(name, { kind: 'configure-human', target: 'Missing', behavior }, hash(scene)));
  await assert.rejects(project.changeSceneObject(name, { kind: 'configure-human', target: 'Guard', behavior }, 'stale'));
  assert.deepEqual(await project.read(name), scene); assert.equal(project.manifest.history.length, history);
  await project.changeSceneObject(name, { kind: 'add-human', name: 'Attacker', model: 'models/Human.4ds', position: [2, 0, 5], rotation: [1, 0, 0, 0], scale: [1, 1, 1], parameters: {}, behavior, code: 'end' }, hash(scene));
  assert.equal(inspectScene(await project.read(name)).actorScripts.at(-1).code, humanBehaviorScript('Attacker', behavior));
  await project.undo(); assert.deepEqual(await project.read(name), scene);
});

test('concurrent weapon edits and failed manifest publication do not partially configure an NPC', async t => {
  const { project, name, scene, table, behavior } = await fixture(t), history = project.manifest.history.length, batch = project.changeBatch;
  project.changeBatch = async function(files, ...args) { const changed = Buffer.from(table); changed.write('Changed', 188); await this.change('tables/predmety.def', changed); return batch.call(this, files, ...args); };
  await assert.rejects(project.changeSceneObject(name, { kind: 'configure-human', target: 'Guard', behavior }, hash(scene)), /změnil/);
  assert.deepEqual(await project.read(name), scene); project.changeBatch = batch; await project.undo();
  const save = project.saveManifest; project.saveManifest = async () => { throw new Error('publication failure'); };
  await assert.rejects(project.changeSceneObject(name, { kind: 'configure-human', target: 'Guard', behavior }, hash(scene)), /publication failure/);
  project.saveManifest = save; assert.deepEqual(await project.read(name), scene); assert.equal(project.manifest.history.length, history);
});
