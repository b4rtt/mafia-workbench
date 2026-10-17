import test from 'node:test';
import assert from 'node:assert/strict';
import {osmTrafficPlan,validateOsmTraffic} from '../src/plugins/osm/traffic.js';
import {osmRoadBytes} from '../src/plugins/osm/mission.js';
import {osmTrafficPreview} from '../src/plugins/osm/traffic-preview.js';
import {parseRoads} from '../src/core/roads.js';
import {roadConnections,roadSettingsPair} from '../src/shared/roads.js';

const options={version:3,density:10,speedKmh:30,tableHash:'a'.repeat(64),models:[{path:'models/test10.4ds',table:'test',sha256:'b'.repeat(64),width:1.8}]};
function fixture(){
  const positions=[[0,0,0],[40,0,0],[40,0,40],[0,0,40],[-40,0,0],[-60,0,0]];
  return {crossings:positions.map(position=>({position})),roads:[[0,1,1],[1,2,2],[2,3,3],[3,0,4],[4,0,5],[5,4,5]].map(([from,to,way])=>({from,to,way,positions:[positions[from].map((n,i)=>(n+positions[to][i])/2)],tags:{},forward:true,reverse:true}))};
}
const surface=p=>({profiles:p.roads.map(()=>({width:6}))});
test('excluding an OSM way retains all its physical pieces and reciprocal AI lanes, with saved inputs unchanged',()=>{
  const p=fixture(),s=surface(p),o={...options,excludedWays:[5]},before=structuredClone({p,s,o}),traffic=osmTrafficPlan(p,s,o),normal=parseRoads(osmRoadBytes(p,osmTrafficPlan(p,s,options))),bytes=osmRoadBytes(p,traffic),native=parseRoads(bytes);
  assert.deepEqual(native.warnings,[]);assert.deepEqual(native.nodes,normal.nodes);
  assert.deepEqual(traffic.exclusions,{ways:[5],roads:2,directions:4});
  p.roads.forEach((road,i)=>{
    const link=roadConnections(native,road.from).find(l=>l.target===road.to),pair=roadSettingsPair(native,road.from,link.slot);
    assert(pair.forward.enabled&&pair.reverse.enabled);
    for(const d of [pair.forward,pair.reverse])assert.equal(d.lanes[0].type,i<4?2:1);
    assert.deepEqual(traffic.roads[i].positions,osmTrafficPlan(p,s,options).roads[i].positions);
  });
  const preview=osmTrafficPreview(p,traffic);assert(preview.arrows.filter(a=>a.road>=4).every(a=>!a.active));assert(preview.arrows.filter(a=>a.road<4).every(a=>a.active));
  assert.deepEqual({p,s,o},before);assert.deepEqual(osmRoadBytes(p,osmTrafficPlan(p,s,JSON.parse(JSON.stringify(o)))),bytes);
});
test('explicit exclusions precede continuity pruning and never invent a new ambient direction',()=>{
  const p=fixture();assert.throws(()=>osmTrafficPlan(p,surface(p),{...options,excludedWays:[1],continuous:true}),/průběžný jízdní okruh/);
  p.roads[4].reverse=false;p.roads[5].reverse=false;
  const t=osmTrafficPlan(p,surface(p),{...options,excludedWays:[5],continuous:true});assert.deepEqual(t.continuity,{before:8,retained:8,excluded:0});
  assert(t.roads.slice(4).every(r=>r.forwardLanes[0].type===1&&r.reverseLanes[0].type===1));
});
test('excluded narrow streets remain available to special AI but no longer block the ambient import',()=>{
  const p=fixture(),s=surface(p);s.profiles[4].width=2;s.profiles[5].width=2;
  assert.throws(()=>osmTrafficPlan(p,s,options),/alespoň/);
  const t=osmTrafficPlan(p,s,{...options,excludedWays:[5],continuous:true});
  assert.deepEqual(t.continuity,{before:8,retained:8,excluded:0});
  assert(t.roads.slice(4).every(r=>r.forwardLanes[0].type===1&&r.reverseLanes[0].type===1));
  assert.throws(()=>osmTrafficPlan(p,s,{...options,excludedWays:[1,2,3,4,5],continuous:true}),/průběžný jízdní okruh/);
  assert.doesNotThrow(()=>osmTrafficPlan(p,s,{...options,excludedWays:[1,2,3,4,5],continuous:false}));
});
test('excluded bends do not seed corner caps or slow a shared straight street',()=>{
  const p={crossings:[[0,0,0],[40,0,0],[40,0,40]].map(position=>({position})),roads:[{from:0,to:1,way:1,positions:[[20,0,0]],tags:{},forward:true,reverse:false},{from:1,to:2,way:2,positions:[[60,0,0],[60,0,40]],tags:{},forward:true,reverse:false}]};
  const t=osmTrafficPlan(p,surface(p),{...options,excludedWays:[2],cornerSpeedKmh:15}),normal=osmTrafficPlan(p,surface(p),{...options,cornerSpeedKmh:15});
  assert.equal(t.cornering.sites,0);assert(normal.cornering.sites>0);assert(t.crossingSpeeds.every(v=>v===30/3.6));assert(t.roads.every(r=>r.nodeSpeeds.every(v=>v===30/3.6)));assert.deepEqual(osmTrafficPreview(p,t).corners,[]);
});
test('absent or empty exclusions preserve saved versions exactly and malformed selections reject',()=>{
  const p=fixture(),s=surface(p);
  for(const version of [1,2,3]){
    const old={...options,version,cornerSpeedKmh:15},before=osmTrafficPlan(p,s,old),empty=osmTrafficPlan(p,s,{...old,excludedWays:[]});
    assert.deepEqual(empty,before);assert.deepEqual(osmRoadBytes(p,empty),osmRoadBytes(p,before));
    if(version!==3)assert.throws(()=>validateOsmTraffic({...old,excludedWays:[5]}),/aktualizovanou/);
  }
  for(const excludedWays of [null,'5',[0],[-1],['5'],[1.5],[Number.MAX_SAFE_INTEGER+1],[5,5],Array.from({length:257},(_,i)=>i+1)])assert.throws(()=>validateOsmTraffic({...options,excludedWays}),/OSM ID/);
});
