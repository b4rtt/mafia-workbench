import test from 'node:test';
import assert from 'node:assert/strict';
import {osmTrafficContinuity} from '../src/plugins/osm/traffic-continuity.js';
import {osmTrafficPlan,validateOsmTraffic} from '../src/plugins/osm/traffic.js';
import {osmRoadBytes} from '../src/plugins/osm/mission.js';
import {parseRoads} from '../src/core/roads.js';
import {roadConnections,roadSettingsPair} from '../src/shared/roads.js';
const fixture=edges=>({crossings:Array.from({length:1+Math.max(...edges.flatMap(e=>e.slice(0,2)))},(_,i)=>({id:`n${i}`,position:[[0,0],[30,0],[30,30],[0,30],[-30,0],[-60,0],[60,60],[90,60],[120,60]][i].flatMap((v,k)=>k?[0,v]:[v])})),roads:edges.map(([from,to,forward=true,reverse=false],i)=>({from,to,forward,reverse,way:i+1,tags:{},positions:[]}))});
const loop=[[0,1],[1,2],[2,3],[3,0]],options=()=>({version:3,continuous:true,density:20,tableHash:'a'.repeat(64),models:[{path:'models/taxi10.4ds',table:'taxi',sha256:'b'.repeat(64),width:2}]});
const surface=p=>({profiles:p.roads.map(()=>({width:6}))});
test('one-way circuit survives and a clipped branch only feeds into it',()=>{
  const p=fixture([...loop,[0,4,true,true],[4,5,true,true]]),before=structuredClone(p),r=osmTrafficContinuity(p);
  assert.deepEqual(r,{directions:[...loop.map(()=>({forward:true,reverse:false})),{forward:false,reverse:true},{forward:false,reverse:true}],before:8,retained:6,excluded:2});
  assert.deepEqual(p,before);
});
test('one-way escape traps are excluded recursively without opening a forbidden direction',()=>{
  const p=fixture([...loop,[0,4],[4,5],[6,7],[7,8]]),r=osmTrafficContinuity(p);
  assert.equal(r.retained,4);assert.equal(r.excluded,4);
  assert(r.directions.slice(4).every(r=>!r.forward&&!r.reverse));
  const reverse=fixture(loop.map(([a,b])=>[a,b,false,true]));assert(osmTrafficContinuity(reverse).directions.every(r=>!r.forward&&r.reverse));
});
test('a bidirectional line is not a circuit and a disconnected genuine circuit remains usable',()=>{
  assert.equal(osmTrafficContinuity(fixture([[0,1,true,true],[1,2,true,true]])).retained,0);
  const p=fixture([...loop,[4,5,true,true],[6,7,true,true],[7,8,true,true]]),r=osmTrafficContinuity(p);
  assert.equal(r.retained,4);assert(r.directions.slice(4).every(r=>!r.forward&&!r.reverse));
  const reordered={...p,roads:p.roads.toReversed()},back=osmTrafficContinuity(reordered);assert.deepEqual(back.directions.toReversed(),r.directions);
});
test('parallel roads can form a real return route while a road cannot return into itself',()=>{
  const r=osmTrafficContinuity(fixture([[0,1],[0,1,false,true]]));assert.equal(r.retained,2);
  assert.equal(osmTrafficContinuity(fixture([[0,1,true,true]])).retained,0);
});
test('native pruning preserves road geometry, reciprocal AI metadata and retained ambient lanes',()=>{
  const p=fixture([...loop,[0,4,true,true],[4,5,true,true]]),o=options(),t=osmTrafficPlan(p,surface(p),o),raw=osmRoadBytes(p,t),native=parseRoads(raw),legacy=parseRoads(osmRoadBytes(p,osmTrafficPlan(p,surface(p),{...o,continuous:false})));
  assert.deepEqual(native.nodes,legacy.nodes);assert.deepEqual(native.warnings,[]);assert.deepEqual(t.continuity,{before:8,retained:6,excluded:2});
  for(const [i,r]of p.roads.entries()){
    const edge=roadConnections(native,r.from).find(e=>e.target===r.to),pair=roadSettingsPair(native,r.from,edge.slot),allowed=osmTrafficContinuity(p).directions[i];
    assert(pair.forward.enabled&&pair.reverse.enabled);
    assert.equal(pair.forward.lanes[0].type,allowed.forward?2:1);assert.equal(pair.reverse.lanes[0].type,allowed.reverse?2:1);
  }
  assert.deepEqual(osmRoadBytes(p,osmTrafficPlan(p,surface(p),JSON.parse(JSON.stringify(o)))),raw);
});
test('disabled or absent pruning retains old bytes and impossible circulation fails explicitly',()=>{
  const p=fixture(loop),sf=surface(p),o=options(),old={...o};delete old.continuous;
  assert.deepEqual(osmRoadBytes(p,osmTrafficPlan(p,sf,{...o,continuous:false})),osmRoadBytes(p,osmTrafficPlan(p,sf,old)));
  const dead=fixture([[0,1,true,true]]);assert.throws(()=>osmTrafficPlan(dead,surface(dead),o),/průběžný jízdní okruh/);
  assert.throws(()=>validateOsmTraffic({...o,version:2}),/aktualizovanou/);
  for(const continuous of [1,'true',null,{}])assert.throws(()=>validateOsmTraffic({...o,continuous}),/aktualizovanou/);
  assert.doesNotThrow(()=>validateOsmTraffic({...o,continuous:false,version:1}));
});
test('excluded escape turns do not slow an otherwise straight continuous junction',()=>{
  const p={crossings:[[0,0],[20,0],[40,0],[40,40],[0,40],[20,-40]].map(([x,z],i)=>({id:`n${i}`,position:[x,0,z]})),roads:[[0,1],[1,2],[2,3],[3,4],[4,0],[1,5]].map(([from,to],i)=>({from,to,positions:[],forward:true,reverse:false,way:i+1,tags:{}}))};
  const enabled=osmTrafficPlan(p,surface(p),{...options(),speedKmh:30,cornerSpeedKmh:15}),old=osmTrafficPlan(p,surface(p),{...options(),continuous:false,speedKmh:30,cornerSpeedKmh:15});
  assert.equal(enabled.cornering.sites,4);assert.equal(old.cornering.sites,5);
  assert(enabled.crossingSpeeds[1]>old.crossingSpeeds[1]);assert.deepEqual(enabled.roads[5].forwardLanes.map(l=>l.type),[1,0,0,0]);
});
