import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {inspectScene,editScene,changeSceneObject} from '../src/core/scene.js';
import {sceneSectors,validateNewLight,lightTypes} from '../src/shared/lights.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';

const chunk=(type,payload)=>{const b=Buffer.alloc(6);b.writeUInt16LE(type);b.writeUInt32LE(payload.length+6,2);return Buffer.concat([b,payload]);};
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const sector=chunk(0x4010,Buffer.concat([chunk(0x4011,u32(5)),chunk(0x10,Buffer.from('Room\0'))]));
const opaque=chunk(0xffff,Buffer.from('unrecognised sibling'));
const original=chunk(0x4c53,Buffer.concat([chunk(0x4000,sector),opaque]));
const request={kind:'add-light',name:'WB_LIGHT',position:[1,2,3],rotation:[1,0,0,0],parameters:{type:2,color:[1,.5,.25],power:2,range:[1,20],cone:[15,45],mode:107,sectors:['primary sector','ROOM']}};
const value=(scene,label)=>scene.entries.find(e=>e.id.startsWith(scene.objects.at(-1).id+'/')&&e.label===label).value;

test('all eight light types create a complete frame with repeated sector chunks, ordered cone/range and preserved data',()=>{
  for(const {value:type} of lightTypes){
    const result=changeSceneObject(original,{...request,parameters:{...request.parameters,type}}),scene=inspectScene(result),object=scene.objects.at(-1);
    assert.deepEqual(scene.objects.slice(0,-1),inspectScene(original).objects);assert.equal(object.frameType,2);assert.equal(object.actorBound,false);assert.deepEqual(object.position,request.position);assert.deepEqual(object.rotation,request.rotation);assert.equal(object.parent,'Primary sector');assert.equal(object.model,undefined);
    assert.equal(value(scene,'Typ světla'),type);assert.deepEqual(value(scene,'Barva RGB'),[1,.5,.25]);assert.equal(value(scene,'Síla světla'),2);assert.deepEqual(value(scene,'Dosah světla'),[1,20]);assert.deepEqual(value(scene,'Světelný kužel'),[15,45].map(n=>Math.fround(n*Math.PI/180)));assert.equal(value(scene,'Režim světla'),107);
    assert.deepEqual(scene.entries.filter(e=>e.label==='Sektor světla').map(e=>e.value),['Primary sector','Room']);assert.ok(result.includes(sector));assert.ok(result.includes(opaque));assert.equal(result.readUInt32LE(2),result.length);assert.deepEqual(original,chunk(0x4c53,Buffer.concat([chunk(0x4000,sector),opaque])));
    for(const entry of scene.entries)assert.deepEqual(editScene(result,entry.id,entry.value),result);
    const copy=changeSceneObject(result,{kind:'duplicate',id:object.id,name:'WB_LIGHT_COPY'}),copyScene=inspectScene(copy);
    assert.equal(copyScene.objects.at(-1).name,'WB_LIGHT_COPY');assert.equal(value(copyScene,'Typ světla'),type);assert.deepEqual(value(copyScene,'Světelný kužel'),value(scene,'Světelný kužel'));
    assert.deepEqual(changeSceneObject(copy,{kind:'delete',id:copyScene.objects.at(-1).id}),result);
  }
});

test('light creation rejects invalid parameters and unresolved sectors without silently repairing stored values',()=>{
  assert.deepEqual(sceneSectors(inspectScene(original).objects,[{name:'Geometry room',type:5},{name:'dup',type:5},{name:'DUP',type:5},{name:'not a sector',type:1}]),['Primary sector','Backdrop sector','Room','Geometry room']);
  const base={sectors:['Primary sector']};
  for(const parameters of [null,[],{...base,unknown:1},{...base,type:0},{...base,type:9},{...base,color:[1,2,0]},{...base,color:[0,NaN,0]},{...base,color:Array(3)},{...base,power:-1},{...base,power:Infinity},{...base,mode:1.1},{...base,mode:2**32},{...base,range:[0,10]},{...base,range:[10,1]},{...base,range:[1,1+1e-10]},{...base,cone:[20,10]},{...base,cone:[0,181]},{...base,cone:[0,1e-50]},{sectors:[]},{sectors:['Room','room']},{sectors:['missing'] }])assert.throws(()=>changeSceneObject(original,{...request,parameters}),/Světlo/);
  assert.throws(()=>changeSceneObject(original,{...request,name:'room'}),/existuje/);
  assert.throws(()=>changeSceneObject(original,{...request,rotation:[0,0,0,0]}),/rotace/);
  assert.throws(()=>changeSceneObject(original,{...request,position:[Infinity,0,0]}),/hodnota/);
  const validated=validateNewLight(base,['Primary sector']);assert.equal(validated.type,1);assert.deepEqual(validated.range,[1,40]);assert.equal(validated.mode,99);
});

test('light changes publish only the scene, reopen, export and undo exactly',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-lights-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Lights',assets:[],history:[]}));const p=await ModProject.open(root),scenePath='missions/NEW/scene2.bin',geometryPath='missions/NEW/scene.4ds';const geometry=Buffer.alloc(19);geometry.write('4DS\0');geometry.writeUInt16LE(29,4);geometry[18]=1;
  await p.createFiles([{path:scenePath,data:original},{path:geometryPath,data:geometry}]);const history=p.manifest.history.length;
  await assert.rejects(p.changeSceneObject(scenePath,request,'stale'),/změnil/);assert.equal(p.manifest.history.length,history);assert.deepEqual(await p.read(scenePath),original);
  await p.changeSceneObject(scenePath,request,hash(original));const result=await p.read(scenePath);assert.deepEqual(p.manifest.history.at(-1).files.map(f=>f.path),[scenePath]);assert.deepEqual(await p.read(geometryPath),geometry);
  const reopened=await ModProject.open(root),parsed=inspectScene(await reopened.read(scenePath)),power=parsed.entries.find(e=>e.label==='Síla světla');await reopened.saveScene(scenePath,[{id:power.id,value:3}],hash(result));assert.equal(value(inspectScene(await reopened.read(scenePath)),'Síla světla'),3);
  const destination=path.join(root,'export');await reopened.export(destination);assert.deepEqual(await fs.readFile(path.join(destination,scenePath)),await reopened.read(scenePath));await reopened.undo();assert.deepEqual(await reopened.read(scenePath),result);await reopened.undo();assert.deepEqual(await reopened.read(scenePath),original);assert.equal(reopened.manifest.history.length,history);
});
