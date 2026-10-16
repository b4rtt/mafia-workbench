import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { roadJunctionPlan } from '../src/shared/road-junction.js';
import { roadSurfaceModel } from '../src/shared/road-surface.js';
import { roadConnections } from '../src/shared/roads.js';
import { changeRoadTopology } from '../src/core/road-topology.js';
import { parseRoads } from '../src/core/roads.js';
import { createRoadSurfaceBytes } from '../src/core/road-surface.js';
import { parseFourDs } from '../src/core/fourds.js';
import { modelCollisionSurface } from '../src/core/model-collision.js';
import { ModProject } from '../src/core/project.js';
import { hash, writeSafe } from '../src/core/files.js';

const options={name:'WB_JUNCTION',from:0,mode:'junction',joinJunctions:true,roadTexture:'maps/asphalt.bmp',sidewalkTexture:'maps/paving.bmp',curbTexture:'maps/curb.bmp',width:6,sidewalkWidth:2,curbHeight:.15,roadTileLength:12,roadTileWidth:6,sidewalkTileSize:2,curbTileLength:1,heightOffset:0};
function network(angles=[0,90,180,270],center=[0,2,0],distance=50){
  let data=Buffer.alloc(12);data.writeUInt32LE(2);
  for(const position of [center,...angles.map(angle=>[center[0]+Math.cos(angle*Math.PI/180)*distance,center[1],center[2]+Math.sin(angle*Math.PI/180)*distance])])data=changeRoadTopology(data,{action:'create-crossing',position,speed:10,semaphore:0}).data;
  for(let to=1;to<=angles.length;to++)data=changeRoadTopology(data,{action:'connect',from:0,to,positions:[parseRoads(data).crossings[to].position.map((v,j)=>(v+center[j])/2)],speed:10}).data;
  return {data,file:parseRoads(data)};
}
const lod=model=>model.meshes[0].lods[0],point=(mesh,index)=>mesh.positions.slice(index*3,index*3+3),points=mesh=>new Set(Array.from({length:mesh.vertices},(_,i)=>point(mesh,i).join(',')));
function area(mesh,material){let sum=0;for(const face of mesh.faces.filter(f=>f.material===material))for(let at=0;at<face.indices.length;at+=3){const[a,b,c]=face.indices.slice(at,at+3).map(i=>point(mesh,i));sum+=Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))/2;}return sum;}
function topHits(mesh,x,z){
  let count=0;for(const face of mesh.faces.filter(f=>f.material<=2))for(let at=0;at<face.indices.length;at+=3){const[a,b,c]=face.indices.slice(at,at+3).map(i=>point(mesh,i)),cross=(p,q)=>(q[0]-p[0])*(z-p[2])-(q[2]-p[2])*(x-p[0]),values=[cross(a,b),cross(b,c),cross(c,a)];if(values.every(n=>n<=1e-7)||values.every(n=>n>=-1e-7)){if(values.some(n=>Math.abs(n)<1e-7))return null;count++;}}return count;
}
test('T and X junctions have exact road/sidewalk areas, upward tops, hard curbs and no overlapping surface interiors',()=>{
  for(const [angles,expected]of [[[0,90,180,270],[108,32]],[[0,90,180],[90,40]]]){
    const {file}=network(angles),mesh=lod(roadSurfaceModel(file,options));assert(Math.abs(area(mesh,1)-expected[0])<1e-5);assert(Math.abs(area(mesh,2)-expected[1])<1e-5);
    for(const face of mesh.faces)for(const index of face.indices){const n=mesh.normals.slice(index*3,index*3+3);assert(Math.abs(Math.hypot(...n)-1)<1e-6);if(face.material<=2)assert(n[1]>.999);else assert(Math.abs(n[1])<1e-6);}
    // Avoid triangle edges deliberately: the grid tests coverage, not a ray's
    // tie-breaking rule at two triangles sharing exactly the same edge.
    for(let x=-5.91;x<6;x+=.41)for(let z=-5.87;z<6;z+=.39){const inside=Math.abs(z)<5||Math.abs(x)<5&&(angles.length===4||z>0),hits=topHits(mesh,x,z);if(hits===null)continue;assert.equal(hits,inside?1:0,`${angles.length} legs, ${x},${z}`);}
  }
});
test('junction seams are exactly shared by trimmed streets in both directions, including rotated large coordinates and grades',()=>{
  for(const [angles,center]of [[[0,90,180,270],[0,2,0]],[[14,71,186,268],[12000.123,7.25,-12000.321]]]){
    const {file}=network(angles,center),plan=roadJunctionPlan(file,0,6,2),junction=lod(roadSurfaceModel(file,{...options,heightOffset:.125})),junctionPoints=points(junction);
    for(const leg of plan.legs){file.crossings[leg.target].position[1]+=4;file.nodes[leg.nodes[0]&32767].position[1]+=2;const forward={...options,mode:'link',slot:leg.slot,heightOffset:.125},reverse=roadConnections(file,leg.target).find(back=>back.target===0),a=lod(roadSurfaceModel(file,forward)),b=lod(roadSurfaceModel(file,{...forward,from:leg.target,slot:reverse.slot}));
      assert.deepEqual(points(a),points(b));
      for(const p of [leg.left,leg.right,leg.outerLeft,leg.outerRight])for(const height of [0,.15]){const key=[p[0],Math.fround(p[1]+.125+height),p[2]].join(',');assert(junctionPoints.has(key),key);assert(points(a).has(key),key);}
      // Only the distant end of each sidewalk is capped. The opening at the
      // junction has no vertical triangles across a pedestrian's path.
      assert.equal(a.faces[2].indices.length/3,20);
    }
  }
});
test('the assembled crossing and all trimmed links cover the street exactly once on either side of every opening',()=>{
  const {file}=network(),meshes=[lod(roadSurfaceModel(file,options)),...roadConnections(file,0).map(leg=>lod(roadSurfaceModel(file,{...options,mode:'link',slot:leg.slot})))];
  for(let x=-15.913;x<16;x+=.73)for(let z=-15.827;z<16;z+=.67){const hits=meshes.map(mesh=>topHits(mesh,x,z));if(hits.includes(null))continue;assert.equal(hits.reduce((sum,n)=>sum+n,0),Math.abs(x)<5||Math.abs(z)<5?1:0,`${x},${z}`);}
});
test('flat junction corners and curbs retain physical texture scale and serialize as editable 4DS with matching collisions',()=>{
  const {file}=network([11,83,192,281]),model=roadSurfaceModel(file,options),mesh=lod(model),native=parseFourDs(createRoadSurfaceBytes(file,options),'all');
  for(const key of ['positions','normals','uv','faces'])assert.deepEqual(lod(native)[key],mesh[key]);
  for(const face of mesh.faces)for(let at=0;at<face.indices.length;at+=3){const ids=face.indices.slice(at,at+3),scale=face.material===1?[12,6]:face.material===2?[2,2]:[.15,1];for(let i=0;i<3;i++){const a=ids[i],b=ids[(i+1)%3],distance=Math.hypot(...point(mesh,a).map((v,j)=>v-point(mesh,b)[j])),tex=Math.hypot(...scale.map((v,j)=>(mesh.uv[a*2+j]-mesh.uv[b*2+j])*v));assert(Math.abs(distance-tex)<1e-5);}}
  const object={name:'JUNCTION',frameType:9,model:'WB_JUNCTION.i3d',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]},collision=modelCollisionSurface(native,object,{objects:[object]},{meshes:[]});assert.equal(collision.degenerate,0);assert.equal(collision.indices.length/3,mesh.faces.reduce((n,f)=>n+f.indices.length/3,0));
});
test('joined roads reject overlapping junction setbacks and tight, incomplete or ambiguous junction layouts without changing the source',()=>{
  for(const angles of [[0,180],[0,10,180],[0,30,65],[0,90,180,180]]){const {file}=network(angles);assert.throws(()=>roadSurfaceModel(file,options),/Ulice/);}
  const {file,data}=network(),before=structuredClone(file);assert.throws(()=>roadSurfaceModel(file,{...options,mode:'other'}),/režim/);assert.throws(()=>roadSurfaceModel(file,{...options,joinJunctions:1}),/režim/);
  const broken=structuredClone(file);broken.crossings[1].links.fill(65535);assert.throws(()=>roadSurfaceModel(broken,options),/vzájemné/);
  const short=network([0,90,180,270],[0,0,0],4);assert.throws(()=>roadSurfaceModel(short.file,options),/blízko/);
  // Two valid individual junctions can still be too close to leave a street.
  let tight=Buffer.alloc(12);tight.writeUInt32LE(2);for(const position of [[0,0,0],[10,0,0],[0,0,30],[0,0,-30],[10,0,30],[10,0,-30]])tight=changeRoadTopology(tight,{action:'create-crossing',position,speed:10,semaphore:0}).data;for(const[from,to]of [[0,1],[0,2],[0,3],[1,4],[1,5]])tight=changeRoadTopology(tight,{action:'connect',from,to,positions:[parseRoads(tight).crossings[to].position.map((v,j)=>(v+parseRoads(tight).crossings[from].position[j])/2)],speed:10}).data;
  const t=parseRoads(tight),slot=roadConnections(t,0).find(l=>l.target===1).slot,back=roadConnections(t,1).find(l=>l.target===0).slot;t.crossings[0].links[slot]=1;t.crossings[1].links[back]=0;assert.throws(()=>roadSurfaceModel(t,{...options,mode:'link',slot}),/překrývají/);assert.deepEqual(file,before);assert.deepEqual(parseRoads(data),before);
});
function bmp(value){const b=Buffer.alloc(58);b.write('BM');b.writeUInt32LE(58,2);b.writeUInt32LE(54,10);b.writeUInt32LE(40,14);b.writeInt32LE(1,18);b.writeInt32LE(1,22);b.writeUInt16LE(1,26);b.writeUInt16LE(24,28);b.writeUInt32LE(4,34);b[54]=value;return b;}
test('junction publication guards the network/textures, exports/reopens and undoes only its own model',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-junction-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:2,name:'Junction',assets:[],history:[]}));const p=await ModProject.open(root),{file,data}=network(),source='missions/WB_JUNCTION/road.bin',textures=[bmp(100),bmp(200),bmp(80)],names=[options.roadTexture,options.sidewalkTexture,options.curbTexture];await p.createFiles([{path:source,data},...names.map((name,i)=>({path:name,data:textures[i]}))]);const history=p.manifest.history.length,hashes=textures.map(hash);
  await assert.rejects(()=>p.createRoadSurface(source,options,'stale',hashes),/silniční/);await assert.rejects(()=>p.createRoadSurface(source,options,hash(data),['stale',...hashes.slice(1)]),/textura/);assert.equal(p.manifest.history.length,history);
  const name=await p.createRoadSurface(source,options,hash(data),hashes),expected=createRoadSurfaceBytes(file,options);assert.deepEqual(await p.read(name),expected);assert.deepEqual(await p.read(source),data);assert.equal(p.manifest.history.length,history+1);const reopened=await ModProject.open(root);await reopened.export(root+'/export');assert.deepEqual(await fs.readFile(path.join(root,'export',name)),expected);await reopened.undo();assert.throws(()=>reopened.asset(name));assert.deepEqual(await reopened.read(source),data);for(let i=0;i<3;i++)assert.deepEqual(await reopened.read(names[i]),textures[i]);
});
