import test from 'node:test';
import assert from 'node:assert/strict';
import {osmSource,osmRoadPlan} from '../src/plugins/osm/area.js';
import {osmSurfaceModel,osmSurfaceDefaults} from '../src/plugins/osm/surface.js';
import {osmTrafficPlan,validateOsmTraffic} from '../src/plugins/osm/traffic.js';
import {loadOsmTrafficModels} from '../src/plugins/osm/traffic-assets.js';
import {osmRoadBytes} from '../src/plugins/osm/mission.js';
import {parseRoads} from '../src/core/roads.js';
import {writeSurfaceModel} from '../src/core/surface-model.js';
import {hash} from '../src/core/files.js';
import {roadConnections,roadSettingsPair} from '../src/shared/roads.js';
const area={latitude:50,longitude:14,size:200},node=(id,x,z)=>({type:'node',id,lat:50+z/6371008.8*180/Math.PI,lon:14+x/6371008.8*180/Math.PI/Math.cos(50*Math.PI/180)});
const plan=(tags={})=>osmRoadPlan(osmSource({elements:[node(1,-50,0),node(2,50,0),{type:'way',id:10,nodes:[1,2],tags:{highway:'residential',...tags}}]},area),[10]);
const options=()=>({version:1,density:20,tableHash:'a'.repeat(64),models:[{path:'models/taxi10.4ds',table:'taxi',sha256:'b'.repeat(64),width:2}]});
const surface=p=>osmSurfaceModel(p,area,{...osmSurfaceDefaults,width:8});
test('OSM traffic fits two native direction lanes inside the carriageway and leaves input untouched',()=>{
  const p=plan(),sf=surface(p),o=options(),before=structuredClone({p,sf,o}),t=osmTrafficPlan(p,sf,o),native=parseRoads(osmRoadBytes(p,t)),active=native.crossings.flatMap(c=>c.directions).filter(d=>d.target!==65535);
  assert.equal(active.length,2);assert(active.every(d=>d.lanes[0].type===2&&d.lanes[0].distance===2&&d.lanes.slice(1).every(l=>l.type===0)));assert.deepEqual(native.warnings,[]);assert.deepEqual({p,sf,o},before);
  assert.deepEqual(osmTrafficPlan(p,sf,o),t);
});
test('traffic retains mapped bends and adds engine guidance nodes at most two metres apart',()=>{
  const p=plan(),sf=surface(p),t=osmTrafficPlan(p,sf,options()),r=t.roads[0],chain=[p.crossings[p.roads[0].from].position,...r.positions,p.crossings[p.roads[0].to].position];assert(r.positions.length>40);for(let i=1;i<chain.length;i++)assert(Math.hypot(...chain[i].map((v,k)=>v-chain[i-1][k]))<=2.00001);assert(r.positions.some(v=>v.every((n,k)=>n===p.roads[0].positions[0][k])));
  const huge=structuredClone(p);huge.roads=Array.from({length:100},()=>structuredClone(p.roads[0]));assert.throws(()=>osmTrafficPlan(huge,{profiles:huge.roads.map(()=>({width:8}))},options()),/4096/);
});
test('one-way cars use the street center and reversed ways retain only the permitted native direction',()=>{
  for(const [oneway,forward]of [['yes',true],['-1',false]]){const p=plan({oneway}),t=osmTrafficPlan(p,surface(p),options()),n=parseRoads(osmRoadBytes(p,t));assert.equal(n.crossings[0].directions.some(d=>d.target!==65535),forward);const directions=n.crossings.flatMap(c=>c.directions);assert.equal(directions.filter(d=>d.target!==65535).length,1);assert(directions.filter(d=>d.target!==65535).every(d=>d.lanes[0].distance===0));assert(directions.filter(d=>d.target===65535).every(d=>d.lanes.every(l=>l.type===0)));}
});
test('narrow streets, missing surfaces and stale/ambiguous traffic settings reject before compilation',()=>{
  const p=plan(),sf=surface(p);sf.profiles[0].width=4;assert.throws(()=>osmTrafficPlan(p,sf,options()),/alespoň 4.80/);assert.throws(()=>osmTrafficPlan(p,null,options()),/povrchy/);
  for(const patch of [{version:4},{version:'2'},{density:0},{density:1.5},{density:101},{tableHash:'stale'},{models:[]},{models:Array(33).fill(options().models[0])},{models:[options().models[0],options().models[0]]},{models:[{...options().models[0],path:'models/../taxi10.4ds'}]},{models:[{...options().models[0],width:NaN}]}])assert.throws(()=>validateOsmTraffic({...options(),...patch}),/doprava/);
});
test('omitting traffic preserves the existing default road bytes and lane offsets',()=>{
  const p=plan();assert.deepEqual(osmRoadBytes(p),osmRoadBytes(p,null));assert.equal(hash(osmRoadBytes(p)),'31c5c111122e68be8e171382c9f1ca30da65c80f21d6dcf3974b4f215fb620fe');const native=parseRoads(osmRoadBytes(p));assert(native.crossings.flatMap(c=>c.directions).filter(d=>d.target!==65535).every(d=>d.lanes[0].distance===1.5));
});
test('traffic speed in km/h survives JSON and reaches every native crossing and road node',()=>{
  const p=plan(),sf=surface(p);
  for(const speedKmh of [1,4.32,30,50]){
    const o=JSON.parse(JSON.stringify({...options(),speedKmh})),before=structuredClone({p,sf,o}),t=osmTrafficPlan(p,sf,o),native=parseRoads(osmRoadBytes(p,t));
    assert.equal(t.speed,speedKmh/3.6);assert(native.nodes.length>40);
    assert([...native.crossings,...native.nodes].every(v=>v.speed===Math.fround(speedKmh/3.6)));
    assert.deepEqual({p,sf,o},before);
  }
  for(const speedKmh of [null,'30',NaN,Infinity,0,50.01,-1])assert.throws(()=>validateOsmTraffic({...options(),speedKmh}),/rychlost/);
});
test('saved traffic without a speed retains its derived plan shape and native bytes',()=>{
  const p=plan(),sf=surface(p),t=osmTrafficPlan(p,sf,JSON.parse(JSON.stringify(options()))),bytes=osmRoadBytes(p,t);
  assert(!Object.hasOwn(t,'speed'));assert.equal(hash(bytes),'a6e889c1d6d87f74d159c44bd11efe8ab36af2ec1d062296b139945e10bead72');
  assert.deepEqual(bytes,osmRoadBytes(p,osmTrafficPlan(p,sf,{...options(),speedKmh:4.32})));
  assert([...parseRoads(bytes).crossings,...parseRoads(bytes).nodes].every(v=>v.speed===Math.fround(1.2)));
});
test('traffic v2 uses the native half-distance rule to center cars in each permitted direction',()=>{
  for(const oneway of [undefined,'yes','-1'])for(const width of [4.8,8,12]){
    const p=plan(oneway?{oneway}:{}),sf=osmSurfaceModel(p,area,{...osmSurfaceDefaults,width}),o={...options(),version:2,speedKmh:30},before=structuredClone({p,sf,o}),t=osmTrafficPlan(p,sf,o),native=parseRoads(osmRoadBytes(p,t)),active=native.crossings.flatMap(c=>c.directions).filter(d=>d.target!==65535),offset=oneway?0:width/4;
    assert.equal(active.length,oneway?1:2);
    for(const direction of active){assert.equal(direction.lanes[0].type,2);assert.equal(direction.lanes[0].distance/2,Math.fround(offset));assert(direction.lanes.slice(1).every(l=>l.type===0&&l.distance===0));assert(offset+o.models[0].width/2<=width/2);}
    assert.deepEqual({p,sf,o},before);assert.deepEqual(osmTrafficPlan(p,sf,JSON.parse(JSON.stringify(o))),t);
    assert.deepEqual(native.warnings,[]);
  }
});
test('traffic v3 retains the incoming native slot without enabling ambient traffic against a one-way street',()=>{
  for(const oneway of ['yes','-1']){
    const p=plan({oneway}),sf=surface(p),o={...options(),version:3,speedKmh:30,cornerSpeedKmh:15},before=structuredClone({p,sf,o}),t=osmTrafficPlan(p,sf,o),bytes=osmRoadBytes(p,t),native=parseRoads(bytes);
    const edge=roadConnections(native,0)[0],pair=roadSettingsPair(native,0,edge.slot);
    assert(pair);assert(pair.forward.enabled&&pair.reverse.enabled);
    assert.equal(pair.forward.lanes[0].type,oneway==='yes'?2:1);
    assert.equal(pair.reverse.lanes[0].type,oneway==='yes'?1:2);
    for(const direction of [pair.forward,pair.reverse]){
      assert.equal(direction.lanes[0].distance,0);
      assert(direction.lanes.slice(1).every(l=>l.type===0&&l.distance===0));
    }
    // roads_disconnect_unused_road_links discards slots whose four lane bytes
    // are zero. Every physical endpoint must retain its path/lane metadata.
    for(const c of native.crossings)for(let i=0;i<4;i++)if(c.links[i]!==65535){
      assert(c.directions[i].lanes.some(l=>l.type!==0));
      assert.notEqual(c.directions[i].target,65535);
    }
    assert.deepEqual(native.warnings,[]);assert.deepEqual({p,sf,o},before);
    assert.deepEqual(osmRoadBytes(p,osmTrafficPlan(p,sf,JSON.parse(JSON.stringify(o)))),bytes);
  }
});
test('traffic v3 changes only one-way metadata and preserves the saved v1/v2 native networks',()=>{
  const expected=['22a9f2dd06dfe166ac4b230ec438dd42461973f99bdd8ebd5265803d23d0ea8a','e4084a80026140845b6f30f529d5a71997507280b0f87efcbabe79f0ada66d5a','6753eddb26c62f0aab1adc681c4a0b72b262dc51051aa426d5de50880e9ef1a0'];
  for(const [i,oneway]of [undefined,'yes','-1'].entries()){
    const p=plan(oneway?{oneway}:{}),sf=surface(p),v2=osmRoadBytes(p,osmTrafficPlan(p,sf,{...options(),version:2})),v3=osmRoadBytes(p,osmTrafficPlan(p,sf,{...options(),version:3}));
    assert.equal(hash(v2),expected[i]);
    if(!oneway)assert.deepEqual(v3,v2);
    else{
      const a=parseRoads(v2),b=parseRoads(v3);
      assert.deepEqual(b.nodes,a.nodes);
      assert.equal(b.crossings.flatMap(c=>c.directions).filter(d=>d.lanes.some(l=>l.type===2)).length,1);
      assert.equal(b.crossings.flatMap(c=>c.directions).filter(d=>d.lanes.some(l=>l.type===1)).length,1);
    }
  }
});
function table(){const b=Buffer.alloc(8+4+36+4+1);b.writeUInt32LE(1);b.writeUInt32LE(1,4);b.writeUInt32LE(b.length-12,8);b.write('taxi',12);b.writeUInt32LE(1,44);b.writeUInt32LE(1,48);return b;}
function model(){const identity={position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]},mesh=name=>({...identity,name,type:1,visual:0,parent:0,renderFlags:0,logicFlags:0,culling:1,lods:[{distance:0,vertices:3,positions:[-1,0,-2,1,0,2,0,2,0],normals:[0,1,0,0,1,0,0,1,0],uv:[0,0,1,1,0,1],faces:[{material:1,indices:[0,1,2]}]}]});return writeSurfaceModel({version:29,materials:[{flags:0,ambient:[1,1,1],diffuse:[1,1,1],emission:[0,0,0],opacity:1,texture:'car.bmp'}],meshes:['BODY','SEAT0','WHL0','WHR0','WHL1','WHR1','BODYCOLB0'].map(mesh)});}
test('traffic catalog validates actual native vehicle parts, family table, dimensions and both dependency hashes',async()=>{
  const bytes=model(),tbl=table(),p={manifest:{assets:[{path:'models/taxi10.4ds'},{path:'models/taxi00.4ds'},{path:'models/unknown10.4ds'}]},asset:path=>({path}),read:async path=>path.endsWith('.bin')?tbl:bytes},c=await loadOsmTrafficModels(p);assert.equal(c.models.length,1);assert.equal(c.models[0].width,2);assert.equal(c.models[0].table,'taxi');assert.equal(c.dependencies.length,2);assert.equal(c.tableHash,hash(tbl));assert.equal(c.models[0].sha256,hash(bytes));
  const saved={...options(),tableHash:c.tableHash,models:c.models};assert.equal((await loadOsmTrafficModels(p,saved)).models.length,1);const reversedKeys={...saved,models:saved.models.map(m=>({...m,envelope:{max:m.envelope.max,min:m.envelope.min}}))};assert.equal((await loadOsmTrafficModels(p,reversedKeys)).models.length,1);await assert.rejects(loadOsmTrafficModels(p,{...saved,turnRadius:6,version:3,models:saved.models.map(m=>({...m,envelope:{min:[-1,-2.1],max:[1,2]}}))}),/rozměry/);await assert.rejects(loadOsmTrafficModels(p,{...saved,tableHash:'0'.repeat(64)}),/tabulka/);await assert.rejects(loadOsmTrafficModels(p,{...saved,models:[{...c.models[0],width:3}]}),/rozměry/);await assert.rejects(loadOsmTrafficModels({...p,manifest:{assets:[]}},saved),/dostupná/);assert.equal((await loadOsmTrafficModels({...p,read:async path=>path.endsWith('.bin')?tbl:Buffer.alloc(5)})).warnings.length,1);
});
