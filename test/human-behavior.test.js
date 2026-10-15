import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { humanAttackTargets, humanBehaviorScript, inspectHumanBehavior, humanRoutePoints, validateHumanRoute, resolveHumanPatrol } from '../src/shared/human-behavior.js';
import { HUMAN_IDLE_SCRIPT } from '../src/shared/human-program.js';
import { ModProject } from '../src/core/project.js';
import { parseNavigation, changeNavigationConnection } from '../src/core/navigation.js';
import { inspectScene, changeSceneObject, editScene } from '../src/core/scene.js';
import { hash, writeSafe } from '../src/core/files.js';

const patrol = { mode: 'patrol', waypoints: [{ id: 101, pauseSeconds: 2 }, { id: 17, pauseSeconds: .5 }], pace: 'walk', loop: true, delaySeconds: 1 };
function navigation() {
  let data = Buffer.alloc(98); data.writeUInt32LE(0x01abcedf); data.writeUInt32LE(3, 4);
  [17, 101, 65535].forEach((id, index) => { const at = 8 + index * 30; data.writeFloatLE(index * 5, at); data.writeUInt16LE(1, at + 12); data.writeUInt16LE(id, at + 14); data.writeUInt16LE(50, at + 16); });
  data = changeNavigationConnection(data, { action: 'connect', from: 0, to: 1 });
  return changeNavigationConnection(data, { action: 'connect', from: 1, to: 2 });
}
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
  await project.createFiles([{ path: name, data: scene }, { path: 'missions/NPC/scene.4ds', data: empty }, { path: 'models/Human.4ds', data: human }, { path: 'models/Gun.4ds', data: gun }, { path: 'tables/predmety.def', data: table }, { path: 'missions/NPC/check.bin', data: navigation() }]);
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


test('patrols use stored IDs, wait after arrival, loop or remain active, and edited recipes remain custom', () => {
  for (const loop of [false, true]) for (const pace of ['walk', 'run']) {
    const options = { ...patrol, loop, pace }, code = humanBehaviorScript('Guard', options);
    assert.deepEqual(inspectHumanBehavior('Guard', code), options);
    assert.match(code, new RegExp(`enemy_move 101, ${pace}\\r\\nwait 2000\\r\\nenemy_move 17, ${pace}\\r\\nwait 500`));
    assert.doesNotMatch(code, /^end$/m); assert.ok(code.endsWith(loop ? 'wait 100\r\ngoto 1\r\n' : 'label 2\r\nwait 1000\r\ngoto 2\r\n'));
    const changed = code.replace('wait 500', 'wait 500\r\nhuman_do_breath'); assert.equal(inspectHumanBehavior('Guard', changed).mode, 'custom');
  }
  for (const invalid of [{ waypoints: [] }, { waypoints: [{ id: 0, pauseSeconds: 0 }] }, { waypoints: [{ id: 65536, pauseSeconds: 0 }] }, { waypoints: [{ id: '17', pauseSeconds: 0 }] }, { waypoints: [{ id: 17, pauseSeconds: NaN }] }, { waypoints: Array(33).fill(patrol.waypoints[0]) }, { pace: 'walk\nend' }, { loop: 1 }, { delaySeconds: -1 }]) assert.throws(() => humanBehaviorScript('Guard', { ...patrol, ...invalid }));
  assert.doesNotThrow(() => humanBehaviorScript('Guard', { ...patrol, loop: false, waypoints: [{ id: 65535, pauseSeconds: 0 }] }));
});

test('routes reject duplicate IDs, nonhuman targets, disconnected and reverse-blocked paths', () => {
  const parsed = parseNavigation(navigation()); validateHumanRoute(patrol, parsed);
  assert.deepEqual(humanRoutePoints(parsed).map(point => point.id), [17, 101, 65535]);
  const duplicate = structuredClone(parsed); duplicate.points[2].id = 101;
  assert.deepEqual(humanRoutePoints(duplicate).map(point => point.id), [17]); assert.throws(() => validateHumanRoute(patrol, duplicate), /jednoznačné/);
  const vehicle = structuredClone(parsed); vehicle.points[1].type = 4; assert.throws(() => validateHumanRoute(patrol, vehicle), /kategorii/);
  const broken = structuredClone(parsed); broken.points[0].links = []; assert.throws(() => validateHumanRoute(patrol, broken), /spojení/);
  const oneWay = structuredClone(parsed); oneWay.points[0].links[0].type = 0x81;
  assert.throws(() => validateHumanRoute(patrol, oneWay), /ID 17 a 101/);
  assert.doesNotThrow(() => validateHumanRoute({ ...patrol, loop: false }, oneWay));
  const carsOnly = structuredClone(parsed); carsOnly.points[1].links[0].type = 4; assert.throws(() => validateHumanRoute(patrol, carsOnly), /spojení/);
  const disabled = structuredClone(parsed); disabled.points[1].links[0].type = 0x4001; assert.throws(() => validateHumanRoute(patrol, disabled), /spojení/);
  const longRoute = { ...patrol, waypoints: [{ id: 17, pauseSeconds: 0 }, { id: 65535, pauseSeconds: 0 }] }; validateHumanRoute(longRoute, parsed); // Intermediate nodes need not be stops.
});

test('NPC route authoring guards mission navigation, preserves unrelated bytes and has exact export/undo', async t => {
  const { project, root, name, scene } = await fixture(t), navName = 'missions/NPC/check.bin', nav = await project.inspect(navName), history = project.manifest.history.length;
  const behavior = { ...patrol, navigationHash: nav.sha256, navigationPath: 'missions/OTHER/check.bin' }; // Client cannot redirect the dependency.
  for (const invalid of [{ navigationHash: 'stale' }, { waypoints: [{ id: 3, pauseSeconds: 0 }, { id: 17, pauseSeconds: 0 }] }]) await assert.rejects(project.changeSceneObject(name, { kind: 'configure-human', target: 'Guard', behavior: { ...behavior, ...invalid } }, hash(scene)));
  assert.deepEqual(await project.read(name), scene); assert.equal(project.manifest.history.length, history);
  await project.changeSceneObject(name, { kind: 'configure-human', target: 'Guard', behavior }, hash(scene));
  const after = await project.read(name), parsed = inspectScene(after); assert.equal(parsed.actorScripts[0].code, humanBehaviorScript('Guard', patrol));
  assert.deepEqual(parsed.actorScripts[1], inspectScene(scene).actorScripts[1]); assert.deepEqual(parsed.entries.filter(entry => !entry.actorScript).map(entry => entry.value), inspectScene(scene).entries.filter(entry => !entry.actorScript).map(entry => entry.value));
  assert.ok(after.includes(Buffer.from('opaque sibling'))); assert.deepEqual(await project.read(navName), navigation());
  assert.deepEqual(project.manifest.history.at(-1).files.map(file => file.path), [name]);
  const reopened = await ModProject.open(root); await reopened.export(path.join(root, 'patrol-export')); assert.deepEqual(await fs.readFile(path.join(root, 'patrol-export', name)), after);
  await reopened.undo(); assert.deepEqual(await reopened.read(name), scene); assert.equal(reopened.manifest.history.length, history);
  await reopened.changeSceneObject(name, { kind: 'add-human', name: 'Walker', model: 'models/Human.4ds', position: [0, 0, 0], rotation: [1, 0, 0, 0], scale: [1, 1, 1], parameters: {}, behavior }, hash(scene));
  assert.equal(inspectScene(await reopened.read(name)).actorScripts.at(-1).code, humanBehaviorScript('Walker', patrol)); await reopened.undo(); assert.deepEqual(await reopened.read(name), scene);
});

test('concurrent navigation changes and publication failures cannot partially save a route', async t => {
  const { project, name, scene } = await fixture(t), navName = 'missions/NPC/check.bin', before = await project.read(navName), behavior = { ...patrol, navigationHash: hash(before) }, history = project.manifest.history.length, batch = project.changeBatch;
  project.changeBatch = async function(files, ...args) { const data = Buffer.from(before); data.writeUInt16LE(44, 8 + 14); await this.change(navName, data); return batch.call(this, files, ...args); };
  await assert.rejects(project.changeSceneObject(name, { kind: 'configure-human', target: 'Guard', behavior }, hash(scene)), /změnil/);
  project.changeBatch = batch; assert.deepEqual(await project.read(name), scene); await project.undo(); assert.deepEqual(await project.read(navName), before);
  const save = project.saveManifest; project.saveManifest = async () => { throw new Error('patrol publication failure'); };
  await assert.rejects(project.changeSceneObject(name, { kind: 'configure-human', target: 'Guard', behavior }, hash(scene)), /patrol publication failure/);
  project.saveManifest = save; assert.equal(project.manifest.history.length, history); assert.deepEqual(await project.read(name), scene); assert.deepEqual(await project.read(navName), before);
});

test('signal patrols wait before movement and signal only after the final stop, with exact legacy preservation', () => {
  const old = humanBehaviorScript('Guard', patrol);
  assert.equal(humanBehaviorScript('Guard', { ...patrol, startSignal: null, onComplete: null }), old);
  for (const startSignal of [null, 'Start']) for (const onComplete of [null, 'Done', 'Start']) for (const loop of [false, true]) {
    if (loop && onComplete) continue;
    const options = { ...patrol, loop, startSignal, onComplete }, code = humanBehaviorScript('Guard', options);
    assert.deepEqual(inspectHumanBehavior('Guard', code), startSignal || onComplete ? options : { ...patrol, loop });
    assert.deepEqual(inspectHumanBehavior('Guard', code.replaceAll('\r\n', '\n')), inspectHumanBehavior('Guard', code));
    const labels = [...code.matchAll(/^label (\d+)\r?$/gm)].map(m => m[1]); assert.equal(labels.length, new Set(labels).size);
    assert.doesNotMatch(code, /^end$/m); assert.doesNotMatch(code, /detector_setsignal .* 0/);
    if (startSignal) assert(code.indexOf('detector_issignal') < code.indexOf('wait 1000\r\nlabel 1\r\nenemy_move'));
    if (onComplete) { assert(code.indexOf('enemy_move 17, walk\r\nwait 500') < code.indexOf('detector_setsignal')); assert(code.indexOf('detector_setsignal') < code.indexOf('label 2\r\n')); }
    for (const changed of [code + '// own edit', code.replace('enemy_move 17, walk', 'enemy_move 17, run'), code.replace('goto 2', 'end')]) if (changed !== code) assert.equal(inspectHumanBehavior('Guard', changed).mode, 'custom');
    validateHumanRoute(options, parseNavigation(navigation()));
  }
  const both = humanBehaviorScript('Guard', { ...patrol, loop: false, startSignal: 'Start', onComplete: 'sTART' }); assert.match(both, /dim_act 1\r\n/);
  for (const invalid of [{ startSignal: 'gUARD' }, { onComplete: 'A"\nend' }, { startSignal: '' }, { startSignal: 5 }, { onComplete: 'Done', loop: true }]) assert.throws(() => humanBehaviorScript('Guard', { ...patrol, loop: false, ...invalid }), /Trasa/);
});

test('patrol signal references require unique detector actors and preserve the supplied scene', () => {
  const scene = { actors: [{ name: 'Start', kind: 5 }, { name: 'Done', kind: 5 }, { name: 'Guard', kind: 27 }], objects: [{ name: 'Start' }, { name: 'Done' }, { name: 'Guard' }], geometry: { meshes: [] } }, original = structuredClone(scene);
  const options = { ...patrol, loop: false, startSignal: 'start', onComplete: 'DONE' };
  assert.deepEqual(resolveHumanPatrol(scene, 'Guard', options), { ...options, startSignal: 'Start', onComplete: 'Done' }); assert.deepEqual(scene, original);
  for (const extra of [{ startSignal: 'Absent' }, { onComplete: 'Guard' }]) assert.throws(() => resolveHumanPatrol(scene, 'Guard', { ...options, ...extra }), /Trasa/);
  for (const extra of [{ actors: [...scene.actors, { name: 'START', kind: 5 }] }, { objects: [...scene.objects, { name: 'DONE' }] }, { actors: scene.actors.map(a => a.name === 'Start' ? { ...a, kind: 27 } : a) }]) assert.throws(() => resolveHumanPatrol({ ...scene, ...extra }, 'Guard', options), /jednoznačný/);
});

test('signal patrol configuration and creation retain dependencies, export/reopen and one-step undo', async t => {
  const { project, root, name } = await fixture(t);
  for (const target of ['Start', 'Done']) await project.changeSceneObject(name, { kind: 'add-detector', name: target, position: [0, 0, 0], mask: 0, code: 'end' }, hash(await project.read(name)));
  const before = await project.read(name), history = project.manifest.history.length, navName = 'missions/NPC/check.bin', nav = await project.read(navName), behavior = { ...patrol, loop: false, startSignal: 'sTART', onComplete: 'done', navigationHash: hash(nav) };
  for (const extra of [{ startSignal: 'Target' }, { onComplete: 'Absent' }, { navigationHash: 'stale' }, { loop: true }]) await assert.rejects(project.changeSceneObject(name, { kind: 'configure-human', target: 'Guard', behavior: { ...behavior, ...extra } }, hash(before)));
  assert.deepEqual(await project.read(name), before); assert.equal(project.manifest.history.length, history);
  await project.changeSceneObject(name, { kind: 'configure-human', target: 'Guard', behavior }, hash(before));
  const after = await project.read(name), parsed = inspectScene(after), expected = { ...patrol, loop: false, startSignal: 'Start', onComplete: 'Done' };
  assert.deepEqual(inspectHumanBehavior('Guard', parsed.actorScripts[0].code), expected);
  assert.deepEqual(parsed.actorScripts.slice(1), inspectScene(before).actorScripts.slice(1)); assert.deepEqual(parsed.entries.filter(e => !e.actorScript).map(e => e.value), inspectScene(before).entries.filter(e => !e.actorScript).map(e => e.value));
  assert.deepEqual(project.manifest.history.at(-1).files.map(f => f.path), [name]); assert.deepEqual(await project.read(navName), nav);
  const reopened = await ModProject.open(root); await reopened.export(path.join(root, 'signal-export')); assert.deepEqual(await fs.readFile(path.join(root, 'signal-export', name)), after);
  await reopened.undo(); assert.deepEqual(await reopened.read(name), before); assert.equal(reopened.manifest.history.length, history);
  await reopened.changeSceneObject(name, { kind: 'add-human', name: 'NewWalker', model: 'models/Human.4ds', position: [0, 0, 0], rotation: [1, 0, 0, 0], scale: [1, 1, 1], parameters: {}, behavior }, hash(before));
  assert.deepEqual(inspectHumanBehavior('NewWalker', inspectScene(await reopened.read(name)).actorScripts.at(-1).code), expected);
  await reopened.undo(); assert.deepEqual(await reopened.read(name), before); assert.deepEqual(await reopened.read(navName), nav);
});

const drive={mode:'drive',carName:'Car',boarding:'walk',stops:[{name:'Finish',pauseSeconds:2},{name:'Start',pauseSeconds:.5}],loop:true,delaySeconds:1};
test('NPC driving recipes board the chosen car, preserve stop order and keep the driver active; edited code stays custom',()=>{
  for(const boarding of ['walk','seated'])for(const loop of [false,true]){
    const options={...drive,boarding,loop},code=humanBehaviorScript('Guard',options);
    assert.deepEqual(inspectHumanBehavior('Guard',code),options);assert.deepEqual(inspectHumanBehavior('Guard',code.replaceAll('\r\n','\n')),options);
    assert.match(code,/findframe 0, "Finish"\r\nenemy_car_moveto 1, 0, stop\r\nwait 2000\r\nfindframe 0, "Start"/);assert.doesNotMatch(code,/^end$/m);
    assert.match(code,boarding==='walk'?/enemy_move_to_car 1, 0, walk\r\nenemy_usecar 1, 0/:/human_force_settocar 0, 1, 0\r\nwait 2000/);
    assert.equal(inspectHumanBehavior('Guard',code.replace('Guard','Other')).mode,'custom');assert.equal(inspectHumanBehavior('Guard',code+'// edit').mode,'custom');assert.equal(inspectHumanBehavior('Guard',code.replace('stop\r\n','natvrdo\r\n')).mode,'custom');
  }
  for(const invalid of [{carName:'guard'},{carName:'Car"\nend'},{boarding:'driver'},{loop:1},{delaySeconds:NaN},{stops:[]},{stops:[{name:'Start',pauseSeconds:-1}]},{stops:[{name:'Start',pauseSeconds:0}]},{stops:[{name:'Guard',pauseSeconds:0}]},{stops:Array(33).fill(drive.stops[0])}])assert.throws(()=>humanBehaviorScript('Guard',{...drive,...invalid}),/Jízda/);
});
async function drivingFixture(t){
  const f=await fixture(t),transform={rotation:[1,0,0,0],scale:[1,1,1]};let scene=changeSceneObject(f.scene,{kind:'add-car',name:'Car',model:'Car.i3d',position:[0,0,0],...transform});
  for(const [name,z]of [['Finish',20],['Start',0]])scene=changeSceneObject(scene,{kind:'add-detector',name,position:[0,0,z],mask:0,code:'end'});
  scene=changeSceneObject(scene,{kind:'add-model',name:'StaticCar',model:'Car.i3d',position:[0,0,0],...transform});await f.project.change(f.name,scene,'Driving fixture');
  const {changeRoadTopology}=await import('../src/core/road-topology.js');let road=Buffer.alloc(12);road.writeUInt32LE(2);
  for(const position of [[0,0,0],[0,0,20]])road=changeRoadTopology(road,{action:'create-crossing',position,speed:5,semaphore:0}).data;
  road=changeRoadTopology(road,{action:'connect',from:0,to:1,positions:[[0,0,10]],speed:5}).data;
  const roadName='missions/NPC/road.bin';await f.project.createFiles([{path:roadName,data:road}]);return {...f,scene,road,roadName,behavior:{...drive,roadHash:hash(road)}};
}
test('driving uses canonical actor/frame names and the same mission road; script-only save exports, reopens and undoes exactly',async t=>{
  const {project,root,name,scene,road,roadName,behavior}=await drivingFixture(t),history=project.manifest.history.length,original=inspectScene(scene);
  await project.changeSceneObject(name,{kind:'configure-human',target:'gUARD',behavior:{...behavior,carName:'cAR',stops:behavior.stops.map(stop=>({...stop,name:stop.name.toLowerCase()})),roadPath:'missions/OTHER/road.bin'}},hash(scene));
  const after=await project.read(name),parsed=inspectScene(after);assert.equal(parsed.actorScripts[0].code,humanBehaviorScript('Guard',drive));assert.deepEqual(parsed.actorScripts.slice(1),original.actorScripts.slice(1));assert.deepEqual(parsed.entries.filter(e=>!e.actorScript).map(e=>e.value),original.entries.filter(e=>!e.actorScript).map(e=>e.value));assert(after.includes(Buffer.from('opaque sibling')));assert.deepEqual(await project.read(roadName),road);assert.deepEqual(project.manifest.history.at(-1).files.map(f=>f.path),[name]);
  const reopened=await ModProject.open(root);await reopened.export(root+'/export');assert.deepEqual(await fs.readFile(root+'/export/'+name),after);assert.deepEqual(inspectHumanBehavior('Guard',inspectScene(await reopened.read(name)).actorScripts[0].code),drive);await reopened.undo();assert.deepEqual(await reopened.read(name),scene);assert.equal(reopened.manifest.history.length,history);
  await reopened.changeSceneObject(name,{kind:'add-human',name:'NewDriver',model:'models/Human.4ds',position:[2,0,0],rotation:[1,0,0,0],scale:[1,1,1],parameters:{},behavior},hash(scene));assert.equal(inspectScene(await reopened.read(name)).actorScripts.at(-1).code,humanBehaviorScript('NewDriver',drive));await reopened.undo();assert.deepEqual(await reopened.read(name),scene);
});
test('driving rejects static cars, moving or missing targets, stale roads and networks without a connected route',async t=>{
  const {project,name,scene,road,roadName,behavior}=await drivingFixture(t),history=project.manifest.history.length;
  for(const invalid of [{carName:'Missing'},{carName:'StaticCar'},{roadHash:'stale'},{stops:[{name:'Target',pauseSeconds:0},{name:'Start',pauseSeconds:0}]},{stops:[{name:'Missing',pauseSeconds:0},{name:'Start',pauseSeconds:0}]}])await assert.rejects(project.changeSceneObject(name,{kind:'configure-human',target:'Guard',behavior:{...behavior,...invalid}},hash(scene)),/Jízda/);
  assert.equal(project.manifest.history.length,history);assert.deepEqual(await project.read(name),scene);
  const empty=Buffer.alloc(12);empty.writeUInt32LE(2);await project.change(roadName,empty,'Empty road');await assert.rejects(project.changeSceneObject(name,{kind:'configure-human',target:'Guard',behavior:{...behavior,roadHash:hash(empty)}},hash(scene)),/propojenou/);await project.undo();assert.deepEqual(await project.read(roadName),road);
  const {humanDrivingTargets}=await import('../src/shared/human-driving.js'),file=await project.inspectMap(name);assert(humanDrivingTargets(file,'Guard','Car').some(f=>f.name==='Finish'));file.geometry.meshes.push({name:'finish',type:1});assert(!humanDrivingTargets(file,'Guard','Car').some(f=>f.name==='Finish'));
});
test('concurrent driving-road edits and failed publication cannot partially replace an NPC program',async t=>{
  const {project,name,scene,road,roadName,behavior}=await drivingFixture(t),history=project.manifest.history.length,batch=project.changeBatch,{changeRoadTopology}=await import('../src/core/road-topology.js');
  project.changeBatch=async function(files,...args){await this.change(roadName,changeRoadTopology(road,{action:'create-crossing',position:[100,0,100],speed:5}).data,'Independent road change');return batch.call(this,files,...args);};
  await assert.rejects(project.changeSceneObject(name,{kind:'configure-human',target:'Guard',behavior},hash(scene)),/změnil/);assert.deepEqual(await project.read(name),scene);project.changeBatch=batch;await project.undo();assert.equal(project.manifest.history.length,history);
  const save=project.saveManifest;project.saveManifest=async()=>{throw Error('driving publication failure');};await assert.rejects(project.changeSceneObject(name,{kind:'configure-human',target:'Guard',behavior},hash(scene)),/driving publication/);project.saveManifest=save;assert.deepEqual(await project.read(name),scene);assert.deepEqual(await project.read(roadName),road);assert.equal(project.manifest.history.length,history);
});

test('driving gates precede both boarding modes and completion follows the last pause exactly once',()=>{
  const legacy=humanBehaviorScript('Guard',drive);
  assert.equal(hash(Buffer.from(legacy)),'c649eb2191f17b7f01a518e8ce0705ad178595ae5c96ad1bb4ca3dc298ef78d0');
  assert.equal(humanBehaviorScript('Guard',{...drive,startSignal:null,onComplete:null}),legacy);
  for(const boarding of ['walk','seated'])for(const [startSignal,onComplete,loop]of [['Start','Finish',false],['Start',null,false],[null,'Finish',false],['Start',null,true]]){
    const options={...drive,boarding,startSignal,onComplete,loop},code=humanBehaviorScript('Guard',options);
    assert.deepEqual(inspectHumanBehavior('Guard',code),options);assert.deepEqual(inspectHumanBehavior('Guard',code.replaceAll('\r\n','\n')),options);
    assert.doesNotMatch(code,/^end$|detector_setsignal \d+, 0/m);
    if(startSignal)assert(code.indexOf('detector_issignal')<code.indexOf(boarding==='walk'?'enemy_move_to_car':'human_force_settocar'));
    if(onComplete){assert(code.indexOf('detector_setsignal')>code.indexOf('wait 500'));assert.equal(code.match(/detector_setsignal/g).length,1);assert(code.indexOf('detector_setsignal')<code.indexOf('label 2\r\n'));}
    for(const edited of [code+'// edited',...(startSignal?[code.replace('200, -1','1, -1')]:[]),code.replace('findactor 0, "Guard"','findactor 0, "Other"')])assert.equal(inspectHumanBehavior('Guard',edited).mode,'custom');
  }
  assert.match(humanBehaviorScript('Guard',{...drive,loop:false,startSignal:'Start',onComplete:'START'}),/dim_act 3\r\n/);
  for(const extra of [{startSignal:''},{startSignal:7},{startSignal:'gUARD'},{onComplete:'X"\nend'},{loop:true,onComplete:'Finish'}])assert.throws(()=>humanBehaviorScript('Guard',{...drive,loop:false,...extra}),/Jízda/);
});

test('signal driving saves canonical detector references with the road dependency, exact export/reopen and one undo',async t=>{
  const {project,root,name,scene,road,roadName,behavior}=await drivingFixture(t),history=project.manifest.history.length;
  const options={...behavior,loop:false,startSignal:'sTART',onComplete:'fINISH'},expected={...drive,loop:false,startSignal:'Start',onComplete:'Finish'};
  await project.changeSceneObject(name,{kind:'configure-human',target:'Guard',behavior:options},hash(scene));
  const after=await project.read(name);assert.equal(inspectScene(after).actorScripts[0].code,humanBehaviorScript('Guard',expected));
  assert.deepEqual(await project.read(roadName),road);assert.deepEqual(project.manifest.history.at(-1).files.map(f=>f.path),[name]);
  const reopened=await ModProject.open(root);await reopened.export(root+'/signal-driving-export');assert.deepEqual(await fs.readFile(root+'/signal-driving-export/'+name),after);assert.deepEqual(inspectHumanBehavior('Guard',inspectScene(await reopened.read(name)).actorScripts[0].code),expected);
  await reopened.undo();assert.deepEqual(await reopened.read(name),scene);assert.equal(reopened.manifest.history.length,history);
  await reopened.changeSceneObject(name,{kind:'add-human',name:'NewDriver',model:'models/Human.4ds',position:[2,0,0],rotation:[1,0,0,0],scale:[1,1,1],parameters:{},behavior:options},hash(scene));assert.equal(inspectScene(await reopened.read(name)).actorScripts.at(-1).code,humanBehaviorScript('NewDriver',expected));await reopened.undo();assert.deepEqual(await reopened.read(name),scene);
  for(const extra of [{startSignal:'Car'},{onComplete:'StaticCar'},{startSignal:'Missing'},{onComplete:'Target'},{roadHash:'stale'}])await assert.rejects(reopened.changeSceneObject(name,{kind:'configure-human',target:'Guard',behavior:{...options,...extra}},hash(scene)),/Jízda/);
  assert.equal(reopened.manifest.history.length,history);assert.deepEqual(await reopened.read(name),scene);
  const {resolveHumanDriving}=await import('../src/shared/human-driving.js'),{parseRoads}=await import('../src/core/roads.js'),file=await reopened.inspectMap(name),before=JSON.stringify(file);
  assert.throws(()=>resolveHumanDriving({...file,actors:[...file.actors,{name:'START',kind:5}]},'Guard',options,parseRoads(road)),/skriptový bod/);
  assert.throws(()=>resolveHumanDriving({...file,objects:file.objects.filter(o=>o.name!=='Start')},'Guard',{...options,stops:[{name:'Finish',pauseSeconds:0}]},parseRoads(road)),/skriptový bod/);assert.equal(JSON.stringify(file),before);
});

test('driving can exit naturally before completion while preserving existing recipes',()=>{
  for(const boarding of ['walk','seated'])for(const signals of [{startSignal:null,onComplete:null},{startSignal:'Start',onComplete:'Finish'},{startSignal:'Start',onComplete:'Start'}]){
    const options={...drive,boarding,loop:false,...signals,exitAfterArrival:true},code=humanBehaviorScript('Guard',options);
    assert.deepEqual(inspectHumanBehavior('Guard',code),options);assert.deepEqual(inspectHumanBehavior('Guard',code.replaceAll('\r\n','\n')),options);
    assert.match(code,/human driving v3\r\n/);assert.match(code,/^enemy_usecar$/m);assert.doesNotMatch(code,/human_fromcar|human_force_settocar.*\r\nlabel 300|^end$/m);
    assert(code.indexOf('enemy_usecar\r\n')>code.indexOf('wait 500\r\n'));
    const slots=new Set([...code.matchAll(/^findactor (\d+),/gm)].map(m=>Number(m[1]))),scratch=Number(/setnullactor (\d+)/.exec(code)[1]);assert(!slots.has(scratch));assert.match(code,new RegExp(`human_getowner 0, ${scratch}\\r\\ncompareactors 1, ${scratch}, 0`));
    if(signals.onComplete)assert(code.indexOf('detector_setsignal')>code.indexOf('label 320'));
    for(const changed of [code.replace('enemy_usecar\r\n','enemy_usecar 1, 0\r\n'),code.replace('goto 300','goto 320'),code.replace('v3','v2')])assert.equal(inspectHumanBehavior('Guard',changed).mode,'custom');
  }
  for(const exitAfterArrival of ['yes',0,null])assert.throws(()=>humanBehaviorScript('Guard',{...drive,exitAfterArrival}),/Jízda/);
  assert.throws(()=>humanBehaviorScript('Guard',{...drive,exitAfterArrival:true}),/jednorázovou/);
  for(const signals of [{},{startSignal:'Start',onComplete:null}])assert.equal(humanBehaviorScript('Guard',{...drive,...signals,exitAfterArrival:false}),humanBehaviorScript('Guard',{...drive,...signals}));
});

test('exit driving changes only the NPC program and retains exact export, inspection and undo',async t=>{
  const {project,root,name,scene,road,roadName,behavior}=await drivingFixture(t),history=project.manifest.history.length;
  const options={...behavior,loop:false,startSignal:'Start',onComplete:'Finish',exitAfterArrival:true},expected={...drive,loop:false,startSignal:'Start',onComplete:'Finish',exitAfterArrival:true};
  await project.changeSceneObject(name,{kind:'configure-human',target:'Guard',behavior:options},hash(scene));
  const after=await project.read(name),before=inspectScene(scene),parsed=inspectScene(after);assert.equal(parsed.actorScripts[0].code,humanBehaviorScript('Guard',expected));assert.deepEqual(parsed.actorScripts.slice(1),before.actorScripts.slice(1));assert.deepEqual(parsed.entries.filter(e=>!e.actorScript),before.entries.filter(e=>!e.actorScript));assert.deepEqual(await project.read(roadName),road);assert.deepEqual(project.manifest.history.at(-1).files.map(f=>f.path),[name]);
  const reopened=await ModProject.open(root);await reopened.export(root+'/exit-driving-export');assert.deepEqual(await fs.readFile(root+'/exit-driving-export/'+name),after);assert.deepEqual(inspectHumanBehavior('Guard',inspectScene(await reopened.read(name)).actorScripts[0].code),expected);await reopened.undo();assert.deepEqual(await reopened.read(name),scene);assert.equal(reopened.manifest.history.length,history);
  await reopened.changeSceneObject(name,{kind:'add-human',name:'NewDriver',model:'models/Human.4ds',position:[2,0,0],rotation:[1,0,0,0],scale:[1,1,1],parameters:{},behavior:options},hash(scene));assert.equal(inspectScene(await reopened.read(name)).actorScripts.at(-1).code,humanBehaviorScript('NewDriver',expected));await reopened.undo();assert.deepEqual(await reopened.read(name),scene);
});

async function followingFixture(t) {
  const f = await fixture(t); let scene = changeSceneObject(f.scene, { kind: 'add-human', name: 'Tommy', model: 'Human.i3d', position: [0,0,0], rotation: [1,0,0,0], scale: [1,1,1], parameters: {}, code: HUMAN_IDLE_SCRIPT });
  scene = editScene(scene, inspectScene(scene).entries.find(e => e.label === 'Typ aktéra' && e.context.endsWith('/ Tommy')).id, 2);
  for (const name of ['Start','Finish','Done']) scene = changeSceneObject(scene, { kind: 'add-detector', name, position: [0,0,10], mask: 1, code: 'wait 789\nend' });
  await f.project.change(f.name, scene, 'Following fixture');
  return { ...f, scene, behavior: { mode: 'follow', startSignal: 'Start', destinationName: 'Finish', destinationRadius: 2.5, onComplete: 'Done', delaySeconds: .5 } };
}
test('following changes only the NPC program, canonicalizes references, preserves all dependencies and has exact export/reopen/undo', async t => {
  const {project,root,name,scene,behavior} = await followingFixture(t), history = project.manifest.history.length, original = inspectScene(scene);
  await project.changeSceneObject(name, {kind:'configure-human',target:'gUARD',behavior:{...behavior,startSignal:'start',destinationName:'finish',onComplete:'done'}}, hash(scene));
  const after = await project.read(name), parsed = inspectScene(after); assert.equal(parsed.actorScripts[0].code, humanBehaviorScript('Guard',behavior)); assert.deepEqual(parsed.actorScripts.slice(1),original.actorScripts.slice(1)); assert.deepEqual(parsed.entries.filter(e=>!e.actorScript),original.entries.filter(e=>!e.actorScript)); assert(after.includes(Buffer.from('opaque sibling'))); assert.deepEqual(project.manifest.history.at(-1).files.map(f=>f.path),[name]);
  const reopened = await ModProject.open(root); await reopened.export(root+'/follow-export'); assert.deepEqual(await fs.readFile(root+'/follow-export/'+name),after); assert.deepEqual(inspectHumanBehavior('Guard',inspectScene(await reopened.read(name)).actorScripts[0].code),behavior); await reopened.undo(); assert.deepEqual(await reopened.read(name),scene); assert.equal(reopened.manifest.history.length,history);
  await reopened.changeSceneObject(name,{kind:'add-human',name:'NewCompanion',model:'models/Human.4ds',position:[2,0,0],rotation:[1,0,0,0],scale:[1,1,1],parameters:{},behavior},hash(scene)); assert.equal(inspectScene(await reopened.read(name)).actorScripts.at(-1).code,humanBehaviorScript('NewCompanion',behavior)); await reopened.undo(); assert.deepEqual(await reopened.read(name),scene);
});
test('following rejects missing player/bindings and protects scene and geometry at publication', async t => {
  const {project,name,scene,behavior} = await followingFixture(t), history=project.manifest.history.length;
  for(const invalid of [{startSignal:'Missing'},{onComplete:'Target'},{destinationName:'Tommy'},{destinationRadius:0}]) await assert.rejects(project.changeSceneObject(name,{kind:'configure-human',target:'Guard',behavior:{...behavior,...invalid}},hash(scene)),/Doprovod/);
  assert.deepEqual(await project.read(name),scene); assert.equal(project.manifest.history.length,history);
  const batch=project.changeBatch,geometryPath='missions/NPC/scene.4ds',geometry=await project.read(geometryPath);
  project.changeBatch=async function(files,...args){await this.change(geometryPath,Buffer.concat([geometry,Buffer.from([1])]),'Independent geometry');return batch.call(this,files,...args);};
  await assert.rejects(project.changeSceneObject(name,{kind:'configure-human',target:'Guard',behavior},hash(scene)),/změnil/); assert.deepEqual(await project.read(name),scene); project.changeBatch=batch; await project.undo(); assert.deepEqual(await project.read(geometryPath),geometry);
  const save=project.saveManifest; project.saveManifest=async()=>{throw Error('following publication failure');}; await assert.rejects(project.changeSceneObject(name,{kind:'configure-human',target:'Guard',behavior},hash(scene)),/following publication/); project.saveManifest=save; assert.deepEqual(await project.read(name),scene); assert.equal(project.manifest.history.length,history);
});
