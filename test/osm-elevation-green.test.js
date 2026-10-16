import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Ray,Vector3} from 'three';
import {osmSource,osmRoadPlan} from '../src/plugins/osm/area.js';
import {osmSurfaceModel,osmSurfaceDefaults} from '../src/plugins/osm/surface.js';
import {osmTerrainSurface} from '../src/plugins/osm/terrain.js';
import {osmGreenDefaults,osmGreenPlan,osmGreenModel} from '../src/plugins/osm/green-areas.js';
import {osmPropReservation} from '../src/plugins/osm/props.js';
import {osmPedestrianPlan,osmPedestrianBytes} from '../src/plugins/osm/pedestrians.js';
import {parseNavigation} from '../src/core/navigation.js';
import {parseFourDs} from '../src/core/fourds.js';
import {writeSurfaceModel} from '../src/core/surface-model.js';
import {modelCollisionSurface} from '../src/core/model-collision.js';
import {parseCollision} from '../src/core/collision.js';
import {replaceCollisionSurfaces,collisionTriangleVertices} from '../src/core/collision-surfaces.js';
import {collisionFixture} from './fixtures/collision.js';

function fixture({angle=0,gap=0,size=100,curbHeight=.15,columns=11,rows=7,height=(x,z)=>200+.06*x+.08*z+1.5*Math.max(0,1-Math.abs(z)/8),tags={}}={}){
  const area={latitude:50,longitude:14,size},elements=[],node=(x,z,tags)=>{const id=elements.length+1,c=Math.cos(angle),s=Math.sin(angle),px=x*c-z*s,pz=x*s+z*c;elements.push({type:'node',id,lat:50+pz/6371008.8*180/Math.PI,lon:14+px/6371008.8*180/Math.PI/Math.cos(50*Math.PI/180),...(tags?{tags}:{})});return id;},ring=points=>{const ids=points.map(p=>node(...p));return [...ids,ids[0]];};
  const road=[node(-size,0),node(0,0,{highway:'crossing',crossing:'uncontrolled'}),node(size,0)],park=ring([[-35,5+gap],[35,5+gap],[35,60],[-35,60]]),hole=ring([[6,16],[14,16],[14,24],[6,24]]),path=[node(0,2),node(0,45)];
  elements.push({type:'way',id:101,nodes:road,tags:{highway:'residential'}},{type:'way',id:102,nodes:park},{type:'way',id:104,nodes:hole},{type:'relation',id:201,members:[{type:'way',ref:102,role:'outer'},{type:'way',ref:104,role:'inner'}],tags:{type:'multipolygon',landuse:'grass'}},{type:'way',id:103,nodes:path,tags:{highway:'footway',width:'3',...tags}});
  const source=osmSource({elements},area),roads=osmRoadPlan(source,[101]),options={...osmSurfaceDefaults,width:6,curbHeight},settings={version:1,area,columns,rows,base:2,samples:Array.from({length:(columns+1)*(rows+1)},(_,i)=>height(size*(i%(columns+1)/columns-.5),size*(Math.floor(i/(columns+1))/rows-.5))),groundTexture:'maps/ground.bmp',groundTileSize:4},surface=osmTerrainSurface(roads,area,options,settings),greenOptions={...osmGreenDefaults,selected:['relation/201/1']},green=osmGreenPlan(source,surface,greenOptions);
  return {source,roads,options,settings,surface,greenOptions,green};
}
const triangles=model=>model.meshes.flatMap(m=>m.lods[0].faces.flatMap(f=>Array.from({length:f.indices.length/3},(_,i)=>({material:f.material,p:f.indices.slice(i*3,i*3+3).map(n=>m.lods[0].positions.slice(n*3,n*3+3))}))));
function floor(tris,x,z,material){let y=-Infinity;const ray=new Ray(new Vector3(x,1000,z),new Vector3(0,-1,0));for(const t of tris){if(material&&t.material!==material)continue;const hit=ray.intersectTriangle(...t.p.map(p=>new Vector3(...p)),true,new Vector3());if(hit)y=Math.max(y,hit.y);}return y;}
const vertices=model=>new Set(triangles(model).flatMap(t=>t.p.map(p=>p.join('/')))).size;
const distance=(a,b)=>Math.hypot(...a.map((n,k)=>n-b[k]));
const component=(p,start)=>{const seen=new Set([start]),stack=[start],adj=p.positions.map(()=>[]);for(const[a,b]of p.links){adj[a].push(b);adj[b].push(a);}while(stack.length)for(const n of adj[stack.pop()])if(!seen.has(n)){seen.add(n);stack.push(n);}return seen;};

test('sloping grass and paving retain native metric UV, upward normals and exact one-sided KLZ triangles',()=>{
  for(const options of [{},{angle:.37},{columns:2,rows:2,height:(x,z)=>200+x*z*.003}]){
    const f=fixture(options),item=f.green.placements[0],before=structuredClone(item),model=parseFourDs(writeSurfaceModel(osmGreenModel(item,f.green.elevation)),true),tris=triangles(model),ground=triangles(f.surface.model).filter(t=>t.material===4);
    assert.deepEqual(item,before);assert.equal(f.green.elevation,f.surface.elevation);assert(item.elevated);assert.equal(tris.length,item.triangles);const heights=tris.flatMap(t=>t.p.map(v=>v[1]));assert(Math.max(...heights)-Math.min(...heights)>.1,'green geometry follows the slope rather than one flat level');
    for(const t of tris){const mid=[0,1,2].map(k=>t.p.reduce((n,p)=>n+p[k],0)/3);assert(Math.abs(mid[1]-floor(ground,mid[0],mid[2])-.03)<6e-6,'whole triangle stays on a terrain plane');}
    for(const mesh of model.meshes){const lod=mesh.lods[0];for(const face of lod.faces)for(const n of face.indices){const p=lod.positions.slice(n*3,n*3+3),normal=lod.normals.slice(n*3,n*3+3),tile=face.material===1?4:2;assert(normal[1]>0);assert(Math.abs(Math.hypot(...normal)-1)<1e-6);assert(Math.abs(lod.uv[n*2]-p[0]/tile)<2e-6);assert(Math.abs(lod.uv[n*2+1]-p[2]/tile)<2e-6);}}
    const object={name:'GREEN',frameType:9,model:'GREEN.i3d',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]},surface={...modelCollisionSurface(model,object,{objects:[object]},{meshes:[]}),doubleSided:false},result=replaceCollisionSurfaces(collisionFixture(),[surface]),collision=parseCollision(result.bytes),group=result.groups[0],key=p=>p.map(v=>v.join('/')).sort().join('|');
    assert.equal(group.triangleCount,tris.length);assert.deepEqual(new Set(collision.primitives.triangles.records.slice(group.triangleStart).map(t=>key(collisionTriangleVertices(collision,t)))),new Set(tris.map(t=>key(t.p))));
  }
});
test('elevated green preserves clipped boundaries and courtyard holes without overlapping grass and paths',()=>{
  for(const size of [100,83.456,50.0000028]){
    const f=fixture({size}),item=f.green.placements[0],tris=triangles(osmGreenModel(item,f.green.elevation)),area=tris.reduce((n,{p:[a,b,c]})=>n+((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]))/2,0);assert(Math.abs(area-item.area)<.001);assert.equal(floor(tris,10,20),-Infinity);assert.equal(floor(tris,0,0),-Infinity);
    for(let x=-size/2+.317;x<size/2;x+=4.971)for(let z=5.193;z<size/2;z+=4.319){const hits=tris.filter(t=>Number.isFinite(floor([t],x,z)));assert(hits.length<=1,'grass/paving never overlap');if(Math.abs(x)<34.99&&!(x>6&&x<14&&z>16&&z<24))assert.equal(hits.length,1,'no cracks between cells or materials');}
    for(const t of tris)for(const v of t.p)assert(v[0]>=f.surface.elevation.x[0]&&v[0]<=f.surface.elevation.x.at(-1)&&v[2]>=f.surface.elevation.z[0]&&v[2]<=f.surface.elevation.z.at(-1));
  }
});
test('terrain park routes join the sidewalk and crossing on their own heights through ridges',()=>{
  for(const options of [{},{angle:.37},{size:83.456},{columns:3,rows:2,height:(x,z)=>200+x*z*.002}]){
    const f=fixture(options),p=osmPedestrianPlan(f.source,f.roads,f.surface,null,f.green,{crossings:true}),native=parseNavigation(osmPedestrianBytes(p)),model=parseFourDs(writeSurfaceModel(osmGreenModel(f.green.placements[0],f.green.elevation)),true),tris=[...triangles(f.surface.model),...triangles(model)],park=triangles(model).filter(t=>t.material===2);
    assert.deepEqual(native.warnings,[]);assert.equal(p.components,1);assert(p.parkPoints>5);assert(p.parkPoints<p.positions.length/2);const far=p.positions.findIndex(v=>Number.isFinite(floor(park,v[0],v[2]))&&v[2]>25),south=p.positions.findIndex(v=>v[2]<-3);assert(far>=0&&south>=0);assert(component(p,south).has(far));
    for(const v of p.positions)assert(Math.abs(floor(tris,v[0],v[2])-v[1])<6e-6,`native point is grounded ${v}`);
    for(const[a,b]of p.links){const v=p.positions[a],w=p.positions[b];assert(distance(v,w)<=4.000001);for(const u of [.2,.5,.8]){const q=v.map((n,k)=>n+(w[k]-n)*u),ground=floor(tris,q[0],q[2]);assert(Number.isFinite(ground));const parkA=floor(park,v[0],v[2]),parkB=floor(park,w[0],w[2]);if(Math.abs(v[1]-parkA)<6e-6&&Math.abs(w[1]-parkB)<6e-6)assert(Math.abs(q[1]-ground)<8e-6,JSON.stringify({options,v,w,q,ground,parkA,parkB}));}}
  }
  const gap=fixture({gap:.02}),p=osmPedestrianPlan(gap.source,gap.roads,gap.surface,null,gap.green);assert.equal(p.components,3);
});
test('terrain parks reject other grids and unsupported path access or curb steps',()=>{
  const f=fixture(),flat=osmSurfaceModel(f.roads,f.source.area,f.options),flatGreen=osmGreenPlan(f.source,flat,f.greenOptions),other=fixture({height:(x,z)=>200+x*.1});
  assert.throws(()=>osmPedestrianPlan(f.source,f.roads,f.surface,null,flatGreen),/stejný výškový/);assert.throws(()=>osmPedestrianPlan(f.source,f.roads,f.surface,null,{...f.green,elevation:other.surface.elevation}),/stejný výškový/);assert.throws(()=>osmPedestrianPlan(f.source,f.roads,flat,null,f.green),/stejný výškový/);assert.throws(()=>osmGreenModel(f.green.placements[0]),/chybí společný/);assert.throws(()=>osmGreenPlan({...f.source,area:{...f.source.area,size:101}},f.surface,f.greenOptions),/jiné oblasti/);
  for(const tags of [{access:'private'},{foot:'no'},{'access:conditional':'no @ (night)'},{bridge:'yes'},{layer:'1'}]){const q=fixture({tags});assert.throws(()=>osmPedestrianPlan(q.source,q.roads,q.surface,null,q.green),/podporovanou veřejnou/);}
  const high=fixture({curbHeight:.231});assert.throws(()=>osmPedestrianPlan(high.source,high.roads,high.surface,null,high.green),/0,25/);
});
test('native green splitting and the shared collision reservation use actual elevated mesh counts',()=>{
  const f=fixture(),item=f.green.placements[0],count=vertices(osmGreenModel(item,f.green.elevation));assert.equal(osmPropReservation(f.surface,null,[],f.green),vertices(f.surface.model)+count);
  assert.equal(osmGreenPlan(f.source,f.surface,f.greenOptions,60000-count).placements.length,1);const over=osmGreenPlan(f.source,f.surface,f.greenOptions,60001-count);assert.equal(over.placements.length,0);assert.match(over.skipped[0].reason,/sdílený/);
  const dense=fixture({columns:128,rows:128}),whole=[[[-50,-50],[50,-50],[50,50],[-50,50],[-50,-50]]],large={...item,grass:[whole],paths:[]},model=parseFourDs(writeSurfaceModel(osmGreenModel(large,dense.surface.elevation)),true);assert(model.meshes.length>1);assert.equal(triangles(model).length,32768);
  for(const mesh of model.meshes){const lod=mesh.lods[0];assert(lod.vertices<=60000);for(const face of lod.faces)assert(face.indices.every(n=>n>=0&&n<lod.vertices));}
  assert.throws(()=>osmGreenModel({...large,paths:[whole]},dense.surface.elevation),/60 000 trojúhelníků/);
});
test('planar green models keep their native bytes from before terrain support',()=>{
  const item={grass:[[[[-20,-20],[20,-20],[20,20],[-20,20],[-20,-20]],[[-5,-5],[-5,5],[5,5],[5,-5],[-5,-5]]]],paths:[],height:.03,tileSize:4,pathTileSize:2,texture:'maps/grass.bmp',pathTexture:'maps/path.bmp'};
  assert.equal(createHash('sha256').update(writeSurfaceModel(osmGreenModel(item))).digest('hex'),'82856f20bd03eb051d5827f96970a5ffe9d9d28e3b69a85afa34fdefee6bedfe');
});
