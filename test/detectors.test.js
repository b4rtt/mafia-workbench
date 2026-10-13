import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createDetector,detectorScriptLayout,editDetectorMask} from '../src/core/detectors.js';
import {proximityDetectorScript} from '../src/shared/detectors.js';
import {inspectScene,editScene,changeSceneObject} from '../src/core/scene.js';
import {groupSceneProperties} from '../src/shared/scene-properties.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';
const chunk=(type,data)=>{const h=Buffer.alloc(6);h.writeUInt16LE(type);h.writeUInt32LE(data.length+6,2);return Buffer.concat([h,data]);};
const opaque=chunk(0xbabe,Buffer.from('preserve opaque sibling')),scene=chunk(0x4c53,Buffer.concat([chunk(0x4000,Buffer.alloc(0)),opaque]));
const request={kind:'add-detector',name:'WB_TRIGGER',position:[7,3,9],mask:129,code:proximityDetectorScript(5,'// vlastní akce\nwait 123')};

test('detector v1 uses the full uint32 human mask and preserves all program and tail bytes on mask edits',()=>{
  const data=Buffer.concat([createDetector('wait 1\n// český komentář',129),Buffer.from([0xfe,0xab])]);
  assert.deepEqual(detectorScriptLayout(data),{lengthOffset:10,codeStart:14,length:24});assert.equal(data.readUInt32LE(1),129);assert.equal(data[0],1);assert.equal(data[5],1);
  for(const mask of [0,1,3,4,8,16,128,129,4294967295]){const changed=editDetectorMask(data,mask);assert.equal(changed.readUInt32LE(1),mask);assert.deepEqual(changed.subarray(5),data.subarray(5));assert.equal(changed[0],data[0]);assert.deepEqual(editDetectorMask(changed,129),data);}
  for(const mask of [-1,4294967296,.5,NaN,'1',true])assert.throws(()=>createDetector('end',mask),/maska/);
  for(const code of [null,'nul\0','emoji 🐱','x'.repeat(1000001)])assert.throws(()=>createDetector(code),/Detektor/);
  for(const offset of [0,5]){const bytes=Buffer.from(data);bytes[offset]=0;assert.equal(detectorScriptLayout(bytes),null);assert.throws(()=>editDetectorMask(bytes,1),/nepodporovaná/);}
  const truncated=Buffer.from(data);truncated.writeUInt32LE(1000000,10);assert.equal(detectorScriptLayout(truncated),null);
});

test('new detector creates one dummy and one script actor, exposes nonboolean masks, and preserves existing scripts and opaque chunks',()=>{
  const added=changeSceneObject(scene,request),file=inspectScene(added),object=file.objects[0],mask=file.entries.find(e=>e.detectorParameter),script=file.entries.find(e=>e.actorScript);
  assert.equal(object.frameType,6);assert.deepEqual(object.position,request.position);assert.equal(object.parent,'Primary sector');assert.equal(object.actorBound,true);assert.equal(object.model,undefined);
  assert.equal(mask.value,129);assert.deepEqual(script.value,{name:request.name,code:request.code});assert.ok(added.includes(opaque));
  const group=groupSceneProperties(file).find(g=>g.name===request.name);assert.ok(group.entries.some(e=>e.entry.id===mask.id));assert.ok(group.entries.some(e=>e.entry.id===script.id));
  const changed=editScene(added,mask.id,3);assert.equal(inspectScene(changed).actorScripts[0].code,request.code);assert.deepEqual(editScene(changed,mask.id,129),added);
  const edited=editScene(changed,script.id,{name:request.name,code:'end'});assert.equal(inspectScene(edited).entries.find(e=>e.detectorParameter).value,3);
  const second=changeSceneObject(added,{...request,name:'SECOND',mask:0,code:'wait 50'});assert.deepEqual(inspectScene(second).actorScripts,[...file.actorScripts,{name:'SECOND',code:'wait 50'}]);assert.ok(second.includes(createDetector(request.code,request.mask)));
  assert.throws(()=>changeSceneObject(added,{...request,name:'wb_trigger'}),/již existuje/);assert.throws(()=>changeSceneObject(scene,request,['WB_TRIGGER']),/již existuje/);
  for(const position of [[0,0],[NaN,0,0],[1e100,0,0],[,0,0]])assert.throws(()=>changeSceneObject(scene,{...request,position}),/pozice/);
});

test('proximity template counts matching humans, yields while waiting, and reserves its control labels',()=>{
  const script=proximityDetectorScript(2.5,'wait 500');assert.ok(script.includes('detector_inrange 0, 2.5\nif flt[0] > 0, 20, -1\nwait 100\ngoto 10\nlabel 20\nwait 500\nend'));
  for(const radius of [0,-1,NaN,Infinity,1e100,1e-100,'3'])assert.throws(()=>proximityDetectorScript(radius),/poloměr/);
  assert.throws(()=>proximityDetectorScript(3,'label 10\nwait 5'),/label/);assert.throws(()=>proximityDetectorScript(3,'LABEL 20\nwait 5'),/label/);
  assert.ok(proximityDetectorScript(3,'label 100\nwait 5').includes('label 100'));
  assert.ok(proximityDetectorScript(3,'// label 10 je rezervovaný').includes('// label 10'));
});

test('project detector creation and simultaneous script/mask edits reopen, export and undo exact scenes',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-detector-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Detectors',assets:[],history:[]}));
  const p=await ModProject.open(root),name='missions/Test/scene2.bin',geometry=Buffer.alloc(19);geometry.write('4DS\0');geometry.writeUInt16LE(29,4);geometry[18]=1;
  await p.createFiles([{path:name,data:scene},{path:'missions/Test/scene.4ds',data:geometry}]);const history=p.manifest.history.length;
  await assert.rejects(p.changeSceneObject(name,request,'stale'),/změnil/);await p.changeSceneObject(name,request,hash(scene));const added=await p.read(name),file=inspectScene(added),mask=file.entries.find(e=>e.detectorParameter),script=file.entries.find(e=>e.actorScript);assert.equal(p.manifest.history.length,history+1);
  await p.saveScene(name,[{id:script.id,value:{name:request.name,code:'wait 1234'}},{id:mask.id,value:3}],hash(added));const changed=await p.read(name),reopened=await ModProject.open(root),parsed=inspectScene(changed);assert.equal(parsed.entries.find(e=>e.detectorParameter).value,3);assert.equal(parsed.actorScripts[0].code,'wait 1234');assert.deepEqual(await reopened.read(name),changed);
  const destination=path.join(root,'export');await reopened.export(destination);assert.deepEqual(await fs.readFile(path.join(destination,name)),changed);assert.deepEqual(await reopened.read('missions/Test/scene.4ds'),geometry);
  await reopened.undo();assert.deepEqual(await reopened.read(name),added);await reopened.undo();assert.deepEqual(await reopened.read(name),scene);assert.equal(reopened.manifest.history.length,history);
});

test('detector creation rejects concurrent geometry changes and rolls back a failed publication',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-detector-stale-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Detectors',assets:[],history:[]}));
  const p=await ModProject.open(root),name='missions/Test/scene2.bin',geometryPath='missions/Test/scene.4ds',geometry=Buffer.alloc(19);geometry.write('4DS\0');geometry.writeUInt16LE(29,4);geometry[18]=1;
  await p.createFiles([{path:name,data:scene},{path:geometryPath,data:geometry}]);const history=p.manifest.history.length,batch=p.changeBatch;
  p.changeBatch=async function(files,...rest){await this.change(geometryPath,Buffer.concat([geometry,Buffer.from([0])]),'Concurrent geometry');return batch.call(this,files,...rest);};
  await assert.rejects(p.changeSceneObject(name,request,hash(scene)),/změnil/);assert.deepEqual(await p.read(name),scene);assert.equal(p.manifest.history.length,history+1);p.changeBatch=batch;await p.undo();assert.deepEqual(await p.read(geometryPath),geometry);
  const save=p.saveManifest;p.saveManifest=async()=>{throw new Error('simulated publication failure');};await assert.rejects(p.changeSceneObject(name,request,hash(scene)),/simulated/);p.saveManifest=save;assert.deepEqual(await p.read(name),scene);assert.equal(p.manifest.history.length,history);
});
