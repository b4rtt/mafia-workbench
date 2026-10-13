import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {inspectModelGeometry,editModelGeometry} from '../src/core/model-geometry.js';
import {parseFourDs} from '../src/core/fourds.js';
import {geometryNormals,geometryPreview,geometryTopology,topologyPreview,removeTopologyVertex,validateTopology} from '../src/shared/geometry-draft.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';
const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;};
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const floats=values=>{const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeFloatLE(v,i*4));return b;};
const text=s=>Buffer.concat([Buffer.from([s.length]),Buffer.from(s)]);
function fixture(visual=0){
 const header=Buffer.alloc(14,0x55);header.write('4DS\0');header.writeUInt16LE(29,4);
 const frame=name=>Buffer.concat([Buffer.from([1,visual,1,2]),u16(0),floats([0,0,0,1,1,1,1,0,0,0]),Buffer.from([9]),text(name),text('opaque')]);
 const lod=index=>Buffer.concat([floats([index*40]),u16(3),floats([0,0,-0,0,0,1,0,0, 1,0,0,0,0,1,1,0, 0,1,0,0,0,1,0,1]),Buffer.from([1]),u16(1),u16(0),u16(1),u16(2),u16(0)]);
 const geometry=Buffer.concat([u16(0),Buffer.from([2]),lod(0),lod(1)]),skin=visual===2?Buffer.concat(Array.from({length:2},()=>Buffer.concat([Buffer.from([0]),u32(3),Buffer.alloc(24,0x99)]))):Buffer.alloc(0),morph=visual===5?Buffer.from([0]):Buffer.alloc(0);
 const body=Buffer.concat([frame('original'),geometry,skin,morph]),instance=Buffer.concat([frame('copy'),u16(1)]);
 return Buffer.concat([header,u16(0),u16(2),body,instance,Buffer.from([0x73])]);
}
const request=(levels,mesh=1)=>({mesh,levels});
test('4DS vertex writer edits every LOD through shared instances and changes only chosen attribute spans',()=>{
 const source=fixture(),context=inspectModelGeometry(source,2);assert.equal(context.mesh.id,1);assert.equal(context.mesh.lods[1].positions.length,9);assert.deepEqual(context.instances.map(item=>item.id),[1,2]);assert.ok(context.editShape);
 const levels=[{lod:0,vertices:[{index:1,position:[2,3,4],uv:[.25,.75]}],recomputeNormals:false},{lod:1,vertices:[{index:2,normal:[1,0,0]}],recomputeNormals:false}],result=editModelGeometry(source,request(levels,2)),parsed=parseFourDs(result,'all');
 assert.deepEqual(parsed.meshes[0].lods[0].positions.slice(3,6),[2,3,4]);assert.deepEqual(parsed.meshes[0].lods[0].uv.slice(2,4),[.25,.75]);assert.deepEqual(parsed.meshes[0].lods[1].normals.slice(6,9),[1,0,0]);
 const allowed=new Set();for(const [lod,index,offset,count]of [[0,1,0,12],[0,1,24,8],[1,2,12,12]])for(let i=0;i<count;i++)allowed.add(context.mesh.lods[lod].vertexOffset+index*32+offset+i);
 for(let i=0;i<source.length;i++)if(!allowed.has(i))assert.equal(result[i],source[i],`byte ${i}`);
 const restore=levels.map(level=>({...level,vertices:level.vertices.map(change=>{const original=context.mesh.lods[level.lod],output={index:change.index};for(const [field,array,size]of [['position','positions',3],['normal','normals',3],['uv','uv',2]])if(change[field])output[field]=original[array].slice(change.index*size,(change.index+1)*size);return output;})}));assert.deepEqual(editModelGeometry(result,request(restore)),source);
 assert.deepEqual(editModelGeometry(source,request([])),source);
});
test('4DS geometry retains raw invalid normals/UV during unrelated edits and preserves signed zero on no-op',()=>{
 const source=fixture(),start=inspectModelGeometry(source,1).mesh.lods[0].vertexOffset;source.writeFloatLE(NaN,start+12);source.writeFloatLE(Infinity,start+24);
 assert.deepEqual(editModelGeometry(source,request([])),source);
 const result=editModelGeometry(source,request([{lod:0,vertices:[{index:2,position:[0,2,0]}],recomputeNormals:false}]));assert.deepEqual(result.subarray(start,start+32),source.subarray(start,start+32));
 const zero=fixture(),context=inspectModelGeometry(zero,1);assert.ok(Object.is(context.mesh.lods[0].positions[2],-0));assert.deepEqual(editModelGeometry(zero,request([{lod:0,vertices:[{index:0,position:[0,0,-0]}],recomputeNormals:false}])),zero);
});
test('normal compilation uses face areas and shared indices, retains unreferenced zero normals and matches preview bytes',()=>{
 const positions=[0,0,0,1,0,0,0,1,0,0,0,2,9,9,9],faces=[{indices:[0,1,2,0,3,1]}],normals=geometryNormals(positions,faces);assert.deepEqual(normals.slice(6,9),[0,0,1]);assert.deepEqual(normals.slice(9,12),[0,1,0]);assert.deepEqual(normals.slice(12),[0,0,0]);assert.ok(Math.abs(normals[1]-2/Math.sqrt(5))<1e-10);
 const source=fixture(),context=inspectModelGeometry(source,1),change={lod:1,vertices:[{index:2,position:[0,1,1]}],recomputeNormals:true},preview=geometryPreview(context.mesh.lods[1],change.vertices,true),result=editModelGeometry(source,request([change])),actual=parseFourDs(result,'all').meshes[0].lods[1];assert.deepEqual(actual.normals,preview.normals);assert.deepEqual(parseFourDs(result,'all').meshes[0].lods[0],context.mesh.lods[0]);
});
test('UV edits leave skin groups and morph payloads intact; shape changes, unsupported references and invalid drafts cannot write',()=>{
 for(const visual of [2,5]){const source=fixture(visual),context=inspectModelGeometry(source,1);assert.equal(context.editShape,false);const at=context.mesh.lods[1].vertexOffset+24,result=editModelGeometry(source,request([{lod:1,vertices:[{index:0,uv:[.2,.3]}],recomputeNormals:false}]));for(let i=0;i<source.length;i++)if(i<at||i>=at+8)assert.equal(result[i],source[i]);assert.throws(()=>editModelGeometry(source,request([{lod:0,vertices:[{index:0,position:[0,0,1]}],recomputeNormals:false}])));assert.throws(()=>editModelGeometry(source,request([{lod:0,vertices:[],recomputeNormals:true}])));}
 const source=fixture(),level={lod:0,vertices:[],recomputeNormals:false};for(const req of [null,request([level],99),request([level,level]),request([{...level,lod:99}]),request([{...level,vertices:[{index:3,uv:[0,0]}]}]),request([{...level,vertices:[{index:0,uv:[0,0]},{index:0,uv:[1,1]}]}]),request([{...level,vertices:[{index:0,uv:[0,Infinity]}]}]),request([{...level,vertices:[{index:0,position:[0,0,1e50]}]}]),request([{...level,vertices:[{index:0,normal:[1,0,0]}],recomputeNormals:true}])])assert.throws(()=>editModelGeometry(source,req));
 const cycle=Buffer.from(source),parsed=parseFourDs(source,'all'),instanceOffset=parsed.entries.find(e=>e.id==='meshes/1/properties').offset+parsed.entries.find(e=>e.id==='meshes/1/properties').length;cycle.writeUInt16LE(2,instanceOffset);assert.throws(()=>inspectModelGeometry(cycle,2),/instance/);
});
test('geometry saves several LODs atomically, checks hashes, exports, reopens and undoes exact models',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-geometry-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const source=fixture(),asset={path:'models/test.4ds',original:'originals/a1/models/test.4ds',archive:'a1.dta',sha256:hash(source),size:source.length,variants:[{}]};await writeSafe(root,asset.original,source);await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Geometry',assets:[asset],history:[]}));
 let p=await ModProject.open(root);const context=await p.modelGeometry(asset.path,2),req=request([{lod:0,vertices:[{index:0,uv:[.1,.2]}],recomputeNormals:false},{lod:1,vertices:[{index:2,position:[0,2,0]}],recomputeNormals:true}],2);await assert.rejects(p.saveGeometry(asset.path,req,'0'.repeat(64)),/změnil/);await p.saveGeometry(asset.path,req,context.sha256);assert.equal(p.manifest.history.length,1);assert.deepEqual(await p.read(asset.path),editModelGeometry(source,req));await assert.rejects(p.saveGeometry(asset.path,req,context.sha256),/změnil/);
 p=await ModProject.open(root);await p.export(path.join(root,'export'));assert.deepEqual(await fs.readFile(path.join(root,'export',asset.path)),await p.read(asset.path));await p.undo();assert.deepEqual(await p.read(asset.path),source);assert.deepEqual(await fs.readFile(path.join(root,asset.original)),source);
});

const topologyLevel=(lod,topology,vertices=[])=>({lod,topology,vertices,recomputeNormals:false});
test('topology identity copies raw vertex rows, face order, distances and opaque tails byte for byte',()=>{
 const source=fixture(),lods=inspectModelGeometry(source,1).mesh.lods;source.writeUInt32LE(0x7fc12345,lods[0].vertexOffset+12);source.writeFloatLE(Infinity,lods[0].vertexOffset+24);
 const context=inspectModelGeometry(source,2),levels=context.mesh.lods.map((lod,i)=>topologyLevel(i,geometryTopology(lod)));
 assert.deepEqual(editModelGeometry(source,request(levels,2)),source);
 const topology=geometryTopology(context.mesh.lods[0]);topology.vertices.push({source:0});topology.faces[0].indices=[3,1,2];
 const result=editModelGeometry(source,request([topologyLevel(0,topology)])),parsed=parseFourDs(result,'all'),lod=parsed.meshes[0].lods[0];
 assert.deepEqual(result.subarray(lod.vertexOffset+3*32,lod.vertexOffset+4*32),source.subarray(context.mesh.lods[0].vertexOffset,context.mesh.lods[0].vertexOffset+32));
 assert.deepEqual(lod.faces[0].indices,[3,1,2]);assert.equal(parsed.meshes[1].instance,1);assert.equal(parsed.meshes[0].lods[1].distance,40);assert.equal(result.at(-1),0x73);
 assert.deepEqual(topologyPreview(context.mesh.lods[0],topology).normals,lod.normals);
});
test('several resized LODs write post-topology indices independent of request order and can restore exact originals',()=>{
 const source=fixture(),context=inspectModelGeometry(source,1),levels=context.mesh.lods.map((lod,i)=>{const topology=geometryTopology(lod);topology.vertices.push({position:[2,i,0],normal:[0,0,1],uv:[.2,.3]});topology.faces.push({material:0,indices:[1,3,2]});return topologyLevel(i,topology,[{index:3,uv:[.75,.5]}]);});
 const result=editModelGeometry(source,request(levels)),reversed=editModelGeometry(source,request([...levels].reverse()));assert.deepEqual(result,reversed);
 const actual=parseFourDs(result,'all');for(const mesh of actual.meshes.slice(0,1))for(const lod of mesh.lods){assert.equal(lod.vertices,4);assert.equal(lod.faces.length,2);assert.deepEqual(lod.uv.slice(6,8),[.75,.5]);}
 const restores=actual.meshes[0].lods.map((lod,i)=>{const topology=geometryTopology(lod);topology.vertices.pop();topology.faces.pop();return topologyLevel(i,topology);});assert.deepEqual(editModelGeometry(result,request(restores)),source);
});
test('removing a vertex drops incident triangles, preserves group order and remaps surviving edits and face references',()=>{
 const topology={vertices:[{source:0},{source:1},{source:2},{source:3},{source:4}],faces:[{material:2,indices:[0,1,2,0,2,4]},{material:1,indices:[1,3,4]},{material:2,indices:[]}]},before=structuredClone(topology),changes=[{index:1,uv:[1,2]},{index:4,position:[4,5,6]}],result=removeTopologyVertex(topology,1,changes);
 assert.deepEqual(topology,before);assert.deepEqual(result.topology.faces,[{material:2,indices:[0,1,3]},{material:1,indices:[]},{material:2,indices:[]}]);assert.deepEqual(result.topology.vertices,[{source:0},{source:2},{source:3},{source:4}]);assert.deepEqual(result.changes,[{index:3,position:[4,5,6]}]);assert.throws(()=>removeTopologyVertex(topology,5));
 const source=fixture(),lod=inspectModelGeometry(source,1).mesh.lods[0],removed=removeTopologyVertex(geometryTopology(lod),1);const actual=parseFourDs(editModelGeometry(source,request([topologyLevel(0,removed.topology)])),'all').meshes[0].lods[0];assert.equal(actual.vertices,2);assert.deepEqual(actual.faces,[{material:0,indices:[]}]);assert.deepEqual(actual.positions,[0,0,-0,0,1,0]);
});
test('removing an invalid-normal vertex restores the same remaining native normals in preview and serialization',()=>{
 const source=fixture(),start=inspectModelGeometry(source,1).mesh.lods[0].vertexOffset;source.writeFloatLE(NaN,start+12);const lod=inspectModelGeometry(source,1).mesh.lods[0],removed=removeTopologyVertex(geometryTopology(lod),0).topology;
 const preview=topologyPreview(lod,removed),actual=parseFourDs(editModelGeometry(source,request([topologyLevel(0,removed)])),'all').meshes[0].lods[0];assert.equal(preview.invalidNormals,false);assert.deepEqual(preview.normals,[0,0,1,0,0,1]);assert.deepEqual(preview.normals,actual.normals);
});
test('attribute edits on resized raw geometry preview the serialized fallback without writing fallback zeros to untouched rows',()=>{
 const source=fixture(),start=inspectModelGeometry(source,1).mesh.lods[0].vertexOffset;source.writeFloatLE(NaN,start+12);source.writeFloatLE(Infinity,start+24);const lod=inspectModelGeometry(source,1).mesh.lods[0],topology=geometryTopology(lod);topology.vertices.push({source:0});
 const changes=[{index:3,normal:[1,0,0],uv:[0,0]}],result=editModelGeometry(new Uint8Array(source),request([topologyLevel(0,topology,changes)])),actual=parseFourDs(result,'all').meshes[0].lods[0],preview=geometryPreview(topologyPreview(lod,topology),changes);assert.deepEqual(preview.normals,actual.normals);assert.deepEqual(preview.uv,actual.uv);assert.equal(result.readFloatLE(actual.vertexOffset+3*32+12),1);assert.deepEqual(result.subarray(actual.vertexOffset,actual.vertexOffset+32),source.subarray(start,start+32));
 const repaired=geometryPreview(topologyPreview(lod,topology),[...changes,{index:0,normal:[0,0,1]}]);assert.equal(repaired.invalidNormals,false);assert.deepEqual(repaired.normals.slice(-3),[1,0,0]);
});
test('face material changes and winding preserve native material blocks and other LODs',()=>{
 const original=fixture(),material=Buffer.concat([u32(0),floats([.1,.2,.3,.4,.5,.6,.7,.8,.9,1]),text('')]),source=Buffer.concat([original.subarray(0,14),u16(1),material,original.subarray(16)]),context=inspectModelGeometry(source,1),topology=geometryTopology(context.mesh.lods[0]);topology.faces[0]={material:1,indices:[0,2,1]};
 const result=editModelGeometry(source,request([topologyLevel(0,topology)])),parsed=parseFourDs(result,'all');assert.deepEqual(parsed.meshes[0].lods[0].faces,[{material:1,indices:[0,2,1]}]);assert.deepEqual(result.subarray(14,16+material.length),source.subarray(14,16+material.length));assert.deepEqual(parsed.meshes[0].lods[1],context.mesh.lods[1]);
 const empty={vertices:[],faces:[]},cleared=editModelGeometry(source,request([topologyLevel(0,empty)]));assert.equal(parseFourDs(cleared,'all').meshes[0].lods[0].vertices,0);
});
test('topology enforces native limits, complete new rows, source indices and safe material/face references',()=>{
 const source=fixture(),lod=inspectModelGeometry(source,1).mesh.lods[0],topology=geometryTopology(lod);
 const invalid=[{...topology,vertices:new Array(65536).fill({source:0})},{...topology,faces:new Array(256).fill({material:0,indices:[]})},{...topology,vertices:[{source:3}]},{...topology,vertices:[{source:0,uv:[0,0]}]},{...topology,vertices:[{position:[0,0,0],normal:[0,1,0]}]},{...topology,vertices:[{position:[0,0,Infinity],normal:[0,1,0],uv:[0,0]}]},{...topology,faces:[{material:1,indices:[0,1,2]}]},{...topology,faces:[{material:0,indices:[0,1,3]}]},{...topology,faces:[{material:0,indices:[0,1]}]},{...topology,faces:[{material:0,indices:new Array(65536*3).fill(0)}]}];
 for(const value of invalid)assert.throws(()=>editModelGeometry(source,request([topologyLevel(0,value)])));
 const limit={vertices:new Array(65535).fill({source:0}),faces:new Array(255).fill({material:0,indices:[]})};assert.doesNotThrow(()=>validateTopology(lod,limit,0));limit.faces[0]={material:0,indices:new Array(65535*3).fill(65534)};assert.doesNotThrow(()=>validateTopology(lod,limit,0));
 const maximum=parseFourDs(editModelGeometry(source,request([topologyLevel(0,limit)])),'all').meshes[0].lods[0];assert.equal(maximum.vertices,65535);assert.equal(maximum.faces.length,255);assert.equal(maximum.faces[0].indices.length,65535*3);assert.equal(maximum.faces[0].indices.at(-1),65534);
 for(const visual of [2,5])assert.throws(()=>editModelGeometry(fixture(visual),request([topologyLevel(0,topology)])),/topologie/);
});
test('topology resizing saves, reopens and exports both LODs in one operation and undo restores exact data',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-topology-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const bytes=fixture(),asset={path:'models/topology.4ds',original:'originals/a1/models/topology.4ds',sha256:hash(bytes),size:bytes.length,archive:'a1.dta',variants:[{}]};await writeSafe(root,asset.original,bytes);await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Topology',assets:[asset],history:[]}));
 let p=await ModProject.open(root);const context=await p.modelGeometry(asset.path,2),req=request(context.mesh.lods.map((lod,i)=>{const topology=geometryTopology(lod);topology.vertices.push({source:2});topology.faces[0].indices.push(0,1,3);return topologyLevel(i,topology,[{index:3,uv:[.2,.9]}]);}),2);await assert.rejects(p.saveGeometry(asset.path,req,'0'.repeat(64)),/změnil/);await p.saveGeometry(asset.path,req,context.sha256);assert.equal(p.manifest.history.length,1);await assert.rejects(p.saveGeometry(asset.path,req,context.sha256),/změnil/);p=await ModProject.open(root);await p.export(path.join(root,'export'));assert.deepEqual(await fs.readFile(path.join(root,'export',asset.path)),editModelGeometry(bytes,req));await p.undo();assert.deepEqual(await p.read(asset.path),bytes);assert.deepEqual(await fs.readFile(path.join(root,asset.original)),bytes);
});
