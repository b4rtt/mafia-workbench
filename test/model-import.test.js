import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prepareModelImport } from '../src/core/model-import.js';
import { ModProject } from '../src/core/project.js';
import { hash, writeSafe } from '../src/core/files.js';
import { parseFourDs } from '../src/core/fourds.js';

function u16(n){const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;}
function floats(values){const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeFloatLE(v,i*4));return b;}
function text(value){return Buffer.concat([Buffer.from([value.length]),Buffer.from(value)]);}
function model({texture='wall.bmp',alpha='',environment='',animated=false,instance=0}={}){
  const header=Buffer.alloc(14);header.write('4DS\0');header.writeUInt16LE(29,4);
  const flags=Buffer.alloc(4);flags.writeUInt32LE((alpha?0x40000000:0)|(environment?0x80000:0)|(animated?0x4000000:0));
  const material=Buffer.concat([flags,floats([.1,.1,.1,1,1,1,0,0,0,1]),...(environment?[floats([.5]),text(environment)]:[]),text(texture),...(alpha?[text(alpha)]:[]),...(animated?[Buffer.alloc(18)]:[])]);
  const mesh=Buffer.concat([Buffer.from([1,0,0,0]),u16(0),floats([0,0,0,1,1,1,1,0,0,0]),Buffer.from([0]),text('triangle'),text('opaque'),u16(instance),...(instance?[]:[Buffer.from([1]),floats([0]),u16(3),floats([0,0,0,0,1,0,0,0,1,0,0,0,1,0,1,0,0,1,0,0,1,0,0,1]),Buffer.from([1]),u16(1),u16(0),u16(1),u16(2),u16(1)])]);
  return Buffer.concat([header,u16(1),material,u16(1),mesh,Buffer.from([0x63])]);
}
function bmp(color=123){const b=Buffer.alloc(58);b.write('BM');b.writeUInt32LE(58,2);b.writeUInt32LE(54,10);b.writeUInt32LE(40,14);b.writeInt32LE(1,18);b.writeInt32LE(1,22);b.writeUInt16LE(1,26);b.writeUInt16LE(24,28);b.fill(color,54);return b;}
const bundle=()=>[{name:'House.4DS',data:model()},{name:'wall.bmp',data:bmp()}];
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-import-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:2,name:'Import',assets:[],history:[]}));return {root,p:await ModProject.open(root)};}
const expected=plan=>({path:plan.path,files:plan.expected});

test('native model bundle preserves bytes, resolves diffuse/alpha/reflection names and validates every file',()=>{
  const files=[{name:'house.4ds',data:model({alpha:'wall+.bmp',environment:'env.bmp'})},{name:'wall.bmp',data:bmp()},{name:'wall+.bmp',data:bmp(11)},{name:'env.bmp',data:bmp(12)}];
  const result=prepareModelImport(files,'renamed.4ds');assert.equal(result.target,'models/renamed.4ds');assert.deepEqual(result.references.sort(),['maps/env.bmp','maps/wall+.bmp','maps/wall.bmp']);assert.deepEqual(result.files.map(file=>file.data),files.map(file=>file.data));assert.equal(result.summary.meshes,1);
  for(const name of ['../house.4ds','CON.4ds','Žlutý.4ds','house.4ds ','x:y.4ds'])assert.throws(()=>prepareModelImport(files,name),/název/);
  assert.throws(()=>prepareModelImport([...bundle(),bundle()[0]]),/opakovaný/);assert.throws(()=>prepareModelImport([bundle()[1]]),/právě jeden/);
  assert.throws(()=>prepareModelImport([{name:'house.4ds',data:model({animated:true})}]),/sekvence|Sekvence/);
  assert.throws(()=>prepareModelImport([{name:'house.4ds',data:model({texture:'..\\wall.bmp'})}]),/název/);
  for(const instance of [1,2])assert.throws(()=>prepareModelImport([{name:'house.4ds',data:model({instance})}]),/instanci/);
  const original=model(),lod=parseFourDs(original,'all').meshes[0].lods[0];
  for(const offset of [lod.vertexOffset-6,lod.vertexOffset+12,lod.vertexOffset+24]){const bad=Buffer.from(original);bad.writeFloatLE(NaN,offset);assert.throws(()=>prepareModelImport([{name:'house.4ds',data:bad}]),/geometrie/);}
  assert.throws(()=>prepareModelImport([{name:'house.4ds',data:model().subarray(0,-1)}]),/4DS/);assert.throws(()=>prepareModelImport([{name:'house.4ds',data:model()}, {name:'wall.bmp',data:Buffer.alloc(10)}]),/BMP/);
});
test('import creates one undo transaction, reopens and exports exact assets without altering source bytes',async t=>{
  const {root,p}=await fixture(t),files=bundle(),before=JSON.stringify(p.manifest),copies=files.map(file=>Buffer.from(file.data));const plan=await p.previewModelImport(files,'Town.4ds');assert.deepEqual(plan.files.map(file=>file.status),['new','new']);assert.deepEqual(plan.blocked,[]);
  assert.equal(await p.importModel(files,'Town.4ds',expected(plan)),'models/Town.4ds');assert.equal(p.manifest.history.length,1);assert.equal(p.asset('MODELS/TOWN.4DS').archive,'Vlastní model');assert.deepEqual(files.map(file=>file.data),copies);
  const reopened=await ModProject.open(root);await reopened.export(path.join(root,'export'));assert.deepEqual(await fs.readFile(path.join(root,'export/models/Town.4ds')),files[0].data);assert.deepEqual(await reopened.read('maps/wall.bmp'),files[1].data);await reopened.undo();assert.equal(JSON.stringify(reopened.manifest),before);assert.throws(()=>reopened.asset('models/Town.4ds'));
});
test('missing textures, case-insensitive model conflicts and different existing texture contents block all publication',async t=>{
  const {p}=await fixture(t),files=bundle();let plan=await p.previewModelImport([files[0]]);assert.equal(plan.files[1].status,'missing');await assert.rejects(()=>p.importModel([files[0]],undefined,expected(plan)),/Chybí/);assert.equal(p.manifest.assets.length,0);
  await p.createFiles([{path:'MAPS/WALL.BMP',data:bmp(7)}]);const before=JSON.stringify(p.manifest);plan=await p.previewModelImport(files);assert.equal(plan.files[1].status,'conflict');await assert.rejects(()=>p.importModel(files,undefined,expected(plan)),/jinými daty/);assert.equal(JSON.stringify(p.manifest),before);
  await p.createFiles([{path:'models/HOUSE.4ds',data:model()}]);plan=await p.previewModelImport([files[0]]);assert.equal(plan.files[0].status,'conflict');await assert.rejects(()=>p.importModel([files[0]],undefined,expected(plan)),/modelem/);
});
test('existing identical textures are reused even with different case and their bytes are guarded against stale preview',async t=>{
  const {p}=await fixture(t),files=bundle();await p.createFiles([{path:'MAPS/WALL.BMP',data:bmp()}]);const before=JSON.stringify(p.manifest);let plan=await p.previewModelImport(files);assert.equal(plan.files[1].status,'reuse');await p.importModel(files,undefined,expected(plan));assert.equal(p.manifest.history.at(-1).files.length,1);await p.undo();assert.equal(JSON.stringify(p.manifest),before);
  plan=await p.previewModelImport([files[0]]);await p.change('maps/wall.bmp',bmp(7));await assert.rejects(()=>p.importModel([files[0]],undefined,expected(plan)),/od náhledu/);assert.throws(()=>p.asset('models/House.4DS'));await p.undo();
  await assert.rejects(()=>p.importModel(files,'Other.4ds',expected(plan)),/od náhledu/);
});
test('changed dependencies during staging and failed manifest publication expose no partial imported files',async t=>{
  const {root,p}=await fixture(t),files=bundle();await p.createFiles([{path:'maps/wall.bmp',data:bmp()}]);const before=JSON.stringify(p.manifest),plan=await p.previewModelImport([files[0]]),save=p.saveManifest;
  p.saveManifest=async()=>{throw new Error('publication failed');};await assert.rejects(()=>p.importModel([files[0]],undefined,expected(plan)),/publication failed/);assert.equal(JSON.stringify(p.manifest),before);assert.throws(()=>p.asset('models/House.4DS'));p.saveManifest=save;
  const read=p.read;let reads=0;p.read=async function(name){const result=await read.call(this,name);return name.toLowerCase()==='maps/wall.bmp'&&++reads===3?bmp(8):result;};await assert.rejects(()=>p.importModel([files[0]],undefined,expected(plan)),/Závislý/);assert.equal(JSON.stringify(p.manifest),before);p.read=read;
  const reopened=await ModProject.open(root);assert.equal(reopened.manifest.assets.length,1);assert.equal(hash(await reopened.read('maps/wall.bmp')),hash(bmp()));
});
