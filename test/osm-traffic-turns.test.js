import test from 'node:test';
import assert from 'node:assert/strict';
import {osmTrafficPlan,validateOsmTraffic} from '../src/plugins/osm/traffic.js';
import {osmSurfaceModel,osmSurfaceDefaults} from '../src/plugins/osm/surface.js';
import {osmRoadBytes} from '../src/plugins/osm/mission.js';
import {osmTrafficPreview} from '../src/plugins/osm/traffic-preview.js';
import {parseRoads} from '../src/core/roads.js';
import {roadConnections,roadSettingsPair} from '../src/shared/roads.js';
const options={version:3,density:1,speedKmh:30,cornerSpeedKmh:15,continuous:true,turnRadius:6,tableHash:'a'.repeat(64),models:[{path:'models/test10.4ds',table:'test',sha256:'b'.repeat(64),width:1.8,envelope:{min:[-.9,-2.3],max:[.9,2.3]}}]};
function square(size=70){const crossings=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z])=>({position:[x*size/2,0,z*size/2]}));return {flat:true,crossings,roads:[[0,1],[1,2],[2,3],[3,0]].map(([from,to],i)=>({from,to,way:101+i,positions:[crossings[from].position.map((v,j)=>(v+crossings[to].position[j])/2)],forward:true,reverse:true,tags:{highway:'residential'}}))};}
const surface=(p,width=8,cornerRadius=2)=>osmSurfaceModel(p,{size:400},{...osmSurfaceDefaults,width,cornerRadius});
test('tangent turns retain both OSM directions as separate native axes and exact saved data',()=>{
  const p=square(),s=surface(p),before=structuredClone({p,s,options}),t=osmTrafficPlan(p,s,options),n=parseRoads(osmRoadBytes(p,t));
  assert.deepEqual(n.warnings,[]);assert.equal(t.turns.axes,8);assert.equal(t.turns.connectors,8);assert.equal(n.crossings.length,16);assert(t.turns.bodyPoses>1000);
  assert.equal(t.network.roads.length,16);assert.equal(t.network.roads.filter(r=>r.kind==='street'&&r.sourceReverse).length,4);
  for(const [i,r]of t.network.roads.entries()){
    const link=roadConnections(n,r.from).find(l=>l.target===r.to),pair=roadSettingsPair(n,r.from,link.slot);assert(pair.forward.enabled&&pair.reverse.enabled);assert.equal(pair.forward.lanes[0].type,2);assert.equal(pair.reverse.lanes[0].type,1);assert.equal(pair.forward.lanes[0].distance,0);
    const chain=[t.network.crossings[r.from].position,...t.roads[i].positions,t.network.crossings[r.to].position];assert(chain.slice(1).every((p,j)=>Math.hypot(p[0]-chain[j][0],p[2]-chain[j][2])<=2.00001));
  }
  assert.deepEqual({p,s,options},before);assert.deepEqual(osmRoadBytes(p,osmTrafficPlan(p,s,JSON.parse(JSON.stringify(options)))),osmRoadBytes(p,t));assert.equal(osmTrafficPreview(p,t).arrows.filter(a=>a.active).length>0,true);
});
test('sampled full-body gate rejects a radius that clips a narrow street without widening its surface',()=>{
  const p=square(),s=surface(p,6,2),before=structuredClone(s);assert.throws(()=>osmTrafficPlan(p,s,options),/karoserie přesahuje asfalt/);assert.deepEqual(s,before);
  assert.doesNotThrow(()=>osmTrafficPlan(p,surface(p,6,4),options));
  const longer={...options,models:[{...options.models[0],envelope:{min:[-.9,-8],max:[.9,8]}}]};assert.throws(()=>osmTrafficPlan(p,surface(p),longer),/karoserie přesahuje asfalt/);
});
test('native junction ports support all mapped non-U-turn movements at a four-way crossing',()=>{
  const p={flat:true,crossings:[],roads:[]};for(let z=-1;z<=1;z++)for(let x=-1;x<=1;x++)p.crossings.push({position:[x*60,0,z*60]});
  const add=(from,to)=>p.roads.push({from,to,way:101+p.roads.length,positions:[p.crossings[from].position.map((v,i)=>(v+p.crossings[to].position[i])/2)],forward:true,reverse:true,tags:{highway:'residential'}});
  for(let z=0;z<3;z++)for(let x=0;x<3;x++){const i=z*3+x;if(x<2)add(i,i+1);if(z<2)add(i,i+3);}
  const t=osmTrafficPlan(p,surface(p),options),n=parseRoads(osmRoadBytes(p,t));assert.deepEqual(n.warnings,[]);assert.equal(t.turns.axes,24);assert(n.crossings.every(c=>roadConnections(n,c.index).length<=4));
  const middleIncoming=t.network.roads.filter(r=>r.kind==='street'&&p.roads[r.sourceRoad][r.sourceReverse?'from':'to']===4);assert.equal(middleIncoming.length,4);
  for(const a of middleIncoming){const next=t.network.roads.filter(r=>r.kind==='turn'&&r.from===a.to);assert.equal(next.length,3);assert(next.every(b=>{const target=t.network.roads.find(r=>r.kind==='street'&&r.from===b.to);return target.sourceRoad!==a.sourceRoad;}));}
});
test('excluded streets and their connectors retain AI-only slots and grey preview',()=>{
  const p=square(),t=osmTrafficPlan(p,surface(p),{...options,continuous:false,excludedWays:[101]});
  for(const [i,r]of t.network.roads.entries())if(r.sourceRoad===0){assert.equal(t.roads[i].forwardLanes[0].type,1);assert.equal(t.roads[i].reverseLanes[0].type,1);}
  for(const r of t.network.roads.filter(r=>r.kind==='turn')){const a=t.network.roads.find(s=>s.kind==='street'&&s.to===r.from),b=t.network.roads.find(s=>s.kind==='street'&&s.from===r.to);assert.equal(r.ambient,a.ambient&&b.ambient);}
  const preview=osmTrafficPreview(p,t);assert(preview.arrows.some(a=>!a.active));assert(preview.arrows.some(a=>a.active));assert.equal(t.exclusions.ways[0],101);
});
test('interior mapped bends are rounded too, with finite float32 guidance and no invented direction',()=>{
  const p=square();p.roads[0].positions=[[0,0,-30]];p.roads.forEach(r=>r.reverse=false);
  const t=osmTrafficPlan(p,surface(p,12,4),options),n=parseRoads(osmRoadBytes(p,t));assert.deepEqual(n.warnings,[]);assert.equal(t.turns.axes,4);assert.equal(t.network.roads.filter(r=>r.sourceReverse).length,0);assert(n.nodes.every(r=>r.position.every(Number.isFinite)));
  assert(t.network.roads.find(r=>r.sourceRoad===0&&r.kind==='street').positions.length>20);
});
test('overlapping turns and unverified terrain stop before compilation; legacy options retain exact networks',()=>{
  const p=square(10);assert.throws(()=>osmTrafficPlan(p,surface(p),options),/nevejde mezi ohyby/);
  const q=square(),s=surface(q);assert.throws(()=>osmTrafficPlan({...q,flat:false,elevated:true},{...s,elevation:{}},options),/rovinný/);
  for(const version of [1,2,3]){const o={...options,version,turnRadius:undefined,continuous:false},a=osmTrafficPlan(q,s,o),b=osmTrafficPlan(q,s,{...o,models:o.models.map(({envelope,...m})=>m)});assert.deepEqual(a,b);assert.deepEqual(osmRoadBytes(q,a),osmRoadBytes(q,b));assert(!Object.hasOwn(a,'network'));}
  for(const patch of [{turnRadius:null},{turnRadius:'6'},{turnRadius:4.99},{turnRadius:12.01},{version:2,continuous:false},{models:[{...options.models[0],envelope:undefined}]},{models:[{...options.models[0],envelope:{min:[-1,-2],max:[1,2]}}]}])assert.throws(()=>validateOsmTraffic({...options,...patch}),/oblouky/);
});

test('reversed one-way streets keep the original permitted order and transform under rotation',()=>{
  const p=square();for(const r of p.roads){r.forward=false;r.reverse=true;}for(const c of p.crossings)c.position=[-c.position[2]+10,0,c.position[0]-15];for(const r of p.roads)r.positions=[p.crossings[r.from].position.map((v,i)=>(v+p.crossings[r.to].position[i])/2)];
  const t=osmTrafficPlan(p,surface(p,8,4),options);assert.equal(t.turns.axes,4);assert.equal(t.turns.connectors,4);assert(t.network.roads.filter(r=>r.kind==='street').every(r=>r.sourceReverse));assert.deepEqual(parseRoads(osmRoadBytes(p,t)).warnings,[]);
});
