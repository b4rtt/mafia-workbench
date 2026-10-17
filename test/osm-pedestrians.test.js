import test from 'node:test';
import assert from 'node:assert/strict';
import {osmSource,osmRoadPlan} from '../src/plugins/osm/area.js';
import {osmSurfaceModel,osmSurfaceDefaults} from '../src/plugins/osm/surface.js';
import {osmPedestrianPlan,osmPedestrianBytes,validateOsmPedestrians} from '../src/plugins/osm/pedestrians.js';
import {loadOsmPedestrianModels} from '../src/plugins/osm/pedestrian-assets.js';
import {parseNavigation} from '../src/core/navigation.js';
const area={latitude:50,longitude:14,size:200},node=(id,x,z)=>({type:'node',id,lat:50+z/6371008.8*180/Math.PI,lon:14+x/6371008.8*180/Math.PI/Math.cos(50*Math.PI/180)});
function street(xy=[[-50,0],[50,0]],tags={},options={}){
  const source=osmSource({elements:[...xy.map(([x,z],i)=>node(i+1,x,z)),{type:'way',id:10,nodes:xy.map((_,i)=>i+1),tags:{highway:'residential',...tags}}]},area),roads=osmRoadPlan(source,[10]),surface=osmSurfaceModel(roads,area,{...osmSurfaceDefaults,...options});return {source,roads,surface};
}
const settings=()=>({version:1,density:30,capacity:3,models:[{path:'models/civil13.4ds',model:'civil13.i3d',sha256:'a'.repeat(64)}]});
const distance=(p,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],u=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[2]-a[1])*dz)/(dx*dx+dz*dz)));return Math.hypot(p[0]-a[0]-u*dx,p[2]-a[1]-u*dz);};
function verify(plan,surface){
  const native=parseNavigation(osmPedestrianBytes(plan));assert(native.points.length>1);assert.deepEqual(native.warnings,[]);assert.equal(native.linkCount,plan.links.length*2);
  const visited=new Set();let components=0;for(let i=0;i<native.points.length;i++)if(!visited.has(i)){components++;const stack=[i];visited.add(i);while(stack.length)for(const l of native.points[stack.pop()].links)if(!visited.has(l.target)){visited.add(l.target);stack.push(l.target);}}assert.equal(plan.components,components);
  for(const [i,p]of native.points.entries()){assert.equal(p.type,1);assert.equal(p.id,i);assert.equal(p.areaSize,10);assert.equal(p.position[1],Math.fround(.2));assert(p.links.length>0&&p.links.length<=3);if(i)assert(p.position[0]>=native.points[i-1].position[0]);for(const l of p.links){assert.equal(l.type,1);assert(native.points[l.target].links.some(l=>l.target===i));}}
  for(const [a,b]of plan.links){const p=plan.positions[a],q=plan.positions[b];assert(Math.hypot(...q.map((v,i)=>v-p[i]))<=4.0001);for(let i=0;i<=20;i++){const v=p.map((n,k)=>n+(q[k]-n)*i/20);for(const poly of surface.footprints.sidewalk)for(const ring of poly)for(let j=1;j<ring.length;j++)assert(distance(v,ring[j-1],ring[j])>=.398,`boundary clearance ${v}`);}}
}
test('OSM pedestrian graph is native, deterministic, reciprocal, sorted and remains inside the pavement',()=>{
  const {source,roads,surface}=street(),before=structuredClone({source,roads,surface}),p=osmPedestrianPlan(source,roads,surface);verify(p,surface);assert.deepEqual(osmPedestrianPlan(source,roads,surface),p);assert.deepEqual({source,roads,surface},before);
});
test('bends and separate road sides never receive a connection across the carriageway',()=>{
  const {source,roads,surface}=street([[-100,0],[0,0],[0,100]]),p=osmPedestrianPlan(source,roads,surface);verify(p,surface);assert.equal(p.components,2);
});
test('narrow, absent and explicitly forbidden sidewalks fail rather than spawning on the road',()=>{
  for(const options of [{sidewalkWidth:.5},{sidewalks:'none'}]){const{source,roads,surface}=street(undefined,{},options);assert.throws(()=>osmPedestrianPlan(source,roads,surface),/chodní|trasa/);}
  for(const tags of [{foot:'no'},{foot:'private'},{'foot:conditional':'no @ (night)'}]){const{source,roads,surface}=street(undefined,tags);assert.throws(()=>osmPedestrianPlan(source,roads,surface),/trasa/);}
  const{source,roads,surface}=street(undefined,{foot:'designated'});assert(osmPedestrianPlan(source,roads,surface).positions.length>0);assert.throws(()=>osmPedestrianPlan(source,roads,null),/chodní/);
});
test('mapped building holes and furniture bases are excluded with body clearance',()=>{
  const{source,roads,surface}=street([[-100,0],[100,0]],{}, {sidewalkWidth:4});
  const obstacle=[[-2,4],[2,4],[2,6],[-2,6]],house=[[-2,-6],[2,-6],[2,-4],[-2,-4]];source.buildings.push({id:20,polygons:[[house]]});
  const p=osmPedestrianPlan(source,roads,surface,{placements:[{footprint:obstacle}]});verify(p,surface);
  for(const[a,b]of p.links)for(let i=0;i<=20;i++){const v=p.positions[a].map((n,k)=>n+(p.positions[b][k]-n)*i/20);for(const ring of [obstacle,house])for(let j=0;j<ring.length;j++)assert(distance(v,ring[j],ring[(j+1)%ring.length])>=.398);}
});
test('civilian configuration rejects invalid numbers, missing hashes, paths and duplicate model families',()=>{
  validateOsmPedestrians(settings());for(const patch of [{version:2},{density:0},{density:101},{density:1.5},{capacity:0},{capacity:21},{capacity:2.5},{models:[]},{models:Array(17).fill(settings().models[0])},{models:[settings().models[0],settings().models[0]]},{models:[{...settings().models[0],sha256:'stale'}]},{models:[{...settings().models[0],model:'civil16.i3d'}]},{models:[{...settings().models[0],path:'models/../civil13.4ds'}]}])assert.throws(()=>validateOsmPedestrians({...settings(),...patch}),/chodci/);
});
test('civilian catalog reports invalid skeletons and rejects unavailable or changed saved models',async()=>{
  const p={manifest:{assets:[{path:'models/civil13.4ds'},{path:'models/cop01.4ds'}]},read:async()=>Buffer.alloc(4)},c=await loadOsmPedestrianModels(p);assert.equal(c.models.length,0);assert.equal(c.warnings.length,1);await assert.rejects(loadOsmPedestrianModels(p,settings()),/chodci/);await assert.rejects(loadOsmPedestrianModels({...p,manifest:{assets:[]}},settings()),/dostupné/);
});

test('larger pedestrian networks retain every island and native link while enforcing the import budget',()=>{
  // Disjoint body-wide strips in a 450 m square exercise the real planner,
  // not just a hand-built serializer input or a configurable test limit.
  const surface=count=>({model:{meshes:[{lods:[{positions:[0,.2,0]}]}]},footprints:{sidewalk:Array.from({length:count},(_,i)=>{const z=-215+i;return [[[-220,z],[220,z],[220,z+.85],[-220,z+.85],[-220,z]]];})}}),source={ways:[],buildings:[]},roads={roads:[]},plan=osmPedestrianPlan(source,roads,surface(250)),bytes=osmPedestrianBytes(plan),native=parseNavigation(bytes);
  assert(plan.positions.length>8192&&plan.positions.length<=16384);assert.equal(plan.components,250);assert.equal(native.points.length,plan.positions.length);assert.equal(native.linkCount,plan.links.length*2);assert.deepEqual(native.warnings,[]);
  const visited=new Set();let islands=0;
  for(const p of native.points){assert.equal(p.id,p.index);if(p.index)assert(p.position[0]>=native.points[p.index-1].position[0]);for(const link of p.links){const q=native.points[link.target];assert(q.links.some(l=>l.target===p.index));assert(Math.hypot(...p.position.map((n,k)=>n-q.position[k]))<=4.000001);}if(!visited.has(p.index)){islands++;const queue=[p.index];visited.add(p.index);while(queue.length)for(const l of native.points[queue.pop()].links)if(!visited.has(l.target)){visited.add(l.target);queue.push(l.target);}}}
  assert.equal(islands,250);assert.equal(visited.size,native.points.length);assert.deepEqual(osmPedestrianBytes(osmPedestrianPlan(source,roads,surface(250))),bytes);
  assert.throws(()=>osmPedestrianPlan(source,roads,surface(430)),/síť přesahuje 16384 bodů/);
});
