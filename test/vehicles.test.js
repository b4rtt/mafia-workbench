import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseVehicleTable, vehicleModelDefinition, validateVehicleModel } from '../src/core/vehicles.js';
import { ModProject } from '../src/core/project.js';
import { inspectScene } from '../src/core/scene.js';
import { hash, writeSafe } from '../src/core/files.js';

function table(){
  const bytes=Buffer.alloc(8+4+36+4+3+4+2);bytes.writeUInt32LE(1);bytes.writeUInt32LE(1,4);bytes.writeUInt32LE(bytes.length-12,8);bytes.write('Taxi',12);bytes.writeUInt32LE(2,44);bytes.writeUInt32LE(3,48);bytes.writeUInt32LE(2,55);return bytes;
}
const names=['BODY','SEAT0','WHL0','WHR0','WHL1','WHR1','BODYCOLB0'];
test('vehicle catalog reads versioned records and level boundaries, matches model families and rejects truncated or ambiguous data',()=>{
  const bytes=table(),parsed=parseVehicleTable(bytes);assert.deepEqual(parsed.entries,[{name:'Taxi',levels:2,offset:8,length:bytes.length-8}]);
  assert.deepEqual(vehicleModelDefinition(parsed,'models/TAXI12.4ds'),{path:'models/TAXI12.4ds',table:'Taxi',variant:12,levels:2});
  for(const name of ['models/taxi.4ds','models/taxi012.4ds','models/taxi12_dead.4ds','maps/taxi12.4ds','models/other00.4ds'])assert.equal(vehicleModelDefinition(parsed,name),null);
  for(const [offset,value] of [[0,2],[4,2],[8,4],[44,0],[48,1000],[55,0]]){const bad=Buffer.from(bytes);bad.writeUInt32LE(value,offset);assert.throws(()=>parseVehicleTable(bad),/Auta/);}
  for(const size of [0,7,25,bytes.length-1])assert.throws(()=>parseVehicleTable(bytes.subarray(0,size)),/Auta/);
  assert.throws(()=>parseVehicleTable(Buffer.concat([bytes,Buffer.from([0])])),/koncová/);
  const duplicate=Buffer.concat([bytes,bytes.subarray(8)]);duplicate.writeUInt32LE(2,4);duplicate.write('tAXI',bytes.length+4);assert.throws(()=>parseVehicleTable(duplicate),/nejednoznačný/);
});
test('car validation requires driver, wheel and collision parts with unique names',()=>{
  const meshes=names.map(name=>({name}));validateVehicleModel({meshes});
  for(const name of names)assert.throws(()=>validateVehicleModel({meshes:meshes.filter(m=>m.name!==name)}),/model/);
  assert.throws(()=>validateVehicleModel({meshes:[...meshes,{name:'seat0'}]}),/jednoznačnou/);
  assert.throws(()=>validateVehicleModel({meshes:[...meshes,{name:'bone',joint:1}]}),/kostrou/);
});
const chunk=(type,payload)=>{const h=Buffer.alloc(6);h.writeUInt16LE(type);h.writeUInt32LE(payload.length+6,2);return Buffer.concat([h,payload]);};
function model(){const h=Buffer.alloc(18);h.write('4DS\0');h.writeUInt16LE(29,4);h.writeUInt16LE(names.length,16);
  const meshes=names.map(name=>{const b=Buffer.alloc(1+2+40+1+1+name.length+1+24);b[0]=6;b.writeFloatLE(1,15);b.writeFloatLE(1,19);b.writeFloatLE(1,23);b.writeFloatLE(1,27);b[43]=1;b[44]=name.length;b.write(name,45);return b;});
  return Buffer.concat([h,...meshes,Buffer.from([0])]);}
test('new car creation publishes frame and actor together, preserves other bytes, exports, reopens and undoes',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-car-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Cars',assets:[],history:[]}));const p=await ModProject.open(root),scenePath='missions/CAR/scene2.bin',scene=chunk(0x4c53,Buffer.concat([chunk(0x4000,Buffer.alloc(0)),chunk(0xbeef,Buffer.from('opaque sibling'))])),empty=Buffer.alloc(19);empty.write('4DS\0');empty.writeUInt16LE(29,4);
  await p.createFiles([{path:scenePath,data:scene},{path:'missions/CAR/scene.4ds',data:empty},{path:'models/Taxi00.4ds',data:model()},{path:'tables/vehicles.bin',data:table()}]);
  const cars=await p.carModels();assert.equal(cars.models.length,1);assert.equal(cars.rejected,0);
  const request={kind:'add-car',name:'WB_CAR',model:'models/taxi00.4ds',position:[1,2,3],rotation:[1,0,0,0],scale:[1,1,1],vehicleTableHash:cars.sha256};
  for(const invalid of [{vehicleTableHash:'stale'},{scale:[2,1,1]},{model:'models/no00.4ds'}])await assert.rejects(p.changeSceneObject(scenePath,{...request,...invalid},hash(scene)));
  assert.deepEqual(await p.read(scenePath),scene);
  await p.changeSceneObject(scenePath,request,hash(scene));const added=await p.read(scenePath),s=inspectScene(added),car=s.objects[0];
  assert.equal(car.actorBound,true);assert.equal(car.model,'Taxi00.i3d');assert.deepEqual(car.position,[1,2,3]);assert.ok(added.includes(Buffer.from('opaque sibling')));assert.equal(s.entries.find(e=>e.label==='Typ aktéra').value,4);assert.equal(s.actorScripts.length,0);
  const actorName=chunk(0xae23,Buffer.from('WB_CAR\0')),at=added.indexOf(actorName);assert.equal(added.readUInt16LE(at+actorName.length),0xae22);assert.equal(added.readUInt32LE(at+actorName.length+6),4);assert.equal(at+actorName.length+10,added.length); // no invalid saved-state AE24
  assert.deepEqual(p.manifest.history.at(-1).files.map(f=>f.path),[scenePath]);assert.deepEqual(await p.read('tables/vehicles.bin'),table());
  const reopened=await ModProject.open(root),dest=path.join(root,'export');await reopened.export(dest);assert.deepEqual(await fs.readFile(path.join(dest,scenePath)),added);await reopened.undo();assert.deepEqual(await reopened.read(scenePath),scene);
});
