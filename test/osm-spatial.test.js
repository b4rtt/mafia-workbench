import test from 'node:test';
import assert from 'node:assert/strict';
import {osmSpatialModel} from '../src/plugins/osm/spatial.js';
import {osmCitySurface} from '../src/plugins/osm/city-surface.js';
import {osmSurfaceModel,osmSurfaceDefaults} from '../src/plugins/osm/surface.js';
import {osmTerrainSurface} from '../src/plugins/osm/terrain.js';
import {writeSurfaceModel} from '../src/core/surface-model.js';
import {parseFourDs} from '../src/core/fourds.js';
import {modelCollisionFrameSurfaces} from '../src/core/model-collision.js';
const area={latitude:50,longitude:14,size:150},partition={version:1,cellSize:25},options={...osmSurfaceDefaults},identity={position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]};
const plan={flat:true,crossings:[[-60,0,-40],[0,0,0],[60,0,40],[0,0,60]].map(position=>({position})),roads:[[0,1],[1,2],[1,3]].map(([from,to])=>({from,to,positions:[]}))};
const elevation={version:1,area,columns:6,rows:6,base:2,samples:Array.from({length:49},(_,i)=>200+Math.sin(i%7)*1.4+Math.cos(Math.floor(i/7))*2),groundTexture:'maps/ground.bmp',groundTileSize:4};
const triangles=model=>model.meshes.flatMap(mesh=>mesh.lods[0].faces.flatMap(f=>Array.from({length:f.indices.length/3},(_,t)=>({material:f.material,vertices:f.indices.slice(t*3,t*3+3).map(i=>({p:mesh.lods[0].positions.slice(i*3,i*3+3),uv:mesh.lods[0].uv.slice(i*2,i*2+2),n:mesh.lods[0].normals.slice(i*3,i*3+3)}))}))));
const cross=([a,b,c])=>{const u=b.p.map((n,i)=>n-a.p[i]),v=c.p.map((n,i)=>n-a.p[i]);return[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];};
const surfaceArea=(model,material)=>triangles(model).filter(t=>t.material===material).reduce((n,t)=>n+Math.hypot(...cross(t.vertices))/2,0);
function sample(model,x,z){const hits=[];for(const t of triangles(model)){const[a,b,c]=t.vertices,dx=b.p[0]-a.p[0],dz=b.p[2]-a.p[2],ex=c.p[0]-a.p[0],ez=c.p[2]-a.p[2],det=dx*ez-dz*ex;if(Math.abs(det)<1e-9)continue;const u=((x-a.p[0])*ez-(z-a.p[2])*ex)/det,v=(dx*(z-a.p[2])-dz*(x-a.p[0]))/det;if(u>1e-6&&v>1e-6&&u+v<1-1e-6)hits.push({material:t.material,y:a.p[1]+u*(b.p[1]-a.p[1])+v*(c.p[1]-a.p[1]),uv:a.uv.map((n,i)=>n+u*(b.uv[i]-n)+v*(c.uv[i]-n))});}return hits.sort((a,b)=>a.material-b.material);}
for(const elevated of [false,true])test(`spatial ${elevated?'terrain':'flat streets'} preserves coverage, winding, interpolated UV and collision indices`,()=>{
  const before=structuredClone(plan),settings={...options,partition},original=elevated?osmTerrainSurface(plan,area,options,elevation):osmSurfaceModel(plan,area,options),result=osmCitySurface(plan,area,settings,elevated?elevation:null),native=parseFourDs(writeSurfaceModel(result.model),'all');
  assert(result.spatial.parts.length>4);assert.deepEqual(plan,before);assert.deepEqual(result.footprints,original.footprints);assert.deepEqual(result.profiles,original.profiles);
  for(let material=1;material<=(elevated?4:3);material++)assert(Math.abs(surfaceArea(native,material)-surfaceArea(original.model,material))<.01,`material ${material}`);
  for(let x=-71.231;x<72;x+=9.113)for(let z=-71.713;z<72;z+=11.317){const a=sample(original.model,x,z),b=sample(native,x,z);assert.deepEqual(b.map(h=>h.material),a.map(h=>h.material));a.forEach((h,i)=>{assert(Math.abs(h.y-b[i].y)<1e-5);h.uv.forEach((n,j)=>assert(Math.abs(n-b[i].uv[j])<1e-5));});}
  for(const t of triangles(native)){const n=cross(t.vertices);assert(Math.hypot(...n)>0);assert(t.vertices.every(v=>Math.abs(Math.hypot(...v.n)-1)<1e-6));if(t.material!==3&&n[1]<=0)assert(triangles(original.model).some(o=>o.material===t.material&&JSON.stringify(o.vertices.map(v=>v.p))===JSON.stringify(t.vertices.map(v=>v.p))), 'new reversed triangle');}
  for(const [i,mesh]of native.meshes.entries()){const part=result.spatial.parts[i],lod=mesh.lods[0];assert.equal(mesh.name,part.name);for(let v=0;v<lod.positions.length;v+=3){assert(lod.positions[v]>=part.cell[0]*25-1e-5&&lod.positions[v]<=(part.cell[0]+1)*25+1e-5);assert(lod.positions[v+2]>=part.cell[1]*25-1e-5&&lod.positions[v+2]<=(part.cell[1]+1)*25+1e-5);}}
  const object={...identity,name:'OSM_STREETS',frameType:9,model:'streets.i3d'},parts=modelCollisionFrameSurfaces(native,object,{objects:[object]},{meshes:[]});assert.equal(parts.length,native.meshes.length);parts.forEach((p,i)=>{assert.deepEqual(p.positions,native.meshes[i].lods[0].positions);assert.deepEqual(p.indices,native.meshes[i].lods[0].faces.flatMap(f=>f.indices));});
});
test('grid corners and original vertices on a plane retain identical attributes at both sides',()=>{
  const model=osmSurfaceModel(plan,area,options).model,source=model.meshes[0];model.meshes=[{...source,lods:[{distance:0,vertices:3,positions:[-50,1,-50,50,5,-50,0,7,50],normals:[0,1,0,0,1,0,0,1,0],uv:[-4,-3,6,-3,1,9],faces:[{material:1,indices:[0,2,1]}]}]}];
  const result=osmSpatialModel(model,partition),native=parseFourDs(writeSurfaceModel(result.model),'all'),seen=new Map();let shared=0;
  for(const mesh of native.meshes){const lod=mesh.lods[0];for(let i=0;i<lod.vertices;i++){const p=lod.positions.slice(i*3,i*3+3);if(p[0]%25&&p[2]%25)continue;const key=p.join('/'),attr=[...lod.normals.slice(i*3,i*3+3),...lod.uv.slice(i*2,i*2+2)];if(seen.has(key)){assert.deepEqual(attr,seen.get(key));shared++;}else seen.set(key,attr);}}
  assert(shared>10);assert.equal(surfaceArea(native,1).toFixed(3),surfaceArea(model,1).toFixed(3));
});
test('vertical curb on a cell plane or diagonal through a corner is not duplicated',()=>{
  const base=osmSurfaceModel(plan,area,options).model,source=base.meshes[0];for(const positions of [[0,0,-50,0,2,-50,0,0,50],[-50,0,-50,-50,2,-50,50,0,50]]){const model={...base,meshes:[{...source,lods:[{distance:0,vertices:3,positions,normals:[1,0,0,1,0,0,1,0,0],uv:[0,0,0,2,10,0],faces:[{material:3,indices:[0,1,2]}]}]}]},result=osmSpatialModel(model,partition);assert(Math.abs(surfaceArea(result.model,3)-surfaceArea(model,3))<.0001);}
});
test('legacy output stays byte-exact and JSON settings reproduce partitioned bytes without mutating input',()=>{
  for(const e of [null,elevation]){const old=e?osmTerrainSurface(plan,area,options,e):osmSurfaceModel(plan,area,options);assert.deepEqual(writeSurfaceModel(osmCitySurface(plan,area,options,e).model),writeSurfaceModel(old.model));const settings={...options,partition},before=structuredClone(settings),a=osmCitySurface(plan,area,settings,e),b=osmCitySurface(plan,area,JSON.parse(JSON.stringify(settings)),e);assert.deepEqual(writeSurfaceModel(a.model),writeSurfaceModel(b.model));assert.deepEqual(a.spatial,b.spatial);assert.deepEqual(settings,before);}
});
test('invalid or excessive spatial splits fail before model publication',()=>{
  const model=osmSurfaceModel(plan,area,options).model;for(const setting of [null,{}, {version:2,cellSize:25},{version:1,cellSize:24},{version:1,cellSize:251},{version:1,cellSize:25.5},{version:1,cellSize:25,extra:true}])assert.throws(()=>osmSpatialModel(model,setting),/prostorové části/);
  assert.throws(()=>osmSpatialModel({...model,meshes:[{...model.meshes[0],position:[1,0,0]}]},partition),/transformací/);
  const huge=structuredClone(model);huge.meshes[0].lods[0].positions=huge.meshes[0].lods[0].positions.map(n=>n*10000);assert.throws(()=>osmSpatialModel(huge,partition),/512/);
});

test('native driving and pedestrian graphs remain common and byte-identical across visual partitions',async()=>{
  const {osmArea,osmSource,osmRoadPlan}=await import('../src/plugins/osm/area.js'),{osmTerrainRoadPlan}=await import('../src/plugins/osm/navigation-elevation.js'),{osmRoadBytes}=await import('../src/plugins/osm/mission.js'),{osmPedestrianPlan,osmPedestrianBytes}=await import('../src/plugins/osm/pedestrians.js');
  const region=osmArea(area),data={elements:[{type:'node',id:1,lat:50,lon:13.998},{type:'node',id:2,lat:50,lon:14},{type:'node',id:3,lat:50,lon:14.002},{type:'way',id:10,nodes:[1,2,3],tags:{highway:'residential',oneway:'yes',sidewalk:'both'}}]},source=osmSource(data,region),roads=osmRoadPlan(source,[10]);
  for(const e of [null,{...elevation,area:region}]){const a=osmCitySurface(roads,region,options,e),b=osmCitySurface(roads,region,{...options,partition},e),roadA=e?osmTerrainRoadPlan(roads,a):roads,roadB=e?osmTerrainRoadPlan(roads,b):roads;assert.deepEqual(osmRoadBytes(roadA),osmRoadBytes(roadB));const walkA=osmPedestrianPlan(source,roads,a),walkB=osmPedestrianPlan(source,roads,b);assert.deepEqual(osmPedestrianBytes(walkA),osmPedestrianBytes(walkB));assert.equal(walkA.components,2);}
});
