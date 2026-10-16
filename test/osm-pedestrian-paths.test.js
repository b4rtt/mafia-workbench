import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Ray,Vector3} from 'three';
import {osmSource,osmRoadPlan} from '../src/plugins/osm/area.js';
import {osmSurfaceModel,osmSurfaceDefaults} from '../src/plugins/osm/surface.js';
import {osmGreenPlan,osmGreenModel,osmGreenDefaults} from '../src/plugins/osm/green-areas.js';
import {osmPedestrianPlan,osmPedestrianBytes,validateOsmPedestrians} from '../src/plugins/osm/pedestrians.js';
import {parseNavigation} from '../src/core/navigation.js';
const region={latitude:50,longitude:14,size:200};
function fixture({gap=0,tags={},width=3,curbHeight=.15,dense=false,angle=0}={}){
  const elements=[],node=(x,z)=>{const id=elements.length+1,c=Math.cos(angle),s=Math.sin(angle),px=x*c-z*s,pz=x*s+z*c;elements.push({type:'node',id,lat:50+pz/6371008.8*180/Math.PI,lon:14+px/6371008.8*180/Math.PI/Math.cos(50*Math.PI/180)});return id;};
  const road=[node(-110,0),node(110,0)],park=[node(-60,5+gap),node(60,5+gap),node(60,55),node(-60,55)],path=[node(0,2),node(0,50)];
  if(dense)for(let i=-2;i<=2;i++){const vertical=[node(i*12+.00017,2),node(i*12+.00023,50)],horizontal=[node(-40,i*8+30.00019),node(40,i*8+30.00023)];elements.push({type:'way',id:200+i*2+10,nodes:vertical,tags:{highway:'footway',width:'3'}},{type:'way',id:201+i*2+10,nodes:horizontal,tags:{highway:'footway',width:'3'}});}
  elements.push({type:'way',id:101,nodes:road,tags:{highway:'residential'}},{type:'way',id:102,nodes:[...park,park[0]],tags:{landuse:'grass'}},{type:'way',id:103,nodes:path,tags:{highway:'footway',width:String(width),...tags}});
  const source=osmSource({elements},region),roads=osmRoadPlan(source,[101]),surface=osmSurfaceModel(roads,region,{...osmSurfaceDefaults,curbHeight}),green=osmGreenPlan(source,surface,{...osmGreenDefaults,selected:[102]});return {source,roads,surface,green};
}
const component=(p,start)=>{const seen=new Set([start]),stack=[start],adj=p.positions.map(()=>[]);for(const[a,b]of p.links){adj[a].push(b);adj[b].push(a);}while(stack.length)for(const n of adj[stack.pop()])if(!seen.has(n)){seen.add(n);stack.push(n);}return seen;};
const at=(p,predicate)=>{const index=p.positions.findIndex(predicate);assert(index>=0,'expected point exists');return index;};
function ground(models,x,z){const ys=[];for(const m of models)for(const mesh of m.meshes){const lod=mesh.lods[0];for(const f of lod.faces)for(let i=0;i<f.indices.length;i+=3){const p=f.indices.slice(i,i+3).map(n=>new Vector3(...lod.positions.slice(n*3,n*3+3))),hit=new Ray(new Vector3(x,2,z),new Vector3(0,-1,0)).intersectTriangle(...p,true,new Vector3());if(hit)ys.push(hit.y);}}return ys.length?Math.max(...ys):null;}
test('generated park paving joins the adjoining sidewalk with actual ground heights and a native reciprocal graph',()=>{
  const f=fixture(),before=structuredClone(f),p=osmPedestrianPlan(f.source,f.roads,f.surface,null,f.green),native=parseNavigation(osmPedestrianBytes(p));assert.deepEqual(f,before);assert.deepEqual(p,osmPedestrianPlan(f.source,f.roads,f.surface,null,f.green));assert(p.parkPoints>10);assert.equal(p.components,2);assert.deepEqual(native.warnings,[]);
  const north=at(p,v=>v[2]>3&&v[2]<4.5&&v[0]<-10),park=at(p,v=>v[2]>40),south=at(p,v=>v[2]<-3);assert(component(p,north).has(park));assert(!component(p,north).has(south));
  const models=[f.surface.model,...f.green.placements.map(osmGreenModel)];for(const v of p.positions)assert(Math.abs(ground(models,v[0],v[2])-v[1])<1e-6,`point ${v} actual floor ${ground(models,v[0],v[2])}`);
  for(const[a,b]of p.links){const v=p.positions[a],w=p.positions[b];assert(Math.hypot(...v.map((n,i)=>n-w[i]))<=4.00001);for(let j=0;j<=20;j++){const x=v[0]+(w[0]-v[0])*j/20,z=v[2]+(w[2]-v[2])*j/20;assert.notEqual(ground(models,x,z),null,'whole link has real ground');}}
  assert(p.links.some(([a,b])=>p.positions[a][1]!==p.positions[b][1]),'curb transition is explicit in native heights');
});
test('a gap or an insufficiently wide entrance never creates a sidewalk to park connection',()=>{
  const f=fixture({gap:.02}),p=osmPedestrianPlan(f.source,f.roads,f.surface,null,f.green),a=at(p,v=>v[2]>3&&v[2]<4.5),b=at(p,v=>v[2]>40);assert(!component(p,a).has(b));assert.equal(p.components,3);
  const narrow=fixture({width:.5}),n=osmPedestrianPlan(narrow.source,narrow.roads,narrow.surface,null,narrow.green);assert.equal(n.parkPoints,0);assert.equal(n.components,2);
});
test('nonpublic, conditional and unsupported-level paths do not get population routes',()=>{
  for(const tags of [{foot:'no'},{foot:'private'},{access:'private'},{access:'customers'},{'foot:conditional':'yes @ (day)'},{'access:conditional':'no @ (night)'},{bridge:'yes'},{tunnel:'yes'},{layer:'1'}]){const f=fixture({tags});assert.throws(()=>osmPedestrianPlan(f.source,f.roads,f.surface,null,f.green),/podporovanou veřejnou/);}
  for(const tags of [{foot:'designated'},{access:'private',foot:'yes'},{access:'permissive'}]){const f=fixture({tags});assert(osmPedestrianPlan(f.source,f.roads,f.surface,null,f.green).parkPoints>0);}
});
test('large curb steps are rejected only for the opt-in park network and legacy sidewalk bytes stay unchanged',()=>{
  const limit=fixture({curbHeight:.23});assert(osmPedestrianPlan(limit.source,limit.roads,limit.surface,null,limit.green).parkPoints>0);const over=fixture({curbHeight:.231});assert.throws(()=>osmPedestrianPlan(over.source,over.roads,over.surface,null,over.green),/0,25 m/);
  const f=fixture({curbHeight:.4});assert.throws(()=>osmPedestrianPlan(f.source,f.roads,f.surface,null,f.green),/0,25 m/);
  // Native bytes of this synthetic sidewalk fixture before park support.
  assert.equal(createHash('sha256').update(osmPedestrianBytes(osmPedestrianPlan(f.source,f.roads,f.surface))).digest('hex'),'9cd95fbbd657c5b95d64d115f46d36ce99e3d10e786db3b075fddb8bdea927e0');
  const settings={version:1,density:30,capacity:3,models:[{path:'models/civil13.4ds',model:'civil13.i3d',sha256:'a'.repeat(64)}]};validateOsmPedestrians(settings);validateOsmPedestrians({...settings,parkPaths:true});validateOsmPedestrians({...settings,parkPaths:false});for(const parkPaths of [null,1,'true'])assert.throws(()=>validateOsmPedestrians({...settings,parkPaths}),/chodci/);
});
test('furniture across a park path splits the route without bridging its clearance area',()=>{
  const f=fixture(),props={placements:[{footprint:[[-2,20],[2,20],[2,22],[-2,22],[-2,20]]}]},p=osmPedestrianPlan(f.source,f.roads,f.surface,props,f.green),north=at(p,v=>v[2]>3&&v[2]<4.5),park=at(p,v=>v[2]>40);assert(!component(p,north).has(park));assert.equal(p.components,3);
  for(const[a,b]of p.links)for(let i=0;i<=20;i++){const v=p.positions[a],w=p.positions[b],x=v[0]+(w[0]-v[0])*i/20,z=v[2]+(w[2]-v[2])*i/20;assert(!(x>-2.39&&x<2.39&&z>19.61&&z<22.39),'link clears the obstacle');}
});
test('dense park path intersections keep a closed, bounded native graph',()=>{
  const f=fixture({dense:true}),p=osmPedestrianPlan(f.source,f.roads,f.surface,null,f.green),native=parseNavigation(osmPedestrianBytes(p));assert(p.parkPoints>100);assert(p.positions.length<8192);assert.equal(p.components,2);assert.deepEqual(native.warnings,[]);assert.deepEqual(p,osmPedestrianPlan(f.source,f.roads,f.surface,null,f.green));
  const models=[f.surface.model,...f.green.placements.map(osmGreenModel)];for(const v of p.positions)assert(Math.abs(ground(models,v[0],v[2])-v[1])<1e-6,'all points stay on real paving');
});
test('rotated shared seams choose the highest actual native floor',()=>{
  const f=fixture({angle:.57,gap:-.1}),p=osmPedestrianPlan(f.source,f.roads,f.surface,null,f.green),models=[f.surface.model,...f.green.placements.map(osmGreenModel)];assert(p.parkPoints>0);for(const v of p.positions)assert(Math.abs(ground(models,v[0],v[2])-v[1])<1e-6,`point ${v} actual floor ${ground(models,v[0],v[2])}`);
});
