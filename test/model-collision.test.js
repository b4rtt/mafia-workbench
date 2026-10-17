import test from 'node:test';
import assert from 'node:assert/strict';
import { modelCollisionBox } from '../src/core/model-collision.js';
import { modelCollisionFrameSurfaces } from '../src/core/model-collision.js';
const identity={position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]};
const mesh=(id,extra={})=>({...identity,id,type:1,parent:0,culling:1,lods:[{positions:[0,0,0,2,0,0,0,4,3,999,999,999],faces:[{indices:[0,1,2]}]}],...extra});
const object={...identity,id:'object',name:'crate',frameType:9,model:'crate.i3d',parent:'Primary sector'};
function box(model,override={},scene=[],geometry=[]){const current={...object,...override};return modelCollisionBox({meshes:model},current,{objects:[current,...scene]},{meshes:geometry});}
const close=(values,expected)=>values.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<1e-6,`${values} vs ${expected}`));
test('collision bounds follow native LS3D rotation, model parents, scene parents and scale, excluding unused vertices',()=>{
  const result=box([mesh(1,{position:[1,0,0]}),mesh(2,{parent:1,position:[0,0,10]})],{position:[10,1,20],rotation:[Math.SQRT1_2,0,Math.SQRT1_2,0],scale:[2,1,1]});
  close(result.min,[-3,1,22]);close(result.max,[10,5,26]);
  const nested=box([mesh(1)],{parent:'parent',position:[1,0,2]},[{...identity,name:'parent',parent:'geometry',position:[10,0,0]}],[{...identity,id:1,name:'geometry',parent:0,position:[0,3,4]}]);
  close(nested.min,[11,3,6]);close(nested.max,[13,7,9]);
});
test('bounds resolve instanced geometry and hide disabled visuals while retaining children of hidden surfaces',()=>{
  const source=mesh(1,{renderFlags:0x40}),instance=mesh(2,{instance:1,lods:[],position:[10,0,0]}),hidden=mesh(3,{culling:0,position:[999,0,0]}),child=mesh(4,{parent:3}),sector=mesh(5,{properties:'SECT',position:[999,0,0]});
  assert.deepEqual(box([source,instance,hidden,child,sector]),{name:'crate',min:[10,0,0],max:[12,4,3]});
  const withChild=box([source,mesh(2,{parent:1,position:[1,0,0]})]);assert.deepEqual(withChild.min,[1,0,0]);
  const flat=box([mesh(1,{lods:[{positions:[0,0,0,2,0,0,0,0,3],faces:[{indices:[0,1,2]}]}]})]);assert.deepEqual(flat.min,[0,-.01,0]);assert.deepEqual(flat.max,[2,.01,3]);
});
test('collision generation rejects dynamic meshes, ambiguous or cyclic hierarchy and invalid geometry',()=>{
  assert.throws(()=>box([mesh(1)],{actorBound:true}),/statický/);
  assert.throws(()=>box([mesh(1,{skin:[{}]})]),/dynamické/);
  assert.throws(()=>box([mesh(1)],{parent:'missing'}),/rodič/);
  assert.throws(()=>box([mesh(1)],{},[{...object}]),/nejednoznačný/);
  assert.throws(()=>box([mesh(1)],{parent:'loop'},[{...identity,name:'loop',parent:'crate'}]),/cyklická/);
  assert.throws(()=>box([mesh(1,{parent:1})]),/cyklická/);
  assert.throws(()=>box([mesh(1,{instance:1})]),/cyklická/);
  assert.throws(()=>box([mesh(1,{lods:[{positions:[0,0,0],faces:[{indices:[1]}]}]})]),/vertex/);
  assert.throws(()=>box([mesh(1,{renderFlags:0x40})]),/povrch/);
});

test('surface extraction uses transformed visible faces, reports degenerates and resolves imported geometry vertices',async()=>{
  const {modelCollisionSurface,geometryCollisionResolver}=await import('../src/core/model-collision.js');
  const current={...object,position:[10,0,20],scale:[2,1,1]},model={meshes:[mesh(1,{position:[1,0,0]}),mesh(2,{renderFlags:0x40,position:[999,0,0]})]};
  const result=modelCollisionSurface(model,current,{objects:[current]},{meshes:[]});assert.deepEqual(result.positions,[12,0,20,16,0,20,12,4,23]);assert.deepEqual(result.indices,[0,1,2]);assert.equal(result.degenerate,0);
  const geometry={meshes:[mesh(1,{name:'wall',position:[5,0,0]}),mesh(2,{name:'copy',position:[15,0,0],instance:1,lods:[]})]};
  const resolver=geometryCollisionResolver({objects:[]},geometry);assert.deepEqual(resolver('COPY',[0,1,2]),[[15,0,0],[17,0,0],[15,4,3]]);assert.throws(()=>resolver('missing',[0,1,2]),/jednoznačný/);
  const degenerate={meshes:[mesh(1,{lods:[{positions:[0,0,0,1,0,0,2,0,0],faces:[{indices:[0,1,2]}]}]})]};assert.throws(()=>modelCollisionSurface(degenerate,object,{objects:[object]},{meshes:[]}),/nedegenerovaný/);
});

test('native surface parts retain complete LOD indices, hierarchy, instances and opaque filtering',()=>{
  const source=mesh(1,{name:'Source',renderFlags:0x40}),instance=mesh(2,{name:'Instance',instance:1,lods:[],position:[5,0,0]}),child=mesh(3,{name:'Child',parent:2,position:[0,2,0]}),hidden=mesh(4,{name:'Hidden',culling:0});
  const parts=modelCollisionFrameSurfaces({meshes:[source,instance,child,hidden]},object,{objects:[object]},{meshes:[]});
  assert.deepEqual(parts.map(p=>p.frame),['crate.Instance','crate.Child']);assert.deepEqual(parts[0].indices,[0,1,2]);assert.equal(parts[0].positions.length,12);assert.deepEqual(parts[0].positions.slice(9),[1004,999,999]);assert.deepEqual(parts[1].positions.slice(0,3),[5,2,0]);
  const model={materials:[{flags:0,opacity:1},{flags:0x8000,opacity:1}],meshes:[mesh(1,{name:'Tree',lods:[{positions:[0,0,0,2,0,0,0,4,3,9,9,9],faces:[{material:1,indices:[2,0,1]},{material:2,indices:[0,2,3]}]}]})]};
  assert.deepEqual(modelCollisionFrameSurfaces(model,object,{objects:[object]},{meshes:[]},{opaqueOnly:true})[0].indices,[2,0,1]);
});
