import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseSegments,inspectSegments,emptySegments,changeSegments,remapSegments} from '../src/core/segments.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';
const cover={position:[2,0,3],dirA:[1,0],dirB:[0,1],dirC:[-Math.SQRT1_2,-Math.SQRT1_2],radius:4,tolerance:Math.PI/4};
function mixed(){
  const header=emptySegments(),record=Buffer.alloc(24+8+52+56+56+24+44,0xa5);header.writeUInt32LE(1,16);record.writeUInt32LE(0x40084212);record.writeUInt32LE(2,20);record.writeUInt32LE(0,24);record.writeUInt32LE(2,28);return Buffer.concat([header,record]);
}
function navigation(){const bytes=Buffer.alloc(8+3*30);bytes.writeUInt32LE(0x01abcedf);bytes.writeUInt32LE(3,4);for(let i=0;i<3;i++){bytes.writeFloatLE(i*10,8+i*30);bytes.writeUInt16LE(2,20+i*30);}return bytes;}
async function project(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-segments-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:2,name:'Segments',assets:[],history:[]}));const p=await ModProject.open(root);await p.createFiles([{path:'MISSIONS/TEST/CHECK.BIN',data:navigation()}]);return {root,p,nav:'MISSIONS/TEST/CHECK.BIN',seg:'missions/test/clusters.seg'};}
test('new PC cover segments encode a single 56-byte special, sorted array indices and clean opaque words',()=>{
  const source=emptySegments(),added=changeSegments(source,3,{action:'add-cover',nodes:[2,0],values:cover}),bytes=added.data;
  assert.equal(added.index,0);assert.equal(bytes.length,108);assert.equal(bytes.readUInt32LE(16),1);assert.equal(bytes.readUInt32LE(20),0x10000020);assert.equal(bytes.readFloatLE(24),4);assert.deepEqual([28,32,36].map(i=>bytes.readFloatLE(i)),cover.position);assert.equal(bytes.readUInt32LE(40),2);assert.deepEqual([44,48].map(i=>bytes.readUInt32LE(i)),[0,2]);assert.deepEqual([...bytes.subarray(-12)],Array(12).fill(0));
  const record=inspectSegments(bytes,3).records[0];assert.equal(record.own,0);assert.deepEqual(record.nodes,[0,2]);assert.equal(record.specials[0].type,2);assert.deepEqual(record.specials[0].position,cover.position);assert.equal(record.specials[0].dirC[0],Math.fround(-Math.SQRT1_2));
  assert.deepEqual(changeSegments(bytes,3,{action:'delete-cover',index:0,special:0}).data,source);
  assert.deepEqual(remapSegments(bytes,[1,-1,0],2).subarray(52),bytes.subarray(52));assert.deepEqual(inspectSegments(remapSegments(bytes,[1,-1,0],2),2).records[0].nodes,[0,1]);
});
test('editing cover geometry and membership preserves opaque own and all other special payloads exactly',()=>{
  const source=mixed(),parsed=parseSegments(source,3),record=parsed.records[0];assert.deepEqual(record.specials.map(s=>s.type),[1,2,4,8]);
  const changed=changeSegments(source,3,{action:'update',index:0,nodes:[1],special:1,values:cover}).data,after=parseSegments(changed,3).records[0],beforeCorner=record.specials[1],afterCorner=after.specials[1];
  assert.deepEqual(changed.subarray(after.payload,afterCorner.start),source.subarray(record.payload,beforeCorner.start));assert.deepEqual(changed.subarray(afterCorner.start+44),source.subarray(beforeCorner.start+44));assert.deepEqual(changed.subarray(0,40),source.subarray(0,40));assert.deepEqual(after.nodes,[1]);assert.deepEqual(inspectSegments(changed,3).records[0].specials[1].position,cover.position);
  const saved=inspectSegments(changed,3).records[0].specials[1],values=Object.fromEntries(Object.keys(cover).map(key=>[key,saved[key]]));assert.deepEqual(changeSegments(changed,3,{action:'update',index:0,special:1,values}).data,changed);
  const removed=changeSegments(source,3,{action:'delete-cover',index:0,special:1}).data,remaining=parseSegments(removed,3).records[0];assert.equal(removed.readUInt32LE(20),0x30008412);assert.deepEqual(remaining.specials.map(s=>s.type),[1,4,8]);assert.deepEqual(removed.subarray(remaining.payload),Buffer.concat([source.subarray(record.payload,beforeCorner.start),source.subarray(beforeCorner.end)]));
  const changedOnlyNodes=changeSegments(source,3,{action:'update',index:0,nodes:[1,2]}).data;assert.deepEqual(changedOnlyNodes.subarray(52),source.subarray(52));
});
test('segment validation rejects dangling memberships, unsupported geometry edits, legacy conversion and invalid corner inputs',()=>{
  const source=changeSegments(emptySegments(),3,{action:'add-cover',values:cover}).data;
  for(const nodes of [[3],[-1],[.5],[1,1],['1'],[NaN]])assert.throws(()=>changeSegments(source,3,{action:'update',index:0,nodes}),/indexy/);
  for(const values of [{position:[0,0,Infinity]},{dirA:[0,0]},{dirB:[1e50,1]},{radius:0},{radius:1e-50},{tolerance:-1},{tolerance:4},{unused:2}])assert.throws(()=>changeSegments(source,3,{action:'update',index:0,special:0,values}));
  for(const request of [{action:'unknown'},{action:'delete-cover',index:-1,special:0},{action:'update',index:0,special:1,values:cover},{action:'add-cover',values:{radius:3}},{action:'update',index:0,foreign:1}])assert.throws(()=>changeSegments(source,3,request));
  assert.throws(()=>changeSegments(mixed(),3,{action:'delete-cover',index:0,special:0}),/typ/);
  const boundary=changeSegments(source,3,{action:'update',index:0,special:0,values:{tolerance:Math.PI}}).data;assert.deepEqual(changeSegments(boundary,3,{action:'update',index:0,special:0,values:{tolerance:Math.fround(Math.PI)}}).data,boundary);
  const legacy=Buffer.from(source);legacy.write('AISEG-V1.0-JIPO');assert.equal(inspectSegments(legacy,3).active,false);assert.throws(()=>changeSegments(legacy,3,{action:'add-cover',values:cover}),/1.0/);
});
test('project creates, edits, exports, remaps and undoes segments with a guarded navigation dependency',async t=>{
  const {p,root,nav,seg}=await project(t),navHash=hash(await p.read(nav));
  await assert.rejects(p.changeSegments(seg,{action:'create'},null,'0'.repeat(64)),/body/);assert.equal(p.manifest.history.length,1);
  await p.changeSegments(seg,{action:'create'},null,navHash);assert.equal((await p.inspect(seg)).type,'segments');assert.equal((await p.inspect(seg)).points.length,3);
  await assert.rejects(p.changeSegments(seg,{action:'create'},null,navHash),/existuje/);
  await p.changeSegments(seg,{action:'add-cover',nodes:[0,2],values:cover},hash(emptySegments()),navHash);const before=await p.read(seg);
  await assert.rejects(p.changeSegments(seg,{action:'update',index:0,nodes:[1]},hash(emptySegments()),navHash),/změnil/);
  await p.changeNavigationPoint(nav,{action:'add',position:[5,0,0]},navHash);const moved=await p.read(seg);assert.deepEqual((await p.inspect(seg)).records[0].nodes,[0,3]);
  await assert.rejects(p.changeSegments(seg,{action:'update',index:0,nodes:[1]},hash(moved),navHash),/body/);
  const fresh=await ModProject.open(root),current=await fresh.inspect(seg);await fresh.changeSegments(seg,{action:'update',index:0,nodes:[1],special:0,values:{position:[4,0,5]}},current.sha256,current.navigationHash);
  await fresh.export(path.join(root,'export'));assert.deepEqual(await fs.readFile(path.join(root,'export',seg)),await fresh.read(seg));
  await fresh.undo();assert.deepEqual(await fresh.read(seg),moved);await fresh.undo();assert.deepEqual(await fresh.read(seg),before);await fresh.undo();assert.deepEqual(await fresh.read(seg),emptySegments());await fresh.undo();assert.throws(()=>fresh.asset(seg));assert.deepEqual(await fresh.read(nav),navigation());assert.equal(fresh.manifest.history.length,1);
});
