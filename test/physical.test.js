import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {physicalFields} from '../src/shared/physical-parameters.js';
import {inspectPhysical,editPhysical,createPhysical} from '../src/core/physical.js';
import {inspectScene,editScene,changeSceneObject} from '../src/core/scene.js';
import {groupSceneProperties} from '../src/shared/scene-properties.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';

const chunk=(type,payload)=>{const b=Buffer.alloc(6);b.writeUInt16LE(type);b.writeUInt32LE(payload.length+6,2);return Buffer.concat([b,payload]);};
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
function fixture(){const b=Buffer.alloc(40,0xa9);b[0]=2;b[1]=1;b.writeFloatLE(1,2);b.writeFloatLE(1.125,6);b.writeFloatLE(50,10);b.writeFloatLE(.5,14);b.writeFloatLE(.01,18);b.writeInt32LE(3,22);b[26]=1;b.writeInt32LE(95,27);return b;}
const data=fixture(),opaque=chunk(0xfefe,Buffer.from('opaque sibling'));
const scene=chunk(0x4c53,Buffer.concat([chunk(0x4000,chunk(0x4010,Buffer.concat([chunk(0x10,Buffer.from('Crate\0')),chunk(0x4011,u32(9))]))),chunk(0xae20,chunk(0xae21,Buffer.concat([chunk(0xae23,Buffer.from('Crate\0')),chunk(0xae22,u32(35)),chunk(0xae24,data),opaque]))),opaque]));

test('v2 physical descriptor exposes eight fields and writes only the chosen field, preserving unknown wheel data and tails',()=>{
  const fields=inspectPhysical(data);assert.equal(fields.length,8);assert.equal(fields.find(f=>f.key==='hitParameter').value,95);
  const replacements={box:false,wheelRadius:2,mass:125,friction:.75,wheelDamping:.25,impactSound:-1,restartSound:false,hitParameter:-1};
  for(const field of fields){assert.deepEqual(editPhysical(data,field.key,field.value),data);const changed=editPhysical(data,field.key,replacements[field.key]);assert.equal(inspectPhysical(changed).find(f=>f.key===field.key).value,replacements[field.key]);assert.deepEqual(changed.subarray(0,field.offset),data.subarray(0,field.offset));assert.deepEqual(changed.subarray(field.offset+field.bytes),data.subarray(field.offset+field.bytes));assert.deepEqual(editPhysical(changed,field.key,field.value),data);}
  assert.deepEqual(data,fixture());assert.equal(physicalFields.some(f=>f.offset===6),false);
});

test('physical editing rejects unsupported versions, malformed flags and invalid numeric values without rebuilding the actor',()=>{
  for(const altered of [data.subarray(0,30),Buffer.from(data)]){if(altered.length>=31)altered[0]=1;assert.deepEqual(inspectPhysical(altered),[]);assert.throws(()=>editPhysical(altered,'mass',1),/nepodporovaný/);}
  for(const offset of [1,26]){const b=Buffer.from(data);b[offset]=2;assert.deepEqual(inspectPhysical(b),[]);}
  const bad=Buffer.from(data);bad.writeFloatLE(NaN,14);assert.deepEqual(inspectPhysical(bad),[]);
  for(const [key,value] of [['mass',0],['mass',100001],['mass',Infinity],['friction',-1],['wheelRadius',0],['wheelDamping',-1],['box',1],['impactSound',14],['impactSound',-2],['impactSound',1.5],['hitParameter',2147483648]])assert.throws(()=>editPhysical(data,key,value),/neplatná|rozsah/);
  const unusual=Buffer.from(data);unusual.writeInt32LE(42,22);assert.deepEqual(editPhysical(unusual,'impactSound',42),unusual);assert.throws(()=>editPhysical(unusual,'impactSound',43),/rozsah/);
});

test('scene physical settings belong to the actor frame and preserve sibling chunks and actor flags',()=>{
  const file=inspectScene(scene),settings=file.entries.filter(e=>e.physicalParameter);assert.equal(settings.length,8);assert.equal(file.objects[0].actorBound,true);
  const group=groupSceneProperties(file).find(g=>g.name==='Crate');assert.ok(settings.every(e=>group.entries.some(item=>item.entry.id===e.id)));
  for(const entry of settings)assert.deepEqual(editScene(scene,entry.id,entry.value),scene);
  const mass=settings.find(e=>e.key==='mass'),changed=editScene(scene,mass.id,75);assert.equal(inspectScene(changed).entries.find(e=>e.id===mass.id).value,75);assert.ok(changed.includes(opaque));assert.deepEqual(editScene(changed,mass.id,50),scene);
});

test('project physical edits reopen, export and undo exact bytes with stale-write protection',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-physical-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Physical',assets:[],history:[]}));const p=await ModProject.open(root),name='missions/Test/scene2.bin';await p.createFiles([{path:name,data:scene}]);const history=p.manifest.history.length,entries=inspectScene(scene).entries.filter(e=>e.physicalParameter),changes=entries.filter(e=>['mass','impactSound','restartSound'].includes(e.key)).map(e=>({id:e.id,value:{mass:125,impactSound:-1,restartSound:false}[e.key]}));
  await assert.rejects(p.saveScene(name,changes,'stale'),/změnil/);assert.equal(p.manifest.history.length,history);await p.saveScene(name,changes,hash(scene));assert.equal(p.manifest.history.length,history+1);const changed=await p.read(name),reopened=await ModProject.open(root);assert.deepEqual(await reopened.read(name),changed);assert.equal(inspectScene(changed).entries.find(e=>e.key==='impactSound').value,-1);
  const output=path.join(root,'export');await reopened.export(output);assert.deepEqual(await fs.readFile(path.join(output,name)),changed);await reopened.undo();assert.deepEqual(await reopened.read(name),scene);assert.equal(reopened.manifest.history.length,history);
});

test('new physical actors have a complete v2 descriptor with engine defaults and strict input validation',()=>{
  const created=createPhysical();assert.equal(created.length,31);assert.equal(created[0],2);assert.equal(created.readFloatLE(6),1);
  for(const field of inspectPhysical(created))assert.equal(field.value,field.kind==='float'?Math.fround(field.default):field.default);
  const wheel=createPhysical({box:false,wheelRadius:2,mass:125,friction:.75,wheelDamping:.125,impactSound:3,restartSound:false,hitParameter:95});
  assert.equal(wheel[1],0);assert.equal(wheel.readFloatLE(2),2);assert.equal(wheel.readFloatLE(6),1);assert.equal(wheel.readFloatLE(10),125);assert.equal(wheel.readInt32LE(27),95);
  for(const parameters of [null,[],{unknown:1},{box:1},{mass:0},{mass:100001},{wheelRadius:0},{impactSound:14},{friction:-1},{hitParameter:1.1}])assert.throws(()=>createPhysical(parameters),/Fyzikální/);
});

test('physical actor attachment binds a unique model without changing frames, opaque siblings or previous actors',()=>{
  const frame=chunk(0x4010,Buffer.concat([chunk(0x10,Buffer.from('NewCrate\0')),chunk(0x4011,u32(9)),chunk(0x2012,Buffer.from('crate.i3d\0')),opaque])),original=chunk(0x4c53,Buffer.concat([chunk(0x4000,frame),opaque]));
  const changed=changeSceneObject(original,{kind:'attach-physical',target:'newcrate',parameters:{mass:75,impactSound:1}}),parsed=inspectScene(changed);
  assert.ok(changed.includes(frame));assert.ok(changed.includes(opaque));assert.equal(parsed.objects[0].actorBound,true);assert.equal(parsed.entries.find(e=>e.physicalParameter&&e.key==='mass').value,75);
  assert.equal(parsed.entries.find(e=>e.label==='Název aktéra').value,'NewCrate');assert.equal(parsed.entries.find(e=>e.label==='Typ aktéra').value,35);
  const actor=Buffer.concat([chunk(0xae23,Buffer.from('NewCrate\0')),chunk(0xae22,u32(35)),chunk(0xae24,createPhysical({mass:75,impactSound:1}))]);assert.ok(changed.includes(actor));
  assert.throws(()=>changeSceneObject(changed,{kind:'attach-physical',target:'NEWCRATE'}),/už má/);
  for(const target of ['',null,'Missing','NewCrate\0'])assert.throws(()=>changeSceneObject(original,{kind:'attach-physical',target}),/Fyzikální/);
  assert.throws(()=>changeSceneObject(original,{kind:'attach-physical',target:'NewCrate'},['NEWCRATE']),/samostatný/);
  const duplicate=chunk(0x4c53,chunk(0x4000,Buffer.concat([frame,frame])));assert.throws(()=>changeSceneObject(duplicate,{kind:'attach-physical',target:'NewCrate'}),/samostatný/);
  const withActor=chunk(0x4c53,Buffer.concat([chunk(0x4000,frame),chunk(0xae20,chunk(0xae21,Buffer.concat([chunk(0xae23,Buffer.from('Other\0')),chunk(0xae22,u32(35)),chunk(0xae24,data),opaque]))),opaque]));
  const attached=changeSceneObject(withActor,{kind:'attach-physical',target:'NewCrate'});assert.ok(attached.includes(chunk(0xae24,data)));assert.equal(inspectScene(attached).entries.filter(e=>e.physicalParameter).length,16);
});
