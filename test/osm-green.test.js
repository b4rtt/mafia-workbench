import test from 'node:test';
import assert from 'node:assert/strict';
import {Ray,Vector3} from 'three';
import {osmSource} from '../src/plugins/osm/area.js';
import {osmGreenDefaults,osmGreenPlan,osmGreenModel,osmGreenReservation,validateOsmGreenOptions} from '../src/plugins/osm/green-areas.js';
import {loadOsmGreenTextures} from '../src/plugins/osm/green-assets.js';
import {writeSurfaceModel} from '../src/core/surface-model.js';
import {parseFourDs} from '../src/core/fourds.js';
import {modelCollisionSurface} from '../src/core/model-collision.js';
import {osmQuery} from '../src/plugins/osm/download.js';
const region={latitude:50,longitude:14,size:200},rad=Math.PI/180,earth=6371008.8;
const node=(id,x,z)=>({type:'node',id,lat:50+z/earth/rad,lon:14+x/earth/rad/Math.cos(50*rad)});
function fixture(){const elements=[];let id=0;const ring=points=>{const ids=points.map(([x,z])=>{elements.push(node(++id,x,z));return id;});return [...ids,ids[0]];};const a=ring([[-20,-20],[20,-20],[20,20],[-20,20]]),b=ring([[-5,-5],[5,-5],[5,5],[-5,5]]);elements.push({type:'way',id:100,nodes:a,tags:{landuse:'grass'}},{type:'way',id:101,nodes:b},{type:'relation',id:200,members:[{type:'way',ref:101,role:'inner'},{type:'way',ref:100,role:'outer'}],tags:{type:'multipolygon',landuse:'grass',name:'Courtyard lawn'}});return {elements};}
const basic=(polygons=[[[[-20,-20],[20,-20],[20,20],[-20,20]]]],tags={})=>({area:{size:200},ways:[],buildings:[],greenAreas:[{id:1,kind:'grass',tags,polygons}]});
const plan=(source=basic(),o={},surface=null,reserve=0)=>osmGreenPlan(source,surface,{...osmGreenDefaults,selected:source.greenAreas.filter(g=>!g.suppressed).map(g=>g.id),...o},reserve);
const tris=model=>model.meshes.flatMap(m=>m.lods[0].faces.flatMap(f=>Array.from({length:f.indices.length/3},(_,i)=>({material:f.material,points:f.indices.slice(i*3,i*3+3).map(n=>m.lods[0].positions.slice(n*3,n*3+3)),uv:f.indices.slice(i*3,i*3+3).map(n=>m.lods[0].uv.slice(n*2,n*2+2))}))));
const area=triangles=>triangles.reduce((s,{points:[a,b,c]})=>s+((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]))/2,0);
const hits=(m,x,z)=>tris(m).flatMap(t=>{const hit=new Ray(new Vector3(x,1,z),new Vector3(0,-1,0)).intersectTriangle(...t.points.map(p=>new Vector3(...p)),true,new Vector3());return hit?[{material:t.material,point:hit.toArray()}]:[];});
test('OSM green ways and full multipolygons retain holes, canonical IDs and tags without duplicating members',()=>{
  const data=fixture(),before=structuredClone(data),source=osmSource(data,region);assert.deepEqual(data,before);assert(source.greenAreas.find(g=>g.id===100).suppressed);const f=source.greenAreas.find(g=>g.relation===200);assert.equal(f.polygons[0].length,2);assert.equal(f.tags.name,'Courtyard lawn');
  const m=parseFourDs(writeSurfaceModel(osmGreenModel(plan(source).placements[0])),true);assert(Math.abs(area(tris(m))-1500)<.01);assert.equal(hits(m,.123,.456).length,0);assert(hits(m,10.123,.456).length>0);
  const reversed=structuredClone(data);reversed.elements.reverse();for(const r of reversed.elements){r.nodes?.reverse();r.members?.reverse();}assert.deepEqual(osmSource(reversed,region).greenAreas.find(g=>g.relation===200),f);
  assert.match(osmQuery(region),/nwr\["landuse"/);assert.match(osmQuery(region),/nwr\["leisure"/);
});
test('missing, untagged, open and invalid green relations never fall back to filling outer member ways',()=>{
  for(const change of [d=>d.elements=d.elements.filter(r=>!(r.type==='way'&&r.id===101)),d=>{delete d.elements.at(-1).tags.landuse;},d=>{d.elements.at(-1).members[0].ref=100;},d=>{d.elements.find(r=>r.id===100&&r.type==='way').nodes.pop();}]){const data=fixture();change(data);const source=osmSource(data,region),rel=source.greenAreas.find(g=>g.relation);assert(rel.reason);assert(source.greenAreas.find(g=>g.id===100).suppressed);assert.equal(plan(source).placements.length,0);}
  const invalid=fixture();invalid.elements.at(-1).tags.name='x'.repeat(1025);assert.match(osmSource(invalid,region).greenAreas.find(f=>f.relation).reason,/značka/);
});
test('green surfaces clip area boundaries, streets, raised sidewalks, buildings and overlap while preserving holes',()=>{
  const source=basic([[[[-120,-120],[120,-120],[120,120],[-120,120]]]]),road=[[[-100,-2],[100,-2],[100,2],[-100,2]]],sidewalk=[[[-100,2],[100,2],[100,4],[-100,4]]];source.buildings=[{id:4,tags:{building:'yes'},polygons:[[[[-20,10],[20,10],[20,40],[-20,40]],[[-5,20],[5,20],[5,30],[-5,30]]]]}];source.greenAreas.push({...source.greenAreas[0],id:2});const surface={model:{meshes:[]},footprints:{road:[road],sidewalk:[sidewalk]}},result=plan(source,{},surface),model=osmGreenModel(result.placements[0]);
  assert.equal(result.placements.length,1);assert.match(result.skipped[0].reason,/ořezu/);assert(Math.abs(area(tris(model))-(40000-1200-1100))<.01);assert.equal(hits(model,10.12,1.34).length,0);assert.equal(hits(model,10.12,3.34).length,0);assert.equal(hits(model,10.12,21.34).length,0);assert(hits(model,.12,25.34).length>0,'courtyard stays usable');for(const t of tris(model))assert(t.points.every(p=>Math.abs(p[0])<=100&&Math.abs(p[2])<=100));assert.deepEqual(plan(source,{selected:[2,1]},surface),result);
});
test('mapped footpaths have separate non-overlapping paving with metric UV, native upward faces and matching collisions',()=>{
  const source=basic();source.ways=[{id:50,tags:{highway:'footway',width:'6 ft'},points:[[-30,0,0],[0,0,0],[30,0,0]]},{id:51,tags:{highway:'path',bridge:'yes'},points:[[0,0,-30],[0,0,30]]},{id:52,tags:{highway:'path',width:'bad'},points:[[-30,0,10],[30,0,10]]}];const result=plan(source),item=result.placements[0],model=parseFourDs(writeSurfaceModel(osmGreenModel(item)),'all'),ts=tris(model);assert.equal(ts.length,item.triangles);assert.equal(hits(model,10.12,.134)[0].material,2);assert.equal(hits(model,.12,-10.134)[0].material,1);assert.equal(hits(model,10.12,10.134)[0].material,2);assert(Math.abs(result.pathProfiles[0].width-1.8288)<1e-8);assert(result.pathProfiles[1].skipped);assert.match(result.pathProfiles[2].note,/náhradní/);assert(Math.abs(area(ts)-1600)<.01);
  for(const t of ts)for(let i=0;i<3;i++){const j=(i+1)%3;assert(Math.abs(Math.hypot(...t.points[i].map((n,k)=>n-t.points[j][k]))-(t.material===1?4:2)*Math.hypot(...t.uv[i].map((n,k)=>n-t.uv[j][k])))<1e-5);}
  const object={name:'GREEN',frameType:9,model:'green.4ds',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]},c=modelCollisionSurface(model,object,{objects:[object]},{meshes:[]});assert.equal(c.indices.length/3,item.triangles);assert(c.positions.every((n,i)=>i%3!==1||Math.abs(n-.03)<1e-7));
  for(let x=-19.734;x<20;x+=1.637)for(let z=-19.137;z<20;z+=1.453)assert.equal(hits(model,x,z).length,1,'each point belongs to exactly one top surface');
});
test('dense intersecting path strips remain closed at millimetre precision and deterministic',()=>{
  const source=basic();source.ways=Array.from({length:30},(_,i)=>({id:i+100,tags:{highway:'path'},points:Array.from({length:12},(_,j)=>[-28+j*5,0,-24+i*1.7+Math.sin(j*.731+i)*.31])}));const result=plan(source);assert(result.placements[0].triangles>50);assert(Math.abs(area(tris(osmGreenModel(result.placements[0])))-1600)<.03);assert.deepEqual(plan(source),result);
});
test('park lawn is explicitly opt-in, conflicting surfaces are skipped and native budgets fail without partial areas',()=>{
  const source=basic();source.greenAreas[0].kind='park';assert.equal(plan(source).placements.length,0);assert.match(plan(source).skipped[0].reason,/odhad/);assert.equal(plan(source,{approximateParks:true}).placements.length,1);assert.match(plan(source,{approximateParks:true}).placements[0].notes[0],/odhad/);
  for(const tags of [{surface:'asphalt'},{layer:'1'},{bridge:'yes'}])assert.equal(plan(basic(undefined,tags)).placements.length,0);
  assert.equal(plan(basic(),{},null,60000).placements.length,0);assert.equal(osmGreenReservation(null,null),0);
  for(const o of [{height:0},{height:.05},{pathWidth:9},{tileSize:NaN},{pathTexture:'maps/../bad.bmp'},{approximateParks:1},{selected:[]},{selected:[1,1]},{selected:[999]}])assert.throws(()=>plan(basic(),o),/zeleň/);assert.throws(()=>validateOsmGreenOptions({...osmGreenDefaults,selected:[1],textures:[{path:'bad',sha256:'bad'}]}),/textury/);
  assert.deepEqual(osmSource({elements:[]},region).greenAreas,[],'old sources without greenery stay loadable');
});
function bmp(){const b=Buffer.alloc(58);b.write('BM');b.writeUInt32LE(58,2);b.writeUInt32LE(54,10);b.writeUInt32LE(40,14);b.writeInt32LE(1,18);b.writeInt32LE(1,22);b.writeUInt16LE(1,26);b.writeUInt16LE(24,28);return b;}
test('selected greenery BMPs are decoded and saved hashes reject changed textures before mission writes',async()=>{
  const options={...osmGreenDefaults,selected:[1]},project={asset:path=>({path}),read:async()=>bmp()},textures=await loadOsmGreenTextures(project,options);assert.equal(textures.length,2);assert.deepEqual(await loadOsmGreenTextures(project,{...options,textures}),textures);const changed=structuredClone(textures);changed[0].sha256='0'.repeat(64);await assert.rejects(loadOsmGreenTextures(project,{...options,textures:changed}),/změnily/);await assert.rejects(loadOsmGreenTextures({...project,read:async()=>Buffer.from('bad')},options),/BMP/);
});
test('a city creation above 64 files remains one bounded transaction with export, reopen, undo and rollback',async t=>{
  const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{ModProject}=await import('../src/core/project.js'),{writeSafe}=await import('../src/core/files.js'),root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-osm-green-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Green audit',assets:[],history:[]}));const p=await ModProject.open(root),files=Array.from({length:139},(_,i)=>({path:`models/generated_${i}.txt`,data:Buffer.from(`model ${i}`)}));
  await assert.rejects(p.createFiles(Array.from({length:161},(_,i)=>({path:`models/too_many_${i}.txt`,data:Buffer.from('x')}))),/Neplatné nové/);assert.equal(p.manifest.assets.length,0);
  const save=p.saveManifest.bind(p);p.saveManifest=async()=>{throw Error('publication failure');};await assert.rejects(p.createFiles(files),/publication failure/);assert.equal(p.manifest.history.length,0);assert.equal(p.manifest.assets.length,0);p.saveManifest=save;
  await p.createFiles(files,'OSM city');assert.equal(p.manifest.history.length,1);assert.equal(p.manifest.assets.length,139);const reopened=await ModProject.open(root);await reopened.export(root+'/export');for(const file of files)assert.deepEqual(await fs.readFile(root+'/export/'+file.path),file.data);
  await reopened.changeBatch(files.map(f=>({...f,data:Buffer.concat([f.data,Buffer.from(' edited')])})),'City edit');assert.equal(reopened.manifest.history.at(-1).files.length,139);await reopened.undo();for(const f of files)assert.deepEqual(await reopened.read(f.path),f.data);
  const saveUndo=reopened.saveManifest.bind(reopened);reopened.saveManifest=async()=>{throw Error('undo failure');};await assert.rejects(reopened.undo(),/undo failure/);assert.equal(reopened.manifest.history.length,1);assert.equal(reopened.manifest.assets.length,139);for(const file of files)assert.deepEqual(await reopened.read(file.path),file.data);reopened.saveManifest=saveUndo;
  await reopened.undo();assert.equal(reopened.manifest.history.length,0);assert.equal(reopened.manifest.assets.length,0);assert.equal((await ModProject.open(root)).manifest.assets.length,0);
});
