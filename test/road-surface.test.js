import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { roadSurfaceModel } from '../src/shared/road-surface.js';
import { roadConnections } from '../src/shared/roads.js';
import { parseRoads } from '../src/core/roads.js';
import { changeRoadTopology } from '../src/core/road-topology.js';
import { createRoadSurfaceBytes } from '../src/core/road-surface.js';
import { createTerrainBytes } from '../src/core/terrain.js';
import { parseFourDs } from '../src/core/fourds.js';
import { editModelGeometry } from '../src/core/model-geometry.js';
import { modelCollisionSurface } from '../src/core/model-collision.js';
import { ModProject } from '../src/core/project.js';
import { hash,writeSafe } from '../src/core/files.js';

const defaults={name:'WB_STREET',from:0,roadTexture:'maps/asphalt.bmp',sidewalkTexture:'maps/paving.bmp',curbTexture:'maps/curb.bmp',width:8,sidewalkWidth:2,curbHeight:.15,roadTileLength:8,roadTileWidth:8,sidewalkTileSize:2,curbTileLength:1,heightOffset:0};
function route(points){
  let data=Buffer.alloc(12);data.writeUInt32LE(2);
  for(const position of [points[0],points.at(-1)])data=changeRoadTopology(data,{action:'create-crossing',position,speed:10,semaphore:0}).data;
  data=changeRoadTopology(data,{action:'connect',from:0,to:1,positions:points.slice(1,-1),speed:10}).data;
  const file=parseRoads(data),options={...defaults,slot:roadConnections(file,0)[0].slot};return {data,file,options};
}
const xyz=(lod,index)=>lod.positions.slice(index*3,index*3+3);
test('street spans the original route with distinct roadway, raised sidewalks and outward hard curb normals',()=>{
  const {file,options}=route([[10,2,20],[10,4,40],[10,6,60]]),model=roadSurfaceModel(file,options),lod=model.meshes[0].lods[0];
  const has=p=>Array.from({length:lod.vertices},(_,i)=>xyz(lod,i)).some(q=>q.every((n,i)=>Math.abs(n-p[i])<1e-5));
  for(const p of [[6,2,20],[14,2,20],[6,6,60],[4,2.15,20],[6,2.15,20]])assert(has(p));
  const n=i=>lod.normals.slice(i*3,i*3+3);
  for(const index of lod.faces[0].indices){assert(n(index)[1]>0);assert(Math.abs(n(index)[2]+.1*n(index)[1])<1e-6);}
  assert(lod.faces[2].indices.some(i=>n(i)[0]<-.999));assert(lod.faces[2].indices.some(i=>n(i)[0]>.999));assert(lod.faces[2].indices.some(i=>n(i)[2]<-.999));assert(lod.faces[2].indices.some(i=>n(i)[2]>.999));
  assert.equal(lod.faces.length,3);assert.deepEqual(lod.faces.map(f=>f.indices.length/3),[4,8,24]);
  assert.deepEqual(model.meshes[0].position,[0,0,0]);assert.deepEqual(model.materials.map(m=>m.texture),['asphalt.bmp','paving.bmp','curb.bmp']);
  for(let i=0;i<lod.normals.length;i+=3)assert(Math.abs(Math.hypot(...lod.normals.slice(i,i+3))-1)<1e-6);
});
test('street unfolds bend and slope triangles with physical texture density, preserving native geometry and collision',()=>{
  const {file,options}=route([[0,0,0],[0,2,20],[20,4,20]]),model=roadSurfaceModel(file,options),lod=model.meshes[0].lods[0];
  assert(lod.positions.some((v,i)=>i%3===0&&v===-4&&lod.positions[i+1]===2&&lod.positions[i+2]===24));
  for(const [group,stripScale]of [[0,[8,8]],[1,[2,2]],[2,[.15,1]]])for(let at=0;at<lod.faces[group].indices.length;at+=3){
    // End caps use transverse length in U and curb height in V; vertical
    // longitudinal strips use the opposite axes, matching the original BMP.
    const pair=Math.floor(at/6)*6,cap=group===2&&new Set(lod.faces[group].indices.slice(pair,pair+6)).size===4,scale=cap?[1,.15]:stripScale;
    const ids=lod.faces[group].indices.slice(at,at+3);
    for(let i=0;i<3;i++){const a=ids[i],b=ids[(i+1)%3],distance=Math.hypot(...xyz(lod,a).map((v,j)=>v-xyz(lod,b)[j])),uvDistance=Math.hypot(...[0,1].map(j=>(lod.uv[a*2+j]-lod.uv[b*2+j])*scale[j]));assert(Math.abs(distance-uvDistance)<1e-5,'UV preserves triangle edge length on a non-planar bend');}
  }
  const native=parseFourDs(createRoadSurfaceBytes(file,options),'all');for(const field of ['positions','normals','uv','faces'])assert.deepEqual(native.meshes[0].lods[0][field],lod[field]);
  const object={name:'ROAD',frameType:9,model:'WB_STREET.i3d',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]};
  const collision=modelCollisionSurface(native,object,{objects:[object]},{meshes:[]});assert.equal(collision.indices.length/3,36);assert.deepEqual(collision.positions.slice(0,3),xyz(lod,0));assert.equal(collision.degenerate,0);
  const edited=editModelGeometry(createRoadSurfaceBytes(file,options),{mesh:1,levels:[{lod:0,vertices:[{index:1,position:[-4,3,24]}],recomputeNormals:true}]});assert.equal(parseFourDs(edited,'all').meshes[0].lods[0].positions[4],3);
  const backward={...options,from:1,slot:roadConnections(file,1)[0].slot},other=roadSurfaceModel(file,backward).meshes[0].lods[0],sorted=positions=>Array.from(new Set(Array.from({length:positions.length/3},(_,i)=>positions.slice(i*3,i*3+3).join(',')))).sort();assert.deepEqual(sorted(other.positions),sorted(lod.positions));
});
test('street rejects unsafe options, broken reciprocal routes, sharp turns, folded wide bends and self intersections',()=>{
  const {file,options}=route([[0,0,0],[0,0,20],[0,0,40]]);
  for(const extra of [{name:'../road'},{name:'NUL'},{name:'česká'},{roadTexture:'maps/a/b.bmp'},{sidewalkTexture:'../x.bmp'},{from:-1},{slot:7},{width:0},{sidewalkWidth:21},{curbHeight:0},{roadTileLength:Infinity},{sidewalkTileSize:NaN},{heightOffset:101}])assert.throws(()=>roadSurfaceModel(file,{...options,...extra}),/Ulice/);
  const broken=structuredClone(file);broken.crossings[1].links.fill(65535);assert.throws(()=>roadSurfaceModel(broken,options),/zpětnou/);
  for(const [points,pattern]of [
    [[[0,0,0],[0,1,.001],[0,2,30]],/blízko/],
    [[[0,0,0],[0,0,20],[1,0,0]],/ostrá/],
    [[[0,0,0],[0,0,3],[3,0,3]],/šířka/],
    [[[0,0,0],[0,0,60],[60,0,60],[60,0,-20],[-20,0,-20],[-20,0,30],[20,0,30]],/kříží/]
  ]){const r=route(points);assert.throws(()=>roadSurfaceModel(r.file,r.options),pattern);}
  const far=route([[32767,0,0],[32767,0,20],[32767,0,40]]);assert.throws(()=>roadSurfaceModel(far.file,far.options),/rozsah/);
});
test('shared new-surface serializer leaves terrain byte-for-byte unchanged',()=>{
  assert.equal(hash(createTerrainBytes({name:'WB_TERRAIN',texture:'maps/ground.bmp',width:20,depth:10,columns:2,rows:2,heights:[0,2,4,6],tileSize:5})),'6bce49351530bde17b4aa7ddd1883e662cdf8d1d30ec4b3f27dec86c65710f87');
});
function bmp(value){const b=Buffer.alloc(58);b.write('BM');b.writeUInt32LE(58,2);b.writeUInt32LE(54,10);b.writeUInt32LE(40,14);b.writeInt32LE(1,18);b.writeInt32LE(1,22);b.writeUInt16LE(1,26);b.writeUInt16LE(24,28);b.writeUInt32LE(4,34);b[54]=value;return b;}
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-street-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:2,name:'Street',assets:[],history:[]}));const p=await ModProject.open(root),r=route([[0,0,0],[0,2,20],[20,4,20]]),textures=[bmp(100),bmp(200),bmp(90)],source='missions/WB_STREET/road.bin';
  await p.createFiles([{path:source,data:r.data},{path:'MAPS/Asphalt.BMP',data:textures[0]},{path:'maps/Paving.bmp',data:textures[1]},{path:'maps/curb.bmp',data:textures[2]}]);return {p,root,...r,textures,source};
}
test('street asset creation guards source/textures, preserves network, exports/reopens, refuses duplicate paths and has exact undo',async t=>{
  const {p,root,data,file,options,textures,source}=await fixture(t),history=p.manifest.history.length,hashes=textures.map(hash);
  await assert.rejects(()=>p.createRoadSurface(source,options,'stale',hashes),/silniční/);
  await assert.rejects(()=>p.createRoadSurface(source,options,hash(data),[hashes[0],'stale']),/textura/);assert.equal(p.manifest.history.length,history);
  const target=await p.createRoadSurface(source,options,hash(data),hashes),expected=createRoadSurfaceBytes(file,options);assert.deepEqual(await p.read(target),expected);assert.deepEqual(await p.read(source),data);assert.equal(p.manifest.history.length,history+1);
  await assert.rejects(()=>p.createRoadSurface(source,{...options,name:'wb_street'},hash(data),hashes),/existuje/);
  const reopened=await ModProject.open(root);await reopened.export(path.join(root,'export'));assert.deepEqual(await fs.readFile(path.join(root,'export',target)),expected);assert.equal((await reopened.modelGeometry(target,1)).mesh.lods[0].faces.length,3);
  await reopened.undo();assert.throws(()=>reopened.asset(target),/není v projektu/);assert.deepEqual(await reopened.read(source),data);for(let i=0;i<3;i++)assert.deepEqual(await reopened.read([options.roadTexture,options.sidewalkTexture,options.curbTexture][i]),textures[i]);
});
test('street publication failure and changes during publish leave no visible unguarded model',async t=>{
  const {p,options,data,textures,source}=await fixture(t),history=p.manifest.history.length,hashes=textures.map(hash);
  p.saveManifest=async()=>{throw Error('publish failed');};await assert.rejects(()=>p.createRoadSurface(source,options,hash(data),hashes),/publish failed/);assert.equal(p.manifest.history.length,history);assert.throws(()=>p.asset('models/WB_STREET.4ds'));
  p.saveManifest=ModProject.prototype.saveManifest;const create=p.createFiles;
  for(const dependency of [source,options.sidewalkTexture,options.curbTexture]){
    p.createFiles=async function(...args){await this.change(dependency,dependency===source?changeRoadTopology(data,{action:'create-crossing',position:[100,0,100],speed:10,semaphore:0}).data:bmp(7),'Independent edit');return create.apply(this,args);};
    await assert.rejects(()=>p.createRoadSurface(source,options,hash(data),hashes),/Závislý/);assert.throws(()=>p.asset('models/WB_STREET.4ds'));await p.undo();assert.equal(p.manifest.history.length,history);
  }
});
