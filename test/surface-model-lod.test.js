import test from 'node:test';
import assert from 'node:assert/strict';
import {writeSurfaceModel} from '../src/core/surface-model.js';
import {parseFourDs} from '../src/core/fourds.js';
import {inspectModelGeometry,editModelGeometry} from '../src/core/model-geometry.js';
import {modelCollisionFrameSurfaces} from '../src/core/model-collision.js';
const identity={position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]},lod=(distance,extra={})=>({distance,vertices:3,positions:[0,0,0,0,2,0,2,0,0],normals:[0,0,-1,0,0,-1,0,0,-1],uv:[0,0,0,1,1,0],faces:[{material:1,indices:[0,1,2]}],...extra});
const model=()=>({materials:[{flags:0x00840001,ambient:[1,1,1],diffuse:[1,1,1],emission:[0,0,0],opacity:1,texture:'wall.bmp'}],meshes:[{...identity,id:1,name:'House',type:1,visual:0,renderFlags:0,logicFlags:0x2a,culling:9,parent:0,lods:[lod(10000),lod(0,{positions:[0,0,0,0,1,0,1,0,0]})]}]});
test('generated multi-LOD visuals keep all buffers, distances, material groups and following meshes aligned',()=>{
  const m=model();m.materials.push({...m.materials[0],texture:'other.bmp'});m.meshes[0].lods[1].faces.push({material:2,indices:[2,1,0]});m.meshes.push({...m.meshes[0],id:2,name:'Following',lods:[lod(0)]});const p=parseFourDs(writeSurfaceModel(m),'all');assert.equal(p.meshes.length,2);assert.equal(p.meshes[1].name,'Following');assert.equal(p.meshes[1].lods.length,1);for(const[i,l]of p.meshes[0].lods.entries())for(const key of['distance','vertices','positions','normals','uv','faces'])assert.deepEqual(l[key],m.meshes[0].lods[i][key]);assert.equal(p.animated,0);
  m.meshes[0].lods=Array.from({length:10},(_,i)=>lod(i===9?0:100*(i+1)));assert.equal(parseFourDs(writeSurfaceModel(m),'all').meshes[0].lods.length,10);
});
test('LOD0 collision buffers and indices stay exact when lower details are added',()=>{
  const m=model(),single=structuredClone(m);single.meshes[0].lods=[single.meshes[0].lods[0]];const object={...identity,name:'HOUSE',frameType:9,model:'house.i3d'},collision=b=>modelCollisionFrameSurfaces(parseFourDs(b,'all'),object,{objects:[object]},{meshes:[]});const surfaces=collision(writeSurfaceModel(m));assert.equal(surfaces.length,1);assert.deepEqual(surfaces[0].positions,m.meshes[0].lods[0].positions);assert.deepEqual(surfaces[0].indices,[0,1,2]);assert.deepEqual(surfaces,collision(writeSurfaceModel(single)));
});
test('normal model geometry editor can edit a generated lower LOD while preserving high detail',()=>{
  const bytes=writeSurfaceModel(model()),context=inspectModelGeometry(bytes,1);assert.equal(context.mesh.lods.length,2);const changed=editModelGeometry(bytes,{mesh:1,levels:[{lod:1,recomputeNormals:false,vertices:[{index:1,position:[0,1.5,0]}]}]}),parsed=parseFourDs(changed,'all');assert.deepEqual(parsed.meshes[0].lods[0],parseFourDs(bytes,'all').meshes[0].lods[0]);assert.equal(parsed.meshes[0].lods[1].positions[4],1.5);
});
test('multi-LOD writer rejects incomplete or overflowing extra geometry rather than silently discarding it',()=>{
  for(const patch of [{distance:NaN},{distance:1e40},{distance:-1},{vertices:65536},{uv:[]},{normals:[Infinity]},{faces:[{material:2,indices:[0,1,2]}]},{faces:[{material:1,indices:[0,1,3]}]},{faces:[{material:1,indices:[0,1]}]},{faces:[null]},{faces:Array(1)},{faces:[{material:1,indices:Array(3)}]}]){const m=model();Object.assign(m.meshes[0].lods[1],patch);assert.throws(()=>writeSurfaceModel(m),/LOD/);}const absent=model();absent.meshes[0].lods[1]=null;assert.throws(()=>writeSurfaceModel(absent),/LOD/);for(const count of[0,11]){const m=model();m.meshes[0].lods=Array.from({length:count},()=>lod(0));assert.throws(()=>writeSurfaceModel(m),/1–10 LOD/);}
});
