import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {missionFlow,missionFlowTargets} from '../src/shared/mission-flow.js';import {missionTaskScript} from '../src/shared/mission-task.js';import {missionDialogueScript} from '../src/shared/mission-dialogue.js';
import {ModProject} from '../src/core/project.js';import {changeSceneObject,inspectScene,editScene} from '../src/core/scene.js';import {addTextDbEntry} from '../src/core/textdb.js';import {hash,writeSafe} from '../src/core/files.js';
const task={objectiveId:10,interactionId:20,nextObjectiveId:30,completeId:40,targetName:'TARGET'},dialogue={trigger:'load',camera:false,lines:[{speaker:'NPC',textId:10}]};
const chunk=(type,data)=>{const header=Buffer.alloc(6);header.writeUInt16LE(type);header.writeUInt32LE(data.length+6,2);return Buffer.concat([header,data]);};
test('flow gates own detector without resetting an early signal and routes exclusive task outcomes using separate actor slots',()=>{
 const code=missionTaskScript({...task,failure:{humanName:'NPC',timeoutSeconds:60,textId:50},flow:{waitForSignal:true,onComplete:'NEXT',onFailure:'FAIL'}});
 assert(code.startsWith('dim_frm 2\ndim_flt 10\ndim_act 3\nwait 2000\nlabel 1\ndetector_issignal -1, 2, -1\nwait 100\ngoto 1\nlabel 2\nfindactor 1, "NEXT"\nfindactor 2, "FAIL"\nfindframe'));
 assert(code.includes('wait 4000\ndetector_setsignal 1, 1\nend\nlabel 30'));
 assert(code.endsWith('wait 4000\ndetector_setsignal 2, 1\nend'));assert(!code.includes('detector_setsignal -1'));
 assert.equal(missionFlow({onComplete:'NEXT',onFailure:'next'},{allowFailure:true}).actors,1);
 const conversation=missionDialogueScript({...dialogue,flow:{waitForSignal:true,onComplete:'NEXT'}});assert(conversation.startsWith('dim_act 2\nwait 2000\nlabel 1'));assert(conversation.includes('findactor 1, "NEXT"\nfindactor 0, "NPC"'));assert(conversation.endsWith('human_talk 0, 10\ndetector_setsignal 1, 1\nend'));
 assert.equal(missionDialogueScript(dialogue),'dim_act 1\nwait 2000\nfindactor 0, "NPC"\nhuman_talk 0, 10\nend');assert.deepEqual(missionFlow(),{actors:0,start:'',gate:'',complete:'',failure:''});
 for(const flow of [false,[],{waitForSignal:'yes'},{onComplete:''},{onComplete:'NEXT"\nend'},{onFailure:'FAIL'}])assert.throws(()=>missionTaskScript({...task,flow}),/Návaznost/);
 assert.throws(()=>missionTaskScript({...task,exitToMenu:true,flow:{onComplete:'NEXT'}}),/menu/);assert.throws(()=>missionTaskScript({...task,failure:{timeoutSeconds:1,textId:50,endMission:true},flow:{onFailure:'FAIL'}}),/koncem hry/);assert.throws(()=>missionDialogueScript({...dialogue,flow:{onFailure:'FAIL'}}),/neúspěchu/);
});
test('flow targets are unique detector actors with frame binding, including a scene overlay of geometry',()=>{
 const actors=[{kind:5,name:'NEXT'},{kind:27,name:'NPC'},{kind:5,name:'EMPTY'}],objects=[{name:'NEXT'},{name:'NPC'}];
 assert.deepEqual(missionFlowTargets({actors,objects,geometry:{meshes:[{name:'NEXT'}]}}).map(a=>a.name),['NEXT']);
 assert.deepEqual(missionFlowTargets({actors:[...actors,{kind:5,name:'next'}],objects}),[]);assert.deepEqual(missionFlowTargets({actors,objects:[...objects,{name:'next'}]}),[]);
});
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-flow-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:2,name:'Flow',assets:[],history:[]}));const p=await ModProject.open(root),name='missions/Test/scene2.bin',geometryPath='missions/Test/scene.4ds',textPath='tables/textdb_cz.def';
 let scene=chunk(0x4c53,Buffer.concat([chunk(0x4000,Buffer.alloc(0)),chunk(0xbeef,Buffer.from('opaque'))]));for(const name of ['TARGET','NEXT','FAIL'])scene=changeSceneObject(scene,{kind:'add-detector',name,position:[0,0,0],mask:1,code:'wait 123\nend'});scene=changeSceneObject(scene,{kind:'add-human',name:'NPC',model:'human.i3d',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1],parameters:{},code:'wait 456\nend'});
 const geometry=Buffer.alloc(19);geometry.write('4DS\0');geometry.writeUInt16LE(29,4);geometry[18]=1;let text=Buffer.alloc(17);text.writeUInt32LE(1);text.writeUInt32LE(99999999,8);text.writeUInt32LE(16,12);for(const id of [10,20,30,40,50])text=addTextDbEntry(text,textPath,{id,text:`Text ${id}`});
 const voice=Buffer.alloc(46);voice.write('RIFF');voice.writeUInt32LE(38,4);voice.write('WAVEfmt ',8);voice.writeUInt32LE(16,16);voice.writeUInt16LE(1,20);voice.writeUInt16LE(1,22);voice.writeUInt32LE(22050,24);voice.writeUInt32LE(44100,28);voice.writeUInt16LE(2,32);voice.writeUInt16LE(16,34);voice.write('data',36);voice.writeUInt32LE(2,40);
 await p.createFiles([{path:name,data:scene},{path:geometryPath,data:geometry},{path:textPath,data:text},{path:'sounds/00000010.wav',data:voice}]);return {p,root,name,geometryPath,textPath,scene,text,geometry,voice};
}
test('task/dialogue flow canonicalizes detector names, rejects invalid targets, ignores arbitrary code and exports/undoes exact bytes',async t=>{
 const {p,root,name,scene,textPath,text,geometryPath,geometry,voice}=await fixture(t),history=p.manifest.history.length;
 const request={kind:'add-detector',name:'QUEST',position:[0,0,0],code:'arbitrary',task:{...task,textDb:textPath,textHash:hash(text),failure:{timeoutSeconds:10,textId:50},flow:{waitForSignal:true,onComplete:'next',onFailure:'fail'}}};
 for(const target of ['NPC','MISSING','QUEST'])await assert.rejects(()=>p.changeSceneObject(name,{...request,task:{...request.task,flow:{onComplete:target}}},hash(scene)),/Návaznost/);assert.equal(p.manifest.history.length,history);assert.deepEqual(await p.read(name),scene);
 await p.changeSceneObject(name,request,hash(scene));const after=await p.read(name),parsed=inspectScene(after);assert.equal(parsed.actorScripts.find(s=>s.name==='QUEST').code,missionTaskScript({...request.task,flow:{waitForSignal:true,onComplete:'NEXT',onFailure:'FAIL'}}));for(const target of ['NEXT','FAIL','TARGET'])assert.equal(parsed.actorScripts.find(s=>s.name===target).code,'wait 123\nend');await p.undo();assert.deepEqual(await p.read(name),scene);
 await p.changeSceneObject(name,{kind:'add-detector',name:'TALK',position:[0,0,0],dialogue:{...dialogue,textDb:textPath,textHash:hash(text),soundHashes:{10:hash(voice)},flow:{waitForSignal:true,onComplete:'next'}}},hash(scene));const saved=await p.read(name);assert.equal(inspectScene(saved).actorScripts.find(s=>s.name==='TALK').code,missionDialogueScript({...dialogue,flow:{waitForSignal:true,onComplete:'NEXT'}}));
 const reopened=await ModProject.open(root);await reopened.export(path.join(root,'export'));assert.deepEqual(await fs.readFile(path.join(root,'export',name)),saved);await reopened.undo();assert.deepEqual(await reopened.read(name),scene);assert.deepEqual(await reopened.read(textPath),text);assert.deepEqual(await reopened.read(geometryPath),geometry);assert.equal(reopened.manifest.history.length,history);
});
test('flow link creation protects the current scene and rolls back failed publication',async t=>{
 const {p,name,scene,textPath,text}=await fixture(t),request={kind:'add-detector',name:'QUEST',position:[0,0,0],task:{...task,textDb:textPath,textHash:hash(text),flow:{onComplete:'NEXT'}}};
 const actorKind=inspectScene(scene).entries.find(entry=>entry.label==='Typ aktéra'&&entry.context.endsWith('/ NEXT'));const changed=editScene(scene,actorKind.id,6);await p.change(name,changed,'Concurrent target type change');await assert.rejects(()=>p.changeSceneObject(name,request,hash(scene)),/změnil/);await p.undo();assert.deepEqual(await p.read(name),scene);
 const original=JSON.stringify(p.manifest);p.saveManifest=async()=>{throw new Error('publish failed');};await assert.rejects(()=>p.changeSceneObject(name,request,hash(scene)),/publish failed/);assert.deepEqual(await p.read(name),scene);assert.equal(JSON.stringify(p.manifest),original);
});
