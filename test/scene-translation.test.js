import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Vector3 } from 'three';
import { planSceneTranslation } from '../src/shared/scene-translation.js';
import { sceneWorld } from '../src/shared/scene-world.js';
import { inspectScene, editScene, changeSceneObject } from '../src/core/scene.js';
import { parseFourDs, editFourDs } from '../src/core/fourds.js';
import { ModProject } from '../src/core/project.js';
import { hash, writeSafe } from '../src/core/files.js';
import { sectorFixture } from './sector-fixture.js';

const near=(a,b)=>a.forEach((value,i)=>assert.ok(Math.abs(value-b[i])<1e-4,`${a} != ${b}`));
const object=(id,name,parent,position,type=9)=>({id,name,parent,position,frameType:type,rotation:[1,0,0,0],scale:[1,1,1],fields:{position:id+'/pos'}});
function fixture(){
  const geometry={meshes:[{id:0,name:'Room',position:[20,3,-10],rotation:[Math.cos(.3),0,Math.sin(.3),0],scale:[-2,3,4]}]};
  const scene={objects:[object('p','Parent','rOoM',[2,4,6]),object('c','Child','parent',[3,2,1]),object('g','Grandchild','Child',[4,0,-1],4),object('o','Other','Primary sector',[50,3,20],2)]};
  return {scene,geometry};
}
function apply(scene,changes){return {...scene,objects:scene.objects.map(object=>({...object,position:changes.find(change=>change.id===object.fields.position)?.value??object.position}))};}
const position=(scene,geometry,name)=>new Vector3().setFromMatrixPosition(sceneWorld(scene,geometry)(name)).toArray();

test('common world translation handles different parents, rotation, nonuniform scale, reflection and selected descendants once',()=>{
  const {scene,geometry}=fixture(),offset=[7,-2,5],before=structuredClone(scene);
  for(const ids of [['c','o'],['p','c','g','o'],['g','p']]){
    const plan=planSceneTranslation(scene,geometry,{ids,offset}),after=apply(scene,plan.changes);
    for(const name of ids.map(id=>scene.objects.find(object=>object.id===id).name))near(position(after,geometry,name),position(scene,geometry,name).map((value,i)=>value+offset[i]));
    assert.deepEqual(scene,before);
    if(ids.includes('p')){assert(!plan.changes.some(change=>change.id==='c/pos'||change.id==='g/pos'));near(position(after,geometry,'Grandchild'),position(scene,geometry,'Grandchild').map((v,i)=>v+offset[i]));}
    else assert.deepEqual(after.objects[0],before.objects[0]);
  }
  assert.deepEqual(planSceneTranslation(scene,geometry,{ids:['p','c','g'],offset}).inherited,['c','g']);
  assert.equal(planSceneTranslation(scene,geometry,{ids:['p','c'],offset:[0,0,0]}).changes.length,0);
});
test('common translation inherits geometry parent/default transforms and rejects ambiguous, cyclic, singular or unsupported selections',()=>{
  const {scene,geometry}=fixture();
  for(const request of [{ids:[],offset:[1,0,0]},{ids:['p','p'],offset:[1,0,0]},{ids:['missing'],offset:[1,0,0]},{ids:['p'],offset:[NaN,0,0]},{ids:['p'],offset:[1e100,0,0]},{ids:Array(257).fill('p'),offset:[1,0,0]}])assert.throws(()=>planSceneTranslation(scene,geometry,request));
  assert.throws(()=>planSceneTranslation({...scene,objects:[...scene.objects,{...scene.objects[0],id:'dup',name:'PARENT'}]},geometry,{ids:['p'],offset:[1,0,0]}),/nejednoznačný/);
  assert.throws(()=>planSceneTranslation({...scene,objects:scene.objects.map(o=>o.id==='p'?{...o,parent:'Grandchild'}:o)},geometry,{ids:['p'],offset:[1,0,0]}),/cyklická/);
  assert.throws(()=>planSceneTranslation(scene,{meshes:[{...geometry.meshes[0],scale:[0,1,1]}]},{ids:['p'],offset:[1,0,0]}),/nevratnou/);
  assert.throws(()=>planSceneTranslation({objects:[object('s','Sector','Primary sector',[0,0,0],5)]},{meshes:[]},{ids:['s'],offset:[1,0,0]}),/sektor/);
  const geo=parseFourDs(sectorFixture()),s={objects:[{...object('a','after',undefined,[1,2,3]),frameType:undefined}]};geo.meshes[1].parent=geo.meshes[0].id;
  const plan=planSceneTranslation(s,geo,{ids:['a'],offset:[10,20,30]});near(position(apply(s,plan.changes),geo,'after'),position(s,geo,'after').map((value,i)=>value+[10,20,30][i]));
});

const chunk=(type,data)=>{const h=Buffer.alloc(6);h.writeUInt16LE(type);h.writeUInt32LE(data.length+6,2);return Buffer.concat([h,data]);};
test('project common translation guards both revisions, failed publication and staging; export/reopen/one undo preserve exact bytes',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-translation-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:2,name:'Move',assets:[],history:[]}));
  const p=await ModProject.open(root),name='missions/Test/scene2.bin',geometry='missions/Test/scene.4ds';let bytes=chunk(0x4c53,Buffer.concat([chunk(0x4000,Buffer.alloc(0)),chunk(0xbeef,Buffer.from('opaque'))]));
  for(const name of ['A','B'])bytes=changeSceneObject(bytes,{kind:'add-model',name,model:'crate.i3d',position:[1,2,3],rotation:[1,0,0,0],scale:[1,1,1]});
  await p.createFiles([{path:name,data:bytes},{path:geometry,data:sectorFixture()},{path:'protected.bin',data:Buffer.from('protected')}]);
  const map=await p.inspectMap(name),request={ids:map.objects.map(o=>o.id),offset:[10,20,30]},history=p.manifest.history.length;
  for(const hashes of [['stale',map.geometry.sha256],[map.sha256,'stale']])await assert.rejects(()=>p.translateSceneObjects(name,request,...hashes),/změnila/);
  const publish=p.saveManifest;p.saveManifest=async()=>{throw Error('Publish failed');};await assert.rejects(()=>p.translateSceneObjects(name,request,map.sha256,map.geometry.sha256),/Publish failed/);p.saveManifest=publish;assert.deepEqual(await p.read(name),bytes);assert.equal(p.manifest.history.length,history);
  const batch=p.changeBatch;p.changeBatch=async function(files,...args){await this.change(geometry,editFourDs(sectorFixture(),[{id:'meshes/0/position',value:[1,0,0]}]),'Concurrent geometry');return batch.call(this,files,...args);};await assert.rejects(()=>p.translateSceneObjects(name,request,map.sha256,map.geometry.sha256),/změnil/);p.changeBatch=batch;assert.deepEqual(await p.read(name),bytes);await p.undo();
  await p.translateSceneObjects(name,request,map.sha256,map.geometry.sha256);assert.equal(p.manifest.history.length,history+1);
  const after=await p.read(name);let expected=bytes;for(const o of map.objects)expected=editScene(expected,o.fields.position,[11,22,33]);assert.deepEqual(after,expected);
  const reopened=await ModProject.open(root);await reopened.export(root+'/export');assert.deepEqual(await fs.readFile(root+'/export/'+name),expected);await reopened.translateSceneObjects(name,{...request,offset:[0,0,0]},hash(after),map.geometry.sha256);assert.equal(reopened.manifest.history.length,history+1);
  await reopened.undo();assert.deepEqual(await reopened.read(name),bytes);assert.deepEqual(await reopened.read(geometry),sectorFixture());assert.equal((await reopened.read('protected.bin')).toString(),'protected');assert.equal(reopened.manifest.history.length,history);
});
