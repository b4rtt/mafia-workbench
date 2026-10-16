import test from 'node:test';
import assert from 'node:assert/strict';
import {Ray,Vector3} from 'three';
import {osmArea,osmSource,osmRoadPlan} from '../src/plugins/osm/area.js';
import {osmTerrainSurface} from '../src/plugins/osm/terrain.js';
import {osmSurfaceModel,osmSurfaceDefaults} from '../src/plugins/osm/surface.js';
import {osmNavigationElevation,osmTerrainRoadPlan} from '../src/plugins/osm/navigation-elevation.js';
import {osmRoadBytes} from '../src/plugins/osm/mission.js';
import {osmTrafficPlan} from '../src/plugins/osm/traffic.js';
import {osmPedestrianPlan,osmPedestrianBytes} from '../src/plugins/osm/pedestrians.js';
import {parseRoads} from '../src/core/roads.js';
import {parseNavigation} from '../src/core/navigation.js';
import {parseFourDs} from '../src/core/fourds.js';
import {writeSurfaceModel} from '../src/core/surface-model.js';

function fixture({size=100,angle=0,crossing=false,curbHeight=.15,oneway='no',height=(x,z)=>200+Math.sin(x)*.5+z*.15,columns=11,rows=7}={}){
  const area=osmArea({latitude:50,longitude:14,size}),c=Math.cos(angle),s=Math.sin(angle),node=(id,x,z,tags)=>({type:'node',id,lat:50+(x*s+z*c)/6371008.8*180/Math.PI,lon:14+(x*c-z*s)/6371008.8*180/Math.PI/Math.cos(50*Math.PI/180),...(tags?{tags}:{})}),data={elements:[node(1,-size,0),node(2,0,0,crossing?{highway:'crossing',crossing:'uncontrolled'}:null),node(3,size,0),{type:'way',id:101,nodes:[1,2,3],tags:{highway:'residential',oneway}}]},source=osmSource(data,area),plan=osmRoadPlan(source,[101]),options={...osmSurfaceDefaults,width:8,curbHeight},settings={version:1,area,columns,rows,base:2,samples:Array.from({length:(columns+1)*(rows+1)},(_,i)=>height(i%(columns+1),Math.floor(i/(columns+1)))),groundTexture:'maps/ground.bmp',groundTileSize:4};
  return {area,source,plan,options,settings,surface:osmTerrainSurface(plan,area,options,settings)};
}
const distance=(a,b)=>Math.hypot(...a.map((n,i)=>n-b[i]));
function meshFloor(model,x,z,material){
  let height=-Infinity;const ray=new Ray(new Vector3(x,1000,z),new Vector3(0,-1,0));
  for(const mesh of model.meshes){const lod=mesh.lods[0];for(const face of lod.faces){if(material&&face.material!==material)continue;for(let i=0;i<face.indices.length;i+=3){const p=face.indices.slice(i,i+3).map(n=>new Vector3(...lod.positions.slice(n*3,n*3+3))),hit=ray.intersectTriangle(...p,true,new Vector3());if(hit)height=Math.max(height,hit.y);}}}return height;
}
const carOptions={version:1,density:20,tableHash:'a'.repeat(64),models:[{path:'models/taxi10.4ds',table:'taxi',sha256:'b'.repeat(64),width:2}]};
test('sloped native roads retain directions and mapped points, split ridges, and follow the rendered carriageway',()=>{
  for(const options of [{},{angle:.57},{size:83.456},{size:50.0000009},{size:50.0000028},{columns:2,rows:1,height:(x,z)=>200+8*x*z},{columns:2,rows:2,height:x=>200+20*x},{oneway:'-1'}]){
    const f=fixture(options),before=structuredClone(f.plan),p=osmTerrainRoadPlan(f.plan,f.surface),native=parseRoads(osmRoadBytes(p)),model=parseFourDs(writeSurfaceModel(f.surface.model),true);
    assert.deepEqual(f.plan,before);assert.equal(p.flat,false);assert.equal(p.elevated,true);assert.deepEqual(native.warnings,[]);assert.deepEqual(osmTerrainRoadPlan(f.plan,f.surface),p);
    for(const v of [...native.crossings,...native.nodes].map(n=>n.position))assert(Math.abs(v[1]-meshFloor(model,v[0],v[2],1))<3e-6,`road ground ${v}`);
    for(const road of p.roads){const chain=[p.crossings[road.from].position,...road.positions,p.crossings[road.to].position];for(let i=1;i<chain.length;i++){const a=chain[i-1],b=chain[i];assert(distance(a,b)<=2.000001);for(const u of [.2,.5,.8]){const v=a.map((n,k)=>n+(b[k]-n)*u);assert(Math.abs(v[1]-meshFloor(model,v[0],v[2],1))<4e-6,`road ridge ${v}`);}}}
    for(const r of f.plan.roads)for(const v of r.positions){const expected=osmNavigationElevation(f.surface).point(v,.05);assert(p.roads.some(r=>r.positions.some(p=>p.every((n,k)=>n===expected[k]))));}
    const directions=native.crossings.flatMap(c=>c.directions).filter(d=>d.target!==65535);assert.equal(directions.length,options.oneway==='-1'?1:2);
  }
});
test('traffic requires elevated endpoints and preserves them in native lanes and 3D direction lengths',()=>{
  const f=fixture({angle:.57}),p=osmTerrainRoadPlan(f.plan,f.surface),traffic=osmTrafficPlan(p,f.surface,carOptions),bytes=osmRoadBytes(p,traffic),native=parseRoads(bytes);
  assert.throws(()=>osmTrafficPlan(f.plan,f.surface,carOptions),/výškový podklad/);
  for(const point of [...native.crossings,...native.nodes])assert(Math.abs(point.position[1]-meshFloor(f.surface.model,point.position[0],point.position[2],1))<3e-6);
  assert(native.crossings.flatMap(c=>c.directions).filter(d=>d.target!==65535).every(d=>d.lanes[0].distance===2));
  for(const [i,r]of p.roads.entries()){const chain=[p.crossings[r.from].position,...traffic.roads[i].positions,p.crossings[r.to].position],length=chain.slice(1).reduce((n,p,i)=>n+distance(p,chain[i]),0),slot=native.crossings[r.from].directions.findIndex(d=>d.target===r.to);assert(slot>=0);assert(Math.abs(bytes.readFloatLE(8+r.from*236+28+slot*52+4)-length)<.0001);}
});
test('native pedestrian nodes and links follow sloping pavement rather than the highest model vertex',()=>{
  for(const options of [{},{angle:.57},{size:83.456},{columns:2,rows:2,height:(x,z)=>200+5*x*z},{columns:2,rows:2,height:x=>200+20*x}]){
    const f=fixture(options),p=osmPedestrianPlan(f.source,f.plan,f.surface),native=parseNavigation(osmPedestrianBytes(p)),model=parseFourDs(writeSurfaceModel(f.surface.model),true);
    assert.equal(p.components,2);assert.deepEqual(native.warnings,[]);assert.equal(native.linkCount,p.links.length*2);assert(new Set(p.positions.map(v=>v[1])).size>5);
    for(const v of p.positions)assert(Math.abs(v[1]-meshFloor(model,v[0],v[2],2))<3e-6,`walk ground ${v}`);
    for(const [a,b]of p.links){const p1=p.positions[a],p2=p.positions[b];assert(distance(p1,p2)<=4.000001);for(const u of [.2,.5,.8]){const v=p1.map((n,k)=>n+(p2[k]-n)*u);assert(Math.abs(v[1]-meshFloor(model,v[0],v[2],2))<4e-6,`walk ridge ${v}`);}}
  }
});
test('mapped crossings connect both sloping pavements locally at their own heights',()=>{
  for(const angle of [0,.57]){
    const f=fixture({angle,crossing:true}),p=osmPedestrianPlan(f.source,f.plan,f.surface,null,null,{crossings:true}),native=parseNavigation(osmPedestrianBytes(p)),c=p.crossings.placements[0];assert(c);assert.equal(p.components,1);assert.equal(p.crossings.skipped.length,0);assert.deepEqual(native.warnings,[]);
    assert.equal(c.level,.05);assert(Math.abs(c.height-meshFloor(f.surface.model,c.point[0],c.point[2],1))<3e-6);assert.notEqual(c.landingHeights[0],c.landingHeights[1]);
    for(const v of p.positions)assert(Math.abs(v[1]-meshFloor(f.surface.model,v[0],v[2]))<4e-6,`crossing ground ${v}`);
    for(const [a,b]of p.links)assert(distance(p.positions[a],p.positions[b])<=4.000001);
    const ends=c.landings.map(q=>p.positions.findIndex(v=>v[0]===q[0]&&v[2]===q[1]));assert(ends.every(i=>i>=0));
    const lengths=p.positions.map(()=>Infinity),todo=new Set(p.positions.map((_,i)=>i));lengths[ends[0]]=0;while(todo.size){const i=[...todo].reduce((a,b)=>lengths[a]<lengths[b]?a:b);todo.delete(i);if(i===ends[1])break;for(const [a,b]of p.links){const j=a===i?b:b===i?a:null;if(j!==null)lengths[j]=Math.min(lengths[j],lengths[i]+distance(p.positions[i],p.positions[j]));}}
    assert(lengths[ends[1]]<distance(p.positions[ends[0]],p.positions[ends[1]])+.35,'the crossing never detours through remote pavement triangles');
  }
  const f=fixture({crossing:true,curbHeight:.251}),p=osmPedestrianPlan(f.source,f.plan,f.surface,null,null,{crossings:true});assert.equal(p.crossings.placements.length,0);assert.match(p.crossings.skipped[0].reason,/0,25/);
});
test('height navigation rejects missing support, extrapolation, incompatible parks and native node overflow',()=>{
  const f=fixture(),terrain=osmNavigationElevation(f.surface);
  assert.equal(osmNavigationElevation(osmSurfaceModel(f.plan,f.area,f.options)),null);assert.throws(()=>osmNavigationElevation({...f.surface,levels:undefined}),/výšková navigace/);assert.throws(()=>terrain.point([51,0,0],.05),/mimo/);assert.throws(()=>terrain.split([0,0,0],[1,0,0],()=>.05,0),/dělení/);assert.throws(()=>osmTerrainRoadPlan({...f.plan,flat:false},f.surface),/rovinný/);
  assert.throws(()=>osmPedestrianPlan(f.source,f.plan,f.surface,null,{placements:[]}),/parkové cesty/);
  const huge={...f.plan,roads:Array.from({length:100},()=>structuredClone(f.plan.roads[0]))};assert.throws(()=>osmTerrainRoadPlan(huge,{...f.surface,profiles:huge.roads.map(()=>({width:8}))}),/4096/);
});
