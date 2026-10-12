import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import { inspectReplay, editReplay } from '../src/core/replay.js';
import { ReplayViewport, sampleReplayPath, replayPathSegments } from '../src/ui/replay.js';
import { ModProject } from '../src/core/project.js';
import { hash, writeSafe } from '../src/core/files.js';
function fixture(type=1) {
  const names=Buffer.alloc(60,0xcd);names.writeUInt32LE(1);names.writeUInt32LE(256,4);names.writeUInt32LE(0,8);names.write('walk.i3d\0',12,'ascii');
  const object=Buffer.alloc(108,0xcd);object.write('Tommy\0');object.write('hum0\0',36);[8,40,44,56,0,50,27,8+[8,40,44,56][type],0].forEach((v,i)=>object.writeUInt32LE(v,72+i*4));
  const keys=Buffer.alloc(8+[8,40,44,56][type]);keys.writeUInt32LE(50,8);keys.writeUInt32LE(type,12);[-0,2,-3,1,0,0,0].forEach((v,i)=>keys.writeFloatLE(v,16+i*4));keys.writeUInt32LE(50176,44);
  const cameras=Buffer.alloc(3*64,0);for(let i=0;i<3;i++){const s=i*64;cameras.writeUInt32LE(i*100,s);cameras.writeUInt32LE(i*100,s+4);cameras.writeUInt32LE(1,s+8);[i*10,3,-8].forEach((v,j)=>cameras.writeFloatLE(v,s+12+j*4));cameras.writeFloatLE(i===2?666:Math.PI/3,s+52);}
  const focus=Buffer.alloc(2*56);for(let i=0;i<2;i++){const s=i*56;focus.writeUInt32LE(i*200,s);focus.writeUInt32LE(i*200,s+4);focus.writeUInt32LE(1,s+8);[1+i*4,2+i*4,3+i*4].forEach((v,j)=>focus.writeFloatLE(v,s+12+j*4));}
  const events=Buffer.alloc(16+80+40,0xcd);[0,0,80,40].forEach((v,i)=>events.writeUInt32LE(v,i*4));for(let i=0;i<2;i++){events.writeUInt32LE(50+i*100,16+i*40);events.write(`Script${i?'B':'A'}\0`,20+i*40);}events.writeUInt32LE(250,96);events.writeUInt32LE(0,100);events.write('tone.wav\0',104);
  const states=Buffer.alloc(12+36+12+44,0xcd);[1,1,1].forEach((v,i)=>states.writeUInt32LE(v,i*4));states.writeUInt32LE(125,12);states.writeUInt32LE(2,16);states.writeUInt32LE(123,20);states.write('Speaker\0',24);[140,2,456].forEach((v,i)=>states.writeUInt32LE(v,48+i*4));states.writeUInt32LE(200,60);states.writeUInt32LE(300,64);states.write('Tommy\0',68);
  const header=Buffer.alloc(96);[0x1631,names.length,keys.length,1,0xcccccccc,3,2,events.length,states.length].forEach((v,i)=>header.writeUInt32LE(v,i*4));return Buffer.concat([header,names,object,keys,cameras,focus,events,states,Buffer.from([0xfa,0xfd,0xab])]);
}
test('REP reads actual section sizes, per-track strides, camera stop key and replay event arrays',()=>{
  const bytes=fixture(),file=inspectReplay(bytes);assert.equal(file.duration,300);assert.equal(file.tracks[0].keys.length,1);assert.deepEqual(file.tracks[0].keys[0].position,[-0,2,-3]);assert.equal(file.cameras.length,3);assert.equal(file.focus.length,2);assert.equal(file.cameras[2].stop,true);assert.ok(!file.entries.some(e=>e.id==='camera/2/fov'));assert.equal(file.events.subtitles.length,1);assert.equal(file.events.morphs[0].end,300);assert.equal(file.tailBytes,3);
  assert.deepEqual(editReplay(bytes,file.entries.map(e=>({id:e.id,value:e.value}))),bytes);
  const special=fixture(3),specialFile=inspectReplay(special);assert.deepEqual(specialFile.tracks[0].keys[0].position,[-0,2,-3]);const changed=editReplay(special,[{id:'objects/0/0/position',value:[0,4,-3]}]);assert.deepEqual(editReplay(changed,[{id:'objects/0/0/position',value:specialFile.tracks[0].keys[0].position}]),special);
});
test('REP edits only recognized spans and leaves all sizes, types, padding and opaque tails intact',()=>{
  const bytes=fixture(),before=Buffer.from(bytes),file=inspectReplay(bytes),changes=[{id:'camera/1/position',value:[12,3,-8]},{id:'camera/1/fov',value:1},{id:'objects/0/0/position',value:[0,5,-3]},{id:'scripts/0/name',value:'Startxx'},{id:'scripts/0/time',value:75},{id:'dialogues/0/textId',value:987}];
  const edited=editReplay(bytes,changes);assert.equal(edited.length,bytes.length);assert.deepEqual(edited.subarray(0,96),bytes.subarray(0,96));assert.deepEqual(bytes,before);assert.equal(inspectReplay(edited).events.scripts[0].time,75);
  const restored=editReplay(edited,changes.map(c=>({id:c.id,value:file.entries.find(e=>e.id===c.id).value})));assert.deepEqual(restored,bytes);assert.equal(inspectReplay(edited).cameras[2].fov,666);
});
test('REP rejects corrupt counts, key strides, event sections, values and reordered event times',()=>{
  const bytes=fixture();for(const [offset,value]of [[0,0],[4,999],[12,0xffffffff],[96,999],[264+12,4],[312+12,0x7fc00000],[620,999]]){const bad=Buffer.from(bytes);bad.writeUInt32LE(value,offset);assert.throws(()=>inspectReplay(bad),`Corrupt field at ${offset}`);}
  assert.throws(()=>inspectReplay(bytes.subarray(0,700)));
  const command=Buffer.from(bytes);command.writeUInt32LE(1,772);assert.equal(inspectReplay(command).events.dialogues[0].command,true);assert.ok(!inspectReplay(command).entries.some(e=>e.id==='dialogues/0/textId'));
  for(const changes of [[{id:'camera/2/fov',value:1}],[{id:'camera/2/position',value:[1,2,3]}],[{id:'dialogues/0/textId',value:1}],[{id:'camera/1/fov',value:666}],[{id:'camera/1/position',value:[1e40,0,0]}],[{id:'objects/0/0/rotation',value:[0,0,0,0]}],[{id:'scripts/0/time',value:200}],[{id:'sounds/0/name',value:'🙂'}],[{id:'animations/0/name',value:'x'.repeat(48)}],[{id:'camera/0/roll',value:0},{id:'camera/0/roll',value:1}]])assert.throws(()=>editReplay(bytes,changes));
});
test('REP path preview clamps duplicate keys, reflects LS3D Z and updates drafts without changing source',()=>{
  const file=inspectReplay(fixture()),before=structuredClone(file);assert.deepEqual(sampleReplayPath(file.cameras,50),[5,3,-8]);assert.deepEqual(sampleReplayPath(file.cameras,-50),[0,3,-8]);assert.equal(sampleReplayPath(file.cameras,500),null);assert.equal(sampleReplayPath([],0),null);
  assert.deepEqual(sampleReplayPath([{time:0,position:[0,0,0]},{time:0,position:[1,2,3]}],0),[1,2,3]);
  const view=Object.create(ReplayViewport.prototype);Object.assign(view,{root:new THREE.Group(),materials:new Set(),camera:new THREE.PerspectiveCamera(),controls:{target:new THREE.Vector3(),update(){}}});view.root.scale.z=-1;view.loadReplay(file);view.seek(50);view.root.updateMatrixWorld(true);assert.deepEqual(view.markers[0].marker.getWorldPosition(new THREE.Vector3()).toArray(),[5,3,8]);view.updateEntry('camera/1/position',[1e40,3,-8]);assert.deepEqual(view.markers[0].marker.position.toArray(),[5,3,-8]);view.updateEntry('camera/1/position',[14,3,-8]);assert.deepEqual(view.markers[0].marker.position.toArray(),[7,3,-8]);assert.equal(view.markers[0].line.geometry.attributes.position.count,2);view.seek(200);assert.ok(view.markers.every(m=>!m.marker.visible));assert.deepEqual(file,before);
});
test('REP cuts preserve opaque markers and use outgoing/incoming poses without a line across the cut',()=>{
  const bytes=fixture(),incoming=Buffer.alloc(64);incoming.writeUInt32LE(100);incoming.writeUInt32LE(100,4);incoming.writeUInt32LE(8,8);[100,3,-8].forEach((n,i)=>incoming.writeFloatLE(n,12+i*4));incoming.writeFloatLE(1,52);
  // The marker's opaque pose bytes deliberately contain NaN float patterns.
  const marker=Buffer.alloc(64,0xcd);marker.writeUInt32LE(100);marker.writeUInt32LE(100,4);marker.writeUInt32LE(2,8);marker.writeUInt32LE(0x7fc00000,12);marker.writeFloatLE(0,52);
  const outgoing=Buffer.from(bytes.subarray(376,440));outgoing.writeUInt32LE(4,8);
  const withCut=Buffer.concat([bytes.subarray(0,376),marker,outgoing,incoming,bytes.subarray(440)]);withCut.writeUInt32LE(5,20);
  const parsed=inspectReplay(withCut);assert.equal(parsed.cameras[1].cut,true);assert.equal(parsed.cameras[1].position,undefined);assert.ok(!parsed.entries.some(e=>e.id.startsWith('camera/1/')));assert.deepEqual(editReplay(withCut,[]),withCut);assert.throws(()=>editReplay(withCut,[{id:'camera/1/position',value:[0,0,0]}]));
  const invalid=Buffer.from(withCut);invalid.writeUInt32LE(1,504+8);assert.throws(()=>inspectReplay(invalid),/střih/);
  const keys=[{time:0,curveTime:0,flags:1,position:[10,3,-8]},{time:100,flags:2,cut:true},{time:100,curveTime:100,flags:4,position:[20,3,-8]},{time:60,curveTime:100,flags:8,position:[100,3,-8]},{time:200,curveTime:200,flags:1,position:[200,3,-8]},{time:300,curveTime:300,flags:1,position:[300,3,-8]},{time:350,stop:true}];
  assert.deepEqual(replayPathSegments(keys).segments,[{start:0,end:100,from:0,to:2},{start:100,end:200,from:3,to:4},{start:200,end:300,from:4,to:5}]);assert.deepEqual(sampleReplayPath(keys,50),[15,3,-8]);assert.deepEqual(sampleReplayPath(keys,100),[100,3,-8]);assert.deepEqual(sampleReplayPath(keys,150),[150,3,-8]);assert.equal(sampleReplayPath(keys,350),null);
  const view=Object.create(ReplayViewport.prototype);Object.assign(view,{root:new THREE.Group(),materials:new Set(),camera:new THREE.PerspectiveCamera(),controls:{target:new THREE.Vector3(),update(){}}});view.root.scale.z=-1;view.loadReplay({cameras:keys,focus:[]});const line=view.markers[0].line;assert.equal(line.isLineSegments,true);assert.deepEqual(view.markers[0].indices,[0,2,3,4,4,5]);view.seek(150);view.updateEntry('camera/4/position',[220,3,-8]);assert.equal(line.geometry.attributes.position.getX(3),220);assert.equal(line.geometry.attributes.position.getX(4),220);assert.deepEqual(view.markers[0].marker.position.toArray(),[160,3,-8]);const count=view.root.children.length;view.fitShot();assert.deepEqual(view.controls.target.toArray(),[160,3,8]);assert.equal(view.root.children.length,count);assert.ok(view.markers[0].marker.scale.x<2);
});
test('REP project saves with stale guards, reopens, exports, undoes and preserves originals',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-rep-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const bytes=fixture(),asset={path:'records/Test.rep',original:'originals/a5/records/Test.rep',sha256:hash(bytes),size:bytes.length,archive:'A5.dta',variants:[{}]};await writeSafe(root,asset.original,bytes);await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Replay',assets:[asset],history:[]}));
  const project=await ModProject.open(root),file=await project.inspect(asset.path),changes=[{id:'camera/1/position',value:[15,3,-8]}];assert.equal(file.type,'replay');await assert.rejects(project.saveReplay(asset.path,changes,'0'.repeat(64)),/změnil/);await project.saveReplay(asset.path,changes,file.sha256);const reopened=await ModProject.open(root);assert.deepEqual((await reopened.inspect(asset.path)).cameras[1].position,[15,3,-8]);await assert.rejects(reopened.saveReplay(asset.path,[],file.sha256),/změnil/);await reopened.export(path.join(root,'export'));assert.deepEqual(await fs.readFile(path.join(root,'export',asset.path)),await reopened.read(asset.path));await reopened.undo();assert.deepEqual(await reopened.read(asset.path),bytes);assert.deepEqual(await fs.readFile(path.join(root,asset.original)),bytes);
});
test('REP plain model animation metadata stays read-only at the end of a 92-byte pose key',()=>{
  const source=fixture(),modelKey=Buffer.alloc(92);source.subarray(272,312).copy(modelKey);modelKey.writeUInt16LE(0x9016,88);modelKey.writeUInt16LE(85,90);
  const bytes=Buffer.concat([source.subarray(0,272),modelKey,source.subarray(312)]);bytes.writeUInt32LE(100,8);bytes.writeUInt32LE(92,232);bytes.writeUInt32LE(0,236);bytes.writeUInt32LE(0,240);bytes.writeUInt32LE(1,252);bytes.writeUInt32LE(100,256);
  const parsed=inspectReplay(bytes),key=parsed.tracks[0].keys[0];assert.equal(key.modelAnimationId,22);assert.equal(key.modelAnimationFlags,0x9016);assert.equal(key.modelAnimationFrame,85);assert.equal(key.animationFlags,undefined);
  assert.deepEqual(editReplay(bytes,[]),bytes);const edited=editReplay(bytes,[{id:'objects/0/0/position',value:[1,2,3]}]);assert.deepEqual(edited.subarray(272+36,364),bytes.subarray(272+36,364));
});
