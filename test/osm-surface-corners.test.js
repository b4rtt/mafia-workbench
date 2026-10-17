import test from 'node:test';
import assert from 'node:assert/strict';
import clipping from 'polygon-clipping';
import {osmSurfaceModel,osmSurfaceDefaults} from '../src/plugins/osm/surface.js';
import {osmTerrainSurface} from '../src/plugins/osm/terrain.js';
import {writeSurfaceModel} from '../src/core/surface-model.js';
import {parseFourDs} from '../src/core/fourds.js';
import {modelCollisionSurface} from '../src/core/model-collision.js';
import {replaceCollisionSurfaces,collisionTriangleVertices} from '../src/core/collision-surfaces.js';
import {parseCollision} from '../src/core/collision.js';
import {collisionFixture} from './fixtures/collision.js';

const area={latitude:50,longitude:14,size:100},options={...osmSurfaceDefaults};
const network=(points,links,tags={})=>({flat:true,crossings:points.map(position=>({position})),roads:links.map(([from,to])=>({from,to,positions:[],tags}))});
const bend=()=>network([[-40,0,0],[0,0,0],[0,0,40]],[[0,1],[1,2]]);
const topology=p=>[p.length,p.reduce((n,r)=>n+r.length-1,0)];
const measure=polygons=>polygons.reduce((sum,p)=>sum+p.reduce((sum,ring,i)=>sum+(i?-1:1)*Math.abs(ring.slice(1).reduce((a,v,j)=>a+ring[j][0]*v[1]-ring[j][1]*v[0],0)/2),0),0);
const triangles=model=>model.meshes.flatMap(m=>m.lods[0].faces.flatMap(f=>Array.from({length:f.indices.length/3},(_,i)=>({material:f.material,p:f.indices.slice(i*3,i*3+3).map(j=>m.lods[0].positions.slice(j*3,j*3+3))}))));
const near=(a,b,tolerance=.0001)=>assert(Math.abs(a-b)<tolerance,`${a} ≠ ${b}`);

test('optional inner curb fillets add asphalt inside the same street envelope, retain planar UV and do not change legacy bytes',()=>{
  const p=bend(),before=structuredClone(p),plain=osmSurfaceModel(p,area,options),zero=osmSurfaceModel(p,area,{...options,cornerRadius:0}),rounded=osmSurfaceModel(p,area,{...options,cornerRadius:2});
  assert.deepEqual(zero,plain);assert.deepEqual(writeSurfaceModel(zero.model),writeSurfaceModel(plain.model));assert(rounded.corners.rounded>0);assert.equal(rounded.corners.radius,2);
  assert.equal(clipping.difference(plain.footprints.road,rounded.footprints.road).length,0);
  const total=f=>clipping.union(f.road,f.sidewalk);near(measure(clipping.xor(total(plain.footprints),total(rounded.footprints))),0);
  assert.equal(clipping.intersection(rounded.footprints.road,rounded.footprints.sidewalk).length,0);assert(measure(rounded.footprints.road)>measure(plain.footprints.road));
  assert.deepEqual(p,before);assert.deepEqual(osmSurfaceModel(p,area,JSON.parse(JSON.stringify({...options,cornerRadius:2}))),rounded);
  const native=parseFourDs(writeSurfaceModel(rounded.model),true);assert.equal(triangles(native).length,rounded.triangles);
  for(const mesh of native.meshes){const lod=mesh.lods[0];for(const f of lod.faces)if(f.material<3)for(const index of f.indices){const tile=f.material===1?4:2;assert(lod.normals[index*3+1]>.999);near(lod.uv[index*2],lod.positions[index*3]/tile);near(lod.uv[index*2+1],lod.positions[index*3+2]/tile);}}
});

test('inner city islands, disconnected streets and clipped boundaries survive large requested radii and transformed networks',()=>{
  for(const angle of [0,.57,1.9])for(const sign of [1,-1]){
    const points=[[-12,0,-12],[12,0,-12],[12,0,12],[-12,0,12],[-60,0,40],[60,0,40]].map(([x,y,z])=>[sign*(x*Math.cos(angle)-z*Math.sin(angle)),y,x*Math.sin(angle)+z*Math.cos(angle)]),p=network(points,[[0,1],[1,2],[2,3],[3,0],[4,5]]),plain=osmSurfaceModel(p,area,options),rounded=osmSurfaceModel(p,area,{...options,cornerRadius:6});
    assert.deepEqual(topology(rounded.footprints.road),topology(plain.footprints.road));assert(rounded.corners.rounded>0);
    assert.equal(clipping.difference(plain.footprints.road,rounded.footprints.road).length,0);
    for(const polygon of rounded.footprints.road)for(const ring of polygon)for(const p of ring)assert(p.every(v=>Math.abs(v)<=50));
  }
});

test('rounding respects missing or narrow sidewalks, constrains short edges and rejects invalid dimensions',()=>{
  const p=bend(),plain=osmSurfaceModel(p,area,{...options,sidewalks:'none'}),disabled=osmSurfaceModel(p,area,{...options,sidewalks:'none',cornerRadius:6});assert.deepEqual(disabled.footprints,plain.footprints);assert.equal(disabled.corners.rounded,0);assert(disabled.corners.skipped>0);
  const short=network([[-6,0,0],[0,0,0],[0,0,6]],[[0,1],[1,2]]),limited=osmSurfaceModel(short,area,{...options,cornerRadius:6});assert(limited.corners.limited>0||limited.corners.skipped>0);
  for(const cornerRadius of [-1,6.001,Infinity,NaN,'2',null])assert.throws(()=>osmSurfaceModel(p,area,{...options,cornerRadius}),/poloměr/);
});

test('new asphalt retains half a metre to the outer boundary with both, one-sided and narrow sidewalks',()=>{
  for(const sidewalks of ['both','left','right','none'])for(const sidewalkWidth of [.5,2]){
    const settings={...options,sidewalks,sidewalkWidth},plain=osmSurfaceModel(bend(),area,settings),rounded=osmSurfaceModel(bend(),area,{...settings,cornerRadius:6}),added=clipping.difference(rounded.footprints.road,plain.footprints.road),outer=clipping.union(plain.footprints.road,plain.footprints.sidewalk);
    for(const polygon of outer)for(const ring of polygon)for(let i=1;i<ring.length;i++){
      const a=ring[i-1],b=ring[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]),dx=-(b[1]-a[1])*.499/length,dz=(b[0]-a[0])*.499/length,strip=[[a[0]+dx,a[1]+dz],[b[0]+dx,b[1]+dz],[b[0]-dx,b[1]-dz],[a[0]-dx,a[1]-dz],[a[0]+dx,a[1]+dz]],cap=Array.from({length:49},(_,j)=>[a[0]+.499*Math.cos(j*Math.PI/24),a[1]+.499*Math.sin(j*Math.PI/24)]);
      assert.equal(clipping.intersection(added,[[strip],[cap]]).length,0,`${sidewalks}, ${sidewalkWidth}m sidewalk`);
    }
  }
});

test('rounded street geometry and all collision triangles use the same native vertices on flat and elevated terrain',()=>{
  const input={version:1,area,columns:4,rows:4,base:2,samples:Array.from({length:25},(_,i)=>200+i%5*.7+Math.floor(i/5)*.4),groundTexture:'maps/ground.bmp',groundTileSize:4};
  for(const elevated of [false,true]){
    const p=bend(),settings={...options,cornerRadius:2},generated=elevated?osmTerrainSurface(p,area,settings,input):osmSurfaceModel(p,area,settings),native=parseFourDs(writeSurfaceModel(generated.model),true),tris=triangles(native),object={name:'STREET',frameType:9,model:'STREET.i3d',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]},surface={...modelCollisionSurface(native,object,{objects:[object]},{meshes:[]}),doubleSided:false},replacement=replaceCollisionSurfaces(collisionFixture(),[surface]),collision=parseCollision(replacement.bytes),group=replacement.groups[0],key=points=>points.map(p=>p.join('/')).sort().join('|');
    assert(generated.corners.rounded>0);assert.equal(group.triangleCount,tris.length);assert.deepEqual(new Set(collision.primitives.triangles.records.slice(group.triangleStart).map(t=>key(collisionTriangleVertices(collision,t)))),new Set(tris.map(t=>key(t.p))));
    for(const {material,p:points}of tris)if(material!==3)for(const point of points){const offset=material===1?.05:material===2?Math.fround(.05+settings.curbHeight):0;near(point[1],Math.fround((elevated?generated.elevation.heightAt(point[0],point[2]):0)+offset),.00001);}
  }
});
