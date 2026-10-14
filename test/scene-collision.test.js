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

test('manual KLZ save inspects, guards hashes, exports and undoes without changing the scene or original game data',async t=>{
  const {p,root,scene,klz}=await setup(t),file=await p.inspect(klzPath),history=p.manifest.history.length;
  assert.equal(file.type,'collision');assert.equal(file.records.length,6);assert.equal(file.links[0].resolved,false);assert.deepEqual(file.records.find(r=>r.array==='triangles').points,[[0,0,0],[0,0,1],[1,0,0]]);
  const operations=[{kind:'edit',array:'aabbs',index:0,changes:{material:19}},{kind:'delete',array:'spheres',index:0}];
  await assert.rejects(p.saveCollision(klzPath,operations,'stale'),/změnily/);assert.equal(p.manifest.history.length,history);
  await p.saveCollision(klzPath,operations,file.sha256,file.dependencyHashes);const after=await p.read(klzPath),parsed=parseCollision(after);assert.equal(parsed.primitives.aabbs.records[0].material,19);assert.equal(parsed.primitives.spheres.count,0);assert.deepEqual(await p.read(scenePath),scene);assert.deepEqual(await p.original(p.asset(klzPath)),klz);
  const opened=await ModProject.open(root);assert.equal((await opened.inspect(klzPath)).type,'collision');const dest=path.join(root,'manual-export');await opened.export(dest);assert.deepEqual(await fs.readFile(path.join(dest,klzPath)),after);
  await opened.undo();assert.deepEqual(await opened.read(klzPath),klz);assert.deepEqual(await opened.read(scenePath),scene);assert.equal(opened.manifest.history.length,history);
});

test('manual geometry protects dependencies and rejects missing volume frames before publication',async t=>{
  const {p,scene}=await setup(t);await add(p,scene);const file=await p.inspect(klzPath),before=await p.read(klzPath),history=p.manifest.history.length;
  const op={kind:'add',array:'aabbs',changes:{link:0,min:[1,0,1],max:[2,1,2]}};
  await assert.rejects(p.saveCollision(klzPath,[op],file.sha256,file.dependencyHashes),/existující frame/);
  const points={kind:'add',array:'triangles',changes:{points:[[12,0,12],[12,3,12],[12,0,14]]}};
  await assert.rejects(p.saveCollision(klzPath,[points],file.sha256,{}),/Geometrie/);assert.deepEqual(await p.read(klzPath),before);assert.equal(p.manifest.history.length,history);
  const change=p.changeBatch,geometry=await p.read('missions/NEW/scene.4ds');p.changeBatch=async function(files,...rest){await this.change('missions/NEW/scene.4ds',Buffer.concat([geometry,Buffer.from([0])]),'Concurrent geometry');return change.call(this,files,...rest);};
  await assert.rejects(p.saveCollision(klzPath,[points],file.sha256,file.dependencyHashes),/změnil/);assert.deepEqual(await p.read(klzPath),before);p.changeBatch=change;await p.undo();
  const publish=p.saveManifest;p.saveManifest=async()=>{throw new Error('KLZ publication failure');};await assert.rejects(p.saveCollision(klzPath,[points],file.sha256,file.dependencyHashes),/publication/);p.saveManifest=publish;assert.deepEqual(await p.read(klzPath),before);assert.equal(p.manifest.history.length,history);
});

test('manual changes detach only affected generated surfaces, remap other owners and survive later model movement',async t=>{
  const {p,root,scene}=await setup(t);await p.changeSceneObject(scenePath,{...operation,collision:{kind:'mesh',material:7}},hash(scene));await p.changeSceneObject(scenePath,{...operation,name:'OTHER',position:[15,0,5],collision:{kind:'mesh',material:8}},hash(await p.read(scenePath)));
  const file=await p.inspect(klzPath),before=await p.read(klzPath),oldOwners=collisionOwnership(p.manifest,scenePath),op=[{kind:'delete',array:'triangles',index:0},{kind:'edit',array:'triangles',index:1,changes:{material:21}}];
  await assert.rejects(p.saveCollision(klzPath,op,file.sha256,file.dependencyHashes),/odpojí/);assert.deepEqual(await p.read(klzPath),before);
  const result=await p.saveCollision(klzPath,op,file.sha256,file.dependencyHashes,{detachGenerated:true});assert.deepEqual(result.detached,['WB_CRATE']);assert.deepEqual(collisionOwnership(p.manifest,scenePath).map(o=>o.name),['OTHER']);assert.equal(collisionOwnership(p.manifest,scenePath)[0].triangleStart,oldOwners[1].triangleStart-1);
  const manual=await p.read(klzPath),map=await p.inspectMap(scenePath),other=map.objects.find(o=>o.name==='OTHER');assert.equal(map.collision.warning,undefined);
  await p.saveScene(scenePath,[{id:other.fields.position,value:[18,0,5]}],map.sha256);const q=parseCollision(await p.read(klzPath)),r=parseCollision(manual);assert.deepEqual(q.primitives.triangles.records[0].raw,r.primitives.triangles.records[0].raw);assert.deepEqual(q.extraVertices.subarray(0,6*12),r.extraVertices.subarray(0,6*12));assert.equal((await p.inspectMap(scenePath)).collision.warning,undefined);
  const reopened=await ModProject.open(root);await reopened.undo();assert.deepEqual(await reopened.read(klzPath),manual);await reopened.undo();assert.deepEqual(await reopened.read(klzPath),before);assert.deepEqual(collisionOwnership(reopened.manifest,scenePath),oldOwners);
});

test('identical manual box copies do not steal generated ownership, including after remapping and scene changes',async t=>{
  const {p,scene}=await setup(t);await add(p,scene);let file=await p.inspect(klzPath);const original=file.records.find(r=>r.owner==='WB_CRATE'),op={kind:'add',array:'aabbs',changes:{link:original.link,min:original.min,max:original.max,material:original.material,flags:original.flags}};
  await p.saveCollision(klzPath,[op],file.sha256,file.dependencyHashes);assert.equal((await p.inspectMap(scenePath)).collision.warning,undefined);assert.equal(collisionOwnership(p.manifest,scenePath)[0].boxIndex,1);
  file=await p.inspect(klzPath);await p.saveCollision(klzPath,[{kind:'delete',array:'aabbs',index:0}],file.sha256,file.dependencyHashes);assert.equal(collisionOwnership(p.manifest,scenePath)[0].boxIndex,0);
  const map=await p.inspectMap(scenePath);await p.saveScene(scenePath,[{id:map.objects[0].fields.position,value:[15,0,5]}],map.sha256);
  const q=parseCollision(await p.read(klzPath));assert.equal(q.primitives.aabbs.count,2);assert.deepEqual(q.primitives.aabbs.records[0].min,original.min);assert.deepEqual(q.primitives.aabbs.records[1].min,[15,0,5]);assert.equal(collisionOwnership(p.manifest,scenePath)[0].boxIndex,1);assert.equal((await p.inspectMap(scenePath)).collision.warning,undefined);
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

test('mission collision rebuild updates all owned models from edited geometry, preserves manual/original records and undoes alone',async t=>{
 const {p,scene,root}=await setup(t);
 await p.changeSceneObject(scenePath,{...operation,collision:{kind:'mesh',material:9,doubleSided:false}},hash(scene));
 await p.changeSceneObject(scenePath,{...operation,name:'BOX',position:[15,0,5]},hash(await p.read(scenePath)));
 const manualPoints=[[12,0,12],[12,3,12],[12,0,14]],manual=editCollision(await p.read(klzPath),[{kind:'add',array:'triangles',changes:{points:manualPoints,material:21}}]).bytes;
 await p.change(klzPath,manual,'Independent manual surface');const beforeScene=await p.read(scenePath),oldOwners=collisionOwnership(p.manifest,scenePath),oldModel=await p.read('models/crate.4ds');
 await p.saveGeometry('models/crate.4ds',{mesh:1,levels:[{lod:0,recomputeNormals:false,vertices:[{index:1,position:[4,2,0]}]}]},hash(oldModel));const model=await p.read('models/crate.4ds'),history=p.manifest.history.length,map=await p.inspectMap(scenePath);
 assert.deepEqual(await p.read(klzPath),manual);
 assert.deepEqual(await p.rebuildSceneCollision(scenePath,map.sha256,map.collision.sha256),{count:2,changed:true});
 const result=await p.read(klzPath),q=parseCollision(result),original=parseCollision(manual),next=await p.inspectMap(scenePath);
 assert.equal(p.manifest.history.length,history+1);assert.deepEqual(p.manifest.history.at(-1).files.map(f=>f.path),[klzPath]);assert.deepEqual(await p.read(scenePath),beforeScene);assert.deepEqual(await p.read('models/crate.4ds'),model);
 assert.equal(next.collision.surfaces[0].material,9);assert.equal(next.collision.surfaces[0].doubleSided,false);assert(next.collision.surfaces[0].positions.some((n,i,a)=>i%3===0&&n===9&&a[i+1]===2));assert.deepEqual(next.collision.boxes[0].max,[19,4,8]);
 assert.deepEqual(q.primitives.triangles.records[0].raw,original.primitives.triangles.records[0].raw);assert.deepEqual(q.primitives.aabbs.records[0].raw,original.primitives.aabbs.records[0].raw);
 for(const name of ['xtobbs','obbs','spheres','cylinders'])assert.deepEqual(q.primitives[name].raw,original.primitives[name].raw);
 assert.deepEqual(collisionTriangleVertices(q,q.primitives.triangles.records.find(r=>r.material===21)).sort(),manualPoints.sort());
 const reopened=await ModProject.open(root),destination=path.join(root,'rebuild-export');await reopened.export(destination);assert.deepEqual(await fs.readFile(path.join(destination,klzPath)),result);
 const length=reopened.manifest.history.length;assert.deepEqual(await reopened.rebuildSceneCollision(scenePath,next.sha256,next.collision.sha256),{count:2,changed:false});assert.equal(reopened.manifest.history.length,length);
 await reopened.undo();assert.deepEqual(await reopened.read(klzPath),manual);assert.deepEqual(collisionOwnership(reopened.manifest,scenePath),oldOwners);assert.deepEqual(await reopened.read('models/crate.4ds'),model);await reopened.undo();assert.deepEqual(await reopened.read('models/crate.4ds'),oldModel);
});
test('collision rebuild refuses stale scene/KLZ, unsupported paths and changed ownership without publishing',async t=>{
 const {p,scene}=await setup(t),history=p.manifest.history.length;
 assert.deepEqual(await p.rebuildSceneCollision(scenePath,hash(scene),hash(await p.read(klzPath))),{count:0,changed:false});assert.equal(p.manifest.history.length,history);
 await p.changeSceneObject(scenePath,{...operation,collision:{kind:'mesh',material:9}},hash(scene));const map=await p.inspectMap(scenePath),bytes=await p.read(klzPath),h=p.manifest.history.length;
 await assert.rejects(p.rebuildSceneCollision('models/crate.4ds',map.sha256,map.collision.sha256),/scene2/);
 await assert.rejects(p.rebuildSceneCollision(scenePath,'stale',map.collision.sha256),/od otevření/);
 await assert.rejects(p.rebuildSceneCollision(scenePath,map.sha256,'stale'),/Kolize se/);
 await assert.rejects(p.rebuildSceneCollision(scenePath,map.sha256),/aktuální/);
 assert.equal(p.manifest.history.length,h);assert.deepEqual(await p.read(klzPath),bytes);
 const q=parseCollision(bytes);bytes.writeFloatLE(123,q.extraVertices.byteOffset-q.bytes.byteOffset+36);await writeSafe(p.root,p.asset(klzPath).overlay,bytes);
 await assert.rejects(p.rebuildSceneCollision(scenePath,map.sha256,hash(bytes)),/mimo editor/);assert.equal(p.manifest.history.length,h);assert.deepEqual(await p.read(klzPath),bytes);
});
test('collision rebuild protects source geometry and rolls back failed publication independently from model editing',async t=>{
 const {p,scene}=await setup(t);await add(p,scene);const oldModel=await p.read('models/crate.4ds');
 await p.saveGeometry('models/crate.4ds',{mesh:1,levels:[{lod:0,recomputeNormals:false,vertices:[{index:1,position:[4,2,0]}]}]},hash(oldModel));
 const map=await p.inspectMap(scenePath),klz=await p.read(klzPath),owners=collisionOwnership(p.manifest,scenePath),history=p.manifest.history.length,save=p.saveManifest;
 p.saveManifest=async()=>{throw Error('rebuild publish failed');};await assert.rejects(p.rebuildSceneCollision(scenePath,map.sha256,map.collision.sha256),/publish failed/);p.saveManifest=save;
 assert.deepEqual(await p.read(klzPath),klz);assert.equal(p.manifest.history.length,history);assert.deepEqual(collisionOwnership(p.manifest,scenePath),owners);
 const batch=p.changeBatch;p.changeBatch=async function(...args){await this.change('models/crate.4ds',oldModel,'Independent geometry edit');return batch.apply(this,args);};
 await assert.rejects(p.rebuildSceneCollision(scenePath,map.sha256,map.collision.sha256),/od otevření/);assert.deepEqual(await p.read(klzPath),klz);assert.equal(p.manifest.history.length,history+1);assert.deepEqual(collisionOwnership(p.manifest,scenePath),owners);
});
