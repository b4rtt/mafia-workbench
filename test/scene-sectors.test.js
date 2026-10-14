import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {inspectScene,editScene,changeSceneObject} from '../src/core/scene.js';
import {inspectSceneSectors,assignSceneSectors} from '../src/core/scene-sectors.js';
import {appendSector} from '../src/core/sector-create.js';
import {parseFourDs,editFourDs} from '../src/core/fourds.js';
import {sceneWorld} from '../src/core/model-collision.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';
import {sectorFixture} from './sector-fixture.js';
const chunk=(type,data)=>{const h=Buffer.alloc(6);h.writeUInt16LE(type);h.writeUInt32LE(data.length+6,2);return Buffer.concat([h,data]);};
function geometry(){const h=Buffer.alloc(19);h.write('4DS\0');h.writeUInt16LE(29,4);h[18]=0x61;return appendSector(appendSector(h,{name:'A',center:[0,0,0],size:[10,10,10]}),{name:'B',center:[10,0,0],size:[10,10,10]});}
function fixture(){let s=chunk(0x4c53,Buffer.concat([chunk(0x4000,Buffer.alloc(0)),chunk(0xf001,Buffer.from('opaque root'))]));
 s=changeSceneObject(s,{kind:'add-model',name:'Crate',model:'crate.i3d',position:[3,4,5],rotation:[Math.SQRT1_2,0,Math.SQRT1_2,0],scale:[2,3,4]});
 s=changeSceneObject(s,{kind:'add-light',name:'Lamp',position:[7,8,9],rotation:[1,0,0,0],parameters:{sectors:['Primary sector']}},['A','B'],parseFourDs(geometry()).meshes);
 return changeSceneObject(s,{kind:'add-sound',name:'Sound',sound:'sound.wav',position:[9,8,7],rotation:[1,0,0,0],parameters:{file:'sound.wav',sectors:['Primary sector'],loop:true}},['A','B'],parseFourDs(geometry()).meshes);
}
const id=(s,name)=>inspectScene(s).objects.find(o=>o.name===name).id;
const near=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<Math.max(1e-5,Math.abs(v)*1e-6),`${i}: ${v} != ${b[i]}`));
test('sector reparent preserves world transform across rotation, scale, reflection and return to Primary',()=>{
 const source=fixture(),before=inspectScene(source),object=before.objects[0],world=sceneWorld(before,parseFourDs(geometry()))(object.name).elements;
 for(const scale of [[2,2,2],[-2,2,2]]){
  const geo=editFourDs(geometry(),[{id:'meshes/0/position',value:[13,-7,11]},{id:'meshes/0/rotation',value:[Math.SQRT1_2,0,Math.SQRT1_2,0]},{id:'meshes/0/scale',value:scale}]);
  const after=assignSceneSectors(source,geo,{id:object.id,parent:'a'}),scene=inspectScene(after);assert.equal(scene.objects[0].parent,'A');near(sceneWorld(scene,parseFourDs(geo))('Crate').elements,world);assert.deepEqual(scene.objects.slice(1),before.objects.slice(1));assert.ok(after.includes(Buffer.from('opaque root')));
  const back=assignSceneSectors(after,geo,{id:object.id,parent:'Primary sector'});near(sceneWorld(inspectScene(back),parseFourDs(geo))('Crate').elements,world);assert.deepEqual(assignSceneSectors(after,geo,{id:object.id,parent:'A'}),after);
 }
 assert.deepEqual(source,fixture());
});
test('light and sound sector lists support multiple sectors and empty membership independently of parent',()=>{
 const source=fixture(),geo=geometry(),lamp=id(source,'Lamp');let after=assignSceneSectors(source,geo,{id:lamp,sectors:['a','B']});
 assert.deepEqual(inspectSceneSectors(after,geo,lamp).sectors,['A','B']);assert.equal(inspectSceneSectors(after,geo,lamp).parent,'Primary sector');assert.deepEqual(assignSceneSectors(after,geo,{id:lamp,sectors:['A','B']}),after);
 const sound=id(after,'Sound'),beforeSound=inspectScene(after).entries.filter(e=>e.id.startsWith(sound+'/')&&!e.label.startsWith('Sektor'));
 after=assignSceneSectors(after,geo,{id:sound,parent:'B',sectors:[]});assert.deepEqual(inspectSceneSectors(after,geo,sound).sectors,[]);assert.equal(inspectSceneSectors(after,geo,sound).parent,'B');assert.equal(inspectScene(after).entries.find(e=>e.id.endsWith(':sound.loop')).value,true);
 for(const entry of beforeSound.filter(e=>!['Pozice','Rotace WXYZ','Měřítko','Název'].includes(e.label)))assert.deepEqual(inspectScene(after).entries.find(e=>e.id===entry.id)?.value,entry.value);
 assert.deepEqual(inspectScene(assignSceneSectors(after,geo,{id:lamp,sectors:[]})).objects.find(o=>o.id===lamp),inspectScene(after).objects.find(o=>o.id===lamp));
});
test('sector assignment rejects missing/ambiguous targets, cycles, actors, singular transforms and shear',()=>{
 const source=fixture(),geo=geometry(),object=id(source,'Crate');
 for(const request of [{id:object,parent:'Missing'},{id:object,sectors:['A']},{id:id(source,'Lamp'),sectors:['A','a']},{id:object,parent:'A',extra:1},{id:'missing',parent:'A'}])assert.throws(()=>assignSceneSectors(source,geo,request));
 assert.throws(()=>assignSceneSectors(source,editFourDs(geo,[{id:'meshes/0/scale',value:[0,1,1]}]),{id:object,parent:'A'}),/nevratnou/);
 assert.throws(()=>assignSceneSectors(source,editFourDs(geo,[{id:'meshes/0/scale',value:[2,1,1]},{id:'meshes/0/rotation',value:[Math.cos(.2),0,Math.sin(.2),0]}]),{id:object,parent:'A'}),/zkosení/);
 const cyclic=changeSceneObject(source,{kind:'add-model',name:'A_override',model:'a.i3d',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]});const alias=editScene(cyclic,inspectScene(cyclic).objects.at(-1).fields.name,'A'),parent=inspectScene(alias).entries.find(e=>e.id.startsWith(id(alias,'A')+'/')&&e.kind==='string'&&e.value==='Primary sector');
 assert.throws(()=>assignSceneSectors(alias,geo,{id:object,parent:'A'}),/sektor/);const sectorOverride=editScene(alias,inspectScene(alias).objects.at(-1).fields.frameType,5);assert.throws(()=>assignSceneSectors(editScene(sectorOverride,parent.id,'Crate'),geo,{id:object,parent:'A'}),/cyklická/);
 const human=changeSceneObject(source,{kind:'add-human',name:'Human',model:'Tommy.i3d',parameters:{},code:'end',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]});assert.throws(()=>assignSceneSectors(human,geo,{id:id(human,'Human'),parent:'A'}),/aktéra/);
});
test('assignment preserves unknown parent and membership tails, parameter order and unrelated scripts',()=>{
 const f=values=>{const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeFloatLE(v,i*4));return b;};const integer=Buffer.alloc(4);integer.writeUInt32LE(2);
 const source=chunk(0x4c53,chunk(0x4000,chunk(0x4010,Buffer.concat([chunk(0x10,Buffer.from('Lamp\0')),chunk(0x4011,integer),chunk(0x20,Buffer.concat([f([1,2,3]),Buffer.from('position tail')])),chunk(0x4020,Buffer.concat([chunk(0x10,Buffer.from('Primary sector\0parent tail')),chunk(0xbeef,Buffer.from('link opaque'))])),chunk(0x4040,Buffer.concat([chunk(0x4046,Buffer.from('A\0membership tail')),chunk(0xbeee,Buffer.from('light opaque'))]))]))));
 const after=assignSceneSectors(source,geometry(),{id:id(source,'Lamp'),parent:'A',sectors:['A','B']});for(const tail of ['position tail','parent tail','membership tail','link opaque','light opaque'])assert.ok(after.includes(Buffer.from(tail)));assert.equal(inspectScene(after).objects[0].parent,'A');
});
test('geometry overrides inherit missing transform fields and parent before reparenting',()=>{
 const geo=editFourDs(sectorFixture(),[{id:'meshes/1/parent',value:1}]),source=chunk(0x4c53,chunk(0x4000,Buffer.concat([chunk(0x4010,chunk(0x10,Buffer.from('after\0'))),chunk(0x4010,chunk(0x10,Buffer.from('room\0')))]))),object=inspectScene(source).objects[0],before=sceneWorld(inspectScene(source),parseFourDs(geo))('after').elements;
 const context=inspectSceneSectors(source,geo,object.id);assert.equal(context.parent,'room');assert.ok(context.available.includes('room'));const after=assignSceneSectors(source,geo,{id:object.id,parent:'Primary sector'});near(sceneWorld(inspectScene(after),parseFourDs(geo))('after').elements,before);assert.equal(inspectScene(after).objects[0].parent,'Primary sector');
});
test('project assignment guards both inputs, publishes one undo, exports exactly and rolls back failures',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-scene-sectors-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:2,name:'Sectors',assets:[],history:[]}));const p=await ModProject.open(root),name='missions/Test/scene2.bin',geo='missions/Test/scene.4ds';await p.createFiles([{path:name,data:fixture()},{path:geo,data:geometry()},{path:'missions/Test/tree.klz',data:Buffer.from('protected')}]);const before=await p.read(name),ctx=await p.sceneSectorContext(name,id(before,'Lamp')),history=structuredClone(p.manifest.history),request={id:ctx.object.id,parent:'B',sectors:['A','B']};
 await assert.rejects(()=>p.assignSceneSectors(name,request,'stale',ctx.geometryHash),/změnila/);await assert.rejects(()=>p.assignSceneSectors(name,request,ctx.sha256,'stale'),/změnila/);
 const publish=p.saveManifest;p.saveManifest=async()=>{throw Error('Publication failed');};await assert.rejects(()=>p.assignSceneSectors(name,request,ctx.sha256,ctx.geometryHash),/Publication failed/);p.saveManifest=publish;assert.deepEqual(await p.read(name),before);assert.deepEqual(p.manifest.history,history);
 const batch=p.changeBatch;p.changeBatch=async function(files,...args){await this.change(geo,editFourDs(geometry(),[{id:'meshes/0/position',value:[1,0,0]}]),'Concurrent geometry');return batch.call(this,files,...args);};await assert.rejects(()=>p.assignSceneSectors(name,request,ctx.sha256,ctx.geometryHash),/změnil/);p.changeBatch=batch;assert.deepEqual(await p.read(name),before);await p.undo();assert.deepEqual(p.manifest.history,history);
 await p.assignSceneSectors(name,request,ctx.sha256,ctx.geometryHash);assert.equal(p.manifest.history.length,history.length+1);assert.equal(p.manifest.history.at(-1).files.length,1);const after=await p.read(name),now=await p.sceneSectorContext(name,ctx.object.id);await p.assignSceneSectors(name,request,now.sha256,now.geometryHash);assert.equal(p.manifest.history.length,history.length+1);
 const reopened=await ModProject.open(root);await reopened.export(root+'/export');assert.deepEqual(await fs.readFile(path.join(root,'export',name)),after);await reopened.undo();assert.deepEqual(await reopened.read(name),before);assert.equal(hash(await reopened.read(geo)),ctx.geometryHash);assert.equal((await reopened.read('missions/Test/tree.klz')).toString(),'protected');assert.deepEqual(reopened.manifest.history,history);
});
