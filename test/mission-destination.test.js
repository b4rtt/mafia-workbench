import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ModProject } from '../src/core/project.js';
import { hash, writeSafe } from '../src/core/files.js';
import { changeSceneObject, inspectScene, editScene } from '../src/core/scene.js';
import { missionTaskScript } from '../src/shared/mission-task.js';
import { missionDestinations } from '../src/shared/mission-destinations.js';
import { collisionFixture } from './fixtures/collision.js';
const task={objectiveId:10,interactionId:20,nextObjectiveId:30,completeId:40,targetName:'DESTINATION',targetRadius:3};
const chunk=(type,data)=>{const h=Buffer.alloc(6);h.writeUInt16LE(type);h.writeUInt32LE(data.length+6,2);return Buffer.concat([h,data]);};
const geometry=()=>{const b=Buffer.alloc(19);b.write('4DS\0');b.writeUInt16LE(29,4);b[18]=1;return b;};
function playerScene(){let s=changeSceneObject(chunk(0x4c53,chunk(0x4000,Buffer.alloc(0))),{kind:'add-human',name:'Tommy',model:'human.i3d',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1],parameters:{},code:'wait 777\nend'});const entry=inspectScene(s).entries.find(e=>e.label==='Typ aktéra'&&e.context.endsWith('/ Tommy'));return editScene(s,entry.id,2);}
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-destination-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:2,name:'Transition',assets:[],history:[]}));const p=await ModProject.open(root),name='missions/Current/scene2.bin',next='missions/Next/scene2.bin';
 const scene=changeSceneObject(chunk(0x4c53,Buffer.concat([chunk(0x4000,Buffer.alloc(0)),chunk(0xbeef,Buffer.from('unknown'))])),{kind:'add-detector',name:'DESTINATION',position:[0,0,0],mask:0,code:'wait 321\nend'}),text=Buffer.alloc(49);text.writeUInt32LE(5);for(const [i,id]of [10,20,30,40,99999999].entries()){text.writeUInt32LE(id,8+i*8);text.writeUInt32LE(48,12+i*8);}
 await p.createFiles([{path:name,data:scene},{path:'missions/Current/scene.4ds',data:geometry()},{path:'missions/Current/tree.klz',data:collisionFixture()},{path:next,data:playerScene()},{path:'MISSIONS/NEXT/scene.4ds',data:geometry()},{path:'missions/Next/tree.klz',data:collisionFixture()},{path:'tables/textdb_cz.def',data:text}]);
 const dest=await p.missionDestination('next'),request={kind:'add-detector',name:'QUEST',position:[0,0,0],mask:128,code:'untrusted',task:{...task,nextMission:'next',nextMissionHashes:dest.hashes,textDb:'tables/textdb_cz.def',textHash:hash(text)}};return {p,root,name,next,scene,request,dest};
}
test('native mission change is only on success, uses an empty entry for fresh initialization and excludes conflicting endings',()=>{
 const code=missionTaskScript({...task,nextMission:'NEXT',failure:{timeoutSeconds:5,textId:50}});assert(code.includes('console_addtext 40\nwait 4000\nchange_mission "NEXT", "", -1\nend\nlabel 30'));assert.equal(code.split('change_mission').length,2);assert(!code.slice(code.indexOf('label 30')).includes('change_mission'));assert(!missionTaskScript(task).includes('change_mission'));
 for(const nextMission of [false,{},'', ' ../NEXT','../NEXT','A/B','A\\B','A"','A\nB','A '.repeat(35),'Žižkov','wbtest','nul', 'A'.repeat(64)])assert.throws(()=>missionTaskScript({...task,nextMission}),/další mise/);
 assert(missionTaskScript({...task,nextMission:'A'.repeat(63)}).includes('change_mission'));
 for(const extra of [{exitToMenu:true},{flow:{onComplete:'FOLLOW'}}])assert.throws(()=>missionTaskScript({...task,nextMission:'NEXT',...extra}),/kombinovat/);
});
test('destination list resolves mixed case, excludes current/reserved/missing mission parts, and sorts folders',()=>{
 const paths=['missions/Current/scene2.bin','MISSIONS/CURRENT/scene.4ds','missions/current/tree.klz','missions/Next/scene2.bin','MISSIONS/NEXT/scene.4ds','missions/next/tree.klz','missions/Missing/scene2.bin','missions/wbtest/scene2.bin','missions/wbtest/scene.4ds','missions/wbtest/tree.klz','missions/Bad.name/scene2.bin','missions/Bad.name/scene.4ds','missions/Bad.name/tree.klz'];assert.deepEqual(missionDestinations(paths.map(path=>({path})),'missions/CURRENT/scene2.bin'),['Next']);
});
test('task checks native target data, protects versions and preserves destination bytes through export, reopen and undo',async t=>{
 const {p,root,name,next,scene,request,dest}=await fixture(t),history=p.manifest.history.length,originals=new Map();for(const filename of Object.keys(dest.hashes))originals.set(filename,await p.read(filename));assert.equal(dest.name,'Next');assert(!('files' in dest));
 await assert.rejects(()=>p.missionDestination('CURRENT'),/hráče Tommy/);
 for(const extra of [{nextMission:'Current'},{nextMission:'Missing'},{nextMissionHashes:{}},{nextMissionHashes:{...dest.hashes,[next]:'stale'}}])await assert.rejects(()=>p.changeSceneObject(name,{...request,task:{...request.task,...extra}},hash(scene)));
 assert.equal(p.manifest.history.length,history);await p.changeSceneObject(name,request,hash(scene));const after=await p.read(name),parsed=inspectScene(after);assert.equal(parsed.actorScripts.find(s=>s.name==='QUEST').code,missionTaskScript({...task,nextMission:'Next'}));assert.equal(parsed.actorScripts.find(s=>s.name==='DESTINATION').code,'wait 321\nend');assert.equal(parsed.entries.filter(e=>e.detectorParameter).at(-1).value,1);assert.equal(p.manifest.history.length,history+1);
 const reopened=await ModProject.open(root);await reopened.export(path.join(root,'export'));assert.deepEqual(await fs.readFile(path.join(root,'export',name)),after);for(const [filename,before]of originals){assert.deepEqual(await reopened.read(filename),before);assert.deepEqual(await fs.readFile(path.join(root,'export',filename)),before);}await reopened.undo();assert.deepEqual(await reopened.read(name),scene);assert.equal(reopened.manifest.history.length,history);
 const npc=playerScene(),entry=inspectScene(npc).entries.find(e=>e.label==='Typ aktéra'&&e.context.endsWith('/ Tommy'));await reopened.change(next,editScene(npc,entry.id,27),'NPC instead of player');await assert.rejects(()=>reopened.missionDestination('Next'),/hráče Tommy/);await reopened.undo();
});
test('concurrent target edits and publication failure leave task absent and destination unchanged except the independent edit',async t=>{
 const {p,name,next,scene,request}=await fixture(t),before=await p.read(next),batch=p.changeBatch,history=p.manifest.history.length;p.changeBatch=async function(files,...args){await this.change(next,Buffer.concat([before,chunk(0xbeef,Buffer.from('concurrent'))]),'Independent target edit');return batch.call(this,files,...args);};await assert.rejects(()=>p.changeSceneObject(name,request,hash(scene)),/změnil/);assert.deepEqual(await p.read(name),scene);p.changeBatch=batch;await p.undo();assert.deepEqual(await p.read(next),before);assert.equal(p.manifest.history.length,history);
 const manifest=JSON.stringify(p.manifest);p.saveManifest=async()=>{throw new Error('publish failed');};await assert.rejects(()=>p.changeSceneObject(name,request,hash(scene)),/publish failed/);assert.deepEqual(await p.read(name),scene);assert.deepEqual(await p.read(next),before);assert.equal(JSON.stringify(p.manifest),manifest);
});
