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

const scenePath='missions/NEW/scene2.bin',klzPath='missions/NEW/tree.klz';
const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;},floats=values=>{const b=Buffer.alloc(values.length*4);values.forEach((n,i)=>b.writeFloatLE(n,i*4));return b;};
const chunk=(type,data)=>{const h=Buffer.alloc(6);h.writeUInt16LE(type);h.writeUInt32LE(data.length+6,2);return Buffer.concat([h,data]);};
async function setup(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-collision-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const manifest={format:'mafia-workbench',version:1,name:'Collision fixture',assets:[],history:[]};await writeSafe(root,'workbench.json',JSON.stringify(manifest));const p=await ModProject.open(root);
  const empty=Buffer.alloc(19);empty.write('4DS\0');empty.writeUInt16LE(29,4);empty[18]=1;
  const model=Buffer.concat([empty.subarray(0,14),u16(0),u16(1),Buffer.from([1,0,0,0]),u16(0),floats([0,0,0,1,1,1,1,0,0,0]),Buffer.from([1,5]),Buffer.from('crate'),Buffer.from([0]),u16(0),Buffer.from([1]),floats([0]),u16(3),floats([0,0,0,0,1,0,0,0,2,0,0,0,1,0,0,0,0,4,3,0,1,0,0,0]),Buffer.from([1]),u16(1),u16(0),u16(1),u16(2),u16(0),Buffer.from([1])]);
  const scene=chunk(0x4c53,chunk(0x4000,Buffer.alloc(0))),klz=collisionFixture();
  await p.createFiles([{path:scenePath,data:scene},{path:'missions/NEW/scene.4ds',data:empty},{path:'models/Crate.4ds',data:model},{path:klzPath,data:klz}]);return {p,root,scene,klz};
}
const operation={kind:'add-model',name:'WB_CRATE',model:'models/crate.4ds',position:[5,0,5],rotation:[1,0,0,0],scale:[1,1,1],collision:{kind:'aabb',material:7}};
async function add(p,scene){await p.changeSceneObject(scenePath,operation,hash(scene));return p.read(scenePath);}

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
