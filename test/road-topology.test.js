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
test('splitting a road retains directional lanes, priorities and opaque bytes on both halves and leaves unrelated routes intact',()=>{
  let original=connect(base(),0,1,{positions:[[2,1,2],[7,2,3],[10,3,1]],speed:2.5,forwardPriority:7,reversePriority:19}).data;
  original=connect(original,2,5).data;
  for(const [cross,target]of [[0,1],[1,0]]){const at=8+cross*236+28+slot(original,cross,target)*52;original[at+2]=0x93;original[at+12]=0x72;original.writeUInt32LE(0x7fc01234,at+32);original.writeFloatLE(-0,at+48);}
  const before=Buffer.from(original),file=parseRoads(original),index=file.nodes.findIndex(n=>n.position[0]===7),forward=bytesSlot(original,0,slot(original,0,1)),reverse=bytesSlot(original,1,slot(original,1,0));
  const result=changeRoadTopology(original,{action:'split-crossing',index,speed:5.5,semaphore:1}),after=routes(result.data);
  assert.deepEqual(original,before);assert.equal(result.index,6);assert.equal(result.mapping[6+index],6);assert.equal(after.crossings.length,7);assert.equal(after.nodes.length,file.nodes.length-1);assert.deepEqual(after.crossings[6].position,[7,2,3]);assert.equal(after.crossings[6].speed,5.5);assert.equal(after.crossings[6].semaphore,1);
  for(const [cross,target,template]of [[0,6,forward],[6,1,forward],[1,6,reverse],[6,0,reverse]]){const actual=bytesSlot(result.data,cross,slot(result.data,cross,target));assert.deepEqual(actual.subarray(2,4),template.subarray(2,4));assert.deepEqual(actual.subarray(12),template.subarray(12));}
  for(const [cross,target]of [[2,5],[5,2]])assert.deepEqual(bytesSlot(result.data,cross,slot(result.data,cross,target)),bytesSlot(original,cross,slot(original,cross,target)));
  assert.equal(after.crossings[6].links.filter(ref=>ref!==65535).length,2);
  const branch=connect(result.data,6,3,{positions:[[-1,2,4]]});routes(branch.data);assert.equal(parseRoads(branch.data).crossings[6].links.filter(ref=>ref!==65535).length,3);
  routes(changeRoadTopology(branch.data,{action:'disconnect',from:6,to:3}).data);
});
test('first, last and sole road nodes become crossings with missing midpoint nodes, including reversed record orientation',()=>{
  for(const positions of [[[2,0,0],[6,0,0],[10,0,0]],[[6,0,0]]])for(const x of new Set([positions[0][0],positions.at(-1)[0]])){
    const original=connect(base(),0,1,{positions,speed:2}).data,start=12+6*236;
    for(let i=0;i<positions.length;i++){const at=start+i*24,prev=original.readUInt16LE(at+16),next=original.readUInt16LE(at+18);original.writeUInt16LE(next,at+16);original.writeUInt16LE(prev,at+18);original.writeUInt16LE(1,at+20);original.writeUInt16LE(0,at+22);}
    const index=parseRoads(original).nodes.findIndex(n=>n.position[0]===x),result=changeRoadTopology(original,{action:'split-crossing',index}),file=routes(result.data);
    assert.equal(file.nodes.length,positions.length===1?2:positions.length);assert.deepEqual(file.crossings[6].position,[x,0,0]);assert.equal(result.mapping[6+index],6);
    const generated=[...(x===positions[0][0]?[x/2]:[]),...(x===positions.at(-1)[0]?[(x+12)/2]:[])];for(const value of generated)assert.ok(file.nodes.some(n=>n.position[0]===value&&n.speed===2));
  }
});
test('split resolves the selected chain when two different roads have the same endpoint crossings',()=>{
  let data=empty();for(const point of [[0,0,0],[12,0,0],[0,0,0],[12,0,0]])data=create(data,point);data=connect(data,0,1,{positions:[[6,0,2]]}).data;data=connect(data,2,3,{positions:[[6,0,-2]]}).data;
  for(const [old,cross,target]of [[2,0,1],[3,1,0]]){const source=8+old*236,destination=8+cross*236;data.copy(data,destination+28+52,source+28,source+28+52);data.writeUInt16LE(target,destination+28+52);data.writeUInt16LE(data.readUInt16LE(source+20),destination+22);data.writeUInt16LE(65535,source+20);data.writeUInt16LE(65535,source+28);}
  const file=parseRoads(data),index=file.nodes.findIndex(n=>n.position[2]===-2),start=12+4*236+index*24;for(const offset of [16,18,20,22]){const ref=data.readUInt16LE(start+offset);data.writeUInt16LE(ref===2?0:ref===3?1:ref,start+offset);}
  const keep=bytesSlot(data,0,0),result=changeRoadTopology(data,{action:'split-crossing',index}),after=routes(result.data);assert.deepEqual(bytesSlot(result.data,0,slot(result.data,0,1)).subarray(0,8),keep.subarray(0,8));assert.equal(after.crossings[4].links.filter(ref=>ref!==65535).length,2);assert.equal(after.nodes.length,3);
});
test('split crossing rejects orphan, shared, ambiguous or collapsed roads and invalid settings without mutating the source',()=>{
  const source=connect(base(),0,1).data,start=12+6*236;
  for(const request of [{index:-1},{index:1},{index:0,speed:-1},{index:0,semaphore:2}])assert.throws(()=>changeRoadTopology(source,{action:'split-crossing',...request}));
  for(const modify of [data=>data.writeUInt16LE(5,start+20),data=>{data.writeUInt16LE(32768,8+22);data.writeUInt16LE(1,8+28+52);},data=>data.writeUInt16LE(32768,8+2*236+20),data=>data.writeUInt16LE(65535,8+236+28),data=>data.writeFloatLE(0,start)]){
    const data=Buffer.from(source);modify(data);const before=Buffer.from(data);assert.throws(()=>changeRoadTopology(data,{action:'split-crossing',index:0}));assert.deepEqual(data,before);
  }
});
test('split crossing uses compacted indices even at the native node limit and rejects crossings beyond the limit',()=>{
  const count=32767,data=Buffer.alloc(12+6*236+count*24);base().copy(data);data.writeUInt32LE(count,8+6*236);data.writeFloatLE(count+1,8+236);
  for(const [cross,near,target]of [[0,32768,1],[1,32768|(count-1),0]]){data.writeUInt16LE(near,8+cross*236+20);data.writeUInt16LE(target,8+cross*236+28);data[8+cross*236+28+22]=2;}
  for(let i=0;i<count;i++){const at=12+6*236+i*24;data.writeFloatLE(i+1,at);data.writeFloatLE(1.2,at+12);data.writeUInt16LE(i?32768|(i-1):0,at+16);data.writeUInt16LE(i+1<count?32768|(i+1):1,at+18);data.writeUInt16LE(0,at+20);data.writeUInt16LE(1,at+22);}
  const result=changeRoadTopology(data,{action:'split-crossing',index:0});assert.equal(parseRoads(result.data).nodes.length,count);routes(result.data);
  const maximum=Buffer.alloc(12+32768*236);maximum.writeUInt32LE(2);maximum.writeUInt32LE(32768,4);const cross=create(empty(),[0,0,0]).subarray(8,244);for(let i=0;i<32768;i++)cross.copy(maximum,8+i*236);assert.throws(()=>changeRoadTopology(maximum,{action:'split-crossing',index:0}),/maximální počet křižovatek/);
});
test('split crossing project transaction has stale protection, byte-exact export and undo while preserving scene and collision assets',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-road-split-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Split',assets:[],history:[]}));const p=await ModProject.open(root),name='missions/TEST/road.bin',source=connect(base(),0,1).data;
  await p.createFiles([{path:name,data:source},{path:'missions/TEST/scene2.bin',data:Buffer.from('scene')},{path:'missions/TEST/tree.klz',data:Buffer.from('collision')}]);const baseline=p.manifest.history.length,request={action:'split-crossing',index:0},expected=changeRoadTopology(source,request);
  await assert.rejects(p.changeRoadTopology(name,request,'stale'),/změnil/);assert.equal(p.manifest.history.length,baseline);await p.changeRoadTopology(name,request,hash(source));const reopened=await ModProject.open(root),destination=path.join(root,'export');await reopened.export(destination);assert.deepEqual(await fs.readFile(path.join(destination,name)),expected.data);await reopened.undo();assert.deepEqual(await reopened.read(name),source);assert.equal(reopened.manifest.history.length,baseline);for(const [asset,value]of [['scene2.bin','scene'],['tree.klz','collision']])assert.equal((await reopened.read(`missions/TEST/${asset}`)).toString(),value);
});
