import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {missionTaskScript,inspectMissionTask} from '../src/shared/mission-task.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';
import {changeSceneObject,inspectScene} from '../src/core/scene.js';
import {addTextDbEntry} from '../src/core/textdb.js';
const task={objectiveId:10,interactionId:20,nextObjectiveId:30,completeId:40,targetName:'DESTINATION',targetRadius:2.5,exitToMenu:false};
const chunk=(type,payload)=>{const header=Buffer.alloc(6);header.writeUInt16LE(type);header.writeUInt32LE(payload.length+6,2);return Buffer.concat([header,payload]);};

test('mission task waits for interaction before polling the target, removes only its own objectives and has explicit menu exit',()=>{
  const code=missionTaskScript(task),use=code.indexOf('detector_waitforuse 20'),poll=code.indexOf('frm_getworldpos 0, 0');
  assert(use>code.indexOf('mission_objectives 10')&&poll>use);assert(code.includes('mission_objectivesremove 10\nmission_objectives 30'));assert(code.includes('if flt[6] < 2.5, 20, -1\nwait 100\ngoto 10'));assert(code.includes('mission_objectivesremove 30\nconsole_addtext 40'));assert(!code.includes('mission_objectivesclear')&&!code.includes('endofmission'));
  assert(missionTaskScript({...task,exitToMenu:true}).includes('endofmission 1, 40\nend'));
  for(const entry of [{objectiveId:-1},{interactionId:NaN},{completeId:4294967296},{targetName:'A"\nend'},{targetName:''},{targetRadius:0},{targetRadius:1e100},{targetRadius:1e-100},{exitToMenu:'false'}])assert.throws(()=>missionTaskScript({...task,...entry}),/Úkol/);
});

test('optional full checkpoint saves the accepted stage once, with an addressable named slot',()=>{
  const code=missionTaskScript({...task,checkpointId:5050});
  assert(code.includes('mission_objectivesremove 10\nmission_objectives 30\nautosavegamefull 5050, 1\nlabel 10'));
  assert.equal(code.split('autosavegamefull').length,2);assert(!missionTaskScript(task).includes('autosavegame'));
  for(const checkpointId of [5000,5599])assert(missionTaskScript({...task,checkpointId}).includes(`autosavegamefull ${checkpointId}, 1`));
  for(const checkpointId of [4999,5600,5050.5,NaN,'5050',false])assert.throws(()=>missionTaskScript({...task,checkpointId}),/checkpoint/);
});

test('task transaction verifies text IDs and dependencies, preserves other scripts, exports and undoes exact scene',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-task-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Task test',assets:[],history:[]}));
  const p=await ModProject.open(root),name='missions/Test/scene2.bin',geometryPath='missions/Test/scene.4ds',textPath='tables/textdb_cz.def',geometry=Buffer.alloc(19);geometry.write('4DS\0');geometry.writeUInt16LE(29,4);geometry[18]=1;
  const empty=chunk(0x4c53,Buffer.concat([chunk(0x4000,Buffer.alloc(0)),chunk(0xbabe,Buffer.from('unknown'))])),scene=changeSceneObject(empty,{kind:'add-detector',name:'DESTINATION',position:[8,0,0],mask:0,code:'wait 987\nend'});
  const text=Buffer.alloc(49);text.writeUInt32LE(5,0);for(const [i,id]of [10,20,30,40,99999999].entries()){text.writeUInt32LE(id,8+i*8);text.writeUInt32LE(48,12+i*8);}
  await p.createFiles([{path:name,data:scene},{path:geometryPath,data:geometry},{path:textPath,data:text}]);const original=JSON.stringify(p.manifest),history=p.manifest.history.length,request={kind:'add-detector',name:'QUEST',position:[0,0,0],mask:128,code:'untrusted replacement',task:{...task,textDb:textPath,textHash:hash(text)}};
  await assert.rejects(()=>p.changeSceneObject(name,{...request,task:{...request.task,textHash:'stale'}},hash(scene)),/změnily/);
  await assert.rejects(()=>p.changeSceneObject(name,{...request,task:{...request.task,completeId:41}},hash(scene)),/neexistuje/);
  await assert.rejects(()=>p.changeSceneObject(name,{...request,task:{...request.task,targetName:'MISSING'}},hash(scene)),/jednoznačný/);assert.equal(p.manifest.history.length,history);
  await p.changeSceneObject(name,request,hash(scene));const after=await p.read(name),parsed=inspectScene(after);assert.equal(parsed.actorScripts.find(s=>s.name==='QUEST').code,missionTaskScript(task));assert.equal(parsed.actorScripts.find(s=>s.name==='DESTINATION').code,'wait 987\nend');assert.equal(parsed.entries.filter(e=>e.detectorParameter).at(-1).value,1);assert.deepEqual(await p.read(textPath),text);assert.deepEqual(await p.read(geometryPath),geometry);
  const reopened=await ModProject.open(root);await reopened.export(path.join(root,'export'));assert.deepEqual(await fs.readFile(path.join(root,'export',name)),after);await reopened.undo();assert.deepEqual(await reopened.read(name),scene);assert.deepEqual(reopened.manifest.history,JSON.parse(original).history);assert.equal(reopened.manifest.version,2);assert.deepEqual(await reopened.read(textPath),text);assert.deepEqual(await reopened.read(geometryPath),geometry);
  const batch=reopened.changeBatch;reopened.changeBatch=async function(files,...args){await this.change(textPath,Buffer.concat([text,Buffer.from([123])]),'Concurrent text');return batch.call(this,files,...args);};await assert.rejects(()=>reopened.changeSceneObject(name,request,hash(scene)),/změnil/);assert.deepEqual(await reopened.read(name),scene);reopened.changeBatch=batch;await reopened.undo();assert.deepEqual(await reopened.read(textPath),text);
});

test('checkpoint creation requires a nonempty TextDB title and is guarded, exported and reversible',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-checkpoint-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Checkpoint',assets:[],history:[]}));
  const p=await ModProject.open(root),name='missions/Test/scene2.bin',textPath='tables/textdb_cz.def',geometry=Buffer.alloc(19);geometry.write('4DS\0');geometry.writeUInt16LE(29,4);geometry[18]=1;
  const scene=changeSceneObject(chunk(0x4c53,chunk(0x4000,Buffer.alloc(0))),{kind:'add-detector',name:'DESTINATION',position:[8,0,0],mask:0,code:'end'}),text=Buffer.alloc(49);text.writeUInt32LE(5,0);for(const [i,id]of [10,20,30,40,99999999].entries()){text.writeUInt32LE(id,8+i*8);text.writeUInt32LE(48,12+i*8);}
  const named=addTextDbEntry(text,textPath,{id:5050,text:'Po převzetí zadání'}),blank=addTextDbEntry(text,textPath,{id:5051,text:'   '});
  await p.createFiles([{path:name,data:scene},{path:'missions/Test/scene.4ds',data:geometry},{path:textPath,data:text}]);const history=p.manifest.history.length;
  const request=(bytes,checkpointId=5050)=>({kind:'add-detector',name:'QUEST',position:[0,0,0],task:{...task,checkpointId,textDb:textPath,textHash:hash(bytes)}});
  await assert.rejects(()=>p.changeSceneObject(name,request(text),hash(scene)),/neprázdný název/);assert.equal(p.manifest.history.length,history);
  await p.change(textPath,blank,'Blank checkpoint title');await assert.rejects(()=>p.changeSceneObject(name,request(blank,5051),hash(scene)),/neprázdný název/);await p.undo();
  await p.change(textPath,named,'Named checkpoint');await assert.rejects(()=>p.changeSceneObject(name,request(text),hash(scene)),/změnily/);
  await p.changeSceneObject(name,request(named),hash(scene));const saved=await p.read(name);assert.equal(inspectScene(saved).actorScripts.find(s=>s.name==='QUEST').code,missionTaskScript({...task,checkpointId:5050}));
  const reopened=await ModProject.open(root);await reopened.export(path.join(root,'export'));assert.deepEqual(await fs.readFile(path.join(root,'export',textPath)),named);assert.deepEqual(await fs.readFile(path.join(root,'export',name)),saved);await reopened.undo();assert.deepEqual(await reopened.read(name),scene);assert.deepEqual(await reopened.read(textPath),named);await reopened.undo();assert.deepEqual(await reopened.read(textPath),text);assert.equal(reopened.manifest.history.length,history);
});

test('failure checks start after acceptance, precede success, save initialized state and leave unrelated objectives/timer intact',()=>{
  const failure={timeoutSeconds:12.5,humanName:'NPC',textId:50,endMission:true},code=missionTaskScript({...task,failure,checkpointId:5050});
  assert(code.startsWith('dim_frm 2\ndim_flt 10\ndim_act 1\n'));
  assert(code.includes('mission_objectives 30\nfindactor 0, "NPC"\ngetgametime 8\nautosavegamefull 5050, 1\nlabel 10'));
  assert(code.includes('label 10\nhuman_getproperty 0, 7, Energy\nif flt[7] > 0, -1, 30\ngetgametime 9\nlet flt[9] = flt[9] - flt[8]\nif flt[9] > 12500, 30, -1\nfrm_getworldpos'));
  assert(code.includes('wait 4000\nend\nlabel 30\nmission_objectivesremove 30\nconsole_addtext 50\nwait 4000\nendofmission 0, 50\nend'));
  assert(!code.includes('globaltimer')&&!code.includes('mission_objectivesclear'));
  const health=missionTaskScript({...task,failure:{humanName:'NPC',textId:50}}),timed=missionTaskScript({...task,failure:{timeoutSeconds:.1,textId:50}});
  assert(health.includes('dim_flt 8')&&!health.includes('getgametime')&&!health.includes('endofmission'));assert(timed.includes('dim_flt 10')&&!timed.includes('dim_act')&&timed.includes('if flt[9] > 100, 30, -1'));
  const baseline='dim_frm 2\ndim_flt 7\nwait 2000\nfindframe 0, "DESTINATION"\nfindframe 1, "Tommy"\nmission_objectives 10\nsubtitle_add 10\ndetector_waitforuse 20\nmission_objectivesremove 10\nmission_objectives 30\nsubtitle_add 30\nlabel 10\nfrm_getworldpos 0, 0\nfrm_getworldpos 1, 3\nvect_sub_vect 0, 3\nvect_magnitude 0, 6\nif flt[6] < 2.5, 20, -1\nwait 100\ngoto 10\nlabel 20\nmission_objectivesremove 30\nsubtitle_add 40\nconsole_addtext 40\nwait 4000\nend';assert(inspectMissionTask(baseline));assert.equal(missionTaskScript(task),baseline.replace(/subtitle_add (\d+)\nconsole_addtext \1\n/g,'console_addtext $1\n').replace(/^subtitle_add \d+\n/gm,''));
  for(const invalid of [false,[],{}, {timeoutSeconds:0,textId:50},{timeoutSeconds:Infinity,textId:50},{timeoutSeconds:86400.1,textId:50},{timeoutSeconds:'60',textId:50},{humanName:'NPC"\nend',textId:50},{humanName:'',textId:50},{humanName:'NPC',textId:2147483648},{humanName:'NPC',textId:NaN},{humanName:'NPC',textId:50,endMission:'false'}])assert.throws(()=>missionTaskScript({...task,failure:invalid}),/Úkol/);
});

test('failure transaction validates named text and human binding, canonicalizes case, guards dependencies and restores exact files',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-failure-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:2,name:'Failure',assets:[],history:[]}));
  const p=await ModProject.open(root),name='missions/Test/scene2.bin',textPath='tables/textdb_cz.def',geometry=Buffer.alloc(19);geometry.write('4DS\0');geometry.writeUInt16LE(29,4);geometry[18]=1;
  let scene=changeSceneObject(chunk(0x4c53,Buffer.concat([chunk(0x4000,Buffer.alloc(0)),chunk(0xbeef,Buffer.from('opaque'))])),{kind:'add-detector',name:'DESTINATION',position:[8,0,0],mask:0,code:'wait 321\nend'});
  scene=changeSceneObject(scene,{kind:'add-human',name:'NPC',model:'human.i3d',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1],parameters:{},code:'wait 123\nend'});
  let text=Buffer.alloc(49);text.writeUInt32LE(5);for(const [i,id]of [10,20,30,40,99999999].entries()){text.writeUInt32LE(id,8+i*8);text.writeUInt32LE(48,12+i*8);}text=addTextDbEntry(text,textPath,{id:50,text:'Úkol selhal.'});text=addTextDbEntry(text,textPath,{id:51,text:'   '});
  await p.createFiles([{path:name,data:scene},{path:'missions/Test/scene.4ds',data:geometry},{path:textPath,data:text}]);const history=p.manifest.history.length,failure={timeoutSeconds:60,humanName:'npc',textId:50,endMission:false},request={kind:'add-detector',name:'QUEST',position:[0,0,0],task:{...task,failure,textDb:textPath,textHash:hash(text)}};
  for(const extra of [{textId:52},{textId:51},{textId:99999999},{humanName:'DESTINATION'},{humanName:'MISSING'}])await assert.rejects(()=>p.changeSceneObject(name,{...request,task:{...request.task,failure:{...failure,...extra}}},hash(scene)),/Úkol/);
  assert.equal(p.manifest.history.length,history);assert.deepEqual(await p.read(name),scene);
  await p.changeSceneObject(name,request,hash(scene));const after=await p.read(name),parsed=inspectScene(after);assert.equal(parsed.actorScripts.find(script=>script.name==='QUEST').code,missionTaskScript({...task,failure:{...failure,humanName:'NPC'}}));assert.equal(parsed.actorScripts.find(script=>script.name==='NPC').code,'wait 123\nend');assert.equal(parsed.actorScripts.find(script=>script.name==='DESTINATION').code,'wait 321\nend');
  const reopened=await ModProject.open(root);await reopened.export(path.join(root,'export'));assert.deepEqual(await fs.readFile(path.join(root,'export',name)),after);assert.deepEqual(await fs.readFile(path.join(root,'export',textPath)),text);await reopened.undo();assert.deepEqual(await reopened.read(name),scene);assert.equal(reopened.manifest.history.length,history);
  const batch=reopened.changeBatch;reopened.changeBatch=async function(files,...args){await this.change(textPath,Buffer.concat([text,Buffer.from([1])]),'Concurrent failure title');return batch.call(this,files,...args);};await assert.rejects(()=>reopened.changeSceneObject(name,request,hash(scene)),/změnil/);assert.deepEqual(await reopened.read(name),scene);reopened.changeBatch=batch;await reopened.undo();assert.deepEqual(await reopened.read(textPath),text);
});
