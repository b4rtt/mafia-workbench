import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as THREE from 'three';
import {parseEffects,editEffects,changeEffects,parseEffectTypes} from '../src/core/effects.js';
import {EffectsViewport} from '../src/ui/effects.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';
import {changeSceneObject} from '../src/core/scene.js';

const chunk=(type,payload)=>{const b=Buffer.alloc(6);b.writeUInt16LE(type);b.writeUInt32LE(payload.length+6,2);return Buffer.concat([b,payload]);};
const empty=chunk(100,Buffer.alloc(0)),tail=Buffer.from('opaque file tail'),foreign=chunk(999,Buffer.from('unknown root child'));
const added=changeEffects(empty,{action:'add',effectId:0,position:[-0,2,3],direction:[0,2,0],frame:'Room'});
const original=Buffer.concat([chunk(100,Buffer.concat([foreign,added.subarray(6)])),tail]);
const definition=(name,model,flags=[1,0])=>chunk(100,Buffer.concat([chunk(103,Buffer.from(name+'\0')),chunk(104,Buffer.from(model+'\0')),chunk(101,Buffer.from('opaque emitter')),chunk(110,Buffer.from(flags)),foreign]));
const table=Buffer.concat([definition('Smoke','particle.I3D'),definition('Fire','particle.I3D',[0,1]),definition('Missing','absent.I3D')]);

test('effect placements preserve matrix rows, signed zero, root siblings and file tails through edits and resizing bindings',()=>{
  const parsed=parseEffects(original),effect=parsed.effects[0];assert.equal(parsed.unknownChunks,1);assert.equal(parsed.tailBytes,tail.length);assert.equal(effect.id,'effects/1');assert.equal(effect.frame,'Room');assert.equal(Object.is(effect.position[0],-0),true);assert.deepEqual(effect.direction,[0,2,0]);
  assert.deepEqual(editEffects(original,parsed.entries.map(entry=>({id:entry.id,value:entry.value}))),original);
  const updated=editEffects(original,[{id:effect.fields.position,value:[4,5,6]},{id:effect.fields.direction,value:[1,0,0]},{id:effect.fields.effectId,value:1},{id:effect.fields.frame,value:'Longer room'}]),revised=parseEffects(updated).effects[0];
  assert.deepEqual(revised.position,[4,5,6]);assert.deepEqual(revised.direction,[1,0,0]);assert.equal(revised.effectId,1);assert.equal(revised.frame,'Longer room');assert.ok(updated.includes(foreign));assert.deepEqual(updated.subarray(-tail.length),tail);
  for(const i of [0,1,2,3,7,8,9,10,11,15])assert.equal(revised.matrix[i],effect.matrix[i]);
  assert.deepEqual(editEffects(updated,parsed.entries.map(entry=>({id:entry.id,value:entry.value}))),original);
  const world=editEffects(original,[{id:effect.fields.frame,value:''}]);assert.equal(parseEffects(world).effects[0].bindingEditable,true);assert.equal(parseEffects(world).effects[0].frame,'');assert.deepEqual(editEffects(world,[{id:effect.fields.frame,value:'Room'}]),original);
  const copy=changeEffects(original,{action:'duplicate',id:effect.id});assert.deepEqual(parseEffects(copy).effects[1].matrix,effect.matrix);assert.deepEqual(changeEffects(copy,{action:'delete',id:parseEffects(copy).effects[1].id}),original);
});

test('opaque bindings and binding suffixes remain intact, including when a recognized name changes',()=>{
  const matrix=added.subarray(12,80),unknownBinding=chunk(1000,Buffer.concat([matrix,chunk(444,Buffer.from('foreign binding'))])),source=chunk(100,unknownBinding),record=parseEffects(source).effects[0];
  assert.equal(record.bindingEditable,false);assert.equal(record.fields.frame,undefined);assert.deepEqual(editEffects(source,[{id:record.fields.position,value:record.position}]),source);assert.throws(()=>editEffects(source,[{id:record.id+'/frame',value:'Room'}]),/vlastnost/);
  const suffix=Buffer.from([17,19,23]),sibling=chunk(555,Buffer.from('extra child')),bound=chunk(100,chunk(1000,Buffer.concat([matrix,chunk(1001,Buffer.concat([Buffer.from('Room\0'),suffix])),sibling]))),parsed=parseEffects(bound).effects[0];
  const renamed=editEffects(bound,[{id:parsed.fields.frame,value:'Other room'}]);assert.ok(renamed.includes(suffix));assert.ok(renamed.includes(sibling));assert.deepEqual(editEffects(renamed,[{id:parsed.fields.frame,value:'Room'}]),bound);assert.throws(()=>editEffects(bound,[{id:parsed.fields.frame,value:''}]),/neznámými/);
});

test('effects reject malformed chunks, stale identifiers and unrepresentable input before modifying any bytes',()=>{
  for(const bytes of [Buffer.alloc(0),Buffer.alloc(6),chunk(101,Buffer.alloc(0)),chunk(100,Buffer.from([1])),chunk(100,chunk(1000,Buffer.alloc(67)))])assert.throws(()=>parseEffects(bytes),/Efekty/);
  const infinity=Buffer.from(added);infinity.writeFloatLE(Infinity,12);assert.throws(()=>parseEffects(infinity),/matice/);
  const record=parseEffects(added).effects[0];
  for(const position of [[],[1,2],[Infinity,0,0],[1e40,0,0],Array(3),[1,'2',3]])assert.throws(()=>changeEffects(empty,{action:'add',effectId:0,position}),/vektor/);
  for(const effectId of [-1,1.5,2**32,NaN,'1'])assert.throws(()=>changeEffects(empty,{action:'add',effectId,position:[0,0,0]}),/index/);
  for(const frame of ['x\0y','💥','x'.repeat(999),null])assert.throws(()=>editEffects(added,[{id:record.fields.frame,value:frame}]),/název/);
  assert.deepEqual(parseEffects(changeEffects(empty,{action:'add',effectId:0,position:[0,0,0],direction:[0,0,0]})).effects[0].direction,[0,0,0]);
  assert.throws(()=>editEffects(added,[{id:record.fields.position,value:[0,0,0]},{id:record.fields.position,value:[1,1,1]}]),/opakovaná/);
  assert.throws(()=>changeEffects(added,{action:'delete',id:'missing'}),/neexistuje/);assert.throws(()=>changeEffects(added,{action:'unknown'}),/operace/);
});

test('type catalogs keep native indices, emitter counts and distinct position/direction flags',()=>{
  const parsed=parseEffectTypes(table);assert.equal(parsed.items.length,3);assert.deepEqual(parsed.items[0],{effectId:0,name:'Smoke',model:'particle.I3D',emitters:1,rotateDirection:true,rotatePosition:false});assert.equal(parsed.items[1].rotatePosition,true);assert.equal(parsed.items[1].rotateDirection,false);
  assert.throws(()=>parseEffectTypes(chunk(99,Buffer.alloc(0))),/nepodporovaný/);assert.throws(()=>parseEffectTypes(chunk(100,chunk(110,Buffer.alloc(1)))),/useknuté/);assert.throws(()=>parseEffectTypes(chunk(100,Buffer.concat([chunk(103,Buffer.from('a\0')),chunk(103,Buffer.from('b\0'))]))),/opakovaná/);
});

async function setup(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-effects-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Effects',assets:[],history:[]}));
  const project=await ModProject.open(root),name='missions/NEW/effects.bin',geometry=Buffer.alloc(19);geometry.write('4DS\0');geometry.writeUInt16LE(29,4);geometry[18]=1;
  const scene=changeSceneObject(chunk(0x4c53,chunk(0x4000,Buffer.alloc(0))),{kind:'add-model',name:'Room',model:'particle.i3d',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]});
  await project.createFiles([{path:name,data:empty},{path:'tables/effects.tbl',data:table},{path:'models/particle.4ds',data:geometry},{path:'missions/NEW/scene.4ds',data:geometry},{path:'missions/NEW/scene2.bin',data:scene}]);
  return {root,project,name,geometry,scene,history:project.manifest.history.length};
}
test('project effects validate dependencies, publish only placements, reopen, export and undo exact bytes',async t=>{
  const {root,project,name,geometry,scene,history}=await setup(t),opened=await project.inspect(name);assert.equal(opened.type,'effects');assert.equal(opened.context.items[0].available,true);assert.equal(opened.context.items[2].available,false);assert.deepEqual(opened.context.frames,['Room']);
  const request={action:'add',effectId:0,position:[1,2,3],direction:[0,1,0],frame:'rOoM'};
  await assert.rejects(project.changeEffects(name,request,'stale',opened.context),/změnil/);await assert.rejects(project.changeEffects(name,{...request,effectId:2},opened.sha256,opened.context),/definici/);await assert.rejects(project.changeEffects(name,{...request,frame:'Missing'},opened.sha256,opened.context),/jednoznačný/);
  await assert.rejects(project.changeEffects(name,request,opened.sha256,{...opened.context,tableHash:'stale'}),/změnila/);await assert.rejects(project.changeEffects(name,request,opened.sha256,{...opened.context,modelHashes:{}}),/změnila/);await assert.rejects(project.changeEffects(name,request,opened.sha256,{...opened.context,frameHashes:{}}),/změnila/);assert.equal(project.manifest.history.length,history);assert.deepEqual(await project.read(name),empty);
  await project.changeEffects(name,request,opened.sha256,opened.context);const first=await project.read(name),record=parseEffects(first).effects[0];assert.deepEqual(project.manifest.history.at(-1).files.map(row=>row.path),[name]);
  await project.saveEffects(name,[{id:record.fields.position,value:[9,8,7]},{id:record.fields.effectId,value:1},{id:record.fields.frame,value:''}],hash(first),opened.context);const second=await project.read(name);assert.equal(parseEffects(second).effects[0].effectId,1);assert.equal(parseEffects(second).effects[0].frame,'');
  const reopened=await ModProject.open(root),destination=path.join(root,'export');assert.deepEqual(await reopened.read(name),second);await reopened.export(destination);assert.deepEqual(await fs.readFile(path.join(destination,name)),second);assert.deepEqual(await reopened.read('missions/NEW/scene2.bin'),scene);assert.deepEqual(await reopened.read('models/particle.4ds'),geometry);assert.deepEqual(await reopened.read('tables/effects.tbl'),table);
  await reopened.undo();assert.deepEqual(await reopened.read(name),first);await reopened.undo();assert.deepEqual(await reopened.read(name),empty);assert.equal(reopened.manifest.history.length,history);
});

test('position edits and deletion remain possible for unavailable existing types; shifted record IDs do not require new dependencies',async t=>{
  const {project,name}=await setup(t),bad=changeEffects(empty,{action:'add',effectId:500,position:[1,2,3]}),two=changeEffects(bad,{action:'add',effectId:501,position:[4,5,6]});await project.change(name,two);
  const opened=await project.inspect(name),first=opened.effects[0];await project.saveEffects(name,[{id:first.fields.position,value:[7,8,9]}],opened.sha256);const current=await project.inspect(name);await assert.rejects(project.changeEffects(name,{action:'duplicate',id:first.id},current.sha256,current.context),/definici/);
  await project.changeEffects(name,{action:'delete',id:first.id},current.sha256);assert.equal(parseEffects(await project.read(name)).effects[0].effectId,501);await project.undo();assert.deepEqual(await project.read(name),editEffects(two,[{id:first.fields.position,value:[7,8,9]}]));
});

test('model dependency changes between validation and publication cannot publish stale effects',async t=>{
  const {project,name}=await setup(t),opened=await project.inspect(name),batch=project.changeBatch;let intercepted=false;
  project.changeBatch=async function(files,label,...rest){if(!intercepted){intercepted=true;this.changeBatch=batch;await this.change('models/particle.4ds',Buffer.from('concurrent model edit'));}return batch.call(this,files,label,...rest);};
  await assert.rejects(project.changeEffects(name,{action:'add',effectId:0,position:[1,2,3]},opened.sha256,opened.context),/změnil/);assert.deepEqual(await project.read(name),empty);assert.equal(project.manifest.history.at(-1).path,'models/particle.4ds');await project.undo();
});

test('effect marker geometry reflects native Z, keeps bound placements local and preserves the camera when restoring selection',()=>{
  const view=Object.create(EffectsViewport.prototype);Object.assign(view,{scene:new THREE.Scene(),root:new THREE.Group(),frames:new Map(),materials:new Set(),camera:new THREE.PerspectiveCamera(),controls:{target:new THREE.Vector3(),update(){}},gizmo:{detach(){},attach(){}},onSelect(){}});view.root.scale.z=-1;view.scene.add(view.root);
  const data=parseEffects(added);view.loadEffects(data);const record=data.effects[0],marker=view.frames.get(record.id);assert.deepEqual(marker.getWorldPosition(new THREE.Vector3()).toArray(),[0,2,-3]);
  view.contextGeometry=new THREE.Group();view.contextGeometry.position.set(1e6,1e6,1e6);view.scene.add(view.contextGeometry);view.showGeometry(true);assert.equal(marker.visible,false);
  const snapshot={position:[1,2,3],target:[1,2,2],near:.001,far:20000};view.restoreCamera(snapshot);view.select(record.id,true,false);assert.equal(view.contextGeometry.visible,false);assert.equal(marker.visible,true);assert.deepEqual(view.captureCamera(),snapshot);
  view.updateEffect(record.id,{position:[4,5,6],direction:[1,0,0]});assert.deepEqual(marker.getWorldPosition(new THREE.Vector3()).toArray(),[4,5,-6]);assert.ok(new THREE.Vector3(0,1,0).applyQuaternion(view.effectRecords.get(record.id).arrow.quaternion).distanceTo(new THREE.Vector3(1,0,0))<1e-10);view.updateEffect(record.id,{direction:[0,0,0]});assert.equal(view.effectRecords.get(record.id).arrow.visible,false);
  view.scene.traverse(node=>node.geometry?.dispose());for(const material of view.materials)material.dispose();
});
