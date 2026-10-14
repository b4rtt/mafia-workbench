import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {terrainModel} from '../src/shared/terrain.js';
import {createTerrainBytes} from '../src/core/terrain.js';
import {parseFourDs} from '../src/core/fourds.js';
import {editModelGeometry} from '../src/core/model-geometry.js';
import {modelCollisionSurface} from '../src/core/model-collision.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';
const options={name:'WB_TERRAIN',texture:'maps/ground.bmp',width:20,depth:10,columns:2,rows:2,heights:[0,2,4,6],tileSize:5};
const bmp=()=>{const b=Buffer.alloc(58);b.write('BM');b.writeUInt32LE(58,2);b.writeUInt32LE(54,10);b.writeUInt32LE(40,14);b.writeInt32LE(1,18);b.writeInt32LE(1,22);b.writeUInt16LE(1,26);b.writeUInt16LE(24,28);b.writeUInt32LE(4,34);b[54]=255;return b;};
test('terrain has native upward winding, interpolated heights, metre UV repeat and normalized slope normals',()=>{
 const model=terrainModel(options),lod=model.meshes[0].lods[0];assert.equal(lod.vertices,9);assert.equal(lod.faces[0].indices.length,24);
 assert.deepEqual(lod.positions,[-10,0,-5,0,1,-5,10,2,-5,-10,2,0,0,3,0,10,4,0,-10,4,5,0,5,5,10,6,5]);assert.deepEqual(lod.uv.slice(0,6),[0,-0,2,-0,4,-0]);assert.deepEqual(lod.uv.slice(-2),[4,-2]);
 for(let i=0;i<lod.normals.length;i+=3){const n=lod.normals.slice(i,i+3);assert(Math.abs(Math.hypot(...n)-1)<1e-6);assert(n[1]>0);assert(Math.abs(n[0]+.1*n[1])<1e-6);assert(Math.abs(n[2]+.4*n[1])<1e-6);}
 const native=parseFourDs(createTerrainBytes(options),'all');assert.deepEqual(native.meshes[0].lods[0].positions,lod.positions);assert.deepEqual(native.meshes[0].lods[0].normals,lod.normals);assert.deepEqual(native.meshes[0].lods[0].faces,lod.faces);assert.equal(native.materials[0].texture,'ground.bmp');assert.equal(native.meshes[0].culling,9);assert.equal(native.meshes[0].logicFlags,0x2a);
 const edited=editModelGeometry(createTerrainBytes(options),{mesh:1,levels:[{lod:0,vertices:[{index:4,position:[0,9,0]}],recomputeNormals:true}]});assert.equal(parseFourDs(edited,true).meshes[0].lods[0].positions[13],9);
 const object={name:'TERRAIN',frameType:9,model:'WB_TERRAIN.i3d',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]},surface=modelCollisionSurface(native,object,{objects:[object]}, {meshes:[]});assert.equal(surface.indices.length/3,8);
});
test('terrain limits reject unsafe inputs and maximal density remains a valid native mesh',()=>{
 for(const extra of [{name:'../x'},{name:'CON'},{name:'česky'},{texture:'maps/a/b.bmp'},{width:0},{depth:NaN},{tileSize:Infinity},{columns:1.5},{rows:129},{heights:[0,1,2]},{heights:[0,0,0,Infinity]}])assert.throws(()=>createTerrainBytes({...options,...extra}),/Terén/);
 const parsed=parseFourDs(createTerrainBytes({...options,columns:128,rows:128}),'all');assert.equal(parsed.meshes[0].lods[0].vertices,16641);assert.equal(parsed.meshes[0].lods[0].faces[0].indices.length/3,32768);
});
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-terrain-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:2,name:'Terrain',assets:[],history:[]}));const p=await ModProject.open(root),texture=bmp();await p.createFiles([{path:'MAPS/Ground.BMP',data:texture}]);return {p,root,texture};}
test('terrain creation preserves texture, exports/reopens as editable native model, refuses stale/duplicate writes and undoes exactly',async t=>{
 const {p,root,texture}=await fixture(t),history=p.manifest.history.length;await assert.rejects(()=>p.createTerrain(options,'stale'),/textura/);assert.equal(p.manifest.history.length,history);
 const target=await p.createTerrain(options,hash(texture)),expected=createTerrainBytes(options);assert.equal(target,'models/WB_TERRAIN.4ds');assert.equal(p.manifest.history.length,history+1);assert.deepEqual(await p.read(target),expected);assert.deepEqual(await p.read('maps/ground.bmp'),texture);
 await assert.rejects(()=>p.createTerrain({...options,name:'wb_terrain'},hash(texture)),/existuje/);const reopened=await ModProject.open(root);await reopened.export(path.join(root,'export'));assert.deepEqual(await fs.readFile(path.join(root,'export',target)),expected);assert.equal((await reopened.modelGeometry(target,1)).mesh.lods[0].vertices,9);
 await reopened.undo();assert.equal(reopened.manifest.history.length,history);assert.throws(()=>reopened.asset(target),/není v projektu/);assert.deepEqual(await reopened.read('maps/ground.bmp'),texture);
});
test('terrain publication failure or concurrent texture edit cannot publish an unguarded model',async t=>{
 const {p,texture}=await fixture(t),history=p.manifest.history.length;p.saveManifest=async()=>{throw Error('publish failed');};await assert.rejects(()=>p.createTerrain(options,hash(texture)),/publish failed/);assert.equal(p.manifest.history.length,history);assert.throws(()=>p.asset('models/WB_TERRAIN.4ds'));
 p.saveManifest=ModProject.prototype.saveManifest;const original=p.createFiles;p.createFiles=async function(...args){const changed=Buffer.from(texture);changed[54]=120;await this.change('maps/ground.bmp',changed,'Independent edit');return original.apply(this,args);};await assert.rejects(()=>p.createTerrain(options,hash(texture)),/Závislý/);assert.throws(()=>p.asset('models/WB_TERRAIN.4ds'));await p.undo();assert.deepEqual(await p.read('maps/ground.bmp'),texture);
});
