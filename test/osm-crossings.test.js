import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Ray,Vector3} from 'three';
import clipping from 'polygon-clipping';
import {osmSource,osmRoadPlan} from '../src/plugins/osm/area.js';
import {osmSurfaceModel,osmSurfaceDefaults} from '../src/plugins/osm/surface.js';
import {osmCrossingPlan} from '../src/plugins/osm/crossings.js';
import {osmPedestrianPlan,osmPedestrianBytes,validateOsmPedestrians} from '../src/plugins/osm/pedestrians.js';
import {osmGreenPlan,osmGreenDefaults} from '../src/plugins/osm/green-areas.js';
import {parseNavigation} from '../src/core/navigation.js';
const area={latitude:50,longitude:14,size:200};
function fixture({tags={},roadTags={},surfaceOptions={},angle=0,diagonal=null,position=0,bend=false,nearby=false,park=false,split=false}={}){
  const elements=[],node=(x,z,tags)=>{const id=elements.filter(e=>e.type==='node').length+1,c=Math.cos(angle),s=Math.sin(angle);elements.push({type:'node',id,lat:50+(x*s+z*c)/6371008.8*180/Math.PI,lon:14+(x*c-z*s)/6371008.8*180/Math.PI/Math.cos(50*Math.PI/180),...(tags?{tags}:{})});return id;};
  const a=node(-160,0),cross=node(position,0,{highway:'crossing',crossing:'uncontrolled',...tags}),b=node(160,bend?400:0);elements.push({type:'way',id:101,nodes:[a,cross,b],tags:{highway:'residential',...roadTags}});
  if(diagonal!==null){const lower=node(position-diagonal*8,-8),upper=node(position+diagonal*8,8);elements.push({type:'way',id:102,nodes:[lower,cross,upper],tags:{highway:'footway',footway:'crossing'}});}
  if(nearby){const a=node(4,-50),b=node(4,50);elements.push({type:'way',id:103,nodes:[a,b],tags:{highway:'residential'}});}
  if(park){const ids=[node(-40,5),node(40,5),node(40,50),node(-40,50)],path=[node(20,2),node(20,40)];elements.push({type:'way',id:104,nodes:[...ids,ids[0]],tags:{landuse:'grass'}},{type:'way',id:105,nodes:path,tags:{highway:'footway',width:'3'}});}
  if(split){elements.find(e=>e.id===101&&e.type==='way').nodes=[a,cross];elements.push({type:'way',id:106,nodes:[cross,b],tags:{highway:'residential'}});}const source=osmSource({elements},area),roads=osmRoadPlan(source,nearby?[101,103]:split?[101,106]:[101]),surface=osmSurfaceModel(roads,area,{...osmSurfaceDefaults,...surfaceOptions});return {data:{elements},source,roads,surface,cross};
}
const enabled=f=>osmPedestrianPlan(f.source,f.roads,f.surface,null,null,{crossings:true});
const reachable=(p,a,b)=>{const stack=[a],seen=new Set(stack),adj=p.positions.map(()=>[]);for(const[a,b]of p.links){adj[a].push(b);adj[b].push(a);}while(stack.length)for(const n of adj[stack.pop()])if(!seen.has(n)){seen.add(n);stack.push(n);}return seen.has(b);};
function floor(model,x,z){let height=null;for(const mesh of model.meshes){const lod=mesh.lods[0];for(const f of lod.faces)for(let i=0;i<f.indices.length;i+=3){const v=f.indices.slice(i,i+3).map(i=>new Vector3(...lod.positions.slice(i*3,i*3+3))),hit=new Ray(new Vector3(x,2,z),new Vector3(0,-1,0)).intersectTriangle(...v,true,new Vector3());if(hit)height=Math.max(height??-Infinity,hit.y);}}return height;}
test('mapped uncontrolled crossings join opposite pavements on actual ground with native reciprocal navigation',()=>{
  for(const angle of [0,.57]){
    const f=fixture({angle}),before=structuredClone(f),p=enabled(f),native=parseNavigation(osmPedestrianBytes(p));assert.deepEqual(f,before);assert.deepEqual(p,enabled(f));assert.equal(p.crossings.placements.length,1);assert.equal(p.components,1);assert.equal(osmPedestrianPlan(f.source,f.roads,f.surface).components,2);assert.deepEqual(native.warnings,[]);assert.equal(native.linkCount,p.links.length*2);const lateral=v=>-v[0]*Math.sin(angle)+v[2]*Math.cos(angle),a=p.positions.findIndex(v=>lateral(v)>3.5),b=p.positions.findIndex(v=>lateral(v)<-3.5);assert(a>=0&&b>=0);assert(reachable(p,a,b));
    for(const v of p.positions)assert(Math.abs(floor(f.surface.model,v[0],v[2])-v[1])<1e-6,`native node is grounded: ${v}`);
    for(const[a,b]of p.links){const v=p.positions[a],w=p.positions[b];assert(Math.hypot(...v.map((n,i)=>n-w[i]))<=4.00001);for(let i=0;i<=20;i++){const x=v[0]+(w[0]-v[0])*i/20,z=v[2]+(w[2]-v[2])*i/20;assert.notEqual(floor(f.surface.model,x,z),null);if(Math.abs(-x*Math.sin(angle)+z*Math.cos(angle))<2.99)assert(Math.abs(x*Math.cos(angle)+z*Math.sin(angle))<1.11,'road links stay inside the inset crossing');}}
    assert(native.points.some(p=>p.position[1]===Math.fround(.05)));assert(native.points.some(p=>p.position[1]===Math.fround(.2)));
  }
});
test('explicit crossing footways set the diagonal direction and node width, without mutating source tags',()=>{
  const f=fixture({diagonal:.3,tags:{width:'4 m'}}),p=enabled(f),c=p.crossings.placements[0];assert.equal(p.components,1);assert.equal(c.directionSource,'OSM footway=crossing');assert.equal(c.width,4);assert.equal(c.widthSource,'OSM width');assert(Math.abs(c.direction[0]/c.direction[1]-.3)<1e-8);assert.equal(f.source.ways.find(w=>w.id===102).tags.footway,'crossing');
  for(const angle of [0,.57]){const split=enabled(fixture({split:true,angle}));assert.equal(split.crossings.placements.length,1);assert.equal(split.components,1);}const fallback=enabled(fixture()).crossings.placements[0];assert.equal(fallback.width,3);assert.match(fallback.widthSource,/náhradní/);assert.match(fallback.directionSource,/odhad/);
});
test('signals, islands, restricted access and unsupported crossing geometry are skipped explicitly',()=>{
  for(const tags of [{crossing:'traffic_signals'},{'crossing:signals':'yes'},{crossing:'marked'},{crossing:undefined},{'crossing:island':'yes'},{traffic_calming:'table'},{'crossing:continuous':'yes'},{foot:'no'},{access:'private'},{'foot:conditional':'yes @ (day)'},{'access:conditional':'no @ (night)'},{layer:'1'},{bridge:'yes'},{tunnel:'yes'},{width:'.5'},{width:'9'},{width:'bad'}]){
    // Missing OSM tags are omitted, rather than serialized as undefined.
    const f=fixture({tags:Object.fromEntries(Object.entries(tags).filter(([,v])=>v!==undefined))});if(Object.hasOwn(tags,'crossing')&&tags.crossing===undefined)delete f.source.pedestrianCrossings[0].tags.crossing;
    const p=enabled(f);assert.equal(p.components,2,JSON.stringify(tags));assert.equal(p.crossings.placements.length,0);assert.equal(p.crossings.skipped.length,1);assert(p.crossings.skipped[0].reason.length>10);
  }
  assert.equal(enabled(fixture({tags:{crossing:'marked','crossing:signals':'no'}})).components,1);
});
test('missing landings, tall curbs, bends, junctions and blockers never get a road shortcut',()=>{
  for(const options of [{surfaceOptions:{sidewalks:'left'}},{surfaceOptions:{sidewalkWidth:.8}},{surfaceOptions:{curbHeight:.251}},{position:99},{bend:true},{nearby:true},{diagonal:2}]){const f=fixture(options),p=osmCrossingPlan(f.source,f.roads,f.surface);assert.equal(p.placements.length,0,JSON.stringify(options));assert.equal(p.skipped.length,1);}
  const f=fixture(),props={placements:[{footprint:[[-.5,-3.5],[.5,-3.5],[.5,-2.5],[-.5,-2.5],[-.5,-3.5]]}]};assert.equal(osmCrossingPlan(f.source,f.roads,f.surface,props).placements.length,0);f.source.buildings.push({id:400,polygons:[[[[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]]]]});assert.equal(osmCrossingPlan(f.source,f.roads,f.surface).placements.length,0);
  assert.equal(enabled(fixture({surfaceOptions:{curbHeight:.25}})).components,1);
  const gap=fixture();gap.surface.footprints.sidewalk=clipping.difference(gap.surface.footprints.sidewalk,[[[[-5,3.2],[5,3.2],[5,3.25],[-5,3.25],[-5,3.2]]]]);assert.equal(osmCrossingPlan(gap.source,gap.roads,gap.surface).placements.length,0,'a physical gap between the road and landing is never bridged');
});
test('crossings and park paths combine without counting road nodes as park paving',()=>{
  const f=fixture({park:true}),green=osmGreenPlan(f.source,f.surface,{...osmGreenDefaults,selected:[104]}),p=osmPedestrianPlan(f.source,f.roads,f.surface,null,green,{crossings:true});assert.equal(p.components,1);assert(p.parkPoints>5);assert.equal(p.parkPoints,p.positions.filter(v=>v[2]>5&&v[1]===Math.fround(.03)).length);assert.equal(p.crossings.placements.length,1);
});
test('the option validates as a boolean and disabled imports keep legacy navigation bytes',()=>{
  const f=fixture({surfaceOptions:{curbHeight:.4}}),old=osmPedestrianPlan(f.source,f.roads,f.surface),off=osmPedestrianPlan(f.source,f.roads,f.surface,null,null,{crossings:false});assert.deepEqual(off,old);assert(!Object.hasOwn(off,'crossings'));assert.equal(createHash('sha256').update(osmPedestrianBytes(old)).digest('hex'),createHash('sha256').update(osmPedestrianBytes(off)).digest('hex'));
  const settings={version:1,density:30,capacity:3,models:[{path:'models/civil13.4ds',model:'civil13.i3d',sha256:'a'.repeat(64)}]};for(const crossings of [true,false])validateOsmPedestrians({...settings,crossings});for(const crossings of [null,1,'yes'])assert.throws(()=>validateOsmPedestrians({...settings,crossings}),/chodci/);
  const invalid=fixture().data;invalid.elements[1].tags.width=42;assert.throws(()=>osmSource(invalid,area),/přechody/);
  const node=(id,x,tags)=>({type:'node',id,lat:50,lon:14+x/6371008.8*180/Math.PI/Math.cos(50*Math.PI/180),...(tags?{tags}:{})}),nodes=[node(1,-110),...Array.from({length:65},(_,i)=>node(i+2,-96+i*3,{highway:'crossing',crossing:'uncontrolled'})),node(67,110)],source=osmSource({elements:[...nodes,{type:'way',id:101,nodes:nodes.map(n=>n.id),tags:{highway:'residential'}}]},area),roads=osmRoadPlan(source,[101]),surface=osmSurfaceModel(roads,area,osmSurfaceDefaults);assert.throws(()=>osmCrossingPlan(source,roads,surface),/64 podporovaných/);
});
