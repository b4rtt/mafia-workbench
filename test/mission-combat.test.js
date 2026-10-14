import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { missionCombatScript, combatTargets, resolveMissionCombat } from '../src/shared/mission-combat.js';
import { ModProject } from '../src/core/project.js';
import { hash, writeSafe } from '../src/core/files.js';
import { changeSceneObject, inspectScene } from '../src/core/scene.js';
import { addTextDbEntry } from '../src/core/textdb.js';

const combat = { targets: ['First', 'Second'], objectiveId: 10, interactionId: 20, completeId: 30 };
const chunk = (type, payload) => { const header = Buffer.alloc(6); header.writeUInt16LE(type); header.writeUInt32LE(payload.length + 6, 2); return Buffer.concat([header, payload]); };
const human = (scene, name) => changeSceneObject(scene, { kind: 'add-human', name, model: 'human.i3d', position: [0, 0, 0], rotation: [1, 0, 0, 0], scale: [1, 1, 1], parameters: {}, code: 'wait 123\nend' });

// Execute the emitted polling decisions against changing actor states. This
// deliberately tests gameplay outcomes rather than only matching a template.
function decision(script, health, elapsed = 0) {
  const lines = script.split('\n'), labels = new Map(lines.map((line, i) => [/^label (\d+)$/.exec(line)?.[1], i]).filter(([label]) => label));
  let pc = labels.get('10') + 1, value = 0;
  for (let steps = 0; steps < 200; steps++) {
    const line = lines[pc++];
    if (line === 'label 20') return 'success';
    if (line === 'label 30') return 'failure';
    if (line === 'label 40') return 'pending';
    const energy = /^human_getproperty (\d+), 0, Energy$/.exec(line);
    if (energy) value = health[Number(energy[1])];
    if (line === 'getgametime 2') value = elapsed;
    const branch = /^if flt\[(\d+)\] > ([\d.e+-]+), (-?\d+), (-?\d+)$/.exec(line);
    if (branch) { const destination = (Number(branch[1]) === 2 ? elapsed : value) > Number(branch[2]) ? branch[3] : branch[4]; if (destination !== '-1') pc = labels.get(destination); }
    const jump = /^goto (\d+)$/.exec(line); if (jump) pc = labels.get(jump[1]);
  }
  throw Error('Polling did not reach an outcome');
}

test('combat keeps waiting until every target is defeated and gives failure priority', () => {
  const code = missionCombatScript({ ...combat, failure: { humanName: 'Guard', timeoutSeconds: 10, textId: 40 } });
  assert.equal(decision(code, [100, 100, 100]), 'pending');
  assert.equal(decision(code, [0, 100, 100]), 'pending');
  assert.equal(decision(code, [100, 0, 100]), 'pending');
  assert.equal(decision(code, [0, 0, 100]), 'success');
  assert.equal(decision(code, [0, 0, 0]), 'failure');
  assert.equal(decision(code, [0, 0, 100], 10001), 'failure');
  assert.equal(decision(code, [0, 0, 100], 10000), 'success');
  assert(!code.includes('human_setproperty') && !code.includes('mission_objectivesclear') && !code.includes('globaltimer') && !code.includes('human_isdead'));
});

test('combat activation, initialized checkpoint, signal indices and separate outcomes', () => {
  const code = missionCombatScript({ ...combat, checkpointId: 5050, failure: { humanName: 'Guard', textId: 40 }, flow: { waitForSignal: true, onComplete: 'Next', onFailure: 'Fail' } });
  assert(code.indexOf('detector_issignal') < code.indexOf('mission_objectives 10'));
  assert(code.indexOf('detector_waitforuse 20') < code.indexOf('findactor 0, "First"'));
  assert(code.indexOf('findactor 2, "Guard"') < code.indexOf('autosavegamefull'));
  assert(code.indexOf('autosavegamefull') < code.indexOf('label 10'));
  assert(code.includes('dim_act 5') && code.includes('findactor 3, "Next"') && code.includes('findactor 4, "Fail"'));
  assert(code.includes('detector_setsignal 3, 1\nend\nlabel 30') && code.endsWith('detector_setsignal 4, 1\nend'));
  const load = missionCombatScript({ ...combat, trigger: 'load', interactionId: undefined, exitToMenu: true });
  assert(!load.includes('waitforuse') && load.includes('endofmission 1, 30'));
  assert(missionCombatScript({ ...combat, failure: { timeoutSeconds: 1, textId: 40, endMission: true } }).endsWith('endofmission 0, 40\nend'));
  for (const extra of [{ targets: [] }, { targets: Array(17).fill('A') }, { targets: ['First', 'FIRST'] }, { targets: ['A"\nend'] }, { targets: ['Tommy'] }, { trigger: 'bogus' }, { completeId: 2147483648 }, { checkpointId: 5600 }, { failure: {} }, { failure: { humanName: 'FIRST', textId: 40 } }, { failure: { timeoutSeconds: NaN, textId: 40 } }, { failure: { timeoutSeconds: 1, textId: 40, endMission: 'false' } }]) assert.throws(() => missionCombatScript({ ...combat, ...extra }), /Bojový úkol/);
  assert.throws(() => missionCombatScript({ ...combat, exitToMenu: true, flow: { onComplete: 'Next' } }), /Návaznost/);
});

test('combat resolves NPC names and excludes ambiguous names, player and nonhumans', () => {
  const scene = { actors: [{ name: 'First', kind: 27 }, { name: 'Second', kind: 27 }, { name: 'Tommy', kind: 2 }, { name: 'Car', kind: 4 }, { name: 'Next', kind: 5 }], objects: ['First', 'Second', 'Tommy', 'Car', 'Next'].map(name => ({ name })) };
  assert.deepEqual(combatTargets(scene).map(actor => actor.name), ['First', 'Second']);
  assert.deepEqual(resolveMissionCombat(scene, { ...combat, targets: ['FIRST', 'second'], flow: { onComplete: 'next' } }, 'Quest').targets, combat.targets);
  assert.equal(resolveMissionCombat(scene, { ...combat, flow: { onComplete: 'next' } }, 'Quest').flow.onComplete, 'Next');
  assert.throws(() => resolveMissionCombat(scene, { ...combat, targets: ['Car'] }, 'Quest'), /NPC/);
  assert.throws(() => resolveMissionCombat({ ...scene, actors: [...scene.actors, { name: 'FIRST', kind: 27 }] }, combat, 'Quest'), /NPC/);
  assert.throws(() => resolveMissionCombat({ ...scene, objects: scene.objects.filter(object => object.name !== 'First') }, combat, 'Quest'), /NPC/);
});

test('combat transaction protects text and geometry dependencies, preserves scripts, exports and undoes exact bytes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mafia-combat-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeSafe(root, 'workbench.json', JSON.stringify({ format: 'mafia-workbench', version: 2, name: 'Combat test', assets: [], history: [] }));
  const p = await ModProject.open(root), name = 'missions/Test/scene2.bin', geometryPath = 'missions/Test/scene.4ds', textPath = 'tables/textdb_cz.def';
  const geometry = Buffer.alloc(19); geometry.write('4DS\0'); geometry.writeUInt16LE(29, 4); geometry[18] = 1;
  let scene = chunk(0x4c53, Buffer.concat([chunk(0x4000, Buffer.alloc(0)), chunk(0xbabe, Buffer.from('opaque'))]));
  for (const npc of ['First', 'Second', 'Guard']) scene = human(scene, npc);
  scene = changeSceneObject(scene, { kind: 'add-detector', name: 'Next', position: [0, 0, 0], mask: 0, code: 'wait 789\nend' });
  let text = Buffer.alloc(17); text.writeUInt32LE(1); text.writeUInt32LE(99999999, 8); text.writeUInt32LE(16, 12);
  for (const [id, value] of [[10, 'Poraz oba'], [20, 'Přijmout'], [30, 'Hotovo'], [40, 'Neúspěch'], [5050, 'Boj začíná'], [50, '   ']]) text = addTextDbEntry(text, textPath, { id, text: value });
  await p.createFiles([{ path: name, data: scene }, { path: geometryPath, data: geometry }, { path: textPath, data: text }]);
  const history = p.manifest.history.length, request = { kind: 'add-detector', name: 'Quest', position: [0, 0, 0], mask: 128, code: 'untrusted', combat: { ...combat, targets: ['first', 'SECOND'], checkpointId: 5050, failure: { humanName: 'guard', textId: 40 }, flow: { onComplete: 'next' }, textDb: textPath, textHash: hash(text) } };
  for (const extra of [{ textHash: 'stale' }, { completeId: 50 }, { completeId: 99999999 }, { completeId: 999 }, { targets: ['Missing'] }, { targets: ['Next'] }, { checkpointId: 5051 }]) await assert.rejects(() => p.changeSceneObject(name, { ...request, combat: { ...request.combat, ...extra } }, hash(scene)), /Bojový úkol/);
  await assert.rejects(() => p.changeSceneObject(name, { ...request, task: {} }, hash(scene)), /pouze jednu/);
  assert.deepEqual(await p.read(name), scene); assert.equal(p.manifest.history.length, history);
  await p.changeSceneObject(name, request, hash(scene)); const after = await p.read(name), parsed = inspectScene(after);
  assert.equal(parsed.actorScripts.find(script => script.name === 'Quest').code, missionCombatScript({ ...request.combat, targets: ['First', 'Second'], failure: { humanName: 'Guard', textId: 40 }, flow: { onComplete: 'Next' } }));
  for (const actor of ['First', 'Second', 'Guard']) assert.equal(parsed.actorScripts.find(script => script.name === actor).code, 'wait 123\nend');
  assert.equal(parsed.actorScripts.find(script => script.name === 'Next').code, 'wait 789\nend'); assert.equal(parsed.entries.filter(entry => entry.detectorParameter).at(-1).value, 1);
  const reopened = await ModProject.open(root); await reopened.export(path.join(root, 'export')); assert.deepEqual(await fs.readFile(path.join(root, 'export', name)), after);
  await reopened.undo(); assert.deepEqual(await reopened.read(name), scene); assert.deepEqual(await reopened.read(textPath), text); assert.deepEqual(await reopened.read(geometryPath), geometry); assert.equal(reopened.manifest.history.length, history);
  const batch = reopened.changeBatch;
  for (const dependency of [textPath, geometryPath]) {
    const original = await reopened.read(dependency);
    reopened.changeBatch = async function (files, ...args) { await this.change(dependency, Buffer.concat([original, Buffer.from([1])]), 'Concurrent dependency'); return batch.call(this, files, ...args); };
    await assert.rejects(() => reopened.changeSceneObject(name, request, hash(scene)), /změnil/); assert.deepEqual(await reopened.read(name), scene);
    reopened.changeBatch = batch; await reopened.undo(); assert.deepEqual(await reopened.read(dependency), original);
  }
});

test('combat wizard recovers existing canonical programs and refuses any edited source', async () => {
  const {inspectMissionCombat}=await import('../src/shared/mission-combat.js');
  for(const trigger of ['use','load'])for(const checkpointId of [null,5050])for(const exitToMenu of [false,true])for(const failure of [null,{timeoutSeconds:.1,textId:40},{humanName:'Guard',textId:40},{humanName:'Guard',timeoutSeconds:123.456,textId:40,endMission:true}])for(const waiting of [false,true]){
    const options={...combat,trigger,checkpointId,exitToMenu,failure,flow:{waitForSignal:waiting}},source=missionCombatScript(options),parsed=inspectMissionCombat(source);
    assert(parsed);assert.equal(missionCombatScript(parsed),source);assert.equal(missionCombatScript(inspectMissionCombat(source.replaceAll('\n','\r\n'))),source);assert.deepEqual(parsed.targets,combat.targets);assert.equal(parsed.trigger,trigger);
    for(const changed of [source+'\n// changed',source.replace('wait 2000','wait 2001'),source.replace('Energy','"Energy"'),source.replace('goto 20','goto 30'),source.replace('dim_act','dim_frm')])assert.equal(inspectMissionCombat(changed),null);
  }
  for(const flow of [{onComplete:'Next'},{onFailure:'Fail'},{waitForSignal:true,onComplete:'Next',onFailure:'Next'},{onComplete:'Next',onFailure:'Fail'}]){
    const code=missionCombatScript({...combat,failure:{timeoutSeconds:10,textId:40},flow});assert.equal(missionCombatScript(inspectMissionCombat(code)),code);assert.deepEqual(inspectMissionCombat(code).flow,{waitForSignal:flow.waitForSignal??false,onComplete:flow.onComplete??null,onFailure:flow.onFailure??null});
  }
  for(const invalid of [null,{},'end','mission_objectives 10\nsubtitle_add 30', 'findactor 0, "First"\nhuman_getproperty 0, 0, Energy\nif flt[0] > 0, 40, -1'])assert.equal(inspectMissionCombat(invalid),null);
});
async function combatEditFixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-combat-edit-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:2,name:'Edit test',assets:[],history:[]}));
  const p=await ModProject.open(root),name='missions/Edit/scene2.bin',geometryPath='missions/Edit/scene.4ds',textPath='tables/textdb_cz.def',geometry=Buffer.alloc(19);geometry.write('4DS\0');geometry.writeUInt16LE(29,4);geometry[18]=1;
  let scene=chunk(0x4c53,Buffer.concat([chunk(0x4000,Buffer.alloc(0)),chunk(0xbabe,Buffer.from('opaque sibling'))]));for(const npc of ['First','Second','Guard'])scene=human(scene,npc);
  for(const detector of ['Next','Fail'])scene=changeSceneObject(scene,{kind:'add-detector',name:detector,position:[1,2,3],mask:128,code:'wait 789\nend'});
  const recipe={...combat,checkpointId:5050,failure:{humanName:'Guard',timeoutSeconds:10,textId:40},flow:{waitForSignal:true,onComplete:'Next',onFailure:'Fail'}};
  scene=changeSceneObject(scene,{kind:'add-detector',name:'Quest',position:[4,5,6],mask:1,code:missionCombatScript(recipe)});
  let text=Buffer.alloc(17);text.writeUInt32LE(1);text.writeUInt32LE(99999999,8);text.writeUInt32LE(16,12);for(const[id,value]of [[10,'Poraz oba'],[20,'Přijmout'],[30,'Hotovo'],[40,'Neúspěch'],[5050,'Boj začíná'],[50,'   ']])text=addTextDbEntry(text,textPath,{id,text:value});
  await p.createFiles([{path:name,data:scene},{path:geometryPath,data:geometry},{path:textPath,data:text}]);
  return {p,root,name,geometryPath,textPath,geometry,text,scene,recipe,request:{kind:'configure-combat',target:'qUEST',name:'Do not rename',position:[99,99,99],mask:0,code:'Do not trust client code',combat:{...recipe,targets:['second'],checkpointId:null,failure:{timeoutSeconds:5,textId:40},flow:{onComplete:'next'},textDb:textPath,textHash:hash(text)}}};
}

test('editing a combat quest changes only its code; exact old recipe survives reopen, export, no-op and undo',async t=>{
  const {editableMissionCombat}=await import('../src/shared/mission-combat.js'),{p,root,name,geometryPath,textPath,scene,geometry,text,request}=await combatEditFixture(t),original=inspectScene(scene),history=p.manifest.history.length;
  assert(editableMissionCombat({...original,geometry:{meshes:[]}},'Quest'));
  await p.changeSceneObject(name,request,hash(scene));const after=await p.read(name),parsed=inspectScene(after),entry=parsed.entries.find(e=>e.actorScript&&e.value.name==='Quest'),expected={...request.combat,targets:['Second'],flow:{onComplete:'Next'}};
  assert.equal(entry.value.code,missionCombatScript(expected));assert.deepEqual(parsed.entries.filter(e=>e.id!==entry.id),original.entries.filter(e=>e.id!==entry.id));assert(after.includes(Buffer.from('opaque sibling')));assert.deepEqual(await p.read(textPath),text);assert.deepEqual(await p.read(geometryPath),geometry);assert.deepEqual(p.manifest.history.at(-1).files.map(f=>f.path),[name]);
  await p.changeSceneObject(name,request,hash(after));assert.equal(p.manifest.history.length,history+1,'Unchanged recipe must not create history');
  const reopened=await ModProject.open(root);await reopened.export(root+'/export');assert.deepEqual(await fs.readFile(root+'/export/'+name),after);assert.equal(missionCombatScript(editableMissionCombat(await reopened.inspectMap(name),'Quest').combat),entry.value.code);
  await reopened.undo();assert.deepEqual(await reopened.read(name),scene);assert.equal(reopened.manifest.history.length,history);
});

test('combat editing refuses custom programs, changed masks, ambiguous actors, stale text and mixed templates',async t=>{
  const {editableMissionCombat}=await import('../src/shared/mission-combat.js'),{p,name,scene,request}=await combatEditFixture(t),history=p.manifest.history.length;
  for(const invalid of [{target:'Missing'},{target:'First'},{task:{}},{dialogue:{}},{combat:{...request.combat,targets:['Missing']}},{combat:{...request.combat,textHash:'stale'}},{combat:{...request.combat,completeId:50}}])await assert.rejects(p.changeSceneObject(name,{...request,...invalid},hash(scene)),/Bojový úkol/);
  const parsed=inspectScene(scene),entry=parsed.entries.find(e=>e.actorScript&&e.value.name==='Quest'),{editScene}=await import('../src/core/scene.js');
  for(const change of [{id:entry.id,value:{...entry.value,code:entry.value.code+'\n// custom'}},{id:parsed.entries.find(e=>e.detectorParameter&&e.context.endsWith('/ Quest')).id,value:128}]){
    const custom=editScene(scene,change.id,change.value);assert.equal(editableMissionCombat({...inspectScene(custom),geometry:{meshes:[]}},'Quest'),null);await p.change(name,custom,'User source');await assert.rejects(p.changeSceneObject(name,request,hash(custom)),/editoru zdroje/);await p.undo();
  }
  const duplicate={...parsed,actors:[...parsed.actors,parsed.actors.find(a=>a.name==='Quest')]};assert.equal(editableMissionCombat(duplicate,'Quest'),null);assert.deepEqual(await p.read(name),scene);assert.equal(p.manifest.history.length,history);
});

test('combat edit guards dependencies at publication and rolls back a failed manifest',async t=>{
  const {p,name,geometryPath,textPath,scene,request}=await combatEditFixture(t),history=p.manifest.history.length,batch=p.changeBatch;
  for(const dependency of [textPath,geometryPath]){const before=await p.read(dependency);p.changeBatch=async function(files,...args){await this.change(dependency,Buffer.concat([before,Buffer.from([1])]),'Independent change');return batch.call(this,files,...args);};await assert.rejects(p.changeSceneObject(name,request,hash(scene)),/změnil/);assert.deepEqual(await p.read(name),scene);p.changeBatch=batch;await p.undo();assert.deepEqual(await p.read(dependency),before);}
  const save=p.saveManifest;p.saveManifest=async()=>{throw Error('combat edit publication failure');};await assert.rejects(p.changeSceneObject(name,request,hash(scene)),/publication failure/);p.saveManifest=save;assert.deepEqual(await p.read(name),scene);assert.equal(p.manifest.history.length,history);
});
