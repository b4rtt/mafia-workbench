import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {changeRoadTopology as change} from '../src/core/road-topology.js';
import {parseRoads} from '../src/core/roads.js';
import {roadMergePlan,roadConnections} from '../src/shared/roads.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';
const slotAt=(cross,slot)=>8+cross*236+28+slot*52;
const link=(file,from,to)=>roadConnections(file,from).find(l=>l.target===to);
const merge=(bytes,from=0,to=1)=>change(bytes,{action:'merge-crossings',from,to});
function fixture(extra={}){
  let data=Buffer.alloc(12);data.writeUInt32LE(2);
  for(const position of [[0,1,0],[8,2,2],[-12,3,0],[8,0,16],[30,0,30],[40,0,30],[0,0,-12],[20,0,2]])data=change(data,{action:'create-crossing',position}).data;
  for(const [from,to,positions]of [[0,1,[[2,1,1],[6,2,2]]],[0,2,[[-4,2,-1],[-8,3,-2]]],[1,3,[[9,1,8]]],[4,5,[[35,0,30]]]])data=change(data,{action:'connect',from,to,positions,...extra}).data;
  return data;
}
function verify(bytes){
  const file=parseRoads(bytes);assert.equal(file.warnings.length,0);
  for(const c of file.crossings)for(const l of roadConnections(file,c.index)){
    const reversed=roadConnections(file,l.target).filter(r=>r.target===c.index&&r.nodes.length===l.nodes.length&&r.nodes.every((ref,i)=>ref===l.nodes[l.nodes.length-1-i]));assert.equal(reversed.length,1);
    for(const ref of l.nodes){const n=file.nodes[ref&32767];assert.deepEqual([n.previousCrossing,n.nextCrossing].sort((a,b)=>a-b),[c.index,l.target].sort((a,b)=>a-b));}
    if(c.directions[l.slot].target!==65535){
      assert.equal(c.directions[l.slot].target,l.target);const positions=[c.position,...l.nodes.map(ref=>file.nodes[ref&32767].position),file.crossings[l.target].position];const distance=positions.slice(1).reduce((sum,p,i)=>sum+Math.hypot(...p.map((v,j)=>v-positions[i][j])),0);assert.ok(Math.abs(bytes.readFloatLE(slotAt(c.index,l.slot)+4)-distance)<1e-4);
    }
  }
  return file;
}
test('merge preserves destination header, curved branch points, complete lane payloads and unrelated records',()=>{
  const bytes=fixture(),before=parseRoads(bytes),start=12+before.crossings.length*236;
  bytes[8+236+12]=1;bytes[8+236+13]=121;bytes.writeFloatLE(2.75,8+236+16);
  for(const [from,to]of [[0,2],[2,0],[1,3],[3,1]]){const at=slotAt(from,link(before,from,to).slot);bytes.writeUInt16LE(0x1234,at+2);bytes[at+12]=55;bytes.writeUInt32LE(0x7fc0abcd,at+32);bytes.writeFloatLE(-0,at+48);}
  const baseline=Buffer.from(bytes),plan=roadMergePlan(before,0,1),result=merge(bytes),after=verify(result.data),total=after.crossings.length;
  assert.equal(total,before.crossings.length-1);assert.equal(after.nodes.length,before.nodes.length-plan.connector.nodes.length);assert.equal(result.index,0);assert.equal(result.mapping[0],0);assert.equal(result.mapping[1],0);assert.deepEqual(result.data.subarray(8,28),bytes.subarray(244,264));assert.deepEqual(bytes,baseline);
  const removed=new Set(plan.connector.nodes.map(ref=>ref&32767));
  const remap=ref=>ref===65535?ref:ref&32768?32768|(result.mapping[before.crossings.length+(ref&32767)]-total):result.mapping[ref];
  for(const n of before.nodes){
    const mapped=result.mapping[before.crossings.length+n.index];if(removed.has(n.index)){assert.equal(mapped,null);continue;}
    const expected=Buffer.from(bytes.subarray(start+n.index*24,start+(n.index+1)*24));for(const delta of [16,18,20,22])expected.writeUInt16LE(remap(expected.readUInt16LE(delta)),delta);assert.deepEqual(result.data.subarray(12+total*236+(mapped-total)*24,12+total*236+(mapped-total+1)*24),expected);
  }
  for(const [from,to]of [[0,2],[2,0],[1,3],[3,1],[4,5],[5,4]]){const old=slotAt(from,link(before,from,to).slot),now=slotAt(result.mapping[from],link(after,result.mapping[from],result.mapping[to]).slot);assert.deepEqual(result.data.subarray(now+2,now+4),bytes.subarray(old+2,old+4));assert.deepEqual(result.data.subarray(now+12,now+52),bytes.subarray(old+12,old+52));if(from>=4)assert.deepEqual(result.data.subarray(now+4,now+52),bytes.subarray(old+4,old+52));}
});
test('merge works in either index order and preserves disabled physical legs with reversed node records',()=>{
  for(const closed of [false,true])for(const [from,to]of [[0,1],[1,0]]){
    let bytes=fixture({reverseEnabled:false});if(closed)for(const [a,b]of [[0,1],[0,2],[1,3]])bytes=change(bytes,{action:'edit-road',from:a,to:b,forward:{enabled:false}}).data;
    const before=parseRoads(bytes),start=12+before.crossings.length*236;
    for(const n of before.nodes)for(const [a,b]of [[16,18],[20,22]]){const at=start+n.index*24,old=bytes.readUInt16LE(at+a);bytes.writeUInt16LE(bytes.readUInt16LE(at+b),at+a);bytes.writeUInt16LE(old,at+b);}
    const result=merge(bytes,from,to),after=verify(result.data);
    for(const [a,b]of [[0,2],[1,3]])for(const [x,y]of [[a,b],[b,a]])assert.equal(after.crossings[result.mapping[x]].directions[link(after,result.mapping[x],result.mapping[y]).slot].target===65535,before.crossings[x].directions[link(before,x,y).slot].target===65535);
  }
});
test('merge allows four outgoing legs and distinct parallel branches but rejects fifth exits',()=>{
  let bytes=fixture();bytes=change(bytes,{action:'connect',from:0,to:6}).data;bytes=change(bytes,{action:'connect',from:1,to:7}).data;assert.equal(roadConnections(verify(merge(bytes).data),0).length,4);
  const full=change(bytes,{action:'connect',from:0,to:3}).data;assert.throws(()=>merge(full),/čtyři výjezdy/);
  bytes=change(fixture(),{action:'connect',from:1,to:2,positions:[[5,3,-4],[-5,3,-5]]}).data;
  const result=merge(bytes),after=verify(result.data),parallel=roadConnections(after,0).filter(l=>l.target===result.mapping[2]);assert.equal(parallel.length,2);assert.notDeepEqual(parallel[0].nodes,parallel[1].nodes);
});
test('merge refuses ambiguous connectors, foreign links, ownership errors and collapsed paths without mutation',()=>{
  const bytes=fixture(),before=parseRoads(bytes),cases=[];
  const foreign=Buffer.from(bytes);foreign.writeUInt16LE(0,slotAt(4,3));cases.push([foreign,/další výjezd/]);
  const ownership=Buffer.from(bytes);ownership.writeUInt16LE(0,12+8*236+(link(before,4,5).nodes[0]&32767)*24+20);cases.push([ownership,/jiný silniční bod/]);
  const wrong=Buffer.from(bytes);wrong.writeUInt16LE(3,12+8*236+(link(before,0,2).nodes[0]&32767)*24+20);cases.push([wrong,/vlastníky/]);
  const invalid=Buffer.from(bytes);invalid.writeFloatLE(NaN,slotAt(0,link(before,0,2).slot)+24);cases.push([invalid,/posun/]);
  const collapsed=Buffer.from(bytes),near=before.nodes[link(before,0,2).nodes[0]&32767].position;near.forEach((n,i)=>collapsed.writeFloatLE(n,8+236+i*4));cases.push([collapsed,/XZ/]);
  const dangling=Buffer.from(bytes);dangling.writeUInt16LE(3,slotAt(0,3));cases.push([dangling,/nepoužitý výjezd/]);
  for(const [data,pattern]of cases){const original=Buffer.from(data);assert.throws(()=>merge(data),pattern);assert.deepEqual(data,original);}
  assert.throws(()=>merge(bytes,0,0),/různé/);assert.throws(()=>merge(bytes,0,4),/společnou cestu/);assert.throws(()=>merge(bytes,-1,1),/mimo síť/);assert.throws(()=>merge(bytes,0,1.5),/mimo síť/);
  let parallel=change(bytes,{action:'disconnect',from:1,to:3}).data;parallel=change(parallel,{action:'connect',from:0,to:3}).data;
  // Turn the third endpoint into a second, separate connector between 0 and 1.
  const f=parseRoads(parallel),first=link(f,0,3),second=link(f,3,0),copy=Buffer.from(parallel);copy.writeUInt16LE(f.crossings[3].links[second.slot],8+236+20+3*2);copy.copy(copy,slotAt(1,3),slotAt(3,second.slot),slotAt(3,second.slot)+52);
  for(const [c,s,target]of [[0,first.slot,1],[1,3,0]])copy.writeUInt16LE(target,slotAt(c,s));
  for(const ref of first.nodes){const at=12+8*236+(ref&32767)*24;for(const d of [16,18,20,22])if(copy.readUInt16LE(at+d)===3)copy.writeUInt16LE(1,at+d);}
  for(let s=0;s<4;s++)for(const at of [8+3*236+20+s*2,slotAt(3,s)])copy.writeUInt16LE(65535,at);
  assert.throws(()=>merge(copy),/právě jednu společnou/);
});
test('merge project uses one guarded transaction and exact reopen/export/undo without touching mission assets',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-road-merge-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Merge',assets:[],history:[]}));const p=await ModProject.open(root),name='missions/TEST/road.bin',bytes=fixture();await p.createFiles([{path:name,data:bytes},{path:'missions/TEST/scene2.bin',data:Buffer.from('scene')},{path:'missions/TEST/tree.klz',data:Buffer.from('collision')}]);const history=p.manifest.history.length;
  await assert.rejects(p.changeRoadTopology(name,{action:'merge-crossings',from:0,to:1},'stale'),/změnil/);assert.equal(p.manifest.history.length,history);
  const expected=merge(bytes),saved=await p.changeRoadTopology(name,{action:'merge-crossings',from:0,to:1},hash(bytes));assert.deepEqual(saved.mapping,expected.mapping);assert.equal(saved.index,expected.index);assert.equal(p.manifest.history.length,history+1);
  const reopened=await ModProject.open(root);assert.deepEqual(await reopened.read(name),expected.data);await reopened.export(root+'/export');assert.deepEqual(await fs.readFile(root+'/export/'+name),expected.data);await reopened.undo();assert.deepEqual(await reopened.read(name),bytes);assert.equal(reopened.manifest.history.length,history);assert.equal((await reopened.read('missions/TEST/scene2.bin')).toString(),'scene');assert.equal((await reopened.read('missions/TEST/tree.klz')).toString(),'collision');
});

test('merge can remove an entire two-end chain, including a direct legacy link, without adding any nodes',()=>{
  for(const direct of [false,true]){
    let bytes=Buffer.alloc(12);bytes.writeUInt32LE(2);
    for(const position of [[0,0,0],[8,0,0]])bytes=change(bytes,{action:'create-crossing',position}).data;
    bytes=change(bytes,{action:'connect',from:0,to:1}).data;
    if(direct){const file=parseRoads(bytes);for(const [a,b]of [[0,1],[1,0]])bytes.writeUInt16LE(b,8+a*236+20+link(file,a,b).slot*2);bytes=Buffer.from(bytes.subarray(0,12+2*236));bytes.writeUInt32LE(0,8+2*236);}
    const result=merge(bytes),after=verify(result.data);assert.equal(after.crossings.length,1);assert.equal(after.nodes.length,0);assert.equal(result.index,0);assert.deepEqual(result.mapping.slice(0,2),[0,0]);assert(after.crossings[0].links.every(ref=>ref===65535));assert(after.crossings[0].directions.every(d=>d.target===65535));assert.deepEqual(after.crossings[0].position,[8,0,0]);
  }
});
