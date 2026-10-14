import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {terrainBrush,terrainNeighbors} from '../src/shared/terrain-brush.js';
import {geometryPreview} from '../src/shared/geometry-draft.js';
import {terrainModel} from '../src/shared/terrain.js';
import {createTerrainBytes} from '../src/core/terrain.js';
import {inspectModelGeometry,editModelGeometry} from '../src/core/model-geometry.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';

const options={name:'BRUSH',texture:'maps/ground.bmp',width:20,depth:20,columns:4,rows:4,heights:[0,0,0,0],tileSize:4};
const flat=()=>terrainModel(options).meshes[0].lods[0];
const brush={mode:'raise',center:[0,0],radius:10,amount:2};

test('height brush has smooth radial falloff, preserves X/Z and leaves the boundary, UV, faces and source unchanged',()=>{
 const lod=flat(),before=structuredClone(lod),changes=terrainBrush(lod,brush),result=geometryPreview(lod,changes,true);
 assert.deepEqual(lod,before);assert.equal(result.positions[12*3+1],2);assert.equal(result.positions[11*3+1],1);assert.equal(result.positions[10*3+1],0);assert.equal(result.positions[0*3+1],0);
 assert.equal(changes.length,9);for(let at=0;at<lod.positions.length;at++)if(at%3!==1)assert.equal(result.positions[at],lod.positions[at]);
 assert.deepEqual(result.uv,lod.uv);assert.deepEqual(result.faces,lod.faces);assert(result.normals.every(Number.isFinite));
 const restored=geometryPreview(result,terrainBrush(result,{...brush,mode:'lower'}));assert(restored.positions.every((value,i)=>Math.abs(value-lod.positions[i])<1e-7));
 assert.deepEqual(terrainBrush(lod,{...brush,center:[100,100]}),[]);
});
test('flatten blends towards the target without overshooting and smoothing uses the original topological neighbors',()=>{
 const lod=flat(),raised=geometryPreview(lod,terrainBrush(lod,{...brush,radius:4,amount:8}));
 const flatten=geometryPreview(raised,terrainBrush(raised,{mode:'flatten',center:[0,0],radius:10,height:2,strength:.5}));assert.equal(flatten.positions[37],5);assert.equal(flatten.positions[34],.5);
 const adjacency=terrainNeighbors(lod);assert.equal(adjacency[12].length,6);assert.equal(adjacency[0].length,2);assert(!adjacency[12].includes(12));
 const smooth=geometryPreview(raised,terrainBrush(raised,{mode:'smooth',center:[0,0],radius:10,strength:1},adjacency));assert.equal(smooth.positions[37],0);
 assert.equal(smooth.positions[34],Math.fround(8/6*.5));assert.equal(raised.positions[37],8);assert.equal(raised.positions[34],0);
 const isolated={vertices:1,positions:[0,7,0],faces:[]};assert.deepEqual(terrainBrush(isolated,{mode:'smooth',center:[0,0],radius:10,strength:1}),[]);
});
test('brush rejects invalid settings and float32 overflow before any source mutation',()=>{
 const lod=flat(),before=structuredClone(lod);
 for(const params of [{mode:'bad'},{center:[NaN,0]},{radius:0},{radius:32769},{amount:-1},{amount:Infinity},{mode:'flatten',strength:0,height:0},{mode:'flatten',strength:1,height:Infinity},{mode:'smooth',strength:2}])assert.throws(()=>terrainBrush(lod,{...brush,...params}));
 const extreme={vertices:1,positions:[0,3.4028234663852886e38,0],faces:[]};assert.throws(()=>terrainBrush(extreme,{mode:'flatten',center:[0,0],radius:1,height:3.4028235677973366e38,strength:1}));
 assert.deepEqual(lod,before);
});
test('brush changes serialize through the native geometry writer with byte-local positions/normals and untouched model data',()=>{
 const source=createTerrainBytes(options),context=inspectModelGeometry(source,1),lod=context.mesh.lods[0],changes=terrainBrush(lod,brush),result=editModelGeometry(source,{mesh:1,levels:[{lod:0,vertices:changes,recomputeNormals:true}]}),actual=inspectModelGeometry(result,1).mesh.lods[0],preview=geometryPreview(lod,changes,true);
 assert.deepEqual(actual.positions,preview.positions);assert.deepEqual(actual.normals,preview.normals);assert.deepEqual(actual.rawUV??actual.uv,lod.rawUV??lod.uv);assert.deepEqual(actual.faces,lod.faces);
 const allowed=new Set();for(let i=0;i<lod.vertices;i++)for(let b=12;b<24;b++)allowed.add(lod.vertexOffset+i*32+b);for(const change of changes)for(let b=0;b<12;b++)allowed.add(lod.vertexOffset+change.index*32+b);
 for(let i=0;i<source.length;i++)if(!allowed.has(i))assert.equal(result[i],source[i],`unchanged byte ${i}`);
});
test('sculpted terrain saves as one guarded geometry operation, exports, reopens and has exact undo',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-brush-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const bytes=createTerrainBytes(options),asset={path:'models/brush.4ds',original:'originals/custom/models/brush.4ds',sha256:hash(bytes),size:bytes.length,archive:'custom',variants:[{}]};await writeSafe(root,asset.original,bytes);await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Brush',assets:[asset],history:[]}));
 let p=await ModProject.open(root);const context=await p.modelGeometry(asset.path,1),vertices=terrainBrush(context.mesh.lods[0],brush),request={mesh:1,levels:[{lod:0,vertices,recomputeNormals:true}]};await assert.rejects(p.saveGeometry(asset.path,request,'stale'),/změnil/);assert.equal(p.manifest.history.length,0);
 await p.saveGeometry(asset.path,request,context.sha256);assert.equal(p.manifest.history.length,1);p=await ModProject.open(root);await p.export(path.join(root,'export'));assert.deepEqual(await fs.readFile(path.join(root,'export',asset.path)),editModelGeometry(bytes,request));await p.undo();assert.deepEqual(await p.read(asset.path),bytes);assert.deepEqual(await fs.readFile(path.join(root,asset.original)),bytes);
});
