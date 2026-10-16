import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {osmSurfaceModel,osmSurfaceDefaults} from '../src/plugins/osm/surface.js';
import {writeSurfaceModel} from '../src/core/surface-model.js';
import {parseFourDs} from '../src/core/fourds.js';
import {changeSceneObject,inspectScene} from '../src/core/scene.js';
import {modelCollisionSurface} from '../src/core/model-collision.js';
import {replaceCollisionSurfaces} from '../src/core/collision-surfaces.js';
import {parseCollision} from '../src/core/collision.js';
import {collisionOwnership,surfaceSignature} from '../src/core/scene-collision.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';
import {collisionFixture} from './fixtures/collision.js';
const options={...osmSurfaceDefaults},area={size:200};
function plan(points,links){return {flat:true,crossings:points.map(position=>({position})),roads:links.map(([from,to])=>({from,to,positions:[]}))};}
const straight=()=>plan([[-40,0,0],[40,0,0]],[[0,1]]);
const triangles=model=>model.meshes.flatMap(m=>m.lods[0].faces.flatMap(f=>Array.from({length:f.indices.length/3},(_,i)=>({material:f.material,points:f.indices.slice(i*3,i*3+3).map(v=>m.lods[0].positions.slice(v*3,v*3+3)),uv:f.indices.slice(i*3,i*3+3).map(v=>m.lods[0].uv.slice(v*2,v*2+2))}))));
function surfaceArea(model,material){return triangles(model).filter(t=>t.material===material).reduce((sum,{points:[a,b,c]})=>sum+Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))/2,0);}
function hits(model,x,z){return triangles(model).filter(t=>t.material<3).filter(({points:[a,b,c]})=>{const cross=(p,q)=>(q[0]-p[0])*(z-p[2])-(q[2]-p[2])*(x-p[0]),signs=[cross(a,b),cross(b,c),cross(c,a)];return signs.every(v=>v>1e-7)||signs.every(v=>v< -1e-7);}).length;}
test('OSM buffered streets retain metric UV, upward tops, separate raised sidewalks and native editable geometry',()=>{
  const result=osmSurfaceModel(straight(),area,options),native=parseFourDs(writeSurfaceModel(result.model),'all');assert.equal(triangles(native).length,result.triangles);
  const disk=r=>12*Math.sin(Math.PI/12)*r*r;assert.ok(Math.abs(surfaceArea(native,1)-(80*6+disk(3)))<.02);assert.ok(Math.abs(surfaceArea(native,2)-(80*4+disk(5)-disk(3)))<.03);
  for(const t of triangles(native)){if(t.material===3)continue;assert(t.points.every(p=>Math.abs(p[1]-(t.material===1?.05:.2))<1e-7));for(let i=0;i<3;i++){const j=(i+1)%3,scale=t.material===1?4:2;assert.ok(Math.abs(Math.hypot(...t.points[i].map((v,k)=>v-t.points[j][k]))-scale*Math.hypot(...t.uv[i].map((v,k)=>v-t.uv[j][k])))<1e-5);}}
  for(const m of native.meshes)for(const f of m.lods[0].faces)for(const i of f.indices)if(f.material<3)assert(m.lods[0].normals[i*3+1]>.999);
});
test('whole-network unions join short/acute junctions and way boundaries without layered overlapping tops',()=>{
  const input=plan([[-60,0,0],[0,0,0],[60,0,0],[3,0,1],[40,0,45],[0,0,-60]],[[0,1],[1,2],[1,3],[3,4],[1,5]]),before=structuredClone(input),{model}=osmSurfaceModel(input,area,options);
  for(let x=-65.413;x<66;x+=2.31)for(let z=-65.179;z<66;z+=2.17)assert(hits(model,x,z)<=1,`${x}/${z}`);
  for(const [x,z]of [[-1.123,.427],[1.123,.427],[2.123,.427],[4.123,1.427],[-20.123,4.427]])assert.equal(hits(model,x,z),1);
  assert.deepEqual(input,before);const split=plan([[-40,0,0],[0,0,0],[40,0,0]],[[0,1],[1,2]]);for(const material of [1,2])assert.ok(Math.abs(surfaceArea(osmSurfaceModel(split,area,options).model,material)-surfaceArea(osmSurfaceModel(straight(),area,options).model,material))<.01);
});
test('closed city blocks keep courtyard holes, disconnected streets stay separate and boundary clipping is exact',()=>{
  const ring=plan([[-25,0,-25],[25,0,-25],[25,0,25],[-25,0,25]],[[0,1],[1,2],[2,3],[3,0]]),{model}=osmSurfaceModel(ring,area,options);assert.equal(hits(model,.123,.456),0);assert.equal(hits(model,24.123,4.456),1);assert.equal(hits(model,29.123,4.456),1);
  const separate=osmSurfaceModel(plan([[-80,0,-30],[80,0,-30],[-80,0,30],[80,0,30]],[[0,1],[2,3]]),area,options);assert.equal(separate.footprints.road.length,2);assert.equal(hits(separate.model,.123,.456),0);
  const clipped=osmSurfaceModel(straight(),{size:50},options);for(const m of clipped.model.meshes)assert(m.lods[0].positions.every((n,i)=>i%3===1||Math.abs(n)<=25));
});
test('OSM surfaces reject unsupported geometry and settings before publishing anything',()=>{
  for(const key of ['width','sidewalkWidth','curbHeight','tileSize','sidewalkTileSize'])for(const value of [0,NaN,'6'])assert.throws(()=>osmSurfaceModel(straight(),area,{...options,[key]:value}),/rozměr/);
  for(const roadTexture of ['maps/../bad.bmp','https://example.com/x.bmp','maps/č.bmp'])assert.throws(()=>osmSurfaceModel(straight(),area,{...options,roadTexture}),/BMP/);
  assert.throws(()=>osmSurfaceModel({...straight(),flat:false},area,options),/rovinná/);const elevated=straight();elevated.crossings[0].position[1]=1;assert.throws(()=>osmSurfaceModel(elevated,area,options),/souřadnice/);
});
const chunk=(type,data)=>{const h=Buffer.alloc(6);h.writeUInt16LE(type);h.writeUInt32LE(data.length+6,2);return Buffer.concat([h,data]);};
test('new mission surface ownership is atomic, survives export/reopen, and follows later movement/deletion with undo',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-osm-surface-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'OSM test',assets:[],history:[]}));const p=await ModProject.open(root),generated=osmSurfaceModel(straight(),area,options),model=writeSurfaceModel(generated.model),geometry=Buffer.alloc(19);geometry.write('4DS\0');geometry.writeUInt16LE(29,4);
  const scene=changeSceneObject(chunk(0x4c53,chunk(0x4000,Buffer.alloc(0))),{kind:'add-model',name:'OSM_STREETS',model:'STREETS.i3d',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]}),objects=inspectScene(scene),collision={...modelCollisionSurface(parseFourDs(model,true),objects.objects[0],objects,{meshes:[]}),doubleSided:false},replacement=replaceCollisionSurfaces(collisionFixture(),[collision]),parsed=parseCollision(replacement.bytes),scenePath='missions/OSM/scene2.bin',klzPath='missions/OSM/tree.klz',ownership={path:scenePath,objects:replacement.groups.map(g=>({...g,kind:'mesh',signature:surfaceSignature(parsed,g)}))},files=[{path:scenePath,data:scene},{path:klzPath,data:replacement.bytes},{path:'missions/OSM/scene.4ds',data:geometry},{path:'models/STREETS.4ds',data:model}];
  await assert.rejects(p.createFiles(files,'Bad',[],'OSM',{...ownership,objects:[{...ownership.objects[0],signature:'0'.repeat(64)}]}),/mimo editor/);assert.equal(p.manifest.assets.length,0);assert.equal(p.manifest.history.length,0);
  await p.createFiles(files,'OSM',[],'OSM',ownership);assert.equal(p.manifest.history.length,1);assert.deepEqual(collisionOwnership(p.manifest,scenePath),ownership.objects);
  const reopened=await ModProject.open(root),map=await reopened.inspectMap(scenePath);assert.equal(map.collision.warning,undefined);const old=map.collision.surfaces[0].positions;await reopened.saveScene(scenePath,[{id:map.objects[0].fields.position,value:[1,2,3]}],map.sha256);const moved=await reopened.inspectMap(scenePath);assert.deepEqual(moved.collision.surfaces[0].positions,old.map((n,i)=>Math.fround(n+[1,2,3][i%3])));
  await reopened.export(root+'/export');assert.deepEqual(await fs.readFile(root+'/export/'+klzPath),await reopened.read(klzPath));await reopened.changeSceneObject(scenePath,{kind:'delete',id:moved.objects[0].id},moved.sha256);assert.equal(collisionOwnership(reopened.manifest,scenePath).length,0);assert.equal(parseCollision(await reopened.read(klzPath)).primitives.triangles.count,1);
  await reopened.undo();await reopened.undo();assert.deepEqual(await reopened.read(klzPath),replacement.bytes);assert.deepEqual(await reopened.read(scenePath),scene);await reopened.undo();assert.equal(reopened.manifest.assets.length,0);assert.equal(reopened.manifest.history.length,0);
});
