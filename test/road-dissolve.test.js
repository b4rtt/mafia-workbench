import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {changeRoadTopology as change} from '../src/core/road-topology.js';
import {parseRoads} from '../src/core/roads.js';
import {roadConnections,roadDissolvePlan} from '../src/shared/roads.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';
const action={action:'dissolve-crossing',index:1};
function source(extra={}){
  let data=Buffer.alloc(12);data.writeUInt32LE(2);
  for(const position of [[-12,0,0],[0,2,4],[12,0,0],[30,0,12],[40,0,15]])data=change(data,{action:'create-crossing',position}).data;
  for(const [from,to,positions]of [[0,1,[[-9,1,2],[-3,2,5]]],[1,2,[[4,1,6],[9,0,4]]],[3,4,[[35,1,14]]]])data=change(data,{action:'connect',from,to,positions,...extra}).data;
  return data;
}
function route(file,from,to){const link=roadConnections(file,from).find(c=>c.target===to);assert.ok(link);return [file.crossings[from].position,...link.nodes.map(ref=>file.nodes[ref&32767].position),file.crossings[to].position];}
const slot=(file,from,to)=>roadConnections(file,from).find(c=>c.target===to).slot;
const slotAt=(cross,s)=>8+cross*236+28+s*52;
function verify(data){
  const file=parseRoads(data);
  for(const c of file.crossings)for(const link of roadConnections(file,c.index)){
    const back=roadConnections(file,link.target).find(l=>l.target===c.index);assert.deepEqual(back.nodes,[...link.nodes].reverse());
    for(const ref of link.nodes){const n=file.nodes[ref&32767];assert.deepEqual([n.previousCrossing,n.nextCrossing].sort((a,b)=>a-b),[c.index,link.target].sort((a,b)=>a-b));}
    if(c.directions[link.slot].target!==65535){const points=route(file,c.index,link.target),length=points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(...p.map((v,j)=>v-points[i][j])),0);assert.ok(Math.abs(data.readFloatLE(slotAt(c.index,link.slot)+4)-length)<1e-4);}
  }
  return file;
}
test('dissolve preserves the complete curved 3D path, speed, mapping, outer opaque fields and unrelated road',()=>{
  const bytes=source(),before=parseRoads(bytes),wanted=[...route(before,0,1).slice(0,-1),...route(before,1,2)];
  for(const [cross,to]of [[0,1],[2,1]]){const at=slotAt(cross,slot(before,cross,to));bytes[at+12]=cross+71;bytes.writeUInt32LE(cross+13,at+14);bytes.writeUInt32LE(0x7fc01234,at+32);}
  bytes[8+236+12]=1;const baseline=Buffer.from(bytes),result=change(bytes,action),file=verify(result.data);
  assert.equal(file.crossings.length,4);assert.equal(file.nodes.length,before.nodes.length+1);assert.deepEqual(route(file,0,1),wanted);
  assert.deepEqual(bytes,baseline);assert.equal(file.nodes[result.index-4].speed,before.crossings[1].speed);assert.deepEqual(file.nodes[result.index-4].position,before.crossings[1].position);assert.equal(result.mapping[1],result.index);
  for(let i=0;i<before.nodes.length;i++)assert.deepEqual(file.nodes[result.mapping[5+i]-4].position,before.nodes[i].position);
  for(const [oldCross,newCross]of [[0,0],[2,1]]){const old=slotAt(oldCross,slot(before,oldCross,1)),now=slotAt(newCross,slot(file,newCross,1-newCross));assert.deepEqual(result.data.subarray(now+10,now+52),bytes.subarray(old+10,old+52));}
  // Unrelated record changes only compacted crossing and sorted node references.
  for(const [oldCross,newCross,target]of [[3,2,3],[4,3,2]]){const expected=Buffer.from(bytes.subarray(8+oldCross*236,8+(oldCross+1)*236));const s=slot(before,oldCross,oldCross===3?4:3);expected.writeUInt16LE(target,28+s*52);const near=expected.readUInt16LE(20+s*2);expected.writeUInt16LE(32768|(result.mapping[5+(near&32767)]-4),20+s*2);assert.deepEqual(result.data.subarray(8+newCross*236,8+(newCross+1)*236),expected);}
});
test('dissolve supports reversed node orientations and one-way or fully closed physical roads',()=>{
  for(const closed of [false,true]){
    let bytes=source({reverseEnabled:false});
    if(closed)for(const [from,to]of [[0,1],[1,2]])bytes=change(bytes,{action:'edit-road',from,to,forward:{enabled:false}}).data;
    const file=parseRoads(bytes),start=12+5*236;
    for(const n of file.nodes){for(const [a,b]of [[16,18],[20,22]]){const at=start+n.index*24,value=bytes.readUInt16LE(at+a);bytes.writeUInt16LE(bytes.readUInt16LE(at+b),at+a);bytes.writeUInt16LE(value,at+b);}}
    const after=verify(change(bytes,action).data),a=after.crossings[0].directions[slot(after,0,1)],b=after.crossings[1].directions[slot(after,1,0)];assert.equal(a.target,closed?65535:1);assert.equal(b.target,65535);
  }
});
test('split followed by dissolve retains endpoints and selected point even when the crossing was appended',()=>{
  let bytes=source();bytes=change(bytes,{action:'disconnect',from:1,to:2}).data;
  const before=parseRoads(bytes),link=roadConnections(before,0).find(c=>c.target===1),split=change(bytes,{action:'split-crossing',index:link.nodes[0]&32767}),joined=change(split.data,{action:'dissolve-crossing',index:5}),file=verify(joined.data);
  assert.deepEqual(route(file,0,1).filter((_,i)=>i!==1),route(before,0,1)); // split added a midpoint at this end
  assert.deepEqual(file.nodes[joined.index-file.crossings.length].position,before.nodes[link.nodes[0]&32767].position);
});
test('dissolve rejects branches, disconnected direction states, lane transitions and hidden foreign references without mutation',()=>{
  const original=source(),cases=[];
  cases.push([change(original,{action:'connect',from:1,to:3}).data,/právě dvě/]);
  cases.push([change(original,{action:'edit-road',from:1,to:2,forward:{enabled:false}}).data,/směry/]);
  cases.push([change(original,{action:'edit-road',from:1,to:2,forward:{lanes:[{distance:3},{},{},{}]}}).data,/pruhy/]);
  const file=parseRoads(original),foreign=Buffer.from(original);foreign.writeUInt16LE(1,slotAt(3,3));cases.push([foreign,/další výjezd/]);
  const owner=Buffer.from(original),n=file.nodes.find(n=>n.previousCrossing===3);owner.writeUInt16LE(1,12+5*236+n.index*24+20);cases.push([owner,/jiný silniční bod/]);
  for(const [data,pattern]of cases){const before=Buffer.from(data);assert.throws(()=>change(data,action),pattern);assert.deepEqual(data,before);}
  assert.throws(()=>roadDissolvePlan(file,0),/právě dvě/);assert.throws(()=>change(original,{...action,index:1.5}),/mimo síť/);
});
test('dissolve handles two directly adjacent endpoints and refuses to exceed the native node limit',()=>{
  let bytes=source();const file=parseRoads(bytes),left=slot(file,1,0),right=slot(file,1,2),a=slot(file,0,1),b=slot(file,2,1);
  for(const [cross,s,ref]of [[0,a,1],[1,left,0],[1,right,2],[2,b,1]])bytes.writeUInt16LE(ref,8+cross*236+20+s*2);
  // Drop the four now-unreferenced nodes; retain no unrelated route in this fixture.
  for(const cross of [3,4])for(let s=0;s<4;s++){bytes.writeUInt16LE(65535,8+cross*236+20+s*2);bytes.writeUInt16LE(65535,slotAt(cross,s));}
  bytes=Buffer.from(bytes.subarray(0,12+5*236));bytes.writeUInt32LE(0,8+5*236);const result=change(bytes,action),after=verify(result.data);assert.equal(after.nodes.length,1);assert.deepEqual(route(after,0,1),[file.crossings[0].position,file.crossings[1].position,file.crossings[2].position]);
  assert.throws(()=>roadDissolvePlan({...file,nodes:Array(32767)},1),/maximální počet/);
});
test('dissolve project change guards stale sources, exports/reopens exactly and undoes a single road-only transaction',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-road-dissolve-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Dissolve',assets:[],history:[]}));const p=await ModProject.open(root),name='missions/TEST/road.bin',bytes=source();
  await p.createFiles([{path:name,data:bytes},{path:'missions/TEST/scene2.bin',data:Buffer.from('scene')},{path:'missions/TEST/tree.klz',data:Buffer.from('collision')}]);const baseline=p.manifest.history.length;
  await assert.rejects(p.changeRoadTopology(name,action,'stale'),/změnil/);assert.equal(p.manifest.history.length,baseline);
  const expected=change(bytes,action),saved=await p.changeRoadTopology(name,action,hash(bytes));assert.equal(saved.index,expected.index);assert.deepEqual(saved.mapping,expected.mapping);assert.equal(p.manifest.history.length,baseline+1);
  const reopened=await ModProject.open(root);assert.deepEqual(await reopened.read(name),expected.data);await reopened.export(root+'/export');assert.deepEqual(await fs.readFile(root+'/export/'+name),expected.data);await reopened.undo();assert.deepEqual(await reopened.read(name),bytes);assert.equal(reopened.manifest.history.length,baseline);assert.equal((await reopened.read('missions/TEST/tree.klz')).toString(),'collision');assert.equal((await reopened.read('missions/TEST/scene2.bin')).toString(),'scene');
});

test('dissolve compacts a first crossing and rejects nonfinite active lane offsets',()=>{
  const original=source(),bytes=Buffer.from(original),file=parseRoads(bytes),a=Buffer.from(bytes.subarray(8,244)),b=Buffer.from(bytes.subarray(244,480));b.copy(bytes,8);a.copy(bytes,244);
  const remap=ref=>ref===0?1:ref===1?0:ref;
  for(let c=0;c<5;c++)for(let s=0;s<4;s++)for(const at of [8+c*236+20+s*2,slotAt(c,s)])bytes.writeUInt16LE(remap(bytes.readUInt16LE(at)),at);
  for(const n of file.nodes)for(const delta of [16,18,20,22]){const at=12+5*236+n.index*24+delta;bytes.writeUInt16LE(remap(bytes.readUInt16LE(at)),at);}
  const before=parseRoads(bytes),plan=roadDissolvePlan(before,0),result=change(bytes,{...action,index:0}),after=verify(result.data);assert.deepEqual(route(after,result.mapping[plan.from],result.mapping[plan.to]),plan.positions);assert.equal(result.mapping[0],result.index);assert.deepEqual(after.nodes[result.index-4].position,before.crossings[0].position);
  const invalid=Buffer.from(original);invalid.writeFloatLE(NaN,slotAt(0,slot(file,0,1))+24);assert.throws(()=>change(invalid,action),/posun/);
});
