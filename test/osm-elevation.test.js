import test from 'node:test';
import assert from 'node:assert/strict';
import {osmArea} from '../src/plugins/osm/area.js';
import {osmElevationGrid} from '../src/plugins/osm/elevation.js';
import {osmTerrainSurface} from '../src/plugins/osm/terrain.js';
import {osmSurfaceModel,osmSurfaceDefaults} from '../src/plugins/osm/surface.js';
import {writeSurfaceModel} from '../src/core/surface-model.js';
import {parseFourDs} from '../src/core/fourds.js';
import {modelCollisionSurface} from '../src/core/model-collision.js';
import {parseCollision} from '../src/core/collision.js';
import {replaceCollisionSurfaces,collisionTriangleVertices} from '../src/core/collision-surfaces.js';
import {collisionFixture} from './fixtures/collision.js';

const area=osmArea({latitude:50,longitude:14,size:50}),options={...osmSurfaceDefaults};
const plan=(points=[[-30,0,-5],[0,0,0],[30,0,11]],links=[[0,1],[1,2]])=>({flat:true,crossings:points.map(position=>({position})),roads:links.map(([from,to])=>({from,to,positions:[]}))});
function settings({columns=5,rows=5,region=area,height=(x,z)=>200+Math.sin(x*.9)*2+Math.cos(z*.6),...rest}={}){return {version:1,area:structuredClone(region),columns,rows,base:2,samples:Array.from({length:(rows+1)*(columns+1)},(_,i)=>height(i%(columns+1),Math.floor(i/(columns+1)))),groundTexture:'maps/ground.bmp',groundTileSize:4,...rest};}
const triangles=model=>model.meshes.flatMap(m=>m.lods[0].faces.flatMap(f=>Array.from({length:f.indices.length/3},(_,i)=>({material:f.material,points:f.indices.slice(i*3,i*3+3).map(n=>m.lods[0].positions.slice(n*3,n*3+3)),uv:f.indices.slice(i*3,i*3+3).map(n=>m.lods[0].uv.slice(n*2,n*2+2))}))));
const areaOf=([a,b,c])=>Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))/2;
function topAt(tris,x,z){
  const values=[];
  for(const {points:[a,b,c]}of tris){const dx=b[0]-a[0],dz=b[2]-a[2],ex=c[0]-a[0],ez=c[2]-a[2],det=dx*ez-dz*ex;if(Math.abs(det)<1e-9)continue;const u=((x-a[0])*ez-(z-a[2])*ex)/det,v=(dx*(z-a[2])-dz*(x-a[0]))/det;if(u>=-2e-5&&v>=-2e-5&&u+v<=1+2e-5)values.push(a[1]+u*(b[1]-a[1])+v*(c[1]-a[1]));}
  return values;
}
test('elevation grid uses one immutable native triangular surface, not bilinear saddle heights',()=>{
  const input=settings({columns:1,rows:1,height:(x,z)=>100+4*x*z}),field=osmElevationGrid(input,area);
  assert.equal(field.minimum,100);assert.equal(field.maximum,104);assert.equal(field.heightAt(-25,-25),2);assert.equal(field.heightAt(25,25),6);assert.equal(field.heightAt(0,0),2);assert.equal(field.heightAt(12.5,12.5),4);
  input.samples[0]=999;input.area.latitude=51;assert.equal(field.samples[0],100);assert.equal(field.area.latitude,50);assert(Object.isFrozen(field));assert(Object.isFrozen(field.samples));assert(Object.isFrozen(field.area.bbox));
  assert.throws(()=>field.heightAt(25.001,0),/mimo/);assert.throws(()=>field.heightAt(0,NaN),/mimo/);assert.throws(()=>field.heightAt('0',0),/mimo/);
});
test('elevation grid rejects incomplete, void, wrong-area or unbounded input without inventing flat heights',()=>{
  const valid=settings();
  for(const extra of [{version:2},{area:{...area,longitude:14.1}},{columns:0},{rows:129},{columns:1.5},{samples:[]},{samples:Array(valid.samples.length)},{samples:valid.samples.map((n,i)=>i? n:null)},{samples:valid.samples.map((n,i)=>i?n:-32768)},{samples:valid.samples.map((n,i)=>i?n:Infinity)},{base:0},{base:'2'}])assert.throws(()=>osmElevationGrid({...valid,...extra},area),/výšky/);
  assert.throws(()=>osmElevationGrid(null,area),/výšky/);
});
test('edge splitting respects every cell and diagonal in both directions, including rectangular grids',()=>{
  const region={...area,size:123.456},field=osmElevationGrid(settings({region,columns:17,rows:13}),region);
  for(const [a,b]of [[[-60,-60],[60,60]],[[-60,59],[60,-59]],[[-50,2],[50,2]],[[0,-61],[0,61]],[[0,0],[0,0]],[[-61,-1],[3,60]]]){
    const pieces=field.splitEdge(a,b),reverse=field.splitEdge(b,a);assert.deepEqual(pieces.map(p=>p.point),reverse.map(p=>p.point).reverse());
    for(let i=1;i<pieces.length;i++){const p=pieces[i-1].point,q=pieces[i].point;assert(pieces[i].t>pieces[i-1].t);for(const u of [.2,.5,.8]){const x=p[0]+(q[0]-p[0])*u,z=p[1]+(q[1]-p[1])*u,actual=field.heightAt(x,z),expected=field.heightAt(...p)*(1-u)+field.heightAt(...q)*u;assert(Math.abs(actual-expected)<4e-6,`${actual}/${expected}`);}}
  }
});
test('elevated street tops, continuous ground, normals and metric UV survive native 4DS and KLZ round trips',()=>{
  const input=settings(),before=structuredClone(input),generated=osmTerrainSurface(plan(),area,options,input),native=parseFourDs(writeSurfaceModel(generated.model),true),tris=triangles(native),field=generated.elevation,heights=new Map([[1,.05],[2,Math.fround(.05+options.curbHeight)],[4,0]]);
  assert.deepEqual(input,before);assert.equal(generated.triangles,tris.length);assert(Math.abs(tris.filter(t=>t.material===4).reduce((n,t)=>n+areaOf(t.points),0)-area.size**2)<.001);
  for(const t of tris){
    if(t.material===3)continue;const offset=heights.get(t.material),tile=t.material===2?options.sidewalkTileSize:4;
    for(let i=0;i<3;i++){const p=t.points[i];assert.equal(p[1],Math.fround(field.heightAt(p[0],p[2])+offset));assert(Math.abs(t.uv[i][0]-p[0]/tile)<2e-6);assert(Math.abs(t.uv[i][1]-p[2]/tile)<2e-6);}
    const centre=[0,1,2].map(i=>t.points.reduce((n,p)=>n+p[i],0)/3);assert(Math.abs(centre[1]-field.heightAt(centre[0],centre[2])-offset)<5e-6);
  }
  for(const mesh of native.meshes){const lod=mesh.lods[0];for(let i=0;i<lod.normals.length;i+=3)assert(Math.abs(Math.hypot(...lod.normals.slice(i,i+3))-1)<1e-6);for(const f of lod.faces)if(f.material!==3)for(const i of f.indices)assert(lod.normals[i*3+1]>0);}
  const object={name:'OSM_TERRAIN',frameType:9,model:'TERRAIN.i3d',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]},surface={...modelCollisionSurface(native,object,{objects:[object]},{meshes:[]}),doubleSided:false},result=replaceCollisionSurfaces(collisionFixture(),[surface]),collision=parseCollision(result.bytes),group=result.groups[0],key=p=>p.map(v=>v.join('/')).sort().join('|');
  assert.equal(surface.positions.length/3,generated.counts.vertices);assert.equal(group.triangleCount,tris.length);assert.deepEqual(new Set(collision.primitives.triangles.records.slice(group.triangleStart).map(t=>key(collisionTriangleVertices(collision,t)))),new Set(tris.map(t=>key(t.points))));
});
test('curb upper edges meet actual pavement triangles through bends, clipping and non-integral grid spacing',()=>{
  for(const size of [50,50.123,83.456]){
    const region={...area,size},generated=osmTerrainSurface(plan(),region,options,settings({region,columns:7,rows:9})),tris=triangles(generated.model),walk=tris.filter(t=>t.material===2),field=generated.elevation;
    for(const polygons of Object.values(generated.footprints))for(const polygon of polygons)for(const ring of polygon)for(const [x,z]of ring){assert(x>=field.x[0]&&x<=field.x.at(-1));assert(z>=field.z[0]&&z<=field.z.at(-1));}
    for(const t of tris.filter(t=>t.material===3))for(const p of t.points){const offset=p[1]-field.heightAt(p[0],p[2]);if(Math.abs(offset-Math.fround(.05+options.curbHeight))>2e-6)continue;const hits=topAt(walk,p[0],p[2]);assert(hits.some(y=>Math.abs(y-p[1])<2e-5),`Missing curb seam ${p}`);}
  }
});
test('terrain refuses a fine city grid that exceeds the planned native collision budget',()=>{
  const region={...area,size:450},points=[],links=[];
  for(let z=-217.5;z<=217.5;z+=5){const n=points.length;points.push([-230,0,z],[230,0,z]);links.push([n,n+1]);}
  assert.throws(()=>osmTerrainSurface(plan(points,links),region,{...options,width:2,sidewalkWidth:.5},settings({region,columns:128,rows:128})),/60 000 (trojúhelníků|kolizních vrcholů)/);
});
test('terrain leaves original planar output byte-exact, preserves street holes and handles no-sidewalk profiles',()=>{
  const input=plan([[-15,0,-15],[15,0,-15],[15,0,15],[-15,0,15]],[[0,1],[1,2],[2,3],[3,0]]),before=writeSurfaceModel(osmSurfaceModel(input,area,options).model),copy=structuredClone(input),generated=osmTerrainSurface(input,area,options,settings()),tris=triangles(generated.model);
  assert.deepEqual(input,copy);assert.deepEqual(writeSurfaceModel(osmSurfaceModel(input,area,options).model),before);assert.equal(topAt(tris.filter(t=>t.material===1||t.material===2),.123,.321).length,0);assert(topAt(tris.filter(t=>t.material===4),.123,.321).length>0);
  const noWalk=osmTerrainSurface(plan(),area,{...options,sidewalks:'none'},settings());assert.equal(noWalk.counts.sidewalk,0);assert.equal(noWalk.counts.curb,0);
});
test('terrain bounds density and partitions large native meshes without changing indices or collision heights',()=>{
  const generated=osmTerrainSurface(plan(),area,options,settings({columns:128,rows:128})),native=parseFourDs(writeSurfaceModel(generated.model),true);assert(native.meshes.length>1);assert(generated.counts.vertices<60000);assert(generated.triangles<=60000);
  for(const mesh of native.meshes){const lod=mesh.lods[0];assert(lod.vertices<=60000);for(const f of lod.faces)assert(f.indices.every(n=>n>=0&&n<lod.vertices));}
  for(const extra of [{groundTexture:'maps/../bad.bmp'},{groundTexture:'https://example.com/x.bmp'},{groundTileSize:0},{groundTileSize:'4'}])assert.throws(()=>osmTerrainSurface(plan(),area,options,settings(extra)),/terén/);
});
