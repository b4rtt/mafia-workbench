import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ModProject } from '../src/core/project.js';
import { hash, writeSafe } from '../src/core/files.js';
import { changeSceneObject, inspectScene, editScene, editSceneSectorBindings } from '../src/core/scene.js';
import { missionChoicePrograms, choiceControllerGroups, editableMissionChoice, resolveMissionChoiceEdit } from '../src/shared/mission-choice.js';
import { addTextDbEntry } from '../src/core/textdb.js';
const chunk=(type,data)=>{const h=Buffer.alloc(6);h.writeUInt16LE(type);h.writeUInt32LE(data.length+6,2);return Buffer.concat([h,data]);};
const name='missions/Test/scene2.bin',geometryPath='missions/Test/scene.4ds',textPath='tables/textdb_cz.def';
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-choice-edit-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:2,name:'Choice edit',assets:[],history:[]}));const p=await ModProject.open(root);
 let scene=chunk(0x4c53,Buffer.concat([chunk(0x4000,Buffer.alloc(0)),chunk(0xbeef,Buffer.from('opaque'))]));
 for(const npc of ['NPC','OtherNPC','BusyNPC'])scene=changeSceneObject(scene,{kind:'add-human',name:npc,model:'human.i3d',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1],parameters:{},code:npc==='BusyNPC'?'wait 10\nend':'end'});
 for(const target of ['Yes','No','Third'])scene=changeSceneObject(scene,{kind:'add-detector',name:target,mask:0,position:[1,0,0],code:'label 1\nwait 100\ngoto 1'});
 const geometry=Buffer.alloc(19);geometry.write('4DS\0');geometry.writeUInt16LE(29,4);geometry[18]=1;let text=Buffer.alloc(17);text.writeUInt32LE(1);text.writeUInt32LE(99999999,8);text.writeUInt32LE(16,12);for(const id of [10,20,30,40])text=addTextDbEntry(text,textPath,{id,text:'Answer '+id});
 await p.createFiles([{path:name,data:scene},{path:geometryPath,data:geometry},{path:textPath,data:text}]);
 const options={controller:'NPC',waitForSignal:true,answers:[{textId:10,target:'Yes'},{textId:20,target:'No'},{textId:30,target:'Third'}]},add=async(owner,extra={})=>p.changeSceneObject(name,{kind:'add-choice',name:owner,position:[2,3,4],choice:{...options,...extra,textDb:textPath,textHash:hash(text)}},hash(await p.read(name)));
 await add('CHOICE');return {p,root,text,geometry,add,options,edit:async(choice,extra={})=>p.changeSceneObject(name,{kind:'configure-choice',target:'CHOICE',name:'Ignored',code:'Ignored',mask:128,position:[99,99,99],choice:{...options,...choice,textDb:textPath,textHash:hash(text)},...extra},hash(await p.read(name)))};
}
test('choice recovery requires whole groups, accepts CRLF, selects helper and rejects custom programs and masks',async t=>{
 const {p}=await fixture(t),source=await p.read(name),scene=await p.inspectMap(name),current=editableMissionChoice(scene,'choice_answer2');assert.equal(current.choice.name,'CHOICE');assert.equal(current.choice.waitForSignal,true);assert.deepEqual(current.choice.answers.map(a=>a.textId),[10,20,30]);
 let crlf=source;for(const entry of scene.entries.filter(e=>e.actorScript&&(/^CHOICE/.test(e.value.name)||e.value.name==='NPC')))crlf=editScene(crlf,entry.id,{...entry.value,code:entry.value.code.replaceAll('\n','\r\n')});assert(editableMissionChoice(inspectScene(crlf),'CHOICE_CLAIM'));
 for(const entry of current.nodes){const changed=editScene(source,entry.entry.id,{...entry.entry.value,code:entry.entry.value.code+'\n// custom'});assert.equal(editableMissionChoice(inspectScene(changed),'CHOICE'),null);}
 const mask=scene.entries.find(e=>e.detectorParameter&&e.id.startsWith(current.nodes[1].entry.id+'/')===false&&e.context.endsWith('/ CHOICE_CLAIM'));assert(mask);assert.equal(editableMissionChoice(inspectScene(editScene(source,mask.id,1)),'CHOICE'),null);
 const npc=scene.entries.find(e=>e.actorScript&&e.value.name==='NPC');assert.equal(editableMissionChoice(inspectScene(editScene(source,npc.id,{...npc.value,code:npc.value.code+'\nwait 10'})),'CHOICE'),null);
});
test('choice editing reorders answers, changes targets and signal, preserves other data and exact CRLF no-op/export/reopen/undo',async t=>{
 const {p,root,edit,text,geometry}=await fixture(t),source=await p.read(name),before=inspectScene(source),history=p.manifest.history.length;
 await edit({waitForSignal:false,answers:[{textId:30,target:'no'},{textId:20,target:'third'},{textId:10,target:'yes'}]});const after=await p.read(name),parsed=inspectScene(after),current=editableMissionChoice(await p.inspectMap(name),'CHOICE');assert.equal(current.choice.waitForSignal,false);assert.deepEqual(current.choice.answers,[{textId:30,target:'No'},{textId:20,target:'Third'},{textId:10,target:'Yes'}]);assert.deepEqual(parsed.objects,before.objects);assert.deepEqual(parsed.entries.filter(e=>!e.actorScript),before.entries.filter(e=>!e.actorScript));assert.equal(p.manifest.history.length,history+1);assert.deepEqual(p.manifest.history.at(-1).files.map(f=>f.path),[name]);assert(after.includes(Buffer.from('opaque')));assert.deepEqual(await p.read(textPath),text);assert.deepEqual(await p.read(geometryPath),geometry);
 await edit(current.choice);assert.equal(p.manifest.history.length,history+1);const reopened=await ModProject.open(root);await reopened.export(root+'/export');assert.deepEqual(await fs.readFile(root+'/export/'+name),after);assert(editableMissionChoice(await reopened.inspectMap(name),'CHOICE_ANSWER1'));await reopened.undo();assert.deepEqual(await reopened.read(name),source);
 let crlf=source;for(const entry of before.entries.filter(e=>e.actorScript&&/^CHOICE/.test(e.value.name)))crlf=editScene(crlf,entry.id,{...entry.value,code:entry.value.code.replaceAll('\n','\r\n')});await p.change(name,crlf,'CRLF');const length=p.manifest.history.length;await edit(editableMissionChoice(await p.inspectMap(name),'CHOICE').choice);assert.deepEqual(await p.read(name),crlf);assert.equal(p.manifest.history.length,length);
});
test('choice resize and controller transfer update numeric events of subsequent groups and preserve their frames/recipes',async t=>{
 const {p,add,edit}=await fixture(t);await add('SECOND');await add('THIRDSET');await add('OTHER',{controller:'OtherNPC'});const source=await p.read(name),before=inspectScene(source),originals=new Map(['SECOND','THIRDSET','OTHER'].map(owner=>[owner,editableMissionChoice(before,owner).choice]));
 await edit({answers:[{textId:10,target:'Yes'},{textId:20,target:'No'},{textId:30,target:'Third'},{textId:40,target:'No'}]});let scene=await p.inspectMap(name);assert.equal(editableMissionChoice(scene,'CHOICE').choice.answers.length,4);assert(scene.actorScripts.find(s=>s.name==='NPC').code.includes('enemy_use_detector 9'));assert.deepEqual(editableMissionChoice(scene,'SECOND').choice,originals.get('SECOND'));await p.undo();
 await edit({controller:'OtherNPC',answers:[{textId:40,target:'Third'},{textId:20,target:'Yes'}],waitForSignal:false});scene=await p.inspectMap(name);assert.deepEqual(choiceControllerGroups(scene.actorScripts.find(s=>s.name==='NPC').code).map(g=>g.owner),['SECOND','THIRDSET']);assert.deepEqual(choiceControllerGroups(scene.actorScripts.find(s=>s.name==='OtherNPC').code).map(g=>g.owner),['OTHER','CHOICE']);assert.equal(editableMissionChoice(scene,'CHOICE').choice.controller,'OtherNPC');assert(!scene.actors.some(a=>a.name==='CHOICE_ANSWER3'));assert(scene.actorScripts.find(s=>s.name==='CHOICE_ANSWER1').code.includes('setevent 1, 1001, -1'));assert(scene.actorScripts.find(s=>s.name==='SECOND_ANSWER1').code.includes('setevent 1, 1000, -1'));for(const owner of originals.keys())assert.deepEqual(editableMissionChoice(scene,owner).choice,originals.get(owner));for(const object of before.objects.filter(o=>!o.name.startsWith('CHOICE')))assert.deepEqual(scene.objects.find(o=>o.name===object.name),{...object,id:scene.objects.find(o=>o.name===object.name).id,fields:scene.objects.find(o=>o.name===object.name).fields});await p.undo();assert.deepEqual(await p.read(name),source);
});
test('last group may move to another NPC and leave its old NPC active and reusable; a full controller is editable',async t=>{
 const {p,add,edit}=await fixture(t);await edit({controller:'OtherNPC'});let scene=await p.inspectMap(name);assert.equal(scene.actorScripts.find(s=>s.name==='NPC').code,'label 1\nwait 1000\ngoto 1');await add('NEW');assert(editableMissionChoice(await p.inspectMap(name),'NEW'));await p.undo();await p.undo();for(let i=1;i<16;i++)await add('SET'+i);scene=await p.inspectMap(name);assert(editableMissionChoice(scene,'CHOICE'));const history=p.manifest.history.length;await edit({waitForSignal:false});assert.equal(p.manifest.history.length,history+1);assert.equal(editableMissionChoice(await p.inspectMap(name),'CHOICE').choice.waitForSignal,false);
});
test('new answers use the activation world position while existing frames and parents remain unchanged',async t=>{
 const {p,edit,options}=await fixture(t),scene=await p.inspectMap(name),owner=scene.objects.find(o=>o.name==='CHOICE');
 const nested=editSceneSectorBindings(await p.read(name),owner.id,{parent:'Yes',transform:{position:[2,3,4],rotation:[1,0,0,0],scale:[1,1,1]}});
 await p.change(name,nested,'Parented choice');const before=inspectScene(nested);
 await edit({answers:[...options.answers,{textId:40,target:'No'}]});const after=await p.inspectMap(name),added=after.objects.find(o=>o.name==='CHOICE_ANSWER4');
 assert.deepEqual(added.position,[3,3,4]);assert.deepEqual(added.worldPosition,[3,3,4]);assert.equal(added.parent,'Primary sector');
 for(const original of before.objects)assert.deepEqual(after.objects.find(o=>o.name===original.name),original);
 await p.undo();assert.deepEqual(await p.read(name),nested);
});
test('choice editing rejects custom related groups, missing bindings, conflicts, stale data, foreign references and opaque answer data',async t=>{
 const {p,edit,options,add}=await fixture(t),source=await p.read(name),history=p.manifest.history.length;
 for(const extra of [{controller:'BusyNPC'},{answers:[{textId:99999999,target:'Yes'},options.answers[1]]},{answers:[{textId:10,target:'CHOICE'},options.answers[1]]},{answers:[options.answers[0],options.answers[0]]},{answers:[{textId:10,target:'Missing'},options.answers[1]]}])await assert.rejects(edit(extra),/Volba/);
 await assert.rejects(edit({}, {dialogue:{}}),/jednu šablonu/);await assert.rejects(edit({}, {target:'No'}),/nezměněnou/);await assert.rejects(edit({}, {choice:{...options,textDb:textPath,textHash:'stale'}}),/změnily/);assert.equal(p.manifest.history.length,history);
 const reduced={answers:options.answers.slice(0,2)};
 for(const file of ['missions/Test/cache.bin','records/custom.rep']){await p.createFiles([{path:file,data:Buffer.from('ref CHOICE_ANSWER3')}]);await assert.rejects(edit(reduced),/odkazuje/);await p.undo();}
 const entry=inspectScene(source).entries.find(e=>e.actorScript&&e.value.name==='Yes');await p.change(name,editScene(source,entry.id,{...entry.value,code:'findactor 0, "CHOICE_ANSWER3"\nend'}),'Foreign ref');await assert.rejects(edit(reduced),/odkazuje/);await p.undo();
 // Append opaque data inside the removable actor. Its program still recovers,
 // but structural deletion must refuse losing the extra payload.
 const script=editableMissionChoice(inspectScene(source),'CHOICE').nodes[4].entry;const parts=script.id.split('/').map(Number);
 function append(nodes,prefix=[]){let at=0,index=0,out=[];while(at<nodes.length){const type=nodes.readUInt16LE(at),size=nodes.readUInt32LE(at+2),raw=nodes.subarray(at,at+size),id=[...prefix,index];if(id.every((v,i)=>v===parts[i])){let payload=raw.subarray(6);payload=id.length===parts.length?Buffer.concat([payload,Buffer.from('opaque-tail')]):append(payload,id);out.push(chunk(type,payload));}else out.push(raw);at+=size;index++;}return Buffer.concat(out);}
 await p.change(name,append(source),'Opaque answer');assert(editableMissionChoice(await p.inspectMap(name),'CHOICE'));await assert.rejects(edit(reduced),/neznámá data/);await p.undo();await add('SECOND');let scene=await p.inspectMap(name);const changed=scene.entries.find(e=>e.actorScript&&e.value.name==='SECOND_ANSWER1');await p.change(name,editScene(await p.read(name),changed.id,{...changed.value,code:changed.value.code+'\n// custom'}),'Custom second');await assert.rejects(edit({waitForSignal:false}),/jiná skupina/);await p.undo();await p.undo();assert.deepEqual(await p.read(name),source);
});
test('choice edits guard text, geometry and removed-node dependencies and roll back failed publication',async t=>{
 const {p,edit,options}=await fixture(t),source=await p.read(name),history=p.manifest.history.length,batch=p.changeBatch;
 for(const file of [textPath,geometryPath]){const original=await p.read(file);p.changeBatch=async function(files,...args){await this.change(file,Buffer.concat([original,Buffer.from([1])]),'Concurrent');return batch.call(this,files,...args);};await assert.rejects(edit({waitForSignal:false}),/změnil/);assert.deepEqual(await p.read(name),source);p.changeBatch=batch;await p.undo();}
 const file='missions/Test/cache.bin';await p.createFiles([{path:file,data:Buffer.from('No references')}]);const original=await p.read(file);p.changeBatch=async function(files,...args){await this.change(file,Buffer.from('CHOICE_ANSWER3'),'Concurrent reference');return batch.call(this,files,...args);};await assert.rejects(edit({answers:options.answers.slice(0,2)}),/změnil/);assert.deepEqual(await p.read(name),source);p.changeBatch=batch;await p.undo();assert.deepEqual(await p.read(file),original);await p.undo();
 const save=p.saveManifest;p.saveManifest=async()=>{throw Error('Choice edit publication failed');};await assert.rejects(edit({waitForSignal:false}),/publication failed/);p.saveManifest=save;assert.deepEqual(await p.read(name),source);assert.equal(p.manifest.history.length,history);
});

test('removing an answer checks more than 64 reference files without including them in the written batch',async t=>{
 const {p,edit,options}=await fixture(t),files=Array.from({length:80},(_,i)=>({path:`records/record${i}.rep`,data:Buffer.from('Unrelated record '+i)}));
 for(let i=0;i<files.length;i+=40)await p.createFiles(files.slice(i,i+40));
 const source=await p.read(name),history=p.manifest.history.length;await edit({answers:options.answers.slice(0,2)});assert.equal(p.manifest.history.length,history+1);assert.deepEqual(p.manifest.history.at(-1).files.map(f=>f.path),[name]);await p.undo();assert.deepEqual(await p.read(name),source);
 const batch=p.changeBatch;p.changeBatch=async function(rows,...args){await this.change(files.at(-1).path,Buffer.from('CHOICE_ANSWER3'),'Concurrent record');return batch.call(this,rows,...args);};await assert.rejects(edit({answers:options.answers.slice(0,2)}),/změnil/);p.changeBatch=batch;assert.deepEqual(await p.read(name),source);await p.undo();
});
