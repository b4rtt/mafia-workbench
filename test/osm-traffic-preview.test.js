import test from 'node:test';
import assert from 'node:assert/strict';
import {osmTrafficPlan} from '../src/plugins/osm/traffic.js';
import {osmTrafficPreview} from '../src/plugins/osm/traffic-preview.js';
import {osmCornerSpeeds} from '../src/plugins/osm/traffic-speeds.js';
import {osmRoadBytes} from '../src/plugins/osm/mission.js';
import {parseRoads} from '../src/core/roads.js';
import {roadLanePreview} from '../src/shared/road-lanes.js';
const options={version:3,density:10,speedKmh:30,tableHash:'a'.repeat(64),models:[{path:'models/test10.4ds',table:'test',sha256:'b'.repeat(64),width:1.8}]};
const straight={crossings:[{position:[0,2,0]},{position:[0,6,40]}],roads:[{from:0,to:1,positions:[[0,4,20]],way:101,tags:{highway:'residential'},forward:true,reverse:true}]};
const surface=plan=>({profiles:plan.roads.map(()=>({width:6}))});
const sign=a=>Math.sign(a.end[2]-a.start[2]);
test('preview offsets match native lane centres for all saved traffic versions without changing road bytes or inputs',()=>{
  for(const version of [1,2,3]){
    const plan=structuredClone(straight),before=structuredClone(plan),traffic=osmTrafficPlan(plan,surface(plan),{...options,version}),snapshot=structuredClone(traffic),bytes=osmRoadBytes(plan,traffic),native=roadLanePreview(parseRoads(bytes),0),preview=osmTrafficPreview(plan,traffic),offset=version===1?.75:1.5;
    assert.equal(preview.arrows.length,4);assert.deepEqual(preview.corners,[]);
    for(const arrow of preview.arrows){assert.equal(arrow.offset,offset);assert.equal(arrow.center[0],sign(arrow)*offset);assert.equal(arrow.center[1],arrow.center[2]/10+2);assert.equal(arrow.active,true);}
    assert.deepEqual(new Set(native.arrows.filter(a=>a.type===2).map(a=>a.offset)),new Set([offset]));
    assert.deepEqual(plan,before);assert.deepEqual(traffic,snapshot);assert.deepEqual(osmRoadBytes(plan,traffic),bytes);
  }
});
test('one-way preview shows only the OSM travel direction and never the reciprocal AI-only slot',()=>{
  for(const reverse of [false,true]){
    const plan=structuredClone(straight);plan.roads[0].forward=!reverse;plan.roads[0].reverse=reverse;
    const traffic=osmTrafficPlan(plan,surface(plan),options),preview=osmTrafficPreview(plan,traffic);
    assert.equal(traffic.roads[0].forward,true);assert.equal(traffic.roads[0].reverse,true);assert.equal(preview.arrows.length,2);
    assert(preview.arrows.every(a=>a.active&&a.offset===0&&a.center[0]===0&&sign(a)===(reverse?-1:1)));
  }
});
test('terminal branch arrows distinguish excluded directions while retaining a permitted feeder into a circuit',()=>{
  const positions=[[0,0,0],[40,0,0],[20,0,40],[-40,0,0]],pairs=[[0,1],[1,2],[2,0],[3,0]],plan={crossings:positions.map(position=>({position})),roads:pairs.map(([from,to],i)=>({from,to,positions:[positions[from].map((n,j)=>(n+positions[to][j])/2)],way:101+i,tags:{},forward:true,reverse:true}))};
  const traffic=osmTrafficPlan(plan,surface(plan),{...options,continuous:true}),preview=osmTrafficPreview(plan,traffic),branch=preview.arrows.filter(a=>a.road===3);
  assert(branch.some(a=>a.active));assert(branch.some(a=>!a.active));
  for(const a of branch)assert.equal(Math.sign(a.end[0]-a.start[0]),a.active?1:-1);
  assert(!preview.corners.some(p=>p[0]===-40));assert(preview.corners.length>0);
});
test('mapped corner markers use the speed planner angle rule without repeated densified seeds and ignore forbidden turns',()=>{
  const plan={crossings:[{position:[0,0,0]},{position:[40,0,40]},{position:[0,0,-40]}],roads:[{from:0,to:1,positions:[[40,0,0]],way:1,tags:{},forward:true,reverse:false},{from:0,to:2,positions:[[0,0,-20]],way:2,tags:{},forward:true,reverse:false}]};
  const traffic=osmTrafficPlan(plan,surface(plan),options),preview=osmTrafficPreview(plan,traffic),caps=osmCornerSpeeds(plan,traffic.roads,15,30/3.6);
  assert.equal(traffic.cornering,undefined);assert(caps.cornering.sites>=preview.corners.length);assert.deepEqual(preview.corners,[[40,0,0]]);
  plan.roads[1].forward=false;plan.roads[1].reverse=true;
  const second=osmTrafficPreview(plan,osmTrafficPlan(plan,surface(plan),options));assert(second.corners.some(p=>p[0]===0&&p[2]===0));
});
test('duplicate XZ points cannot create invalid arrows and reversing an elevated road does not reflect its world coordinates',()=>{
  const plan=structuredClone(straight);plan.roads[0].positions.push([0,4,20]);plan.roads[0].forward=false;
  const preview=osmTrafficPreview(plan,osmTrafficPlan(plan,surface(plan),options));assert.equal(preview.arrows.length,2);assert(preview.arrows.every(a=>[...a.start,...a.end,...a.center].every(Number.isFinite)&&sign(a)===-1));
});
