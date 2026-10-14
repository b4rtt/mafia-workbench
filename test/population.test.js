import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {inspectPopulation,editPopulation} from '../src/core/population.js';
import {inspectScene,editScene} from '../src/core/scene.js';
import {groupSceneProperties} from '../src/shared/scene-properties.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';

const chunk=(type,data)=>{const b=Buffer.alloc(6);b.writeUInt16LE(type);b.writeUInt32LE(data.length+6,2);return Buffer.concat([b,data]);};
const u32=value=>{const b=Buffer.alloc(4);b.writeUInt32LE(value);return b;};
const opaque=chunk(0xfefe,Buffer.from('untouched sibling'));
function fixture(kind){
  const cars=kind===12,names=cars?['taxi','forAcou']:['civil13.i3d','civil16.i3d'],header=cars?24:33,b=Buffer.alloc(header+2*(cars?32:21),0xcd);
  b.writeUInt32LE(cars?5:1);b.writeUInt32LE(100,cars?16:25);b.writeUInt32LE(2,cars?20:29);
  names.forEach((name,i)=>{const start=header+i*(cars?32:17);Buffer.from(name+'\0').copy(b,start);if(cars){b.writeFloatLE(i?2.5:.5,start+20);b.writeUInt32LE(i?4:1,start+24);[0,1,0,0xaa].forEach((v,j)=>b[start+28+j]=v);}else b.writeUInt32LE(i?7:15,header+34+i*4);});return b;
}
const actor=(name,kind,data)=>chunk(0xae21,Buffer.concat([chunk(0xae23,Buffer.from(name+'\0')),chunk(0xae22,u32(kind)),chunk(0xae24,data),opaque]));
const scene=(cars=fixture(12),people=fixture(18))=>chunk(0x4c53,Buffer.concat([chunk(0x4000,chunk(0x4010,Buffer.concat([chunk(0x10,Buffer.from('pedestrians\0')),chunk(0x4011,u32(9))]))),chunk(0xae20,Buffer.concat([actor('traffic',12,cars),actor('pedestrians',18,people)])),opaque]));
test('generator tables read v5/v1 and preserve literal no-ops, source data, padding and opaque header floats',()=>{
  for(const kind of [12,18]){const data=fixture(kind),before=Buffer.from(data),value=inspectPopulation(kind,data);assert.equal(value.models.length,2);assert.equal(value.budget,100);assert.deepEqual(editPopulation(kind,data,value),data);const changed=editPopulation(kind,data,{...value,budget:50});const offset=kind===12?16:25;assert.equal(changed.readUInt32LE(offset),50);assert.deepEqual(changed.subarray(0,offset),data.subarray(0,offset));assert.deepEqual(changed.subarray(offset+4),data.subarray(offset+4));assert.deepEqual(data,before);}
});
test('structural model add/delete/reorder retains exact original records and writes parallel pedestrian counts in new order',()=>{
  for(const kind of [12,18]){const data=fixture(kind),value=inspectPopulation(kind,data),newRow=kind===12?{sourceIndex:null,model:'arrow',weight:1.25,colors:2,flags:[1,2,3,4]}:{sourceIndex:null,model:'civil01.i3d',capacity:3};
    const changed=editPopulation(kind,data,{...value,models:[value.models[1],newRow,value.models[0]]}),parsed=inspectPopulation(kind,changed);assert.deepEqual(parsed.models.map(row=>row.model),[value.models[1].model,newRow.model,value.models[0].model]);
    const header=kind===12?24:33,size=kind===12?32:17;assert.deepEqual(changed.subarray(header,header+size),data.subarray(header+size,header+2*size));assert.deepEqual(changed.subarray(header+2*size,header+3*size),data.subarray(header,header+size));assert.equal(parsed.models[1][kind===12?'weight':'capacity'],newRow[kind===12?'weight':'capacity']);
    const removed=editPopulation(kind,changed,{budget:100,models:[parsed.models[2],parsed.models[0]]});assert.deepEqual(removed,data);
  }
});
test('edited fixed-width names clear padding only in their record, and zero pedestrian budget clears all model slots',()=>{
  for(const kind of [12,18]){const data=fixture(kind),value=inspectPopulation(kind,data);value.models[0].model=kind===12?'taxiNew':'new.i3d';const changed=editPopulation(kind,data,value),start=kind===12?24:33,size=kind===12?20:17;assert.deepEqual(changed.subarray(start+size),data.subarray(start+size));assert.ok(changed.subarray(start,start+size).includes(0));assert.equal(inspectPopulation(kind,changed).models[0].model,value.models[0].model);}
  const data=fixture(18),value=inspectPopulation(18,data),off=editPopulation(18,data,{...value,budget:0});assert.deepEqual(inspectPopulation(18,off).models.map(row=>row.capacity),[0,0]);const zeroLegacy=Buffer.from(data);zeroLegacy.writeUInt32LE(0,25);assert.deepEqual(editPopulation(18,zeroLegacy,inspectPopulation(18,zeroLegacy)),zeroLegacy);
  const active=inspectPopulation(18,off);active.budget=100;active.models[0].capacity=2;assert.deepEqual(inspectPopulation(18,editPopulation(18,off,active)).models.map(row=>row.capacity),[2,0]);
  const cars=fixture(12),traffic=inspectPopulation(12,cars);const stopped=editPopulation(12,cars,{...traffic,budget:0});assert.deepEqual(inspectPopulation(12,stopped).models.map(row=>row.weight),[0,0]);const legacy=Buffer.from(cars);legacy.writeUInt32LE(0,16);assert.deepEqual(editPopulation(12,legacy,inspectPopulation(12,legacy)),legacy);
});
test('table edits refuse unsupported lengths/versions, ambiguous identity, invalid names, flags, weights and counts',()=>{
  for(const kind of [12,18]){const data=fixture(kind);for(const bad of [data.subarray(0,data.length-1),Buffer.concat([data,Buffer.alloc(1)]),Buffer.alloc(data.length)]){assert.equal(inspectPopulation(kind,bad),null);assert.throws(()=>editPopulation(kind,bad,{}),/nepodporovaný/);}const original=inspectPopulation(kind,data);
    for(const mutate of [v=>v.budget=-1,v=>v.budget=101,v=>v.extra=0,v=>v.models[0].sourceIndex=2,v=>v.models[1].sourceIndex=0,v=>v.models[0].model='../bad',v=>v.models[0].model='a'.repeat(20),v=>v.models[0].model='💥',v=>v.models[0].model='',...(kind===12?[v=>v.models[0].weight=NaN,v=>v.models[0].weight=-1,v=>v.models[0].colors=0,v=>v.models[0].colors=11,v=>v.models[0].flags=[1],v=>v.models[0].flags[0]=256]:[v=>v.models[0].capacity=-1,v=>v.models[0].capacity=1.5,v=>v.models[0].capacity=1001])]){const value=structuredClone(original);mutate(value);assert.throws(()=>editPopulation(kind,data,value),/Doprava a chodci/);}
  }
});
test('scene generator properties group with their actor frame and structural writes preserve all sibling chunks',()=>{
  const source=scene(),file=inspectScene(source),entries=file.entries.filter(row=>row.populationParameter);assert.equal(entries.length,2);const grouped=groupSceneProperties(file).find(group=>group.name==='pedestrians');assert.ok(grouped.entries.some(row=>row.entry.id===entries[1].id));
  for(const entry of entries)assert.deepEqual(editScene(source,entry.id,entry.value),source);
  const value={...entries[1].value,models:[entries[1].value.models[1]]},changed=editScene(source,entries[1].id,value);assert.deepEqual(changed,scene(fixture(12),editPopulation(18,fixture(18),value)));assert.ok(changed.includes(opaque));
});
test('project generator budget edits preserve export/reopen, exact undo and stale-write rejection; missing new models never publish',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-population-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Population',assets:[],history:[]}));const p=await ModProject.open(root),name='missions/Test/scene2.bin',original=scene();await p.createFiles([{path:name,data:original}]);const entry=inspectScene(original).entries.find(e=>e.populationParameter&&e.actorKind===18),changes=[{id:entry.id,value:{...entry.value,budget:50}}],history=p.manifest.history.length;
  await assert.rejects(p.saveScene(name,changes,'stale'),/změnil/);await p.saveScene(name,changes,hash(original));const changed=await p.read(name),reopened=await ModProject.open(root);assert.equal(reopened.manifest.history.length,history+1);assert.deepEqual(await reopened.read(name),changed);const output=path.join(root,'export');await reopened.export(output);assert.deepEqual(await fs.readFile(path.join(output,name)),changed);await reopened.undo();assert.deepEqual(await reopened.read(name),original);
  const value=structuredClone(entry.value);value.models.push({sourceIndex:null,model:'missing.i3d',capacity:1});await assert.rejects(reopened.saveScene(name,[{id:entry.id,value}],hash(original)));assert.deepEqual(await reopened.read(name),original);assert.equal(reopened.manifest.history.length,history);
  // A script-style single-file edit before a generator batch must also undo
  // through the creation, without leaving an older hidden mods/path layer.
  await reopened.undo();await reopened.createFiles([{path:name,data:original}]);
  const modified=Buffer.from(original);modified[modified.length-1]^=1;
  await reopened.change(name,modified,'Single scene edit');await reopened.saveScene(name,changes,hash(modified));
  await reopened.undo();assert.deepEqual(await reopened.read(name),modified);
  const hidden=path.join(root,'mods',name),external=Buffer.from(modified);external[external.length-1]^=2;await fs.writeFile(hidden,external);await assert.rejects(reopened.undo(),/skryté/);assert.deepEqual(await fs.readFile(hidden),external);assert.deepEqual(await reopened.read(name),modified);await fs.writeFile(hidden,modified);
  const publish=reopened.saveManifest.bind(reopened),overlay=reopened.asset(name).overlay;reopened.saveManifest=async()=>{throw Error('Failed undo publish');};await assert.rejects(reopened.undo(),/Failed undo/);assert.equal(reopened.asset(name).overlay,overlay);assert.deepEqual(await fs.readFile(hidden),modified);assert.deepEqual(await reopened.read(name),modified);reopened.saveManifest=publish;
  await reopened.undo();assert.deepEqual(await reopened.read(name),original);await reopened.undo();assert.equal(reopened.manifest.history.length,0);assert.equal(reopened.manifest.assets.length,0);
});

test('new traffic rows validate the model and physics dependency; a concurrent model change rejects the entire scene save',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-traffic-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Traffic',assets:[],history:[]}));const p=await ModProject.open(root),name='missions/Test/scene2.bin',original=scene();
  const header=Buffer.alloc(18);header.write('4DS\0');header.writeUInt16LE(29,4);const names=['BODY','SEAT0','WHL0','WHR0','WHL1','WHR1','BODYCOLB0'];header.writeUInt16LE(names.length,16);
  const parts=names.map(name=>{const b=Buffer.alloc(1+2+40+1+1+name.length+1+24);b[0]=6;for(const at of [15,19,23,27])b.writeFloatLE(1,at);b[43]=1;b[44]=name.length;b.write(name,45);return b;});const model=Buffer.concat([header,...parts,Buffer.from([0])]);
  const table=Buffer.alloc(8+4+36+4+1);table.writeUInt32LE(1);table.writeUInt32LE(1,4);table.writeUInt32LE(table.length-12,8);table.write('taxi',12);table.writeUInt32LE(1,44);table.writeUInt32LE(1,48);
  await p.createFiles([{path:name,data:original},{path:'models/taxi10.4ds',data:model},{path:'tables/vehicles.bin',data:table}]);const entry=inspectScene(original).entries.find(e=>e.populationParameter&&e.actorKind===12),value={budget:100,models:[{sourceIndex:null,model:'taxi',weight:1,colors:1,flags:[0,0,0,0]}]},history=p.manifest.history.length;
  await p.saveScene(name,[{id:entry.id,value}],hash(original));assert.equal(inspectScene(await p.read(name)).entries.find(e=>e.id===entry.id).value.models.length,1);assert.deepEqual(p.manifest.history.at(-1).files.map(file=>file.path),[name]);await p.undo();assert.deepEqual(await p.read(name),original);
  const publish=p.changeBatch.bind(p);p.changeBatch=async(...args)=>{await p.change('models/taxi10.4ds',before=>{const bytes=Buffer.from(before);bytes[6]=1;return bytes;},'Concurrent model');return publish(...args);};
  await assert.rejects(p.saveScene(name,[{id:entry.id,value}],hash(original)),/změnil/);assert.deepEqual(await p.read(name),original);assert.equal(p.manifest.history.length,history+1);assert.equal((await p.read('models/taxi10.4ds'))[6],1);p.changeBatch=publish;await p.undo();assert.deepEqual(await p.read('models/taxi10.4ds'),model);
  await p.change('models/taxi10.4ds',()=>Buffer.alloc(19),'Invalid model');await assert.rejects(p.saveScene(name,[{id:entry.id,value}],hash(original)));assert.deepEqual(await p.read(name),original);
});
