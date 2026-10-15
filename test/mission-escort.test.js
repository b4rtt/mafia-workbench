import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { missionTaskScript, inspectMissionTask, missionTaskEscortHumans, resolveMissionTaskEscort, editableMissionTask } from '../src/shared/mission-task.js';
import { missionLogic } from '../src/shared/mission-logic.js';
import { ModProject } from '../src/core/project.js';
import { changeSceneObject, inspectScene } from '../src/core/scene.js';
import { addTextDbEntry } from '../src/core/textdb.js';
import { hash, writeSafe } from '../src/core/files.js';

const task={objectiveId:10,interactionId:20,nextObjectiveId:30,completeId:40,targetName:'Finish',targetRadius:3,escort:{humanName:'Companion'},exitToMenu:false};
test('NPC arrival tasks measure the live NPC, retain activation/failure ordering and recover all independent signal registers',()=>{
 for(const trigger of ['use','load','area'])for(const humanName of [null,'Companion','Other'])for(const timed of [false,true]){
  const options={...task,...(trigger==='use'?{}:{trigger,triggerRadius:trigger==='area'?2.5:null,objectiveId:null,interactionId:null}),failure:humanName||timed?{humanName,timeoutSeconds:timed?30:null,textId:50,endMission:false}:null,flow:{waitForSignal:true,onComplete:'Success',onFailure:humanName||timed?'Failure':null}};
  const code=missionTaskScript(options),recovered=inspectMissionTask(code);assert(recovered);assert.equal(missionTaskScript(recovered),code);assert.equal(missionTaskScript(inspectMissionTask(code.replaceAll('\n','\r\n'))),code);
  assert.deepEqual(recovered.escort,options.escort);assert.equal(recovered.failure?.humanName??null,humanName);assert.match(code,/findframe 1, "Companion"/);assert(!code.includes('findframe 1, "Tommy"'));
  const alive=code.indexOf('if flt[7] > 0, -1, 15'),distance=code.indexOf('vect_magnitude');assert(alive>code.indexOf('label 10')&&distance>alive);if(timed)assert(code.indexOf('if flt[9] > 30000, 30, -1')<alive);if(humanName)assert(code.indexOf('if flt[7] > 0, -1, 30')<alive);
  for(const altered of [code.replace('if flt[7] > 0, -1, 15','goto 20'),code+'\nunknown',code.replace('findframe 1, "Companion"','findframe 1, "Tommy"')])assert.equal(inspectMissionTask(altered),null);
 }
 const code=missionTaskScript(task);assert.match(code,/dim_flt 8\ndim_act 1/);assert(!code.includes('enemy_followplayer')&&!code.includes('enemy_action_follow'));
 for(const escort of [false,[],{}, {humanName:''},{humanName:'Tommy'},{humanName:'Bad"\nend'}])assert.throws(()=>missionTaskScript({...task,escort}),/Úkol/);
 for(const extra of [{targetName:'Companion'},{vehicle:{name:'Car',driverOnly:true}},{inventory:{itemId:23,atTarget:true,consume:false}}])assert.throws(()=>missionTaskScript({...task,...extra}),/Úkol/);
});
const sceneFixture=()=>({actors:[{name:'Companion',kind:27},{name:'Tommy',kind:2},{name:'Finish',kind:5},{name:'Door',kind:10}],objects:[{name:'Companion',frameType:9,model:'Human.i3d'},{name:'Tommy',frameType:9},{name:'Finish',frameType:6},{name:'Door',frameType:9}],geometry:{meshes:[]}});
test('arrival binds unique NPC and static destination without changing either, rejecting players and ambiguous scene frames',()=>{
 const scene=sceneFixture(),before=JSON.stringify(scene);assert.deepEqual(missionTaskEscortHumans(scene).map(a=>a.name),['Companion']);assert.deepEqual(resolveMissionTaskEscort(scene,{...task,escort:{humanName:'companion'},targetName:'finish'}),{escort:task.escort,targetName:'Finish'});assert.equal(JSON.stringify(scene),before);
 for(const extra of [{escort:{humanName:'Tommy'}},{escort:{humanName:'Missing'}},{targetName:'Companion'},{targetName:'Door'}])assert.throws(()=>resolveMissionTaskEscort(scene,{...task,...extra}),/Úkol/);
 const duplicate=sceneFixture();duplicate.geometry.meshes.push({name:'COMPANION',type:1});assert.equal(missionTaskEscortHumans(duplicate).length,0);
 const target=sceneFixture();target.geometry.meshes.push({name:'FINISH',type:1});assert.throws(()=>resolveMissionTaskEscort(target,task),/nepohyblivý/);
});
const chunk=(type,payload)=>{const h=Buffer.alloc(6);h.writeUInt16LE(type);h.writeUInt32LE(payload.length+6,2);return Buffer.concat([h,payload]);};
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-escort-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:2,name:'Escort',assets:[],history:[]}));const project=await ModProject.open(root),name='missions/Test/scene2.bin',textPath='tables/textdb_cz.def',geometryPath='missions/Test/scene.4ds';
 let scene=chunk(0x4c53,Buffer.concat([chunk(0x4000,Buffer.alloc(0)),chunk(0xbeef,Buffer.from('opaque sibling'))]));scene=changeSceneObject(scene,{kind:'add-human',name:'Companion',model:'Human.i3d',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1],parameters:{},code:'label 99\nwait 1000\ngoto 99'});for(const name of ['Finish','Success','Failure'])scene=changeSceneObject(scene,{kind:'add-detector',name,position:[8,0,0],mask:1,code:'wait 987\nend'});
 let text=Buffer.alloc(17);text.writeUInt32LE(1);text.writeUInt32LE(99999999,8);text.writeUInt32LE(16,12);for(const id of [10,20,30,40,50])text=addTextDbEntry(text,textPath,{id,text:'Task '+id});const geometry=Buffer.alloc(19);geometry.write('4DS\0');geometry.writeUInt16LE(29,4);geometry[18]=1;await project.createFiles([{path:name,data:scene},{path:geometryPath,data:geometry},{path:textPath,data:text}]);return{root,project,name,scene,text,textPath,geometryPath,geometry};
}
test('arrival tasks add/configure with exact export/reopen/undo while preserving NPC and other raw programs',async t=>{
 const {root,project,name,scene,text,textPath,geometry}=await fixture(t),history=project.manifest.history.length;const options={...task,flow:{onComplete:'Success'},textDb:textPath,textHash:hash(text)};
 await project.changeSceneObject(name,{kind:'add-detector',name:'Quest',position:[0,0,0],task:{...options,escort:{humanName:'companion'},targetName:'finish'}},hash(scene));const created=await project.read(name),parsed={...inspectScene(created),geometry:{meshes:[]}},recipe=editableMissionTask(parsed,'Quest');assert.deepEqual(recipe.task.escort,task.escort);assert.equal(recipe.task.targetName,'Finish');assert.equal(inspectScene(scene).actorScripts[0].code,parsed.actorScripts[0].code);assert(created.includes(Buffer.from('opaque sibling')));assert.equal(project.manifest.history.length,history+1);assert.deepEqual(project.manifest.history.at(-1).files.map(f=>f.path),[name]);assert.equal(missionLogic(parsed).nodes.find(n=>n.name==='Quest').kind,'task');
 const configured={...options,failure:{humanName:'Companion',textId:50,timeoutSeconds:30,endMission:false},flow:{onComplete:'Success',onFailure:'Failure'},targetRadius:4};await project.changeSceneObject(name,{kind:'configure-task',target:'Quest',task:configured},hash(created));const after=await project.read(name),reopened=await ModProject.open(root);await reopened.export(root+'/export');assert.deepEqual(await fs.readFile(root+'/export/'+name),after);assert.deepEqual(await fs.readFile(root+'/export/'+textPath),text);await reopened.undo();assert.deepEqual(await reopened.read(name),created);await reopened.undo();assert.deepEqual(await reopened.read(name),scene);assert.equal(reopened.manifest.history.length,history);assert.equal(geometry.length,19);
});
test('arrival publication guards target geometry and text, and rolls back without overwriting the NPC program',async t=>{
 const {project,name,scene,text,textPath,geometryPath,geometry}=await fixture(t),history=project.manifest.history.length,request={kind:'add-detector',name:'Quest',position:[0,0,0],task:{...task,textDb:textPath,textHash:hash(text)}};
 for(const escort of [{humanName:'Missing'},{humanName:'Finish'},{humanName:'Tommy'}])await assert.rejects(project.changeSceneObject(name,{...request,task:{...request.task,escort}},hash(scene)),/Úkol/);await assert.rejects(project.changeSceneObject(name,{...request,task:{...request.task,textHash:'stale'}},hash(scene)),/změnily/);
 const batch=project.changeBatch;project.changeBatch=async function(files,...args){await this.change(geometryPath,Buffer.concat([geometry,Buffer.from([1])]),'Concurrent geometry');return batch.call(this,files,...args);};await assert.rejects(project.changeSceneObject(name,request,hash(scene)),/změnil/);project.changeBatch=batch;assert.deepEqual(await project.read(name),scene);await project.undo();assert.deepEqual(await project.read(geometryPath),geometry);
 const save=project.saveManifest;project.saveManifest=async()=>{throw Error('escort publication failure');};await assert.rejects(project.changeSceneObject(name,request,hash(scene)),/escort publication/);project.saveManifest=save;assert.deepEqual(await project.read(name),scene);assert.deepEqual(await project.read(textPath),text);assert.equal(project.manifest.history.length,history);
});
