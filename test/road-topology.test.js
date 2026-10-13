import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {changeRoadTopology} from '../src/core/road-topology.js';
import {parseRoads} from '../src/core/roads.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';
const empty=()=>{const b=Buffer.alloc(12);b.writeUInt32LE(2);return b;};
const create=(data,position)=>changeRoadTopology(data,{action:'create-crossing',position}).data;
function base(){let data=empty();for(const point of [[0,0,0],[12,0,0],[0,0,12],[-12,0,0],[0,0,-12],[20,0,20]])data=create(data,point);return data;}
const connect=(data,from,to,extra={})=>changeRoadTopology(data,{action:'connect',from,to,...extra});
const slot=(data,cross,target)=>parseRoads(data).crossings[cross].directions.findIndex(d=>d.target===target);
const bytesSlot=(data,cross,index)=>Buffer.from(data.subarray(8+cross*236+28+index*52,8+cross*236+28+(index+1)*52));
function routes(data){
  const file=parseRoads(data);
  for(const cross of file.crossings)for(let s=0;s<4;s++){
    const d=cross.directions[s];if(d.target===65535){assert.equal(cross.links[s],65535);continue;}
    const visited=new Set();let previous=cross.index,ref=cross.links[s],length=0,pos=cross.position;
    while(ref&32768){assert.notEqual(ref,65535);assert.ok(!visited.has(ref));visited.add(ref);const n=file.nodes[ref&32767];assert.ok(n);length+=Math.hypot(...n.position.map((v,i)=>v-pos[i]));pos=n.position;assert.ok([n.previousCrossing,n.nextCrossing].includes(cross.index));assert.ok([n.previousCrossing,n.nextCrossing].includes(d.target));assert.ok(n.previous===previous||n.next===previous);const next=n.previous===previous?n.next:n.previous;previous=ref;ref=next;}
    assert.equal(ref,d.target);assert.ok(file.crossings[ref].links.includes(previous));length+=Math.hypot(...file.crossings[ref].position.map((v,i)=>v-pos[i]));const stored=data.readFloatLE(8+cross.index*236+28+s*52+4);assert.ok(Math.abs(stored-length)<1e-4);assert.ok(d.lanes.some(l=>l.type));
  }
  for(let i=1;i<file.nodes.length;i++)assert.ok(file.nodes[i].position[0]>=file.nodes[i-1].position[0]);return file;
}
test('new crossings explicitly initialize all absent references and preserve original records and graph selection mapping',()=>{
  let original=connect(base(),0,1).data;const file=parseRoads(original),created=changeRoadTopology(original,{action:'create-crossing',position:[-30,2,8],speed:2,semaphore:1}),after=parseRoads(created.data);
  assert.equal(created.index,6);assert.deepEqual(created.mapping,[0,1,2,3,4,5,7]);assert.deepEqual(after.crossings[6].links,Array(4).fill(65535));assert.ok(after.crossings[6].directions.every(d=>d.target===65535&&d.priority===100&&d.lanes.every(l=>l.type===0)));assert.equal(after.crossings[6].semaphore,1);
  assert.deepEqual(created.data.subarray(8,8+6*236),original.subarray(8,8+6*236));assert.deepEqual(created.data.subarray(12+7*236),original.subarray(12+6*236));
  const removed=changeRoadTopology(created.data,{action:'delete-crossing',index:6});assert.deepEqual(removed.data,original);assert.equal(removed.mapping[6],null);assert.equal(removed.mapping[7],6);
});
test('joining crossings builds reciprocal tagged chains with ownership, lane metadata, sorted nodes and true geometric lengths',()=>{
  const source=base(),forward=[{type:1,distance:-2},{type:2,distance:1.75},{type:3,distance:3.5},{type:0,distance:4}],reverse=[{type:2,distance:2},...Array.from({length:3},()=>({type:0,distance:4}))];
  const result=connect(source,0,1,{positions:[[8,1,4],[3,2,6]],speed:3,forwardLanes:forward,reverseLanes:reverse,forwardPriority:7,reversePriority:11}),file=routes(result.data);
  assert.deepEqual(file.nodes.map(n=>n.position),[[3,2,6],[8,1,4]]);assert.equal(file.nodes[0].speed,3);assert.deepEqual([file.nodes[0].previousCrossing,file.nodes[0].nextCrossing],[0,1]);assert.equal(file.crossings[0].links[0],32769);assert.equal(file.nodes[1].next,32768);assert.equal(file.nodes[0].next,1);
  const f=bytesSlot(result.data,0,0);assert.equal(f.readUInt32LE(14),7);assert.equal(result.data.readUInt32LE(8+236+28+14),11);forward.forEach((lane,i)=>{assert.equal(f[22+i*8],lane.type);assert.equal(f.readFloatLE(24+i*8),lane.distance);});
  for(let cross=2;cross<6;cross++)assert.deepEqual(result.data.subarray(8+cross*236,8+(cross+1)*236),source.subarray(8+cross*236,8+(cross+1)*236));assert.deepEqual(result.mapping,[0,1,2,3,4,5]);
});
test('a four-way junction sorts complete road slots, preserves opaque lanes and supports branching and targeted disconnect',()=>{
  let data=connect(base(),0,1).data;
  // Deliberately opaque lane and padding values belong to the existing route.
  const at=8+28;data[at+12]=0xd7;data.writeUInt32LE(0x7fc01234,at+24+8);const original=bytesSlot(data,0,0);
  for(const target of [2,3,4])data=connect(data,0,target,{positions:[parseRoads(data).crossings[target].position.map(v=>v/3),parseRoads(data).crossings[target].position.map(v=>v*2/3)]}).data;
  const file=routes(data);assert.equal(file.crossings[0].links.filter(ref=>ref!==65535).length,4);assert.throws(()=>connect(data,0,5),/čtyři/);
  assert.deepEqual(bytesSlot(data,0,slot(data,0,1)).subarray(12),original.subarray(12));
  const angles=Array.from({length:4},(_,s)=>data.readFloatLE(8+28+s*52+8));assert.ok(Math.abs(angles.reduce((a,b)=>a+b)-Math.PI*2)<1e-6);
  const keep=bytesSlot(data,0,slot(data,0,2)),removed=changeRoadTopology(data,{action:'disconnect',from:0,to:3}),after=routes(removed.data);assert.equal(after.nodes.length,file.nodes.length-2);assert.deepEqual(new Set(after.crossings[0].directions.filter(d=>d.target!==65535).map(d=>d.target)),new Set([1,2,4]));
  assert.deepEqual(bytesSlot(removed.data,0,slot(removed.data,0,2)).subarray(12),keep.subarray(12));assert.equal(removed.mapping.filter(i=>i===null).length,2);
  const rejoined=connect(removed.data,0,3,{positions:[[-4,0,0],[-8,0,0]]});routes(rejoined.data);assert.equal(parseRoads(rejoined.data).nodes.length,file.nodes.length);
});
test('isolated crossing removal rebases all untagged owners and endpoints without changing node identities',()=>{
  const data=connect(base(),2,4).data,before=parseRoads(data),result=changeRoadTopology(data,{action:'delete-crossing',index:1}),file=routes(result.data);
  assert.equal(result.mapping[1],null);assert.deepEqual(result.mapping.slice(6),[5]);assert.equal(file.crossings[1].directions[0].target,3);assert.deepEqual([file.nodes[0].previousCrossing,file.nodes[0].nextCrossing],[1,3]);assert.deepEqual(file.nodes[0].position,before.nodes[0].position);
  assert.throws(()=>changeRoadTopology(data,{action:'delete-crossing',index:2}),/nejdřív/);
});
test('inactive original direction metadata is retained and reused free slots preserve their opaque bytes',()=>{
  const data=base(),stale=8+2*236+28;
  // A target without a nearby link occurs in original disabled directions.
  data.writeUInt16LE(4,stale);data[stale+12]=0x71;
  const free=8+28;for(const offset of [2,3,12,13,18,19,20,21,23,28,29,31,36,37,39,44,45,47])data[free+offset]=(offset*7)&255;
  const before=bytesSlot(data,0,0),original=Buffer.from(data),result=connect(data,0,1),file=parseRoads(result.data),reused=bytesSlot(result.data,0,slot(result.data,0,1));
  assert.equal(file.nodes.length,1);assert.deepEqual(bytesSlot(result.data,2,0),bytesSlot(data,2,0));
  for(const offset of [2,3,12,13,18,19,20,21,23,28,29,31,36,37,39,44,45,47])assert.equal(reused[offset],before[offset]);
  const removed=changeRoadTopology(result.data,{action:'disconnect',from:0,to:1});assert.deepEqual(bytesSlot(removed.data,2,0),bytesSlot(data,2,0));assert.deepEqual(data,original);
});
test('unsafe topology, hidden ownership, shared chains, zero XZ segments, disabled directions and invalid parameters reject before publication',()=>{
  const source=base(),unchanged=Buffer.from(source);
  for(const request of [{action:'missing'},{action:'create-crossing',position:[1,2]},{action:'create-crossing',position:[Infinity,0,0]},{action:'create-crossing',position:[0,0,0],speed:-1},{action:'create-crossing',position:[0,0,0],semaphore:2},{action:'connect',from:0,to:0},{action:'connect',from:0,to:6},{action:'connect',from:0,to:1,positions:[]},{action:'connect',from:0,to:1,positions:[[0,1,0]]},{action:'connect',from:0,to:1,positions:Array(2)},{action:'connect',from:0,to:1,forwardLanes:Array(4)},{action:'connect',from:0,to:1,forwardLanes:Array.from({length:4},()=>({type:0,distance:4}))},{action:'connect',from:0,to:1,forwardPriority:-1},{action:'disconnect',from:0,to:1}])assert.throws(()=>changeRoadTopology(source,request));assert.deepEqual(source,unchanged);
  const linked=connect(source,0,1).data;assert.throws(()=>connect(linked,0,1),/už mají/);
  const shared=Buffer.from(linked);shared.writeUInt16LE(32768,8+2*236+20);shared.writeUInt16LE(1,8+2*236+28);assert.throws(()=>changeRoadTopology(shared,{action:'disconnect',from:0,to:1}),/vzájemné|další/);
  const owner=Buffer.from(linked);owner.writeUInt16LE(5,12+6*236+20);assert.throws(()=>changeRoadTopology(owner,{action:'disconnect',from:0,to:1}),/vlastníky/);assert.throws(()=>changeRoadTopology(owner,{action:'delete-crossing',index:5}),/používá/);
});
test('topology project transactions preserve stale guards, other assets, exact export/reopen and successive undo',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-road-network-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Network',assets:[],history:[]}));const p=await ModProject.open(root),name='missions/TEST/road.bin',source=base();await p.createFiles([{path:name,data:source},{path:'missions/TEST/tree.klz',data:Buffer.from('unchanged')}]);const baseline=p.manifest.history.length,versions=[source];
  for(const request of [{action:'connect',from:0,to:1},{action:'connect',from:0,to:2},{action:'disconnect',from:0,to:1},{action:'delete-crossing',index:1}]){const before=await p.read(name),expected=changeRoadTopology(before,request);await assert.rejects(p.changeRoadTopology(name,request,'stale'),/změnil/);const selection=await p.changeRoadTopology(name,request,hash(before));assert.deepEqual(selection,{index:expected.index,mapping:expected.mapping});versions.push(expected.data);assert.deepEqual(await p.read(name),expected.data);}
  const reopened=await ModProject.open(root),destination=path.join(root,'export');await reopened.export(destination);assert.deepEqual(await fs.readFile(path.join(destination,name)),versions.at(-1));for(let i=versions.length-2;i>=0;i--){await reopened.undo();assert.deepEqual(await reopened.read(name),versions[i]);}assert.equal(reopened.manifest.history.length,baseline);assert.equal((await reopened.read('missions/TEST/tree.klz')).toString(),'unchanged');
});
