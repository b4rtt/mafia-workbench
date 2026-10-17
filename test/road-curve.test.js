import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {roadCurvePlan} from '../src/shared/road-curve.js';
import {roadConnections,roadSettingsPair} from '../src/shared/roads.js';
import {parseRoads} from '../src/core/roads.js';
import {changeRoadTopology} from '../src/core/road-topology.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';

function fixture(transform=p=>p,extra={}){
  let data=Buffer.alloc(12);data.writeUInt32LE(2);
  for(const position of [[0,0,0],[20,0,20],[-40,0,0],[-40,0,20]].map(transform))data=changeRoadTopology(data,{action:'create-crossing',position}).data;
  data=changeRoadTopology(data,{action:'connect',from:0,to:1,positions:[[20,0,0]].map(transform),speed:2.5,...extra}).data;
  data=changeRoadTopology(data,{action:'connect',from:2,to:3,positions:[[-40,0,10]].map(transform),speed:4}).data;
  const file=parseRoads(data),index=file.nodes.findIndex(n=>n.speed===2.5);return {data,index};
}
function verify(data){
  const file=parseRoads(data);assert.deepEqual(file.warnings,[]);
  for(const c of file.crossings)for(const route of roadConnections(file,c.index)){
    const pair=roadSettingsPair(file,c.index,route.slot);assert(pair);
    const chain=[c.position,...route.nodes.map(r=>file.nodes[r&32767].position),file.crossings[route.target].position];
    const length=chain.slice(1).reduce((sum,p,i)=>sum+Math.hypot(...p.map((v,j)=>v-chain[i][j])),0),at=8+c.index*236+28+route.slot*52;
    if(c.directions[route.slot].target!==65535)assert(Math.abs(data.readFloatLE(at+4)-length)<.001);
    for(const r of route.nodes){const n=file.nodes[r&32767];assert.deepEqual(new Set([n.previousCrossing,n.nextCrossing]),new Set([c.index,route.target]));}
  }return file;
}
test('a circular fillet has known tangent endpoints, bounded chords and unchanged neighbours',()=>{
  for(const sign of [1,-1])for(const rotation of [0,.7]){
    const transform=([x,y,z])=>[100+x*Math.cos(rotation)-sign*z*Math.sin(rotation),y,-40+x*Math.sin(rotation)+sign*z*Math.cos(rotation)].map(Math.fround),{data,index}=fixture(transform),before=Buffer.from(data),plan=roadCurvePlan(parseRoads(data),index,6);
    const near=(a,b)=>assert(Math.hypot(...a.map((v,i)=>v-b[i]))<.0001);
    near(plan.positions[0],transform([14,0,0]));near(plan.positions.at(-1),transform([20,0,6]));
    const center=transform([14,0,6]);for(const p of plan.positions)assert(Math.abs(Math.hypot(p[0]-center[0],p[2]-center[2])-6)<.0001);
    for(let i=1;i<plan.positions.length;i++)assert(Math.hypot(...plan.positions[i].map((n,j)=>n-plan.positions[i-1][j]))<=.751);
    const result=changeRoadTopology(data,{action:'round-node',index,radius:6}),file=verify(result.data);
    assert.equal(file.nodes.length,parseRoads(data).nodes.length+plan.positions.length-1);assert.equal(file.crossings.length,4);near(file.nodes[result.index-4].position,plan.positions[plan.middle]);assert.equal(result.mapping[4+index],result.index);
    assert.deepEqual(data,before);assert(file.nodes.filter(n=>n.speed===2.5).every(n=>plan.positions.some(p=>p.every((v,i)=>v===n.position[i]))));
    for(const old of parseRoads(data).nodes)if(old.index!==index){const after=file.nodes[result.mapping[4+old.index]-4];assert.deepEqual(after.position,old.position);assert.equal(after.speed,old.speed);}
  }
});
test('rounding preserves raw lane metadata, disabled directions and unrelated road records',()=>{
  for(const disabled of [false,true]){
    const {data,index}=fixture(p=>p,{reverseEnabled:!disabled});const file=parseRoads(data);
    for(const c of file.crossings)for(const r of roadConnections(file,c.index)){const at=8+c.index*236+28+r.slot*52;data[at+2]=0x93;data[at+12]=0x72;data.writeUInt32LE(0x7fc01234,at+32);}
    const result=changeRoadTopology(data,{action:'round-node',index,radius:5}),after=verify(result.data);
    for(const c of file.crossings)for(const r of roadConnections(file,c.index)){
      const s=roadConnections(after,c.index).find(v=>v.target===r.target).slot,a=8+c.index*236+28+r.slot*52,b=8+c.index*236+28+s*52;
      assert.deepEqual(result.data.subarray(b,b+4),data.subarray(a,a+4));assert.deepEqual(result.data.subarray(b+12,b+52),data.subarray(a+12,a+52));
      if(c.index>=2)assert.deepEqual(result.data.subarray(b,b+52),data.subarray(a,a+52));
    }
    const back=roadConnections(after,1)[0];assert.equal(back.enabled,!disabled);
  }
});
test('a reversed node record and a sloped corner retain ownership, speed and bounded linear arc height',()=>{
  const {data,index}=fixture(([x,,z])=>[x,x*.1+z*.2,z]),start=12+4*236+index*24;
  for(const [a,b]of [[16,18],[20,22]]){const value=data.readUInt16LE(start+a);data.writeUInt16LE(data.readUInt16LE(start+b),start+a);data.writeUInt16LE(value,start+b);}
  const plan=roadCurvePlan(parseRoads(data),index,6),result=changeRoadTopology(data,{action:'round-node',index,radius:6}),file=verify(result.data);
  plan.positions.forEach((p,i)=>assert(Math.abs(p[1]-(plan.positions[0][1]+(plan.positions.at(-1)[1]-plan.positions[0][1])*i/(plan.positions.length-1)))<.000001));
  assert.equal(file.nodes[result.index-4].speed,2.5);assert.deepEqual(file.nodes[result.index-4].position,plan.positions[plan.middle]);
});
test('rounding an internal bend reconnects ordinary neighbours after X sorting',()=>{
  let {data}=fixture();const original=parseRoads(data),route=roadConnections(original,0)[0];
  data=changeRoadTopology(data,{action:'disconnect',from:0,to:route.target}).data;
  data=changeRoadTopology(data,{action:'connect',from:0,to:1,positions:[[10,0,0],[20,0,0],[20,0,10]],speed:2.5}).data;
  const before=parseRoads(data),index=before.nodes.findIndex(n=>n.position[0]===20&&n.position[2]===0),plan=roadCurvePlan(before,index,4),result=changeRoadTopology(data,{action:'round-node',index,radius:4}),after=verify(result.data);
  const chain=roadConnections(after,0)[0].nodes.map(ref=>after.nodes[ref&32767].position);
  assert.deepEqual(chain,[[10,0,0],...plan.positions,[20,0,10]]);
  for(const n of before.nodes)if(n.index!==index)assert.deepEqual(after.nodes[result.mapping[4+n.index]-4].position,n.position);
});
test('invalid radii, straight or shared nodes and float32 collapse reject without changing input',()=>{
  const {data,index}=fixture(),request={action:'round-node',index};
  for(const patch of [{index:-1},{index:2},{radius:0},{radius:NaN},{radius:Infinity},{radius:'6'},{radius:20},{radius:.001}]){const before=Buffer.from(data);assert.throws(()=>changeRoadTopology(data,{...request,...patch}));assert.deepEqual(data,before);}
  const at=12+4*236+index*24;
  for(const change of [b=>{b.writeFloatLE(10,at);b.writeFloatLE(10,at+8);},b=>b.writeUInt16LE(32768|index,8+2*236+22),b=>b.writeUInt16LE(65535,at+20),b=>b.writeUInt16LE(32768|index,at+16)]){
    const broken=Buffer.from(data);change(broken);const before=Buffer.from(broken);assert.throws(()=>changeRoadTopology(broken,request));assert.deepEqual(broken,before);
  }
  const big=fixture(([x,y,z])=>[1e8+x,y,1e8+z]);assert.throws(()=>changeRoadTopology(big.data,{action:'round-node',index:big.index,radius:1}),/float32/);
});
test('project rounding has one history entry, detects stale input, exports and restores exact bytes with undo',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-road-curve-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Curve',assets:[],history:[]}));
  const p=await ModProject.open(root),name='missions/TEST/road.bin',{data,index}=fixture();await p.createFiles([{path:name,data},{path:'missions/TEST/tree.klz',data:Buffer.from('unchanged')}]);const baseline=p.manifest.history.length;
  const result=await p.changeRoadTopology(name,{action:'round-node',index,radius:6},hash(data)),rounded=await p.read(name);assert.equal(p.manifest.history.length,baseline+1);assert.equal(result.index,changeRoadTopology(data,{action:'round-node',index,radius:6}).index);
  await assert.rejects(p.changeRoadTopology(name,{action:'round-node',index,radius:6},hash(data)),/změnil/);assert.equal(p.manifest.history.length,baseline+1);
  const reopened=await ModProject.open(root),exported=path.join(root,'export');await reopened.export(exported);assert.deepEqual(await fs.readFile(path.join(exported,name)),rounded);await reopened.undo();assert.deepEqual(await reopened.read(name),data);assert.equal(reopened.manifest.history.length,baseline);assert.equal((await reopened.read('missions/TEST/tree.klz')).toString(),'unchanged');
});
