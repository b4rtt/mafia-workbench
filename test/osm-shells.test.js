import test from 'node:test';
import assert from 'node:assert/strict';
import {Ray,Vector3} from 'three';
import {osmShellModel,osmShellPlan,osmShellStyles} from '../src/plugins/osm/building-shells.js';
import {loadOsmShellStyles} from '../src/plugins/osm/building-shell-assets.js';
import {writeSurfaceModel} from '../src/core/surface-model.js';
import {parseFourDs} from '../src/core/fourds.js';
import {modelCollisionSurface} from '../src/core/model-collision.js';
import {hash} from '../src/core/files.js';
const outer=[[-20,-15],[20,-15],[20,15],[-20,15]],hole=[[-8,-5],[8,-5],[8,5],[-8,5]],roads={flat:true,crossings:[{position:[-99,0,-90]},{position:[99,0,-90]}],roads:[{from:0,to:1,positions:[]}]};
const options={version:1,mode:'footprint',selected:[1],styles:[{id:'brick'},{id:'shops'}],ground:.2,fallbackHeight:15};
const source=(polygons=[[outer,hole]],tags={})=>({area:{size:200},ways:[],buildings:polygons.map((polygon,i)=>({id:i+1,tags:{building:'yes',...tags},polygons:[polygon]}))});
const plan=(s=source(),o={},surface=null)=>osmShellPlan(s,roads,surface,{...options,...o});
const tris=model=>model.meshes.flatMap(m=>m.lods[0].faces.flatMap(f=>Array.from({length:f.indices.length/3},(_,i)=>({material:f.material,points:f.indices.slice(i*3,i*3+3).map(n=>m.lods[0].positions.slice(n*3,n*3+3)),uv:f.indices.slice(i*3,i*3+3).map(n=>m.lods[0].uv.slice(n*2,n*2+2))}))));
function hits(model,origin,direction){const ray=new Ray(new Vector3(...origin),new Vector3(...direction).normalize());return tris(model).flatMap(t=>{const hit=ray.intersectTriangle(...t.points.map(p=>new Vector3(...p)),true,new Vector3());return hit?[hit.toArray()]:[];});}
test('complete concave footprints and courtyard holes become native roof and outward walls without filling the courtyard',()=>{
  const input=source(),before=structuredClone(input),p=plan(input).placements[0],m=parseFourDs(writeSurfaceModel(osmShellModel(p)),'all');assert.deepEqual(input,before);assert.equal(p.coverage,1);assert.equal(p.roof,'flat');
  const roof=tris(m).filter(t=>t.material===3),area=roof.reduce((s,{points:[a,b,c]})=>s+((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]))/2,0);assert(Math.abs(area-(40*30-16*10))<1e-5);
  assert.equal(hits(m,[.1,30,.2],[0,-1,0]).length,0);assert(hits(m,[15.1,30,.2],[0,-1,0]).every(p=>p[1]===15));assert(hits(m,[15.1,30,.2],[0,-1,0]).length>0);
  assert(hits(m,[.1,5,0],[1,0,0]).some(p=>Math.abs(p[0]-8)<1e-6));assert(hits(m,[30,5,.1],[-1,0,0]).some(p=>Math.abs(p[0]-20)<1e-6));
  const concave=[[-20,-15],[20,-15],[20,15],[5,15],[5,-2],[-5,-2],[-5,15],[-20,15]],c=osmShellModel(plan(source([[concave]])).placements[0]);assert.equal(hits(c,[.1,30,5.2],[0,-1,0]).length,0);assert(hits(c,[10.1,30,5.2],[0,-1,0]).length>0);
});
test('native world placement stays on the OSM boundary, roof and courtyard collision agree with rendered geometry',()=>{
  const polygon=[outer.map(([x,z])=>[x+35,z+20]),hole.map(([x,z])=>[x+35,z+20])],p=plan(source([polygon]),{ground:1.25}).placements[0],model=parseFourDs(writeSurfaceModel(osmShellModel(p)),true),object={...p,frameType:9,model:'HOUSE.4ds'},surface=modelCollisionSurface(model,object,{objects:[object]},{meshes:[]});
  assert.equal(surface.indices.length/3,p.triangles);for(let i=0;i<surface.positions.length;i+=3){assert(surface.positions[i]>=15&&surface.positions[i]<=55);assert(surface.positions[i+2]>=5&&surface.positions[i+2]<=35);assert(surface.positions[i+1]>=1.25&&surface.positions[i+1]<=16.25);}
  const local=tris(model);for(const t of local.filter(t=>t.material===3))for(const p of t.points)assert.equal(p[1],15);
});
test('facades retain bounded metric window bays, upright V direction and deterministic style selection',()=>{
  for(const id of ['brick','shops']){const p={...plan().placements[0],style:id},m=parseFourDs(writeSurfaceModel(osmShellModel(p)),'all'),style=osmShellStyles.find(s=>s.id===id);for(const t of tris(m).filter(t=>t.material===1||t.material===2)){
    for(let i=0;i<3;i++)for(let j=i+1;j<3;j++){const a=t.points[i],b=t.points[j],uv=t.uv[i],q=t.uv[j];if(a[1]!==b[1]){assert((a[1]-b[1])*(uv[1]-q[1])<0);assert(Math.abs(Math.abs(a[1]-b[1])-Math.abs(uv[1]-q[1])*(t.material===1?style.groundHeight:style.upperHeight))<1e-4);}else{const length=Math.hypot(a[0]-b[0],a[2]-b[2]),ratio=Math.abs(uv[0]-q[0])*(t.material===1?style.groundWidth:style.width)/length;assert(ratio>=.85-1e-6&&ratio<=1.15+1e-6);}}
  }}assert.deepEqual(plan(),plan());const reverse=source([[outer.toReversed(),hole.toReversed()]]),m=osmShellModel(plan(reverse).placements[0]);assert.equal(hits(m,[.1,30,.2],[0,-1,0]).length,0);assert(hits(m,[30,5,.1],[-1,0,0]).length>0);
});
test('full footprints are excluded from streets, sidewalks, overlapping neighbours and off-area positions with explicit reasons',()=>{
  const blocked={model:{meshes:[]},footprints:{road:[[outer]],sidewalk:[]}};assert.match(plan(source(),{},blocked).skipped[0].reason,/vozovky/);blocked.footprints.sidewalk=blocked.footprints.road;blocked.footprints.road=[];assert.equal(plan(source(),{},blocked).placements.length,0);
  const p=plan(source([[outer],[outer]]),{selected:[1,2]});assert.equal(p.placements.length,1);assert.match(p.skipped[0].reason,/jiné budovy/);
  const outside=source([[outer.map(([x,z])=>[x+95,z])]]);assert.match(plan(outside).skipped[0].reason,/hranici/);
  for(const tags of [{building:'church'},{'building:part':'yes'},{min_height:'4'},{layer:'1'}])assert.equal(plan(source(undefined,tags)).placements.length,0);
  assert.equal(plan(source([[outer,hole],[hole]]),{selected:[1,2]}).placements.length,2,'a separate building can occupy a courtyard without overlapping its ring');
});
test('OSM heights and level estimates stay explicit; invalid modes, selections and unsafe geometry are rejected',()=>{
  assert.equal(plan(source(undefined,{height:'32.8 ft'})).placements[0].estimated,false);assert(Math.abs(plan(source(undefined,{height:'32.8 ft'})).placements[0].height-9.99744)<1e-6);const level=plan(source(undefined,{'building:levels':'3'})).placements[0];assert.equal(level.height,12);assert.match(level.heightSource,/odhad/);assert.equal(plan(source(undefined,{'building:levels':'99'})).placements.length,0);
  for(const o of [{mode:'other'},{styles:[]},{styles:[{id:'unknown'}]},{styles:[{id:'brick'},{id:'brick'}]},{ground:NaN},{fallbackHeight:121},{selected:[1,1]},{selected:[42]}])assert.throws(()=>plan(source(),o),/půdorys/);
  const p=plan().placements[0];for(const o of [{style:'bad'},{height:NaN},{polygon:[[[0,0],[1,1],[NaN,1]]]},{polygon:[[[0,0],[0,0],[1,1]]]}])assert.throws(()=>osmShellModel({...p,...o}),/půdorys/);
});
function bmp(){const b=Buffer.alloc(58);b.write('BM');b.writeUInt32LE(58,2);b.writeUInt32LE(54,10);b.writeUInt32LE(40,14);b.writeInt32LE(1,18);b.writeInt32LE(1,22);b.writeUInt16LE(1,26);b.writeUInt16LE(24,28);return b;}
test('style catalog validates actual project BMPs and hashes, refuses changed saved textures and reports missing assets',async()=>{
  const bytes=bmp(),project={asset:path=>({path}),read:async()=>bytes},catalog=await loadOsmShellStyles(project);assert.equal(catalog.styles.length,osmShellStyles.length);assert.equal(catalog.warnings.length,0);assert(catalog.styles.every(s=>s.textures.every(t=>t.sha256===hash(bytes))));assert.deepEqual(await loadOsmShellStyles(project,catalog.styles),catalog);
  const changed=structuredClone(catalog.styles);changed[0].textures[0].sha256='0'.repeat(64);await assert.rejects(loadOsmShellStyles(project,changed),/změnily/);await assert.rejects(loadOsmShellStyles(project,[{id:'bad'}]),/neplatné/);
  const absent=await loadOsmShellStyles({asset:()=>{throw Error('missing');}});assert.equal(absent.styles.length,0);assert.equal(absent.warnings.length,osmShellStyles.length);await assert.rejects(loadOsmShellStyles(project,[{id:'brick',textures:[]}]),/změnily/);
});
test('many small houses respect the import and shared native collision budgets without partially generating a house',()=>{
  const polygons=Array.from({length:65},(_,i)=>{const x=-55+i%9*12,z=-55+Math.floor(i/9)*12;return [[[x,z],[x+5,z],[x+5,z+5],[x,z+5]]];}),input=source(polygons),result=plan(input,{selected:input.buildings.map(b=>b.id)});assert.equal(result.placements.length,64);assert.match(result.skipped[0].reason,/64/);
  const dense={model:{meshes:[{lods:[{positions:Array.from({length:59970*3},(_,i)=>i%3===0?Math.floor(i/3)*.001:0)}]}]},footprints:{road:[],sidewalk:[]}},blocked=plan(source(),{},dense);assert.equal(blocked.placements.length,0);assert.match(blocked.skipped[0].reason,/vrcholů/);
});
test('all curated facade styles generate distinct native materials with matching collision and deterministic saved selection',async()=>{
  const upper=new Set();
  for(const style of osmShellStyles){
    const options={styles:[{id:style.id}]},first=plan(source(),options),second=plan(source(),JSON.parse(JSON.stringify(options)));assert.deepEqual(first,second);
    const item=first.placements[0],bytes=writeSurfaceModel(osmShellModel(item)),model=parseFourDs(bytes,'all');
    assert.deepEqual(model.materials.map(m=>'maps/'+m.texture),style.textures);assert.equal(model.meshes[0].lods[0].faces.reduce((n,f)=>n+f.indices.length/3,0),item.triangles);
    assert(hits(model,[30,5,.1],[-1,0,0]).length>0);assert.equal(hits(model,[.1,30,.2],[0,-1,0]).length,0);
    assert(model.meshes[0].lods[0].uv.every(Number.isFinite));upper.add(style.textures[1]);assert.match(style.source,/\.4ds$/);
  }
  assert.equal(upper.size,osmShellStyles.length);
  const project={asset:path=>({path}),read:async()=>bmp()},legacy=await loadOsmShellStyles(project,(await loadOsmShellStyles(project)).styles.slice(0,2));assert.deepEqual(legacy.styles.map(s=>s.id),['brick','shops']);
  const unavailable=await loadOsmShellStyles({...project,asset:path=>{if(path==='maps/%HOFAS.BMP')throw Error('missing facade');return{path};}});assert.equal(unavailable.styles.length,osmShellStyles.length-1);assert.equal(unavailable.warnings.length,1);assert.match(unavailable.warnings[0],/Červenohnědá/);
});

for(const count of [24,30])test(`saved ${count}-style catalogues stay usable without the newly curated texture files`,async()=>{
  const bytes=bmp(),complete={asset:path=>({path}),read:async()=>bytes},saved=(await loadOsmShellStyles(complete)).styles.slice(0,count),oldPaths=new Set(saved.flatMap(s=>s.textures.map(t=>t.path))),read=[];
  const oldProject={asset:path=>{assert(oldPaths.has(path),'legacy selection requested a new texture');return{path};},read:async path=>{read.push(path);return bytes;}};
  const restored=await loadOsmShellStyles(oldProject,saved);assert.deepEqual(restored,{styles:saved,warnings:[]});assert.equal(read.length,count*4);
  const input=source(),selected=input.buildings.map(b=>b.id),options={version:1,mode:'footprint',selected,styles:saved,fallbackHeight:15,ground:.2,facade:{version:1}};
  assert.deepEqual(plan(input,options),plan(input,{...options,styles:restored.styles}));
});
