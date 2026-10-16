import test from 'node:test';
import assert from 'node:assert/strict';
import {Ray,Vector3} from 'three';
import {osmElevationGrid} from '../src/plugins/osm/elevation.js';
import {osmBuildingSupport,osmBuildingFoundation,osmFoundationVertices} from '../src/plugins/osm/building-terrain.js';
import {osmShellPlan,osmShellModel} from '../src/plugins/osm/building-shells.js';
import {osmBuildingPlan} from '../src/plugins/osm/buildings.js';
import {osmGreenReservation} from '../src/plugins/osm/green-areas.js';
import {osmTerrainSurface} from '../src/plugins/osm/terrain.js';
import {osmSurfaceDefaults} from '../src/plugins/osm/surface.js';
import {writeSurfaceModel} from '../src/core/surface-model.js';
import {parseFourDs} from '../src/core/fourds.js';
import {modelCollisionSurface} from '../src/core/model-collision.js';
import {frameMatrix} from '../src/shared/scene-world.js';

const area={latitude:50,longitude:14,size:100},outer=[[-20,-15],[20,-15],[20,15],[-20,15]],hole=[[-5,-5],[-5,5],[5,5],[5,-5]],roads={flat:true,crossings:[{position:[-50,0,-40]},{position:[50,0,-40]}],roads:[{from:0,to:1,positions:[]}]};
const shellOptions={version:1,mode:'footprint',selected:[1],styles:[{id:'brick'}],ground:.1,fallbackHeight:15},originalOptions={version:1,selected:[1],adjustScale:false,minCoverage:.25,fallbackHeight:10,ground:.1},catalog=[{path:'models/HOUSE.4ds',sha256:'a'.repeat(64),min:[-7,-.2,-3],max:[5,10,5],vertices:8}];
const source=(polygon=[outer,hole])=>({area,ways:[],buildings:[{id:1,tags:{building:'yes'},polygons:[polygon]}]});
function surface(fn=(x,z)=>200+x*.03+z*.02){return osmTerrainSurface(roads,area,osmSurfaceDefaults,{version:1,area,columns:10,rows:10,base:2,samples:Array.from({length:121},(_,i)=>fn(-50+i%11*10,-50+Math.floor(i/11)*10)),groundTexture:'maps/ground.bmp',groundTileSize:4});}
const triangles=model=>model.meshes.flatMap(m=>m.lods[0].faces.flatMap(f=>Array.from({length:f.indices.length/3},(_,i)=>({material:f.material,p:f.indices.slice(i*3,i*3+3).map(n=>m.lods[0].positions.slice(n*3,n*3+3))}))));
function hits(model,p,d){const ray=new Ray(new Vector3(...p),new Vector3(...d));return triangles(model).flatMap(t=>{const hit=ray.intersectTriangle(...t.p.map(p=>new Vector3(...p)),true,new Vector3());return hit?[hit.toArray()]:[];});}
const vertices=model=>new Set(model.meshes.flatMap(m=>{const p=m.lods[0].positions;return Array.from({length:p.length/3},(_,i)=>p.slice(i*3,i*3+3).join('/'));})).size;

test('building support includes interior terrain peaks and excludes courtyard peaks, retaining every boundary cut',()=>{
  const field=osmElevationGrid({version:1,area,columns:2,rows:2,base:2,samples:[200,200,200,200,202,200,200,200,200]},area),s={elevation:field,levels:{road:.05,ground:0,sidewalk:.2},model:{materials:[{},{},{texture:'curb.bmp'}]}},ring=[[-40,-40],[40,-40],[40,40],[-40,40]],court=[[-25,-25],[25,-25],[25,25],[-25,25]],full=osmBuildingSupport(s,area,[ring],0),withHole=osmBuildingSupport(s,area,[ring,court],0);
  assert.equal(full.maximum,4);assert(Math.abs(full.ground-4.01)<1e-6);assert.equal(withHole.maximum,3);assert(full.maximum>Math.max(...full.profiles.flatMap(r=>r.map(p=>p[1]))));
  for(const support of [full,withHole])for(const r of support.profiles)for(let i=0;i<r.length;i++)for(const c of field.splitEdge([r[i][0],r[i][2]],[r[(i+1)%r.length][0],r[(i+1)%r.length][2]])){
    const next=r[(i+1)%r.length],y=r[i][1]+(next[1]-r[i][1])*c.t;assert(Math.abs(y-field.heightAt(...c.point))<1e-6);
  }
});

test('native foundations close sloping walls, preserve courtyard holes and metric UV with outward normals',()=>{
  const s=surface(),support=osmBuildingSupport(s,area,[outer,hole],.1),model=parseFourDs(writeSurfaceModel(osmBuildingFoundation(support)),true),top=triangles(model).filter(t=>t.p.every(p=>p[1]===support.ground));
  const capArea=top.reduce((sum,{p:[a,b,c]})=>sum+((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]))/2,0);assert(Math.abs(capArea-1100)<1e-5);assert.equal(hits(model,[.1,100,.2],[0,-1,0]).length,0);assert(hits(model,[10.1,100,.2],[0,-1,0]).some(p=>p[1]===support.ground));
  assert(hits(model,[30,support.ground-.1,0],[-1,0,0]).some(p=>p[0]===20));assert(hits(model,[0,support.ground-.1,0],[1,0,0]).some(p=>p[0]===5));
  for(const m of model.meshes){const lod=m.lods[0];for(let i=0;i<lod.vertices;i++){const p=lod.positions.slice(i*3,i*3+3);assert(p[1]===support.ground||Math.abs(p[1]-s.elevation.heightAt(p[0],p[2])+.03)<2e-6);assert(Math.abs(Math.hypot(...lod.normals.slice(i*3,i*3+3))-1)<1e-6);}for(const t of triangles(model).filter(t=>!t.p.every(p=>p[1]===support.ground)))assert(Math.hypot(...t.p[1].map((n,k)=>n-t.p[0][k]))>0);}
  const lod=model.meshes[0].lods[0];for(const f of lod.faces)for(let i=0;i<f.indices.length;i+=3)for(let j=0;j<3;j++)for(let k=j+1;k<3;k++){const a=f.indices[i+j],b=f.indices[i+k],p=lod.positions.slice(a*3,a*3+3),q=lod.positions.slice(b*3,b*3+3),u=lod.uv.slice(a*2,a*2+2),v=lod.uv.slice(b*2,b*2+2);if(p[0]===q[0]&&p[2]===q[2])assert(Math.abs(Math.abs(p[1]-q[1])-Math.abs(u[1]-v[1]))<2e-6);}
  const concave=[[-20,-15],[20,-15],[20,15],[5,15],[5,-2],[-5,-2],[-5,15],[-20,15]],bay=osmBuildingFoundation(osmBuildingSupport(s,area,[concave],.1));assert.equal(hits(bay,[.1,100,5.2],[0,-1,0]).length,0);assert(hits(bay,[10.1,100,5.2],[0,-1,0]).length>0);
});

test('sloped footprint shells retain horizontal roofs and exact native world collision with their own foundation',()=>{
  const s=surface(),input=source(),before=structuredClone(input);
  for(const roof of [undefined,{useOsmTags:false,shape:'gabled',height:3,orientation:'along'}]){
    const p=osmShellPlan(input,roads,s,{...shellOptions,...(roof?{roof}:{})}).placements[0],bytes=writeSurfaceModel(osmShellModel(p)),model=parseFourDs(bytes,true),object={...p,frameType:9,model:'house.4ds'},collision=modelCollisionSurface(model,object,{objects:[object]},{meshes:[]}),all=triangles(model);
    assert.equal(model.meshes.length,2);assert.equal(model.materials.length,5);assert.equal(collision.indices.length/3,p.triangles);assert.equal(p.position[1],p.support.ground);assert.equal(p.rotation[0],1);assert.deepEqual(p.scale,[1,1,1]);assert(all.filter(t=>t.material===3).some(t=>t.p.some(v=>v[1]===15)));assert(all.filter(t=>t.material===5).some(t=>t.p.some(v=>v[1]<0)));
    const actual=new Set();for(let i=0;i<collision.positions.length;i+=3)actual.add(collision.positions.slice(i,i+3).map(Math.fround).join('/'));const matrix=frameMatrix(object);for(const t of all)for(const v of t.p)assert(actual.has(new Vector3(...v).applyMatrix4(matrix).toArray().map(Math.fround).join('/')));
    assert.deepEqual(writeSurfaceModel(osmShellModel(JSON.parse(JSON.stringify(p)))),bytes);
  }assert.deepEqual(input,before);
});

test('rigid original houses use their complete native rotated base and reserve foundation collisions',()=>{
  const s=surface(),angle=.47,c=Math.cos(angle),sin=Math.sin(angle),ring=[[-9,-6],[9,-6],[9,6],[-9,6]].map(([x,z])=>[8+c*x-sin*z,10+sin*x+c*z]),p=osmBuildingPlan(source([ring]),roads,s,catalog,originalOptions).placements[0];assert(p);assert.deepEqual(p.scale,[1,1,1]);assert.equal(p.modelHash,catalog[0].sha256);
  const matrix=frameMatrix(p),corners=[[-7,-.2,-3],[5,-.2,-3],[5,-.2,5],[-7,-.2,5]].map(v=>new Vector3(...v).applyMatrix4(matrix).toArray());for(const q of corners){assert(Math.abs(q[1]-p.support.ground)<2e-6);assert(q[1]>=s.elevation.heightAt(q[0],q[2]));assert(p.support.polygon[0].some(v=>Math.hypot(q[0]-v[0],q[2]-v[1])<2e-6));}
  assert.equal(osmGreenReservation(s,{placements:[p]},catalog),vertices(s.model)+catalog[0].vertices+osmFoundationVertices(p.support));
  const shell=osmShellPlan(source(),roads,s,shellOptions);assert.equal(osmGreenReservation(s,shell),vertices(s.model)+vertices(osmShellModel(shell.placements[0])));
});

test('unsupported slopes, mismatched fields and invalid foundations are explicit, without changing planar houses',()=>{
  const steep=surface((x,z)=>200+x*.3+z*.1);for(const p of [osmShellPlan(source(),roads,steep,shellOptions),osmBuildingPlan(source([[[-9,-6],[9,-6],[9,6],[-9,6]]]),roads,steep,catalog,originalOptions)]){assert.equal(p.placements.length,0);assert.match(p.skipped[0].reason,/3 m/);}
  const s=surface();assert.throws(()=>osmBuildingSupport(s,{...area,size:200},[outer],0),/jiné oblasti/);assert.throws(()=>osmBuildingSupport(s,area,[outer],-.1),/nezáporný/);assert.throws(()=>osmBuildingSupport(s,area,[[[0,0],[0,0],[0,0]]],0),/nulová/);
  const support=osmBuildingSupport(s,area,[outer],0);for(const change of [{texture:'maps/../bad.bmp'},{ground:NaN},{profiles:[[[0,NaN,0]]]},{embed:-1}])assert.throws(()=>osmBuildingFoundation({...support,...change}),/profil/);
  const a=osmShellPlan(source(),roads,null,shellOptions).placements[0],b=osmBuildingPlan(source([[[-9,-6],[9,-6],[9,6],[-9,6]]]),roads,null,catalog,originalOptions).placements[0];assert.equal(a.support,undefined);assert.equal(b.support,undefined);assert.equal(a.position[1],.1);assert.equal(b.position[1],Math.fround(.1));assert.equal(osmShellModel(a).meshes.length,1);
  const crowded={...s,model:{...s.model,meshes:[{lods:[{positions:Array.from({length:59960*3},(_,i)=>i%3===0?Math.floor(i/3)*.001:0)}]}]}},blocked=osmShellPlan(source(),roads,crowded,shellOptions);assert.equal(blocked.placements.length,0);assert.match(blocked.skipped[0].reason,/vrcholů/);
});
