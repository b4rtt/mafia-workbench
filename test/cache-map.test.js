import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ModProject } from '../src/core/project.js';
import { hash, writeSafe } from '../src/core/files.js';
import { inspectCache } from '../src/core/cache.js';
import { cacheMap } from '../src/shared/cache-map.js';
import { groupSceneProperties } from '../src/shared/scene-properties.js';
import { MissionViews } from '../src/ui/mission-views.js';
import { changeSceneObject } from '../src/core/scene.js';

const chunk=(type,payload)=>{const h=Buffer.alloc(6);h.writeUInt16LE(type);h.writeUInt32LE(payload.length+6,2);return Buffer.concat([h,payload]);};
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const text=s=>Buffer.concat([u32(Buffer.byteLength(s)),Buffer.from(s)]);
const floats=values=>{const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeFloatLE(v,i*4));return b;};
function source(){
  const frame=x=>chunk(2000,Buffer.concat([text('box.i3d'),floats([x,2,3,1,0,0,0,1,1,1]),u32(0x87654321),floats([2,3,4]),Buffer.from('opaque')]));
  const part=(name,count)=>chunk(1000,Buffer.concat([text(name),floats(Array.from({length:19},(_,i)=>i+100)),...Array.from({length:count},(_,i)=>frame(i))]));
  return chunk(500,Buffer.concat([u32(1),part('City',2),chunk(9000,Buffer.from('unknown')),part('City',501)]));
}
test('cache map keeps identities, world transforms, editable properties and streaming bounds separate from scene context',()=>{
  const parsed={type:'cache',path:'missions/Test/cache.bin',sha256:'hash',...inspectCache(source())},geometry={meshes:[{id:1,name:'box'}],materials:[]},objects=[{id:'frame',name:'City / 1 · box.i3d',position:[90,0,0],fields:{position:'frame/position'}}];
  const scene={path:'missions/Test/scene2.bin',objects,geometry,entries:[{id:'frame/position',value:[90,0,0]}]},before=structuredClone({parsed,scene});
  const map=cacheMap(parsed,'parts/0',scene);
  assert.equal(map.type,'map');assert.equal(map.cacheSource,true);assert.equal(map.scenePath,scene.path);assert.equal(map.cachePart,'parts/0');assert.deepEqual(map.cacheParts.map(p=>p.count),[2,501]);
  assert.deepEqual(map.objects[0].position,[0,2,3]);assert.deepEqual(map.objects[0].secondaryScale,[2,3,4]);assert.equal(map.objects[0].parent,'Primary sector');
  assert.equal(map.geometry,geometry);assert.equal(map.contextObjects[0].contextOnly,true);assert.deepEqual(map.contextObjects[0].fields,{});
  assert.equal(map.entries.some(e=>e.id==='frame/position'),false);assert(map.entries.every(e=>e.id.startsWith('parts/0/')));
  const groups=groupSceneProperties(map);assert.equal(groups.length,3);assert(groups.some(group=>group.id==='object/parts/0/frames/0'));assert(groups.some(group=>group.id==='object/parts/0/frames/1'));
  assert.equal(cacheMap(parsed,'parts/2',scene).objects.length,501);assert.deepEqual({parsed,scene},before);
  assert.throws(()=>cacheMap(parsed,'parts/1',scene),/existující/);assert.throws(()=>cacheMap({type:'binary',warning:'Unsupported'},'parts/0'),/Unsupported/);
  const standalone=cacheMap(parsed,'parts/0',null,'No scene');assert.deepEqual(standalone.geometry,{meshes:[],materials:[]});assert.deepEqual(standalone.contextObjects,[]);assert.equal(standalone.contextWarning,'No scene');
});
test('cache part camera and selection survive separately from the scene, another part and project',()=>{
  const memory=new MissionViews(),camera={position:[1,2,3],target:[4,5,6],near:.02,far:20000},view={mapPath:'missions/Test/cache.bin',projectRoot:'/project',cachePart:'parts/0',selectedName:'A',gizmo:{mode:'rotate'},captureCamera:()=>camera};
  memory.remember(view);memory.remember({...view,cachePart:'parts/2',selectedName:'B',captureCamera:()=>({...camera,position:[7,8,9]})});
  const file={path:'MISSIONS/TEST/CACHE.BIN',type:'map',cacheSource:true,cachePart:'parts/0'};
  assert.equal(memory.get('/project',file).selectedName,'A');assert.deepEqual(memory.get('/project',file).camera,camera);assert.equal(memory.get('/project',{...file,cachePart:'parts/2'}).selectedName,'B');
  assert.equal(memory.get('/project',{...file,cacheSource:false}),null);assert.equal(memory.get('/other',file),null);assert.equal(memory.get('/project',{path:'missions/Test/scene2.bin',type:'map'}),null);
  assert.equal(memory.cachePart('/project',file.path),'parts/2');assert.equal(memory.cachePart('/other',file.path),null);memory.clear();assert.equal(memory.cachePart('/project',file.path),null);
});
test('project cache map reads same-mission overlays and saves only cache with hash guard, exact export, reopen and undo',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-cache-map-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:2,name:'Cache context',assets:[],history:[]}));
  const p=await ModProject.open(root),cachePath='MISSIONS/Test/CACHE.BIN',scenePath='missions/TEST/scene2.bin',geometryPath='Missions/test/SCENE.4DS';
  const bytes=source(),geometry=Buffer.alloc(19);geometry.write('4DS\0');geometry.writeUInt16LE(29,4);geometry[18]=1;
  let scene=chunk(0x4c53,chunk(0x4000,Buffer.alloc(0)));scene=changeSceneObject(scene,{kind:'add-model',name:'Context',model:'box.i3d',position:[9,8,7],rotation:[1,0,0,0],scale:[1,1,1]});
  await p.createFiles([{path:cachePath,data:bytes},{path:scenePath,data:scene},{path:geometryPath,data:geometry}]);
  const manifest=await fs.readFile(root+'/workbench.json'),map=await p.inspectCacheMap('missions/test/cache.bin','parts/0');
  assert.equal(map.path,cachePath);assert.equal(map.scenePath,scenePath);assert.equal(map.contextObjects[0].name,'Context');assert.deepEqual(await fs.readFile(root+'/workbench.json'),manifest);
  await assert.rejects(p.inspectCacheMap('missions/other/cache.bin','parts/0'));await assert.rejects(p.inspectCacheMap(scenePath,'parts/0'),/cache/);
  const position=map.objects[0].fields.position;await assert.rejects(p.saveCache(cachePath,[{id:position,value:[2,3,4]}],'stale'),/změnil/);assert.equal(p.manifest.history.length,1);
  await p.saveCache(cachePath,[{id:position,value:[2,3,4]}],map.sha256);assert.equal(p.manifest.history.length,2);assert.deepEqual(await p.read(scenePath),scene);assert.deepEqual(await p.read(geometryPath),geometry);
  const reopened=await ModProject.open(root),saved=await reopened.inspectCacheMap(cachePath,'parts/0');assert.deepEqual(saved.objects[0].position,[2,3,4]);assert.equal(saved.sha256,hash(await p.read(cachePath)));
  await reopened.export(root+'/export');assert.deepEqual(await fs.readFile(root+'/export/'+cachePath),await p.read(cachePath));
  await reopened.undo();assert.deepEqual(await reopened.read(cachePath),bytes);assert.equal(reopened.manifest.history.length,1);
  await reopened.change(geometryPath,Buffer.from('unsupported'),'Test unavailable context');const fallback=await reopened.inspectCacheMap(cachePath,'parts/0');assert.match(fallback.contextWarning,/Okolní scénu/);assert.equal(fallback.objects.length,2);assert.equal(fallback.scenePath,null);assert.deepEqual(fallback.geometry,{meshes:[],materials:[]});
  await reopened.undo();await reopened.change(cachePath,Buffer.from('unsupported'),'Test invalid cache');await assert.rejects(reopened.inspectCacheMap(cachePath,'parts/0'),/Cache/);await reopened.undo();
  assert.deepEqual(await fs.readFile(root+'/workbench.json'),manifest);
});
