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
import { humanBehaviorScript } from '../src/shared/human-behavior.js';

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
  await project.createFiles([{ path: scenePath, data: scene }, { path: 'MISSIONS/TEST/SCENE.4DS', data: geometry }, { path: 'models/Human.4ds', data: geometry }, { path: 'missions/test/tree.klz', data: collisionFixture() }, { path: textPath, data: textDb([10, 20, 30, 40, 80]) }, { path: 'tables/textdb_en.def', data: textDb([10, 20, 30, 40]) }, { path: 'SOUNDS/00000080.WAV', data: voice }]);
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
  assert(report.custom > 0); assert(report.issues.some(issue => issue.code === 'custom')); assert.equal(report.files.length, 6); assert.equal(report.models, 1); assert.equal(report.textures, 0);
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

const patrol={mode:'patrol',waypoints:[{id:77,pauseSeconds:1}],pace:'walk',loop:false,delaySeconds:0,startSignal:'Talk',onComplete:'Quest'};
function navigation(ids=[77,88]) {
  const bytes=Buffer.alloc(8+30*ids.length);bytes.writeUInt32LE(0x01abcedf);bytes.writeUInt32LE(ids.length,4);
  ids.forEach((id,index)=>{const at=8+30*index;bytes.writeFloatLE(index*5,at);bytes.writeUInt16LE(1,at+12);bytes.writeUInt16LE(id,at+14);bytes.writeUInt16LE(50,at+16);});return bytes;
}
test('mission check validates exact NPC patrols against current stored navigation IDs and reports the source without mutations',async t=>{
  const {project}=await fixture(t),nav='missions/Test/check.bin';
  await script(project,'Companion',humanBehaviorScript('Companion',patrol));
  let report=await project.checkMission(scenePath);assert(errors(report).some(i=>i.code==='npc-route'&&i.object==='Companion'&&i.entryId&&i.path===scenePath&&i.message.includes('check.bin')));
  await project.createFiles([{path:nav,data:navigation()}]);
  const before=new Map(await Promise.all(project.manifest.assets.map(async a=>[a.path,await project.read(a.path)]))),history=project.manifest.history.length;
  report=await project.checkMission(scenePath);assert.deepEqual(errors(report),[]);assert.equal(report.recipes,3);assert(report.files.some(f=>f.path===nav));
  for(const options of [{...patrol,waypoints:[{id:0,pauseSeconds:0}]},{...patrol,waypoints:[...patrol.waypoints,{id:88,pauseSeconds:0}]}]){
    await script(project,'Companion',humanBehaviorScript('Companion',options));report=await project.checkMission(scenePath);const issue=errors(report).find(i=>i.code==='npc-route');assert.equal(issue.object,'Companion');assert.equal(issue.path,scenePath);assert(issue.entryId);await project.undo();
  }
  for(const data of [navigation([77,77]),Buffer.from('bad')]){await project.change(nav,data,'Navigation audit');report=await project.checkMission(scenePath);assert(errors(report).some(i=>i.code==='npc-route'));await project.undo();}
  await script(project,'Companion',humanBehaviorScript('Companion',{...patrol,startSignal:'MissingGate'}));report=await project.checkMission(scenePath);const gate=errors(report).find(i=>i.code==='flow');assert(gate.entryId);assert.equal(gate.path,scenePath);await project.undo();
  assert.equal(project.manifest.history.length,history);for(const[n,b]of before)assert.deepEqual(await project.read(n),b);
  const read=project.read.bind(project);let count=0;project.read=async n=>{const b=await read(n);return n===nav&&++count===2?Buffer.concat([b,Buffer.from([0])]):b;};await assert.rejects(project.checkMission(scenePath),/během kontroly/);assert.equal(project.manifest.history.length,history);
});
test('following dependencies are checked while altered NPC programs remain explicitly unknown',async t=>{
  const {project}=await fixture(t),options={mode:'follow',startSignal:'Talk',destinationName:'Finish',destinationRadius:3,onComplete:'Quest',delaySeconds:0};
  await script(project,'Companion',humanBehaviorScript('Companion',options));let report=await project.checkMission(scenePath);assert.deepEqual(errors(report),[]);assert.equal(report.recipes,3);
  for(const extra of [{destinationName:'Absent'},{startSignal:'MissingGate'},{onComplete:'MissingDone'}]){
    await script(project,'Companion',humanBehaviorScript('Companion',{...options,...extra}));report=await project.checkMission(scenePath);const issue=errors(report).find(i=>i.code==='npc-follow');assert.equal(issue.object,'Companion');assert(issue.entryId);await project.undo();
  }
  await script(project,'Companion',humanBehaviorScript('Companion',options)+'// own');report=await project.checkMission(scenePath);assert.equal(report.recipes,2);assert(!errors(report).some(i=>i.code==='npc-follow'));assert(report.issues.some(i=>i.code==='custom'));
});

test('driving checks stored road data, bound vehicles, static stops and gates while preserving all files and history',async t=>{
  const {project}=await fixture(t),roadName='missions/Test/road.bin',options={mode:'drive',carName:'Car',boarding:'seated',stops:[{name:'Finish',pauseSeconds:1}],loop:false,delaySeconds:0,startSignal:'Talk',onComplete:'Quest'};
  const before=await project.read(scenePath);await project.change(scenePath,changeSceneObject(before,{kind:'add-car',name:'Car',model:'Human.i3d',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]}),'Test vehicle');
  await script(project,'Companion',humanBehaviorScript('Companion',options));
  let report=await project.checkMission(scenePath);assert(errors(report).some(i=>i.code==='npc-drive'&&i.path===scenePath&&i.object==='Companion'&&i.entryId&&i.message.includes('road.bin')));
  const {changeRoadTopology}=await import('../src/core/road-topology.js');let road=Buffer.alloc(12);road.writeUInt32LE(2);
  for(const position of [[0,0,0],[0,0,10]])road=changeRoadTopology(road,{action:'create-crossing',position,speed:5,semaphore:0}).data;
  road=changeRoadTopology(road,{action:'connect',from:0,to:1,positions:[[0,0,5]],speed:5}).data;await project.createFiles([{path:roadName,data:road}]);
  const snapshot=new Map(await Promise.all(project.manifest.assets.map(async a=>[a.path,await project.read(a.path)]))),history=project.manifest.history.length;
  report=await project.checkMission(scenePath);assert.deepEqual(errors(report),[]);assert.equal(report.recipes,3);assert(report.files.some(f=>f.path===roadName&&f.sha256===hash(road)));
  for(const extra of [{carName:'Missing'},{stops:[{name:'Tommy',pauseSeconds:0}]},{stops:[{name:'Missing',pauseSeconds:0}]},{startSignal:'Car'},{onComplete:'Absent'}]){
    await script(project,'Companion',humanBehaviorScript('Companion',{...options,...extra}));report=await project.checkMission(scenePath);const issue=errors(report).find(i=>i.code==='npc-drive');assert.equal(issue.object,'Companion');assert.equal(issue.path,scenePath);assert(issue.entryId);await project.undo();
  }
  for(const bytes of [Buffer.from('bad'),Buffer.from([2,0,0,0,0,0,0,0,0,0,0,0])]){await project.change(roadName,bytes,'Road audit');report=await project.checkMission(scenePath);assert(errors(report).some(i=>i.code==='npc-drive'));await project.undo();}
  await script(project,'Companion',humanBehaviorScript('Companion',options)+'// own');report=await project.checkMission(scenePath);assert.equal(report.recipes,2);assert(!errors(report).some(i=>i.code==='npc-drive'));await project.undo();
  assert.equal(project.manifest.history.length,history);for(const [name,bytes]of snapshot)assert.deepEqual(await project.read(name),bytes);
  const read=project.read.bind(project);let count=0;project.read=async n=>{const b=await read(n);return n===roadName&&++count===2?Buffer.concat([b,Buffer.from([0])]):b;};await assert.rejects(project.checkMission(scenePath),/během kontroly/);
});

function texturedModel({texture='WALL.BMP',alpha='MASK.BMP',environment='REFLECT.BMP',animated=false}={}) {
  const header=Buffer.alloc(16);header.write('4DS\0');header.writeUInt16LE(29,4);header.writeUInt16LE(1,14);
  const values=Buffer.alloc(44);values.writeUInt32LE((alpha?0x40000000:0)|(environment?0x80000:0)|(animated?0x4000000:0));values.writeFloatLE(1,40);
  const text=value=>Buffer.concat([Buffer.from([Buffer.byteLength(value)]),Buffer.from(value)]);
  return Buffer.concat([header,values,...(environment?[Buffer.alloc(4),text(environment)]:[]),text(texture),...(alpha?[text(alpha)]:[]),...(animated?[Buffer.alloc(18)]:[]),Buffer.alloc(3)]);
}
test('mission assets include scene materials, direct models and every diffuse, alpha and reflection dependency without mutations',async t=>{
  const {project,root}=await fixture(t),modelName='models/Human.4ds';
  await project.change(modelName,texturedModel(),'Textured model');
  await project.change('missions/Test/scene.4ds',texturedModel({texture:'maps/WALL.BMP',alpha:'',environment:''}),'Scene material');
  let report=await project.checkMission(scenePath),missing=errors(report).filter(i=>i.code==='texture');
  assert.equal(missing.length,4);assert(missing.some(i=>i.path===modelName&&i.message.includes('MASK.BMP')));assert(missing.some(i=>i.path===modelName&&i.message.includes('REFLECT.BMP')));assert(missing.some(i=>/SCENE.4DS$/.test(i.path)));
  // Texture presence/readability, not image decoding, is the declared scope.
  await project.createFiles(['wall.bmp','mask.bmp','reflect.bmp'].map(n=>({path:'MAPS/'+n,data:Buffer.from('image payload')})));
  const manifest=await fs.readFile(root+'/workbench.json'),history=project.manifest.history.length,before=new Map(await Promise.all(project.manifest.assets.map(async a=>[a.path,await project.read(a.path)])));
  report=await project.checkMission(scenePath);assert.deepEqual(errors(report),[]);assert.equal(report.models,1);assert.equal(report.textures,3);assert.equal(report.files.filter(f=>/^MAPS\//.test(f.path)).length,3);assert.equal(report.files.filter(f=>f.path===modelName).length,1);
  assert.deepEqual((await(await ModProject.open(root)).checkMission(scenePath)).issues,report.issues);
  assert.equal(project.manifest.history.length,history);assert.deepEqual(await fs.readFile(root+'/workbench.json'),manifest);for(const[n,b]of before)assert.deepEqual(await project.read(n),b);
  const read=project.read.bind(project);let count=0;project.read=async n=>{const b=await read(n);return n==='MAPS/mask.bmp'&&++count===2?Buffer.concat([b,Buffer.from([0])]):b;};await assert.rejects(project.checkMission(scenePath),/během kontroly/);
});
test('model failures point to owning scene, unsafe references never escape asset lookup and animated sequences remain explicitly incomplete',async t=>{
  const {project}=await fixture(t),scene=await project.inspect(scenePath),field=scene.objects.find(o=>o.name==='Companion').fields.model,baseline=await project.read(scenePath);
  for(const name of ['Missing.i3d','../Human.i3d','/Human.4ds','C:\\Human.4ds','Human.txt']){
    await project.change(scenePath,editScene(baseline,field,name),'Missing model');const report=await project.checkMission(scenePath),issue=errors(report).find(i=>i.code==='model');assert(issue.message.includes(name));assert.equal(issue.path,scenePath);assert.equal(issue.object,'Companion');await project.undo();
  }
  await project.change('models/Human.4ds',Buffer.from('broken'),'Damaged model');let report=await project.checkMission(scenePath),issues=errors(report).filter(i=>i.code==='model');assert.equal(issues.length,1);assert(issues[0].message.includes('Tommy, Companion'));await project.undo();
  await project.change('models/Human.4ds',texturedModel({texture:'../outside.bmp',alpha:'',environment:'',animated:true}),'Animated material');report=await project.checkMission(scenePath);assert(errors(report).some(i=>i.code==='texture'&&i.path==='models/Human.4ds'));assert.equal(report.issues.filter(i=>i.code==='texture-animation').length,1);
  await project.undo();assert.deepEqual(errors(await project.checkMission(scenePath)),[]);
});
