import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prepareModelImport } from '../src/core/model-import.js';
import { parseFourDs } from '../src/core/fourds.js';
import { ModProject } from '../src/core/project.js';
import { geometryNormals } from '../src/shared/geometry-draft.js';
import { modelCollisionSurface } from '../src/core/model-collision.js';
import { materialTransparency } from '../src/ui/materials.js';

const file=(name,data)=>({name,data:Buffer.from(data)}),obj=text=>file('Building.obj',text),mtl=text=>file('building.mtl',text);
const triangle='v 0 0 0\nv 2 0 0\nv 0 2 0\nf 1 2 3';
const model=(files,options)=>parseFourDs(prepareModelImport(files,undefined,options).files[0].data,'all');
const near=(a,b)=>{assert.equal(a.length,b.length);a.forEach((v,i)=>assert(Math.abs(v-b[i])<1e-6,`${v} != ${b[i]}`));};
const expected=p=>({path:p.path,files:p.expected,sourceHash:p.sourceHash});
function bmp(value=255){const b=Buffer.alloc(58);b.write('BM');b.writeUInt32LE(58,2);b.writeUInt32LE(54,10);b.writeUInt32LE(40,14);b.writeInt32LE(1,18);b.writeInt32LE(1,22);b.writeUInt16LE(1,26);b.writeUInt16LE(24,28);b.fill(value,54);return b;}
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-obj-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(root+'/workbench.json',JSON.stringify({format:'mafia-workbench',version:2,name:'OBJ',assets:[],history:[]}));return{root,p:await ModProject.open(root)};}
const textured=()=>[obj('mtllib building.mtl\nv 0 0 0\nv 2 0 0\nv 0 2 0\nvt 0 0\nvt 1 0\nvt 0 1\nusemtl Wall\nf 1/1 2/2 3/3'),mtl('newmtl Wall\nKa .5 .5 .5\nKd 1 .5 .25\nmap_Kd Wall.bmp'),file('Wall.bmp',bmp())];

test('OBJ converts handedness, normals, UV and Y/Z-up units with consistent one-sided winding',()=>{
  for(const options of [{up:'y',scale:1},{up:'z',scale:.25}]){
    const result=model(textured(),options),lod=result.meshes[0].lods[0];near(lod.normals,geometryNormals(lod.positions,lod.faces));
    near(lod.uv,[0,1,1,1,0,0]);near(lod.positions,options.up==='y'?[0,0,0,2,0,0,0,2,0]:[0,0,0,.5,0,0,0,0,.5]);
    near(result.materials[0].diffuse,[1,.5,.25]);assert.equal(result.materials[0].texture,'Wall.bmp');assert.equal(prepareModelImport(textured()).target,'models/Building.4ds');
  }
  const explicit=model([obj('v 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 2\nf 1//1 2//1 3//1')]);near(explicit.meshes[0].lods[0].normals,[0,0,-1,0,0,-1,0,0,-1]);
});
test('concave polygons triangulate without filling the notch, support relative indices and logical line continuation',()=>{
  const data=model([obj('o Concave\nv 0 0 0\nv 3 0 0\nv 3 3 0\nv 1.5 1 0\nv 0 3 0\nf -5 -4 \\\n-3 -2 -1 # comment')]),lod=data.meshes[0].lods[0];
  assert.equal(lod.faces[0].indices.length,9);assert.equal(lod.vertices,5);let area=0;
  for(let i=0;i<9;i+=3){const [a,b,c]=lod.faces[0].indices.slice(i,i+3).map(v=>lod.positions.slice(v*3,v*3+3));area+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;const center=[(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3];assert(center[1]<=1||center[0]<=1.5*(3-center[1])/2||center[0]>=3-1.5*(3-center[1])/2);}
  assert.equal(area,6);near(lod.normals,geometryNormals(lod.positions,lod.faces));
});
test('hard edges split vertices, smoothing is area weighted across UV seams and authored normals take precedence',()=>{
  const base='v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nvt 0 0\nvt 1 1\n';
  const hard=model([obj(base+'s off\nf 1 2 3\nf 1 4 2')]).meshes[0].lods[0];assert.equal(hard.vertices,6);
  const smooth=model([obj(base+'s 2\nf 1/1 2/1 3/1\nf 1/2 4/2 2/2')]).meshes[0].lods[0];assert.equal(smooth.vertices,6);
  const shared=[];for(let i=0;i<smooth.vertices;i++)if(smooth.positions.slice(i*3,i*3+3).every(v=>v===0))shared.push(smooth.normals.slice(i*3,i*3+3));assert.equal(shared.length,2);for(const n of shared)near(n,[0,Math.SQRT1_2,-Math.SQRT1_2]);
  const authored=model([obj(base+'vn 1 0 0\ns 1\nf 1//1 2//1 3//1\nf 1 4 2')]).meshes[0].lods[0];near(authored.normals.slice(0,9),[1,0,0,1,0,0,1,0,0]);
  const groups=model([obj(base+'s 1\ng Front\nf 1 2 3\ng Side\nf 1 4 2')]).meshes;assert.equal(groups.length,2);for(const group of groups)near(group.lods[0].normals.slice(0,3),[0,Math.SQRT1_2,-Math.SQRT1_2]);
  const aliases=model([obj(base+'s 01\nf 1 2 3\ns 1\nf 1 4 2')]).meshes[0].lods[0];assert.equal(aliases.vertices,4);near(aliases.normals.slice(0,3),[0,Math.SQRT1_2,-Math.SQRT1_2]);assert.equal(model([obj(base+'s 00\nf 1 2 3\nf 1 4 2')]).meshes[0].lods[0].vertices,6);
});
test('objects, groups, material order, constant opacity and explicit alpha masks survive native parsing',()=>{
  const files=textured();files[0]=obj(files[0].data.toString()+'\no Second\ng Roof\nusemtl Glass\nf 1/1 2/2 3/3\nusemtl Tint\nf 1/1 2/2 3/3');files[1]=mtl(files[1].data.toString()+'\nnewmtl Glass\nmap_Kd Wall.bmp\nmap_d Mask.bmp\nnewmtl Tint\nd .25\nmap_Kd Wall.bmp\nKs 0 0 0\nNs 10');files.push(file('Mask.bmp',bmp(128)));
  const prepared=prepareModelImport(files),data=parseFourDs(prepared.files[0].data,'all');assert.equal(data.meshes.length,2);assert.equal(data.meshes[1].name,'Second_Roof');assert.deepEqual(data.meshes[1].lods[0].faces.map(f=>f.material),[2,3]);assert.equal(data.materials[1].alphaTexture,'Mask.bmp');assert.equal(materialTransparency(data.materials[1]).alphaTexture,'Mask.bmp');assert.equal(data.materials[2].opacity,.25);assert.equal(materialTransparency(data.materials[2]).alphaTexture,null);assert.equal(prepared.summary.warnings.length,1);
});
test('missing libraries block publication, explicit paths flatten safely and ambiguous material or unsupported effects reject',async t=>{
  const {p}=await fixture(t),files=textured();let plan=await p.previewModelImport([files[0]]);assert.match(plan.blocked.join(' '),/knihovna/);await assert.rejects(()=>p.importModel([files[0]],undefined,expected(plan)),/knihovna/);assert.equal(p.manifest.history.length,0);
  files[0]=obj(files[0].data.toString().replace('building.mtl','"materials/building.mtl"'));files[1]=mtl(files[1].data.toString().replace('Wall.bmp','textures/Wall.bmp'));plan=await p.previewModelImport(files);assert.equal(plan.blocked.length,0);assert.equal(plan.warnings.length,2);
  for(const map of ['../Wall.bmp','/tmp/Wall.bmp','C:\\Wall.bmp','wall.png','-s 2 2 1 Wall.bmp']){const bad=[...files];bad[1]=mtl('newmtl Wall\nmap_Kd '+map);assert.throws(()=>prepareModelImport(bad),/cesta|závislost|volby/);}
  for(const extra of ['\nbump Wall.bmp','\nd .2\nTr .3','\nmap_d -clamp on Mask.bmp','\nmap_Kd -clamp on Wall.bmp','\nnewmtl Wall']){const bad=[...files];bad[1]=mtl(files[1].data.toString()+extra);assert.throws(()=>prepareModelImport(bad),/nepodporovaná|rozporné|shodné|opakovan[ýá]/);}
  const undefinedMaterial=[...files];undefinedMaterial[1]=mtl('newmtl Other');assert.throws(()=>prepareModelImport(undefinedMaterial),/není definovaný/);
});
test('unsafe geometry, malformed references, unsupported data and coordinate collapse fail before creating files',()=>{
  const bad=['v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 3 2 4','v 0 0 0\nv 1 0 0\nv 1 1 1\nv 0 1 0\nf 1 2 3 4',triangle.replace('1 2 3','0 2 3'),triangle.replace('1 2 3','-4 2 3'),triangle.replace('1 2 3','1/ 2 3'),triangle.replace('1 2 3','1 2 2'),triangle+'\nl 1 2',triangle+'\ncurv 0 1 1 2',triangle.replace('v 0 0 0','v 0 0 0 1 0 0'),triangle+'\nvn 0 0 0',triangle.replace('v 2 0 0','v NaN 0 0'),triangle+'\nmtllib ../../secret.mtl',triangle+'\nusemtl Unknown\nf 1 2 3',triangle.replace('v 0 0 0','v 1e20 1e20 0').replace('v 2 0 0','v 1.000000001e20 1e20 0').replace('v 0 2 0','v 1e20 1.000000001e20 0')];
  for(const text of bad)assert.throws(()=>prepareModelImport([obj(text)]),/OBJ\/MTL/);
  for(const options of [{up:'x'},{scale:0},{scale:-1},{scale:Infinity},{scale:'2'},{extra:true}])assert.throws(()=>prepareModelImport([obj(triangle)],undefined,options),/OBJ\/MTL/);
  for(const text of [triangle+'\ns 9007199254740992',triangle+'\no '+('a'.repeat(256)),triangle+'\nf '+Array(1025).fill('1').join(' ')])assert.throws(()=>prepareModelImport([obj(text)]),/OBJ\/MTL/);
  const noUV=textured();noUV[0]=obj(noUV[0].data.toString().replace('1/1 2/2 3/3','1 2 3'));assert.throws(()=>prepareModelImport(noUV),/UV/);
});
test('native vertex, face and material-group limits split new standard visuals without losing triangles',()=>{
  let result=model([obj('v 0 0 0\nv 1 0 0\nv 0 1 0\n'+Array(21846).fill('f 1 2 3').join('\n'))]);assert.equal(result.meshes.length,2);assert.deepEqual(result.meshes.map(m=>m.lods[0].vertices),[65535,3]);
  result=model([obj('mtllib building.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\ns 1\n'+Array.from({length:256},(_,i)=>`usemtl ${i%2?'B':'A'}\nf 1 2 3`).join('\n')),mtl('newmtl A\nnewmtl B')]);assert.equal(result.meshes.length,2);assert.deepEqual(result.meshes.map(m=>m.lods[0].faces.length),[255,1]);
  result=model([obj('v 0 0 0\nv 1 0 0\nv 0 1 0\ns 1\n'+Array(65536).fill('f 1 2 3').join('\n'))]);assert.equal(result.meshes.length,1);assert.deepEqual(result.meshes[0].lods[0].faces.map(f=>f.indices.length/3),[65535,1]);
});
test('OBJ project publication is atomic, guards source/options/textures, exports/reopens and undoes all files',async t=>{
  const {p,root}=await fixture(t),files=textured(),before=JSON.stringify(p.manifest),inputs=files.map(f=>Buffer.from(f.data)),plan=await p.previewModelImport(files,'Own.4ds',{up:'z',scale:2});
  await assert.rejects(()=>p.importModel(files,'Own.4ds',expected(plan),{up:'y',scale:2}),/od náhledu/);
  const changed=[...files];changed[0]=obj(files[0].data.toString()+'\n# modified source');await assert.rejects(()=>p.importModel(changed,'Own.4ds',expected(plan),{up:'z',scale:2}),/od náhledu/);
  const save=p.saveManifest;p.saveManifest=async()=>{throw Error('publication failed');};await assert.rejects(()=>p.importModel(files,'Own.4ds',expected(plan),{up:'z',scale:2}),/publication failed/);p.saveManifest=save;assert.equal(JSON.stringify(p.manifest),before);
  await p.importModel(files,'Own.4ds',expected(plan),{up:'z',scale:2});assert.equal(p.manifest.history.length,1);assert.deepEqual(p.manifest.history[0].files.map(f=>f.path),['models/Own.4ds','maps/Wall.bmp']);const data=await p.read('models/Own.4ds'),reopened=await ModProject.open(root);await reopened.export(root+'/export');assert.deepEqual(await fs.readFile(root+'/export/models/Own.4ds'),data);assert.deepEqual(await fs.readFile(root+'/export/maps/Wall.bmp'),inputs[2]);assert.deepEqual(files.map(f=>f.data),inputs);await reopened.undo();assert.equal(JSON.stringify(reopened.manifest),before);
});
test('OBJ with multiple parts generates exact collision surfaces in native scene coordinates',()=>{
  const data=model([obj(triangle+'\no Other\nf 1 2 3')]),object={name:'Own',frameType:9,model:'Own.4ds',position:[10,2,3],rotation:[1,0,0,0],scale:[2,1,1]},surface=modelCollisionSurface(data,object,{objects:[object]},{meshes:[]},true);
  assert.equal(surface.indices.length,6);assert.equal(surface.positions.length,9);near(surface.positions,[10,2,3,10,4,3,14,2,3]);assert.equal(surface.degenerate,0);
});
test('OBJ reuses case-insensitive existing BMPs, rejects stale texture bytes and conflicting selected BMPs',async t=>{
  const {p}=await fixture(t),files=textured();await p.createFiles([{path:'MAPS/WALL.BMP',data:files[2].data}]);const before=JSON.stringify(p.manifest),sources=files.slice(0,2);let plan=await p.previewModelImport(sources);assert.deepEqual(plan.files.map(f=>f.status),['new','reuse']);await p.importModel(sources,undefined,expected(plan));assert.equal(p.manifest.history.at(-1).files.length,1);await p.undo();assert.equal(JSON.stringify(p.manifest),before);
  plan=await p.previewModelImport(sources);await p.change('MAPS/WALL.BMP',bmp(10));await assert.rejects(()=>p.importModel(sources,undefined,expected(plan)),/od náhledu/);assert.throws(()=>p.asset('models/Building.4ds'));plan=await p.previewModelImport(files);assert(plan.blocked.some(s=>s.includes('jinými daty')));await assert.rejects(()=>p.importModel(files,undefined,expected(plan)),/jinými daty/);
});
test('OBJ preview blocks publication exceeding the transaction limit on reused texture dependencies',async t=>{
  const {p}=await fixture(t),textures=Array.from({length:65},(_,i)=>({path:`maps/t${i}.bmp`,data:bmp()}));await p.createFiles(textures.slice(0,64));await p.createFiles(textures.slice(64));const source=obj('mtllib building.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\n'+textures.map((_,i)=>`usemtl M${i}\nf 1/1 2/1 3/1`).join('\n')),library=mtl(textures.map((_,i)=>`newmtl M${i}\nmap_Kd t${i}.bmp`).join('\n')),plan=await p.previewModelImport([source,library]),before=JSON.stringify(p.manifest);assert(plan.blocked.some(s=>s.includes('64 převzatých')));await assert.rejects(()=>p.importModel([source,library],undefined,expected(plan)),/64 převzatých/);assert.equal(JSON.stringify(p.manifest),before);
});
test('conversion expansion beyond the shared 64 MiB publication limit is already blocked by preview',async t=>{
  const {p}=await fixture(t),files=textured(),bitmap=Buffer.alloc(64*1024*1024-100000);files[2].data.copy(bitmap);bitmap.writeUInt32LE(bitmap.length,2);files[2].data=bitmap;files[0]=obj(files[0].data.toString()+'\n'+Array(2000).fill('f 1/1 2/2 3/3').join('\n'));const plan=await p.previewModelImport(files);assert(plan.blocked.some(s=>s.includes('dohromady přesahují')));await assert.rejects(()=>p.importModel(files,undefined,expected(plan)),/dohromady přesahují/);assert.equal(p.manifest.history.length,0);
});
