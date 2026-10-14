import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {sectorFixture} from './sector-fixture.js';import {parseFourDs} from '../src/core/fourds.js';import {editSectorGeometry} from '../src/core/sector-geometry.js';import {sectorVolume,portalPolygon} from '../src/shared/sector-geometry.js';import {inspectModelGeometry,editModelGeometry} from '../src/core/model-geometry.js';import {ModProject} from '../src/core/project.js';import {hash,writeSafe} from '../src/core/files.js';
const box={positions:[0,0,0,2,0,0,2,2,0,0,2,0,0,0,2,2,0,2,2,2,2,0,2,2],indices:[0,1,2,0,2,3,4,6,5,4,7,6,0,3,7,0,7,4,1,5,6,1,6,2,0,4,5,0,5,1,3,2,6,3,6,7]};
const parsed=b=>parseFourDs(b,true).meshes[0].sector;
test('sector geometry route preserves no-op including inconsistent original plane and uninitialised parameters',()=>{
 const bytes=sectorFixture(),s=parsed(bytes);bytes.writeUInt32LE(0x7fc0abcd,s.portals[0].offset+9);bytes.writeFloatLE(99,s.portals[0].planeOffset+12);
 const context=inspectModelGeometry(bytes,1);assert(context.sector);const original=parsed(bytes);assert.deepEqual(editModelGeometry(bytes,{mesh:1,sector:{positions:original.positions,indices:original.indices,portals:[{source:0,positions:original.portals[0].positions}]}}),bytes);
 assert.deepEqual(editSectorGeometry(bytes,{mesh:1,sector:{}}),bytes);
 for(const request of [{mesh:2,sector:{}},{mesh:1,sector:[]},{mesh:1,sector:{positions:null}},{mesh:1,sector:{indices:null}},{mesh:1,sector:{portals:null}},{mesh:1,sector:{portals:[{source:9}]}},{mesh:1,sector:{portals:[{source:0,flags:4}]}}])assert.throws(()=>editSectorGeometry(bytes,request));
 // A portal edit must not repair or reject an unrelated legacy volume.
 const legacy=Buffer.from(bytes);legacy.writeUInt16LE(0,original.vertexOffset+original.vertices*12+2);const invalid=parsed(legacy);
 assert.throws(()=>sectorVolume(invalid.positions,invalid.indices));assert.deepEqual(editSectorGeometry(legacy,{mesh:1,sector:{}}),legacy);
 const positions=invalid.portals[0].positions.map((v,i)=>i%3===2?v+1:v),after=editSectorGeometry(legacy,{mesh:1,sector:{portals:[{source:0,positions}]}}),edited=parsed(after);
 assert.deepEqual(after.subarray(edited.geometryOffset,edited.portalsOffset),legacy.subarray(invalid.geometryOffset,invalid.portalsOffset));assert.deepEqual(edited.portals[0].plane,[0,0,1,-1]);assert.equal(after.readUInt32LE(edited.portals[0].offset+9),0x7fc0abcd);
});
test('resizing a convex inward sector derives bounds and preserves flags, portal records and following frames',()=>{
 const before=sectorFixture(),source=parsed(before),after=editSectorGeometry(before,{mesh:1,sector:box}),s=parsed(after);
 assert.deepEqual(s.positions,box.positions);assert.deepEqual(s.indices,box.indices);assert.deepEqual(s.bounds,[0,0,0,2,2,2]);
 assert.deepEqual(after.subarray(0,s.geometryOffset),before.subarray(0,source.geometryOffset));assert.deepEqual(after.subarray(s.portals[0].offset,s.portals[0].endOffset),before.subarray(source.portals[0].offset,source.portals[0].endOffset));assert.deepEqual(after.subarray(s.endOffset),before.subarray(source.endOffset));assert.equal(parseFourDs(after,true).meshes[1].name,'after');
 const positions=source.positions.map((v,i)=>i%3===0?v-5:v);const moved=parsed(editSectorGeometry(before,{mesh:1,sector:{positions}}));assert.deepEqual(moved.bounds,[-5,0,0,-3,2,2]);
 const retained=sectorVolume([...box.positions,3,1,1],box.indices);assert.deepEqual(retained.bounds,[0,0,0,3,2,2]);assert.equal(retained.positions.length,27);
 for(const invalid of [{...box,indices:box.indices.slice(3)},{...box,indices:box.indices.map((v,i)=>i%3===1?box.indices[i+1]:i%3===2?box.indices[i-1]:v)},{...box,indices:[...box.indices,0,1,2]},{...box,positions:box.positions.map((v,i)=>i===18?-.5:v)}])assert.throws(()=>sectorVolume(invalid.positions,invalid.indices));
});
test('changed portal plane follows ordered polygon while raw header, sector volume and other portals remain exact',()=>{
 const before=sectorFixture(),original=parsed(before).portals[0];before.writeUInt32LE(0x7fc0abcd,original.offset+9);
 const positions=[0,0,1,2,0,1,2,2,1,0,2,1],after=editSectorGeometry(before,{mesh:1,sector:{portals:[{source:0,positions},{source:0}]}}),s=parsed(after),p=s.portals[0];assert.deepEqual(p.plane,[0,0,1,-1]);assert.equal(p.points,4);assert.equal(after.readUInt32LE(p.offset+9),0x7fc0abcd);assert.equal(p.flags,0x80000004);
 assert.deepEqual(after.subarray(s.geometryOffset,s.portalsOffset),before.subarray(parsed(before).geometryOffset,parsed(before).portalsOffset));assert.deepEqual(after.subarray(s.portals[1].offset,s.portals[1].endOffset),before.subarray(original.offset,original.endOffset));
 const reversed=Array.from({length:4},(_,i)=>positions.slice(i*3,i*3+3)).reverse().flat(),reverse=portalPolygon(reversed);assert.equal(reverse.plane[2],-1);assert.equal(reverse.plane[3],1);
 const flatCorner=[1,0,1,2,0,1,2,2,1,0,2,1,0,0,1],corner=portalPolygon(flatCorner);assert.deepEqual(corner.positions,[2,0,1,2,2,1,0,2,1,0,0,1,1,0,1]);assert.deepEqual(corner.plane,[0,0,1,-1]);
 const cornerWritten=parsed(editSectorGeometry(before,{mesh:1,sector:{portals:[{positions:flatCorner}]}})).portals[0];assert.deepEqual(cornerWritten.positions,corner.positions);assert.deepEqual(cornerWritten.plane,corner.plane);
 assert.throws(()=>portalPolygon(Array.from({length:8},(_,i)=>[Math.cos(i*Math.PI/4)*1e-6,Math.sin(i*Math.PI/4)*1e-6,0]).flat()),/roh/);
 for(const bad of [[0,0,0,1,0,0,2,0,0],[0,0,0,2,0,0,.5,.5,0,0,2,0],[0,0,0,2,2,0,0,2,0,2,0,0],[0,0,0,1,0,0,1,1,0,0,1,1],[0,0,0,1,0,0,0,0,0],positions.map((v,i)=>i===0?1e39:v)])assert.throws(()=>portalPolygon(bad));
});
test('new/removed portals validate count and finite parameters without regenerating sector or opaque data',()=>{
 const before=sectorFixture(),positions=parsed(before).portals[0].positions;
 const after=editSectorGeometry(before,{mesh:1,sector:{portals:[{positions,flags:0xffffffff,parameters:[-0,3.5]}]}}),p=parsed(after).portals[0];assert.equal(p.flags,0xffffffff);assert(Object.is(p.parameters[0],-0));assert.equal(p.parameters[1],3.5);
 const removed=editSectorGeometry(before,{mesh:1,sector:{portals:[]}});assert.equal(parsed(removed).portals.length,0);assert.deepEqual(removed.subarray(parsed(removed).endOffset),before.subarray(parsed(before).endOffset));
 for(const portals of [Array.from({length:256},()=>({source:0})),new Array(1),[{positions,flags:-1}],[{positions,flags:null}],[{positions,parameters:[NaN,0]}],[{positions,parameters:new Array(2)}],[{positions,parameters:null}]])assert.throws(()=>editSectorGeometry(before,{mesh:1,sector:{portals}}));
});
test('resized sector uses project concurrency guard, exact export and undo without touching collision file',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-sector-shape-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:2,name:'Sector shape',assets:[],history:[]}));const p=await ModProject.open(root),name='missions/Test/scene.4ds',before=sectorFixture();await p.createFiles([{path:name,data:before},{path:'missions/Test/tree.klz',data:Buffer.from('protected collision')}]);const history=structuredClone(p.manifest.history);
 const context=await p.modelGeometry(name,1);assert(context.sector);await p.saveGeometry(name,{mesh:1,sector:{...box,portals:[{source:0},{positions:[0,0,0,1,0,0,0,1,0]}]}},context.sha256);const after=await p.read(name);assert.equal(parsed(after).portals.length,2);await assert.rejects(()=>p.saveGeometry(name,{mesh:1,sector:{}},hash(before)),/změnil/);
 const reopened=await ModProject.open(root);await reopened.export(path.join(root,'export'));assert.deepEqual(await fs.readFile(path.join(root,'export',name)),after);await reopened.undo();assert.deepEqual(await reopened.read(name),before);assert.deepEqual(reopened.manifest.history,history);assert.equal((await reopened.read('missions/Test/tree.klz')).toString(),'protected collision');
});
