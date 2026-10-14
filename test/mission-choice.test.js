import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { missionChoicePrograms, choiceControllerGroups, choiceControllers } from '../src/shared/mission-choice.js';
import { ModProject } from '../src/core/project.js';
import { changeSceneObject, inspectScene, editScene } from '../src/core/scene.js';
import { editTextDb } from '../src/core/textdb.js';
import { hash, writeSafe } from '../src/core/files.js';

const choice = { name: 'ANSWER', controller: 'NPC', waitForSignal: true, answers: [{ textId: 90000, target: 'YES' }, { textId: 90001, target: 'NO' }] };
const chunk = (type, data) => { const header = Buffer.alloc(6); header.writeUInt16LE(type); header.writeUInt32LE(data.length + 6, 2); return Buffer.concat([header, data]); };

test('choice waits for activation, claims one branch before cleanup/signal, and owns only exact controller source', () => {
  const plan = missionChoicePrograms(choice);
  assert.deepEqual(plan.nodes.map(node => node.name), ['ANSWER', 'ANSWER_CLAIM', 'ANSWER_ANSWER1', 'ANSWER_ANSWER2']);
  const start = plan.nodes[0].code;
  assert(start.indexOf('detector_issignal -1, 3, -1') < start.indexOf('detector_setsignal -1, 0'));
  assert(start.indexOf('label 2') < start.indexOf('detector_setsignal 0, 1'));
  for (const node of plan.nodes.slice(2)) {
    assert(node.code.indexOf('detector_issignal -1, 2, -1') < node.code.indexOf('detector_waitforuse'));
    assert(node.code.indexOf('detector_setsignal 0, 1') < node.code.indexOf('setevent 1, 1000, -1'));
    assert(node.code.indexOf('setevent 1, 1000, -1') < node.code.indexOf('detector_setsignal 2, 1'));
    assert(node.code.endsWith('label 90\nend'));
  }
  assert(!missionChoicePrograms({ ...choice, waitForSignal: false }).nodes[0].code.includes('wait 100'));
  const groups = choiceControllerGroups(plan.controller.code);
  assert.deepEqual(groups, [{ owner: 'ANSWER', names: ['ANSWER_ANSWER1', 'ANSWER_ANSWER2'] }]);
  const next = missionChoicePrograms({ ...choice, name: 'NEXT', answers: [...choice.answers, { textId: 90002, target: 'YES' }] }, groups);
  assert.deepEqual(choiceControllerGroups(next.controller.code).map(group => group.owner), ['ANSWER', 'NEXT']);
  assert(next.controller.code.includes('dim_act 5') && next.controller.code.includes('event 1001\nenemy_use_detector 2\nenemy_use_detector 3\nenemy_use_detector 4\nreturn'));
  assert.equal(choiceControllerGroups(plan.controller.code + '\nwait 50'), null);
  assert.equal(choiceControllerGroups(plan.controller.code.replace('enemy_use_detector 1', 'enemy_use_detector 0')), null);
  assert.equal(choiceControllerGroups(plan.controller.code.replace('ANSWER_ANSWER2', 'Another')), null);
  assert.deepEqual(choiceControllerGroups('end\r\n'), []);
  for (const extra of [{ name: 'bad"\nend' }, { name: 'é' }, { name: 'a'.repeat(56) }, { controller: 1 }, { waitForSignal: 1 }, { answers: [] }, { answers: Array(5).fill(choice.answers[0]) }, { answers: [choice.answers[0], choice.answers[0]] }, { answers: [{ textId: NaN, target: 'YES' }, choice.answers[1]] }, { answers: [{ textId: 90000, target: '"' }, choice.answers[1]] }]) assert.throws(() => missionChoicePrograms({ ...choice, ...extra }), /Volba/);
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mafia-choice-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeSafe(root, 'workbench.json', JSON.stringify({ format: 'mafia-workbench', version: 2, name: 'Choice', assets: [], history: [] }));
  const p = await ModProject.open(root), name = 'missions/Test/scene2.bin', geometryPath = 'missions/Test/scene.4ds', textPath = 'tables/textdb_cz.def';
  let scene = chunk(0x4c53, Buffer.concat([chunk(0x4000, Buffer.alloc(0)), chunk(0xbeef, Buffer.from('opaque'))]));
  for (const [name, code] of [['NPC', 'end'], ['BusyNPC', 'wait 123\nend'], ['Tommy', 'end']]) scene = changeSceneObject(scene, { kind: 'add-human', name, model: 'human.i3d', position: [0, 0, 0], rotation: [1, 0, 0, 0], scale: [1, 1, 1], parameters: {}, code });
  const player = inspectScene(scene).entries.find(entry => entry.label === 'Typ aktéra' && entry.context.endsWith('/ Tommy')); scene = editScene(scene, player.id, 2);
  for (const target of ['YES', 'NO']) scene = changeSceneObject(scene, { kind: 'add-detector', name: target, position: [0, 0, 0], mask: 0, code: 'label 1\ndetector_issignal -1, 2, -1\nwait 100\ngoto 1\nlabel 2\nend' });
  const geometry = Buffer.alloc(19); geometry.write('4DS\0'); geometry.writeUInt16LE(29, 4); geometry[18] = 1;
  const text = Buffer.alloc(41); text.writeUInt32LE(4); for (const [index, id] of [90000, 90001, 90002, 99999999].entries()) { text.writeUInt32LE(id, 8 + index * 8); text.writeUInt32LE(40, 12 + index * 8); }
  const texts = editTextDb(text, textPath, [{ index: 0, text: 'Yes' }, { index: 1, text: 'No' }, { index: 2, text: 'Maybe' }]);
  await p.createFiles([{ path: name, data: scene }, { path: geometryPath, data: geometry }, { path: textPath, data: texts }]);
  const { name: owner, ...config } = choice;
  const request = { kind: 'add-choice', name: owner, position: [2, 0, 0], code: 'arbitrary', mask: 128, choice: { ...config, textDb: textPath, textHash: hash(texts) } };
  return { p, root, name, scene, geometryPath, geometry, textPath, texts, request };
}

test('choice creates every node and NPC event atomically, preserves unrelated data, exports/reopens and has exact undo', async t => {
  const { p, root, name, scene, geometryPath, geometry, textPath, texts, request } = await fixture(t), baseline = structuredClone(p.manifest);
  const before = inspectScene(scene); assert.deepEqual(choiceControllers(before).map(actor => actor.name), ['NPC']);
  await p.changeSceneObject(name, { ...request, choice: { ...request.choice, controller: 'npc', answers: request.choice.answers.map(answer => ({ ...answer, target: answer.target.toLowerCase() })) } }, hash(scene));
  const data = await p.read(name), parsed = inspectScene(data), plan = missionChoicePrograms(choice);
  for (const node of plan.nodes) assert.equal(parsed.actorScripts.find(script => script.name === node.name).code, node.code);
  assert.equal(parsed.actorScripts.find(script => script.name === 'NPC').code, plan.controller.code);
  assert.equal(parsed.actorScripts.find(script => script.name === 'BusyNPC').code, 'wait 123\nend');
  assert.deepEqual(parsed.entries.filter(entry => entry.humanParameter), before.entries.filter(entry => entry.humanParameter));
  const opaque = chunk(0xbeef, Buffer.from('opaque')); assert(data.includes(opaque)); assert.equal(data.indexOf(opaque, data.indexOf(opaque) + 1), -1);
  assert(parsed.entries.filter(entry => entry.detectorParameter).every(entry => entry.value === 0));
  assert.equal(p.manifest.history.length, baseline.history.length + 1);
  assert.deepEqual(await p.read(textPath), texts); assert.deepEqual(await p.read(geometryPath), geometry);
  const reopened = await ModProject.open(root); await reopened.export(path.join(root, 'export')); assert.deepEqual(await fs.readFile(path.join(root, 'export', name)), data);
  await reopened.undo(); assert.deepEqual(await reopened.read(name), scene); assert.deepEqual(reopened.manifest.history, baseline.history);
});

test('same NPC can own another choice, without rewriting previous nodes; one undo restores its previous program', async t => {
  const { p, name, scene, request } = await fixture(t);
  await p.changeSceneObject(name, request, hash(scene)); const first = await p.read(name), before = inspectScene(first);
  await p.changeSceneObject(name, { ...request, name: 'NEXT' }, hash(first)); const parsed = inspectScene(await p.read(name));
  assert.deepEqual(choiceControllers(parsed).find(actor => actor.name === 'NPC').groups.map(group => group.owner), ['ANSWER', 'NEXT']);
  for (const original of before.actorScripts.filter(script => script.name !== 'NPC')) assert.equal(parsed.actorScripts.find(script => script.name === original.name).code, original.code);
  await p.undo(); assert.deepEqual(await p.read(name), first); await p.undo(); assert.deepEqual(await p.read(name), scene);
});

test('choice rejects stale text/scene, boundary/empty text, ambiguous or busy actors, invalid targets and names without publishing', async t => {
  const { p, name, scene, request, textPath, texts } = await fixture(t), baseline = JSON.stringify(p.manifest);
  for (const [extra, pattern] of [[{ textHash: 'stale' }, /změnily/], [{ controller: 'BusyNPC' }, /prázdným/], [{ controller: 'Tommy' }, /prázdným/], [{ controller: 1 }, /prázdným/], [{ answers: [{ textId: 99999999, target: 'YES' }, choice.answers[1]] }, /hraniční/], [{ answers: [{ textId: 90000, target: 'unknown' }, choice.answers[1]] }, /cílem/], [{ answers: [choice.answers[0], choice.answers[0]] }, /různá/]]) await assert.rejects(() => p.changeSceneObject(name, { ...request, choice: { ...request.choice, ...extra } }, hash(scene)), pattern);
  for (const extra of [{ name: 'yes' }, { name: '1invalid' }, { position: [NaN, 0, 0] }]) await assert.rejects(() => p.changeSceneObject(name, { ...request, ...extra }, hash(scene)));
  await assert.rejects(() => p.changeSceneObject(name, request, 'stale'), /změnil/);
  assert.equal(JSON.stringify(p.manifest), baseline); assert.deepEqual(await p.read(name), scene);
  const blank = editTextDb(texts, textPath, [{ index: 0, text: ' ' }]); await p.change(textPath, blank, 'Blank text');
  await assert.rejects(() => p.changeSceneObject(name, { ...request, choice: { ...request.choice, textHash: hash(blank) } }, hash(scene)), /neprázdný/); await p.undo();
  const npc = inspectScene(scene).objects.find(object => object.name === 'NPC');
  const duplicate = { ...inspectScene(scene), objects: [...inspectScene(scene).objects, npc] }; assert(!choiceControllers(duplicate).length);
  await p.changeSceneObject(name, request, hash(scene)); const generated = inspectScene(await p.read(name));
  assert(!choiceControllers({ ...generated, actors: generated.actors.filter(actor => actor.name !== 'ANSWER_CLAIM') }).length);
  await p.undo(); assert.deepEqual(await p.read(name), scene);
});

test('choice transaction rolls back failed publication and rejects a concurrent TextDB change', async t => {
  const { p, name, scene, request, textPath, texts } = await fixture(t), baseline = JSON.stringify(p.manifest), save = p.saveManifest;
  p.saveManifest = async () => { throw new Error('publish failed'); };
  await assert.rejects(() => p.changeSceneObject(name, request, hash(scene)), /publish failed/); assert.deepEqual(await p.read(name), scene); assert.equal(JSON.stringify(p.manifest), baseline); p.saveManifest = save;
  const batch = p.changeBatch; p.changeBatch = async function(files, ...args) { await this.change(textPath, editTextDb(texts, textPath, [{ index: 1, text: 'Changed' }]), 'Concurrent text'); return batch.call(this, files, ...args); };
  await assert.rejects(() => p.changeSceneObject(name, request, hash(scene)), /změnil/); assert.deepEqual(await p.read(name), scene); p.changeBatch = batch; await p.undo(); assert.deepEqual(await p.read(textPath), texts); assert.equal(JSON.stringify(p.manifest), baseline);
});
