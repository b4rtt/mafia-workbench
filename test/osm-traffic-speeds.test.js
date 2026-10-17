import test from 'node:test';
import assert from 'node:assert/strict';
import {osmTrafficPlan,validateOsmTraffic} from '../src/plugins/osm/traffic.js';
import {osmRoadBytes} from '../src/plugins/osm/mission.js';
import {parseRoads} from '../src/core/roads.js';
import {roadConnections} from '../src/shared/roads.js';
const point=([x,z],y=0)=>[x,y,z],options=()=>({version:2,density:20,speedKmh:30,cornerSpeedKmh:15,tableHash:'a'.repeat(64),models:[{path:'models/taxi10.4ds',table:'taxi',sha256:'b'.repeat(64),width:2}]}),surface=p=>({profiles:p.roads.map(()=>({width:8}))});
function fixture(crossings,roads){return {crossings:crossings.map((p,id)=>({id,position:point(p)})),roads:roads.map(([from,to,positions,forward=true,reverse=true],way)=>({from,to,positions:positions.map(p=>point(p)),way,tags:{},forward,reverse}))};}
const corner=()=>fixture([[-100,0],[0,0],[0,100]],[[0,1,[[-50,0]]],[1,2,[[0,50]]]]);
const allSpeeds=t=>[...t.crossingSpeeds,...t.roads.flatMap(r=>r.nodeSpeeds)];
test('turn caps reach native crossings and X-sorted road nodes with a gradual distance ramp',()=>{
  const p=corner(),o=options(),sf=surface(p),before=structuredClone({p,o,sf}),t=osmTrafficPlan(p,sf,o),bytes=osmRoadBytes(p,t),n=parseRoads(bytes),cap=15/3.6,cruise=30/3.6;
  assert.equal(t.cornering.sites,1);assert.equal(t.crossingSpeeds[1],cap);assert.equal(t.crossingSpeeds[0],cruise);assert.equal(t.crossingSpeeds[2],cruise);assert.deepEqual(n.warnings,[]);
  for(const [i,r]of p.roads.entries()){
    const link=roadConnections(n,r.from).find(l=>l.target===r.to);assert.equal(link.nodes.length,t.roads[i].positions.length);
    for(const [j,ref]of link.nodes.entries()){
      const node=n.nodes[ref&32767],v=t.roads[i].positions[j],distance=Math.hypot(v[0],v[2]),expected=Math.min(cruise,Math.sqrt(cap**2+3*Math.max(0,distance-12)));
      assert.equal(t.roads[i].nodeSpeeds[j],expected);assert.equal(node.speed,Math.fround(expected));assert.deepEqual(node.position,v);
    }
  }
  assert(allSpeeds(t).some(v=>v>cap&&v<cruise));assert.deepEqual({p,o,sf},before);assert.deepEqual(osmTrafficPlan(p,sf,JSON.parse(JSON.stringify(o))),t);assert.deepEqual(osmRoadBytes(p,t),bytes);
});
test('straight intermediate junctions and dead ends retain cruise speed',()=>{
  const p=fixture([[-100,0],[0,0],[100,0]],[[0,1,[[-50,0]]],[1,2,[[50,0]]]]),t=osmTrafficPlan(p,surface(p),options());
  assert.equal(t.cornering.sites,0);assert.equal(t.cornering.affectedNodes,0);assert(allSpeeds(t).every(v=>v===30/3.6));
});
test('single-road bends slow before the corner independently of point order or height',()=>{
  const p=fixture([[-100,0],[0,100]],[[0,1,[[-50,0],[0,0],[0,50]]]]);p.elevated=true;p.crossings[1].position[1]=10;p.roads[0].positions[2][1]=5;
  const sf={...surface(p),elevation:true},t=osmTrafficPlan(p,sf,options());assert(t.cornering.sites>0);
  const r=t.roads[0],at=r.positions.findIndex(v=>v[0]===0&&v[2]===0);assert.equal(r.nodeSpeeds[at],15/3.6);assert.equal(t.crossingSpeeds[0],30/3.6);assert.equal(t.crossingSpeeds[1],30/3.6);
  const reversed=structuredClone(p);reversed.roads[0]={...reversed.roads[0],from:1,to:0,positions:reversed.roads[0].positions.toReversed()};
  const back=osmTrafficPlan(reversed,sf,options()).roads[0];assert.deepEqual(back.positions.toReversed(),r.positions);assert.deepEqual(back.nodeSpeeds.toReversed(),r.nodeSpeeds);
});
test('junction turn detection respects permitted incoming and outgoing one-way directions',()=>{
  for(const [directions,expected]of [[[true,false,true,false],0],[[false,true,false,true],0],[[true,false,false,true],1]]){
    const p=fixture([[-100,0],[0,0],[0,100]],[[0,1,[[-50,0]],directions[0],directions[1]],[2,1,[[0,50]],directions[2],directions[3]]]);
    assert.equal(osmTrafficPlan(p,surface(p),options()).cornering.sites,expected);
  }
});
test('nearby disconnected streets keep their speed instead of inheriting a spatial corner cap',()=>{
  const p=corner();p.crossings.push({id:3,position:point([-100,5])},{id:4,position:point([100,5])});p.roads.push({from:3,to:4,positions:[point([-50,5]),point([0,5]),point([50,5])],way:3,tags:{},forward:true,reverse:true});
  const t=osmTrafficPlan(p,surface(p),options());assert.equal(t.crossingSpeeds[3],30/3.6);assert.equal(t.crossingSpeeds[4],30/3.6);assert(t.roads[2].nodeSpeeds.every(v=>v===30/3.6));assert(t.roads[0].nodeSpeeds.some(v=>v<30/3.6));
});
test('corner speed never raises the cruise speed, including old traffic without speedKmh',()=>{
  const p=corner();for(const speed of [1,15,30,50]){const o={...options(),cornerSpeedKmh:speed},t=osmTrafficPlan(p,surface(p),o);assert(allSpeeds(t).every(v=>v<=30/3.6&&v>=Math.min(speed,30)/3.6));}
  const old={...options(),version:1};delete old.speedKmh;delete old.cornerSpeedKmh;
  const legacy=osmRoadBytes(p,osmTrafficPlan(p,surface(p),old)),capped=osmRoadBytes(p,osmTrafficPlan(p,surface(p),{...old,cornerSpeedKmh:15}));assert.deepEqual(capped,legacy);
  for(const cornerSpeedKmh of [null,'15',false,NaN,Infinity,0,50.01])assert.throws(()=>validateOsmTraffic({...options(),cornerSpeedKmh}),/zatáčkách/);
});
test('native writer refuses a mismatched speed array rather than applying it to another road',()=>{
  const p=corner(),t=osmTrafficPlan(p,surface(p),options());t.roads[0].nodeSpeeds.pop();assert.throws(()=>osmRoadBytes(p,t),/rychlosti neodpovídají/);
});
test('large cornered networks preserve every speed beyond the native edit batch limit',()=>{
  for(const segments of [150,450]){
    const positions=Array.from({length:segments-1},(_,i)=>[(i+1)%2?12:0,(i+1)*12]),p=fixture([[0,0],[0,segments*12]],[[0,1,positions]]),t=osmTrafficPlan(p,surface(p),options());
    assert(t.cornering.affectedNodes>(segments===150?1024:4000));assert(t.roads[0].positions.length<=4096);
    const original=osmRoadBytes(p,osmTrafficPlan(p,surface(p),{...options(),cornerSpeedKmh:undefined})),bytes=osmRoadBytes(p,t),n=parseRoads(bytes),link=roadConnections(n,0).find(l=>l.target===1);
    assert.deepEqual(n.warnings,[]);assert.equal(link.nodes.length,t.roads[0].nodeSpeeds.length);
    for(const [i,ref]of link.nodes.entries())assert.equal(n.nodes[ref&32767].speed,Math.fround(t.roads[0].nodeSpeeds[i]));
    const expected=Buffer.from(original),start=12+n.crossings.length*236;
    n.crossings.forEach((_,i)=>expected.writeFloatLE(t.crossingSpeeds[i],8+i*236+16));
    link.nodes.forEach((ref,i)=>expected.writeFloatLE(t.roads[0].nodeSpeeds[i],start+(ref&32767)*24+12));
    assert.deepEqual(bytes,expected);assert.deepEqual(osmRoadBytes(p,t),bytes);
  }
});
