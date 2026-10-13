import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ModProject } from '../src/core/project.js';
import { hash, writeSafe } from '../src/core/files.js';
import { inspectScene } from '../src/core/scene.js';
import { parseCollision } from '../src/core/collision.js';
import { collisionOwnership } from '../src/core/scene-collision.js';
import { collisionFixture } from './fixtures/collision.js';
import { editCollision } from '../src/core/collision-editor.js';
import { collisionTriangleVertices } from '../src/core/collision-surfaces.js';

const scenePath='missions/NEW/scene2.bin',klzPath='missions/NEW/tree.klz';
const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;},floats=values=>{const b=Buffer.alloc(values.length*4);values.forEach((n,i)=>b.writeFloatLE(n,i*4));return b;};
const chunk=(type,data)=>{const h=Buffer.alloc(6);h.writeUInt16LE(type);h.writeUInt32LE(data.length+6,2);return Buffer.concat([h,data]);};
async function setup(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-collision-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const manifest={format:'mafia-workbench',version:1,name:'Collision fixture',assets:[],history:[]};await writeSafe(root,'workbench.json',JSON.stringify(manifest));const p=await ModProject.open(root);
  const empty=Buffer.alloc(19);empty.write('4DS\0');empty.writeUInt16LE(29,4);empty[18]=1;
  const model=Buffer.concat([empty.subarray(0,14),u16(0),u16(1),Buffer.from([1,0,0,0]),u16(0),floats([0,0,0,1,1,1,1,0,0,0]),Buffer.from([1,5]),Buffer.from('crate'),Buffer.from([0]),u16(0),Buffer.from([1]),floats([0]),u16(3),floats([0,0,0,0,1,0,0,0,2,0,0,0,1,0,0,0,0,4,3,0,1,0,0,0]),Buffer.from([1]),u16(1),u16(0),u16(1),u16(2),u16(0),Buffer.from([1])]);
  const scene=chunk(0x4c53,chunk(0x4000,Buffer.alloc(0))),klz=collisionFixture(),parsed=parseCollision(klz);klz.writeUInt16LE(2,parsed.primitives.triangles.start+8);klz.writeUInt16LE(1,parsed.primitives.triangles.start+12);
  await p.createFiles([{path:scenePath,data:scene},{path:'missions/NEW/scene.4ds',data:empty},{path:'models/Crate.4ds',data:model},{path:klzPath,data:klz}]);return {p,root,scene,klz};
}
const operation={kind:'add-model',name:'WB_CRATE',model:'models/crate.4ds',position:[5,0,5],rotation:[1,0,0,0],scale:[1,1,1],collision:{kind:'aabb',material:7}};
async function add(p,scene){await p.changeSceneObject(scenePath,operation,hash(scene));return p.read(scenePath);}

test('automatic model collisions keep independent manual surfaces across regeneration, export and undo',async t=>{
  const {p,scene,root}=await setup(t);await p.changeSceneObject(scenePath,{...operation,collision:{kind:'mesh',material:7}},hash(scene));
  const before=await p.read(klzPath),manualPoints=[[12,0,12],[12,3,12],[12,0,14]],manual=editCollision(before,[{kind:'add',array:'triangles',changes:{points:manualPoints,material:21}}]).bytes;
  await p.change(klzPath,manual,'Manual collision surface');const snapshot=await p.read(scenePath),map=await p.inspectMap(scenePath);assert.equal(map.collision.warning,undefined);
  await p.saveScene(scenePath,[{id:map.objects[0].fields.position,value:[15,0,15]}],map.sha256);
  const result=await p.read(klzPath),q=parseCollision(result),owned=collisionOwnership(p.manifest,scenePath)[0],independent=q.primitives.triangles.records.find(r=>r.material===21);
  assert.ok(independent);assert.equal(q.vertexCount,9);assert.equal(owned.vertexStart,6);assert.deepEqual(collisionTriangleVertices(q,independent).sort(),manualPoints.sort());assert.equal((await p.inspectMap(scenePath)).collision.warning,undefined);
  const destination=path.join(root,'mixed-export');await p.export(destination);assert.deepEqual(await fs.readFile(path.join(destination,klzPath)),result);
  await p.undo();assert.deepEqual(await p.read(klzPath),manual);assert.deepEqual(await p.read(scenePath),snapshot);assert.equal((await p.inspectMap(scenePath)).collision.warning,undefined);
});

test('pickup rename preserves other owned collisions without duplicating geometry dependencies',async t=>{
  const {p,scene}=await setup(t),table=Buffer.alloc(188*2);table.write('Crate item',188);table.write('Crate.i3d',188+36);
  await p.createFiles([{path:'tables/predmety.def',data:table}]);const withCrate=await add(p,scene),catalog=await p.pickupItems(),item=catalog.items[0],collision=await p.read(klzPath);
  await p.changeSceneObject(scenePath,{kind:'add-pickup',name:'PICKUP',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1],itemId:1,clip:0,reserve:0,itemTableHash:catalog.sha256,itemModelHash:item.modelHash},hash(withCrate));
  const added=await p.read(scenePath),object=inspectScene(added).objects.find(object=>object.name==='PICKUP');
  await p.saveScene(scenePath,[{id:object.fields.name,value:'RENAMED_PICKUP'}],hash(added));
  assert.equal(inspectScene(await p.read(scenePath)).objects.find(object=>object.name==='RENAMED_PICKUP').pickup.name,'RENAMED_PICKUP');assert.deepEqual(await p.read(klzPath),collision);
  await p.undo();assert.deepEqual(await p.read(scenePath),added);await p.undo();assert.deepEqual(await p.read(scenePath),withCrate);assert.deepEqual(await p.read(klzPath),collision);
});

test('adding a model and collision publishes atomically, reopens, exports, transforms and undoes together',async t=>{
  const {p,root,scene,klz}=await setup(t),added=await add(p,scene),collision=await p.read(klzPath),history=p.manifest.history.at(-1);
  assert.deepEqual(history.files.map(f=>f.path),[scenePath,klzPath]);assert.equal(collisionOwnership(p.manifest,scenePath).length,1);
  let map=await p.inspectMap(scenePath);assert.deepEqual(map.collision.boxes,[{name:'WB_CRATE',min:[5,0,5],max:[7,4,8],material:7}]);
  const reopened=await ModProject.open(root),object=inspectScene(added).objects[0];await reopened.saveScene(scenePath,[{id:object.fields.position,value:[15,2,15]},{id:object.fields.scale,value:[2,1,1]}],hash(added));
  map=await reopened.inspectMap(scenePath);assert.deepEqual(map.collision.boxes[0].min,[15,2,15]);assert.deepEqual(map.collision.boxes[0].max,[19,6,18]);assert.equal(parseCollision(await reopened.read(klzPath)).primitives.aabbs.count,2);
  assert.deepEqual(parseCollision(await reopened.read(klzPath)).primitives.aabbs.records[0].raw,parseCollision(klz).primitives.aabbs.records[0].raw);
  const destination=path.join(root,'export');await reopened.export(destination);assert.deepEqual(await fs.readFile(path.join(destination,klzPath)),await reopened.read(klzPath));assert.deepEqual(await fs.readFile(path.join(destination,scenePath)),await reopened.read(scenePath));
  await reopened.undo();assert.deepEqual(await reopened.read(scenePath),added);assert.deepEqual(await reopened.read(klzPath),collision);assert.equal(collisionOwnership(reopened.manifest,scenePath).length,1);
  await reopened.undo();assert.deepEqual(await reopened.read(scenePath),scene);assert.deepEqual(await reopened.read(klzPath),klz);assert.deepEqual(collisionOwnership(reopened.manifest,scenePath),[]);
  assert.deepEqual(await reopened.original(reopened.asset(klzPath)),klz);
});

test('generated collision follows rename, duplication, deletion and removal without touching imported colliders',async t=>{
  const {p,scene,klz}=await setup(t);await add(p,scene);let data=await p.read(scenePath),object=inspectScene(data).objects[0];
  await p.saveScene(scenePath,[{id:object.fields.name,value:'RENAMED'}],hash(data));let map=await p.inspectMap(scenePath);assert.equal(map.collision.boxes[0].name,'RENAMED');object=map.objects[0];
  await p.changeSceneObject(scenePath,{kind:'duplicate',id:object.id,name:'COPY'},map.sha256);map=await p.inspectMap(scenePath);assert.equal(map.collision.boxes.length,2);assert.equal(parseCollision(await p.read(klzPath)).primitives.aabbs.count,3);
  const duplicate=map.objects.find(o=>o.name==='COPY');await p.changeSceneObject(scenePath,{kind:'delete',id:duplicate.id},map.sha256);map=await p.inspectMap(scenePath);assert.equal(map.collision.boxes.length,1);
  const before=await p.read(klzPath);await p.changeSceneObject(scenePath,{kind:'collision',id:map.objects[0].id,collision:{kind:'none'},collisionHash:map.collision.sha256},map.sha256);
  assert.deepEqual(collisionOwnership(p.manifest,scenePath),[]);assert.deepEqual(parseCollision(await p.read(klzPath)).primitives.aabbs.raw,parseCollision(klz).primitives.aabbs.raw);
  await p.undo();assert.deepEqual(await p.read(klzPath),before);assert.equal((await p.inspectMap(scenePath)).collision.boxes.length,1);
  await p.restore(scenePath);assert.deepEqual(await p.read(scenePath),scene);assert.deepEqual(collisionOwnership(p.manifest,scenePath),[]);assert.equal(parseCollision(await p.read(klzPath)).primitives.aabbs.count,1);
});

test('failed manifest publication, stale collision hashes and externally changed owned records leave both files untouched',async t=>{
  const {p,scene,klz,root}=await setup(t),save=p.saveManifest;p.saveManifest=async()=>{throw new Error('simulated failure');};
  await assert.rejects(add(p,scene),/simulated/);assert.deepEqual(await p.read(scenePath),scene);assert.deepEqual(await p.read(klzPath),klz);assert.equal(p.manifest.history.length,1);assert.deepEqual(collisionOwnership(p.manifest,scenePath),[]);
  p.saveManifest=save;await assert.rejects(p.changeSceneObject(scenePath,{...operation,collisionHash:'stale'},hash(scene)),/Kolize se/);assert.deepEqual(await p.read(scenePath),scene);
  const added=await add(p,scene),map=await p.inspectMap(scenePath),bytes=await p.read(klzPath),parsed=parseCollision(bytes);bytes[parsed.primitives.aabbs.records[1].offset+3]=99;await writeSafe(root,p.asset(klzPath).overlay,bytes);
  assert.match((await p.inspectMap(scenePath)).collision.warning,/mimo editor/);
  await assert.rejects(p.saveScene(scenePath,[{id:map.objects[0].fields.position,value:[15,0,15]}],hash(added)),/mimo editor/);assert.deepEqual(await p.read(scenePath),added);assert.deepEqual(await p.read(klzPath),bytes);
});

test('replacing a scene removes its generated colliders atomically and undo restores their ownership',async t=>{
  const {p,scene}=await setup(t),added=await add(p,scene),collision=await p.read(klzPath);
  await p.change(scenePath,scene,'Replace scene');assert.deepEqual(collisionOwnership(p.manifest,scenePath),[]);assert.equal(parseCollision(await p.read(klzPath)).primitives.aabbs.count,1);
  await p.undo();assert.deepEqual(await p.read(scenePath),added);assert.deepEqual(await p.read(klzPath),collision);assert.equal(collisionOwnership(p.manifest,scenePath).length,1);
});
test('creating a door replaces its owned static box atomically and undo restores the model and collision',async t=>{
  const {p,scene}=await setup(t),before=await add(p,scene),box=await p.read(klzPath),map=await p.inspectMap(scenePath),history=p.manifest.history.length;
  const door={kind:'attach-door',target:'wb_crate',parameters:{angle:110,locked:true},collisionHash:map.collision.sha256};
  await assert.rejects(p.changeSceneObject(scenePath,{...door,collisionHash:'stale'},hash(before)),/Kolize se/);assert.deepEqual(await p.read(scenePath),before);assert.deepEqual(await p.read(klzPath),box);assert.equal(p.manifest.history.length,history);
  await p.changeSceneObject(scenePath,door,hash(before));const after=await p.read(scenePath),parsed=inspectScene(after);assert.equal(parsed.objects[0].actorBound,true);assert.deepEqual(parsed.objects[0].position,map.objects[0].position);assert.equal(parsed.entries.find(e=>e.doorParameter&&e.key==='locked').value,true);assert.equal(parsed.entries.find(e=>e.label==='Typ aktéra').value,6);
  assert.deepEqual(collisionOwnership(p.manifest,scenePath),[]);assert.equal(parseCollision(await p.read(klzPath)).primitives.aabbs.count,1);assert.deepEqual(p.manifest.history.at(-1).files.map(f=>f.path),[scenePath,klzPath]);
  await assert.rejects(p.changeSceneObject(scenePath,door,hash(after)),/už má/);assert.deepEqual(await p.read(scenePath),after);
  const reopened=await ModProject.open(p.root);await reopened.undo();assert.deepEqual(await reopened.read(scenePath),before);assert.deepEqual(await reopened.read(klzPath),box);assert.equal(collisionOwnership(reopened.manifest,scenePath).length,1);
});

test('physical actor creation replaces only its owned box, exports and undoes actor and collisions atomically',async t=>{
  const {p,root,scene}=await setup(t);await add(p,scene);await p.changeSceneObject(scenePath,{...operation,name:'OTHER_CRATE',position:[15,0,5]},hash(await p.read(scenePath)));
  const before=await p.read(scenePath),box=await p.read(klzPath),model=await p.read('models/Crate.4ds'),map=await p.inspectMap(scenePath),history=p.manifest.history.length;
  const request={kind:'attach-physical',target:'wb_crate',parameters:{mass:25,impactSound:3},collisionHash:map.collision.sha256};
  await assert.rejects(p.changeSceneObject(scenePath,{...request,collisionHash:'stale'},hash(before)),/Kolize se/);assert.deepEqual(await p.read(scenePath),before);assert.deepEqual(await p.read(klzPath),box);
  await p.changeSceneObject(scenePath,request,hash(before));const after=await p.read(scenePath),klz=await p.read(klzPath),parsed=inspectScene(after);
  assert.equal(parsed.objects.find(o=>o.name==='WB_CRATE').actorBound,true);assert.equal(parsed.entries.find(e=>e.physicalParameter&&e.key==='mass').value,25);assert.equal(parsed.entries.find(e=>e.label==='Typ aktéra').value,35);
  assert.equal(p.manifest.history.length,history+1);assert.deepEqual(p.manifest.history.at(-1).files.map(f=>f.path),[scenePath,klzPath]);assert.deepEqual(collisionOwnership(p.manifest,scenePath).map(o=>o.name),['OTHER_CRATE']);
  assert.equal(parseCollision(klz).primitives.aabbs.count,2);const original=parseCollision(box).primitives.aabbs.records,next=parseCollision(klz).primitives.aabbs.records;assert.deepEqual(next[0].raw,original[0].raw);assert.deepEqual(next[1].raw,original[2].raw);assert.deepEqual(await p.read('models/Crate.4ds'),model);
  await assert.rejects(p.changeSceneObject(scenePath,request,hash(after)),/už má/);
  const reopened=await ModProject.open(root),destination=path.join(root,'physical-export');await reopened.export(destination);assert.deepEqual(await fs.readFile(path.join(destination,scenePath)),after);assert.deepEqual(await fs.readFile(path.join(destination,klzPath)),klz);
  await reopened.undo();assert.deepEqual(await reopened.read(scenePath),before);assert.deepEqual(await reopened.read(klzPath),box);assert.equal(collisionOwnership(reopened.manifest,scenePath).length,2);assert.equal(reopened.manifest.history.length,history);
});

test('physical actor creation rejects missing model surfaces and concurrent model changes without publishing partial data',async t=>{
  const {p,root,scene}=await setup(t),before=await add(p,scene),box=await p.read(klzPath),model=await p.read('models/Crate.4ds'),history=p.manifest.history.length;
  const request={kind:'attach-physical',target:'WB_CRATE'},changeBatch=p.changeBatch;
  p.changeBatch=async function(files,...rest){await this.change('models/Crate.4ds',Buffer.concat([model,Buffer.from([0])]),'Concurrent model');return changeBatch.call(this,files,...rest);};
  await assert.rejects(p.changeSceneObject(scenePath,request,hash(before)),/změnil/);assert.deepEqual(await p.read(scenePath),before);assert.deepEqual(await p.read(klzPath),box);assert.equal(p.manifest.history.length,history+1);p.changeBatch=changeBatch;await p.undo();
  const empty=await p.read('missions/NEW/scene.4ds');await p.change('models/Crate.4ds',empty,'Empty surface');await assert.rejects(p.changeSceneObject(scenePath,request,hash(before)),/statický model/);assert.deepEqual(await p.read(scenePath),before);await p.undo();
  const save=p.saveManifest;p.saveManifest=async()=>{throw new Error('simulated publication failure');};await assert.rejects(p.changeSceneObject(scenePath,request,hash(before)),/simulated/);p.saveManifest=save;
  assert.deepEqual(await p.read(scenePath),before);assert.deepEqual(await p.read(klzPath),box);assert.equal(p.manifest.history.length,history);assert.equal(collisionOwnership(p.manifest,scenePath).length,1);assert.deepEqual(await p.read('models/Crate.4ds'),model);
});

test('surface collision saves, transforms, exports and undoes with the model without growing its vertex pool',async t=>{
  const {p,root,scene,klz}=await setup(t);await p.changeSceneObject(scenePath,{...operation,collision:{kind:'mesh',material:9}},hash(scene));
  const added=await p.read(scenePath),surface=await p.read(klzPath),history=p.manifest.history.length;let map=await p.inspectMap(scenePath);
  assert.equal(map.collision.boxes.length,0);assert.equal(map.collision.surfaces[0].triangleCount,2);assert.equal(map.collision.surfaces[0].material,9);assert.equal(parseCollision(surface).vertexCount,6);
  const unchanged=await p.read(klzPath);await p.changeSceneObject(scenePath,{kind:'collision',id:map.objects[0].id,collision:{kind:'mesh',material:9},collisionHash:map.collision.sha256},map.sha256);assert.deepEqual(await p.read(klzPath),unchanged);assert.equal(p.manifest.history.length,history);
  const reopened=await ModProject.open(root);await reopened.saveScene(scenePath,[{id:map.objects[0].fields.position,value:[15,2,5]},{id:map.objects[0].fields.scale,value:[2,1,1]}],map.sha256);
  map=await reopened.inspectMap(scenePath);const moved=await reopened.read(klzPath),q=parseCollision(moved);assert.equal(q.vertexCount,6);assert.equal(q.primitives.triangles.count,3);assert.deepEqual(q.primitives.triangles.records[0].raw,parseCollision(klz).primitives.triangles.records[0].raw);assert.deepEqual(q.extraVertices.subarray(0,36),parseCollision(klz).extraVertices);
  assert.ok(map.collision.surfaces[0].positions.some((n,i)=>i%3===0&&n===19));assert.equal(collisionOwnership(reopened.manifest,scenePath)[0].kind,'mesh');
  const dest=path.join(root,'surface-export');await reopened.export(dest);assert.deepEqual(await fs.readFile(path.join(dest,klzPath)),moved);
  await reopened.undo();assert.deepEqual(await reopened.read(scenePath),added);assert.deepEqual(await reopened.read(klzPath),surface);
  await reopened.undo();assert.deepEqual(await reopened.read(scenePath),scene);assert.deepEqual(await reopened.read(klzPath),klz);assert.deepEqual(collisionOwnership(reopened.manifest,scenePath),[]);
});
test('surface owners support rename, duplicate, deletion, box conversion and dynamic actor replacement',async t=>{
  const {p,scene,klz}=await setup(t);await p.changeSceneObject(scenePath,{...operation,collision:{kind:'mesh',material:4,doubleSided:false}},hash(scene));let map=await p.inspectMap(scenePath);
  await p.saveScene(scenePath,[{id:map.objects[0].fields.name,value:'RENAMED'}],map.sha256);map=await p.inspectMap(scenePath);assert.equal(map.collision.surfaces[0].name,'RENAMED');
  await p.changeSceneObject(scenePath,{kind:'duplicate',id:map.objects[0].id,name:'COPY'},map.sha256);map=await p.inspectMap(scenePath);assert.equal(map.collision.surfaces.length,2);assert.ok(map.collision.surfaces.every(s=>s.doubleSided===false&&s.triangleCount===1&&s.material===4));assert.equal(parseCollision(await p.read(klzPath)).vertexCount,9);
  await p.changeSceneObject(scenePath,{kind:'delete',id:map.objects.find(o=>o.name==='COPY').id},map.sha256);map=await p.inspectMap(scenePath);assert.equal(map.collision.surfaces.length,1);assert.equal(parseCollision(await p.read(klzPath)).vertexCount,6);
  await p.changeSceneObject(scenePath,{kind:'collision',id:map.objects[0].id,collision:{kind:'aabb',material:7}},map.sha256);map=await p.inspectMap(scenePath);assert.equal(map.collision.boxes.length,1);assert.equal(map.collision.surfaces.length,0);assert.equal(parseCollision(await p.read(klzPath)).vertexCount,3);
  await p.undo();map=await p.inspectMap(scenePath);const before=await p.read(klzPath);await p.changeSceneObject(scenePath,{kind:'attach-physical',target:'RENAMED'},map.sha256);assert.equal(parseCollision(await p.read(klzPath)).vertexCount,3);assert.equal(parseCollision(await p.read(klzPath)).primitives.triangles.count,1);assert.deepEqual(collisionOwnership(p.manifest,scenePath),[]);
  await p.undo();assert.deepEqual(await p.read(klzPath),before);await p.restore(scenePath);assert.equal(parseCollision(await p.read(klzPath)).vertexCount,3);assert.deepEqual(parseCollision(await p.read(klzPath)).primitives.triangles.raw,parseCollision(klz).primitives.triangles.raw);
});
test('surface ownership detects vertex tampering and atomic publication failures before changing the scene',async t=>{
  const {p,root,scene,klz}=await setup(t),save=p.saveManifest;p.saveManifest=async()=>{throw new Error('surface publish failure');};
  await assert.rejects(p.changeSceneObject(scenePath,{...operation,collision:{kind:'mesh',material:1}},hash(scene)),/publish failure/);p.saveManifest=save;assert.deepEqual(await p.read(scenePath),scene);assert.deepEqual(await p.read(klzPath),klz);
  await p.changeSceneObject(scenePath,{...operation,collision:{kind:'mesh',material:1}},hash(scene));const map=await p.inspectMap(scenePath),before=await p.read(scenePath),bytes=await p.read(klzPath),q=parseCollision(bytes),offset=q.extraVertices.byteOffset-q.bytes.byteOffset;
  bytes.writeFloatLE(123,offset+36);await writeSafe(root,p.asset(klzPath).overlay,bytes);assert.match((await p.inspectMap(scenePath)).collision.warning,/mimo editor/);
  await assert.rejects(p.saveScene(scenePath,[{id:map.objects[0].fields.position,value:[10,0,0]}],hash(before)),/mimo editor/);assert.deepEqual(await p.read(scenePath),before);assert.deepEqual(await p.read(klzPath),bytes);
});

test('new surfaces coexist with imported frame triangles belonging to prefixed external models',async t=>{
  const {p,scene}=await setup(t);await p.changeSceneObject(scenePath,{...operation,name:'a',position:[0,0,0],collision:{kind:'none'}},hash(scene));
  const klz=await p.read(klzPath),parsed=parseCollision(klz);klz.write('a.crate\0',parsed.links[0].offset+4);klz.writeUInt16LE(0,parsed.primitives.triangles.start+6);await p.change(klzPath,klz,'Imported model surface');
  await p.changeSceneObject(scenePath,{...operation,collision:{kind:'mesh',material:2}},hash(await p.read(scenePath)));const map=await p.inspectMap(scenePath),after=parseCollision(await p.read(klzPath));assert.equal(map.collision.warning,undefined);assert.equal(map.collision.surfaces[0].triangleCount,2);assert.deepEqual(after.primitives.triangles.records[0].raw,parseCollision(klz).primitives.triangles.records[0].raw);
});
